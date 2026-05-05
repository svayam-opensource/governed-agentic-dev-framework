# Infrastructure Exception Request Template

**Exception Path:** `knowledge/policies/exceptions/infrastructure/`
**Approver:** Infrastructure Owner (current: `rkant@svayamtech.com`)
**Compliance Level:** C02 — Always Apply exception process

---

## How to Use This Template

1. Copy this file and rename it: `YYYY-MM-DD-SVM-NNN-slug-brief-description.md`
2. Fill in all required fields below
3. Commit the file to your project branch: `svm-NNN-slug`
4. Raise a PR targeting master
5. Infrastructure Owner reviews and merges to grant approval
6. Do NOT proceed with the excepted action until the PR is merged

Common uses: using a Provisional LLM provider, deviating from CI/CD requirements, infrastructure configuration exceptions.

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
  [Why is this exception necessary? What business or technical need drives it?]

risk_assessment: |
  [What risks does this exception introduce? How are they mitigated?]

exception_start: YYYY-MM-DD
exception_end: YYYY-MM-DD

alternatives_considered: |
  [What alternatives were evaluated?]
```

---

## Approval Record (completed by Infrastructure Owner on merge)

```yaml
approved_by: rkant@svayamtech.com
approval_date: YYYY-MM-DD
approval_pr: https://github.com/svayam-rkant/000-svm-prj/pull/NNN
conditions: ~
```
