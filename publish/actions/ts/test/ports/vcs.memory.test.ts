// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/** The VcsPort conformance suite against the `memory` adapter (unit tier), plus what only memory has. */
import { expect } from "chai";
import { vcsConformance } from "./vcs.conformance.js";
import { createMemoryVcs } from "../../src/adapters/memory/vcs.js";
import { builtInProviders, pickAdapter } from "../../src/adapters/registry.js";

const REPO = { owner: "acme", name: "app" };

function seeded() {
  const vcs = createMemoryVcs({
    identity: { login: "alice", kind: "human" },
    repos: [{
      repo: REPO, defaultBranch: "main", visibility: "private",
      branches: { main: "1111111", dev: "2222222", "feature-x": "3333333", "feature-y": "4444444" },
      requiredChecks: { main: ["build", "test"] },
    }],
  });
  const reviewed = vcs.seedChangeRequest({ repo: REPO, head: "feature-y", base: "dev", title: "reviewed", body: "" });
  vcs.addReview(reviewed, { by: "bob", verdict: "approved" });
  vcs.addReview(reviewed, { by: "copilot-pull-request-reviewer[bot]", verdict: "commented" });
  vcs.addReview(reviewed, { by: "gov-checks", type: "Bot", verdict: "changes-requested" });
  const merged = vcs.seedChangeRequest({ repo: REPO, head: "dev", base: "main", title: "release", body: "" });
  vcs.merge(merged);
  return { vcs, reviewed, merged };
}

vcsConformance("memory", () => {
  const { vcs, reviewed, merged } = seeded();
  return {
    vcs, repo: REPO, defaultBranch: "main", head: "feature-x", missingBranch: "no-such-branch",
    missingRepo: { owner: "acme", name: "nope" },
    requiredChecks: { branch: "main", checks: ["build", "test"], unprotected: "dev" },
    reviewed: { ref: reviewed, human: "bob", bot: "copilot-pull-request-reviewer[bot]" },
    merged,
    identity: { login: "alice", kind: "human" },
  };
});

describe("VcsPort — memory adapter specifics", () => {
  it("a bot named only by its account type is a bot", async () => {
    const { vcs, reviewed } = seeded();
    const r = await vcs.reviews(reviewed);
    expect(r.ok && r.value.find((x) => x.by === "gov-checks")?.kind).to.equal("bot");
  });

  it("a second open change request for the same head and base is refused, as the host does", async () => {
    const { vcs } = seeded();
    const a = await vcs.openChangeRequest({ repo: REPO, head: "feature-x", base: "main", title: "a", body: "" });
    const b = await vcs.openChangeRequest({ repo: REPO, head: "feature-x", base: "main", title: "b", body: "" });
    expect(a.ok).to.equal(true);
    expect(b.ok).to.equal(false);
    if (!b.ok) expect(b.reason).to.match(/already/);
  });

  it("head equal to base is refused", async () => {
    const { vcs } = seeded();
    expect((await vcs.openChangeRequest({ repo: REPO, head: "main", base: "main", title: "x", body: "" })).ok).to.equal(false);
  });

  it("an empty title is refused", async () => {
    const { vcs } = seeded();
    expect((await vcs.openChangeRequest({ repo: REPO, head: "feature-x", base: "main", title: " ", body: "" })).ok).to.equal(false);
  });

  it("no identity seeded → identity() fails rather than inventing one", async () => {
    expect((await createMemoryVcs().identity()).ok).to.equal(false);
  });

  it("is registered as the memory adapter for vcs; github is registered too", () => {
    expect(Object.keys(builtInProviders.vcs).sort()).to.deep.equal(["github", "memory"]);
    expect(pickAdapter(builtInProviders, "vcs", "memory")).to.have.property("openChangeRequest");
  });
});
