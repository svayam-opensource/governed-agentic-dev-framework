# Data classification — <ORG_NAME>'s tiers

**Document:** Data Classification
**Governed by:** `policies/org-policy.md` section 4
**Policy Owner:** <POLICY_OWNER_EMAIL>
**Status:** seed — written once by `gov setup`, and **yours to change**

> ## This file is yours
>
> gov created it once and **will never overwrite it**. Everything below is a starter: four tiers most
> organizations recognise, and a handful of rules written so you can see the shape of a good one. Renaming a
> tier, merging two of them, or deleting a rule you do not want is the expected first act, not a deviation.
>
> One thing is not yours to relax: a credential, key, token or password never goes into any file, log,
> commit, pull request or issue, and there is no exception to that. Your tiers may be stricter. They may not
> be laxer (`framework/docs/specs/framework-specification.md` section 9.4).

---

## 1. The tiers

### 1.1 Four tiers, and the names are yours

The Policy Owner may rename these four tiers, merge two of them, or add a fifth. Whatever the names, the most
sensitive tier always keeps the rule in section 2.1; changing that needs an approved exception.

| Tier | What it covers | May be written into `knowledge/` |
|---|---|---|
| **Public** | information intended for people outside the organization | yes (section 2.3) |
| **Internal** | ordinary organizational information | yes (section 2.3) |
| **Confidential** | sensitive business information | only with an approved exception (section 2.2) |
| **Restricted** | credentials, keys, tokens, passwords, personal data | never (section 2.1) |

## 2. What may be written down

### 2.1 Name the tier before you write, and never write the restricted one

Before an agent writes a piece of data anywhere, it decides which tier the data belongs to. It never writes
restricted data into a file, a log, a commit message, a pull request, an issue, or a prompt sent to an LLM
provider. There is no exception to either half.

This is the moment that matters most in this document, because it is a judgement an agent makes in the middle
of a task, before anything a check could see exists. It is worth an agent being reminded of it whenever it is
about to write.

A check can back it up, crudely: a scan of every changed file for something shaped like
`password: <16 or more characters>`. Tighten the pattern, or narrow it to the file types you actually ship,
once you have seen what it finds in your own repositories.

### 2.2 Confidential data needs an approved exception first

Confidential data goes into `knowledge/` or a project's knowledge folder only when an exception has already
been approved and recorded under `policies/exceptions/`. Without that, it does not go in.

The moment this applies is the moment someone writes a document, and what it asks for is a pull request a
person approves, not a judgement an agent makes mid-task. So it needs no reminder in an agent's context.

### 2.3 Public and internal data

Public and internal data may be written into any knowledge folder without an exception. That is what those
two tiers are for.

## 3. When restricted data is already there

### 3.1 Stop, and escalate

An agent that finds restricted data already committed to a repository stops work at once, commits nothing
further, and tells the Policy Owner. There is no exception to this.

Agents need no separate reminder of it: the framework already tells every agent, on every turn, to stop and
tell a person when a rule like this is broken.

## 4. Secrets, and where data may go

### 4.1 Credentials are never written down

A credential, key, token or password is never written into a file, a log, a commit, a pull request or an
issue. Whatever this organization calls its most sensitive tier, that data never reaches a log, a knowledge
folder, a repository or a model provider. Anyone, person or agent, who finds one stops and tells the Policy
Owner. There is no exception to this.

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
  is a claim about configuration, not about the code, and it is one flag away from being false.
- **Any transport.** Console, file, syslog, a hosted aggregator, a crash reporter, an APM trace, a span
  attribute: a log line that leaves the process is a log line.
- **Structured fields too.** A tidy message with the credential in a structured field, or an exception
  object logged whole because it carries the request that carried the key, is the common way this rule is
  broken while appearing to be kept.

Section 2.1 keeps restricted data out of every repository, and section 4.3 keeps it away from model providers.
This closes the third route, and it is the one that looks like diligence.
