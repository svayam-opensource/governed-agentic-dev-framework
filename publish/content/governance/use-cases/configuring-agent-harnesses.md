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

The session-start protocol is **one canonical source**, delivered through each tool's conventional install path. Full design: [`docs/design/agent-context-assembly-spec.md`](design/agent-context-assembly-spec.md) §3.3–§3.4.

### Canonical source (edit these)

| File | Purpose |
|---|---|
| `agent/session-protocol.md` | C01 session protocol — layer load order, gates, write rules, capture (POL-113–117) |
| `agent.md` | Org workspace entrypoint — policy pointers, repo identity |

**Do not** hand-edit generated harness install paths (see below). Run `node agent/render-harness.mjs` after changing the canonical source.

### How each tool gets protocol into system context

Full matrix and Claude/Cursor/Gemini step-by-step: [`docs/design/agent-context-assembly-spec.md`](design/agent-context-assembly-spec.md) Appendix D. Registry: [`agent/harness-manifest.yaml`](../agent/harness-manifest.yaml).

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

### What harness does *not* load

Harness delivery covers **protocol only**. The agent must read these each session:

- Full `governance/policies/` text
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
