# Compliance review — <ORG_NAME>'s cadence

**Document:** Compliance Review
**Policy Owner:** <POLICY_OWNER_EMAIL>
**Status:** seed — written once by `gov setup`, and **yours to change**

> ## This file is yours
>
> gov created it once and **will never overwrite it**. Quarterly is a starter: an organization that ships
> weekly may want monthly, and one with three repositories may want twice a year. Change the cadence, change
> who does the review, or delete a clause you do not want. That is the expected first act.
>
> The framework has no opinion on how often you look at your own compliance. It insists on one thing only: a
> violation of a rule that admits no exception is never left for a review to find (section 1.3).

---

## 1. The review

### 1.1 Cadence

The Policy Owner reviews the organization's compliance once every quarter. Skipping or delaying a review needs
an approved exception, so that a missed quarter is a decision somebody made rather than something that
drifted.

### 1.2 What the review answers

Every review answers three questions, and the summary records the answer to each:

- Was every violation of a no-exception rule raised since the last review surfaced to a person, and resolved?
- Does every deviation from a rule that needs an exception have an approved exception on file?
- Was every deviation from a strong-default rule recorded, with its reason, when it was taken?

### 1.3 A no-exception violation does not wait for the review

Anyone, person or agent, who finds a violation of a rule that admits no exception tells the Policy Owner
immediately. Never hold it for the next review, whatever this document says about cadence.

Agents need no separate reminder of this: the framework already tells every agent, on every turn, to stop and
tell a person when such a rule is broken. Saying it twice in an agent's context would weaken both.

## 2. What the review reads

### 2.1 A deviation is recorded when it is taken, not at the review

Each exception used and each deviation taken is recorded in the active project's `knowledge/compliance.md`
at the moment it happens, not reconstructed when the project closes. This always applies; recording them
later needs an approved exception.

If you want `gov close` to refuse a project that has no compliance record, say so here in plain words. The
rule that comes out of it can carry a check that runs when `gov close` runs and names the missing file in its
refusal. Start it as a warning: a hard close gate was removed from the framework on 2026-09-27 because it
blocked a developer who had worked a project by hand, and a seeded file should not quietly put it back. Make
it refuse once you want a project with no compliance record to be impossible to close.

### 2.2 Projects feed the organization's summary

The Policy Owner builds the organization's summary under `knowledge/compliance/` from the projects' own
compliance records, so the summary has a source other than memory. Building it any other way needs an
approved exception.

## 3. How to run a review

A suggested order. Adapt it freely; it is guidance, not a rule.

1. Read the last summary under `knowledge/compliance/`.
2. Collect the `compliance.md` of every project completed in the period.
3. Look for patterns: the same violation recurring, the same exception requested again and again, deviations
   clustering around one rule.
4. Decide whether a pattern points to a gap in a policy, or a gap in how it is enforced.
5. Write the period's summary to `knowledge/compliance/<year>-Q<n>-summary.md`.
6. Where a policy should change, propose the change as an ordinary policy pull request.
