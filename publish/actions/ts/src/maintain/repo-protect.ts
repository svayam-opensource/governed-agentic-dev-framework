// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov repo protect` — THE FIRST THING IN gov THAT INSTALLS AN ENFORCEMENT RATHER THAN READING ONE
 * (Policy Owner, 2026-09-29).
 *
 * WHAT WAS MISSING. `lifecycle/branch-protection.ts` reads GOV-FRM-447 and `maintain/protection-check.ts`
 * turns it into rows, so `gov doctor` has been able to say "this branch is open" for two days. Nothing could
 * close it. The posture of every adopting organization was therefore whatever somebody had clicked, and gov's
 * honest report of that fact was the end of the story rather than the start of it.
 *
 * TWO POSTURES, BOTH IMPLEMENTED. `hard` means the PLATFORM stops work attempted outside gov; `soft` means an
 * organization deliberately leaves room for direct work. Under `soft` this command installs nothing and says
 * so — a refusal, not a failure. No posture recorded IS soft (W2-Q6): see `config/governance.ts`.
 *
 * ── THE THREE ANSWERS THIS FILE KEEPS APART ──────────────────────────────────────────────────────────────
 *
 *   UNPROTECTED   GitHub answered: this branch has no rule. A plan with four changes, and `apply` writes them.
 *   CANNOT        The PLATFORM refuses — 403 "Upgrade to GitHub Pro or make this repository public". No
 *                 configuration exists that would satisfy GOV-FRM-447 here, not even the approver check, because
 *                 required status checks are themselves a branch-protection feature (§3.4). `apply` exits
 *                 NON-ZERO and names the three ways out GOV-FRM-449 names.
 *   DID NOT       gov could not find out — not an admin, not signed in, the call failed in transit. Different
 *                 from CANNOT in the only way that matters: something might be there. `apply` refuses to write
 *                 blind and exits non-zero; it never reports having installed anything.
 *
 * A SILENT PARTIAL APPLY IS THE WORST OUTCOME AVAILABLE, so nothing here reports success for a step the
 * platform did not confirm. The protection write is RE-READ and the report is built from the re-read, not from
 * the fact that the PUT exited 0.
 *
 * ── AND WHY THE WORKFLOW GOES FIRST ──────────────────────────────────────────────────────────────────────
 *
 * A required status check that has never run leaves every pull request pending FOR EVER — including the pull
 * request that would land the workflow which makes it run. So `apply` refuses to make `approver-check`
 * required until the workflow is on the default branch, writes the file into the working tree instead, and
 * says to land it by pull request. Two commands rather than one, deliberately: the alternative is a repository
 * that can never merge anything again, installed by the command that was supposed to protect it.
 *
 * Everything reaches GitHub through `run-process.ts` (GOV-FRM-423) — `node:child_process` is banned here by lint.
 */
import * as path from "node:path";
import { parseProtection, whyUnreadable, UNPROTECTED, type ProtectionFacts } from "../lifecycle/branch-protection.js";
import {
  APPROVER_CHECK, isPlanLimited, planWaysOut, protectionChanges, WANTED_APPROVING_REVIEWS,
  type ProtectionChange,
} from "./protection-check.js";
import { frameworkOwners, parseGovernance, type PostureChoice } from "../config/governance.js";
import { resolveRoles } from "../config/role-list.js";
import { WORKFLOW_PATH as GOV_CHECKS_WORKFLOW } from "../rules/checks/render-github.js";
import type { RequiredRuleCheck } from "./rule-checks.js";

/**
 * Runs `gh <args>`, with an optional JSON body on stdin, and returns stdout. Throws on a non-zero exit.
 *
 * NOT `lifecycle/gh-board.ts`'s `RunGh`, and the difference is the body. A PUT to
 * `branches/<branch>/protection` needs nested objects and EXPLICIT nulls (`restrictions: null` is how you say
 * "nobody is restricted", and omitting the key is a different request). `RunGh` has no channel for a body, and
 * expressing one through a pile of `gh api -f key[sub][]=…` flags means betting the only write gov performs on
 * a guess about gh's field syntax. One extra parameter, one place, said out loud.
 */
export type GhApi = (args: readonly string[], body?: string) => string;

/** The file-system reach this command needs, and no more. */
export interface ProtectFs {
  readFile(file: string): string | null;
  writeFile(file: string, content: string): void;
  pathExists(p: string): boolean;
}

export interface RepoProtectDeps {
  readonly gh: GhApi;
  readonly fs: ProtectFs;
}

export interface RepoProtectInput {
  /** `owner/name` — the repository GOV-FRM-447 is about. */
  readonly repo: string;
  /** The branch it protects: the repository's default branch. */
  readonly branch: string;
  /** What `policies/governance.yaml` says the organization chose. Absent is soft; unrecognised refuses. */
  readonly posture: PostureChoice;
  /** The check this organization requires, when it renamed the framework's. */
  readonly approverCheck?: string;
  /** The governance repo clone — where the SHIPPED workflow template is read from. */
  readonly home: string;
  /**
   * The working tree of the repository being protected, when gov has one. `apply` writes the workflow there.
   * Absent → `apply` says where the template is and what to do with it, and writes no file.
   */
  readonly repoDir?: string;
  /** The organization's approver logins, for the `gh variable set` line a CODE repository needs. */
  readonly approvers?: readonly string[];
  /** True when `repo` is the governance repository, which holds the approver list's sources and needs no variable. */
  readonly isGovernanceRepo?: boolean;
  /** The status checks the rules in force make required on this repository under hard posture. */
  readonly ruleChecks?: RuleChecksRead;
}

/**
 * The rules' own required checks, as dispatch read them from the governance repo's DEFAULT branch
 * (maintain/rule-checks.ts) — or why it could not. Absent: no rule checks are known, and none are planned.
 */
export type RuleChecksRead =
  | { readonly ok: true; readonly checks: readonly RequiredRuleCheck[]; readonly ref: string }
  | { readonly ok: false; readonly reason: string };

export type ProtectMode = "plan" | "apply";

export interface ProtectResult {
  readonly code: number;
  readonly lines: readonly string[];
}

/** Where the framework ships the workflow, inside the governance repo. */
export const WORKFLOW_TEMPLATE = path.join("framework", "templates", "workflows", "approver-check.yml");
/** Where it has to be in a repository for GitHub to run it. */
export const WORKFLOW_DEST = path.posix.join(".github", "workflows", "approver-check.yml");

/**
 * THE ORGANIZATION'S APPROVER LOGINS (org-config split, Policy Owner 2026-10-06) — PURE, over the text of
 * `policies/governance.yaml` (the Policy Owner and the Check Owner) and the role list in
 * `policies/authorized-representatives.md` (every role's holder). A vacant role adds nobody: its approvals fall to
 * the Policy Owner, who is already on the list.
 *
 * The explicit `authorized_approvers:` list in org-config.yaml is retired: who may approve IS who holds a role, and
 * a second list of the same people was a second place for them to disagree.
 *
 * gov uses this for ONE thing: printing the `gh variable set GOV_APPROVERS` line a CODE repository needs, because a
 * code repo cannot read the governance repo. The workflow does its own reading of the same two files, so the two
 * cannot silently disagree about who may approve.
 */
export function approverLogins(governanceText: string | null | undefined, roleListText: string | null | undefined): readonly string[] {
  const owners = frameworkOwners(parseGovernance(governanceText ?? null));
  const handles = [owners.policyOwner, owners.checkOwner, ...resolveRoles(roleListText).roles.map((r) => r.holder ?? "")]
    .map((h) => h.trim().replace(/^@+/, "")).filter(Boolean);
  return [...new Set(handles)];
}

/* ────────────────────────────── the raw payload, and the body gov writes ────────────────────────────── */

/**
 * The classic protection payload, as much of it as a WRITE has to preserve.
 *
 * `PUT branches/<branch>/protection` REPLACES the whole rule: every key omitted from the body is reset to its
 * default. So a write that sent only GOV-FRM-447's four settings would silently turn off `dismiss_stale_reviews`,
 * `required_conversation_resolution` and anything else the organization had configured — a governance command
 * quietly undoing governance. gov reads the payload first and sends what was there, changed only where the
 * policy asks.
 */
interface RawProtection {
  required_status_checks?: {
    strict?: boolean;
    contexts?: string[] | null;
    checks?: { context?: string; app_id?: number | null }[] | null;
  } | null;
  enforce_admins?: { enabled?: boolean } | null;
  required_pull_request_reviews?: {
    required_approving_review_count?: number;
    dismiss_stale_reviews?: boolean;
    require_code_owner_reviews?: boolean;
    require_last_push_approval?: boolean;
  } | null;
  restrictions?: {
    users?: { login?: string }[] | null;
    teams?: { slug?: string }[] | null;
    apps?: { slug?: string }[] | null;
  } | null;
  allow_force_pushes?: { enabled?: boolean } | null;
  allow_deletions?: { enabled?: boolean } | null;
  required_conversation_resolution?: { enabled?: boolean } | null;
  required_linear_history?: { enabled?: boolean } | null;
  block_creations?: { enabled?: boolean } | null;
  lock_branch?: { enabled?: boolean } | null;
  allow_fork_syncing?: { enabled?: boolean } | null;
}

function parseRaw(stdout: string): RawProtection | null {
  let root: unknown;
  try { root = JSON.parse(stdout); } catch { return null; /* not JSON: gh printed GitHub's message, and the caller classifies it */ }
  if (typeof root !== "object" || root === null || Array.isArray(root)) return null;
  return root as RawProtection;
}

/**
 * The PUT body for a branch that must satisfy GOV-FRM-447 — PURE, over what is there now.
 *
 * The four settings are set; everything else the payload carried is carried back. The existing required checks
 * are KEPT and the approver check is added to them: a governance command that dropped an organization's build
 * gate in order to install its approval gate would be trading one enforcement for another.
 */
export function buildProtectionBody(raw: RawProtection | null, approverCheck: string = APPROVER_CHECK, ruleChecks: readonly string[] = []): string {
  const checks = raw?.required_status_checks ?? null;
  const existing = [
    ...(checks?.contexts ?? []),
    ...(checks?.checks ?? []).map((c) => c?.context ?? "").filter(Boolean),
  ];
  const reviews = raw?.required_pull_request_reviews ?? null;
  const restrictions = raw?.restrictions ?? null;
  const on = (k: keyof RawProtection): boolean | undefined =>
    (raw?.[k] as { enabled?: boolean } | null | undefined)?.enabled;

  const body: Record<string, unknown> = {
    required_status_checks: {
      // `strict` (require branches to be up to date) is the organization's business, not GOV-FRM-447's. Kept as
      // found, defaulting to false, because turning it ON here would start failing merges for a reason the
      // policy never asked for.
      strict: checks?.strict ?? false,
      contexts: [...new Set([...existing, approverCheck, ...ruleChecks])],
    },
    enforce_admins: true,                                        // GOV-FRM-447.3
    required_pull_request_reviews: {
      // GOV-FRM-447.1 + .2: the presence of this object is what makes a pull request unavoidable, and the count is
      // what makes a review unavoidable. `Math.max` so an organization that already requires two keeps two —
      // the policy says "at least one", and lowering somebody's bar to meet a minimum is not compliance.
      required_approving_review_count: Math.max(WANTED_APPROVING_REVIEWS, reviews?.required_approving_review_count ?? 0),
      dismiss_stale_reviews: reviews?.dismiss_stale_reviews ?? false,
      require_code_owner_reviews: reviews?.require_code_owner_reviews ?? false,
      ...(reviews?.require_last_push_approval === undefined ? {} : { require_last_push_approval: reviews.require_last_push_approval }),
    },
    // `null` means "nobody is restricted", and it is REQUIRED in the body — the endpoint rejects a request
    // that omits it. Sent as the object it was when the organization had one.
    restrictions: restrictions
      ? {
          users: (restrictions.users ?? []).map((u) => u?.login ?? "").filter(Boolean),
          teams: (restrictions.teams ?? []).map((t) => t?.slug ?? "").filter(Boolean),
          apps: (restrictions.apps ?? []).map((a) => a?.slug ?? "").filter(Boolean),
        }
      : null,
  };
  // The optional flags, carried back only when the payload actually stated them. Sending a default for a key
  // GitHub did not report is how a write invents a setting nobody chose.
  for (const k of ["allow_force_pushes", "allow_deletions", "required_conversation_resolution",
    "required_linear_history", "block_creations", "lock_branch", "allow_fork_syncing"] as const) {
    const v = on(k);
    if (v !== undefined) body[k] = v;
  }
  return JSON.stringify(body, null, 2);
}

/* ─────────────────────────────────────────── reading ─────────────────────────────────────────── */

/** What gh said, from every channel it says things on. */
function said(e: unknown): string {
  const err = e as { message?: string; stdout?: string | Buffer; stderr?: string | Buffer };
  return `${err?.stderr?.toString() ?? ""}\n${err?.stdout?.toString() ?? ""}\n${err?.message ?? ""}`;
}

/**
 * One read of a branch's protection, keeping the three answers apart.
 *
 * `kind` is the machine's version of the distinction the file header states, so no caller has to re-derive it
 * from a message: `facts` (including UNPROTECTED) means gov knows, `cannot` means the platform refuses, and
 * `unknown` means gov did not find out.
 */
type ProtectionState =
  | { readonly kind: "facts"; readonly facts: ProtectionFacts; readonly raw: RawProtection | null }
  | { readonly kind: "cannot"; readonly why: string; readonly said: string }
  | { readonly kind: "unknown"; readonly why: string };

function readState(deps: RepoProtectDeps, repo: string, branch: string): ProtectionState {
  let stdout: string;
  try {
    stdout = deps.gh(["api", `repos/${repo}/branches/${branch}/protection`]);
  } catch (e) {
    const message = said(e);
    const why = whyUnreadable(message);
    // `null` from whyUnreadable is GitHub ANSWERING: 404 "Branch not protected".
    if (why === null) return { kind: "facts", facts: UNPROTECTED, raw: null };
    return isPlanLimited(message) ? { kind: "cannot", why, said: message } : { kind: "unknown", why };
  }
  const facts = parseProtection(stdout);
  if (facts !== null) return { kind: "facts", facts, raw: parseRaw(stdout) };
  const why = whyUnreadable(stdout);
  if (why === null) return { kind: "facts", facts: UNPROTECTED, raw: null };
  return isPlanLimited(stdout) ? { kind: "cannot", why, said: stdout } : { kind: "unknown", why };
}

/** Is the workflow on the branch GitHub would run it from? `null` when gov could not find out. */
function workflowOnBranch(deps: RepoProtectDeps, repo: string, branch: string, file: string = WORKFLOW_DEST): boolean | null {
  try {
    deps.gh(["api", `repos/${repo}/contents/${file}?ref=${branch}`]);
    return true;
  } catch (e) {
    const message = said(e);
    // A 404 here is an ANSWER — the file is not there. Anything else (403, a bad ref, the network) is not, and
    // must not be reported as absent: gov would then write a file that is already on the branch.
    if (/\b404\b|\bnot found\b/i.test(message)) return false;
    return null;
  }
}

/* ─────────────────────────── the force-push ruleset (GOV-FRM-466, W2-Q10) ─────────────────────────── */

/**
 * The branch ruleset that blocks force pushes on every project branch. A RULESET, not classic protection: classic
 * protection is per branch name, and `BRNCH-*` is a pattern that grows a branch per project. gov finds its own by
 * NAME, so a re-run updates it rather than adding a second.
 */
export const FORCE_PUSH_RULESET = {
  name: "gov: no force-push on BRNCH-*",
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["refs/heads/BRNCH-*"], exclude: [] as string[] } },
  rules: [{ type: "non_fast_forward" }],
} as const;

/** What gov knows about its ruleset: right, missing, there but weakened, or not found out. */
type RulesetState =
  | { readonly kind: "present"; readonly id: number }
  | { readonly kind: "absent" }
  | { readonly kind: "differs"; readonly id: number; readonly what: string }
  | { readonly kind: "unknown"; readonly why: string };

/** Does a ruleset's detail do what GOV-FRM-466 asks? `null` when it does; otherwise what is off, in words. */
function rulesetGap(detail: unknown): string | null {
  const d = (detail ?? {}) as { target?: string; enforcement?: string; conditions?: { ref_name?: { include?: string[] } }; rules?: { type?: string }[] };
  if (d.target !== "branch") return `targets ${d.target ?? "nothing"}, not branches`;
  if (d.enforcement !== "active") return `enforcement is ${d.enforcement ?? "unset"}, not active`;
  if (!(d.conditions?.ref_name?.include ?? []).includes("refs/heads/BRNCH-*")) return "does not cover refs/heads/BRNCH-*";
  if (!(d.rules ?? []).some((r) => r?.type === "non_fast_forward")) return "has no block-force-pushes rule";
  return null;
}

function readRuleset(deps: RepoProtectDeps, repo: string): RulesetState {
  let list: unknown;
  try {
    list = JSON.parse(deps.gh(["api", `repos/${repo}/rulesets?per_page=100`]));
  } catch (e) {
    return { kind: "unknown", why: whyUnreadable(said(e)) ?? "gh failed" };
  }
  if (!Array.isArray(list)) return { kind: "unknown", why: "GitHub's answer was not a list of rulesets" };
  const ours = (list as { id?: number; name?: string }[]).find((r) => r?.name === FORCE_PUSH_RULESET.name);
  if (!ours || typeof ours.id !== "number") return { kind: "absent" };
  let detail: unknown;
  try {
    detail = JSON.parse(deps.gh(["api", `repos/${repo}/rulesets/${ours.id}`]));
  } catch (e) {
    return { kind: "unknown", why: whyUnreadable(said(e)) ?? "gh failed" };
  }
  const gap = rulesetGap(detail);
  return gap === null ? { kind: "present", id: ours.id } : { kind: "differs", id: ours.id, what: gap };
}

function rulesetRow(state: RulesetState): ProtectionChange {
  return {
    setting: "ruleset: block force pushes on BRNCH-*",
    current: state.kind === "present" ? "active" : state.kind === "absent" ? "absent"
      : state.kind === "differs" ? `present, but ${state.what}` : "could not find out",
    wanted: "active",
    rule: "GOV-FRM-466",
    changes: state.kind !== "present",
  };
}

/* ─────────────────────────────────────────── rendering ─────────────────────────────────────────── */

const pad = (s: string, w: number): string => s + " ".repeat(Math.max(0, w - s.length));

/**
 * The plan table: one row per requirement, the current value beside the wanted one.
 *
 * `→` marks the rows that would change, and the rows that would not are STILL PRINTED — a table that showed
 * only the gaps could not be read as "this is the whole of GOV-FRM-447", which is the question a person runs
 * `plan` to have answered.
 */
function table(changes: readonly ProtectionChange[]): readonly string[] {
  const w1 = Math.max(7, ...changes.map((c) => c.setting.length));
  const w2 = Math.max(7, ...changes.map((c) => c.current.length));
  return [
    `    ${pad("setting", w1)}  ${pad("current", w2)}  wanted`,
    ...changes.map((c) => `  ${c.changes ? "→ " : "  "}${pad(c.setting, w1)}  ${pad(c.current, w2)}  ${c.wanted}   (${c.rule})`),
  ];
}

/**
 * The workflow, AS A ROW OF THE SAME TABLE. It is requirement 4's other half — the required check cannot pass
 * without it — so showing it in a separate paragraph invited a reader to plan the settings and forget the file.
 */
function workflowRow(onBranch: boolean | null, branch: string, file: string = WORKFLOW_DEST, rule: string = "GOV-FRM-447.4"): ProtectionChange {
  return {
    setting: `workflow ${file}`,
    current: onBranch === null ? "could not find out" : onBranch ? "present" : "absent",
    wanted: `on ${branch}`,
    rule,
    changes: onBranch !== true,
  };
}

/**
 * The refusal framework-specification.md §11.2 describes, IN PLAIN WORDS (GOV-FRM-449, W2-Q6). Never GitHub's raw
 * message: a person reading this needs to know what hard posture needs, what that means for their checks, and the
 * three ways forward — not an HTTP status.
 */
function cannotLines(repo: string, mode: ProtectMode, rules: readonly RequiredRuleCheck[]): readonly string[] {
  return [
    "  Hard posture needs a public repository or a paid GitHub plan.",
    `  ${repo} is private, and its GitHub plan offers no branch protection and no rulesets, so gov cannot`,
    "  protect it — not the four GOV-FRM-447 settings, not a required check, not the force-push block.",
    "",
    "  Nothing was written. Every check on this repository stays `detected`: its job still runs and reports,",
    "  but it cannot stop a merge.",
    ...(rules.length
      ? ["  These checks would be required here under hard posture:", ...rules.map((c) => `    ${c.name}   (${c.id})`)]
      : []),
    "",
    "  GOV-FRM-449: three ways forward (framework-specification.md §11.2):",
    ...planWaysOut(repo).map((l) => `    ${l}`),
    "",
    mode === "apply"
      ? `  gov repo protect: FAILED — ${repo} is NOT protected, and gov will not report that it is.`
      : "  There is nothing gov can change here until one of these is done.",
  ];
}

/** The rule checks that are known, or none. */
const knownRules = (r: RuleChecksRead | undefined): readonly RequiredRuleCheck[] => (r?.ok ? r.checks : []);

/** Under soft: what hard would require, said as a list and changing nothing. */
function wouldUnderHard(input: RepoProtectInput): readonly string[] {
  const r = input.ruleChecks;
  if (r === undefined) return [];
  if (!r.ok) return ["", `  (gov could not read the rules to list what hard would require: ${r.reason}.)`];
  return [
    "",
    `  Under hard posture, ${input.repo}@${input.branch} would also get (rules read at ${r.ref}):`,
    ...(r.checks.length
      ? r.checks.map((c) => `    ${c.name}   would be required under hard   (${c.id})`)
      : ["    no rule check — no rule in force binds a gate on this repository's pull requests"]),
    "    force pushes on BRNCH-* blocked by a ruleset   (GOV-FRM-466)",
    "  Here, each of those checks is `detected`: its job runs and reports, but it does not stop a merge.",
  ];
}

/* ─────────────────────────────────────────── the command ─────────────────────────────────────────── */

/**
 * `gov repo protect plan` / `apply`.
 *
 * ONE COMPUTATION, TWO MODES, the shape `rules-verb.ts` already uses: `plan` and `apply` take the same reads
 * and the same decisions and differ only in whether they write. Two code paths asking "what needs changing"
 * is how a plan comes to disagree with the apply it was supposed to describe.
 */
export function protectRepo(deps: RepoProtectDeps, input: RepoProtectInput, mode: ProtectMode): ProtectResult {
  const check = input.approverCheck ?? APPROVER_CHECK;
  const at = `${input.repo}@${input.branch}`;
  const head = `gov repo protect ${mode} — ${at}`;
  const rules = knownRules(input.ruleChecks);
  const ruleNames = rules.map((c) => c.name);

  // ── 0. THE POSTURE. gov installs platform controls only for an organization that ASKED for them. ────────
  if (input.posture.unrecognised || input.posture.posture === null) {
    return { code: mode === "apply" ? 1 : 0, lines: [
      head,
      `  governance_posture is \`${input.posture.raw}\`, which is not a posture gov knows — use \`hard\` or \`soft\`.`,
      "  gov will not guess which was meant: the two are opposite answers about the same repository.",
    ] };
  }
  if (input.posture.posture === "soft") {
    return { code: 0, lines: [
      head,
      input.posture.raw === ""
        ? "  This organization is in SOFT governance (the default — nothing chose hard), so gov installs nothing."
        : "  This organization chose SOFT governance, so gov installs nothing.",
      "  `gov repo protect` installs the controls that stop work attempted outside gov — which is exactly the",
      "  room a soft posture deliberately leaves. gov's own gates remain, and they do not bind an agent a",
      "  developer starts outside gov.",
      ...wouldUnderHard(input),
      "",
      "  To change that: `governance_posture: hard` in policies/governance.yaml, by pull request, then run this again.",
    ] };
  }

  // ── 0b. THE RULES. Under hard, apply makes their gates required — and will not guess which they are. ──────
  if (input.ruleChecks && !input.ruleChecks.ok && mode === "apply") {
    return { code: 1, lines: [
      head,
      `  ✗ gov could not read the rules in force — ${input.ruleChecks.reason}.`,
      "  It will not guess which status checks to require, so nothing was written.",
    ] };
  }
  const rulesNote = input.ruleChecks
    ? input.ruleChecks.ok
      ? `  rules read at ${input.ruleChecks.ref}: ${rules.length} gate check(s) on this repository's pull requests`
      : `  ! the rules could not be read (${input.ruleChecks.reason}) — no rule check is planned, and \`apply\` will refuse`
    : null;

  // ── 1. WHAT IS THERE NOW ────────────────────────────────────────────────────────────────────────────────
  const state = readState(deps, input.repo, input.branch);
  if (state.kind === "cannot") {
    return { code: mode === "apply" ? 1 : 0, lines: [head, "", ...cannotLines(input.repo, mode, rules)] };
  }
  if (state.kind === "unknown") {
    // DID NOT, not CANNOT. Something may well be configured; gov has not seen it. `apply` stops, because the
    // write that follows would be a write onto a rule gov could not read, and its report would be a claim
    // about a branch gov never inspected.
    return { code: mode === "apply" ? 1 : 0, lines: [
      head,
      `  ✗ gov could not read the protection on ${at} — ${state.why}.`,
      "  UNKNOWN IS NOT UNPROTECTED and it is not unprotectABLE either: this is gov failing to find out, not",
      "  the platform refusing. Reading branch protection needs ADMIN rights on the repository.",
      ...(mode === "apply"
        ? ["", "  gov repo protect: FAILED — nothing was written. gov does not write onto a rule it could not read,",
           "  because the report afterwards would be a claim about a branch it never inspected."]
        : ["", "  There is no plan to show until the read succeeds."]),
    ] };
  }

  const changes = protectionChanges(state.facts, check, rules);
  const onBranch = workflowOnBranch(deps, input.repo, input.branch);
  // The gov-checks workflow reports the rule checks. Asked only when there are some: without it, requiring them
  // would leave every pull request pending for ever, exactly as the approver check would.
  const govChecksOnBranch = rules.length ? workflowOnBranch(deps, input.repo, input.branch, GOV_CHECKS_WORKFLOW) : true;
  const ruleset = readRuleset(deps, input.repo);
  const rows = [
    ...changes,
    workflowRow(onBranch, input.branch),
    ...(rules.length ? [workflowRow(govChecksOnBranch, input.branch, GOV_CHECKS_WORKFLOW, "gov check install")] : []),
    rulesetRow(ruleset),
  ];

  // ── 2. PLAN — prints, changes nothing ───────────────────────────────────────────────────────────────────
  if (mode === "plan") {
    const pending = changes.filter((c) => c.changes);
    const allCorrect = pending.length === 0 && onBranch === true && govChecksOnBranch === true && ruleset.kind === "present";
    return { code: 0, lines: [
      head,
      "  posture: hard — the platform is meant to stop work attempted outside gov (GOV-FRM-447)",
      ...(rulesNote ? [rulesNote] : []),
      "",
      ...table(rows),
      "",
      ...(allCorrect
        ? ["  ALREADY CORRECT — every requirement of GOV-FRM-447 is configured on this branch, the rules' checks are",
           "  required, force pushes on BRNCH-* are blocked, and the workflows are on it. `apply` would write nothing."]
        : [
            `  ${pending.length} of ${changes.length} settings would change${onBranch === false ? `, and ${WORKFLOW_DEST} would be written` : ""}.`,
            ...(ruleset.kind === "absent" ? ["  The force-push ruleset would be created (GOV-FRM-466)."] : []),
            ...(ruleset.kind === "differs" ? [`  The force-push ruleset would be put right: it ${ruleset.what} (GOV-FRM-466).`] : []),
            ...(ruleset.kind === "unknown" ? [`  ! gov could not read the rulesets — ${ruleset.why}. \`apply\` will not write until it can.`] : []),
            "  NOTHING HAS BEEN WRITTEN. `gov repo protect apply` writes it.",
            ...(onBranch === false
              ? ["", "  ORDER MATTERS, and `apply` enforces it: the workflow lands FIRST, by pull request. A required",
                 "  check that has never run leaves every pull request pending for ever — including the one that",
                 "  would land the workflow."]
              : []),
            ...(govChecksOnBranch === false
              ? ["", `  ${GOV_CHECKS_WORKFLOW} is not on ${input.branch}: \`gov check install\` renders it; land it by pull request first.`]
              : []),
            ...(onBranch === null
              ? ["", `  gov could not tell whether ${WORKFLOW_DEST} is on ${input.branch}, so \`apply\` will not assume it is.`]
              : []),
          ]),
      ...(input.isGovernanceRepo
        ? ["", "  Each linked code repository is protected the same way: `gov repo protect plan --repo <name>`."]
        : []),
    ] };
  }

  // ── 3. APPLY, step one: THE WORKFLOWS, BEFORE THE REQUIRED CHECKS ───────────────────────────────────────
  if (ruleset.kind === "unknown") {
    return { code: 1, lines: [
      head,
      `  ✗ gov could not read the rulesets on ${input.repo} — ${ruleset.why}.`,
      "  gov repo protect: FAILED — nothing was written. gov does not write onto rules it could not read.",
    ] };
  }
  if (onBranch !== true) {
    const template = deps.fs.readFile(path.join(input.home, WORKFLOW_TEMPLATE));
    if (template === null) {
      return { code: 1, lines: [
        head,
        `  ✗ the framework's approver-check workflow is not in this workspace (${WORKFLOW_TEMPLATE}).`,
        "  `gov upgrade` brings the framework's content up to date; nothing was written.",
      ] };
    }
    const lines: string[] = [
      head,
      ...(onBranch === null
        ? [`  ! gov could not tell whether ${WORKFLOW_DEST} is already on ${input.branch}, so it is treating it as absent.`]
        : [`  ${WORKFLOW_DEST} is not on ${input.branch}.`]),
      "",
    ];
    if (input.repoDir) {
      const dest = path.join(input.repoDir, ...WORKFLOW_DEST.split("/"));
      const current = deps.fs.readFile(dest);
      if (current === template) {
        // WRITE ONLY WHEN IT CHANGES — the discipline the harness mirror now follows. A rewritten identical
        // file is a dirty working tree and a diff somebody has to read to discover it says nothing.
        lines.push(`  ✓ already correct in the working tree: ${dest} matches the framework's copy.`);
      } else {
        deps.fs.writeFile(dest, template);
        lines.push(current === null ? `  ✓ written: ${dest}` : `  ✓ updated: ${dest} (it differed from the framework's copy)`);
      }
    } else {
      lines.push(
        "  gov has no local clone of this repository, so it wrote nothing. Copy the framework's workflow in:",
        `    ${path.join(input.home, WORKFLOW_TEMPLATE)}`,
        `  →  <clone>/${WORKFLOW_DEST}`,
      );
    }
    if (!input.isGovernanceRepo) {
      lines.push(
        "",
        "  A CODE REPOSITORY CANNOT READ policies/governance.yaml — it lives in the governance repo, and a GITHUB_TOKEN",
        "  cannot read another private repository. Give the check this organization's list as a variable:",
        input.approvers?.length
          ? `    gh variable set GOV_APPROVERS --repo ${input.repo} --body "${input.approvers.join(" ")}"`
          : "    gh variable set GOV_APPROVERS --repo " + input.repo + ' --body "<login> <login> …"'
            + "   (policies/governance.yaml names nobody yet)",
      );
    }
    if (govChecksOnBranch !== true) lines.push("", ...govChecksMissing(input));
    return { code: 1, lines: [
      ...lines,
      "",
      "  STOPPED BEFORE TOUCHING BRANCH PROTECTION, on purpose. Making `" + check + "` a required check now would",
      "  leave every pull request pending for ever, because the workflow that produces it is not on",
      `  ${input.branch} yet — including the pull request that would put it there.`,
      "",
      "  Land the workflow by pull request, then run `gov repo protect apply` again. gov repo protect: INCOMPLETE",
      "  — this repository is NOT yet protected.",
    ] };
  }
  if (govChecksOnBranch !== true) {
    return { code: 1, lines: [
      head,
      ...govChecksMissing(input),
      "",
      "  STOPPED BEFORE TOUCHING BRANCH PROTECTION, on purpose: a required check that nothing reports leaves every",
      "  pull request pending for ever. gov repo protect: INCOMPLETE — this repository is NOT yet protected.",
    ] };
  }

  // ── 4. APPLY, step two: THE BRANCH PROTECTION ───────────────────────────────────────────────────────────
  const pending = changes.filter((c) => c.changes);
  if (!pending.length && ruleset.kind === "present") {
    return { code: 0, lines: [
      head,
      "  ALREADY CORRECT — every requirement of GOV-FRM-447 is configured on this branch, the rules' checks are",
      `  required, force pushes on BRNCH-* are blocked, and the workflows are on ${input.branch}. Nothing was written.`,
      "",
      ...table(rows),
    ] };
  }

  let confirmed = changes;
  if (pending.length) {
    const body = buildProtectionBody(state.raw, check, ruleNames);
    try {
      deps.gh(["api", "--method", "PUT", `repos/${input.repo}/branches/${input.branch}/protection`, "--input", "-"], body);
    } catch (e) {
      const message = said(e);
      if (isPlanLimited(message)) {
        return { code: 1, lines: [head, "", ...cannotLines(input.repo, "apply", rules)] };
      }
      return { code: 1, lines: [
        head,
        `  ✗ the write was refused — ${whyUnreadable(message) ?? "gh failed"}.`,
        "  Writing branch protection needs ADMIN rights on the repository.",
        "  gov repo protect: FAILED — this repository is NOT protected.",
      ] };
    }

    // ── 5. THE RE-READ. The report is built from THIS, never from the PUT's exit code. ─────────────────────
    const after = readState(deps, input.repo, input.branch);
    if (after.kind !== "facts") {
      return { code: 1, lines: [
        head,
        "  ! the write was accepted, and gov could NOT re-read the branch to confirm what it did"
          + `${after.kind === "unknown" ? ` — ${after.why}` : ""}.`,
        "  So gov is not reporting success: an unconfirmed write is exactly the silent partial apply that leaves",
        "  an organization believing it is protected. Check github.com/" + input.repo + "/settings/branches, or run",
        "  `gov repo protect plan` again.",
      ] };
    }
    confirmed = protectionChanges(after.facts, check, rules);
    const remaining = confirmed.filter((c) => c.changes);
    if (remaining.length) {
      return { code: 1, lines: [
        head,
        "  ✗ PARTIALLY APPLIED — GitHub accepted the write, and the RE-READ says this is still not configured:",
        ...remaining.map((c) => `     ${c.setting}: ${c.current} (wanted ${c.wanted})   ${c.rule}`),
        "",
        "  gov repo protect: FAILED. Reported from the re-read, not from the write — a command that trusted the",
        "  exit code would have told you this branch was protected.",
      ] };
    }
  }

  // ── 6. THE FORCE-PUSH RULESET (GOV-FRM-466), written and RE-READ the same way ───────────────────────────
  const rulesetLines = applyRuleset(deps, input.repo, ruleset);
  if (!rulesetLines.ok) {
    return { code: 1, lines: [
      head,
      ...(pending.length ? ["  ✓ branch protection written and RE-READ — GOV-FRM-447 and the rules' checks hold."] : []),
      ...rulesetLines.lines,
      "  gov repo protect: FAILED — force pushes on BRNCH-* are NOT blocked.",
    ] };
  }

  return { code: 0, lines: [
    head,
    "  ✓ written and RE-READ on GitHub — every requirement of GOV-FRM-447 now holds:",
    ...table(confirmed),
    "",
    `  ✓ ${WORKFLOW_DEST} is on ${input.branch}, and \`${check}\` is a required check.`,
    ...(rules.length
      ? [`  ✓ the rules' gate checks are required, so they are \`prevented\` on ${input.branch}: ${ruleNames.join(", ")}`]
      : []),
    `  ✓ force pushes on BRNCH-* are blocked (ruleset "${FORCE_PUSH_RULESET.name}", GOV-FRM-466).`,
    "",
    "  Work attempted outside gov on this branch is now stopped by the platform. What gov CANNOT tell you is",
    "  whether every OTHER repository of this organization is in the same state — run this per repository.",
  ] };
}

/** The gov-checks workflow is not on the branch: what to do, for this kind of repository. */
function govChecksMissing(input: RepoProtectInput): readonly string[] {
  return [
    `  ${GOV_CHECKS_WORKFLOW} is not on ${input.branch}, and it is what reports the rules' checks.`,
    input.isGovernanceRepo
      ? "  Render it with `gov check install`, land it by pull request, then run `gov repo protect apply` again."
      : "  Render it with `gov check install --repo <path to this repository's clone>`, land it by pull request,"
        + " then run `gov repo protect apply` again.",
  ];
}

/** Create or put right gov's force-push ruleset, then RE-READ it. Nothing to do when it is already right. */
function applyRuleset(deps: RepoProtectDeps, repo: string, state: RulesetState): { ok: boolean; lines: readonly string[] } {
  if (state.kind === "present") return { ok: true, lines: [] };
  if (state.kind === "unknown") return { ok: false, lines: [`  ✗ gov could not read the rulesets — ${state.why}.`] };
  const body = JSON.stringify(FORCE_PUSH_RULESET, null, 2);
  try {
    deps.gh(state.kind === "absent"
      ? ["api", "--method", "POST", `repos/${repo}/rulesets`, "--input", "-"]
      : ["api", "--method", "PUT", `repos/${repo}/rulesets/${state.id}`, "--input", "-"], body);
  } catch (e) {
    const message = said(e);
    return { ok: false, lines: [isPlanLimited(message)
      ? "  ✗ GitHub offers no rulesets on this repository's plan — hard posture needs a public repository or a paid plan."
      : `  ✗ the ruleset write was refused — ${whyUnreadable(message) ?? "gh failed"}. Writing rulesets needs ADMIN rights.`] };
  }
  const after = readRuleset(deps, repo);
  if (after.kind === "present") return { ok: true, lines: [] };
  return { ok: false, lines: [
    "  ✗ GitHub accepted the ruleset write, and the RE-READ does not show it in force"
      + (after.kind === "differs" ? `: it ${after.what}` : after.kind === "unknown" ? ` — ${after.why}` : "") + ".",
  ] };
}
