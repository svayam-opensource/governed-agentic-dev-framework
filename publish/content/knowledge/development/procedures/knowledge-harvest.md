---
domain: development
layer: procedure
owner: development-owner
compliance: C01
status: current
---

# Knowledge Harvest Protocol (project close)

The procedure an agent MUST run at project close to turn a project's learnings
into durable org knowledge. It is the **quality lever**: the close command can only check
that a manifest is *present and structured* — it has no project context. Only
the agent that did the work (reading the evidence) can judge *what* to capture.
So quality is carried by **(1) this protocol's rigor**, **(2) the Owner's C01
review of the resulting proposal PRs**, and **(3) the completeness-critic pass** —
never by `gov-work close`'s gate, which checks presence/structure only.

**Output:** `projects/<PRJ>/knowledge/knowledge-close.md` (the manifest, template
below) + the actual proposed org-knowledge changes (via `gov-work knowledge`).
`gov-work close`'s gate refuses to close until the manifest exists and every
section is filled (no `TBD`).

## Prime directive — reconstruct from EVIDENCE, not memory

A long project's conversation context is compacted and lossy. **Do not harvest
from recall.** Read the durable record first and treat it as the source of truth:

1. **`git log -p`** across **every** project repo on the project branch, scoped
   to `*/knowledge/**` and the key source dirs — the actual diffs, not summaries.
2. The **merged-issue list** (titles + bodies) for the project.
3. The project **`todo.md`** — `Done`, the running **knowledge-close candidates**,
   and remaining `Open`.
4. Every doc under **`projects/<PRJ>/knowledge/`** (design docs, decision records,
   compliance).

## The seven moves

1. **GATHER** the evidence above. List your sources at the top of the manifest.
2. **ENUMERATE** every *durable* artifact — one sourced line each:
   contracts/specs · designs **with the decision _and its why_** · patterns ·
   **gotchas / failures-and-fixes** · reference pointers. Durable = useful to
   someone who wasn't here, after this project ends.
3. **CLASSIFY** each → **graduate** (target `domain/layer`) · **keep-local**
   (reason) · **discard** (reason). Nothing left unclassified.
4. **MINE THE NON-OBVIOUS** — a dedicated pass: *what cost us time, what
   surprised us, what we'd warn the next person about.* These are the first
   learnings to be lost and the highest-value to keep (traps, precision bugs,
   tool quirks, dead-ends that looked promising).
5. **JOURNEY REVIEW** (POL-089/412) — what *"how do I X"* paths did the work
   traverse that aren't documented? Create/update `paths/<journey>.md`
   (links-only). Answer the journey question explicitly.
6. **COMPLETENESS CRITIC** — an adversarial pass against the evidence: which
   claim is unverified? which decision has *no recorded why*? which changed code
   area produced *no* knowledge? what is still `TBD`? Fix or record each.
7. **PRODUCE** — raise the org-knowledge changes via `gov-work knowledge` (one or
   more PRs), and write the manifest mapping every artifact → disposition → PR#.

## `knowledge-close.md` manifest template

```markdown
# Knowledge Close — <PRJ>

**Harvested:** <date>  ·  **Sources:** <repos/branches + issue list + todo + docs read>

## Graduated to org knowledge
| Artifact | → domain/layer | PR# | merged? |
|---|---|---|---|
| <one durable fact/design/spec> | architecture/system/specs | #NN | yes/no |

## Kept project-local
| Artifact | Why local (not org-durable) |
|---|---|

## Discarded
| Artifact | Why discarded |
|---|---|

## Journeys created / updated
| Journey (paths/…) | New or Updated | PR# |
|---|---|---|
**Journey question (POL-412):** <the path(s) this project traversed that were undocumented, now addressed — or "none">

## Completeness critic
- Unverified claims handled: …
- Decisions missing a "why" — now recorded: …
- Changed areas that produced no knowledge (justified): …
- Remaining TBD (must be empty to close): none
```

## What "done" means
- Every enumerated artifact appears in exactly one of graduated/local/discarded.
- Every `graduate` row has a PR that is **merged** (the Owner's C01 approval is
  the quality gate; an open PR does not satisfy close).
- The journey question is answered; completeness-critic has no remaining `TBD`.
