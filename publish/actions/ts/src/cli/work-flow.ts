// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The guided Work flow (port of prj `cmd_work`) — the menu's primary path.
 * Pick YOUR assigned project → fail fast if you can't write its board → route:
 * seed if new, join if not cloned locally, else it's ready → session-start
 * guidance. Pure over injected deps (ports + run + prompt/print), so it's testable.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { isRateLimited, type BoardSummary, type Projects } from "../lifecycle/project-list.js";
import type { AnchorCreator } from "../lifecycle/anchor.js";
import type { Fs } from "../lifecycle/fs-io.js";
import { deriveProjectIdentity } from "../lifecycle/identity.js";
import { deriveStatus } from "../lifecycle/state.js";
import { boardNumberFromProjectId } from "../lifecycle/task.js";
import { ensureRootProtocol, mirrorWarnings } from "../lifecycle/root-protocol.js";
import type { GovSnapshot } from "../lifecycle/governance-snapshot.js";
import { AGENT_CATALOG, CURSOR_GUI, agentStatuses, approvedAgents, offerable, installable, menuLines, nothingInstalledLines, type AgentCandidate } from "./agent-catalog.js";
import { chooseAgent, choiceExplanation } from "./agent-choice.js";
import { structureOnlyLines, TURN_AGENTS_ON } from "./approve-agents-step.js";
import { defaultAgent } from "../config/approved-agents.js";
import { paint } from "./format.js";
import { decide, log } from "../log.js";
import {
  fillPage, formatLevel, githubUnreachableLines, leadWithSearch, matchProjects, pageOf, pickerSettings,
  rankProjects, resolvePickerInput, type LevelView, type LocalOrder, type PickerLevel,
  type PickerRow, type PickerSettings,
} from "./project-picker.js";
import { lastUsedLabel, orderLocal, scanLocalProjects, type LocalProject } from "../lifecycle/local-projects.js";

/**
 * The status of a board that has NO anchor issue: nobody has seeded it, anywhere, ever.
 *
 * Named rather than spelled out at each site (#198), because it is the ONE value that separates
 * "does not exist yet" from "exists, and this machine has not opened it". `deriveStatus` never
 * produces it — a project with an anchor always has a real lifecycle status.
 */
export const NOT_STARTED = "not started";

export interface WorkProject {
  readonly boardNumber: number;
  readonly title: string;
  readonly url: string;
  /** A `ProjectStatus` when an anchor issue exists, {@link NOT_STARTED} when none does. */
  readonly status: string;
  readonly projectId: string;
}

export interface WorkFlowDeps {
  readonly projects: Projects;
  readonly anchor: AnchorCreator;
  readonly fs: Fs;
  /**
   * `govHome` is the governance clone held on the DEFAULT branch (`~/.gov/<slug>/gov_repo`).
   * Optional so a caller that cannot resolve it still works — the prompt then falls back to the
   * project-branch worktree, which is a wrong-branch read (GOV-FRM-456) but not a dead path.
   */
  readonly config: { readonly githubOrg: string; readonly workspaceRepo: string; readonly agentWorkRoot: string; readonly govHome?: string; readonly ownerField?: "organization" | "user" };
  readonly me: string | null;
  readonly canWriteBoard: (boardNumber: number) => boolean;
  readonly run: (argv: readonly string[]) => Promise<number> | number;
  readonly prompt: (q: string) => Promise<string>;
  /** Is this command on PATH? Injected, so the menu is decidable in a test (#195). */
  readonly hasTool?: (cmd: string) => boolean;
  /** The environment, for reporting a missing key without ever reading its value. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * The org's `authorized_agents`, in the three states `parseAuthorizedAgents` keeps apart (#196):
   *
   *   null  nobody has answered → gov falls back to the framework's list and says so
   *   []    the org authorized NONE → structure-only; nothing agent-shaped happens here
   *   […]   the org's list
   *
   * THE EMPTY ARRAY IS LOAD-BEARING. It used to be indistinguishable from null, so an org that had
   * decided to run no agents was offered the whole framework catalogue to install — the fallback
   * that #196 removed at adoption, arriving instead at the one moment the org had already
   * answered. Both `[]` and null reach the same dep because the reader already tells them apart;
   * nothing new had to be wired through the three callers that build this.
   */
  readonly approvedAgents?: () => readonly { readonly id: string; readonly default?: boolean }[] | null;
  /** This person's preferred agent id, from their preferences file. C03. */
  readonly agentPreference?: () => string | null;
  /** Install an approved agent and offer its sign-in. Returns whether it is usable now. */
  /**
   * Install an approved agent and settle its sign-in. Returns whether it is usable now.
   *
   * ASYNC, AND IT BORROWS THIS FLOW'S PROMPT (#213). It used to be synchronous and read the
   * terminal itself — first `readSync(0, …)`, which the flow's own readline had already taken,
   * then a second handle on /dev/tty, which raced the same readline for the same keystrokes.
   * Both are the shape #194 named: two readers of one terminal. There is one reader here, and
   * everything that needs to ask borrows it.
   */
  readonly installAgent?: (id: string, ask: AskFns) => Promise<boolean> | boolean;
  /** Copy the governing files from the default branch into `<project>/.gov/governance` (PRJ-121). Absent or
   *  null → the prompt keeps its old paths. */
  readonly snapshotGovernance?: (projectDir: string) => GovSnapshot | null;
  /** Fork mappings the last `seed` proposed, if any (#194). */
  readonly pendingRepoOverrides?: () => readonly { readonly from: string; readonly to: string }[];
  /** Record them in org-config.yaml. Returns whether anything was written. */
  readonly applyRepoOverrides?: (o: readonly { readonly from: string; readonly to: string }[]) => boolean;
  readonly print: (l: string) => void;
  /** May this flow's output carry ANSI (#204)? Decided by the caller — these lines go to stderr. */
  readonly color?: boolean;
  /**
   * How to ask — including the hidden read a key needs. REQUIRED, and that is the fix.
   *
   * It was optional, with a fallback that printed "(cannot hide input here — skipped)" and
   * returned "". Three call sites build a work flow; two were given an asker and the THIRD —
   * the review offer that closes adoption (#203) — was not. So an adopter chose "paste an API
   * key", and the fallback answered for them, in a parenthetical, and the run carried on.
   *
   * That is #199's lesson rebuilt by hand: a degraded path that cannot be told from success at
   * the call site. Making this required turns "I forgot one" into a compile error, which is
   * the only version of this that stays fixed.
   */
  readonly ask: AskFns;
  /** Launch an interactive agent/editor/shell with `cwd` = the project dir. `inject` = the session-start
   *  kickoff prompt handed to a speak-first CLI agent (Claude / cursor-agent) so it runs the protocol
   *  immediately. Terminal agents inherit stdio + block; the GUI editor opens detached. */
  readonly launch: (agent: AgentKind, cwd: string, inject: string) => Promise<number>;
  /** `--print-prompt` writes HERE, not through `print` — stdout must carry the prompt and nothing else,
   *  so `gov work … --print-prompt` can be captured or piped. */
  readonly printPrompt?: (prompt: string) => void;
}

/**
 * What to launch: an `AGENT_CATALOG` id (`"claude-code"`, `"ibm-bob"`, …) whose own `cmd` is run,
 * or one of the two things that are not catalog agents — the Cursor editor opened on the project
 * directory, and a plain shell.
 *
 * It was a closed four-value union, which is why the catalog could grow to twelve agents while only
 * two of them could be started (#199). The id IS the launch instruction now; nothing translates it.
 */
export type AgentKind = "cursor-gui" | "shell" | (string & {});

/**
 * The two ways to ask, both driven by the ONE reader the flow owns.
 *
 * `secret` is the same question with the echo off — a key must not appear on screen, in a
 * scrollback, or over someone's shoulder.
 */
export interface AskFns {
  readonly line: (question: string) => Promise<string>;
  readonly secret: (question: string) => Promise<string>;
}

/**
 * What `gov work` already knows, so the flow can skip asking. The MENU passes none of these and behaves
 * exactly as before; flags fill them in one at a time, and with both supplied the flow runs start to finish
 * without a prompt — which is what makes it usable from a script.
 */
export interface WorkFlowOpts {
  /** `--project=<regex>` — matched against project ids, case-insensitive. */
  readonly projectPattern?: string;
  /** `--agent=<kind>` — skips the agent question. */
  readonly agent?: AgentKind;
  /** `--seed` — authorises STARTING a project that nobody has seeded yet (org-visible: branches, anchor
   *  issue, assignment). Picking a `(not started)` entry from the menu IS this consent; a regex match is not. */
  readonly seedOk?: boolean;
  /** `--print-prompt` — emit the kickoff prompt and stop. Seeds nothing, clones nothing, launches nothing. */
  readonly printPromptOnly?: boolean;
  /** false when there is no TTY: an unresolved choice must then FAIL naming the flag that would resolve it,
   *  because there is nobody to ask. */
  readonly interactive?: boolean;
  /** `work.picker.pageSize` — how many projects a page shows. The person's preference; 15 when unset. */
  readonly pageSize?: number;
  /** `work.picker.localFirst` — offer the projects already cloned here before any GitHub call. Default true. */
  readonly localFirst?: boolean;
  /** `work.picker.localOrder` — `last-used` (mtime, the default) or `number` (board order, like the GitHub lists). */
  readonly localOrder?: LocalOrder;
  /** `work.picker.searchThreshold` — past this many entries a level leads with search instead of a list. Default 30. */
  readonly searchThreshold?: number;
  /** The project the person is STANDING IN (cwd under the work root), when no `--project` was given. The menu
   *  says "Continue the current project" in PROJECT context; the flow used to list every project anyway
   *  (a walk, 2026-09-22). With this set, Work goes straight to it. */
  readonly currentProject?: string;
}

// `matchProjects` moved to `project-picker.ts` with the rest of the matching, and is re-exported here
// because every caller and test already imports it from this module. The picker's `/text` search is a
// strict superset of it, so the menu can never match less than `--project` does.
export { matchProjects };

/** The kickoff prompt that makes a speak-first CLI agent run the session-start protocol immediately, before
 *  the user types anything (ports the bash prj `agent_session_start_prompt`). Paths are workspace-relative
 *  from the PROJECT ROOT (where the agent launches), so the agent reads the right files across repos. */
export function sessionStartPrompt(projectId: string, workspaceRepo: string, govHome?: string, snapshot?: GovSnapshot | null): string {
  const w = workspaceRepo;
  // GOVERNANCE FROM THE DEFAULT BRANCH, PROJECT PATHS FROM THE PROJECT BRANCH (GOV-FRM-456, C01).
  //
  // This pointed every read at `<project>/<workspace-repo>/…`, which is a worktree on the
  // PROJECT branch. GOV-FRM-456 is explicit: org knowledge, the session protocol and policies
  // "must be built, and rebuilt each session, from <DEFAULT_BRANCH>, never from a project
  // branch", while `projects/PRJ-…/` is read from the project branch.
  //
  // Reading the policy from the project branch is not pedantically wrong, it is the hole
  // GOV-FRM-086 warns about: a project branch MAY edit org knowledge, as a proposal with no
  // governing force. Point the agent at that same branch and an unratified edit becomes the
  // thing it obeys — self-governing, which GOV-FRM-086 prohibits in as many words.
  //
  // `govHome` is the clone held on the default branch (~/.gov/<slug>/gov_repo). When a caller
  // cannot supply it the prompt falls back to the worktree copy rather than naming a path that
  // may not exist — a wrong-branch read is a governance defect, a missing path is a dead end.
  //
  // A SNAPSHOT INSIDE THE PROJECT WHEN THERE IS ONE (PRJ-121, 2026-09-22). `govHome` is outside the project
  // folder, where an agent that sandboxes its reads cannot go — on a walk, Bob's `read_file` there failed and it
  // fell back to `cat`. gov now copies the two files from the default branch into `<project>/.gov/governance`
  // (see governance-snapshot.ts) and points here; the old paths remain the fallback when no snapshot was made.
  if (snapshot) {
    return `Run the session-start protocol for ${projectId} now, before I send anything else: `
      + `read ${snapshot.files.map((f) => `${snapshot.dir}/${f}`).join(" and ")} — `
      + `a read-only snapshot of ${snapshot.source}, the default branch, which is the only branch that governs `
      + `(GOV-FRM-086); gov copied it into this project so you can read it here — then `
      + `${w}/projects/${projectId}/agent.md and any "## Open" items from `
      + `${w}/projects/${projectId}/knowledge/todo.md, which are the project branch's; `
      + `then post the context manifest, naming ${snapshot.source} as the governance you read, and wait for my direction.`;
  }
  const governance = govHome ?? w;
  return `Run the session-start protocol for ${projectId} now, before I send anything else: `
    + `read ${governance}/org-config.yaml and `
    + `${governance}/framework/policies/framework-policy.md — both from the `
    + `default branch, which is the only branch that governs (GOV-FRM-086) — then `
    + `${w}/projects/${projectId}/agent.md and any "## Open" items from `
    + `${w}/projects/${projectId}/knowledge/todo.md, which are the project branch's; `
    + `then post the context manifest and wait for my direction.`;
}


export interface StartSession {
  readonly projectId: string;
  /** the project directory the agent must run in — repos are its children. */
  readonly dir: string;
  /** the kickoff prompt, identical to the one the interactive menu injects. */
  readonly prompt: string;
}

/**
 * WHAT A SESSION ON AN EXISTING PROJECT NEEDS — resolved without a terminal.
 *
 * The guided Work flow (menu) does seed → join → session-start and launches an agent carrying the kickoff
 * prompt. That path is TTY-only, which is backwards: the prompt exists to drive an AGENT, and agents are
 * precisely the non-TTY case. This is the same resolution as a pure function, so `gov work` can answer a
 * script, a CI job, or an agent wrapper.
 *
 * `undefined` when the project is not cloned here — the caller says how to get it (`gov join <board-url>`),
 * because "no such directory" is not a useful thing to tell someone who asked to start work.
 */
export function startSession(
  projectWorkRoot: string, workspaceRepo: string, projectId: string, exists: (p: string) => boolean,
): StartSession | undefined {
  const dir = path.join(projectWorkRoot, projectId);   // path.join, not a literal '/': on Windows the two do not match
  if (!exists(dir)) return undefined;
  return { projectId, dir, prompt: sessionStartPrompt(projectId, workspaceRepo) };
}

/**
 * The project a path sits inside, if any: the first segment below the work root. Lets `gov work` be typed
 * with no argument from anywhere in a project — the same rule the context banner uses to decide PROJECT.
 */
export function projectFromPath(projectWorkRoot: string, cwd: string, sep = "/"): string | undefined {
  const root = projectWorkRoot.endsWith(sep) ? projectWorkRoot : projectWorkRoot + sep;
  if (!cwd.startsWith(root)) return undefined;
  return cwd.slice(root.length).split(sep).filter(Boolean)[0];
}

export interface LaunchSpec {
  readonly cmd: string;
  readonly args: readonly string[];
  readonly detached: boolean;
  /**
   * The kickoff prompt gov could NOT hand to this agent, because its catalog entry does not
   * say how (#207). The caller prints it to paste. Absent when the prompt was passed.
   */
  readonly promptToPaste?: string;
  /** True when the prompt travelled in `args` — so the caller can say governance happened. */
  readonly promptArgvUsed?: true;
  /** How to reopen the session after a one-shot first message — see AgentCandidate.resume. */
  readonly resume?: AgentCandidate["resume"];
  /**
   * The protocol text itself, ALWAYS — regardless of how it was delivered.
   *
   * Separate from `promptToPaste`, which means "delivery is by paste and the caller must print
   * it". Conflating the two left the first-run handover unable to show the protocol on the one
   * path where it is needed most: an argv agent that refused the argv. The spec knew the text
   * and had nowhere to put it.
   */
  readonly promptText: string;
}

/**
 * The concrete command to launch an agent in a project dir — READ FROM THE CATALOG (#199).
 *
 * It used to be a four-arm switch, and every catalog agent was squeezed into those four values by a
 * ternary that mapped anything but Claude Code and Cursor to `"shell"`. So five of the seven `cli`
 * agents — codex, gemini, copilot, bob, aider — installed, were announced as started, and opened a
 * bare shell. Each of them carries its own `cmd` in `AGENT_CATALOG`, which the mapping discarded.
 *
 * NULL WHEN GOV CANNOT LAUNCH IT. The defect was not the missing binary, it was the fallback:
 * substituting a shell produced a result indistinguishable from success, and the caller went on to
 * say the agent had started. A caller that must handle null cannot make that mistake silently.
 *
 * Speak-first CLI agents get the `inject` prompt as their first message; an `ide` entry opens the
 * directory and detaches. Pure (env + catalog injected), so the mapping is tested without spawning.
 */

/**
 * The shell to open when `$SHELL` is not set — one that is actually on this machine (PRJ-121, 2026-09-22).
 *
 * This was a hardcoded `/bin/zsh`: macOS's default, and absent from the Rocky, Debian and Ubuntu images an
 * adopter arrives on. `$SHELL` is unset more often than it looks — root in `docker run … bash`, CI, cloud
 * shells, minimal containers — and there the DECLINE path had no exit: answer `n` to installing an agent and
 * gov promised a shell, printed `could not launch '/bin/zsh'`, and dropped the person back out. Found on a
 * walk as root; `su - tester` sets `$SHELL`, which is why the tester walk never saw it.
 */
export function fallbackShell(exists: (p: string) => boolean = fs.existsSync): string {
  for (const s of ["/bin/bash", "/bin/sh"]) if (exists(s)) return s;
  return "/bin/sh";   // POSIX guarantees it; if even this is missing, the error names a shell that should be there
}
export function agentLaunchSpec(
  agent: AgentKind,
  cwd: string,
  inject: string,
  env: NodeJS.ProcessEnv = process.env,
  catalog: readonly AgentCandidate[] = AGENT_CATALOG,
  exists: (p: string) => boolean = fs.existsSync,
): LaunchSpec | null {
  if (agent === "shell") return { cmd: env.SHELL || fallbackShell(exists), args: [], detached: false, promptText: inject };
  // The Cursor EDITOR opened on the project dir. Not a catalog entry of its own: the policy approves
  // `cursor` the agent, and this is one of the ways to run it (#196, Q8).
  //
  // AN EDITOR STILL NEEDS THE FIRST MESSAGE. It used to get no prompt at all — neither argv nor
  // paste — so gov opened the editor and the session-start protocol simply never ran, silently.
  // A GUI cannot take a positional prompt, so paste is the only route, and #218 already made
  // paste survivable: the text is written to <project>/.gov/session-prompt.md and gov waits
  // before launching. That machinery is more useful here than in a terminal, because the editor
  // opens in another window and leaves the instruction on screen.
  if (agent === "cursor-gui") return { cmd: "cursor", args: [cwd], detached: true, promptToPaste: inject, promptText: inject };

  const c = catalog.find((a) => a.id === agent);
  if (!c?.cmd || c.launch === "none") return null;
  if (c.launch === "ide") return { cmd: c.cmd, args: [cwd], detached: true, promptToPaste: inject, promptText: inject };
  // HOW TO HAND IT THE PROMPT IS PER-AGENT (#207). It was a bare positional for everyone,
  // which `bob` rejects outright — zero positionals, and the launch died with a usage error
  // after a clean install. An entry that has not been checked launches BARE: the agent still
  // starts in the project, and its harness file is what governs the session anyway.
  return c.promptArgv
    ? { cmd: c.cmd, args: c.promptArgv.map((a) => a.replaceAll("{prompt}", inject)), detached: false, promptArgvUsed: true, promptText: inject, ...(c.resume ? { resume: c.resume } : {}) }
    : { cmd: c.cmd, args: [], detached: false, promptToPaste: inject, promptText: inject };
}

/**
 * The `--agent=` vocabulary. The flag is a short alias a person types; the value gov carries is the
 * CATALOG ID, so the launch can read the entry. Catalog ids are accepted directly too, which is what
 * makes `--agent=ibm-bob` work without a second name for it.
 */
export const AGENT_FLAG_ALIASES: Readonly<Record<string, AgentKind>> = {
  claude: "claude-code",
  cursor: "cursor",
  "cursor-gui": "cursor-gui",
  shell: "shell",
};

/** A flag or `$GOV_AGENT` value → the catalog id (or special) to launch, or null if it names nothing. */
export function agentKindFromFlag(named: string, catalog: readonly AgentCandidate[] = AGENT_CATALOG): AgentKind | null {
  const alias = AGENT_FLAG_ALIASES[named];
  if (alias) return alias;
  return catalog.some((a) => a.id === named && a.cmd) ? named : null;
}

/**
 * WHICH AGENT TO LAUNCH, without asking — the non-TTY counterpart of the menu's numbered prompt.
 *
 *   --agent <kind>  >  $GOV_AGENT  >  the one that is actually installed
 *
 * The last step is what makes this work for someone who has just installed gov: if exactly one supported
 * agent is on their PATH, that is not a guess, it is the only answer. Two installed and no preference is a
 * real ambiguity, so it asks rather than picking — the same discipline as refusing an ambiguous content_sha.
 */
export type AgentChoice = { readonly ok: true; readonly agent: AgentKind } | { readonly ok: false; readonly reason: string };

export function resolveAgent(
  flag: string | undefined, env: NodeJS.ProcessEnv, onPath: (cmd: string) => boolean,
  catalog: readonly AgentCandidate[] = AGENT_CATALOG,
): AgentChoice {
  const named = (flag ?? env.GOV_AGENT)?.trim();
  if (named) {
    const k = agentKindFromFlag(named, catalog);
    if (k) return { ok: true, agent: k };
    const ids = catalog.filter((a) => a.cmd && a.launch !== "none").map((a) => a.id);
    return { ok: false, reason: `unknown agent '${named}' — use one of: ${Object.keys(AGENT_FLAG_ALIASES).join(", ")}, or a catalog id (${ids.join(", ")})` };
  }
  // WHATEVER IS ON PATH, not a hard-coded pair (#199). The old list looked for `claude` and
  // `cursor-agent` only, so the one installed agent on a machine that had chosen any of the other
  // five was invisible — and `gov work --agent` was the only way through.
  const found = catalog.filter((a) => a.cmd && a.launch !== "none" && onPath(a.cmd));
  if (found.length === 1) return { ok: true, agent: found[0]!.id };
  if (found.length === 0) {
    const looked = catalog.filter((a) => a.cmd && a.launch !== "none").map((a) => a.cmd).join(", ");
    return { ok: false, reason: `no agent found on PATH (looked for: ${looked}).\n  pass --agent <id>, or set $GOV_AGENT.\n  \`--agent shell\` just opens a shell in the project.` };
  }
  return { ok: false, reason: `more than one agent is installed (${found.map((a) => a.cmd).join(", ")}) — say which: --agent <${found.map((a) => a.id).join("|")}>, or set $GOV_AGENT.` };
}

/** A board, with the two facts the picker splits its levels on: is it seeded at all, and is it MINE? */
export interface Candidate extends WorkProject {
  /** An anchor issue exists → somebody has started this project. */
  readonly anchored: boolean;
  /** The anchor issue names me as an assignee. Being assigned IS the access (design §3.2). */
  readonly mine: boolean;
}

/**
 * EVERY OPEN BOARD, NEWEST FIRST — the board list and the anchors, and NOT ONE ACCESS CHECK.
 *
 * Two `gh` calls however many boards the org has: `gh project list` once, the anchor search once. That
 * is the whole cost of knowing which projects exist, which are seeded, and which are yours.
 *
 * The expensive question — "may I write this board?" — is deliberately absent. It costs a call PER
 * BOARD, it is only needed for boards nobody has started (being assigned already answers it for the
 * rest), and on the org this design came from ~100 of ~100 boards were unstarted, so asking it up
 * front was a 100-call preamble to showing a person the project they open every morning. It is asked
 * in {@link unstartedPage}, for the page being shown, and by the write gate on the project actually
 * picked — the two places where the answer changes what gov does.
 */
export function candidateProjects(deps: WorkFlowDeps): Candidate[] {
  const ownerField = deps.config.ownerField ?? "organization";
  // Fetch every anchor in ONE gh call when the port supports it (63 boards → 1 round-trip, not 63);
  // fall back to per-board find() for lightweight doubles that don't implement findAll.
  const allAnchors = deps.anchor.findAll?.(deps.config.githubOrg, deps.config.workspaceRepo);
  const out: Candidate[] = [];
  for (const b of deps.projects.listBoards(deps.config.githubOrg)) {
    if (b.closed) continue;
    const a = allAnchors ? allAnchors.get(b.number) ?? null : deps.anchor.find({ owner: deps.config.githubOrg, ownerField, number: b.number }, deps.config.workspaceRepo);
    const id = deriveProjectIdentity({ url: b.url, title: b.title });
    out.push({
      boardNumber: b.number, title: b.title, url: b.url,
      status: a ? deriveStatus(!b.closed, a.labels) : NOT_STARTED,
      projectId: id.ok ? id.projectId : `PRJ-${b.number}`,
      anchored: !!a,
      mine: !!a && !!deps.me && a.assignees.includes(deps.me),
    });
  }
  return out.sort((x, y) => y.boardNumber - x.boardNumber);
}

/** My projects = open boards whose anchor issue lists me as an assignee (owner). Two calls, no access checks. */
export function myProjects(deps: WorkFlowDeps): WorkProject[] {
  if (!deps.me) return [];
  return candidateProjects(deps).filter((c) => c.mine);
}

/**
 * Open boards with NO anchor — nobody has seeded them, anywhere, ever. Not access-checked here.
 *
 * Kept separate from the check so a `/text` search can narrow the list BEFORE gov pays a call per
 * board (design §3.4: a search must save calls, not just screen space).
 */
export function unstartedBoards(deps: WorkFlowDeps): WorkProject[] {
  if (!deps.me) return [];      // seeding assigns somebody; with no login there is nobody to assign
  return candidateProjects(deps).filter((c) => !c.anchored);
}

/**
 * ONE FULL PAGE OF BOARDS YOU COULD START — `limit` of them, checking write access only as far as it
 * takes to fill the page.
 *
 * Two mistakes are avoided at once here, and they pull against each other:
 *
 *   · checking every board is a ~100-call wait on a large org (design §3.3 → check per page);
 *   · checking exactly `limit` boards and showing the survivors is how this list came to paginate
 *     11, then 1, then 7 (a walk, 2026-09-22) — the page size belonged to what was SHOWN, and the
 *     filter ran after it.
 *
 * So the scan stops at the first of "the page is full" and "there are no more boards", `nextOffset`
 * is the board to resume from, and `more` says whether any remain. The arithmetic is `fillPage`'s,
 * tested on its own with a list long enough to page three times.
 */
export function unstartedPage(deps: WorkFlowDeps, limit: number, offset: number): { items: WorkProject[]; nextOffset: number; more: boolean; total: number } {
  const boards = unstartedBoards(deps);
  const page = fillPage(boards, (b) => deps.canWriteBoard(b.boardNumber), limit, offset);
  return { items: page.items, nextOffset: page.nextOffset, more: page.more, total: boards.length };
}

/** Seedable boards = open boards I can WRITE but that have NO anchor yet (never seeded). Offered in Work so a
 *  freshly-created GitHub board (e.g. #106) can be STARTED, not only picked once already seeded. Picking one
 *  runs the not-seeded → `seed` path. (Cost: `canWriteBoard` per un-anchored board — the picker pays it a
 *  page at a time; this whole-list form is for callers that need the count.) */
export function seedableBoards(deps: WorkFlowDeps): WorkProject[] {
  const boards = unstartedBoards(deps);
  return fillPage(boards, (b) => deps.canWriteBoard(b.boardNumber), Math.max(1, boards.length), 0).items;
}

export type WorkspaceState = "not-seeded" | "not-cloned" | "ready";
/**
 * Where this project stands ON THIS MACHINE — and, separately, whether it exists at all (#198).
 *
 * The local directory answers only the first question. It was being used for both, so on a machine
 * that had never opened the project — every fresh install, every new developer — an organization's
 * long-seeded projects were all classified `not-seeded` and routed to `seed`. Seed then found the
 * remote branch and the home stub, which are the evidence the seed SUCCEEDED, and reported them as
 * "leftover state from a previous failed run". The run stopped there, offering nothing.
 *
 * Whether a project has been seeded is a GitHub fact, and the list one line above already resolved
 * it: an anchor issue exists (`myProjects` → a real status) or it does not (`seedableBoards` →
 * "not started"). So it is read here rather than guessed from the filesystem. A missing directory
 * for an anchored project means it is not cloned HERE, which is `join`'s job — and `join`
 * materializes the work root it does not find.
 */
export function workspaceState(deps: WorkFlowDeps, p: WorkProject): WorkspaceState {
  const projRoot = path.join(deps.config.agentWorkRoot, p.projectId);
  if (!deps.fs.pathExists(projRoot)) return p.status === NOT_STARTED ? "not-seeded" : "not-cloned";
  if (!deps.fs.pathExists(path.join(projRoot, deps.config.workspaceRepo, ".git"))) return "not-cloned";
  return "ready";
}

/**
 * The board list and the anchors, fetched ONCE per flow. Every page (and every `m`) re-ran `gh project list`
 * — 10–12 s on this org — and the org-wide anchor search. Nothing they return changes while a person reads a
 * page, so the flow asks once and pages over the answer.
 *
 * `cached` answers "has GitHub already been asked?" WITHOUT asking it. The local list needs that: a
 * project whose board has since closed is marked `(closed on GitHub)` only once GitHub has been
 * consulted for some other reason, and never by making a call of its own (design §3.1).
 */
function withBoardCache(deps: WorkFlowDeps): { deps: WorkFlowDeps; cached: () => ReturnType<Projects["listBoards"]> | null } {
  const boards = new Map<string, ReturnType<Projects["listBoards"]>>();
  const anchors = new Map<string, ReturnType<NonNullable<WorkFlowDeps["anchor"]["findAll"]>>>();
  const projects: Projects = {
    ...deps.projects,
    listBoards: (owner) => {
      if (!boards.has(owner)) {
        const got = deps.projects.listBoards(owner);
        if (deps.projects.lastFailure?.()) return got;          // never cache a failure — the next ask retries
        boards.set(owner, got);
      }
      return boards.get(owner)!;
    },
    ...(deps.projects.lastFailure ? { lastFailure: () => deps.projects.lastFailure!() } : {}),
  };
  const findAll = deps.anchor.findAll;
  const anchor = findAll
    ? { ...deps.anchor, findAll: (org: string, repo: string) => {
        const k = `${org}/${repo}`;
        if (!anchors.has(k)) anchors.set(k, findAll.call(deps.anchor, org, repo));
        return anchors.get(k)!;
      } }
    : deps.anchor;
  return {
    deps: { ...deps, projects, anchor } as WorkFlowDeps,
    cached: () => boards.get(deps.config.githubOrg) ?? null,
  };
}

// `ensureRootProtocol` (imported above) lives in a leaf lifecycle module so BOTH `seed` and this Work flow use
// it (no cli→lifecycle cycle). Re-exported so existing importers/tests keep resolving it here.
export { ensureRootProtocol, mirrorWarnings };

/** A folder's row: the branch it is on and when it was last used — the two things that tell one apart. */
export function localRow(l: LocalProject, nowMs: number, closedOnGitHub = false): PickerRow {
  const bits = [l.branch, lastUsedLabel(l.lastUsedMs, nowMs)].filter(Boolean);
  if (!l.cloned) bits.push("needs cloning");
  if (closedOnGitHub) bits.push("closed on GitHub");
  return { projectId: l.projectId, note: bits.length ? bits.join(" · ") : "on this machine" };
}

/** A board's row: its lifecycle status, or `not started` for one nobody has seeded. */
export const boardRow = (p: WorkProject): PickerRow => ({ projectId: p.projectId, note: `(${p.status})` });

/**
 * Which local folders belong to a board that is closed (or gone) on GitHub — `null` boards means GOV HAS NOT
 * ASKED, and then nothing is marked.
 *
 * The local list is the zero-call list, and a `(closed on GitHub)` mark it had to make a call to earn would
 * quietly cost exactly what that list exists to avoid (design §3.1). So the mark appears only when the board
 * list happens to be in hand already — the person pressed `g` earlier, or a pattern was resolved — and its
 * absence means "not known", never "open".
 */
export function markClosedOnGitHub(local: readonly LocalProject[], boards: readonly BoardSummary[] | null): ReadonlySet<string> {
  const out = new Set<string>();
  if (!boards) return out;
  for (const l of local) {
    if (l.boardNumber === null) continue;
    const b = boards.find((x) => x.number === l.boardNumber);
    if (!b || b.closed) out.add(l.projectId);
  }
  return out;
}

type Picked = { readonly kind: "picked"; readonly project: WorkProject; readonly local: boolean };
type Done = { readonly kind: "done"; readonly code: number };

/**
 * THE PICKER, DRIVEN — local first, then yours, then what you could start, with `/text` at every level.
 *
 * The shape of the levels, the ranking, the paging and the search-first decision are all in
 * `project-picker.ts` and tested without a terminal. What is here is the IO: when to call GitHub (as late
 * as possible, and never for the local list), what to do when it will not answer, and what a keystroke
 * does to the level stack.
 *
 * `local: true` on the result means the pick came from a folder that is already cloned here: nothing
 * org-visible follows, so the caller skips even the one write-access check (design §5 promises a project
 * already on this machine opens for NO GitHub calls).
 */
async function pickProject(
  deps: WorkFlowDeps, set: PickerSettings, cachedBoards: () => readonly BoardSummary[] | null, nowMs: number,
): Promise<Picked | Done> {
  const { print } = deps;
  const localAll = set.localFirst
    ? orderLocal(scanLocalProjects(deps.fs, deps.config.agentWorkRoot, deps.config.workspaceRepo), set.localOrder)
    : [];

  // GITHUB IS ASKED WHEN A LEVEL NEEDS IT, AND ONCE. `withBoardCache` keeps the answer; this keeps the
  // failure, so a rate limit is reported where it happened instead of being retried on every keystroke.
  let candidates: Candidate[] | null = null;
  const loadCandidates = (): Candidate[] | { readonly failure: string } => {
    if (candidates) return candidates;
    print("  ⏳ Asking GitHub for the org's boards and who is assigned…");
    deps.projects.listBoards(deps.config.githubOrg);
    const failure = deps.projects.lastFailure?.() ?? null;
    if (failure) return { failure };
    candidates = candidateProjects(deps);
    return candidates;
  };

  /** Opening a folder that is already cloned costs nothing; one that is half-made needs `join`, and `join`
   *  needs the BOARD URL (#206) — the one thing only GitHub can supply. */
  const openLocal = async (l: LocalProject): Promise<Picked | null> => {
    if (l.cloned) {
      return { kind: "picked", local: true, project: { boardNumber: l.boardNumber ?? 0, title: l.projectId, url: "", status: "on this machine", projectId: l.projectId } };
    }
    const c = loadCandidates();
    if ("failure" in c) {
      for (const line of githubUnreachableLines(c.failure, localAll.length)) print(line);
      print(`  So '${l.projectId}' cannot be finished right now — its folder has no workspace clone yet.`);
      return null;
    }
    const board = c.find((x) => x.projectId === l.projectId || (l.boardNumber !== null && x.boardNumber === l.boardNumber));
    if (!board) {
      print(`  '${l.projectId}' has a folder here, but no open board on GitHub — nothing to clone into it.`);
      print("  Ask an owner whether that project was closed, or remove the folder.");
      return null;
    }
    return { kind: "picked", local: false, project: board };
  };

  // WHERE YOU ARE IS A STACK, as it is in the menu (`361fe04`): `g`/`s` push a level, `0` pops one, and
  // popping the last one leaves Work. A filter belongs to the level it was typed at and nowhere else.
  const stack: PickerLevel[] = [localAll.length ? "local" : "mine"];
  let query: string | null = null;
  let offset = 0;
  /** `m` past the search-first prompt: "or m to page through them" — the list, on request. */
  let listing = false;
  const fresh = (): void => { query = null; offset = 0; listing = false; };
  const go = (to: PickerLevel): void => { stack.push(to); fresh(); };
  const pop = (): void => { stack.pop(); fresh(); };
  const nothingForYou = (): Done => {
    print(`  No active or startable projects for you${deps.me ? ` (${deps.me})` : ""}.`);
    print("  Ask a project owner to assign you, or create a GitHub Project board for a new one, then retry.");
    return { kind: "done", code: 0 };
  };

  for (;;) {
    const level = stack[stack.length - 1]!;
    // Every arm below assigns all four, and TypeScript enforces it — there is no default worth having: a
    // level that forgot its rows, or its pick action, must not compile into one that quietly offers nothing.
    let rows: PickerRow[];
    /** Row `n` on screen — or, when the prompt led with search and listed nothing, the nth entry of the level. */
    let pickAt: (n: number) => Promise<Picked | null>;
    let view: LevelView;
    let nextOffset: number;

    if (level === "local") {
      const filtered = query === null ? localAll : rankProjects(localAll, query);
      const searchFirst = leadWithSearch(filtered.length, set.searchThreshold, query !== null) && !listing;
      const page = pageOf(filtered, set.pageSize, offset);
      const closed = markClosedOnGitHub(page.items, cachedBoards());
      rows = searchFirst ? [] : page.items.map((l) => localRow(l, nowMs, closed.has(l.projectId)));
      nextOffset = page.nextOffset;
      pickAt = async (n) => {
        const l = filtered[offset + n - 1];
        return l ? await openLocal(l) : null;
      };
      view = {
        level, rows, total: page.total, page: page.page, pages: page.pages,
        more: searchFirst ? page.total > 0 : page.more, query, searchFirst,
        keys: { more: searchFirst ? page.total > 0 : page.more, mine: true, startable: true },
      };
    } else {
      const c = loadCandidates();
      if ("failure" in c) {
        // A THROTTLED OR UNREACHABLE GITHUB IS NOT "NO PROJECTS", AND MUST NOT BE A HANG OR A STACK TRACE.
        // Say which it is, then fall back to the list that needs no calls at all — the folders already here.
        // That fallback IS the feature: the design's motivation was "GitHub may throttle on a large number
        // of requests", and the useful answer to a throttle is the work you already have on disk.
        for (const line of githubUnreachableLines(c.failure, localAll.length)) print(line);
        log("info", "GitHub would not list the org's boards", "gov-work:cli:work-flow", "pickProject",
          { failure: c.failure, rateLimited: isRateLimited(c.failure), localProjects: localAll.length });
        if (!localAll.length) return { kind: "done", code: 1 };
        stack.length = 0; stack.push("local"); fresh();
        continue;
      }
      const mineAll = c.filter((x) => x.mine);
      const unstartedAll = deps.me ? c.filter((x) => !x.anchored) : [];

      if (level === "mine" && !mineAll.length) {
        // Being assigned to nothing is a joiner's ordinary state, not an error. Descend rather than print an
        // empty list and ask for a keystroke with only one sensible value.
        if (!unstartedAll.length) {
          if (!localAll.length) return nothingForYou();
          print(`  Nothing on GitHub is assigned to you${deps.me ? ` (${deps.me})` : ""}, and every open board already has a project.`);
          pop();
          if (!stack.length) return { kind: "done", code: 0 };
          continue;
        }
        print(`  Nothing on GitHub is assigned to you yet${deps.me ? ` (${deps.me})` : ""} — these are the boards you could start.`);
        stack[stack.length - 1] = "startable"; fresh();
        continue;
      }
      if (level === "startable" && !unstartedAll.length) {
        print("  Every open board already has a project — there is nothing to start.");
        pop();
        if (!stack.length) return mineAll.length || localAll.length ? { kind: "done", code: 0 } : nothingForYou();
        continue;
      }

      if (level === "mine") {
        const filtered = query === null ? mineAll : rankProjects(mineAll, query);
        const searchFirst = leadWithSearch(filtered.length, set.searchThreshold, query !== null) && !listing;
        const page = pageOf(filtered, set.pageSize, offset);
        rows = searchFirst ? [] : page.items.map(boardRow);
        nextOffset = page.nextOffset;
        pickAt = async (n) => {
          const p = filtered[offset + n - 1];
          return p ? { kind: "picked", local: false, project: p } : null;
        };
        view = {
          level, rows, total: page.total, page: page.page, pages: page.pages,
          more: searchFirst ? page.total > 0 : page.more, query, searchFirst,
          keys: { more: searchFirst ? page.total > 0 : page.more, startable: unstartedAll.length > 0 },
        };
      } else {
        // YOU COULD START — the one list whose eligibility costs a `gh` call PER BOARD. So the filter runs
        // first (design §3.4: a search must save calls, not just screen space), the check runs only as far as
        // it takes to fill the page (§3.3), and while the prompt is leading with search it does not run at
        // all — paying fifteen calls to render rows nobody has asked for is the cost this level exists to cap.
        const filtered = query === null ? unstartedAll : rankProjects(unstartedAll, query);
        const searchFirst = leadWithSearch(filtered.length, set.searchThreshold, query !== null) && !listing;
        const writable = (b: WorkProject): boolean => deps.canWriteBoard(b.boardNumber);
        const page = searchFirst ? { items: [] as WorkProject[], nextOffset: 0, more: filtered.length > 0, scanned: 0 } : fillPage(filtered, writable, set.pageSize, offset);
        // NOTHING WRITABLE, AND NOTHING LEFT TO SCAN — a level with no rows and no `m` is not a place to
        // stand. It used to be: the old loop printed "(nothing startable on this page)" and asked again, so a
        // person (or a test double) answering the same thing twice was in a loop with no exit but ctrl-C.
        if (!searchFirst && !page.items.length && !page.more && filtered.length > 0) {
          print(`  ${filtered.length === 1 ? "The one board nobody has started is not one" : `None of the ${filtered.length} boards nobody has started are ones`} you can write.`);
          print("  Ask an owner for write access on the board you need (`gov manage`), then retry.");
          pop();
          if (!stack.length) return mineAll.length || localAll.length ? { kind: "done", code: 0 } : nothingForYou();
          continue;
        }
        rows = page.items.map(boardRow);
        nextOffset = page.nextOffset;
        pickAt = async (n) => {
          // The nth board FROM THIS PAGE'S START that gov may write — the same sequence the rows came from,
          // extended by one page's worth when nothing was listed.
          const seq = page.items.length >= n ? page.items : fillPage(filtered, writable, Math.max(n, set.pageSize), offset).items;
          const p = seq[n - 1];
          return p ? { kind: "picked", local: false, project: p } : null;
        };
        // `pages` stays 1 on purpose: gov cannot know how many of these boards it may write without asking,
        // so it prints no page count it would have to guess at. `more` is the honest half of the same fact.
        view = { level, rows, total: filtered.length, page: 1, pages: 1, more: page.more, query, searchFirst, keys: { more: page.more } };
      }
    }

    // THE PAGE, AS THE PERSON SEES IT. Pages of 11, then 1, then 7 were reported from a walk before anybody
    // could say what the flow had done; this is that fact, on the record — now with the level and the filter.
    log("info", "offered a page of projects", "gov-work:cli:work-flow", "pickProject",
      { level, query, shown: rows.length, total: view.total, offset, nextOffset, more: view.more, searchFirst: view.searchFirst });

    for (const line of formatLevel(view)) print(line);
    const answer = resolvePickerInput(await deps.prompt("  Choose: "), view.keys);
    if (answer.kind === "back") {
      pop();
      if (!stack.length) return { kind: "done", code: 0 };
      continue;
    }
    if (answer.kind === "more") { if (view.searchFirst) listing = true; else offset = nextOffset; continue; }
    if (answer.kind === "search") { query = answer.query; offset = 0; listing = false; continue; }
    if (answer.kind === "clear") { fresh(); continue; }
    if (answer.kind === "level") { go(answer.to); continue; }
    if (answer.kind === "pick") {
      const got = await pickAt(answer.n);
      if (!got) { print("  unknown choice"); continue; }
      // A NUMBER ALWAYS SELECTS — including at a level that led with search and listed nothing. What it must
      // not do is commit UNSEEN to an act other people will see: seeding creates branches, an anchor issue and
      // an assignment, and consent given to a row nobody has read is not consent. So an unlisted pick names
      // what it resolved to, and asks when the answer is org-visible.
      if (view.searchFirst) {
        print(`  ${answer.n}) ${got.project.projectId}  (${got.project.status})`);
        if (got.project.status === NOT_STARTED) {
          const yes = (await deps.prompt("  Nobody has started that one — seeding creates branches, an anchor issue and assigns you. Go ahead? (y/N) ")).trim().toLowerCase();
          if (!/^y(es)?$/.test(yes)) { print("  Left alone."); continue; }
        }
      }
      return got;
    }
    print("  unknown choice");
  }
}

export async function runWorkFlow(rawDeps: WorkFlowDeps, opts: WorkFlowOpts = {}): Promise<number> {
  const { deps, cached } = withBoardCache(rawDeps);
  const { print } = deps;
  const set = pickerSettings(opts);
  const interactive = opts.interactive ?? true;
  print("");
  print("  Work — start / continue a project");

  // ── project, by pattern ──────────────────────────────────────────────────────────────────────────
  // Resolved from the board list and the anchors — two calls, no per-board access checks. One match proceeds;
  // several ask (or, with no TTY, list them and stop — a script must not be given a project it did not name);
  // none is an error that shows what WAS available, because "no match" without the candidate list is a dead end.
  let picked: WorkProject | null = null;
  /** Did the pick come from a folder already cloned here? Then nothing org-visible follows — see the write gate. */
  let fromLocal = false;
  // ── the project you are standing in ──────────────────────────────────────────────────────────────
  // The menu promises "Continue the current project" in PROJECT context; the flow used to list every project
  // (a walk, 2026-09-22). Resolved from the board list gov fetches anyway — no extra call. If the board is
  // gone or closed, fall through to the list rather than guess.
  if (!opts.projectPattern && opts.currentProject) {
    const n = boardNumberFromProjectId(opts.currentProject);
    const b = n === null ? undefined : deps.projects.listBoards(deps.config.githubOrg).find((x) => x.number === n && !x.closed);
    if (b) {
      const a = deps.anchor.findAll?.(deps.config.githubOrg, deps.config.workspaceRepo)?.get(b.number)
        ?? deps.anchor.find({ owner: deps.config.githubOrg, ownerField: deps.config.ownerField ?? "organization", number: b.number }, deps.config.workspaceRepo);
      picked = { boardNumber: b.number, title: b.title, url: b.url, status: a ? deriveStatus(true, a.labels) : NOT_STARTED, projectId: opts.currentProject };
      decide("project", opts.currentProject, "the project you are standing in", "gov-work:cli:work-flow", "runWorkFlow", { board: b.number });
      print(`  Continuing ${opts.currentProject} — the project you are in.`);
      print("  (Another one: `gov work --project=<pattern>`, or run gov from outside this project.)");
    } else if (deps.projects.lastFailure?.() && deps.fs.pathExists(path.join(deps.config.agentWorkRoot, opts.currentProject, deps.config.workspaceRepo, ".git"))) {
      // GITHUB WOULD NOT ANSWER, AND THE PROJECT IS RIGHT HERE. Continuing it needs no board — the folder is
      // cloned and the branch is checked out — so a throttle must not push somebody out of the project they
      // are standing in and into a list gov cannot fetch either. This is the design's motivation at its
      // sharpest: the useful answer to "GitHub may throttle" is the work already on the disk.
      const failure = deps.projects.lastFailure()!;
      for (const line of githubUnreachableLines(failure, 1)) print(line);
      picked = { boardNumber: boardNumberFromProjectId(opts.currentProject) ?? 0, title: opts.currentProject, url: "", status: "on this machine", projectId: opts.currentProject };
      fromLocal = true;
      decide("project", opts.currentProject, "standing in it, and GitHub would not answer", "gov-work:cli:work-flow", "runWorkFlow", { rateLimited: isRateLimited(failure) });
      print(`  Continuing ${opts.currentProject} anyway — it is cloned here, so this needs no GitHub call.`);
    }
  }
  if (picked) {
    // resolved above — skip the pattern and the list
  } else if (opts.projectPattern) {
    // EVERY OPEN BOARD IS A CANDIDATE, AND NOT ONE ACCESS CHECK IS PAID TO FIND OUT (design §4).
    //
    // This used to page through `startablePage` to exhaustion, which resolved `canWriteBoard` for every
    // un-anchored board in the org — ~100 calls on the org this design came from — to answer a question about
    // ONE named project. The write gate below asks about the project actually chosen, which is the only board
    // whose answer changes anything.
    const all: WorkProject[] = candidateProjects(deps);
    const failure = deps.projects.lastFailure?.() ?? null;
    if (failure) {
      // A pattern that matched nothing because GitHub said nothing is not "no such project" — the remedy for
      // a rate limit is a minute, and for an empty org it is a board. A local folder the pattern names is
      // still openable with no calls at all, so say so rather than stopping at a wall.
      const localHits = matchProjects(orderLocal(scanLocalProjects(deps.fs, deps.config.agentWorkRoot, deps.config.workspaceRepo), set.localOrder), opts.projectPattern);
      for (const line of githubUnreachableLines(failure, localHits.length)) print(line);
      if (localHits.length === 1 && localHits[0]!.cloned) {
        picked = { boardNumber: localHits[0]!.boardNumber ?? 0, title: localHits[0]!.projectId, url: "", status: "on this machine", projectId: localHits[0]!.projectId };
        fromLocal = true;
        decide("project", picked.projectId, `--project=${opts.projectPattern} matched one folder on this machine while GitHub was unreachable`, "gov-work:cli:work-flow", "runWorkFlow", { rateLimited: isRateLimited(failure) });
        print(`  '${picked.projectId}' is already cloned here, so gov can open it without GitHub.`);
      } else {
        if (localHits.length > 1) print(`  On this machine: ${localHits.map((l) => l.projectId).join(", ")} — name one exactly.`);
        return 1;
      }
    }
    // `picked` is set only when GitHub was unreachable and the pattern named a folder that is here; then there
    // is nothing to match against, and the work goes on with what the disk knows.
    if (!picked) {
      // The id regex first — that is what `--project` has always meant — and the picker's `/text` ranking as a
      // FALLBACK, so the command line can match a board by its title too (design §3.4: one idea of "matches").
      // Only ever additive: an invocation that resolved to one project before still resolves to that one.
      const byId = matchProjects(all, opts.projectPattern);
      const hits = byId.length ? byId : rankProjects(all, opts.projectPattern);
      if (hits.length === 0) {
        print(`  No project matches '${opts.projectPattern}'.`);
        if (all.length) print(`  Available: ${all.slice(0, 10).map((i) => i.projectId).join(", ")}${all.length > 10 ? ", …" : ""}`);
        return 1;
      }
      if (hits.length === 1) { picked = hits[0]!; decide("project", picked.projectId, `--project=${opts.projectPattern} matched one`, "gov-work:cli:work-flow", "runWorkFlow", { candidates: all.length }); }
      else if (!interactive) {
        print(`  '${opts.projectPattern}' matches ${hits.length} projects: ${hits.map((i) => i.projectId).join(", ")}`);
        print("  Narrow the pattern — with no terminal there is nobody to ask.");
        return 2;
      } else {
        print("");
        print(`  '${opts.projectPattern}' matches ${hits.length} projects:`);
        hits.forEach((it, i) => print(`    ${String(i + 1).padStart(2)}) ${it.projectId}  (${it.status})`));
        const sel = (await deps.prompt("  Choose: ")).trim();
        const idx = Number(sel) - 1;
        picked = Number.isInteger(idx) && idx >= 0 && idx < hits.length ? hits[idx]! : null;
        if (!picked) { print("  unknown choice"); return 2; }
      }
    }
  } else if (!interactive) {
    print("  No --project=<pattern>, and no terminal to choose in.");
    print("  Name one:  gov work --project=<regex> --agent=<claude|cursor|cursor-gui|shell>");
    return 2;
  }
  // THE PICKER: on this machine, then yours on GitHub, then what you could start — with `/text` at each
  // level and a number that always selects. Its lists, ranking and arithmetic are `project-picker.ts`'s.
  let p: WorkProject | null = picked;
  if (!p) {
    const chosen = await pickProject(deps, set, cached, Date.now());
    if (chosen.kind === "done") return chosen.code;
    p = chosen.project;
    fromLocal = chosen.local;
  }

  // THE WRITE GATE — asked for every project EXCEPT one that is already cloned on this machine.
  //
  // Write access to the board is the authorization (there is no `project.yaml`), and everything that needs it
  // is org-visible: seeding branches and an anchor issue, joining, and later `gov task`/`gov merge`, each of
  // which checks for itself. Opening a folder that is already here does none of that — it starts an agent in a
  // directory — and the design's §5 promises that path costs ZERO GitHub calls. Spending one here to re-ask a
  // question nothing acts on would break exactly the promise the local list exists to keep.
  if (!fromLocal && !deps.canWriteBoard(p.boardNumber)) {
    print(`  You don't have write access to '${p.title}' (its GitHub Project board).`);
    print("  Ask an owner to grant access (`gov manage`), then retry.");
    return 1;
  }
  // SKIPPED IS NOT THE SAME AS PASSED, and the difference has to be visible (2026-09-28). The zero-call promise
  // above is worth keeping, but authorization IS board write access (gov-behaviour.md §4) and an access that was revoked
  // since the clone would go unnoticed here. What catches it is the agent's own session-start check (GOV-FRM-114) —
  // which is agentic, so it persuades rather than proves. Saying so costs nothing, tells the developer which
  // check is actually standing between them and unauthorized work, and stops a silent skip reading as a pass.
  if (fromLocal) {
    print("  (opened from this machine — gov did not re-check your board access; your agent verifies it at session start)");
  }

  const projectDir = path.join(deps.config.agentWorkRoot, p.projectId);   // <project> — all repos live under it
  const state = workspaceState(deps, p);

  // `--print-prompt` is the scripting escape: emit the kickoff prompt, change nothing. A project that is not
  // on this machine has no directory to run an agent in, so printing a prompt for it would be a lie.
  if (opts.printPromptOnly) {
    if (state !== "ready") {
      print(`  '${p.projectId}' is not ready on this machine (${state}).`);
      print(`  Set it up first:  gov work --project=${p.projectId}`);
      return 1;
    }
    deps.printPrompt?.(sessionStartPrompt(p.projectId, deps.config.workspaceRepo, deps.config.govHome));
    return 0;
  }

  if (state === "not-seeded") {
    // SEEDING IS ORG-VISIBLE — branches in every repo, an anchor issue, an assignment. Choosing a
    // `(not started)` entry from the menu IS consent; a regex that happened to match one is not. So a
    // pattern-selected project asks first, and with no terminal it refuses and names the flag.
    if (opts.projectPattern && !opts.seedOk) {
      const msg = `  '${p.projectId}' has not been started by anyone yet — seeding creates branches, an anchor issue and assigns you.`;
      if (!interactive) {
        print(msg);
        print(`  Authorise it explicitly:  gov work --project=${opts.projectPattern} --seed`);
        return 1;
      }
      print(msg);
      const yes = (await deps.prompt("  Start it now? (y/N) ")).trim().toLowerCase();
      if (!/^y(es)?$/.test(yes)) { print("  Left alone."); return 0; }
    }
    print(`  Initializing '${p.title}' (seed → branch → clone)…`);
    let code = await deps.run(["seed", p.url, ...(deps.me ? [deps.me] : [])]);

    // THE FORK QUESTION BELONGS HERE (#194), not inside seed's failure path.
    //
    // It was asked there, on /dev/tty, and the answer arrived before anyone could
    // type: this flow's readline already owns the terminal, so a second reader gets
    // an immediate empty read — which was taken for "yes" and recorded a mapping
    // nobody had agreed to. Twice. The terminal has one owner, and in this flow it
    // is `deps.prompt`; so the question is asked with it.
    const pending = deps.pendingRepoOverrides?.() ?? [];
    if (code !== 0 && pending.length && deps.applyRepoOverrides) {
      print("");
      print("  gov found a fork of that repository under your organization:");
      for (const o of pending) print(`    ${o.from}  →  ${o.to}`);
      print("");
      print("  Recording this in org-config.yaml means the branch, the pushes and the merges");
      print("  happen in your repo, while the board goes on linking theirs.");
      // Explicit yes. Anything else — including an answer we could not read — leaves
      // the file alone, because recording it silently is the failure this replaces.
      const yes = (await deps.prompt("  Record it and try again? (y/N) ")).trim().toLowerCase();
      if (/^y(es)?$/.test(yes)) {
        if (deps.applyRepoOverrides(pending)) {
          print("  Recorded. Trying again…");
          code = await deps.run(["seed", p.url, ...(deps.me ? [deps.me] : [])]);
        } else {
          print("  Could not write org-config.yaml — add the mapping by hand and run this again.");
        }
      } else {
        print("  Left alone. Add it to org-config.yaml yourself when you are ready.");
      }
    }
    if (code !== 0) return code;
  } else if (state === "not-cloned") {
    // THE BOARD URL, NOT THE ID (#206). `join` opens with `parseBoardUrl`, so an id got as far
    // as "Not a GitHub Project URL: PRJ-5-…" and no further. The seed call above always passed
    // `p.url`; this one did not, and the arm was near-unreachable until #198 sent every fresh
    // machine through it.
    print(`  Cloning your workspace for '${p.projectId}'…`);
    const code = await deps.run(["join", p.url]);
    if (code !== 0) return code;
  }

  // So an agent launched at <project> — OR inside any of its code-repo clones — runs session-start.
  // The warnings are printed, not discarded: a source gov could not read means a stale file an agent is
  // about to be governed by, and the only thing missing from that failure was somebody being told (PRJ-121).
  const mirror = ensureRootProtocol(deps.fs, projectDir, deps.config.workspaceRepo);
  for (const line of mirrorWarnings(mirror)) print(line);
  // …and the governing files it must read, copied from the default branch into the project (PRJ-121).
  const snap = deps.snapshotGovernance?.(projectDir) ?? null;
  const kickoff = (): string => sessionStartPrompt(p.projectId, deps.config.workspaceRepo, deps.config.govHome, snap);
  print("");
  print(`  ✓ '${p.projectId}' is ready at:  ${projectDir}`);

  // ── an organization that runs no AI agents ───────────────────────────────────────────────────
  //
  // STRUCTURE-ONLY IS A COMPLETE WAY TO USE gov (Policy Owner, 2026-09-28). Everything above this
  // line is the fixed process — the board, the branches, the clone, the project directory — and it
  // is finished. What follows is entirely agentic, and for an org that recorded
  // `authorized_agents: none` it was the menu's dead primary action: `approvedAgents()` returned an
  // empty list, `approvedAgents([])` read that as "has not decided", and gov offered the whole
  // framework catalogue to install. The org had decided; gov argued with the decision.
  //
  // EXPLAIN, DO NOT JUST SKIP. Silence here is indistinguishable from gov being broken, so the
  // decision, the file it lives in and the command that reverses it are all named — and then the
  // project is opened in a shell, which is the whole point of the fixed process.
  const authorized = deps.approvedAgents?.() ?? null;
  if (authorized !== null && authorized.length === 0) {
    print("");
    for (const line of structureOnlyLines()) print(line);
    // AN EXPLICIT `--agent` IS REFUSED, NOT QUIETLY TURNED INTO A SHELL. Substituting one and
    // reporting success is the fallback-indistinguishable-from-success shape this flow keeps
    // removing (#199); a script that asked for an agent must hear that it cannot have one.
    if (opts.agent && opts.agent !== "shell") {
      print("");
      print(`  So \`--agent=${opts.agent}\` cannot be honoured here.`);
      print(`  Use \`--agent=shell\` to work in the project, or run \`${TURN_AGENTS_ON}\` first.`);
      return 2;
    }
    print("");
    print(`  Opening a shell in ${projectDir}. Type 'exit' to come back.`);
    return await deps.launch("shell", projectDir, kickoff());
  }

  let agent: AgentKind | null = opts.agent ?? null;
  if (!agent && !interactive) {
    print("  No --agent=<claude|cursor|cursor-gui|shell>, and no terminal to choose in.");
    print(`  The project is ready at ${projectDir} — name an agent, or use --print-prompt to drive your own.`);
    return 2;
  }
  if (!agent) {
    // OFFER WHAT EXISTS, AND ONLY WHAT IS APPROVED (#195/#196). The old menu was four
    // fixed lines — offered whole to a machine with none of them installed, and led
    // by a tool the policy this same install had just seeded lists as prohibited.
    const statuses = agentStatuses(AGENT_CATALOG, deps.hasTool ?? (() => false), deps.env ?? {});
    const approvedList = deps.approvedAgents?.() ?? null;
    const approved = approvedAgents(approvedList ? approvedList.map((a) => a.id) : null);
    const offer = [...offerable(statuses, approved.ids)];
    if (approved.ids.includes("cursor") && (deps.hasTool?.("cursor") ?? false)) {
      offer.push({ candidate: CURSOR_GUI, installed: true, credentialPresent: null });
    }

    if (!offer.length) {
      // NOTHING INSTALLED IS THE JOINER'S ORDINARY CASE, not an edge one — a new
      // machine, a new person, a container. The adopter already chose a default for
      // exactly this moment (#196, Q3), so the useful thing is to OFFER it rather
      // than print a list and step aside. Printing a list was the old behaviour and
      // it left the person who most needs help holding a command to retype.
      const def = defaultAgent(approvedList);
      const defName = def ? AGENT_CATALOG.find((a) => a.id === def)?.tool ?? def : null;

      // EVERY APPROVED AGENT IS A REAL CHOICE, THE DEFAULT PRE-SELECTED (PRJ-121, 2026-09-22).
      //
      // This used to offer the default alone — `Install IBM Bob now? (Y/n)` — and answering `n` printed the
      // other approved agents as commands to run elsewhere, then opened a shell: the very "list to retype" the
      // Y/n was introduced to replace. An org approving three agents gave a joiner one. The Policy Owner, on a
      // walk: "I was expecting to see a choice of approved agents rather than forced to use just the default."
      //
      // `installAgent` already installs ANY approved agent (the same plan as `gov agent install`, checked
      // against the policy), so this is only the offer. Enter — and a reflexive `y` — still mean the default,
      // so #196's one-keypress intent stands; `n` still means none.
      //
      // Only for an org that has APPROVED agents. With none approved the list is the framework's fallback,
      // and gov does not install on an organization's behalf what the organization never chose.
      const choices = deps.installAgent && !approved.usingDefaults
        ? [...installable(statuses, approved.ids)].sort((a, b) => Number(b.candidate.id === def) - Number(a.candidate.id === def))
        : [];
      if (choices.length && deps.installAgent) {
        const hasDefault = choices[0]!.candidate.id === def;
        const none = choices.length + 1;
        print("");
        print(`  No AI agent is installed here yet.${hasDefault && defName ? ` Your organization's default is ${defName}.` : ""}`);
        print("");
        print("  Which would you like to install?");
        choices.forEach((s, i) => print(`     ${i + 1}) ${s.candidate.tool}${s.candidate.id === def ? "  — your organization's default" : ""}`));
        print(`     ${none}) none — open a shell here`);
        print("");
        const ask = `  ${paint("Install which?", "bold", deps.color ?? false)} ${hasDefault ? "[1] " : `[1-${none}] `}`;
        let n = NaN;
        for (let tries = 0; tries < 3 && !(n >= 1 && n <= none); tries++) {
          const a = (await deps.prompt(tries ? `  Choose a number from 1 to ${none}: ` : ask)).trim().toLowerCase();
          n = a === "" || /^y(es)?$/.test(a) ? (hasDefault ? 1 : NaN) : /^n(o)?$/.test(a) ? none : Number(a);
        }
        const pick = n >= 1 && n < none ? choices[n - 1]!.candidate : null;
        if (pick) {
          if (await deps.installAgent(pick.id, deps.ask)) {
            // THE ID IS THE LAUNCH INSTRUCTION (#199). This used to map anything but Claude Code
            // and Cursor to "shell", so an org whose default was Bob, codex, gemini, copilot or
            // aider was told its agent had started and handed a shell prompt.
            print(`  ✓ ${pick.tool} is ready. Starting it in ${projectDir}…`);
            return await deps.launch(pick.id, projectDir, kickoff());
          }
          // INSTALLED IS NOT READY (#200). `installAgent` now answers "can it run", so an agent
          // waiting on a key stops here instead of being announced as started. The project is made
          // and the shell is a real place to work from; the claim is what had to go.
          print(`  ${pick.tool} is not ready yet — the lines above say what it still needs.`);
          print(`  The project is ready at ${projectDir}.`);
          print("");
          print(`  Opening a shell there. Type 'exit' to come back.`);
          return await deps.launch("shell", projectDir, kickoff());
        }
        // None chosen (or no valid answer in three tries): a shell, with the choice still open for later.
        print(`  No agent installed. Any of them is one command away:  gov agent install <${choices.map((s) => s.candidate.id).join(" | ")}>`);
        print(`  Opening a shell in ${projectDir}. Type 'exit' to come back.`);
        return await deps.launch("shell", projectDir, kickoff());
      }

      for (const line of nothingInstalledLines(installable(statuses, approved.ids), approved.usingDefaults)) print(line);
      print("");
      print(`  Opening a shell in ${projectDir}. Type 'exit' to come back.`);
      return await deps.launch("shell", projectDir, kickoff());
    }

    // ORG DEFAULT → USER PREFERENCE → ASK (#196, Q9). Three layers already existed;
    // the mistake would be inventing a fourth memory. Asked only when neither the
    // organization nor the person has an answer, which for most people is once.
    const decided = chooseAgent(approvedList, deps.agentPreference?.() ?? null, offer.map((o) => o.candidate.id));
    decide("agent", decided.id, decided.source, "gov-work:cli:work-flow", "runWorkFlow",
      { offered: offer.map((o) => o.candidate.id), ...(decided.ignoredPreference ? { ignoredPreference: decided.ignoredPreference } : {}) });
    for (const line of choiceExplanation(decided, (id) => AGENT_CATALOG.find((a) => a.id === id)?.tool ?? id)) print(line);

    if (decided.id) {
      const picked = offer.find((o) => o.candidate.id === decided.id)?.candidate;
      // Object identity, not id: CURSOR_GUI shares the id "cursor" with the CLI entry — one approval,
      // two ways to run it (#196, Q8) — so only the instance says which was offered.
      if (picked) agent = picked === CURSOR_GUI ? "cursor-gui" : picked.id;
    }

    if (!agent) {
      print("  Start an agent in it now?");
      for (const line of menuLines(offer)) print(line);
      const choice = (await deps.prompt("  Choose: ")).trim();
      const n = Number(choice);
      if (n >= 1 && n <= offer.length) {
        const picked = offer[n - 1]!.candidate;
        agent = picked === CURSOR_GUI ? "cursor-gui" : picked.id;
      } else if (n === offer.length + 1) {
        agent = "shell";
      } else {
        agent = null;
      }
    }
  }
  if (!agent) { print(`  Later:  cd "${projectDir}" && claude "<session-start>"      # or your agent`); return 0; }
  print(`  Launching ${agent === "cursor-gui" ? "Cursor (GUI)" : agent} in ${projectDir}…`);
  return await deps.launch(agent, projectDir, kickoff());
}
