// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * F18 (svm-geneva re-walk, 2026-10-07). Configure-in-place (`gov setup` with no argument) skipped the agents question,
 * and `gov doctor` then said "agents: not chosen yet". It is asked in place too — with the organization's existing
 * choice kept as the default, so Enter changes nothing an org already decided.
 */
import { expect } from "chai";
import { runSetup } from "../../src/setup/setup-run.js";
import { readExistingOrgConfig } from "../../src/setup/setup.js";
import { readAuthorizedAgents } from "../../src/config/approved-agents.js";
import { noneOption } from "../../src/cli/agent-selection.js";
import type { Fs } from "../../src/lifecycle/fs-io.js";
import { px } from "../helpers/paths.js";

const GOV = "/repo/policies/governance.yaml";

function world(files: Record<string, string>) {
  const disk: Record<string, string> = { ...files };
  const fs = {
    writeFile: (f: string, c: string) => { disk[px(f)] = c; },
    readFile: (f: string) => disk[px(f)] ?? null,
    pathExists: (f: string) => px(f) in disk || Object.keys(disk).some((k) => k.startsWith(`${px(f)}/`)),
    mkdirp: () => {}, rm: () => {}, readdir: () => [],
  } as unknown as Fs;
  return { fs, disk };
}

const CFG = 'org_name: "Acme Inc"\norg_short_name: "Acme"\norg_slug: "ACME"\ngithub_org: "acme"\norg_gov_repo: "acme-gov"\n';
const GOVERNANCE = 'governance_posture: "soft"\npolicy_owner:\n  email: ""\n  github: "@rk"\ncheck_owner:\n  github: "@rk"\n';

async function setupWith(files: Record<string, string>, reply: (q: string, def: string) => string | undefined) {
  const { fs, disk } = world(files);
  const asked: string[] = [];
  const out: string[] = [];
  const code = await runSetup({
    existing: readExistingOrgConfig(files["/repo/org-config.yaml"]!, files[GOV] ?? null),
    fs, cwd: "/repo", originUrl: "git@github.com:acme/acme-gov.git", ghUser: "rk", gitEmail: "rk@acme.io", today: "2026-10-07",
    prompt: async (q, def) => { asked.push(q); return reply(q, def) ?? def; },
    print: (l) => out.push(l),
  }, true);
  return { code, disk, asked, out };
}

describe("F18 — configure-in-place asks which AI agents the organization authorizes", () => {
  it("an org that has not chosen is asked, and its answer is written to governance.yaml", async () => {
    let first = true;
    const r = await setupWith({ "/repo/org-config.yaml": CFG, [GOV]: GOVERNANCE }, (q) => {
      if (/^\s*Choose \[1\//.test(q) && first) { first = false; return "1"; }   // the default agent: the first offered
      if (/Choose \(Y\/n\)/.test(q)) return "y";
      return undefined;                                                    // Enter — "no more" at the add question
    });
    expect(r.code, r.out.join("\n")).to.equal(0);
    expect(r.out.join("\n")).to.match(/not chosen its AI agents yet/);
    const agents = readAuthorizedAgents(r.disk[GOV]!);
    expect(agents.kind, "doctor no longer reads 'not chosen yet'").to.equal("agents");
  });

  it("`none` is an answer, recorded as `authorized_agents: none`", async () => {
    const r = await setupWith({ "/repo/org-config.yaml": CFG, [GOV]: GOVERNANCE }, (q) => {
      if (/^\s*Choose \[/.test(q) && !/Y\/n/.test(q)) return String(noneOption());
      if (/Choose \(Y\/n\)/.test(q)) return "y";
      return undefined;
    });
    expect(r.code, r.out.join("\n")).to.equal(0);
    expect(r.disk[GOV]).to.match(/^authorized_agents: none$/m);
  });

  it("an org that already chose keeps its choice on Enter — shown, and the default", async () => {
    const chosen = `${GOVERNANCE}authorized_agents:\n  default: "claude-code"\n`;
    const r = await setupWith({ "/repo/org-config.yaml": CFG, [GOV]: chosen }, () => undefined);
    expect(r.code, r.out.join("\n")).to.equal(0);
    const q = r.asked.find((x) => /Keep your organization's authorized AI agents/.test(x));
    expect(q, "the question is asked").to.not.equal(undefined);
    expect(r.out.join("\n")).to.match(/Claude Code/);
    expect(r.disk[GOV]).to.match(/^authorized_agents:\n {2}default: "claude-code"\n?$/m);
  });

  it("answering n to keep re-asks the selection and writes the new answer", async () => {
    const chosen = `${GOVERNANCE}authorized_agents:\n  default: "claude-code"\n`;
    const r = await setupWith({ "/repo/org-config.yaml": CFG, [GOV]: chosen }, (q) => {
      if (/Keep your organization's authorized AI agents/.test(q)) return "n";
      if (/^\s*Choose \[/.test(q) && !/Y\/n/.test(q)) return String(noneOption());
      if (/Choose \(Y\/n\)/.test(q)) return "y";
      return undefined;
    });
    expect(r.code, r.out.join("\n")).to.equal(0);
    expect(r.disk[GOV]).to.match(/^authorized_agents: none$/m);
    expect(r.disk[GOV]).to.not.match(/claude-code/);
  });
});
