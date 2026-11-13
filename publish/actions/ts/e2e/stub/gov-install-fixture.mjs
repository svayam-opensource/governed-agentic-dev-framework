#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
//
// A FIXTURE SCRIPTS HOST — what spec addendum-install-signup §7 says a scripts-only gov-install serves, in a few
// lines, so the install-signup journey's own assertions can be tested with no Docker and no network
// (test/e2e/signup-journey-dry.test.ts, and the adopter-e2e `signup` job's hermetic mode).
//
// IT IS NOT gov-install. The real one is site/ (built by site/build.mjs, served by Caddy), which the journey runs
// against through e2e/local-gov-install.sh. This file exists so a broken assertion in the journey is caught by a
// unit test — including the cases the real site must never show: `--break <defect>` serves one on purpose.
//
//   node e2e/stub/gov-install-fixture.mjs [--port 0] [--break script-redirect|html-script|no-cors|pin-mismatch|no-302]
//     prints `listening <port>`; routes by Host like the edge: gov-dev / gov-uat / gov .svayamtech.com
import * as http from "node:http";

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const BREAK = opt("break") ?? "";
const ENVS = {
  dev: { ref: "dev", pkg: "@svayam-opensource/gov@dev", registry: "https://npm.svayamtech.com", label: "DEV — the tip of the dev branch. Expect it to be broken." },
  uat: { ref: "uat", pkg: "@svayam-opensource/gov@uat", registry: "https://npm.svayamtech.com", label: "UAT — release candidate. Not the version to adopt." },
  prod: { ref: "gov-work-1.2.3", pkg: "@svayam-opensource/gov@1.2.3", registry: null, label: null },
};
const VERSIONED = ["1.2.3"];
const dn = (slug, env) => `${slug}${env === "prod" ? "" : `-${env}`}.svayamtech.com`;
const byHost = Object.fromEntries(Object.keys(ENVS).map((e) => [dn("gov", e), e]));

const sh = (pkg, registry) => `#!/usr/bin/env bash\n# gov installer (fixture)\nGOV_PKG="\${GOV_PKG:-${pkg}}"\nGOV_REGISTRY="\${GOV_REGISTRY:-${registry ?? ""}}"\necho install\n`;
const ps1 = (pkg) => `# gov installer (fixture)\n$GovPkg = if ($env:GOV_PKG) { $env:GOV_PKG } else { '${pkg}' }\n`;

http.createServer((req, res) => {
  const env = byHost[(req.headers.host ?? "").replace(/:\d+$/, "")];
  const p = new URL(req.url, "http://x").pathname;
  const send = (status, type, body, extra = {}) => { res.writeHead(status, { ...(type ? { "content-type": type } : {}), ...extra }); res.end(body); };
  const text = (b) => send(200, "text/plain; charset=utf-8", BREAK === "html-script" ? `<!doctype html>${b}` : b);
  if (p === "/healthz") return send(200, "text/plain", "ok");
  if (!env) return send(404, "text/plain", "not found");
  const e = ENVS[env], host = dn("gov", env), portal = `https://${dn("portal", env)}`;
  if (p === "/" || p === "/index.html") {
    if (BREAK === "no-302") return send(200, "text/html", "<!doctype html><title>gov</title>");
    return send(302, null, "", { location: `${portal}/install` });
  }
  if (BREAK === "script-redirect" && p === "/install.sh") return send(301, null, "", { location: `https://${host}/v/1.2.3/install.sh` });
  if (p === "/install.sh") return text(sh(e.pkg, e.registry));
  if (p === "/install.ps1") return text(ps1(e.pkg));
  const v = /^\/v\/([\d.]+)\/install\.(sh|ps1)$/.exec(p);
  if (v && VERSIONED.includes(v[1])) return text(v[2] === "sh" ? sh(`@svayam-opensource/gov@${v[1]}`, null) : ps1(`@svayam-opensource/gov@${v[1]}`));
  if (p === "/versions.json") {
    const doc = { env, host, ref: e.ref, pkg: BREAK === "pin-mismatch" ? "@svayam-opensource/gov@9.9.9" : e.pkg, ...(e.registry ? { registry: e.registry } : {}), label: e.label,
      versioned: VERSIONED.map((x) => ({ version: x, sh: `/v/${x}/install.sh`, ps1: `/v/${x}/install.ps1` })), built: "2026-10-18T00:00:00Z" };
    return send(200, "application/json", JSON.stringify(doc), BREAK === "no-cors" ? {} : { "access-control-allow-origin": portal });
  }
  if (p === "/robots.txt") return text("User-agent: *\nDisallow: /\n");
  return send(404, "text/plain", "not found");
}).listen(Number(opt("port") ?? 0), "127.0.0.1", function () { process.stdout.write(`listening ${this.address().port}\n`); });
