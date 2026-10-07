// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * F17 (svm-geneva re-walk, 2026-10-07). `gov setup` run in place wrote org-config.yaml and policies/governance.yaml on
 * `main` and said only "Next: run `gov app setup`" — and a plain commit and push to main would itself break GOV-FRM-040.
 * Setup now puts what it changed on a branch and opens the pull request, or prints the exact commands when it cannot;
 * it never leaves the person on main with uncommitted governance changes and no word about it.
 *
 * F20. The same change carries CODEOWNERS, regenerated when setup changed the owners (and the role list's seeded
 * tokens, settled) — doctor reported "codeowners: drifted… Run gov upgrade" right after setup.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { landSetupChanges, changedPaths, type LandIo } from "../../src/setup/in-place-land.js";
import { finishInPlace } from "../../src/setup/in-place-land.js";
import { ROLE_LIST_PATH } from "../../src/config/role-list.js";
import { GOVERNANCE_PATH } from "../../src/config/governance.js";

/** A scripted git/gh: `state` drives the reads; every mutating call is recorded and succeeds unless `fail` names it. */
function fakeIo(state: { branch: string; before: string; after: string; existing?: string[] }, opts: { interactive?: boolean; answer?: string; fail?: string } = {}) {
  const calls: string[] = [];
  const out: string[] = [];
  let status = state.before;
  const io: LandIo = {
    git: (args) => {
      const line = `git ${args.join(" ")}`;
      if (args[0] === "status") return status;
      if (args[0] === "rev-parse" && args.includes("--abbrev-ref")) return state.branch;
      if (args[0] === "rev-parse" && args.includes("--verify")) return (state.existing ?? []).some((b) => args.at(-1) === `refs/heads/${b}`) ? "sha" : null;
      calls.push(line);
      if (opts.fail && line.startsWith(opts.fail)) return null;
      return "";
    },
    gh: (args) => {
      const line = `gh ${args.join(" ")}`;
      calls.push(line);
      if (opts.fail && line.startsWith(opts.fail)) return null;
      return "https://github.com/acme/acme-gov/pull/7";
    },
    print: (l) => out.push(l),
    ...(opts.interactive === false ? {} : { prompt: async (_q: string, def: string) => opts.answer ?? def }),
  };
  return { io, calls, out, setAfter: () => { status = state.after; } };
}

const SETUP_PATHS = ["org-config.yaml", GOVERNANCE_PATH, "CODEOWNERS", ROLE_LIST_PATH];

describe("F17 — configure-in-place lands its changes by a pull request", () => {
  it("changedPaths reads porcelain output, renames to their new name", () => {
    expect(changedPaths(" M org-config.yaml\n?? policies/governance.yaml\nR  a.md -> b.md\n")).to.deep.equal(["org-config.yaml", "policies/governance.yaml", "b.md"]);
  });

  it("on the default branch: a new branch, only setup's files, a commit, a push, gh pr create — and back to main", async () => {
    const w = fakeIo({ branch: "main", before: " M notes.txt\n", after: " M notes.txt\n M org-config.yaml\n M policies/governance.yaml\n M CODEOWNERS\n" });
    const before = w.io.git(["status", "--porcelain", "-uall"]);
    w.setAfter();
    const code = await landSetupChanges(w.io, { defaultBranch: "main", today: "2026-10-07", before: before ?? "", setupPaths: SETUP_PATHS });
    expect(code).to.equal(0);
    expect(w.calls[0]).to.equal("git switch -c gov-setup-2026-10-07");
    const add = w.calls.find((c) => c.startsWith("git add"))!;
    expect(add).to.contain("org-config.yaml").and.contain("policies/governance.yaml").and.contain("CODEOWNERS");
    expect(add, "the person's own edit is not swept into setup's commit").to.not.contain("notes.txt");
    expect(w.calls.some((c) => c.startsWith("git commit"))).to.equal(true);
    expect(w.calls).to.include("git push -u origin gov-setup-2026-10-07");
    expect(w.calls.find((c) => c.startsWith("gh pr create"))).to.match(/--base main --head gov-setup-2026-10-07/);
    expect(w.calls.at(-1)).to.equal("git switch main");
    expect(w.out.join("\n")).to.contain("https://github.com/acme/acme-gov/pull/7");
    expect(w.out.join("\n"), "never a push to main").to.not.match(/push.*origin main/);
  });

  it("files the upgrade-before-setup changed are carried too — everything setup changed, nothing it did not", async () => {
    const w = fakeIo({ branch: "main", before: "", after: " M org-config.yaml\n?? framework/templates/todo-template.md\n D governance/policies/x.md\n" });
    w.setAfter();
    await landSetupChanges(w.io, { defaultBranch: "main", today: "2026-10-07", before: "", setupPaths: SETUP_PATHS });
    const add = w.calls.find((c) => c.startsWith("git add"))!;
    expect(add).to.contain("framework/templates/todo-template.md").and.contain("governance/policies/x.md");
  });

  it("a branch of that name already exists → the next free name", async () => {
    const w = fakeIo({ branch: "main", before: "", after: " M org-config.yaml\n", existing: ["gov-setup-2026-10-07"] });
    w.setAfter();
    await landSetupChanges(w.io, { defaultBranch: "main", today: "2026-10-07", before: "", setupPaths: SETUP_PATHS });
    expect(w.calls[0]).to.equal("git switch -c gov-setup-2026-10-07-2");
  });

  it("non-interactive: nothing is committed, and the exact commands are printed — with why", async () => {
    const w = fakeIo({ branch: "main", before: "", after: " M org-config.yaml\n M policies/governance.yaml\n" }, { interactive: false });
    w.setAfter();
    expect(await landSetupChanges(w.io, { defaultBranch: "main", today: "2026-10-07", before: "", setupPaths: SETUP_PATHS })).to.equal(0);
    expect(w.calls, "no git write, no gh").to.deep.equal([]);
    const text = w.out.join("\n");
    expect(text).to.match(/GOV-FRM-040/);
    expect(text).to.contain("git switch -c gov-setup-2026-10-07");
    expect(text).to.match(/git add -- org-config\.yaml policies\/governance\.yaml/);
    expect(text).to.contain("git push -u origin gov-setup-2026-10-07");
    expect(text).to.match(/gh pr create --base main --head gov-setup-2026-10-07/);
  });

  it("declined: same commands, nothing done", async () => {
    const w = fakeIo({ branch: "main", before: "", after: " M org-config.yaml\n" }, { answer: "n" });
    w.setAfter();
    await landSetupChanges(w.io, { defaultBranch: "main", today: "2026-10-07", before: "", setupPaths: SETUP_PATHS });
    expect(w.calls).to.deep.equal([]);
    expect(w.out.join("\n")).to.contain("gh pr create");
  });

  it("a failed push is said, with the commands still to run — and the clone goes back to main", async () => {
    const w = fakeIo({ branch: "main", before: "", after: " M org-config.yaml\n" }, { fail: "git push" });
    w.setAfter();
    const code = await landSetupChanges(w.io, { defaultBranch: "main", today: "2026-10-07", before: "", setupPaths: SETUP_PATHS });
    expect(code).to.equal(1);
    const text = w.out.join("\n");
    expect(text).to.match(/push.*failed/i);
    expect(text).to.contain("git push -u origin gov-setup-2026-10-07");
    expect(text).to.contain("gh pr create");
    expect(w.calls.some((c) => c.startsWith("gh "))).to.equal(false);
  });

  it("already on a work branch: nothing committed for them, and they are told the changes are there", async () => {
    const w = fakeIo({ branch: "e2e/setup", before: "", after: " M org-config.yaml\n" });
    w.setAfter();
    await landSetupChanges(w.io, { defaultBranch: "main", today: "2026-10-07", before: "", setupPaths: SETUP_PATHS });
    expect(w.calls).to.deep.equal([]);
    expect(w.out.join("\n")).to.match(/on branch e2e\/setup, not committed/);
  });

  it("nothing changed → nothing to land, said in one line", async () => {
    const w = fakeIo({ branch: "main", before: "", after: "" });
    await landSetupChanges(w.io, { defaultBranch: "main", today: "2026-10-07", before: "", setupPaths: SETUP_PATHS });
    expect(w.calls).to.deep.equal([]);
    expect(w.out.join("\n")).to.match(/nothing to land/i);
  });
});

describe("F20 — setup regenerates CODEOWNERS in the same change", () => {
  let dir = "";
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "gov-f20-")); fs.mkdirSync(path.join(dir, "policies")); });
  afterEach(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } });

  it("after the owners change, CODEOWNERS routes to the new Policy Owner and the role list carries no token", () => {
    fs.writeFileSync(path.join(dir, "org-config.yaml"), 'org_name: "Acme"\norg_slug: "ACME"\n');
    fs.writeFileSync(path.join(dir, GOVERNANCE_PATH), 'policy_owner:\n  email: ""\n  github: "@alice"\ncheck_owner:\n  github: "@carol"\n');
    fs.writeFileSync(path.join(dir, ROLE_LIST_PATH), "| Role | GitHub handle | Owns |\n|---|---|---|\n| Legal Owner | <LEGAL_OWNER_GITHUB> | `knowledge/legal/` |\n");
    fs.writeFileSync(path.join(dir, "CODEOWNERS"), "* @old-owner\n");
    const lines = finishInPlace(dir);
    const owners = fs.readFileSync(path.join(dir, "CODEOWNERS"), "utf8");
    expect(owners).to.contain("@alice").and.to.not.contain("@old-owner");
    expect(owners).to.match(/\/policies\/actions\/\s+@carol/);
    expect(fs.readFileSync(path.join(dir, ROLE_LIST_PATH), "utf8")).to.match(/\| Legal Owner \| vacant \|/);
    expect(lines.join("\n")).to.match(/CODEOWNERS/);
  });
});
