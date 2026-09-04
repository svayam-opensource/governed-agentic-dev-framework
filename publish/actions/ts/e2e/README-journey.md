# The interactive journey — how a walk gets automated

## Why this tier exists

Between #197 and #209, twelve defects reached a container walk. Every one of them shipped
past a green suite:

```
893 unit tests            inject the IO — never spawn, never type
adopter-smoke (hermetic)  drives the real binary — never types
bootstrap matrix          installs on five OSes — never types
```

The common gap has one name: **nothing ever answered a prompt.** A test that cannot answer
a question cannot reach the code behind it, and every one of those twelve lived behind one —
the role question, the organization's name, the approved-agent list, "Install IBM Bob now?",
the closing offer, a context gate.

This tier types. It runs gov in a **real pty**, answers as an adopter would, and asserts on
the transcript an adopter would have read.

## Running it

```bash
npm run test:journey              # every scenario
npm run test:journey 50           # the ones whose filename matches
```

Needs `expect` (`dnf install expect` · `apt-get install expect` · preinstalled on macOS).
No token, no network, no side effects, no Docker.

## What a scenario looks like

`journey.d/NN-name.sh`. It gets a clean world and these helpers:

| | |
|---|---|
| `drive "$(conv <<'C' … C)" gov …` | run in a pty, answering the conversation |
| `saw` / `never` | a phrase was / was not on screen |
| `says` / `never_says` | the same, tolerant of where the terminal wrapped |
| `painted` / `unpainted` | it arrived coloured / deliberately plain (#204) |
| `ran` / `not_ran` | the agent double was invoked, with which argv (#199/#207) |
| `gh_ran` / `gh_never` | gov did / did not ask GitHub for something (#201) |
| `exists` | the machine is left holding it (#209) |
| `give_agent` `make_gov_repo` `approve_agents` | build the world the scenario needs |

A conversation is four directives: `>` wait for, `<` type, `!` must never appear,
`~` change the timeout.

## The doubles, and why each one is where it is

| double | why not the real thing |
|---|---|
| `stub/gh` | gov reaches GitHub through `gh` and nothing else, so this is the whole seam. Steered by `GH_STUB_*` — one variable per fact a scenario needs to state. |
| `stub/git` | rewrites `https://github.test/o/r` to a local fixture. A `file://` path would have been simpler and would have meant weakening `looksLikeRepoUrl`, the check that catches a typo before git's output does. Faking the HOST keeps gov's real validation. |
| `stub/agent-double` | #199, #207 and #209 are facts about the exec — which binary, which argv, which directory, reachable afterwards. A vendor CLI cannot assert those and needs an account to try. |
| shadowed agents | every agent gov knows about is made to fail, so "not installed" is true here whatever the developer has. The first run of this suite reported *"IBM Bob is already installed"* because `bob` was on the laptop. |

## Prove it catches what it claims

The suite is only worth its runtime if it fails when the fix is removed. Two mutations,
run on the day it was written:

| put back | journey | unit suite |
|---|---|---|
| `npm: "@bobsworkshop/cli"` on the ibm-bob variant (#201) | **3 failed** | 2 failed |
| `signsInItself` deleted (#208) | **2 failed** | passed |

The second is the point. #208 was invisible to 893 unit tests and is caught here in the
words an adopter reads.

**Do this for every scenario added.** A regression test nobody has seen fail is a claim,
not a check — the same finding as #188's unreachable validators.

## What this tier does NOT cover

- **Creating a repository from the template.** That is the live tier
  (`npm run test:adopter`), against a real throwaway org.
- **A private Node install and its PATH consequences (#209).** Needs a machine where gov's
  Node really is private — the OS matrix, not a developer's laptop.
- **A vendor agent's real argv (#207).** The doubles prove gov passes what the catalog says;
  only running the vendor proves the catalog is right. That is what `promptArgv` being absent
  admits, and what a walk is still for.
