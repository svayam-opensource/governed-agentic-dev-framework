// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov setup <org>/<repo>` — CREATE a governed workspace from nothing (#159).
 *
 * Adoption used to be four manual steps before the tool did anything: create from the template in the
 * GitHub UI, `npm i -g`, `git clone`, `cd`, then `gov setup`. Two of them are where adopters got lost —
 * *which* repo to clone, and *which* directory setup must run in.
 *
 * ONE VERB, AND THE ARGUMENT DECIDES. `gov setup <org>/<repo>` creates; bare `gov setup` configures the
 * workspace you are in, exactly as before; `--non-interactive` never creates whatever the cwd. Creation
 * can never be inferred from location, so a re-run cannot be mistaken for "make me a new one".
 *
 * NOTHING IS CREATED UNTIL EVERYTHING IS KNOWN. `gh` cannot delete a repository without the `delete_repo`
 * scope, which a normal `gh auth login` does not grant — so a half-made repo in someone's GitHub org
 * cannot be rolled back, and requiring adopters to hand a setup command repo-deletion rights is a bad
 * trade. The window is shrunk instead of undone: every precondition is checked and the org slug is known
 * before the first remote call. See `preflight`.
 *
 * Locations are DERIVED, per the workspace-resolution contract (R9/R10), not chosen per machine:
 *   registry   ~/.gov/workspaces · ~/.gov/active
 *   mirror     ~/.gov/<org_slug>/gov_repo
 *   work root  ~/.gov/<org_slug>/projects
 * `--path` overrides the mirror location only; the registry records the override, and resolution reads
 * the registry either way, so R2 is unaffected.
 */

/** The GitHub coordinates of the repo to create. */
export interface CreateTarget {
  readonly org: string;
  readonly repo: string;
}

/** Everything this module touches, injected so the logic is testable without a network or a filesystem. */
export interface CreateIo {
  /** run `gh` with args; return stdout, or null when it exits non-zero. */
  readonly gh: (args: readonly string[]) => string | null;
  /** absolute path of the user's home directory. */
  readonly home: string;
  /** does this path exist? */
  readonly exists: (p: string) => boolean;
  readonly print: (line: string) => void;
}

export type PreflightFailure =
  /** the argument was not `<org>/<repo>`. */
  | { readonly why: "bad-target"; readonly got: string }
  /** `gh` is not authenticated at all. */
  | { readonly why: "not-authenticated" }
  /** authenticated, but cannot create a repository in that org. */
  | { readonly why: "cannot-create"; readonly org: string }
  /** the org ALREADY has a governance repo — creating a second forks the org's policy. */
  | { readonly why: "already-governed"; readonly repo: string; readonly all: readonly string[] }
  /** something is already at the derived (or --path) location. */
  | { readonly why: "path-occupied"; readonly path: string }
  /** the governance probe could not run — refusing rather than risking a duplicate. */
  | { readonly why: "cannot-verify"; readonly org: string };

/** Non-fatal findings. The command proceeds; the adopter is told. */
export interface PreflightWarning {
  readonly what: "no-project-scope" | "cannot-protect-branch" | "governance-scan-truncated";
  readonly detail: string;
}

/**
 * `<org>/<repo>` and nothing else.
 *
 * Deliberately strict: a URL, an `owner/repo/extra`, or a bare name are all things a hurried adopter
 * types, and each would otherwise create a repo somewhere unintended. GitHub's own rules — alphanumerics,
 * `-`, `_`, `.` — are the whole permitted set.
 */
export function parseTarget(arg: string): CreateTarget | null {
  const m = /^([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(arg.trim());
  if (!m) return null;
  return { org: m[1], repo: m[2] };
}

/** The org's canonical locations (R9). `slug` is the answer to "Org slug", lowercased. */
export function derivedPaths(home: string, slug: string): {
  readonly govRepo: string;
  readonly workRoot: string;
  readonly registry: string;
  readonly active: string;
} {
  const root = `${home}/.gov`;
  const org = `${root}/${slug.toLowerCase()}`;
  return { govRepo: `${org}/gov_repo`, workRoot: `${org}/projects`, registry: `${root}/workspaces`, active: `${root}/active` };
}

/** A repo name an adopter need not invent. */
export const suggestRepoName = (slug: string): string => `${slug.toLowerCase()}-gov`;

/**
 * Does this GitHub org already have a governance repo?
 *
 * THE FAILURE THIS PREVENTS IS THE FRAMEWORK'S WORST. A second developer at an adopting org who runs
 * create — and they are, by definition, new — would make a SECOND governance repo, and the org's policy
 * forks silently. Nothing downstream would notice: both repos validate, both resolve, and two halves of
 * one org would govern themselves differently.
 *
 * Searched by content rather than by name, because the name is exactly what a second adopter would pick
 * differently.
 */
export function findExistingGovernanceRepo(io: CreateIo, org: string): { readonly repos: readonly string[]; readonly truncated: boolean; readonly verified: boolean } {
  // NOT `gh search code`. GitHub's code-search index does not cover private repositories, so it returns
  // ZERO for an org whose governance repo is private — which every governance repo is. Verified against
  // Svayamtech: `search/code` reported total_count 0 while the contents API served the file immediately.
  // A check that cannot see the thing it is checking for is worse than no check, because it reports
  // "clear" and the second adopter proceeds.
  //
  // GraphQL asks every repo for the file directly, in one call.
  const raw = io.gh(["api", "graphql", "-f", `org=${org}`, "-f", `query=${GOVERNANCE_PROBE}`,
    "--jq", "{repos: [.data.organization.repositories.nodes[] | select(.object != null) | .nameWithOwner], more: .data.organization.repositories.pageInfo.hasNextPage}"]);
  // FAILING OPEN HERE CREATES A SECOND GOVERNANCE REPO. A probe that could not run must NOT report
  // "clear" — that is what happened on the first real adoption run: the org's existing governance repo
  // was invisible to the token (404), the probe returned nothing, and a duplicate was created in an org
  // that already had one. Blind is blind, whatever the cause.
  if (raw === null) return { repos: [], truncated: false, verified: false };
  try {
    const parsed = JSON.parse(raw) as { repos?: string[]; more?: boolean };
    return { repos: parsed.repos ?? [], truncated: parsed.more === true, verified: true };
  } catch {
    return { repos: [], truncated: false, verified: false };
  }
}

/**
 * Wait for GitHub to finish copying the template before cloning it.
 *
 * `gh repo create --template` RETURNS BEFORE THE COPY COMPLETES. Cloning immediately yields
 * `warning: You appear to have cloned an empty repository` — and setup then configures nothing, while
 * appearing to succeed. Observed on the first real adoption run: the remote ended up with 16 files, the
 * adopter's clone with none.
 *
 * Same read-after-write shape as the npm publish verification (`910-GOV-CICD#132`): the write succeeded,
 * the immediate read did not see it, and the code believed the read.
 */
export function waitForTemplateContent(io: CreateIo, target: CreateTarget, attempts = 10, sleep: (ms: number) => void = () => {}): boolean {
  const full = `${target.org}/${target.repo}`;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const out = io.gh(["api", `repos/${full}/contents`, "--jq", "length"]);
    const n = out === null ? 0 : Number(out.trim());
    if (Number.isFinite(n) && n > 0) return true;
    if (attempt === attempts) break;
    io.print(`  waiting for GitHub to finish copying the template (attempt ${attempt})…`);
    sleep(1000 * attempt);
  }
  return false;
}

/** One call, every repo, "does HEAD:org-config.yaml exist". 100 is GraphQL's per-page maximum. */
const GOVERNANCE_PROBE =
  `query($org:String!){ organization(login:$org){ repositories(first:100){ pageInfo{ hasNextPage } ` +
  `nodes{ nameWithOwner object(expression:"HEAD:org-config.yaml"){ __typename } } } } }`;

/**
 * Everything that must be true BEFORE anything is created.
 *
 * Hard-fails only on what makes the command impossible — no auth, no create permission, an occupied
 * path, or an org that is already governed. Everything else warns and continues: `project` scope will
 * matter (GitHub Projects are the source of truth) but not until `gov seed`, and branch protection is
 * unavailable on private repos under some plans, which must not stop an adoption.
 */
export function preflight(
  io: CreateIo,
  rawTarget: string,
  slug: string,
  pathOverride?: string,
): { readonly ok: false; readonly failure: PreflightFailure } | { readonly ok: true; readonly target: CreateTarget; readonly govRepo: string; readonly warnings: readonly PreflightWarning[] } {
  const target = parseTarget(rawTarget);
  if (!target) return { ok: false, failure: { why: "bad-target", got: rawTarget } };

  if (io.gh(["auth", "status"]) === null) return { ok: false, failure: { why: "not-authenticated" } };

  // Ask GitHub whether this token may create here, rather than inferring it from scopes — an org can
  // forbid member repo creation with every scope present, and the scope list is not the authority.
  const perm = io.gh(["api", `orgs/${target.org}`, "--jq", ".login"]);
  if (perm === null) return { ok: false, failure: { why: "cannot-create", org: target.org } };

  const existing = findExistingGovernanceRepo(io, target.org);
  if (!existing.verified) return { ok: false, failure: { why: "cannot-verify", org: target.org } };
  if (existing.repos.length > 0) return { ok: false, failure: { why: "already-governed", repo: existing.repos[0], all: existing.repos } };

  // NOT a failure any more: an occupied path is the RETRY case. The caller archives the previous
  // attempt and adopts the remote only if it is provably ours (#159 finding 2). Refusing here made every
  // failed run need manual cleanup — the friction this command exists to remove.
  const govRepo = pathOverride ?? derivedPaths(io.home, slug).govRepo;

  const warnings: PreflightWarning[] = [];
  if (existing.truncated) {
    warnings.push({ what: "governance-scan-truncated",
      detail: `${target.org} has more than 100 repositories — only the first 100 were checked for an existing governance repo. Confirm by hand that none exists before continuing.` });
  }
  const scopes = io.gh(["auth", "status"]) ?? "";
  if (!/\bproject\b/.test(scopes)) {
    warnings.push({ what: "no-project-scope",
      detail: "the 'project' scope is missing — GitHub Projects are the source of truth for project state, so `gov seed` will need it. Add it with: gh auth refresh -s project" });
  }
  return { ok: true, target, govRepo, warnings };
}

/** What a preflight failure should say. Every message names the next action, not just the problem. */
export function explainFailure(f: PreflightFailure): readonly string[] {
  switch (f.why) {
    case "bad-target":
      return [`gov setup: '${f.got}' is not <org>/<repo>.`,
              "  to create:    gov setup <github-org>/<repo-name>",
              "  to configure: gov setup            (inside an existing workspace)"];
    case "not-authenticated":
      return ["gov setup: not signed in to GitHub.", "  fix: gh auth login"];
    case "cannot-create":
      return [`gov setup: cannot create a repository in '${f.org}' — the org does not exist, or your token cannot see it.`,
              "  fix: check the org name, then: gh auth refresh -s repo"];
    case "already-governed":
      // Refuses INTO something. A bare refusal here sends a new developer off to create one under a
      // different name, which is the outcome this check exists to prevent.
      //
      // NAME A COMMAND THAT WORKS (#197). This used to say `git clone … && cd … && gov setup`, which
      // leaves the clone in whatever directory the reader happened to be standing in — while the
      // adoption checklist requires it at `~/.gov/<org-slug>/gov_repo`. So the advice could not
      // produce a working machine, and did not say which directory to be in, because no answer
      // existed. `gov` walks the joining path and places the clone where everything else looks.
      //
      // The first-run wizard pivots into that path by itself; this message is for whoever reached
      // `gov setup <org>/<repo>` directly, with no wizard around them.
      return [f.all.length > 1
                ? `gov setup: this org already has ${f.all.length} governance repos (${f.all.join(", ")}) — creating another would fork its policy further.`
                : `gov setup: '${f.repo}' already governs this org — creating a second workspace would fork its policy.`,
              "  you want to JOIN it, not create one. gov clones and places it for you:",
              "    gov          then choose  B. I am a JOINER",
              `  already have a clone?  gov org add ${f.repo.split("/")[0]} --home <path-to-your-clone>`];
    case "cannot-verify":
      // Refuse, do not guess. A duplicate governance repo forks the org's policy silently and cannot be
      // detected afterwards; a refusal costs one command.
      return [`gov setup: could not check whether '${f.org}' already has a governance repo, so it will not create one.`,
              "  a second governance repo would fork your org's policy, silently and unrecoverably.",
              "  check your access:  gh auth refresh -s read:org",
              "  then confirm by hand:  gh repo list " + f.org + " --limit 200"];
    case "path-occupied":
      return [`gov setup: ${f.path} already exists.`,
              "  move it aside, or choose another location with --path <dir>"];
  }
}

/**
 * Publisher scaffolding that must not reach an adopter (#159 finding 6c).
 *
 * The framework repo is also the template, so `gh repo create --template` copies EVERYTHING the
 * publisher needs to build and test itself. An adopter has no TypeScript to build and no framework to
 * document, so these are noise at best — and `.github` is worse than noise: the workflows build the
 * CLI's own source, so a brand-new adopter's first push turns their repo red.
 *
 * Pruned in the adopter's clone, never in the framework repo, which keeps whatever shape it needs.
 * `publish/` is deliberately NOT here: it is the copy source the framework replaces on upgrade.
 */
export const PUBLISHER_ONLY_DIRS: readonly string[] = ["ci", "docs", "packages", ".github"];

/**
 * The framework's OWN working copies, which the template copy also brings.
 *
 * These are not the adopter's content. `publish/content/{agent,knowledge}` is the seed — 26 knowledge
 * files against the framework's own 4 — and per the publish-folder model the CLI GENERATES adopter
 * content from `publish/`, never inherits the framework's working directories. Pruned before seeding,
 * so the seed lands on a clean tree.
 */
export const INHERITED_DIRS: readonly string[] = ["agent", "knowledge"];

/**
 * What an adopter should be left with — asserted after pruning so a new publisher
 * dir cannot creep in. The FLOOR, not the whole answer: everything MANIFEST.yaml
 * scaffolds is expected too, and {@link expectedDirs} unions the two.
 */
export const ADOPTER_DIRS: readonly string[] = ["agent", "knowledge", "publish"];

/**
 * Every top-level directory the manifest scaffolds into an adopter's repo (#193).
 *
 * A clean adoption used to end by calling `.claude .clinerules .continue .cursor
 * .gemini .github .windsurf docs projects` "unexpected directories" and asking to
 * be told if they were publisher-only. They are not: MANIFEST.yaml scaffolds every
 * one of them on purpose — the agent harness is what the session-start protocol
 * runs on. `.github` was in the publisher-only list AND in the manifest, which is
 * the clearest sign the two had drifted.
 *
 * The hand-kept list was a second description of something the manifest already
 * states file by file, and the manifest is the one the installer follows. Deriving
 * removes the copy rather than correcting it — the same move as retiring
 * `registry.yaml` in favour of GitHub, and `ADOPTER_DIRS` vs `~/.gov/<slug>` before it.
 */
export function expectedDirs(manifestText: string | null): readonly string[] {
  const dirs = new Set<string>(ADOPTER_DIRS);
  for (const m of (manifestText ?? "").matchAll(/\bdst:\s*([^\s,}]+)/g)) {
    const dst = m[1]?.trim();
    if (!dst || !dst.includes("/")) continue;      // a root-level FILE, not a directory
    const top = dst.split("/")[0];
    if (top) dirs.add(top);
  }
  return [...dirs];
}

/**
 * Tokens that are SUPPOSED to survive setup: they belong to a project, and at setup
 * time there is no project. `gov seed` resolves them.
 *
 * Reporting these alongside real leaks is what made the warning easy to dismiss —
 * six of the eight it named were genuine, and these two were not.
 */
export const PER_PROJECT_TOKENS: ReadonlySet<string> = new Set(["<PROJECT_ID>", "<PRJ>"]);

/**
 * Token values from org-config.yaml's TEXT, not from its typed parse (#193).
 *
 * The sweep built its map from `parseOrgConfig`, whose interface carries the keys
 * gov-work itself reads — org name, slug, branches. It has no
 * `policy_owner_github`, no `legal_owner_github`, no `policy_effective_date`, so
 * those tokens had no values and survived into the adopter's policy documents:
 * exactly the first impression this whole flow exists to fix.
 *
 * The file is the authority on what it contains. Read it as such.
 */
export function tokenValuesFromOrgConfig(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const m = /^([a-z][a-z0-9_]*):\s*(.+?)\s*$/.exec(raw);
    if (!m) continue;                                  // comment, blank, or nested
    const value = (m[2] ?? "").replace(/^["']|["']$/g, "").trim();
    if (!value || value === "|" || value === ">") continue;
    values[m[1]!.toUpperCase()] = value;
  }
  return values;
}

/** One line per thing setup actually did, printed at the end instead of leaving it silent (6b/6d). */
export interface ManifestLine { readonly what: string; readonly detail: string }

export function renderManifest(lines: readonly ManifestLine[], nextSteps: readonly string[]): readonly string[] {
  const w = Math.max(...lines.map((l) => l.what.length), 9);
  return [
    "",
    ...lines.map((l) => `  ${l.what.padEnd(w)}  ${l.detail}`),
    "",
    "  Next:",
    ...nextSteps.map((s) => `    ${s}`),
    "",
  ];
}

/** Tokens resolved into adopter content at seed time, from org-config values. */
export function substituteTokens(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(/<([A-Za-z_]+)>/g, (whole, key: string) => values[key] ?? whole);
}

/** `<TOKEN>` occurrences left after substitution — a doc the adopter should never have to decode. */
export function leftoverTokens(text: string): readonly string[] {
  return [...new Set([...text.matchAll(/<([A-Z][A-Z_]{2,})>/g)].map((m) => m[0]))];
}

/**
 * Is an already-existing remote safe to adopt after a failed run (#159 finding 2)?
 *
 * `gh` cannot delete a repo without `delete_repo`, so a failed run leaves one behind and the retry hits
 * `Name already exists on this account`. Adopting blindly would prune and force-push over whatever is
 * there — unrecoverable if it is someone's real work. So: adopt ONLY what could only have come from a
 * failed run of this command, refuse anything else, and never guess between the two.
 */
export type AdoptVerdict =
  | { readonly adopt: true; readonly why: "empty" | "template-shaped" }
  | { readonly adopt: false; readonly why: "not-ours" | "cannot-tell"; readonly detail: string };

export function canAdoptExisting(io: CreateIo, target: CreateTarget): AdoptVerdict {
  const full = `${target.org}/${target.repo}`;
  const perm = io.gh(["api", `repos/${full}`, "--jq", ".permissions.admin"]);
  if (perm === null) return { adopt: false, why: "cannot-tell", detail: `cannot read ${full}` };
  if (perm.trim() !== "true") return { adopt: false, why: "not-ours", detail: `you are not an admin of ${full}` };

  const commits = io.gh(["api", `repos/${full}/commits`, "--jq", "length"]);
  if (commits === null) return { adopt: true, why: "empty" };          // no commits at all → nothing to lose
  const n = Number(commits.trim());
  if (!Number.isFinite(n)) return { adopt: false, why: "cannot-tell", detail: "could not count commits" };
  if (n === 0) return { adopt: true, why: "empty" };
  if (n === 1) return { adopt: true, why: "template-shaped" };         // the template import commit only
  return { adopt: false, why: "not-ours", detail: `${full} has ${n} commits — it is not a failed run of this command` };
}

/** Where a previous attempt's clone is moved so a retry can proceed without destroying evidence. */
export function archivePathFor(home: string, slug: string, stamp: string): string {
  return `${derivedPaths(home, slug).govRepo.replace(/\/gov_repo$/, "")}/archive/${stamp}/gov_repo`;
}
