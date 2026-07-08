---
domain: policies
layer: mandate
compliance: C01
status: current
owner: <POLICY_OWNER_EMAIL>
---

# LLM Governance Policy

**Owner:** Infrastructure Owner (acting: `<POLICY_OWNER_EMAIL>`)
**Parent Policy:** `knowledge/policies/agentic-development-policy.md`
**Compliance Level:** C01 for Prohibited tier and data rules; C02 for Provisional tier

---

## Purpose

This policy governs which LLM providers and models may be used by agents and developers at <ORG_NAME>, and what data may be passed to them.

---

## Provider / Model Tiers

### Approved
Vetted providers and models that have been reviewed for security, data residency, and compliance requirements.

**Usage:** Default allowed. No additional approval needed.
**Agent config:** Use an approved provider/model in the agent's run configuration.

**Current approved list:**

| Provider | Model | Notes |
|---|---|---|
| Cursor | auto | Default — `model: auto, provider: cursor` |

*Maintained by Infrastructure Owner. Updated via `gov-work knowledge`.*

---

### Provisional
Providers or models not yet vetted. May be used for specific projects with Infrastructure Owner approval.

**Usage:** Allowed with Infrastructure Owner C02 approval documented in project exception folder.
**Process:** Raise exception in `knowledge/policies/exceptions/infrastructure/` before use.
**Agent config:** Must still be declared in the agent's run configuration.

---

### Prohibited
Providers or models that have failed or not yet undergone security, data residency, or compliance review, or that have been explicitly banned.

**Usage:** Never. **(C01)**

*Any provider not on the Approved or Provisional list is Prohibited by default.*

---

## Default Agent Configuration

All projects default to:

```yaml
agent_config:
  model: auto
  provider: cursor
```

This must be declared in the agent's run configuration. Agents must not use a different provider without updating this declaration and obtaining appropriate approval.

---

## Data Rules (C01 — No Exceptions)

Regardless of provider approval tier:

1. **No Restricted data** (credentials, secrets, PII, API keys) may ever be passed to any LLM provider. **(C01)**
2. **No Confidential data** may be passed to any LLM provider without explicit C02 approval. **(C01)**
3. Agents must treat all LLM API calls as potentially logged by the provider.

See `knowledge/policies/data-classification.md` for data classification definitions.

---

## Infrastructure Owner Responsibilities

- Maintain the Approved providers list in this file
- Review and approve Provisional provider requests
- Update this policy via `gov-work knowledge` as new providers are vetted
- Ensure CI/CD pipeline and vector store use only Approved providers
