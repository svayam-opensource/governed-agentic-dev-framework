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

## 5. Then work like everyone else

- [Path — Developer](../../build/guides/path-developer.md)
