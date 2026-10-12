// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * framework/rules/rule-row.schema.yaml IS HELD TO validateRuleStore (PRJ-121 intent 05, Item 9; Policy Owner Q10).
 *
 * The schema is the published shape of a rule store, for people and tools that are not gov. gov itself validates a
 * store with `validateRuleStore` (src/rules/model/rule-row.ts). Two descriptions of one thing drift unless something
 * holds them together, so this test gives both the same stores — the two gov ships, and a corpus of rows that are each
 * wrong in one way — and fails on any disagreement about whether a store is valid.
 *
 * "Valid" for the validator means no diagnostic other than a warning (ROW_WARNINGS): a warned store still loads.
 *
 * Rules that span rows or compare versions (two-in-force, broken-chain, end-before-start) cannot be said in JSON
 * Schema. They are TS-only by design: the schema accepts those stores, the validator refuses them, and the schema's
 * own description names each one — which this test also checks, so a new TS-only rule must be listed there.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import Ajv2020, { type ValidateFunction } from "ajv/dist/2020.js";
import { parseRuleStore, validateRuleStore, ROW_WARNINGS, type RowDiagnosticKind } from "../../src/rules/model/rule-row.js";
import { FRAMEWORK_SCOPE } from "../../src/rules/model/gov-id.js";

const CONTENT = fileURLToPath(new URL("../../../../content/", import.meta.url));
const SCHEMA_PATH = "framework/rules/rule-row.schema.yaml";
type Json = Record<string, unknown>;
const loadSchema = (): Json => yaml.load(fs.readFileSync(path.join(CONTENT, SCHEMA_PATH), "utf8"), { schema: yaml.JSON_SCHEMA }) as Json;

/** Which store a text is: the framework's (`FRM`) or an organization's (any other scope; ACME here). */
type Store = "framework" | "org";
const scopeOf = (s: Store): string => (s === "framework" ? FRAMEWORK_SCOPE : "ACME");

const compiled = new WeakMap<Json, { ajv: Ajv2020; store: (s: Store) => ValidateFunction }>();
function schemaVerdict(schema: Json, store: Store, text: string): { ok: boolean; errors: string } {
  let c = compiled.get(schema);
  if (!c) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    ajv.addSchema(schema, "rule-row");
    c = { ajv, store: (s) => {
      const v = ajv.getSchema(`rule-row#/$defs/${s}Store`);
      if (!v) throw new Error(`the schema has no $defs/${s}Store`);
      return v;
    } };
    compiled.set(schema, c);
  }
  const validate = c.store(store);
  const ok = validate(yaml.load(text, { schema: yaml.JSON_SCHEMA }) ?? []) as boolean;
  return { ok, errors: c.ajv.errorsText(validate.errors) };
}

function tsVerdict(store: Store, text: string): { ok: boolean; kinds: RowDiagnosticKind[] } {
  const kinds = validateRuleStore(parseRuleStore(text), { scope: scopeOf(store) }).map((d) => d.kind).filter((k) => !ROW_WARNINGS.has(k));
  return { ok: kinds.length === 0, kinds };
}

// ---- the corpus: one valid row, and rows that are each wrong in one way ----------------------------------------------

const BASE: Json = {
  id: "GOV-FRM-901",
  source: { doc: "framework/docs/specs/framework-specification.md", section: "3.2", sha: "94eefc7" },
  expectation: "The agent does one observable thing.",
  actor: ["agent"],
  level: "C01",
  start: { version: "1.2.3", date: "2026-10-06" },
  end: null,
};
const ORG_BASE: Json = { ...BASE, id: "GOV-ACME-001", level: "C02" };
const without = (o: Json, k: string): Json => { const c = { ...o }; delete c[k]; return c; };
const store = (...rows: Json[]): string => yaml.dump(rows);

interface Case { readonly name: string; readonly store: Store; readonly text: string; readonly tsKind?: RowDiagnosticKind }

/** Each row here: the validator and the schema must AGREE. `tsKind` set = both refuse (and the validator says why). */
const AGREE: Case[] = [
  // valid
  { name: "a plain framework row", store: "framework", text: store(BASE) },
  { name: "an org row at C02", store: "org", text: store(ORG_BASE) },
  { name: "an empty store", store: "org", text: "[]" },
  { name: "end absent (read as null, in force)", store: "framework", text: store(without(BASE, "end")) },
  { name: "a closed row with its PR", store: "framework", text: store({ ...BASE, end: { version: "1.3.0", date: "2026-10-07", pr: 12 } }) },
  { name: "everyone with gov-client", store: "framework", text: store({ ...BASE, actor: ["everyone", "gov-client"] }) },
  { name: "a resident cue on a C01 agent rule", store: "framework", text: store({ ...BASE, cue: { tier: "resident", text: "STOP." } }) },
  { name: "an on-demand cue with no check — a warning, not a refusal", store: "framework", text: store({ ...BASE, cue: { tier: "on-demand", text: "x" } }) },
  { name: "checks and qa", store: "framework", text: store({ ...BASE, checks: [{ on: { resource: "vcs.gov-repo", event: "push" }, action: "gh-action/landed-by-pr", with: { branches: ["$default"] }, on_miss: "fail" }], qa: [{ q: "why?", a: "because" }] }) },
  { name: "a revision chain that meets", store: "framework", text: store({ ...BASE, end: { version: "1.3.0", date: "2026-10-07" } }, { ...BASE, start: { version: "1.3.0", date: "2026-10-07" } }) },
  // refused — one per required field
  ...["id", "source", "expectation", "actor", "level", "start"].map((k): Case => ({
    name: `no ${k}`, store: "framework", text: store(without(BASE, k)),
    tsKind: ({ id: "bad-id", source: "bad-source", expectation: "bad-expectation", actor: "bad-actor", level: "bad-level", start: "bad-stamp" } as const)[k as "id"],
  })),
  // refused — one per per-row diagnostic
  { name: "a malformed id", store: "framework", text: store({ ...BASE, id: "GOV-frm-1" }), tsKind: "bad-id" },
  { name: "an org id in the framework store", store: "framework", text: store({ ...BASE, id: "GOV-ACME-001" }), tsKind: "wrong-scope" },
  { name: "a framework id in the org store", store: "org", text: store({ ...ORG_BASE, id: "GOV-FRM-901" }), tsKind: "wrong-scope" },
  { name: "a source without its sha", store: "framework", text: store({ ...BASE, source: { doc: "d.md", section: "1" } }), tsKind: "bad-source" },
  { name: "a source with an empty doc", store: "framework", text: store({ ...BASE, source: { doc: "", section: "1", sha: "abc" } }), tsKind: "bad-source" },
  { name: "a blank expectation", store: "framework", text: store({ ...BASE, expectation: "   " }), tsKind: "bad-expectation" },
  { name: "level C04", store: "framework", text: store({ ...BASE, level: "C04" }), tsKind: "bad-level" },
  { name: "no actors", store: "framework", text: store({ ...BASE, actor: [] }), tsKind: "bad-actor" },
  { name: "an unknown actor", store: "framework", text: store({ ...BASE, actor: ["robot"] }), tsKind: "bad-actor" },
  { name: "an actor twice", store: "framework", text: store({ ...BASE, actor: ["agent", "agent"] }), tsKind: "bad-actor" },
  { name: "actor not a list", store: "framework", text: store({ ...BASE, actor: "agent" }), tsKind: "bad-actor" },
  { name: "everyone with agent", store: "framework", text: store({ ...BASE, actor: ["everyone", "agent"] }), tsKind: "bad-actor" },
  { name: "everyone with human", store: "framework", text: store({ ...BASE, actor: ["human", "everyone"] }), tsKind: "bad-actor" },
  { name: "gov-client in an org rule", store: "org", text: store({ ...ORG_BASE, actor: ["gov-client"] }), tsKind: "gov-client-in-org" },
  { name: "C02 in the framework", store: "framework", text: store({ ...BASE, level: "C02" }), tsKind: "c02-in-framework" },
  { name: "a resident cue on a C03 rule", store: "framework", text: store({ ...BASE, level: "C03", cue: { tier: "resident", text: "x" } }), tsKind: "resident-cue-not-c01" },
  { name: "a resident cue no agent reads", store: "framework", text: store({ ...BASE, actor: ["human"], cue: { tier: "resident", text: "x" } }), tsKind: "resident-cue-no-agent" },
  { name: "a two-part version", store: "framework", text: store({ ...BASE, start: { version: "1.2", date: "2026-10-06" } }), tsKind: "bad-stamp" },
  { name: "a day-first date", store: "framework", text: store({ ...BASE, start: { version: "1.2.3", date: "06-10-2026" } }), tsKind: "bad-stamp" },
  { name: "a start with no date", store: "framework", text: store({ ...BASE, start: { version: "1.2.3" } }), tsKind: "bad-stamp" },
  { name: "PR 0", store: "framework", text: store({ ...BASE, start: { version: "1.2.3", date: "2026-10-06", pr: 0 } }), tsKind: "bad-stamp" },
  { name: "a fractional PR", store: "framework", text: store({ ...BASE, start: { version: "1.2.3", date: "2026-10-06", pr: 1.5 } }), tsKind: "bad-stamp" },
  { name: "a malformed end", store: "framework", text: store({ ...BASE, end: { version: "x", date: "2026-10-07" } }), tsKind: "bad-stamp" },
];

/** Rules JSON Schema cannot say: the schema accepts the store, the validator refuses it. */
const TS_ONLY: Case[] = [
  { name: "a row that ends before it starts", store: "framework", text: store({ ...BASE, start: { version: "1.3.0", date: "2026-10-06" }, end: { version: "1.2.0", date: "2026-10-07" } }), tsKind: "end-before-start" },
  { name: "two rows of one id in force", store: "framework", text: store(BASE, { ...BASE, start: { version: "1.3.0", date: "2026-10-07" } }), tsKind: "two-in-force" },
  { name: "a revision chain with a gap", store: "framework", text: store({ ...BASE, end: { version: "1.3.0", date: "2026-10-07" } }, { ...BASE, start: { version: "1.4.0", date: "2026-10-08" } }), tsKind: "broken-chain" },
];

/** Every way the corpus disagrees with a schema. Empty = parity. */
function disagreements(schema: Json): string[] {
  const out: string[] = [];
  for (const c of AGREE) {
    const s = schemaVerdict(schema, c.store, c.text), t = tsVerdict(c.store, c.text);
    if (s.ok !== t.ok) out.push(`${c.name}: schema ${s.ok ? "accepts" : `refuses (${s.errors})`}, validator ${t.ok ? "accepts" : `refuses (${t.kinds.join(", ")})`}`);
  }
  return out;
}

describe("rule-row.schema.yaml — held to validateRuleStore (Item 9, Q10)", () => {
  it("is a JSON Schema 2020-12 document that compiles strictly", () => {
    const schema = loadSchema();
    expect(schema.$schema).to.equal("https://json-schema.org/draft/2020-12/schema");
    expect(() => new Ajv2020({ strict: true }).compile(schema)).to.not.throw();
  });

  it("both shipped stores are valid to the schema AND the validator", () => {
    const schema = loadSchema();
    for (const [file, st] of [["framework/rules/rules.yaml", "framework"], ["policies/rules.yaml", "org"]] as const) {
      const text = fs.readFileSync(path.join(CONTENT, file), "utf8");
      const s = schemaVerdict(schema, st, text), t = tsVerdict(st, text);
      expect(s.ok, `${file} to the schema: ${s.errors}`).to.equal(true);
      expect(t.ok, `${file} to the validator: ${t.kinds.join(", ")}`).to.equal(true);
    }
  });

  it("the framework store is non-trivial — the parity covers real rows, cues and checks", () => {
    const rows = parseRuleStore(fs.readFileSync(path.join(CONTENT, "framework/rules/rules.yaml"), "utf8"));
    expect(rows.length).to.be.greaterThan(10);
    expect(rows.some((r) => r.cue)).to.equal(true);
    expect(rows.some((r) => r.checks?.length)).to.equal(true);
  });

  it("the schema and the validator agree on every row of the corpus", () => {
    expect(disagreements(loadSchema())).to.deep.equal([]);
  });

  it("the corpus refuses each row for the reason it was written for", () => {
    for (const c of AGREE.filter((x) => x.tsKind)) expect(tsVerdict(c.store, c.text).kinds, c.name).to.include(c.tsKind);
  });

  it("the corpus exercises every per-row diagnostic the validator has", () => {
    const covered = new Set([...AGREE, ...TS_ONLY].map((c) => c.tsKind).filter(Boolean));
    const all: RowDiagnosticKind[] = ["bad-id", "wrong-scope", "bad-source", "bad-expectation", "bad-actor", "bad-level", "bad-stamp",
      "gov-client-in-org", "c02-in-framework", "resident-cue-not-c01", "resident-cue-no-agent", "two-in-force", "broken-chain",
      "end-before-start", "on-demand-cue-unbound"];
    for (const k of all) if (!ROW_WARNINGS.has(k)) expect(covered.has(k), `no corpus row for ${k}`).to.equal(true);
  });

  it("the TS-only rules: the schema accepts, the validator refuses, and the schema's description names each one", () => {
    const schema = loadSchema();
    for (const c of TS_ONLY) {
      expect(schemaVerdict(schema, c.store, c.text).ok, `${c.name} — schema`).to.equal(true);
      expect(tsVerdict(c.store, c.text).kinds, `${c.name} — validator`).to.include(c.tsKind);
      expect(String(schema.description), `the schema's description lists ${c.tsKind}`).to.contain(c.tsKind);
    }
  });

  it("deleting any required field from the schema breaks the parity", () => {
    const schema = loadSchema();
    const row = (schema.$defs as Record<string, Json>).row;
    const required = row.required as string[];
    expect(required).to.include.members(["id", "source", "expectation", "actor", "level", "start"]);
    for (const k of required) {
      const mutated = structuredClone(schema);
      const r = (mutated.$defs as Record<string, Json>).row;
      r.required = (r.required as string[]).filter((x) => x !== k);
      expect(disagreements(mutated), `dropping "${k}" from the schema's required list must be caught`).to.not.deep.equal([]);
    }
  });

  it("…and a validator that stopped checking a required field would be caught the same way", () => {
    // The schema refuses a row with no <field>; so the corpus row "no <field>" only agrees while the validator refuses it.
    const schema = loadSchema();
    for (const k of ["id", "source", "expectation", "actor", "level", "start"]) {
      const c = AGREE.find((x) => x.name === `no ${k}`)!;
      expect(schemaVerdict(schema, c.store, c.text).ok, `schema must refuse "${c.name}"`).to.equal(false);
    }
  });
});
