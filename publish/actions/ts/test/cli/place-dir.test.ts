// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `gov setup --join` clones into the OS temp dir, then moves the clone to its home under ~/.gov. On a machine whose
 * /tmp is its own filesystem (tmpfs on Fedora/Arch, GitHub's ubuntu runners) a rename cannot cross the device and
 * fails with EXDEV — the joiner journey died on exactly that. The move must still land the repo, intact.
 */
import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { placeDir } from "../../src/cli/place-dir.js";

const exdev = (): never => { throw Object.assign(new Error("EXDEV: cross-device link not permitted"), { code: "EXDEV" }); };

describe("placeDir — move a staged clone to its home", () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "place-dir-")); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const stage = (): string => {
    const from = path.join(root, "staged", "gov_repo");
    fs.mkdirSync(path.join(from, ".git", "refs"), { recursive: true });
    fs.writeFileSync(path.join(from, "org-config.yaml"), "org_name: x\n");
    fs.writeFileSync(path.join(from, ".git", "HEAD"), "ref: refs/heads/main\n");
    return from;
  };

  it("renames when it can, creating the parent", () => {
    const from = stage(); const to = path.join(root, "home", ".gov", "x", "gov_repo");
    placeDir(from, to);
    expect(fs.readFileSync(path.join(to, "org-config.yaml"), "utf8")).to.equal("org_name: x\n");
    expect(fs.existsSync(from)).to.equal(false);
  });

  it("across devices (EXDEV) it copies the whole tree, dotfiles included, then removes the staged copy", () => {
    const from = stage(); const to = path.join(root, "home", ".gov", "x", "gov_repo");
    placeDir(from, to, { rename: exdev });
    expect(fs.readFileSync(path.join(to, ".git", "HEAD"), "utf8")).to.equal("ref: refs/heads/main\n");
    expect(fs.existsSync(path.join(to, ".git", "refs"))).to.equal(true);
    expect(fs.existsSync(from)).to.equal(false);
  });

  it("any other rename failure is not swallowed", () => {
    const from = stage(); const to = path.join(root, "home", "gov_repo");
    const eacces = (): never => { throw Object.assign(new Error("EACCES"), { code: "EACCES" }); };
    expect(() => placeDir(from, to, { rename: eacces })).to.throw("EACCES");
    expect(fs.existsSync(from)).to.equal(true);
  });
});
