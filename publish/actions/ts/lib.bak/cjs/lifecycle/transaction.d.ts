/**
 * A tiny transactional rollback engine for seed (SDD Part B). seed mutates the
 * home workspace, per-project worktrees, and remote branches across phases A–D;
 * on any failure those tracked side effects must reverse. The bash tracked four
 * parallel arrays (created paths / worktrees / pushed branches / pre-seed SHA);
 * a single **LIFO compensation stack** expresses the same intent more simply:
 * each forward step registers its undo, and rollback runs them newest-first.
 */
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
export declare class Transaction {
    private readonly stack;
    private committed;
    /** Run a forward action and register its compensating undo (receives the result). */
    step<T>(label: string, forward: () => T, undo: (result: T) => void): T;
    /** Register a bare undo for an effect performed outside {@link step} (e.g. a
     *  pre-recorded HEAD sha to reset to). */
    onRollback(label: string, undo: () => void): void;
    /** Mark the operation successful — {@link rollback} becomes a no-op. */
    commit(): void;
    /** Reverse every registered undo, newest-first. Returns any undo failures. */
    rollback(): RollbackFailure[];
    /** Number of pending compensations (0 after commit-less rollback). */
    get pending(): number;
}
