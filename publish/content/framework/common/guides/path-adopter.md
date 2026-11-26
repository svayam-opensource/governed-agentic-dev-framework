---
domain: governance
layer: path
owner: policy-owner
compliance: C02
status: current
---

# Path — Adopter

You are bringing this framework into an organization for the first time. Nobody here has used
it yet, and the decisions you make in the next hour are the ones everyone else inherits.

**A journey document is a consultation order, links only — never content (Knowledge Organization Standard §5).** Follow it
in sequence; each destination is the single home of what it covers.

## 1. Get the tooling on your machine

Run install.sh, then the first-run flow (adopt / join / not sure) and choose adopt. On Windows, the installer
ends in the same first-run flow.

- [Setting up your machine](setting-up-your-machine.md)

## 2. Understand what you are about to commit the organization to

- [How the framework works](../../framework-specification.md) — workspace, project, knowledge layers, compliance levels
  (the glossary is at the end), and chapter 2, the roles you are about to name
- [The knowledge tree is yours](../../framework-specification.md#81-the-knowledge-tree-is-yours) —
  `knowledge/` ships empty and is yours to structure, and so is whether you publish it

## 3. Decide who approves what

Role holders live in `policies/common/authorized-representatives.md`; their GitHub handles live in `org-config.yaml`, and
`CODEOWNERS` is generated from both. The Policy Owner is required — everything else is added as
you create a domain and name its owner.

- [How the framework works, chapter 2: who decides](../../framework-specification.md#2-who-decides)

## 4. Decide which agents your organization allows

- [LLM governance](../../../policies/governance.yaml) — the approved list is a file, not a memory
- [Configuring agent harnesses](../../build/guides/configuring-agent-harnesses.md) — what each agent
  reads, and what gov places where

- [Evidence and auditor reports](evidence-and-auditor-reports.md) — with a subscription, `gov evidence enable` turns
  on the organization's signed evidence ledger (optional; every check runs without it)

## 5. Decide how work moves from intent to release

A new organization gets one starter lifecycle, once: `policies/active/ai-sdlc-lifecycle.md`, with its step
templates in `policies/reference/lifecycles/ai-sdlc/`. It is yours — change it, replace it, or delete it.

- [The AI-native software lifecycle](../../../policies/active/ai-sdlc-lifecycle.md) — who approves at each gate
- [How the framework works, §1.7: the lifecycle a project follows](../../../framework/build/build-specification.md#17-the-lifecycle-a-project-follows)

## 6. Make your first governed change

First-run setup made you a practice project, **Make the policy ours**. Its one task puts your organization's
name on the policy's title page, in `policies/policy-document.yaml`. Run `gov work`, pick the project, and let
your agent follow the task. The pull request it ends in shows a check waiting for someone other than you to
approve it — that is the framework working, not a fault. The title page is the Policy Owner's to approve, and
you are the Policy Owner and the author, so the check waits for the **Check Owner**. If you named a teammate when
setup asked who approves your own changes, they are the Check Owner, and nothing else is needed: ask them to
approve it. Under hard governance on a plan that allows branch protection, GitHub will not merge it until then.
Otherwise nothing technically stops a merge past the check, but the check stays red where everyone can see it, so
don't merge it yourself. If you named nobody, invite a teammate and name them Check Owner: their GitHub handle
goes in `check_owner.github` in [`policies/governance.yaml`](../../../policies/governance.yaml), in a pull request
of its own. Under soft governance that pull request, like the practice one, can merge only past a red check, and
the merge is recorded. There is no way to approve your own change.

- [How the framework works, chapter 7: how a change is approved and lands](../../framework-specification.md#7-how-a-change-is-approved-and-lands)

## 7. Then work like everyone else

- [Path — Developer](../../build/guides/path-developer.md)
