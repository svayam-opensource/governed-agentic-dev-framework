// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * VcsPort on GitHub, through `gh api` (PRJ-121 intent 03, L03). The runner is injected ({@link GhRun}), so unit
 * tests use a fake and the live tier runs the conformance suite (test/ports/vcs.conformance.ts) for real.
 *
 * Every call answers with a Result. Where GitHub's "not found" is an ANSWER (a branch that does not exist) it is
 * `ok(null)`; everywhere else it is a failure with GitHub's own words as the reason.
 */
import { fail, ok, type Result } from "../../ports/result.js";
import type {
  AccountKind, BranchInfo, ChangeRequest, ChangeRequestQuery, ChangeRequestRef, Identity, NewChangeRequest, RepoInfo, RepoRef, Review, VcsPort,
} from "../../ports/vcs.js";
import { defaultGhRun, ghCall, ghFailure, ghJson, isNotFound, type GhRun } from "./gh.js";

/** A bot: GitHub's `type: "Bot"`, or a login ending in `[bot]` (an App acting as itself). */
export function isBotAccount(login: string, type?: string | null): boolean {
  return type === "Bot" || /\[bot\]$/.test(login);
}
const kindOf = (login: string, type?: string | null): AccountKind => (isBotAccount(login, type) ? "bot" : "human");

const VERDICTS: Readonly<Record<string, Review["verdict"]>> = {
  APPROVED: "approved", CHANGES_REQUESTED: "changes-requested", COMMENTED: "commented", DISMISSED: "dismissed", PENDING: "pending",
};

const slug = (r: RepoRef): string => `${r.owner}/${r.name}`;

interface GhBranch {
  name?: string; commit?: { sha?: string }; protected?: boolean;
  protection?: { required_status_checks?: { contexts?: string[] | null; checks?: { context?: string }[] | null } | null } | null;
}

export interface GithubVcsDeps { readonly gh?: GhRun }

export function createGithubVcs(deps: GithubVcsDeps = {}): VcsPort {
  const gh = deps.gh ?? defaultGhRun;

  /** The branch as GitHub reports it; ok(null) when it does not exist. */
  const readBranch = (r: RepoRef, name: string): Result<GhBranch | null> => {
    const reply = ghCall(gh, ["api", `repos/${slug(r)}/branches/${name}`]);
    if (isNotFound(reply)) return ok(null);
    if (reply.status !== 0) return ghFailure(reply, `reading branch ${name} of ${slug(r)}`);
    try { return ok(JSON.parse(reply.stdout) as GhBranch); } catch (e) {
      return fail(`reading branch ${name} of ${slug(r)}: GitHub's answer was not JSON (${(e as Error).message.slice(0, 80)})`);
    }
  };

  return {
    async repo(r): Promise<Result<RepoInfo>> {
      const j = ghJson<{ default_branch?: string; html_url?: string; visibility?: string; private?: boolean }>(gh, ["api", `repos/${slug(r)}`], `reading ${slug(r)}`);
      if (!j.ok) return j;
      if (!j.value.default_branch) return fail(`reading ${slug(r)}: GitHub's answer had no default branch`);
      const vis = j.value.visibility === "public" || j.value.visibility === "internal" || j.value.visibility === "private"
        ? j.value.visibility : (j.value.private ? "private" : "public");
      return ok({ defaultBranch: j.value.default_branch, url: j.value.html_url ?? `https://github.com/${slug(r)}`, visibility: vis });
    },

    async branch(r, name): Promise<Result<BranchInfo | null>> {
      const b = readBranch(r, name);
      if (!b.ok || b.value === null) return b as Result<null>;
      const sha = b.value.commit?.sha;
      if (!sha) return fail(`reading branch ${name} of ${slug(r)}: GitHub's answer had no commit`);
      return ok({ name: b.value.name ?? name, sha, protected: b.value.protected === true });
    },

    async openChangeRequest(cr: NewChangeRequest): Promise<Result<ChangeRequestRef>> {
      const j = ghJson<{ number?: number }>(gh, [
        "api", "-X", "POST", `repos/${slug(cr.repo)}/pulls`,
        "-f", `title=${cr.title}`, "-f", `body=${cr.body}`, "-f", `head=${cr.head}`, "-f", `base=${cr.base}`,
        "-F", `draft=${cr.draft === true}`,
      ], `opening a change request ${cr.head} → ${cr.base} in ${slug(cr.repo)}`);
      if (!j.ok) return j;
      if (typeof j.value.number !== "number") return fail(`opening a change request in ${slug(cr.repo)}: GitHub's answer had no number`);
      return ok({ repo: cr.repo, number: j.value.number });
    },

    async changeRequest(ref): Promise<Result<ChangeRequest>> {
      const j = ghJson<{ state?: string; merged?: boolean; draft?: boolean; title?: string; html_url?: string; head?: { ref?: string }; base?: { ref?: string } }>(
        gh, ["api", `repos/${slug(ref.repo)}/pulls/${ref.number}`], `reading change request #${ref.number} of ${slug(ref.repo)}`);
      if (!j.ok) return j;
      const p = j.value;
      const merged = p.merged === true;
      return ok({
        ref, state: merged ? "merged" : p.state === "open" ? "open" : "closed", merged, draft: p.draft === true,
        title: p.title ?? "", url: p.html_url ?? "", head: p.head?.ref ?? "", base: p.base?.ref ?? "",
      });
    },

    async reviews(ref): Promise<Result<Review[]>> {
      // Every page, one review per line: `--paginate` walks the pages and `@json` keeps each one on its own line.
      const reply = ghCall(gh, ["api", "--paginate", `repos/${slug(ref.repo)}/pulls/${ref.number}/reviews?per_page=100`, "--jq", ".[] | @json"]);
      if (reply.status !== 0) return ghFailure(reply, `reading the reviews of #${ref.number} in ${slug(ref.repo)}`);
      const out: Review[] = [];
      for (const line of reply.stdout.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let x: { user?: { login?: string; type?: string } | null; state?: string; submitted_at?: string | null };
        try { x = JSON.parse(line); } catch (e) {
          return fail(`reading the reviews of #${ref.number} in ${slug(ref.repo)}: a line was not JSON (${(e as Error).message.slice(0, 80)})`);
        }
        const login = x.user?.login ?? "ghost";               // GitHub's own name for a deleted account
        const verdict = VERDICTS[x.state ?? ""];
        if (!verdict) return fail(`reading the reviews of #${ref.number} in ${slug(ref.repo)}: unknown review state '${x.state}'`);
        out.push({ by: login, kind: kindOf(login, x.user?.type), verdict, at: x.submitted_at ?? "" });
      }
      return ok(out);
    },

    async changeRequests(r: RepoRef, q: ChangeRequestQuery): Promise<Result<ChangeRequest[]>> {
      // GitHub has no "merged" state to ask for: open, or closed (merged or not), or all — then told apart by
      // merged_at. `head` must be owner-qualified, or GitHub ignores it and answers with every change request.
      const ask = q.state === "open" ? "open" : q.state === "closed" || q.state === "merged" ? "closed" : "all";
      const params = [`state=${ask}`, "per_page=100",
        ...(q.base ? [`base=${encodeURIComponent(q.base)}`] : []),
        ...(q.head ? [`head=${encodeURIComponent(`${r.owner}:${q.head}`)}`] : [])];
      const reply = ghCall(gh, ["api", "--paginate", `repos/${slug(r)}/pulls?${params.join("&")}`, "--jq", ".[] | @json"]);
      const what = `listing the change requests of ${slug(r)}`;
      if (reply.status !== 0) return ghFailure(reply, what);
      const out: ChangeRequest[] = [];
      for (const line of reply.stdout.split(/\r?\n/)) {
        if (!line.trim()) continue;
        let p: { number?: number; state?: string; merged_at?: string | null; draft?: boolean; title?: string; html_url?: string; head?: { ref?: string }; base?: { ref?: string } };
        try { p = JSON.parse(line); } catch (e) { return fail(`${what}: a line was not JSON (${(e as Error).message.slice(0, 80)})`); }
        if (typeof p.number !== "number") return fail(`${what}: a change request had no number`);
        const merged = !!p.merged_at;
        out.push({
          ref: { repo: r, number: p.number }, state: merged ? "merged" : p.state === "open" ? "open" : "closed", merged, draft: p.draft === true,
          title: p.title ?? "", url: p.html_url ?? "", head: p.head?.ref ?? "", base: p.base?.ref ?? "",
        });
      }
      const want = q.state ?? "all";
      return ok(out.filter((c) => want === "all" || c.state === want).sort((a, b) => b.ref.number - a.ref.number));
    },

    async requiredChecks(r, branch): Promise<Result<string[]>> {
      // Two places say a check is required: classic branch protection (shown, read-only, on the branch itself — no
      // admin rights needed) and repository rulesets. Both are read, and the names merged.
      const b = readBranch(r, branch);
      if (!b.ok) return b;
      if (b.value === null) return fail(`reading the required checks of ${branch} in ${slug(r)}: no such branch`);
      const rsc = b.value.protection?.required_status_checks;
      const names = [...(rsc?.contexts ?? []), ...(rsc?.checks ?? []).map((c) => c.context ?? "")];
      const rules = ghCall(gh, ["api", `repos/${slug(r)}/rules/branches/${branch}`]);
      if (rules.status !== 0) {
        // A plan with no rulesets (GitHub Free, private repo) has none to require — an answer, not a failure.
        if (!/upgrade to github pro|make this repository public/i.test(rules.stderr)) return ghFailure(rules, `reading the rulesets of ${branch} in ${slug(r)}`);
      } else {
        let list: { type?: string; parameters?: { required_status_checks?: { context?: string }[] } }[];
        try { list = JSON.parse(rules.stdout); } catch (e) {
          return fail(`reading the rulesets of ${branch} in ${slug(r)}: GitHub's answer was not JSON (${(e as Error).message.slice(0, 80)})`);
        }
        for (const rule of Array.isArray(list) ? list : []) {
          if (rule.type === "required_status_checks") names.push(...(rule.parameters?.required_status_checks ?? []).map((c) => c.context ?? ""));
        }
      }
      return ok([...new Set(names.filter(Boolean))]);
    },

    async identity(): Promise<Result<Identity>> {
      const j = ghJson<{ login?: string; type?: string }>(gh, ["api", "user"], "reading who gh is signed in as");
      if (!j.ok) return j;
      if (!j.value.login) return fail("reading who gh is signed in as: GitHub's answer had no login");
      return ok({ login: j.value.login, kind: kindOf(j.value.login, j.value.type) });
    },
  };
}
