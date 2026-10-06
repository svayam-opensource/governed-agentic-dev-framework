// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov app setup` / `gov app check` (rule-model-design.md, "gov-repo access": a GitHub App, no stopgap token).
 *
 * Over a fake `gh` and a fake loopback, except where the thing under test IS the real one: the loopback listener
 * (a real request to 127.0.0.1) and the no-key-in-a-log guarantee (a real run's log file, a real `gh` stand-in on
 * PATH, through the run-process chokepoint main.ts wires).
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  appCheck, appCommand, appDiagnostic, appManifest, appSetup, ghRunner, manifestPage, readGithubApp, withGithubApp,
  type AppConfig, type AppSetupDeps, type GhOutcome, type GhRun,
} from "../../src/cli/app-verb.js";
import { startLoopback, type StartLoopback } from "../../src/cli/app-loopback.js";
import { doctor } from "../../src/maintain/doctor.js";
import { endRun, startRun } from "../../src/log.js";

const PEM = "-----BEGIN RSA PRIVATE KEY-----\nMIIEsecretKEYmaterialDO-NOT-LEAK\n-----END RSA PRIVATE KEY-----\n";
const CFG: AppConfig = { home: "/gov", githubOrg: "acme", orgSlugLower: "acme", workspaceRepo: "acme-gov", defaultBranch: "main" };
const ORG_CONFIG = 'org_name: "Acme"\ngithub_org: "acme"\nservices:\n  vault: ""\n  oidc: ""\n\nauthorized_agents:\n  default: ""\n';
const ok = (stdout = ""): GhOutcome => ({ status: 0, stdout, stderr: "" });
const err = (stderr: string): GhOutcome => ({ status: 1, stdout: "", stderr });
const CONVERSION = JSON.stringify({ id: 42, slug: "gov-acme", client_id: "Iv23abc", pem: PEM, client_secret: "cs", webhook_secret: null });

interface Call { args: readonly string[]; input?: string }

/** A fake gh: the first matching route answers; every call is recorded. */
function fakeGh(routes: [RegExp, GhOutcome | ((c: Call) => GhOutcome)][], calls: Call[]): GhRun {
  return (args, input) => {
    const c: Call = { args, ...(input === undefined ? {} : { input }) };
    calls.push(c);
    const hit = routes.find(([re]) => re.test(args.join(" ")));
    if (!hit) return err("no route");
    return typeof hit[1] === "function" ? hit[1](c) : hit[1];
  };
}

/** A fake loopback that renders the page (so the manifest can be read back) and answers with `code`. */
function fakeLoopback(code: string | Error, seen: { page?: string; state?: string }): StartLoopback {
  return async (o) => {
    seen.page = o.page("http://127.0.0.1:5555/callback");
    seen.state = o.state;
    return { url: "http://127.0.0.1:5555/", code: code instanceof Error ? Promise.reject(code) : Promise.resolve(code), close: () => {} };
  };
}

function setupDeps(gh: GhRun, opts: { code?: string | Error; files?: Record<string, string>; seen?: { page?: string; state?: string } } = {}) {
  const files: Record<string, string> = { "/gov/org-config.yaml": ORG_CONFIG, ...(opts.files ?? {}) };
  const said: string[] = [];
  const writes: { file: string; text: string }[] = [];
  const deps: AppSetupDeps = {
    gh,
    loopback: fakeLoopback(opts.code ?? "code123", opts.seen ?? {}),
    readFile: (f) => files[f] ?? null,
    writeFile: (f, t) => { writes.push({ file: f, text: t }); files[f] = t; },
    say: (l) => said.push(l),
    newState: () => "st4te",
  };
  return { deps, files, said, writes };
}

const happyRoutes = (): [RegExp, GhOutcome][] => [
  [/^api \/apps\//, err("gh: Not Found (HTTP 404)")],
  [/^api -X POST \/app-manifests\/code123\/conversions$/, ok(CONVERSION)],
  [/^secret set /, ok()],
];

describe("gov app setup — the org's GitHub App, by the manifest flow", () => {
  it("asks GitHub for gov-<org_slug>: contents + metadata read, no webhook, private, redirect to the loopback", () => {
    const m = appManifest({ ...CFG, orgSlugLower: "AcMe" }, "http://127.0.0.1:9/callback");
    expect(m.name).to.equal("gov-acme");
    expect(m.default_permissions).to.deep.equal({ contents: "read", metadata: "read" });
    expect(m.hook_attributes.active).to.equal(false);
    expect(m.public).to.equal(false);
    expect(m.redirect_url).to.equal("http://127.0.0.1:9/callback");
    expect(m.default_events).to.deep.equal([]);
  });

  it("the one-shot page auto-POSTs the manifest to the ORG's new-App page, with the state, escaped", () => {
    const html = manifestPage(appManifest(CFG, "http://127.0.0.1:9/callback"), "acme", "s1");
    expect(html).to.contain('method="post" action="https://github.com/organizations/acme/settings/apps/new?state=s1"');
    expect(html).to.contain("document.forms[0].submit()");
    const value = /name="manifest" value="([^"]*)"/.exec(html)![1]!.replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&");
    expect(JSON.parse(value).name).to.equal("gov-acme");
  });

  it("happy path: code exchanged through gh api, both secrets set on STDIN, identity recorded, install URL printed", async () => {
    const calls: Call[] = [];
    const seen: { page?: string; state?: string } = {};
    const { deps, files, said } = setupDeps(fakeGh(happyRoutes(), calls), { seen });
    const r = await appSetup(deps, CFG);
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(seen.state).to.equal("st4te");
    expect(seen.page).to.contain("gov-acme").and.contain("127.0.0.1:5555/callback");
    expect(said.join("\n")).to.contain("http://127.0.0.1:5555/");

    expect(calls.some((c) => c.args.join(" ") === "api -X POST /app-manifests/code123/conversions")).to.equal(true);
    const sets = calls.filter((c) => c.args[0] === "secret");
    expect(sets.map((c) => c.args.join(" "))).to.deep.equal([
      "secret set GOV_APP_CLIENT_ID --org acme --visibility all",
      "secret set GOV_APP_PRIVATE_KEY --org acme --visibility all",
    ]);
    expect(sets[0]!.input).to.equal("Iv23abc");
    expect(sets[1]!.input, "the key goes on stdin").to.equal(PEM);

    expect(readGithubApp(files["/gov/org-config.yaml"])).to.deep.equal({ clientId: "Iv23abc", slug: "gov-acme" });
    const text = r.lines.join("\n");
    expect(text).to.contain("https://github.com/apps/gov-acme/installations/new");
    expect(text).to.contain("acme-gov").and.contain("gov app check");
  });

  it("THE KEY NEVER LEAVES EXCEPT ON STDIN: not an argument, not a line printed, not in any file written", async () => {
    const calls: Call[] = [];
    const { deps, said, writes } = setupDeps(fakeGh(happyRoutes(), calls));
    const r = await appSetup(deps, CFG);
    const secretBits = ["MIIEsecretKEY", "PRIVATE KEY"];
    for (const bit of secretBits) {
      expect(calls.flatMap((c) => c.args).join(" ")).to.not.contain(bit);
      expect([...r.lines, ...said].join("\n")).to.not.contain(bit);
      expect(writes.map((w) => w.text).join("\n")).to.not.contain(bit);
    }
    expect(writes.map((w) => w.file)).to.deep.equal(["/gov/org-config.yaml"]);
    expect(calls.filter((c) => c.input?.includes("MIIEsecretKEY")).map((c) => c.args[2])).to.deep.equal(["GOV_APP_PRIVATE_KEY"]);
  });

  it("a secret that cannot be set: exit 1, the App is still recorded, and the next steps say how — without the key", async () => {
    const calls: Call[] = [];
    const { deps, files } = setupDeps(fakeGh([
      [/^api \/apps\//, err("HTTP 404")],
      [/conversions$/, ok(CONVERSION)],
      [/GOV_APP_CLIENT_ID/, ok()],
      [/GOV_APP_PRIVATE_KEY/, err("HTTP 403: Must have admin rights")],
    ], calls));
    const r = await appSetup(deps, CFG);
    const text = r.lines.join("\n");
    expect(r.code).to.equal(1);
    expect(text).to.contain("GOV_APP_PRIVATE_KEY could not be set").and.contain("admin:org").and.contain("kept no copy");
    expect(text).to.not.contain("MIIEsecretKEY");
    expect(readGithubApp(files["/gov/org-config.yaml"])?.slug).to.equal("gov-acme");
  });

  it("the exchange fails: exit 1, nothing set, nothing written", async () => {
    const calls: Call[] = [];
    const { deps, writes } = setupDeps(fakeGh([[/^api \/apps\//, err("HTTP 404")], [/conversions$/, err("HTTP 404: Not Found")]], calls));
    const r = await appSetup(deps, CFG);
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.contain("single-use");
    expect(calls.some((c) => c.args[0] === "secret")).to.equal(false);
    expect(writes).to.deep.equal([]);
  });

  it("no answer from the browser: exit 1, gh never asked to convert anything", async () => {
    const calls: Call[] = [];
    const { deps } = setupDeps(fakeGh(happyRoutes(), calls), { code: new Error("no answer from GitHub within 600s") });
    const r = await appSetup(deps, CFG);
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.contain("no answer from GitHub");
    expect(calls.some((c) => c.args.join(" ").includes("conversions"))).to.equal(false);
  });

  it("a code that is not code-shaped never reaches a gh api path", async () => {
    const calls: Call[] = [];
    const { deps } = setupDeps(fakeGh(happyRoutes(), calls), { code: "../../user" });
    expect((await appSetup(deps, CFG)).code).to.equal(1);
    expect(calls.some((c) => c.args.join(" ").includes("conversions"))).to.equal(false);
  });

  it("an App already recorded and still on GitHub is not created twice", async () => {
    const calls: Call[] = [];
    const { deps } = setupDeps(fakeGh([[/^api \/apps\/gov-acme$/, ok("{}")]], calls),
      { files: { "/gov/org-config.yaml": withGithubApp(ORG_CONFIG, { clientId: "Iv1", slug: "gov-acme" }) } });
    const r = await appSetup(deps, CFG);
    expect(r.code).to.equal(0);
    expect(r.lines.join("\n")).to.contain("already has its App").and.contain("gov app check");
    expect(calls).to.have.length(1);
  });

  it("refuses without the org's names", async () => {
    const { deps } = setupDeps(fakeGh([], []));
    expect((await appSetup(deps, { ...CFG, githubOrg: "" })).code).to.equal(1);
  });
});

describe("services.github_app in org-config.yaml — the App's public identity", () => {
  it("adds the block inside services:, leaving the rest of the file as it was", () => {
    const out = withGithubApp(ORG_CONFIG, { clientId: "Iv1", slug: "gov-acme" });
    expect(out).to.contain('services:\n  vault: ""\n  oidc: ""\n  github_app:');
    expect(out).to.contain('    client_id: "Iv1"\n    slug: "gov-acme"\n\nauthorized_agents:');
    expect(readGithubApp(out)).to.deep.equal({ clientId: "Iv1", slug: "gov-acme" });
  });

  it("replaces an earlier block, never duplicates it", () => {
    const once = withGithubApp(ORG_CONFIG, { clientId: "Iv1", slug: "gov-acme" });
    const twice = withGithubApp(once, { clientId: "Iv2", slug: "gov-acme-2" });
    expect(twice.match(/github_app:/g)).to.have.length(1);
    expect(readGithubApp(twice)).to.deep.equal({ clientId: "Iv2", slug: "gov-acme-2" });
    expect(twice).to.contain("authorized_agents:");
  });

  it("adds services: when the file has none; an empty block reads as no App", () => {
    expect(readGithubApp(withGithubApp('org_name: "x"\n', { clientId: "a", slug: "b" }))).to.deep.equal({ clientId: "a", slug: "b" });
    expect(readGithubApp('services:\n  github_app:\n    client_id: ""\n    slug: ""\n')).to.equal(null);
    expect(readGithubApp(null)).to.equal(null);
  });
});

describe("gov app check — installed, reaching the governance repo, secrets set", () => {
  const INSTALLED = (over: Record<string, unknown> = {}): GhOutcome => ok(JSON.stringify({
    installations: [{ id: 7, app_slug: "gov-acme", client_id: "Iv1", suspended_at: null, repository_selection: "selected", permissions: { contents: "read", metadata: "read" }, ...over }],
  }));
  const REPOS = ok(JSON.stringify({ repositories: [{ full_name: "acme/acme-gov" }] }));
  const SECRETS = ok(JSON.stringify([{ name: "GOV_APP_CLIENT_ID", visibility: "ALL" }, { name: "GOV_APP_PRIVATE_KEY", visibility: "ALL" }]));
  const routes = (over: [RegExp, GhOutcome][] = []): [RegExp, GhOutcome][] => [
    ...over,
    [/^api \/orgs\/acme\/installations/, INSTALLED()],
    [/^api \/user\/installations\/7\/repositories/, REPOS],
    [/^api \/repos\/acme\/acme-gov\/branches\/main/, ok("main")],
    [/^secret list --org acme --json name,visibility$/, SECRETS],
  ];
  const run = (r: [RegExp, GhOutcome][], recorded = null as null | { clientId: string; slug: string }) => appCheck(fakeGh(r, []), CFG, recorded);

  it("all good: ok, every line a ✓", () => {
    const r = run(routes());
    expect(r.verdict, r.lines.join("\n")).to.equal("ok");
    expect(r.lines.every((l) => l.startsWith("  ✓"))).to.equal(true);
  });

  it("no such App: fail, and the next step is `gov app setup`", () => {
    const r = run(routes([[/^api \/orgs\/acme\/installations/, ok('{"installations":[]}')], [/^api \/apps\/gov-acme$/, err("gh: Not Found (HTTP 404)")]]));
    expect(r.verdict).to.equal("fail");
    expect(r.summary).to.contain("gov app setup");
  });

  it("the App exists but is not installed: fail, with the install URL", () => {
    const r = run(routes([[/^api \/orgs\/acme\/installations/, ok('{"installations":[]}')], [/^api \/apps\/gov-acme$/, ok("{}")]]));
    expect(r.verdict).to.equal("fail");
    expect(r.summary).to.contain("https://github.com/apps/gov-acme/installations/new");
  });

  it("uses the slug recorded in org-config, and matches by client id too", () => {
    const r = run(routes([[/^api \/orgs\/acme\/installations/, INSTALLED({ app_slug: "gov-acme-2", client_id: "Iv9" })]]), { clientId: "Iv9", slug: "gov-acme-2" });
    expect(r.verdict, r.lines.join("\n")).to.equal("ok");
  });

  it("installed but not on the governance repo: fail, naming where to add it", () => {
    const r = run(routes([[/^api \/user\/installations\/7\/repositories/, ok('{"repositories":[{"full_name":"acme/other"}]}')]]));
    expect(r.verdict).to.equal("fail");
    expect(r.summary).to.contain("cannot reach acme/acme-gov").and.contain("settings/installations/7");
  });

  it("suspended, or without contents access: fail", () => {
    expect(run(routes([[/^api \/orgs\/acme\/installations/, INSTALLED({ suspended_at: "2026-10-01" })]])).summary).to.contain("SUSPENDED");
    expect(run(routes([[/^api \/orgs\/acme\/installations/, INSTALLED({ permissions: { metadata: "read" } })]])).summary).to.contain("Contents: Read-only");
  });

  it("the default branch missing: fail, naming default_branch", () => {
    const r = run(routes([[/branches\/main/, err("gh: Branch not found (HTTP 404)")]]));
    expect(r.verdict).to.equal("fail");
    expect(r.summary).to.contain("default_branch");
  });

  it("a missing secret, or one hidden from the code repos: fail, with the command", () => {
    const one = run(routes([[/^secret list/, ok('[{"name":"GOV_APP_CLIENT_ID","visibility":"ALL"}]')]]));
    expect(one.verdict).to.equal("fail");
    expect(one.summary).to.contain("GOV_APP_PRIVATE_KEY is not set");
    const priv = run(routes([[/^secret list/, ok('[{"name":"GOV_APP_CLIENT_ID","visibility":"PRIVATE"},{"name":"GOV_APP_PRIVATE_KEY","visibility":"ALL"}]')]]));
    expect(priv.summary).to.contain("--visibility all");
  });

  it("OFFLINE is cannot-tell, never ok — and gov stops asking", () => {
    const calls: Call[] = [];
    const r = appCheck(fakeGh([[/./, err("error connecting to api.github.com")]], calls), CFG, null);
    expect(r.verdict).to.equal("cannot-tell");
    expect(r.summary).to.contain("did not answer");
    expect(calls).to.have.length(1);
  });

  it("a login that may not look is cannot-tell, with the scope to ask for", () => {
    const r = run(routes([
      [/^api \/orgs\/acme\/installations/, err("HTTP 403: Resource not accessible by integration")],
      [/^secret list/, err("HTTP 403: Must have admin rights")],
    ]));
    expect(r.verdict).to.equal("cannot-tell");
    expect(r.lines.join("\n")).to.contain("admin:org");
  });

  it("the verb: exit 0 on ok, 1 otherwise, 2 on usage", async () => {
    const { deps } = setupDeps(fakeGh(routes(), []));
    expect((await appCommand(["check"], {}, deps, CFG)).code).to.equal(0);
    const bad = setupDeps(fakeGh([[/./, err("timeout")]], [])).deps;
    const r = await appCommand(["check"], {}, bad, CFG);
    expect(r.code).to.equal(1);
    expect(r.lines.at(-1)).to.contain("COULD NOT TELL");
    expect((await appCommand([], {}, deps, CFG)).code).to.equal(2);
  });
});

describe("gov doctor — one GitHub App row, and it never says ok when it cannot tell", () => {
  const base = { gitPresent: true, ghPresent: true, resolve: { ok: false, code: 1 } as never, activeOrg: null, cliVersion: "1" };
  const row = (r: Parameters<typeof appDiagnostic>[0]) => doctor({ ...base, githubApp: r }).diagnostics.find((d) => d.name === "GitHub App");

  it("cannot tell → a warning that says `cannot tell`", () => {
    const d = row({ verdict: "cannot-tell", summary: "GitHub did not answer", lines: [] })!;
    expect(d.status).to.equal("warn");
    expect(d.detail).to.match(/^cannot tell/);
  });

  it("ok → ok; fail → a warning pointing at gov app check; not probed → no row", () => {
    expect(row({ verdict: "ok", summary: "fine", lines: [] })!.status).to.equal("ok");
    const f = row({ verdict: "fail", summary: "no App", lines: [] })!;
    expect(f.status).to.equal("warn");
    expect(f.detail).to.contain("gov app check");
    expect(doctor(base).diagnostics.some((d) => d.name === "GitHub App")).to.equal(false);
  });
});

describe("the loopback listener — real, on 127.0.0.1", function () {
  this.timeout(5000);

  it("serves the page, refuses a wrong state, and hands back the code from the right one", async () => {
    const s = await startLoopback({ page: (redirect) => `<p>${redirect}</p>`, state: "good", timeoutMs: 4000 });
    try {
      expect(s.url).to.match(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      expect(await (await fetch(s.url)).text()).to.contain(`${s.url}callback`);
      expect((await fetch(`${s.url}callback?code=abc&state=evil`)).status).to.equal(400);
      expect((await fetch(`${s.url}callback?code=abc&state=good`)).status).to.equal(200);
      expect(await s.code).to.equal("abc");
    } finally { s.close(); }
  });

  it("times out with an error, not a hang", async () => {
    const s = await startLoopback({ page: () => "", state: "x", timeoutMs: 50 });
    let msg = "";
    try { await s.code; } catch (e) { msg = (e as Error).message; }
    expect(msg).to.contain("no answer from GitHub");
  });
});

describe("the private key never reaches the run's log — a real run, a real gh stand-in", function () {
  this.timeout(20000);
  let root = "", logText = "", stdinSeen = "", savedPath = "";

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "gov-app-log-"));
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    // The stand-in answers the conversion with a key, and for `secret set` records only WHETHER stdin carried it.
    fs.writeFileSync(path.join(bin, "gh"), [
      "#!/bin/sh",
      'case "$*" in',
      '  "api /apps/"*) echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;',
      `  *conversions) printf '%s' '${JSON.stringify({ id: 1, slug: "gov-acme", client_id: "Iv23abc", pem: PEM }).replace(/\n/g, "\\n")}' ;;`,
      `  "secret set GOV_APP_PRIVATE_KEY"*) if cat | grep -q MIIEsecretKEY; then echo key-on-stdin >> "${root}/seen"; fi ;;`,
      '  "secret set"*) cat > /dev/null ;;',
      "esac",
    ].join("\n"), { mode: 0o755 });
    savedPath = process.env.PATH ?? "";
    process.env.PATH = `${bin}${path.delimiter}${savedPath}`;

    startRun({ argv: ["app", "setup"], command: "app", workRoot: root, login: "tester", version: "9" });
    const files: Record<string, string> = { "/gov/org-config.yaml": ORG_CONFIG };
    const r = await appSetup({
      gh: ghRunner("gov-work:test:app"),
      loopback: fakeLoopback("code123", {}),
      readFile: (f) => files[f] ?? null,
      writeFile: (f, t) => { files[f] = t; },
      say: () => {},
      newState: () => "s",
    }, CFG);
    expect(r.code, r.lines.join("\n")).to.equal(0);
    endRun(0);
    stdinSeen = fs.existsSync(path.join(root, "seen")) ? fs.readFileSync(path.join(root, "seen"), "utf8") : "";

    const d = new Date(), p = (n: number): string => String(n).padStart(2, "0");
    const dayDir = path.join(root, "preferences", "tester", "state", "logs", `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
    const runDir = fs.existsSync(dayDir) ? path.join(dayDir, fs.readdirSync(dayDir)[0]!) : "";
    for (let i = 0; i < 60 && runDir; i++) {
      const f = fs.existsSync(runDir) ? fs.readdirSync(runDir).find((n) => n.endsWith(".log")) : undefined;
      logText = f ? fs.readFileSync(path.join(runDir, f), "utf8") : "";
      if (logText.includes("run finished")) break;
      await new Promise((res) => setTimeout(res, 50));
    }
  });

  after(() => {
    process.env.PATH = savedPath;
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* gone */ }
  });

  it("gh received the key on stdin", () => {
    expect(stdinSeen).to.contain("key-on-stdin");
  });

  it("the log recorded the gh calls — and not a byte of the key", () => {
    expect(logText, "the run's log was written").to.contain("run finished");
    expect(logText).to.contain("conversions").and.contain("GOV_APP_PRIVATE_KEY");
    expect(logText).to.not.contain("MIIEsecretKEY");
    expect(logText).to.not.contain("PRIVATE KEY-----");
  });
});
