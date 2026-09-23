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

# Compliance review — <ORG_NAME>'s cadence

**How often this organization reviews its own compliance, and who does it.** Quarterly is the starter;
an organization that ships weekly may want monthly, and one with a small estate may want twice a year.

## The review (starter)

The Policy Owner must review the org-level compliance summary in `knowledge/compliance/` on a quarterly basis **(C02, POL-107)**. This review must assess whether C01 violations have been surfaced, C02 exceptions are being used appropriately, and C03 deviations are being documented.

Per-project `compliance.md` files feed into the org-level compliance summary. **(POL-108)**

Critical C01 violations escalate to the Policy Owner immediately, regardless of the quarterly review cadence. **(POL-109)**
