# Architecture Exception Request Template

**Exception Path:** `knowledge/policies/exceptions/architecture/`
**Approver:** System Architecture Owner or Data Architecture Owner (current: `<POLICY_OWNER_EMAIL>`)
**Compliance Level:** C02 — Always Apply exception process

---

## How to Use This Template

1. Copy this file and rename it: `YYYY-MM-DD-PRJ-<board#>-<slug>-brief-description.md`
2. Fill in all required fields, including which architecture domain applies
3. Commit the file to your project branch: `BRNCH-<board#>-<slug>`
4. Raise a PR targeting <DEFAULT_BRANCH>
5. Appropriate Architecture Owner reviews and merges to grant approval
6. Do NOT proceed with the excepted action until the PR is merged

---

## Exception Request

```yaml
request_date: YYYY-MM-DD
project_id: PRJ-<board#>-<slug>
requester: your@email.com

# Specify which domain: system | data | both
architecture_domain: system

rule_id: POL-NNN
rule_description: [one-line description of the rule]

action_description: |
  [Describe the architectural deviation you need to make]

justification: |
  [Why is this deviation necessary? What constraint or opportunity drives it?]

risk_assessment: |
  [Architectural risks introduced and mitigation approach]

exception_start: YYYY-MM-DD
exception_end: YYYY-MM-DD

alternatives_considered: |
  [What architectural alternatives were evaluated?]
```

---

## Approval Record (completed by Architecture Owner on merge)

```yaml
approved_by: <POLICY_OWNER_EMAIL>
approval_date: YYYY-MM-DD
approval_pr: https://github.com/<GITHUB_ORG>/<WORKSPACE_REPO>/pull/NNN
conditions: ~
```
