#!/usr/bin/env bash
# Cursor sessionStart hook (#54 Layer 2). On each new session, clear the
# per-session ack marker so the session-start protocol must be acknowledged
# again. Cursor project hooks run from the project root. Fail-OPEN.
set +e
rm -f ".cursor/.session-ack" 2>/dev/null
exit 0
