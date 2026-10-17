# Changelog

Versions of `@svayam-opensource/gov`, the governance client.

This file starts at 1.0.0 and is **reconstructed from release commits and npm publish dates**
(#235). Everything before it was published by hand with no tag, no release and no changelog, so the
entries below say what the release commit said and no more — they are not a retrospective audit of
each diff. From here on, entries are written at release time — a release being `gov-work-<semver>`,
cut by gov (see Releasing in `docs/CONTRIBUTING.md`).

The format is loosely [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are
[semver](https://semver.org/spec/v2.0.0.html).

## Unreleased

## 2.0.0-next.2 — pre-release (dist-tag `next`; `latest` stays 1.2.3)

2.0.0-next.1 reached the internal uat registry only and was never published to npmjs; next.2 is the
first public 2.0 pre-release and carries everything below, including the org runner choice (`ci.runs_on`).

The first 2.0 pre-release: everything PRJ-121 built. Install it only on purpose
(`npm i -g @svayam-opensource/gov@next`). 2.0.0 itself ships when the vision checklist is complete.

**Breaking**
- **Phase layout.** `framework/` and `policies/` split into `common/` · `build/` · `active/` · `reference/` ·
  `rules/`; org rules move to `policies/rules/`. Orgs on the 1.x layout are moved by `gov upgrade --pr` through
  the bridge pre-release; 2.0.0 itself carries no legacy-layout code.
- Setup no longer seeds knowledge-publication, knowledge-organization-standard, compliance-review, the
  knowledge-harvest procedure or the project `compliance.md`; the `knowledge_publication` setting is retired. How an
  organization publishes, organizes and harvests knowledge is its own policy.
- People have one way in: `install.sh` (macOS/Linux) or `winget install Svayam.Gov` (Windows), then the first-run
  flow. `gov setup` remains for automation. Deploy and promote are `gov-cicd` verbs.

**Governance**
- Plain-English policy → rule rows (`GOV-FRM-…`, `GOV-<org>-…`) proposed by an interview, approved by section
  owners; checks run free (the engine stays MIT). A parent policy is a floor: a part that loosens it is asked about.
- Paid evidence (separate, closed `@svayam/gov-check`): a signed, hash-chained ledger kept in the org's own gov repo,
  SOC 2 CC8 and RBI change-management reports; only licence/lease traffic and usage counts reach Svayam.

**The AI-SDLC lifecycle**
- `gov intent` (from issues, by owner interview) → spec → plan → build; releases per unit; `gov autorun` drafts
  each stage and stops at every human gate. `gov project`, `gov issue`, and `gov signal`
  (ask · depends · handover · merge · notice) between projects.
- Rule guidance reaches agents as native skills; new code sits behind vendor-neutral ports
  (VCS, CI identity, work tracker).

**Adopters**
- Native Windows: spawning through PATH×PATHEXT, a per-user MSI (unsigned until a production certificate exists).
- `gov work` lists agents only when the org approves more than one, defaulting to last time's agent on the project.
- gov's GitHub workflows run on the organization's runner: `ci.runs_on` in `policies/governance.yaml` (one label, or a
  list such as `[self-hosted, linux]`) goes into every job of `gov-checks.yml`, the approver check, and a newly
  installed `gov-validate.yml`. While it is set, `gov upgrade` and `gov check install` also keep the org's existing
  `gov-validate.yml` on it, changing only its `runs-on:` lines and naming each one. Unset, they ask for
  `ubuntu-latest` as before and never touch the org's copy. On a runner without `git` or the GitHub CLI, `gov check run`
  fails under any posture and names the missing tool. Before, each GitHub read failed in turn, and under soft posture
  the check went green having done nothing. An organization whose CI runs only on
  self-hosted runners (an Actions spending limit of $0) needs it, or its checks wait for a runner that never comes.
- Many first-run fixes (#191–#224): failed seeds keep the workspace, wrong answers are asked again, forks, reopened
  projects, verified vendor installers, a stale mirror is never used (#180).

**Reliability**
- `gov merge` ignores gov's own regenerated agent files; board status is really set (#225); org check actions run
  (bash/python locally and in CI, GitHub Actions in CI from the default branch); a rule-row JSON Schema.
- gov requires `@svayam-opensource/svm-util-log ^1.1.1`, whose `moment ^2.31.0` floor removes
  GHSA-4p3w-j4w9-5jqw (moment path traversal) from every install. node-ci fails on any moderate-or-worse
  advisory in production dependencies, for the lockfile and for the packed gov installed fresh.

## 1.2.3 — 2026-09-17

- The install instructions fetch `install.sh` to a file, then run it. Piped into `bash`, a failed
  download exits 0 and installs nothing without saying so (#240).
- One path to a published version: gov (`gov deploy` / `gov promote`). The tag-triggered GitHub
  Actions publish added for #235 is removed; releases are gov's `gov-work-<semver>` tags (#243).
- `install.sh` verifies the Node archive it downloads against nodejs.org's `SHASUMS256.txt`, and
  refuses rather than warning on a mismatch (#205).
- An install site serving `install.sh` and `install.ps1` from a named host, per environment (#231).
- `gov seed <url> --clean` reverses what a failed seed left behind, judging each artifact on its own
  evidence and refusing to destroy uncommitted work (#230).
- `gov close` reads the base branch recorded on the project's anchor issue instead of assuming
  `defaultCodeBranch`, so a hotfix cut from a higher env branch reaches it.
- POL-423 and POL-427 are defined in the shipped policy; the C01 digest every agent carries no
  longer cites clauses with no home in an adopter's repo.

## 1.2.2 — 2026-08-27

- `resolve-gov` gains a REPORT operation class and makes it the default, restoring behaviour that
  making PROJECT the default had broken: `gov doctor` and the context banner describe wherever you
  actually are, including from outside any project, and answer rather than refuse.
- Corrects a version drift nobody was comparing — `package-lock.json` had been stale by three minor
  versions (1.0.0 against a package at 1.2.1). Two records of one fact, never compared.

## 1.2.1 — 2026-08-13

- A clearer first prompt, and expected errors no longer printed as noise.

## 1.2.0 — 2026-08-13

- One-command adoption that actually works.

## 1.1.1 — 2026-08-13

- Registers the workspace that `gov setup` creates — previously setup made a workspace the client
  could not then resolve.

## 1.1.0 — 2026-08-12

- `gov setup <org>/<repo>`, removing the clone-first step.
- The registry moves to `~/.gov`.

## 1.0.2 — 2026-08-11

- The adoption path works on a clean machine.

## 1.0.1 — never published

A release commit exists for 1.0.1 (a board-pagination fix) but **the version is absent from npm**,
so no adopter ever received it. Recorded rather than omitted: a gap in a published version sequence
is the kind of thing that looks like a mistake in this file years later, and it is not.

## 1.0.0 — 2026-08-09

- First release of the TypeScript client, succeeding the bash `@svayam-opensource/prj` (frozen at
  0.11.0 and since deprecated).
