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
 * `gov_home` lives at `~/.gov/<org_slug>/gov_repo`, and **`org_slug` is inside the repo being cloned**. So the
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
import { approvalPrompt, parseApprovalChoice, approvalSummary } from "./approve-agents-step.js";

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
 * Where a freshly cloned governance repo belongs: `~/.gov/<org_slug>/gov_repo`.
 *
 * Under `~/.gov/`, not `~/.<slug>/` (#186). Three parts of this tool had three
 * answers: `create.ts` placed a NEW workspace at `~/.gov/<slug>/gov_repo`, the
 * registry that maps orgs to homes lives at `~/.gov/workspaces`, and this — the
 * JOINING path — put the clone at `~/.<slug>/gov_repo`. So founding and joining
 * the same organization on the same machine produced two different layouts.
 *
 * `~/.gov/` as the root is also what makes more than one governed organization
 * workable: every org is a sibling directory next to the registry that enumerates
 * them, instead of being scattered across the home directory with nothing to list.
 *
 * The slug is read from the clone's own `org-config.yaml`, so a JOINER lands exactly where the org says,
 * not where a URL suggested. A FOUNDER has no config yet, so the caller passes the slug the setup questions
 * produced — same rule, later input.
 *
 * Lower-cased, because the slug is authored uppercase (`SVM`) while the directory is not (`~/.svm`) — the
 * same pairing `org_slug` / `org_slug_lower` already makes inside org-config.yaml.
 */
export function govHomeFor(homeDir: string, orgSlug: string, join: (...p: string[]) => string = path.join): string {
  return join(homeDir, ".gov", orgSlug.toLowerCase(), "gov_repo");
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
 * A clone URL for a repo gov found itself, shown as the default the user can override (#197).
 *
 * https rather than ssh because it is the one that works on a machine that has only done what the
 * checklist asked — `gh auth login`, no key generated, no key uploaded. It is a DEFAULT, not a
 * decision: someone whose org requires ssh edits the line. The clone itself prefers `cloneRepo`
 * (`gh repo clone`), which resolves protocol and credentials the way `gov setup` already does.
 */
export function cloneUrlFor(nameWithOwner: string): string {
  return `https://github.com/${nameWithOwner}.git`;
}

/** What gov knows about an organization's existing governance repos (#197). */
export interface GovernanceProbe {
  /** `owner/repo` for every repo in the org that declares an `org-config.yaml`. */
  readonly repos: readonly string[];
  /** false = the probe could not run. Say NOTHING then — a guess here is a forked policy. */
  readonly verified: boolean;
}

/** Where the repo to join came from: a URL the user typed, or one gov derived from `owner/repo`. */
interface CloneSource {
  readonly url: string;
  /** `owner/repo` when gov found it, null when the user typed a URL gov cannot attribute. */
  readonly nameWithOwner: string | null;
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

/** The two roles adoption can END in. "explain" is a request for help, not a destination. */
export type AdoptionRole = "adopter" | "joiner";

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

/**
 * What someone is told when they answered ADOPTER for an organization that is already governed (#197).
 *
 * This is not a refusal, and must not read like one. They answered the role question truthfully with
 * what they knew; gov then went and looked, and found out otherwise. The only thing that has changed
 * is which of the two paths they are on — so the screen says that, names the repository, and offers
 * the path they are actually on. Being told "no" and handed a shell command was the old behaviour, and
 * the command it handed them could not produce a working machine.
 */
export function alreadyGovernedNotice(org: string, repos: readonly string[]): readonly string[] {
  const rule = "=".repeat(88);
  const lines: string[] = [
    "",
    rule,
    `  ${org} is already governed`,
    rule,
    "",
  ];
  if (repos.length === 1) {
    lines.push(`  Governance repository:  ${repos[0]}`);
  } else {
    lines.push(`  ${org} has ${repos.length} governance repositories:`);
    repos.forEach((r, i) => lines.push(`    ${i + 1}) ${r}`));
  }
  lines.push(
    "",
    "  An organization is adopted once. A second governance repository would fork its",
    "  policy — two sets of rules over the same projects, and nothing to say which one",
    "  governs. So nothing will be created here.",
    "",
    "  Which means you are a JOINER, not an adopter. That is a smaller job, and gov can",
    "  do all of it: clone what your organization already decided, put it where every",
    "  other tool expects to find it, and register it on this machine.",
    "",
  );
  return lines;
}

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
  /**
   * Clone `owner/repo` with `gh`, which resolves the protocol and the credentials — the same
   * mechanism `gov setup` uses for the repo it creates. Used only for a repo GOV found, never for a
   * URL the user typed. Optional: without it the derived https URL goes through `clone`.
   */
  cloneRepo?(nameWithOwner: string, dest: string): void;
  /**
   * Does this GitHub organization already have a governance repo (#197)?
   *
   * Asked BEFORE the questions only an adopter can answer, because the answer decides whether those
   * questions are worth asking. Optional: absent means "do not probe", and the flow is as it was —
   * `preflight` still refuses to create a second one either way.
   */
  probeGovernance?(org: string): GovernanceProbe;
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
  /** Record the org's approved agents in llm-governance.md. Returns whether it wrote (#196). */
  approveAgents?: (agents: readonly { readonly id: string; readonly default?: boolean }[]) => boolean;
  /** Build the starter review project; returns the lines to print (#186). */
  createStarterProject?: () => readonly string[];
  /**
   * The whole checklist, ticked, at the true end of the run (#186).
   *
   * The role is PASSED, not assumed. It used to be hardcoded to "adopter", so a joiner who finished
   * cleanly was shown the founding steps against their own name — a list of things they must not do
   * (#197). Step 8 is the one item that differs, and the caller is the only one who knows which
   * branch was actually walked.
   */
  finalStatus?: (role: AdoptionRole) => readonly string[];
  /** What to do now, for an adopter. */
  adopterNextSteps?: () => readonly string[];
  /** What to do now, for a joiner. */
  joinerNextSteps?: () => readonly string[];
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
  // TWO QUESTIONS, NOT ONE (#192). "Organization/repository to create" asks a
  // newcomer to compose a form they have not been taught, out of two things they
  // know separately — and the second of them they should not have to invent at all.
  io.print("");
  io.print("Adopting the framework creates a NEW repository in your GitHub organization.");
  io.print("It will hold your policies, your knowledge, and a record of every project.");
  io.print("");

  let org = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    org = (await io.prompt("Which organization are you adopting the governance framework for? (GitHub organization name, or Enter to stop): ", "")).trim();
    if (org === "") {
      io.print("");
      io.print("Nothing created. When you are ready:  gov setup <your-github-org>/<repo-name>");
      return 0;
    }
    if (/^[A-Za-z0-9._-]+$/.test(org)) break;
    io.print(org.includes("/")
      ? `  ✗ '${org}' looks like <organization>/<repository>. Just the organization here — the repository is the next question.`
      : `  ✗ '${org}' is not a GitHub organization name (letters, digits, dots, dashes).`);
    org = "";
  }
  if (!org) {
    io.print("");
    io.print("Nothing created. Re-run `gov` when you know which organization to adopt for.");
    return 1;
  }

  // LOOK BEFORE ASKING ANYTHING ELSE (#197).
  //
  // Every remaining question on this path — the repository name, the org slug asked
  // inside `gov setup` — exists to create something. If the organization already has
  // a governance repository, none of them has an answer worth collecting, and the
  // refusal was arriving three questions later anyway, as an error, with the run
  // over. The probe is one GraphQL call and it is the same one `preflight` makes.
  //
  // An UNVERIFIED probe says nothing and changes nothing: `preflight` still refuses
  // to create when it cannot see, which is the guard that matters.
  const probe = io.probeGovernance?.(org);
  if (probe?.verified && probe.repos.length > 0) return joinInsteadOfAdopting(io, org, probe.repos);

  // Defaulted, because nobody should have to invent a name for a repository whose
  // purpose is fixed. Enter is the right answer here for almost everyone.
  const defaultRepo = `${org}-gov`;
  let repo = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    repo = (await io.prompt(
      `Name for the governance repository that will be created to house your policies [${defaultRepo}]: `,
      defaultRepo,
    )).trim();
    if (/^[A-Za-z0-9._-]+$/.test(repo)) break;
    io.print(`  ✗ '${repo}' is not a repository name (letters, digits, dots, dashes).`);
    repo = "";
  }
  if (!repo) {
    io.print("");
    io.print("Nothing created. Re-run `gov` and accept the suggested name, or give a simple one.");
    return 1;
  }

  const target = `${org}/${repo}`;
  const code = await io.createWorkspace(target);
  if (code !== 0) return code;

  // WHICH AGENTS THIS ORGANIZATION ALLOWS (#196, Q3).
  //
  // Asked here, during adoption, because the alternative is a fallback — treat the
  // framework's list as approved when no policy exists — and that leaves an
  // organization permanently governed by a decision nobody made. The state is
  // removed rather than guarded: adoption produces an approved list, so "nobody has
  // decided" never persists past setup.
  if (io.approveAgents) {
    for (const line of approvalPrompt()) io.print(line);
    for (let attempt = 0; attempt < 5; attempt++) {
      const answer = await io.prompt("  Allowed agents: ", "");
      const choice = parseApprovalChoice(answer);
      if (choice.ok) {
        if (io.approveAgents(choice.agents)) {
          for (const line of approvalSummary(choice.agents)) io.print(line);
        } else {
          io.print("  ✗ Could not write llm-governance.md — approve them later with `gov agent approve <id>`.");
        }
        break;
      }
      io.print(`  ✗ ${choice.message}`);
    }
  }

  // THE FIRST GOVERNED THING, MADE FOR THEM (#186).
  //
  // The asking happens INSIDE createStarterProject, not here. `createWorkspace`
  // hands the terminal to `gov setup`, which opens and closes its own readline —
  // so a prompt from this function afterwards died with ERR_USE_AFTER_CLOSE, on
  // the last question of an otherwise complete adoption. Whoever holds the
  // terminal at the moment does the asking; by now, that is no longer this
  // function.
  for (const line of io.createStarterProject?.() ?? []) io.print(line);

  // THE REAL END, and the only place the word "final" is true.
  for (const line of io.finalStatus?.("adopter") ?? []) io.print(line);
  for (const line of io.adopterNextSteps?.() ?? []) io.print(line);
  return 0;
}

/**
 * The pivot: an ADOPTER answer for an organization that already has a governance repo (#197).
 *
 * Everything needed to join is already known — gov found the repository itself — so this asks for
 * consent, not for information. Declining stops cleanly; it does not fall through to a create that
 * `preflight` would refuse anyway.
 */
async function joinInsteadOfAdopting(io: FirstRunIo, org: string, repos: readonly string[]): Promise<number> {
  for (const line of alreadyGovernedNotice(org, repos)) io.print(line);

  // MORE THAN ONE is a real state — an org that forked its policy before gov could stop it — and the
  // person in front of us cannot be assumed to know which is theirs. Ask; do not pick the first.
  let chosen = repos[0]!;
  if (repos.length > 1) {
    const answer = (await io.prompt("  Which one governs your work? (number, or Enter to stop): ", "")).trim();
    const pick = /^\d+$/.test(answer) ? repos[Number(answer) - 1] : undefined;
    if (!pick) {
      io.print("");
      io.print("  Nothing changed. Ask your governance administrator which repository governs your");
      io.print("  work, then re-run `gov` and choose B.");
      return answer === "" ? 0 : 1;
    }
    chosen = pick;
  }

  const consent = (await io.prompt(`  Join ${chosen} now? [Y/n]: `, "Y")).trim().toLowerCase();
  if (consent.startsWith("n")) {
    io.print("");
    io.print("  Nothing created, and nothing changed on this machine.");
    io.print("  When you want to join:  gov      → choose B");
    io.print(`  If ${chosen} is not the right repository, ask your governance administrator.`);
    return 0;
  }

  io.print("");
  return joinExisting(io, { url: cloneUrlFor(chosen), nameWithOwner: chosen });
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
  return joinExisting(io, { url, nameWithOwner: null });
}

/**
 * Clone a governance repo, place it at `~/.gov/<slug>/gov_repo`, register it, activate it.
 *
 * Split out of `cloneAndRegister` (#197) because it is the destination of TWO routes now: the JOINER
 * who typed a URL, and the ADOPTER who turned out to be a joiner. Extracting it is what let the pivot
 * be a pivot — the alternative was printing a shell command that put the repo somewhere gov does not
 * look, which is exactly the instruction the old refusal gave.
 *
 * The staging dir is discarded on EVERY failure after it exists, including a failed `place`: a
 * half-placed home is worse than none, because the next run would find something at `gov_home` and
 * believe it.
 */
async function joinExisting(io: FirstRunIo, src: CloneSource): Promise<number> {
  const tmp = io.tempDir();
  const repoName = repoNameFromUrl(src.url) ?? "gov_repo";
  const staged = path.join(tmp, repoName);
  try {
    io.print(`Cloning ${src.url} …`);
    // `gh repo clone` for a repo gov FOUND: it knows the protocol and carries the token, so a private
    // governance repo — which every governance repo is — clones on a machine that has only run
    // `gh auth login`. A URL the user typed is theirs, and goes through git untouched.
    if (src.nameWithOwner && io.cloneRepo) io.cloneRepo(src.nameWithOwner, staged);
    else io.clone(src.url, staged);
  } catch (e) {
    io.discard(tmp);
    io.print(`clone failed: ${(e as Error)?.message ?? String(e)}`);
    return 1;
  }

  try {
    // JOINING vs FOUNDING — the single question that decides the rest, and the only thing that
    // decides which role this run ends in. Derived, never assumed: a repo with no org-config.yaml is
    // being founded by whoever is standing here, whatever they answered upstream.
    let identity = io.readIdentity(staged);
    const founding = identity === null;
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
    // A joiner needs the opposite of an adopter's instructions: not "settle this",
    // but "this is already settled, and here is where to read it". Which of the two
    // gets printed follows what actually happened above, not what was answered at
    // the role question — someone who cloned an unconfigured repo just founded an
    // organization, and was being sent to read policies nobody had written (#197).
    for (const line of io.finalStatus?.(founding ? "adopter" : "joiner") ?? []) io.print(line);
    const after = founding ? io.adopterNextSteps : io.joinerNextSteps;
    for (const line of after?.() ?? []) io.print(line);
    io.print(`Active org → ${identity.org}`);
    return 0;
  } catch (e) {
    io.print(`${(e as Error)?.message ?? String(e)}`);
    return 1;
  } finally {
    io.discard(tmp);   // the staging dir is never the home; placing MOVED the repo out of it.
  }
}
