# AI-native software lifecycle

Part of org-policy.md; applies to build, deploy and run.

> **This file is yours.** gov created it once, for a new organization, and will never overwrite it. Edit it,
> replace it, or delete it. It is the one lifecycle gov follows: `gov intent` and `gov autorun` read the step
> sections below (their headings and their `Template:` lines) and nothing else. With no lifecycle here, they say
> so and do nothing. The templates it names are a library in `policies/reference/lifecycles/` — gov never turns
> a template into rules.
>
> Changing it is a normal policy change: edit, open a pull request, have it approved, merge.

## 1. Why we work this way

Agents draft; people decide. Every change we ship traces back to a business intent that a person approved, and
every step between the intent and the running system has a written artifact that a person reviewed. An agent
saves us the typing. It never saves us the deciding.

## 2. Roles

- **Business owner** — the person who wants the outcome. Answers the intent interview and approves the intent.
- **Project owner** — the person accountable for the project. Approves the spec and the plan.
- **Reviewer** — the code owner (CODEOWNERS) of what a change touches. Reviews and merges each change request.
- **Agent** — drafts every artifact and every change. An agent never approves anything, and never acts on a
  draft that no person approved.

## 3. Intent (phase: build)

Template: `policies/reference/lifecycles/ai-sdlc/intent.md`

- An intent is made from one or more board issues. Related issues may be grouped into one intent.
- The owner interview: the agent drafts the intent from the issues, then interviews the business owner one
  question at a time, each with a recommendation, asking only what the record does not already answer —
  outcome, who benefits, priority, success measure, what is in and out of scope, constraints and risks.
- The business owner approves the result. An intent written without the interview stays DRAFT.

## 4. Spec (phase: build)

Template: `policies/reference/lifecycles/ai-sdlc/spec.md`

The spec says what will be true and how it is designed. Its open questions are ruled one at a time, by the
person who approves the spec, before it is approved.

## 5. Plan (phase: build)

Template: `policies/reference/lifecycles/ai-sdlc/plan.md`

The plan lists the tasks (one board issue each), their order, a test plan and a documentation plan. Approving
the plan approves its task issues.

## 6. Build (phase: build)

Template: `policies/reference/lifecycles/ai-sdlc/build.md`

Each task is one change request to the project branch. A person reviews and merges it. When every task has
merged, the agent drafts `build.md` — what shipped, every deviation from the plan and who approved it, and the
tests that ran — and its approval marks the intent built.

## 7. Release and deploy (phase: deploy)

Template: `policies/reference/lifecycles/ai-sdlc/deploy.md`

One release moves one unit one version. Its `deploy.md` lists every intent it ships, and each of those intents'
`build.md` links forward to it.

## 8. Run (phase: run)

Template: `policies/reference/lifecycles/ai-sdlc/run.md`

Operators accept the release: `run.md` says what changed for them, how it is monitored, and what is known to be
wrong, and its hand-over is signed off.

## 9. Gates

A draft that no person approved is never acted on. Approval is an approving review on the artifact's change
request by the person named here, then the merge — never a line of text an agent could write.

| Gate | Step | Who approves |
|---|---|---|
| G1 | Intent | the business owner |
| G2 | Spec | the project owner |
| G3 | Plan (and so its task issues) | the project owner |
| G4 | Each build change request | the code owner (CODEOWNERS) of what it touches |
| G4b | `build.md` | the project owner |
| G5 | Deploy | as the release process requires |
| G6 | Run hand-over | the operators who will run it |

## 10. Changing this lifecycle

Replace this file by a policy change request. The templates in `policies/reference/` are a library: copy one,
adapt it, and point a step's `Template:` line at your copy.
