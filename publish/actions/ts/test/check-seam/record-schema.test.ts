// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// THE EVIDENCE RECORD CARRIES NO CONTENT (spec 02 §3.1, A6 schema half). A record names a rule, a verdict and a
// message KEY — never code, a diff, file content or finding prose, and the org only by its rename-safe numeric id.
// The schemas are strict (`additionalProperties: false` at every level), so anything else is refused, not ignored.
import { expect } from "chai";
import { validate } from "../../src/check-seam/validate.js";
import { SCHEMA_NAMES, SCHEMAS } from "../../src/check-seam/schemas.js";

const base = {
  schema: "gov-evidence/1",
  id: "01JA0000000000000000000000",
  org: { vcs: "github", id: 297356872 },
  source: "ci",
  runKey: "gh:9123:1:GOV-ACME-012:pull_request",
  at: "2026-10-12T09:14:03Z",
  versions: { gov: "2.0.0", govCheck: "2.0.0", policy: "org-1.4.0", pack: "soc2-cc8@1.0.0" },
};

const check = {
  ...base,
  kind: "check",
  repo: { id: 77, name: "acme/app" },
  ref: { sha: "a".repeat(40), changeRequest: 42, branch: "BRNCH-12-x" },
  rule: { id: "GOV-ACME-012", rev: "org-1.4.0", level: "C01", phase: "build" },
  binding: { resource: "vcs.code-repo", event: "pull_request", action: "gov-builtin/list-membership" },
  verdict: "pass",
  class: "prevented",
  messageKey: "landed-by-pr.missing-review",
  actor: { login: "dev1", kind: "agent", agent: "claude-code", trailer: "present" },
  session: { project: "PRJ-121", issue: 186 },
};

const valid: Record<string, unknown> = {
  check,
  gate: { ...check, kind: "gate", binding: undefined },
  "judge (observe-only)": { ...check, kind: "judge", verdict: "fail", class: "judged" },
  "needs-subscription": { ...check, verdict: "needs-subscription", class: "advisory (needs subscription)" },
  "session start": { ...base, kind: "session", boundary: "start", session: { project: "PRJ-121", issue: 186 }, actor: { login: "dev1", kind: "human", trailer: "absent" } },
  gap: { ...base, kind: "gap", reason: "lease.refused" },
};

const strip = (o: Record<string, unknown>) => JSON.parse(JSON.stringify(o)) as Record<string, unknown>;

describe("check-seam — the gov-evidence/1 record schema (A6)", () => {
  for (const [name, rec] of Object.entries(valid)) {
    it(`accepts a valid ${name} record`, () => {
      expect(validate("gov-evidence-1", strip(rec as Record<string, unknown>))).to.deep.equal([]);
    });
  }

  for (const field of ["diff", "content", "code", "message", "findings", "patch"]) {
    it(`refuses a record carrying "${field}"`, () => {
      const errs = validate("gov-evidence-1", strip({ ...check, [field]: "diff --git a/x b/x\n+secret()" }));
      expect(errs).to.not.be.empty;
    });
  }

  it("refuses org.login — the org is named only by its numeric id", () => {
    expect(validate("gov-evidence-1", strip({ ...check, org: { vcs: "github", id: 1, login: "acme" } }))).to.not.be.empty;
    expect(validate("gov-evidence-1", strip({ ...check, org: { vcs: "github", id: "acme" } }))).to.not.be.empty;
  });

  it("refuses finding prose smuggled into messageKey", () => {
    expect(validate("gov-evidence-1", strip({ ...check, messageKey: "@chuck has not approved this change." }))).to.not.be.empty;
  });

  it("refuses unknown nested fields (rule.text, binding.with, ref.diff)", () => {
    expect(validate("gov-evidence-1", strip({ ...check, rule: { ...check.rule, text: "prose" } }))).to.not.be.empty;
    expect(validate("gov-evidence-1", strip({ ...check, binding: { ...check.binding, with: { list: "x" } } }))).to.not.be.empty;
    expect(validate("gov-evidence-1", strip({ ...check, ref: { ...check.ref, diff: "+x" } }))).to.not.be.empty;
  });

  it("a gap carries no verdict — a missing record is never a pass", () => {
    expect(validate("gov-evidence-1", strip({ ...base, kind: "gap", reason: "lease.refused", verdict: "pass" }))).to.not.be.empty;
  });

  it("a verdict-bearing record without a verdict is refused", () => {
    const { verdict: _v, ...noVerdict } = check;
    expect(validate("gov-evidence-1", strip(noVerdict))).to.not.be.empty;
  });

  it("every shipped schema forbids extra properties at every object level", () => {
    for (const name of SCHEMA_NAMES) expect(openObjects(name), name).to.deep.equal([]);
  });
});

describe("check-seam — usage counts are numbers only (§4.3, A13)", () => {
  const counts = {
    window: { from: "2026-10-01T00:00:00Z", to: "2026-10-12T00:00:00Z" },
    writer: "w-3f2a",
    records: 1840, agentRecords: 610, judgeCalls: 22, gaps: 1, activeActors90d: 14, repos: 6,
  };

  it("accepts the counts", () => expect(validate("usage-counts", counts)).to.deep.equal([]));

  for (const k of ["records", "agentRecords", "judgeCalls", "gaps", "activeActors90d", "repos"]) {
    it(`refuses a non-numeric ${k}`, () => {
      expect(validate("usage-counts", { ...counts, [k]: "acme/app" })).to.not.be.empty;
    });
  }

  it("refuses any extra field (a login list, repo names, rule ids)", () => {
    expect(validate("usage-counts", { ...counts, logins: ["dev1"] })).to.not.be.empty;
    expect(validate("usage-counts", { ...counts, repoNames: "acme/app" })).to.not.be.empty;
    expect(validate("usage-counts", { ...counts, window: { ...counts.window, rule: "GOV-1" } })).to.not.be.empty;
  });

  it("a lease request is a personal key OR an OIDC token, a writer key and counts — nothing else", () => {
    const writerPub = { kty: "OKP", crv: "Ed25519", x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo" };
    expect(validate("lease-request", { personalKey: "eyJ.a.b", writerPub, counts })).to.deep.equal([]);
    expect(validate("lease-request", { oidcToken: "eyJ.a.b", writerPub, counts })).to.deep.equal([]);
    expect(validate("lease-request", { personalKey: "k", oidcToken: "t", writerPub, counts })).to.not.be.empty;
    expect(validate("lease-request", { writerPub, counts })).to.not.be.empty;
    expect(validate("lease-request", { personalKey: "k", writerPub, counts, chainHead: "ab".repeat(32) })).to.not.be.empty;
  });
});

describe("check-seam — seal and chain entry", () => {
  const hex = "ab".repeat(32);
  it("accepts a seal line and a chain entry", () => {
    expect(validate("seal", { seal: { segment: "ci-77-9123-1", count: 2, root: hex, chainPrev: hex, writer: "w-1", cert: "lease-1", sig: "c2ln" } })).to.deep.equal([]);
    expect(validate("chain-entry", { n: 412, segment: "2026/10/12/ci-77-9123-1.jsonl", sha256: hex, prev: hex, writer: "w-1", sig: "c2ln" })).to.deep.equal([]);
  });
  it("refuses a seal with a non-hex root and a chain entry with n = 0", () => {
    expect(validate("seal", { seal: { segment: "s", count: 1, root: "nothex", chainPrev: hex, writer: "w", cert: "c", sig: "s" } })).to.not.be.empty;
    expect(validate("chain-entry", { n: 0, segment: "x.jsonl", sha256: hex, prev: hex, writer: "w", sig: "s" })).to.not.be.empty;
  });
});

/** Paths of object schemas that do not say `additionalProperties: false`. */
function openObjects(name: (typeof SCHEMA_NAMES)[number]): string[] {
  const bad: string[] = [];
  const walk = (node: unknown, at: string): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach((n, i) => walk(n, `${at}[${i}]`)); return; }
    const s = node as Record<string, unknown>;
    if (s.type === "object" && s.additionalProperties !== false) bad.push(at || "/");
    for (const [k, v] of Object.entries(s)) walk(v, `${at}/${k}`);
  };
  walk(SCHEMAS[name], "");
  return bad;
}
