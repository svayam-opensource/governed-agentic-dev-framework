# shellcheck shell=bash
# Agent-launch helpers (sourced by prj). Kept separate from the heavy CLI body so the
# logic is unit-testable in isolation.
#
# The Cursor GUI can't take an initial agent prompt as an argv (that's a cursor-agent/CLI
# feature), and it opens whatever FOLDER you point it at. Two consequences the launcher must
# handle so the GUI experience matches the CLI one:
#   1. Open the PROJECT ROOT (the folder holding the gov clone + every code repo), not the
#      gov clone alone — otherwise sibling code repos are invisible.
#   2. Make the project root carry an alwaysApply Cursor rule, so the agent runs the
#      session-start protocol on its FIRST turn (the framework's Pattern 1) with no copy-paste.

# Write an alwaysApply Cursor rule at the project root that auto-runs session-start.
# Idempotent: never clobbers an existing rule. Args: <proj_root> <gov_clone_name> <project_id>
_ensure_cursor_autostart_rule() {
  local proj_root="$1" gov_name="$2" pid="$3" rules rule
  [[ -n "$proj_root" && -n "$gov_name" && -n "$pid" ]] || return 1
  rules="$proj_root/.cursor/rules"; rule="$rules/session-start.mdc"
  [[ -f "$rule" ]] && return 0                         # respect an existing rule
  mkdir -p "$rules" 2>/dev/null || return 1
  cat > "$rule" <<MDC
---
description: $pid — run the session-start protocol before any work (auto)
globs: ["**/*"]
alwaysApply: true
---
# Auto session-start — $pid

This workspace is the **$pid** project root. It contains the governance clone
\`$gov_name/\` and this project's code repositories as sibling folders.

**On your first message in any new chat, before planning or editing anything**, run the
session-start protocol proactively — do NOT wait for the user to paste a kickoff prompt:

1. Read \`$gov_name/projects/$pid/agent.md\`, \`$gov_name/projects/$pid/project.yaml\`, and
   \`$gov_name/projects/$pid/knowledge/todo.md\`.
2. Read \`$gov_name/org-config.yaml\` and the policy layer under \`$gov_name/knowledge/policies/\`.
3. Verify you are authorized (project \`assigned_to\`) and that \`status: active\`.
4. Post the **context manifest** (Project, Branch, Status / assigned_to, Repos, Open todos,
   Layers loaded, Awaiting), then stop for direction — unless the user's first message already
   contains a specific task, in which case post a short manifest first, then proceed.

Git/branch operations run inside \`$gov_name/\` (and the code repos), not at this root.
MDC
}

# Resolve the project root (folder with the gov clone + code repos) from a gov-clone path.
# org_gov_clone is "<work_root>/<pid>/<workspace_repo>", so the parent is the project root.
_project_root_of_clone() { [[ -n "$1" ]] && dirname "$1"; }
