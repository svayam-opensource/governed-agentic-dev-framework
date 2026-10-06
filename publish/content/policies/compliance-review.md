---
domain: policies
layer: policy
owner: <POLICY_OWNER_EMAIL>
compliance: C02
status: seed
---

<!-- YOURS AFTER THE FIRST INSTALL. gov seeds this file once and never touches it again (MANIFEST: seed-once),
     so an upgrade cannot overwrite what your organization decides here. -->

# Compliance review — <ORG_NAME>'s cadence

**Document:** Compliance Review
**Policy Owner:** <POLICY_OWNER_EMAIL>
**Status:** seed — written once by `gov setup`, and **yours to change**

> ## This file is yours
>
> gov created it once and **will never overwrite it**. Quarterly is a **starter**: an organization that ships
> weekly may want monthly, and one with three repositories may want twice a year. Change the cadence, change
> who does the review, or delete a clause you do not want — that is the expected first act.
>
> The framework has no opinion on how often you look at your own compliance. It only insists that a C01
> violation is not something you find out about at a review (§1.3).
>
> The notation is the framework's: the ALL-CAPS modal verb declares the level (`framework-policy.md` §1.3).

---

## 1. The review

### 1.1 Cadence

The Policy Owner MAY review the organization's compliance summary under `knowledge/compliance/` once every
quarter. **(POL-260)**

### 1.2 What the review answers

The Policy Owner MAY answer three questions in each review: whether every C01 violation raised since the last
one was surfaced and resolved, whether every C02 deviation has an approved exception on file, and whether every
C03 deviation was recorded with its reason. **(POL-261)**

### 1.3 A C01 violation does not wait for the review

An agent or a developer that finds a C01 violation MUST escalate it to the Policy Owner immediately, whatever
this document says about cadence. **(POL-262)**

*(No cue. The framework's own C01 cue — "C01 MEANS STOP … tell the human" — is already resident in every
agent's context on every turn, and a second copy of it would make both weaker: one fact, one document, applied to the resident
block. See `policies/org-policy.md` §6.3.)*

## 2. What the review reads

### 2.1 A deviation is recorded when it is taken, not at the review

An agent MAY record each exception used and each deviation taken in the active project's
`knowledge/compliance.md` at the moment it happens, rather than reconstructing them when the project
closes. **(POL-263)**

<!-- gov:cue generated clause-sha=f79ce80 -->
> **Always in the agent's context** · POL-263 · C02
> JUST DEVIATED FROM A RULE, OR LEANED ON AN EXCEPTION? WRITE IT DOWN NOW — in this project's
> `knowledge/compliance.md`: which POL number, what you did instead, who approved it, when.
> Nobody can reconstruct it at `gov close`. No approval yet? STOP and get one before the work lands.

<!-- gov:check kind=file-required when=verb:close require=knowledge/compliance.md on_miss=warn -->

The check above is the invitation in `policies/knowledge-organization-standard.md` §5 taken up: a
`gov:check … when=verb:close` is how an organization asks `gov close` for the artifacts it wants, and the
refusal names the file and cites the clause. It ships as `on_miss=warn` on purpose — the Policy Owner removed a
hardcoded close gate on 2026-09-27 because it blocked a developer who had hand-worked a project, and a seeded
file should not quietly put it back. Change it to `on_miss=fail` when you want a project with no compliance
record to be unclosable.

### 2.2 Projects feed the organization's summary

The Policy Owner MAY assemble the org-level summary under `knowledge/compliance/` from the projects' own
records, so that the summary has a source other than memory. **(POL-264)**
