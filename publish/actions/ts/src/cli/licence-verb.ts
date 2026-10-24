// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * `gov licence login | status | install` (spec 02 §4.1, plan 02 E05) — the person's side of the optional paid module.
 *
 *   login    paste the personal key from the portal → OS keychain (never a file, never printed); the module, when
 *            installed, is handed the key so it can take its first lease
 *   status   what the INSTALLED MODULE says: state, org, plan, entitlements, lease expiry. Open gov never judges a
 *            licence itself (spec 02 §5 — a check in open code would be decorative)
 *   install  exchange the key for a ~15-minute registry token (POST <api>/registry-token), give it to npm through the
 *            ENVIRONMENT only, and install @svayam/gov-check where gov's loader looks for it
 *
 * The key never reaches stdout, stderr or a log: every line that might carry text from elsewhere (a service's error,
 * npm's stderr) is scrubbed of the key and the token before it is returned.
 */
import * as path from "node:path";
import { decodeJws } from "../evidence/roots.js";
import type { LicenceStatus } from "../check-seam/public.js";
import { LICENCE_ACCOUNT, LICENCE_KEY_ENV, type OsKeychain } from "../security/keychain.js";

/** The module's package, and the versions this gov installs (host API 1.x ↔ gov-check 2.x). */
export const GOV_CHECK_PACKAGE = "@svayam/gov-check";
export const GOV_CHECK_RANGE = "^2.0.0-next.0";
export const GOV_CHECK_REGISTRY = "https://npm.svayamtech.com/";
/** Where gov-check's own (public) dependencies come from. The gov registry token reaches gov-check only. */
export const PUBLIC_REGISTRY = "https://registry.npmjs.org/";
/**
 * npm's arguments for the install. Both registries are FLAGS, not only .npmrc lines: npm ranks an inherited
 * `npm_config_registry` above a project .npmrc, and `npx` exports the user's default registry to its children —
 * measured 2026-10-24, the public deps then went to npm.svayamtech.com with the gov token and got 403.
 */
export const npmInstallArgs = (spec: string): string[] =>
  ["install", "--no-audit", "--no-fund", `--registry=${PUBLIC_REGISTRY}`, `--@svayam:registry=${GOV_CHECK_REGISTRY}`, spec];
/**
 * The env var npm reads the credential from — named in .npmrc as `${…}`, so the file never holds it. It carries npm
 * BASIC auth (`_auth`): base64 of `gov-registry:<registry token>`. The registry's gate (verdaccio-gov-auth) is an auth
 * plugin, and Verdaccio hands a plugin only Basic credentials; an `_authToken` goes out as a Bearer token, which
 * Verdaccio treats as one of its own sessions, so the install arrived anonymous and was refused (401).
 */
export const REGISTRY_AUTH_ENV = "GOV_CHECK_REGISTRY_AUTH";
/** The Basic-auth user name the registry's gate reads a token from. */
export const REGISTRY_TOKEN_USER = "gov-registry";
/** npm `_auth` for a registry token: base64 of `gov-registry:<token>`. */
export const registryBasicAuth = (token: string): string => Buffer.from(`${REGISTRY_TOKEN_USER}:${token}`).toString("base64");

export type ModuleState =
  | { readonly state: "absent" }
  | { readonly state: "refused"; readonly lines: readonly string[] }
  | { readonly state: "active"; readonly via?: string; readonly licence: { status(): LicenceStatus; login(key: string): Promise<void> } };

export type RegistryTokenResult = { readonly ok: true; readonly token: string; readonly expiresAt?: string } | { readonly ok: false; readonly reason: string };

export interface LicenceDeps {
  readonly keychain: OsKeychain;
  /** Find and start the installed module (the seam loader); never throws. */
  loadModule(): Promise<ModuleState>;
  /** The pasted key: a hidden prompt, or stdin with --key-from-stdin. null = nothing given. */
  readKey(fromStdin: boolean): Promise<string | null>;
  /** POST <api>/registry-token {personalKey} → a short-lived npm read token. */
  registryToken(personalKey: string): Promise<RegistryTokenResult>;
  /** `npm install <spec>` in `dir`; `env` is ADDED to the process environment. */
  npmInstall(dir: string, spec: string, env: Readonly<Record<string, string>>): { status: number; stderr: string };
  /** Write a file (creating its folder). */
  writeFile(file: string, text: string): void;
  /** Where the loader finds an installed module: `$XDG_DATA_HOME/gov/gov-check` or `%LOCALAPPDATA%\gov\gov-check`. */
  readonly installDir: string;
  /** The portal page where a person generates a personal key. */
  readonly portalUrl: string;
}

export interface LicenceResult { readonly code: number; readonly lines: readonly string[] }

const USAGE = "usage: gov licence <login [--key-from-stdin] | status | install [--spec <version-range>]>";

/** Remove every secret from text that came from elsewhere. */
const scrub = (text: string, secrets: readonly (string | undefined)[]): string =>
  secrets.reduce<string>((t, s) => (s && s.length >= 8 ? t.split(s).join("[redacted]") : t), text);

export async function licenceCommand(positionals: readonly string[], flags: Readonly<Record<string, string | boolean>>, deps: LicenceDeps): Promise<LicenceResult> {
  switch (positionals[0]) {
    case "login": return login(flags, deps);
    case "status": return status(deps);
    case "install": return install(flags, deps);
    default: return { code: 2, lines: [USAGE] };
  }
}

async function login(flags: Readonly<Record<string, string | boolean>>, deps: LicenceDeps): Promise<LicenceResult> {
  const lines = [
    `Generate a personal key in the Svayam portal: ${deps.portalUrl}`,
    "Copy it, then paste it here. It is stored in your OS keychain and never shown.",
  ];
  const raw = await deps.readKey(Object.prototype.hasOwnProperty.call(flags, "key-from-stdin"));
  const key = raw?.trim() ?? "";
  if (!key) return { code: 1, lines: [...lines, "gov licence login: no key was given — nothing was stored."] };
  const jws = decodeJws(key);
  if (!jws || jws.header.typ !== "gov-key+jws") {
    return { code: 1, lines: [...lines, `gov licence login: that is not a gov personal key (a gov-key+jws token from ${deps.portalUrl}) — nothing was stored.`] };
  }
  if (deps.keychain.backend === "env only") {
    return { code: 1, lines: [...lines, `gov licence login: this system has no keychain gov can use — put the key in ${LICENCE_KEY_ENV} in your environment (your shell profile, or your CI secret store). gov never writes it to a file.`] };
  }
  try {
    await deps.keychain.set(LICENCE_ACCOUNT, key);
  } catch (e) {
    return { code: 1, lines: [...lines, `gov licence login: ${scrub((e as Error).message, [key])}`] };
  }
  lines.push(`personal key stored in ${deps.keychain.backend}.`);
  const m = await deps.loadModule();
  if (m.state === "active") {
    try {
      await m.licence.login(key);
      lines.push("gov-check took the key; `gov licence status` shows your organization, plan and lease.");
    } catch (e) {
      lines.push(`gov-check could not take a lease yet: ${scrub((e as Error).message.split("\n")[0] ?? "", [key])} — \`gov licence status\` says more.`);
    }
  } else if (m.state === "absent") {
    lines.push("Next: `gov licence install` fetches gov-check, the module that writes signed evidence.");
  } else {
    lines.push(...m.lines.map((l) => scrub(l, [key])));
  }
  return { code: 0, lines };
}

async function status(deps: LicenceDeps): Promise<LicenceResult> {
  const found = await deps.keychain.lookup(LICENCE_ACCOUNT);
  const keyLine = found
    ? found.from === "keychain" ? `stored in ${deps.keychain.backend}` : `from ${LICENCE_KEY_ENV}`
    : "not set — `gov licence login`";
  const lines = ["gov licence status", `  personal key   ${keyLine}`];
  const m = await deps.loadModule();
  const secrets = [found?.secret];
  if (m.state === "absent") {
    lines.push("  gov-check      not installed — `gov licence install` (open gov runs every check without it)");
    return { code: 1, lines };
  }
  if (m.state === "refused") {
    lines.push(...m.lines.map((l) => `  gov-check      ${scrub(l, secrets)}`));
    return { code: 1, lines };
  }
  const s = m.licence.status();
  lines.push(`  gov-check      installed${m.via ? ` (${m.via})` : ""}`);
  lines.push(`  state          ${s.state}`);
  if (s.org) lines.push(`  org            ${s.org.vcs} ${s.org.id}`);
  if (s.plan) lines.push(`  plan           ${s.plan}`);
  lines.push(`  entitlements   ${s.entitlements.length ? s.entitlements.join(", ") : "none"}`);
  if (s.leaseExpiry) lines.push(`  lease expires  ${s.leaseExpiry}`);
  if (s.reason) lines.push(`  reason         ${scrub(s.reason, secrets)}`);
  return { code: s.state === "licensed" || s.state === "grace" ? 0 : 1, lines };
}

async function install(flags: Readonly<Record<string, string | boolean>>, deps: LicenceDeps): Promise<LicenceResult> {
  const range = typeof flags.spec === "string" ? flags.spec : GOV_CHECK_RANGE;
  if (!/^[A-Za-z0-9.^~<>=| *+-]+$/.test(range)) return { code: 2, lines: [`gov licence install: --spec takes a version or range, e.g. ${GOV_CHECK_RANGE}`, USAGE] };
  const key = await deps.keychain.get(LICENCE_ACCOUNT);
  if (!key) return { code: 1, lines: [`gov licence install: no personal key — run \`gov licence login\` first (or set ${LICENCE_KEY_ENV}).`] };

  const tok = await deps.registryToken(key);
  if (!tok.ok) return { code: 1, lines: [`gov licence install: the licence service gave no registry token — ${scrub(tok.reason, [key])}`] };

  const dir = deps.installDir;
  const host = new URL(GOV_CHECK_REGISTRY).host;
  deps.writeFile(path.join(dir, "package.json"), `${JSON.stringify({ name: "gov-check-install", private: true, description: "Where `gov licence install` keeps @svayam/gov-check. Managed by gov." }, null, 2)}\n`);
  // The credential is NAMED here, never written: npm expands ${GOV_CHECK_REGISTRY_AUTH} from the environment it is
  // given. The blank `_authToken` matters: a Svayam developer's own ~/.npmrc often holds an SSO token for this host,
  // and npm prefers a token over `_auth` across config layers — without the blank, npm would read gov-check as that
  // person, whom the package rule does not admit (403). `registry=` sends gov-check's own (public) dependencies to npmjs:
  // the registry token reaches gov-check only, so a developer whose default registry is this host would get 403 on them.
  const auth = registryBasicAuth(tok.token);
  deps.writeFile(path.join(dir, ".npmrc"), `registry=${PUBLIC_REGISTRY}\n@svayam:registry=${GOV_CHECK_REGISTRY}\n//${host}/:_auth=\${${REGISTRY_AUTH_ENV}}\n//${host}/:_authToken=\n`);
  const spec = `${GOV_CHECK_PACKAGE}@${range}`;
  const r = deps.npmInstall(dir, spec, { [REGISTRY_AUTH_ENV]: auth });
  if (r.status !== 0) {
    const last = r.stderr.trim().split("\n").filter(Boolean).slice(-2).join(" · ");
    return { code: 1, lines: [`gov licence install: npm could not install ${spec} into ${dir}${last ? `: ${scrub(last, [key, tok.token, auth])}` : ""}`] };
  }
  const lines = [`installed ${spec} into ${dir} — gov finds it there.`];
  const m = await deps.loadModule();
  if (m.state === "active") lines.push("gov-check is active; `gov licence status` shows your organization, plan and lease.");
  else if (m.state === "refused") lines.push(...m.lines.map((l) => scrub(l, [key, tok.token, auth])));
  return { code: 0, lines };
}
