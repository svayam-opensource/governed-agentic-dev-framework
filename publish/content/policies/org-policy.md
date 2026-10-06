---
domain: policies
layer: mandate
owner: policy-owner
compliance: C02
status: draft
---

# <ORG_NAME> — Development Policy

**Document:** Development Policy
**Policy Owner:** <POLICY_OWNER_EMAIL>
**Status:** draft — seeded by `gov setup`, and **yours to change**

> ## This file is yours
>
> gov created it once and **will never overwrite it**. Edit it, add to it, delete what does not apply.
> Everything below is a **starter**: clauses we think most organizations want, written so you can see the
> shape of a good one. Deleting a clause you do not want is the expected first act, not a deviation.
>
> Changing it is a normal policy change: edit, open a pull request, have it approved (§1.3), merge. The rules
> reach your agents from `<DEFAULT_BRANCH>` — never from a working branch.
>
> The framework's own policy is `framework/policies/framework-policy.md`. It is **not** yours: it is replaced
> on every upgrade. Your policy here MAY be stricter than it. It MUST NOT be laxer.

---

## 1. About this policy

### 1.1 Notation

This policy uses the framework's notation: **the modal verb declares the compliance level**, ALL CAPS only.
`MUST`/`SHALL` = C01, `MAY` = C02, `CAN` = C03. The full table, and the six rules that go with it, are in
`framework/policies/framework-policy.md` §1.3 — deliberately not repeated here, because a fact restated in
two documents is a fact that will eventually disagree with itself (POL-402).

Run `gov knowledge show framework-policy.md` to read it.

### 1.2 What happens to a clause you write

`gov rules build` compiles each clause into a **cue** — a short trigger placed in every agent's context, on
every turn — and, where possible, a **check** that fails a pull request. `gov doctor` tells you how many of
your clauses are checked, cued, advisory, and **ungoverned** (prose that states a requirement but forgot a
modal verb, so it compiles to nothing).

You write the prose. An agent drafts the cue inside the pull request; you approve it there, so what your
agents are told is part of what you reviewed.

### 1.3 Who approves a change to this policy

Approval is by the representatives named in `policies/authorized-representatives.md`, enforced at the
pull-request gate. A change to this file MAY be approved by the Policy Owner. **(POL-200)**

---

## 2. Engineering standards

> Starter clauses. Keep, change the level, or delete.

### 2.1 Code explains itself

Every source file MAY open with a comment that states what the file is for and why it exists — not what the
code does line by line, which the code already says. **(POL-201)**

<!-- gov:cue generated clause-sha=172b09b -->
> **Always in the agent's context** · POL-201 · C02
> A NEW SOURCE FILE OPENS WITH A COMMENT saying what it is for and why it exists — the reason, not a
> restatement of the code. No comment is a review finding, not a style preference.

<!-- gov:check kind=content-required when=**/*.ts,**/*.js,**/*.py,**/*.go
     pattern=^\s*(//|#|/\*) within_lines=5 on_miss=warn -->

### 2.2 A behaviour change comes with a test

A change to application behaviour MAY be accompanied by a test that would fail without it. **(POL-202)**

<!-- gov:cue generated clause-sha=16751fa -->
> **Always in the agent's context** · POL-202 · C02
> CHANGING BEHAVIOUR? BRING A TEST that fails without your change. "Tested manually" is not a test, and a
> test written to pass is not evidence.

<!-- gov:check kind=file-required when=src/**,lib/**,app/** require=test/**,tests/**,**/*.test.* on_miss=warn -->

### 2.3 Every source file carries the licence header

Every source file MUST carry the organization's SPDX licence identifier. **(POL-203)**

<!-- gov:check kind=content-required when=**/*.ts,**/*.js,**/*.py,**/*.go
     pattern=SPDX-License-Identifier on_miss=fail -->

*(No cue: a machine sees this in a diff perfectly well, and an agent does not need to be told on every turn.
That is a deliberate choice — see §6.3.)*

### 2.4 Formatting is the formatter's job

Formatting CAN be left to the configured formatter. Hand-formatting, or arguing about it in review, is
waste. **(POL-204)**

---

## 3. Technology choices

### 3.1 Only approved technologies

A language, framework, library, datastore, queue, test runner or CI service that is not listed in
`policies/approved-technologies.md` MAY be introduced only with an approved exception. **(POL-210)**

<!-- gov:cue generated clause-sha=fa2f24d -->
> **Always in the agent's context** · POL-210 · C02
> TECHNOLOGY CHOICES ARE NOT YOURS. Before adding a dependency or choosing a language, framework, library,
> datastore, queue, test runner or CI step — or editing package.json · go.mod · pom.xml · requirements.txt ·
> Dockerfile · CI config — run: `gov knowledge search "approved <thing>"`.
> Named there? Use it. Not named? STOP and ask. Never pick one yourself.

<!-- gov:check kind=list-membership when=**/package.json,**/go.mod,**/pom.xml,**/requirements.txt
     list=policies/approved-technologies.md on_miss=fail -->

### 3.2 Removing a technology

Retiring an approved technology MAY be recorded in `policies/approved-technologies.md` with the date and the
reason, so that a repository still using it can be found. **(POL-211)**

---

## 4. Data

What data this organization holds, what its tiers are called, and how each is handled are in
`policies/data-classification.md`. The framework's own absolute rule — no credential, key, token or password
in a file, a log, a commit, a pull request or an issue — is in `framework-policy.md` §9.9 and applies
whatever this organization decides. **(POL-220 — see `policies/data-classification.md`)**

---

## 5. Roles

Who owns which domain, and who may approve what, are in `policies/authorized-representatives.md`. Until
owners are appointed, every approval falls to the Policy Owner. **(POL-230 — see that policy)**

---

## 6. How to write a clause that works

> This section is a guide, not a set of rules. It has no modal verbs on purpose — so `gov doctor` will not
> report it as ungoverned, and so you can see what unnumbered guidance looks like beside real clauses.

### 6.1 One clause, one level

Two modals at the same level are fine — *"MUST be reviewed and MUST NOT be self-merged"* is one rule. Two
**levels** in one clause is rejected, because one POL number and one cue cannot say which half they mean.

### 6.2 Three properties of a cue that actually fires

1. **Fire on an artifact, not an abstraction.** "A technology decision" is invisible to an agent in the
   middle of a task. "You are editing `package.json`" is not.
2. **Name the command, not the document.** A path gets renamed; `gov knowledge search` does not.
3. **State what to do when the answer is missing — and make it `stop`.** Absence of a rule reads as
   permission unless you say otherwise. This is the sentence most often left out, and the most expensive.

### 6.3 Not every clause deserves a cue

A cue costs context on **every turn of every session**, and a long resident block makes each rule in it
weaker. So:

- a rule a machine can see in a diff (a licence header, a file name) → **check only**, no cue;
- a rule about a judgement an agent makes mid-task (which library, whether this is restricted data) → **cue**,
  because no check will catch the decision before it is made;
- a rule with neither → advisory. Write it anyway if it matters, but know that nothing enforces it.

`gov doctor` prints the resident cost of your cues. If it is growing, something that belongs in the policy
has been put in the resident block.

### 6.4 Where clauses come from

Good clauses are usually written after something went wrong. A clause that cannot name the failure it
prevents is often a preference in the costume of a policy — and preferences belong in a developer's own
preferences file, not here.

---

## 7. People stay accountable for AI-assisted work

When an AI tool helps with a task, the person using it remains responsible for the result. Before relying on
what the tool produced, that person checks that it complies with this policy and with the framework's rules.
Handing the work to a tool does not hand over the accountability: "the agent wrote it" is never the answer to
"who approved this?".

## 8. Who owns each section of this policy

Each section of a policy document has an owner, and a change to a section is approved by that section's owner.
Write the ownership here, in plain sentences, one per section or group of sections. When this policy changes,
gov reads these sentences into `policies/ownership.yaml`. On a pull request it then asks the owner of every
changed section to review, and requires each of them to approve.

**As seeded:** every section of this policy is owned by the Policy Owner, because on the first day of an
adoption that is the only owner there is.

Three things always hold, whatever you write here:

- A section that names no owner belongs to the Policy Owner.
- A change to this section, or to `policies/ownership.yaml`, is approved by the Policy Owner. Nobody can
  hand a section to themselves.
- An executable check action under `policies/actions/` is approved by the Check Owner.

> **An example of delegating sections.** Once your organization has appointed owners in
> `policies/authorized-representatives.md`, the Policy Owner might replace the "as seeded" sentence above with:
>
> *Sections 1, 5, 7 and 8 of this policy are owned by the Policy Owner.*
> *Section 2 is owned by the System Architecture Owner.*
> *Section 3 is owned by the System Architecture Owner.*
> *Section 4 is owned by the Data Architecture Owner.*
> *In `policies/data-classification.md`, every section is owned by the Data Architecture Owner.*
>
> Each role named must be one listed in `policies/authorized-representatives.md`, with a named holder.
