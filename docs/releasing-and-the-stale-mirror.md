# Releasing gov: the mirror decides the stamp, and it goes stale

A release of `@svayam-opensource/gov` is stamped on the operator's machine and built in CI. Those are
two different reads of "the source", and when they disagree the build still passes.

## What happened on 1.2.2

`deploy --env dev` reported **ok** and published `1.2.2-dev.gb63b1c9`. The tarball was correct. The
`gov.contentSha` recorded in it was not — it described the tree at `9ab819d`, the commit *before* the
version bump, combined with the *new* semver from the catalog. A tree that never existed as a release.

Nothing failed until the next step:

```
gov-cut-release: no published version of @svayam-opensource/gov carries content_sha 8db0d9e1…
```

`content_sha = sha256({code, deps, semver, baseRef, packaging})`, where `code` is the git tree-sha of
`publish/actions/ts`. Recomputing both values from the identity module:

| content_sha | tree | semver |
|---|---|---|
| `ad81d480…` — what dev **published** | `9ab819d` (pre-bump) | 1.2.2 |
| `8db0d9e1…` — what the uat cut **wants** | `b63b1c9` (correct) | 1.2.2 |

The mirror on the laptop had not fetched the branches after they moved, so the recipe hashed yesterday's
tree while Jenkins cloned today's.

## Before you release

```sh
git -C <mirror> fetch origin
git -C <mirror> rev-parse --short origin/dev   # must equal what GitHub shows
```

If they differ, the recipe will stamp the wrong `content_sha` and you will not find out until the promote.

## Two other traps this release hit

**The branch order is `dev → uat → main`.** The version bump was raised against `main`, which inverted
it: `main` had 1.2.2 while `dev` — the branch the dev build clones — still had 1.2.1, and the version
gate correctly refused with *"package.json … != catalog …"*. That gate is doing its job; the mistake was
upstream of it.

**There are THREE copies of the version, not two.** `package.json`, the catalog's `semver:`, and
`package-lock.json` — which had been sitting at `1.0.0` while `package.json` said 1.2.1. `npm version`
writes both files; hand-editing `package.json` alone leaves the lock behind.

## Tracked

- `Svayamtech/910-GOV-CICD#221` — fetch the declared ref before hashing it, and make the job refuse when
  the commit it cloned differs from the one the recipe hashed. Two records of one fact, never compared.
- `#179` — `gov setup --help` runs the command.
- `#180` — `gov seed` pushed `main` without fetching first, which is the same staleness in a different verb.
  **Fixed (PRJ-121 intent 05, ruling Q3)** — see below.

## The same staleness in `gov seed` and `gov setup` (#180)

A mirror behind its remote is not only a release problem. `gov seed` cut the project branch from the gov home's
**local** default branch, with no fetch: a home nobody had pulled this week started the project on last week's
policy, and every agent on it was governed by rules the organization had already replaced. `gov setup` pushed the
default branch the same way, and a remote that had moved met a bare push that failed and a hint to run the same push
again.

What they do now:

| verb | before | now |
|---|---|---|
| `gov seed` | `worktree add -b <branch> <path> main` (the local mirror) | fetch `origin/<default>` first; cut from the **fetched sha**; local `main` untouched; cannot fetch → stop before any write |
| `gov setup` (first push) | `git push -u origin HEAD` | fetch; remote's default branch not an ancestor of HEAD → stop: "the remote moved — run `git pull --rebase`, then `gov setup` again"; never force |
| failed seed | the error, and the undos that failed | the error, then `created: …; rolled back: …; left behind: …` |

The rule is the one this page started with: **a value read from a mirror is a claim about the remote, and it is
only true right after a fetch.** Held by `test/lifecycle/seed-remote-moved.test.ts`, `test/setup/first-push.test.ts`
and the hermetic scenario `e2e/journey.d/49-seed-after-remote-moved.sh`.
