#!/usr/bin/env bash
# Cursor session-start gate (#54 Layer 2). Wired to BOTH preToolUse(matcher
# "Write") and beforeShellExecution: deny file writes + shell until the agent has
# acknowledged the session-start protocol (which writes .cursor/.session-ack).
# The session-ack command is always whitelisted so the agent can unlock.
# Fail-OPEN on any error — a client nudge must never brick the workspace; the
# tool-agnostic server gate (Layer 3) is the real enforcement.
set +e
marker=".cursor/.session-ack"

# No python3 → cannot inspect input safely → fail open.
command -v python3 >/dev/null 2>&1 || { printf '{"permission":"allow"}\n'; exit 0; }

input="$(cat 2>/dev/null)"
cmd="$(printf '%s' "$input" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    print(d.get("command", "") or (d.get("tool_input") or {}).get("command", "") or "")
except Exception:
    print("__ERR__")
' 2>/dev/null)"

case "$cmd" in
  *session-ack*) printf '{"permission":"allow"}\n'; exit 0 ;;   # whitelist the ack
  __ERR__)       printf '{"permission":"allow"}\n'; exit 0 ;;   # parse error → fail open
esac

# cmd is "" (a Write tool call — no command field) or a non-ack shell command.
if [[ -f "$marker" ]]; then printf '{"permission":"allow"}\n'; exit 0; fi

printf '%s\n' '{"permission":"deny","user_message":"Session-start protocol not acknowledged.","agent_message":"Run the session-start protocol and post the context manifest (agent/session-protocol.md §0) BEFORE changing code, then run: bash .cursor/hooks/session-ack.sh — this unlocks edits and shell for the session."}'
exit 0
