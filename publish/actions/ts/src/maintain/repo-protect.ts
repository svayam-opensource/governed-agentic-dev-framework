// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov repo protect` — THE FIRST THING IN gov THAT INSTALLS AN ENFORCEMENT RATHER THAN READING ONE
 * (Policy Owner, 2026-09-29).
 *
 * WHAT WAS MISSING. `lifecycle/branch-protection.ts` reads POL-040a §3.3 and `maintain/protection-check.ts`
 * turns it into rows, so `gov doctor` has been able to say "this branch is open" for two days. Nothing could
 * close it. The posture of every adopting organization was therefore whatever somebody had clicked, and gov's
 * honest report of that fact was the end of the story rather than the start of it.
 *
 * TWO POSTURES, BOTH IMPLEMENTED. `hard` means the PLATFORM stops work attempted outside gov; `soft` means an
 * organization deliberately leaves room for direct work. Under `soft` this command installs nothing and says
 * so — a refusal, not a failure. Under neither (nobody chose) it also installs nothing, which is the whole
 * point of the third state: see `config/org-config.ts`.
 *
 * ── THE THREE ANSWERS THIS FILE KEEPS APART ──────────────────────────────────────────────────────────────
 *
 *   UNPROTECTED   GitHub answered: this branch has no rule. A plan with four changes, and `apply` writes them.
 *   CANNOT        The PLATFORM refuses — 403 "Upgrade to GitHub Pro or make this repository public". No
 *                 configuration exists that would satisfy POL-040a here, not even the approver check, because
 *                 required status checks are themselves a branch-protection feature (§3.4). `apply` exits
 *                 NON-ZERO and names the three ways out POL-040d states.
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
 * Everything reaches GitHub through `run-process.ts` (POL-423) — `node:child_process` is banned here by lint.
 */
import * as path from "node:path";
import { parseProtection, whyUnreadable, UNPROTECTED, type ProtectionFacts } from "../lifecycle/branch-protection.js";
import {
  APPROVER_CHECK, isPlanLimited, planWaysOut, protectionChanges, WANTED_APPROVING_REVIEWS,
  type ProtectionChange,
} from "./protection-check.js";
import type { PostureChoice } from "../config/org-config.js";

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
  /** `owner/name` — the repository POL-040a §3.3 is about. */
  readonly repo: string;
  /** The branch it protects: the repository's default branch. */
  readonly branch: string;
  /** What `org-config.yaml` says the organization chose. Unset and unrecognised both refuse. */
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
  /** True when `repo` is the governance repository, which holds `org-config.yaml` and needs no variable. */
  readonly isGovernanceRepo?: boolean;
}

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
 * THE ORGANIZATION'S APPROVER LOGINS, as the shipped workflow reads them — PURE, over `org-config.yaml`'s text.
 *
 * The explicit `authorized_approvers:` list, else the role handles `gov setup` writes and CODEOWNERS is
 * generated from. §3.2's own list lives in `policies/authorized-representatives.md`, which names people by
 * EMAIL and is seed-once — so the framework may never add machine-readable structure to it, and GitHub logins
 * have to live here.
 *
 * gov uses this for ONE thing: printing the `gh variable set GOV_APPROVERS` line a CODE repository needs,
 * because a code repo cannot read this file. The workflow does its own reading, in the same order, so that the
 * two cannot silently disagree about who may approve.
 */
export function approverLogins(orgConfigText: string | null | undefined): readonly string[] {
  if (!orgConfigText) return [];
  const clean = (s: string): string => s.trim().replace(/\s+#.*$/, "").replace(/^["']|["']$/g, "").replace(/^@+/, "").trim();
  const lines = orgConfigText.split(/\r?\n/);
  const at = lines.findIndex((l) => /^authorized_approvers:\s*(#.*)?$/.test(l));
  const listed: string[] = [];
  if (at !== -1) {
    for (const line of lines.slice(at + 1)) {
      if (/^\S/.test(line)) break;                     // dedent → the next top-level key
      const m = /^\s+-\s*(.+)$/.exec(line);
      if (m) { const v = clean(m[1]!); if (v) listed.push(v); }
      else if (line.trim()) break;                     // something that is not an item → not our list
    }
  }
  if (listed.length) return [...new Set(listed)];
  const roles = ["policy_owner_github", "check_owner_github", "legal_owner_github", "infra_owner_github",
    "system_arch_owner_github", "data_arch_owner_github"];
  const handles: string[] = [];
  for (const line of lines) {
    const m = /^([a-z_]+):\s*(.+)$/.exec(line);
    if (m && roles.includes(m[1]!)) { const v = clean(m[2]!); if (v) handles.push(v); }
  }
  return [...new Set(handles)];
}

/* ────────────────────────────── the raw payload, and the body gov writes ────────────────────────────── */

/**
 * The classic protection payload, as much of it as a WRITE has to preserve.
 *
 * `PUT branches/<branch>/protection` REPLACES the whole rule: every key omitted from the body is reset to its
 * default. So a write that sent only POL-040a's four settings would silently turn off `dismiss_stale_reviews`,
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
 * The PUT body for a branch that must satisfy POL-040a §3.3 — PURE, over what is there now.
 *
 * The four settings are set; everything else the payload carried is carried back. The existing required checks
 * are KEPT and the approver check is added to them: a governance command that dropped an organization's build
 * gate in order to install its approval gate would be trading one enforcement for another.
 */
export function buildProtectionBody(raw: RawProtection | null, approverCheck: string = APPROVER_CHECK): string {
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
      // `strict` (require branches to be up to date) is the organization's business, not POL-040a's. Kept as
      // found, defaulting to false, because turning it ON here would start failing merges for a reason the
      // policy never asked for.
      strict: checks?.strict ?? false,
      contexts: [...new Set([...existing, approverCheck])],
    },
    enforce_admins: true,                                        // POL-040a.3
    required_pull_request_reviews: {
      // POL-040a.1 + .2: the presence of this object is what makes a pull request unavoidable, and the count is
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
function workflowOnBranch(deps: RepoProtectDeps, repo: string, branch: string): boolean | null {
  try {
    deps.gh(["api", `repos/${repo}/contents/${WORKFLOW_DEST}?ref=${branch}`]);
    return true;
  } catch (e) {
    const message = said(e);
    // A 404 here is an ANSWER — the file is not there. Anything else (403, a bad ref, the network) is not, and
    // must not be reported as absent: gov would then write a file that is already on the branch.
    if (/\b404\b|\bnot found\b/i.test(message)) return false;
    return null;
  }
}

/* ─────────────────────────────────────────── rendering ─────────────────────────────────────────── */

const pad = (s: string, w: number): string => s + " ".repeat(Math.max(0, w - s.length));

/**
 * The plan table: one row per requirement, the current value beside the wanted one.
 *
 * `→` marks the rows that would change, and the rows that would not are STILL PRINTED — a table that showed
 * only the gaps could not be read as "this is the whole of POL-040a §3.3", which is the question a person runs
 * `plan` to have answered.
 */
function table(changes: readonly ProtectionChange[]): readonly string[] {
  const w1 = Math.max(7, ...changes.map((c) => c.setting.length));
  const w2 = Math.max(7, ...changes.map((c) => c.current.length));
  return [
    `    ${pad("setting", w1)}  ${pad("current", w2)}  wanted`,
    ...changes.map((c) => `  ${c.changes ? "→ " : "  "}${pad(c.setting, w1)}  ${pad(c.current, w2)}  ${c.wanted}   (${c.pol})`),
  ];
}

/**
 * The workflow, AS A ROW OF THE SAME TABLE. It is requirement 4's other half — the required check cannot pass
 * without it — so showing it in a separate paragraph invited a reader to plan the settings and forget the file.
 */
function workflowRow(onBranch: boolean | null, branch: string): ProtectionChange {
  return {
    setting: `workflow ${WORKFLOW_DEST}`,
    current: onBranch === null ? "could not find out" : onBranch ? "present" : "absent",
    wanted: `on ${branch}`,
    pol: "POL-040a.4",
    changes: onBranch !== true,
  };
}

/** The refusal §3.4 describes, in full, every time. Never abbreviated: it is the answer, not an aside. */
function cannotLines(repo: string, mode: ProtectMode, message: string): readonly string[] {
  const first = message.split(/\r?\n/).map((l) => l.trim()).find((l) => /upgrade to github pro|make this repository public/i.test(l))
    ?? "Upgrade to GitHub Pro or make this repository public to enable this feature.";
  return [
    `  ✗ GitHub REFUSED: ${first}`,
    "",
    `  NOTHING WAS WRITTEN, and nothing can be: ${repo} is a PRIVATE repository on a plan without branch`,
    "  protection. None of POL-040a §3.3's four settings can be configured here — not even the approver check,",
    "  because required status checks are themselves a branch-protection feature (framework-policy §3.4).",
    "  Until this changes, gov's own gates are the only enforcement, and they do not bind an agent a developer",
    "  starts outside gov.",
    "",
    "  POL-040d gives three ways out, and this organization MUST record which it took:",
    ...planWaysOut(repo).map((l) => `    ${l}`),
    "",
    mode === "apply"
      ? "  gov repo protect: FAILED — this repository is NOT protected, and gov will not report that it is."
      : "  gov repo protect plan: there is nothing to plan here. This is a platform limit, not a missing setting.",
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

  // ── 0. THE POSTURE. gov installs platform controls only for an organization that ASKED for them. ────────
  if (input.posture.unrecognised) {
    return { code: mode === "apply" ? 1 : 0, lines: [
      head,
      `  governance_posture is \`${input.posture.raw}\`, which is not a posture gov knows — use \`hard\` or \`soft\`.`,
      "  gov will not guess which was meant: the two are opposite answers about the same repository.",
    ] };
  }
  if (input.posture.posture === null) {
    return { code: mode === "apply" ? 1 : 0, lines: [
      head,
      "  NO POSTURE HAS BEEN CHOSEN. `governance_posture` is empty in org-config.yaml, and gov will not install",
      "  repository controls an organization has not asked for — nor pretend that leaving the question open is a",
      "  decision to leave the repository open.",
      "",
      "  Record one, by pull request, and run this again:",
      "    governance_posture: hard    the platform stops work attempted outside gov (§3.3)",
      "    governance_posture: soft    direct clone, commit and push are deliberately left open (§3.4)",
    ] };
  }
  if (input.posture.posture === "soft") {
    return { code: 0, lines: [
      head,
      "  This organization chose SOFT governance, so gov installs nothing.",
      "  `gov repo protect` installs the controls that stop work attempted outside gov — which is exactly the",
      "  room a soft posture deliberately leaves. gov's own gates remain, and they do not bind an agent a",
      "  developer starts outside gov.",
      "",
      "  To change that: `governance_posture: hard` in org-config.yaml, by pull request, then run this again.",
    ] };
  }

  // ── 1. WHAT IS THERE NOW ────────────────────────────────────────────────────────────────────────────────
  const state = readState(deps, input.repo, input.branch);
  if (state.kind === "cannot") {
    return { code: mode === "apply" ? 1 : 0, lines: [head, "", ...cannotLines(input.repo, mode, state.said)] };
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

  const changes = protectionChanges(state.facts, check);
  const onBranch = workflowOnBranch(deps, input.repo, input.branch);

  // ── 2. PLAN — prints, changes nothing ───────────────────────────────────────────────────────────────────
  if (mode === "plan") {
    const pending = changes.filter((c) => c.changes);
    const allCorrect = pending.length === 0 && onBranch === true;
    return { code: 0, lines: [
      head,
      "  posture: hard — the platform is meant to stop work attempted outside gov (POL-040a §3.3)",
      "",
      ...table([...changes, workflowRow(onBranch, input.branch)]),
      "",
      ...(allCorrect
        ? ["  ALREADY CORRECT — every requirement of POL-040a §3.3 is configured on this branch and the approver",
           "  workflow is on it. `apply` would write nothing."]
        : [
            `  ${pending.length} of ${changes.length} settings would change${onBranch === false ? `, and ${WORKFLOW_DEST} would be written` : ""}.`,
            "  NOTHING HAS BEEN WRITTEN. `gov repo protect apply` writes it.",
            ...(onBranch === false
              ? ["", "  ORDER MATTERS, and `apply` enforces it: the workflow lands FIRST, by pull request. A required",
                 "  check that has never run leaves every pull request pending for ever — including the one that",
                 "  would land the workflow."]
              : []),
            ...(onBranch === null
              ? ["", `  gov could not tell whether ${WORKFLOW_DEST} is on ${input.branch}, so \`apply\` will not assume it is.`]
              : []),
          ]),
    ] };
  }

  // ── 3. APPLY, step one: THE WORKFLOW, BEFORE THE REQUIRED CHECK ─────────────────────────────────────────
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
        "  A CODE REPOSITORY CANNOT READ org-config.yaml — it lives in the governance repo, and a GITHUB_TOKEN",
        "  cannot read another private repository. Give the check this organization's list as a variable:",
        input.approvers?.length
          ? `    gh variable set GOV_APPROVERS --repo ${input.repo} --body "${input.approvers.join(" ")}"`
          : "    gh variable set GOV_APPROVERS --repo " + input.repo + ' --body "<login> <login> …"'
            + "   (org-config.yaml names nobody yet)",
      );
    }
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

  // ── 4. APPLY, step two: THE BRANCH PROTECTION ───────────────────────────────────────────────────────────
  const pending = changes.filter((c) => c.changes);
  if (!pending.length) {
    return { code: 0, lines: [
      head,
      "  ALREADY CORRECT — every requirement of POL-040a §3.3 is configured on this branch and the approver",
      `  workflow is on ${input.branch}. Nothing was written.`,
      "",
      ...table(changes),
    ] };
  }

  const body = buildProtectionBody(state.raw, check);
  try {
    deps.gh(["api", "--method", "PUT", `repos/${input.repo}/branches/${input.branch}/protection`, "--input", "-"], body);
  } catch (e) {
    const message = said(e);
    if (isPlanLimited(message)) {
      return { code: 1, lines: [head, "", ...cannotLines(input.repo, "apply", message)] };
    }
    return { code: 1, lines: [
      head,
      `  ✗ the write was refused — ${whyUnreadable(message) ?? "gh failed"}.`,
      "  Writing branch protection needs ADMIN rights on the repository.",
      "  gov repo protect: FAILED — this repository is NOT protected.",
    ] };
  }

  // ── 5. THE RE-READ. The report is built from THIS, never from the PUT's exit code. ───────────────────────
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
  const remaining = protectionChanges(after.facts, check).filter((c) => c.changes);
  if (remaining.length) {
    return { code: 1, lines: [
      head,
      "  ✗ PARTIALLY APPLIED — GitHub accepted the write, and the RE-READ says this is still not configured:",
      ...remaining.map((c) => `     ${c.setting}: ${c.current} (wanted ${c.wanted})   ${c.pol}`),
      "",
      "  gov repo protect: FAILED. Reported from the re-read, not from the write — a command that trusted the",
      "  exit code would have told you this branch was protected.",
    ] };
  }
  return { code: 0, lines: [
    head,
    "  ✓ written and RE-READ on GitHub — every requirement of POL-040a §3.3 now holds:",
    ...table(protectionChanges(after.facts, check)),
    "",
    `  ✓ ${WORKFLOW_DEST} is on ${input.branch}, and \`${check}\` is a required check.`,
    "",
    "  Work attempted outside gov on this branch is now stopped by the platform. What gov CANNOT tell you is",
    "  whether every OTHER repository of this organization is in the same state — run this per repository.",
  ] };
}
