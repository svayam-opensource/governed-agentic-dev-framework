#!/usr/bin/env bash
# Regression test for #54 — the Cursor session-start client gate (.cursor/hooks).
# Exercises the deny/allow/marker logic deterministically; the live Cursor wiring
# (sessionStart firing, preToolUse honoring "deny") needs a real session.
TEST_NAME="cursor_gate"
source "$(dirname "$0")/lib.sh"

H="$REPO_ROOT/.cursor/hooks"
gate="$H/session-gate.sh"; start="$H/session-start.sh"; ack="$H/session-ack.sh"

for f in "$gate" "$start" "$ack" "$REPO_ROOT/.cursor/hooks.json" "$REPO_ROOT/.cursor/rules/session-start-gate.mdc"; do
  [[ -f "$f" ]] && t_pass "present: ${f#"$REPO_ROOT"/}" || t_fail "missing: ${f#"$REPO_ROOT"/}"
done

# Cursor project hooks run from the project root → use relative .cursor/.session-ack.
# Run each hook from a temp "project root".
tmp="$(mktemp -d)"; mkdir -p "$tmp/.cursor"
run() { ( cd "$tmp" && printf '%s' "$2" | bash "$1" ); }

# 1) Write tool call, no marker → deny
out="$(run "$gate" '{"tool":"Write","tool_input":{"file_path":"x"}}')"
assert_contains '"permission":"deny"' "$out" "Write denied when session not acknowledged"

# 2) shell ack command → allowed (whitelisted) even with no marker
out="$(run "$gate" '{"command":"bash .cursor/hooks/session-ack.sh"}')"
assert_contains '"permission":"allow"' "$out" "session-ack shell command is whitelisted"
assert_not_contains 'deny' "$out" "ack command not denied"

# 3) non-ack shell, no marker → deny
out="$(run "$gate" '{"command":"rm -rf x"}')"
assert_contains '"permission":"deny"' "$out" "shell denied when session not acknowledged"

# 4) ack writes the marker
( cd "$tmp" && bash "$ack" >/dev/null 2>&1 )
[[ -f "$tmp/.cursor/.session-ack" ]] && t_pass "session-ack writes the marker" || t_fail "ack did not write the marker"

# 5) Write + marker present → allow
out="$(run "$gate" '{"tool":"Write","tool_input":{"file_path":"x"}}')"
assert_contains '"permission":"allow"' "$out" "Write allowed after ack"

# 6) non-ack shell + marker present → allow
out="$(run "$gate" '{"command":"rm -rf x"}')"
assert_contains '"permission":"allow"' "$out" "shell allowed after ack"

# 7) sessionStart clears the marker
( cd "$tmp" && bash "$start" >/dev/null 2>&1 )
[[ ! -f "$tmp/.cursor/.session-ack" ]] && t_pass "sessionStart clears the marker" || t_fail "marker not cleared on session start"

# 8) and after clear, Write is denied again
out="$(run "$gate" '{"tool":"Write","tool_input":{"file_path":"x"}}')"
assert_contains '"permission":"deny"' "$out" "Write denied again after session restart"

# 9) hooks.json wires the three events
hj="$(cat "$REPO_ROOT/.cursor/hooks.json")"
assert_contains 'sessionStart'         "$hj" "hooks.json wires sessionStart"
assert_contains 'preToolUse'           "$hj" "hooks.json wires preToolUse"
assert_contains 'beforeShellExecution' "$hj" "hooks.json wires beforeShellExecution"

rm -rf "$tmp"
