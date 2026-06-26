#!/usr/bin/env bats
# #102.3 — the Claude PreToolUse session-start gate blocked ALL Bash pre-ack, so
# the protocol couldn't even run a read-only `gh api user` to confirm the
# developer's login/access. The gate now allows a tiny allowlist of read-only
# identity probes pre-ack, while still denying everything else (and refusing to
# let a probe smuggle a chained mutation). Tests the shipped template hook.
load helpers
GATE="$REPO_SRC/framework/.claude/hooks/pre-tool-gate.sh"
setup() {
  sandbox_up
  export CLAUDE_PROJECT_DIR="$TEST_TMP/proj"
  mkdir -p "$CLAUDE_PROJECT_DIR/.claude"          # no .session-ack marker yet
}
teardown() { sandbox_down; }

# Empty stdout = allow; a JSON object with permissionDecision=deny = deny.
gate() { printf '%s' "$1" | bash "$GATE"; }

@test "gate allows read-only 'gh api user' pre-ack (#102.3)" {
  run gate '{"tool_input":{"command":"gh api user --jq .login"}}'
  assert_success
  assert_output ""
}

@test "gate allows 'gh auth status' pre-ack (#102.3)" {
  run gate '{"tool_input":{"command":"gh auth status"}}'
  assert_output ""
}

@test "gate denies an arbitrary mutating command pre-ack" {
  run gate '{"tool_input":{"command":"echo hi > x"}}'
  assert_output --partial '"permissionDecision":"deny"'
}

@test "gate denies a probe that smuggles a chained command" {
  run gate '{"tool_input":{"command":"gh api user && rm -rf /"}}'
  assert_output --partial '"permissionDecision":"deny"'
}

@test "gate denies 'gh api user' with a mutating method flag" {
  run gate '{"tool_input":{"command":"gh api user -X POST"}}'
  assert_output --partial '"permissionDecision":"deny"'
}

@test "gate allows anything once the session is acknowledged" {
  : > "$CLAUDE_PROJECT_DIR/.claude/.session-ack"
  run gate '{"tool_input":{"command":"echo hi > x"}}'
  assert_output ""
}
