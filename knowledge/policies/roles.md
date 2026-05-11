---
maintained_by: Policy Owner
last_updated_by: {{POLICY_OWNER_EMAIL}}
last_updated_at: 2026-05-05
---

# {{ORG_NAME}} — Role Registry

This file is the authoritative record of role holders and manager assignments at {{ORG_NAME}}
Changing this file is a policy update — versioned by commit SHA on {{DEFAULT_BRANCH}}.
Changes require a PR approved by the Policy Owner.

## Role Types

**Owners** are accountable parties responsible for accuracy, implications, and risk appetite within their domain.
Only Owners can approve and merge PRs in their domain (enforced via CODEOWNERS).

**Managers** are assigned by their Owner to perform repo/GitHub work (creating PRs, committing files, etc.).
Managers cannot approve or merge — only Owners can.

One person may hold multiple roles simultaneously if explicitly listed here.
Vacant roles escalate automatically to the Policy Owner.

---

## Policy Owner

**Accountable for:** Overall policy accuracy, risk appetite, cross-domain decisions, conflict resolution between domains, quarterly compliance review.

**Authority:** Final approval authority on all cross-domain decisions. Resolves conflicts between domain owners.

| | |
|---|---|
| Current Holder | {{POLICY_OWNER_EMAIL}} |
| GitHub Handle | {{POLICY_OWNER_GITHUB}} |
| Effective From | 2026-05-05 |
| Managers | TBD |

---

## Legal Owner

**Accountable for:** Legal compliance, legal C02 exceptions, legal domain policy section (10.4), data retention policy.

**Authority:** Final approval authority on `knowledge/legal/` and legal exception requests.

| | |
|---|---|
| Current Holder | TBD ({{POLICY_OWNER_EMAIL}} acting) |
| GitHub Handle | {{LEGAL_OWNER_GITHUB}} |
| Effective From | TBD |
| Managers | TBD |

---

## Infrastructure Owner

**Accountable for:** CI/CD pipeline, static site hosting, vector store, authentication, approved LLM models list, infrastructure domain policy section (10.1).

**Authority:** Final approval authority on `knowledge/infrastructure/` and infrastructure exception requests.

| | |
|---|---|
| Current Holder | TBD ({{POLICY_OWNER_EMAIL}} acting) |
| GitHub Handle | {{INFRA_OWNER_GITHUB}} |
| Effective From | TBD |
| Managers | TBD |

---

## System Architecture Owner

**Accountable for:** System design standards, architectural patterns, system architecture domain policy section (10.2).

**Authority:** Final approval authority on `knowledge/architecture/system/` and architecture exception requests.

| | |
|---|---|
| Current Holder | TBD ({{POLICY_OWNER_EMAIL}} acting) |
| GitHub Handle | {{SYSTEM_ARCH_OWNER_GITHUB}} |
| Effective From | TBD |
| Managers | TBD |

---

## Data Architecture Owner

**Accountable for:** Data standards, data architecture decisions, data architecture domain policy section (10.3).

**Authority:** Final approval authority on `knowledge/architecture/data/` and data architecture exception requests.

| | |
|---|---|
| Current Holder | TBD ({{POLICY_OWNER_EMAIL}} acting) |
| GitHub Handle | {{DATA_ARCH_OWNER_GITHUB}} |
| Effective From | TBD |
| Managers | TBD |

---

## Notes

- All roles currently held by `{{POLICY_OWNER_EMAIL}}` as {{ORG_NAME}} scales.
- As the organization grows, each role should be formally assigned to the appropriate C-suite executive.
- CODEOWNERS must be updated whenever GitHub handles change.
- This file version is identified by its git commit SHA on {{DEFAULT_BRANCH}}.
