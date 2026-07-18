// SPDX-License-Identifier: LicenseRef-Svayam-Proprietary
/**
 * Per-user credential STORE (SDD credential-seam, client half). Creds live under the
 * developer's own home, keyed by identity, so another OS user on the same machine can
 * neither read nor use them:
 *
 *     <agent_work_root>/preferences/<identity>/credentials      (0600, dir 0700)
 *
 * `<identity>` defaults to the logged-in user but can be any named identity the user
 * chooses to act as (see `resolveIdentity`). The file is a simple `KEY=VALUE` store; all
 * writes are LINE-PRESERVING (update the matching key's line, else append) so we never
 * rewrite — any pre-existing content/format survives untouched. Values are NEVER logged.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
/** The credentials file for an identity under the agent work root. */
export function credentialsPath(agentWorkRoot, identity) {
    return path.join(agentWorkRoot, "preferences", identity, "credentials");
}
/** A credential key is a stable id for one secret, e.g. `npm_token:npm.svayamtech.com`.
 *  Keep it to `[A-Za-z0-9_.:@/-]` so it survives as a `KEY=VALUE` line. */
export function credKey(kind, scope) {
    return `${kind}:${scope}`;
}
/** Parse `KEY=VALUE` lines (blank + `#` comments ignored). First `=` splits; value verbatim. */
export function parseCredentials(text) {
    const out = new Map();
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#"))
            continue;
        const eq = line.indexOf("=");
        if (eq <= 0)
            continue;
        out.set(line.slice(0, eq).trim(), raw.slice(raw.indexOf("=") + 1));
    }
    return out;
}
/** Read one credential value, or undefined. Does not throw if the file is absent. */
export function getCredential(file, key) {
    let text;
    try {
        text = fs.readFileSync(file, "utf8");
    }
    catch {
        return undefined;
    }
    return parseCredentials(text).get(key);
}
/** Which credential keys does this identity already hold? (keys only — never values). */
export function listCredentialKeys(file) {
    try {
        return [...parseCredentials(fs.readFileSync(file, "utf8")).keys()];
    }
    catch {
        return [];
    }
}
/**
 * Set/merge `key=value`, LINE-PRESERVING: replace the one line whose key matches, else
 * append. Everything else in the file is written back byte-for-byte, so a pre-existing
 * store in another shape is never clobbered. Creates dirs `0700` + file `0600`.
 */
export function setCredential(file, key, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    let lines = [];
    try {
        lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    }
    catch { /* new file */ }
    const rendered = `${key}=${value}`;
    let replaced = false;
    const out = lines.map((raw) => {
        const t = raw.trim();
        if (!replaced && !t.startsWith("#") && t.slice(0, t.indexOf("=") > 0 ? t.indexOf("=") : 0).trim() === key) {
            replaced = true;
            return rendered;
        }
        return raw;
    });
    if (!replaced) {
        // append after trimming a single trailing empty line, keeping a final newline
        while (out.length && out[out.length - 1].trim() === "")
            out.pop();
        out.push(rendered);
    }
    fs.writeFileSync(file, out.join("\n").replace(/\n*$/, "\n"), { mode: 0o600 });
    try {
        fs.chmodSync(file, 0o600);
    }
    catch { /* best-effort on platforms without chmod */ }
}
/** Identities that already have a preferences dir under the work root (dir names). */
export function listIdentities(agentWorkRoot) {
    const dir = path.join(agentWorkRoot, "preferences");
    try {
        return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    }
    catch {
        return [];
    }
}
/** True if an identity has a credentials file at all (used to decide create-vs-reuse). */
export function identityExists(agentWorkRoot, identity) {
    try {
        return fs.statSync(credentialsPath(agentWorkRoot, identity)).isFile();
    }
    catch {
        return false;
    }
}
/** The default identity for the prompt — the logged-in user id. Overridable by the user. */
export function defaultIdentity(env = process.env) {
    return env.GOV_IDENTITY || env.USER || env.LOGNAME || os.userInfo().username;
}
