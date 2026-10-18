#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// A STUB PORTAL + IAM FOR THE INSTALL-SIGNUP JOURNEY (PRJ-121 intent 02 addendum, IS-E6 "now" half; spec
// addendum-install-signup §3, §4, §5, §8, §9).
//
// The real pages live in portal-web (912-SVM-LIB-UI) and the real account data in IAM (PRJ-119, signals S-g…S-k),
// neither of which exists yet. This server is the JOURNEY PORT: the few calls e2e/signup-journey.sh makes, answered
// from memory with the behaviour the approved spec rules. When PRJ-119 lands its API, the journey's live driver maps
// these calls onto it; the journey's assertions do not change. Shapes here are PROPOSALS (plan §1, "Port shapes are
// proposals"), like the portal's own fakes.
//
//   node e2e/stub/signup-portal.mjs --port 0 --gov-install uat=http://127.0.0.1:4002 [--gov-install dev=…] …
//     prints `listening <port>` on stdout once it accepts connections.
//
// Every environment has its OWN accounts (A13): paths are /<env>/api/…, env ∈ dev | uat | prod. Identities are
// shared across environments (A15): `Authorization: Bearer stub:<who>`, <who> from IDENTITIES below — the stand-ins
// for plan P4's sandbox identities. Each env's member view reads that env's scripts host's /versions.json at request
// time (§5.2), exactly as the portal will — so the page can never disagree with the scripts.
//
// Endpoints (all JSON):
//   GET    /<env>/api/install                          the /install view for the caller (§5.3 flowchart)
//   POST   /<env>/api/registrations {githubOrg,displayName}  → 201 pending | 409 already-registered (names no account)
//   GET    /<env>/api/registrations/:id                state: pending | active | expired
//   POST   /<env>/api/registrations/:id/verify         a GitHub org admin installs gov-<env> (S-h) — stub stand-in
//   GET    /<env>/api/account                          the caller's account (id, status, plan, githubOrgId, role)
//   GET    /<env>/api/members · DELETE /<env>/api/members/:login · PUT /<env>/api/members/:login/role {admin}
//   POST   /<env>/api/invitations {email|githubLogin,admin?} · GET /<env>/api/invitations · DELETE …/:id (revoke)
//   POST   /<env>/api/invitations/:id/accept
//   GET    /<env>/api/join-requests/eligibility · POST /<env>/api/join-requests · GET /<env>/api/join-requests/mine
//   GET    /<env>/api/join-requests (admins) · POST /<env>/api/join-requests/:id/approve | /decline
//   POST   /<env>/api/admin/accounts/:id/status {status: suspended|active, reason}   (platform admin)
//   POST   /<env>/api/lease                            gov-licence's answer for the caller's account (S-e stand-in)
//   POST   /api/me/github-link {login}                 link a GitHub login (S-c; identity-wide, not per env)
//   --break leak-account | approve-as-admin | piped-command   serve ONE defect the spec forbids, so a unit test can
//                                                             prove the journey catches it (never used by a real run)
//   STUB-ONLY: POST /_stub/clock {days} · POST /_stub/github-rename {from,to} · POST /_stub/gov-install {env,url}
//              GET /_stub/outbox (the emails IAM would have sent)
import * as http from "node:http";
import * as https from "node:https";

const ENVS = ["dev", "uat", "prod"];
const DAY = 86_400_000;
const REPO = "https://github.com/svayam-opensource/governed-agentic-dev-framework";

// Plan P4's identities, as the stub knows them. `gh` is the GitHub login (null = no GitHub account); `orgs` maps a
// GitHub org to the person's role in it. `linked` = their GitHub login is verified-linked (S-c) from the start.
const IDENTITIES = {
  admin: { name: "e2e admin", email: "admin@e2e.test", gh: "e2e-admin", ghId: 1001, orgs: { "svayam-e2e": "admin", "svayam-e2e-pending": "admin" }, linked: true },
  registrant: { name: "e2e registrant", email: "registrant@e2e.test", gh: "e2e-registrant", ghId: 1002, orgs: { "svayam-e2e-pending": "member" }, linked: true },
  "email-invitee": { name: "e2e email invitee", email: "invitee@e2e.test", gh: null, ghId: null, orgs: {}, linked: false },
  "gh-invitee": { name: "e2e contractor", email: "contractor@e2e.test", gh: "e2e-contractor", ghId: 1003, orgs: {}, linked: false },
  "org-member": { name: "e2e org member", email: "member@e2e.test", gh: "e2e-member", ghId: 1004, orgs: { "svayam-e2e": "member" }, linked: false },
  outsider: { name: "e2e outsider", email: "outsider@e2e.test", gh: "e2e-outsider", ghId: 1005, orgs: {}, linked: true },
  impostor: { name: "e2e impostor", email: "impostor@e2e.test", gh: "e2e-impostor", ghId: 1006, orgs: {}, linked: true },
  "platform-admin": { name: "Svayam platform admin", email: "platform@svayam.test", gh: null, ghId: null, orgs: {}, linked: false, platformAdmin: true },
};
// GitHub's numeric ids — what an invitation by login and an org link are held against (IS-A5, IS-A7).
const GITHUB_ORGS = { "svayam-e2e": 9001, "svayam-e2e-pending": 9002 };
const ghUsers = Object.fromEntries(Object.values(IDENTITIES).filter((i) => i.gh).map((i) => [i.gh, i.ghId]));

const args = process.argv.slice(2);
const opt = (name) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1]] : []));
const BREAK = opt("break")[0] ?? "";
const govInstall = {};   // env → base URL of that env's scripts host (or a local gov-install container)
for (const spec of opt("gov-install")) { const [env, url] = spec.split(/=(.*)/s); govInstall[env] = url; }

let clock = Date.now();
let seq = 1000;   // one sequence for every env, so a dev account and a uat account never share an id
const outbox = [];
const state = Object.fromEntries(ENVS.map((e) => [e, { accounts: [], registrations: [], invitations: [], joinRequests: [] }]));

const scriptsHost = (env) => (env === "prod" ? "gov.svayamtech.com" : `gov-${env}.svayamtech.com`);
const appFor = (env) => (env === "prod" ? "gov" : `gov-${env}`);
const who = (req) => { const m = /^Bearer stub:(\S+)$/.exec(req.headers.authorization ?? ""); return m && IDENTITIES[m[1]] ? m[1] : null; };
const me = (w) => IDENTITIES[w];
const accountOf = (s, w) => s.accounts.find((a) => a.members.some((m) => m.who === w));
const roleIn = (a, w) => a.members.find((m) => m.who === w)?.role;
const isAdmin = (a, w) => roleIn(a, w) === "ACCOUNT_ADMIN";
const linkedId = (w) => (me(w).linked ? ghUsers[me(w).gh] : null);
const orgsOfLogin = (w) => (me(w).linked ? Object.keys(me(w).orgs) : []);
const expire = (s) => {
  for (const r of s.registrations) if (r.state === "pending" && clock > r.expiresAt) r.state = "expired";
  for (const i of s.invitations) if (i.state === "pending" && clock > i.expiresAt) i.state = "expired";
  for (const j of s.joinRequests) if (j.state === "pending" && clock > j.expiresAt) j.state = "expired";
};
// The account a person could ask to join: one linked to a GitHub org their verified login belongs to — never named.
const joinable = (s, w) => s.accounts.find((a) => orgsOfLogin(w).some((o) => GITHUB_ORGS[o] === a.githubOrgId) && !roleIn(a, w));

/** GET a URL (http or https). A loopback URL is a LOCAL gov-install container, which routes by Host as the edge
 *  does: it is asked for `host` (that env's scripts host). */
function fetchText(url, host) {
  return new Promise((resolve) => {
    let u; try { u = new URL(url); } catch { resolve(null); return; }
    const mod = u.protocol === "https:" ? https : http;
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
    const req = mod.get(u, { headers: local ? { host } : {}, timeout: 5000 }, (res) => {
      let b = ""; res.setEncoding("utf8"); res.on("data", (c) => (b += c));
      res.on("end", () => resolve(res.statusCode === 200 ? b : null));
    });
    req.on("error", () => resolve(null)); req.on("timeout", () => { req.destroy(); resolve(null); });
  });
}

async function installView(env, w) {
  const openSource = { text: "gov is open source (MIT)", url: REPO };
  const signIn = { returnTo: "/install" };   // §5.1: sign-in from /install returns to /install (IS-A14)
  if (!w) return { view: "signed-out", actions: ["sign-in", "register"], signIn, openSource };
  const s = state[env]; expire(s);
  const acct = accountOf(s, w);
  if (!acct) {
    const base = { view: "signed-out", variant: "no-account", notMember: "You are not a member of a gov organisation here yet.", actions: ["register"], openSource };
    const mine = s.invitations.filter((i) => i.state === "pending" && i.kind === "github" && i.ghId === linkedId(w));
    if (mine.length) return { ...base, offer: "accept", invitations: mine.map((i) => ({ id: i.id, expiresAt: i.expiresAt })) };
    if (!me(w).linked) return { ...base, offer: "link-github" };
    const req = s.joinRequests.filter((j) => j.who === w).at(-1);
    if (req?.state === "pending") return { ...base, offer: "request-sent", message: "Request sent — your organisation's gov admins will review it" };
    if (joinable(s, w)) return { ...base, offer: "request-to-join", ...(req?.state === "declined" ? { previous: "Your request was not approved" } : {}) };
    return { ...base, offer: "ask-admin-or-register", message: "Ask your organisation's gov admin to invite you, or register your organisation" };
  }
  if (acct.status === "suspended") return { view: "suspended", notice: "This organisation's gov account is suspended. Contact Svayam." };
  const raw = govInstall[env] ? await fetchText(`${govInstall[env]}/versions.json`, scriptsHost(env)) : null;
  let v = null; try { v = raw ? JSON.parse(raw) : null; } catch { v = null; }
  if (!v || !v.host) return { view: "install", unavailable: true, message: "Install details unavailable" };   // §5.2, IS-A15
  const h = v.host;
  return {
    view: "install", env: v.env, scriptsHost: h, ref: v.ref, pkg: v.pkg, registry: v.registry ?? null, label: v.label ?? null,
    versioned: v.versioned ?? [],
    commands: {
      unix: BREAK === "piped-command" ? `curl -fsSL https://${h}/install.sh | bash` : `curl -fsSL https://${h}/install.sh -o install.sh && bash install.sh`,
      ci: `curl -fsSL https://${h}/install.sh | GOV_YES=1 bash`,
      windows: "winget install Svayam.Gov",
      ps1: `https://${h}/install.ps1`,
    },
    invite: isAdmin(acct, w) ? "Invite your team" : undefined,
  };
}

function route(req, body) {
  const url = new URL(req.url, "http://stub");
  const p = url.pathname;
  const w = who(req);
  // ── stub-only controls ──
  if (p === "/_stub/clock" && req.method === "POST") { clock += (body.days ?? 0) * DAY; return [200, { now: clock }]; }
  if (p === "/_stub/outbox") return [200, outbox];
  if (p === "/_stub/github-rename" && req.method === "POST") {
    const i = Object.values(IDENTITIES).find((x) => x.gh === body.from); if (!i) return [404, { error: "no-such-login" }];
    delete ghUsers[i.gh]; i.gh = body.to; ghUsers[i.gh] = i.ghId; return [200, { login: i.gh, id: i.ghId }];
  }
  if (p === "/_stub/gov-install" && req.method === "POST") { govInstall[body.env] = body.url; return [200, {}]; }
  if (p === "/healthz") return [200, { ok: true }];
  if (p === "/api/me/github-link" && req.method === "POST") {   // S-c: works with no account (§4.2)
    if (!w) return [401, { error: "sign-in" }];
    if (me(w).gh !== body.login) return [403, { error: "not-your-login" }];
    me(w).linked = true; return [200, { login: me(w).gh, id: me(w).ghId }];
  }
  const m = /^\/(dev|uat|prod)\/api(\/.*)$/.exec(p);
  if (!m) return [404, { error: "not-found" }];
  const env = m[1], rest = m[2], s = state[env]; expire(s);
  if (rest === "/install" && req.method === "GET") return ["async", installView(env, w)];
  if (!w) return [401, { error: "sign-in" }];
  const acct = accountOf(s, w);
  const suspended = acct?.status === "suspended";
  let r;

  // ── registration (§3, S-g/S-h) ──
  if (rest === "/registrations" && req.method === "POST") {
    const orgId = GITHUB_ORGS[body.githubOrg]; if (!orgId) return [404, { error: "no-such-github-org" }];
    if (s.accounts.some((a) => a.githubOrgId === orgId)) {   // A11: one account per GitHub org, per env — named nowhere
      const leak = BREAK === "leak-account" ? { account: s.accounts.find((a) => a.githubOrgId === orgId).name } : {};
      return [409, { error: "already-registered", message: "This GitHub organisation is already registered with gov.", offer: "request-to-join", ...leak }];
    }
    if (s.registrations.some((x) => x.orgId === orgId && x.state === "pending")) return [409, { error: "pending-elsewhere", message: "A registration for this GitHub organisation is waiting for verification." }];
    const id = `reg-${seq++}`;
    s.registrations.push({ id, by: w, orgId, org: body.githubOrg, displayName: body.displayName, state: "pending", expiresAt: clock + 7 * DAY });
    const orgAdmin = me(w).orgs[body.githubOrg] === "admin";
    return [201, { id, state: "pending", app: appFor(env), canVerify: orgAdmin, ...(orgAdmin ? {} : { sendToAdminLink: `https://portal-${env}.svayamtech.com/register/verify/${id}` }) }];
  }
  if ((r = /^\/registrations\/([\w-]+)(\/verify)?$/.exec(rest))) {
    const reg = s.registrations.find((x) => x.id === r[1]); if (!reg) return [404, { error: "not-found" }];
    if (!r[2]) return [200, { id: reg.id, state: reg.state }];
    if (reg.state !== "pending") return [410, { error: reg.state }];
    if (me(w).orgs[reg.org] !== "admin") return [403, { error: "not-a-github-org-admin" }];
    reg.state = "active";
    s.accounts.push({ id: seq++, env, name: reg.displayName, githubOrgId: reg.orgId, plan: "free", product: "governance", status: "active", history: [], members: [{ who: reg.by, role: "ACCOUNT_ADMIN" }] });
    return [200, { id: reg.id, state: "active" }];
  }
  if (rest === "/account" && req.method === "GET") {
    if (!acct) return [404, { error: "no-account" }];
    return [200, { id: acct.id, name: acct.name, status: acct.status, plan: acct.plan, product: acct.product, githubOrgId: acct.githubOrgId, githubOrgLinked: "read-only", role: roleIn(acct, w) }];
  }

  // ── platform admin (§3.2) and the lease (gov-licence, S-e) ──
  if ((r = /^\/admin\/accounts\/(\d+)\/status$/.exec(rest)) && req.method === "POST") {
    if (!me(w).platformAdmin) return [403, { error: "platform-admin-only" }];
    const a = s.accounts.find((x) => String(x.id) === r[1]); if (!a) return [404, { error: "not-found" }];
    if (!body.reason) return [400, { error: "reason-required" }];
    a.status = body.status; a.history.push({ status: body.status, reason: body.reason, by: w, at: clock });
    return [200, { id: a.id, status: a.status, history: a.history }];
  }
  if (rest === "/lease" && req.method === "POST") {
    if (!acct) return [403, { refused: true, reason: "no-account" }];
    if (suspended) return [403, { refused: true, reason: "suspended" }];
    return [200, { lease: `lease-${env}-${acct.id}` }];
  }

  // ── members (§4.3) ──
  const adminOnly = () => (!acct || !isAdmin(acct, w) ? [403, { error: "account-admin-only" }] : null);
  const refuseSuspended = () => (suspended ? [423, { error: "suspended", message: "This organisation's gov account is suspended." }] : null);
  if (rest === "/members" && req.method === "GET") return adminOnly() ?? [200, acct.members.map((x) => ({ login: me(x.who).gh ?? me(x.who).email, role: x.role }))];
  if ((r = /^\/members\/([^/]+)(\/role)?$/.exec(rest))) {
    const deny = adminOnly(); if (deny) return deny;
    const target = acct.members.find((x) => (me(x.who).gh ?? me(x.who).email) === decodeURIComponent(r[1])); if (!target) return [404, { error: "not-a-member" }];
    const admins = acct.members.filter((x) => x.role === "ACCOUNT_ADMIN");
    const losesAdmin = target.role === "ACCOUNT_ADMIN" && (req.method === "DELETE" || (r[2] && !body.admin));
    if (losesAdmin && admins.length === 1) return [409, { error: "last-admin", message: "An account always keeps at least one admin." }];
    if (req.method === "DELETE") { acct.members = acct.members.filter((x) => x !== target); return [200, {}]; }
    target.role = body.admin ? "ACCOUNT_ADMIN" : "MEMBER"; return [200, { role: target.role }];
  }

  // ── invitations (§4.1, S-i) ──
  if (rest === "/invitations" && req.method === "POST") {
    const deny = adminOnly() ?? refuseSuspended(); if (deny) return deny;
    const id = `inv-${seq++}`;
    if (body.githubLogin) {
      const ghId = ghUsers[body.githubLogin]; if (!ghId) return [404, { error: "no-such-github-login" }];
      s.invitations.push({ id, acct: acct.id, kind: "github", ghId, admin: !!body.admin, state: "pending", expiresAt: clock + 7 * DAY });
      return [201, { id, kind: "github", ghId, link: `https://portal-${env}.svayamtech.com/install?invitation=${id}`, emailed: false }];
    }
    s.invitations.push({ id, acct: acct.id, kind: "email", email: body.email, admin: !!body.admin, state: "pending", expiresAt: clock + 7 * DAY });
    outbox.push({ env, to: body.email, kind: "invitation", invitation: id });   // IAM sends it (S-i), not the portal
    return [201, { id, kind: "email", emailed: true }];
  }
  if (rest === "/invitations" && req.method === "GET") return adminOnly() ?? [200, s.invitations.filter((i) => i.acct === acct.id)];
  if ((r = /^\/invitations\/([\w-]+)(\/accept)?$/.exec(rest))) {
    const inv = s.invitations.find((x) => x.id === r[1]); if (!inv) return [404, { error: "not-found" }];
    const target = s.accounts.find((a) => a.id === inv.acct);
    if (req.method === "DELETE") { if (!acct || acct.id !== inv.acct || !isAdmin(acct, w)) return [403, { error: "account-admin-only" }]; inv.state = "revoked"; return [200, {}]; }
    if (target.status === "suspended") return [423, { error: "suspended", message: "This organisation's gov account is suspended." }];
    if (inv.state === "expired") return [410, { error: "expired", message: "This invitation has expired. Ask your admin for a new one." }];
    if (inv.state === "revoked") return [410, { error: "revoked", message: "This invitation was withdrawn by your organisation's admin." }];
    if (inv.state !== "pending") return [410, { error: inv.state }];
    if (inv.kind === "github") {
      if (!me(w).linked) return [409, { error: "link-github-first", message: "Link your GitHub login" }];
      if (linkedId(w) !== inv.ghId) return [403, { error: "login-mismatch", message: "This invitation is for a different GitHub login." }];
    } else if (me(w).email !== inv.email) return [403, { error: "email-mismatch" }];
    inv.state = "accepted"; target.members.push({ who: w, role: inv.admin ? "ACCOUNT_ADMIN" : "MEMBER" });
    return [200, { state: "accepted" }];
  }

  // ── join requests (§4.2, S-i) — the requester never learns the account's name or admins ──
  if (rest === "/join-requests/eligibility") {
    if (!me(w).linked) return [200, { eligible: false, reason: "link-github" }];
    return [200, { eligible: !!joinable(s, w) }];
  }
  if (rest === "/join-requests/mine") {
    const j = s.joinRequests.filter((x) => x.who === w).at(-1); if (!j) return [404, { error: "none" }];
    return [200, { state: j.state, ...(j.state === "declined" ? { message: "Your request was not approved" } : {}) }];
  }
  if (rest === "/join-requests" && req.method === "POST") {
    const a = me(w).linked ? joinable(s, w) : null;
    if (!a) return [403, { error: "not-eligible", message: "No gov organisation here is available to join." }];
    if (a.status === "suspended") return [423, { error: "suspended" }];
    if (s.joinRequests.some((j) => j.who === w && j.acct === a.id && j.state === "pending")) return [409, { error: "already-open", message: "Request sent — your organisation's gov admins will review it" }];
    const id = `jr-${seq++}`;
    s.joinRequests.push({ id, who: w, acct: a.id, state: "pending", expiresAt: clock + 30 * DAY });
    for (const x of a.members.filter((y) => y.role === "ACCOUNT_ADMIN")) outbox.push({ env, to: me(x.who).email, kind: "join-request", request: id });
    return [201, { id, state: "pending", message: "Request sent — your organisation's gov admins will review it" }];
  }
  if (rest === "/join-requests" && req.method === "GET") {
    return adminOnly() ?? [200, s.joinRequests.filter((j) => j.acct === acct.id).map((j) => ({ id: j.id, name: me(j.who).name, email: me(j.who).email, githubLogin: me(j.who).gh, state: j.state }))];
  }
  if ((r = /^\/join-requests\/([\w-]+)\/(approve|decline)$/.exec(rest)) && req.method === "POST") {
    const deny = adminOnly() ?? refuseSuspended(); if (deny) return deny;
    const j = s.joinRequests.find((x) => x.id === r[1] && x.acct === acct.id); if (!j) return [404, { error: "not-found" }];
    if (j.state !== "pending") return [410, { error: j.state }];
    j.state = r[2] === "approve" ? "approved" : "declined";
    if (j.state === "approved") acct.members.push({ who: j.who, role: BREAK === "approve-as-admin" ? "ACCOUNT_ADMIN" : "MEMBER" });   // never an admin (§4.2)
    return [200, { state: j.state }];
  }
  return [404, { error: "not-found" }];
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.setEncoding("utf8");
  req.on("data", (c) => (raw += c));
  req.on("end", async () => {
    let body = {}; try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    let [status, out] = route(req, body);
    if (status === "async") { out = await out; status = 200; }
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(out));
  });
});
const port = Number(opt("port")[0] ?? 0);
server.listen(port, "127.0.0.1", () => { process.stdout.write(`listening ${server.address().port}\n`); });
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => process.exit(0)));
