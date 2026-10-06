---
domain: policies
layer: policy
owner: <POLICY_OWNER_EMAIL>
compliance: C02
status: seed
---

# Knowledge publication — <ORG_NAME>'s decision

**Document:** Knowledge Publication
**Owner:** Infrastructure Owner (acting: <POLICY_OWNER_EMAIL>)
**Status:** seed — written once by `gov setup`, and **yours to change**

> ## This file is yours, and it may well be yours to delete
>
> gov created it once and **will never overwrite it**. The framework ships **none** of this infrastructure
> and requires none of it. `gov knowledge search` and `gov knowledge show` read the markdown already cloned on
> every machine, so an organization that publishes nothing is fully compliant. The `knowledge_publication`
> setting records what you chose; it is `none` by default.
>
> Everything below is a starter describing the arrangement Svayam runs. Keep it, cut it down to one form, or
> delete the document. That is the expected first act, not a deviation.
>
> Notice how few rules this document has. It governs a pipeline **you** build, so most of it is a
> specification for whoever builds it rather than a rule anybody can be held to.

---

## 1. Whether this organization publishes its knowledge

### 1.1 The decision is a setting, not a paragraph

The Policy Owner records the organization's choice in the `knowledge_publication` setting. This always
applies; an arrangement described in this document but not set there is a plan, not a policy, and nothing
reads it.

### 1.2 One source, several renderings

Every published form is generated from the markdown in this repository, and no published artifact is edited
by hand, so that no published copy can disagree with the source it came from. Editing a published copy
directly needs an approved exception.

### 1.3 Nothing confidential reaches an unauthenticated reader

A document holding confidential or restricted data (see `policies/data-classification.md`) is never published
in any form that can be reached without authentication. There is no exception to this.

## 2. The three forms (starter)

### 2.1 Form 1 — the static site, internal only

The main reading surface for developers, governance and audit: every document under `knowledge/` and
`projects/` rendered as navigable, searchable, linked pages, with URLs that mirror the folder structure, and
reflecting `<DEFAULT_BRANCH>` within an hour of a merge.

The site sits behind authentication that only the organization's own authorized users pass, such as SSO or
the version-control platform's own sign-in. Opening it to anyone else needs an approved exception.

### 2.2 Form 2 — PDF exports, for people outside

One PDF per top-level policy document, regenerated when `framework/` or `policies/` changes, and linked from
the matching page on the static site. These are the copies that reach a regulator or an external auditor.

Every generated PDF carries the document's title, the commit it was generated from, its effective date and
the Policy Owner's name, so that a copy in someone else's hands can be traced back to its source. Leaving any
of these off needs an approved exception.

### 2.3 Form 3 — vector embeddings, for retrieval

An index over `knowledge/` that lets an agent find the few relevant documents without reading all of them.
One chunk per `##` section, each carrying its file path, section heading, source commit and domain owner, so
that a retrieved fragment says what it is and how binding it is.

As a strong default, re-embed only the files a merge changed, rather than re-indexing the whole tree.

## 3. For whoever builds it

### 3.1 What the Infrastructure Owner owns

The choice of static-site generator, PDF toolchain and vector store; the ingestion pipeline; uptime; and the
internal API through which agents and `gov close` read the index. None of it is prescribed here. These are
renderers over the same files, and `policies/knowledge-organization-standard.md` section 6 keeps git,
markdown and pull-request approval as the only way to write knowledge, precisely so that a renderer can be
swapped without a policy change.

### 3.2 Checklist

- [ ] the `knowledge_publication` setting says what you actually run
- [ ] static site deployed, behind authentication
- [ ] PDF generation wired to merges that touch the policy folders
- [ ] vector store provisioned; ingestion re-embeds changed files only
- [ ] all three forms regenerate on a `<DEFAULT_BRANCH>` merge, from CI, with no manual step
- [ ] pipeline failures alert somebody

### 3.3 Why nothing in gov checks these rules

gov's built-in checks read a change and a workspace. None of them can see a published site, a PDF or a
vector index. So the rules here are advisory as far as gov is concerned: written because they matter, with
nothing in gov enforcing them. The place to enforce them is the publishing pipeline's own CI, and
`framework/docs/specs/framework-specification.md` section 11.3 explains the distinction being relied on here.
`gov doctor` counts them as advisory, which is the honest number.

### 3.4 Why agents need no reminder of them either

A reminder in an agent's context costs space on every turn of every session. Nothing here is a judgement an
agent makes mid-task: an agent writing a document does not decide how it is published. The one thing an
author must not get wrong, what may be written down at all, is already covered by
`policies/data-classification.md` section 2.1. A second, similar reminder would weaken both
(`policies/org-policy.md` section 6.3).

## 4. Who owns this document

As seeded, every section of this document is owned by the Policy Owner. Once an Infrastructure Owner is
appointed in `policies/authorized-representatives.md`, the Policy Owner may hand sections 2 and 3 to that role
by rewriting this sentence.
