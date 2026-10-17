// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The GitHub adapter of the {@link WorkTrackerPort} (gadf#225, completed by PRJ-121 intent 03 L02).
 *
 * The Status write (T04) is ONE query and ONE mutation. The query starts from the ISSUE (`resource(url:)`) and
 * reads its project items, each with its project's number, owner and `Status` field — so the item id, project id,
 * field id and option ids all arrive together, and the owner's kind (organization or user) never has to be known.
 * The mutation is `updateProjectV2ItemFieldValue`. `gh project item-edit --url … --field … --value …` does not
 * exist in that form; that is what the old stub's comment found.
 *
 * Two shapes from one implementation: {@link createGithubWorkTracker} (the full async port) and
 * {@link createGithubBoardWriter} (the synchronous slice `gov task` / `merge` / `close` / `cancel` hold).
 *
 * Values travel as GraphQL VARIABLES (`-f name=value`) or as separate argv entries, never spliced into query text.
 */
import { isTransientGhError, type RunGh } from "../../lifecycle/gh-board.js";
import { fail, ok, type Result } from "../../ports/result.js";
import type { RepoRef } from "../../ports/vcs.js";
import {
  STATE_NAMES, linkMarker, statusAsResult, stateOfStatus,
  type BoardCloseResult, type BoardStatusResult, type BoardWriter, type Item, type ItemRef, type LinkKind,
  type ProjectRef, type WorkState, type WorkTrackerPort,
} from "../../ports/work-tracker.js";
import { defaultGhRun, ghCall, ghFailure, ghJson, type GhReply, type GhRun } from "./gh.js";

const ITEMS_OF_ISSUE = `query($url: URI!) {
  resource(url: $url) {
    __typename
    ... on Issue { id projectItems(first: 50) { nodes { ...item } } }
    ... on PullRequest { id projectItems(first: 50) { nodes { ...item } } }
  }
}
fragment item on ProjectV2Item {
  id
  project {
    id number
    owner { ... on Organization { login } ... on User { login } }
    field(name: "Status") { __typename ... on ProjectV2SingleSelectField { id options { id name } } }
  }
}`;

const SET_MUTATION = `mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field, value: { singleSelectOptionId: $option } }) {
    projectV2Item { id }
  }
}`;

const PROJECT_QUERY = `query($owner: String!, $number: Int!) {
  repositoryOwner(login: $owner) {
    ... on Organization { projectV2(number: $number) { ...p } }
    ... on User { projectV2(number: $number) { ...p } }
  }
}
fragment p on ProjectV2 { number title closed url shortDescription }`;

const PROJECT_ITEMS_QUERY = `query($owner: String!, $number: Int!, $after: String) {
  repositoryOwner(login: $owner) {
    ... on Organization { projectV2(number: $number) { ...items } }
    ... on User { projectV2(number: $number) { ...items } }
  }
}
fragment items on ProjectV2 {
  items(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
      content {
        __typename
        ... on Issue { url title body state labels(first: 100) { nodes { name } } assignees(first: 50) { nodes { login } } }
        ... on PullRequest { url title body state labels(first: 100) { nodes { name } } assignees(first: 50) { nodes { login } } }
      }
    }
  }
}`;

interface ItemNode {
  readonly id?: string;
  readonly project?: {
    readonly id?: string;
    readonly number?: number;
    readonly owner?: { readonly login?: string } | null;
    readonly field?: { readonly __typename?: string; readonly id?: string; readonly options?: readonly { id: string; name: string }[] } | null;
  } | null;
}

// ── T04's Status write, on a GhRun ─────────────────────────────────────────────────────────────────────────────

/** Permission refusals, as gh and the GraphQL API word them. Everything else is `unreachable`. */
const DENIED = /Resource not accessible|FORBIDDEN|INSUFFICIENT_SCOPES|not been granted the required scopes|HTTP 40[13]|Bad credentials|must have .*(?:access|permission)|does not have permission/i;

function failureText(r: GhReply): string {
  return r.stderr.replace(/^Command failed:[^\n]*\n?/, "").trim().split("\n").filter(Boolean).slice(-1)[0] ?? "gh failed";
}
function classify(r: GhReply): { ok: false; why: "denied" | "unreachable"; detail: string } {
  return { ok: false, why: DENIED.test(r.stderr) ? "denied" : "unreachable", detail: failureText(r) };
}

/** The issue's item on THIS board, with the board's Status field — or why not. */
function boardItem(gh: GhRun, p: ProjectRef, issueUrl: string): { ok: true; node: ItemNode } | { ok: false; result: BoardStatusResult } {
  const reply = ghCall(gh, ["api", "graphql", "-f", `query=${ITEMS_OF_ISSUE}`, "-f", `url=${issueUrl}`]);
  if (reply.status !== 0) {
    if (/Could not resolve to a/i.test(reply.stderr)) return { ok: false, result: { ok: false, why: "not-on-board", detail: `${issueUrl} could not be resolved` } };
    return { ok: false, result: classify(reply) };
  }
  let nodes: readonly ItemNode[] | null;
  try {
    const j = JSON.parse(reply.stdout) as { data?: { resource?: { projectItems?: { nodes?: ItemNode[] } } | null } };
    if (!j.data) return { ok: false, result: { ok: false, why: "unreachable", detail: "GitHub's answer carried no data" } };
    nodes = j.data.resource ? (j.data.resource.projectItems?.nodes ?? []) : null;
  } catch { /* not JSON — reported to the caller as `unreachable`, which is the account of it */
    return { ok: false, result: { ok: false, why: "unreachable", detail: "GitHub's answer was not JSON" } };
  }
  if (nodes === null) return { ok: false, result: { ok: false, why: "not-on-board", detail: `${issueUrl} could not be resolved (not found, or not readable with this token)` } };
  const owner = p.owner.toLowerCase();
  const node = nodes.find((n) => n?.project?.number === p.number && (n.project.owner?.login ?? "").toLowerCase() === owner);
  if (!node?.id || !node.project?.id) {
    return { ok: false, result: { ok: false, why: "not-on-board", detail: `${issueUrl} is not an item of board ${p.owner}#${p.number}` } };
  }
  return { ok: true, node };
}

function setStateSync(gh: GhRun, p: ProjectRef, issueUrl: string, s: WorkState): BoardStatusResult {
  const found = boardItem(gh, p, issueUrl);
  if (!found.ok) return found.result;
  const item = found.node;
  const field = item.project!.field;
  if (!field?.id || field.__typename !== "ProjectV2SingleSelectField") {
    return { ok: false, why: "no-field", detail: `board #${p.number} has no single-select field named Status` };
  }
  const options = field.options ?? [];
  const option = options.find((o) => stateOfStatus(o.name) === s);
  if (!option) {
    return { ok: false, why: "no-option", detail: `Status on board #${p.number} has no option "${STATE_NAMES[s]}" (options: ${options.map((o) => o.name).join(", ") || "none"})` };
  }
  const set = ghCall(gh, ["api", "graphql", "-f", `query=${SET_MUTATION}`,
    "-f", `project=${item.project!.id}`, "-f", `item=${item.id}`, "-f", `field=${field.id}`, "-f", `option=${option.id}`]);
  return set.status === 0 ? { ok: true } : classify(set);
}

function closeProjectSync(gh: GhRun, p: ProjectRef, pointer?: string): BoardCloseResult {
  if (pointer !== undefined) {
    const edit = ghCall(gh, ["project", "edit", String(p.number), "--owner", p.owner, "--description", `Closed — the work continues at ${pointer}`]);
    if (edit.status !== 0) return classify(edit);
  }
  const close = ghCall(gh, ["project", "close", String(p.number), "--owner", p.owner]);
  return close.status === 0 ? { ok: true } : classify(close);
}

/** A throwing {@link RunGh} (the lifecycle's runner) as a {@link GhRun}: a throw becomes a failed reply. */
export function ghRunFrom(runGh: RunGh): GhRun {
  return (args) => {
    try { return { status: 0, stdout: runGh([...args]), stderr: "" }; } catch (e) {
      const x = e as { message?: string; stderr?: string | Buffer; status?: number };
      return { status: typeof x?.status === "number" && x.status !== 0 ? x.status : 1, stdout: "", stderr: `${x?.message ?? String(e)}\n${x?.stderr?.toString() ?? ""}`.trim() };
    }
  };
}

/** The synchronous {@link BoardWriter} for `gov task` / `merge` / `close` / `cancel`. `runGh` is injectable for tests. */
export function createGithubBoardWriter(runGh: RunGh): BoardWriter {
  const gh = ghRunFrom(runGh);
  return {
    setState: (p, issueUrl, s) => setStateSync(gh, p, issueUrl, s),
    closeProject: (p, pointer) => closeProjectSync(gh, p, pointer),
  };
}

// ── The full port ──────────────────────────────────────────────────────────────────────────────────────────────

const slug = (r: RepoRef): string => `${r.owner}/${r.name}`;
const board = (p: ProjectRef): string => `${p.owner}#${p.number}`;
const done: Result<void> = ok(undefined);

/** owner/repo/number of an issue (or pull request) URL — what the REST endpoints need. */
function issueParts(i: ItemRef): { owner: string; repo: string; number: number } | null {
  const m = /^https:\/\/[^/]+\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)\b/.exec(i.url);
  return m ? { owner: m[1]!, repo: m[2]!, number: Number(m[3]) } : null;
}

const lower = (s: string | undefined): "open" | "closed" => ((s ?? "").toUpperCase() === "OPEN" ? "open" : "closed");
const names = (xs: readonly { name?: string }[] | undefined): string[] => (xs ?? []).map((x) => x.name ?? "").filter(Boolean);
const logins = (xs: readonly { login?: string }[] | undefined): string[] => (xs ?? []).map((x) => x.login ?? "").filter(Boolean);

interface GhIssue { url?: string; title?: string; body?: string; state?: string; labels?: { name?: string }[]; assignees?: { login?: string }[] }
const toItem = (j: GhIssue, fallbackUrl = ""): Item => ({
  ref: { url: j.url ?? fallbackUrl }, title: j.title ?? "", body: j.body ?? "", state: lower(j.state),
  labels: names(j.labels), assignees: logins(j.assignees),
});

/** GitHub's "refused" for a link it will not make: missing endpoint, feature off, not allowed, invalid. */
const REFUSED = /HTTP 4(?:0[0-9]|1[0-9]|2[0-9])|Not Found|not enabled|not available|Validation Failed/i;

export interface GithubWorkTrackerDeps { readonly gh?: GhRun }

/** The full {@link WorkTrackerPort} on GitHub. The runner is injectable; unit tests use a fake. */
export function createGithubWorkTracker(deps: GithubWorkTrackerDeps = {}): WorkTrackerPort {
  const gh = deps.gh ?? defaultGhRun;

  /** A write whose only answer is its exit status. */
  const write = (args: readonly string[], what: string): Result<void> => {
    const r = ghCall(gh, args);
    return r.status === 0 ? done : ghFailure(r, what);
  };
  const comment = (i: ItemRef, text: string): Result<void> =>
    text.trim() ? write(["issue", "comment", i.url, "--body", text], `commenting on ${i.url}`) : fail("a comment needs text");
  const addToProject = (p: ProjectRef, i: ItemRef): Result<void> =>
    write(["project", "item-add", String(p.number), "--owner", p.owner, "--url", i.url, "--format", "json"], `adding ${i.url} to project ${board(p)}`);

  const linkByMarker = (on: ItemRef, a: ItemRef, kind: LinkKind, b: ItemRef, note = ""): Result<{ via: "marker" }> => {
    const say = { blocks: `Blocked by ${a.url}.`, relates: `Related to ${b.url}.`, "moved-to": `Moved to ${b.url}.` }[kind];
    const c = comment(on, `${say}${note}\n\n${linkMarker(a, kind, b)}`);
    return c.ok ? ok({ via: "marker" }) : c;
  };

  return {
    async project(p) {
      const j = ghJson<{ data?: { repositoryOwner?: { projectV2?: { number?: number; title?: string; closed?: boolean; url?: string; shortDescription?: string | null } | null } | null } }>(
        gh, ["api", "graphql", "-f", `query=${PROJECT_QUERY}`, "-f", `owner=${p.owner}`, "-F", `number=${p.number}`], `reading project ${board(p)}`);
      if (!j.ok) return j;
      const v = j.value.data?.repositoryOwner?.projectV2;
      if (!v) return fail(`no project ${board(p)} (not found, or not readable with this token)`);
      return ok({ ref: { owner: p.owner, number: p.number }, title: v.title ?? "", state: v.closed ? "closed" : "open", url: v.url ?? "", description: v.shortDescription ?? "" });
    },

    async items(p) {
      type Content = Omit<GhIssue, "labels" | "assignees"> & { __typename?: string; labels?: { nodes?: { name?: string }[] }; assignees?: { nodes?: { login?: string }[] } };
      type Node = { status?: { name?: string } | null; content?: Content | null };
      type Page = { data?: { repositoryOwner?: { projectV2?: { items?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }; nodes?: Node[] } } | null } | null } };
      const out: Item[] = [];
      let after: string | null = null;
      for (let page = 0; page < 100; page++) {
        const args: string[] = ["api", "graphql", "-f", `query=${PROJECT_ITEMS_QUERY}`, "-f", `owner=${p.owner}`, "-F", `number=${p.number}`, ...(after ? ["-f", `after=${after}`] : [])];
        const j: Result<Page> = ghJson<Page>(gh, args, `reading the items of project ${board(p)}`);
        if (!j.ok) return j;
        type Conn = NonNullable<NonNullable<NonNullable<NonNullable<Page["data"]>["repositoryOwner"]>["projectV2"]>["items"]>;
        const conn: Conn | undefined = j.value.data?.repositoryOwner?.projectV2?.items;
        if (!conn) return fail(`no project ${board(p)} (not found, or not readable with this token)`);
        for (const n of conn.nodes ?? []) {
          const c = n?.content;
          if (!c || (c.__typename !== "Issue" && c.__typename !== "PullRequest") || !c.url) continue;   // draft notes are not items
          out.push({ ...toItem({ ...c, labels: c.labels?.nodes, assignees: c.assignees?.nodes }), workState: stateOfStatus(n.status?.name) });
        }
        if (!conn.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) return ok(out);
        after = conn.pageInfo.endCursor;
      }
      return fail(`project ${board(p)} has more items than gov reads (10 000)`);
    },

    async item(i) {
      const j = ghJson<GhIssue>(gh, ["issue", "view", i.url, "--json", "url,title,body,state,labels,assignees"], `reading ${i.url}`);
      return j.ok ? ok(toItem(j.value, i.url)) : j;
    },

    async create(where, item, onto = []) {
      if (!item.assignee?.trim()) return fail("an item needs an assignee — gov never creates an unassigned one");
      if (!item.title.trim()) return fail("an item needs a title");
      const args = ["issue", "create", "--repo", slug(where), "--title", item.title, "--body", item.body, "--assignee", item.assignee.trim()];
      for (const l of item.labels ?? []) args.push("--label", l);
      let r = ghCall(gh, args);
      // A LABEL THE REPO HAS NEVER HAD (plan 03 L06). `gh issue create --label x` refuses when x does not exist, which is
      // the first `gov project` in a fresh governance repo (no `anchor` yet). Create the missing labels — without
      // --force, so an existing one keeps its colour — and try once more. Any other refusal is returned as it came.
      if (r.status !== 0 && (item.labels ?? []).length && /could not add label/i.test(r.stderr)) {
        for (const l of item.labels ?? []) ghCall(gh, ["label", "create", l, "--repo", slug(where)]);   // "already exists" is fine: the retry says what matters
        r = ghCall(gh, args);
      }
      if (r.status !== 0) return ghFailure(r, `creating an item in ${slug(where)}`);
      const url = r.stdout.split(/\r?\n/).map((l) => l.trim()).reverse().find((l) => /^https?:\/\//.test(l));
      if (!url) return fail(`creating an item in ${slug(where)}: gh did not print the new item's address`);
      for (const p of onto) {
        const a = addToProject(p, { url });
        if (!a.ok) return fail(`created ${url}, but it is not on project ${board(p)} — ${a.reason}`, a.retryable);
      }
      return ok({ url });
    },

    async addToProject(p, i) { return addToProject(p, i); },

    async removeFromProject(p, i) {
      const found = boardItem(gh, p, i.url);
      if (!found.ok) return statusAsResult(found.result);
      return write(["project", "item-delete", String(p.number), "--owner", p.owner, "--id", found.node.id!], `removing ${i.url} from project ${board(p)}`);
    },

    async setState(p, i, s) { return statusAsResult(setStateSync(gh, p, i.url, s)); },

    async link(a, b, kind) {
      if (kind !== "blocks") return linkByMarker(a, a, kind, b);
      const pa = issueParts(a), pb = issueParts(b);
      if (!pa || !pb) return fail(`a blocks link needs two issue addresses (${a.url}, ${b.url})`);
      const ida = ghJson<{ id?: number }>(gh, ["api", `repos/${pa.owner}/${pa.repo}/issues/${pa.number}`], `reading ${a.url}`);
      if (!ida.ok) return ida;
      if (typeof ida.value.id !== "number") return fail(`reading ${a.url}: GitHub's answer had no id`);
      const r = ghCall(gh, ["api", "-X", "POST", `repos/${pb.owner}/${pb.repo}/issues/${pb.number}/dependencies/blocked_by`, "-F", `issue_id=${ida.value.id}`]);
      if (r.status === 0) return ok({ via: "native" });
      if (isTransientGhError({ stderr: r.stderr }) || !REFUSED.test(r.stderr)) return ghFailure(r, `linking ${a.url} blocks ${b.url}`);
      // The API refused the relation (no dependencies on this plan, across owners, …): record it where a person sees it.
      const said = r.stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-1)[0] ?? "";
      return linkByMarker(b, a, kind, b, ` (GitHub refused a native link: ${said})`);
    },

    async label(i, add, remove = []) {
      if (add.length === 0 && remove.length === 0) return done;
      return write(["issue", "edit", i.url, ...(add.length ? ["--add-label", add.join(",")] : []), ...(remove.length ? ["--remove-label", remove.join(",")] : [])], `labelling ${i.url}`);
    },

    async comment(i, text) { return comment(i, text); },

    async close(i) { return write(["issue", "close", i.url], `closing ${i.url}`); },

    async search(q) {
      if (!q.repo) return fail("search needs a repository on GitHub — gov will not search all of GitHub");
      const args = ["search", "issues", "--repo", slug(q.repo), "--json", "url,title,body,state,labels,assignees", "--limit", "500"];
      for (const l of q.labels ?? []) args.push("--label", l);
      if (q.state) args.push("--state", q.state);
      // GitHub's search tokenises and ignores punctuation; ask for the marker's words, then match it exactly.
      const words = (q.marker ?? "").replace(/[^\p{L}\p{N}_-]+/gu, " ").split(" ").filter((w) => /[\p{L}\p{N}]/u.test(w)).join(" ");
      if (words) args.push("--", `${words} in:body`);
      const j = ghJson<GhIssue[]>(gh, args, `searching ${slug(q.repo)}`);
      if (!j.ok) return j;
      const want = q.labels ?? [];
      return ok((Array.isArray(j.value) ? j.value : []).map((x) => toItem(x))
        .filter((x) => !q.marker || x.body.includes(q.marker))
        .filter((x) => want.every((l) => x.labels.includes(l)))
        .filter((x) => !q.state || x.state === q.state));
    },

    async createProject(owner, title) {
      if (!title.trim()) return fail("a project needs a title");
      const j = ghJson<{ number?: number }>(gh, ["project", "create", "--owner", owner, "--title", title, "--format", "json"], `creating a project for ${owner}`);
      if (!j.ok) return j;
      return typeof j.value.number === "number" ? ok({ owner, number: j.value.number }) : fail(`creating a project for ${owner}: GitHub's answer had no number`);
    },

    async closeProject(p, pointer) { return statusAsResult(closeProjectSync(gh, p, pointer)); },
  };
}
