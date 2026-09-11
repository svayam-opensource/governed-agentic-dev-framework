---
domain: policies
layer: mandate
owner: policy-owner
compliance: C02
status: superseded
superseded_by: org-ai-agent-governance-policy.md
---

# MOVED — this file no longer governs

This policy is now at:

**[`org-ai-agent-governance-policy.md`](./org-ai-agent-governance-policy.md)**

## Why it moved

The old name — *agentic **development** policy* — read as though it applied only to development
work. It does not. It governs every agent session in this organization, whatever the work is:
reviewing a policy, answering a question, running a deploy, editing a document. The name was
narrowing a scope that was never narrow.

## Why this stub exists rather than nothing

`gov upgrade` seeds content from the framework and **adds** files; it does not delete what an
earlier version put in your repo. So an adopter upgrading across this rename would end up with
both names present — the new one governing, the old one stale, and no way to tell which from a
directory listing.

Two policy files that disagree is worse than one that is out of date, because the reader picks
the wrong one silently. This stub makes the answer unambiguous at the moment of looking.

**Safe to delete** once your organization has no links pointing here. Nothing in the framework
references it; it exists for the links in your own knowledge, PRs and issues.
