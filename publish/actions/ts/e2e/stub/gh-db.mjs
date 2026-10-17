#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// A FAKE GITHUB WITH A MEMORY, for scenarios where one run must see what the last one did (PRJ-121 intent 03, L17:
// `gov autorun` is idempotent only if its second run finds the change request its first run opened).
//
// `stub/gh` hands a call here when GH_STUB_DB is set (a directory). Exit 3 = "not mine" — the stub then answers as
// it always has. Everything is JSON files in that directory, so a scenario arranges the world by writing them and
// asserts by reading them:
//
//   prs.json      [{ repo, number, state: open|closed, merged, draft, title, body, head, base }]
//   reviews.json  { "<owner/repo>#<n>": [{ user: { login, type }, state, submitted_at }] }
//   issues.json   [{ url, repo, title, body, state: OPEN|CLOSED, labels: [names], assignees: [logins] }]
//   board.json    [{ url, status }]   — the project board's items, in order
//
// What it answers: the pulls API (open, read, list, reviews), issue create / view / edit / comment, project
// item-add, and the board items GraphQL query. Nothing here merges or closes: a call to do so is not answered, and
// the stub's log (GH_STUB_LOG) is where a scenario proves nobody asked.
import * as fs from "node:fs";
import * as path from "node:path";

const DB = process.env.GH_STUB_DB;
if (!DB) process.exit(3);
const args = process.argv.slice(2);
const line = args.join(" ");

const file = (n) => path.join(DB, n);
const load = (n, empty) => { try { return JSON.parse(fs.readFileSync(file(n), "utf8")); } catch { return empty; } };
const save = (n, v) => fs.writeFileSync(file(n), JSON.stringify(v, null, 2));
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const fField = (k) => args.map((a, i) => (args[i - 1] === "-f" || args[i - 1] === "-F") && a.startsWith(`${k}=`) ? a.slice(k.length + 1) : undefined).find((x) => x !== undefined);
const out = (v) => { process.stdout.write(typeof v === "string" ? v : `${JSON.stringify(v)}\n`); process.exit(0); };
const prJson = (p) => ({
  number: p.number, state: p.state, merged: !!p.merged, merged_at: p.merged ? "2026-10-01T00:00:00Z" : null, draft: !!p.draft,
  title: p.title, body: p.body ?? "", html_url: `https://github.com/${p.repo}/pull/${p.number}`, head: { ref: p.head }, base: { ref: p.base },
});

// ── the pulls API ────────────────────────────────────────────────────────────────────────────────────────────
let m;
if (args[0] === "api" && args[1] === "-X" && args[2] === "POST" && (m = /^repos\/([^/]+\/[^/]+)\/pulls$/.exec(args[3] ?? ""))) {
  const prs = load("prs.json", []);
  const repo = m[1];
  const head = fField("head"), base = fField("base");
  if (prs.some((p) => p.repo === repo && p.head === head && p.base === base && p.state === "open")) {
    process.stderr.write(`gh: A pull request already exists for ${head}. (HTTP 422)\n`); process.exit(1);
  }
  const number = Math.max(100, ...prs.filter((p) => p.repo === repo).map((p) => p.number)) + 1;
  const p = { repo, number, state: "open", merged: false, draft: fField("draft") === "true", title: fField("title") ?? "", body: fField("body") ?? "", head, base };
  prs.push(p); save("prs.json", prs);
  out(prJson(p));
}
if (args[0] === "api" && args[1] === "--paginate" && (m = /^repos\/([^/]+\/[^/]+)\/pulls\/(\d+)\/reviews/.exec(args[2] ?? ""))) {
  const reviews = load("reviews.json", {})[`${m[1]}#${m[2]}`] ?? [];
  out(reviews.map((r) => `${JSON.stringify(r)}\n`).join(""));
}
if (args[0] === "api" && args[1] === "--paginate" && (m = /^repos\/([^/]+\/[^/]+)\/pulls\?(.*)$/.exec(args[2] ?? ""))) {
  const q = new URLSearchParams(m[2]);
  const repo = m[1];
  const want = q.get("state") ?? "open";
  const head = q.get("head")?.replace(/^[^:]+:/, "");
  const list = load("prs.json", []).filter((p) => p.repo === repo)
    .filter((p) => want === "all" || p.state === want)
    .filter((p) => !q.get("base") || p.base === q.get("base"))
    .filter((p) => !head || p.head === head)
    .sort((a, b) => b.number - a.number);
  out(list.map((p) => `${JSON.stringify(prJson(p))}\n`).join(""));
}
if (args[0] === "api" && (m = /^repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/.exec(args[1] ?? ""))) {
  const p = load("prs.json", []).find((x) => x.repo === m[1] && x.number === Number(m[2]));
  if (!p) { process.stderr.write("gh: Not Found (HTTP 404)\n"); process.exit(1); }
  out(prJson(p));
}

// ── issues ───────────────────────────────────────────────────────────────────────────────────────────────────
if (args[0] === "issue" && args[1] === "create") {
  const issues = load("issues.json", []);
  const repo = flag("--repo");
  const n = Math.max(200, ...issues.filter((i) => i.repo === repo).map((i) => Number(i.url.split("/").pop()))) + 1;
  const labels = args.map((a, i) => (args[i - 1] === "--label" ? a : undefined)).filter(Boolean);
  const it = { url: `https://github.com/${repo}/issues/${n}`, repo, title: flag("--title") ?? "", body: flag("--body") ?? "", state: "OPEN", labels, assignees: [flag("--assignee")] };
  issues.push(it); save("issues.json", issues);
  out(`${it.url}\n`);
}
if (args[0] === "issue" && args[1] === "view") {
  const it = load("issues.json", []).find((i) => i.url === args[2]);
  if (!it) process.exit(3);
  out({ ...it, labels: it.labels.map((name) => ({ name })), assignees: it.assignees.map((login) => ({ login })) });
}
if (args[0] === "issue" && args[1] === "edit") {
  const issues = load("issues.json", []);
  const it = issues.find((i) => i.url === args[2]);
  if (!it) process.exit(3);
  for (const l of (flag("--add-label") ?? "").split(",").filter(Boolean)) if (!it.labels.includes(l)) it.labels.push(l);
  save("issues.json", issues);
  out("");
}
if (args[0] === "issue" && args[1] === "comment") out("");

// ── the board ────────────────────────────────────────────────────────────────────────────────────────────────
if (args[0] === "project" && args[1] === "item-add") {
  const board = load("board.json", []);
  const url = flag("--url");
  if (!board.some((b) => b.url === url)) { board.push({ url, status: "Todo" }); save("board.json", board); }
  out({ id: `PVTI_${board.length}` });
}
if (args[0] === "api" && args[1] === "graphql" && line.includes("items(first: 100")) {
  const issues = load("issues.json", []);
  const nodes = load("board.json", []).map((b, i) => {
    const it = issues.find((x) => x.url === b.url) ?? { url: b.url, title: "", body: "", state: "OPEN", labels: [], assignees: [] };
    return {
      id: `PVTI_${i + 1}`, status: b.status ? { name: b.status } : null,
      content: { __typename: "Issue", url: it.url, title: it.title, body: it.body, state: it.state,
        labels: { nodes: it.labels.map((name) => ({ name })) }, assignees: { nodes: it.assignees.map((login) => ({ login })) } },
    };
  });
  out({ data: { repositoryOwner: { projectV2: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } } } });
}

process.exit(3);
