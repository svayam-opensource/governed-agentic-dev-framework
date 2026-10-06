---
domain: governance
layer: spec
owner: framework
compliance: descriptive
status: current
---

# How the governed development framework works

A guide for the people who adopt, run and work inside the framework: what happens, who decides what, and why
it is built this way. Read it once from the start. After that, come back to the chapter for whatever you are
trying to do.

**About the rules.** This guide explains. It does not number anything. Each binding promise or obligation it
describes is held as a rule row in `framework/rules/rules.yaml`. A row records who the rule binds, how strict
it is and what checks it. You can see every row, and how each one is enforced, in the rule map
(`agent/harness/rule-map.md`). Each chapter ends with a pointer to the part of the map that belongs to it.

## Contents

1. [What this is, and what is yours](#1-what-this-is-and-what-is-yours)
2. [Who decides](#2-who-decides)
3. [How strict a rule is](#3-how-strict-a-rule-is)
4. [How a project starts](#4-how-a-project-starts)
5. [Where you may write](#5-where-you-may-write)
6. [What an agent does when a session starts](#6-what-an-agent-does-when-a-session-starts)
7. [How a change is approved and lands](#7-how-a-change-is-approved-and-lands)
8. [Writing knowledge down](#8-writing-knowledge-down)
9. [How your policy becomes rules](#9-how-your-policy-becomes-rules)
10. [When something goes wrong](#10-when-something-goes-wrong)
11. [What holds when gov is not in the loop](#11-what-holds-when-gov-is-not-in-the-loop)
12. [What gov records](#12-what-gov-records)
- [Glossary](#glossary)

---

## 1. What this is, and what is yours

### 1.1 Do not edit this document

The framework publishes this document and everything else under `framework/`.

- Do not change anything in it.
- A framework upgrade (`gov upgrade`) may replace it wholesale, or change it.
- Any edit you make here is lost at the next upgrade. It is lost silently, with no merge conflict to warn
  you.

The same holds for the framework's rules in `framework/rules/rules.yaml`: one writer, `gov upgrade`, and nobody
else. If something here does not fit your organization, tell the framework's maintainers. A local edit only
postpones the problem to the next upgrade, and hides it until then.

### 1.2 Your policies are yours

Your organization's own governance policy lives in the **`policies/`** folder.

- During the first setup, gov seeds a sample policy for your organization to use as a starting point. It is
  seeded once and never overwritten.
- You may change your policies whenever you like.
- You may write new rules in your policy, and change the ones you wrote.
- Your policies may be **stricter** than the framework, by adding rules of their own. They cannot relax,
  disable or replace a framework rule. §9.4 explains how that is held.

An upgrade never changes what you wrote in `policies/`. When a release ships a new file there, the upgrade adds
it once, empty, and leaves it to you from then on. That is what lets an organization write its own decisions
down without fearing that the next release will quietly undo them.

One upgrade does a little more, once. When your organization moves to the split described in §1.6, `gov
upgrade` carries the governance values you had already written in `org-config.yaml` into
`policies/governance.yaml` and your role list. It fills only blanks the framework itself shipped. If any value
would end up different from what you wrote, it stops and changes nothing, and tells you which value to
reconcile.

### 1.3 What the framework is for

The framework is a way of doing software work, with or without AI agents, so that the work is **traceable,
safe, compliant and recoverable** at every stage. Every rule in it serves that goal. A rule that stops serving
it is a defect, and should be reported as one.

It applies to all development work in an organization that has adopted it, whoever or whatever does the work.
That includes:

- a person using an AI assistant
- an assistant with write access to a repository
- a fully autonomous agent running a multi-step plan

An agent may be custom-built, vendor-supplied or a mix of both. It may call any model provider your
organization has authorized. Every agent works under the same contract, and none is exempt.

The framework carries no facts about your organization. Who your organization is, such as your name and your
branches, comes from `org-config.yaml`. How it governs, such as who your Policy Owner is, comes from
`policies/governance.yaml` (§1.6). What data you hold, which technologies you approve and who owns which part of
your knowledge are your decisions, and they live in `policies/` too.

### 1.4 Using gov without agents

An organization can adopt the framework for its **structure** alone: projects, tasks, branches, knowledge and
a reviewed way to change policy. It may authorize no AI agent at all (`authorized_agents: none` in
`policies/governance.yaml`). That is a supported way to run, not a loophole. A framework that could not be adopted for
structure alone would ask an organization to take on AI governance just to get a branch naming convention.

In that mode, every rule addressed to an agent simply sits idle. Every command that does not launch an agent
works as normal. `gov doctor` tells you which mode a workspace is in, so nobody has to work it out from a
policy.

### 1.5 When it takes effect

The framework takes effect for your organization when you adopt it, at the version recorded in the
governance repository's `VERSION` file. Each upgrade brings the rules of the new version. If your organization needs its own
effective date, it belongs in `policies/`.

### 1.6 Your settings, and where each one lives

Your organization's settings are in three places, grouped by who may change them:

| File | What it holds | Who approves a change |
|---|---|---|
| `org-config.yaml` | who your organization is: its name, its slug, its repositories and branches, and the addresses of the services it uses | anyone who may merge to the governance repository |
| `policies/governance.yaml` | how your organization governs: its posture (§11.1), its Policy Owner and Check Owner, the AI agents it authorizes, whether it publishes its knowledge, and the model it approves for `gov rules propose` | the Policy Owner |
| `~/.gov/work-roots`, on your own machine | where your own project folders live, if not in `~/.gov/<slug>/projects` | you |

`gov setup` writes the first two. The framework decides which keys `org-config.yaml` may hold and what each one
means, and publishes that list as `framework/config/org-config.schema.yaml`, which `gov upgrade` keeps current.
`gov doctor` checks your `org-config.yaml` against it. It names a key that is missing, a key gov does not read,
and a key that has moved to another file.

*Rules for this chapter: rule map, filter `framework-specification.md §1`.*

---

## 2. Who decides

### 2.1 The Policy Owner

The framework needs someone who can approve a change to governance, and who is the final escalation point
when nothing else settles a question. That person is the **Policy Owner**:

- They hold overall authority for your organization's adoption of the framework.
- They decide questions that cross domains.
- They settle disputes between the owners of different domains.

`policies/governance.yaml` names them, under `policy_owner` (an email address and a GitHub handle). A change to
that file needs the Policy Owner's approval.

### 2.2 The Check Owner

Some of your rules will be enforced by small programs, called **actions**, that run when something happens in
a repository. An action is code, and code needs a reviewer who can read it. The **Check Owner** reviews every
executable action your organization adds under `policies/actions/`.

`policies/governance.yaml` names them, under `check_owner`. By default the Policy Owner holds this role too. That
works, but it removes the second pair of eyes, so `gov doctor` warns you when one person holds both roles.

The split exists because the two approvals answer different questions. The Policy Owner approves the
**intent**: is this what we want to require? The Check Owner approves the **code**: does this program check
what it claims to, and nothing else?

### 2.3 Every other role is yours

Some questions are your organization's to answer, and they can change without a framework upgrade:

- who owns which domain
- whether you distinguish owners from managers
- who may approve what
- how a role is handed over

The framework asks only that the answers be **written down, with names**, in
`policies/authorized-representatives.md`. A named list can be checked; an assumption cannot.

### 2.4 When a role falls vacant

The framework's two roles must always have a named holder. `gov setup` will not finish without both.
`gov doctor` reports a role that has fallen empty. While the Check Owner role is vacant, the Policy Owner does
that work. Your seeded policy applies the same idea to the roles you define: each has a named holder, and a
vacancy falls to the Policy Owner until someone is named.

*Rules for this chapter: rule map, filter `framework-specification.md §2`.*

---

## 3. How strict a rule is

### 3.1 Three levels

Every rule has exactly one of three levels. The level says how firmly the rule binds, and what you may do when
it gets in the way.

| Level | In plain words | When it gets in the way |
|---|---|---|
| **C01** | non-negotiable | stop |
| **C02** | always applies | get an approved exception first |
| **C03** | a strong default | adapt it on purpose, and write down why |

A rule's wording does not set its level. "Must", "should" and "never" are ordinary English in a policy. The
level is a separate field of the rule row. It is proposed from what the author meant, and approved by the
Policy Owner (§9.3).

### 3.2 C01: stop

A C01 rule admits **no exception**, under any circumstance. No one can waive, override or defer it, the Policy
Owner included. C01 is the floor of the organization's safety and integrity. A floor that someone can lower
on request is not a floor.

So when a C01 rule is broken, or about to be broken, the only correct response is to stop and tell a person
(§10.1). A hard stop raised with a human is the outcome the system is designed to produce. It is not a failure.

### 3.3 C02: not without an approved exception

A C02 rule applies in all normal circumstances. You may deviate from one only when all three of these hold:

- an exception request exists under `policies/exceptions/`
- its pull request has been reviewed and merged by the person authorized for that domain
- that merged pull request exists, and can be pointed to, at the moment you rely on it

"It was agreed in a meeting" is not an exception. Neither is "the approver said yes in chat". Until the
exception is merged, being blocked and waiting is the right state. §10.2 shows how to ask for one.

### 3.4 C03: adapt, and say so

A C03 rule is a strong default. It applies unless the situation makes a different approach the better one.
Adapting it needs no exception, but three things are still expected:

- the decision is deliberate, never casual or for convenience
- the reasoning is recorded at the time, in the project's knowledge
- the rule's intent is still honoured, even where its letter is not

"Apply intelligently" is not permission to ignore. A silent deviation from a C03 rule breaks it. A recorded
one does not.

### 3.5 Framework rules are C01 or C03

A framework rule is **C01 or C03, never C02**. C02 is the level with an exception route, and a framework rule
has none: your organization cannot excuse itself from how the framework works. Where a framework rule cannot
work for you, that is a defect to report upstream, not a deviation to approve locally (§10.5). The levels of
your own rules are yours to choose, and C02 is often the right one for them.

*Rules for this chapter: rule map, filter `framework-specification.md §3`.*

---

## 4. How a project starts

### 4.1 Everything happens inside a project

All work happens inside a **project**: a unit of work with an identity, an owner and a lifecycle. No one
commits code, updates knowledge or changes an organizational resource outside an active project. That rule is
what makes work traceable afterwards: every change can be traced back to the project that made it, and to the
people accountable for that project. gov's own commands refuse to change anything outside one.

### 4.2 The board is the project

A project is a **board** in your project management system, plus a workspace on your machine. The framework
uses GitHub Projects today. The binding is deliberately thin, so that moving to another system would change a
binding and not a policy.

What gov needs from any project management system:

| Capability | Used for |
|---|---|
| a work item with an id, status, assignee and links to repositories | task identity, ownership, scope |
| a board with an open/closed state and membership | project identity and lifecycle |
| write access as a permission gov can check | who may work on the project |

Before `gov seed` will start a project from a board, the board needs two things: a name, and at least one
linked issue or pull request. A board with no description gets a warning and nothing more.

### 4.3 Identifiers and branches are issued, not composed

gov issues every identifier and every branch. Nobody types one in.

| What | Looks like | Issued by |
|---|---|---|
| project id | `PRJ-<board#>-<slug>` (board number, no leading zero) | `gov seed` |
| project branch | `BRNCH-<board#>-<slug>`, in the governance repo and in every code repo | `gov seed` |
| task sub-branch | `BRNCH-<board#>-<slug>.ISSUE-<n>` | `gov task` |
| archive tag | `archive/<branch>`, written before a branch is deleted | `gov cancel`, `gov close` |

**Why this matters for agents.** Knowing the pattern is no use to an agent that should not be making the
branch in the first place. A branch an agent invented looks exactly like one gov issued, right up to the
merge that lands it somewhere nobody intended. So an agent uses only the identifiers and branches gov gave
it. It never composes one, and never creates, renames or merges a branch by hand. If it thinks it needs a
branch, it asks.

### 4.4 State lives on the board

A project's state is **read from the board** every time it is needed, and never stored in a file:

- an open board means the project is active
- a closed board means it is done
- the anchor issue's assignees are its owners
- write access to the board is the authorization

There is no `registry.yaml` and no `project.yaml`. gov writes no state file, and an agent must not create one,
or edit task state by hand. Tasks are created with `gov task` and landed with `gov merge`.

**Why.** A copy of the board's facts can disagree with the board. When it does, the checks written against the
copy fire on work that is perfectly correct. This really happened: while a cached `project.yaml` and the
derived model were both live, lifecycle commands stopped with `project.yaml not found` on projects that were
valid under the model the tooling had already adopted.

### 4.5 Who may work on a project

**Write access to the project's board is the authorization.** There is no separate list, and gov will not add
one. An owner grants access with `gov manage assign`. Organization owners and admins have access to
everything.

gov checks that access before any command that changes a project: `task`, `merge`, `close`, `sync`, `join`,
`add-repo` and the rest. It refuses when GitHub does not confirm the access. That includes the case where
GitHub could not be asked: an unanswered question is a refusal, not a pass.

One honest gap: opening a project that is already on your machine costs no GitHub calls, so gov does not
re-check access at that point. It says so when it happens. The agent's own check at session start (§6.2) is
what covers that case.

### 4.6 A project's life

A project is always in one of five states. Each is worked out from the board, and none is written down:

- `proposed`: a board exists, but no workspace has been made from it yet
- `active`
- `paused`
- `completed`
- `cancelled`

`gov pause`, `gov resume`, `gov cancel` and `gov close` move a project between them. Cancelling a project tags
each branch `archive/<branch>` and then deletes it. Closing a project is covered in §7.5.

*Rules for this chapter: rule map, filter `framework-specification.md §4`.*

---

## 5. Where you may write

### 5.1 Your workspace

gov keeps everything for a project in one directory on your machine:

```
$AGENT_WORK_ROOT/PRJ-<board#>-<slug>/     the project directory
  <governance-repo>/            a worktree on the project branch
  <each code repo>/             a worktree on the project branch
  .bases/<repo>/                a shared clone the worktrees are cut from
  .gov/governance/              a read-only snapshot of the governing files
  CLAUDE.md · AGENTS.md · …     the agent harness, one file per approved agent
```

`$AGENT_WORK_ROOT` defaults to `~/.gov/<slug>/projects`. Next to it, under `~/.gov/<slug>/`, are each
person's `preferences/` and gov's logs.

**The agent harness** is the set of files an agent reads when it starts. gov writes them when it launches a
session, and only when their bytes change. There are nine, one per kind of agent:

| Path | Agent |
|---|---|
| `CLAUDE.md` | claude-code |
| `AGENTS.md` | openai-codex, ibm-bob |
| `CONVENTIONS.md` | aider |
| `GEMINI.md` | gemini-code-assist |
| `.github/copilot-instructions.md` | github-copilot |
| `.clinerules/agent.md` | cline |
| `.continue/rules/agent.md` | continue |
| `.windsurf/rules/agent.md` | windsurf |
| `.cursor/rules/agent.mdc` | cursor |

gov writes the same nine files at the project root and inside every cloned code repository. It does both
because an editor opened on a code repository governs its agent only if that vendor's tool searches parent
directories, and only one of the nine does.

At the project root, gov owns each file whole. In a code repository:

- Five files keep gov's section above your team's own text, and your text survives.
- Four are written whole: the `.cursor`, `.clinerules`, `.continue` and `.windsurf` files. A team's own file
  at one of those paths is replaced on every launch. The Cursor file cannot be shared: its front matter must
  be the first bytes of the file, or Cursor treats the whole file as advisory.

The files are **untracked and visible**. gov does not commit them. A team that wants every clone governed
runs `git add` once, and gov keeps them current from then on.

### 5.2 The governance repository and the code repositories

Two kinds of repository take part in a project, and each holds one kind of thing:

- **The governance repository** (`<ORG_GOV_REPO>`) holds governance: `knowledge/`, `policies/`,
  `framework/`, `org-config.yaml`, and one `projects/PRJ-<board#>-<slug>/` folder per project for that
  project's own notes, decisions and to-dos.
- **Code repositories** hold code.

Code never goes in the governance repository, and governance never goes in a code repository. Each code
repository may have its own `knowledge/` folder for things that are true only of that repository, such as
how to build, run and test it.

### 5.3 Proposing a change to knowledge or policy

On the project branch, you and your agent may edit anything in the governance repository's `knowledge/` and
`policies/`. Those edits are **proposals**, and they carry no authority. A proposal becomes your
organization's standard only when its pull request is approved and merged to the default branch (§7.2).

The one thing an agent must never do is **act on its own unmerged edit** as though it were in force. It must
not follow it, or cite it as a rule. Governance comes from the default branch (§7.4). An agent that has just
written a rule, and then believed it, has approved its own work.

### 5.4 `framework/` is not yours to edit

Nothing under `framework/` is edited by hand, on any branch: not by a person, and not by an agent. The
framework publishes it, and `gov upgrade` is its only writer (§1.1).

### 5.5 Your preferences

Each person has a preferences folder of their own, at `~/.gov/<slug>/preferences/<your-github-login>/`. It
holds three things:

- a Markdown file for your agent, with how you like to work
- `preferences.json`, with settings gov uses for you (`gov preferences` lists them)
- a `credentials` directory for your keys

A preferences file is a place for conveniences: formatting habits, how much the agent explains, which editor
you use. It is bounded to what a C03 rule allows. It must never carry any of the following, because they
belong to the organization and not to one person:

- organizational policy
- a security mandate
- a compliance level
- an assignment or locking rule
- the priority of the knowledge layers

If an agent finds a preferences file trying to override one of those, it ignores the override and tells the
person.

### 5.6 What never gets committed

`$AGENT_WORK_ROOT` holds every project's clones, and the folder above it holds every person's preferences and
credentials. None of it is ever committed to any repository. Committing it would put another person's
preferences, and possibly their keys, into version control, from a directory nobody thinks of as content.

*Rules for this chapter: rule map, filter `framework-specification.md §5`.*

---

## 6. What an agent does when a session starts

### 6.1 What gov does before the agent's first turn

When you run `gov work`, gov takes four steps before the agent reads a word:

1. It launches only an agent your organization authorized in `authorized_agents` in `policies/governance.yaml`.
2. It writes the harness (§5.1) and checks that the file is there and not empty. It refuses to launch
   otherwise.
3. It builds the harness from the governance repository's **default branch**, never from a project branch
   (§7.4).
4. It puts the framework's rules, and your organization's, into the agent's context at launch and on every
   turn after that.

That guarantee covers only the sessions gov starts. An agent a developer launches by hand, in a code
repository or anywhere else, is outside it. gov cannot place a file into a session it did not start, so it
does not claim to.

**Every approved agent is governed the same way.** gov does not use a mechanism that only one vendor offers,
such as a hook. That would make that vendor the better-governed choice for a reason that has nothing to do
with its merits. It would also bias which agents an organization approves.

### 6.2 The agent's first reply

gov's guarantee ends at the first turn. From then on the agent is responsible for itself. Before it does any
work, in its first reply, an agent completes these steps:

1. Read `org-config.yaml` and `policies/governance.yaml`. Every later step takes its values from them.
2. Confirm that it is authorized. It needs write access to this project's board, and on a task sub-branch,
   the sub-branch must be assigned to it.
3. Confirm the project is active, meaning the board is open. In any other state it refuses and says why.
4. Load the four knowledge layers, fresh (§6.3).
5. Pull the latest project branch in every repository taking part.
6. Post a **context manifest** that says what it loaded, and wait.

Until those six are done, the agent makes no edits, commits, branches or tasks. If it cannot confirm step 2 or
3, it stops, tells the person and commits nothing. If someone asks it to skip the steps, it says it cannot,
and why.

**Why the agent checks again.** gov has already checked board access. But only the agent knows which task it
is about to work on. And when a project is opened from the local list, gov's check is skipped (§4.5).

### 6.3 The four knowledge layers

An agent reads knowledge in four layers. When two layers disagree, **the higher layer wins**.

| Layer | Where | Holds |
|---|---|---|
| 1. Organization (highest) | `knowledge/` and `policies/` in the governance repository | policy, standards, org-wide decisions |
| 2. Project | `projects/PRJ-<board#>-<slug>/knowledge/` | this project's decisions, learnings, compliance notes |
| 3. Repository | `knowledge/` in each code repository | that repository's conventions and build |
| 4. Person (lowest) | your own preferences folder (§5.5) | how you like to work |

Three things follow from the order:

- Preferences never override repository or organization knowledge.
- Repository knowledge never overrides organization knowledge.
- An agent reads **only its own person's** preferences. The other folders belong to other people.

All four layers are loaded fresh in every session. Nothing is carried over from an earlier session's memory or
cache, because yesterday's copy of a rule may already be wrong.

**No machine can see a read.** A validator can prove a file was written. Nothing can prove a file was
consulted. That is why this part of the contract rests on the agent being told, every turn, rather than on a
check.

### 6.4 Agents it spawns

An agent that starts a subagent, a sub-session or a worker gives it this same protocol. Whether a spawned
session inherits its parent's context depends on the vendor, and gov cannot reach into it. So the obligation
rests with the agent that spawns it. A subagent without the protocol is an ungoverned agent writing to a
governed repository. Pass the protocol on, or do the work yourself.

### 6.5 Saying which model it runs

Before it begins work, an agent says which model and which provider it runs on. A reviewer reading the work
later can then tell what produced it. Your organization's policy decides which providers are authorized, and
what data may be sent to them.

*Rules for this chapter: rule map, filter `framework-specification.md §6`.*

---

## 7. How a change is approved and lands

### 7.1 Every change lands by a pull request

Every change lands by a **pull request** that someone with the authority has approved. That covers code,
knowledge and policy alike. Nobody approves their own work, and nothing is merged without a review.

For task branches, use `gov merge`. It lands a task sub-branch into its project branch and nowhere else.

Even in the soft posture (§11.1), where a direct push to the default branch is technically possible, a check
looks at every push to a default branch. It confirms that each commit pushed arrived through a merged pull
request. A commit that did not is recorded as a violation for the Policy Owner to review. gov does not try to
undo it automatically, because reverting a shared default branch could destroy work other people have already
pulled.

### 7.2 Who approves

Approval follows what the change touches.

**Policy is approved section by section.** Your policy documents say, in plain English, who owns each
section, for example *"Section 4 is owned by the Data Owner."* gov reads those sentences into
`policies/ownership.yaml`. When a pull request changes a policy, gov works out which sections changed, asks
each section's owner to review, and requires every one of them to approve. There are three guard rails:

- A section that names no owner belongs to the Policy Owner.
- A change to who owns what always needs the Policy Owner. Nobody can hand a section to themselves.
- An executable action under `policies/actions/` needs the Check Owner (§2.2).

**Knowledge is approved folder by folder.** gov generates `CODEOWNERS` from your role list:

- Every folder of `knowledge/` and `policies/` routes to a named owner, and a folder with no owner routes to
  the Policy Owner.
- `policies/actions/` routes to the Check Owner.

The pull request is then sent to the right reviewers automatically. `gov doctor` notices a `CODEOWNERS` that
someone has edited by hand and that no longer matches.

### 7.3 The controls on the platform

A named approver is worth nothing if anybody can merge. So the real enforcement lives at the version-control
platform. `gov repo protect apply` installs four controls on the governance repository:

1. a pull request is required
2. an approving review is required
3. administrators cannot bypass either
4. a status check confirms that the approver is on your organization's list

The fourth exists because **an approving review does not prove the approver was authorized**. Any
collaborator with write access can leave one. The check reads your own list and fails when the approver is not
on it. That is what turns "a review happened" into "the right person approved". `gov doctor` reports which of
the four are actually in place.

`CODEOWNERS` is a **routing** mechanism. It decides who is asked to review. Where your plan does not enforce
it, it is not a gate.

### 7.4 The default branch is the authority

Governance always comes from the governance repository's **default branch**. The harness, the session-start
context and every rule gov enforces are built from that branch, and rebuilt every session. They are never
built from a project branch. Project-specific notes are read from the project branch, because that is where
the project's work is.

**Why this keeps concurrent work safe.** Many projects run at once, each on its own branch, and each may
propose changes to knowledge or policy. None of those proposals can affect another project, or the live
rules, until it is approved and merged. The protection comes from keeping branches apart and from a review
at merge. It does not depend on an agent choosing not to write somewhere. The one thing the branches cannot
prevent, an agent believing its own unmerged edit, is covered by §5.3.

Proposing a change to a rule is a different thing from being excused from one. A pull request that changes a
policy proposes a new rule for everyone. An exception (§10) excuses one piece of work from a C02 rule that
stays in force for everyone else.

### 7.5 Closing a project: two kinds of merge

Closing a project does two jobs, and they carry different authority.

| Target | What `gov close` does | Why |
|---|---|---|
| a **code** repository | merges the project branch back into the branch it was cut from, locally, and pushes; then tags it `archive/<branch>` and deletes it | gov is finishing work gov started: an authorized automatic merge, with nothing to review |
| the **governance** repository | opens a pull request and **leaves it open** | that branch proposes organization-wide knowledge, which only someone with the authority can merge |

The board closes on the first run, without waiting. A completed project stays completed whether its knowledge
proposal is merged, rejected or abandoned. The governance branch is not archived on that run, because it is
the head of the open pull request, and deleting it would close the request unmerged. Run `gov close` again
after the request is merged, and gov tags and deletes the branch. While the request is still open, a second
run says so and changes nothing.

**gov never merges a pull request.** It once merged this one with the administrator override, seconds after
opening it, which defeated the very review it had just requested. That was removed on 2026-09-30.

The only other knowledge branches are `knowledge-<slug>`, from `gov knowledge propose`, and
`onboard-knowledge`, from `gov onboard`. Neither is built from the project's identity.

### 7.6 Never force-push a shared branch

Nobody force-pushes a branch that other people work on. That covers people, agents and gov itself. A force-push
rewrites history that others have already built on, and their next pull either fails or quietly drops work.

On every repository, a forced push to a project branch is recorded as a violation. In the hard posture, the
platform also blocks force-pushes to project branches outright.

*Rules for this chapter: rule map, filter `framework-specification.md §7`.*

---

## 8. Writing knowledge down

### 8.1 The knowledge tree is yours

`knowledge/` **ships empty**. The framework creates no domains. A domain should exist only when your
organization has a named owner for it, and a tree made up in advance would tie you to someone else's
taxonomy before anyone was accountable for it. `policies/knowledge-organization-standard.md` is a starting
point for your structure, and you can change it.

Whether your knowledge documents open with front matter, and which fields and values it carries, is also your
choice. gov checks front matter only when your own policy asks for it: keep section 4 of that standard, or write
your own, and `gov rules propose` turns it into a rule that checks exactly the fields and values you listed.

### 8.2 One fact, one document

Every fact lives in exactly **one** document. Do not restate a rule that exists somewhere else; link to it.
A duplicated fact drifts, and a drifted copy is false authority. Readers cannot tell which copy is right.

This matters as much inside an agent's context as it does in the repository. An agent that reads the same
rule stated two ways holds both, and which one it follows cannot be predicted. If you find the same rule in
two places saying different things, stop and report it.

### 8.3 Write it down as you decide it

Decisions, exceptions and open to-dos go into the project's knowledge **when they are made**, not at the end
of the session. A session that ends unexpectedly never reaches its end-of-session checklist. A decision
written down at the moment it is made survives the session.

### 8.4 Draw structure as text

Anything with structure is drawn as a **Mermaid diagram in text**: a flow, an architecture, a sequence, a
state machine or a relationship. Do not use an image. One text diagram serves both readers: it renders as a
picture for people, and it stays a few dozen lines that can be compared, searched and reviewed. An image
cannot be read by an agent, compared in a review or searched.

### 8.5 The project's compliance record

Each project keeps a `compliance.md` in its knowledge folder. It is the record of three things:

- the C01 violations found
- the C02 exceptions used
- the C03 deviations taken, each with its reasoning

The file has two halves.

- **gov writes one half** from its own run log: every refusal it issued, every gate that fired, every check
  that failed and was fixed, and every exception the project cited. gov rewrites that fenced section each time
  and never touches anything outside it.
- **People write the other half**, because no machine can: what was deviated from, why it was reasonable, and
  what a reader a year from now would need in order to agree.

How your organization rolls these up, and how often it reviews them, is set in
`policies/compliance-review.md`.

*Rules for this chapter: rule map, filter `framework-specification.md §8`.*

---

## 9. How your policy becomes rules

### 9.1 Prose for people, rows for machines

A policy is written by people, for people, in plain English. **gov never changes your policy text.** Each
rule in it is also held as a **rule row**, which records five things:

- the expectation, in one plain sentence: who does what
- the actor it binds: gov itself, an agent, a person, or everyone
- its level (§3)
- the short **cue** an agent is shown
- the **checks** that enforce it

The row also records the exact section it came from, with a fingerprint of that section's text. When the
section changes, its rows are flagged for review.

Every rule has an id. The id never changes and is never reused, even after the rule is retired. That way a
citation written last year still finds the rule it meant.

### 9.2 Two sets of rows

| Set | File | Written by |
|---|---|---|
| the framework's | `framework/rules/rules.yaml` | `gov upgrade` only |
| your organization's | `policies/rules.yaml` | an approved policy pull request only |

Each set has one writer, so an upgrade can never touch your rows, and your pull requests can never touch the
framework's. The rule map (§9.7) shows both sets together.

Each row is a dated revision. A changed rule closes its current row and opens a new one, so the history of
every rule stays readable. Your rows are stamped with your organization's own policy version
(`policies/VERSION`). That version goes up only when `policies/` changes. Each time it goes up, a copy of
your policies as they were is kept in `policies/history/<x.y.z>/`, and nobody may change that copy afterwards.
(These copies used to live in `policies/version/`. On a Mac or a Windows machine, a folder of that name and the
file `policies/VERSION` count as the same name, so one of them went missing. `gov upgrade` moves the old copies
for you, unchanged, and moving them is allowed.)
`policies/CHANGELOG.md` records:

- what changed
- who changed it
- who approved it
- the pull request that made the change

### 9.3 How a section becomes rules

When a policy section changes, `gov rules propose` reads it and suggests rows for it. It looks at each
existing row and suggests whether to **keep**, **revise** or **retire** it, and it suggests any new rows. It
asks you only when your intent is unclear:

- which level you meant
- who the rule binds
- whether an old rule still holds
- whether something can be checked at all

You answer, the Policy Owner approves, and the result is locked.

The policy pull request check starts from your policy text, not from the rules. It finds every section the pull
request added or changed, and checks that each one was reviewed. A section with no rules counts too. The
changelog entry for the new version shows the outcome, one line per section: no rule, or which rules were added,
revised, retired or kept. A section the pull request removed is listed with the rules it retired. Editing a
section again after it was reviewed means it must be reviewed again. Changing only spacing or line breaks is not
a change.

You can run it yourself, which is the normal way. It also runs on a policy pull request when the rows are out
of date. gov issues every new id itself; a language model never does. A commit made by a bot never counts as
an approval.

Reading your policy and suggesting rows is done by a language model, so your policy text is sent to it. gov
sends it only to a model your organization has approved. You approve one in `policies/governance.yaml`, under
`models:`. gov can use a Claude model from Anthropic, a Gemini model from Google, or a command-line program you
name that reads the request and prints the reply. You also decide there whether the pull request check may
use it. Until you approve one, propose refuses and tells you where to do it. When the check does use it, gov
pushes its suggestion to the pull request with the repository's own token. GitHub does not re-run checks after
such a push, so gov asks you to re-run them.

### 9.4 Stricter, never laxer

Your organization can never change a framework row. You may **add** your own rules that are stricter than
the framework: requiring more, or allowing less. A stricter rule needs no exception; it is your organization
holding itself to a higher standard.

What you cannot do is relax, disable or replace a framework rule. When a proposed rule of yours contradicts a
framework rule, the proposal says so. The Policy Owner cannot approve it as written.

### 9.5 Checks

A **check** is an action that runs when something happens to a resource. Some examples:

- a pull request is opened on a repository
- a commit is pushed
- an issue is closed
- a gov command is about to run

The catalog (`framework/rules/catalog.yaml`, plus any additions of yours in `policies/catalog.yaml`) lists the
resources, the events each one produces, and the actions available.

Events come in two kinds:

- **Gates** can refuse. A required check on a pull request is a gate, and so is a gov command.
- **Observers** see something after it has happened. A failed check there opens a violation record for the
  Policy Owner. Where the catalog says how, it also undoes the change.

A rule checked at a gate is **prevented**. A rule checked only by an observer is **detected**. A check judged
by a language model never blocks anything. It only raises a finding, and a person confirms or dismisses it.

gov renders each check into the resource's own automation, for example a GitHub Actions workflow. Every
rendered check calls `gov check run <rule id>`. There is no central service to run or keep alive.

A check in a code repository has to read the rules, and they live in the governance repository. GitHub's own
workflow token can read only the repository the workflow runs in, so your organization needs a GitHub App to
bridge the two. GitHub Apps are free on every plan. Once per organization, an owner runs `gov app setup`. It
opens a page in your browser, where you confirm the new App on GitHub. gov then stores the App's two
credentials as Actions secrets wherever your repositories can receive them (§11.4), and never keeps a copy of
its private key. You install the App on the
governance repository only, and `gov app check` confirms that everything is in place. After that, each check
gets a short-lived, read-only token every time it runs. Nobody's personal token is involved.

A project usually spans several repositories, and each one needs its own copy of the workflow. `gov check install
--all` writes it into the governance repository and into every code repository linked to the project's board, in
your local clones. It only writes on the project's own branch or one of its task branches. A repository sitting on
its default branch is skipped, with the reason. gov never commits or pushes. It tells you which repositories it
changed and prints the commands to land them. Running it again changes nothing if the rules have not changed.
`gov check status` tells you, for each repository, whether its workflow is current, out of date or missing, and
`gov doctor` shows the same answer in one line. When gov cannot see a repository, it says it cannot tell.

### 9.6 Cues

A **cue** is a one-line reminder an agent carries. Cues come in two tiers:

- **Resident** cues are always in the agent's context, on every turn. Only C01 rules that bind an agent have
  one. The tier has a hard limit, and a build that would exceed it fails rather than silently dropping a rule.
- **On-demand** cues are shown only when the agent is about to do the thing the rule is about. They are keyed
  to the same event as the rule's check.

People get no cues. A person meets a rule in the message a gate gives when it refuses.

### 9.7 The rule map

`agent/harness/rule-map.md` lists every rule in force, from both sets, with its level, who it binds, and what
actually holds it up. It is the audit record, and it shows how much of your governance is enforced and how
much depends on someone choosing to obey it. Each rule is in one of six classes:

| Class | Means |
|---|---|
| **prevented** | a gate refuses the violation |
| **detected** | a check finds it after the fact |
| **judged** | a model flags it, and a person decides |
| **cued** | an agent is told, every turn or at the moment it matters |
| **advisory** | nothing enforces it; it binds because people read it |
| **cannot-tell** | its check is bound to something nothing can listen to yet |

### 9.8 When the rules change during a session

gov cannot replace the rules inside a running session. So when a rebuild changes what agents are told, gov
records that the rules are pending. These commands then refuse until a new session is started, or until a
person confirms the restart with `gov rules reload`:

- `task`
- `merge`
- `close`
- `knowledge propose`, `knowledge submit` and `knowledge archive`

Other commands change things but do not refuse: `seed`, `join`, `add-repo`, `issue`, `onboard`, `cancel`,
`pause`, `resume`, `sync` and `repo protect apply`. Whether that list is the right one is still an open
question.

The pending marker is kept per person and per work root. If gov cannot tell who you are, or where your work
root is, the commands that would refuse refuse anyway, and say which of the two was unknown. "No marker" and
"no answer" lead to opposite actions, so gov never treats one as the other.

*Rules for this chapter: rule map, filter `framework-specification.md §9`.*

---

## 10. When something goes wrong

### 10.1 A C01 violation

An agent that finds a C01 rule broken, or about to be broken, does four things:

1. It **stops** all work immediately.
2. It **commits nothing**, to any branch.
3. It **tells** the responsible person what it found.
4. It **waits** until that person has resolved it.

This applies at any point in a session, not only at the start. Stopping is not the agent failing; it is the
system doing what it was built to do. `framework/docs/user-guides/when-something-goes-wrong.md` covers what
to do when a gov command refuses.

### 10.2 Asking for an exception

An exception lets one piece of work deviate from one C02 rule, for a stated time. It must be approved
**before** the work that depends on it starts:

1. The requester writes an exception file in the right domain folder under `policies/exceptions/`, using the
   form in `framework/templates/exceptions/`.
2. The requester opens a pull request for it.
3. The person authorized for that domain reviews it and merges it. **Merging is the approval.**
   `policies/authorized-representatives.md` names who that is. Until your organization appoints domain
   owners, it is the Policy Owner.
4. Until the pull request is merged, the work that depends on it waits.

An agent never assumes approval is coming, and never acts on a verbal or informal yes.

### 10.3 What an exception says

An exception file states six things:

- the rule it excepts, by id
- the project or context it applies to
- the business reason
- its scope
- its **expiry date**
- any compensating controls

An exception with no expiry is a permanent change to policy, and should be made as a policy change instead.

### 10.4 While it is in force, and when it expires

An approved exception is added to the project's resident rules, limited to the scope it names. The agent is
told what it may now do: which rule is excepted, where, until when, and who approved it. Without that, a cue
would keep stopping work the organization has already allowed, and people would learn to talk their way past
cues.

gov removes the exception when it expires. Nothing else has to happen: the rule speaks again at the next
build, and the check it was excusing starts failing again.

### 10.5 What cannot be excepted

Exceptions apply only to your **organization's** C02 rules. Two kinds of rule can never be excepted:

- **C01 rules**, by definition (§3.2)
- **framework rules**, because they are fixed

gov refuses an exception that names a framework rule. If the framework requires something your organization
cannot do, that is a defect to report upstream, not a deviation to approve locally.

*Rules for this chapter: rule map, filter `framework-specification.md §10`.*

---

## 11. What holds when gov is not in the loop

### 11.1 Soft and hard

A developer who clones a repository and pushes by hand runs none of gov's code, so none of gov's gates apply.
**Only the platform can stop that.** Whether it does is your choice, recorded as `governance_posture` in
`policies/governance.yaml`:

| Posture | What happens on a violation |
|---|---|
| `soft` (the default) | a violation record is opened so the Policy Owner can review it later; direct work is possible |
| `hard` | the action, for example a merge, is stopped; `gov repo protect apply` installs the platform controls (§7.3) |

When you choose `hard` during setup, gov warns you first. Choosing "hard" requires your repositories to be
public, or a paid GitHub plan. You are then asked to confirm, and the default answer is no.

Under `hard`, `gov repo protect apply` also makes each rule's pull-request check a required check, on the
governance repository and on each code repository. A failing check then stops the merge, so the rule is
**prevented**. It also blocks force pushes on project branches (§7.6). Under `soft` the same checks run and
report, but nothing waits for them, so they are **detected**.

Detected means recorded. When a pull request merges under `soft` while any of gov's checks on it has failed,
the push to the default branch opens one violation record for the Policy Owner. The record names the pull
request and each failed rule with what it found, and says the pull request merged under soft posture with
those checks failing. A pull request gets one record, however many times the push is checked. Under `hard`
this cannot happen, because the checks are required.

Under `hard`, no gov command writes to a protected branch. `gov seed` creates the project branch and nothing
else. Closing a project leaves the governance pull request for a person to merge.

### 11.2 When the platform cannot enforce anything

On a **private repository on the GitHub Free plan**, branch protection and rulesets are not available. The
API answers `403 Upgrade to GitHub Pro or make this repository public`. GitHub Actions still run there, but
they cannot block a merge. So every check on that repository is **detected**, never **prevented**.
`gov repo protect apply` says so and stops with an error, rather than reporting a success it did not get.

You have three ways forward:

1. **Make the repository public.** Protection becomes available, and `hard` works.
2. **Move to a paid plan.** The same, and the repository stays private.
3. **Stay `soft`.** Violations are detected and recorded for the Policy Owner instead of being stopped. This
   is an honest position, as long as everyone knows it is the one you are in.

### 11.3 What gov can and cannot see

gov can see what passes through its own commands, what a check can read in a pull request or a push, and what
the platform reports. It cannot see:

- what a person or an agent read
- what an agent was told outside a session gov started
- a push made with the hooks turned off

The rule map (§9.7) is honest about this: a rule held up only by a cue, or by nothing, is labelled that way.

### 11.4 Where the secrets live, and why the plan matters

Some checks need a secret: a code repository's check needs the GitHub App's two credentials to read the rules
(§9.5), and the governance repository needs your approved model's key when CI may propose rules (§9.3). A
secret can be stored once for the whole organization, or separately on each repository.

**On the GitHub Free plan, an organization secret never reaches a private repository.** The workflow still
runs, but the secret arrives empty, and GitHub gives no warning. Organization secrets reach a repository only
when your plan is paid (Team or Enterprise) or the repository is public. Everywhere else, the repository needs
its own copy.

gov works this out for you. It reads your plan and each repository's visibility. Only an organization owner can
see the plan, so when gov cannot read it, it says it cannot tell and never assumes.

- `gov app setup` stores the App's credentials as organization secrets where they reach, and as repository
  secrets on the governance repository and on each of the project's code repositories that needs its own copy.
  It does this while it holds the private key, and keeps no copy afterwards.
- `gov app rotate` is for a repository added later, or a key that may have leaked. GitHub cannot create an App
  key through its API, so gov sends you to the App's page to generate one. You hand it to gov on standard input
  or as a file, which gov deletes after use. gov stores it everywhere it is needed and tells you which old key
  to delete on the App's page.
- `gov app check` and `gov doctor` name each repository that will not receive a secret it needs, with the
  fix: a repository secret, or `gov app rotate`.
- When CI cannot propose rules because the model's key is missing, the message says that organization secrets
  do not reach private repositories on the Free plan, and gives the command that sets the key on the
  repository.

*Rules for this chapter: rule map, filter `framework-specification.md §11`.*

---

## 12. What gov records

### 12.1 The run log

Every run of gov writes one log, in the person's own state directory. It is named for the day, the time, the
project and the command. Writes are logged, and reads are not. Someone who was not there can see afterwards
what gov did, and why it refused.

An ordinary prompt's answer **is** logged, in full. That is deliberate: "what was asked, and what did the
person say" was once impossible to answer without a screen recording. It is also why a prompt that asks for a
credential must use the hidden prompt path. A test fails if a credential-shaped question uses the plain one.

### 12.2 What is redacted

| Redacted | How |
|---|---|
| a secret-shaped flag's value | `--token x`, `--api_key=x`, `--auth`, `--bearer`, `--cookie`, `--credential`, `-H`, `-u`: the name stays, the value becomes `***` |
| a credential inside a URL | `https://user:tok@host` → `https://user:***@host`, including in a bare argument |
| a credential shape in free text | private-key blocks, GitHub tokens and fine-grained PATs, AWS key ids, Slack tokens: the same shapes `gov validate` scans files for |
| a failed process's error output | redacted before it is logged, because `git` and `gh` repeat the remote URL, token included, in their errors |
| a hidden prompt's answer | only its length is recorded |

**One gap, kept knowingly.** A secret that begins with `-` and is passed as a separate argument
(`--token -abc`) is not redacted. Treating it as a value would mean redacting the next real flag in every
ordinary command, which would ruin the log for its actual purpose. `--token=-abc` is covered.

### 12.3 One logging utility

Every gov client logs through **one shared logging utility**. Nobody uses `print`, `console.log` or a
logger written for one module. One utility means one set of levels, one structure, and one place to add a
redaction rule so that it applies everywhere at once. Each kind of ad-hoc output breaks that in its own way.
The framework's own build enforces it.

Your organization's own code follows your organization's architectural principles, which are yours to write in
`policies/`.

*Rules for this chapter: rule map, filter `framework-specification.md §12`.*

---

## Glossary

| Term | Meaning |
|---|---|
| **action** | a small program a check runs, listed in the catalog. Organization actions are reviewed by the Check Owner. |
| **agent** | any AI tool working with write access to one of your repositories |
| **anchor** | the issue on the board that carries a project's ownership |
| **board** | the record in the project management system that is a project (GitHub Projects today) |
| **catalog** | the list of resources, their events, and the actions checks may run |
| **check** | an action bound to a resource event, which enforces a rule |
| **C01 · C02 · C03** | the three levels of a rule (§3) |
| **cue** | the one-line reminder of a rule that an agent is shown |
| **default branch** | the governance repository's main branch: the only source of governance |
| **exception** | an approved, time-limited permission to deviate from one of your C02 rules |
| **gate · observe** | an event that can refuse, or one that sees a change after it has happened |
| **governance posture** | `soft` or `hard`: whether a violation is recorded or stopped |
| **governance repository** | `<ORG_GOV_REPO>`, which holds `knowledge/`, `policies/`, `framework/` and `projects/` |
| **harness** | the files gov writes so that an agent starts with the rules in its context |
| **project** | a unit of work: a board plus a workspace (§4) |
| **proposal** | an unmerged change to knowledge or policy; it has no authority yet |
| **rule row** | the machine-readable form of one rule: expectation, actor, level, cue, checks, history |
| **rule map** | the generated list of every rule in force and what enforces it |
| **section owner** | the role that approves changes to one section of a policy |
| **VCS · PMS** | version control system (GitHub) · project management system (GitHub Projects) |

For every command, flag and exit code, see [`gov-command-reference.md`](gov-command-reference.md), which is
generated from the CLI itself. For how the governance repository is operated, see
[`org_gov_repo_operations.md`](org_gov_repo_operations.md).
