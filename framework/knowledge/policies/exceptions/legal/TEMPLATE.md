# Legal Exception Request Template

**Exception Path:** `knowledge/policies/exceptions/legal/`
**Approver:** Legal Owner (current: `<POLICY_OWNER_EMAIL>`)
**Compliance Level:** C02 — Always Apply exception process

---

## How to Use This Template

1. Copy this file and rename it: `YYYY-MM-DD-PRJ-NNN-<slug>-brief-description.md`
2. Fill in all required fields below
3. Commit the file to your project branch: `brnch-NNN-<slug>`
4. Raise a PR targeting <DEFAULT_BRANCH>
5. Legal Owner reviews and merges to grant approval
6. Do NOT proceed with the excepted action until the PR is merged

---

## Exception Request

```yaml
# Required fields — all must be completed

request_date: YYYY-MM-DD
project_id: PRJ-NNN-<slug>
requester: your@email.com

# The policy rule being excepted
rule_id: POL-NNN
rule_description: [one-line description of the rule]

# The action requiring exception
action_description: |
  [Describe clearly what you need to do that would violate the above rule]

# Legal justification
legal_justification: |
  [Explain the legal constraint or requirement that necessitates this exception]

# Risk assessment
risk_assessment: |
  [What risks does this exception introduce? How are they mitigated?]

# Duration
exception_start: YYYY-MM-DD
exception_end: YYYY-MM-DD    # or 'indefinite' with justification

# Alternatives considered
alternatives_considered: |
  [What alternatives were evaluated before requesting this exception?]
```

---

## Approval Record (completed by Legal Owner on merge)

```yaml
approved_by: <POLICY_OWNER_EMAIL>
approval_date: YYYY-MM-DD
approval_pr: https://github.com/<GITHUB_ORG>/<WORKSPACE_REPO>/pull/NNN
conditions: |
  [Any conditions attached to this approval]
```
