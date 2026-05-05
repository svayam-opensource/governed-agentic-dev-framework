# Developer Preferences — C03 only. Org and repo knowledge always take precedence.
#
# LOCATION: <agent_work_root>/preferences/agent.md
# This file is NEVER committed to any repository.
# It is the lowest-priority knowledge layer — it cannot override org or repo knowledge.
#
# See: {{WORKSPACE_REPO}}/knowledge/policies/agentic-development-policy.md (POL-131 to POL-136)

---

## Agent Work Root

```yaml
agent_work_root: ~/work    # Change to your preferred local path
```

Project repos are cloned into `<agent_work_root>/SVM-NNN-slug/`.

---

## Coding Style Preferences
# Examples of what is allowed here (C03 — adapt with documentation)

# preferred_indentation: 2 spaces
# preferred_line_length: 120
# preferred_quote_style: single
# preferred_import_order: stdlib, third-party, local

---

## Preferred Tools and Models
# Override the default agent_config at the preference level (C03 only)
# Note: model/provider must still be on the approved list in llm-governance.md

# preferred_model: auto
# preferred_provider: cursor

---

## Communication Style
# How you prefer the agent to communicate with you

# verbosity: concise          # concise | detailed
# code_comments: minimal      # minimal | explain-why | full
# confirmation_style: silent  # silent | confirm-destructive | confirm-all

---

## Personal Shortcuts and Aliases
# Project-agnostic shortcuts you want available in every session

# shortcuts:
#   - name: run-tests
#     command: npm test
#   - name: lint
#     command: npm run lint

---

## PROHIBITED — The Following Cannot Appear in This File

The following must NEVER be placed in developer preferences (C01 violations):
- Org policies or policy overrides
- Security mandates or exceptions
- Compliance level definitions or overrides
- Assignment or locking rule overrides
- Knowledge layer priority order changes
- Anything that contradicts {{WORKSPACE_REPO}}/knowledge/policies/

If you need to change org policy, use the propose-knowledge script.
