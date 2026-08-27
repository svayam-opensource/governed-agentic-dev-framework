// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * FIRST RUN — the flow that takes a bare machine to a registered org.
 *
 * Every external act (clone, disk, registry, terminal) is injected, so what these tests exercise is the
 * DECISION: which rung the machine is on, join versus found, and what is left behind when a step fails.
 */
import { expect } from "chai";
import {
  nextStep, govHomeFor, repoNameFromUrl, looksLikeRepoUrl, runFirstRun,
  type FirstRunIo, type OrgIdentity,
} from "../../src/cli/bootstrap.js";
import { px, pxAll } from "../helpers/paths.js";

describe("gov-work — first run: which rung is this machine on", () => {
  it("an active, registered org → nothing to do", () => {
    expect(nextStep({ orgs: ["Svayamtech"], active: "Svayamtech", interactive: true })).to.deep.equal({
      kind: "ready", org: "Svayamtech",
    });
  });

  it("exactly one org and none active → that one IS the answer, no question asked", () => {
    expect(nextStep({ orgs: ["Svayamtech"], active: null, interactive: true })).to.deep.equal({
      kind: "ready", org: "Svayamtech",
    });
  });

  it("an active org that is NOT registered is not an answer — it falls through", () => {
    // a stale `active-org` file naming an org that was removed: believing it would resolve to nothing.
    expect(nextStep({ orgs: ["A", "B"], active: "Gone", interactive: true })).to.deep.equal({
      kind: "choose", orgs: ["A", "B"],
    });
  });

  it("several orgs, none active, with a terminal → choose", () => {
    expect(nextStep({ orgs: ["A", "B"], active: null, interactive: true })).to.deep.equal({ kind: "choose", orgs: ["A", "B"] });
  });

  it("nothing registered, with a terminal → clone", () => {
    expect(nextStep({ orgs: [], active: null, interactive: true })).to.deep.equal({ kind: "clone" });
  });

  it("no terminal → blocked, and the message names the verb that fixes it", () => {
    const bare = nextStep({ orgs: [], active: null, interactive: false });
    expect(bare.kind).to.equal("blocked");
    if (bare.kind !== "blocked") return;
    expect(bare.reason).to.match(/run `gov` in a terminal/);

    const ambiguous = nextStep({ orgs: ["A", "B"], active: null, interactive: false });
    expect(ambiguous.kind).to.equal("blocked");
    if (ambiguous.kind !== "blocked") return;
    expect(ambiguous.reason).to.match(/gov org use <org>/);
    expect(ambiguous.reason, "say WHICH orgs, or the advice is unusable").to.include("A, B");
  });
});

describe("gov-work — first run: helpers", () => {
  it("gov_home is ~/.<slug>/gov_repo, lower-cased from the authored slug", () => {
    expect(px(govHomeFor("/home/rk", "SVM"))).to.equal("/home/rk/.svm/gov_repo");
  });

  it("repoNameFromUrl strips the path and .git for ssh and https", () => {
    expect(repoNameFromUrl("git@github.com:Svayamtech/svm-prj-work.git")).to.equal("svm-prj-work");
    expect(repoNameFromUrl("https://github.com/Svayamtech/svm-prj-work")).to.equal("svm-prj-work");
    expect(repoNameFromUrl("https://github.com/o/name/")).to.equal("name");
  });

  it("a typo'd URL fails here, not inside git's output", () => {
    expect(looksLikeRepoUrl("git@github.com:Svayamtech/svm-prj-work.git")).to.equal(true);
    expect(looksLikeRepoUrl("https://github.com/Svayamtech/svm-prj-work")).to.equal(true);
    expect(looksLikeRepoUrl("svm-prj-work")).to.equal(false);
    expect(looksLikeRepoUrl("github.com/Svayamtech/svm-prj-work")).to.equal(false); // no scheme
    expect(looksLikeRepoUrl("")).to.equal(false);
  });
});

const JOINER: OrgIdentity = { org: "Svayamtech", orgSlug: "SVM" };
const URL = "git@github.com:Svayamtech/svm-prj-work.git";

/** A recording world: every external act is captured, nothing happens. */
function io(over: Partial<FirstRunIo> = {}) {
  const out: string[] = [];
  const acts: string[] = [];
  const w: FirstRunIo = {
    facts: { orgs: [], active: null, interactive: true },
    homeDir: "/home/rk",
    // The role question comes first now (#186). Default to B (joiner) so the tests
    // below still describe what they say they describe; the adopter path has its
    // own tests.
    prompt: async (q: string) => (/Select \(A\/B\/C\)/.test(q) ? "B" : URL),
    print: (l) => out.push(l),
    tempDir: () => "/tmp/boot",
    clone: (u, d) => acts.push(`clone ${u} -> ${px(d)}`),
    readIdentity: () => JOINER,
    exists: () => false,
    place: (f, t) => acts.push(`place ${px(f)} -> ${px(t)}`),
    discard: (d) => acts.push(`discard ${px(d)}`),
    found: async () => null,
    createWorkspace: async () => 0,
    register: () => ({ ok: true }),
    activate: () => ({ ok: true }),
    ...over,
  };
  return { w, out, acts };
}

describe("gov-work — first run: the flow", () => {
  it("already set up → null, NOT 0 — the command the user typed still has to run", async () => {
    const { w } = io({ facts: { orgs: ["Svayamtech"], active: "Svayamtech", interactive: true } });
    expect(await runFirstRun(w)).to.equal(null);
  });

  it("JOINING: clone, read the org's own slug, place at ~/.svm/gov_repo, register + activate", async () => {
    const { w, out, acts } = io();
    expect(await runFirstRun(w)).to.equal(0);
    expect(acts).to.deep.equal([
      `clone ${URL} -> /tmp/boot/svm-prj-work`,
      "place /tmp/boot/svm-prj-work -> /home/rk/.svm/gov_repo",
      "discard /tmp/boot",
    ]);
    expect(out.join("\n"), "never asks a joiner to author the org's identity").to.not.match(/NEW organization/);
    expect(out).to.include("Joining Svayamtech.");
    expect(pxAll(out)).to.include("Registered Svayamtech → /home/rk/.svm/gov_repo");
  });

  it("FOUNDING: no org-config.yaml → setup authors it, and the slug it produced picks the home", async () => {
    const founded: string[] = [];
    const { w, out, acts } = io({
      readIdentity: () => null,
      found: async (dir) => { founded.push(px(dir)); return { org: "Acme", orgSlug: "ACME" }; },
    });
    expect(await runFirstRun(w)).to.equal(0);
    expect(founded, "setup runs in the CLONE, before it is placed").to.deep.equal(["/tmp/boot/svm-prj-work"]);
    expect(acts).to.include("place /tmp/boot/svm-prj-work -> /home/rk/.acme/gov_repo");
    expect(pxAll(out)).to.include("Registered Acme → /home/rk/.acme/gov_repo");
  });

  it("a bad URL is rejected before anything is cloned", async () => {
    const { w, out, acts } = io({ prompt: async (q: string) => (/Select \(A\/B\/C\)/.test(q) ? "B" : "svm-prj-work") });
    expect(await runFirstRun(w)).to.equal(1);
    expect(acts, "nothing touched the disk").to.deep.equal([]);
    expect(out.join("\n")).to.match(/does not look like a clone URL/);
  });

  it("asks which role you are here in, before asking anything only one role can answer", async () => {
    const asked: string[] = [];
    const { w, out } = io({ prompt: async (q: string) => { asked.push(q); return /Select \(A\/B\/C\)/.test(q) ? "B" : URL; } });
    await runFirstRun(w);
    expect(asked[0], "the role question comes first").to.match(/Select \(A\/B\/C\)/);
    expect(out.join("\n")).to.match(/I am an ADOPTER/);
    expect(out.join("\n")).to.match(/I am a JOINER/);
  });

  it("ADOPTER: does not ask for a clone URL — it creates the repo instead", async () => {
    const created: string[] = [];
    const { w, acts } = io({
      prompt: async (q: string) => (/Select \(A\/B\/C\)/.test(q) ? "A" : "acme-corp/acme-governance"),
      createWorkspace: async (t) => { created.push(t); return 0; },
    });
    expect(await runFirstRun(w)).to.equal(0);
    expect(created).to.deep.equal(["acme-corp/acme-governance"]);
    expect(acts, "nothing is cloned on the adopter path").to.deep.equal([]);
  });

  it("ADOPTER: a clone URL where a name belongs is sent back to the other option", async () => {
    const { w, out } = io({ prompt: async (q: string) => (/Select \(A\/B\/C\)/.test(q) ? "A" : URL) });
    expect(await runFirstRun(w)).to.equal(1);
    expect(out.join("\n")).to.match(/re-run and choose B/);
  });

  it("C explains, then asks again — and 'I am not sure' is an answer, not a refusal", async () => {
    let asked = 0;
    const { w, out } = io({
      prompt: async (q: string) => {
        if (!/Select \(A\/B\/C\)/.test(q)) return URL;
        asked++;
        return asked === 1 ? "C" : "B";
      },
    });
    expect(await runFirstRun(w)).to.equal(0);
    expect(asked, "asked again after explaining").to.equal(2);
    expect(out.join("\n"), "explains what an organization is").to.match(/It is NOT your user account/);
    expect(out.join("\n"), "explains the one-adoption rule").to.match(/ONE organization, ONE adoption/);
  });

  it("Enter on either path stops cleanly rather than erroring", async () => {
    const join = io({ prompt: async (q: string) => (/Select \(A\/B\/C\)/.test(q) ? "B" : "") });
    expect(await runFirstRun(join.w)).to.equal(0);
    expect(join.acts).to.deep.equal([]);

    const found = io({ prompt: async (q: string) => (/Select \(A\/B\/C\)/.test(q) ? "A" : "") });
    expect(await runFirstRun(found.w)).to.equal(0);
    expect(found.out.join("\n")).to.match(/gov setup <your-github-org>/);
  });

  it("a failed clone leaves no staging dir behind", async () => {
    const { w, out, acts } = io({ clone: () => { throw new Error("Repository not found"); } });
    expect(await runFirstRun(w)).to.equal(1);
    expect(acts).to.deep.equal(["discard /tmp/boot"]);
    expect(out.join("\n")).to.include("Repository not found");
  });

  it("an existing gov_home is never overwritten — it says how to register it instead", async () => {
    const { w, out, acts } = io({ exists: () => true });
    expect(await runFirstRun(w)).to.equal(1);
    expect(acts.some((a) => a.startsWith("place")), "nothing was placed").to.equal(false);
    expect(acts).to.include("discard /tmp/boot");
    expect(pxAll(out).join("\n")).to.match(/gov org add Svayamtech \/home\/rk\/\.svm\/gov_repo/);
  });

  it("abandoning setup discards the clone and does NOT register a half-made org", async () => {
    let registered = 0;
    const { w, acts } = io({ readIdentity: () => null, found: async () => null, register: () => { registered++; return { ok: true }; } });
    expect(await runFirstRun(w)).to.equal(1);
    expect(registered).to.equal(0);
    expect(acts).to.deep.equal([`clone ${URL} -> /tmp/boot/svm-prj-work`, "discard /tmp/boot"]);
  });

  it("choose: picks by number or by name, and refuses anything else", async () => {
    const facts = { orgs: ["Acme", "Svayamtech"], active: null, interactive: true };
    const picked: string[] = [];
    const mk = (answer: string) => io({ facts, prompt: async () => answer, activate: (o) => { picked.push(o); return { ok: true }; } });

    expect(await runFirstRun(mk("2").w)).to.equal(0);
    expect(await runFirstRun(mk("Acme").w)).to.equal(0);
    expect(picked).to.deep.equal(["Svayamtech", "Acme"]);

    const bad = mk("Nope");
    expect(await runFirstRun(bad.w)).to.equal(1);
    expect(bad.out.join("\n")).to.match(/is not one of the choices/);
    expect(picked, "a bad answer selects nothing").to.have.lengthOf(2);
  });

  it("no terminal: prints the reason and exits — first run is a human act", async () => {
    const { w, out, acts } = io({ facts: { orgs: [], active: null, interactive: false } });
    expect(await runFirstRun(w)).to.equal(1);
    expect(acts).to.deep.equal([]);
    expect(out.join("\n")).to.match(/run `gov` in a terminal/);
  });
});
