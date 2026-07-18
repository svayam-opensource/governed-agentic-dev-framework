/** Run every validator and aggregate; `ok` is true only if all passed. */
export function runValidators(ctx, validators) {
    const results = validators.map((v) => v(ctx));
    const failures = results.flatMap((r) => r.errors.map((e) => `${r.name}: ${e}`));
    return { ok: results.every((r) => r.ok), results, failures };
}
