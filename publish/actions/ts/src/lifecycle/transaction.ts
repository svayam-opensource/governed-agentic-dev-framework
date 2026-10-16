// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * A tiny transactional rollback engine for seed (SDD Part B). seed mutates the
 * home workspace, per-project worktrees, and remote branches across phases A–D;
 * on any failure those tracked side effects must reverse. The bash tracked four
 * parallel arrays (created paths / worktrees / pushed branches / pre-seed SHA);
 * a single **LIFO compensation stack** expresses the same intent more simply:
 * each forward step registers its undo, and rollback runs them newest-first.
 */

/** A recorded compensating action. */
interface Compensation {
  readonly label: string;
  readonly undo: () => void;
}

/** A failure encountered while rolling back one compensation. */
export interface RollbackFailure {
  readonly label: string;
  readonly error: unknown;
}

/**
 * Records undo actions as forward steps succeed and reverses them (LIFO) on
 * rollback. `commit()` disarms it once the whole operation succeeds. Rollback is
 * best-effort: a failing undo is collected and reported, never thrown, so one
 * stuck step can't strand the rest (matches the bash `… || true` discipline).
 */
import { log } from "../log.js";

/**
 * What a transaction did, in labels (gadf#180). A failed seed used to return its error and the undos that failed,
 * and nothing about what had been made and unmade — so "what state did it leave behind?" was a question for the
 * log file. `created` is every step that ran, in order; `rolledBack` the undos that succeeded, newest-first;
 * `leftBehind` the ones that did not, each with git's (or the filesystem's) reason.
 */
export interface TransactionReport {
  readonly created: readonly string[];
  readonly rolledBack: readonly string[];
  readonly leftBehind: readonly string[];
}

export class Transaction {
  private readonly stack: Compensation[] = [];
  private committed = false;
  private readonly created: string[] = [];
  private readonly rolledBack: string[] = [];
  private readonly leftBehind: string[] = [];

  /** Run a forward action and register its compensating undo (receives the result). */
  step<T>(label: string, forward: () => T, undo: (result: T) => void): T {
    // EVERY STEP OF AN ORG-VISIBLE OPERATION, on the record (PRJ-121, 2026-09-23). A seed, a task or a close
    // creates branches, issues and assignments across repositories; when one half-happened, the only account of
    // how far it got was whatever the screen still showed.
    try {
      const result = forward();
      this.stack.push({ label, undo: () => undo(result) });
      this.created.push(label);
      log("info", "step done", "gov-work:lifecycle:transaction", "step", { step: label, pending: this.stack.length });
      return result;
    } catch (e) {
      log("error", "step failed — rolling back", "gov-work:lifecycle:transaction", "step", { step: label, pending: this.stack.length, message: (e as Error)?.message });
      throw e;
    }
  }

  /** Register a bare undo for an effect performed outside {@link step} (e.g. a
   *  pre-recorded HEAD sha to reset to). */
  onRollback(label: string, undo: () => void): void {
    this.stack.push({ label, undo });
    this.created.push(label);
  }

  /** Mark the operation successful — {@link rollback} becomes a no-op. */
  commit(): void {
    this.committed = true;
    log("info", "committed", "gov-work:lifecycle:transaction", "commit", { steps: this.stack.length });
  }

  /** Reverse every registered undo, newest-first. Returns any undo failures. */
  rollback(): RollbackFailure[] {
    if (this.committed) return [];
    const failures: RollbackFailure[] = [];
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const c = this.stack[i];
      try {
        c.undo();
        this.rolledBack.push(c.label);
        log("info", "undone", "gov-work:lifecycle:transaction", "rollback", { step: c.label });
      } catch (error) {
        failures.push({ label: c.label, error });
        this.leftBehind.push(`${c.label} (${(error as Error)?.message ?? String(error)})`);
        log("error", "UNDO FAILED — left behind", "gov-work:lifecycle:transaction", "rollback", { step: c.label, message: (error as Error)?.message });
      }
    }
    this.stack.length = 0;
    return failures;
  }

  /** What ran, what was undone, what could not be (see {@link TransactionReport}). */
  report(): TransactionReport {
    return { created: [...this.created], rolledBack: [...this.rolledBack], leftBehind: [...this.leftBehind] };
  }

  /**
   * The report as one line a person reads after a failure:
   * `created: …; rolled back: …; left behind: …`. An empty list says "nothing" — a blank after a colon reads as
   * a formatting error, not as an answer.
   */
  summary(): string {
    const list = (xs: readonly string[]) => (xs.length ? xs.join(", ") : "nothing");
    const r = this.report();
    return `created: ${list(r.created)}; rolled back: ${list(r.rolledBack)}; left behind: ${list(r.leftBehind)}`;
  }

  /** Number of pending compensations (0 after commit-less rollback). */
  get pending(): number {
    return this.stack.length;
  }
}
