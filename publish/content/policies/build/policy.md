# <ORG_NAME> — Build Policy

> ## This file is yours
>
> gov created it once and **will never overwrite it**. Edit it, add to it, delete what does not apply.
> Everything below is a **starter**: clauses we think most organizations want for building software, written so
> you can see the shape of a good one. Deleting a clause you do not want is the expected first act, not a
> deviation.
>
> This is the build phase's part of your organization's policy. `policies/org-policy.md` is the rest: how this
> policy is written and approved (its §1), and what applies to every phase. The two share one set of section
> numbers, so this file starts at §2. Changing it is a normal policy change: edit, open a pull request, have it
> approved (`policies/org-policy.md` §1.3), merge.

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
turn — see `policies/org-policy.md` §6.3.)*

### 2.4 Formatting is the formatter's job

Formatting is left to the configured formatter. Hand-formatting, or arguing about it in review, is
waste.

---

## 3. Technology choices

### 3.1 Only approved technologies

A language, framework, library, datastore, queue, test runner or CI service that is not listed in
`policies/build/approved-technologies.md` is introduced only with an approved exception.

### 3.2 Removing a technology

Retiring an approved technology is recorded in `policies/build/approved-technologies.md` with the date and the
reason, so that a repository still using it can be found.
