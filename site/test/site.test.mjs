// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The site's own tests — what gov's container recipe runs as `npm test` in site/. They need no git history
 * and no network: the git-reading half of the build is asserted by `build.mjs --verify` inside the image
 * build, which fails the deploy on its own.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderCaddyfile, sitesIn, PORT } from "../caddyfile.mjs";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(SITE, p), "utf8");
const SITES = [{ env: "dev", host: "gov-dev.svayamtech.com" }, { env: "prod", host: "gov.svayamtech.com" }];

test("each env is served ONLY on its own host, from its own build", () => {
  const cf = renderCaddyfile(SITES);
  assert.match(cf, /@dev host gov-dev\.svayamtech\.com\n\thandle @dev \{\n\t\troot \* \/srv\/dev/);
  assert.match(cf, /@prod host gov\.svayamtech\.com\n\thandle @prod \{\n\t\troot \* \/srv\/prod/);
});

test("a missing path is a 404 — never a page an adopter would pipe into a shell", () => {
  const cf = renderCaddyfile(SITES);
  assert.doesNotMatch(cf, /try_files|rewrite|index\.html/);
  assert.match(cf, /\thandle \{\n\t\trespond "not found" 404\n\t\}\n\}\n$/);
});

test("an unknown host gets the 404, not some env's site", () => {
  // The catch-all is the LAST handle; every site handle is guarded by a host matcher.
  const cf = renderCaddyfile(SITES);
  const handles = cf.match(/\thandle[^\n]*\{/g);
  assert.deepEqual(handles, ["\thandle @healthz {", "\thandle @dev {", "\thandle @prod {", "\thandle {"]);
});

test("the scripts are served as text — `irm … | iex` needs a string", () => {
  assert.match(renderCaddyfile(SITES), /@scripts path \*\.sh \*\.ps1\n\t\theader @scripts Content-Type "text\/plain; charset=utf-8"/);
});

test("health is answered on gov's serve port, without a host", () => {
  const cf = renderCaddyfile(SITES);
  assert.match(cf, new RegExp(`^:${PORT} \\{`, "m"));
  assert.match(cf, /@healthz path \/healthz\n\thandle @healthz \{\n\t\trespond "ok" 200/);
  assert.match(read("Dockerfile"), new RegExp(`EXPOSE ${PORT}`));
});

test("no admin endpoint and no certificate management inside the container — the edge does TLS", () => {
  assert.match(renderCaddyfile(SITES), /^\{\n\tadmin off\n\tauto_https off\n\}/);
});

test("refuses to render a server with nothing to serve", () => {
  assert.throws(() => renderCaddyfile([]), /no site builds/);
});

test("sites are discovered from the build's CNAMEs — no second copy of the DN rule", () => {
  const dist = mkdtempSync(join(tmpdir(), "site-dist-"));
  for (const [env, host] of [["prod", "gov.svayamtech.com"], ["dev", "gov-dev.svayamtech.com"]]) {
    mkdirSync(join(dist, env)); writeFileSync(join(dist, env, "CNAME"), `${host}\n`);
  }
  mkdirSync(join(dist, "stray"));                              // no CNAME → not a site build
  assert.deepEqual(sitesIn(dist), [{ env: "dev", host: "gov-dev.svayamtech.com" }, { env: "prod", host: "gov.svayamtech.com" }]);
});

test("the image builds EVERY env in envs.json — one image, promoted unchanged", () => {
  const df = read("Dockerfile");
  assert.match(df, /Object\.keys\(require\('\.\/site\/envs\.json'\)\.envs\)/);
  assert.match(df, /node site\/build\.mjs "\$e" --verify/);
  assert.match(df, /COPY \. \/src\/site/, "the deployed commit's site/ must overlay the clone");
});

test("envs.json: prod pins refs that cannot move", () => {
  const { envs, versioned } = JSON.parse(read("envs.json"));
  assert.match(envs.prod.ref, /^(gov-work-\d+\.\d+\.\d+|[0-9a-f]{40})$/);
  assert.match(envs.prod.pkg, /^@svayam-opensource\/gov@\d+\.\d+\.\d+$/);
  for (const t of versioned ?? []) assert.match(t, /^gov-work-\d+\.\d+\.\d+$/);
});

test("the page's primary command fetches to a file, then runs it", () => {
  const cmd = read("template/index.html").match(/<code id="cmd-unix">([^<]*)<\/code>/)?.[1] ?? "";
  assert.match(cmd, /-o install\.sh/);
  assert.doesNotMatch(cmd, /\|\s*bash/);
});

test("every base image is fully qualified — the deploy agent's podman cannot resolve short names", () => {
  const froms = [...read("Dockerfile").matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1]);
  assert.ok(froms.length >= 2);
  for (const image of froms) assert.match(image, /^[a-z0-9.-]+\.[a-z]+\/[^\s]+$/, `${image} is not fully qualified`);
});

test("the build output never reaches the image context", () => {
  assert.match(read(".dockerignore"), /^dist$/m);
});

// ── the catalog decides the version, not this file (PRJ-121) ──────────────────────────────────────
//
// The pins in envs.json are a FALLBACK for a hand-run build. What a deployed site installs comes from
// `gov deploy`, which passes GOV_DEPS from the catalog. The bug this guards against was silent and the
// wrong way round: a gov-work fix lands on dev, the site still installs the released client, and a walk
// against it passes — on the code the fix replaced.

test("the Dockerfile accepts GOV_DEPS and passes it to every env's build", () => {
  const df = read("Dockerfile");
  assert.match(df, /^ARG GOV_DEPS=/m, "gov deploy passes --build-arg GOV_DEPS; the Dockerfile must declare it");
  assert.match(df, /GOV_DEPS="\$GOV_DEPS" node site\/build\.mjs/, "the ARG must reach build.mjs, not just exist");
});

test("an empty GOV_DEPS stays a valid build — a local docker build has no deploy behind it", () => {
  assert.match(read("Dockerfile"), /^ARG GOV_DEPS=\s*$/m, "the ARG must default to empty, not be required");
});

test("envs.json declares a registry for every non-prod env, and none for prod", () => {
  const { envs } = JSON.parse(read("envs.json"));
  assert.equal(envs.prod.registry, undefined,
    "a registry on prod would route every adopter off their own registry");
  for (const [name, e] of Object.entries(envs)) {
    if (name === "prod") continue;
    assert.match(e.registry ?? "", /^https:\/\//,
      `${name} must pin a registry — build-once-promote publishes there FIRST, so without it ${name} installs the RELEASED client`);
  }
});

test("install.sh routes the registry per-call and never writes it to the adopter's npm config", () => {
  const sh = readFileSync(join(SITE, "..", "install.sh"), "utf8");
  assert.match(sh, /^GOV_REGISTRY="\$\{GOV_REGISTRY:-\}"$/m, "build.mjs pins this exact line — its shape is load-bearing");
  assert.match(sh, /npm_args\+=\(--registry "\$GOV_REGISTRY"\)/, "an array, not an unquoted ${VAR:+…}: zsh does not word-split");
  assert.doesNotMatch(sh, /npm config set registry/, "the adopter's own npm config must survive an install");
});
