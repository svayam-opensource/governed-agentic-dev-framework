import { archiveBranch } from "./merge.js";
/** The branch name for a knowledge proposal. */
export function knowledgeBranch(slug) {
    return `knowledge-${slug}`;
}
/** Create + push a `knowledge-<slug>` proposal branch off the default branch. */
export function proposeKnowledge(vcs, config, home, slug) {
    if (!slug)
        return { ok: false, code: 2, message: "usage: gov-work knowledge propose <slug>" };
    const branch = knowledgeBranch(slug);
    const remote = config.remote ?? "origin";
    try {
        vcs.fetch(home, remote, config.defaultBranch);
        vcs.checkout(home, config.defaultBranch);
        vcs.checkoutNew(home, branch);
        vcs.push(home, remote, branch, { setUpstream: true });
        return { ok: true, lines: [`Created knowledge branch '${branch}' (pushed).`, `  edit under knowledge/, then: prj knowledge submit ${slug} "<desc>"`] };
    }
    catch (e) {
        return { ok: false, code: 1, message: e.message };
    }
}
/** Open a PR for a `knowledge-<slug>` branch → the default branch. */
export function submitKnowledge(pulls, config, slug, description) {
    if (!slug)
        return { ok: false, code: 2, message: "usage: gov-work knowledge submit <slug> [description]" };
    const branch = knowledgeBranch(slug);
    const repo = `${config.githubOrg}/${config.workspaceRepo}`;
    const url = pulls.create(repo, config.defaultBranch, branch, `knowledge: ${slug}`, description || `Org knowledge proposal: ${slug}`);
    return url ? { ok: true, lines: [`Opened knowledge PR: ${url}`] } : { ok: false, code: 1, message: `Could not open a PR for '${branch}'.` };
}
/** Archive a merged `knowledge-<slug>` branch (tag archive/<branch> + delete). */
export function archiveKnowledge(vcs, config, home, slug) {
    if (!slug)
        return { ok: false, code: 2, message: "usage: gov-work knowledge archive <slug>" };
    const branch = knowledgeBranch(slug);
    try {
        archiveBranch(vcs, home, branch, config.remote ?? "origin");
        return { ok: true, lines: [`Archived '${branch}' (tag archive/${branch} + deleted).`] };
    }
    catch (e) {
        return { ok: false, code: 1, message: e.message };
    }
}
