---
domain: policies
layer: policy
owner: <POLICY_OWNER_EMAIL>
compliance: C02
status: seed
---

<!-- YOURS AFTER THE FIRST INSTALL. gov seeds this file once and never touches it again (MANIFEST: seed-once),
     so an upgrade cannot overwrite what your organization decides here. The clause numbers are kept: the
     framework's policy points at this file for them, and everything that cites them still resolves. -->

# Data classification — <ORG_NAME>'s tiers

**What kinds of data this organization recognises, and what may be written down.** The four tiers below
are the starter. The one rule the framework does NOT leave to you: whatever you call your most sensitive
tier, it never reaches a log, a knowledge folder, or an LLM provider (POL-427, C01).

## The tiers (starter)

All data handled by agents is classified under one of four categories. Agents must apply classification rules without exception. **(POL-139)**

| Classification | Description | Allowed in Knowledge Base |
|---|---|---|
| **Public** | Information intended for public audiences | Yes **(POL-140)** |
| **Internal** | Internal organizational information | Yes **(POL-141)** |
| **Confidential** | Sensitive business information | Only with explicit C02 approval **(POL-142)** |
| **Restricted** | Credentials, secrets, PII, API keys, tokens | Never **(C01, POL-143)** |

Restricted data must never appear in any knowledge folder, any repository, or in any communication with any LLM provider. **(POL-144)**

An agent that detects restricted data in any repository context must immediately hard stop and escalate to the Policy Owner. **(POL-145)**
