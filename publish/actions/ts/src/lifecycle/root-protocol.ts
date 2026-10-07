// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Make an agent launched at the PROJECT ROOT (`<project>`, the dir that holds the gov workspace + all code
 * repos) run the session-start protocol. The harness is rendered into the workspace repo; this mirrors it to
 * the root so every agent picks it up from its own conventional path. Used by BOTH `seed` (every seeded
 * project gets it) and the interactive Work flow (before launching an agent).
 *
 * ONE MECHANISM FOR ALL AGENTS — copy the rendered file to the path that agent reads. No vendor has a
 * mechanism another lacks; see the ruling recorded at the removed Claude branches below.
 * Leaf module (Fs + the pure org-config reader) — no cli/lifecycle cycle.
 */
import path from "node:path";
import type { Fs } from "./fs-io.js";
import type { GitRead } from "../cli/policy-gate-io.js";
import { isStructureOnly } from "../config/approved-agents.js";
import { GOVERNANCE_PATH } from "../config/governance.js";

/**
 * Every agent's own path, mirrored into the project — ALL of them.
 *
 * This list had four entries, so `gemini`, `github-copilot` and `continue` were rendered into
 * the workspace and then placed nowhere the agent looks. Three of nine approved agents had
 * NOTHING in context, which the guarantee "the governance requirements are in the agent's
 * context" cannot survive. They were missing because the list was written when those three were
 * not yet in the catalog, and nothing tied the two together.
 *
 * DERIVED WOULD BE BETTER THAN LISTED. The paths are already declared per harness in
 * `agent/harness-manifest.yaml`; this is a second copy, and a second copy is what drifted.
 * Reading the manifest at runtime would need it shipped and parsed, so the list stays for now —
 * with a test asserting it covers every active harness, which is the part that was absent.
 */
/** Where the canonical copies live inside the governance repo (Decision 2, 2026-09-14). */
export const HARNESS_SRC_DIR = path.join("agent", "harness");

export const ROOT_HARNESS_FILES = [
  "AGENTS.md",                          // openai-codex, ibm-bob
  "CLAUDE.md",                          // claude-code — rendered text now, not an @-import
  "CONVENTIONS.md",                     // aider
  ".clinerules/agent.md",               // cline — a DIRECTORY of rules; the file is what renders
  ".cursor/rules/agent.mdc",            // cursor
  "GEMINI.md",                          // gemini-code-assist — NOT .gemini/styleguide.md
  ".github/copilot-instructions.md",    // github-copilot
  ".continue/rules/agent.md",           // continue — a DIRECTORY the CLI scans, not a file
  ".windsurf/rules/agent.md",           // windsurf
] as const;

/**
 * WHERE A CODE REPO'S CLONE LIVES, read from disk rather than from the board (PRJ-121, defect 2).
 *
 * `seed`, `join` and `add-repo` all materialize a code repo at exactly `<projectWorkRoot>/<repoNameFromUrl(url)>`
 * and nowhere else, and `add-repo` states the model out loud: "there is no project.yaml repos[] to update —
 * membership is the board's linked items + the local worktree". So the worktrees ARE the local membership record,
 * and `cleanup.ts::dirtyReposUnder` already reads it exactly this way: every entry directly under the root that
 * has a `.git`, with the workspace repo told apart by name.
 *
 * NOT `board.fetchProject(ref).repoUrls`, which is how `close`/`merge`/`sync` reach the same directories. Those
 * commands already hold a `BoardRef`, an authorization and a network budget. This function runs on EVERY agent
 * launch from three call sites and is deliberately a leaf. Asking the board here would also be wrong in the one
 * direction that matters: a clone sitting on disk that the board no longer links is still a directory somebody
 * opens in an IDE, and it still has to be governed. The board decides what gets CLONED; the clones decide what
 * gets GOVERNED.
 */
export function codeRepoDirs(
  fs: Pick<Fs, "readdir" | "pathExists">,
  projectDir: string,
  workspaceRepo: string,
): readonly string[] {
  return fs.readdir(projectDir)
    .filter((name) => name !== workspaceRepo)
    .map((name) => path.join(projectDir, name))
    .filter((dir) => fs.pathExists(path.join(dir, ".git")))
    .sort();
}

/**
 * GOV'S BLOCK INSIDE A FILE THAT MAY BE THE TEAM'S (PRJ-121, defect 2).
 *
 * A code repo's `CLAUDE.md` or `AGENTS.md` is very often already there and already theirs — build notes, house
 * style, a test recipe. Overwriting it to install the protocol would delete content gov has no standing to delete
 * (the same GOV-FRM-086 reasoning that stops `verifyAgentContext` refusing a file gov did not render); writing nothing
 * leaves the repo ungoverned, which is the defect. So gov owns a FENCED REGION and nothing else: replaced on every
 * launch, every byte outside it carried over.
 *
 * The team's text lands below `<!-- ADOPTER_C03_EXTENSIONS -->`, the marker `agent/harness-manifest.yaml` already
 * defines for this ("add org-specific lines below; do not contradict protocol above"), so the layering a reader
 * sees in the file is the layering the protocol claims — rather than a second convention invented here.
 */
export const GOV_BLOCK_BEGIN = "<!-- BEGIN gov session-start protocol — generated every launch; edit the governance repo, not this block -->";
export const GOV_BLOCK_END = "<!-- END gov session-start protocol -->";
/** The manifest's `adopter_marker`. Everything below it in a code repo's file is the team's. */
export const ADOPTER_MARKER = "<!-- ADOPTER_C03_EXTENSIONS -->";

/**
 * Harness paths gov writes VERBATIM even inside a team's repository — no fence, whole file.
 *
 * TWO REASONS, EITHER OF WHICH IS SUFFICIENT.
 *
 *  1. FRONT MATTER MUST BE LINE 1. `.cursor/rules/agent.mdc` opens with the YAML block that carries
 *     `alwaysApply: true`, which is the only thing that makes Cursor inject the rule on every turn. An HTML
 *     comment above it is no longer front matter, so the file parses as an advisory rule and Cursor stops
 *     loading it — a governed project, a file full of protocol, and nothing in context. That is this module's
 *     signature failure, and fencing would have manufactured a fresh instance of it.
 *  2. THERE IS NOTHING TO COEXIST WITH. These four live in directories the vendor SCANS — `.clinerules/`,
 *     `.cursor/rules/`, `.continue/rules/`, `.windsurf/rules/` — so gov's `agent.md` is one rule file beside
 *     the team's own, never a file it has to share. Coexistence is only a question for the single fixed
 *     filenames: `CLAUDE.md`, `AGENTS.md`, `CONVENTIONS.md`, `GEMINI.md`, `.github/copilot-instructions.md`.
 *
 * A second hand-kept list is exactly what drifted before, so a test asserts every entry here is a real harness
 * path and that nothing carrying front matter is ever fenced.
 */
const WHOLE_FILE_IN_A_CODE_REPO: readonly string[] = [
  ".clinerules/agent.md",
  ".cursor/rules/agent.mdc",
  ".continue/rules/agent.md",
  ".windsurf/rules/agent.md",
];

/** Does gov own the whole of this file even in a team's repo, or only a fence inside it? */
export const ownsWholeFile = (rel: string): boolean => WHOLE_FILE_IN_A_CODE_REPO.includes(rel);

/**
 * The file a code repo should hold, given gov's rendered body and whatever is there now. PURE — no disk, because
 * the coexistence rule is exactly one thing worth testing on its own: a string transform that must be IDEMPOTENT.
 * It runs on every launch, and a rule that grew the file each time would be its own silent defect.
 */
export function composeTeamFile(body: string, existing: string | null): string {
  const block = `${GOV_BLOCK_BEGIN}\n${body.replace(/\n+$/, "")}\n${GOV_BLOCK_END}\n`;
  if (existing == null || existing.trim() === "") return block;
  const begin = existing.indexOf(GOV_BLOCK_BEGIN);
  const end = existing.indexOf(GOV_BLOCK_END);
  // Refresh in place. Anything the team wrote above or below the fence is carried over byte for byte.
  if (begin !== -1 && end > begin) {
    return existing.slice(0, begin) + block.replace(/\n$/, "") + existing.slice(end + GOV_BLOCK_END.length);
  }
  // First contact: gov above, the marker, then their file. The newline placement is chosen so that feeding this
  // output back in takes the branch above and returns it unchanged — asserted by test, not by inspection.
  return `${block}\n${ADOPTER_MARKER}\n\n${existing.replace(/^\n+/, "")}`;
}

/** The fence gov keeps in a repo's local exclude list — same replace-in-place rule as {@link composeTeamFile}. */



/** What a destination holds while gov could not refresh it — the discriminator for the warning's wording. */
export type StaleHolds =
  | "the retired two-line @-import stub"
  | "a render from an earlier framework version"
  | "gov's fenced block, now frozen"
  | "content gov did not write";

/** One harness path gov could not mirror, and what is sitting at the destination instead. */
export interface SkippedHarness {
  /** The harness path, relative to the directory mirrored into. */
  readonly rel: string;
  /** The rendered file gov looked for and did not find. */
  readonly source: string;
  /** The destination gov would have written. */
  readonly at: string;
  /** Set only when something gov would have replaced is sitting at `at` — stale by definition. */
  readonly stale: StaleHolds | null;
}

/** What the mirror did — so a caller can say "nine files" or "nothing, and here is why". */
export interface MirrorResult {
  /** The org runs no AI agents (`authorized_agents: none`): nothing was mirrored, by decision. */
  readonly structureOnly: boolean;
  /** The paths, relative to the project dir, gov is responsible for at every target. */
  readonly placed: readonly string[];
  /**
   * How many files this call actually CHANGED. Zero is the normal case on a second launch, and saying so is what
   * lets a caller report "already current" instead of implying work that did not happen.
   */
  readonly written: number;
  /**
   * Every directory the harness was mirrored into: the project root first, then each code-repo clone.
   * Reported because "governed" is a claim about a directory, and until now only one of them was true.
   */
  readonly targets: readonly string[];
  /**
   * A SKIPPED SOURCE IS NEVER SILENT ANY MORE (PRJ-121, defect 1). `continue` on a missing source is what let a
   * real project's root `CLAUDE.md` stay the retired two-line `@`-import stub while `AGENTS.md` beside it carried
   * the full protocol — Claude running on the mechanism retired on 2026-09-11, with nothing to read it, and every
   * test green. Reported per path, with what is sitting there instead.
   */
  readonly skipped: readonly SkippedHarness[];
  /**
   * Why gov could not read the harness at the default branch at all — the ref did not resolve, or git did not
   * answer. Null when it could. A NOTED ABSENCE (GOV-FRM-456): every file is then in `skipped`, and nothing is
   * read from the project-branch worktree in its place.
   */
  readonly unreadable?: string | null;
}

/**
 * Where the harness is read from: the governance repo's DEFAULT branch, through the project's own worktree of it
 * (GOV-FRM-456). `git` is `git -C <repo> <args>` → stdout, or null when git could not answer.
 */
export interface HarnessSource {
  readonly git: GitRead;
  readonly defaultBranch: string;
}

/** How a surviving destination should be described. Pure; reuses the shapes `verifyAgentContext` already knows. */
function classifyStale(text: string): StaleHolds {
  if (IMPORT_STUB.test(text)) return "the retired two-line @-import stub";
  if (text.includes(GOV_BLOCK_BEGIN)) return "gov's fenced block, now frozen";
  if (text.includes(RENDERED_BANNER) || text.includes(PROTOCOL_MARKER)) return "a render from an earlier framework version";
  return "content gov did not write";
}

/**
 * The warnings a caller must print, in the order a reader needs them. PURE — separated from the mirroring so the
 * wording is testable without a filesystem, and so no call site can "handle" the report by dropping it.
 *
 * A WARNING, NOT A REFUSAL, and the reason is already written down two functions below: `verifyAgentContext`
 * deliberately permits the old `@`-import stub, because for an organization that adopted before the version
 * marker existed it IS valid ratified governance. Refusing here would block exactly those working adopters —
 * the trap that check fell into twice, where every historical shape nobody anticipated bricked every launch.
 * What was actually missing was not a gate but a SENTENCE: the un-upgraded workspace, the path it could not be
 * read from, and the stale file it left behind, said out loud where somebody will see it.
 */
export function mirrorWarnings(result: MirrorResult): readonly string[] {
  if (result.structureOnly || !result.skipped.length) return [];
  const lines = result.unreadable
    ? [
      `  ! ${result.skipped.length} harness file(s) could not be refreshed — ${result.unreadable}.`,
      "    The harness is read only from the default branch, never from this project's branch (GOV-FRM-456);",
      "    fetch it (`git fetch`) or run `gov sync`, then start again.",
    ]
    : [
      `  ! ${result.skipped.length} harness file(s) could not be refreshed — the default branch has no rendered copy of them.`,
      "    Run `gov upgrade` (or `gov rules build` in the governance repo) to render them.",
    ];
  // The stale ones first: an absent source is an un-upgraded workspace, but an absent source WITH a file at the
  // destination is an agent reading something gov can no longer vouch for, which is the one worth the eye.
  for (const s of result.skipped.filter((x) => x.stale !== null)) {
    lines.push(`    STALE  ${s.at}`);
    lines.push(`           holds ${s.stale!}; gov wanted to replace it from ${s.source}`);
  }
  // STALE FILES ARE NAMED INDIVIDUALLY; ABSENT ONES ARE COUNTED. An un-upgraded workspace has no rendered
  // harness at all, so listing nine identical "no source" lines turns `gov sync`'s ordinary output into twelve
  // lines of noise — and a warning that long is one nobody reads, which defeats the point of having stopped
  // being silent. The stale case is different and stays per-file: something IS at that path and gov can no
  // longer vouch for it.
  const absent = result.skipped.filter((x) => x.stale === null);
  if (absent.length) {
    lines.push(`    ${absent.length} absent: ${absent.slice(0, 2).map((s) => s.at.split("/").pop()).join(", ")}`
      + `${absent.length > 2 ? `, and ${absent.length - 2} more` : ""} — no rendered source at the default branch.`);
  }
  return lines;
}

/**
 * NO EXCLUDE LIST, BY RULING (Policy Owner, 2026-09-28). `composeExclude` and `gitInfoExcludeFile` lived here and
 * fenced gov's nine files into each clone's `.git/info/exclude`. They are gone because the commit that tracks
 * these files belongs to ordinary project work, and a file hidden from `git status` can never be in it.
 *
 * If that is ever reversed, the hard part was not the fencing: a gov code repo is a WORKTREE, so `<repo>/.git` is
 * a FILE holding `gitdir: …/worktrees/<name>`, and git reads `info/exclude` from the common dir named in that
 * worktree's `commondir` — following only the `gitdir:` line writes a file git never reads, while the code claims
 * to have hidden something.
 */

/**
 * NOTHING TO MIRROR FOR AN ORGANIZATION THAT RUNS NO AGENTS (Policy Owner, 2026-09-28).
 *
 * This is where structure-only is most visible and was worst: an org that never approved an agent
 * still got CLAUDE.md, GEMINI.md, AGENTS.md, CONVENTIONS.md, .cursor/, .clinerules/, .continue/,
 * .windsurf/ and .github/copilot-instructions.md dropped into every project directory, with no
 * explanation and nothing to explain — nine vendor files for nine tools they had told gov they do
 * not use. The guarantee these files exist for is "an agent gov launches has the governance in
 * its context"; where gov launches no agent there is no guarantee to keep, only clutter.
 *
 * READ FROM THE WORKSPACE CLONE, not from a parameter. Three call sites mirror — `seed`, the Work
 * flow and `sync` — and one of them is in a module this change may not touch. A parameter would
 * therefore have been honoured on two paths out of three, which is worse than not having it: the
 * one that forgot would keep writing the nine files and nothing would say so. The answer is in
 * `<project>/<workspace-repo>/policies/governance.yaml`, which is the same clone the harness is read from,
 * so every caller gets the same behaviour for free.
 *
 * ABSENT OR UNANSWERED CONFIG MIRRORS AS BEFORE. `isStructureOnly` is false unless the org
 * explicitly recorded `none`, so a missing file, a stale clone or a setup mid-flight all keep the
 * behaviour they had. Only a decision turns the mirror off.
 */
export function ensureRootProtocol(fs: Fs, projectDir: string, workspaceRepo: string, source: HarnessSource): MirrorResult {
  const ws = workspaceRepo;
  if (isStructureOnly(fs.readFile(path.join(projectDir, ws, GOVERNANCE_PATH)))) {
    return { structureOnly: true, placed: [], targets: [], skipped: [], written: 0, unreadable: null };
  }
  // FROM THE DEFAULT BRANCH, NEVER THE PROJECT BRANCH (GOV-FRM-456). The worktree at `<project>/<ws>` is on the
  // project branch, and a harness file edited there is a proposal (GOV-FRM-086) — mirroring it would let a branch
  // rewrite the rules its own agent is launched under. The worktree and gov_repo are one repository, so
  // `git show <default>:agent/harness/<rel>` reads the ratified copy from inside the project, the same mechanism
  // the governance snapshot and policy-gate-io.ts use. Git that cannot answer is a noted absence (`unreadable`),
  // never a quiet read of the worktree instead.
  const harness = readHarnessAtDefault(source, path.join(projectDir, ws));
  // CLAUDE.md IS NO LONGER SPECIAL (Policy Owner, 2026-09-11). It used to be written here as
  // two @-imports, and only when absent — so a damaged copy was never repaired, and a broken
  // workspace path gave Claude an empty context with no error. It is now mirrored verbatim with
  // every other agent's file, below, and refreshed on every launch like the rest.
  // THE CLAUDE-ONLY SessionStart HOOK IS GONE (Policy Owner, 2026-09-11).
  //
  // It worked, and that was the problem. A mechanism only one vendor has made that vendor
  // better-governed than the rest, which biases the agent choice at Q12 for a reason that has
  // nothing to do with the agent. Consistency was ruled to matter more than the marginal
  // capability, and the guarantee no longer needs it: the protocol is placed in every agent's
  // own file and handed to eight of ten as their first message, so the hook added nothing
  // except the appearance that Claude was the governed choice.
  //
  // A user's OWN .claude/settings.json is untouched — this only stops gov writing one.
  //
  // Mirror each self-contained rendered file to the project root, refreshed every call so it can never go
  // stale against the workspace. Files not rendered for this workspace are skipped.
  // SOURCE MOVED, DESTINATION DID NOT (Decision 2, 2026-09-14). The canonical copies now live
  // at `<repo>/agent/harness/<rel>`, because 13 of the governance repo's 19 top-level entries
  // were harness paths in a repo whose purpose is curation and knowledge. The DESTINATION is
  // still `<project>/<rel>`: those paths are vendor conventions, not gov's choice, and the
  // project directory is the agent's cwd because code repos are its siblings.
  //
  // AND INTO EVERY CLONED CODE REPO, NOT ONLY THE PROJECT ROOT (PRJ-121, defect 2).
  //
  // The project root was enough only for a vendor that walks UP the directory tree looking for its instructions
  // file. Claude Code does; Cursor, Cline, Continue and Bob read the workspace root they were opened at. A
  // developer who opens `<project>/910-GOV-CICD/` in their IDE — the ordinary way to work on one repo — was
  // therefore governed by accident of vendor, on one vendor out of nine, and nothing anywhere said which.
  const clones = codeRepoDirs(fs, projectDir, workspaceRepo);
  const targets = [projectDir, ...clones];
  const placed: string[] = [];
  let written = 0;
  const skipped: SkippedHarness[] = [];
  for (const rel of ROOT_HARNESS_FILES) {
    const from = harness.from(rel);
    const src = harness.read(rel);
    if (src == null) {
      // A SKIPPED SOURCE IS REPORTED, and a destination gov would have overwritten but could not is reported as
      // STALE. The bare `continue` that used to be here is defect 1: an un-upgraded workspace mirrored nothing
      // and whatever was already at the destination SURVIVED, which is how a project ended up running Claude on
      // the `@`-import stub retired on 2026-09-11 with a full 118-line `AGENTS.md` sitting beside it.
      //
      // Still not a refusal — see `mirrorWarnings` for why that would brick the adopters this is meant to help.
      for (const dir of targets) {
        const at = path.join(dir, rel);
        const held = fs.readFile(at);
        // At the project root gov would have overwritten the whole file, so anything there is stale. In a code
        // repo gov only owns its fence, so only a frozen fence is stale — the team's own file is not gov's to
        // call stale, and saying so would train people to ignore the warning.
        const wouldHaveReplaced = held !== null && held.trim() !== ""
          && (dir === projectDir || ownsWholeFile(rel) || held.includes(GOV_BLOCK_BEGIN));
        skipped.push({ rel, source: from, at, stale: wouldHaveReplaced ? classifyStale(held) : null });
      }
      continue;
    }
    for (const dir of targets) {
      const dst = path.join(dir, rel);
      if (rel.includes("/")) fs.mkdirp(path.dirname(dst));
      // VERBATIM AT THE PROJECT ROOT, AND FENCED IN A CODE REPO — except for the four paths gov owns outright
      // even there. The project directory is gov's own: gov created it, nothing else writes there, and the whole
      // file byte for byte is what `verifyAgentContext` and `gov upgrade` both assume. A code repo belongs to
      // its team, so a file the team may already own gets a fence. See {@link composeTeamFile} and
      // {@link ownsWholeFile}.
      const whole = dir === projectDir || ownsWholeFile(rel);
      const existing = fs.readFile(dst);
      const wanted = whole ? src : composeTeamFile(src, existing);
      // WRITE ONLY WHEN THE BYTES CHANGE (PRJ-121, 2026-09-28).
      //
      // This ran on every agent launch and wrote unconditionally: nine files into the project root and nine into
      // every cloned code repo, so a three-repo project rewrote thirty-six identical files each time somebody
      // started an agent. Git never noticed, because the content is idempotent — but mtime did, and mtime is what
      // file watchers, IDE reload prompts and every timestamp-based rebuild key on. The Fs port also logs each
      // write, so a launch left thirty-six "wrote a file" lines that meant nothing happened.
      //
      // Comparing first makes the honest claim true: these files are written once and refreshed when the
      // framework's or the organization's policy changes. It also makes TRACKING them reasonable for a team that
      // wants to — a diff then appears exactly when governance changed, which is a diff worth reviewing.
      if (existing !== wanted) { fs.writeFile(dst, wanted); written++; }
    }
    placed.push(rel);
  }
  // NO `.git/info/exclude` ENTRY ANY MORE (Policy Owner, 2026-09-28).
  //
  // gov used to hide its copies from every code repo's `git status`, because `cleanup.ts` reads untracked files as
  // "dirty" and would then refuse to remove a work root on account of gov's own output. The ruling reversed it:
  // the commit that puts these files under version control belongs to ORDINARY PROJECT WORK, made by the
  // developer or their agent — not to gov at launch, and not to `gov add-repo`. A file hidden from `git status`
  // can never be picked up by that commit, so hiding them prevented the very thing they were meant to enable.
  //
  // The cleanup problem is fixed where it belongs, in `dirtyIgnoringGovsOwnFiles`: gov discounts its own harness
  // when judging whether deleting a directory would lose somebody's work. A team that would rather not see these
  // files can add them to their own `.gitignore`, which is their file and their decision.
  return { structureOnly: false, placed, targets, skipped, written, unreadable: harness.unreadable };
}

/**
 * The rendered harness as the default branch has it. `read(rel)` is the file's text, or null when the branch has
 * none (or git could not be asked — then `unreadable` says why). Local branch first, then the remote-tracking one,
 * as `snapshotGovernance` resolves it.
 */
function readHarnessAtDefault(source: HarnessSource, worktree: string): {
  readonly unreadable: string | null; readonly from: (rel: string) => string; readonly read: (rel: string) => string | null;
} {
  const dir = HARNESS_SRC_DIR.split(path.sep).join("/");
  const b = source.defaultBranch;
  const ref = [b, `origin/${b}`].find((r) => source.git(worktree, ["rev-parse", "--verify", "--quiet", `${r}^{commit}`]) !== null);
  const from = (rel: string): string => `${ref ?? b}:${dir}/${rel}`;
  if (!ref) return { unreadable: `gov could not read the default branch '${b}' in ${worktree}`, from, read: () => null };
  // ONE LISTING, so "the branch has no such file" is a fact git stated, kept apart from git failing.
  const listing = source.git(worktree, ["ls-tree", "-r", "--name-only", ref, "--", dir]);
  if (listing === null) return { unreadable: `git could not list ${dir}/ at ${ref} in ${worktree}`, from, read: () => null };
  const present = new Set(listing.split("\n").map((l) => l.trim()).filter(Boolean));
  let unreadable: string | null = null;
  const read = (rel: string): string | null => {
    if (!present.has(`${dir}/${rel}`)) return null;
    const text = source.git(worktree, ["show", from(rel)]);
    if (text === null) { unreadable ??= `git could not read ${from(rel)}, though the branch has it`; return null; }
    // EXACTLY ONE TRAILING NEWLINE, as the renderer writes every harness file. gov's git ports trim stdout, and a
    // copy one byte short of the rendered file would be rewritten on every launch and never match a fresh render.
    return text.replace(/\n*$/, "\n");
  };
  return { get unreadable() { return unreadable; }, from, read };
}

/**
 * Is the governance actually in this agent's context? — the check behind the guarantee.
 *
 * THE GUARANTEE IS ONLY WORTH THE VERIFICATION (Policy Owner, 2026-09-11, answering "1. should
 * be blocked"). gov promises the governance requirements are in the agent's context at launch
 * and on every turn, "from a file gov placed AND VERIFIED at the start of the session". Placing
 * it is `ensureRootProtocol`; this is the second half. Without it the promise rests on a copy
 * that may have been skipped — as `.clinerules` was, for as long as the mirror list named a
 * directory where the rendered file is `.clinerules/agent.md`. Nothing failed, and cline
 * launched into a governed project with no governance. That is the failure mode this exists for:
 * not a crash, a silence.
 *
 * Three ways the file can be there and not govern, all seen or reachable:
 *   missing  — never rendered for this workspace, or mirrored to the wrong path
 *   empty    — a truncated write, or a render that produced nothing
 *   unversioned — some other file of the same name, not gov's protocol
 *
 * The version marker is the discriminator. An adopter's own hand-written CLAUDE.md is a real
 * possibility, and overwriting it silently would be its own defect; refusing to launch names the
 * conflict instead.
 */
export type ContextVerdict =
  /** gov's protocol at the version this build renders. Launch, say nothing. */
  | { readonly ok: true; readonly at: string; readonly current: true }
  /** Something IS in the agent's context, but not this build's render. Launch, and say so. */
  | { readonly ok: true; readonly at: string; readonly current: false; readonly why: string }
  /** Nothing is in the agent's context at all. Refuse. */
  | { readonly ok: false; readonly at: string; readonly why: string };

/** The marker the renderer stamps into every harness file. Kept here, asserted by test against
 *  what `render-harness.mjs` actually writes, so the two cannot drift apart unnoticed. */
export const PROTOCOL_MARKER = "gov-protocol-version";

/** The renderer's banner — in every harness file it has written, at every version. */
export const RENDERED_BANNER = "GENERATED from the framework harness source";

/**
 * The old Claude mechanism: a file of `@`-imports rather than a render. Still governance —
 * Claude resolves them and reads the protocol — and still shipped on `main` today.
 *
 * THE WORKSPACE PREFIX WAS MISSING, so the pattern did not match the stubs actually on disk (PRJ-121,
 * 2026-09-28). It was written from the manifest's `claude-import-stub` template, which is unprefixed
 * (`@agent/session-protocol.md`), but a stub placed at a PROJECT root has to reach into the workspace clone —
 * `@svm-prj-work/agent/session-protocol.md` — and that is what the live project was found holding. So the one
 * shape this exists to recognise was the one shape it did not, and the stub fell through to "gov did not render
 * it": true, and unhelpfully vague about a mechanism gov retired and can name.
 *
 * Matched as "a line that is nothing but an `@`-import of an `agent.md` or a `session-protocol.md`", which is
 * what the stub is, rather than as a list of the prefixes seen so far — the growing-list-of-shapes mistake
 * `verifyAgentContext` made twice below.
 */
export const IMPORT_STUB = /^@[\w./-]*(?:agent|session-protocol)\.md\s*$/m;

/**
 * Is anything governing this agent's session? — the check behind the guarantee.
 *
 * REFUSE ONLY WHEN THERE IS NOTHING THERE. Two walks taught this, and both times the refusal
 * was the defect rather than the protection:
 *
 *   · The first version required a `gov-protocol-version` line. That marker was added on
 *     2026-09-11, so every organization adopted before then was refused — on content that is
 *     perfectly valid ratified governance.
 *   · The second recognised the renderer's banner as well. That still refused Claude, because
 *     `main` ships CLAUDE.md as a two-line `@`-import stub with no banner by design — the old
 *     Claude mechanism, which works.
 *
 * The pattern in both: a growing list of historical shapes, where every shape I failed to
 * anticipate blocks EVERY launch. That is a bad trade for a check whose purpose is narrow.
 *
 * WHAT MAKES THE NARROW RULE CORRECT. `ensureRootProtocol` overwrites this file from
 * `<workspace>/<rel>` on every launch, so what is read here is always a copy of the
 * organization's own governed repository. If an org edited it, that edit is their ratified
 * choice (GOV-FRM-086) and gov has no standing to refuse it. The genuinely ungoverned cases are the
 * two where the agent would start with nothing in context at all: the file is absent, or it is
 * empty. Those are unambiguous, cannot be produced by any historical version, and are what the
 * guarantee was written to prevent.
 *
 * Everything else launches. `current: false` is a WARNING — said once, with `gov upgrade` — so
 * an org running an older protocol is told, without being stopped.
 *
 * DEVIATION, RECORDED: the ruling of 2026-09-11 said a file that "lacks gov-protocol-version"
 * should be blocked. Followed literally that blocks the entire installed base, including every
 * org seeded from `main` today, because the marker is newer than all of them. The intent —
 * never hand over an ungoverned session — is kept; the trigger is narrowed to the cases that
 * actually mean ungoverned.
 */
export function verifyAgentContext(
  fs: Pick<Fs, "readFile">,
  projectDir: string,
  harnessRel: string,
): ContextVerdict {
  const at = path.join(projectDir, harnessRel);
  const text = fs.readFile(at);
  if (text == null) return { ok: false, at, why: "the file is not there" };
  if (text.trim() === "") return { ok: false, at, why: "the file is empty" };

  if (text.includes(PROTOCOL_MARKER)) return { ok: true, at, current: true };
  if (text.includes(RENDERED_BANNER)) {
    return {
      ok: true, at, current: false,
      why: "it is gov's protocol from an earlier framework version",
    };
  }
  if (IMPORT_STUB.test(text)) {
    return {
      ok: true, at, current: false,
      why: "it is the older Claude @-import form, which loads the protocol indirectly",
    };
  }
  // Present, non-empty, and not a shape gov recognises — so it is most likely the
  // organization's own. Say plainly that gov cannot vouch for it, and get out of the way.
  return {
    ok: true, at, current: false,
    why: "gov did not render it, so gov cannot confirm it carries the session-start protocol",
  };
}
