// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// THE gov-checks WORKFLOW AND EVIDENCE (spec 02 §4.1, X13, A11 static half, A19 CI surface).
// Every job is rendered the same for a subscribed org and an unsubscribed one (one render, no flap): `id-token:
// write`, and optional evidence steps that are skipped unless the org turned evidence on (`gov evidence enable` sets
// the App's org secrets). The steps use the job's OIDC identity only — no licensing secret is referenced — and every
// one of them is non-fatal: a refusal or an outage leaves the checks to run, and judge, exactly as before.
import { expect } from "chai";
import yaml from "js-yaml";
import http from "node:http";
import { execFile } from "node:child_process";
import { validate } from "../../../src/check-seam/validate.js";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { renderWorkflow } from "../../../src/rules/checks/render-github.js";
import type { CheckBinding } from "../../../src/rules/model/catalog.js";

const b = (id: string, resource: string, event: string, action: string): { id: string; check: CheckBinding } =>
  ({ id, check: { on: { resource, event }, action, with: {}, on_miss: "fail" } });

const BINDINGS = [b("GOV-ACME-001", "vcs.code-repo", "pull_request", "gov-builtin/list-membership")];

describe("gov-checks workflow — evidence steps (X13, A11, A19)", () => {
  const text = (o = {}) => renderWorkflow(BINDINGS, { govCheckout: { repository: "acme/acme-gov" }, ...o })[0]!.text;

  it("every job asks for the OIDC token — the render does not depend on a subscription", () => {
    expect(text()).to.match(/permissions:\n(?:\s+\S+: \w+\n)*\s+id-token: write/);
  });

  it("the evidence steps are gated on the App secret, which only an org that turned evidence on has", () => {
    const t = text();
    expect(t).to.contain("GOV_EVIDENCE_APP_CLIENT_ID");
    expect(t).to.match(/GOV_EVIDENCE_ENABLED: \$\{\{ secrets\.GOV_EVIDENCE_APP_CLIENT_ID != '' \}\}/);
    expect(t.match(/if: env\.GOV_EVIDENCE_ENABLED == 'true'/g)!.length).to.be.greaterThan(1);
  });

  it("every evidence step is non-fatal (continue-on-error), so a 403 or an outage never changes a verdict", () => {
    const t = text();
    const steps = t.split("\n      - ").filter((s) => /Evidence/.test(s.split("\n")[0]!));
    expect(steps.length).to.be.greaterThan(1);
    for (const s of steps) expect(s, s.split("\n")[0]).to.contain("continue-on-error: true");
  });

  it("licensing runs on OIDC alone: no stored licensing secret is referenced (A11 static half)", () => {
    const refs = [...text().matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    expect(refs.filter((r) => /LICEN[CS]E|GOV_KEY|GOV_CHECK/i.test(r!))).to.deep.equal([]);
    // The only secrets are the two GitHub Apps' (read the gov repo; write the evidence branch).
    expect(new Set(refs)).to.deep.equal(new Set(["GOV_APP_CLIENT_ID", "GOV_APP_PRIVATE_KEY", "GOV_EVIDENCE_APP_CLIENT_ID", "GOV_EVIDENCE_APP_PRIVATE_KEY"]));
  });

  it("asks GitHub for the token with audience gov-evidence, exchanges it at the lease endpoint, installs @svayam/gov-check with the returned registry token", () => {
    const t = text();
    expect(t).to.contain("audience=gov-evidence");
    expect(t).to.contain("/leases/oidc");
    // The SAME range the laptop installs: gov-check ships 2.0.0-next.N first, and a bare `^2` matches no prerelease —
    // the CI install would find nothing to install until a stable 2.0.0 existed.
    expect(t).to.contain('"@svayam/gov-check@^2.0.0-next.0"');
    expect(t).to.not.contain('"@svayam/gov-check@^2"');
    expect(t).to.contain("::add-mask::");
  });

  it("a refusal prints ONE ::notice and the job carries on", () => {
    const t = text();
    expect((t.match(/::notice title=gov evidence::/g) ?? []).length).to.equal(1);
    expect(t).to.contain("r.status === 403");
  });

  it("the module writes with the evidence App's token, to the gov repo's gov/evidence branch only", () => {
    const t = text();
    expect(t).to.contain("GOV_EVIDENCE_TOKEN: ${{ steps.evidence-token.outputs.token }}");
    expect(t).to.contain("GOV_EVIDENCE_REMOTE: https://github.com/acme/acme-gov.git");
    expect(t).to.contain("permission-contents: write");
  });

  it("the governance repo's own workflow is unchanged: no evidence steps, no App token", () => {
    const t = renderWorkflow([b("GOV-FRM-455", "vcs.gov-repo", "pull_request", "gov-builtin/section-owner-approval")])[0]!.text;
    expect(t).to.not.contain("Evidence");
    expect(t).to.not.contain("GOV_EVIDENCE");
  });

  it("the rendered YAML parses, and the lease script embedded in it is valid JavaScript with its escapes intact", () => {
    const doc = yaml.load(text()) as { jobs: Record<string, { steps: { id?: string; run?: string }[] }> };
    const step = Object.values(doc.jobs)[0]!.steps.find((s) => s.id === "evidence-install")!;
    const m = /-e '\n([\s\S]*)\n'$/.exec(step.run!.trim());
    expect(m, "script between the quotes").to.not.equal(null);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gov-lease-"));
    const f = path.join(dir, "lease.mjs");
    fs.writeFileSync(f, m![1]!);
    execFileSync(process.execPath, ["--check", f]);
    fs.rmSync(dir, { recursive: true, force: true });
    expect(m![1]).to.contain("replace(/\\.\\d+Z$/").and.contain('"installed=true\\n"');
  });

  it("deterministic: two renders are byte-identical", () => {
    expect(text()).to.equal(text());
  });
});

// The embedded lease script, RUN against local stand-ins for GitHub's token endpoint and the licence service
// (127.0.0.1 only — no real host). It must send exactly one schema-valid body, and handle 403 / outage quietly.
describe("gov-checks workflow — the embedded lease script, run locally (A11, A19, I02.3)", () => {
  const script = (): string => {
    const doc = yaml.load(renderWorkflow(BINDINGS, { govCheckout: { repository: "acme/acme-gov" } })[0]!.text) as { jobs: Record<string, { steps: { id?: string; run?: string }[] }> };
    const run = Object.values(doc.jobs)[0]!.steps.find((x) => x.id === "evidence-install")!.run!.trim();
    return /-e '\n([\s\S]*)\n'$/.exec(run)![1]!;
  };

  async function runScript(licence: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void) {
    const seen: { url: string; body: string }[] = [];
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        seen.push({ url: req.url ?? "", body });
        if (req.url?.startsWith("/oidc")) { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ value: "oidc.jwt.token" })); return; }
        licence(req, body, res);
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gov-lease-run-"));
    const f = path.join(dir, "lease.mjs");
    fs.writeFileSync(f, script());
    const out = path.join(dir, "output");
    fs.writeFileSync(out, "");
    const r = await new Promise<{ code: number | null; stdout: string }>((resolve) => {
      execFile(process.execPath, [f], {
        env: { PATH: process.env.PATH, RUNNER_TEMP: dir, GITHUB_OUTPUT: out,
          ACTIONS_ID_TOKEN_REQUEST_URL: `http://127.0.0.1:${port}/oidc?api-version=2`, ACTIONS_ID_TOKEN_REQUEST_TOKEN: "rt",
          GOV_LICENCE_API: `http://127.0.0.1:${port}/api/v1` },
      }, (err, stdout) => resolve({ code: err ? (err as { code?: number }).code ?? 1 : 0, stdout }));
    });
    server.close();
    const outputs = fs.readFileSync(out, "utf8");
    const npmrc = fs.existsSync(path.join(dir, "gov-check.npmrc")) ? fs.readFileSync(path.join(dir, "gov-check.npmrc"), "utf8") : null;
    fs.rmSync(dir, { recursive: true, force: true });
    return { ...r, seen, outputs, npmrc };
  }

  it("a subscribed org: audience gov-evidence, ONE schema-valid lease body, registry token masked and written only to the runner's temp", async () => {
    const r = await runScript((_q, _b, res) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ registryToken: "reg-secret-token", lease: "l", licence: "p" })); });
    expect(r.code).to.equal(0);
    expect(r.seen[0]!.url).to.contain("audience=gov-evidence");
    const lease = r.seen.filter((x) => x.url.startsWith("/api/v1/leases/oidc"));
    expect(lease).to.have.length(1);
    const body = JSON.parse(lease[0]!.body) as Record<string, unknown>;
    expect(validate("lease-request", body)).to.deep.equal([]);
    expect(Object.keys(body).sort()).to.deep.equal(["counts", "oidcToken", "writerPub"]);
    expect(r.stdout).to.contain("::add-mask::reg-secret-token");
    expect(r.outputs).to.contain("installed=true");
    // Basic auth (user gov-registry): the registry's gate plugin never sees a Bearer `_authToken` (Verdaccio 401s it).
    const basic = Buffer.from("gov-registry:reg-secret-token").toString("base64");
    expect(r.npmrc).to.contain("//npm.svayamtech.com/:_auth=" + basic);
    expect(r.npmrc).to.not.contain("_authToken=reg-secret-token");
    expect(r.npmrc.split("\n")).to.include("registry=https://registry.npmjs.org/");   // public deps never ride the gov token
    expect(r.stdout).to.contain("::add-mask::" + basic);
    expect(r.stdout).to.not.contain("::notice");
  });

  it("an unsubscribed org (403): exactly one ::notice, exit 0, nothing installed", async () => {
    const r = await runScript((_q, _b, res) => { res.statusCode = 403; res.end("{}"); });
    expect(r.code).to.equal(0);
    expect((r.stdout.match(/::notice title=gov evidence::/g) ?? []).length).to.equal(1);
    expect(r.outputs).to.not.contain("installed=true");
    expect(r.npmrc).to.equal(null);
  });

  it("an outage (500): silent, exit 0, nothing installed", async () => {
    const r = await runScript((_q, _b, res) => { res.statusCode = 500; res.end("boom"); });
    expect(r.code).to.equal(0);
    expect(r.stdout).to.not.contain("::notice");
    expect(r.outputs).to.not.contain("installed=true");
  });
});
