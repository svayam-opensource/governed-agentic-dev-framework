// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Enterprise plugin seam — `gov` loads `@svayam/gov-operate` (catalog + deploy)
 * when it's installed and licensed. The OSS CLI stays free of enterprise code:
 * these commands dynamic-import the plugin and delegate to its `runCli` entry;
 * absent → a clear "install the enterprise plugin" message. The importer is
 * injected so the seam is fully unit-testable without the real package.
 */
import type { OrgConfig } from "../config/org-config.js";

/** The enterprise command namespace owned by the gov-operate plugin. */
export const PLUGIN_COMMANDS = ["deploy", "catalog", "data", "promote", "rollback", "drift"] as const;
export type PluginCommand = (typeof PLUGIN_COMMANDS)[number];

export function isPluginCommand(cmd: string): cmd is PluginCommand {
  return (PLUGIN_COMMANDS as readonly string[]).includes(cmd);
}

/** What `gov` hands the plugin so it can assemble its own ports. */
export interface PluginCliContext {
  readonly home: string;
  readonly config: OrgConfig;
  /** The enterprise license (from $GOV_LICENSE), if any. */
  readonly license?: string;
}

export interface PluginCliResult {
  readonly code: number;
  readonly lines: readonly string[];
}

/** A credential a plugin command's ask needs — surfaced so the OSS preflight can detect it
 *  (a per-env registry publish token) BEFORE the command runs. `method` (the discovered auth
 *  method) + `credKey` (the standard store key) are INTERNAL — the developer never sees them. */
export interface PluginSecurityNeed { readonly registry: string; readonly env: string; readonly method: string; readonly credKey: string; }

/** The contract `@svayam/gov-operate` must export. */
export interface GovOperatePlugin {
  runCli(argv: readonly string[], ctx: PluginCliContext): Promise<PluginCliResult>;
  /** OPTIONAL: the command's security needs (probes the target to discover the credential). */
  securityNeeds?(argv: readonly string[], ctx: PluginCliContext): Promise<PluginSecurityNeed[]>;
}

export type PluginLoad =
  | { readonly ok: true; readonly plugin: GovOperatePlugin }
  | { readonly ok: false; readonly message: string };

const PACKAGE = "@svayam/gov-operate";

/** Dynamic-import the enterprise plugin. `importer` is injected for tests. */
export async function loadGovOperate(importer: (name: string) => Promise<unknown> = (n) => import(n)): Promise<PluginLoad> {
  let mod: { runCli?: unknown; securityNeeds?: unknown };
  try {
    mod = (await importer(PACKAGE)) as { runCli?: unknown; securityNeeds?: unknown };
  } catch {
    return {
      ok: false,
      message: `This is an enterprise command (catalog/deploy). Install the plugin:\n  npm i -g ${PACKAGE}   # registry: npm.svayamtech.com`,
    };
  }
  if (typeof mod.runCli !== "function") {
    return { ok: false, message: `${PACKAGE} is installed but exposes no \`runCli\` entry — update the plugin.` };
  }
  return { ok: true, plugin: {
    runCli: mod.runCli as GovOperatePlugin["runCli"],
    ...(typeof mod.securityNeeds === "function" ? { securityNeeds: mod.securityNeeds as GovOperatePlugin["securityNeeds"] } : {}),
  } };
}

/** Load the plugin and delegate the command; returns the plugin's exit code + output. */
export async function runPluginCommand(argv: readonly string[], ctx: PluginCliContext, importer?: (name: string) => Promise<unknown>): Promise<PluginCliResult> {
  const load = await loadGovOperate(importer);
  if (!load.ok) return { code: 2, lines: [load.message] };
  try {
    return await load.plugin.runCli(argv, ctx);
  } catch (e) {
    // e.g. the plugin's LicenseError when installed but unlicensed.
    return { code: 1, lines: [(e as Error).message] };
  }
}
