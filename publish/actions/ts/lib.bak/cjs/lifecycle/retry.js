/** Run `fn`, retrying on throw up to `attempts` times; rethrows the last error. */
export function retry(fn, opts = {}) {
    const attempts = opts.attempts ?? 3;
    const sleep = opts.sleep ?? (() => { });
    const backoff = opts.backoff ?? 3;
    let delay = opts.delayMs ?? 5000;
    let lastError;
    for (let n = 1; n <= attempts; n++) {
        try {
            return fn();
        }
        catch (error) {
            lastError = error;
            if (n >= attempts)
                break;
            opts.onRetry?.(n, error);
            sleep(delay);
            delay *= backoff;
        }
    }
    throw lastError;
}
