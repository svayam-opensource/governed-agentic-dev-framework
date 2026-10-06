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
import { generateKeyPairSync } from "node:crypto";
import {
  appCheck, appCommand, appDiagnostic, appManifest, appRotate, appSetup, ghRunner, keyFingerprint, manifestPage, readGithubApp,
  secretsDiagnostic, withGithubApp, type AppConfig, type AppSetupDeps, type GhOutcome, type GhRun,
} from "../../src/cli/app-verb.js";
import { startLoopback, type StartLoopback } from "../../src/cli/app-loopback.js";
import { doctor } from "../../src/maintain/doctor.js";
import { endRun, startRun } from "../../src/log.js";
import { chooseModel } from "../../src/rules/propose/providers/index.js";

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
  [/^api \/orgs\/acme --jq \.plan\.name$/, ok("team")],
  [/^api \/repos\/[^ ]+ --jq \.visibility$/, ok("private")],
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
  const SECRETS = ok(JSON.stringify([{ name: "GOV_APP_CLIENT_ID", visibility: "ALL" }, { name: "GOV_APP_PRIVATE_KEY", visibility: "ALL" }]));
  const routes = (over: [RegExp, GhOutcome][] = []): [RegExp, GhOutcome][] => [
    ...over,
    [/^api \/orgs\/acme\/installations/, INSTALLED()],
    [/^api \/repos\/acme\/acme-gov\/branches\/main/, ok("main")],
    [/^secret list --org acme --json name,visibility$/, SECRETS],
  ];
  const run = (r: [RegExp, GhOutcome][], recorded = null as null | { clientId: string; slug: string }) => appCheck(fakeGh(r, []), CFG, recorded);

  it("all good on ALL repositories: ok, every line a ✓, and it reaches the governance repo", () => {
    const r = run(routes([[/^api \/orgs\/acme\/installations/, INSTALLED({ repository_selection: "all" })]]));
    expect(r.verdict, r.lines.join("\n")).to.equal("ok");
    expect(r.lines.every((l) => l.startsWith("  ✓"))).to.equal(true);
    expect(r.lines.join("\n")).to.contain("it reaches acme/acme-gov");
  });

  // SANDBOX FINDING (PRJ-121, 2026-10-07): /user/installations/{id}/repositories needs a GitHub-App USER token, so with
  // an ordinary `gh` login it always said "cannot tell". An owner's token reads the installation's repository_selection
  // and nothing finer — so for "selected" gov says what it did NOT verify and where it will be proven.
  it("SELECTED repositories: never asks the user-token endpoint, never claims the reach — names where it is proven", () => {
    const calls: Call[] = [];
    const r = appCheck(fakeGh(routes(), calls), CFG, null);
    expect(calls.map((c) => c.args.join(" ")).some((a) => a.includes("/user/installations")), "no user-token endpoint").to.equal(false);
    expect(r.verdict, r.lines.join("\n")).to.equal("ok");
    const reach = r.lines.find((l) => l.includes("selected repositories"))!;
    expect(reach, r.lines.join("\n")).to.match(/^ {2}· not verified here:/);
    expect(reach).to.contain("first code-repo check run").and.contain("https://github.com/organizations/acme/settings/installations/7");
    expect(r.lines.filter((l) => l.startsWith("  ✓")).join("\n")).to.not.contain("reaches");
    expect(r.summary, "the ok summary must not claim the reach").to.not.contain("reads acme/acme-gov@main");
    expect(r.summary).to.contain("first code-repo check run");
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

// ── SECRETS ON FREE + PRIVATE (sandbox finding, svayam-e2e, 2026-10-07; Policy Owner ruling: per-repo secrets +
// detection). On GitHub Free an org secret is not given to a private repository — the job sees it empty.
const REAL_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const REAL_KEY_2 = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" }).toString();
const keyBits = (pem: string): string => pem.split("\n")[5]!;
const freeRoutes = (over: [RegExp, GhOutcome][] = []): [RegExp, GhOutcome][] => [
  ...over,
  [/^api \/apps\//, err("gh: Not Found (HTTP 404)")],
  [/^api \/orgs\/acme --jq \.plan\.name$/, ok("free")],
  [/^api \/repos\/acme\/site --jq \.visibility$/, ok("public")],
  [/^api \/repos\/[^ ]+ --jq \.visibility$/, ok("private")],
  [/^api -X POST \/app-manifests\/code123\/conversions$/, ok(CONVERSION)],
  [/^secret set /, ok()],
];

describe("gov app setup — secrets where they reach (Free + private)", () => {
  it("Free plan, private gov repo + private code repo: NO org secret, repository secrets on both, the key on stdin only", async () => {
    const calls: Call[] = [];
    const { deps, said, writes } = setupDeps(fakeGh(freeRoutes(), calls));
    const r = await appSetup({ ...deps, codeRepos: () => ({ ok: true, names: ["app"] }) }, CFG);
    expect(r.code, r.lines.join("\n")).to.equal(0);
    const sets = calls.filter((c) => c.args[0] === "secret").map((c) => c.args.join(" "));
    expect(sets).to.deep.equal([
      "secret set GOV_APP_CLIENT_ID -R acme/acme-gov", "secret set GOV_APP_PRIVATE_KEY -R acme/acme-gov",
      "secret set GOV_APP_CLIENT_ID -R acme/app", "secret set GOV_APP_PRIVATE_KEY -R acme/app",
    ]);
    expect(calls.filter((c) => c.input === PEM).map((c) => c.args.join(" "))).to.deep.equal([
      "secret set GOV_APP_PRIVATE_KEY -R acme/acme-gov", "secret set GOV_APP_PRIVATE_KEY -R acme/app",
    ]);
    const text = [...r.lines, ...said].join("\n");
    expect(text).to.contain("Free plan").and.contain("acme/app");
    for (const bit of ["MIIEsecretKEY", "PRIVATE KEY"]) {
      expect(calls.flatMap((c) => c.args).join(" ")).to.not.contain(bit);
      expect(text).to.not.contain(bit);
      expect(writes.map((w) => w.text).join("\n")).to.not.contain(bit);
    }
  });

  it("a public code repo on Free gets the org secret; the private gov repo gets repository secrets", async () => {
    const calls: Call[] = [];
    const { deps } = setupDeps(fakeGh(freeRoutes(), calls));
    await appSetup({ ...deps, codeRepos: () => ({ ok: true, names: ["site"] }) }, CFG);
    const sets = calls.filter((c) => c.args[0] === "secret").map((c) => c.args.join(" "));
    expect(sets).to.include("secret set GOV_APP_PRIVATE_KEY --org acme --visibility all").and.include("secret set GOV_APP_PRIVATE_KEY -R acme/acme-gov");
    expect(sets).to.not.include("secret set GOV_APP_PRIVATE_KEY -R acme/site");
  });

  it("the board unreadable: the gov repo is still covered, and a repo added later is told to `gov app rotate`", async () => {
    const { deps } = setupDeps(fakeGh(freeRoutes(), []));
    const r = await appSetup({ ...deps, codeRepos: () => ({ ok: false, reason: "no project branch" }) }, CFG);
    expect(r.code).to.equal(0);
    expect(r.lines.join("\n")).to.contain("no project branch").and.contain("gov app rotate");
  });

  it("a repository that refuses its secret: exit 1, the repo named, the fix is `gov app rotate`", async () => {
    const { deps } = setupDeps(fakeGh(freeRoutes([[/-R acme\/app$/, err("HTTP 403: Must have admin rights")]]), []));
    const r = await appSetup({ ...deps, codeRepos: () => ({ ok: true, names: ["app"] }) }, CFG);
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.contain("acme/app").and.contain("gov app rotate").and.not.contain("MIIEsecretKEY");
  });

  it("records the key's public fingerprint (never the key) so a later rotate can name the key to delete", async () => {
    const conv = JSON.stringify({ id: 42, slug: "gov-acme", client_id: "Iv23abc", pem: REAL_KEY });
    const { deps, files } = setupDeps(fakeGh(freeRoutes([[/conversions$/, ok(conv)]]), []));
    await appSetup(deps, CFG);
    const id = readGithubApp(files["/gov/org-config.yaml"])!;
    expect(id.keyFingerprint).to.equal(keyFingerprint(REAL_KEY));
    expect(id.keyFingerprint).to.match(/^SHA256:[A-Za-z0-9+/]+=*$/);
    expect(files["/gov/org-config.yaml"]).to.not.contain(keyBits(REAL_KEY));
  });
});

describe("gov app rotate — a new key onto every repo that needs it; gov never keeps a key", () => {
  const recorded = { "/gov/org-config.yaml": withGithubApp(ORG_CONFIG, { clientId: "Iv1", slug: "gov-acme", keyFingerprint: "SHA256:oldOLDold=" }) };
  const rotateDeps = (gh: GhRun, over: Partial<AppSetupDeps> = {}, files: Record<string, string> = {}) => {
    const s = setupDeps(gh, { files: { ...recorded, ...files } });
    const removed: string[] = [];
    const deps: AppSetupDeps = { ...s.deps, codeRepos: () => ({ ok: true, names: ["app"] }), removeFile: (f) => { removed.push(f); delete s.files[f]; }, ...over };
    return { ...s, deps, removed };
  };

  it("without a key: the App's settings URL (GitHub has no API to make a key) and how to hand it over; nothing set", async () => {
    const calls: Call[] = [];
    const { deps } = rotateDeps(fakeGh(freeRoutes(), calls));
    const r = await appRotate(deps, CFG, {});
    expect(r.code).to.equal(1);
    const text = r.lines.join("\n");
    expect(text).to.contain("https://github.com/organizations/acme/settings/apps/gov-acme").and.contain("--key-from-stdin").and.contain("--key-file");
    expect(calls.some((c) => c.args[0] === "secret")).to.equal(false);
  });

  it("--key-from-stdin: repository secrets on every repo that needs them, the old key named for deletion, the new fingerprint recorded", async () => {
    const calls: Call[] = [];
    const { deps, files, writes } = rotateDeps(fakeGh(freeRoutes(), calls), { readStdin: () => REAL_KEY });
    const r = await appRotate(deps, CFG, { "key-from-stdin": true });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(calls.filter((c) => c.input === REAL_KEY).map((c) => c.args.join(" "))).to.deep.equal([
      "secret set GOV_APP_PRIVATE_KEY -R acme/acme-gov", "secret set GOV_APP_PRIVATE_KEY -R acme/app",
    ]);
    expect(calls.filter((c) => c.args[2] === "GOV_APP_CLIENT_ID").every((c) => c.input === "Iv1")).to.equal(true);
    const text = r.lines.join("\n");
    expect(text).to.contain("SHA256:oldOLDold=").and.contain("delete").and.contain("https://github.com/organizations/acme/settings/apps/gov-acme");
    expect(text).to.contain(keyFingerprint(REAL_KEY)!);
    expect(readGithubApp(files["/gov/org-config.yaml"])!.keyFingerprint).to.equal(keyFingerprint(REAL_KEY));
    for (const t of [text, calls.flatMap((c) => c.args).join(" "), writes.map((w) => w.text).join("\n")]) expect(t).to.not.contain(keyBits(REAL_KEY));
  });

  it("--key-file: reads the file, DELETES it after use, and says so", async () => {
    const { deps, removed } = rotateDeps(fakeGh(freeRoutes(), []), {}, { "/dl/gov-acme.pem": REAL_KEY_2 });
    const r = await appRotate(deps, CFG, { "key-file": "/dl/gov-acme.pem" });
    expect(r.code, r.lines.join("\n")).to.equal(0);
    expect(removed).to.deep.equal(["/dl/gov-acme.pem"]);
    expect(r.lines.join("\n")).to.contain("Deleted /dl/gov-acme.pem");
  });

  it("--key-file deleted even when a repo refuses the secret — gov never leaves a key behind", async () => {
    const { deps, removed } = rotateDeps(fakeGh(freeRoutes([[/-R acme\/app$/, err("HTTP 403")]]), []), {}, { "/dl/k.pem": REAL_KEY_2 });
    const r = await appRotate(deps, CFG, { "key-file": "/dl/k.pem" });
    expect(r.code).to.equal(1);
    expect(removed).to.deep.equal(["/dl/k.pem"]);
  });

  it("a file that is not a private key: refused, nothing set, the file left alone", async () => {
    const calls: Call[] = [];
    const { deps, removed } = rotateDeps(fakeGh(freeRoutes(), calls), {}, { "/dl/notes.txt": "hello" });
    const r = await appRotate(deps, CFG, { "key-file": "/dl/notes.txt" });
    expect(r.code).to.equal(1);
    expect(r.lines.join("\n")).to.contain("not a private key");
    expect(removed).to.deep.equal([]);
    expect(calls.some((c) => c.args[0] === "secret")).to.equal(false);
  });

  it("no App recorded: refused — run `gov app setup`; both flags at once: usage", async () => {
    const s = setupDeps(fakeGh(freeRoutes(), []));
    expect((await appRotate({ ...s.deps, readStdin: () => REAL_KEY }, CFG, { "key-from-stdin": true })).lines.join("\n")).to.contain("gov app setup");
    const { deps } = rotateDeps(fakeGh(freeRoutes(), []));
    expect((await appRotate(deps, CFG, { "key-from-stdin": true, "key-file": "x" })).code).to.equal(2);
  });

  it("is reachable as `gov app rotate`", async () => {
    const { deps } = rotateDeps(fakeGh(freeRoutes(), []), { readStdin: () => REAL_KEY });
    expect((await appCommand(["rotate"], { "key-from-stdin": true }, deps, CFG)).code).to.equal(0);
  });
});

describe("gov app check / gov doctor — each repo that will not receive a needed secret, with the fix", () => {
  const INSTALLED = ok(JSON.stringify({ installations: [{ id: 7, app_slug: "gov-acme", client_id: "Iv1", suspended_at: null, repository_selection: "all", permissions: { contents: "read" } }] }));
  const base = (over: [RegExp, GhOutcome][] = []): [RegExp, GhOutcome][] => [
    ...over,
    [/^api \/orgs\/acme\/installations/, INSTALLED],
    [/^api \/repos\/acme\/acme-gov\/branches\/main/, ok("main")],
    [/^secret list --org acme --json name,visibility$/, ok("[]")],
    [/^api \/orgs\/acme --jq \.plan\.name$/, ok("free")],
    [/^api \/repos\/[^ ]+ --jq \.visibility$/, ok("private")],
    [/^secret list -R acme\/acme-gov --json name$/, ok('[{"name":"GOV_APP_CLIENT_ID"},{"name":"GOV_APP_PRIVATE_KEY"}]')],
    [/^secret list -R acme\/app --json name$/, ok("[]")],
  ];

  it("Free + private code repo without the App secrets: ✗ naming the repo and `gov app rotate`; the org secrets are not demanded", () => {
    const r = appCheck(fakeGh(base(), []), CFG, null, { codeRepos: { ok: true, names: ["app"] } });
    expect(r.verdict, r.lines.join("\n")).to.equal("fail");
    const text = r.lines.join("\n");
    expect(text).to.contain("acme/app will not receive GOV_APP_PRIVATE_KEY").and.contain("gov app rotate");
    expect(text, "org secrets reach nothing here, so their absence is no failure").to.not.contain("org secret GOV_APP_PRIVATE_KEY is not set");
  });

  it("all repository secrets in place on Free + private: ok", () => {
    const r = appCheck(fakeGh(base([[/^secret list -R acme\/app --json name$/, ok('[{"name":"GOV_APP_CLIENT_ID"},{"name":"GOV_APP_PRIVATE_KEY"}]')]]), []), CFG, null, { codeRepos: { ok: true, names: ["app"] } });
    expect(r.verdict, r.lines.join("\n")).to.equal("ok");
  });

  it("the approved model's key, when CI may use it: the gov repo without it is ✗ with `gh secret set <NAME> -R <repo>`", () => {
    const r = appCheck(fakeGh(base(), []), CFG, null, { codeRepos: { ok: true, names: [] }, modelKey: "GEMINI_API_KEY" });
    expect(r.verdict).to.equal("fail");
    expect(r.lines.join("\n")).to.contain("acme/acme-gov will not receive GEMINI_API_KEY").and.contain("gh secret set GEMINI_API_KEY -R acme/acme-gov");
  });

  it("the plan unreadable (not an owner): cannot tell, never ok", () => {
    const r = appCheck(fakeGh(base([[/^api \/orgs\/acme --jq/, ok("")], [/^secret list -R acme\/acme-gov --json name$/, ok("[]")]]), []), CFG, null, { codeRepos: { ok: true, names: [] } });
    expect(r.verdict).to.not.equal("ok");
  });

  it("doctor: one Secrets row listing EVERY repo that will not receive one", () => {
    const r = appCheck(fakeGh(base(), []), CFG, null, { codeRepos: { ok: true, names: ["app"] }, modelKey: "GEMINI_API_KEY" });
    const row = secretsDiagnostic(r)!;
    expect(row.status).to.equal("warn");
    expect(row.detail).to.contain("acme/app").and.contain("acme/acme-gov").and.contain("GEMINI_API_KEY");
    const d = doctor({ gitPresent: true, ghPresent: true, resolve: { ok: false, code: 1 } as never, activeOrg: null, cliVersion: "1", githubApp: r });
    expect(d.diagnostics.find((x) => x.name === "Secrets reach")?.detail).to.contain("acme/app");
    expect(secretsDiagnostic({ verdict: "ok", summary: "", lines: [] })).to.equal(null);
  });
});

describe("gov rules propose in CI — a missing key names the Free-plan cause and the fix", () => {
  it("adds one line: org secrets do not reach private repos on Free; gh secret set <NAME> -R <repo>", () => {
    const c = chooseModel({ provider: "gemini", model: "g", command: "", ciAllowed: true },
      { ci: true, anthropicKey: () => null, geminiKey: () => null, runCommand: () => ({ status: 0, stdout: "", stderr: "" }) as never, repository: "acme/acme-gov" });
    expect(c.ok).to.equal(false);
    const text = !c.ok ? c.lines.join("\n") : "";
    expect(text).to.contain("Free plan").and.contain("gh secret set GEMINI_API_KEY -R acme/acme-gov");
    const a = chooseModel({ provider: "anthropic", model: "m", command: "", ciAllowed: true },
      { ci: true, anthropicKey: () => null, geminiKey: () => null, runCommand: () => ({ status: 0, stdout: "", stderr: "" }) as never, repository: "acme/acme-gov" });
    expect(!a.ok && a.lines.join("\n")).to.contain("gh secret set ANTHROPIC_API_KEY -R acme/acme-gov");
  });

  it("locally, no such line", () => {
    const c = chooseModel({ provider: "gemini", model: "g", command: "", ciAllowed: true },
      { ci: false, anthropicKey: () => null, geminiKey: () => null, runCommand: () => ({ status: 0, stdout: "", stderr: "" }) as never });
    expect(!c.ok && c.lines.join("\n")).to.not.contain("Free plan");
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

  it("gh received the key on stdin — for the org secret and for the repository secret", () => {
    expect(stdinSeen.match(/key-on-stdin/g)).to.have.length(2);
  });

  it("the log recorded the gh calls — and not a byte of the key", () => {
    expect(logText, "the run's log was written").to.contain("run finished");
    expect(logText).to.contain("conversions").and.contain("GOV_APP_PRIVATE_KEY");
    // The plan is unreadable to this stand-in, so gov could not tell: it wrote the REPOSITORY secret too — still on stdin.
    expect(logText).to.contain("'GOV_APP_PRIVATE_KEY', '-R', 'acme/acme-gov'");
    expect(logText).to.not.contain("MIIEsecretKEY");
    expect(logText).to.not.contain("PRIVATE KEY-----");
  });
});
