# Data Classification Policy

**Owner:** Policy Owner (`<POLICY_OWNER_EMAIL>`)
**Parent Policy:** `knowledge/policies/agentic-development-policy.md`
**Compliance Level:** C01 for Restricted tier; C02 for Confidential tier

---

## Purpose

This policy defines how data is classified at <ORG_NAME> and the rules governing what data may appear in repositories, knowledge bases, and agent contexts.

---

## Classification Tiers

### Public
Data that is safe for unrestricted disclosure.

**Examples:** Architecture patterns, coding standards, publicly available documentation, open-source references.

**Knowledge base:** Allowed without restriction.
**Repositories:** Allowed without restriction.
**Agent context:** Allowed.

---

### Internal
Data intended for internal use only. Not for external distribution but not critically sensitive.

**Examples:** Org processes, infrastructure topology, internal tooling documentation, team structures, project plans.

**Knowledge base:** Allowed without restriction.
**Repositories:** Allowed. Must not be publicly exposed.
**Agent context:** Allowed.

---

### Confidential
Sensitive business data. Disclosure could harm business interests, client relationships, or competitive position.

**Examples:** Client details, commercial agreements, financial data, unreleased product plans, personnel information.

**Knowledge base:** Allowed only with explicit C02 approval.
**Repositories:** Allowed with appropriate access controls.
**Agent context:** Allowed only after C02 approval is documented in `project.yaml`.
**Process:** Raise exception request in `knowledge/policies/exceptions/policy/` and obtain Policy Owner approval before including.

---

### Restricted
Critically sensitive data. Inclusion in any repository or knowledge base is a hard policy violation.

**Examples:** Credentials, passwords, API keys, private keys, secrets, PII (personally identifiable information), payment card data, health records, biometric data.

**Knowledge base:** NEVER. No exceptions. **(C01)**
**Repositories:** NEVER in committed files. Use secrets management systems. **(C01)**
**Agent context:** NEVER pass Restricted data to any LLM provider. **(C01)**

---

## Agent Behavior on Detection

If an agent detects Restricted data in any file it is about to commit or pass to an LLM:

1. **Hard stop** — do not commit, do not proceed **(C01)**
2. Remove or redact the data immediately
3. Surface the detection to the human developer
4. Escalate to Policy Owner (`<POLICY_OWNER_EMAIL>`)
5. Log the incident in `projects/PRJ-NNN-<slug>/knowledge/compliance.md`

Failure to stop on detecting Restricted data is itself a C01 violation.

---

## LLM Provider Rules

Regardless of data classification, no Confidential or Restricted data may be sent to any LLM provider — even approved providers. **(C01)**

See `knowledge/policies/llm-governance.md` for provider approval tiers.
