// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * CLI ↔ content version compatibility. The installed `gov` CLI operates on a gov
 * workspace whose content is at some VERSION (the laid-down marker). Running an
 * OLDER CLI against NEWER content is unsafe — it may not understand the layout —
 * so a MAJOR-version gap hard-stops; smaller gaps warn (semver back-compat within
 * a major). Content behind the CLI just wants a `gov upgrade`.
 */
export type CompatStatus = "ok" | "no-marker" | "content-behind" | "cli-behind" | "cli-behind-major";

export interface CompatResult {
  readonly status: CompatStatus;
  /** false only for a hard-stop (cli-behind-major). */
  readonly ok: boolean;
  readonly message: string;
}

function parse(v: string): [number, number, number] {
  const m = v.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : [0, 0, 0];
}
function cmp(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

export function checkVersionCompat(cliVersion: string, contentVersion: string | null): CompatResult {
  if (!contentVersion) return { status: "no-marker", ok: true, message: "no content VERSION marker — run `gov upgrade` to install one" };
  const cli = parse(cliVersion);
  const content = parse(contentVersion);
  const c = cmp(cli, content);
  if (c === 0) return { status: "ok", ok: true, message: `CLI ${cliVersion} == content ${contentVersion}` };
  if (c > 0) return { status: "content-behind", ok: true, message: `content ${contentVersion} is behind the CLI ${cliVersion} — run \`gov upgrade\` to sync the workspace` };
  if (cli[0] < content[0]) {
    return { status: "cli-behind-major", ok: false, message: `gov CLI ${cliVersion} is a MAJOR version behind this workspace's content ${contentVersion} — it may not understand the layout. Upgrade the CLI:\n  npm i -g @svayam-opensource/gov@${contentVersion}` };
  }
  return { status: "cli-behind", ok: true, message: `gov CLI ${cliVersion} is behind the content ${contentVersion} — consider \`npm i -g @svayam-opensource/gov@${contentVersion}\`` };
}
