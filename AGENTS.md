# AGENTS.md — working in this repository

This repo builds the Governed Agentic Development Framework: the **gov-work CLI**
(`publish/actions/ts`) and the **content** it ships to adopters (`publish/content`).
(This file is for agents *contributing to this repo*; the adopter-facing agent
protocol lives in `publish/content/`.)

## Adding tests or checks — drop-in, never touch CI/branch protection

Two required checks gate `main`, and both discover new cases automatically. Pick by
dependency and drop a file in:

- **Assertable with fakes/stubs** — logic, a command × flag × error, a content rule
  → add a **`publish/actions/ts/test/**/*.test.ts`** file (mocha globs it → `gov-work`).
- **Local CLI behavior, no real GitHub** — flags, `setup`, resolution, `--gov-home`,
  `validate` → drop a **`publish/actions/ts/e2e/smoke.d/NN-name.sh`** fragment
  (the runner sources them → `adopter-smoke`).
- **Needs real GitHub state** — a new lifecycle step → add to
  **`publish/actions/ts/e2e/adopter-journey.sh`** (the gated live tier).

Do **not** edit CI workflows or branch protection to add a test *case* — the checks
are fixed commands. Every bug you fix should land the cheapest guard that catches it.

Full guides: **[CONTRIBUTING.md](CONTRIBUTING.md)** ·
**[`publish/actions/ts/test/README.md`](publish/actions/ts/test/README.md)**.
