// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The GitHub adapter of {@link VcsEvidencePort} (evidence administration — see ports/vcs.ts), over the `gh` CLI. Every call is one or a
 * few `gh api` calls; a request body goes on gh's STDIN (`--input -`), never on argv, so nothing secret or bulky
 * reaches the process list or gov's process log.
 */
import type { BranchRuleset, NewApp, NewFile, RepoInfo, RepoRef, RulesetSummary, VcsEvidencePort, BranchInfo } from "../../ports/vcs.js";
import { fail, ok, type Result } from "../../ports/result.js";

/** Run `gh` with these arguments; `input` is its stdin. Never throws. */
export type GhCall = (args: readonly string[], input?: string) => { status: number; stdout: string; stderr: string };

const firstLine = (s: string): string => s.split(/\r?\n/).map((l) => l.trim()).find(Boolean)?.slice(0, 200) ?? "no output";

function parse<T>(s: string): T | null {
  try { return JSON.parse(s) as T; } catch { /* not JSON — the caller reports "unexpected answer" */ return null; }
}

/** A failed gh call, sorted: 404 is "missing", 401/403 "forbidden"; anything else may be worth retrying. */
function why(r: { stderr: string; stdout: string }): { kind: "missing" | "forbidden" | "other"; text: string } {
  const t = `${r.stderr}\n${r.stdout}`;
  if (/HTTP 404|Not Found/i.test(t)) return { kind: "missing", text: firstLine(r.stderr || r.stdout) };
  if (/HTTP 40[13]|Resource not accessible|must have admin|Upgrade to GitHub|insufficient/i.test(t)) return { kind: "forbidden", text: firstLine(r.stderr || r.stdout) };
  return { kind: "other", text: firstLine(r.stderr || r.stdout) };
}

const failFrom = (what: string, r: { stderr: string; stdout: string }): Result<never> => {
  const w = why(r);
  return fail(`${what}: ${w.text}`, w.kind === "other");
};

export function githubVcs(gh: GhCall): VcsEvidencePort {
  const repoPath = (r: RepoRef): string => `/repos/${r.owner}/${r.name}`;
  const post = (path: string, body: unknown) => gh(["api", "-X", "POST", path, "--input", "-"], JSON.stringify(body));

  return {
    repo(r) {
      const out = gh(["api", repoPath(r)]);
      if (out.status !== 0) return Promise.resolve(failFrom(`could not read ${r.owner}/${r.name}`, out));
      const j = parse<{ default_branch?: string; html_url?: string; visibility?: string; private?: boolean }>(out.stdout);
      if (!j?.default_branch) return Promise.resolve(fail(`unexpected answer reading ${r.owner}/${r.name}`));
      const visibility: RepoInfo["visibility"] = j.visibility === "public" || j.visibility === "internal" ? j.visibility : j.private === false ? "public" : "private";
      return Promise.resolve(ok({ defaultBranch: j.default_branch, url: j.html_url ?? `https://github.com/${r.owner}/${r.name}`, visibility }));
    },

    branch(r, name) {
      const out = gh(["api", `${repoPath(r)}/branches/${encodeURIComponent(name)}`]);
      if (out.status !== 0) return Promise.resolve(why(out).kind === "missing" ? ok(null) : failFrom(`could not read branch ${name}`, out));
      const j = parse<{ name?: string; commit?: { sha?: string }; protected?: boolean }>(out.stdout);
      if (!j?.commit?.sha) return Promise.resolve(fail(`unexpected answer reading branch ${name}`));
      const b: BranchInfo = { name: j.name ?? name, sha: j.commit.sha, protected: j.protected === true };
      return Promise.resolve(ok(b));
    },

    createOrphanBranch(r, name, files: readonly NewFile[], message) {
      // A tree with no base, a commit with NO parents, then a NEW ref — the only write. No existing ref is touched.
      const t = post(`${repoPath(r)}/git/trees`, { tree: files.map((f) => ({ path: f.path, mode: "100644", type: "blob", content: f.text })) });
      const tree = t.status === 0 ? parse<{ sha?: string }>(t.stdout)?.sha : undefined;
      if (!tree) return Promise.resolve(t.status === 0 ? fail("unexpected answer creating the tree") : failFrom("could not create the branch's files", t));
      const c = post(`${repoPath(r)}/git/commits`, { message, tree, parents: [] });
      const commit = c.status === 0 ? parse<{ sha?: string }>(c.stdout)?.sha : undefined;
      if (!commit) return Promise.resolve(c.status === 0 ? fail("unexpected answer creating the commit") : failFrom("could not create the branch's first commit", c));
      const ref = post(`${repoPath(r)}/git/refs`, { ref: `refs/heads/${name}`, sha: commit });
      if (ref.status !== 0) return Promise.resolve(failFrom(`could not create branch ${name}`, ref));
      return Promise.resolve(ok({ sha: commit }));
    },

    rulesets(r) {
      const out = gh(["api", `${repoPath(r)}/rulesets?per_page=100`]);
      if (out.status !== 0) return Promise.resolve(failFrom("could not list the repository's rulesets", out));
      const j = parse<{ id?: number; name?: string }[]>(out.stdout);
      if (!Array.isArray(j)) return Promise.resolve(fail("unexpected answer listing rulesets"));
      return Promise.resolve(ok(j.filter((x) => typeof x.id === "number" && typeof x.name === "string").map((x): RulesetSummary => ({ id: x.id!, name: x.name! }))));
    },

    createRuleset(r, ruleset: BranchRuleset) {
      const out = post(`${repoPath(r)}/rulesets`, ruleset);
      const id = out.status === 0 ? parse<{ id?: number }>(out.stdout)?.id : undefined;
      if (typeof id !== "number") return Promise.resolve(out.status === 0 ? fail("unexpected answer creating the ruleset") : failFrom("could not create the ruleset", out));
      return Promise.resolve(ok({ id }));
    },

    appExists(slug) {
      const out = gh(["api", `/apps/${slug}`]);
      if (out.status === 0) return Promise.resolve(ok(true));
      return Promise.resolve(why(out).kind === "missing" ? ok(false) : failFrom(`could not look up the App ${slug}`, out));
    },

    convertAppManifest(code) {
      // The answer holds the App's private key: only its fields are read, and the text is never printed.
      const out = gh(["api", "-X", "POST", `/app-manifests/${code}/conversions`]);
      if (out.status !== 0) return Promise.resolve(failFrom("GitHub did not hand over the App's credentials", out));
      const j = parse<{ slug?: string; client_id?: string; pem?: string }>(out.stdout);
      if (!j?.slug || !j.client_id || !j.pem) return Promise.resolve(fail("GitHub's answer did not hold the App's slug, client id and key"));
      const app: NewApp = { slug: j.slug, clientId: j.client_id, pem: j.pem };
      return Promise.resolve(ok(app));
    },

    orgSecretNames(org) {
      const out = gh(["secret", "list", "--org", org, "--json", "name"]);
      if (out.status !== 0) return Promise.resolve(failFrom(`could not list ${org}'s Actions secrets (an org owner with the admin:org scope can)`, out));
      const j = parse<{ name?: string }[]>(out.stdout);
      return Promise.resolve(Array.isArray(j) ? ok(j.map((x) => x.name ?? "").filter(Boolean)) : fail("unexpected answer listing secrets"));
    },

    setOrgSecret(org, name, value) {
      const out = gh(["secret", "set", name, "--org", org, "--visibility", "all"], value);
      return Promise.resolve(out.status === 0 ? ok(undefined) : failFrom(`could not set the ${org} org secret ${name} (an org owner with the admin:org scope can)`, out));
    },
  };
}
