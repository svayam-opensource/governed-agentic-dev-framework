---
domain: governance
layer: use-case
owner: policy-owner
compliance: C02
status: current
---
# Closing a project

Closing is the only step that offers a project's knowledge back to the organization, so it is the one worth
slowing down for. Cancelling is here too. It is a different act, and the difference matters.

## Closing the project

When the project's work is done, run `gov close` from the project's workspace:

```bash
gov close
```

Before it changes anything, `gov close` checks one thing the framework itself needs:
`projects/<id>/knowledge/` must exist, because close proposes that folder to the organization. What is in it,
and how well it is curated, is your organization's decision, not the framework's. If your organization wants a
harvest step at close (a manifest, a checklist, a reviewer), it writes that into its own policy, and
`gov rules propose` turns it into a check that runs on `gov close`. The framework ships no harvest step of its
own and requires no `knowledge-close.md`.

Then `gov close` does two jobs, with different authority:

| Target | What happens | Why |
|---|---|---|
| each **code** repository | the project branch is merged back into the branch it was cut from and pushed, tagged `archive/<branch>`, and deleted | gov is finishing work gov started; there is nothing to review |
| the **governance** repository | a pull request is opened for the project's knowledge, and **left open** | it proposes organization-wide knowledge, which only someone with the authority can merge |

The project's GitHub board closes on the first run. A completed project stays completed whether its knowledge
pull request is merged, rejected or abandoned. CODEOWNERS assigns the reviewers.

The governance branch is not archived on that first run, because it is the head of the open pull request. After
the request is merged, run `gov close` again and gov tags and deletes the branch. While the request is still open,
a second run says so and changes nothing. **gov never merges that pull request itself.**

## Cancelling

```bash
gov cancel
```

Run it from the project's workspace. It labels the project's anchor issue and closes the board. **Nothing is
merged**, no knowledge pull request is opened, and the branches and clones are left exactly where they are.

## Reopening

If a closed project's board is opened again on GitHub, carry on with the usual commands. Closing deleted each
code repo's project branch. The first `gov sync` or `gov task` makes the missing branch again from the base
branch and prints `recreated '<branch>' in <repo> off origin/<base>`. `gov add-repo` reuses a worktree that is
already on disk. Work merged at close stays merged, and nothing is restored from the `archive/` tags.
