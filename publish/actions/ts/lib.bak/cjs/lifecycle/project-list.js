export function createGhProjects(runGh) {
    return {
        listBoards(owner) {
            try {
                const out = runGh(["project", "list", "--owner", owner, "--format", "json", "--limit", "100"]);
                const d = JSON.parse(out);
                return (d.projects ?? [])
                    .filter((p) => p.number !== undefined)
                    .map((p) => ({ number: p.number, title: p.title ?? "", url: p.url ?? "", closed: p.closed ?? false }));
            }
            catch {
                return [];
            }
        },
    };
}
