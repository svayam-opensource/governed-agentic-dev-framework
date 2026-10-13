// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The GitHub WorkTrackerPort adapter over a FAKE `gh` (PRJ-121 intent 03, L02): what it asks GitHub, how it reads
 * the answers, the `blocks` fallback, and that every failure is a Result with a reason — never a throw, never a
 * quiet ok. The same adapter runs the conformance suite live (test/ports/work-tracker.conformance.ts) in svayam-e2e.
 * The Status write itself (one query, one mutation, every why) is T04's: test/adapters/github/work-tracker.test.ts.
 */
import { expect } from "chai";
import { createGithubWorkTracker } from "../../src/adapters/github/work-tracker.js";
import type { GhReply } from "../../src/adapters/github/gh.js";
import { linkMarker } from "../../src/ports/work-tracker.js";

const REPO = { owner: "acme", name: "work" };
const BOARD = { owner: "acme", number: 7 };
const A = { url: "https://github.com/acme/work/issues/1" };
const B = { url: "https://github.com/acme/work/issues/2" };
const ok = (body: unknown): GhReply => ({ status: 0, stdout: typeof body === "string" ? body : JSON.stringify(body), stderr: "" });
const err = (stderr: string, status = 1): GhReply => ({ status, stdout: "", stderr });

/** A fake gh: the first route whose key the joined args contain answers; anything else is a test failure. */
function fakeGh(routes: Record<string, GhReply | (() => GhReply)>) {
  const calls: string[][] = [];
  const gh = (args: readonly string[]): GhReply => {
    calls.push([...args]);
    const line = args.join(" ");
    const key = Object.keys(routes).find((k) => line.includes(k));
    if (!key) throw new Error(`fake gh: no route for: ${line.slice(0, 200)}`);
    const r = routes[key]!;
    return typeof r === "function" ? r() : r;
  };
  return { gh, calls, port: createGithubWorkTracker({ gh }) };
}
const has = (call: readonly string[], ...want: string[]) => want.every((w) => call.includes(w));

const issueJson = { url: A.url, title: "T", body: "b", state: "OPEN", labels: [{ name: "x" }], assignees: [{ login: "alice" }] };
const STATUS = { __typename: "ProjectV2SingleSelectField", id: "F", options: [{ id: "O1", name: "Todo" }, { id: "O2", name: "In Progress" }, { id: "O3", name: "Done" }] };
const issueItems = (nodes: unknown[] | null) => ok({ data: { resource: nodes === null ? null : { __typename: "Issue", id: "I", projectItems: { nodes } } } });
const boardItem = { id: "PVTI_1", project: { id: "PVT_7", number: 7, owner: { login: "acme" }, field: STATUS } };

describe("WorkTrackerPort — GitHub adapter (fake gh)", () => {
  it("project(): title, open/closed, url, description — the owner's kind need not be known", async () => {
    const f = fakeGh({ "projectV2(number": ok({ data: { repositoryOwner: { projectV2: { number: 7, title: "Work", closed: true, url: "https://github.com/orgs/acme/projects/7", shortDescription: "moved" } } } }) });
    expect(await f.port.project(BOARD)).to.deep.equal({ ok: true, value: { ref: BOARD, title: "Work", state: "closed", url: "https://github.com/orgs/acme/projects/7", description: "moved" } });
    expect(has(f.calls[0]!, "owner=acme", "number=7")).to.equal(true);
  });

  it("project(): no such owner or board is a failure naming it", async () => {
    const r = await fakeGh({ "projectV2(number": ok({ data: { repositoryOwner: null } }) }).port.project(BOARD);
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.contain("acme#7");
  });

  it("items(): every page; issues with their Status as a state; draft notes skipped", async () => {
    const page = (nodes: unknown[], next: string | null) => ok({ data: { repositoryOwner: { projectV2: { items: { pageInfo: { hasNextPage: next !== null, endCursor: next }, nodes } } } } });
    const issue = (n: number, status: string | null, state = "OPEN") => ({
      id: `PVTI_${n}`, status: status === null ? null : { name: status },
      content: { __typename: "Issue", url: `https://github.com/acme/work/issues/${n}`, title: `t${n}`, body: "", state, labels: { nodes: [{ name: "l" }] }, assignees: { nodes: [{ login: "alice" }] } },
    });
    let n = 0;
    const f = fakeGh({ "items(first": () => (n++ === 0 ? page([issue(1, "In Progress"), { id: "PVTI_d", status: null, content: { __typename: "DraftIssue" } }], "C1") : page([issue(2, null, "CLOSED"), issue(3, "Backlog")], null)) });
    const r = await f.port.items(BOARD);
    expect(r.ok, JSON.stringify(r)).to.equal(true);
    if (!r.ok) return;
    expect(r.value.map((i) => [i.ref.url.split("/").pop(), i.state, i.workState])).to.deep.equal([["1", "open", "in-progress"], ["2", "closed", null], ["3", "open", null]]);
    expect(r.value[0]).to.deep.include({ labels: ["l"], assignees: ["alice"] });
    expect(f.calls[1]).to.include("after=C1");
  });

  it("item(): reads the issue; state lower-cased", async () => {
    const f = fakeGh({ "issue view": ok(issueJson) });
    expect(await f.port.item(A)).to.deep.equal({ ok: true, value: { ref: A, title: "T", body: "b", state: "open", labels: ["x"], assignees: ["alice"] } });
  });

  it("create(): no assignee → refused without calling gh", async () => {
    const f = fakeGh({});
    const r = await f.port.create(REPO, { title: "T", body: "", assignee: " " });
    expect(r.ok).to.equal(false);
    expect(f.calls).to.have.lengthOf(0);
  });

  it("create(): title, body, assignee and labels; then onto each project", async () => {
    const f = fakeGh({ "issue create": ok(`Creating issue\n${A.url}\n`), "project item-add": ok({ id: "PVTI_1" }) });
    const r = await f.port.create(REPO, { title: "T", body: "B", assignee: "alice", labels: ["x", "y"] }, [BOARD]);
    expect(r).to.deep.equal({ ok: true, value: A });
    expect(has(f.calls[0]!, "--repo", "acme/work", "--title", "T", "--body", "B", "--assignee", "alice")).to.equal(true);
    expect(f.calls[0]!.filter((a) => a === "--label")).to.have.lengthOf(2);
    expect(has(f.calls[1]!, "item-add", "7", "--owner", "acme", "--url", A.url)).to.equal(true);
  });

  it("create(): a label the repo does not have yet is created, then the issue is created once more (gov project's anchor)", async () => {
    let first = true;
    const f = fakeGh({
      "issue create": () => (first ? ((first = false), err("could not add label: 'anchor' not found")) : ok(A.url)),
      "label create": ok(""),
    });
    const r = await f.port.create(REPO, { title: "T", body: "", assignee: "alice", labels: ["anchor"] });
    expect(r).to.deep.equal({ ok: true, value: A });
    expect(f.calls.map((c) => c.slice(0, 2).join(" "))).to.deep.equal(["issue create", "label create", "issue create"]);
    expect(has(f.calls[1]!, "anchor", "--repo", "acme/work")).to.equal(true);
    expect(f.calls[1]!.includes("--force"), "an existing label is never overwritten").to.equal(false);
  });

  it("create(): any other refusal is not retried", async () => {
    const f = fakeGh({ "issue create": err("HTTP 403: Resource not accessible") });
    const r = await f.port.create(REPO, { title: "T", body: "", assignee: "alice", labels: ["anchor"] });
    expect(r.ok).to.equal(false);
    expect(f.calls).to.have.lengthOf(1);
  });

  it("create(): made but not added to a project → a failure that names the item made", async () => {
    const f = fakeGh({ "issue create": ok(A.url), "project item-add": err("gh: Could not resolve to a ProjectV2 with the number 7.") });
    const r = await f.port.create(REPO, { title: "T", body: "", assignee: "alice" }, [BOARD]);
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.contain(A.url).and.contain("acme#7");
  });

  it("removeFromProject(): finds this board's item id, then deletes it; not on the board → failure", async () => {
    const f = fakeGh({ "resource(url": issueItems([boardItem]), "item-delete": ok("") });
    expect(await f.port.removeFromProject(BOARD, A)).to.deep.equal({ ok: true, value: undefined });
    expect(has(f.calls[1]!, "item-delete", "7", "--owner", "acme", "--id", "PVTI_1")).to.equal(true);
    const g = fakeGh({ "resource(url": issueItems([]) });
    const r = await g.port.removeFromProject(BOARD, A);
    expect(r.ok).to.equal(false);
    if (!r.ok) expect(r.reason).to.match(/not an item/);
  });

  it("setState(): the state's Status option, through the T04 write; its why becomes the reason", async () => {
    const f = fakeGh({ "updateProjectV2ItemFieldValue": ok("{\"data\":{}}"), "resource(url": issueItems([boardItem]) });
    expect(await f.port.setState(BOARD, A, "in-progress")).to.deep.equal({ ok: true, value: undefined });
    expect(f.calls[1]).to.include("option=O2");
    const off = await fakeGh({ "resource(url": issueItems([]) }).port.setState(BOARD, A, "done");
    expect(off).to.include({ ok: false, retryable: false });
    if (!off.ok) expect(off.reason).to.match(/^not-on-board: /);
  });

  it("link(blocks): native — b is blocked by a, by a's issue id", async () => {
    const f = fakeGh({ "repos/acme/work/issues/1": ok({ id: 1001, number: 1 }), "dependencies/blocked_by": ok({}) });
    expect(await f.port.link(A, B, "blocks")).to.deep.equal({ ok: true, value: { via: "native" } });
    expect(has(f.calls[1]!, "-X", "POST", "repos/acme/work/issues/2/dependencies/blocked_by", "issue_id=1001")).to.equal(true);
  });

  it("link(blocks): refused by the API → a marker comment on the blocked item, and the result says so", async () => {
    const f = fakeGh({ "repos/acme/work/issues/1": ok({ id: 1001 }), "dependencies/blocked_by": err("gh: Not Found (HTTP 404)"), "issue comment": ok("") });
    expect(await f.port.link(A, B, "blocks")).to.deep.equal({ ok: true, value: { via: "marker" } });
    const c = f.calls[2]!;
    expect(has(c, "issue", "comment", B.url)).to.equal(true);
    expect(c[c.indexOf("--body") + 1]).to.contain(linkMarker(A, "blocks", B)).and.contain(A.url);
  });

  it("link(blocks): a dropped connection is a retryable failure, not a fallback", async () => {
    const f = fakeGh({ "repos/acme/work/issues/1": ok({ id: 1001 }), "dependencies/blocked_by": err("Post \"https://api.github.com/\": EOF") });
    expect(await f.port.link(A, B, "blocks")).to.include({ ok: false, retryable: true });
    expect(f.calls).to.have.lengthOf(2);
  });

  it("link(blocks): the blocking item cannot be read → failure (no comment written)", async () => {
    const f = fakeGh({ "repos/acme/work/issues/1": err("gh: Not Found (HTTP 404)") });
    expect((await f.port.link(A, B, "blocks")).ok).to.equal(false);
    expect(f.calls).to.have.lengthOf(1);
  });

  it("link(relates | moved-to): a marker comment on the first item", async () => {
    for (const kind of ["relates", "moved-to"] as const) {
      const f = fakeGh({ "issue comment": ok("") });
      expect(await f.port.link(A, B, kind)).to.deep.equal({ ok: true, value: { via: "marker" } });
      expect(f.calls[0]).to.include(A.url);
      expect(f.calls[0]![f.calls[0]!.indexOf("--body") + 1]).to.contain(linkMarker(A, kind, B));
    }
  });

  it("link(): an item that is not an issue URL is refused", async () => {
    expect((await fakeGh({}).port.link({ url: "nope" }, B, "blocks")).ok).to.equal(false);
  });

  it("label(): add and remove in one edit; nothing to do → ok without calling gh", async () => {
    const f = fakeGh({ "issue edit": ok("") });
    expect(await f.port.label(A, ["a", "b"], ["c"])).to.deep.equal({ ok: true, value: undefined });
    expect(f.calls[0]).to.deep.equal(["issue", "edit", A.url, "--add-label", "a,b", "--remove-label", "c"]);
    expect(await f.port.label(A, [])).to.deep.equal({ ok: true, value: undefined });
    expect(f.calls).to.have.lengthOf(1);
  });

  it("comment(): written; empty refused; GitHub's refusal is the reason", async () => {
    const f = fakeGh({ "issue comment": ok("") });
    expect(await f.port.comment(A, "hi")).to.deep.equal({ ok: true, value: undefined });
    expect((await f.port.comment(A, " ")).ok).to.equal(false);
    const g = fakeGh({ "issue comment": err("GraphQL: Could not resolve to an issue or pull request with the number of 2. (repository.issue)") });
    const r = await g.port.comment(B, "x");
    expect(r.ok === false && r.reason).to.contain("Could not resolve");
  });

  it("search(): in a repo, by labels, state and marker — the marker matched exactly in the body", async () => {
    const hit = { url: A.url, title: "a", body: "x <!-- gov-signal {\"to\":\"PRJ-2\"} --> y", state: "open", labels: [{ name: "gov-signal:ask" }], assignees: [] };
    const near = { ...hit, url: B.url, body: "gov-signal to PRJ-2 but no marker" };
    const f = fakeGh({ "search issues": ok([hit, near]) });
    const r = await f.port.search({ repo: REPO, labels: ["gov-signal:ask"], state: "open", marker: "<!-- gov-signal {\"to\":\"PRJ-2\"}" });
    expect(r.ok && r.value.map((x) => x.ref.url)).to.deep.equal([A.url]);
    const c = f.calls[0]!;
    expect(has(c, "--repo", "acme/work", "--label", "gov-signal:ask", "--state", "open")).to.equal(true);
    expect(c.join(" ")).to.not.contain("{");
  });

  it("search(): no repo → refused rather than searching all of GitHub", async () => {
    const f = fakeGh({});
    expect((await f.port.search({ labels: ["x"] })).ok).to.equal(false);
    expect(f.calls).to.have.lengthOf(0);
  });

  it("createProject(): the new board's number; empty title refused", async () => {
    const f = fakeGh({ "project create": ok({ number: 12, url: "u" }) });
    expect(await f.port.createProject("acme", "New")).to.deep.equal({ ok: true, value: { owner: "acme", number: 12 } });
    expect(has(f.calls[0]!, "--owner", "acme", "--title", "New")).to.equal(true);
    expect((await f.port.createProject("acme", "")).ok).to.equal(false);
  });

  it("closeProject(pointer): the description says where the work went, then the board closes", async () => {
    const f = fakeGh({ "project edit": ok(""), "project close": ok("") });
    expect(await f.port.closeProject(BOARD, "https://github.com/orgs/acme/projects/9")).to.deep.equal({ ok: true, value: undefined });
    expect(f.calls[0]![f.calls[0]!.indexOf("--description") + 1]).to.contain("https://github.com/orgs/acme/projects/9");
    expect(f.calls[1]).to.deep.equal(["project", "close", "7", "--owner", "acme"]);
  });

  it("closeProject(): a pointer that cannot be written leaves the board open and says why", async () => {
    const f = fakeGh({ "project edit": err("gh: HTTP 403: Resource not accessible by integration") });
    const r = await f.port.closeProject(BOARD, "p");
    expect(r.ok).to.equal(false);
    expect(f.calls).to.have.lengthOf(1);
  });

  it("a gh that throws (not installed) is a failure, never an exception", async () => {
    const port = createGithubWorkTracker({ gh: () => { throw new Error("spawn gh ENOENT"); } });
    const r = await port.item(A);
    expect(r.ok === false && r.reason).to.contain("ENOENT");
  });
});
