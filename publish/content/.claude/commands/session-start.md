---
description: Run the session-start protocol and unlock mutating tools for this session
---

Run the workspace **session-start protocol** now, then acknowledge it. Until you
acknowledge (step 3), `Edit`/`Write`/`Bash` are blocked by the PreToolUse gate —
`Read`/`Grep`/`Glob` work, so you can do the reads below.

1. **Load context** per `framework/CLAUDE.md` §1–§2:
   - `org-config.yaml` (org layer)
   - the active project's `projects/<PROJECT_ID>/agent.md` and
     `projects/<PROJECT_ID>/knowledge/todo.md` (surface every `## Open` item)
   - `knowledge/policies/agentic-development-policy.md` (policy layer)
   - your developer prefs, if present.
2. **Post the context manifest** in the required format (Project, Branch,
   Status (GitHub board open/closed), Repos, Open todos, Layers loaded, Awaiting). Then
   **stop for direction** — unless the user's first message already asked for
   something specific, in which case complete the manifest first, then proceed.
3. **Acknowledge** (last step — unlocks mutating tools for this session):

   ```bash
   bash "$CLAUDE_PROJECT_DIR/.claude/hooks/session-ack.sh"
   ```

Do not run step 3 before steps 1–2 — the acknowledgement asserts the protocol
ran. (This is the Layer-2 client gate; CI / merge enforce the same at Layer 3.)
