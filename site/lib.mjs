// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The pure half of the install site's build — what build.mjs, build-local.mjs and the tests share.
 *
 * SCRIPTS ONLY (PRJ-121 intent 02 addendum, IS-E2, rulings A5 + A14, 2026-10-18). gov-install serves the
 * installers, the `/v/<ver>/` pairs, `versions.json` and, once it carries them, the `.msi` files winget fetches.
 * The install PAGE moved to the portal's `/install`, which reads `versions.json` from this host — so the page and
 * the scripts can never disagree. `/` answers 302 to that page; nothing else redirects.
 *
 * No I/O beyond reading a directory, and no top-level side effects, so the tests can import it.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Where `/` sends a visitor on each env's portal. */
export const PORTAL_PATH = "/install";

/**
 * The DN gov derives for a unit: prod is bare, every other env carries `-<env>`
 * (svm-prj-work:knowledge/deployment/specs/public-dn-convention.md). `slug` defaults to this unit's own.
 */
export const dnFor = (cfg, envName, slug = cfg.app_domain) =>
  envName === "prod" ? `${slug}.${cfg.base}` : `${slug}-${envName}.${cfg.base}`;

/** The env's portal ORIGIN, by the same rule: portal-dev, portal-uat, portal. */
export function portalOrigin(cfg, envName) {
  if (!cfg.portal_slug) throw new Error("envs.json names no portal_slug — the redirect target is derived from it, never guessed");
  return `https://${dnFor(cfg, envName, cfg.portal_slug)}`;
}

/** An origin and nothing else: scheme, host, optional port. What PORTAL holds and what CORS names. */
export const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?$/;

/**
 * `/versions.json` — the one source the portal's Install page reads (spec §7.2). Written from the SAME values
 * that are pinned into the scripts, and held to them by `versionsMismatches` in --verify.
 */
export function versionsDoc({ env, host, ref, pkg, registry, label, versions, built }) {
  return {
    env,
    host,
    ref,
    pkg,
    registry: registry ?? null,
    label: label ?? null,
    versioned: (versions ?? []).map((v) => ({ version: v, sh: `/v/${v}/install.sh`, ps1: `/v/${v}/install.ps1` })),
    built,
  };
}

const line = (text, name) => text.match(new RegExp(`^${name}="\\$\\{${name}:-([^"]*)\\}"$`, "m"))?.[1];

/** The pins as SERVED — read back out of an install.sh, never taken from the build's own variables. */
export function pinsOf(sh) {
  return { url: line(sh, "GOV_INSTALL_URL"), pkg: line(sh, "GOV_PKG"), registry: line(sh, "GOV_REGISTRY") ?? "" };
}

/**
 * Every way `versions.json` disagrees with the scripts it describes. Empty = they agree.
 * @param {ReturnType<typeof versionsDoc>} doc
 * @param {{ sh: string, versioned: Record<string, string> }} served  the root install.sh, and each /v/<ver>/install.sh
 */
export function versionsMismatches(doc, served) {
  const out = [];
  const p = pinsOf(served.sh);
  if (p.pkg !== doc.pkg) out.push(`versions.json pkg '${doc.pkg}' but install.sh installs '${p.pkg}'`);
  if (p.registry !== (doc.registry ?? "")) out.push(`versions.json registry '${doc.registry}' but install.sh routes to '${p.registry}'`);
  if (!p.url || !p.url.endsWith(`//${doc.host}/install.sh`)) out.push(`versions.json host '${doc.host}' but install.sh names itself '${p.url}'`);
  for (const { version } of doc.versioned ?? []) {
    const t = served.versioned?.[version];
    if (t === undefined) { out.push(`versions.json lists ${version} but /v/${version}/install.sh is not served`); continue; }
    const vp = pinsOf(t);
    if (vp.pkg !== `@svayam-opensource/gov@${version}`) out.push(`versions.json lists ${version} but /v/${version}/install.sh installs '${vp.pkg}'`);
  }
  return out;
}

/** A page — what this host no longer serves. */
const PAGE = /\.(html?|css)$/i;

/** Every page file under `dir`, repo-style relative paths. --verify fails on any. */
export function pagesIn(dir, rel = "") {
  const out = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...pagesIn(dir, r));
    else if (PAGE.test(e.name)) out.push(r);
  }
  return out;
}
