#!/usr/bin/env bash
# Cursor session-ack (#54 Layer 2). The LAST step of the session-start protocol:
# write the per-session marker that unlocks edits + shell. The gate whitelists any
# shell command containing "session-ack", so this is never blocked.
set +e
mkdir -p ".cursor" 2>/dev/null
{ date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo ack; } > ".cursor/.session-ack"
echo "✓ session-start acknowledged — edits and shell unlocked for this Cursor session."
exit 0
