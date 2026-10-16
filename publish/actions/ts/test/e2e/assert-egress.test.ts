// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// THE TRAFFIC ASSERTER (spec 02 A18, plan E24). assert-egress.py reads what a proxy recorded during the evidence
// journey and fails unless only portal loads, licence exchanges and registry reads reached Svayam — with a lease body
// that fits the schema and no canary anywhere. Run here over RECORDED FIXTURES: an allowed flow passes; a lease body
// with an extra field fails; a planted leak (a rule id in a Svayam-bound body) fails — the negative control, proving
// the scan can fail. No network, no proxy.
import { expect } from "chai";
import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tool = path.resolve(here, "../../e2e/traffic-capture/assert-egress.py");
const schemaFile = path.resolve(here, "../../src/check-seam/schemas/lease-request.schema.json");
const havePython = spawnSync("python3", ["--version"]).status === 0;

const COUNTS = { window: { from: "2026-10-13T00:00:00Z", to: "2026-10-13T00:00:00Z" }, writer: "wk-abc", records: 3, agentRecords: 1, judgeCalls: 0, gaps: 0, activeActors90d: 2, repos: 1 };
const WRITER = { kty: "OKP", crv: "Ed25519", x: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo" };
const SHA = "9f8e7d6c5b4a39281706f5e4d3c2b1a099887766";
const RULE = "GOV-ACME-012";
const b64 = (o: unknown): string => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64");
const flow = (host: string, method: string, p: string, body: unknown = "", status = 200) =>
  ({ host, method, path: p, svayam: /svayamtech\.com$/.test(host), body_b64: /svayamtech\.com$/.test(host) ? b64(body) : "", body_len: 0, status, has_auth: false });
const jwt = (claims: object): string => ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");

function audit(flows: object[], extra: string[] = []): { code: number; out: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gov-egress-"));
  fs.writeFileSync(path.join(dir, "flows.jsonl"), flows.map((f) => JSON.stringify(f)).join("\n") + "\n");
  fs.writeFileSync(path.join(dir, "canaries.txt"), [RULE, SHA, "planted-unique-string-7731", "acme/app", "src/secret-file.ts"].join("\n") + "\n");
  const r = spawnSync("python3", [tool, "--flows", path.join(dir, "flows.jsonl"), "--canaries", path.join(dir, "canaries.txt"), "--schema", schemaFile, ...extra], { encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: r.status ?? 1, out: `${r.stdout}${r.stderr}` };
}

const ALLOWED = [
  flow("portal-uat.svayamtech.com", "GET", "/"),
  flow("auth-uat.svayamtech.com", "POST", "/oauth/token", "grant_type=authorization_code&code=abc"),
  flow("gov-uat.svayamtech.com", "POST", "/api/v1/leases", { personalKey: "k.k.k", writerPub: WRITER, counts: COUNTS }),
  flow("gov-uat.svayamtech.com", "POST", "/api/v1/leases/oidc", { oidcToken: jwt({ repository: "acme/app", sha: SHA, actor: "dev1" }), writerPub: WRITER, counts: COUNTS }),
  flow("gov-uat.svayamtech.com", "GET", "/api/v1/keys/personal"),
  flow("npm.svayamtech.com", "GET", "/@svayam%2fgov-check"),
  flow("api.github.com", "POST", `/repos/acme/app/statuses/${SHA}`, "x"),
  flow("registry.npmjs.org", "GET", "/chai"),
];

describe("traffic capture — assert-egress over recorded fixtures (A18)", function () {
  this.timeout(60_000);
  before(function () { if (!havePython) this.skip(); });

  it("an allowed journey passes — including GitHub's own OIDC token naming repo and sha (the ruled Q3 exception)", () => {
    const r = audit(ALLOWED);
    expect(r.code, r.out).to.equal(0);
    expect(JSON.parse(r.out.split("\n")[0]!)).to.include({ problems: 0, svayam_bound: 6 });
  });

  it("a lease body with an extra field fails", () => {
    const bad = flow("gov-uat.svayamtech.com", "POST", "/api/v1/leases", { personalKey: "k", writerPub: WRITER, counts: COUNTS, chainHead: "ab".repeat(32) });
    const r = audit([...ALLOWED, bad]);
    expect(r.code).to.equal(1);
    expect(r.out).to.match(/lease body.*chainHead.*not allowed/);
  });

  it("a lease count that is not a number fails", () => {
    const bad = flow("gov-uat.svayamtech.com", "POST", "/api/v1/leases", { personalKey: "k", writerPub: WRITER, counts: { ...COUNTS, records: "acme/app" } });
    expect(audit([bad]).code).to.equal(1);
  });

  it("NEGATIVE CONTROL: a planted leak (a rule id in a Svayam-bound body) fails and names the flow", () => {
    const leak = flow("portal-uat.svayamtech.com", "POST", "/api/telemetry", { note: `rule ${RULE} failed` });
    const r = audit([...ALLOWED, leak]);
    expect(r.code).to.equal(1);
    expect(r.out).to.match(/LEAK.*GOV-ACME-01/);
    expect(r.out).to.contain("POST portal-uat.svayamtech.com/api/telemetry");
  });

  it("each canary kind is caught: sha, repo name, file name, planted string — in a body or a path", () => {
    for (const c of [SHA, "acme/app", "src/secret-file.ts", "planted-unique-string-7731"]) {
      expect(audit([flow("npm.svayamtech.com", "GET", `/pkg?x=${c}`)]).code, c).to.equal(1);
      expect(audit([flow("portal-uat.svayamtech.com", "POST", "/x", c)]).code, c).to.equal(1);
    }
  });

  it("a leak hidden in a lease body OUTSIDE the oidcToken still fails", () => {
    const bad = flow("gov-uat.svayamtech.com", "POST", "/api/v1/leases/oidc", { oidcToken: jwt({ sha: SHA }), writerPub: WRITER, counts: { ...COUNTS, writer: RULE } });
    expect(audit([bad]).code).to.equal(1);
  });

  it("a request to any other Svayam path or method fails (evidence upload, registry write)", () => {
    expect(audit([flow("gov-uat.svayamtech.com", "POST", "/api/v1/evidence", {})]).code).to.equal(1);
    expect(audit([flow("npm.svayamtech.com", "PUT", "/@svayam%2fgov-check", {})]).code).to.equal(1);
  });

  it("a host that is not Svayam, GitHub, npmjs or an allowed provider fails; --allow-host admits the judge's", () => {
    const f = flow("api.anthropic.com", "POST", "/v1/messages", "x");
    expect(audit([f]).code).to.equal(1);
    expect(audit([f], ["--allow-host", "api.anthropic.com"]).code).to.equal(0);
  });

  it("an unsubscribed org: no Svayam-bound request at all", () => {
    expect(audit([flow("api.github.com", "GET", "/user"), flow("registry.npmjs.org", "GET", "/x")], ["--expect-no-svayam"]).code).to.equal(0);
    const r = audit([flow("api.github.com", "GET", "/user"), flow("gov-uat.svayamtech.com", "POST", "/api/v1/leases/oidc", {})], ["--expect-no-svayam"]);
    expect(r.code).to.equal(1);
    expect(r.out).to.match(/unsubscribed org must make no Svayam-bound request/);
  });

  it("the python files are valid", () => {
    for (const f of ["assert-egress.py", "svayam_egress.py"]) execFileSync("python3", ["-m", "py_compile", path.resolve(here, "../../e2e/traffic-capture", f)], { env: { ...process.env, PYTHONPYCACHEPREFIX: os.tmpdir() } });
  });
});
