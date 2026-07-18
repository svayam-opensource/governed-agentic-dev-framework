/**
 * A tiny synchronous retry-with-backoff (SDD Part B, seed Phase C — the
 * `git_clone_retry` behavior). `sleep` is injected (default no-op) so tests run
 * instantly; a real caller can pass a blocking sleep for network backoff.
 */
export interface RetryOptions {
    /** Total attempts (default 3). */
    readonly attempts?: number;
    /** Initial delay before the 2nd attempt (default 5000ms). */
    readonly delayMs?: number;
    /** Delay multiplier between attempts (default 3). */
    readonly backoff?: number;
    /** Blocking sleep between attempts (default no-op). */
    readonly sleep?: (ms: number) => void;
    /** Notified before each retry with the failed attempt number + error. */
    readonly onRetry?: (attempt: number, error: unknown) => void;
}
/** Run `fn`, retrying on throw up to `attempts` times; rethrows the last error. */
export declare function retry<T>(fn: () => T, opts?: RetryOptions): T;
