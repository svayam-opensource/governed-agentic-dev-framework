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

> **Rescued, 2026-09-28.** These notes lived at the bottom of `docs/specs/gov-command-reference.md` until that
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

## "Branch already exists" during `gov seed`

Somebody created a branch matching `BRNCH-<board#>-<slug>` by hand, or a previous seed half-completed. Look at
the branch, decide whether it holds anything (`git log <branch> --oneline -5`), delete it if not, and re-run.
Seed does not adopt an existing branch silently, on purpose: a branch someone else made may carry their work.

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
2. If the person who left held a role in `policies/authorized-representatives.md`, update that file in the
   same change, so that nobody is named as an approver who can no longer approve.
3. The new person runs `gov join <board-url | project-id>` to get the project on their machine, and starts a
   fresh session before doing any work, so their agent loads the current rules and the project's open
   to-dos.

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
