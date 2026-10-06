// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE EXTRACTION REQUEST FOR ONE CHANGED SECTION (rule-model-design.md Q9, Q10, Q13, Q15, Q17, Q18, W2-Q2, W2-Q8; W4).
 *
 * The SYSTEM text is fixed — the rules of extraction, the same for every section, so a run is reproducible and a
 * change to how gov extracts is a reviewed change to this file. The USER text is the section's data: its prose and
 * sha, the rules it already has, the catalog it may bind to, the framework rules it must not contradict, and the
 * interview so far.
 *
 * Pure.
 */
import type { RuleRow } from "../model/rule-row.js";
import type { Catalog } from "../model/catalog.js";
import type { ModelRequest } from "./model-port.js";

export interface PromptInput {
  readonly doc: string;
  readonly section: string;
  readonly sha: string;
  readonly text: string;
  /** The section's rules in force. */
  readonly rows: readonly RuleRow[];
  readonly catalog: Catalog;
  /** Framework rules in force: an org rule may tighten them, never contradict them (W2-Q2). */
  readonly frameworkRules: readonly RuleRow[];
  /** The org's role names, for ownership sentences (W2-Q8). */
  readonly roles?: readonly string[];
  /** The interview so far. */
  readonly qa: readonly { readonly q: string; readonly a: string }[];
  /** What gov refused in the previous reply, for the model to correct. */
  readonly corrections: readonly string[];
}

export const SYSTEM_PROMPT = `You extract governance rules from ONE section of an organization's policy, written in plain English by its owners.
You never change the prose. You propose; a human approves. Reply with ONE JSON object and nothing else.

WHAT A RULE IS
- One rule = one expectation of the form "<Actor> <verb> <one observable action>." Plain verbs ("uses", "records",
  "does not push"). Never MUST/SHOULD/MAY in capitals — the verb is NOT the level.
- One section may yield several rules, or none (pure description, rationale, examples yield none).

LEVEL (separate field; infer it from intent)
- "never", "no exceptions", "under no circumstances" → C01.
- "must … unless approved", or a restriction followed by an exception route → C02.
- "should", "prefer", "by default", "where possible" → C03.
- No signal → do not guess: ask (kind "level").

ACTOR (a set)
- "everyone", "all staff", "anyone" → ["everyone"] (= agent and human).
- Only agents → ["agent"]; only people → ["human"].
- NEVER "gov-client" — only the framework makes promises about the gov tool.
- Unclear who is bound → ask (kind "actor").

EXISTING RULES
- You are given the section's rules in force, with their GOV ids. Classify EVERY one exactly once:
  keep (still says the same), revise (same rule, changed meaning or wording — give the new row), retire (gone).
- If you cannot tell whether a change revises a rule or retires it and adds another → ask (kind "keep-revise-retire").
- A NEW rule is "add" with NO id. Never write a GOV id for a new rule; gov issues ids.

CHECKS AND CUES
- A check binds the rule to a resource event from the CATALOG and runs an action from the CATALOG, with "with" params
  the action declares. Never invent resources, events or actions.
- If the intent is real but nothing in the catalog can observe it → ask (kind "uncheckable"):
  "draft a new check for the Check Owner to review, or leave the rule advisory?"
- A C01 rule bound only to observe events can only be detected after the fact; gov will ask the owner about it.
- cue (optional): "resident" only for C01 rules binding agents; "on-demand" only on a rule WITH checks (it is shown
  when a check fires — with no check nothing can show it); otherwise no cue.

FRAMEWORK RULES
- You are given the framework's rules in force. An org rule may be STRICTER, never contradictory. If this section
  contradicts one, ask (kind "contradiction", "contradicts": "<GOV-FRM id>") and do not propose the contradicting rule.

OWNERSHIP
- A sentence like "Section 4 is owned by the Data Owner" is not a rule: put it in "ownership" as
  {"section": "4", "role": "Data Owner"}. Use the role's name from the org's role list.

ASK ONLY ON AMBIGUITY
- If the prose is clear, ask nothing. Each question: a stable short id, the text, and options where the answer is a choice.
- Answers already given are in the interview; follow them and do not ask again.
- When you ask, still return the verdicts you are sure of.

OUTPUT (strict JSON, no extra fields, no commentary):
{"verdicts":[{"kind":"keep","id":"GOV-X-001"},{"kind":"revise","id":"GOV-X-002","row":ROW},{"kind":"retire","id":"GOV-X-003"},{"kind":"add","row":ROW}],
 "ownership":[{"section":"4","role":"Data Owner"}],
 "questions":[{"id":"q1","kind":"level","text":"…","options":["C01","C02","C03"]}]}
ROW = {"expectation":"…","actor":["everyone"],"level":"C02","cue":{"tier":"on-demand","text":"…"},
       "checks":[{"on":{"resource":"…","event":"…"},"action":"…","with":{},"on_miss":"fail"}]}   (cue and checks optional)`;

const ROW_SCHEMA = {
  type: "object", additionalProperties: false, required: ["expectation", "actor", "level"],
  properties: {
    expectation: { type: "string" },
    actor: { type: "array", items: { enum: ["agent", "human", "everyone"] } },
    level: { enum: ["C01", "C02", "C03"] },
    cue: { type: "object", additionalProperties: false, required: ["tier", "text"], properties: { tier: { enum: ["resident", "on-demand"] }, text: { type: "string" } } },
    checks: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["on", "action", "on_miss"],
        properties: {
          on: { type: "object", additionalProperties: false, required: ["resource", "event"], properties: { resource: { type: "string" }, event: { type: "string" } } },
          action: { type: "string" }, with: { type: "object" }, on_miss: { enum: ["fail", "warn"] },
        },
      },
    },
  },
} as const;

/** The reply's JSON Schema, for providers that enforce structured output. {@link ./parse.js} re-checks regardless. */
export const PROPOSAL_SCHEMA = {
  type: "object", additionalProperties: false, required: ["verdicts", "ownership", "questions"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        oneOf: [
          { type: "object", additionalProperties: false, required: ["kind", "id"], properties: { kind: { enum: ["keep", "retire"] }, id: { type: "string" } } },
          { type: "object", additionalProperties: false, required: ["kind", "id", "row"], properties: { kind: { const: "revise" }, id: { type: "string" }, row: ROW_SCHEMA } },
          { type: "object", additionalProperties: false, required: ["kind", "row"], properties: { kind: { const: "add" }, row: ROW_SCHEMA } },
        ],
      },
    },
    ownership: { type: "array", items: { type: "object", additionalProperties: false, required: ["section", "role"], properties: { section: { type: "string" }, role: { type: "string" } } } },
    questions: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["id", "text"],
        properties: {
          id: { type: "string" }, text: { type: "string" }, options: { type: "array", items: { type: "string" } },
          kind: { enum: ["level", "actor", "keep-revise-retire", "uncheckable", "contradiction", "other"] },
          contradicts: { type: "string" },
        },
      },
    },
  },
} as const;

/** A row as the model needs to see it: what it says, not its history. */
const brief = (r: RuleRow) => ({
  id: r.id, expectation: r.expectation, actor: r.actor, level: r.level,
  ...(r.cue ? { cue: r.cue } : {}), ...(r.checks?.length ? { checks: r.checks } : {}),
});

export function buildProposalRequest(p: PromptInput): ModelRequest {
  const data = {
    section: { doc: p.doc, section: p.section, sha: p.sha },
    existing_rules: p.rows.map(brief),
    catalog: {
      resources: p.catalog.resources.map((r) => ({ id: r.id, events: r.events.map((e) => ({ name: e.name, mode: e.mode })) })),
      actions: p.catalog.actions.map((a) => ({ id: a.id, tool: a.tool, ...(a.params ? { params: a.params } : {}) })),
    },
    framework_rules: p.frameworkRules.map((r) => ({ id: r.id, expectation: r.expectation, actor: r.actor, level: r.level })),
    ...(p.roles ? { roles: p.roles } : {}),
  };
  const parts = [
    `SECTION ${p.section} of ${p.doc} (sha ${p.sha}) — the prose, exactly as written:`,
    "<<<", p.text, ">>>",
    "",
    "DATA (JSON):",
    JSON.stringify(data, null, 2),
  ];
  if (p.qa.length) {
    parts.push("", "INTERVIEW SO FAR (the owner's answers are binding):");
    for (const { q, a } of p.qa) parts.push(`Q: ${q}`, `A: ${a}`);
  }
  if (p.corrections.length) {
    parts.push("", "YOUR PREVIOUS REPLY WAS REFUSED. Correct these and reply again in full:");
    for (const c of p.corrections) parts.push(`- ${c}`);
  }
  parts.push("", "Reply with the JSON object only.");
  return { system: SYSTEM_PROMPT, user: parts.join("\n"), schema: PROPOSAL_SCHEMA };
}
