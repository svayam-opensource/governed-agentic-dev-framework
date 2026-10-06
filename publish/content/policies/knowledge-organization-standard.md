# Knowledge Organization Standard

**Document:** Knowledge Organization Standard
**Policy Owner:** <POLICY_OWNER_EMAIL>
**Status:** seeded by `gov setup`, and **yours to change**

> ## This file is yours
>
> gov created it once and **will never overwrite it**. It is a starting point for how your organization
> structures, describes and finds its knowledge under `knowledge/`. The structure below is one that has worked;
> the domain list in particular is meant to be replaced with yours (section 8). Changing or deleting a rule
> you do not want is the expected first act, not a deviation.
>
> Two rules this standard leans on are the framework's, not yours, and are not restated here:
> every fact lives in one document, and structure is drawn as text
> (`framework/docs/specs/framework-specification.md` sections 8.2 and 8.4). `knowledge/` ships empty because
> of the framework (section 8.1 there); what grows in it is decided here.

---

## 1. Storage and navigation are two different things

**Storage follows accountability. Navigation follows the reader's journey.** Never mix the two; there is no
exception to this.

- The folder tree exists so that every document has exactly one owner who approves changes to it, through
  `CODEOWNERS` and pull-request review. So the tree is organized by who is accountable, never by reader
  journey, document kind or org chart.
- Readers and agents are served by a separate navigation layer (section 5). A navigation document holds
  **links in the order to consult them, never content**.
- Putting a copy of a fact "on the path" where a reader will meet it breaks the framework's one-fact rule. Link
  to the fact instead.

## 2. Domains — the ownership tree

A top-level domain under `knowledge/` exists **only while a named owner role exists for it** in
`policies/authorized-representatives.md`. The tree changes only when an accountability domain and its owner
role are created or retired. This always applies; a domain without an owner needs an approved exception.

That is why `knowledge/` ships empty. A framework that created domains in advance would run this rule
backwards: the tree would exist before anyone was accountable for it, and every adopter would be committed to
one taxonomy before knowing its own domains. An organization that structures knowledge by delivery phase, by
product line, or by anything else is doing what this standard asks.

Framework material is not under `knowledge/`. The framework's specification, user guides and templates live
under `framework/`, which the framework writes and `gov upgrade` replaces. Your organization writes everything
under `knowledge/` and `policies/`. Naming your Policy Owner as the approver of a file an upgrade replaces
would claim an authority nobody in your organization has.

A starter set of domains, to adapt:

| Domain | Owner role | Scope |
|---|---|---|
| `legal/` | Legal Owner | legal compliance, contracts, intellectual property, jurisdiction |
| `architecture/system/` | System Architecture Owner | system design standards; **specs of the products we build** |
| `architecture/data/` | Data Architecture Owner | data standards, modelling, pipelines, residency |
| `development/` | Development Owner | engineering craft: coding standards, toolchains, repository conventions, code review |
| `testing/` | Testing and Quality Owner | test architecture, coverage and verification gates, quality practices |
| `deployment/` | Deployment and Release Owner | the release **contract**: pipeline standards, environment promotion, versioning |
| `infrastructure/` | Infrastructure Owner | hosts, network, edge proxies, certificates, backups, vector store |
| `support/` | Support Owner | **internal tooling the organization runs for itself**: registry, CI server, mail, ticketing, identity provider |
| `compliance/` | Policy Owner | **the organization-wide rollup only**: it gathers each domain's compliance records |

The organization's own policies are not a knowledge domain. They live in `policies/`, beside `knowledge/`.

### 2.1 Where something belongs

Use these as a strong default when it is not obvious which domain a document belongs to. Where a document
fits better elsewhere, put it there and note why in the pull request.

- *It has a URL and users: support. It has an IP address and uptime: infrastructure.*
- Edge proxies are the network edge, so infrastructure, even though they are software.
- A running service (for example the identity provider) is specified in support. *Which* service is required
  is a rule in the domain that requires it.
- Products the organization builds are specified in `architecture/system/specs/`. Support covers internal
  tooling only.
- **Deployment owns the contract; support operates the tools; infrastructure hosts them.**
- An activity (a verb) is not a domain. What it requires is split among the domains that own the things it
  touches; the activity itself gets a journey document (section 5).
- How to build, run, test and deploy one repository stays in that repository's own `knowledge/`, and is
  **linked from** organization documents, never copied up.

## 3. Layers — how binding a document is, inside every domain

Every domain has exactly these six subfolders. The names are the same everywhere. No domain renames, omits or
adds a layer. An empty layer holds a stub index. This always applies, unless an exception is approved.

| Layer | What it asks of the reader | Default level | Holds |
|---|---|---|---|
| `mandates/` | must be followed | the strictest two | enforceable rules; reviewed and audited |
| `procedures/` | is to be followed | always applies | required processes |
| `patterns/` | is to be aware of | a strong default | good practice |
| `use-cases/` | is to learn from | instructional | guides by actor, procedure and component, with sequence diagrams |
| `specs/` | describes | descriptive | how things are now: an inventory index, then one document per item |
| `compliance/` | records | evidence | the domain's review and audit records, which feed the organization rollup |

A document's layer gives its **default** level. A rule inside a document may be stricter than that default;
when it is, its wording says so plainly. This is a strong default.

Exceptions are filed per domain, so `policies/exceptions/` has one subfolder for each domain your
organization defines. This always applies, unless an exception is approved.

## 4. Front matter — whether knowledge documents describe themselves is your choice

**This section is your organization's choice. gov requires none of it.** Keep it, change the fields and values
to your own, or delete the section. If you keep it, `gov rules propose` turns it into a rule, and from then on
gov checks every knowledge pull request against exactly the fields and values written here. If you delete it,
gov checks no front matter at all.

As seeded: every Markdown file under `knowledge/`, except the `README.md` index files, opens with a front-matter
block carrying these five fields. This always applies, unless an exception is approved.

| Field | Allowed values |
|---|---|
| `domain` | one of your domains from section 2 (as seeded: `legal`, `architecture/system`, `architecture/data`, `development`, `testing`, `deployment`, `infrastructure`, `support`, `compliance`), or `navigation` |
| `layer` | `mandate`, `procedure`, `pattern`, `use-case`, `spec`, `compliance` or `path` |
| `owner` | any value: the owning role, never a person |
| `compliance` | `C01`, `C02`, `C03`, `instructional`, `descriptive` or `evidence` |
| `status` | `current`, `draft` or `superseded` |

For example:

```yaml
---
domain: support
layer: spec
owner: support-owner
compliance: descriptive
status: current
---
```

Why: indexes and the dashboard can then be generated; a search or retrieval hit says what it is, so an agent
landing in the middle of a document knows whether it is reading a binding rule or a description.

## 5. Navigation — the dashboard and journeys

These always apply, unless an exception is approved:

- `knowledge/README.md` is the **single entry point**. It has two faces. For writers: this tree, the layer
  table, where things belong, and how to propose a change. For readers: the journey index and a link to each
  domain's inventory. It is the home page of the published knowledge site, if you publish one
  (`policies/knowledge-publication.md`).
- A journey is a **consultation order across domains: links only, never content**. Mandates first, then
  procedures and use-cases, then specs, then repository-local knowledge. Journeys that cross your own domains
  live in `knowledge/paths/<journey>.md` and are owned by the Policy Owner. Journeys through the framework's
  own material are in `framework/docs/user-guides/path-<journey>.md`, which the framework maintains.

Anyone may add or extend a journey by pull request.

When a project closes, its knowledge proposal always answers one question: **"what journey did this project
follow that is not yet written down?"** A journey found by real work is proposed then, not lost. There is no
exception to this.

### 5.1 Whether harvesting knowledge gates a close is your choice

The framework does not require any particular knowledge to exist before `gov close` will close a project. It
checks only that the project's `knowledge/` folder exists, because that is what it promotes. Deciding what
must be curated first is your organization's call.

If you want a requirement, write it here in plain words: for example, "a project is closed only once its
knowledge folder holds a summary of what it learned". The rule that comes out of it can carry a check that
runs when `gov close` runs, and the refusal names exactly what is missing. As seeded, there is no such
requirement.

## 6. Writing conventions

These always apply, unless an exception is approved:

- **Standard relative Markdown links only, no `[[wikilinks]]`.** That keeps GitHub, site generators, link
  checkers, local editors and agents all able to follow them.
- Screenshots of external user interfaces are images and are allowed. Diagrams are not: the framework's rule
  that structure is drawn as text covers them.

Nothing is added to the **write path**, and this has no exception: git, Markdown and pull-request approval
are the only way knowledge is written and stored. Read-side tools such as a static site generator, retrieval,
graph viewers and local editors only render the same files, and may be swapped freely.

Where the organization has adopted a documentation standard, glossary and acronym linking follows it:
spell out an acronym on first use, and link glossary terms.

## 7. Checks on every knowledge pull request

Every pull request that touches `knowledge/` is checked for the following. This always applies, unless an
exception is approved:

1. **Front matter**, if you kept section 4, carries the fields and values section 4 lists.
2. **No orphans:** every document can be reached from its layer index or a journey.
3. **Journeys hold links only:** `paths/*.md` contain links and ordering prose, nothing else.
4. **Links work:** no broken relative links, and no links to a `status: superseded` document except from its
   replacement notice.
5. **Ownership routing holds:** every path in `CODEOWNERS` exists.

## 8. Adapting this standard

Adapt the **domain list** to your own roles: merge or split domains as your named owners dictate. One
Architecture Owner, for example, means one `architecture/` domain. Keep the rest stable: the rule that a
domain exists only with an owner (section 2), the six layers, and the navigation rules (section 5). Section 4's
front matter is yours to keep or drop. This is a strong default; where your organization departs from it, record
why.
