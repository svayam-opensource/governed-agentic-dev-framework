---
title: gov CLI Conventions
status: draft (for review)
owner: rkant@svayam.ai
applies_to: gov-work (OSS) + gov-operate (plugin) — the unified `gov` CLI
updated: 2026-07-16
---

# gov CLI Conventions

The single source of truth for how every `gov` command looks and behaves. Both packages implement it:
**gov-work** (OSS host) and **gov-operate** (internal plugin). Once this is approved, we apply it **wholesale**
across all commands in one change.

## 1. Command surface

- **One binary: `gov`.** gov-work provides it and hosts core verbs; gov-operate delegates the governed verbs
  (catalog/deploy/promote/rollback/drift/attest). `gov-work`/`gov-operate` remain as transitional aliases.
- **All user-facing text says `gov`** — help, prompts, errors, docs. Never `gov-work`/`prj`.
- **Verbs are lower-kebab** (`add-repo`, `list-all`, `deploy-check`), grouped by domain in help.

## 2. Arguments — the core rule

**One positional SUBJECT; everything else is a named flag.**

- **Positional = the single primary noun** the command acts on: `unit`, `board-url`, `repo-url`, `slug`,
  `project`. Exactly **one**. If a command has no subject, or two same-typed nouns, use flags for all.
- **Named flags for every qualifier / option** — especially **consequential** ones. `--env`, `--from`,
  `--to`, `--content-sha`, `--owner`, `--description`.
  - **The env (and anything that can hit prod) is ALWAYS an explicit flag** — never a bare positional.
    This prevents the silent order-swap "right unit, wrong env," self-documents, and pairs with the context
    banner's `target env:` + prompt-on-change.
- **Three or more args, or same-typed args → all flags** (no positional): `promote <unit> --from uat --to prod`.

### Applied (the wholesale change)

| Today (positional) | Convention |
|---|---|
| `gov deploy <unit> <env>` | `gov deploy <unit> --env <env>` |
| `gov promote <unit> <from> <to>` | `gov promote <unit> --from <env> --to <env>` |
| `gov rollback <unit> <env> --to-sha <sha>` | `gov rollback <unit> --env <env> --to-sha <sha>` |
| `gov data <unit> <env> …` | `gov data <unit> --env <env> …` |
| `gov onboard <url> <owner> <desc>` | `gov onboard <url> --owner <o> --description "<d>"` |
| `gov status <project>` | `gov status [--project <id>]` (blank = pick) |
| `gov seed <board-url> [assignee]` | keep subject positional; `--assignee <login>` |
| `gov manage assign <login>` | subject positional (`<login>`) — one noun, fine |
| `gov creds set <service> …` | subject positional (`<service>`) — one noun, fine |

### Transition (no breakage)

For every command whose args change, **accept the old trailing positionals as a DEPRECATED fallback**: run
it, but print a one-line `deprecation: pass --env <v> (positional env is going away)` to stderr. Remove the
fallback after one release line.

## 3. Flag syntax

- Long form `--flag`; short `-x` only for the few very common ones (`-h`, `-v`, `-y`, `-q`).
- Value as `--flag value` **or** `--flag=value` (both accepted).
- Booleans are bare `--flag`; negate with `--no-flag` where a default-true needs turning off.
- **Standard flags on every command:** `--help/-h`, `--yes/-y` (confirm non-interactively), `--quiet/-q`
  (suppress the banner), `--dry-run`, `--json` (machine output → stdout only), `--gov-home <dir>`.

## 4. Help

- **`gov --help`** and **`gov help`** → the **git-help-style reference**: `usage: gov <command> [<args>]`,
  commands grouped with a one-line description each, footer pointing to per-command help.
- **`gov help <command>`** / **`gov <command> --help`** → real per-command help: `gov <cmd> — <description>` +
  `usage: gov <cmd> <synopsis>`. Never a "run `--help`" pointer.
- Interactive **Help → help for one command** lists commands to pick (numbered), not a free-text prompt.

## 5. Context + safety

- **Context banner on every invocation** (stderr): mode (PROJECT/GOVERNED/NONE) · gov_repo · org_config ·
  service presence (✓/·) · user · anomalies. Never a secret value.
- **Prompt-on-context-CHANGE only** — `Proceed? (y/N)` when the fingerprint (mode · project · gov_repo ·
  org-config path+content · user · target env · CLI major) differs from a recently-acked one. TTL-acked.
- **Non-TTY never blocks:** print the banner; `--yes`/`$GOV_YES` skip; `$GOV_EXPECT_CONTEXT` asserts (fail on
  mismatch) instead of prompting.
- **Interactive menu is context-aware:** one skeleton, actions filtered/annotated by mode; project-only
  commands are marked "needs an active project" and guarded rather than dead-ending.

## 6. Output, errors, exit codes

- **stdout = the result/data** (pipeable, `--json` clean); **stderr = banner, prompts, progress, warnings.**
- **Never silent-empty on failure** — a `gh`/network/auth failure must say *why*, not look like "no results."
- **Actionable errors:** state the cause + the fix (`… — run \`gov auth login\``).
- **Exit codes:** `0` success · `1` runtime error · `2` usage error.

## 7. Secrets

- **Never print a credential VALUE** anywhere (banner, help, logs, errors) — presence/length only.
- Tokens written to files (`.npmrc`) are done with tracing off so they can't leak to a build log.

## 8. Idempotency

- Re-running a converging command is a **no-op**, not an error (e.g. an unchanged content-addressed publish
  → "already published — skip", exit 0).

---

**Review checklist:** ratify §2 (positional-subject + flagged-qualifiers, env always a flag) — it's the one
that drives the wholesale change. The rest codifies what's already built this session. Once approved, the
sweep updates every command in gov-work + gov-operate to §2/§3, with §2 "Transition" keeping old positionals
working (deprecated) for one release line.
