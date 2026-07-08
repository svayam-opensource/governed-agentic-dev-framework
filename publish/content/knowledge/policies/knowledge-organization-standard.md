---
domain: policies
layer: mandate
owner: policy-owner
compliance: C02
status: current
effective_date: 2026-06-06
---

# Knowledge Organization Standard

**Document:** Knowledge Organization Standard
**Policy Owner:** <POLICY_OWNER_EMAIL>
**Compliance:** C02 unless a clause states otherwise
**Decision record:** `projects/PRJ-005-oidc-step3-start-check-iam/knowledge/knowledge-reorg-decisions.md`

This standard governs how org-wide knowledge (`<WORKSPACE_REPO>/knowledge/`)
is structured, typed, navigated, and consumed. It refines POL-082 and is
referenced by it.

---

## 1. Two systems, never conflated

**Storage follows accountability; navigation follows journeys.** **(POL-401, C01)**

- The physical tree exists so that every document has exactly one owner who
  approves changes to it (CODEOWNERS → PR review). It is organized by
  accountability domain — never by reader journey, document kind, or org chart.
- Reader/agent journeys are served by a navigation layer (Section 5) of
  documents that contain **links in consultation order, never content**.
- Every fact lives in exactly one document. Duplicating a fact so it appears
  "on a path" is prohibited — a drifted copy is false authority. **(POL-402, C01)**

## 2. Domains — the ownership tree

**Invariant: a top-level domain exists if and only if a named Owner role
exists for it in `knowledge/policies/roles.md` (POL-033). The tree changes
only when an accountability domain and its owner role are created or
retired.** **(POL-403, C02)**

| Domain | Owner role | Scope |
|---|---|---|
| `policies/` | Policy Owner | org-wide governance of work: the agentic development policy, llm-governance, data-classification, this standard, exceptions |
| `legal/` | Legal Owner | legal compliance, contracts, IP, jurisdiction |
| `architecture/system/` | System Architecture Owner | system design standards; **specs of the products we build** |
| `architecture/data/` | Data Architecture Owner | data standards, modeling, pipelines, residency |
| `development/` | Development Owner | engineering craft: coding standards, toolchains, repo conventions, code review |
| `testing/` | Testing/Quality Owner | test architecture, coverage/verification gates, quality practices |
| `deployment/` | Deployment/Release Owner | the release **contract**: pipeline standards, environment promotion, versioning/dist-tags |
| `infrastructure/` | Infrastructure Owner | hosts, network, edge proxies, certificates, backups, vector store |
| `support/` | Support Owner | **internal tooling the org runs for itself**: registry, CI server, webmail, ticketing, IdP-as-a-service |
| `compliance/` | Policy Owner | **org rollup only** — aggregates per-domain compliance records (POL-107/108) |

**Boundary rules** **(POL-404, C03 — apply intelligently, document deviations):**

- *URL + users ⇒ support; IP + uptime ⇒ infrastructure.*
- Edge proxies are network edge ⇒ infrastructure, even though they are software.
- A running service (e.g. the IdP) is specced in support; *which* service is
  mandated is a mandate in the appropriate domain.
- Products the org builds are specced in `architecture/system/specs/` —
  support covers internal tooling only.
- **Deployment owns the contract; support operates the tools; infrastructure
  hosts them.**
- Activities (verbs) are not domains. A verb's normative content distributes
  to its noun-owners; the verb itself gets a journey doc (Section 5).
- Repo-specific operational detail (build/run/test/deploy of one repo) stays
  in that repo's `knowledge/` (POL-079) and is **linked from** org specs —
  never copied up.

## 3. Layers — the normativity gradient inside every domain

Every domain contains exactly these six subfolders. **Names are standardized
org-wide; no domain may rename, omit, or add layers.** Empty layers carry a
stub index. **(POL-405, C02)**

| Layer | Force | Default compliance | Holds |
|---|---|---|---|
| `mandates/` | must | C01/C02 | enforceable rules; reviewed and audited |
| `procedures/` | to be followed | C02 | required processes for policy compliance |
| `patterns/` | to be aware of | C03 | best practices, strong defaults |
| `use-cases/` | to learn and follow | instructional | actor/role × procedure × component guides, sequence diagrams |
| `specs/` | descriptive | descriptive | current state: an inventory index + one doc per item |
| `compliance/` | evidence | evidence | per-domain review/audit records; feeds the org rollup |

A document's layer states its **default** compliance level; a clause inside it
may declare a stricter level explicitly. **(POL-406, C03)**

`knowledge/policies/exceptions/` gains one subfolder per domain (the existing
`legal/ infrastructure/ architecture/ policy/` set extends with
`development/ testing/ deployment/ support/`). **(POL-407, C02)**

## 4. Front-matter — every knowledge document is self-describing

Every `*.md` under `knowledge/` (except generated indexes) opens with:
**(POL-408, C02)**

```yaml
---
domain: support            # one of the 9 domains (or "navigation")
layer: spec                # mandate|procedure|pattern|use-case|spec|compliance|path
owner: support-owner       # role slug, never a person
compliance: descriptive    # C01|C02|C03|instructional|descriptive|evidence
status: current            # current|draft|superseded
---
```

Purpose: (a) per-domain indexes and the dashboard become generatable;
(b) RAG/vector hits are self-describing — an agent landing mid-document knows
whether it reads a C01 mandate or a descriptive observation; (c) CI lint
becomes trivial (Section 7).

## 5. Navigation — the dashboard and journeys

- `knowledge/README.md` is the **single entry point** with two faces:
  *write-side* (this tree, the layer table, the boundary rules, how to
  propose) and *read-side* (the journey index + per-domain inventory links).
  It is the home page of the published knowledge site (POL-101). **(POL-409, C02)**
- Journeys live in `knowledge/paths/<journey>.md`, owned by the Policy Owner.
  A journey doc is a **consultation order across domains — links only, never
  content** (mandates → procedures/use-cases → specs → repo-local). **(POL-410, C02)**
- Anyone may add or extend a journey by PR. **(POL-411, C03)**
- **Every project knowledge-close must answer: "what journey did this project
  traverse that is not documented?"** — undocumented journeys discovered by
  real work are proposed at close (extends POL-089). **(POL-412, C01)**
- **Knowledge harvest is a hard close condition.** A project MUST NOT close
  until its agent has run the [Knowledge Harvest Protocol](../development/procedures/knowledge-harvest.md)
  and produced a complete `projects/<PRJ>/knowledge/knowledge-close.md` manifest.
  Quality is carried by the protocol's rigor + the Owner's C01 review of the
  resulting proposal PRs + the completeness-critic pass — **the close script
  checks only presence + structure** (manifest exists, every section filled, no
  `TBD`). A `graduate` disposition is satisfied only when its proposal PR is
  **merged**, not merely open. **(POL-413, C01)**
- **`gov-work close`'s gate enforces the manifest** alongside `compliance.md`:
  the manifest must be present, structurally complete (all sections), and free
  of `TBD`/`TODO` placeholders before the project can be marked closed.
  **(POL-414, C01)**

## 6. Authoring conventions

- **Standard relative markdown links only — no `[[wikilinks]]`.** Keeps
  GitHub, site generators, CI link-checking, local tools (Obsidian/LogSeq),
  and agents interoperable. **(POL-413, C02)**
- **Diagrams as Mermaid text only — no binary images for diagrams** in
  `knowledge/`. One artifact serves both consumers: rendered picture for
  humans, ~tens of structured lines for agents. (Screenshots of external UIs
  are exempt.) **(POL-414, C02)**
- Nothing new in the **write path**: git + markdown + PR approval is the only
  authoring/storage system (reaffirms POL-104). Read-side tools — static site
  generator, RAG, graph viewers, local editors — are renderers over the same
  files and may be swapped freely. **(POL-415, C01 for the write path)**
- Glossary/acronym linking follows the documentation standard (first-use
  expansion + glossary hover-links) where adopted.

## 7. Enforcement (mechanized, like POL-301's CI gate)

CI on every PR touching `knowledge/` **(POL-416, C02; implementation per
phase P4 of the migration plan):**

1. **Front-matter lint** — schema valid; `domain`/`layer` agree with the
   file's folder; owner is a known role.
2. **Orphan check** — every document is reachable from its layer index or a
   journey doc.
3. **Journey purity** — `paths/*.md` contain links and ordering prose only.
4. **Link check** — no broken relative links; no links to `status: superseded`
   docs outside their replacement notice.
5. Existing checks (CODEOWNERS paths exist, placeholder scan) continue.

## 8. Template adopters

Organizations adopting the framework template adapt the **domain set** to
their own role registry (merge or split domains as their named-owner roles
dictate — e.g. one Architecture Owner ⇒ one `architecture/` domain). The
invariant (POL-403), the six layers (POL-405), the front-matter (POL-408) and
the navigation rules (POL-409–412) are the stable contract; the domain *list*
is the adaptation point. **(POL-417, C03)**

## 9. Migration

Executed in phases (P2 scaffold + CODEOWNERS, P3 content moves with redirect
stubs and link fixes, P4 enforcement CI + renderer selection), each via
a `gov-work knowledge` PR. Old paths keep one-line redirect stubs for one
quarter. The decision record and phase plan live in the PRJ-005 project
knowledge.
