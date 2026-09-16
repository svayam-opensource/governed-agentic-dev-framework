# Changelog

Versions of `@svayam-opensource/gov`, the governance client.

This file starts at 1.0.0 and is **reconstructed from release commits and npm publish dates**
(#235). Everything before it was published by hand with no tag, no release and no changelog, so the
entries below say what the release commit said and no more — they are not a retrospective audit of
each diff. From the first tag onward, entries are written at release time.

The format is loosely [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are
[semver](https://semver.org/spec/v2.0.0.html).

## Unreleased

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
