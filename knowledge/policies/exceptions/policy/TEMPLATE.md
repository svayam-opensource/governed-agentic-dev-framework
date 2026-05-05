# Policy Exception Request Template

**Exception Path:** `knowledge/policies/exceptions/policy/`
**Approver:** Policy Owner (current: `{{POLICY_OWNER_EMAIL}}`)
**Compliance Level:** C02 — Always Apply exception process

---

## How to Use This Template

1. Copy this file and rename it: `YYYY-MM-DD-SVM-NNN-slug-brief-description.md`
2. Fill in all required fields below
3. Commit the file to your project branch: `svm-NNN-slug`
4. Raise a PR targeting master
5. Policy Owner reviews and merges to grant approval
6. Do NOT proceed with the excepted action until the PR is merged

Use this path for exceptions that do not fall under Legal, Infrastructure, or Architecture domains.
Also use this path for project reassignment exceptions (POL-053).

---

## Exception Request

```yaml
request_date: YYYY-MM-DD
project_id: SVM-NNN-slug
requester: your@email.com

rule_id: POL-NNN
rule_description: [one-line description of the rule]

action_description: |
  [Describe what you need to do that requires an exception]

justification: |
  [Why is this exception necessary?]

risk_assessment: |
  [What risks does this introduce and how are they managed?]

exception_start: YYYY-MM-DD
exception_end: YYYY-MM-DD

alternatives_considered: |
  [What alternatives were evaluated?]

# For reassignment exceptions, also complete:
reassignment_from: ~
reassignment_to: ~
reassignment_reason: ~
```

---

## Approval Record (completed by Policy Owner on merge)

```yaml
approved_by: {{POLICY_OWNER_EMAIL}}
approval_date: YYYY-MM-DD
approval_pr: https://github.com/{{GITHUB_ORG}}/{{WORKSPACE_REPO}}/pull/NNN
conditions: ~
```
