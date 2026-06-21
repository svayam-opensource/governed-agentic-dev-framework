#!/usr/bin/env bash
# SessionStart hook (#54 Layer 2 — Claude Code client gate).
# On every session (re)start — startup | resume | clear | compact — clear the
# per-session ack marker so /session-start must run again, and remind the agent.
# Fail-OPEN: a client nudge must never brick the workspace; Layer 3 (server) is
# the real enforcement.
set +e
root="${CLAUDE_PROJECT_DIR:-$PWD}"
rm -f "$root/.claude/.session-ack" 2>/dev/null
msg="Session-start protocol is in effect (agent/session-protocol.md §0). Run /session-start now: post the context manifest BEFORE changing code. Edit/Write/Bash stay blocked until /session-start acknowledges this session."
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$msg"
exit 0
