# Policy domains — <ORG_NAME>'s own policies

**Document:** Policy Domains
**Policy Owner:** <POLICY_OWNER_EMAIL>
**Status:** seed — written once by `gov setup`, and **yours to change**

> ## This file is yours
>
> gov created it once and **will never overwrite it**. It lists the policies most organizations end up
> writing for themselves, each with the role that would own it. Rename a domain, merge two, add one, or delete
> the ones you do not need. That is the expected first act, not a deviation.
>
> Nothing here is a rule yet. Each domain below is a placeholder for a policy your organization has not
> written. Write it here, in plain English, or say where you keep it.

---

## 1. Until a domain has an owner, the Policy Owner decides

Each domain below names the role that will own it. Until somebody holds that role (see
`policies/authorized-representatives.md`), the Policy Owner decides every question that falls in the domain.

## 2. The domains (starter)

### 2.1 Infrastructure

**Status:** not yet written. **Owner:** the Infrastructure Owner, once appointed.

Would cover: standards for CI/CD pipelines, the hosting platform, the vector store, authentication and
authorization, and which LLM providers may be used. Once written, it is the reference for every
infrastructure decision.

### 2.2 System architecture

**Status:** not yet written. **Owner:** the System Architecture Owner, once appointed.

Would cover: system design standards, API contracts, how services talk to each other, and how architectural
decisions are made and recorded.

### 2.3 Data architecture

**Status:** not yet written. **Owner:** the Data Architecture Owner, once appointed.

Would cover: data modelling standards, data pipeline architecture, where data may reside and under whose law,
and how data is governed.

### 2.4 Legal and compliance

**Status:** not yet written. **Owner:** the Legal Owner, once appointed.

Would cover: the legal requirements that apply to building software here, obligations under contracts with
third-party tool providers, intellectual property, and the jurisdictions the organization answers to.

## 3. How to write one

Write a domain's policy the same way as `policies/org-policy.md`: plain English, one requirement per
paragraph, and say why. Say how firmly each requirement binds in ordinary words: "never", "always, unless an
exception is approved", or "as a strong default". When the policy changes, `gov rules propose` reads it and
proposes its rules; the people who own its sections approve them (`policies/org-policy.md` section 8).
