// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * gadf#225 — the board Status is REALLY set, or gov says why not (PRJ-121 intent 05, Item 3, ruling Q4).
 *
 * The GitHub adapter of the WorkTrackerPort, driven by a fake `gh`: one GraphQL query (the issue's project
 * items, each with its project's Status field and options), one `updateProjectV2ItemFieldValue` mutation.
 * One test per outcome the port can report.
 */
import { expect } from "chai";
import { createGithubBoardWriter } from "../../../src/adapters/github/work-tracker.js";
import type { BoardRef } from "../../../src/lifecycle/identity.js";

const REF: BoardRef = { owner: "Svayamtech", ownerField: "organization", number: 43 };
const ISSUE = "https://github.com/Svayamtech/911-SVM-LIB-SVC/issues/123";

const STATUS_FIELD = {
  __typename: "ProjectV2SingleSelectField",
  id: "F_status",
  options: [{ id: "O_todo", name: "Todo" }, { id: "O_wip", name: "In Progress" }, { id: "O_done", name: "Done" }],
};
function item(over: { number?: number; owner?: string; field?: unknown } = {}) {
  return {
    id: "PVTI_1",
    project: { id: "PVT_43", number: over.number ?? 43, owner: { login: over.owner ?? "Svayamtech" }, field: over.field === undefined ? STATUS_FIELD : over.field },
  };
}
function answer(nodes: unknown[] | null) {
  return JSON.stringify({ data: { resource: nodes === null ? null : { __typename: "Issue", id: "I_123", projectItems: { nodes } } } });
}
class GhError extends Error {
  constructor(public stderr: string) { super(`Command failed: gh api graphql\n${stderr}`); }
}

/** A fake `gh`: answers the query with `query`, records every call, runs `mutation` for the update. */
function fakeGh(query: () => string, mutation: () => string = () => "{\"data\":{}}") {
  const calls: string[][] = [];
  const runGh = (args: string[]): string => {
    calls.push(args);
    const q = args.find((a) => a.startsWith("query=")) ?? "";
    if (q.includes("updateProjectV2ItemFieldValue")) return mutation();
    if (args[0] === "project" && args[1] === "close") return mutation();
    return query();
  };
  return { runGh, calls };
}
const mutations = (calls: string[][]) => calls.filter((c) => c.some((a) => a.includes("updateProjectV2ItemFieldValue")));
const arg = (c: string[], name: string) => c[c.indexOf(c.find((a) => a.startsWith(`${name}=`))!)].slice(name.length + 1);

describe("BoardWriter (GitHub) — setState (gadf#225; was setStatus)", () => {
  it("ok: one query, one mutation with the item, project, field and option ids", () => {
    const { runGh, calls } = fakeGh(() => answer([item()]));
    const r = createGithubBoardWriter(runGh).setState(REF, ISSUE, "done");
    expect(r).to.deep.equal({ ok: true });
    expect(calls).to.have.lengthOf(2);
    const m = mutations(calls)[0];
    expect(arg(m, "project")).to.equal("PVT_43");
    expect(arg(m, "item")).to.equal("PVTI_1");
    expect(arg(m, "field")).to.equal("F_status");
    expect(arg(m, "option")).to.equal("O_done");
    // the issue is passed as a variable, never spliced into the query text
    expect(arg(calls[0], "url")).to.equal(ISSUE);
  });

  it("matches the option name case-insensitively (in-progress → 'In Progress')", () => {
    const { runGh, calls } = fakeGh(() => answer([item()]));
    expect(createGithubBoardWriter(runGh).setState(REF, ISSUE, "in-progress")).to.deep.equal({ ok: true });
    expect(arg(mutations(calls)[0], "option")).to.equal("O_wip");
  });

  it("picks THIS board's item when the issue is on several boards", () => {
    const other = { ...item({ number: 7 }), id: "PVTI_other" };
    const { runGh, calls } = fakeGh(() => answer([other, item()]));
    expect(createGithubBoardWriter(runGh).setState(REF, ISSUE, "done").ok).to.equal(true);
    expect(arg(mutations(calls)[0], "item")).to.equal("PVTI_1");
  });

  it("no-field: the board has no single-select field named Status", () => {
    const { runGh, calls } = fakeGh(() => answer([item({ field: null })]));
    const r = createGithubBoardWriter(runGh).setState(REF, ISSUE, "done");
    expect(r.ok).to.equal(false);
    if (r.ok) return;
    expect(r.why).to.equal("no-field");
    expect(r.detail).to.match(/#43/);
    expect(mutations(calls)).to.have.lengthOf(0);
  });

  it("no-option: Status has no option for the state — the detail names the options there are", () => {
    const field = { ...STATUS_FIELD, options: [{ id: "O_todo", name: "Todo" }, { id: "O_wip", name: "In Progress" }, { id: "O_ship", name: "Shipped" }] };
    const { runGh, calls } = fakeGh(() => answer([item({ field })]));
    const r = createGithubBoardWriter(runGh).setState(REF, ISSUE, "done");
    expect(r.ok).to.equal(false);
    if (r.ok) return;
    expect(r.why).to.equal("no-option");
    expect(r.detail).to.match(/"Done"/);
    expect(r.detail).to.match(/Todo, In Progress, Shipped/);
    expect(mutations(calls)).to.have.lengthOf(0);
  });

  it("not-on-board: the issue is on no item of this board", () => {
    const { runGh } = fakeGh(() => answer([item({ number: 7 })]));
    const r = createGithubBoardWriter(runGh).setState(REF, ISSUE, "done");
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.why).to.equal("not-on-board");
  });

  it("not-on-board: same board number under another owner does not count", () => {
    const { runGh } = fakeGh(() => answer([item({ owner: "someone-else" })]));
    const r = createGithubBoardWriter(runGh).setState(REF, ISSUE, "done");
    if (!r.ok) expect(r.why).to.equal("not-on-board");
    else expect.fail("must not set Status on another owner's board");
  });

  it("not-on-board: the issue itself cannot be resolved", () => {
    const { runGh } = fakeGh(() => answer(null));
    const r = createGithubBoardWriter(runGh).setState(REF, ISSUE, "done");
    if (!r.ok) { expect(r.why).to.equal("not-on-board"); expect(r.detail).to.include(ISSUE); }
    else expect.fail("expected a failure");
  });

  it("denied: the query is refused for permission", () => {
    const { runGh } = fakeGh(() => { throw new GhError("gh: Resource not accessible by personal access token (FORBIDDEN)"); });
    const r = createGithubBoardWriter(runGh).setState(REF, ISSUE, "done");
    if (!r.ok) { expect(r.why).to.equal("denied"); expect(r.detail).to.match(/Resource not accessible/); }
    else expect.fail("expected a failure");
  });

  it("denied: the mutation is refused (token can read the board but not write it)", () => {
    const { runGh } = fakeGh(() => answer([item()]), () => { throw new GhError("gh: Your token has not been granted the required scopes to execute this query. INSUFFICIENT_SCOPES"); });
    const r = createGithubBoardWriter(runGh).setState(REF, ISSUE, "done");
    if (!r.ok) expect(r.why).to.equal("denied");
    else expect.fail("expected a failure");
  });

  it("unreachable: gh fails for any other reason", () => {
    const { runGh } = fakeGh(() => { throw new GhError("Post \"https://api.github.com/graphql\": EOF"); });
    const r = createGithubBoardWriter(runGh).setState(REF, ISSUE, "done");
    if (!r.ok) expect(r.why).to.equal("unreachable");
    else expect.fail("expected a failure");
  });

  it("unreachable: an answer that is not the expected JSON", () => {
    const { runGh } = fakeGh(() => "<html>gateway</html>");
    const r = createGithubBoardWriter(runGh).setState(REF, ISSUE, "done");
    if (!r.ok) expect(r.why).to.equal("unreachable");
    else expect.fail("expected a failure");
  });
});

describe("BoardWriter (GitHub) — closeProject", () => {
  it("ok: closes the board", () => {
    const { runGh, calls } = fakeGh(() => "", () => "");
    expect(createGithubBoardWriter(runGh).closeProject(REF)).to.deep.equal({ ok: true });
    expect(calls[0]).to.deep.equal(["project", "close", "43", "--owner", "Svayamtech"]);
  });
  it("with a pointer: the description says where the work went, then the board closes", () => {
    const { runGh, calls } = fakeGh(() => "", () => "");
    expect(createGithubBoardWriter(runGh).closeProject(REF, "https://github.com/orgs/Svayamtech/projects/9")).to.deep.equal({ ok: true });
    expect(calls[0]!.slice(0, 5)).to.deep.equal(["project", "edit", "43", "--owner", "Svayamtech"]);
    expect(calls[0]![calls[0]!.indexOf("--description") + 1]).to.contain("projects/9");
    expect(calls[1]).to.deep.equal(["project", "close", "43", "--owner", "Svayamtech"]);
  });
  it("denied / unreachable are reported, never thrown", () => {
    const denied = fakeGh(() => "", () => { throw new GhError("HTTP 403: Resource not accessible by integration"); });
    const r1 = createGithubBoardWriter(denied.runGh).closeProject(REF);
    expect(r1.ok ? null : r1.why).to.equal("denied");
    const down = fakeGh(() => "", () => { throw new GhError("connection reset by peer"); });
    const r2 = createGithubBoardWriter(down.runGh).closeProject(REF);
    expect(r2.ok ? null : r2.why).to.equal("unreachable");
  });
});
