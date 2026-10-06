// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * WHERE AN ACTIONS SECRET HAS TO LIVE for a repository's workflow to receive it (rule-model-design.md, "secrets on
 * Free + private"; Policy Owner ruling 2026-10-07: per-repo secrets plus detection).
 *
 * SANDBOX FINDING (svayam-e2e, 2026-10-07). On GitHub's FREE plan an ORGANIZATION secret is not given to a PRIVATE
 * repository: the job sees an empty value, and nothing warns. So the org's GitHub App secrets (`GOV_APP_*`) and an
 * org-level model key silently never arrive in a private repo on Free.
 *
 * THE RULE, in one pure function ({@link secretReach}): an org secret reaches a repository when the plan is paid
 * (team or enterprise) OR the repository is public. Otherwise the repository needs repository secrets. A plan gov
 * could not read (only an org OWNER's token sees `plan`) is never assumed: a private repo is then `cannot-tell`.
 *
 * Writers and readers go through an injected `gh` (a value only ever on STDIN — never an argument, never printed).
 */
import type { GhOutcome, GhRun } from "./app-verb.js";
import type { ModelSettings } from "../rules/propose/model-settings.js";
import { ANTHROPIC_KEY_ENV } from "../rules/propose/providers/anthropic.js";
import { GEMINI_KEY_ENV } from "../rules/propose/providers/gemini.js";

export type PlanFact = { readonly known: true; readonly name: string } | { readonly known: false; readonly why: string };
export type Visibility = "public" | "private" | "internal";
export interface RepoFact { readonly repo: string; readonly visibility: Visibility | null; readonly why?: string }
export type Reach = "org" | "repo-required" | "cannot-tell";
export interface RepoReach { readonly repo: string; readonly reach: Reach; readonly why: string }

/** The plan names GitHub reports for a PAID organization plan. Anything else that is not `free` is not assumed. */
const PAID = new Set(["team", "enterprise", "business", "business_plus"]);

/** Does an org secret reach each repository? Pure; one row per repo, in order. */
export function secretReach(plan: PlanFact, repos: readonly RepoFact[]): RepoReach[] {
  const paid = plan.known && PAID.has(plan.name.toLowerCase());
  const free = plan.known && plan.name.toLowerCase() === "free";
  return repos.map((r): RepoReach => {
    if (r.visibility === "public") return { repo: r.repo, reach: "org", why: "the repository is public" };
    if (paid) return { repo: r.repo, reach: "org", why: `the ${plan.known ? plan.name : ""} plan gives org secrets to private repositories` };
    if (!plan.known) return { repo: r.repo, reach: "cannot-tell", why: `gov could not read the org's plan (${plan.why})` };
    if (!free) return { repo: r.repo, reach: "cannot-tell", why: `gov does not know the plan "${plan.name}"` };
    if (r.visibility === null) return { repo: r.repo, reach: "cannot-tell", why: `gov could not read the repository's visibility (${r.why ?? "no answer"})` };
    return { repo: r.repo, reach: "repo-required", why: `on the Free plan, org secrets do not reach a ${r.visibility} repository` };
  });
}

const firstLine = (s: string): string => s.split(/\r?\n/).map((l) => l.trim()).find(Boolean)?.slice(0, 200) ?? "no output";

/** The org's plan from `gh api /orgs/{org}`. Only an org owner's token sees `plan`; without it, cannot-tell. */
export function readPlan(gh: GhRun, org: string): PlanFact {
  const r = gh(["api", `/orgs/${org}`, "--jq", ".plan.name"]);
  if (r.status !== 0) return { known: false, why: firstLine(r.stderr) };
  const name = r.stdout.trim();
  return name && name !== "null"
    ? { known: true, name }
    : { known: false, why: `GitHub shows the plan only to an org owner — run this as an owner of ${org}` };
}

/** A repository's visibility from `gh api /repos/{o}/{r}`; null with the reason when it cannot be read. */
export function readVisibility(gh: GhRun, full: string): RepoFact {
  const r = gh(["api", `/repos/${full}`, "--jq", ".visibility"]);
  const v = r.stdout.trim().toLowerCase();
  if (r.status === 0 && (v === "public" || v === "private" || v === "internal")) return { repo: full, visibility: v };
  return { repo: full, visibility: null, why: r.status === 0 ? `unexpected answer "${v}"` : firstLine(r.stderr) };
}

/** The plan once, each distinct repository once, and the reach for each. */
export function readReach(gh: GhRun, org: string, repos: readonly string[]): { plan: PlanFact; reaches: RepoReach[] } {
  const plan = readPlan(gh, org);
  const facts = [...new Set(repos)].map((r) => readVisibility(gh, r));
  return { plan, reaches: secretReach(plan, facts) };
}

// ── writing ───────────────────────────────────────────────────────────────────────────────────────────────

export interface SecretValue { readonly name: string; readonly value: string }

/**
 * Set each secret where it reaches: as an org secret when any repository is reached by one (or gov cannot tell),
 * and as a REPOSITORY secret on every repository that needs it (or where gov cannot tell — a repository secret
 * always reaches, so writing it is never a guess). Values go on gh's STDIN only.
 */
export function writeSecrets(gh: GhRun, org: string, reaches: readonly RepoReach[], values: readonly SecretValue[]): { lines: string[]; failed: boolean } {
  const lines: string[] = [];
  let failed = false;
  const names = values.map((v) => v.name).join(" and ");
  const set = (args: string[], value: string): GhOutcome => gh(["secret", "set", ...args], value);

  const orgUseful = reaches.length === 0 || reaches.some((r) => r.reach !== "repo-required");
  if (orgUseful) {
    const bad = values.map((v) => ({ v, r: set([v.name, "--org", org, "--visibility", "all"], v.value) })).find((x) => x.r.status !== 0);
    if (bad) {
      failed = true;
      lines.push(`  ✗ the ${org} org secret ${bad.v.name} could not be set (${firstLine(bad.r.stderr)}) — org secrets need an org owner with the admin:org scope: gh auth refresh -h github.com -s admin:org; then \`gov app rotate\``);
    } else {
      const reached = reaches.filter((r) => r.reach === "org").map((r) => r.repo);
      lines.push(`Stored ${names} as ${org} organization Actions secrets (visible to all its repositories)${reached.length ? ` — they reach ${reached.join(", ")}` : ""}.`);
    }
  } else {
    lines.push(`Did not store ${names} as ${org} organization secrets: on the Free plan they reach none of these private repositories.`);
  }

  for (const r of reaches.filter((x) => x.reach !== "org")) {
    const bad = values.map((v) => ({ v, out: set([v.name, "-R", r.repo], v.value) })).filter((x) => x.out.status !== 0);
    if (bad.length) {
      failed = true;
      lines.push(`  ✗ ${r.repo}: could not set ${bad.map((b) => b.v.name).join(", ")} (${firstLine(bad[0]!.out.stderr)}) — setting a repository secret needs admin on ${r.repo}; then \`gov app rotate\``);
    } else {
      lines.push(r.reach === "repo-required"
        ? `Stored ${names} as repository secrets on ${r.repo} (${r.why}).`
        : `Stored ${names} as repository secrets on ${r.repo} too: gov could not tell whether the org secret reaches it (${r.why}).`);
    }
  }
  return { lines, failed };
}

// ── checking ──────────────────────────────────────────────────────────────────────────────────────────────

export interface SecretNeed {
  /** `owner/name`. */
  readonly repo: string;
  readonly name: string;
  /** The exact fix, said as a command. */
  readonly fix: string;
}

export interface NeedsResult { readonly pass: string[]; readonly fail: string[]; readonly unsure: string[] }

/**
 * Which repository will NOT receive a secret it needs. `orgSecrets` is the org's secret names, or null when they
 * could not be read. Names only: gh never shows a value.
 */
export function checkSecretNeeds(gh: GhRun, org: string, needs: readonly SecretNeed[], orgSecrets: readonly string[] | null): NeedsResult {
  const out: NeedsResult = { pass: [], fail: [], unsure: [] };
  if (!needs.length) return out;
  const { reaches } = readReach(gh, org, needs.map((n) => n.repo));
  const repoSecrets = new Map<string, string[] | null>();
  const repoList = (repo: string): string[] | null => {
    if (!repoSecrets.has(repo)) {
      const r = gh(["secret", "list", "-R", repo, "--json", "name"]);
      let names: string[] | null = null;
      if (r.status === 0) {
        try { names = (JSON.parse(r.stdout) as { name?: string }[]).map((x) => x.name ?? ""); } catch { /* not JSON: no answer */ names = null; }
      }
      repoSecrets.set(repo, names);
    }
    return repoSecrets.get(repo)!;
  };
  for (const n of needs) {
    const reach = reaches.find((r) => r.repo === n.repo)!;
    const own = reach.reach === "org" ? null : repoList(n.repo);
    if (reach.reach === "org") {
      if (orgSecrets === null) out.unsure.push(`whether ${n.repo} receives ${n.name}: the org's secrets could not be read`);
      else if (orgSecrets.includes(n.name)) out.pass.push(`${n.repo} receives ${n.name} from the org secret (${reach.why})`);
      else if ((repoList(n.repo) ?? []).includes(n.name)) out.pass.push(`${n.repo} has ${n.name} as a repository secret`);
      else out.fail.push(`${n.repo} will not receive ${n.name}: it is set neither for ${org} nor on the repository — ${n.fix}`);
    } else if (own?.includes(n.name)) {
      out.pass.push(`${n.repo} has ${n.name} as a repository secret`);
    } else if (reach.reach === "repo-required") {
      out.fail.push(own === null
        ? `${n.repo} needs ${n.name} as a repository secret (on the Free plan, org secrets do not reach a private repository), and its secrets could not be read — ${n.fix}`
        : `${n.repo} will not receive ${n.name}: on the Free plan, org secrets do not reach a private repository — ${n.fix}`);
    } else {
      out.unsure.push(`whether ${n.repo} receives ${n.name}: ${reach.why}; no repository secret is set there — to be sure: ${n.fix}`);
    }
  }
  return out;
}

/** The secret the approved model needs in the governance repo — only when CI may use the model. Pure. */
export function keyNameFor(s: ModelSettings): string | null {
  if (!s.ciAllowed) return null;
  if (s.provider === "anthropic") return ANTHROPIC_KEY_ENV;
  if (s.provider === "gemini") return GEMINI_KEY_ENV;
  return null;
}
