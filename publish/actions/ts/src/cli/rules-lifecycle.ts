// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * RUNNING THE COMPILER WHERE NOBODY HAS TO KNOW IT EXISTS (rules-and-cues-design §7, PRJ-121, 2026-09-28).
 *
 * `gov rules build|check|report` was implemented and called by nothing — the same state the framework's own
 * `render-harness.mjs --check` was in, and for the same reason: a verb an adopter must remember to type is a
 * verb an adopter does not type. The promise the framework makes is "write your policy and your agents will
 * follow it", and a promise whose delivery step is manual is not kept for anybody but the person who wrote it.
 *
 * So the build runs at the three moments the rendered rules can become wrong, and nowhere else:
 *
 *   gov setup     the adopter's FIRST copy — nothing is rendered yet, and every agent they launch reads it
 *   gov upgrade   the FRAMEWORK'S clauses changed, so the resident block has to be re-rendered
 *   gov sync      how a RATIFIED ORG RULE reaches a project already in flight
 *
 * WHICH SOURCE EACH ONE READS, and the one place this deviates from "always the default branch":
 *
 *   sync    → the DEFAULT BRANCH. This is the case POL-086b is about: a clause edited on the project branch is
 *             a proposal, and compiling it would deliver a rule nobody ratified into the one block an agent is
 *             guaranteed to read — self-governance, straight into context.
 *   setup   → the WORKING TREE, necessarily. At setup the policies have just been seeded from `publish/content`
 *             and token-substituted; they are not committed to any branch yet. A default-branch read there
 *             compiles the framework template's OWN un-substituted documents instead — so the adopter's first
 *             harness would be rendered from text that is not their policy, while reporting success.
 *   upgrade → the WORKING TREE, for the same reason one step later. `gov upgrade` exists to put the framework's
 *             new clause text on disk; the default branch is by definition still carrying the OLD clauses, so
 *             reading it would render the previous rules into the changeset that ships the new ones.
 *
 * The deviation is safe because of WHAT is being compiled, not where from: at setup and upgrade the documents
 * are the framework's, arriving from published content, and the rendered harness travels in the same commit for
 * the same review. `rules()` prints "from the WORKING TREE (unratified …)" every time, so the reader is never
 * told otherwise.
 *
 * WHICH ONE MAY LEAVE THE WORKSPACE UN-BUILT: `gov sync`. The build STOPS AND ASKS when a clause has been
 * reworded and it cannot tell whether the old number still names it — a question only a person with standing
 * over that policy may answer. At setup and at upgrade that person is the one running the command, in their own
 * governance repo. At sync they are usually not: sync runs inside a project, for a developer who may have no
 * say over the organization's policy at all, and demanding an answer there would either block their work or
 * invite them to confirm a rewording they are not authorized to confirm. So sync surfaces the question, leaves
 * the project on the render it already had — coherent, ratified, merely older — and finishes its other work.
 * Setup and upgrade surface it too and also complete (the repository exists; refusing to commit would leave a
 * half-made workspace), but for them an un-built workspace is a reported defect rather than an accepted state.
 *
 * NO COMMAND FAILS BECAUSE OF THIS. setup, upgrade and sync each have work that must still complete — branches
 * merged, content written, a repository created and pushed — and a non-zero exit for a question about clause
 * numbering would strand all of it.
 */
import * as path from "node:path";
import { plan, readPolicyDocs, rules, type RulesDeps, type RulesInput } from "./rules-verb.js";
import { changedCites, residentCues, rulesHash, writePending, type RulesPending } from "../rules-pending.js";
import { log } from "../log.js";

/** Which of the three moments this is. It changes the wording and whether a marker is recorded, nothing else. */
export type RulesMoment = "setup" | "upgrade" | "sync";

export interface LifecycleRulesDeps extends RulesDeps {
  /**
   * Where the `rules-pending` marker goes, and whose it is. Absent → no marker.
   *
   * ABSENT IS NOT A FAILURE. The marker is keyed by the person's GitHub login, and gov does not always know it
   * (no `gh` on PATH, not signed in). The reader in `dispatch.ts` is keyed the same way, so writer and reader
   * agree: when the login is unknown nothing is recorded AND nothing would be found, which is consistent rather
   * than half-enforced. The residual hole — a marker written while the login was known and read after `gh` broke
   * — is recorded as such, not papered over.
   */
  readonly marker?: { readonly workRoot: string; readonly login: string; readonly now: () => Date };
}

export interface LifecycleRulesOutcome {
  /** Lines for the calling command's output, already indented to sit inside it. */
  readonly lines: readonly string[];
  /** The build stopped and asked a question only a person can answer; nothing was written. */
  readonly asked: boolean;
  /** The build could not run — a notation error, an unreadable lock, a write that failed. */
  readonly failed: boolean;
  /** There are no policy documents at all, so there was nothing to compile. Not a failure; see below. */
  readonly skipped: boolean;
  /** Citations whose resident text differs from what was on disk. */
  readonly changed: readonly string[];
  /** The rendered rules' hash after the build, or null when nothing was rendered. */
  readonly hash: string | null;
  /** True when `state/rules-pending` was written, so the caller can say the mutating verbs are now closed. */
  readonly pendingRecorded: boolean;
}

/** `gov <moment>` — the label the output and the marker both use. */
const MOMENT_VERB: Record<RulesMoment, string> = { setup: "setup", upgrade: "upgrade", sync: "sync" };

/**
 * Compile the policies and render the harness, as part of `moment`.
 *
 * ONE COMPUTATION, TWO USES. `plan()` is called for the decision data (did the bytes change, was a question
 * asked) and `rules()` for the write and the human output. Both are pure over the same inputs and `rules()`
 * calls `plan()` itself, so the work is done twice — deliberately, because the alternative is a second code
 * path deciding "what should be there", which is exactly the split that lets a freshness check pass on a stale
 * file (see the header of `rules-verb.ts`).
 */
export function buildRulesAt(deps: LifecycleRulesDeps, input: RulesInput, moment: RulesMoment): LifecycleRulesOutcome {
  const verb = MOMENT_VERB[moment];
  const nothing = { asked: false, failed: false, skipped: false, changed: [] as string[], hash: null, pendingRecorded: false };

  // NO POLICY DOCUMENTS IS NOT A PROBLEM TO REPORT (PRJ-121, 2026-09-28).
  //
  // A structure-only workspace, or one whose org has not written a policy yet, has nothing to compile — and the
  // command must behave exactly as it did before any of this existed. `policy-gate-io.ts` states the same rule
  // for verb checks, and for the same reason: it is the property that lets this be wired unconditionally
  // without stranding adopters who never write a policy. Saying "not compiled — no policy documents" on every
  // `gov sync` would teach a whole class of workspace to skim past the rules lines, including the day one of
  // them matters.
  if (!readPolicyDocs(deps, input).length) {
    return { ...nothing, skipped: true, lines: [] };
  }

  const planned = plan(deps, input);
  if (planned.error || !planned.result) {
    return {
      ...nothing,
      failed: true,
      lines: [
        `  rules: not compiled — ${planned.error ?? "the compiler returned nothing"}`,
        `  your agents keep whatever is already rendered. See why:  gov rules report`,
      ],
    };
  }

  // A QUESTION STOPS THE WRITE, and it must not stop the command. `rules("build")` writes nothing while an ask
  // is outstanding (it refuses by construction), so it is safe to call for its wording — which is the wording
  // `gov rules build` itself prints, so a person reading it here and there reads the same thing.
  if (planned.result.asks.length) {
    const spoken = rules(deps, input, "build");
    log("warn", "the rules build stopped and asked — the workspace is left un-built", "gov-work:cli:rules-lifecycle", "buildRulesAt",
      { moment, asks: planned.result.asks.length });
    return {
      ...nothing,
      asked: true,
      lines: [
        `  rules: NOT rendered — the compiler has a question only a person can answer.`,
        ...spoken.lines.map((l) => `  ${l}`),
        moment === "sync"
          ? `  gov ${verb} finished. This project keeps the rules it already had until someone answers the above.`
          : `  gov ${verb} finished, but this workspace's harness is NOT compiled from its policies. Answer the above,`
            + `\n  then re-run \`gov rules build\` and commit the result.`,
      ],
    };
  }
  if (planned.result.diagnostics.length) {
    return {
      ...nothing,
      failed: true,
      lines: [
        `  rules: NOT rendered — ${planned.result.diagnostics.length} notation error(s) in the policies.`,
        ...planned.result.diagnostics.map((d) => `  ${d}`),
        `  fix those, then:  gov rules build`,
      ],
    };
  }

  // WHAT WAS THERE BEFORE, read before the write. The LOCKS are deliberately not part of this: a lock entry
  // appearing is bookkeeping, not a change to anything an agent reads, and counting it would mark a session
  // stale for a fact no session ever saw.
  const before = planned.result.files.map((f) => ({ path: f.path, content: deps.fs.readFile(path.join(input.home, f.path)) }));
  const hadAny = before.some((f) => f.content !== null);
  const previous = hadAny ? rulesHash(before.map((f) => ({ path: f.path, content: f.content ?? "" }))) : null;
  const hash = rulesHash(planned.result.files);
  // EVERY RENDERED FILE'S CUES, JOINED. The nine files carry the same resident block, so the map collapses to
  // one entry per citation — and joining means this never has to know WHICH of the nine is the plain one.
  const changed = changedCites(
    residentCues(before.map((f) => f.content ?? "").join("\n")),
    residentCues(planned.result.files.map((f) => f.content).join("\n")),
  );

  const written = rules(deps, input, "build");
  if (written.code !== 0) {
    // `plan` saw no asks and no diagnostics, so this is a write that failed — a read-only tree, a full disk.
    return { ...nothing, failed: true, lines: [`  rules: the build did not complete —`, ...written.lines.map((l) => `  ${l}`)] };
  }

  const differs = previous !== hash;
  const lines = [
    `  rules: compiled ${planned.result.files.length} file(s) from ${input.workingTree ? "the working tree (this changeset)" : input.defaultBranch}`,
  ];

  // THE MARKER IS FOR SYNC AND UPGRADE, NEVER SETUP. At setup there is no session to invalidate — the workspace
  // is minutes old and nobody has launched an agent against it — and a fresh workspace whose first `gov task`
  // refuses would read as gov being broken on first contact.
  let pendingRecorded = false;
  if (differs && moment !== "setup" && deps.marker) {
    const pending: RulesPending = {
      hash, previous, clauses: changed,
      at: deps.marker.now().toISOString(),
      by: verb,
    };
    writePending(deps.fs, deps.marker.workRoot, deps.marker.login, pending);
    pendingRecorded = true;
    log("warn", "the rendered rules changed — mutating verbs are closed until the session restarts", "gov-work:cli:rules-lifecycle", "buildRulesAt",
      { moment, hash, previous, clauses: changed.length });
  }

  if (differs) {
    lines.push(
      `  rules CHANGED: ${hash}${previous ? ` (was ${previous})` : " (nothing was rendered before)"}`,
      ...(changed.length ? [`  ${changed.length} resident clause(s) differ: ${changed.slice(0, 6).join(", ")}${changed.length > 6 ? ", …" : ""}`] : []),
    );
    if (pendingRecorded) {
      lines.push(
        `  task · merge · close · knowledge propose are CLOSED until your agent session restarts.`,
        `  restart it:  gov work        already restarted it:  gov rules reload`,
      );
    }
  } else {
    lines.push(`  rules unchanged (${hash}).`);
  }
  return { lines, asked: false, failed: false, skipped: false, changed, hash, pendingRecorded };
}
