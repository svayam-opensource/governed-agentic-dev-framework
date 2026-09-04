# Journey scenarios — the backlog, from the code's own branches

Chosen by walking the decision points, not by listing features. A scenario earns its place
when it is a branch a real person can land on and a unit test cannot reach.

## First run — the ladder (`bootstrap.ts nextStep`)
| | scenario | the branch it pins |
|---|---|---|
| 10 | no terminal, nothing registered | `blocked` — names the verb rather than hanging |
| 11 | several orgs registered, none active | `choose` — by number AND by name; a bad answer selects nothing |
| 12 | one org, none active | that one IS the answer, no question asked |
| 14 | answer `C`, then `B` | "not sure" is an answer, not a refusal; it explains and asks again |
| 15 | an unrecognised answer, five times | stops with a reason rather than spinning (#192) |

## The adopter's questions (`foundNewOrg`)
| | scenario | |
|---|---|---|
| 16 | types `org/repo` into the organization question | explained, asked again — not ended (#192) |
| 18 | Enter at the organization question | stops cleanly, names `gov setup <org>/<repo>` |
| 30 | founds an org, IBM Bob as default | **the path no walk has ever completed** |
| 31 | founds, declines the starter project | adoption still completes; nothing claims otherwise |

## Preflight — the refusals that protect an org (`create.ts`)
| | scenario | |
|---|---|---|
| 20 | not signed in | names `gh auth login` |
| 22 | the governance probe cannot run | **REFUSES** — failing open here created a duplicate governance repo on the first real adoption |
| 24 | the org has TWO governance repos | lists them, asks which; never picks the first |
| 26 | `gov_home` exists from a failed run | archives it, adopts the remote only if provably ours (#159 finding 2) — the retry case |

## Joiner
| | scenario | |
|---|---|---|
| 42 | a typo'd clone URL | refused before anything is cloned |
| 44 | `gov_home` already exists | "register it instead: `gov org add`" — never overwritten |
| 46 | clones a repo with no `org-config.yaml` | that is a FOUNDING; the run must end as ADOPTER (#197) |

## Agents
| | scenario | |
|---|---|---|
| 62 | org default not installed | offered → installed → started (the joiner's ordinary case, #196) |
| 64 | nothing installed, no org default | the list, then a shell **called a shell** |
| 66 | installs but will not run | "not ready yet", no launch, no `✓ ready` (#200/#202) |
| 68 | launch argv | claude gets the prompt; bob launches bare and the prompt is printed to paste (#207) |

## Work flow
| | scenario | |
|---|---|---|
| 70 | pick a project the menu shows `(active)` | **JOIN**, with the board URL (#198 + #206) |
| 72 | pick a `(not started)` board | SEED |
| 74 | `--project` with no `--seed`, no terminal | refuses, names the flag |

## The output contract (#204)
| | scenario | |
|---|---|---|
| 80 | `NO_COLOR=1` | every mark still present, not one escape code |
| 82 | stdout piped, stderr a tty | the prompts still colour; the report does not |
| 84 | the doctor itinerary | headings painted, **commands never** |

## OS tier — needs a real machine, not a double
| | scenario | |
|---|---|---|
| 90 | bare: no node, no git, no gh | `install.sh` does it all; `gov --version` in a NEW login shell |
| 92 | interrupted install, re-run | resumes; re-running is boring |
| 94 | an installed agent, after gov exits | `bob --version` works (#209 — only reproducible where gov's Node is private) |
