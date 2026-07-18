/** A {@link Pulls} backed by the `gh` CLI. `runGh` is injectable for tests. */
export function createGhPulls(runGh) {
    const existingUrl = (repo, head) => {
        try {
            return runGh(["pr", "view", head, "--repo", repo, "--json", "url", "-q", ".url"]).trim() || null;
        }
        catch {
            return null;
        }
    };
    return {
        create(repo, base, head, title, body) {
            try {
                const url = runGh(["pr", "create", "--repo", repo, "--base", base, "--head", head, "--title", title, "--body", body]).trim();
                if (url)
                    return url;
            }
            catch {
                /* likely already open — fall through to reuse */
            }
            return existingUrl(repo, head);
        },
        merge(repo, head) {
            try {
                runGh(["pr", "merge", head, "--repo", repo, "--merge", "--admin"]);
                return "merged";
            }
            catch {
                // Already merged? Treat as success (idempotent re-run).
                try {
                    const state = runGh(["pr", "view", head, "--repo", repo, "--json", "state", "-q", ".state"]).trim().toUpperCase();
                    return state === "MERGED" ? "already-merged" : "failed";
                }
                catch {
                    return "failed";
                }
            }
        },
    };
}
