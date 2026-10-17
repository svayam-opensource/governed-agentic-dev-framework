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
4. How a project starts — [build specification §1](build/build-specification.md)
5. Where you may write — [build specification §2](build/build-specification.md)
6. What an agent does when a session starts — [build specification §3](build/build-specification.md)
7. [How a change is approved and lands](#7-how-a-change-is-approved-and-lands)
8. Writing knowledge down — [build specification §4](build/build-specification.md)
9. [How your policy becomes rules](#9-how-your-policy-becomes-rules)
10. [When something goes wrong](#10-when-something-goes-wrong)
11. [What holds when gov is not in the loop](#11-what-holds-when-gov-is-not-in-the-loop)
12. [What gov records](#12-what-gov-records)
13. [The platforms gov works with](#13-the-platforms-gov-works-with)
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

The release `gov upgrade` writes is the one your gov carries. Each gov package includes the framework content it
was built with, so the client and the content always match. Setup seeds a new repository from that content,
and `gov upgrade` brings an existing one to it. Neither fetches anything to do so. To move to newer framework
content, install a newer gov, then run `gov upgrade`. To use other content on purpose, pass `--ref` (a commit,
branch or tag of the framework's repository) or `--from` (a local directory) to either command. gov refuses
content that is not the build it was made with, and writes nothing.

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
| `policies/governance.yaml` | how your organization governs: its posture (§11.1), its Policy Owner and Check Owner, the AI agents it authorizes, whether it publishes its knowledge, the model it approves for `gov rules propose`, and the runner gov's GitHub workflows ask for (§9.5) | the Policy Owner |
| `~/.gov/work-roots`, on your own machine | where your own project folders live, if not in `~/.gov/<slug>/projects` | you |

Setup writes the first two. The framework decides which keys `org-config.yaml` may hold and what each one
means, and publishes that list as `framework/common/reference/org-config.schema.yaml`, which `gov upgrade` keeps current.
`gov doctor` checks your `org-config.yaml` against it. It names a key that is missing, a key gov does not read,
and a key that has moved to another file. One block in `org-config.yaml`, `adapters:`, says which platform gov
talks to for each kind of work (§13).

### 1.7 The phases, and the paths reserved for them

The governance repository is split by owner, `framework/` (the framework's) and `policies/` (yours), and inside each
by phase: `common/` for what every phase shares, and `build/` for building software. Each owner keeps one `rules/`
store at its root. Two more phases are reserved for the tools that govern them, and gov creates neither folder:

| Phase | Reserved path | Owner |
|---|---|---|
| deploy | `policies/deploy/unit-catalog/` — reserved for the unit catalog | gov-cicd |
| run | `policies/run/fleet-catalog/` — reserved for the fleet catalog | gov-infra |

When one arrives it is a phase folder like `common/` and `build/`: the same `CODEOWNERS` routing, the same section
ownership in `policies/ownership.yaml`.

This specification is split the same way. This file holds what every phase shares; the build phase's chapters (how a
project starts, where you may write, what an agent does when a session starts, writing knowledge down) are in
`framework/build/build-specification.md`, numbered from 1. When the framework moves a file or splits a chapter after
2.0, your rules that cite it follow in one reviewed pull request: a rule may be changed in place when only the file it
cites moved and the cited section reads the same (`framework/common/reference/org_gov_repo_operations.md` has the
conditions).

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
`policies/common/authorized-representatives.md`. A named list can be checked; an assumption cannot.

### 2.4 When a role falls vacant

The framework's two roles must always have a named holder. Setup will not finish without both.
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
prevent, an agent believing its own unmerged edit, is covered by build specification §2.3.

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

The shape of a row is published as `framework/rules/rule-row.schema.yaml`, a JSON Schema that any editor or
tool can check a set of rows against. Three things it cannot say, because they look across several rows or
compare versions: only one row of a rule is in force at a time; each closed revision ends at the version where
the next one starts; and no row ends before it starts. `gov rules check` checks those three as well as
everything the schema checks, and gov's tests keep the schema and `gov rules check` in agreement. That
includes the cue (a tier and its text), each check's shape, the interview's questions and answers, and the
source's document, section and sha, which must be text. Quote a section or sha that looks like a number, for
example `section: "3"`.

### 9.2 Two sets of rows

| Set | File | Written by |
|---|---|---|
| the framework's | `framework/rules/rules.yaml` | `gov upgrade` only |
| your organization's | `policies/rules/rules.yaml` | an approved policy pull request only |

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

You answer, the Policy Owner approves, and the result is locked. A rule gets a cue shown at the moment of action
only if it has a check; otherwise the cue is dropped and the changelog says why, though a C01 rule for agents may
keep its cue as one every agent session reads.

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

The catalog (`framework/rules/checks-catalog.yaml`, plus any additions of yours in `policies/rules/checks-catalog.yaml`) lists the
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

**Where the checks run.** Every workflow gov writes asks GitHub for a runner. Unless you say otherwise, it asks for
GitHub's hosted runner, `ubuntu-latest`. If your organization runs its CI on its own machines — for example because
its GitHub Actions spending limit is $0 — a hosted runner is never granted: the job waits, the check never reports,
and a pull request that requires it waits with it. Name your runner once, in `policies/governance.yaml`:

```yaml
ci:
  runs_on: [self-hosted, linux]
```

`runs_on` is one runner label, or a list of labels a runner must carry every one of. gov then uses it in the
workflows it writes: `gov check install` writes it into every job of `gov-checks.yml`, `gov repo protect apply` into
the approver check, and `gov upgrade` keeps both in step when you change it. The validation workflow
(`gov-validate.yml`) gets it when it is first installed. After that, that file is yours, so if you change your runner
later, change it there too. A value gov cannot use — a label with a space, an empty list — stops `gov check install`
and `gov repo protect apply` before they write anything, and the message names `ci.runs_on`. `gov doctor` warns about
it too. A runner you set by hand in gov's approver check is kept as long as `ci.runs_on` is not set.

**Writing your own check action.** When the framework's actions cannot express a check, your organization can
write one as a small `bash` or `python` program. It lives in its own folder, `policies/actions/<name>/`, and the
Check Owner reviews it like any other code (§2.2). You list it in `policies/rules/checks-catalog.yaml` as `bash/<name>` or
`python/<name>`, and a rule binds it like any other action. The folder holds:

- `action.yaml`, which says `tool:` (`bash` or `python`, the same as the catalog entry), `entry:` (the script in
  the folder to run, for example `run.sh` or `run.py`), and optionally `timeout:` in seconds (60 if you leave it
  out) and `needs: [github]`.
- the script itself, and anything else it reads.

gov runs the script in the repository being checked. It tells the script what happened through environment
variables: `GOV_RULE_ID`, `GOV_EVENT`, `GOV_RESOURCE`, `GOV_REPO_DIR` (the repository, also the working
directory), `GOV_PARAMS` (the rule's `with:` settings, as JSON) and `GOV_CHANGED_FILES` (the path of a file listing
the changed files, one per line). The script answers with its exit code:

| exit code | means |
| --- | --- |
| 0 | the rule held |
| 1 | the rule did not hold. The rule's `on_miss` decides whether that fails or only warns. |
| anything else | the check could not tell |

A script that runs past its timeout also could not tell, and so does a `python` action on a machine without
Python 3. gov looks for it under the names it usually has: `python3`, then `python` on Linux and macOS; `py -3`, then
`python`, then `python3` on Windows. When none of them is Python 3, the finding names every one gov tried. To say what it found, the script prints one JSON object per line, with a `message` and, where it
helps, the `file`, the `line` and the `rule`. gov shows each one as a finding. Any other output is the script's own
log, and gov ignores it.

Three things keep this safe:

- gov runs the action as your **default branch** has it, never the copy in the change being checked. A pull
  request that changes an action cannot run its new code until it is approved and merged. Until then, a check
  that needs an action the default branch does not have yet could not tell.
- The script gets no GitHub token and none of gov's own settings. Only the variables above, and basics such as
  `PATH` and `HOME`, are passed. An action that must call GitHub says `needs: [github]` in `action.yaml`, which
  passes `GH_TOKEN` and `GITHUB_TOKEN` and nothing more. The Check Owner sees that line in review.
- The timeout stops a script that hangs.

`gov check run` runs these actions on your machine as well as in GitHub Actions.

An action can also be a GitHub Action, listed as `gh-action/<name>`, with its own `action.yml` in
`policies/actions/<name>/`. That kind runs **in GitHub Actions only**. `gov check install` writes it into the rule's
job as a step, taken from your default branch's copy of the folder, and the step's result is the check's result. The
rule's `on_miss` applies to it as to any other action. Run on your machine, `gov check run` cannot run it, and says
the check runs in CI only.

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
system doing what it was built to do. `framework/common/guides/when-something-goes-wrong.md` covers what
to do when a gov command refuses.

### 10.2 Asking for an exception

An exception lets one piece of work deviate from one C02 rule, for a stated time. It must be approved
**before** the work that depends on it starts:

1. The requester writes an exception file in the right domain folder under `policies/exceptions/`, using the
   form in `framework/common/templates/exception-template.md`.
2. The requester opens a pull request for it.
3. The person authorized for that domain reviews it and merges it. **Merging is the approval.**
   `policies/common/authorized-representatives.md` names who that is. Until your organization appoints domain
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

### 12.4 Evidence, and the seam to a paid module

gov runs every check, decides every verdict and enforces every gate by itself. Nothing below is needed for that.
An organization that wants **evidence** — signed, tamper-evident records an auditor can rely on — adds a separate,
paid module from Svayam, `@svayam/gov-check`. The module only adds things. It writes evidence, runs the paid
actions (the LLM judge, actions that come with a compliance pack), generates auditor reports and offers packs.

```mermaid
flowchart LR
  subgraph OPEN["gov (open source)"]
    RUN["checks, verdicts, gates"] --> SINK["evidence sink<br/>(does nothing by default)"]
    HOST["check-host<br/>types · schemas · canonical JSON"]
  end
  subgraph PAID["@svayam/gov-check (paid)"]
    W["sign · chain · push"]
    R["reports · packs · LLM judge"]
  end
  SINK -- "if installed" --> W
  HOST -. "imported by" .-> PAID
  W --> L["evidence/ in YOUR gov repo"]
```

| | Open gov | Paid module |
|---|---|---|
| Running checks, verdicts, gates, violation issues | yes, all of it | — |
| The shape of an evidence record, and when one is produced | yes | — |
| Signing, chaining and pushing records | — | yes |
| Reports, packs, the LLM judge | says "needs subscription" | yes |
| Licence and lease checks | never | yes |
| Verifying a ledger | yes, free (`gov evidence verify`) | — |

**What a record holds.** One record is written per check verdict, per gate decision and per session start or end.
It names the rule, the verdict and a short message *key*. It never holds code, a diff, file contents or the text of
a finding, and it names your organization only by its numeric id. The record format is strict: a record with any
other field is refused. Records are kept in your own gov repository, under `evidence/`. They never leave your
environment. The only things that reach Svayam are lease requests: a key or a CI identity token, the writer's
public key, and a handful of usage *numbers*.

**Evidence from CI.** The `gov-checks` workflow in a code repository always asks GitHub for its identity token
(`id-token: write`), whether or not the organization pays, so the workflow never changes with a subscription. Its
evidence steps run only when the organization has turned evidence on (`gov evidence enable` stores the evidence
App's two secrets). Then the job swaps its GitHub identity token for a short-lived key to the paid module, installs
the module, mints the evidence App's token, and the checks write their signed segment to `gov/evidence`. No licence
key is stored anywhere: the job proves itself with GitHub's token alone. Each of these steps may fail without
failing the job. An organization without a subscription gets one calm notice and its checks run as usual.

**When a rule needs a subscription.** Some actions are paid: the LLM judge on a gov-check installation, and the
actions that come with a compliance pack (a catalog action whose tool is `gov-check`, or that says `paid: true`).
Where no paid module runs, a binding to a paid action is recorded but not run. Its outcome is **needs
subscription**. It is never a pass, it counts like "could not tell" when outcomes are combined, and it does not
block anything by itself. A rule whose every check is paid shows the Class *advisory (needs subscription)* in the
rule map. Without the module, an LLM judge binding stays "could not tell", as before.

**The quiet notice.** The subscription decides whether evidence is recorded. There is no setting for it in
`policies/governance.yaml`. When the module is not installed or not running, gov says so once per place it
speaks: one notice on the CI run (GitHub shows it on the pull request), one line under the session manifest when
`gov work` starts an agent, and one advisory row in `gov doctor`. Nothing else changes.

**Versions must match.** gov announces the version of the seam it offers. The module declares the version it
needs. When they do not fit, gov prints one quiet line and runs exactly as it does with no module installed. It
never fails because of the module.

*For module authors:* the seam is the subpath `@svayam-opensource/gov/check-host`. It exports the types, the
JSON schemas (record, seal, chain entry, lease request, usage counts) and the one canonical-JSON function that every
hash and signature in the ledger is computed over.

---

## 13. The platforms gov works with

### 13.1 Three ports

gov needs three things from the platforms your organization runs on. Each is a **port**: a fixed list of
questions and actions, in words that belong to no vendor.

| Port | What gov asks of it |
|---|---|
| work tracker | the projects and the work items on them: create an item (always with an assignee), move it between to do, in progress and done, link and label it, comment on it, find it again |
| code host (`vcs`) | the hosted repositories: a branch, a change request and its state, who reviewed it (a person or a bot), the checks a branch requires, and who gov is signed in as |
| CI identity | whether gov is running in a CI that can prove who started it, and what that signed proof says |

Each port is answered by an **adapter**, which speaks one platform's language. GitHub is the only adapter today.
Another platform, such as GitLab or Jira, needs a new adapter. It does not need a change to the commands that use
the port.

Your local git commands (commit, branch, push) are not a port. git is the same everywhere.

**Nothing fails quietly.** Every action a port takes returns either its result or the reason it failed, and
whether trying again could help. The command that asked must deal with the failure. A step that did nothing is
reported as a step that did nothing, never as a success.

The commands added for the AI-native lifecycle (signals, autorun, intents, projects and skills) use only the
ports. The framework's own build refuses code in them that calls GitHub's command-line tool directly. Older
commands move behind the ports as they are changed.

### 13.2 Choosing the platform

The `adapters:` block in `org-config.yaml` names the adapter for each port:

```yaml
adapters:
  work_tracker: github
  vcs: github
  ci_identity: github
```

Leave the block out, or leave a port out of it, and gov uses `github`. `gov doctor` fails if the block names an
adapter gov does not have, and says which port and which name. gov never falls back to a different adapter in
silence, because then it would report work done on a platform it never touched.

### 13.3 Change requests and who reviewed them

The code host port is how gov opens a change request (a pull request on GitHub), reads its state, and reads
the checks a branch requires. Those come from both branch protection and rulesets. A missing branch is an
answer, not a failure: gov is told it is not there, and can tell that apart from a host it could not reach.

Each review says who gave it and whether that account is a **person** or a **bot**. On GitHub an account is a
bot when GitHub marks it as one, or when its name ends in `[bot]`. The difference matters because an agent can
write a review, but it cannot approve as a person. Knowing which is which lets gov count only a person's approval.

### 13.4 Proving where a run came from

A command running in CI can ask the CI identity port for a signed token that says which repository, branch and
run it belongs to, and who started it. On GitHub this is the job's OIDC token, which a job receives only when
its workflow grants `id-token: write`. Outside CI the port says it is not available, and gov does not guess.

gov reads what the token says but does not check its signature itself. The service the token is shown to checks
it. gov never writes the token to its log, prints it, or puts it in an error message.

### 13.5 Work items and the board

The work tracker port is how gov reads a project and its items, and how it changes them. On GitHub a project is
a GitHub Project board and an item is an issue on it.

- **Every item has an assignee.** gov refuses to create an item without one, before anything is created.
- **State is the board's Status.** gov moves an item between three states: to do, in progress and done. It sets
  the board option with that name, whatever its capitals or spacing ("In Progress", "in-progress"). A board
  with no Status field, or no option for the state, is reported as such. `gov task` sets in progress and
  `gov merge` sets done. When the board cannot be updated, the command still succeeds, because its branches are
  already made, and it prints why the Status was not set.
- **Links.** One item can block another, relate to it, or have moved to it. GitHub records "blocks" as an issue
  dependency. When GitHub refuses that, for example because the repository's plan has no issue dependencies,
  gov writes a comment on the blocked item instead. The comment says which item blocks it and carries a
  machine-readable marker. gov then reports that the link was recorded as a comment. Links of the other two
  kinds are always comments with the same marker.
- **Finding items again.** gov searches one repository by label, by a marker in the item's text, and by
  open or closed. It does not search all of GitHub.
- **Closing a project.** When the work moves somewhere else, gov first writes where it went into the project's
  description, then closes it. If gov cannot write the description, the project stays open and gov says why.

Adding an item to a project it is already on succeeds and changes nothing. Removing an item that is not on the
project fails, so a caller never takes "nothing happened" for "done".

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
| **project** | a unit of work: a board plus a workspace (build specification §1) |
| **proposal** | an unmerged change to knowledge or policy; it has no authority yet |
| **rule row** | the machine-readable form of one rule: expectation, actor, level, cue, checks, history |
| **rule map** | the generated list of every rule in force and what enforces it |
| **section owner** | the role that approves changes to one section of a policy |
| **VCS · PMS** | version control system (GitHub) · project management system (GitHub Projects) |

For every command, flag and exit code, see [`gov-command-reference.md`](common/reference/gov-command-reference.md), which is
generated from the CLI itself. For how the governance repository is operated, see
[`org_gov_repo_operations.md`](common/reference/org_gov_repo_operations.md).
