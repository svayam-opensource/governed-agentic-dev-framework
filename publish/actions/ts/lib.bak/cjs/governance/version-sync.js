// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Version-sync validator (SDD-032) — in the framework repo the CLI package
 * version must agree with the shipped content version, or installs + the
 * downgrade guard misbehave:
 *   1. publish/actions/ts/package.json "version"  (source of truth — the gov-work CLI)
 *   2. publish/content/VERSION                    (the framework content)
 * Outside the framework repo (e.g. an adopter's gov workspace) there is no CLI
 * package.json — the check is N/A and passes. The README's jsDelivr diagram URLs
 * must stay on the FLOATING `@latest` tag (assets ship in the tarball).
 */
import * as path from "node:path";
const PKG_REL = "publish/actions/ts/package.json";
const CONTENT_VERSION_REL = "publish/content/VERSION";
/** jsDelivr URLs for this package in the README; captures the version spec. */
const README_PIN_RE = /cdn\.jsdelivr\.net\/npm\/@svayam-opensource\/gov-work@([^/]+)\//g;
export function checkVersionSync(ctx) {
    const errors = [];
    const read = (rel) => ctx.fs.readFile(path.join(ctx.repoRoot, rel));
    const pkgText = read(PKG_REL);
    // N/A outside the framework repo (adopters hold no CLI source).
    if (pkgText === null)
        return { name: "version-sync", ok: true, errors: [] };
    let version;
    try {
        version = (JSON.parse(pkgText).version ?? "").trim();
    }
    catch (e) {
        return { name: "version-sync", ok: false, errors: [`${PKG_REL} does not parse: ${e.message}`] };
    }
    if (!version)
        return { name: "version-sync", ok: false, errors: [`${PKG_REL}: no 'version' field`] };
    const contentVersion = read(CONTENT_VERSION_REL);
    if (contentVersion === null) {
        errors.push(`${CONTENT_VERSION_REL}: missing (expected to equal the CLI ${version})`);
    }
    else if (contentVersion.trim() !== version) {
        errors.push(`${CONTENT_VERSION_REL}: '${contentVersion.trim()}' != CLI '${version}'`);
    }
    const readme = read("README.md");
    if (readme !== null) {
        for (const m of readme.matchAll(README_PIN_RE)) {
            if (m[1] !== "latest") {
                errors.push(`README.md: jsDelivr URL is pinned to @${m[1]}; use @latest (assets float with the release)`);
            }
        }
    }
    return { name: "version-sync", ok: errors.length === 0, errors };
}
