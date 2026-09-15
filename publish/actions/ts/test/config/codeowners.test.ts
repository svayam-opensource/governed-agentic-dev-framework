// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * CODEOWNERS is generated, and the generation is the fix (Decisions 7, 8, 13 — 2026-09-14).
 *
 * The shipped template reached every adopter with seven unresolved tokens, because the token
 * sweep covered `agent/` and `knowledge/` and never the repo root. GitHub cannot resolve
 * `<POLICY_OWNER_GITHUB>`, so no rule applied and `governance/policies/` was unprotected
 * everywhere — while the policy said changes there need the Policy Owner. Every test passed.
 *
 * These tests exist because that is not a bug you find by reading output.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderCodeowners, unresolvedTokens, normalizeHandle, POLICY_OWNER_PATHS, DOMAIN_ROLES,
} from "../../src/config/codeowners.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

describe("CODEOWNERS generation", () => {
  it("a Policy Owner is required — no owner means no file, not a partial one", () => {
    // Refusing is the point. A CODEOWNERS missing its floor protects nothing, and that state is
    // indistinguishable from the broken template it replaces.
    expect(renderCodeowners({})).to.equal(null);
    expect(renderCodeowners({ policy_owner_github: "   " }), "blank is not a holder").to.equal(null);
    expect(renderCodeowners({ legal_owner_github: "x" }), "a domain role cannot stand in").to.equal(null);
  });

  it("org-config.yaml is gated, and listed FIRST", () => {
    // Decision 6: it holds every other handle, so an ungated copy is a route to naming yourself
    // the approver of everything else. First because order is how a reader sees the point.
    const r = renderCodeowners({ policy_owner_github: "rkant" })!;
    const rules = r.text.split("\n").filter((l) => l.startsWith("/"));
    expect(rules[0]).to.match(/^\/org-config\.yaml\s+@rkant$/);
    for (const p of POLICY_OWNER_PATHS) expect(r.text).to.contain(p);
  });

  it("a domain line appears only when the role is HELD", () => {
    // POL-403: a top-level domain exists if and only if a named Owner role exists for it. The
    // framework no longer ships eight domains with owners TBD, so an unheld role adds no line.
    const none = renderCodeowners({ policy_owner_github: "rkant" })!;
    for (const r of DOMAIN_ROLES) for (const p of r.paths) expect(none.text).to.not.contain(p);
    expect(none.unheld).to.have.length(DOMAIN_ROLES.length);

    const one = renderCodeowners({ policy_owner_github: "rkant", legal_owner_github: "lawyer" })!;
    expect(one.text).to.contain("/knowledge/legal/");
    expect(one.text).to.contain("@lawyer");
    expect(one.unheld, "and the rest are REPORTED, not silently dropped").to.not.include("Legal Owner");
  });

  it("handles are normalised, so `@x` and `x` cannot produce `@@x`", () => {
    expect(normalizeHandle("rkant")).to.equal("@rkant");
    expect(normalizeHandle("@rkant")).to.equal("@rkant");
    expect(normalizeHandle("@@rkant")).to.equal("@rkant");
    expect(normalizeHandle("")).to.equal(null);
    expect(normalizeHandle(undefined)).to.equal(null);
  });

  it("the generated file carries NO unresolved token", () => {
    const r = renderCodeowners({ policy_owner_github: "rkant", legal_owner_github: "lawyer" })!;
    expect(unresolvedTokens(r.text)).to.deep.equal([]);
  });

  it("unresolvedTokens catches what shipped for months", () => {
    // The exact seven from the old template.
    const old = "knowledge/policies/ <POLICY_OWNER_GITHUB>\nknowledge/legal/ <LEGAL_OWNER_GITHUB>\n";
    expect(unresolvedTokens(old)).to.deep.equal(["<POLICY_OWNER_GITHUB>", "<LEGAL_OWNER_GITHUB>"]);
    expect(unresolvedTokens("/x @rkant"), "and does not cry wolf").to.deep.equal([]);
  });

  it("no CODEOWNERS template ships any more", () => {
    // The whole failure mode was a shipped file with tokens in it. If one reappears in
    // publish/content, the sweep gap can reappear with it.
    expect(
      fs.existsSync(path.join(repoRoot, "publish", "content", "CODEOWNERS")),
      "publish/content/CODEOWNERS must not exist — CODEOWNERS is generated",
    ).to.equal(false);
  });

  it("reads org-config KEYS, which is not how tokenValuesFromOrgConfig hands them over", () => {
    // THE WIRING BUG THIS EXISTS FOR. `tokenValuesFromOrgConfig` returns keys UPPERCASED
    // (`POLICY_OWNER_GITHUB`), because its job is token substitution. Passing that object in
    // directly makes every handle `undefined`, so this returns null and setup aborts with
    // "org-config.yaml names no policy_owner_github" on a config that names one. The caller
    // lowercases; this pins which shape the module expects.
    expect(renderCodeowners({ POLICY_OWNER_GITHUB: "rkant" } as never), "token-cased keys must NOT work").to.equal(null);
    expect(renderCodeowners({ policy_owner_github: "rkant" }), "config-cased keys must").to.not.equal(null);
  });

  it("nothing shipped will be substituted into an ACCESS-CONTROL file", () => {
    // Narrower than my first version, which flagged two legitimate documentation mentions: the
    // manifest's own comment explaining this defect, and the protocol's token-mapping table.
    // Documentation naming a token is fine. What must never ship is a file that GRANTS ACCESS
    // and waits for a token to be filled in — because when the sweep misses it, the file looks
    // like a gate and enforces nothing. CODEOWNERS is the only such file.
    const content = path.join(repoRoot, "publish", "content");
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    const accessFiles = walk(content).filter((f) => path.basename(f) === "CODEOWNERS");
    expect(accessFiles, "no CODEOWNERS may ship at all").to.deep.equal([]);
  });

  it("no manifest entry uses scaffold-prompt, because readBaseline does not exist", () => {
    // The guard for the decision, not the decision itself. scaffold-prompt needs a baseline to
    // distinguish "we changed it" from "they changed it"; `readBaseline` is declared, called,
    // and implemented nowhere, so every difference became a skipped conflict. If an entry
    // reappears in this mode, that silent-skip behaviour comes back with it.
    const manifest = fs.readFileSync(path.join(repoRoot, "publish", "content", "MANIFEST.yaml"), "utf8");
    const entries = manifest.match(/\{\s*src:[^}]*mode:\s*scaffold-prompt\s*\}/g) ?? [];
    expect(entries, "implement readBaseline before using scaffold-prompt again").to.deep.equal([]);
  });

  it("the shipped protocol source matches the one the renderer reads", () => {
    // FOUND WHILE WRITING THESE TESTS. publish/content/agent/session-protocol.md had drifted to
    // the pre-2026-09-11 protocol — no version marker — while every rendered harness file came
    // from agent/session-protocol.md at the repo root. So adopters were seeded with a stale
    // source alongside current renders: two copies, and the one shipped as authoritative was
    // the out-of-date one (POL-402).
    const shipped = fs.readFileSync(path.join(repoRoot, "publish", "content", "agent", "session-protocol.md"), "utf8");
    const source = fs.readFileSync(path.join(repoRoot, "agent", "session-protocol.md"), "utf8");
    expect(shipped, "publish/content's copy has drifted from the render source").to.equal(source);
  });
});
