// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * NEW MODULES REACH GITHUB ONLY THROUGH A PORT (PRJ-121 intent 03, D7; contract M4).
 *
 * The modules intent 03 adds — signal, autorun, intent, project, skills — talk to the code host, the work tracker
 * and the CI through `src/ports/`, so a bank on GitLab or Jira needs a new adapter, not a rewrite. That holds
 * only if nothing in them goes round the port, so in those directories (eslint.config.ts) this rule reports:
 *
 *   1. an import from `gh-board` — the gh-backed board and its `RunGh` runner;
 *   2. an imported name `runGh` / `RunGh` / `createGh…` from anywhere — a gh runner or a gh-backed factory;
 *   3. a call whose first argument is the string "gh" — `run("gh", …)`, `tryRun("gh", …)` and the like.
 *
 * Existing code is NOT in scope: it moves behind the ports when it is touched (M4), not all at once.
 */
const MESSAGE = "reach GitHub through a port (src/ports/, adapters chosen in org-config.yaml), not {{what}} — PRJ-121 M4.";
const GH_BOARD = /(^|\/)gh-board(\.js|\.ts)?$/;
const GH_NAMES = /^(runGh|RunGh|defaultRunGh|createGh[A-Z]\w*)$/;

export default {
  meta: {
    type: "problem",
    docs: { description: "signal, autorun, intent, project and skills call ports — never gh, gh-board or runGh" },
    schema: [],
    messages: { direct: MESSAGE },
  },
  create(context) {
    const report = (node, what) => context.report({ node, messageId: "direct", data: { what } });
    return {
      ImportDeclaration(node) {
        const from = String(node.source.value);
        if (GH_BOARD.test(from)) { report(node, `an import from ${from}`); return; }
        for (const s of node.specifiers) {
          const name = s.type === "ImportSpecifier" ? (s.imported.name ?? s.imported.value) : null;
          if (name && GH_NAMES.test(name)) report(s, `${name}`);
        }
      },
      CallExpression(node) {
        const first = node.arguments[0];
        if (first && first.type === "Literal" && first.value === "gh") report(node, "running `gh`");
      },
    };
  },
};
