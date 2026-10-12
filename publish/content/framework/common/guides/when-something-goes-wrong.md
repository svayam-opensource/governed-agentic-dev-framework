---
domain: governance
layer: guide
owner: framework
compliance: C03
status: current
---

# When something goes wrong

Hand-written, and deliberately so: the command reference is generated from the CLI's own specs, and none of
what follows can be derived from a spec. It is what people actually hit.

> **Rescued, 2026-09-28.** These notes lived at the bottom of the command reference (`gov-command-reference.md`) until that
> page became generated output. Regenerating it would have deleted them with no trace, which is a good argument
> for keeping hand-written help in a hand-written file. Two entries were stale and are corrected below.

---

## `gov close` refuses

**"Pre-close conditions not met."** The framework asks for one thing: the project's `knowledge/` directory must
exist, because close promotes that directory and proposing a directory that is not there produces a broken pull
request. Whether it is *full* is not gov's business.

**"Blocked by N policy checks on `gov close`."** This is **your organization's** rule, not the framework's, and
the message names the clause, the document, the section, and the file to create. Read the clause:
`gov knowledge show <the document it named>`. If you disagree with the rule, that is a policy conversation — the
gate is doing what your organization asked.

*(Corrected: this entry used to say close failed when "required project knowledge is missing" and to read the
validator output. Since 2026-09-27 the framework requires no particular knowledge file; curation requirements
come from your own policy, and the message says which clause asked.)*

## `gov merge` or `gov sync` says "Uncommitted changes"

**"Uncommitted changes in `<folder>`: `<files>` — commit or stash first."** Something in that repository has not
been committed, and merging over it could lose it, so nothing was changed. The message names up to five of the
files (`+N more` for the rest); `git -C <folder> status` lists them all. Commit them on your branch (or stash
them), then re-run.

The agent instruction files gov itself writes into every clone — `AGENTS.md`, `CLAUDE.md`,
`.cursor/rules/agent.mdc` and the rest of the agent harness — never cause this refusal, whether new or changed:
gov can write them again from the governance repo. They still show in `git status`, and committing them with
your project work is still the right thing to do.

## `board: Status not set — <why>` after `gov task` or `gov merge`

The task or merge itself worked — the branches are made or landed, the issue assigned or closed. Only the issue's
**Status** on the project board did not move, and the line says why:

| `<why>` | What it means | What to do |
|---|---|---|
| `no-field` | The board has no single-select field named **Status**. | Add one (GitHub's default board has it), or set Status by hand. |
| `no-option` | Status has no option with that name. gov sets *In progress* on task and *Done* on merge, ignoring case; the line lists the options there are. | Add or rename the option on the board. |
| `not-on-board` | The issue is not an item of this project's board — or GitHub could not resolve the issue at all. | Add the issue to the board; check the URL. |
| `denied` | Your token may not read or write the board (or the issue's repository). | `gh auth refresh -s project`; ask an owner for write access to the board. |
| `unreachable` | Anything else: GitHub did not answer, answered something unexpected, or this command had no board connection. | Re-run later; set the Status by hand meanwhile. |

`board: not closed — <why>` after `gov close` or `gov cancel` is the same report for closing the board itself
(`denied` or `unreachable`): the project's branches are done, but it reads as active until the board is closed —
close it on GitHub, or fix the token and re-run.

## "Branch already exists" during `gov seed`

Somebody created a branch matching `BRNCH-<board#>-<slug>` by hand, or a previous seed half-completed. Look at
the branch, decide whether it holds anything (`git log <branch> --oneline -5`), delete it if not, and re-run.
Seed does not adopt an existing branch silently, on purpose: a branch someone else made may carry their work.

## `gov add-repo` says "archived the previous attempt"

Something was already at the place the repo goes, `<project>/<repo>`, that was not one of gov's worktrees. That
is usually a clone made before gov used worktrees, or what a failed attempt left. gov moved it to
`<project>/archive/<time>/<repo>`, did not delete it, and added the repo. Look inside the archived copy. Take
anything you want from it, then delete it yourself.

If the add fails partway, gov puts the archived copy back and removes the branch it had started. You can
re-run straight away; nothing is left to clean up.

## `gov sync` or `gov task` says "recreated '<branch>' … off origin/<base>"

The project was closed and then reopened. Closing deleted the code repos' project branches, but your worktrees
stayed on disk. gov made the missing branch again from the base branch, pushed it, and carried on. Nothing of
yours was changed. If a repo is not on disk at all, `gov add-repo <repo-url>` brings it back, and it reuses a
worktree that is already there.

## Reading a failed `gov seed`

A seed that fails part-way undoes what it did, and its last line says so:

```
push failed: BRNCH-7-alpha …

created: work root ~/.gov/ACME/projects/PRJ-7-alpha, worktree …/acme-gov; rolled back: worktree …/acme-gov, work root ~/.gov/ACME/projects/PRJ-7-alpha; left behind: nothing
```

- **created** — every step this run took, in order.
- **rolled back** — the steps it undid, newest first.
- **left behind** — the steps it could **not** undo, each with the reason. `nothing` means the machine and the
  remote are as they were: fix the cause (the first line) and run the same command again. Anything listed here
  is real state — remove it, or run `gov seed <board-url> --clean`, which says what is safe to reverse.

**"could not fetch origin/main … nothing has been created."** Seed fetches the governance repo's default branch
first and cuts the project branch from what the remote holds **now**, so a project never starts on policy your
organization has already replaced. It could not reach the remote, so it stopped before creating anything. Check
your network and access, then re-run. Your local default branch is never moved by seed — only `origin/main`.

## `gov setup` says "the remote moved"

Before its first push, setup fetches. If someone pushed to the governance repository's default branch while setup
was running, setup stops instead of overwriting their work: your configuration is committed in the local clone and
nothing was pushed. Run `git pull --rebase` in that clone, then `gov setup` again. gov never force-pushes.

## The test-merge gate fails after a sync

The merge itself worked; a validator downstream of it did not. The output names the check and the file and line.
The fix belongs on your branch — re-run after fixing. A gate failing *after* a successful sync usually means the
default branch gained a rule your branch has not satisfied yet, which is the gate doing its job.

## The knowledge-close pull request has nothing in it

Expected, when nothing was written up. The branch and the pull request are still created so the project's state
can transition, and the pull request can be closed without merging. Nothing is lost.

*(Corrected: this entry used to attribute the empty PR to "no LLM/agent synthesis running". `gov close` performs
no synthesis — it proposes the project's own files, and if there are none to propose, there is nothing to review.
The clause that said so was corrected to match on 2026-09-23.)*

## Lost track of where you are

```bash
gov status          # this project: state, owners, board
gov list            # your active projects
gov doctor          # this machine: tools, auth, workspace, and what gov cannot verify
gov                 # the menu, which resolves the project for you
```

`gov doctor` is the one to reach for when a command's *context* looks wrong — it prints which workspace resolved
and why, which is usually the answer.

## You want to undo a close

**Don't.** Undoing a close means reverting merges in several repositories and re-creating archived branches; the
result is a repository state nobody can reason about afterwards. Seed a follow-up project instead. The closed
project stays closed and honest about what it did.

## The person working a project is no longer available

Someone leaves, falls ill or changes role, and their project has to go on. No exception is needed; this is
an access change, and it is made on GitHub, because the board is the project:

1. An owner runs `gov manage assign <new-person's-login>` from the project. That assigns the new person on the
   project's anchor issue, which is what gives them access. `gov manage unassign <login>` removes the person
   who left.
2. If the person who left held a role in `policies/common/authorized-representatives.md`, update that file in the
   same change, so that nobody is named as an approver who can no longer approve.
3. The new person runs `gov join <board-url | project-id>` to get the project on their machine, and starts a
   fresh session before doing any work, so their agent loads the current rules and the project's open
   to-dos.

## "Signed evidence is off" or "needs a subscription"

Both are notices, not errors. Your checks ran and enforced exactly as they always do.

- **"Signed evidence is off: gov-check is not installed here."** Your organization set `evidence: enabled` in
  `policies/governance.yaml`, but this machine or CI job does not have the paid module, `@svayam/gov-check`, so no
  signed evidence was written for this run. You see it once per place: on the CI run, under the session manifest
  and in `gov doctor`. To get evidence, your organization needs a subscription (the guide
  "Evidence and auditor reports" explains it). To stop the notice instead, remove the
  `evidence:` line or set it to `off`.
- **"needs a subscription — the binding was recorded, not run".** A rule binds a paid action (an LLM judge or a
  compliance pack's action) and no paid module runs here. The rule is not checked by that binding. It is not
  counted as a pass, and it does not block your change.

## An agent is behaving as though a rule does not exist

Two likely causes, in order:

1. **The rule never reached it.** A rule is in an agent's context only if it compiled to a resident cue. Check
   with `gov doctor`, which reports how many clauses are resident and how many are advisory.
2. **The session started before the rule landed.** A running session cannot be updated in place. Restart it —
   gov refuses mutating verbs while the rules on disk are newer than the session that loaded them, and says so.

If the rule is advisory, nothing enforces it. That is a property of the clause, not a fault of the agent.
`gov doctor` prints the breakdown — how many rules are prevented, detected, judged, cued, advisory or
cannot-tell — and `agent/harness/rule-map.md` says which class each one is in.

*(Corrected 2026-09-29: this used to point at the framework policy's §10.2, which described four enforcement
classes. The specification/policy split removed that section — a clause in the policy is now enforced by
construction — so the counts moved to `gov doctor` and the per-clause answer to the rule map.)*
