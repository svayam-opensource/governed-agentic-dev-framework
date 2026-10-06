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
**Governed by:** `policies/org-policy.md` §4 (POL-220)
**Policy Owner:** <POLICY_OWNER_EMAIL>
**Status:** seed — written once by `gov setup`, and **yours to change**

> ## This file is yours
>
> gov created it once and **will never overwrite it**. Everything below is a **starter**: four tiers most
> organizations recognise, and a handful of clauses written so you can see the shape of a good one. Renaming a
> tier, merging two of them, or deleting a clause you do not want is the expected first act, not a deviation.
>
> One thing is not yours to relax. `framework/policies/framework-policy.md` §9.9 forbids a credential, key,
> token or password in any file, log, commit, pull request or issue — at C01, for every adopter — and points
> here for everything else. Your tiers MAY be stricter than that. They MUST NOT be laxer (framework-policy
> §10.1).
>
> The notation is the framework's: the ALL-CAPS modal verb declares the level. `MUST`/`SHALL` = C01, `MAY` =
> C02, `CAN` = C03. The table and the rules that go with it — one clause one level, and a clause names its
> actor — are in `framework-policy.md` §1.3, and deliberately not repeated here.

---

## 1. The tiers

### 1.1 Four tiers, and the names are yours

The Policy Owner MAY rename these four tiers, merge two of them, or add a fifth, provided the most sensitive
tier keeps the rule in §2.1. **(POL-240)**

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
provider. **(POL-241)**

<!-- gov:cue generated clause-sha=66b371b -->
> **Always in the agent's context** · POL-241 · C01
> BEFORE YOU WRITE DATA DOWN, NAME ITS TIER — Public · Internal · Confidential · Restricted. Unsure which?
> Run `gov knowledge search "data classification"`.
> A credential, key, token, password or personal datum is RESTRICTED: it goes into no file, no log, no commit,
> no pull request, no issue and no prompt. Still unsure? STOP and ask. Redacting it in a later commit does not
> undo it — it is already in the history.

<!-- gov:check kind=content-forbidden when=** pattern=(?:secret|token|password|passwd|api[_-]?key|SECRET|TOKEN|PASSWORD|API[_-]?KEY)[A-Za-z_]*["']?\s*[:=]\s*["']?[A-Za-z0-9/+=_-]{16,} on_miss=fail -->

*(The pattern above is a starter and it is deliberately crude — it catches the shape `password: <16+ characters>`
and nothing cleverer. Tighten it, or point `when=` at the file types you actually ship, once you have seen what
it says about your own repositories.)*

### 2.2 Confidential data needs an approved exception first

An agent MAY write confidential data into `knowledge/` or a project's knowledge folder only with an exception
already approved and recorded under `policies/exceptions/`. **(POL-242)**

*(No cue. The moment this rule applies is the moment someone writes a document, and the thing it asks for is a
pull request a person approves — not a judgement an agent makes mid-task. See `policies/org-policy.md` §6.3 for
the test.)*

### 2.3 Public and internal data

An agent CAN write public and internal data into any knowledge folder without an exception; that is what those
two tiers are for. **(POL-243)**

## 3. When restricted data is already there

### 3.1 Stop, and escalate

An agent that finds restricted data already committed to a repository MUST stop work, commit nothing further,
and escalate to the Policy Owner. **(POL-244)**

*(No cue. The framework's own C01 cue — "C01 MEANS STOP. No exception exists, and nobody can grant one" — is
already resident in every agent's context on every turn. A second copy of it would make both weaker, which is
POL-402 applied to the resident block.)*

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
