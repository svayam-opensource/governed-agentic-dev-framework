// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
import { expect } from "chai";
import { createGhAnchor, anchorIssueBody } from "../../src/lifecycle/anchor.js";

describe("prj-work Phase 2 — anchor issue creator", () => {
  const params = {
    boardNumber: 43,
    title: "@Governance Common Project",
    owner: "Svayamtech",
    workspaceRepo: "svm-prj-work",
    assigneeLogin: "svayam-rkant",
  };

  it("creates the issue (label + assignee + board add) and returns <repo>#<n>", () => {
    const calls: string[][] = [];
    const anchor = createGhAnchor((args) => {
      calls.push(args);
      if (args[0] === "issue") return "https://github.com/Svayamtech/svm-prj-work/issues/42\n";
      return "";
    });
    const ref = anchor.createAnchorIssue(params);
    expect(ref).to.equal("Svayamtech/svm-prj-work#42");
    expect(calls[0][0]).to.equal("label"); // ensure label first
    const issue = calls.find((c) => c[0] === "issue")!;
    expect(issue).to.include.members(["--repo", "Svayamtech/svm-prj-work", "--label", "anchor"]);
    expect(issue).to.include.members(["--assignee", "svayam-rkant"]);
    expect(calls.some((c) => c[0] === "project" && c[1] === "item-add")).to.equal(true);
  });

  it("omits --assignee when no login is given", () => {
    const calls: string[][] = [];
    const anchor = createGhAnchor((args) => {
      calls.push(args);
      return args[0] === "issue" ? "https://github.com/O/svm-prj-work/issues/7" : "";
    });
    anchor.createAnchorIssue({ ...params, assigneeLogin: null });
    expect(calls.find((c) => c[0] === "issue")).to.not.include("--assignee");
  });

  it("returns null (best-effort) when issue creation fails", () => {
    const anchor = createGhAnchor((args) => {
      if (args[0] === "issue") throw new Error("gh: no perms");
      return "";
    });
    expect(anchor.createAnchorIssue(params)).to.equal(null);
  });

  it("find(): board #1 is not board #12's anchor — the number is matched whole (seed reuses what find returns)", () => {
    const list = JSON.stringify([
      { url: "https://github.com/O/r/issues/12", number: 12, body: "Anchor issue for the project on GitHub Project #12 — *A*.", labels: [], assignees: [] },
      { url: "https://github.com/O/r/issues/3", number: 3, body: "Anchor issue for the project on GitHub Project #1 — *B*.", labels: [], assignees: [] },
    ]);
    const anchor = createGhAnchor(() => list);
    expect(anchor.find({ owner: "O", ownerField: "organization", number: 1 }, "r")?.number).to.equal(3);
    expect(anchor.find({ owner: "O", ownerField: "organization", number: 2 }, "r")).to.equal(null);
  });

  it("body names the board number and title", () => {
    expect(anchorIssueBody(43, "X")).to.include("GitHub Project #43").and.to.include("*X*");
  });
});
