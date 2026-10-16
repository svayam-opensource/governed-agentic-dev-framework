// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// #210 — THE FIRST QUESTION NEVER REFUSES THE EMPTY ANSWER IT INVITED.
//
// Reported: `gov setup`'s first question, "Full legal name of your organization: ", offered no default and then
// said "✗ An organization name cannot be empty." Fixed (4ccc1ea) by defaulting the legal name to the GitHub
// organization. Since #215 reordered the founding interview (names first), the legal name is asked BEFORE the
// organization is known on that path, so there are now two founding-path shapes and both are pinned here:
//
//   gov setup <org>/<repo>   the org is known → the legal name defaults to it, and Enter accepts it.
//   gov (first run, adopt)   Q1 comes first → no default exists to offer, and Enter is the documented clean
//                            stop ("Nothing created…"), never a refusal. A re-run that knows a name offers it.
import { expect } from "chai";
import { deriveOrgConfig } from "../../src/setup/setup.js";
import { runSetup } from "../../src/setup/setup-run.js";
import { askOrgInterview } from "../../src/setup/interview.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import { px } from "../helpers/paths.js";
import { agentAnswer } from "../helpers/agents-answer.js";

const ORIGIN = "git@github.com:Acme/acme-gov.git";
const noFs = (writes: Record<string, string>): Fs =>
  ({ writeFile: (f: string, c: string) => { writes[px(f)] = c; }, pathExists: () => false, readFile: () => null, mkdirp: () => {}, rm: () => {}, readdir: () => [] }) as Fs;

describe("gov-work — the legal name has a default worth accepting (#210)", () => {
  it("defaults to the GitHub organization when the origin names one", () => {
    const d = deriveOrgConfig({}, { originUrl: ORIGIN, ghUser: "rk", gitEmail: null, today: "2026-10-12" });
    expect(d.orgName).to.equal("Acme");
    expect(d.orgShortName || d.orgName, "and the short name's default follows from it").to.equal("Acme");
  });

  it("gov setup <org>/<repo>: the question OFFERS the organization, Enter accepts it, nothing is refused", async () => {
    const writes: Record<string, string> = {};
    const printed: string[] = [];
    const asked: Array<[string, string]> = [];
    const code = await runSetup({
      fs: noFs(writes), cwd: "/repo", originUrl: ORIGIN, ghUser: "rk", gitEmail: "rk@acme.io", today: "2026-10-12",
      // Enter at every question (the default), except the slug, which has none by design.
      prompt: async (q, def) => { asked.push([q, def]); return agentAnswer(q) ?? (/Org slug/.test(q) ? "ACME" : def); },
      print: (l) => printed.push(l),
    }, true);
    expect(code).to.equal(0);
    const q = asked.find(([question]) => /legal name/.test(question));
    expect(q, "the legal name is asked").to.not.equal(undefined);
    expect(q![1], "with the organization as its default").to.equal("Acme");
    expect(printed.join("\n"), "and Enter is never refused").to.not.match(/cannot be empty/);
    expect(writes["/repo/org-config.yaml"]).to.match(/org_name: "Acme"/);
  });

  it("first-run adoption: Enter at Q1 (no organization known yet) is a clean stop, never a refusal", async () => {
    const printed: string[] = [];
    const asked: string[] = [];
    const r = await askOrgInterview({
      prompt: async (q) => { asked.push(q); return ""; },
      print: (l) => printed.push(l),
      derive: (partial) => deriveOrgConfig(partial, { originUrl: "", ghUser: "rk", gitEmail: null, today: "2026-10-12" }),
    });
    expect(r, "the adopter left; nothing is created").to.equal(null);
    expect(asked, "one question, asked once").to.have.length(1);
    expect(printed.join("\n")).to.not.match(/cannot be empty|✗/);
  });

  it("first-run adoption: when a name IS known, Q1 offers it and Enter takes it", async () => {
    const asked: string[] = [];
    const r = await askOrgInterview({
      prompt: async (q) => { asked.push(q); return /^Q3 /.test(q) ? "acme" : /^Q8 |^Q9 /.test(q) ? "rk" : ""; },
      print: () => {},
      derive: (partial) => deriveOrgConfig(partial, { originUrl: ORIGIN, ghUser: "rk", gitEmail: "rk@acme.io", today: "2026-10-12" }),
    });
    expect(asked[0]).to.match(/^Q1 [\s\S]*Enter Value \[Acme\] : $/);
    expect(r?.answers.orgName).to.equal("Acme");
  });
});
