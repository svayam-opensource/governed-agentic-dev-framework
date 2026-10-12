---
domain: governance
layer: use-case
owner: policy-owner
compliance: C02
status: current
---
# Configuring agent harnesses

Which file each agent reads, what gov places where, and the foot-guns that come with editing
any of it by hand.

## 9. Tool-specific notes

The session-start protocol is **one canonical source**, delivered through each tool's conventional install path. Full design: [`docs/design/agent-context-assembly-spec.md`](https://github.com/svayam-opensource/governed-agentic-dev-framework/blob/main/docs/design/agent-context-assembly-spec.md) §3.3–§3.4.

### Canonical source (edit these)

| File | Purpose |
|---|---|
| `agent/session-protocol.md` | C01 session protocol — layer load order, gates, write rules, capture (GOV-FRM-113…117) |
| `agent.md` | Org workspace entrypoint — policy pointers, repo identity |

**Do not** hand-edit generated harness install paths (see below). Run `node agent/render-harness.mjs` after changing the canonical source.

### How each tool gets protocol into system context

Full matrix and Claude/Cursor/Gemini step-by-step: [`docs/design/agent-context-assembly-spec.md`](https://github.com/svayam-opensource/governed-agentic-dev-framework/blob/main/docs/design/agent-context-assembly-spec.md) Appendix D. Registry: [`agent/harness-manifest.yaml`](https://github.com/svayam-opensource/governed-agentic-dev-framework/blob/main/agent/harness-manifest.yaml).

| Tool | Install path | Tier | Auto? | Verify |
|---|---|---|---|---|
| **Claude Code** | `CLAUDE.md` | import (`@`) | Yes | `/memory` |
| **Cursor** | `.cursor/rules/agent.mdc` | generate_auto | Yes | Settings → Rules → Always |
| **OpenAI Codex** | `AGENTS.md` | generate_auto | Yes | First-message summary |
| **Gemini Code Assist** | `.gemini/styleguide.md` | generate_auto | Yes | Ask re write restrictions |
| **GitHub Copilot** | `.github/copilot-instructions.md` | generate_auto | On assist | Weaker session gate |
| **Windsurf** | `.windsurf/rules/agent.md` | generate_auto | Yes | First message |
| **Cline / Roo Code** | `.clinerules/agent.md` | generate_auto | Yes | Startup / first message |
| **Continue.dev** | `.continue/rules.md` | generate_auto | Yes | First message |
| **Aider** | `CONVENTIONS.md` | generate_manual | **`--read` only** | Confirm in context |

Per-project copies under `projects/<PID>/` are composed at seed time (protocol + `projects/<PID>/agent.md`) so opening the project folder as workspace still works.

### Which agents can run headless

Running an agent *headless* means gov starts it with nobody at the terminal: the agent gets its instructions, works, prints what it did and exits. The lifecycle engine (`gov autorun`, coming in a later release) works this way. gov runs an agent headless only after someone has checked that agent's own command line does exactly that, and gov's agent catalog records when it was checked. Any other agent is refused, and gov tells you why. It does not start the agent and hope nobody needs to answer a question.

| Agent | Headless? | How gov runs it | Checked |
|---|---|---|---|
| **Claude Code** | Yes | `claude -p "<prompt>" --output-format text` | 2026-10-12, claude 2.1.272 |
| **Cursor** (`cursor-agent`) | Not yet | `-p`/`--print` exists, but no successful run has been seen yet | 2026-10-12 (no answer seen yet) |
| All others | No | Use them interactively with `gov work` | — |

What this means for you:

- **The same session-start protocol.** A headless run starts with exactly the prompt `gov work` gives an interactive agent, so the session-start protocol runs first, then the task.
- **gov reads the exit code.** If the agent exits non-zero and its output names a C01 rule (a `GOV-…` id whose rule is C01), autorun stops completely. Any other non-zero exit fails only that item. An agent that names a C01 rule but exits zero has done nothing wrong: a context manifest lists the rules it read.
- **Permissions stay yours.** gov never adds flags like `--dangerously-skip-permissions`, `--force` or `--yolo`. What a headless agent may do comes from that agent's own settings in the project (for Claude Code, `.claude/settings.json`), which your organization controls.

### Skills: the rules an agent needs only when it does the thing

The protocol file carries the C01 rules on every turn. The C02 and C03 rules that bind an agent are delivered as
**skills** instead: the agent always sees each skill's one-line description, and loads the rest when its work
matches.

- **One skill per policy section.** Every section of a policy or the framework specification that holds C02 or
  C03 rules for agents becomes one skill, named `gov-<document>-<section number>-<section title>` — for example
  `gov-framework-specification-8-3-write-it-down-as-you-decide-it`.
- **What it says.** The description names the section and when to use it (the files or `gov` commands its rules
  are checked on). The body lists each rule — C02 as *required*, C03 as *preferred* — then links the section.
- **Where it goes.** Only where an agent has been seen to load it:

  | Agent | Skill location | How it was verified |
  |---|---|---|
  | Claude Code | `.claude/skills/<name>/SKILL.md` | Run: Claude Code loaded a skill there (2026-10-12) |
  | Cursor | `.cursor/skills/<name>/SKILL.md` | Cursor's own documentation (2026-10-12); a run is still to do |

  Other agents get none yet; they still have every C01 rule in their protocol file.
- **How it gets there.** `gov rules build` (and `gov setup`, `gov upgrade`, `gov sync`) writes the skills under
  `agent/harness/` with the protocol files. `gov work` copies them into the project folder and each code repo every
  time it starts an agent.
- **Renamed or removed sections.** Rename a section and its skill is renamed: the next build writes the new skill
  and deletes the old one. `gov rules check` fails until that build is done.
- **Your own skills are safe.** gov deletes only skills it generated — each carries the line
  "generated by gov — do not edit". A skill you write, even one named `gov-…`, is never touched.
- **Do not edit a generated skill.** Change the rule or the policy section, then run `gov rules build`.

### What harness does *not* load

Harness delivery covers **protocol only**. The agent must read these each session:

- Full `framework/framework-specification.md` text
- `projects/<PID>/knowledge/*`
- Code repo `knowledge/`
- `$AGENT_WORK_ROOT/preferences/<gh-login>.md`

Reads persist in **chat transcript** for the rest of the session; they are not re-injected each turn like rules.

### General foot-guns regardless of tool

- **Text pointers are not file loads.** *"See `agent.md`"* in a rule instructs the model; it does not embed the file. Use Claude `@import` or Cursor generation.
- **Verify loading.** First prompt: ask for a context manifest (project, branch, open todos). Claude: `/memory`. Cursor: confirm Always rules in Settings → Rules.
- **Adopter C03 extensions** go below the `ADOPTER_C03_EXTENSIONS` marker in `agent/session-protocol.local.md` or the generated harness footer — never contradict layer priority or C01/C02 rules.
- **Migration note:** Until `agent/session-protocol.md` and `agent/render-harness.mjs` land, harness files still inline duplicate protocol — update them in lockstep if you edit protocol text.

---
