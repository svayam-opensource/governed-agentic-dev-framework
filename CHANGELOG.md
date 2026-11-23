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

- Who must approve a policy change is now one function, `requiredSectionOwners`, exported from `@svayam-opensource/gov/policy-pr` (F136, ruling D3 A+). Given the ownership rows, the roles, the changed files with their base texts, and the author, it returns each approver's handle and what they must approve, for example "`policies/org-policy.md` §4 (Data Owner)". It also returns notes for anything it could not work out, and says when only the author could approve. The section-owner-approval check (GOV-FRM-455) now decides with it and behaves exactly as before. A service that shows who must approve, such as gov web's practice record, calls the same function, so the page and the check cannot disagree. `parseOwnership` and `OWNERSHIP_PATH` are exported beside it.

- A pull request merged with a red gov check is recorded under hard posture too (F136, ruling Q43 A). Hard posture asks GitHub to make the checks required, but GitHub cannot protect a private repository on GitHub Free, so there a merge can still go ahead while a check is red. The push to the default branch now looks for such merges whatever the posture and opens the same violation record for the Policy Owner. Where the branch is protected nothing is found, because the checks were required. The record no longer says the merge happened under soft posture.

- A new governance repository has its checks from the first commit (F136, ruling Q42 C). `gov setup <org>/<repo>` now puts `.github/workflows/approver-check.yml` and `.github/workflows/gov-checks.yml` into the one commit it makes, on every plan and under either posture, so the first pull request shows a check waiting for someone else's approval. Under hard posture, setup then runs `gov repo protect apply`. Where GitHub cannot protect the repository (a private repository on GitHub Free), setup says so, gives the ways forward and carries on. Under soft posture nothing is protected. The landed-by-pr check (GOV-FRM-040) no longer flags that one setup commit: the commit with setup's subject whose only parent is the repository's first commit, in a governance repository. The practice task now says what actually stops the merge for the organization's posture and plan.

- First run makes the adopter a practice project, without asking (F136). The "Create it? [y/N]" starter project is gone. An adopter now gets **Make the policy ours**: a board, its anchor issue labelled `anchor` and `practice`, one task issue, and the project branch, made the way `gov project "<name>" --seed` makes any project. The task is to put the organization's name on the policy's title page (`policies/policy-document.yaml`: `title` and `approved_by`). It tells the agent to make the change with `gov rules propose`, and says ahead of time that the pull request waits for approval by someone other than its author, and that a person on their own must invite a teammate to approve it. A board left open from an earlier run is reused. People who join never get a practice project. `gov project` can now put extra labels on an anchor.

- The framework's rules read as a policy document (F127, 912-SVM-LIB-UI#213). Every framework rule in force now has a plain-English `statement` and a `chapter`, and `framework/policy-document.yaml` carries the eight chapter introductions and a glossary (Agent, Policy Owner, Check Owner, Mandatory (C01), Required (C02), Recommended (C03), Pull request, Exception and more). A test fails when a rule in force has no statement or chapter.

- `@svayam-opensource/gov/policy-pr`: the policy pull request writer as a library (F127, 912-SVM-LIB-UI#213), for a service that changes an organization's policy for a person. `applyPolicyEdit` writes one edit — add, revise, close (Stop), enforce-now, or annotate — into a branch: the statement into the policy's section, the rule rows, and then the version, snapshot, stamps and changelog the policy check demands. `judgePolicyPr` checks the result the way CI will. A new rule may now start on a later date: the policy check accepts it, and it is not in force until then.

- Rule rows carry the policy document's text (F127, 912-SVM-LIB-UI#213). A row may have a plain-English `statement` (what a board reader sees) and a `chapter` (1 to 8: Purpose, scope and authority · Roles and responsibilities · Development · Deployment and release · Operations and maintenance · Security and access · Evidence and audit · Exceptions and waivers); `rule-row.schema.yaml` and `gov rules check` both accept them. A policy pull request may fill either on an open row in place, as a patch, like a sha refresh. A row whose start date is later than today is open but not yet in force. New files: `framework/policy-document.yaml` (the framework's chapter titles, introductions and glossary, replaced by `gov upgrade`) and `policies/policy-document.yaml` (the organization's title page, introductions and glossary, seeded once and never rewritten).

- Set-up code and set-up trail (#391). `install.sh` and `install.ps1` pass `GOV_SETUP_CODE` and `GOV_SETUP_ISSUER` from gov web's Install page on to gov, and never print them. gov records each set-up step as done or pending in `~/.gov/setup-state.json` (owner-only), and re-running `gov` resumes at the first pending step. Once the client is installed, the governance repository is in place and the workspace folders are ready, gov sends the code to `<issuer>/ident/gov-setup/redeem`, once. It only sends to `https://*.svayamtech.com`. A refused code, a rate limit or a network error is reported in one line and never fails set-up. `gov doctor` shows the trail in a `set-up` row, never the code.

- `gov signal` survives a brief GitHub error (F68). Creating a signal issue, commenting and closing are retried up to 3 times (after ~2, 4 and 8 s) on 5xx, 429 or rate-limit and network errors. Before each retry, gov checks whether the earlier attempt went through, so nothing is made twice. A 4xx refusal is returned at once. If it still fails, gov says what was saved and prints the command to finish by hand.

- `gov check install` pins the gov it installs. With no `--gov-package` and no pin to keep, the workflow it writes now installs `@svayam-opensource/gov@<this gov>`, as `gov upgrade` does. Before, it was unpinned, so runners got npm `latest` (1.2.3) (#388).

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
