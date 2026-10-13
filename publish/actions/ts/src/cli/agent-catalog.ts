// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Which agents gov may offer, and what it knows about each (#195).
 *
 * The menu used to be four hard-coded lines — Claude, cursor, Cursor GUI, shell —
 * offered whole to a machine with none of them installed, and led by a tool the
 * policy the same install had just seeded lists as prohibited.
 *
 * WHAT MAKES AN AGENT OFFERABLE IS A HARNESS. `agent/harness-manifest.yaml` renders
 * a rules file per tool — CLAUDE.md, .cursor/rules/agent.mdc, .clinerules/agent.md
 * and the rest — and that file is how the session protocol reaches the agent at all.
 * A tool with no harness would be launched into a project it cannot read the rules
 * of, which is worse than not offering it. So the manifest is the list, and a test
 * holds this file to it rather than a second hand-kept copy drifting from the first
 * — the same fix as ADOPTER_DIRS against MANIFEST.yaml and the itinerary against
 * the checklist.
 *
 * HOW THE RULES ARRIVE differs, and the menu should say so:
 *
 *   cli   gov passes the protocol as an argument      claude "<protocol>"
 *   ide   gov opens the folder; the tool's own agent reads the rules from the repo
 *
 * Both are governed. "Run an agent" and "open my editor here" are still not the
 * same offer, and one undifferentiated row said they were.
 */

export type LaunchKind = "cli" | "ide" | "none";

/**
 * Where an agent comes from. `script` is the https URL of the VENDOR'S OWN install script; gov downloads it once,
 * verifies it, and runs those exact bytes with bash (vendor-script.ts, #205, ruling Q16 C).
 *
 * `scriptSha256` would PIN IT: a different script is refused, naming both digests. No catalog entry is pinned
 * (D1, 2026-10-13): a vendor's script change must never block installs, so gov shows the URL and digest and asks.
 */
export interface AgentInstall {
  readonly npm?: string;
  readonly brew?: string;
  readonly script?: string;
  readonly scriptSha256?: string;
  readonly pip?: string;
  readonly url: string;
}

/**
 * One way to run an approved agent (#196, Q8). The policy approves the AGENT — its
 * real question is which provider may see your code, and that does not change
 * between a CLI and an extension of the same tool — so a single approval brings all
 * of its variants.
 */
export interface AgentVariant {
  readonly kind: "cli" | "editor" | "extension";
  readonly label: string;
  /** The command to probe and to launch. Extensions have none of their own. */
  readonly cmd?: string;
  /** npm package, or the https URL of a vendor's install script (with its optional pin — see AgentInstall). */
  readonly install?: AgentInstall;
  /** For extensions: the marketplace id, installed through the host's own CLI. */
  readonly extensionId?: string;
  /** The hosts that can carry this extension, in preference order. */
  readonly hosts?: readonly string[];
  /** The agent's own login command, when it has one — tier 1 of the sign-in design. */
  readonly login?: readonly string[];
}

export interface AgentCandidate {
  /** Matches the harness manifest's `id`, which is what makes this list checkable. */
  readonly id: string;
  readonly tool: string;
  readonly launch: LaunchKind;
  /** The executable to probe and to run. Absent when gov cannot launch it. */
  readonly cmd?: string;
  /**
   * How to install it. `npm` is a named package from a named publisher; `script` is
   * a vendor's own installer, downloaded once and verified before bash runs it (#205). gov
   * runs either — but only for an agent the org has approved, because approval IS the trust
   * decision about the vendor (#196, Q2); the digest is the check on the bytes.
   */
  readonly install?: AgentInstall;
  /** The environment variable that would hold a key, so gov can report its absence. */
  readonly credentialEnv?: string;
  /**
   * Known to gov, NOT yet offered at adoption (Policy Owner, 2026-09-10).
   *
   * A launch list of ten is ten paths a real adopter can take, of which two have verified
   * prompt delivery. The decision was to make a smaller list foolproof first and expand from
   * there — so these entries keep their catalog knowledge, their manifest parity and their
   * tests, and simply do not appear in the Q12 menu.
   *
   * DEFERRAL AFFECTS THE MENU ONLY. An organization that already approved one of these keeps
   * working: `approvedAgents` still resolves it, `agentLaunchSpec` still launches it. Upgrading
   * gov must never take an agent away from an org that is using it.
   */
  readonly deferred?: true;
  /**
   * It opens its own browser the first time it needs to authenticate (#208).
   *
   * The THIRD sign-in shape, and the one the code did not have. gov had two — a `login`
   * subcommand to run, or an API key to ask for — so "no login command" was read as "needs a
   * key", and an adopter was asked for a BOB_API_KEY by a tool that then opened a browser on
   * its own. `credentialEnv` may still be set alongside this: a key is how the agent runs
   * HEADLESS, where no browser can be opened. It means a key CAN be used, never that gov
   * should ask for one.
   */
  readonly signsInItself?: true;
  /** Where a tier-2 key belongs — the agent's own config, never gov's. */
  readonly credentialFile?: string;
  /**
   * How this agent takes the session-start prompt, with `{prompt}` substituted (#207).
   *
   * ABSENT MEANS GOV DOES NOT KNOW, and it does not guess. Every `cli` agent used to be
   * handed the prompt as a bare positional, which is right for the two that were checked
   * and wrong for `bob`, which takes none: "too many arguments. Expected 0 arguments but
   * got 1." — after a clean install and a "Starting it in…".
   *
   * Where it is absent the agent is launched bare and the prompt is printed to paste. The
   * harness file this catalog exists to guarantee — AGENTS.md, CLAUDE.md, the cursor rule —
   * is what actually governs the session; the prompt only makes the agent speak first.
   * Filling these in means running each vendor's CLI and recording what it accepts.
   */
  readonly promptArgv?: readonly string[];
  /**
   * FOR AN AGENT WHOSE FIRST-MESSAGE MODE ENDS THE SESSION (PRJ-121, 2026-09-22).
   *
   * Some agents take a first message only in a one-shot mode: they run it, print a task id and exit. Handing
   * such an agent the protocol "as its first message" answers the protocol and then leaves the person at a
   * shell — the manifest says "Awaiting your direction" to nobody. `resume` reopens that conversation
   * interactively: `argv` with `{taskId}` read from the first run's output by `taskIdPattern`; `pickerArgv` when
   * no id could be read, which opens the agent's own list of tasks rather than guessing.
   */
  readonly resume?: { readonly argv: readonly string[]; readonly pickerArgv: readonly string[]; readonly taskIdPattern: RegExp };
  /**
   * HOW TO RUN IT WITH NOBODY AT THE TERMINAL, with `{prompt}` substituted (PRJ-121 intent 03, L16; 03-Q16).
   *
   * `gov autorun` runs an agent headless: it takes the prompt, works, prints, and EXITS with a code gov reads. The
   * opposite of `promptArgv`, which must keep the session open — for several vendors the same `-p` is the trap
   * there and the answer here.
   *
   * ABSENT MEANS GOV WILL NOT RUN IT HEADLESS, and says why (03-Q16 (b)). An agent launched "interactively, and
   * hope" with no TTY hangs a run on a question nobody will answer. Set only after running the vendor's CLI with
   * exactly this argv and seeing it answer and exit; `headlessVerified` records that run.
   *
   * PERMISSIONS ARE NOT GRANTED HERE. No `--dangerously-skip-permissions`, `--force` or `--yolo`: what a headless
   * agent may do is the agent's own settings in the project (e.g. `.claude/settings.json`), which the organization
   * controls — gov does not widen it by a flag nobody reviewed.
   */
  readonly headlessArgv?: readonly string[];
  /** `YYYY-MM-DD <cli> <version>: what was run and seen` — required wherever `headlessArgv` is set (a test holds it). */
  readonly headlessVerified?: string;
  /**
   * WHERE THIS AGENT LOADS SKILLS FROM, relative to the directory it runs in (intent 03 spec §5, D6; L15).
   *
   * ABSENT MEANS GOV HAS NOT SEEN IT WORK — the `promptArgv` rule. A location goes here only after that vendor's
   * own CLI was run and seen to load a skill from it, and `skillsVerified` says when, on which version, and how.
   * An agent without one still gets every skill: its harness file carries an index — "when a task matches X, read
   * `.agents/skills/<name>/SKILL.md`" (Q14, skills/fallback-index.ts). A test holds the two fields together.
   */
  readonly skillsDir?: string;
  /** The dated note for `skillsDir`: `YYYY-MM-DD <cli> <version>: what was run and what it showed`. */
  readonly skillsVerified?: string;
  /** Where to go to create an account, when there is no automating it. */
  readonly signupUrl?: string;
  /** Every way to run it. The policy approves the agent; this is what that buys. */
  readonly variants?: readonly AgentVariant[];
  /**
   * Who sells it — named when an account or a bill stops it running, because that is between the person and
   * this company, not gov (F24). Absent: "the vendor".
   */
  readonly vendor?: string;
  /**
   * What this agent prints when its ACCOUNT stops it — a trial over, a plan or quota used up, a key the vendor
   * no longer accepts (F24). Checked before the generic set in agent-account.ts. Only text SEEN from the vendor's
   * own CLI belongs here; the generic set covers the rest.
   */
  readonly accountFailures?: readonly AccountFailurePattern[];
}

/** One recognisable account or billing failure: the text, and what it means in plain words ("its …"). */
export interface AccountFailurePattern {
  readonly pattern: RegExp;
  readonly reason: string;
}

/**
 * Every harness the framework renders. `launch: "none"` entries are governed but
 * not startable from here — a browser tool has no command to run.
 */
/*
 * HOW EACH AGENT TAKES A FIRST MESSAGE — read from the vendors' own `--help`, in a container,
 * on 2026-09-11 (#207, and the resolution of #6).
 *
 * This was unverified for seven of nine agents for weeks, on the reasoning that guessing a
 * vendor's flags is worse than pasting. That reasoning was right; not looking was not. Every
 * one of them takes a prompt, IBM Bob included, and the version each was read from is recorded
 * beside it so a flag that changes is a diff rather than a mystery.
 *
 * THE TRAP, AND IT IS NOT SUBTLE ONCE SEEN. For `gemini` and `copilot`, `-p/--prompt` is the
 * NON-INTERACTIVE flag: it runs the prompt and exits. Using it would deliver the session-start
 * protocol and then throw away the session it was meant to govern — a launch that reports
 * success and leaves the adopter at a shell. `-i` is the interactive form for both. `cn` has
 * the same shape (`-p, --print` prints and exits), so its bare positional is the right one.
 *
 * WHAT IS VERIFIED, PRECISELY: that the flag exists and what the vendor says it does. Whether
 * the agent then runs the protocol needs a credential and a real session, which is the walk.
 */
/**
 * IBM's `bobshell.sh` is UNPINNED, like Cursor's `install` (D1, 2026-10-13, revising Q16 C's pin): gov shows the
 * URL and the digest of what it downloaded and asks. Accepted trade-off: an IBM script change never blocks an
 * install, and a tampered script would run once the person says yes.
 */
export const AGENT_CATALOG: readonly AgentCandidate[] = [
  // promptArgv verified in use: both take the first message as a bare positional.
  { id: "claude-code", tool: "Claude Code", launch: "cli", cmd: "claude", promptArgv: ["{prompt}"],
    // claude 2.1.272 --help: `-p, --print  Print response and exit`; `--output-format  (only works with --print):
    // "text" (default), "json", "stream-json"`. Plain text, so a C01 id the agent prints is read as written.
    headlessArgv: ["-p", "{prompt}", "--output-format", "text"],
    headlessVerified: "2026-10-12 claude 2.1.272 (macOS): `claude -p \"Reply with exactly: ok\" --output-format text` "
      + "with stdin closed printed `ok` and exited 0, no TTY, no prompt",
    skillsDir: ".claude/skills",
    skillsVerified: "2026-10-12 claude 2.1.272: RUN — a scratch git repo holding .claude/skills/gov-verify-zebra/SKILL.md "
      + "(front matter name, description, gov-ids, policy-version); `claude -p \"Use the gov-verify-zebra skill …\" "
      + "--output-format json` invoked the Skill tool with gov-verify-zebra and answered the codeword only that file held (L14).",
    install: { npm: "@anthropic-ai/claude-code", url: "https://claude.com/claude-code" },
    credentialEnv: "ANTHROPIC_API_KEY", signupUrl: "https://claude.com/claude-code", vendor: "Anthropic",
    accountFailures: [
      { pattern: /credit balance is too low/i, reason: "its account's credit balance is too low" },
      { pattern: /invalid api key/i, reason: "its API key is invalid or has expired" },
    ],
    variants: [
      { kind: "cli", label: "in the terminal", cmd: "claude",
        install: { npm: "@anthropic-ai/claude-code", url: "https://claude.com/claude-code" },
        login: ["claude", "/login"] },
      { kind: "extension", label: "in VS Code", extensionId: "anthropic.claude-code", hosts: ["code", "cursor", "windsurf"] },
    ] },
  { id: "cursor", tool: "Cursor", launch: "cli", cmd: "cursor-agent", promptArgv: ["{prompt}"],
    // NO headlessArgv YET — NOT SEEN TO ANSWER (2026-10-12, L16). cursor-agent 2026.07.16-899851b --help lists
    // `-p, --print  Print responses to console (for scripts or non-interactive use)`, `--output-format text|json|
    // stream-json (only works with --print)` and `--trust  Trust the current workspace without prompting (only works
    // with --print/headless mode)`. The candidate is ["-p", "{prompt}", "--output-format", "text", "--trust"]. Run
    // once with it, it exited 1 without prompting — "Authentication required. Please run 'agent login' first" — so
    // it is non-interactive, but no answer was seen. Set it after one signed-in run prints an answer and exits 0.
    // NOT YET RUN-VERIFIED — kept as L14 placed it, by the lead's decision, until a logged-in run confirms it. The
    // same CLI's bundle (2026.07.16-899851b) also scans .agents/skills, .claude/skills and .codex/skills in the
    // project, so once a run confirms the loader, .agents/skills (one copy, shared) is the better home.
    skillsDir: ".cursor/skills",
    skillsVerified: "2026-10-12 cursor-agent 2026.07.16-899851b: DOC ONLY — its bundled create-skill skill "
      + "(~/.cursor/skills-cursor/create-skill/SKILL.md) gives the project location .cursor/skills/<name>/; a run was "
      + "refused (\"Authentication required\": not logged in on this machine, and gov's tasks never touch credentials). "
      + "Re-verify by a run.",
    install: { script: "https://cursor.com/install", url: "https://cursor.com/cli" },
    signupUrl: "https://cursor.com", vendor: "Cursor",
    variants: [
      { kind: "cli", label: "in the terminal", cmd: "cursor-agent",
        install: { script: "https://cursor.com/install", url: "https://cursor.com/cli" },
        login: ["cursor-agent", "login"] },
      // The editor IS the agent here — there is no Cursor extension for someone
      // else's host — so choosing it means installing an editor. That is the one
      // case where gov may (#196, Q7).
      { kind: "editor", label: "the Cursor editor", cmd: "cursor", install: { url: "https://cursor.com/downloads" } },
    ] },
  { id: "openai-codex", tool: "OpenAI Codex", launch: "cli", cmd: "codex",
    // codex --help: `[PROMPT]  Optional user prompt to start the session` (read 2026-09-11)
    promptArgv: ["{prompt}"],
    install: { npm: "@openai/codex", url: "https://developers.openai.com/codex/cli" },
    credentialEnv: "OPENAI_API_KEY", signupUrl: "https://platform.openai.com/signup", vendor: "OpenAI",
    accountFailures: [
      { pattern: /exceeded your current quota/i, reason: "its account has run out of quota on its plan" },
    ],
    variants: [
      { kind: "cli", label: "in the terminal", cmd: "codex",
        install: { npm: "@openai/codex", url: "https://developers.openai.com/codex/cli" },
        login: ["codex", "login"] },
      { kind: "extension", label: "in VS Code", extensionId: "openai.chatgpt", hosts: ["code", "cursor", "windsurf"] },
    ] },
  { id: "gemini-code-assist", tool: "Gemini Code Assist", launch: "cli", cmd: "gemini",
    // gemini 0.59.0: `-i, --prompt-interactive  Execute the provided prompt and continue in
    // interactive mode`. NOT `-p`, which is headless and exits (read 2026-09-11).
    promptArgv: ["-i", "{prompt}"],
    // .agents/skills, not .gemini/skills: gemini reads BOTH, and the same name in both is a "Skill conflict
    // detected" warning — so it shares the fallback copy every index-only agent is pointed at, and there is one.
    skillsDir: ".agents/skills",
    skillsVerified: "2026-10-12 gemini 0.31.0: CLI LISTING — in a scratch git repo, `gemini skills list` (run with a "
      + "placeholder GEMINI_API_KEY only to pass its auth-method gate; no model call is made) discovered "
      + ".agents/skills/gov-verify-agents/SKILL.md and .gemini/skills/gov-verify-gem/SKILL.md with gov's front matter "
      + "(name, description, gov-ids, policy-version) as [Enabled] workspace skills. No model run: no credentials here.",
    install: { npm: "@google/gemini-cli", url: "https://github.com/google-gemini/gemini-cli" },
    credentialEnv: "GEMINI_API_KEY", signupUrl: "https://aistudio.google.com/apikey", vendor: "Google",
    variants: [
      { kind: "cli", label: "in the terminal", cmd: "gemini",
        install: { npm: "@google/gemini-cli", url: "https://github.com/google-gemini/gemini-cli" } },
      { kind: "extension", label: "in VS Code", extensionId: "Google.geminicodeassist", hosts: ["code", "cursor", "windsurf"] },
    ] },
  { id: "github-copilot", tool: "GitHub Copilot", launch: "cli", cmd: "copilot",
    // copilot 1.0.83: `-i, --interactive <prompt>  Start interactive mode and automatically
    // execute this prompt`. NOT `-p`, which is non-interactive (read 2026-09-11).
    promptArgv: ["-i", "{prompt}"],
    install: { npm: "@github/copilot", url: "https://github.com/features/copilot/cli" },
    signupUrl: "https://github.com/features/copilot", vendor: "GitHub",
    variants: [
      { kind: "cli", label: "in the terminal", cmd: "copilot",
        install: { npm: "@github/copilot", url: "https://github.com/features/copilot/cli" } },
      { kind: "extension", label: "in VS Code", extensionId: "GitHub.copilot", hosts: ["code", "cursor", "windsurf"] },
    ] },
  // A standalone editor, like Cursor: the editor IS the agent, so there is no
  // extension for someone else's host.
  // EDITOR ONLY, and deliberately so — two near-misses are recorded here because both
  // look like the answer.
  //
  // 1. `windsurf` on npm is NOT the vendor's: v0.0.1, description "Coming soon.",
  //    maintainer `colin@edgedb.com`. Exactly the #201 shape.
  // 2. `curl -fsSL https://cli.devin.ai/install.sh | bash` IS Cognition's (they own
  //    Windsurf), and it even has a `curl-bash-windsurfcom` distribution — but it sets
  //    `BINARY_NAME="devin"`. It installs the DEVIN CLI, a different product from the
  //    Windsurf editor. Adding it here would give this entry a binary it does not have.
  //
  // A Devin entry would be legitimate on its own, once someone records which
  // instructions file it reads — an agent gov can launch but cannot hand a session
  // protocol to is worse than one it refuses (harness-manifest.yaml).
  { deferred: true, // DEFERRED (2026-09-10): gov can install NOTHING for it: the editor is a desktop download, and `windsurf`
  // on npm is not the vendor's (v0.0.1, maintainer colin@edgedb.com).
    id: "windsurf", tool: "Windsurf", launch: "ide", cmd: "windsurf",
    install: { url: "https://windsurf.com/editor" },
    variants: [{ kind: "editor", label: "the Windsurf editor", cmd: "windsurf", install: { url: "https://windsurf.com/editor" } }] },
  // A CLI NOW — this entry said "there is no Cline CLI" and was true when written. Cline
  // shipped one (npm `cline`, v3.0.61+), so the old comment made gov offer an agent it
  // could neither install nor launch, and the menu told an adopter with no editor that
  // they could not use it. Provenance checked the #201 way before the package name was
  // written down: repository `github.com/cline/cline`, maintainers all `@cline.bot`.
  // Binary is `cline` (npm `bin: { cline: "bin/cline" }`).
  { id: "cline", tool: "Cline / Roo Code", launch: "cli", cmd: "cline",
    // cline 3.0.61: `[prompt]  Your prompt. Default to start in act mode` (read 2026-09-11)
    promptArgv: ["{prompt}"],
    install: { npm: "cline", url: "https://cline.bot" }, vendor: "Cline",
    variants: [
      { kind: "cli", label: "in the terminal", cmd: "cline", install: { npm: "cline", url: "https://cline.bot" } },
      { kind: "extension", label: "in VS Code", extensionId: "saoudrizwan.claude-dev", hosts: ["code", "cursor", "windsurf"] },
    ] },
  // Also a CLI now, and the BINARY IS NOT THE ID: npm `@continuedev/cli` installs `cn`
  // (`bin: { cn: "dist/cn.js" }`). Recording `cmd: "continue"` would have produced a
  // command-not-found after a successful install — the shape #199 exists to prevent.
  // Provenance: repository `github.com/continuedev/continue`, maintainers `@continue.dev`.
  { id: "continue", tool: "Continue.dev", launch: "cli", cmd: "cn",
    // cn 1.5.47: `[prompt]  Optional prompt to send to the assistant`. The bare positional,
    // not `-p, --print`, which prints and exits (read 2026-09-11).
    promptArgv: ["{prompt}"],
    install: { npm: "@continuedev/cli", url: "https://continue.dev" }, vendor: "Continue",
    variants: [
      { kind: "cli", label: "in the terminal", cmd: "cn", install: { npm: "@continuedev/cli", url: "https://continue.dev" } },
      { kind: "extension", label: "in VS Code", extensionId: "Continue.continue", hosts: ["code", "cursor", "windsurf"] },
    ] },
  // IBM Bob — a CLI and a STANDALONE IDE, not a VS Code extension (verified against
  // IBM's own quickstart: "Bob is a standalone IDE application and not an
  // extension"). Reads AGENTS.md, which the framework already renders, so it needed
  // no new harness.
  //
  // NO npm COORDINATE, DELIBERATELY (#201). This entry carried `npm: "@bobsworkshop/cli"`,
  // which is not IBM's: one maintainer, `topseedr2infinity`, repo `Topseeder1/bob-cli`,
  // first published 2026-06-06. `planAgentInstall` prefers npm over script, so an
  // Infrastructure Owner who approved "IBM Bob" — and per #196 Q2 that approval IS the
  // trust decision — got `npm install -g` of a stranger's package every time. IBM ships
  // through bob.ibm.com, whose certificate is issued to International Business Machines
  // Corporation; that is the only channel here. Restore an npm package only when it sits
  // in an IBM-owned scope, and let `every-npm-package-is-the-vendor's` say so.
  { id: "ibm-bob", tool: "IBM Bob", launch: "cli", cmd: "bob",
    install: { script: "https://bob.ibm.com/download/bobshell.sh", url: "https://bob.ibm.com" },
    // Verified on a container: Bob prints its own sign-in URL and waits (#208).
    //
    // `-p` IS ONE-SHOT — corrected 2026-09-22 on a walk (bob 2.0.4). This comment used to say `-p` hands the
    // protocol over "as its first message" and stop there, which was checked only as far as Bob ACCEPTING the
    // flag. What it DOES: runs the prompt, prints a transcript, `Task Summary · Total Cost · Task ID`, and EXITS.
    // So the walk got a correct context manifest ending "Awaiting: your direction" — and a shell prompt. The
    // first launch agreed: refusing the licence, Bob said "Launch Bob Shell in interactive mode".
    //
    // `bob chat` is the interactive client and takes no first message (`bob chat --help`). But
    // `bob chat --resume <task-id>` reopens a task WITH its history — verified on the walk: the prompt, the
    // answer, and the context and cost carried over. So: `-p` delivers the protocol, `resume` hands the person
    // the live session. Tasks are per user and per machine (a resume from another container: "No task found").
    promptArgv: ["-p", "{prompt}"],
    // NO skillsDir (L15, 2026-10-12): bob 2.0.2's bundle documents `.bob/skills/<name>/SKILL.md`, but it has no
    // listing command and a run needs a signed-in account, so nothing was SEEN loading. It reads the index in
    // AGENTS.md until a run confirms the location.
    resume: { argv: ["chat", "--resume", "{taskId}"], pickerArgv: ["chat", "--resume"], taskIdPattern: /Task ID:\s+([0-9a-f]{32})/ },
    credentialEnv: "BOB_API_KEY", signsInItself: true, signupUrl: "https://bob.ibm.com", vendor: "IBM",
    // SEEN on a container walk, 2026-10-08 (F24): "Error: Your Free trial has expired. You have reached the end of
    // your free trial period. Upgrade your plan to continue." gov called it a first-run step and offered Bob again.
    accountFailures: [
      { pattern: /free trial (has )?expired|end of your free trial/i, reason: "its account's free trial has expired" },
    ],
    variants: [
      // No login subcommand: Bob Shell opens the browser itself when it needs to
      // authenticate, so there is nothing for gov to run — which is tier 1 working
      // exactly as intended, with gov never near the credential.
      { kind: "cli", label: "in the terminal", cmd: "bob",
        install: { script: "https://bob.ibm.com/download/bobshell.sh", url: "https://bob.ibm.com" } },
      { kind: "editor", label: "the Bob IDE", cmd: "bob-ide", install: { url: "https://bob.ibm.com/download" } },
    ] },
  { id: "aider", tool: "Aider", launch: "cli", cmd: "aider",
    // PyPI, not npm — and npm `aider` is a SQUAT (v1.0.1, maintainer 36634584@qq.com), which is
    // why the obvious guess was never taken. `aider-chat` is the project's own distribution.
    install: { pip: "aider-chat", url: "https://aider.chat" }, credentialEnv: "OPENAI_API_KEY" },
  // No command, by nature. Kept so the catalog and the manifest agree, and so
  // nobody adds it to the menu later by mistake.
  { id: "chatgpt-web", tool: "ChatGPT (web) / custom GPT", launch: "none",
    install: { url: "https://chat.openai.com" } },
];

/** The Cursor editor, which is a launch target rather than its own harness. */
export const CURSOR_GUI: AgentCandidate = { id: "cursor", tool: "Cursor (editor)", launch: "ide", cmd: "cursor" };

export interface AgentStatus {
  readonly candidate: AgentCandidate;
  readonly installed: boolean;
  /** Null when gov cannot tell — which is not the same as "no". */
  readonly credentialPresent: boolean | null;
}

/**
 * What is actually on this machine. `hasTool` and `env` are injected, so the whole
 * decision is decidable without a shell.
 */
export function agentStatuses(
  candidates: readonly AgentCandidate[],
  hasTool: (cmd: string) => boolean,
  env: Readonly<Record<string, string | undefined>>,
): readonly AgentStatus[] {
  return candidates.map((c) => ({
    candidate: c,
    installed: Boolean(c.cmd && hasTool(c.cmd)),
    credentialPresent: c.credentialEnv ? Boolean(env[c.credentialEnv]) : null,
  }));
}

/**
 * The approved set. An org that has not decided yet gets the framework's own list,
 * and is told so — an empty menu on day one would make the feature useless exactly
 * when it is needed most.
 *
 * AN EMPTY LIST IS A DECISION, NOT A GAP (Policy Owner, 2026-09-28). `null` means nobody has
 * answered; `[]` means the organization authorized NO agents — structure-only — and
 * `config/approved-agents.ts` now keeps those two apart. Both used to land in the fallback below,
 * so an org that had explicitly chosen to run no agents was shown the whole framework catalogue as
 * "yours by default": the unowned state #196 removed at adoption, re-created at the one moment the
 * org had already answered. `structureOnly` says WHICH empty menu this is, so a caller can explain
 * instead of showing nothing.
 */
export function approvedAgents(orgApproved: readonly string[] | null): {
  readonly ids: readonly string[]; readonly usingDefaults: boolean; readonly structureOnly: boolean;
} {
  if (orgApproved && orgApproved.length) return { ids: orgApproved, usingDefaults: false, structureOnly: false };
  if (orgApproved) return { ids: [], usingDefaults: false, structureOnly: true };
  // THE FALLBACK MUST NOT OFFER MORE THAN ADOPTION DOES. A walk saw all ten listed here,
  // Windsurf included — gov proposing, as an organization's defaults, agents its own adoption
  // menu declines to offer. `deferred` means "not offered"; that has to hold on every path
  // that shows a list, not only the one that asks the question.
  return { ids: AGENT_CATALOG.filter((a) => !a.deferred).map((a) => a.id), usingDefaults: true, structureOnly: false };
}

/**
 * The instructions file this agent reads, relative to the project root — or null when gov has
 * no way to govern its session except by handing it a first message.
 *
 * WHY THIS MATTERS MORE THAN A PROMPT. No CLI agent speaks first; every one of them waits for
 * input. gov once leaned on a Claude-only SessionStart hook to close that gap, and the hook was
 * removed (2026-09-11) — not because it failed, but because a mechanism one vendor has makes
 * that vendor the better-governed choice for a reason unrelated to the agent, and it biases the
 * selection at Q12.
 *
 * It cost nothing to remove, because an instructions file read on EVERY TURN was always the
 * stronger half: it governs the whole session rather than its opening. So when this returns a
 * path, gov's job is done by `ensureRootProtocol` mirroring the file and `verifyAgentContext`
 * refusing to launch if it did not land — and the honest instruction to the human is "say
 * anything", not "paste these five lines".
 *
 * Kept beside the catalog and matching `agent/harness-manifest.yaml`, which is what renders
 * them. An agent absent from both is ungoverned, and gov says so rather than implying otherwise.
 */
export function harnessFileFor(agentId: string): string | null {
  switch (agentId) {
    case "claude-code": return "CLAUDE.md";
    case "openai-codex": case "ibm-bob": return "AGENTS.md";
    case "cursor": return ".cursor/rules/agent.mdc";
    case "cline": return ".clinerules/agent.md";
    // `.continue/rules/` is a DIRECTORY the CLI scans for markdown rule files, not a file —
    // verified in @continuedev/cli, which builds `rulesDirs = [path.join(cwd, ".continue",
    // "rules"), …]` and scans them. gov shipped `.continue/rules.md`, so Continue read nothing.
    // The fourth instance of this class, after .clinerules, AGENTS.md and .gemini/styleguide.md
    // — and the first one found by a tool rather than by a person noticing.
    case "continue": return ".continue/rules/agent.md";
    // GEMINI.md, NOT .gemini/styleguide.md (Decision 15, 2026-09-14). Verified against the
    // published @google/gemini-cli 0.59.0: `contextFileName` defaults to "GEMINI.md", which
    // appears 227 times in the package; `styleguide.md` appears nowhere. The styleguide is
    // Gemini Code Assist's GitHub CODE-REVIEW file — a different product surface — so the CLI
    // this catalog launches was receiving no protocol at all, and `verifyAgentContext` passed
    // throughout because it checks the file gov PLACED, not the file the agent READS.
    case "gemini-code-assist": return "GEMINI.md";
    case "github-copilot": return ".github/copilot-instructions.md";
    case "windsurf": return ".windsurf/rules/agent.md";
    case "aider": return "CONVENTIONS.md";
    default: return null;
  }
}

/** Offerable = approved, launchable, and actually here. */
export function offerable(statuses: readonly AgentStatus[], approvedIds: readonly string[]): readonly AgentStatus[] {
  return statuses.filter((s) => s.installed && s.candidate.launch !== "none" && approvedIds.includes(s.candidate.id));
}

/** Approved, launchable, and missing — the ones worth offering to install. */
export function installable(statuses: readonly AgentStatus[], approvedIds: readonly string[]): readonly AgentStatus[] {
  return statuses.filter((s) => !s.installed && s.candidate.launch !== "none" && s.candidate.install && approvedIds.includes(s.candidate.id));
}

/** One line each, saying what it is rather than only what it is called. */
export function menuLines(offer: readonly AgentStatus[]): readonly string[] {
  const lines = offer.map((s, i) => {
    const kind = s.candidate.launch === "cli"
      ? "runs the agent here, with the rules loaded"
      : "opens your editor here; its own agent reads the rules from the repo";
    const cred = s.credentialPresent === false ? "  — no API key set, it may ask you to sign in" : "";
    return `     ${i + 1}) ${s.candidate.tool}  — ${kind}${cred}`;
  });
  return [
    ...lines,
    `     ${offer.length + 1}) shell  — your normal command line, in the project folder. No AI involved.`,
    "     0) later",
  ];
}

/** Shown when nothing is installed: what could be, and how. */
export function nothingInstalledLines(missing: readonly AgentStatus[], usingDefaults: boolean): readonly string[] {
  return [
    "  No AI agent is installed on this machine yet.",
    "",
    ...(usingDefaults
      ? ["  Your organization has not approved any agents yet, so these are the framework's",
         "  defaults. Narrow them in policies/governance.yaml (authorized_agents) when you decide.",
         ""]
      : []),
    "  Approved and available to install:",
    ...missing.map((s) => {
      const how = s.candidate.install?.npm ? `npm i -g ${s.candidate.install.npm}` : s.candidate.install?.url ?? "";
      return `    · ${s.candidate.tool.padEnd(28)} ${how}`;
    }),
    "",
    "  Install one in another terminal and re-run `gov`, or carry on with `shell` and",
    "  do the work yourself. gov shows the command; it does not run it for you yet,",
    "  and it never creates an account or holds a key — signing in stays yours.",
  ];
}

/**
 * The agent ids an org has authorized, read from its own `policies/governance.yaml` (authorized_agents).
 *
 * Deliberately forgiving: the file is prose with a table in it, maintained by a
 * human, and a parse failure must not empty the menu. Null means "could not tell",
 * which falls back to the framework's list and says so — never to nothing.
 */
export function approvedAgentIdsFrom(policyText: string | null): readonly string[] | null {
  if (!policyText) return null;
  const approvedSection = /###\s*Approved([\s\S]*?)(?=\n###\s|\n---\s*\n|$)/.exec(policyText)?.[1];
  if (!approvedSection) return null;
  const found = AGENT_CATALOG.filter((a) => {
    const tool = a.tool.split(" / ")[0]!.replace(/\s*\(.*\)$/, "");
    return new RegExp(`\\b${tool.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(approvedSection);
  }).map((a) => a.id);
  return found.length ? found : null;
}

/** Which variants of an agent can run on this machine right now (#196, Q7). */
export interface VariantStatus {
  readonly agent: AgentCandidate;
  readonly variant: AgentVariant;
  readonly installed: boolean;
  /** For an extension: the host it would attach to, or null when none is present. */
  readonly host: string | null;
}

/**
 * Enumerate an approved agent's variants against this machine.
 *
 * An extension with no host is NOT offered, and gov does not install the host to
 * create one: putting a desktop IDE on someone's machine is a provisioning decision,
 * not an agent one — irreversible by `npm rm -g`, meaningless headless, and usually
 * IT's call. Nobody is stranded by that, because an approved agent almost always has
 * a CLI variant too (#196, Q7).
 */
export function variantStatuses(
  agent: AgentCandidate,
  hasTool: (cmd: string) => boolean,
): readonly VariantStatus[] {
  // A catalog entry without an explicit variant list has exactly one: itself. The
  // label says HOW it runs, not what it is called — the name is already on the row.
  const variants = agent.variants ?? (agent.cmd
    ? [{
        kind: agent.launch === "ide" ? "editor" as const : "cli" as const,
        label: agent.launch === "ide" ? "the editor" : "in the terminal",
        cmd: agent.cmd, install: agent.install,
      }]
    : []);
  return variants.map((v) => {
    if (v.kind === "extension") {
      const host = (v.hosts ?? []).find((h) => hasTool(h)) ?? null;
      return { agent, variant: v, installed: false, host };
    }
    return { agent, variant: v, installed: Boolean(v.cmd && hasTool(v.cmd)), host: null };
  });
}

/** Runnable now: a CLI or editor that is installed, or an extension with a host. */
export function runnableVariants(all: readonly VariantStatus[]): readonly VariantStatus[] {
  return all.filter((v) => (v.variant.kind === "extension" ? v.host !== null : v.installed));
}
