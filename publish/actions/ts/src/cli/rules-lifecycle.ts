// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * RUNNING THE BUILD WHERE NOBODY HAS TO KNOW IT EXISTS (rules-and-cues-design §7, PRJ-121, 2026-09-28).
 *
 * `gov rules build|check|report` was implemented and called by nothing — the same state the framework's own
 * `render-harness.mjs --check` was in, and for the same reason: a verb an adopter must remember to type is a
 * verb an adopter does not type. The promise the framework makes is "write your policy and your agents will
 * follow it", and a promise whose delivery step is manual is not kept for anybody but the person who wrote it.
 *
 * So the build runs at the three moments the rendered rules can become wrong, and nowhere else:
 *
 *   gov setup     the adopter's FIRST copy — nothing is rendered yet, and every agent they launch reads it
 *   gov upgrade   the FRAMEWORK'S rule rows changed, so the resident block has to be re-rendered
 *   gov sync      how a RATIFIED ORG RULE reaches a project already in flight
 *
 * WHICH SOURCE EACH ONE READS, and the one place this deviates from "always the default branch":
 *
 *   sync    → the DEFAULT BRANCH. This is the case GOV-FRM-086 is about: a rule row edited on the project branch
 *             is a proposal, and rendering it would deliver a rule nobody ratified into the one block an agent is
 *             guaranteed to read — self-governance, straight into context.
 *   setup   → the WORKING TREE, necessarily. At setup the rule stores have just been seeded from `publish/content`;
 *             they are not committed to any branch yet.
 *   upgrade → the WORKING TREE, for the same reason one step later. `gov upgrade` exists to put the framework's
 *             new rule rows on disk; the default branch is by definition still carrying the OLD ones, so reading it
 *             would render the previous rules into the changeset that ships the new ones.
 *
 * The deviation is safe because of WHAT is being rendered, not where from: at setup and upgrade the rows
 * are the framework's, arriving from published content, and the rendered harness travels in the same commit for
 * the same review. `rules()` prints "from the WORKING TREE (unratified …)" every time, so the reader is never
 * told otherwise.
 *
 * WHAT MAY LEAVE THE WORKSPACE UN-BUILT: a rule store with errors, or a resident tier over its cap. The build
 * refuses rather than render rules nobody can vouch for, and the workspace keeps the render it already had —
 * coherent, ratified, merely older. The rule-model build never stops to ASK: a reworded section marks its rows
 * stale for `gov rules propose`, it does not block a render.
 *
 * NO COMMAND FAILS BECAUSE OF THIS. setup, upgrade and sync each have work that must still complete — branches
 * merged, content written, a repository created and pushed — and a non-zero exit for a rules problem would strand
 * all of it.
 */
import * as path from "node:path";
import { hasRuleStores, plan, rules, type RulesDeps, type RulesInput } from "./rules-verb.js";
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
  /** The build could not run — an unreadable store, a row error, a resident tier over its cap, a failed write. */
  readonly failed: boolean;
  /** There is no rule store at all, so there was nothing to build. Not a failure; see below. */
  readonly skipped: boolean;
  /** GOV ids whose resident cue differs from what was on disk. */
  readonly changed: readonly string[];
  /** The rendered rules' hash after the build, or null when nothing was rendered. */
  readonly hash: string | null;
  /** True when `state/rules-pending` was written, so the caller can say the mutating verbs are now closed. */
  readonly pendingRecorded: boolean;
}

/** `gov <moment>` — the label the output and the marker both use. */
const MOMENT_VERB: Record<RulesMoment, string> = { setup: "setup", upgrade: "upgrade", sync: "sync" };

/**
 * Render the harness and the rule map from the rule stores, as part of `moment`.
 *
 * ONE COMPUTATION, TWO USES. `plan()` is called for the decision data (did the bytes change, can it render) and
 * `rules()` for the write and the human output. Both are pure over the same inputs and `rules()`
 * calls `plan()` itself, so the work is done twice — deliberately, because the alternative is a second code
 * path deciding "what should be there", which is exactly the split that lets a freshness check pass on a stale
 * file (see the header of `rules-verb.ts`).
 */
export function buildRulesAt(deps: LifecycleRulesDeps, input: RulesInput, moment: RulesMoment): LifecycleRulesOutcome {
  const verb = MOMENT_VERB[moment];
  const nothing = { failed: false, skipped: false, changed: [] as string[], hash: null, pendingRecorded: false };

  // NO RULE STORE IS NOT A PROBLEM TO REPORT (PRJ-121, 2026-09-28; rule model 2026-10-06).
  //
  // A workspace on the pre-rule-model layout has nothing to build until `gov upgrade` installs the framework's
  // rules — and the command must behave exactly as it did before. Saying "not built" on every `gov sync` would
  // teach a whole class of workspace to skim past the rules lines, including the day one of them matters.
  if (!hasRuleStores(deps, input)) {
    return { ...nothing, skipped: true, lines: [] };
  }

  const planned = plan(deps, input);
  if (planned.error || !planned.result) {
    return {
      ...nothing,
      failed: true,
      lines: [
        `  rules: not built — ${planned.error ?? "the build returned nothing"}`,
        `  your agents keep whatever is already rendered. See why:  gov rules report`,
      ],
    };
  }
  if (planned.result.errors.length) {
    return {
      ...nothing,
      failed: true,
      lines: [
        `  rules: NOT rendered — ${planned.result.errors.length} error(s) in the rule stores.`,
        ...planned.result.errors.map((d) => `  ${d}`),
        `  fix those, then:  gov rules build`,
      ],
    };
  }

  // WHAT WAS THERE BEFORE, read before the write.
  const before = planned.result.files.map((f) => ({ path: f.path, content: deps.fs.readFile(path.join(input.home, f.path)) }));
  const hadAny = before.some((f) => f.content !== null);
  const previous = hadAny ? rulesHash(before.map((f) => ({ path: f.path, content: f.content ?? "" }))) : null;
  const hash = rulesHash(planned.result.files);
  // EVERY RENDERED FILE'S CUES, JOINED. The nine files carry the same resident block, so the map collapses to
  // one entry per GOV id — and joining means this never has to know WHICH of the nine is the plain one.
  const changed = changedCites(
    residentCues(before.map((f) => f.content ?? "").join("\n")),
    residentCues(planned.result.files.map((f) => f.content).join("\n")),
  );

  const written = rules(deps, input, "build");
  if (written.code !== 0) {
    // `plan` saw no errors, so this is a write that failed — a read-only tree, a full disk.
    return { ...nothing, failed: true, lines: [`  rules: the build did not complete —`, ...written.lines.map((l) => `  ${l}`)] };
  }

  const differs = previous !== hash;
  const lines = [
    `  rules: rendered ${planned.result.files.length} file(s) from ${input.workingTree ? "the working tree (this changeset)" : input.defaultBranch}`,
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
      ...(changed.length ? [`  ${changed.length} resident rule(s) differ: ${changed.slice(0, 6).join(", ")}${changed.length > 6 ? ", …" : ""}`] : []),
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
  return { lines, failed: false, skipped: false, changed, hash, pendingRecorded };
}
