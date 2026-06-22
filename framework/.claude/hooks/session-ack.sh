#!/usr/bin/env bash
# session-ack (#54 Layer 2). The LAST step of /session-start: write the per-session
# marker that unlocks mutating tools. The PreToolUse gate whitelists any command
# containing "session-ack", so this is never blocked.
set +e
root="${CLAUDE_PROJECT_DIR:-$PWD}"
mkdir -p "$root/.claude" 2>/dev/null
{ date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo ack; } > "$root/.claude/.session-ack"
echo "✓ session-start acknowledged — mutating tools unlocked for this session."
exit 0
