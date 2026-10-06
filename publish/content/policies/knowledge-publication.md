---
domain: policies
layer: policy
owner: <POLICY_OWNER_EMAIL>
compliance: C02
status: seed
---

<!-- YOURS AFTER THE FIRST INSTALL. gov seeds this file once and never touches it again (MANIFEST: seed-once),
     so an upgrade cannot overwrite what your organization decides here. -->

# Knowledge publication — <ORG_NAME>'s decision

**Document:** Knowledge Publication
**Owner:** Infrastructure Owner (acting: <POLICY_OWNER_EMAIL>)
**Status:** seed — written once by `gov setup`, and **yours to change**

> ## This file is yours, and it may well be yours to delete
>
> The framework ships **none** of this infrastructure and requires none of it. `gov knowledge search|show`
> reads the markdown already cloned on every machine, so an organization that publishes nothing is fully
> compliant. `knowledge_publication` in `org-config.yaml` records what you chose; it is `none` by default.
>
> Everything below is a **starter** describing the arrangement Svayam runs. Keep it, cut it down to one form,
> or delete the document — that is the expected first act, not a deviation.
>
> The notation is the framework's: the ALL-CAPS modal verb declares the level (`framework-policy.md` §1.3).
> Note how few clauses this document has: it governs a pipeline **you** build, so most of it is a
> specification for whoever builds it rather than a rule anybody can be held to.

---

## 1. Whether this organization publishes its knowledge

### 1.1 The decision is a setting, not a paragraph

The Policy Owner MAY record this organization's choice in `knowledge_publication` in `org-config.yaml`. An
arrangement described in this document but not set there is a plan, not a policy, and nothing reads it. **(POL-270)**

### 1.2 One source, several renderings

The organization MAY generate every published form from the markdown in this repository, and edit no published
artifact directly, so that no published copy can disagree with the source it came from. **(POL-271)**

### 1.3 Nothing confidential reaches an unauthenticated reader

The organization MUST NOT publish a document holding confidential or restricted data (see
`policies/data-classification.md`) to any form reachable without authentication. **(POL-272)**

## 2. The three forms (starter)

### 2.1 Form 1 — the static site, internal only

The primary reading surface for developers, governance and audit: every document under `knowledge/` and
`projects/` rendered as navigable, searchable, hyperlinked pages, with URLs mirroring the folder structure, and
reflecting `<DEFAULT_BRANCH>` within an hour of a merge.

The organization MAY place the static site behind authentication that only its own authorized users pass — SSO,
or the version-control platform's own identity. **(POL-273)**

### 2.2 Form 2 — PDF exports, for people outside

One PDF per top-level policy document, regenerated when `framework/policies/` or `policies/` changes, linked
from the corresponding page on the static site. These are the copies that reach a regulator or an external
auditor.

The organization MAY carry, on every generated PDF, the document's title, the commit it was generated from, its
effective date and the Policy Owner's name, so that a copy in someone else's hands can be traced back to a
source. **(POL-274)**

### 2.3 Form 3 — vector embeddings, for retrieval

An index over `knowledge/` that lets an agent find the relevant few documents without reading all of them.
One chunk per `##` section, each carrying its file path, section heading, source commit and domain owner, so
that a retrieved fragment says what it is and how binding it is.

The organization CAN re-embed only the files a merge changed, rather than re-indexing the whole tree. **(POL-275)**

## 3. For whoever builds it

### 3.1 What the Infrastructure Owner owns

Choice of static-site generator, PDF toolchain and vector store; the ingestion pipeline; uptime; and the
internal API that agents and `gov close` read the index through. None of it is prescribed here: these are
renderers over the same files, and `policies/knowledge-organization-standard.md` §6 keeps the write
path — git, markdown, pull-request approval — the only authoring system, precisely so that a renderer can be
swapped without a policy change.

### 3.2 Checklist

- [ ] `knowledge_publication` set in `org-config.yaml` to what you actually run
- [ ] static site deployed, behind authentication
- [ ] PDF generation wired to merges touching the policy folders
- [ ] vector store provisioned; ingestion re-embeds changed files only
- [ ] all three forms regenerate on `<DEFAULT_BRANCH>` merge, from CI, with no manual step
- [ ] pipeline failures alert somebody

### 3.3 Why this document carries no check

None of the seven predicates (`naming`, `path-scope`, `list-membership`, `content-forbidden`,
`content-required`, `file-required`, `frontmatter-required`) can see a published site, a PDF or a vector index:
they read a changeset and a workspace. So the clauses here are **advisory** — written because they matter, with
nothing in gov enforcing them. The place to enforce them is the publishing pipeline's own CI, and
`framework/docs/specs/gov-behaviour.md` draws the distinction being relied on here. `gov doctor` counts them as advisory, which is the
honest number.

### 3.4 Why it carries no cue either

A cue costs context on every turn of every session. Nothing here is a judgement an agent makes mid-task: an
agent writing a document does not decide how it is published, and the one rule an author must not get wrong —
what may be written down at all — already has its cue in `policies/data-classification.md` §2.1. Adding a
second, similar resident block would weaken both (`policies/org-policy.md` §6.3).
