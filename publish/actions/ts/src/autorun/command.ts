// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov autorun [--intent <NN>|--all] [--dry-run] [--agent <id>] [--max-minutes <n>] [--serial|--parallel <k>]` —
 * the verb (PRJ-121 intent 03, D4; spec §3; rulings Q7, Q10–Q12, Q16). It wires the real world into the run loop
 * (`run.ts`):
 *
 *   items   L11's scan of the project branch + the code host's change requests and approvals + the board (facts.ts)
 *   step    gov intent (L12) · a headless agent session (L16) on a sub-branch, by change request · STALE marking ·
 *           the plan's task issues after G3 (steps.ts)
 *   budget  `autorun:` in policies/governance.yaml, read from the DEFAULT branch (Q11; `--max-minutes` only lowers it)
 *   lock    one run per project, in gov's state dir
 *   record  `projects/<PRJ>/autorun/<yyyy-mm-dd-hhmm>.md` + one line in `projects/<PRJ>/knowledge/decisions.md`,
 *           committed on the project branch by local git and pushed (Q12)
 *
 * Which agent (Q16): only one with a verified headless mode (`headlessArgv` in the catalog) AND approved by the
 * organization. `--agent` naming any other refuses the run; with no usable agent the steps that need none (drafting
 * an intent, task issues, STALE marking) still run and the rest fail per item, saying why.
 *
 * Serial (#183 Q2). `--parallel <k>` above 1 is refused, not quietly run serially: the steps share one checkout for
 * `gov intent`, and per-item isolation for it is not built yet.
 */
import * as path from "node:path";
import type { Fs } from "../lifecycle/fs-io.js";
import type { Vcs } from "../lifecycle/vcs.js";
import type { VcsPort } from "../ports/vcs.js";
import type { WorkTrackerPort } from "../ports/work-tracker.js";
import { AGENT_CATALOG, type AgentCandidate } from "../cli/agent-catalog.js";
import { c01IdsFromRules, headlessLaunchSpec, runHeadless, type HeadlessRunDeps } from "../cli/work-flow.js";
import { parseAuthorizedAgents, type ApprovedAgent } from "../config/approved-agents.js";
import { boardNumberFromBranch } from "../lifecycle/task.js";
import { userDirtyPaths, dirtyRefusal } from "../lifecycle/root-protocol.js";
import { createIntent, projectBranchUnder } from "../intent/create.js";
import { LIFECYCLE_POLICY_PATH, parseLifecycle } from "../intent/lifecycle-policy.js";
import type { TreeReader } from "../intent/scan.js";
import { parseRuleStore, type RuleRow } from "../rules/model/rule-row.js";
import { RULE_STORE_PATHS } from "../rules/model/store-io.js";
import { readBudget } from "./budget.js";
import { collectItems, type ItemContext } from "./facts.js";
import type { LockFs } from "./lock.js";
import { withTrailers } from "./record.js";
import { runAutorun } from "./run.js";
import { makeStep } from "./steps.js";

export interface AutorunFlags {
  /** Only this intent (`NN`). Absent → every item (the board's loose issues too). */
  readonly intent?: string;
  readonly dryRun: boolean;
  readonly agent?: string;
  readonly maxMinutes?: number;
}

type Flags = Readonly<Record<string, string | boolean>>;
const KNOWN = new Set(["intent", "all", "dry-run", "agent", "max-minutes", "serial", "parallel"]);

export function parseAutorunFlags(positionals: readonly string[], flags: Flags): { ok: true; value: AutorunFlags } | { ok: false; message: string } {
  const no = (message: string) => ({ ok: false as const, message });
  if (positionals.length) return no(`gov autorun takes no arguments ('${positionals[0]}') — name an intent with --intent <NN>`);
  for (const k of Object.keys(flags)) if (!KNOWN.has(k)) return no(`gov autorun: unknown flag --${k}`);
  const out: { intent?: string; dryRun: boolean; agent?: string; maxMinutes?: number } = { dryRun: "dry-run" in flags };

  if ("intent" in flags) {
    const v = flags.intent;
    if (typeof v !== "string" || !/^\d{1,2}$/.test(v)) return no("--intent takes the intent's number, as in intents/<NN>-<slug>/ (for example --intent 03)");
    if ("all" in flags) return no("--intent and --all ask two different things — give one");
    out.intent = v.padStart(2, "0");
  }
  if ("agent" in flags) {
    if (typeof flags.agent !== "string" || !flags.agent.trim()) return no("--agent takes an agent id, for example --agent claude-code");
    out.agent = flags.agent.trim();
  }
  if ("max-minutes" in flags) {
    const v = flags["max-minutes"];
    const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
    if (!Number.isInteger(n) || n < 1) return no("--max-minutes takes a whole number of minutes, 1 or more");
    out.maxMinutes = n;
  }
  if ("parallel" in flags) {
    const v = flags.parallel;
    const k = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
    if (!Number.isInteger(k) || k < 1) return no("--parallel takes how many items at once, 1 or more");
    if ("serial" in flags && k !== 1) return no("--serial and --parallel <k> ask two different things — give one");
    if (k > 1) {
      return no(`--parallel ${k}: autorun runs serially for now — gov intent's step shares your checkout, and running items side by side needs each in its own. Run without --parallel.`);
    }
  }
  return { ok: true, value: out };
}

/**
 * The agent that drafts (03-Q16): `asked` if it may, else the org's default if it can run headless, else the first
 * approved agent that can. One gov has not seen run headless, or one the organization did not approve, is refused.
 */
export function resolveAgent(
  asked: string | undefined, approved: readonly Pick<ApprovedAgent, "id" | "default">[] | null, catalog: readonly AgentCandidate[] = AGENT_CATALOG,
): { readonly id: string } | { readonly refused: string } {
  const list = approved ?? [];
  const canRun = (id: string): string | null => {
    const s = headlessLaunchSpec(id, "", catalog);
    return "refused" in s ? s.refused : null;
  };
  if (asked) {
    if (!list.some((a) => a.id === asked)) {
      return { refused: `${asked} is not one of your organization's approved agents (${list.map((a) => a.id).join(", ") || "none"}) — autorun runs only an approved agent.` };
    }
    const why = canRun(asked);
    return why ? { refused: why } : { id: asked };
  }
  if (!list.length) return { refused: "your organization has approved no agents — autorun drafts nothing that needs one." };
  const ordered = [...list.filter((a) => a.default), ...list.filter((a) => !a.default)];
  const first = ordered.find((a) => canRun(a.id) === null);
  if (first) return { id: first.id };
  return { refused: `none of your organization's approved agents (${list.map((a) => a.id).join(", ")}) has a verified headless mode, so autorun cannot draft with one (03-Q16). Run those steps by hand with \`gov work\`.` };
}

export interface AutorunEnv {
  readonly vcs: Vcs;
  readonly fs: Fs;
  /** Read-only git queries in a repository: stdout, or null when git fails. */
  readonly git: (repo: string, args: readonly string[]) => string | null;
  readonly host: VcsPort;
  readonly tracker: WorkTrackerPort;
  /** The governance-repo checkout the person runs in, on the project branch. */
  readonly home: string;
  readonly remote?: string;
  readonly githubOrg: string;
  readonly workspaceRepo: string;
  readonly defaultBranch: string;
  /** Who runs it: the intent tracking issues' assignee. */
  readonly login: string;
  /** gov's state dir for this person — the lock and the worktrees live there. */
  readonly stateDir: string;
  readonly lockFs: LockFs;
  readonly now: () => Date;
  readonly runId: string;
  readonly today: string;
  readonly catalog?: readonly AgentCandidate[];
  readonly headlessExec: HeadlessRunDeps;
  /** gov work's kickoff for the project — the one prompt every gov-launched session starts with. */
  readonly kickoff: (project: string) => string;
}

/** A {@link TreeReader} over a git ref, by read-only git queries. */
export function gitTree(git: AutorunEnv["git"], repo: string, ref: string): TreeReader {
  return {
    async list(dir) {
      if (git(repo, ["cat-file", "-t", `${ref}:${dir}`]) !== "tree") return null;
      const out = git(repo, ["ls-tree", "--name-only", `${ref}:${dir}`]);
      return out === null ? null : out.split("\n").filter(Boolean);
    },
    async read(file) {
      if (git(repo, ["cat-file", "-t", `${ref}:${file}`]) !== "blob") return null;
      return git(repo, ["cat-file", "-p", `${ref}:${file}`]);
    },
  };
}

export async function autorunCommand(flags: AutorunFlags, env: AutorunEnv): Promise<{ code: number; lines: string[] }> {
  const refuse = (...lines: string[]) => ({ code: 1, lines });
  const remote = env.remote ?? "origin";
  const current = env.vcs.currentBranch(env.home);
  const pb = projectBranchUnder(current);
  const board = boardNumberFromBranch(pb);
  if (board === null) return refuse(`'${current}' is not a project branch (expected BRNCH-<n>-…) — run gov autorun inside the project.`);
  if (current !== pb && !flags.dryRun) {
    return refuse(`You are on ${current}. gov autorun commits its run record on the project branch — switch to it first: git checkout ${pb}`);
  }
  const project = pb.replace(/^brnch-/i, "PRJ-");

  // Governance from the DEFAULT branch (GOV-FRM-086/456): approved agents, budgets, the C01 rules.
  const govRef = env.git(env.home, ["rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/${env.defaultBranch}`]) ? `${remote}/${env.defaultBranch}` : env.defaultBranch;
  const governed = gitTree(env.git, env.home, govRef);
  const governanceText = await governed.read("policies/governance.yaml");
  const agent = resolveAgent(flags.agent, parseAuthorizedAgents(governanceText), env.catalog ?? AGENT_CATALOG);
  if (flags.agent && "refused" in agent) return refuse(`gov autorun: ${agent.refused}`);
  const { budget, problems } = readBudget(governanceText, flags.maxMinutes !== undefined ? { maxMinutes: flags.maxMinutes } : {});
  const rows: RuleRow[] = [];
  for (const rel of [RULE_STORE_PATHS.frameworkRules, RULE_STORE_PATHS.orgRules]) {
    const t = await governed.read(rel);
    if (t === null) continue;
    try { rows.push(...parseRuleStore(t)); } catch { /* a store that does not parse names no C01 id; `gov doctor` reports it */ }
  }
  const c01 = c01IdsFromRules(rows);
  const isC01 = (id: string): boolean => c01.has(id);

  // The project branch: up to date with its remote copy before anything is read or committed.
  if (!flags.dryRun) {
    const dirty = userDirtyPaths(env.vcs, env.home);
    if (dirty.length) return refuse(dirtyRefusal(env.home, dirty));
    try { env.vcs.fetch(env.home, remote, pb); } catch { /* offline or no remote copy yet: the local branch is what there is */ }
    const theirs = `refs/remotes/${remote}/${pb}`;
    if (env.vcs.refExists(env.home, theirs) && env.vcs.revParse(env.home, theirs) !== env.vcs.revParse(env.home, pb)) {
      if (env.vcs.isAncestor(env.home, pb, theirs)) {
        try { env.vcs.mergeNoEdit(env.home, `${remote}/${pb}`); } catch (e) { return refuse(`Could not bring ${pb} up to date with ${remote}: ${(e as Error).message}`); }
      } else if (!env.vcs.isAncestor(env.home, theirs, pb)) {
        return refuse(`${pb} and ${remote}/${pb} have diverged — bring them together (git pull) and run again.`);
      }
    }
  }
  const baseRef = pb;
  const tree = gitTree(env.git, env.home, baseRef);
  const policy = await tree.read(LIFECYCLE_POLICY_PATH);
  const govRepo = { owner: env.githubOrg, name: env.workspaceRepo };
  const boardRef = { owner: env.githubOrg, number: board };

  const contexts = new Map<string, ItemContext>();
  const notes: string[] = [...problems.map((p) => `budget: ${p}`)];
  if ("refused" in agent) notes.push(`agent: ${agent.refused}`);
  const extra: string[] = [];
  const kickoff = env.kickoff(project);

  const step = makeStep({
    vcs: env.vcs, fs: env.fs, host: env.host, tracker: env.tracker, home: env.home, remote, projectBranch: pb, baseRef,
    project, govRepo, board: boardRef, githubOrg: env.githubOrg, workspaceRepo: env.workspaceRepo, runId: env.runId, agent,
    headless: ({ cwd, task, timeoutMs }) => runHeadless(env.headlessExec, { agent: "id" in agent ? agent.id : "", cwd, kickoff, task, isC01, timeoutMs }, env.catalog ?? AGENT_CATALOG),
    isC01,
    worktreeRoot: path.join(env.stateDir, "autorun", "worktrees"),
    lifecycle: parseLifecycle(policy ?? ""),
    draftIntent: async (url) => {
      try {
        return await createIntent(
          { vcs: env.vcs, fs: env.fs, tracker: env.tracker, host: env.host },
          { govClone: env.home, issueUrls: [url], assignee: env.login, githubOrg: env.githubOrg, workspaceRepo: env.workspaceRepo,
            today: env.today, remote, trailers: { runId: env.runId, agent: "gov" } },
        );
      } finally {
        // gov intent leaves a person on the intent branch, for the interview; autorun goes back to the project branch.
        try { if (env.vcs.currentBranch(env.home) !== pb) env.vcs.checkout(env.home, pb); } catch { /* reported by the next step's own checks */ }
      }
    },
    contextOf: (id) => contexts.get(id),
  });

  try {
    const r = await runAutorun({
      project, lifecycleActive: policy !== null,
      items: async () => {
        const got = await collectItems({
          tree, host: env.host, tracker: env.tracker, govRepo, board: boardRef, project, projectBranch: pb,
          changedAt: (p) => env.git(env.home, ["log", "-1", "--format=%cI", baseRef, "--", p]) || null,
        });
        if (!got.ok) throw new Error(got.reason);
        notes.push(...got.notes);
        for (const it of got.items) contexts.set(it.facts.id, it.context);
        return got.items.map((i) => i.facts);
      },
      recordExists: (rel) => env.fs.pathExists(path.join(env.home, ...rel.split("/"))),
      step, lockFs: env.lockFs, stateDir: env.stateDir, now: env.now, runId: env.runId, budget,
      record: async (rel, text, decisionsLine) => {
        const at = (p: string): string => path.join(env.home, ...p.split("/"));
        const decisions = `projects/${project}/knowledge/decisions.md`;
        try {
          env.fs.mkdirp(path.dirname(at(rel)));
          env.fs.writeFile(at(rel), text);
          const cur = env.fs.readFile(at(decisions));
          env.fs.mkdirp(path.dirname(at(decisions)));
          env.fs.writeFile(at(decisions), `${cur ?? "# Decisions\n\n"}${cur && !cur.endsWith("\n") ? "\n" : ""}${decisionsLine}\n`);
          env.vcs.addPath(env.home, rel);
          env.vcs.addPath(env.home, decisions);
          env.vcs.commit(env.home, withTrailers(`autorun ${env.runId}: run record`, { runId: env.runId, agent: "gov" }));
        } catch (e) {
          return { ok: false, reason: (e as Error).message };
        }
        try { env.vcs.push(env.home, remote, pb); } catch (e) {
          extra.push(`  ⚠ the run record is committed on ${pb} but not pushed: ${(e as Error).message.split("\n").slice(-1)[0]}`);
        }
        return { ok: true };
      },
    }, { ...(flags.intent ? { intent: flags.intent } : {}), dryRun: flags.dryRun });
    const [head, ...rest] = r.lines;
    return { code: r.code, lines: [...(head ? [head] : []), ...notes.map((n) => `  · ${n}`), ...rest, ...extra] };
  } catch (e) {
    return refuse(`gov autorun: ${(e as Error).message}`, ...notes.map((n) => `  · ${n}`));
  }
}
