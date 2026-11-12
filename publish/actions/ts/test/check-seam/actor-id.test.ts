// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// MO1 Q1b (2026-11-12): a CI record names the person by numeric GitHub user id too (`actor.id`, optional, additive),
// so gov-check can make the seat hash without asking GitHub. The repo's org id is learnt once per process.
import { expect } from "chai";
import { runContext } from "../../src/check-seam/record.js";
import { validate } from "../../src/check-seam/validate.js";
import { githubOrgIdProvider } from "../../src/cli/org-id.js";

const CI = { GITHUB_ACTIONS: "true", GITHUB_RUN_ID: "9", GITHUB_ACTOR: "dev1" };
const record = (actor: Record<string, unknown>) => ({
  schema: "gov-evidence/1", id: "01JA0000000000000000000000", org: { vcs: "github", id: 297356872 }, source: "ci",
  runKey: "gh:9:1:x", at: "2026-11-12T09:14:03Z", versions: { gov: "2.0.0" },
  kind: "check", repo: { id: 77, name: "acme/app" }, ref: { sha: "a".repeat(40) },
  rule: { id: "GOV-ACME-012" }, binding: { resource: "vcs.code-repo", event: "pull_request", action: "gov-builtin/list-membership" },
  verdict: "pass", class: "prevented", messageKey: "landed-by-pr.pass",
  actor,
});

describe("actor.id (MO1 Q1b)", () => {
  it("CI context carries GITHUB_ACTOR_ID as actor.id; absent or malformed → none", () => {
    expect(runContext({ ...CI, GITHUB_ACTOR_ID: "7001" }, "2.0.0").actor).to.include({ login: "dev1", id: 7001 });
    expect(runContext(CI, "2.0.0").actor).to.not.have.property("id");
    expect(runContext({ ...CI, GITHUB_ACTOR_ID: "07" }, "2.0.0").actor).to.not.have.property("id");
    expect(runContext({ ...CI, GITHUB_ACTOR_ID: "x1" }, "2.0.0").actor).to.not.have.property("id");
  });

  it("the schema takes a positive integer id, and still takes records without one", () => {
    const ok = (a: Record<string, unknown>) => validate("gov-evidence-1", record(a)).length === 0;
    expect(ok({ login: "dev1", kind: "human" })).to.equal(true);
    expect(ok({ login: "dev1", id: 7001, kind: "human" })).to.equal(true);
    expect(ok({ login: "dev1", id: 0, kind: "human" })).to.equal(false);
    expect(ok({ login: "dev1", id: "7001", kind: "human" })).to.equal(false);
  });
});

describe("githubOrgIdProvider", () => {
  it("CI's environment first; else gh, asked at most once; null when unknown", async () => {
    let asked = 0;
    const gh = () => { asked++; return "297356872\n"; };
    expect(await githubOrgIdProvider("acme", { GITHUB_REPOSITORY_OWNER_ID: "42" }, gh)()).to.equal(42);
    expect(asked).to.equal(0);
    const p = githubOrgIdProvider("acme", {}, gh);
    expect(await p()).to.equal(297356872);
    expect(await p()).to.equal(297356872);
    expect(asked).to.equal(1);
    expect(await githubOrgIdProvider("", {}, gh)()).to.equal(null);
    expect(await githubOrgIdProvider("bad name", {}, gh)()).to.equal(null);
    expect(await githubOrgIdProvider("acme", {}, () => null)()).to.equal(null);
  });
});

describe("gov licence install names the repo's org (MO1 Q3)", () => {
  const fake = (seen: unknown[]) => (async (_u: string, i: RequestInit) => {
    seen.push(JSON.parse(String(i.body)));
    return new Response(JSON.stringify({ token: "t" }), { status: 200 });
  }) as unknown as typeof fetch;

  it("sends org when known, and only the key when not", async () => {
    const { httpRegistryToken } = await import("../../src/cli/licence-run.js");
    const seen: unknown[] = [];
    await httpRegistryToken("https://lic.test", fake(seen), () => Promise.resolve(297356872))("k.e.y");
    await httpRegistryToken("https://lic.test", fake(seen))("k.e.y");
    await httpRegistryToken("https://lic.test", fake(seen), () => Promise.reject(new Error("gh")))("k.e.y");
    expect(seen).to.deep.equal([{ personalKey: "k.e.y", org: 297356872 }, { personalKey: "k.e.y" }, { personalKey: "k.e.y" }]);
  });
});
