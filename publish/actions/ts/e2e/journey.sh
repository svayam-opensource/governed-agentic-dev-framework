#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# THE INTERACTIVE ADOPTER JOURNEY — the tier that answers questions.
#
# `adopter-smoke.sh` drives the same real binary and never types anything, so it reaches
# only the surface gov exposes non-interactively. Every defect between #197 and #209 lived
# behind a prompt. This runs gov in a REAL PTY, answers as an adopter would, and asserts on
# the transcript an adopter would have read.
#
# Hermetic: stub `gh`, doubles for the agents, an isolated HOME and registry. No token, no
# network, no side effects. Runs anywhere `expect` does.
#
#   bash e2e/journey.sh                 every scenario
#   bash e2e/journey.sh 30-adopter      just the ones whose name matches
#
# A scenario is a file in journey.d/. It gets the helpers below and a clean world.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TS_DIR="$(cd "$HERE/.." && pwd)"
CONTENT_DIR="$(cd "$TS_DIR/../../content" && pwd)"
FILTER="${1:-}"

BOLD=$'\033[1m'; CYA=$'\033[36m'; GRN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; RST=$'\033[0m'
[ -t 1 ] && [ -z "${NO_COLOR:-}" ] || { BOLD=""; CYA=""; GRN=""; RED=""; DIM=""; RST=""; }

PASS=0; FAIL=0; SCENARIO=""
scenario(){ SCENARIO="$1"; printf '\n%s%s%s\n\n' "$BOLD" "$1" "$RST"; }
pass(){ printf '  %s✓%s %s\n' "$GRN" "$RST" "$*"; PASS=$((PASS+1)); }
fail(){ printf '  %s✗%s %s\n' "$RED" "$RST" "$*"; FAIL=$((FAIL+1)); }
info(){ printf '  %s→%s %s\n' "$CYA" "$RST" "$*"; }

command -v expect >/dev/null || { echo "journey.sh needs \`expect\` (dnf/apt install expect)"; exit 2; }

# ── the world each scenario gets ──────────────────────────────────────────────
# A HOME of its own, so nothing here can see or touch the machine's real gov.
new_world() {
  WORLD="$(mktemp -d)"
  export HOME="$WORLD/home"; mkdir -p "$HOME/.local/bin"
  export XDG_CONFIG_HOME="$HOME/.config"
  export PATH="$WORLD/bin:$HOME/.local/bin:$PATH"
  # A git identity, because step 6 of adoption sets one and every verb's preflight requires
  # it. Without this the world is a machine mid-adoption, which is a different scenario —
  # one worth its own fragment (20-bare), not the silent default for all of them.
  printf '[user]\n\tname = Adopter Bot\n\temail = adopter@example.test\n' > "$HOME/.gitconfig"
  export GH_STUB_LOG="$WORLD/gh.log"
  export AGENT_DOUBLE_LOG="$WORLD/agent.log"
  : > "$GH_STUB_LOG"; : > "$AGENT_DOUBLE_LOG"
  mkdir -p "$WORLD/bin"
  cp "$HERE/stub/gh" "$WORLD/bin/gh"
  cp "$HERE/stub/git" "$WORLD/bin/git"
  export GIT_STUB_REMOTES="$WORLD/remote"; mkdir -p "$GIT_STUB_REMOTES"
  # `gov` as a wrapper on the built binary — the same shape install.sh writes, so PATH
  # behaves the way it does on a real machine.
  printf '#!/usr/bin/env bash\nexec node "%s/lib/esm/cli/bin.js" "$@"\n' "$TS_DIR" > "$WORLD/bin/gov"
  chmod +x "$WORLD/bin/gh" "$WORLD/bin/git" "$WORLD/bin/gov"
  no_agents_installed
  TRANSCRIPT="$WORLD/transcript.txt"      # exactly what the terminal received, codes and all
  PLAIN="$WORLD/plain.txt"                # the same, readable — what the words say
  FLAT="$WORLD/flat.txt"                  # one line, for prose that the terminal wrapped
}

# An agent binary that exists on PATH and records how it was called (#199/#207/#209).
give_agent() { cp "$HERE/stub/agent-double" "$WORLD/bin/$1"; chmod +x "$WORLD/bin/$1"; }

# NOTHING IS ALREADY TRUE HERE (#186's whole lesson, applied to the harness itself).
#
# The world inherits the machine's PATH so it can find node, git and the shell — and with it
# whatever the person running the tests happens to have installed. The first run of this
# suite reported "IBM Bob is already installed", because `bob` was on the developer's laptop.
# A harness that passes differently on two machines is the thing it exists to prevent.
#
# So every agent gov knows about is shadowed by a command that fails, which is what "not
# installed" looks like to `tryRun(cmd, ["--version"])`. A scenario that wants one calls
# `give_agent`, and says so.
AGENT_COMMANDS="claude cursor-agent cursor codex gemini copilot bob aider windsurf code bob-ide"
no_agents_installed() {
  local c
  for c in $AGENT_COMMANDS; do
    printf '#!/bin/sh\nexit 127\n' > "$WORLD/bin/$c"
    chmod +x "$WORLD/bin/$c"
  done
}

# A governance workspace a JOINER could clone: the identity plus the two files the flows
# read. Built from the shipped content, so it cannot drift from what gov actually seeds.
make_gov_repo() {
  local dir="$1" org="$2" slug="$3"
  mkdir -p "$dir/knowledge/policies" "$dir/agent"
  cat > "$dir/org-config.yaml" <<YAML
org_name: "$org Ltd"
org_short_name: "$org"
org_slug: "$slug"
org_slug_lower: "$(echo "$slug" | tr '[:upper:]' '[:lower:]')"
org_repo_url: "git@github.com:$org/$org-gov.git"
github_org: "$org"
workspace_repo: "$org-gov"
default_branch: "main"
default_code_branch: "dev"
agent_work_root: "$HOME/.gov/$(echo "$slug" | tr '[:upper:]' '[:lower:]')/projects"
policy_owner_email: "owner@example.test"
YAML
  cp "$CONTENT_DIR/agent/session-protocol.md" "$dir/agent/" 2>/dev/null || echo "# protocol" > "$dir/agent/session-protocol.md"
  cp "$CONTENT_DIR/knowledge/policies/llm-governance.md" "$dir/knowledge/policies/" 2>/dev/null \
    || echo "# llm governance" > "$dir/knowledge/policies/llm-governance.md"
  ( cd "$dir" && git init -q . && git add -A && git -c user.email=e@x -c user.name=e commit -qm init )
}

# Record the org's approved agents the way `gov agent approve` would.
approve_agents() {
  local file="$1/knowledge/policies/llm-governance.md"; shift
  { printf '\n```yaml\napproved_agents:\n'
    local first=1
    for id in "$@"; do
      printf '  - id: %s\n' "$id"
      [ $first = 1 ] && printf '    default: true\n'; first=0
    done
    printf '```\n'; } >> "$file"
}

# ── driving ───────────────────────────────────────────────────────────────────
# Run a command in a pty, answering from a conversation. Returns expect's verdict.
drive() {
  local conv="$1"; shift
  : > "$TRANSCRIPT"
  expect "$HERE/pty/drive.exp" "$TRANSCRIPT" "$conv" -- "$@" >/dev/null 2>"$WORLD/drive.err"
  local rc=$?
  # A pty transcript carries the colour AND readline's cursor moves. Assertions about WORDS
  # read the stripped copy; assertions about colour read the raw one. Grepping the raw text
  # for a phrase that happens to be painted is a test that fails for the wrong reason.
  perl -pe 's/\e\[[0-9;]*[a-zA-Z]//g; s/\r//g' "$TRANSCRIPT" > "$PLAIN"
  # WRAPPED PROSE IS STILL THE SAME SENTENCE. Asserting on a phrase that happens to straddle a
  # line break is a test that fails when someone rewraps a paragraph — which teaches people to
  # loosen assertions. One long line, whitespace collapsed, and the sentence survives.
  tr '\n' ' ' < "$PLAIN" | tr -s ' ' > "$FLAT"
  return $rc
}

# A conversation written inline by the scenario.
conv() { CONV="$WORLD/conv.$$"; cat > "$CONV"; echo "$CONV"; }

# ── assertions, all against the transcript an adopter would have read ─────────
saw()     { grep -qF -- "$2" "$PLAIN" && pass "$1" || { fail "$1"; printf '%s     expected: %s%s\n' "$DIM" "$2" "$RST"; }; }
saw_re()  { grep -qE -- "$2" "$PLAIN" && pass "$1" || { fail "$1"; printf '%s     expected /%s/%s\n' "$DIM" "$2" "$RST"; }; }
never()   { grep -qF -- "$2" "$PLAIN" && { fail "$1"; printf '%s     forbidden: %s%s\n' "$DIM" "$2" "$RST"; } || pass "$1"; }
says()    { grep -qF -- "$2" "$FLAT" && pass "$1" || { fail "$1"; printf '%s     expected sentence: %s%s\n' "$DIM" "$2" "$RST"; }; }
never_says(){ grep -qF -- "$2" "$FLAT" && { fail "$1"; printf '%s     forbidden sentence: %s%s\n' "$DIM" "$2" "$RST"; } || pass "$1"; }
never_re(){ grep -qE -- "$2" "$PLAIN" && { fail "$1"; printf '%s     forbidden /%s/%s\n' "$DIM" "$2" "$RST"; } || pass "$1"; }
# Colour lives in the RAW transcript, and is asserted as "this phrase arrived painted" —
# never as a bare escape code somewhere on the screen (#204).
painted()   { grep -qE -- $'\033\\[[0-9;]*m[^\033]*'"$2" "$TRANSCRIPT" && pass "$1" || { fail "$1"; printf '%s     expected painted: %s%s\n' "$DIM" "$2" "$RST"; }; }
unpainted() { grep -qE -- $'\033\\[[0-9;]*m[^\033]*'"$2" "$TRANSCRIPT" && { fail "$1"; printf '%s     should be plain: %s%s\n' "$DIM" "$2" "$RST"; } || pass "$1"; }
ran()     { grep -qF -- "$2" "$AGENT_DOUBLE_LOG" && pass "$1" || { fail "$1"; printf '%s     agent log:%s\n%s\n' "$DIM" "$RST" "$(sed 's/^/       /' "$AGENT_DOUBLE_LOG")"; }; }
not_ran() { grep -qF -- "$2" "$AGENT_DOUBLE_LOG" && fail "$1" || pass "$1"; }
gh_ran()  { grep -qF -- "$2" "$GH_STUB_LOG" && pass "$1" || { fail "$1"; printf '%s     gh log:%s\n%s\n' "$DIM" "$RST" "$(sed 's/^/       /' "$GH_STUB_LOG")"; }; }
gh_never(){ grep -qF -- "$2" "$GH_STUB_LOG" && { fail "$1"; printf '%s     forbidden gh: %s%s\n' "$DIM" "$2" "$RST"; } || pass "$1"; }
exists()  { [ -e "$2" ] && pass "$1" || { fail "$1"; printf '%s     no such path: %s%s\n' "$DIM" "$2" "$RST"; }; }
runs()    { "$@" >/dev/null 2>&1; }
dump()    { printf '%s--- transcript ---%s\n%s\n' "$DIM" "$RST" "$(sed 's/^/    /' "$PLAIN")"; }

[ -f "$TS_DIR/lib/esm/cli/bin.js" ] || ( cd "$TS_DIR" && npm run build >/dev/null 2>&1 )

export HERE TS_DIR CONTENT_DIR
shopt -s nullglob
for f in "$HERE"/journey.d/*.sh; do
  name="$(basename "$f" .sh)"
  [ -n "$FILTER" ] && [[ "$name" != *"$FILTER"* ]] && continue
  new_world
  # shellcheck disable=SC1090
  source "$f"
  rm -rf "$WORLD"
done
shopt -u nullglob

printf '\n%s%d passed, %d failed%s\n' "$BOLD" "$PASS" "$FAIL" "$RST"
[ "$FAIL" -eq 0 ]
