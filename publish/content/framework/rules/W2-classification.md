---
domain: policies
layer: spec
owner: policy-owner
compliance: C01
status: draft
---

# W2: classifying framework-policy.md for the rule model (phase 1)

This is a working document for the Policy Owner's review. It is not published content and should be deleted once
W2's phase 2 has merged. It classifies every clause and paragraph of
`framework/policies/framework-policy.md` (as of a512e2f) into the four groups ruled on in
`rule-model-design.md` Q20, plus DROP. **Nothing is written to the rule rows, the new spec or the org
policies until you approve this classification.**

Key: **SPEC** = `framework/docs/specs/framework-specification.md` · **FRM** = `framework/rules/rules.yaml` ·
**ORG:x** = seeded `policies/x`. Actor `everyone` = {agent, human}. Levels are proposed from intent (Q10).
`[machine-only]` = text a human reader does not need; it survives only as a field in a rule row (usually the
cue). ❓ = I need your ruling.

## 1. Counts

| Group | Rows (incl. cue rows) | Rules proposed |
|---|---|---|
| SPEC-DESC (spec prose, no rule) | 29 | 0 |
| SPEC-PROMISE (spec + GOV-FRM rule, actor gov-client, tested) | 12 | 15 |
| MECHANICS (spec + GOV-FRM rule, fixed) | 29 | 15 |
| AGENT-CONTRACT (GOV-FRM rule, fixed) | 48 | 23 |
| ORG-HUMAN (seeded org policy) | 3 | 2 |
| ORG-DATA (seeded org policy) | 10 | 5 |
| DROP | 16 | 0 |
| **Total** | **147** | **60** (53 GOV-FRM, 7 GOV-SVM) |

A row with two groups ("A + B") is counted under the first; its rules are counted under each. Rows exceed rules because list items and pronoun clauses fold into their parent rule (Q21). Of the 147 rows,
**17 are flagged `[machine-only]`**: 15 cue blocks, which are counted under the group of the rule they cue, plus
the §1.3 notation table and Appendix C.
Of the 60 rules, **23 receive fresh ids** (GOV-FRM-444 … GOV-FRM-465 and GOV-SVM-466) because they are new
promises, or lettered or split clauses. The other 37 keep their old number.
The current maximum allocated number is POL-443. POL-900 and POL-999 are test fixtures only. One counter runs
across both namespaces, so that `pol-aliases.yaml` never maps one fresh number two ways.

## 2. Contradictions and false statements found

Each was verified in `publish/actions/ts/src` or the named documents, at a512e2f.

1. **§10.1 POL-145c says a relaxing clause "is refused at compile time".** No code does this. There is no
   relax, laxer or stricter logic anywhere in `src/rules/`.
2. **§2.1 POL-011 says "a C01 rule admits no exception".** `rules/exceptions.ts` compiles an exception for
   *any* cited clause into the resident block, C01 included. It never looks at the level.
3. **§11.4 POL-158a is classed `implemented` in rule-map.md.** `exceptions.ts` accepts an exception against a
   framework clause just as it accepts one against an org clause. Nothing refuses it.
4. **§11.2 POL-156 requires six things in an exception.** gov requires three: `clause`, `expires` and
   `approved_by`. Business reason, scope and compensating controls go unchecked. The clause regex accepts only
   `POL-\d{3}`, so W3 must change it.
5. **§6.5 says "gov checks board access when it launches a session".** That is only partly true:
   - `cli/work-flow.ts:931-943` skips the check for a project opened from the local list.
   - The picker's `canWriteBoard` (`cli/main.ts:1486`) **fails open**: it tests `!== "false"`, so an errored
     probe authorizes.
   - The lifecycle `authorize` (`main.ts:2664`) fails closed: it tests `=== "true"`.
6. **The preferences path is stated four ways:**
   - framework-policy POL-080: `$AGENT_WORK_ROOT/<org>/projects/preferences/<gh-login>/`
   - the code (`state-paths.ts:28`): `<agent_work_root>/preferences/<login>/`
   - gov-behaviour §5: preferences is a *sibling* of the work root
   - concepts.md, and this workspace's session-protocol: `$AGENT_WORK_ROOT/preferences/<login>.md`, a file
7. **§3.1 says "the framework defines exactly one role".** That became false with the P1 Check Owner ruling.
   concepts.md "Roles" also gets two things wrong:
   - It lists five fixed roles, which is the `codeowners.ts` defect already noted in P1.
   - It says the Policy Owner approves changes to `framework/policies/`, which nobody may edit.
8. **concepts.md "Compliance levels" makes two false claims:**
   - "C01 — gov-work refuses to proceed": gov does not detect C01 violations in general.
   - "[C01] exceptions require Policy Owner approval via PR": this contradicts POL-011 and POL-015.
9. **POL-172 and POL-086b contradict each other.**
   - POL-172: an agent MUST NOT write to `knowledge/` or `policies/` during a project.
   - POL-086b: project work "may touch any path, including `knowledge/` and `policies/`", as proposals.
   - session-protocol.md §4 sides with POL-172. ❓ Q3.
10. **POL-076's level is stated two ways.** Its modal (MUST) makes it C01 in rule-map.md, but its cue header
    says `C02`.
11. **POL-113 says "in order", but the orders disagree.**
    - POL-113 orders the steps: org-config → authorization → active → layers → pull → manifest.
    - Its cue, and session-protocol.md, load the layers *before* verifying.
    - POL-117 (pull the project branch) is absent from session-protocol.md.
12. **Two numbers are reused in the org policies.**
    - org `knowledge-organization-standard.md` restates POL-402 under the same number. That breaks the
      one-fact-one-document rule.
    - It also uses POL-414 for a *different* clause (Mermaid only, in `knowledge/`). rule-map.md lists POL-414
      twice.
13. **Some pointers cite numbers that do not exist in their targets.**
    - §3.2 cites POL-026, 027, 029–032 and 035–040 "in `authorized-representatives.md`". That file holds only
      POL-250–254.
    - §10.4 cites POL-151 "in `compliance-review.md`", which holds only POL-260–264.
14. **POL-432 is classed `implemented`, with actor `gov`, in rule-map.md.** §9.3 itself says gov cannot reach a
    spawned session.
15. **POL-427 is anchored to the wrong text.** Its number sits on the closing "third route" paragraph. The rule
    itself ("Restricted data MUST NEVER be written to a log") carries no number, and rule-map.md shows it
    as "—".
16. **The §5.5 cue states obligations no clause states:** never push to the default branch, and never
    force-push a shared branch. ❓ Q10.
17. **The banner's "51 rules — 23 cued, 2 implemented, 26 advisory" is a hand-copied count.** That is
    exactly what one-fact-one-document forbids.
18. **The seeded org files cite retired framework numbers:** POL-033, 079, 082, 089, 101, 104, 107/108 and
    301. That is for W3 to alias or rewrite.
19. **POL-022–024 read as permissions in plain English but mean obligations.** They say "MAY be deliberate",
    "MAY be recorded" and "MAY be honoured". This comes from the notation, and Q10 removes it.

## 3. Proposed outline of framework-specification.md (user-guide chapters)

Per your guidance, it is written for a person learning how the process works. The GOV ids, actors, levels and
checks live in the rows and do not appear in the prose. Each chapter ends with a single line pointing at the
rule-map filter for that chapter.

| Ch | Title | Draws on |
|---|---|---|
| 1 | **What this is, and what is yours** — framework vs your `policies/`; never edit this; upgrades; structure-only use | Owner's opening edit, §1, §10.1, gov-behaviour §1 |
| 2 | **Who decides** — the Policy Owner, the Check Owner, vacancies, where your other roles live | §3.1–3.2, concepts Roles, P1 rulings |
| 3 | **How strict a rule is** — C01 / C02 / C03 in plain words, what each lets you do | §2, concepts levels |
| 4 | **How a project starts** — the board, issued ids and branches, state on the board, who may work on it | §4, §5.6, §6, gov-behaviour §2–4, concepts Project |
| 5 | **Where you may write** — the workspace, the two repos, preferences, credentials, what never gets committed | §7.1–7.2, §7.4, gov-behaviour §5 |
| 6 | **What an agent does when a session starts** — the steps, the four knowledge layers, the manifest, spawned agents | §6.5, §7.3, §9.3–9.4, §9.7, gov-behaviour §8 |
| 7 | **How a change is approved and lands** — pull requests, the approval controls, the default branch as authority, proposals, close | §3.3, §5.5, §8.3, gov-behaviour §3 |
| 8 | **Writing knowledge down** — one fact one document, decide-and-record, diagrams as text, compliance.md | §8.1, §8.6, §9.5, §10.4 |
| 9 | **How your policy becomes rules** — rule rows, levels, tighten-never-relax, cues, checks, the rule map | §10.1, gov-behaviour §6, rule-model-design |
| 10 | **When something goes wrong** — the C01 stop, asking for an exception, what it must say, expiry, what cannot be excepted | §2.1–2.2, §9.6, §11 |
| 11 | **What holds when gov is not in the loop** — governance posture, GitHub Free, what gov can and cannot see | §3.4, gov-behaviour §7–8 |
| 12 | **What gov records** — the run log, redaction | gov-behaviour §10 |
| A | Glossary · command list (link to gov-command-reference.md) | §12 App. A, gov-behaviour §9 |

## 4. The classification

| POL | § | Gist | GROUP | Destination | GOV id | Actor | Level | Ch | Note |
|---|---|---|---|---|---|---|---|---|---|
| — | head | Document / Owned by / Applies / Version lines | SPEC-DESC | SPEC header | — | — | — | 1 | replaced by P3 header-table standard |
| — | banner | **Do not edit** (Owner's uncommitted edit): framework-published; never edit; upgrade may replace it; edits silently lost | SPEC-PROMISE | SPEC ch1 opening + FRM | GOV-FRM-444 | gov-client | C01 | 1 | opening carries the Owner's wording in plain prose; test: upgrade overwrites a modified framework file |
| — | banner | Org's governance lives in `policies/`, seeded once, never overwritten, yours to change | SPEC-PROMISE | SPEC ch1 + FRM | GOV-FRM-445 | gov-client | C01 | 1 | test: upgrade leaves a modified `policies/` file byte-identical |
| — | banner | Org MAY tighten, MUST NOT relax (§10.1) | MECHANICS | SPEC ch1, ch9 | → GOV-FRM-462 | — | — | 1 | merged with §10.1 rows; ❓ Q2 |
| — | banner | "What this document is not": history of the split, 51/23/2/26 counts | DROP | — | — | — | — | — | history, plus a hand-kept count (contradiction 17) |
| — | 1.1 | The framework's instrument; carries no org-specific values | SPEC-DESC | SPEC ch1 | — | — | — | 1 | |
| — | 1.1 | Goal: traceable, safe, compliant, recoverable; a rule that stops serving it is a defect | SPEC-DESC | SPEC ch1 | — | — | — | 1 | |
| — | 1.2 | Scope: all agentic work, every autonomy level, no agent exempt | SPEC-DESC | SPEC ch1 | — | — | — | 1 | "this policy" becomes "these rules" (Q20: the framework has no policy) |
| — | 1.2 | "One clause, because delegating work does not delegate accountability" | ORG-HUMAN | ORG:org-policy.md | — | — | — | — | lead-in moves with POL-006 |
| POL-006 | 1.2 | A human using an AI tool ensures its output complies | ORG-HUMAN | ORG:org-policy.md | GOV-SVM-006 | human | C01 | — | |
| — | 1.3 | Notation table: MUST = C01, MAY = C02, CAN = C03 | DROP | — | — | — | — | — | retired by Q10. `[machine-only]` |
| — | 1.3 | Lowercase "must" creates no rule; link to the compiler | DROP | — | — | — | — | — | retired by Q10 |
| — | 1.6 | Agent clauses apply only when agents are used; structure-only is fully supported; doctor shows the mode | SPEC-PROMISE | SPEC ch1 + FRM | GOV-FRM-446 | gov-client | C01 | 1 | becomes the meaning of actor `agent`: those rows sit idle under `authorized_agents: none` |
| — | 1.7 | Effective date = adoption, at the framework version | SPEC-DESC | SPEC ch1 | — | — | — | 1 | |
| — | 2 | Every rule has one of three levels, declared by its modal verb | SPEC-DESC | SPEC ch3 | — | — | — | 3 | "declared by modal" is dropped (Q10); level is a field the owner approves |
| POL-011 | 2.1 | A C01 rule admits no exception | MECHANICS | SPEC ch3 + FRM | GOV-FRM-011 | everyone | C01 | 3 | false today (contradiction 2); W6 could add a gov-client check that refuses a C01 exception |
| POL-012 | 2.1 | An agent detecting a C01 violation hard-stops all work | AGENT-CONTRACT | FRM | GOV-FRM-012 | agent | C01 | 10 | absorbs POL-013, 014 and 124 |
| POL-013 | 2.1 | "It MUST commit nothing" | AGENT-CONTRACT | FRM | → GOV-FRM-012 | — | — | 10 | pronoun clause, folded |
| POL-014 | 2.1 | "It MUST surface … and wait" | AGENT-CONTRACT | FRM | → GOV-FRM-012 | — | — | 10 | pronoun clause, folded |
| POL-015 | 2.1 | No role, the Policy Owner included, waives a C01 rule | ORG-HUMAN | ORG:org-policy.md | GOV-SVM-015 | everyone | C01 | — | ❓ Q4 |
| — | 2.1 | cue: "C01 MEANS STOP…" | AGENT-CONTRACT | FRM cue of 012 | — | — | — | — | `[machine-only]` |
| POL-016 | 2.2 | C02 applies always; deviation needs a merged exception first | MECHANICS | SPEC ch3 + FRM | GOV-FRM-016 | everyone | C01 | 3 | absorbs 017–019 |
| — | 2.2 | "A deviation MAY proceed only when all hold:" | MECHANICS | SPEC ch3 | → GOV-FRM-016 | — | — | 3 | lead-in |
| POL-017 | 2.2 | An exception file exists under `policies/exceptions/` | MECHANICS | — | → GOV-FRM-016 | — | — | 3 | list item, folded |
| POL-018 | 2.2 | Its PR is merged by the domain's authorized representative | MECHANICS | — | → GOV-FRM-016 | — | — | 3 | list item, folded; who approves is the org's |
| POL-019 | 2.2 | The approved PR is referenceable when the exception is used | MECHANICS | — | → GOV-FRM-016 | — | — | 3 | list item, folded |
| POL-020 | 2.2 | The agent blocks dependent work until the approved PR exists; no verbal approval | AGENT-CONTRACT | FRM | GOV-FRM-020 | agent | C01 | 10 | absorbs POL-155 (duplicate) |
| — | 2.2 | cue: "C02 MEANS NOT WITHOUT…" | AGENT-CONTRACT | FRM cue of 020 | — | — | — | — | `[machine-only]` |
| POL-021 | 2.3 | C03 is a strong default; adapt deliberately and record why | MECHANICS | SPEC ch3 + FRM | GOV-FRM-021 | everyone | C01 | 3 | absorbs 022–025; ❓ Q1 on level |
| — | 2.3 | Adapting C03 needs no exception PR | SPEC-DESC | SPEC ch3 | — | — | — | 3 | |
| POL-022 | 2.3 | Deviate deliberately, not casually | MECHANICS | — | → GOV-FRM-021 | — | — | 3 | folded (contradiction 19) |
| POL-023 | 2.3 | Record the reasoning at the time, in project knowledge | MECHANICS | — | → GOV-FRM-021 | — | — | 3 | folded |
| POL-024 | 2.3 | Honour the intent where the implementation is adapted | MECHANICS | — | → GOV-FRM-021 | — | — | 3 | folded |
| POL-025 | 2.3 | An agent ignoring C03 without a record violates policy | MECHANICS | — | → GOV-FRM-021 | — | — | 3 | restates 021 for agents; folded |
| — | 2.3 | cue: "C03 MEANS ADAPT AND SAY SO" | MECHANICS | FRM cue of 021 | — | — | — | — | `[machine-only]` |
| — | 3.1 | The framework defines exactly one role | SPEC-DESC | SPEC ch2 | — | — | — | 2 | now false: P1 added the Check Owner (contradiction 7) |
| POL-028 | 3.1 | Definition of the Policy Owner; held by `policy_owner_email` | SPEC-DESC | SPEC ch2 | — | — | — | 2 | a definition, with no action in it; number retired, aliased to spec ch2 |
| POL-033 | 3.1 | Every role has a current, named holder | MECHANICS | SPEC ch2 + FRM | GOV-FRM-033 | human | C01 | 2 | ❓ Q5 |
| POL-034 | 3.1 | A vacant role escalates to the Policy Owner | MECHANICS | SPEC ch2 + FRM | GOV-FRM-034 | human | C01 | 2 | P1 relies on this for the Check Owner |
| — | 3.2 | Callout: other roles are yours, in `authorized-representatives.md` | SPEC-DESC | SPEC ch2 | — | — | — | 2 | |
| POL-026 … 040 | 3.2 | Roles must be written down and named; cites POL-026, 027, 029–032, 035–040 | DROP | — | — | — | — | — | the cited numbers do not exist in the target (contradiction 13); "written down and named" is in GOV-FRM-033 |
| — | 3.3 | Enforcement at the VCS gate: four controls; `repo protect` installs them; doctor reports | SPEC-PROMISE | SPEC ch7 + FRM | GOV-FRM-447, GOV-FRM-448 | gov-client | C01 | 7 | two promises: install, and report |
| — | 3.3 | Why the 4th control: an approving review does not prove authorization | SPEC-DESC | SPEC ch7 | — | — | — | 7 | `templates/workflows/approver-check.yml` exists |
| — | 3.4 | GitHub Free private repo: protection answers 403; gov's gates do not bind a hand push | SPEC-PROMISE | SPEC ch11 + FRM | GOV-FRM-449 | gov-client | C01 | 11 | test: a 403 gives a non-zero exit that names the three ways out |
| POL-040d | 3.4 | Such an org chooses one of three ways out and records which | MECHANICS | SPEC ch11 + FRM | GOV-FRM-450 | human | C01 | 11 | ❓ Q6. Partly enforced: `repo protect apply` refuses until a posture is recorded |
| POL-083 | 3.4 | CODEOWNERS routes reviews and is not relied on to enforce | DROP | SPEC ch7 prose | — | — | — | 7 | a statement of fact, with no actor; it stays as spec prose |
| — | 4 | Pointer to the spec for ids and lifecycle | SPEC-DESC | SPEC ch4 | — | — | — | 4 | |
| POL-041 | 4.1 | All work happens inside an active project | AGENT-CONTRACT | SPEC ch4 + FRM | GOV-FRM-041 | everyone | C01 | 4 | gov verbs already refuse outside a project (partial check) |
| — | 4.3 | Why: the registry.yaml / project.yaml incident | SPEC-DESC | SPEC ch4 | — | — | — | 4 | |
| POL-044 | 4.3 | State is derived from the PMS, never stored in a file | AGENT-CONTRACT + SPEC-PROMISE | FRM | GOV-FRM-044 (agent), GOV-FRM-451 (gov) | agent; gov-client | C01 | 4 | split: the agent creates no state file; gov writes none |
| — | 4.3 | cue: "PROJECT AND TASK STATE LIVE IN THE BOARD…" | AGENT-CONTRACT | FRM cue of 044 | — | — | — | — | `[machine-only]` |
| — | 5 | Bound to GitHub; pointer to branching | SPEC-DESC | SPEC ch4 | — | — | — | 4 | |
| POL-040c | 5.5 | Every change lands by a PR approved per §3.3 | AGENT-CONTRACT | SPEC ch7 + FRM | GOV-FRM-452 | everyone | C01 | 7 | lettered, so it gets a fresh id |
| — | 5.5 | cue: "YOU DO NOT APPROVE YOUR OWN WORK… never push to default, never force-push" | AGENT-CONTRACT | FRM cue of 452 | — | — | — | — | `[machine-only]`; ❓ Q10 |
| — | 5.6 | Why: an agent-composed branch looks exactly like an issued one | SPEC-DESC | SPEC ch4 | — | — | — | 4 | |
| POL-443 | 5.6 | The agent uses only gov-issued ids and branches; never composes or merges one by hand | AGENT-CONTRACT + SPEC-PROMISE | SPEC ch4 + FRM | GOV-FRM-443 (agent), GOV-FRM-453 (gov) | agent; gov-client | C01 | 4 | promise: seed and task compose them (`identity.ts`) |
| — | 5.6 | cue: "NEVER INVENT AN ID OR A BRANCH" | AGENT-CONTRACT | FRM cue of 443 | — | — | — | — | `[machine-only]` |
| — | 6 | Pointer to the PMS contract | SPEC-DESC | SPEC ch4 | — | — | — | 4 | |
| — | 6.5 | gov checks board access at launch; the agent must check task ownership too | SPEC-PROMISE | SPEC ch6 + FRM | GOV-FRM-454 | gov-client | C01 | 6 | partly false today (contradiction 5); the promise is worded to what is true: mutating lifecycle verbs refuse |
| POL-114 | 6.5 | The agent confirms board write access and sub-branch assignment, or stops | AGENT-CONTRACT | FRM | GOV-FRM-114 | agent | C01 | 6 | |
| — | 6.5 | cue: "YOU ARE AUTHORIZED ONLY IF…" | AGENT-CONTRACT | FRM cue of 114 | — | — | — | — | `[machine-only]` |
| — | 7 | Pointer: where gov places clones | SPEC-DESC | SPEC ch5 | — | — | — | 5 | |
| — | 7.1 | Why: AGENT_WORK_ROOT holds others' preferences and keys | SPEC-DESC | SPEC ch5 | — | — | — | 5 | |
| POL-128 | 7.1 | `$AGENT_WORK_ROOT` is never committed | AGENT-CONTRACT | SPEC ch5 + FRM | GOV-FRM-128 | everyone | C01 | 5 | a path check in `gov validate` is a candidate (W6) |
| — | 7.2 | "An agent MAY write to: project folder; clones on the project branch" | AGENT-CONTRACT | SPEC ch5 | → GOV-FRM-172 | — | — | 5 | the positive half of 172 |
| — | 7.2 | (list) `projects/PRJ-…/` | AGENT-CONTRACT | — | → GOV-FRM-172 | — | — | 5 | list item |
| — | 7.2 | (list) cloned code repos on the project branch | AGENT-CONTRACT | — | → GOV-FRM-172 | — | — | 5 | list item |
| POL-172 | 7.2 | The agent never writes `knowledge/`, `policies/`, `framework/` or `org-config.yaml` as governance | AGENT-CONTRACT | FRM | GOV-FRM-172 | agent | C01 | 5 | ❓ Q3 (contradiction 9) |
| POL-173 | 7.2 | No code in the governance repo; no governance in a code repo | AGENT-CONTRACT | SPEC ch5 + FRM | GOV-FRM-173 | everyone | C01 | 5 | |
| — | 7.2 | cue: "WRITE ONLY…" | AGENT-CONTRACT | FRM cue of 172 | — | — | — | — | `[machine-only]` |
| — | 7.3 | Why: no machine can see a read | SPEC-DESC | SPEC ch6 | — | — | — | 6 | |
| POL-076 | 7.3 | Four layers; the higher layer wins a conflict | AGENT-CONTRACT | SPEC ch6 + FRM | GOV-FRM-076 | agent | C01 | 6 | absorbs 077–079 and 081; the level was stated two ways (contradiction 10) |
| POL-077 | 7.3 | Layer 1: org knowledge and `policies/` | AGENT-CONTRACT | SPEC ch6 | → GOV-FRM-076 | — | — | 6 | list item |
| POL-078 | 7.3 | Layer 2: project knowledge | AGENT-CONTRACT | SPEC ch6 | → GOV-FRM-076 | — | — | 6 | list item |
| POL-079 | 7.3 | Layer 3: repo-local knowledge | AGENT-CONTRACT | SPEC ch6 | → GOV-FRM-076 | — | — | 6 | list item; cited by an org file (W3 alias) |
| POL-080 | 7.3 | Layer 4: preferences; the agent reads only its own | AGENT-CONTRACT | SPEC ch6 + FRM | GOV-FRM-080 | agent | C01 | 6 | the path is wrong (contradiction 6); the spec uses the code's path |
| POL-081 | 7.3 | Preferences never override repo; repo never overrides org | AGENT-CONTRACT | — | → GOV-FRM-076 | — | — | 6 | restates 076 |
| POL-116 | 7.3 | Layers load fresh each session, never from a cache | AGENT-CONTRACT | FRM | GOV-FRM-116 | agent | C01 | 6 | |
| — | 7.3 | cue: "READ IN THIS ORDER…" | AGENT-CONTRACT | FRM cue of 076 | — | — | — | — | `[machine-only]` |
| — | 7.4 | Pointer: what preferences may carry, bounded to C03 | SPEC-DESC | SPEC ch5 | — | — | — | 5 | |
| POL-131 | 7.4 | A preferences file carries no policy, mandates, levels, assignment or layer rules | AGENT-CONTRACT | SPEC ch5 + FRM | GOV-FRM-131 | everyone | C01 | 5 | |
| POL-131a | 7.4 | Credentials only in the credentials dir under one's own preferences | ORG-DATA | ORG:data-classification.md | GOV-SVM-466 | everyone | C01 | 5 | the directory layout itself stays spec prose in ch5 |
| POL-133 | 7.4 | The agent disregards a preferences override and surfaces it | AGENT-CONTRACT | FRM | GOV-FRM-133 | agent | C01 | 6 | |
| — | 8.1 | Callout: the knowledge structure is yours | SPEC-DESC | SPEC ch8 | — | — | — | 8 | |
| POL-082 | 8.1 | `knowledge/` ships empty; the framework creates no domains | SPEC-PROMISE | SPEC ch8 + FRM | GOV-FRM-082 | gov-client | C01 | 8 | test: setup creates no folder under `knowledge/`; cited by an org file |
| POL-083a | 8.1 | CODEOWNERS maps each folder of `knowledge/` and `policies/` to its owner | MECHANICS | SPEC ch7 + FRM | GOV-FRM-455 | human | C01 | 7 | ❓ Q7 |
| — | 8.3 | Why: the most load-bearing clause; isolation plus a review gate | SPEC-DESC | SPEC ch7 | — | — | — | 7 | |
| POL-086a | 8.3 | Governance comes from the default branch; the harness is rebuilt from it each session | SPEC-PROMISE + AGENT-CONTRACT | SPEC ch7 + FRM | GOV-FRM-456 (gov), GOV-FRM-457 (agent) | gov-client; agent | C01 | 7 | lettered, so fresh ids; split into what gov does and what the agent does |
| POL-086b | 8.3 | Project edits to `knowledge/` and `policies/` are proposals; never treat your own as authority | AGENT-CONTRACT | SPEC ch7 + FRM | GOV-FRM-458 | agent | C01 | 7 | ❓ Q3 |
| POL-086c | 8.3 | A proposal becomes standard only when merged with PO and folder-owner approval; `policies/` needs all owners | MECHANICS | SPEC ch7 + FRM | GOV-FRM-459 | human | C01 | 7 | ❓ Q8 |
| POL-086d | 8.3 | Proposing a change is distinct from the exception process | SPEC-DESC | SPEC ch7 | — | — | — | 7 | explanation, no action; number retired |
| — | 8.3 | cue: "GOVERNANCE COMES FROM THE DEFAULT BRANCH…" | AGENT-CONTRACT | FRM cue of 457/458 | — | — | — | — | `[machine-only]` |
| POL-402 | 8.6 | One fact, one document; link, don't restate | MECHANICS | SPEC ch8 + FRM | GOV-FRM-402 | everyone | C01 | 8 | the org file reuses this number (contradiction 12) |
| — | 8.6 | cue: "ONE FACT, ONE DOCUMENT…" | MECHANICS | FRM cue of 402 | — | — | — | — | `[machine-only]` |
| — | 8.6 | Applies to agent context too; produced this document's reduction | SPEC-DESC | SPEC ch8 | — | — | — | 8 | the history sentence is dropped |
| — | 8.8 | Callout: publication and compliance review are yours | SPEC-DESC | SPEC ch8 | — | — | — | 8 | link only |
| — | 8.8 | Org CAN publish; `knowledge_publication`; review cadence; C01 escalation | DROP | — | — | — | — | — | restates org files (POL-270…275, 260…264); the spec links instead |
| — | 9 | Pointer: how a rule reaches an agent; gov's guarantee ends at the first turn | SPEC-DESC | SPEC ch6 | — | — | — | 6 | |
| POL-432 | 9.3 | A spawning agent gives its subagent this protocol | AGENT-CONTRACT | SPEC ch6 + FRM | GOV-FRM-432 | agent | C01 | 6 | rule-map misclasses it as gov/implemented (contradiction 14) |
| — | 9.3 | cue: "ANY AGENT OR SESSION YOU SPAWN…" | AGENT-CONTRACT | FRM cue of 432 | — | — | — | — | `[machine-only]` |
| POL-113 | 9.4 | Before any work, complete the session-start steps in order | AGENT-CONTRACT | SPEC ch6 + FRM | GOV-FRM-113 | agent | C01 | 6 | absorbs steps 1, 2, 4, 6 and POL-118; the step order conflicts (contradiction 11) |
| — | 9.4 | Step 1: read `org-config.yaml` | AGENT-CONTRACT | SPEC ch6 | → GOV-FRM-113 | — | — | 6 | |
| — | 9.4 | Step 2: verify authorization (POL-114) | AGENT-CONTRACT | SPEC ch6 | → GOV-FRM-114 | — | — | 6 | |
| POL-115 | 9.4 | Step 3: verify the board is open; otherwise refuse | AGENT-CONTRACT | FRM | GOV-FRM-115 | agent | C01 | 6 | |
| — | 9.4 | Step 4: load layers fresh (POL-116) | AGENT-CONTRACT | SPEC ch6 | → GOV-FRM-116 | — | — | 6 | |
| POL-117 | 9.4 | Step 5: pull the latest project branch in every repo | AGENT-CONTRACT | FRM | GOV-FRM-117 | agent | C02 | 6 | missing from session-protocol.md; ❓ Q1 on level |
| — | 9.4 | Step 6: post a context manifest, then wait | AGENT-CONTRACT | SPEC ch6 | → GOV-FRM-113 | — | — | 6 | |
| POL-118 | 9.4 | Only when all six are complete may work begin | AGENT-CONTRACT | — | → GOV-FRM-113 | — | — | 6 | restates 113 |
| — | 9.4 | cue: "BEFORE ANY WORK, IN YOUR FIRST REPLY…" | AGENT-CONTRACT | FRM cue of 113 | — | — | — | — | `[machine-only]` |
| — | 9.5 | History: there used to be an end-of-session checklist | DROP | — | — | — | — | — | history |
| POL-414 | 9.5 | Record decisions as made; draw structure as Mermaid | AGENT-CONTRACT | SPEC ch8 + FRM | GOV-FRM-414 | everyone | C02 | 8 | the Mermaid half folds into GOV-FRM-460; ❓ Q1 on level |
| POL-414a | 9.5 | No image for structure that could be text | MECHANICS | SPEC ch8 + FRM | GOV-FRM-460 | everyone | C01 | 8 | lettered, so a fresh id; the org POL-414 collides (contradiction 12) |
| — | 9.5 | cue: "AS YOU DECIDE, WRITE IT DOWN…" | AGENT-CONTRACT | FRM cue of 414 | — | — | — | — | `[machine-only]` |
| POL-124 | 9.6 | Mid-session C01: stop, commit nothing, surface, wait | DROP | — | → GOV-FRM-012 | — | — | 10 | duplicates POL-012–014 (one fact, one document); aliased |
| — | 9.7 | gov launches only agents in `authorized_agents` | SPEC-PROMISE | SPEC ch6 + FRM | GOV-FRM-461 | gov-client | C01 | 6 | `work-flow.ts` offers only approved agents; I did not verify there is no bypass flag |
| POL-134 | 9.7 | The agent declares its model and provider before work (cites 134, 135) | AGENT-CONTRACT | FRM | GOV-FRM-134 | agent | C02 | 6 | POL-135 folds in; ❓ Q1 on level |
| POL-137 | 9.7 | No confidential or restricted data to any LLM provider | ORG-DATA | ORG:data-classification.md | GOV-SVM-137 | everyone | C01 | — | |
| POL-423 | 9.8 | Log through the org's designated logging utility | ORG-DATA | ORG:approved-technologies.md or org-policy.md | GOV-SVM-423 | everyone | C02 | — | ❓ Q9 |
| — | 9.8 | **Restricted data never written to a log**, at any level or transport | ORG-DATA | ORG:data-classification.md | GOV-SVM-427 | everyone | C01 | — | carries POL-427's number (contradiction 15) |
| — | 9.8 | (bullet) any level | ORG-DATA | ORG prose | → GOV-SVM-427 | — | — | — | explanation |
| — | 9.8 | (bullet) any transport | ORG-DATA | ORG prose | → GOV-SVM-427 | — | — | — | explanation |
| — | 9.8 | (bullet) structured fields too | ORG-DATA | ORG prose | → GOV-SVM-427 | — | — | — | explanation |
| POL-427 | 9.8 | "POL-143… POL-137… this closes the third route" | ORG-DATA | ORG prose | → GOV-SVM-427 | — | — | — | the number moves to the rule sentence |
| POL-143 | 9.9 | No credential in a file, log, commit, PR or issue; an agent that finds one stops | ORG-DATA | ORG:data-classification.md | GOV-SVM-143 | everyone | C01 | — | the "finds one, stops" sentence folds in |
| — | 9.9 | cue: "NEVER write a credential…" (covers 143, 427, 131a) | ORG-DATA | ORG row cue | — | — | — | — | `[machine-only]` |
| POL-240 | 9.9 | Pointer: the rest of the tiers are in data-classification.md | DROP | — | — | — | — | — | pointer only; POL-240 lives in the org file |
| — | 10.1 | Framework files are replaced every upgrade; `policies/` is seeded once | SPEC-PROMISE | SPEC ch1 | → GOV-FRM-444/445 | — | — | 1 | same fact as the banner, merged into one place |
| POL-145a | 10.1 | Org policy MAY be stricter, without an exception | SPEC-DESC | SPEC ch9 | — | — | — | 9 | a permission with no observable obligation; ❓ Q2 |
| POL-145c | 10.1 | Org policy SHALL NOT be laxer; "refused at compile time" | MECHANICS | SPEC ch9 + FRM | GOV-FRM-462 | human | C01 | 9 | the compile-time claim is false (contradiction 1); ❓ Q11 |
| POL-145b | 10.1 | Relax C02/C03 only by exception; C01 never | DROP | — | → GOV-FRM-011, 016 | — | — | 3 | restates 011 and 016 |
| — | 10.1 | Three enforcement points: compiler, checks, resident line | DROP | — | — | — | — | — | the compiler and notation are retired (Q10, P3) |
| POL-150 | 10.4 | Each project keeps `compliance.md` (C01s, C02 exceptions, C03 deviations) | MECHANICS | SPEC ch8 + FRM | GOV-FRM-150 | everyone | C02 | 8 | the org's POL-263 says the same; ❓ Q1 on level |
| — | 10.4 | gov derives half of compliance.md from its run log, in a fenced region | SPEC-PROMISE | SPEC ch8 + FRM | GOV-FRM-463 | gov-client | C01 | 8 | `rules/compliance-record.ts` exists |
| POL-151 | 10.4 | Org summaries live where the org's policy says | DROP | — | — | — | — | — | pointer, and the number is not in the target (contradiction 13) |
| — | 11.1 | Request and approve an exception **before** dependent work | MECHANICS | SPEC ch10 | → GOV-FRM-152 | — | — | 10 | lead-in |
| POL-152 | 11.1 | The requester files an exception from the template under `policies/exceptions/` | MECHANICS | SPEC ch10 + FRM | GOV-FRM-152 | everyone | C01 | 10 | absorbs 153 |
| POL-153 | 11.1 | The requester raises a PR for it | MECHANICS | — | → GOV-FRM-152 | — | — | 10 | folded |
| POL-154 | 11.1 | The domain representative reviews and merges; merging is the approval | MECHANICS | SPEC ch10 + FRM | GOV-FRM-154 | human | C01 | 10 | |
| POL-155 | 11.1 | The agent blocks until the PR is merged | DROP | — | → GOV-FRM-020 | — | — | 10 | duplicates POL-020 |
| POL-156 | 11.2 | An exception names its rule, context, reason, scope, expiry, controls; no expiry means a policy change | MECHANICS | SPEC ch10 + FRM | GOV-FRM-156 | everyone | C01 | 10 | gov checks 3 of the 6 (contradiction 4) |
| POL-156a | 11.2 | An approved exception is compiled into the resident block and removed at expiry | SPEC-PROMISE | SPEC ch10 + FRM | GOV-FRM-464 | gov-client | C01 | 10 | `rules/exceptions.ts`; lettered, so a fresh id |
| — | 11.3 | Callout: who approves, by domain, is yours; the Policy Owner until appointed | SPEC-DESC | SPEC ch10 | — | — | — | 10 | link to authorized-representatives.md |
| POL-158a | 11.4 | Exceptions only against org rules, never framework mechanics | MECHANICS | SPEC ch10 + FRM | GOV-FRM-465 | gov-client | C01 | 10 | not implemented (contradiction 3); the test is for W6/W9 |
| — | 12 A | Glossary | SPEC-DESC | SPEC App. A | — | — | — | A | drop or redefine clause, cue, check, policy and specification for the row model |
| — | 12 B | Where everything else went | DROP | — | — | — | — | — | the single spec replaces it (Q23) |
| — | 12 B | A retired clause keeps its number; `.pol-lock.json` holds the retired ones | DROP | — | — | — | — | — | superseded by Q5 (rows never deleted) and Q21 (`pol-aliases.yaml`) |
| — | 12 C | Clause index generated into rule-map.md | DROP | — | — | — | — | — | W8 generates the rule map from rows. `[machine-only]` |

**Not in this table, but in scope for phase 2.** gov-behaviour.md and concepts.md fold into the same spec.
They hold more gov-client promise candidates that a test could check:

- the harness is written only when its bytes change
- "gov never merges a pull request"
- `seed` writes nothing to the default branch
- the rules-pending gate's deny-list
- the redaction table in §10

I will classify those in the same form when phase 2 opens, unless you want them here now.

## 5. Normalised expectations (one per proposed rule)

**GOV-FRM: spec promises (actor: gov-client; each is checked by a tagged test, Q3/Q4)**

- GOV-FRM-082: gov setup creates no domain folder under `knowledge/`.
- GOV-FRM-444: gov upgrade replaces every file under `framework/` with the release's copy.
- GOV-FRM-445: gov seeds each file under `policies/` once and never overwrites it afterwards.
- GOV-FRM-446: gov runs every non-agent verb when `authorized_agents` is `none`, and gov doctor reports the
  workspace as structure-only.
- GOV-FRM-447: gov repo protect apply, under `governance_posture: hard`, installs four controls on the
  governance repository: a required pull request, a required approving review, no administrator bypass, and
  the approver-check status check.
- GOV-FRM-448: gov doctor reports which of the four approval controls are in place on the governance
  repository.
- GOV-FRM-449: gov repo protect apply exits non-zero, and names the three ways out, when the platform refuses
  branch protection.
- GOV-FRM-451: gov reads project and task state from the board and writes it to no file in any repository.
- GOV-FRM-453: gov seed composes the project identifier and project branch from the board number, and gov task
  composes the task sub-branch.
- GOV-FRM-454: gov refuses a mutating lifecycle verb when the person lacks write access to the project's board.
- GOV-FRM-456: gov builds the agent harness and the governance snapshot from the governance repository's
  default branch, never from a project branch.
- GOV-FRM-461: gov work launches only an agent listed in `authorized_agents`.
- GOV-FRM-463: gov regenerates only the fenced derived region of `compliance.md` and never changes the
  hand-written region.
- GOV-FRM-464: gov places each approved, unexpired exception in the project's resident block and removes it
  when it expires.
- GOV-FRM-465: gov refuses an exception that names a framework rule.

**GOV-FRM: mechanics (fixed)**

- GOV-FRM-011: Nobody approves or exercises an exception to a C01 rule.
- GOV-FRM-016: Everyone deviates from a C02 rule only after the exception's pull request is merged by the
  domain's authorized representative.
- GOV-FRM-021: Everyone who deviates from a C03 rule records the reasoning in the project's knowledge at the
  time of the deviation.
- GOV-FRM-033: The Policy Owner names a current holder for every framework role in `org-config.yaml`.
- GOV-FRM-034: The Policy Owner acts for any vacant role until a new holder is named.
- GOV-FRM-150: Everyone records the project's C01 violations, C02 exceptions and C03 deviations in the
  project's `compliance.md`.
- GOV-FRM-152: The requester files a C02 exception from the framework template under
  `policies/exceptions/<domain>/`, and raises its pull request, before the dependent work starts.
- GOV-FRM-154: The domain's authorized representative approves an exception by reviewing and merging its pull
  request.
- GOV-FRM-156: The requester states six things in every exception file: the rule's GOV id, the context, the
  business reason, the scope, an expiry date and any compensating controls.
- GOV-FRM-402: Everyone states each fact in exactly one document and links to it everywhere else.
- GOV-FRM-450: The Policy Owner records which of the three ways out the organization took when its
  governance repository cannot be protected.
- GOV-FRM-455: The Policy Owner maps every folder of `knowledge/` and `policies/` to its owner in
  `CODEOWNERS`.
- GOV-FRM-459: The Policy Owner and the owners of the touched folders approve a governance change before it
  merges to the default branch.
- GOV-FRM-460: Everyone draws structure (flows, architectures, sequences, state machines) as Mermaid text and
  never as an image.
- GOV-FRM-462: The Policy Owner approves no organizational rule that relaxes, disables or replaces a framework
  rule.

**GOV-FRM: agent operating contract (fixed)**

- GOV-FRM-012: The agent stops all work, commits nothing, tells the responsible human and waits for their
  resolution as soon as it detects a C01 violation.
- GOV-FRM-020: The agent holds work that depends on a C02 exception until the exception's merged pull request
  exists, and never acts on verbal approval.
- GOV-FRM-041: Everyone commits code, updates knowledge and changes organizational resources only inside an
  active project.
- GOV-FRM-044: The agent creates no project-state or task-state file, and changes task state only through
  gov task and gov merge.
- GOV-FRM-076: The agent resolves a conflict between knowledge layers in favour of the higher layer: org, then
  project, then repo, then preferences.
- GOV-FRM-080: The agent reads only the preferences directory of its own GitHub login.
- GOV-FRM-113: The agent completes the session-start steps and posts a context manifest before its first
  edit, commit, branch or task.
- GOV-FRM-114: The agent confirms, before any work, two things: that it has write access to the project's
  board, and on a task sub-branch that the sub-branch is assigned to it. It stops without committing when it
  cannot confirm either.
- GOV-FRM-115: The agent refuses work and tells the human when the project's board is not open.
- GOV-FRM-116: The agent loads every knowledge layer fresh at session start and carries none over from an
  earlier session.
- GOV-FRM-117: The agent pulls the latest project branch in every participating repository before starting
  work.
- GOV-FRM-128: Everyone keeps `$AGENT_WORK_ROOT` and its contents out of every repository.
- GOV-FRM-131: Everyone keeps policy, security mandates, compliance levels, assignment rules and layer priority
  out of preferences files.
- GOV-FRM-133: The agent ignores a preferences file's attempt to override policy, security mandates,
  compliance levels or layer priority, and tells the human.
- GOV-FRM-134: The agent declares the model and provider it runs with before beginning work.
- GOV-FRM-172: The agent writes during an active project only to two places: `projects/<PROJECT_ID>/` in the
  governance repository, and the cloned code repositories on the project branch.
- GOV-FRM-173: Everyone keeps code out of the governance repository and governance out of code repositories.
- GOV-FRM-414: Everyone records decisions, exceptions and open to-dos in the project's knowledge as they are
  made.
- GOV-FRM-432: The agent gives every subagent, sub-session or worker it spawns this same session protocol.
- GOV-FRM-443: The agent uses only the project identifier and branches gov issued, and never composes an
  identifier or creates, renames or merges a branch by hand.
- GOV-FRM-452: Everyone lands every change to code, knowledge or policy by a pull request that someone on the
  organization's authorized list has approved.
- GOV-FRM-457: The agent takes governing knowledge and policy only from the governance repository's default
  branch.
- GOV-FRM-458: The agent never treats or cites its own unmerged edit to `knowledge/` or `policies/` as a rule.

**GOV-SVM: seeded org policy (B: human accountability, C: data)**

- GOV-SVM-006: The human using an AI tool checks that the tool's output complies with policy before relying
  on it.
- GOV-SVM-015: Nobody, the Policy Owner included, waives, overrides or defers a C01 rule.
- GOV-SVM-137: Everyone keeps confidential and restricted data away from every LLM provider, authorized or not.
- GOV-SVM-143: Everyone keeps credentials, keys, tokens and passwords out of files, logs, commits, pull
  requests and issues.
- GOV-SVM-423: Everyone logs through the organization's designated logging utility.
- GOV-SVM-427: Everyone keeps restricted data out of every log, at every level, through every transport,
  structured fields included.
- GOV-SVM-466: Everyone stores credentials only in the credentials directory under their own preferences
  directory.

## 6. Questions for the Policy Owner (❓)

- **Q1 (levels on fixed rules).** Q20 makes every framework rule fixed: no exception, no tightening. What, then,
  does C02 or C03 mean on a GOV-FRM row? GOV-FRM-117, 134, 150 and 414 are proposed at C02. Should every
  framework rule be C01, or should C02/C03 keep meaning "how firmly to apply it" with no exception route?
- **Q2 (tightening).** Q20 says framework rules allow "no tightening or loosening". Your edit to the opening,
  and POL-145a, say an organization MAY make them stricter. Which stands?
- **Q3 (write boundary).** POL-172 forbids an agent from writing to `knowledge/` or `policies/` during a
  project. POL-086b says project work may touch those paths, as proposals. Which is the rule?
- **Q4 (POL-015).** POL-015 (no role waives C01) goes to the org policy, as ruled. But GOV-FRM-011 already says
  that no C01 exception exists. Keep both, or retire POL-015 into GOV-FRM-011 so the fact lives once?
- **Q5 (POL-033 scope).** Should "every role has a named holder" cover only the two framework roles in GOV-FRM?
  If so, a separate "every org role" rule would be seeded into `authorized-representatives.md`.
- **Q6 (POL-040d).** Recording which way out the organization took on an unprotectable repository: is that a
  framework mechanic (GOV-FRM, actor Policy Owner) or org policy?
- **Q7 (POL-083a, CODEOWNERS coverage).** Is this a Policy Owner obligation (GOV-FRM mechanic), a gov promise
  (gov generates CODEOWNERS, P3 #6), or org policy?
- **Q8 (POL-086c approvers).** Does "Policy Owner + folder owners; `policies/` needs all policy and domain
  owners" still hold after P1, where org rule changes go to the Policy Owner and actions to the Check Owner?
- **Q9 (POL-423, logging utility).** Move it to the org policy (`approved-technologies.md` already names the
  utility "required by POL-423"), or drop it as uncheckable?
- **Q10 (cue-only obligations).** The §5.5 cue says "never push to the default branch" and "never force-push a
  shared branch", but no clause says either. Should they become GOV-FRM agent rules, or be removed from the cue?
- **Q11 (enforcing "not laxer").** No compiler refuses a relaxing clause today. In the new model, should the
  proposer interview (W4) flag an org row that contradicts a GOV-FRM row, or does GOV-FRM-462 stay advisory?
