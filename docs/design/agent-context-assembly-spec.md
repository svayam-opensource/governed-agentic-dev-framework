# Agent Context Assembly Specification

**Status:** Draft — design only, not implemented  
**Owner:** Infrastructure Owner (acting: `{{POLICY_OWNER_EMAIL}}`)  
**Parent policy:** `knowledge/policies/agentic-development-policy.md` (POL-076–081, POL-113–123, POL-129–138)  
**Related specs:** `knowledge/infrastructure/knowledge-publication-spec.md`, `knowledge/guidance/scripts/close-knowledge-spec.md`  
**Audience:** Infrastructure Owner, Policy Owner, agent harness maintainers, framework implementers

---

## 1. Purpose

This specification defines **how an agent assembles working context** from organizational knowledge — not merely *where* knowledge lives (policy Section 6) or *that* layers must be loaded fresh at session start (POL-116), but:

- **What** to retrieve (structural vs semantic)
- **In what order** (layer precedence + priority tiers)
- **How much** fits in the prompt budget
- **Where** each piece is injected (system rules, user message, tool-readable files, ephemeral session state)
- **What may persist** across turns within a session vs what must be re-loaded every session
- **When** to refresh context mid-session

Vector RAG (Form 3 in the knowledge publication spec) is **one retrieval input** to this assembly process — not the whole process.

### 1.1 Success criteria

An implementation of this spec is successful when:

1. **Agents consistently load correct context** without the human re-stating policy, project state, or repo conventions each session.
2. **Policy and compliance content is never dropped** due to prompt budget pressure — lower-priority material is trimmed first.
3. **Harness/bootstrap files** (Cursor rules, `CLAUDE.md`, etc.) deliver protocol reliably but **never override** org, repo, or user knowledge.
4. **Project knowledge** is treated as a **staging lane** during work and is not required to remain in the agent's standing context after knowledge close merges into org.

### 1.2 Non-goals

- Defining the human-facing knowledge portal (see separate portal IA work).
- Choosing a vector database vendor (Infrastructure Owner decision).
- Replacing POL-113–118 session-start **gates** — those remain C01; this spec adds **assembly** after gates pass.
- Mandating a specific LLM provider's memory feature — assembly must work with file-based context and standard chat turns.

---

## 2. Terminology

| Term | Meaning |
|---|---|
| **Layer** | A precedence-ranked source of truth: Org → Project → Repo → Developer prefs (POL-076). Higher layer wins on conflict. |
| **Harness** | Tool-specific bootstrap surface (`.cursor/rules/agent.mdc`, `CLAUDE.md`, `AGENTS.md`, …). Delivery only — **not** a knowledge layer. |
| **Entrypoint chain** | Ordered list of `agent.md` files an agent follows to discover what to load. |
| **Chunk** | A self-contained unit of knowledge indexed for retrieval (one POL clause, one `##` section, or one project note section). |
| **Context pack** | The assembled, budget-trimmed set of chunks + mandatory inclusions ready for injection. |
| **Slot** | A named region of the prompt with a priority tier and byte/token budget (e.g. `SLOT-C01-GATES`). |
| **Staging knowledge** | Project-scoped writes in `projects/<PID>/knowledge/` during an active project — promoted to org/repo at close. |
| **Structural retrieval** | Path- and manifest-driven loading (always deterministic). |
| **Semantic retrieval** | Embedding nearest-neighbor search over org knowledge (optional until vector store exists). |

---

## 3. Layer model (refined)

Policy defines four layers. This spec adds **harness** and clarifies **project** lifecycle:

```
┌─────────────────────────────────────────────────────────────┐
│  Harness (bootstrap only — points down, never overrides)     │
├─────────────────────────────────────────────────────────────┤
│  1. Org-wide     {{WORKSPACE_REPO}}/knowledge/               │
│  2. Project      projects/<PID>/knowledge/  [STAGING]        │
│  3. Repo-local   <code-repo>/knowledge/                      │
│  4. Developer    $AGENT_WORK_ROOT/preferences/<gh-login>.md  │
└─────────────────────────────────────────────────────────────┘
         Higher ↑ overrides lower ↓ on conflict
```

### 3.1 Project layer as staging

During an active project, layer 2 is **writable staging**. At knowledge close, durable learnings **integrate into org and/or repo** via PR — they are not kept as a permanent parallel truth.

After close (merged / rejected / abandoned), agents on **new** projects must not treat stale project folders as authoritative over org; org + repo are canonical.

### 3.2 Harness constraint

Harness files may restate the session-start protocol for tool auto-load compatibility, but:

- They **must** point to the canonical org entrypoint: root `agent.md` or equivalent path.
- They **must not** contain org policy, security mandates, or layer priority that could override layers 1–4.
- On conflict between harness text and org/repo knowledge, **layers 1–4 win**; the agent surfaces the discrepancy to the human (POL-133 pattern).

**Target end state:** harness files are **generated thin pointers** from a single canonical protocol block; adopters append C03 customizations below a fixed boundary.

---

## 4. Assembly overview

Context assembly runs in **phases**. Phases 0–2 are **mandatory** even without a vector store. Phase 3 uses semantic retrieval when available.

```mermaid
flowchart TD
  P0[Phase 0 — C01 gates] --> P1[Phase 1 — Resolve scope]
  P1 --> P2[Phase 2 — Structural load]
  P2 --> P3[Phase 3 — Semantic retrieve]
  P3 --> P4[Phase 4 — Budget & pack]
  P4 --> P5[Phase 5 — Inject surfaces]
  P5 --> WORK[Work session]
  WORK --> REF{Refresh trigger?}
  REF -->|yes| P2
  REF -->|no| END[Phase 6 — Session end capture]
```

| Phase | Name | Required | Primary inputs |
|---|---|---|---|
| 0 | C01 gates | Always | `project.yaml`, branch, lock, status |
| 1 | Resolve scope | Always | `agent.md` chain, `project.yaml`, active task |
| 2 | Structural load | Always | Layer paths, mandatory files, repo list |
| 3 | Semantic retrieve | When index exists | Task/query embedding, org `knowledge/` index |
| 4 | Budget & pack | Always | Slot budgets, tier rules, deduplication |
| 5 | Inject | Always | Harness surfaces, first-turn summary |
| 6 | Session end | C02 recommended | Write-back to project knowledge |

---

## 5. Phase 0 — C01 gates (pre-assembly)

**No context assembly begins until all gates pass.** This mirrors POL-113–115 and is identical across harnesses.

| Gate | Check | On failure |
|---|---|---|
| G0.1 | Active project context identified (`<PID>` from branch or explicit prompt) | Hard stop — ask human |
| G0.2 | `project.yaml` `locked_by` matches current user identity | Hard stop (POL-114) |
| G0.3 | `project.yaml` `status` is `active` (or defined read-only mode for paused — see §12) | Hard stop (POL-115) |
| G0.4 | `agent_config.provider` on Approved/Provisional list | Hard stop (POL-138) |
| G0.5 | Latest project branch pulled in workspace + code repos | Hard stop (POL-117) |

**Output:** `AssemblyContext` record: `{ project_id, user, repos[], task_subbranch?, agent_config }`.

---

## 6. Phase 1 — Resolve scope (entrypoint chain)

### 6.1 Entrypoint chain order

Walk **top-down**; each entrypoint lists the next files to read:

```
1. Harness bootstrap          (tool convention — protocol summary only)
2. {{WORKSPACE_REPO}}/agent.md
3. projects/<PID>/agent.md
4. For each active code repo:
     <repo>/knowledge/agent.md
5. $AGENT_WORK_ROOT/preferences/<gh-login>.md
```

Each `agent.md` should list **explicit paths** under its layer — assembly does not rely on transitive "see also" discovery alone (DEVELOPER_GUIDE §9 foot-gun).

### 6.2 Task-scoped branch

When working on a **task sub-branch** (`<org_slug>-NNN-slug/<task-slug>`):

- Scope code edits to that sub-branch.
- Project knowledge writes still go to `projects/<PID>/knowledge/` (project branch), not a separate task folder.
- Assembly adds the linked GitHub Issue title/body (if available) to semantic query seeds.

### 6.3 Repo scope

From `project.yaml` `repos[]`, classify:

| Role | Structural load |
|---|---|
| `primary` | Full repo knowledge (`agent.md` + `knowledge/repo/*`) |
| `dependency` | `agent.md` + `patterns.md` only unless task touches it |
| `read-only` | `agent.md` only |

---

## 7. Phase 2 — Structural load (always)

Structural retrieval is **deterministic** and does not depend on embeddings. These inclusions are **Tier A — never drop**.

### 7.1 Org-wide mandatory set

Always load (from `{{DEFAULT_BRANCH}}` of workspace repo, even when project branch is checked out):

| File / pattern | Reason |
|---|---|
| `knowledge/policies/agentic-development-policy.md` | Governing policy — at minimum load §2 compliance levels + §6–§7 | 
| `knowledge/policies/data-classification.md` | C01 data rules |
| `knowledge/policies/llm-governance.md` | Provider approval |
| `agent.md` (root) | Org entrypoint |
| Domain-specific if task touches domain | Resolved via CODEOWNERS path map (see §7.4) |

**Optimization:** For policy, load **clause-level chunks** tagged C01/C02 first; defer C03 appendices until budget allows.

### 7.2 Project mandatory set

From `projects/<PID>/knowledge/` on the **project branch**:

| File | Reason |
|---|---|
| `todo.md` | Surface `## Open` before new work (DEVELOPER_GUIDE) |
| `compliance.md` | Active exceptions, deviations |
| All other files | Load filenames into manifest; load full text if under per-file cap |

### 7.3 Repo mandatory set

Per scoped repo (§6.3):

| File | Reason |
|---|---|
| `knowledge/agent.md` | Repo entrypoint |
| `knowledge/repo/structure.md` | Layout |
| `knowledge/repo/environment.md` | Build/run |
| `knowledge/repo/patterns.md` | Conventions |
| `knowledge/projects/<PID>/` | Prior impact on this repo, if exists |

### 7.4 Developer preferences

Load **only** `$AGENT_WORK_ROOT/preferences/<gh-login>.md` for the current identity (POL-127).

Validate opening declaration (POL-132). Strip or ignore any line attempting to override layer priority, compliance levels, or security rules (POL-133).

### 7.5 Structural domain routing

When the task or open files touch a path, add org knowledge from mapped folders:

| Path prefix (code) | Org knowledge folder |
|---|---|
| `*/db/*`, migrations | `knowledge/architecture/data/` |
| `*/infra/*`, CI, Docker | `knowledge/infrastructure/` |
| API / service boundaries | `knowledge/architecture/system/` |
| Shared libraries | `knowledge/patterns/` |

Mapping is maintained in a future `knowledge/guidance/context-routing.yaml` (not yet created).

---

## 8. Phase 3 — Semantic retrieve (when index exists)

When the vector index from `knowledge-publication-spec.md` Form 3 is available:

### 8.1 Query construction

Build a **retrieval query** from:

1. GitHub Issue title + body (if task-scoped)
2. Human's first message in the session
3. Filenames/paths the human references
4. `todo.md` open item titles
5. Project `description` from `project.yaml`

Do **not** embed or retrieve from:

- Developer preferences (layer 4 — structural only)
- Harness bootstrap files
- Raw credentials, `.env`, secrets (C01)
- Other users' preference files

### 8.2 Retrieval scope

| Index scope | Priority |
|---|---|
| `knowledge/` org-wide | High |
| `projects/<PID>/knowledge/` | High (current project only) |
| `<repo>/knowledge/` for scoped repos | Medium |
| Completed projects' staging folders | **Excluded** — use org integrated content |

### 8.3 Chunk metadata (required per chunk)

Each indexed chunk carries:

```yaml
path: knowledge/policies/agentic-development-policy.md
section: "## 2.1 C01 — Non-Negotiable"
clause: POL-011
layer: org
domain_owner: policy
compliance: C01
commit_sha: abc123
token_estimate: 180
```

### 8.4 Chunking rules

| Source type | Chunk boundary |
|---|---|
| Policy (`knowledge/policies/`) | One chunk per `(POL-NNN)` clause where possible; otherwise one `##` section |
| Procedures | One `##` section |
| Patterns / accumulated | One `##` section or one ADR |
| Project notes | One `##` section |
| Repo patterns | One `##` section |

Each chunk must include **±1 adjacent heading** in stored text for self-containment (per publication spec).

### 8.5 Merge with structural results

Semantic hits **deduplicate** against Phase 2 loads (same `path` + `section`). Layer precedence applies on conflict: org chunk wins over repo chunk with contradictory guidance.

### 8.6 Fallback when index unavailable

Proceed with Phase 2 only. Log warning. This is explicitly allowed for `close-knowledge` (close-knowledge-spec) and for agent sessions.

---

## 9. Phase 4 — Budget allocation & context pack

### 9.1 Design principle

**Compliance and gates beat convenience.** Trim Tier C before Tier B before Tier A.

### 9.2 Priority tiers

| Tier | Label | Contents | Drop policy |
|---|---|---|---|
| **A** | Critical | C01/C02 policy clauses, data classification, lock/status gates, active compliance exceptions, `todo.md` open items | **Never drop** |
| **B** | Project-scoped | Project knowledge, repo `patterns.md`/`environment.md`, task issue text, semantic hits > score threshold | Drop lowest-score first |
| **C** | Background | C03 policy appendices, historical accumulated, low-score semantic hits, verbose repo structure | Drop freely |

### 9.3 Prompt slots (recommended layout)

Slots are ordered **top to bottom** in the injected pack:

```
SLOT-0  SESSION-MANIFEST     (~200 tokens)   Tier A
        project_id, user, repos, branch, task, agent_config

SLOT-1  C01-C02-POLICY       (budget floor)  Tier A
        data classification, LLM governance, active C01/C02 clauses

SLOT-2  PROJECT-STATE        (~800 tokens)   Tier A
        todo.md Open, compliance.md summary

SLOT-3  REPO-CONVENTIONS     (~600 tokens/repo) Tier B
        patterns, environment highlights per primary repo

SLOT-4  TASK-CONTEXT         (variable)      Tier B
        issue body, human directive, semantic hits

SLOT-5  BACKGROUND           (remainder)       Tier C
        architecture, patterns, accumulated learnings
```

**Budget floor for Tier A:** Implementations must reserve at least **40%** of total context budget for Tier A before filling Tier B/C. Exact token limits are harness-specific; the **ratio** is normative.

### 9.4 Session manifest (SLOT-0)

Every session's first agent response should reflect a manifest like:

```markdown
## Context manifest
- Project: ACME-007-invoice-api (active, locked_by: you)
- Branch: acme-007-invoice-api [/ task sub-branch if any]
- Repos: invoice-api (primary), svm-util (dependency)
- Open todos: 2 (surfaced below)
- Policy loaded: C01/C02 clauses, data classification, LLM governance
- Retrieval: structural [+ semantic N chunks if index used]
```

This is what the DEVELOPER_GUIDE first-prompt template validates.

### 9.5 Deduplication & conflict surfacing

Before injection:

1. Remove duplicate chunks (same path + section).
2. On cross-layer conflict, keep higher layer; add one-line note to manifest: *"Preference X overridden by org policy POL-NNN."*
3. Never silently merge contradictory C01/C02 guidance — hard stop instead.

---

## 10. Phase 5 — Injection surfaces

Different harnesses expose different surfaces. Assembly **maps the same context pack** to available surfaces:

| Surface | Typical harness | What goes here |
|---|---|---|
| **System / rules** | Cursor rules, Copilot instructions | Session protocol, C01 gates, layer priority, write restrictions |
| **Project rules** | `projects/<PID>/.cursor/rules` if present | Project-specific C03 notes only |
| **First user turn** | Developer kickoff prompt | Manifest request, todo surfacing |
| **File reads** | All harnesses | Full text of Tier A files; Tier B/C as needed |
| **Tool-accessible docs** | MCP, `@` references | Repo paths under `$AGENT_WORK_ROOT/<PID>/` |
| **Provider memory** | Cursor memories, Claude projects | **Do not store org policy** — see §11 |

**Rule:** Org policy and project compliance state are **re-loaded every session** into files or explicit reads — not stored in provider-native long-term memory (which bypasses git versioning and POL-116).

---

## 11. Memory classes

| Class | Lifetime | Examples | Rule |
|---|---|---|---|
| **Ephemeral** | Single session | Assembled context pack, manifest | Must rebuild from git on new session (POL-116) |
| **Working** | Multi-turn within session | Current task plan, files edited this session | Allowed in conversation; not authoritative over git |
| **Persistent (git)** | Cross-session | `projects/<PID>/knowledge/*`, commits | **Source of truth** — session end writes here |
| **Forbidden** | — | Restricted data, other users' prefs, secrets | Never in context or memory (C01) |

### 11.1 What agents may write at session end (POL-119–123)

| Destination | Content |
|---|---|
| `projects/<PID>/knowledge/notes.md` | Decisions, rationale |
| `projects/<PID>/knowledge/todo.md` | Move Open → Done |
| `projects/<PID>/knowledge/compliance.md` | C01/C02/C03 events |
| Code repos | Implementation only — not policy |

Agents **must not** write org `knowledge/` during active projects (POL-086).

### 11.2 Provider-native memory

If the harness supports persistent memory (e.g. "remember this preference"):

| Allowed | Not allowed |
|---|---|
| Personal workflow shortcuts (C03) | Org policy paraphrases |
| File path preferences | Compliance level definitions |
| Communication style | Project lock/status |
| | Security or data-handling rules |

When in doubt, **write to git** (project knowledge or preferences file) instead of provider memory.

---

## 12. Mid-session refresh triggers

Re-run **Phase 2 minimum** (Phase 3 if index available) when:

| Trigger | Action |
|---|---|
| `./prj sync` or `./prj resume` | Full re-assembly (POL-116 fresh load) |
| Switch project branch | Full re-assembly |
| Human invokes "reload context" / `./prj context refresh` | Full re-assembly |
| `./prj task` or `./prj merge` | Re-resolve scope (§6); reload task/issue context |
| Org policy merge landed on default while project active | Next sync/resume picks it up; agent should not self-merge default into project |
| Detected manifest drift (lock changed, status no longer active) | Hard stop |

**Incremental work within one repo** does not require full re-assembly unless the human changes task or repo scope.

---

## 13. Modes outside active project work

| Mode | Phase 0 gates | Layers loaded |
|---|---|---|
| **Active project** (normal) | Full C01 | 1 → 2 → 3 → 4 |
| **Paused project** | Read-only; no code writes | 1 → 2; status check blocks writes |
| **`propose-knowledge`** | No project lock; explicit branch `knowledge-<slug>` | Org (1) + target folders only |
| **`onboard-repo`** | No project | Org (1) + repo template |
| **Framework contribution** (this repo, no PID) | No lock | Org bootstrap + CONTRIBUTING |

Harness protocol still applies; project layer empty or N/A.

---

## 14. Relationship to knowledge close

`close-knowledge` uses the **same chunk index and layer rules** but different assembly goals:

| | Agent session | close-knowledge |
|---|---|---|
| **Goal** | Execute task within policy | Propose org/repo integrations |
| **Project staging** | Full load | Full read |
| **Semantic query** | Task/issue-driven | "What org docs relate to these learnings?" |
| **Output** | Context pack | PR diff to `knowledge/` |
| **Tier A** | C01/C02 for action | Data classification + target domain ownership |

Project learnings that integrate into org (diagram updates, procedure edits) become **org chunks** on merge — future sessions retrieve them via org layer, not project staging.

---

## 15. Implementation roadmap (informative)

Suggested implementation order:

1. **`context-manifest` schema** — JSON/YAML schema for SLOT-0 output; validator in `scripts/validate/`
2. **`./prj context assemble [--project PID]`** — prints manifest + file list (no LLM required)
3. **`./prj context refresh`** — git pull + re-assemble; for developer kickoff prompts
4. **`knowledge/guidance/context-routing.yaml`** — path → org folder map (§7.5)
5. **Chunk indexer** — implements §8.4 rules in CI (extends publication spec Form 3)
6. **Harness generator** — thin pointers from canonical protocol (§3.2)
7. **Session-start test** — CI fixture: given a project fixture, assert Tier A files present in assemble output

---

## 16. Open decisions

| # | Question | Options | Impact |
|---|---|---|---|
| D1 | Exact token budget defaults per slot | Fixed tokens vs % of model window | Harness-specific |
| D2 | Semantic score threshold for Tier B vs C | Cosine similarity cutoff | Quality of retrieval |
| D3 | Policy loading: full doc vs clause index only | Full file simpler; clause index smaller | Tier A size |
| D4 | `./prj context` output format | Markdown manifest vs JSON for tooling | DX |
| D5 | Index repo knowledge in same store as org | Unified vs per-repo collections | Retrieval scope |
| D6 | Auto-surface related exceptions when policy clause loaded | On vs off | Compliance UX |

---

## 17. Appendix A — Example first-session pack (illustrative)

**SLOT-0 manifest** — see §9.4.

**SLOT-1 excerpt (Tier A):**

```
POL-086 (C01): No edits to {{WORKSPACE_REPO}}/knowledge/ during active project.
POL-143 (C01): Restricted data never in knowledge or LLM calls.
POL-116 (C01): Load all four layers fresh — no cross-session cache.
```

**SLOT-2 excerpt:**

```
## Open (todo.md)
- [ ] Wire validation for invoice total field
- [ ] Document API error codes in notes.md
```

**SLOT-3 excerpt (primary repo):**

```
From knowledge/repo/patterns.md:
- Use @svayam/svm-util for Express bootstrap
- Error responses: { code, message, details }
```

---

## 18. Appendix B — Policy cross-reference

| This spec | Policy clauses |
|---|---|
| Layer order | POL-076 – POL-081 |
| Session start gates | POL-113 – POL-118 |
| Session end capture | POL-119 – POL-123 |
| Preferences bounds | POL-129 – POL-133 |
| LLM / data rules | POL-134 – POL-145 |
| Org write lock during project | POL-086 – POL-088 |
| Knowledge publication / RAG | POL-100 – POL-104 |
| close-knowledge | POL-089 – POL-112 |

---

## Document history

| Date | Change |
|---|---|
| 2026-05-27 | Initial draft from knowledge management design interview |
