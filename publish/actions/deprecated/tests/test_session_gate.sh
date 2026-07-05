#!/usr/bin/env bash
# Regression test for #54 Increment 2 — the Claude Code session-start client gate.
# Exercises the hook logic deterministically (the live Claude Code wiring needs a
# real session to verify; this guards the deny/allow/marker behaviour).
TEST_NAME="session_gate"
source "$(dirname "$0")/lib.sh"

H="$REPO_ROOT/.claude/hooks"
gate="$H/pre-tool-gate.sh"; start="$H/session-start.sh"; ack="$H/session-ack.sh"

for f in "$gate" "$start" "$ack" "$REPO_ROOT/.claude/settings.json" "$REPO_ROOT/.claude/commands/session-start.md"; do
  [[ -f "$f" ]] && t_pass "present: ${f#"$REPO_ROOT"/}" || t_fail "missing: ${f#"$REPO_ROOT"/}"
done

tmp="$(mktemp -d)"; mkdir -p "$tmp/.claude"
export CLAUDE_PROJECT_DIR="$tmp"
run_gate() { printf '%s' "$1" | bash "$gate"; }

# 1) no marker + Edit → deny
out="$(run_gate '{"tool_name":"Edit","tool_input":{"file_path":"x"}}')"
assert_contains '"permissionDecision":"deny"' "$out" "Edit denied when session not started"

# 2) no marker + the ack Bash command → allowed (no deny)
out="$(run_gate '{"tool_name":"Bash","tool_input":{"command":"bash .claude/hooks/session-ack.sh"}}')"
assert_not_contains 'deny' "$out" "session-ack command is whitelisted even with no marker"

# 3) ack writes the marker
bash "$ack" >/dev/null 2>&1
[[ -f "$tmp/.claude/.session-ack" ]] && t_pass "session-ack writes the marker" || t_fail "ack did not write the marker"

# 4) marker present + Edit → allowed
out="$(run_gate '{"tool_name":"Edit","tool_input":{"file_path":"x"}}')"
assert_not_contains 'deny' "$out" "Edit allowed after ack"

# 5) SessionStart clears the marker (forces re-run next session)
bash "$start" >/dev/null 2>&1
[[ ! -f "$tmp/.claude/.session-ack" ]] && t_pass "SessionStart clears the marker" || t_fail "marker not cleared on session start"

# 6) after clear, Edit is denied again
out="$(run_gate '{"tool_name":"Edit","tool_input":{"file_path":"x"}}')"
assert_contains '"permissionDecision":"deny"' "$out" "Edit denied again after session restart"

# 7) SessionStart emits additionalContext (the protocol reminder)
out="$(bash "$start")"
assert_contains 'additionalContext' "$out" "SessionStart injects the protocol reminder"

# 8) settings.json wires both hooks
sj="$(cat "$REPO_ROOT/.claude/settings.json")"
assert_contains 'SessionStart' "$sj" "settings.json wires SessionStart"
assert_contains 'PreToolUse'   "$sj" "settings.json wires PreToolUse"

rm -rf "$tmp"
