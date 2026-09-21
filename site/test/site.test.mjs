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
  // The deployed commit's site/ REPLACES the clone's, from whichever context the catalog chose.
  assert.match(df, /COPY \. \/ctx/, "the whole build context is taken, whether it is the repo root or site/");
  assert.match(df, /rm -rf \/src\/site && cp -r "\$site" \/src\/site/, "the deployed commit's site/ must replace the clone's");
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

// ── non-prod asks for its dist-tag; the scope mapping cannot silently win (2026-09-21) ────────────

test("envs.json: non-prod asks for its own dist-tag, prod for an exact release", () => {
  // The first cut pinned `@<semver>` everywhere. On dev that named the RELEASED client (or a version the
  // dev build never published), so a dev walk tested the code the change replaced.
  const { envs } = JSON.parse(read("envs.json"));
  for (const [name, e] of Object.entries(envs)) {
    const spec = e.pkg.slice(e.pkg.lastIndexOf("@") + 1);
    if (name === "prod") assert.match(spec, /^\d+\.\d+\.\d+$/, "prod must name an exact release, never a moving tag");
    else assert.equal(spec, name, `${name} must ask for '@${name}' — gov-cicd tags each non-prod env by its own name`);
  }
});

test("install.sh passes the SCOPED registry flag, not --registry alone", () => {
  // A `@<scope>:registry` mapping in any npmrc outranks --registry for a scoped package. Developers carry
  // exactly that mapping; a fresh container does not — which is why every container test passed the bug.
  const sh = readFileSync(join(SITE, "..", "install.sh"), "utf8");
  assert.match(sh, /"--\$\{GOV_PKG%%\/\*\}:registry=\$GOV_REGISTRY"/,
    "the scope is derived from GOV_PKG, so the flag follows the package rather than hardcoding a scope");
  assert.match(sh, /case "\$GOV_PKG" in\s*\n\s*@\*\/\*\)/, "only a scoped package gets the scoped flag; a tarball path must not");
});

// THE TEST THAT WOULD HAVE CAUGHT IT. Every other check here reads source text. This one runs npm, with
// the adopter-hostile config PLANTED, and asks which registry actually answered. Needs the network, so it
// skips — loudly, naming what went unproven — rather than failing when there is none.
test("with a scope mapping to the PUBLIC registry planted, the scoped flag still reaches the private one", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const home = mkdtempSync(join(tmpdir(), "gov-scope-"));
  const npmrc = join(home, "npmrc");
  writeFileSync(npmrc, "@svayam-opensource:registry=https://registry.npmjs.org\n");
  const reg = "https://npm.svayamtech.com";
  const view = (...extra) => spawnSync("npm", ["view", "@svayam-opensource/gov", "dist-tags", "--json", ...extra],
    { encoding: "utf8", env: { ...process.env, NPM_CONFIG_USERCONFIG: npmrc }, timeout: 30000 });

  const scoped = view("--registry", reg, `--@svayam-opensource:registry=${reg}`);
  if (scoped.status !== 0) { t.skip(`no route to ${reg} — the scope-precedence fix is UNPROVEN on this run`); return; }
  const bare = view("--registry", reg);

  // The private registry carries a `dev` tag; the public one never does.
  assert.ok(JSON.parse(scoped.stdout).dev, "with the scoped flag, npm must reach the private registry (which has @dev)");
  assert.equal(JSON.parse(bare.stdout).dev, undefined,
    "--registry alone is expected to LOSE to the planted mapping — if this now passes, npm changed and the scoped flag's reason should be re-examined");
});

// ── prod is a release pair; a pre-routing ref cannot sink the image (2026-09-21) ──────────────────
//
// These read build.mjs rather than run it: the recipe runs `npm test` in a --depth 1 checkout with no
// refs, and the build's own `--verify` is what enforces both rules at image-build time. What these catch is
// the rule being REMOVED — a refactor that quietly lets GOV_DEPS move prod again.

test("prod is never derived from GOV_DEPS — the installer and client are ONE release", () => {
  const b = read("build.mjs");
  assert.match(b, /if \(name === "prod"\) return base;/,
    "GOV_DEPS must not touch prod: the catalog semver names the NEXT release, often unpublished");
  assert.match(b, /prod installs .* but its release pair says/, "--verify must refuse a prod pin that left its pair");
});

test("non-prod takes only the package name and registry from GOV_DEPS — the version is the dist-tag", () => {
  assert.match(read("build.mjs"), /pkg: `\$\{gov\.package\}@\$\{name\}`/,
    "a dev version is unknown until it publishes; `@<env>` is the name that follows it");
});

test("an env whose ref predates GOV_REGISTRY is served the released pair, never fails the image", () => {
  // One image builds every env under `set -e`. Failing here would stop a DEV deploy over UAT's ref.
  const b = read("build.mjs");
  assert.match(b, /!RE_REG\.test\(readAtRef\(env\.ref, "install\.sh"\)\.text\)/, "the check is on the REF's installer, not the working tree");
  assert.match(b, /env = \{ \.\.\.env, pkg: cfg\.envs\.prod\.pkg, registry: undefined \}/,
    "the fallback is prod's release pair from the adopter's own registry — `@uat` without a registry would die");
  assert.match(b, /console\.warn\(/, "the fallback must be ANNOUNCED — a site quietly serving the released client is the bug");
});

// ── the LOCAL sandbox (PRJ-121, 2026-09-21) ──────────────────────────────────────────────────────────
//
// `gov-cicd deploy gov-install --env local` builds a fourth site from the WORKTREE — its install.sh, and a
// client packed from its publish/actions/ts — so a change can be walked before it goes anywhere. The property
// that matters most is the negative one: that variant must never exist in an image a shared env builds.

test("the local site is built ONLY when GOV_LOCAL=1 — a shared build never contains it", () => {
  const df = read("Dockerfile");
  assert.match(df, /^ARG GOV_LOCAL=\s*$/m, "absent by default: a shared-env build must not be told it is local");
  assert.match(df, /if \[ "\$GOV_LOCAL" = 1 \]; then/, "the local build must be gated on the arg");
  assert.match(df, /node site\/build-local\.mjs/, "the local site is built by its own script, not by build.mjs");
});

test("GOV_LOCAL without the repo root refuses — never a silent skip", () => {
  assert.match(read("Dockerfile"), /\[ -n "\$root" \] \|\| \{ echo "GOV_LOCAL=1 needs build\.context: repo/);
});

test("the Dockerfile works with EITHER context, so catalog and site can change in any order", () => {
  // Two repositories cannot change in one step. A Dockerfile that assumed one context would break the next
  // dev deploy in the window between them.
  assert.match(read("Dockerfile"), /if \[ -f \/ctx\/site\/build\.mjs \]; then site=\/ctx\/site; root=\/ctx; else site=\/ctx; root=; fi/);
});

test("build.mjs never builds `local` — the rule that protects adopters has no local branch in it", () => {
  // build.mjs refuses the working tree; build-local.mjs reads nothing else. Keeping them apart is the point.
  const cfg = JSON.parse(read("envs.json"));
  assert.equal(cfg.envs.local, undefined, "`local` must not be an envs.json env — every shared build loops over those");
  // CODE only — a comment pointing a reader at the local builder is welcome; a code path into it is not.
  const code = read("build.mjs").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /build-local|GOV_LOCAL/);
});

test("the local installer asks for the SERVED client over plain http, and pins no registry", () => {
  const b = read("build-local.mjs");
  assert.match(b, /GOV_PKG="\\\$\{GOV_PKG:-http:\/\/\$\{SELF\}\/gov\.tgz\}"/, "the walk must install YOUR client, not @dev");
  assert.match(b, /must not pin a registry/, "GOV_PKG is a URL; a registry pin would be meaningless");
  assert.match(b, /\.replaceAll\("https:\/\/\{\{HOST\}\}", "http:\/\/\{\{HOST\}\}"\)/, "nothing local serves TLS");
});

test("the local site answers ONLY to local names", () => {
  // Read from source, never imported: build-local.mjs is a CLI whose top level exits without arguments, and an
  // import would take this whole test process down with it.
  const hosts = JSON.parse(read("build-local.mjs").match(/LOCAL_HOSTS = (\[[^\]]*\])/)[1]);
  assert.deepEqual([...hosts].sort(), ["127.0.0.1", "host.docker.internal", "localhost"]);
});

test("the build context never carries node_modules, build output, tarballs or .git", () => {
  const ig = read("Dockerfile.dockerignore").split("\n").filter((l) => l && !l.startsWith("#"));
  for (const p of [".git", "**/node_modules", "**/lib", "**/dist", "**/*.tgz"]) assert.ok(ig.includes(p), `missing ${p}`);
  // Deny-only: an allow-list (`*` then `!site`) empties the build when the context IS site/.
  assert.ok(!ig.includes("*"), "an allow-list breaks the site/ context");
});
