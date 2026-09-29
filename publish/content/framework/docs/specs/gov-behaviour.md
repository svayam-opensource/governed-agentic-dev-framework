---
domain: governance
layer: spec
owner: framework
compliance: descriptive
status: current
---

# How gov behaves

**This is a specification, not a policy.** It describes what the gov clients DO. Nothing here is a rule you can
comply with or deviate from, because none of it depends on anybody's cooperation: it is what the programs are
coded to do, parameterised by your settings.

That distinction was ruled on 2026-09-29, and it exists because the policy used to contain both. A sentence like
*"a project branch MUST be named `BRNCH-<board#>-<slug>`"* read as a rule somebody could break, when in fact
`identity.ts` composes that string — there is no version of running gov where the branch is named otherwise.
Mixing the two taught readers that the prose had a bearing on the behaviour, and one clause (POL-071, describing
a knowledge-close branch that no code ever created) was simply false for as long as anybody had been reading it.

## What is described here, and what is not

| | Lives in | Enforced by |
|---|---|---|
| **This document** | the clients' code, parameterised by settings | gov running |
| **`framework/policies/framework-policy.md`** | clauses an agent carries, and clauses a check reads | an agent's context · `gov validate` · the platform |
| **Your own `policies/`** | your organization's clauses | the same two |

**There are no POL numbers in this document.** A citable number invites an exception request, and you cannot be
excepted from how a program behaves. Where a statement here has a policy counterpart — because an agent must also
be told, or because a check enforces it — the policy carries the number and this document points at it.

**Every literal below is anchored by a test.** Where a sentence names a concrete string — a branch pattern, a file
name, a verb, an exit code — `test/content/spec-anchors.test.ts` asserts that string exists in the code. That is
the mechanism which replaces "this document is updated when the code changes", which is a discipline, and which
POL-071 demonstrates does not hold on its own.

---

## 1. Where the organization's choices live

gov reads its behaviour from settings, never from prose. The complete list of places a choice is recorded:

| Setting | What it decides |
|---|---|
| `org-config.yaml` | the organization's identity, its branches, its work root, its authorized agents, its governance posture |
| `CODEOWNERS` | who reviews which folder — the routing behind "who may approve" |
| the folder structure under `knowledge/` | which accountability domains exist |
| `policies/approved-technologies.md` and lists like it | what a `list-membership` check reads |
| a clause's `gov:check` | what `gov validate` tests, and when |
| `preferences.json` | one person's own conveniences, bounded to C03 |

**So a policy edit changes gov's behaviour in exactly one way: through a clause's `gov:check`.** Everything else
is a setting, and every setting is a file gov reads.

## 2. Units of work

A **project** is a board in the project management system plus a workspace on your machine. Everything gov does
happens inside one.

**Identity is issued, never invented.** `gov seed` reads the board's number and composes the identifier; nothing
accepts one typed by hand.

```
project id      PRJ-<board#>-<slug>        board number, no leading zero
project branch  BRNCH-<board#>-<slug>      in the governance repo and in every code repo
task sub-branch BRNCH-<board#>-<slug>.ISSUE-<n>
archive tag     archive/<branch>           written before the branch is deleted
```

**State is derived, never stored.** There is no `registry.yaml` and no `project.yaml`. The board being open means
the project is active; closed means done; the anchor issue's assignees are its owners; write access to the board
is the authorization. gov re-reads those facts when it needs them.

The reason is a failure that happened: while a cached `project.yaml` and the derived model were both live,
lifecycle commands hard-stopped with `project.yaml not found` on projects that were perfectly valid under the
model the tooling had already adopted. A cache of the platform's facts can disagree with the platform, and when it
does, the gates written against the cache fire on correct work.

**Lifecycle states** — each derived, none written down: `proposed` (a board exists, no workspace), `active`,
`paused`, `completed`, `cancelled`.

## 3. Branching

- Project work in the governance repository branches from the default branch and merges back to it.
- A code repository's project branch is cut from `default_code_branch`, which `gov seed` can override for a
  hotfix line.
- A task sub-branch merges back to its parent project branch. `gov merge` will not merge one anywhere else.
- On close or cancel, each branch is tagged `archive/<branch>` and then deleted.

**What is NOT specified here, because no code does it:** no branch is derived from a project branch by suffixing
it. `gov close` creates no branch at all. The two knowledge branches that do exist are fixed names belonging to
other verbs — `knowledge-<slug>` from `gov knowledge propose`, and `onboard-knowledge` from `gov onboard` — and
neither is composed from the project's identity. The policy asserted otherwise until 2026-09-29.

**What stops a branch rule being broken outside gov** is the platform, not this document — see §7.

## 4. The project management system

gov is bound to GitHub Projects today, and the binding is deliberately thin so that another system is a binding
change rather than a policy one. What gov requires of any such system:

| Capability | Used for |
|---|---|
| a work item with an id, status, assignee and links to repositories | task identity, ownership, scope |
| a board with an open/closed state and membership | project identity and lifecycle |
| write access as a checkable permission | the authorization of record |

**Write access to the board is the authorization.** There is no separate authorization file, and gov will not
introduce one.

Before `gov seed` will run: the board must have a name and at least one linked issue or pull request. It warns,
rather than refusing, when a linked issue belongs to no identifiable repository, when the board has no
description, or when nothing marks the project's scope.

## 5. What gov writes, and where

```
$AGENT_WORK_ROOT/<org>/projects/PRJ-<board#>-<slug>/     the project directory
  <governance-repo>/            a worktree on the project branch
  <each code repo>/             a worktree on the project branch
  .gov/governance/              a read-only snapshot of the ratified org-config + policy
  CLAUDE.md · AGENTS.md · …     the agent harness, one file per approved agent
```

**The harness is written on launch, and only when its bytes change.** Nine files at the project root and, since
2026-09-28, the same nine inside every cloned code repository — because an IDE opened at a code repo governs the
agent only if that vendor searches parent directories, which one of nine does. In a code repo gov owns a fenced
region and the team's own file survives below it; at the project root gov owns the whole file.

Those files are **untracked and visible**. gov does not commit them: putting them under version control is an
ordinary commit made by a developer or their agent during project work, and a team that wants every clone
governed runs `git add` once, after which gov keeps refreshing them in place.

## 6. Rules: from your prose to what an agent carries

`gov rules build` reads every document under `framework/policies/` and `policies/` **from the default branch**,
and produces:

| Output | Read by |
|---|---|
| the nine harness files | every approved agent, on every turn |
| `agent/harness/rule-map.md` | an auditor. Deliberately not resident |
| `.pol-lock.json`, one per tree | gov, to keep a POL number meaning one clause for ever |
| the compile report | you |

`gov rules check` writes nothing and fails when any of those is stale. `gov rules report` prints only the numbers.

**It reads the default branch because a clause on a working branch is a proposal.** Compiling it would put a rule
nobody ratified into the one place an agent is guaranteed to read. `gov setup` and `gov upgrade` are the two
exceptions and they are exceptions for a reason: at setup the substituted policies are on no branch yet, and at
upgrade the default branch still holds the clauses being replaced.

**A number is allocated once.** Where a clause already cites a POL number, that number is recorded; where a clause
is reworded, gov stops and asks rather than deciding whether it is the same rule. `POL-427` is cited in gov's own
source code, so a renumbering would silently re-point real citations.

**A changed rule stops work.** gov cannot replace the rules inside a running session, so when a build changes the
rendered bytes it records a marker and the mutating verbs (`task`, `merge`, `close`, `knowledge propose|submit|archive`)
refuse until a new session is launched or a person attests the restart with `gov rules reload`. Read-only verbs
keep working.

## 7. What holds when gov is not in the loop

This is the honest boundary of everything above. A developer who clones a repository and pushes by hand runs none
of gov's code, so none of gov's gates apply. **Only the platform can stop that**, and whether it does is a choice
recorded in `governance_posture`:

| `governance_posture` | Means |
|---|---|
| `hard` | `gov repo protect apply` installs the controls: a pull request required, an approving review required, no bypass for administrators, and a required check verifying the approver is authorized |
| `soft` | direct work is deliberately possible. gov's gates and the agent's cues remain, and neither binds a hand-run `git push` |
| unset | nobody has chosen. `gov doctor` says so, and does not treat it as either |

**On GitHub Free for a private repository none of it can be installed** — the API answers 403 *"Upgrade to GitHub
Pro or make this repository public"* for both classic protection and rulesets. There, `hard` is unavailable and
`gov repo protect` says so rather than reporting a success: the organization's options are to make the repository
public, change plan, or record an exception naming the gap.

## 8. What gov verifies, and where it stops

**gov guarantees that the governance requirements are in an agent's context at launch and on every turn, from a
file it placed and verified.** The guarantee covers sessions gov starts. An agent a developer launches themselves
— in a code repository, a subdirectory, or anywhere else — is outside it; gov cannot place a file into a session
it did not start, so it does not claim to. `verifyAgentContext` refuses to launch when that file is missing or
empty, and today it checks the project root only.

**One mechanism for every approved agent.** No agent is governed by a means another lacks, even where a vendor
offers one — a hook only one vendor has would make that vendor the better-governed choice for a reason unrelated
to its merits, and would bias the choice an organization makes when it approves agents.

## 9. The verbs

`gov` alone opens the menu. Otherwise, and in full in
[`gov-command-reference.md`](gov-command-reference.md), which is generated from the CLI's own specs:

| Verb | What it changes |
|---|---|
| `setup` · `upgrade` | adopt the framework; bring an adopted workspace to this version |
| `seed` · `join` · `add-repo` | create a project workspace; bring one here; link a repository |
| `work` | resolve a project and launch an authorized agent with the protocol in its context |
| `task` · `merge` | create a task sub-branch; land it into the project branch |
| `pause` · `resume` · `cancel` · `close` | lifecycle transitions |
| `rules build\|check\|report\|reload` | compile the policies; verify; report; attest a restart |
| `knowledge search\|show\|list` | read the knowledge on this machine — no service, no network |
| `knowledge propose\|submit\|archive` | propose a change to org-wide knowledge |
| `repo protect plan\|apply` | install the platform controls, per the posture |
| `validate` · `doctor` | run the checks; report this machine and this workspace |
| `org` · `manage` · `preferences` · `log` | workspaces; ownership; your settings; this run's history |

## 10. Logging

Every run writes one log, under the person's own state directory, named for the day, the time, the project and the
command. Writes are logged; reads are not. Restricted data is never written to it at any level or through any
transport — that one is also a policy clause, because a person and an agent both have to observe it in code they
write, not only in code gov ships.
