---
domain: policies
layer: policy
owner: <POLICY_OWNER_EMAIL>
compliance: C02
status: seed
---

<!-- YOURS AFTER THE FIRST INSTALL. gov seeds this file once and never touches it again (MANIFEST: seed-once),
     so an upgrade cannot overwrite what your organization decides here. -->

# Authorized representatives — who approves an exception

**Document:** Authorized Representatives
**Governed by:** `policies/org-policy.md` §5 (POL-230)
**Policy Owner:** <POLICY_OWNER_EMAIL>
**Status:** seed — written once by `gov setup`, and **yours to change**

> ## This file is yours
>
> gov created it once and **will never overwrite it**. The table in §1.2 is a **starter**: it routes every
> approval to the Policy Owner, because on the first day of an adoption that is the only role that exists.
> Appointing owners, splitting a domain, or deleting a clause you do not want is the expected first act.
>
> This file names **real people**, and it is the list an exception is checked against. Keeping it true is
> therefore not documentation work — a stale row here is an approval nobody actually gave.
>
> The notation is the framework's: the ALL-CAPS modal verb declares the level (`framework-policy.md` §1.3).

---

## 1. Who approves an exception

### 1.1 Every exception has a named approver

An exception request MUST be approved by the representative named for its domain in §1.2, and until a domain
owner is appointed the Policy Owner MUST be that representative. **(POL-250)**

### 1.2 The representatives (starter)

| Domain | Authorized approver | Current holder |
|---|---|---|
| Legal | Legal Owner | <POLICY_OWNER_EMAIL> (until a Legal Owner is appointed) |
| Infrastructure | Infrastructure Owner | <POLICY_OWNER_EMAIL> (until an Infrastructure Owner is appointed) |
| Architecture | System / Data Architecture Owner | <POLICY_OWNER_EMAIL> (until Architecture Owners are appointed) |
| Policy | Policy Owner | <POLICY_OWNER_EMAIL> |

The Policy Owner MAY appoint a representative, or change one, by a pull request to this file. An appointment
announced anywhere else does not reach the gate, because the gate reads this file. **(POL-251)**

### 1.3 Nobody approves their own exception

The requester MUST NOT approve their own exception request, in any domain, including when the requester is the
Policy Owner. **(POL-252)**

*(Advisory, and honestly so: none of the seven predicates can see who authored a change and who approved it —
that is the version-control platform's job, configured as a required review by somebody other than the author.
`framework-policy.md` §3.4 says what follows when a platform will not provide it.)*

## 2. Keeping this file true

### 2.1 An agent does not appoint anybody

An agent MUST NOT add, remove or change a representative in this file: an appointment is a human decision,
recorded by the human who made it. **(POL-253)**

<!-- gov:cue generated clause-sha=2148543 -->
> **Always in the agent's context** · POL-253 · C01
> ASKED TO CHANGE WHO APPROVES THINGS? IT IS NOT YOURS TO CHANGE.
> `policies/authorized-representatives.md` names real people and is the list an exception is checked against.
> Draft the wording if you are asked to, and STOP: a human opens the pull request and a human approves it.
> Never edit it in passing, as part of another task.

### 2.2 A departure is recorded when access changes

The Policy Owner MAY update this file in the same pull request that changes a named holder's access, so that
the list and the access cannot disagree. **(POL-254)**

## 3. Every role has a holder

Every role this organization defines, in §1.2 or anywhere else in `policies/`, has a named person holding it
at all times. When a role falls vacant, the Policy Owner holds it until someone new is named, and records the
vacancy here in the same pull request that removes the departing holder. A role with nobody in it is a
question nobody is answering, and an approval nobody can give.

The framework holds its own two roles, the Policy Owner and the Check Owner, to the same standard: `gov setup`
will not finish without both, and `gov doctor` reports either one when it falls empty.
