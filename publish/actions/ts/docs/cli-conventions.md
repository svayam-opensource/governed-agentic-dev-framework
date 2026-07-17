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

### First publish — adopt outright (no fallback)

`gov` / `gov-operate` have **not been published yet**, so there is NO installed syntax to preserve — apply
the flag convention **directly**, with no deprecated positional fallback and no transition warnings. (Should a
command ever ship with positional args in a *future* release and then change, reintroduce a one-release
deprecation window at that point — not now.)

### Value discovery — how a developer learns the allowed values

A flag value is either a fixed **ENUM** or a **DYNAMIC set** (derived from the catalog/config/registry). Both
are discoverable four ways, all reading from **one source of truth** for the set (no drift):

1. **Usage synopsis** — enums shown inline: `--env <dev|uat|prod>`. Dynamic sets point to their source:
   `<unit> (see \`gov catalog\`)`, `--project <id> (see \`gov list\`)`.
2. **Validation error lists the valid set** — `--env 'stage' invalid; choose: dev · uat · prod`
   (dynamic: `--unit 'foo' not in the catalog — run \`gov catalog\``). A wrong value never dead-ends; it teaches.
3. **Interactive menu presents them as a numbered pick** — never free-text (same rule as the org/help pickers).
4. **A listing surface** — `gov standards` enumerates the sanctioned enums; dynamic sets have their list
   commands (`gov catalog`, `gov list`, `gov org list`). Shell completion (later) completes from the same source.

**Rule:** define each value set ONCE in code (the `ENVS` list, the standards taxonomy, the catalog) — the
synopsis, the validator, the menu pick, and completion all read *that*.

## 3. Flag syntax

- Long form `--flag`; short `-x` only for the few very common ones (`-h`, `-v`, `-y`, `-q`).
- **Value syntax: the parser accepts BOTH `--flag value` and `--flag=value`; docs/help/examples use the
  space form `--env <env>` as canonical.** Reach for `=` only when the value could start with `-`
  (`--message=-x`) or the flag has an OPTIONAL value (`--color` vs `--color=always`) — there the space form
  is ambiguous, so `=` is required.
- Booleans are bare `--flag`; negate with `--no-flag` where a default-true needs turning off.
- **Standard flags on every command:** `--help/-h`, `--yes/-y` (confirm non-interactively), `--quiet/-q`
  (suppress the banner), `--dry-run`, `--json` (machine output → stdout only), `--gov-home <dir>`.

### Values & quoting

Values are tokenized by the **shell** before `gov` sees them; the CLI treats each value as a **literal
string** and never re-parses quotes.

- **Any characters are allowed** in a value — spaces, symbols, quotes. The user quotes/escapes at the shell:
  `--description "two words"`, `--description 'she said "hi"'`, `--path "$HOME/a b"`.
- **The CLI does NOT strip quotes** from a value — a value that legitimately contains quotes is preserved
  verbatim. (Quote-stripping happens only when READING a config FILE, never for a CLI arg.)
- **`--flag=value` splits on the FIRST `=` only** — the value may itself contain `=` (`--tag env=prod`).
- **Interactive menu:** each value is prompted on its own line and taken **whole, verbatim** (no whitespace
  splitting), so multi-word/special values need no quoting there.

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

## 9. Progress & verbosity

Any command that can take more than ~1s **must show it's alive** — nothing should read as hung.

- **TTY:** a spinner + status line on **stderr**; a **step counter when the total is known**
  (`[3/7] running tests…`). One consistent spinner style across commands.
- **Non-TTY (CI / piped / `--json`):** **no spinner/ANSI** — plain one-line-per-step to stderr
  (`▶ test`, `✓ test (2.1s)`), so logs stay clean.
- **stdout is the result only** — progress/spinners never touch it (keeps pipes + `--json` clean).
- **Verbosity flags:** `--quiet/-q` (result + errors only; no banner, no progress) · `--verbose` (per-step
  detail + underlying gh/git/http calls) · `--json` (machine output, implies quiet). Default = banner +
  high-level progress. `--verbose` is long-only (`-v` stays `--version`).
- **Every run is logged** to the per-user run log regardless of verbosity
  (`…/preferences/<user>/logs/gov-<date>.log`) — a quiet/spinner run still has a full record;
  `--log-file <path>` redirects, `--no-log` disables.
- **Long waits get a live indicator + elapsed** — e.g. the deploy's Jenkins-build wait shows
  `⠋ waiting for Jenkins build #N … (2m10s)` and updates as recipe phases report, instead of a silent poll.

---

**Review checklist:** ratify §2 (positional-subject + flagged-qualifiers, env always a flag) — it's the one
that drives the wholesale change. The rest codifies what's already built this session. Once approved, the
sweep updates every command in gov-work + gov-operate to §2/§3 **outright** (first publish → no positional
fallback), plus the tests and the git-help usage synopses.
