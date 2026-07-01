# Team ownership + searchable state + list UX (prj 0.10.0)

Status: **accepted, implementing** · Supersedes the one-line "teams deferred" in
`prj-manage-work-redesign.md §1`. Stage this into that org spec via a knowledge-close
PR (org `knowledge/` is read-only during an active project — C01).

Feasibility was proven live against Svayamtech (mock board #54 + anchor issue, since torn
down): `updateProjectV2Collaborators({teamId, role})` grants a team a board role
(NONE/READER/WRITER/ADMIN), and `projectV2.teams` reads it back. `project-access.sh`
already resolves `@team-slug` via `gh_resolve_actor`, so team board-grant plumbing exists.

## 1. Ownership model — individuals *and* teams

The individual model is **"anchor assignee (searchable owner identity) + board write-access
(authorization), kept atomic."** Teams get the same two dimensions via a different pair of
GitHub primitives (issue assignees can't be teams):

| Dimension | Individual | Team |
|---|---|---|
| identity / discovery | anchor **assignee** → `assignee:@me` | anchor **label** `owner-team:<slug>` → `label:owner-team:<slug>` |
| authorization / access | board WRITER grant | **team** board WRITER grant (`updateProjectV2Collaborators` / `project-access.sh grant <url> @<slug>`) |

Both are **server-side searchable** (labels are indexed like assignees) — the property that
justifies the anchor issue in the first place.

**Effective owners** of a project = anchor **assignees** ∪ **members of every `owner-team:*`
team** (resolved live from `orgs/<org>/teams/<slug>/members`). Individuals and teams compose;
a project may have both.

**Atomic `manage`:** add team owner = add `owner-team:<slug>` label **+** grant that team board
WRITER; remove = drop label **+** revoke — mirroring the individual `set_owner`. Drift (labelled
but no access, or vice-versa) is the failure mode both halves-together prevent.

Team membership is resolved **live** at authorization/display time (not stored) — a new team
member becomes an authorized owner instantly with no anchor edit. Cost: authorization does a
`read:org` team-membership lookup.

## 2. Authorization (`work`)

You may `work` a project if **any** of:
1. you are an anchor **assignee** (individual owner), OR
2. you are a **member of any `owner-team:*` team** on the anchor, OR
3. you are **assigned to any board issue** (existing rule).

## 3. Discovery — "my projects" is a union of server-side searches

- individual: `gh search issues 'label:anchor assignee:@me org:<ORG>'`
- per team I'm in (`gh api /user/teams`): `gh search issues 'label:anchor label:owner-team:<slug> org:<ORG>'`
- union, deduped by board number (anchor↔board is 1:1; dedup only where you're both an
  individual and a team owner).

## 4. Searchable state

Today status is *derived* (board open/closed + `paused`/`cancelled` labels); `active`/`completed`
carry **no** label, so state is not searchable. Fix: a **mutually-exclusive `state:<x>` label**
on the anchor — `state:active` · `state:paused` · `state:completed` · `state:cancelled` — stamped
by every lifecycle transition. Then `label:anchor label:state:active` is one server-side query,
and "my active projects" needs zero board lookups.

- **Source of truth stays the board** (open/closed) + `cancelled`. The `state:` label is the
  searchable projection, kept in lockstep by transitions — never edited by hand.
- **`anchor_set_state <url> <state>`** (lib.sh): set the one `state:*` label, remove the other
  three. Mutually exclusive by construction.
- **Transitions call it:** init/start/resume → `active`; pause → `paused`; cancel → `cancelled`;
  close → `completed`. (Legacy bare `paused`/`cancelled` labels are still written for one release
  for back-compat, then dropped.)
- **Readers prefer the label, fall back to board-state:** `derive_project_status` and
  `project_context_list` use the `state:*` label when present, else the legacy derivation (board
  open/closed + `paused`/`cancelled`). So un-migrated anchors still resolve correctly — they just
  won't be found by a `label:state:*` search until stamped.
- **Backfill:** `prj doctor` (and a one-shot `backfill`) stamps `state:*` on existing anchors from
  their current derived status, so search coverage becomes complete without a re-seed.

## 5. List UX

- **`prj list` / `list-all`** already skip `not-initiated` (no-anchor) boards. Add a footer:
  *"Projects not having an anchor issue are not included in the list."* (Un-anchored boards are
  project *candidates* — surface them only in `manage` where you designate an anchor.)
- **`prj work`** shows **only** projects you own or can access (scope `me`, now including team
  ownership), with the footer: *"List only includes projects you are either owner and/or have
  access to it. If you want to work on a project that is not in this list, please contact an admin
  to get that project assigned to you."*

## 6. Scaling note (unchanged decision)

`all` can only ever **enumerate** (no global project search). `mine`/`my-team's` **can** switch
from enumerate-then-filter to server-side search once the org has enough boards — the payoff of
putting both ownership and state on searchable issue attributes. 0.10.0 keeps the single batched
enumerate engine (`project_context_list`) and adds the team + state dimensions to it; the
search-first pivot is a later optimization, not a rewrite.

## 7. Label conventions (summary)

| Label | Meaning | Written by |
|---|---|---|
| `anchor` | the project's scope/anchor issue | init / manage-designate |
| `owner-team:<slug>` | team owner (identity/discovery) | `manage` add/remove team owner |
| `state:active\|paused\|completed\|cancelled` | searchable lifecycle state | lifecycle transitions + backfill |
| `paused` / `cancelled` (legacy bare) | pre-0.10.0 state markers | transitions (kept 1 release, then dropped) |
