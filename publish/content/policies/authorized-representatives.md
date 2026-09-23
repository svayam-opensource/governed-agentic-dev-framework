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

# Authorized representatives — who approves an exception

**Who in this organization may approve an exception, by domain.** Until you appoint owners, every
approval falls to the Policy Owner, which is what the starter says.

## The approvers (starter)

The following individuals are authorized to approve exceptions in their respective domains. Until domain owners are appointed, all exception approvals fall to the Policy Owner. **(POL-157)**

| Domain | Authorized Approver | Current Holder |
|---|---|---|
| Legal exceptions | Legal Owner | <POLICY_OWNER_EMAIL> (until Legal Owner appointed) |
| Infrastructure exceptions | Infrastructure Owner | <POLICY_OWNER_EMAIL> (until Infrastructure Owner appointed) |
| Architecture exceptions | System/Data Architecture Owner | <POLICY_OWNER_EMAIL> (until Architecture Owners appointed) |
| Policy exceptions | Policy Owner | <POLICY_OWNER_EMAIL> |

**(POL-158)**
