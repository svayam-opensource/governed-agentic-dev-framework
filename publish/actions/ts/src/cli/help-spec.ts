// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * ONE SPEC PER COMMAND — the source the help, the docs and (in time) the parser all read.
 *
 * Decided with the Policy Owner (2026-09-22) after a walk found help in three hand-kept tables that the
 * argument parsers never read: 13 of ~25 commands had a description, 6 had a usage line, none had an example,
 * and `gov merge -h` ran a merge. The tables could not be trusted to match what a command accepted, because
 * nothing made them.
 *
 * THE PAGE, in this order, every time:
 *
 *   gov task — start a task: a sub-branch for one or more issues, in every repo of the project
 *   USAGE · WHERE · ARGUMENTS · FLAGS · EXAMPLES · CHANGES · EXIT · SEE ALSO
 *
 * Two of those are uncommon, and both earn their place here:
 *   CHANGES — what the command creates, pushes or assigns. docker and gh do not need it; gov's commands act on
 *             branches, boards and people, and a governed reader must know before typing.
 *   EXIT    — gh keeps exit codes in one topic because its are uniform. gov's differ per command, and AGENTS
 *             branch on them: the protocol has an agent run `task`, `merge`, `seed`.
 *
 * AUDIENCE groups the overview (Policy Owner's decision, 2026-09-23): `you` · `agent` · `maintainer`, declared
 * here and reviewed, never detected at run time — the groups describe intent, and anyone may run anything.
 */

export type Audience = "you" | "agent" | "maintainer";

export interface CommandSpec {
  readonly name: string;
  readonly audience: Audience;
  /** One line, as the overview prints it. Lower case, no full stop. */
  readonly summary: string;
  /** `<board-url> [--assignee <login>]` — arguments only; gov's own name is added. */
  readonly usage: string;
  /** Where it can run: PROJECT (inside a project), GOVERNED (the org home), anywhere. */
  readonly where?: string;
  readonly args?: readonly { readonly name: string; readonly what: string }[];
  readonly flags?: readonly { readonly name: string; readonly what: string }[];
  /** Two or three. The first should be the one most people type. */
  readonly examples: readonly string[];
  /** What it creates, pushes, assigns or deletes — the line no other CLI carries. */
  readonly changes?: string;
  /** Exit codes that mean something beyond "it worked" / "it did not". */
  readonly exit?: readonly { readonly code: number; readonly means: string }[];
  readonly seeAlso?: readonly string[];
}

const EXIT_USUAL = [
  { code: 0, means: "done" },
  { code: 1, means: "failed — nothing half-applied that gov could undo" },
  { code: 2, means: "usage: a missing or wrong argument" },
] as const;

/**
 * EVERY COMMAND gov HAS. A command missing from here has no help, which a test refuses — the drift that made
 * this work necessary cannot start again silently.
 */
export const COMMAND_SPECS: readonly CommandSpec[] = [
  // ── you ────────────────────────────────────────────────────────────────────────────────────────────────
  {
    name: "work", audience: "you",
    summary: "start or continue a project, and open your agent in it",
    usage: "[<project-id>] [--project <pattern>] [--agent <id>] [--seed] [--print-prompt]",
    where: "anywhere. Inside a project, it continues THAT project",
    args: [{ name: "<project-id>", what: "a project to open, e.g. PRJ-43-billing. Without one, gov asks" }],
    flags: [
      { name: "--project <pattern>", what: "match a project by a regular expression instead of picking from a list" },
      { name: "--agent <id>", what: "the agent to launch (`gov agent list` shows what your org approves)" },
      { name: "--seed", what: "allow STARTING a project nobody has started yet — org-visible, so never implied" },
      { name: "--print-prompt", what: "print the session-start prompt and stop: changes nothing, launches nothing" },
    ],
    examples: ["gov work", "gov work --project=billing", "gov work --project=PRJ-43-billing --agent=claude --print-prompt"],
    changes: "clones the project's repos if they are not here, puts each on the project branch, writes the agent harness and the governance snapshot into the project folder, and launches your agent",
    exit: [...EXIT_USUAL, { code: 1, means: "you have no write access to the project's board" }],
    seeAlso: ["seed", "join", "agent", "preferences"],
  },
  {
    name: "org", audience: "you",
    summary: "the governance workspaces on this machine, and which one is active",
    usage: "<add|use|list|remove> [<github_org>] [--home <path>]",
    args: [{ name: "<github_org>", what: "the organization, as GitHub spells it" }],
    flags: [{ name: "--home <path>", what: "where that org's governance repo is cloned (for `add`)" }],
    examples: ["gov org list", "gov org use acme", "gov org add acme --home ~/.gov/acme/gov_repo"],
    changes: "writes the machine's registry (~/.gov/workspaces and ~/.gov/active). Touches no repository",
    exit: EXIT_USUAL,
    seeAlso: ["setup", "doctor"],
  },
  {
    name: "doctor", audience: "you",
    summary: "check this machine: git, gh, the workspace, the active org, versions",
    usage: "[--fix] [--gov-home <path>]",
    where: "anywhere — it is the command for a machine that is not set up yet",
    flags: [
      { name: "--fix", what: "offer to install or configure what is missing, one step at a time, asking first" },
      { name: "--gov-home <path>", what: "check a workspace other than the active one" },
    ],
    examples: ["gov doctor", "gov doctor --fix"],
    changes: "nothing, unless `--fix` is given and you agree to a step; then it installs tools or writes git config",
    exit: [{ code: 0, means: "ready, or ready once you follow the notes" }, { code: 1, means: "something is missing that gov cannot work without" }],
    seeAlso: ["setup", "org", "upgrade"],
  },
  {
    name: "setup", audience: "you",
    summary: "set this machine up for an organization — the first `gov` run does this for you",
    usage: "[<github_org>/<repo>] [--non-interactive] [--path <dir>]",
    args: [{ name: "<github_org>/<repo>", what: "create a NEW governance repo for that org. Without it, configure the workspace you are in" }],
    flags: [
      { name: "--non-interactive", what: "never create anything and never ask; for CI" },
      { name: "--path <dir>", what: "where to put the clone" },
    ],
    examples: ["gov setup", "gov setup acme/acme-gov"],
    changes: "with an argument: creates the org's governance repository on GitHub, clones it, seeds the framework content, registers and activates it. Without one: configures the workspace you are standing in",
    exit: EXIT_USUAL,
    seeAlso: ["org", "doctor"],
  },
  {
    name: "upgrade", audience: "you",
    summary: "pull the latest framework content into this org (not the CLI — that is `npm i -g`)",
    usage: "[--apply] [--pr] [--ref <branch>] [--from <dir>]",
    where: "GOVERNED — the org's workspace",
    flags: [
      { name: "--apply", what: "make the changes. Without it, gov only says what it would do" },
      { name: "--pr", what: "put the changes in a pull request instead of the working tree" },
      { name: "--ref <branch>", what: "take the content from another branch of the framework" },
      { name: "--from <dir>", what: "take the content from a local directory instead of the template remote" },
    ],
    examples: ["gov upgrade", "gov upgrade --pr", "gov upgrade --apply"],
    changes: "with `--apply`: rewrites framework-owned files, leaves the org's own alone, merges org-config key by key, and removes what the new layout retires. With `--pr`: the same, on a branch, as a pull request",
    exit: EXIT_USUAL,
    seeAlso: ["doctor", "validate"],
  },
  {
    name: "preferences", audience: "you",
    summary: "your settings for gov: the agent it launches, the picker, colour, how long logs are kept",
    usage: "[list] | set <key> <value> | reset <key> | path",
    args: [{ name: "<key>", what: "a setting, e.g. work.picker.pageSize. `gov preferences` lists them all" }],
    examples: ["gov preferences", "gov preferences set work.picker.pageSize 25", "gov preferences reset agent.default"],
    changes: "writes your own preferences file. Affects nobody else, and never overrides what your organization requires",
    exit: EXIT_USUAL,
    seeAlso: ["work", "log"],
  },
  {
    name: "log", audience: "you",
    summary: "what gov did — one log per run, on this machine",
    usage: "[<run-id>] [--last] [--project <name>] [--limit <n>]",
    args: [{ name: "<run-id>", what: "the four characters a failure printed, e.g. 7f3a" }],
    flags: [
      { name: "--last", what: "the newest run: its folder, then its lines" },
      { name: "--project <name>", what: "only runs about that project" },
      { name: "--limit <n>", what: "how many to list (default 20)" },
    ],
    examples: ["gov log", "gov log --last", "gov log 7f3a"],
    changes: "nothing — it reads what earlier runs recorded",
    exit: [{ code: 0, means: "listed, or printed" }, { code: 1, means: "no organization on this machine yet" }],
    seeAlso: ["doctor", "preferences"],
  },
  {
    name: "agent", audience: "you",
    summary: "which AI agents your org approves, what is installed, and how to add one",
    usage: "[list | install <id> | approve <id>]",
    args: [{ name: "<id>", what: "an agent from the catalog, e.g. claude, ibm-bob, openai-codex" }],
    examples: ["gov agent list", "gov agent install ibm-bob", "gov agent approve claude"],
    changes: "`install` installs the vendor's tool on this machine (it shows the vendor's URL first and asks). `approve` opens a pull request against your org's agent policy — it does not decide it",
    exit: EXIT_USUAL,
    seeAlso: ["work", "preferences"],
  },

  // ── your agent runs these (you can too) ────────────────────────────────────────────────────────────────
  {
    name: "seed", audience: "agent",
    summary: "start a project from a GitHub Project board",
    usage: "<board-url> [--assignee <login>] [--clean [--consent]]",
    args: [{ name: "<board-url>", what: "the board this project is run from" }],
    flags: [
      { name: "--assignee <login>", what: "who the anchor issue is assigned to (default: you)" },
      { name: "--clean", what: "remove a half-finished earlier attempt first; needs --consent" },
    ],
    examples: ["gov seed https://github.com/orgs/acme/projects/43"],
    changes: "creates the project branch in the workspace and in every linked repo, pushes them, creates the anchor issue on the board and assigns it, and scaffolds projects/<id>/ with its knowledge files",
    exit: [...EXIT_USUAL, { code: 1, means: "a half-finished attempt is in the way — `--clean --consent` clears it" }],
    seeAlso: ["work", "join", "close"],
  },
  {
    name: "join", audience: "agent",
    summary: "join a project someone else started, on this machine",
    usage: "<board-url | project-id>",
    examples: ["gov join https://github.com/orgs/acme/projects/43", "gov join PRJ-43-billing"],
    changes: "clones the project's repos under the work root and checks each out on the project branch. Creates nothing on GitHub",
    exit: EXIT_USUAL,
    seeAlso: ["work", "seed"],
  },
  {
    name: "task", audience: "agent",
    summary: "start a task: a sub-branch for one or more issues, in every repo of the project",
    usage: "<issue-url>[,<issue-url>…]",
    where: "PROJECT — inside the project the issues belong to",
    args: [{ name: "<issue-url>", what: "a GitHub issue on this project's board. Several, comma-separated, share one branch" }],
    examples: [
      "gov task https://github.com/acme/app/issues/42",
      "gov task https://github.com/acme/app/issues/42,https://github.com/acme/app/issues/43",
    ],
    changes: "creates <project-branch>.ISSUE-<n> in the workspace and each code repo and pushes it; assigns the issues to you and moves them to In progress",
    exit: [...EXIT_USUAL, { code: 1, means: "the issue is closed, or you are not authorized on the board — nothing was created" }],
    seeAlso: ["merge", "work"],
  },
  {
    name: "merge", audience: "agent",
    summary: "land a task sub-branch back on the project branch",
    usage: "<issue-url | task-branch>",
    where: "PROJECT",
    examples: ["gov merge https://github.com/acme/app/issues/42", "gov merge BRNCH-43-billing.ISSUE-42"],
    changes: "merges the sub-branch into the project branch in every repo that has it, pushes, deletes the sub-branch, and closes the issue",
    exit: [...EXIT_USUAL, { code: 1, means: "the test-merge gate failed, or a repo refused the push — nothing was landed" }],
    seeAlso: ["task", "close"],
  },
  {
    name: "sync", audience: "agent",
    summary: "bring the project branch up to date with its base",
    usage: "", where: "PROJECT",
    examples: ["gov sync"],
    changes: "fast-forwards or merges the base branch into the project branch in each repo, and pushes",
    exit: EXIT_USUAL, seeAlso: ["work", "merge"],
  },
  {
    name: "add-repo", audience: "agent",
    summary: "add a code repository to the current project",
    usage: "<repo-url> [--base-branch <branch>]",
    where: "PROJECT",
    flags: [{ name: "--base-branch <branch>", what: "the branch the project branch is cut from (default: the org's)" }],
    examples: ["gov add-repo https://github.com/acme/api"],
    changes: "clones the repo under the project, creates and pushes the project branch in it, and links it to the board",
    exit: EXIT_USUAL, seeAlso: ["seed", "join"],
  },
  {
    name: "close", audience: "agent",
    summary: "close a finished project",
    usage: "", where: "PROJECT",
    examples: ["gov close"],
    changes: "runs the knowledge gate, merges the project branch to its base in every repo, opens the knowledge pull request, and closes the board",
    exit: [...EXIT_USUAL, { code: 1, means: "the knowledge gate refused — what is missing is named, and nothing was merged" }],
    seeAlso: ["merge", "knowledge"],
  },
  { name: "pause", audience: "agent", summary: "pause the current project", usage: "", where: "PROJECT",
    examples: ["gov pause"], changes: "labels the anchor issue and moves the board item — the project stays exactly where it is on disk",
    exit: EXIT_USUAL, seeAlso: ["resume", "cancel", "status"] },
  { name: "resume", audience: "agent", summary: "resume a paused project", usage: "", where: "PROJECT",
    examples: ["gov resume"], changes: "labels the anchor issue and moves the board item", exit: EXIT_USUAL, seeAlso: ["pause", "status"] },
  { name: "cancel", audience: "agent", summary: "cancel the current project", usage: "", where: "PROJECT",
    examples: ["gov cancel"], changes: "labels the anchor issue and closes the board. Branches and clones are left alone",
    exit: EXIT_USUAL, seeAlso: ["close", "pause"] },
  {
    name: "knowledge", audience: "agent",
    summary: "propose, submit or archive a change to the org's knowledge",
    usage: "<propose|submit|archive> <slug> [--description \"<text>\"]",
    where: "GOVERNED",
    args: [{ name: "<slug>", what: "a short kebab-case name for the change, e.g. deploy-policy" }],
    examples: ['gov knowledge propose deploy-policy', 'gov knowledge submit deploy-policy --description "why this changes"'],
    changes: "`propose` creates and pushes a knowledge branch; `submit` opens the pull request to whoever owns that area; `archive` retires a knowledge file on a branch",
    exit: EXIT_USUAL, seeAlso: ["close", "validate"],
  },
  {
    name: "issue", audience: "agent",
    summary: "create an issue — assigned to you, on the board",
    usage: "[<org>/<repo>] --title <t> [--body <b>|--body-file <f>] [--board <n>]  |  --from <upstream-issue-url> [--board <n>]",
    flags: [
      { name: "--title <t>", what: "the issue's title" },
      { name: "--body <b> · --body-file <f>", what: "its body, inline or from a file" },
      { name: "--from <url>", what: "mirror an upstream issue into this org" },
      { name: "--board <n>", what: "the board to add it to (default: the current project's)" },
    ],
    examples: ['gov issue --title "the picker paginates unevenly"', "gov issue --from https://github.com/other/repo/issues/9"],
    changes: "creates the issue on GitHub, assigns it to you, and adds it to the board",
    exit: EXIT_USUAL, seeAlso: ["task", "manage"],
  },
  { name: "list", audience: "agent", summary: "list YOUR active projects", usage: "[--page <n>] [--limit <n>]",
    examples: ["gov list"], changes: "nothing", exit: EXIT_USUAL, seeAlso: ["list-all", "status", "work"] },
  { name: "list-all", audience: "agent", summary: "list ALL the org's projects", usage: "[--page <n>] [--limit <n>]",
    examples: ["gov list-all"], changes: "nothing", exit: EXIT_USUAL, seeAlso: ["list", "manage"] },
  { name: "status", audience: "agent", summary: "the current project's status, owners and board",
    usage: "[<project-id | board-number>]", examples: ["gov status", "gov status PRJ-43-billing"],
    changes: "nothing", exit: EXIT_USUAL, seeAlso: ["list", "anchor"] },
  { name: "anchor", audience: "agent", summary: "show the current project's anchor issue", usage: "", where: "PROJECT",
    examples: ["gov anchor"], changes: "nothing", exit: EXIT_USUAL, seeAlso: ["status", "manage"] },
  {
    name: "manage", audience: "agent", summary: "project access — assign and unassign owners",
    usage: "<assign|unassign> <github-login> [--board <n>]",
    examples: ["gov manage assign @alice", "gov manage unassign @bob --board 43"],
    changes: "assigns or unassigns the person on the project's anchor issue, which is what grants access",
    exit: EXIT_USUAL, seeAlso: ["status", "list-all"],
  },
  {
    name: "onboard", audience: "agent", summary: "onboard a repository into the framework",
    usage: '<repo-url> --owner <owner> --description "<text>"',
    examples: ['gov onboard https://github.com/acme/api --owner platform --description "the public API"'],
    changes: "adds the repo's knowledge scaffold and registers it for the org",
    exit: EXIT_USUAL, seeAlso: ["add-repo", "knowledge"],
  },
  {
    name: "validate", audience: "agent", summary: "validate the workspace, or the shipped content",
    usage: "[--suite <name>]", examples: ["gov validate"],
    changes: "nothing — it reads and reports", exit: [{ code: 0, means: "everything the validators check passed" }, { code: 1, means: "at least one validator failed; each is named" }],
    seeAlso: ["doctor", "knowledge"],
  },

  // ── building gov itself (hidden from the overview) ─────────────────────────────────────────────────────
  {
    name: "bump-version", audience: "maintainer", summary: "bump the CLI and content version together",
    usage: "<x.y.z>", examples: ["gov bump-version 1.3.0"],
    changes: "writes publish/actions/ts/package.json and publish/content/VERSION in the framework repo",
    exit: EXIT_USUAL, seeAlso: ["publish"],
  },
  {
    name: "publish", audience: "maintainer", summary: "the pre-publish gate — never publishes by hand",
    usage: "", examples: ["gov publish"],
    changes: "nothing: it runs the readiness gate (version-sync) and reports. Publishing is gov-cicd's",
    exit: [{ code: 0, means: "ready to publish" }, { code: 1, means: "a blocker; each is named" }],
    seeAlso: ["bump-version", "validate"],
  },
  {
    name: "deps", audience: "maintainer", summary: "retired — `gov doctor` reports the same prerequisites",
    usage: "", examples: ["gov doctor"], changes: "nothing", exit: [{ code: 2, means: "it says where it went" }],
    seeAlso: ["doctor"],
  },
];

export const specOf = (name: string): CommandSpec | undefined => COMMAND_SPECS.find((c) => c.name === name);
export const specsFor = (audience: Audience): CommandSpec[] => COMMAND_SPECS.filter((c) => c.audience === audience);
