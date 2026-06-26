#!/usr/bin/env bash
# PreToolUse gate (#54 Layer 2 — Claude Code client gate).
# Deny mutating tools (Edit|MultiEdit|Write|NotebookEdit|Bash) until the agent
# has run /session-start this session (which writes the ack marker). Read|Grep|
# Glob stay ungated so the protocol's own reads work. The session-ack command is
# always whitelisted so the agent can unlock. A tiny allowlist of read-only
# identity probes (`gh api user`, `gh auth status`) is also allowed pre-ack so the
# protocol can confirm the developer's GitHub login/access (#102.3).
# Fail-OPEN on any error — a client nudge must never brick the workspace; the
# tool-agnostic server gate (Layer 3) is the real enforcement.
set +e
root="${CLAUDE_PROJECT_DIR:-$PWD}"
marker="$root/.claude/.session-ack"
input="$(cat 2>/dev/null)"

# Is this the whitelisted ack command? Parse the Bash command precisely; on any
# parse error (e.g. no python3) fail open.
ack="$(printf '%s' "$input" | python3 -c '
import sys, json, re
try:
    d = json.load(sys.stdin)
    cmd = ((d.get("tool_input") or {}).get("command", "") or "").strip()
    if "session-ack" in cmd:
        print("yes")
    elif re.fullmatch(r"gh api user(\s+--jq\s+\S+)?", cmd) or re.fullmatch(r"gh auth status(\s+--\S+)*", cmd):
        print("probe")   # read-only identity probe the session-start protocol needs pre-ack
    else:
        print("no")
except Exception:
    print("err")
' 2>/dev/null)"
case "$ack" in
  yes|probe|err|"") exit 0 ;;   # ack cmd, whitelisted read-only identity probe, parse error, or no python3 → allow
esac

# Session already acknowledged → allow.
[[ -f "$marker" ]] && exit 0

# Otherwise: deny, with a clear, actionable reason.
printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Complete /session-start first: run the session-start protocol and post the context manifest (agent/session-protocol.md §0) before changing code. Mutating tools unlock once /session-start acknowledges this session."}}'
exit 0
