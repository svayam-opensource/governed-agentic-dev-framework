// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { doctor, formatDoctorReport, type DoctorFacts } from "../../src/maintain/doctor.js";
import type { ResolveResult } from "../../src/resolve/types.js";

const resolved: ResolveResult = { ok: true, home: "/gov", org: "Svayamtech", via: "active-org" };
const unresolved: ResolveResult = { ok: false, code: 2, reason: "no-active-org" };
// A workspace that EXISTS but will not resolve: an org is set, its home is gone. Still a failure.
const broken: ResolveResult = { ok: false, code: 2, reason: "no-home", activeOrg: "Svayamtech" };

const facts = (over: Partial<DoctorFacts> = {}): DoctorFacts => ({
  gitPresent: true,
  ghPresent: true,
  resolve: resolved,
  activeOrg: "Svayamtech",
  cliVersion: "1.0.0",
  ...over,
});

describe("gov-work — doctor", () => {
  it("all green when tools present, workspace resolves, active org set", () => {
    const r = doctor(facts());
    expect(r.ok).to.equal(true);
    expect(r.diagnostics.every((d) => d.status === "ok")).to.equal(true);
    expect(r.diagnostics.find((d) => d.name === "CLI version")!.detail).to.equal("1.0.0");
  });

  it("fails (not ok) when git/gh missing or the workspace won't resolve", () => {
    expect(doctor(facts({ gitPresent: false })).ok).to.equal(false);
    expect(doctor(facts({ ghPresent: false })).ok).to.equal(false);
    const r = doctor(facts({ resolve: broken }));
    expect(r.ok).to.equal(false);
    expect(r.diagnostics.find((d) => d.name === "gov workspace")!.status).to.equal("fail");
  });

  // PRJ-121, 2026-09-22 — right after "gov is installed", a walk got the same fact three times (banner ⚠,
  // ✗ gov workspace, ! active org) with two different remedies, and the ✗ made the report FAILED.
  it("NOT SET UP YET is one warning with one remedy — the next step, not a failure", () => {
    const r = doctor(facts({ resolve: unresolved, activeOrg: null }));
    const ws = r.diagnostics.filter((d) => d.name === "gov workspace");
    expect(ws).to.have.length(1);
    expect(ws[0]!.status).to.equal("warn");
    expect(ws[0]!.detail).to.match(/not set up yet — run `gov`/);
    expect(r.diagnostics.find((d) => d.name === "active org"), "the same fact is not repeated").to.equal(undefined);
    expect(r.ok, "tools present + nothing set up yet = ready for the next step").to.equal(true);
  });

  // …but only on an EMPTY registry (PRJ-121, 2026-09-22): with orgs registered and none active, "not set up
  // yet" was false and sent the person to the first-run flow.
  it("orgs registered, none active → names them and `gov org use`, not 'not set up yet'", () => {
    const r = doctor(facts({ resolve: unresolved, activeOrg: null, registeredOrgs: ["Svayamtech", "Beta"] }));
    const ws = r.diagnostics.find((d) => d.name === "gov workspace")!;
    expect(ws.status).to.equal("warn");
    expect(ws.detail).to.contain("Svayamtech, Beta").and.contain("gov org use").and.not.match(/not set up yet/);
  });

  // The sibling of 5bec707: with no workspace, doctor read VERSION from the cwd and said
  // "✓ version compat: … run `gov upgrade`", and "✓ content layout: current" about nothing.
  it("rows ABOUT a workspace are absent when there is none — not a tick about nothing", () => {
    const r = doctor(facts({ resolve: unresolved, activeOrg: null, contentVersion: null }));
    expect(r.diagnostics.find((d) => d.name === "version compat")).to.equal(undefined);
    expect(r.diagnostics.find((d) => d.name === "content layout")).to.equal(undefined);
  });

  it("a workspace the person NAMED (--gov-home) is still examined, even if nothing resolves", () => {
    const r = doctor(facts({ resolve: unresolved, workspaceChecked: true, contentVersion: null }));
    expect(r.diagnostics.find((d) => d.name === "version compat")).to.not.equal(undefined);
  });

  it("warns on old-world content artifacts (points to gov upgrade)", () => {
    const r = doctor(facts({ staleArtifacts: ["framework/", "registry.yaml"] }));
    expect(r.ok).to.equal(true);
    const cl = r.diagnostics.find((d) => d.name === "content layout");
    expect(cl.status).to.equal("warn");
    expect(cl.detail).to.match(/gov upgrade/);
  });

  it("warns (still ok) on no active org", () => {
    const noOrg = doctor(facts({ activeOrg: null }));
    expect(noOrg.ok).to.equal(true);
    const org = noOrg.diagnostics.find((d) => d.name === "active org")!;
    expect(org.status).to.equal("warn");
    expect(org.detail).to.match(/gov org use/);
  });

  it("formats a printable report ending in the overall verdict", () => {
    const lines = formatDoctorReport(doctor(facts()));
    expect(lines[0]).to.match(/^ {2}✓ git:/);
    expect(lines[lines.length - 1]).to.equal("doctor: ok");
    expect(formatDoctorReport(doctor(facts({ gitPresent: false }))).pop()).to.match(/doctor: FAILED/);
  });
});

describe("gov-work — the doctor report in colour (#204)", () => {
  // eslint-disable-next-line no-control-regex
  const strip = (s: string): string => s.replace(/\u001b\[\d+m/g, "");

  it("stripping the codes gives back exactly the plain report", () => {
    const r = doctor(facts({ gitPresent: false }));
    expect(formatDoctorReport(r, true).map(strip)).to.deep.equal(formatDoctorReport(r, false));
  });

  it("plain is the default, and the MARK still tells ok from fail", () => {
    const lines = formatDoctorReport(doctor(facts({ gitPresent: false })));
    expect(lines.join("")).to.not.contain("\u001b");
    expect(lines.some((l) => l.includes("\u2717 git")), "a fail is a cross, not a colour").to.equal(true);
    expect(lines.some((l) => l.includes("\u2713 CLI version")), "an ok is a tick").to.equal(true);
  });
});

// ── old-world artifacts are looked for only in a WORKSPACE (PRJ-121, 2026-09-21) ────────────────────
//
// Found by the first walk of the local install site. With no workspace resolved, doctor's "home" is just the
// cwd — on a fresh machine the adopter's home directory, where our own documented command
// (`curl … -o install.sh && bash install.sh`) had just saved install.sh. The first thing a new adopter saw was
// `old-world artifacts (install.sh) — run gov upgrade --from <content>`.
import { staleArtifactsIn } from "../../src/maintain/upgrade-sync.js";

describe("staleArtifactsIn — retire only what a workspace left behind", () => {
  const present = (...rels: string[]) => (rel: string) => rels.includes(rel);

  it("finds NOTHING outside a workspace, whatever the directory holds", () => {
    // A fresh adopter's home: the installer we told them to save, and the ~/bin and ~/scripts many people keep.
    expect(staleArtifactsIn(false, present("install.sh", "bin", "scripts"))).to.deep.equal([]);
  });

  it("still finds them in a real adopter workspace — the rule is right where it applies", () => {
    // Reported as RETIRE_PATHS spells them (`framework/`), in its order — what doctor has always printed.
    expect(staleArtifactsIn(true, present("install.sh", "registry.yaml", "framework"))).to.deep.equal(["framework/", "registry.yaml", "install.sh"]);
  });

  it("exempts the framework's own checkout, where install.sh is the bootstrap installer (#186)", () => {
    expect(staleArtifactsIn(true, present("publish/content/MANIFEST.yaml", "install.sh"))).to.deep.equal([]);
  });

  it("a clean workspace reports nothing", () => {
    expect(staleArtifactsIn(true, present())).to.deep.equal([]);
  });

  // PRJ-121, 2026-09-22 — svm-geneva-gov inherited publish/ (436 files), site/ and install.ps1 from the template.
  it("an ADOPTER that inherited the framework's files is not mistaken for the framework — they are reported", () => {
    const geneva = present("org-config.yaml", "publish/content/MANIFEST.yaml", "publish/actions/ts/package.json", "site/caddyfile.mjs", "install.ps1");
    expect(staleArtifactsIn(true, geneva)).to.deep.equal(["publish/", "site/", "install.ps1"]);
  });

  it("an org's OWN site/ or publish/ (no framework fingerprint) is never flagged", () => {
    expect(staleArtifactsIn(true, present("org-config.yaml", "site/index.html", "publish/report.md"))).to.deep.equal([]);
  });
});

// PRJ-121, 2026-09-23 — `governance/` split into `framework/` (the framework's) + `policies/` (the org's).
// Both shapes exist in the wild for one release, so gov must be able to say which one it is looking at.
describe("the content layout, said plainly", () => {
  it("names the older layout, and the command that moves it", () => {
    const r = doctor(facts({ workspaceChecked: true, contentLayout: "governance", contentVersion: "1.2.3" }));
    const row = r.diagnostics.find((d) => d.name === "content layout")!;
    expect(row.status, "behind is not broken").to.equal("warn");
    expect(row.detail).to.contain("governance/").and.contain("gov upgrade --pr");
    expect(r.ok, "and it does not fail the report").to.equal(true);
  });

  it("says nothing special about the current one", () => {
    const row = doctor(facts({ workspaceChecked: true, contentLayout: "framework", contentVersion: "1.2.3" }))
      .diagnostics.find((d) => d.name === "content layout")!;
    expect(row.status).to.equal("ok");
  });
});

describe("contentLayoutOf — derived from the tree, never stored", () => {
  it("reads the layout off what is on disk", async () => {
    const { contentLayoutOf } = await import("../../src/maintain/upgrade-sync.js");
    expect(contentLayoutOf((r) => r === "framework/policies")).to.equal("framework");
    expect(contentLayoutOf((r) => r === "governance/policies")).to.equal("governance");
    expect(contentLayoutOf(() => false), "a directory that is neither is not a workspace to upgrade").to.equal("none");
    expect(contentLayoutOf((r) => r === "framework/policies" || r === "governance/policies"),
      "mid-upgrade, the NEW layout is the answer").to.equal("framework");
  });
});

// PRJ-121, 2026-09-27 — gov owns the schema of org-config.yaml, so gov must report what it ignored in it.
// An org can add `require_two_approvals: true`, have it reviewed and merged, and believe it configured
// something. `preferences.ts` has always said "gov does not know this setting"; this channel said nothing.
describe("org-config — what gov ignored, said out loud", () => {
  it("names the keys gov does not read, and counts them", () => {
    const r = doctor(facts({
      workspaceChecked: true,
      contentVersion: "1.0.0",
      orgConfigText: 'org_name: "Acme"\nrequire_two_approvals: true\nfoo: bar\n',
    }));
    const row = r.diagnostics.find((d) => d.name === "org-config")!;
    expect(row.status, "an unknown key is a warning, never a failure").to.equal("warn");
    expect(row.detail).to.equal("2 keys gov does not read — require_two_approvals, foo (ignored)");
    expect(r.ok, "and the report still passes").to.equal(true);
  });

  it("singular reads as singular", () => {
    const row = doctor(facts({ orgConfigText: "require_two_approvals: true\n" })).diagnostics.find((d) => d.name === "org-config")!;
    expect(row.detail).to.equal("1 key gov does not read — require_two_approvals (ignored)");
  });

  it("says so when everything is recognised", () => {
    const row = doctor(facts({ orgConfigText: 'org_name: "Acme"\ndefault_branch: "main"\n' })).diagnostics.find((d) => d.name === "org-config")!;
    expect(row.status).to.equal("ok");
    expect(row.detail).to.equal("all keys recognised");
  });

  it("no config examined → no row (a row about a fact nobody gathered is worse than no row)", () => {
    expect(doctor(facts()).diagnostics.find((d) => d.name === "org-config")).to.equal(undefined);
    expect(doctor(facts({ orgConfigText: null })).diagnostics.find((d) => d.name === "org-config")).to.equal(undefined);
  });
});

// PRJ-121, 2026-09-27 — GOV-FRM-447 was UNVERIFIED: nothing in src/ mentioned branch protection. It is the
// only layer that holds when an agent runs from outside gov altogether.
describe("branch protection — GOV-FRM-448, in the report", () => {
  const protection = (over: Partial<NonNullable<DoctorFacts["protection"]>> = {}) => ({
    repo: "Acme/acme-gov",
    branch: "main",
    facts: { pullRequestRequired: true, approvingReviews: 1, enforceAdmins: true, requiredStatusChecks: ["approver-check"] },
    ...over,
  });

  it("four rows, and a compliant repo keeps the report green", () => {
    const r = doctor(facts({ protection: protection() }));
    expect(r.diagnostics.filter((d) => d.name.startsWith("protection · "))).to.have.length(4);
    expect(r.ok).to.equal(true);
  });

  it("a missing requirement FAILS the report — this is the layer that holds outside gov", () => {
    const r = doctor(facts({ protection: protection({ facts: { pullRequestRequired: true, approvingReviews: 0, enforceAdmins: false, requiredStatusChecks: [] } }) }));
    expect(r.ok).to.equal(false);
    expect(r.diagnostics.filter((d) => d.status === "fail").map((d) => d.name))
      .to.deep.equal(["protection · approving review", "protection · no bypass", "protection · approver check"]);
  });

  it("unreadable is ONE warning that does not fail the report, and does not read as unprotected", () => {
    const r = doctor(facts({ protection: protection({ facts: null, why: "gh is signed in but not an admin of this repo" }) }));
    const row = r.diagnostics.find((d) => d.name === "branch protection")!;
    expect(row.status).to.equal("warn");
    expect(row.detail).to.contain("UNKNOWN IS NOT UNPROTECTED");
    expect(r.ok).to.equal(true);
    expect(r.diagnostics.filter((d) => d.name.startsWith("protection · ")), "no invented requirement rows").to.have.length(0);
  });

  it("not probed → no rows at all", () => {
    expect(doctor(facts()).diagnostics.filter((d) => d.name.includes("protection"))).to.have.length(0);
  });

  it("the rows render with their marks, protection included", () => {
    const lines = formatDoctorReport(doctor(facts({ protection: protection({ facts: { pullRequestRequired: false, approvingReviews: 0, enforceAdmins: false, requiredStatusChecks: [] } }) })));
    expect(lines.some((l) => l.includes("✗ protection · pull request:"))).to.equal(true);
    expect(lines[lines.length - 1]).to.contain("doctor: FAILED");
  });
});

// Policy Owner, 2026-09-29 — HARD OR SOFT, and the third state. Two organizations with identical branch
// protection are in opposite positions depending on which they chose, and until this row the report could not
// tell them apart.
describe("governance posture — the row that says what the protection rows are FOR", () => {
  const row = (text: string | null | undefined) => doctor(facts({ orgConfigText: text })).diagnostics.find((d) => d.name === "governance posture");
  const protection = {
    repo: "Acme/acme-gov",
    branch: "main",
    facts: { pullRequestRequired: false, approvingReviews: 0, enforceAdmins: false, requiredStatusChecks: [] },
  };

  it("no key is SOFT by default (W2-Q6) — ok, and it says it is the default and how to choose hard", () => {
    const r = row("org_name: \"Acme\"\n")!;
    expect(r.status).to.equal("ok");
    expect(r.detail).to.contain("soft").and.contain("the default").and.contain("governance_posture: hard");
  });

  it("an empty value is the same as no key at all — soft, by default", () => {
    expect(row('governance_posture: ""\n')!.status).to.equal("ok");
    expect(row('governance_posture: ""\n')!.detail).to.contain("the default");
  });

  it("hard is a decision, and reports ok", () => {
    const r = row("governance_posture: hard\n")!;
    expect(r.status).to.equal("ok");
    expect(r.detail).to.contain("hard").and.contain("outside gov");
  });

  it("soft is ALSO a decision — an org may adopt the framework for its structure alone", () => {
    const r = row("governance_posture: soft\n")!;
    expect(r.status).to.equal("ok");
    expect(r.detail).to.contain("soft").and.contain("deliberately");
  });

  it("a value gov does not know warns, and is not read as either posture", () => {
    const r = row("governance_posture: strict\n")!;
    expect(r.status).to.equal("warn");
    expect(r.detail).to.contain("`strict`").and.contain("not a posture gov knows");
  });

  it("no config examined → no row. A row about a fact nobody gathered is worse than no row", () => {
    expect(row(null)).to.equal(undefined);
    expect(row(undefined)).to.equal(undefined);
  });

  it("under SOFT the per-requirement rows are GONE — four crosses against a deliberate choice is a false alarm", () => {
    const r = doctor(facts({ orgConfigText: "governance_posture: soft\n", protection }));
    expect(r.diagnostics.filter((d) => d.name.startsWith("protection · "))).to.have.length(0);
    expect(r.ok, "and the report is not failed by a decision the organization made on purpose").to.equal(true);
  });

  it("under HARD they stay, and an open branch fails the report", () => {
    const r = doctor(facts({ orgConfigText: "governance_posture: hard\n", protection }));
    expect(r.diagnostics.filter((d) => d.name.startsWith("protection · "))).to.have.length(4);
    expect(r.ok).to.equal(false);
  });

  it("UNSET is soft by default (W2-Q6), so the rows go too", () => {
    const r = doctor(facts({ orgConfigText: 'org_name: "Acme"\n', protection }));
    expect(r.diagnostics.filter((d) => d.name.startsWith("protection · "))).to.have.length(0);
    expect(r.ok).to.equal(true);
  });

  it("NO CONFIG EXAMINED is not soft — the posture is unknown, so the rows stay", () => {
    const r = doctor(facts({ protection }));
    expect(r.diagnostics.filter((d) => d.name.startsWith("protection · "))).to.have.length(4);
  });
});
