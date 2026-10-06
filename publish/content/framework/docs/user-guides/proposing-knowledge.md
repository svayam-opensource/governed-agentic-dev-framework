---
domain: governance
layer: use-case
owner: policy-owner
compliance: C02
status: current
---
# Proposing knowledge and exceptions

Changing org knowledge or policy when you are not in a project, asking for an exception, and where
repo-local knowledge belongs.

## Knowledge proposals (outside any project)

For policy updates, ad-hoc learnings, or initial bootstrap knowledge — anything that isn't tied to a specific project:

```bash
gov knowledge
```

Walks you through:
1. Choosing a slug (e.g., `auth-pattern-update`)
2. Creating branch `knowledge-<slug>`
3. Letting you edit `knowledge/` files manually
4. Optionally raising the PR with `--submit`

This is the right path for:
- Policy text updates (Policy Owner)
- Adding new guidance documents
- Capturing learnings that arose outside a project

**Changing a policy.** Edit the document that holds the rule: a file under `policies/` for your
organization's own rules, or `policies/authorized-representatives.md` for who holds which role. Never edit
anything under `framework/`: `gov upgrade` replaces it, so your edit would be lost without even a merge
conflict to warn you. Something the framework itself gets wrong is reported upstream instead. Run
`gov rules propose` so the rules that come out of your changed sections are in the same pull request as the
prose. The owner of every changed section approves it, and the change reaches active projects at their next
`gov sync` or `gov resume`.

---

## Exception process

An exception lets one piece of work depart from one of your organization's rules that allows exceptions, for
a stated time. Framework rules, and rules that admit no exception at all, cannot be excepted; gov refuses
an exception that names one. Get it approved **before** you do the work that depends on it.

1. Find the id of the rule you need excepted. `gov rules show <id>` prints a rule, and
   `agent/harness/rule-map.md` lists them all.
2. Copy the form for the right domain from `framework/templates/exceptions/<domain>/TEMPLATE.md` to
   `policies/exceptions/<domain>/YYYY-MM-DD-<short-name>.md`, on your project branch:
   - `legal/`: legal or regulatory constraints (Legal Owner approves)
   - `infrastructure/`: CI/CD, hosting, model providers (Infrastructure Owner)
   - `architecture/`: system or data architecture (the relevant Architecture Owner)
   - `policy/`: anything else (Policy Owner)

   `policies/authorized-representatives.md` names who holds each role. While a role is vacant, the Policy
   Owner approves in its place.
3. Fill in the fields at the top (`clause`, `scope`, `reason`, `expires`, `approved_by`; gov reads them, so keep
   their names) and the text below them: what you need to do, why, the risks and compensating controls, and
   the alternatives you considered. An exception always has an expiry date. One with no end is a policy
   change, and belongs in a policy pull request.
4. Commit it, and open a pull request to the default branch.
5. Wait for the approver to merge it. **Merging is the approval.** Do not do the excepted work until then:
   a "yes" in a meeting or in chat is not an exception.

Once merged, the exception is shown to agents working in its scope until it expires, and then it simply
stops applying. Rules that are a strong default need no exception: depart from them on purpose and record why
in `projects/<id>/knowledge/compliance.md`.

---

## Repo-local knowledge

Code repos under the framework have their own `knowledge/` folder:

- `knowledge/agent.md` — entry point pointing to layer priority and writes restrictions
- `knowledge/repo/structure.md` — directory layout, modules, packages
- `knowledge/repo/environment.md` — build tools, dependencies, setup
- `knowledge/repo/patterns.md` — coding conventions specific to this repo
- `knowledge/projects/<id>/` — per-project impact notes (changelog, decisions, impact-summary)

To onboard an existing code repo:

```bash
gov onboard
```

Run it only for a repository that has no `knowledge/` folder yet. It scaffolds the `knowledge/` structure and
raises a pull request in that repository. The repository's owner reviews and merges it, then fills in the
placeholder files (`structure.md`, `environment.md`, `patterns.md`) with what is actually true of the
repository.

---
