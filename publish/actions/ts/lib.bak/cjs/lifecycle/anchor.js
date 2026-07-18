export const DEFAULT_ANCHOR_LABEL = "anchor";
/** The anchor issue body (matches seed.sh wording). */
export function anchorIssueBody(boardNumber, title) {
    return `Anchor issue for the project on GitHub Project #${boardNumber} — *${title}*.

Owners = this issue's assignees (managed via \`prj manage\`). Status carrier:
a \`paused\` or \`cancelled\` label here drives the project's derived lifecycle
status (with the board's open/closed state). Long-lived scope marker; closed at
project close.`;
}
/** A {@link AnchorCreator} backed by the `gh` CLI. `runGh` is injectable for tests. */
export function createGhAnchor(runGh) {
    return {
        createAnchorIssue(p) {
            const label = p.anchorLabel ?? DEFAULT_ANCHOR_LABEL;
            const repo = `${p.owner}/${p.workspaceRepo}`;
            // Ensure the anchor label exists (best-effort).
            try {
                runGh(["label", "create", label, "--repo", repo, "--color", "5319e7", "--force"]);
            }
            catch {
                /* label may already exist / no perms — non-fatal */
            }
            let out;
            try {
                out = runGh([
                    "issue",
                    "create",
                    "--repo",
                    repo,
                    "--title",
                    `${p.title}: project scope & anchor`,
                    "--label",
                    label,
                    ...(p.assigneeLogin ? ["--assignee", p.assigneeLogin] : []),
                    "--body",
                    anchorIssueBody(p.boardNumber, p.title),
                ]);
            }
            catch {
                return null; // seed continues without an anchor
            }
            const url = out.trim().split("\n").pop() ?? "";
            if (!url)
                return null;
            // Add the issue to the board (best-effort).
            try {
                runGh(["project", "item-add", String(p.boardNumber), "--owner", p.owner, "--url", url]);
            }
            catch {
                /* non-fatal */
            }
            return `${repo}#${url.split("/").pop()}`;
        },
        find(ref, workspaceRepo) {
            const repo = `${ref.owner}/${workspaceRepo}`;
            try {
                const out = runGh(["issue", "list", "--repo", repo, "--label", DEFAULT_ANCHOR_LABEL, "--state", "all", "--json", "url,number,body,labels,assignees", "--limit", "100"]);
                const items = JSON.parse(out);
                const it = items.find((i) => i.body?.includes(`Project #${ref.number}`));
                if (!it?.url || it.number === undefined)
                    return null;
                return {
                    url: it.url,
                    number: it.number,
                    labels: (it.labels ?? []).map((l) => l.name ?? "").filter(Boolean),
                    assignees: (it.assignees ?? []).map((a) => a.login ?? "").filter(Boolean),
                };
            }
            catch {
                return null;
            }
        },
        setState(ref, workspaceRepo, label, action) {
            const anchor = this.find(ref, workspaceRepo);
            if (!anchor)
                return false;
            try {
                runGh(["issue", "edit", anchor.url, `--${action}-label`, label]);
                return true;
            }
            catch {
                return false;
            }
        },
        setAssignee(issueUrl, login, action) {
            try {
                runGh(["issue", "edit", issueUrl, `--${action}-assignee`, login]);
                return true;
            }
            catch {
                return false;
            }
        },
    };
}
