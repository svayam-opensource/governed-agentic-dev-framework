---
id: EX-<short-name>
clause: GOV-<ORG_SLUG>-NNN
scope: PRJ-<board#>-<slug>
reason: <one line: what this exception permits>
expires: YYYY-MM-DD
approved_by: <GitHub handle of the person who will approve it>
requested_by: <your GitHub handle>
requested_on: YYYY-MM-DD
---

# Infrastructure exception: <short title>

<!-- HOW TO USE THIS FORM. Delete this comment once the form is filled in.

Copy this file to policies/exceptions/infrastructure/YYYY-MM-DD-<short-name>.md on your project branch, fill it in,
and open a pull request to <DEFAULT_BRANCH>. The exception is approved when the Infrastructure Owner merges that
pull request, and not before. Until then, do not do the thing it asks to permit.

Who holds that role is in policies/authorized-representatives.md. While nobody does, the Policy Owner
approves.

Typical uses: a model provider that is not yet fully authorized, a departure from a CI/CD requirement,
or an infrastructure configuration the policy does not allow.

gov reads the fields between the two --- lines, so keep their names exactly as they are:

  id           a short name people can cite in conversation, for example EX-redis-cache.
  clause       the id of the rule being excepted; `gov rules show <id>` prints a rule. Only your
               organization's rules that admit an exception can be excepted. gov refuses a framework rule,
               and a rule that admits no exception at all.
  scope        what the exception covers: a project id, repository names or paths, separated by commas.
               Left empty, it covers the whole organization. Say so in the text below if you mean that.
  reason       one line saying what it permits. Agents are shown this line while the exception is in force.
  expires      the date it lapses, as YYYY-MM-DD. Required. An exception with no end is a change to the
               policy itself, and belongs in a policy pull request instead.
  approved_by  the person who will approve it. The merge is what makes this true.

Everything below the front matter is for people. Write it so the approver can decide. -->

## What you need to do

<Describe exactly what you need to do that the rule does not allow.>

## Why

<The business or technical need that makes this exception necessary.>

## Risks, and how they are handled

<What could go wrong while the exception is in force, and what limits the damage. Name any compensating
controls: what you will do instead, so that the rule's purpose is still served.>

## Alternatives considered

<What else you looked at, and why it does not work here.>

## Approval

<Filled in by the approver, only if the approval carries conditions. The merged pull request is the
record of approval.>
