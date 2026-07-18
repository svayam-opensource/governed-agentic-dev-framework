// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `onboard` (SDD Part C, onboard-repo.sh) — bring an existing repo under the
 * framework: scaffold a `knowledge/` folder (agent.md + repo/{structure,
 * environment,patterns}.md) on an `onboard-knowledge` branch and raise a PR.
 * A one-time, per-repo provisioning step — distinct from `add-repo` (which pulls
 * a repo into the CURRENT project). Pure over Vcs + Fs + Pulls + cloneRepo.
 */
import * as path from "node:path";
import { repoNameFromUrl } from "./repo.js";
const ONBOARD_BRANCH = "onboard-knowledge";
function agentMd(input, config) {
    const ws = config.workspaceRepo;
    return `**Repository:** ${input.repoUrl}
**Purpose:** ${input.description}
**Owner:** ${input.owner}

---
This file represents the **repo-local knowledge layer** — third priority.

\`\`\`
1. Org-wide knowledge      → ${ws}/knowledge/        [HIGHEST]
2. Project knowledge       → ${ws}/projects/<project-id>/knowledge/
3. This repo's knowledge   → this file and knowledge/repo/      [THIS FILE]
4. Your developer prefs    → ${config.agentWorkRoot}/preferences/<your-gh-login>.md
\`\`\`

**This file cannot override org-wide knowledge or policy.**

---
Read before working in this repository:
- \`knowledge/repo/structure.md\`   — directory layout, modules, packages
- \`knowledge/repo/environment.md\` — build tools, dependencies, setup
- \`knowledge/repo/patterns.md\`    — coding conventions, architectural patterns

---
During an active project:
- Do NOT modify \`knowledge/repo/\` directly.
- All knowledge writes go to \`${ws}/projects/<project-id>/knowledge/\`.
- Repo knowledge is updated only via the project's knowledge close PR.

Never commit credentials, secrets, API keys, or PII (C01).
`;
}
function repoDoc(owner, todo) {
    return `**Owner:** ${owner}
**TODO:** Populate this file with the repository's ${todo}.

---
<describe here>
`;
}
function prBody(repoName, orgName) {
    return `This PR adds the \`knowledge/\` folder to bring **${repoName}** under the ${orgName} Agentic Development Policy.

- \`knowledge/agent.md\` — agent entry point with knowledge-layer priority
- \`knowledge/repo/structure.md\` — placeholder for repo structure
- \`knowledge/repo/environment.md\` — placeholder for build/setup
- \`knowledge/repo/patterns.md\` — placeholder for coding conventions

Populate the placeholders as a follow-up PR. Does not touch CI/CD or application code.
`;
}
export function onboard(deps, config, input) {
    const repoName = repoNameFromUrl(input.repoUrl);
    const remote = config.remote ?? "origin";
    const repoDir = path.join(config.agentWorkRoot, "onboard", repoName);
    if (deps.fs.pathExists(path.join(repoDir, ".git"))) {
        deps.log?.(`fetching existing clone at ${repoDir}`);
        deps.vcs.fetch(repoDir, remote);
    }
    else {
        deps.log?.(`cloning ${input.repoUrl} → ${repoDir}`);
        deps.cloneRepo(input.repoUrl, repoDir);
    }
    // Guards (match onboard-repo.sh): no existing knowledge/ or onboard branch.
    if (deps.fs.pathExists(path.join(repoDir, "knowledge"))) {
        return { ok: false, code: 1, reason: "knowledge-exists", message: `knowledge/ already exists in ${repoName} — investigate the existing structure.` };
    }
    if (deps.vcs.remoteBranchExists(repoDir, remote, ONBOARD_BRANCH)) {
        return { ok: false, code: 1, reason: "branch-exists", message: `Branch '${ONBOARD_BRANCH}' already exists in ${repoName} — investigate before proceeding.` };
    }
    const defaultBranch = deps.vcs.defaultBranch(input.repoUrl) ?? "main";
    deps.vcs.checkout(repoDir, defaultBranch);
    deps.vcs.checkoutNew(repoDir, ONBOARD_BRANCH);
    deps.fs.writeFile(path.join(repoDir, "knowledge", "agent.md"), agentMd(input, config));
    deps.fs.writeFile(path.join(repoDir, "knowledge", "repo", "structure.md"), repoDoc(input.owner, "directory layout and key modules"));
    deps.fs.writeFile(path.join(repoDir, "knowledge", "repo", "environment.md"), repoDoc(input.owner, "build tools, dependencies, and local setup"));
    deps.fs.writeFile(path.join(repoDir, "knowledge", "repo", "patterns.md"), repoDoc(input.owner, "coding conventions and architectural patterns"));
    deps.vcs.addPath(repoDir, "knowledge");
    deps.vcs.commit(repoDir, "onboard: initialize knowledge/ folder for agentic development");
    deps.vcs.push(repoDir, remote, ONBOARD_BRANCH, { setUpstream: true });
    const prUrl = deps.pulls.create(input.repoUrl, defaultBranch, ONBOARD_BRANCH, "[Onboard] Initialize knowledge/ folder for agentic development", prBody(repoName, config.orgName));
    return {
        ok: true,
        branch: ONBOARD_BRANCH,
        lines: [`Onboarded ${repoName} (branch ${ONBOARD_BRANCH} pushed).`, prUrl ? `  PR: ${prUrl}` : "  branch pushed — open a PR for onboard-knowledge manually."],
    };
}
