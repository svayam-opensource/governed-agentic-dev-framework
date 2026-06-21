#!/usr/bin/env bash
# PreToolUse gate (#54 Layer 2 — Claude Code client gate).
# Deny mutating tools (Edit|MultiEdit|Write|NotebookEdit|Bash) until the agent
# has run /session-start this session (which writes the ack marker). Read|Grep|
# Glob stay ungated so the protocol's own reads work. The session-ack command is
# always whitelisted so the agent can unlock.
# Fail-OPEN on any error — a client nudge must never brick the workspace; the
# tool-agnostic server gate (Layer 3) is the real enforcement.
set +e
root="${CLAUDE_PROJECT_DIR:-$PWD}"
marker="$root/.claude/.session-ack"
input="$(cat 2>/dev/null)"

# Is this the whitelisted ack command? Parse the Bash command precisely; on any
# parse error (e.g. no python3) fail open.
ack="$(printf '%s' "$input" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    cmd = (d.get("tool_input") or {}).get("command", "") or ""
    print("yes" if "session-ack" in cmd else "no")
except Exception:
    print("err")
' 2>/dev/null)"
case "$ack" in
  yes|err|"") exit 0 ;;   # ack command, parse error, or no python3 → allow
esac

# Session already acknowledged → allow.
[[ -f "$marker" ]] && exit 0

# Otherwise: deny, with a clear, actionable reason.
printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Complete /session-start first: run the session-start protocol and post the context manifest (agent/session-protocol.md §0) before changing code. Mutating tools unlock once /session-start acknowledges this session."}}'
exit 0
