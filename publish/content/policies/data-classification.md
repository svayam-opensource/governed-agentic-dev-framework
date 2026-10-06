---
domain: policies
layer: policy
owner: <POLICY_OWNER_EMAIL>
compliance: C02
status: seed
---

<!-- YOURS AFTER THE FIRST INSTALL. gov seeds this file once and never touches it again (MANIFEST: seed-once),
     so an upgrade cannot overwrite what your organization decides here. -->

# Data classification — <ORG_NAME>'s tiers

**Document:** Data Classification
**Governed by:** `policies/org-policy.md` §4
**Policy Owner:** <POLICY_OWNER_EMAIL>
**Status:** seed — written once by `gov setup`, and **yours to change**

> ## This file is yours
>
> gov created it once and **will never overwrite it**. Everything below is a **starter**: four tiers most
> organizations recognise, and a handful of clauses written so you can see the shape of a good one. Renaming a
> tier, merging two of them, or deleting a clause you do not want is the expected first act, not a deviation.
>
> One thing is not yours to relax: no credential, key, token or password goes into any file, log, commit, pull
> request or issue — at C01. Your tiers may be stricter than that. They may not be laxer
> (`framework/docs/specs/framework-specification.md` §9.4).
>
> Write it in plain English. How strict each rule is gets decided per rule when `gov rules propose` extracts it,
> and you approve it there (`framework-specification.md` chapter 9).

---

## 1. The tiers

### 1.1 Four tiers, and the names are yours

The Policy Owner MAY rename these four tiers, merge two of them, or add a fifth, provided the most sensitive
tier keeps the rule in §2.1.

| Tier | What it covers | May be written into `knowledge/` |
|---|---|---|
| **Public** | information intended for people outside the organization | yes (§2.3) |
| **Internal** | ordinary organizational information | yes (§2.3) |
| **Confidential** | sensitive business information | only with an approved exception (§2.2) |
| **Restricted** | credentials, keys, tokens, passwords, personal data | never (§2.1) |

## 2. What may be written down

### 2.1 Name the tier before you write, and never write the restricted one

An agent MUST decide which tier a piece of data belongs to **before** writing it anywhere, and MUST NOT write
restricted data into a file, a log, a commit message, a pull request, an issue, or a prompt sent to an LLM
provider.

*(A starter check for this rule is `gov-builtin/content-forbidden` on every changed file, with a pattern for the
shape `password: <16+ characters>`. It is deliberately crude — tighten it, or narrow `when` to the file types
you actually ship, once you have seen what it says about your own repositories.)*

### 2.2 Confidential data needs an approved exception first

An agent MAY write confidential data into `knowledge/` or a project's knowledge folder only with an exception
already approved and recorded under `policies/exceptions/`.

*(No cue. The moment this rule applies is the moment someone writes a document, and the thing it asks for is a
pull request a person approves — not a judgement an agent makes mid-task. See `policies/org-policy.md` §6.3 for
the test.)*

### 2.3 Public and internal data

An agent CAN write public and internal data into any knowledge folder without an exception; that is what those
two tiers are for.

## 3. When restricted data is already there

### 3.1 Stop, and escalate

An agent that finds restricted data already committed to a repository MUST stop work, commit nothing further,
and escalate to the Policy Owner.

*(No cue. The framework's own C01 cue — "C01 MEANS STOP. No exception exists, and nobody can grant one" — is
already resident in every agent's context on every turn. A second copy of it would make both weaker, which is
one fact, one document, applied to the resident block.)*

## 4. Secrets, and where data may go

### 4.1 Credentials are never written down

A credential, key, token or password is never written into a file, a log, a commit, a pull request or an
issue. Whatever this organization calls its most sensitive tier, that data never reaches a log, a knowledge
folder, a repository or a model provider. Anyone, person or agent, who finds one stops and escalates to the
Policy Owner.

### 4.2 Credentials live in one place

Credentials, including agent API keys, are kept only in the `credentials` directory inside the person's own
preferences folder (`~/.gov/<slug>/preferences/<github-login>/credentials`). They are never kept in a
repository, and never in a file someone else reads.

### 4.3 Nothing confidential or restricted goes to a model provider

Confidential and restricted data are never sent to any model provider, whether or not this organization has
authorized that provider. Authorizing a provider permits it to be used for public and internal data only.

### 4.4 Restricted data never reaches a log

Restricted data is never written to a log: not at any level, not through any transport, and not in any field.
Each part of that sentence has caused a real incident somewhere:

- **Any level.** A secret in a `debug` or `trace` call is still a secret in a log. "It is off in production"
  is a configuration claim, not a property of the code, and it is one flag away from being false.
- **Any transport.** Console, file, syslog, a hosted aggregator, a crash reporter, an APM trace, a span
  attribute: a log line that leaves the process is a log line.
- **Structured fields too.** A tidy message with the credential in a structured field, or an exception
  object logged whole because it carries the request that carried the key, is the common way this rule is
  broken while appearing to be kept.

§2.1 keeps restricted data out of every repository, and §4.3 keeps it away from model providers. This closes
the third route, and it is the one that looks like diligence.
