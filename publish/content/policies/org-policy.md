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
> The framework's own rules are in `framework/rules/rules.yaml`, explained in
> `framework/docs/specs/framework-specification.md`. They are **not** yours: they are replaced on every upgrade.
> Your policy here may be stricter than them. It may not be laxer.

---

## 1. About this policy

### 1.1 Plain English

Write this policy in plain English. Nothing here needs a special notation, a number or a marker: gov never
edits this file. How strict each rule is — C01 (stop), C02 (not without an approved exception) or C03 (adapt,
and say so) — is decided per rule when the rules are extracted, and you approve it there. Words such as "must",
"never" and "unless approved" are what the extraction reads as your intent.

`framework/docs/specs/framework-specification.md` chapter 3 explains the three levels, and chapter 9 how a
section becomes rules. Run `gov knowledge show framework-specification.md` to read it.

### 1.2 What happens to a section you write

`gov rules propose` reads each changed section and proposes its rules into `policies/rules.yaml`: who each
binds, how strict it is, a **cue** (a short trigger an agent carries, every turn or at the moment it applies)
and, where possible, a **check** that fails a pull request. You approve the rows in the same pull request as
the prose, so what your agents are told is part of what you reviewed. `gov rules build` renders the rows into
your agents' context and `agent/harness/rule-map.md`; `gov doctor` counts how many are prevented, detected,
cued or advisory.

### 1.3 Who approves a change to this policy

Approval is by the representatives named in `policies/authorized-representatives.md`, enforced at the
pull-request gate. A change to this file is approved by the Policy Owner.

---

## 2. Engineering standards

> Starter clauses. Keep, change the level, or delete.

### 2.1 Code explains itself

Every source file opens with a comment that states what the file is for and why it exists — not what the
code does line by line, which the code already says. A file without one needs an approved exception.

### 2.2 A behaviour change comes with a test

A change to application behaviour comes with a test that would fail without it, unless an exception is
approved.

### 2.3 Every source file carries the licence header

Every source file must carry the organization's SPDX licence identifier. No exception.

*(A rule a machine can see in a diff wants a check, not a cue: an agent does not need to be told it on every
turn — see §6.3.)*

### 2.4 Formatting is the formatter's job

Formatting is left to the configured formatter. Hand-formatting, or arguing about it in review, is
waste.

---

## 3. Technology choices

### 3.1 Only approved technologies

A language, framework, library, datastore, queue, test runner or CI service that is not listed in
`policies/approved-technologies.md` is introduced only with an approved exception.

### 3.2 Removing a technology

Retiring an approved technology is recorded in `policies/approved-technologies.md` with the date and the
reason, so that a repository still using it can be found.

---

## 4. Data

What data this organization holds, what its tiers are called, and how each is handled are in
`policies/data-classification.md`. The framework's own absolute rule — no credential, key, token or password
in a file, a log, a commit, a pull request or an issue — applies whatever this organization decides (see
`policies/data-classification.md`).

---

## 5. Roles

Who owns which domain, and who may approve what, are in `policies/authorized-representatives.md`. Until
owners are appointed, every approval falls to the Policy Owner.

---

## 6. How to write a clause that works

> This section is a guide, not a set of rules — so you can see what guidance looks like beside real clauses.

### 6.1 One clause, one level

Two requirements at the same strength are fine — *"must be reviewed and must not be self-merged"* is one rule.
Two **strengths** in one sentence become two rules, because one rule row and one cue cannot say which half they
mean.

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

`gov doctor` prints the resident cost of your cues. If it is growing, something that belongs in a check has
been put in the resident block.

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
