// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * FIRST RUN — from a bare machine to a registered org, in one command (PRJ-43 walkthrough, 2026-08-07).
 *
 * `gov` on a machine with no `org_registry` used to print *"no gov workspace resolved — run `gov setup` /
 * `gov org use`"*: two verbs taught at the moment of failure, and the work handed back. It now asks the one
 * question it actually needs — which governance repo? — and does the rest.
 *
 * ## The order, and why it is that order
 *
 * `gov_home` lives at `~/.<org_slug>/gov_repo`, and **`org_slug` is inside the repo being cloned**. So the
 * destination cannot be computed before the clone exists. Cloning to a temp location and then placing it is
 * not a workaround: the alternative is deriving a slug from the URL and letting `org-config.yaml` disagree
 * with the path it lives at — a second copy of a value, with nothing comparing them, which is the shape
 * behind most of this project's defects.
 *
 * ## Joining versus founding
 *
 * After the clone, exactly one question decides everything: **does it already have `org-config.yaml`?**
 *
 *   yes → JOINING. ~Everyone. The org's identity exists; a newcomer must never be prompted to author it,
 *         because those answers are committed to a repo the whole org reads.
 *   no  → FOUNDING. Once, by one person. This is what `setup` is, and the only path that reaches it.
 *
 * That conditional is why `setup` needs no refuse-on-exists guard: the flow never reaches it for a repo that
 * is already configured.
 *
 * ## With no terminal
 *
 * Print and exit. First run is a human act, once per machine (Policy Owner, 2026-08-07). The accepted
 * consequence is that a fresh CI runner cannot onboard itself; everything downstream IS non-interactive, so
 * if that ever bites, the fix is one flag rather than a redesign.
 */

import * as path from "node:path";

/** What the bootstrap must do next. Pure data — the caller performs it. */
export type BootstrapStep =
  /** nothing to do: an org is registered and active. */
  | { readonly kind: "ready"; readonly org: string }
  /** registered orgs exist but none is active — pick one (or `--org`). */
  | { readonly kind: "choose"; readonly orgs: readonly string[] }
  /** nothing registered: ask for the governance repo and clone it. */
  | { readonly kind: "clone" }
  /** no terminal, and something needs asking. */
  | { readonly kind: "blocked"; readonly reason: string };

export interface RegistryFacts {
  /** orgs already registered on this machine. */
  readonly orgs: readonly string[];
  /** the active org, if one is selected. */
  readonly active: string | null;
  /** is there a terminal to ask in? */
  readonly interactive: boolean;
}

/**
 * The rung the machine is on. Deliberately does NOT look at the filesystem or the network — the caller
 * supplies what it knows, so every branch is decidable in a test.
 */
export function nextStep(f: RegistryFacts): BootstrapStep {
  if (f.active && f.orgs.includes(f.active)) return { kind: "ready", org: f.active };
  if (f.orgs.length === 1) return { kind: "ready", org: f.orgs[0]! };   // one org, none active → it is the answer
  if (f.orgs.length > 1) {
    return f.interactive
      ? { kind: "choose", orgs: f.orgs }
      : { kind: "blocked", reason: `${f.orgs.length} organizations are registered and none is active (${f.orgs.join(", ")}) — choose one with \`gov org use <org>\`, or run \`gov\` in a terminal.` };
  }
  return f.interactive
    ? { kind: "clone" }
    : { kind: "blocked", reason: "no organization is registered on this machine yet — run `gov` in a terminal to set one up." };
}

/**
 * Where a freshly cloned governance repo belongs: `~/.<org_slug>/gov_repo`.
 *
 * The slug is read from the clone's own `org-config.yaml`, so a JOINER lands exactly where the org says,
 * not where a URL suggested. A FOUNDER has no config yet, so the caller passes the slug the setup questions
 * produced — same rule, later input.
 *
 * Lower-cased, because the slug is authored uppercase (`SVM`) while the directory is not (`~/.svm`) — the
 * same pairing `org_slug` / `org_slug_lower` already makes inside org-config.yaml.
 */
export function govHomeFor(homeDir: string, orgSlug: string, join: (...p: string[]) => string = path.join): string {
  return join(homeDir, `.${orgSlug.toLowerCase()}`, "gov_repo");
}

/** `git@github.com:Svayamtech/svm-prj-work.git` / `https://github.com/Svayamtech/svm-prj-work` → `svm-prj-work`. */
export function repoNameFromUrl(url: string): string | null {
  const m = /([^/:]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m?.[1] ?? null;
}

/** Is this a plausible clone URL? A typo'd answer should fail HERE, not inside git's output. */
export function looksLikeRepoUrl(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  return /^(https?:\/\/|git@|ssh:\/\/)/.test(t) && /[/:][^/:]+\/[^/:]+/.test(t);
}

/**
 * What the first run asks before anything else (#186).
 *
 * The prompt used to ask for a governance repo clone URL. Only a JOINER can answer
 * that: an adopter's governance repo does not exist yet — `gov setup <org>/<repo>`
 * is what creates it. So the first question was answerable by roughly half the
 * people who reached it, and the other half went looking for a repository that was
 * never going to be found.
 *
 * Asking the ROLE first is not an extra step; it is the step that decides which
 * question is worth asking. And because "which am I?" is a fair thing not to know,
 * C is a real answer rather than a way of saying no.
 */
export type FirstRunRole = "adopter" | "joiner" | "explain";

export function parseRole(answer: string): FirstRunRole | null {
  switch (answer.trim().toUpperCase()) {
    case "A": case "ADOPTER": return "adopter";
    case "B": case "JOINER":  return "joiner";
    case "C": case "?":       return "explain";
    default: return null;
  }
}

export const ROLE_QUESTION: readonly string[] = [
  "Please choose one of the following to continue:",
  "",
  "  A. I am an ADOPTER — I want to start using the governance framework for my organization.",
  "  B. I am a JOINER — my organization already uses it, and I want to start working under it.",
  "  C. I am not sure. Explain this to me before I decide.",
  "",
];

/**
 * Shown for C, and again after any unrecognised answer. Deliberately explains
 * GitHub organizations too: the framework is adopted per ORGANIZATION, and a
 * newcomer who thinks their personal account is their organization will adopt into
 * the wrong place — a mistake nothing downstream can detect.
 */
export const ROLE_EXPLANATION: readonly string[] = [
  "",
  "Definitions",
  "",
  "  The FRAMEWORK",
  "    The open-source governed agentic development framework, by Svayam Infoware Pvt. Ltd.",
  "    https://github.com/svayam-opensource/governed-agentic-dev-framework",
  "    You never clone it yourself. The tool copies what it needs.",
  "",
  "  An ORGANIZATION",
  "    A shared GitHub workspace where a business or team collaborates across many",
  "    projects and owns repositories together. It is NOT your user account.",
  "    You cannot log in to an organization; you sign in as yourself, and from there",
  "    you reach the organizations you created or were invited to:",
  "",
  "        You ──────── Org 1        (you created it)",
  "            ├─────── Org 2",
  "            └─────── Org 3",
  "",
  "        Someone else ─── Org A",
  "                     └── Org 1    (invited by you)",
  "",
  "  ONE organization, ONE adoption",
  "    The framework is adopted once per organization. An organization cannot be run",
  "    by two sets of governing rules at the same time — its projects answer to one",
  "    set of policies, or the policies mean nothing.",
  "",
  "You are a JOINER (choose B) if",
  "  · someone has already adopted the framework for your organization;",
  "  · you will need your organization's governance repo details to join — ask your",
  "    governance administrator for them before you continue.",
  "",
  "You are an ADOPTER (choose A) if",
  "  · nobody has adopted the framework for your organization yet;",
  "  · you want to adopt it for your organization;",
  "  · you are willing to act as its governance administrator. You will be walked",
  "    through what that means during setup and review.",
  "",
];

/** The org identity a governance repo declares about itself. */
export interface OrgIdentity {
  readonly org: string;
  readonly orgSlug: string;
}

/**
 * Everything the first run touches that is not a decision: the network, the disk, the registry, the
 * terminal. Injected so the whole flow below is decidable in a test — no clone, no home directory.
 */
export interface FirstRunIo {
  readonly facts: RegistryFacts;
  /** the user's home directory — `gov_home` is derived from it, never from cwd. */
  readonly homeDir: string;
  prompt(question: string, def: string): Promise<string>;
  /** progress + errors. stdout stays free for whatever the real command prints. */
  print(line: string): void;
  /** a fresh empty directory to clone into. */
  tempDir(): string;
  /** clone `url` into `dest`; throw with git's own message when it fails. */
  clone(url: string, dest: string): void;
  /** the repo's declared identity, or null when it has none yet (→ FOUNDING). */
  readIdentity(repoDir: string): OrgIdentity | null;
  /** does anything already live here? Placing must never overwrite an existing home. */
  exists(dir: string): boolean;
  /** move the clone to its final home. */
  place(from: string, to: string): void;
  /** best-effort cleanup of a temp clone. */
  discard(dir: string): void;
  /** author `org-config.yaml` in a repo that has none — the FOUNDING path (`gov setup`). */
  found(repoDir: string): Promise<OrgIdentity | null>;
  /**
   * The ADOPTER path: create the organization's governance repo from the template
   * and configure it — i.e. `gov setup <org>/<repo>`. Returns its exit code.
   */
  createWorkspace(target: string): Promise<number>;
  /** register the home and make it active. */
  register(org: string, home: string): { readonly ok: boolean; readonly message?: string };
  /** select an already-registered org. */
  activate(org: string): { readonly ok: boolean; readonly message?: string };
}

/**
 * Run the first-run flow. Returns null when there was nothing to do — the caller then proceeds with the
 * command the user actually typed. Any number is an exit code.
 *
 * Returning `null` rather than `0` matters: "already set up" and "just finished setting up" must not look
 * alike to the caller, or the command the user typed would be swallowed by its own prerequisite.
 */
export async function runFirstRun(io: FirstRunIo): Promise<number | null> {
  const step = nextStep(io.facts);
  switch (step.kind) {
    case "ready":
      return null;

    case "blocked":
      io.print(step.reason);
      return 1;

    case "choose": {
      io.print("Several organizations are registered on this machine and none is active:");
      step.orgs.forEach((o, i) => io.print(`  ${i + 1}) ${o}`));
      const answer = (await io.prompt("Which one? ", "1")).trim();
      const idx = /^\d+$/.test(answer) ? Number(answer) - 1 : step.orgs.indexOf(answer);
      const chosen = step.orgs[idx];
      if (!chosen) { io.print(`'${answer}' is not one of the choices.`); return 1; }
      const r = io.activate(chosen);
      if (!r.ok) { io.print(r.message ?? `could not select '${chosen}'.`); return 1; }
      io.print(`Active org → ${chosen}`);
      return 0;
    }

    case "clone":
      return cloneAndRegister(io);
  }
}

/**
 * The founding/joining flow proper. Split out so the ladder above reads as a ladder.
 *
 * The temp clone is discarded on EVERY failure after it exists, including a failed `place`: a half-placed
 * home is worse than none, because the next run would find something at `gov_home` and believe it.
 */
/**
 * Ask which role the person is here in, explaining as often as they need. Loops
 * rather than failing: an unrecognised answer means the question was not clear
 * enough, which is our problem to fix on the spot, not theirs to be punished for.
 */
async function askRole(io: FirstRunIo): Promise<FirstRunRole | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    for (const line of ROLE_QUESTION) io.print(line);
    const role = parseRole(await io.prompt("Select (A/B/C): ", ""));
    if (role === "adopter" || role === "joiner") return role;
    for (const line of ROLE_EXPLANATION) io.print(line);
  }
  return null;
}

/** The ADOPTER path: name the repo to create, and hand it to `gov setup`. */
async function foundNewOrg(io: FirstRunIo): Promise<number> {
  io.print("");
  io.print("Adopting the framework creates a NEW repository in your GitHub organization.");
  io.print("It will hold your policies, your knowledge, and a record of every project.");
  io.print("");
  io.print("  Give it as <your-github-org>/<repo-name>, for example:  acme-corp/acme-governance");
  io.print("");
  const target = (await io.prompt("Organization/repository to create (or Enter to stop): ", "")).trim();
  if (target === "") {
    io.print("");
    io.print("Nothing created. When you are ready:  gov setup <your-github-org>/<repo-name>");
    return 0;
  }
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(target)) {
    io.print(`'${target}' is not an organization/repository name — expected something like acme-corp/acme-governance.`);
    io.print("If you meant to JOIN an organization that already uses gov, re-run and choose B.");
    return 1;
  }
  return io.createWorkspace(target);
}

async function cloneAndRegister(io: FirstRunIo): Promise<number> {
  const role = await askRole(io);
  if (role === null) {
    io.print("");
    io.print("Stopping here rather than guessing. Re-run `gov` when you know which applies.");
    return 1;
  }
  if (role === "adopter") return foundNewOrg(io);

  // JOINER. Now the clone URL is a fair question: their organization's governance
  // repo exists, and someone can tell them where it is.
  io.print("");
  io.print("Joining an organization that already uses gov.");
  io.print("Your governance administrator has the repo's clone URL — ask them if you do not have it.");
  io.print("");
  const url = (await io.prompt("Governance repo (clone URL), or Enter to stop: ", "")).trim();
  if (url === "") {
    io.print("");
    io.print("Nothing registered. Re-run `gov` once you have the clone URL.");
    return 0;
  }
  if (!looksLikeRepoUrl(url)) {
    io.print(`'${url}' does not look like a clone URL — expected something like git@github.com:Org/org-gov.git`);
    io.print("If nobody has adopted the framework for your organization yet, re-run and choose A.");
    return 1;
  }

  const tmp = io.tempDir();
  const repoName = repoNameFromUrl(url) ?? "gov_repo";
  const staged = path.join(tmp, repoName);
  try {
    io.print(`Cloning ${url} …`);
    io.clone(url, staged);
  } catch (e) {
    io.discard(tmp);
    io.print(`clone failed: ${(e as Error)?.message ?? String(e)}`);
    return 1;
  }

  try {
    // JOINING vs FOUNDING — the single question that decides the rest.
    let identity = io.readIdentity(staged);
    if (identity === null) {
      io.print("This repo has no org-config.yaml yet — setting up a NEW organization.");
      identity = await io.found(staged);
      if (identity === null) return 1;   // `finally` discards the staging dir
    } else {
      io.print(`Joining ${identity.org}.`);
    }

    const home = govHomeFor(io.homeDir, identity.orgSlug);
    if (io.exists(home)) {
      io.print(`${home} already exists — register it instead:  gov org add ${identity.org} ${home}`);
      return 1;
    }
    io.place(staged, home);

    const r = io.register(identity.org, home);
    if (!r.ok) { io.print(r.message ?? `could not register ${identity.org}.`); return 1; }
    io.print(`Registered ${identity.org} → ${home}`);
    io.print(`Active org → ${identity.org}`);
    return 0;
  } catch (e) {
    io.print(`${(e as Error)?.message ?? String(e)}`);
    return 1;
  } finally {
    io.discard(tmp);   // the staging dir is never the home; placing MOVED the repo out of it.
  }
}
