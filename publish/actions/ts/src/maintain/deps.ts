// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * `deps` (SDD Part E, install-deps.sh) — report the runtime prerequisites and,
 * for any missing, the per-OS install command. Under the Node cutover the deps
 * reduce to `git` + `gh` (no more yq/python3). Pure over an injected tool probe;
 * report-only (the actual install is the printed command — no auto-install).
 */
export const REQUIRED_TOOLS = ["git", "gh"] as const;

export interface ToolCheck {
  readonly name: string;
  readonly present: boolean;
  readonly installHint: string;
}
export interface DepsReport {
  readonly ok: boolean;
  readonly tools: readonly ToolCheck[];
}

const HINTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  darwin: { git: "brew install git", gh: "brew install gh" },
  linux: { git: "apt-get install -y git  (or: dnf install git)", gh: "https://github.com/cli/cli#installation" },
  win32: { git: "winget install Git.Git", gh: "winget install GitHub.cli" },
};

export function checkDeps(hasTool: (name: string) => boolean, platform: string): DepsReport {
  const tools = REQUIRED_TOOLS.map((name) => ({
    name,
    present: hasTool(name),
    installHint: HINTS[platform]?.[name] ?? `install ${name}`,
  }));
  return { ok: tools.every((t) => t.present), tools };
}

export function formatDepsReport(r: DepsReport): string[] {
  return [
    ...r.tools.map((t) => (t.present ? `  ✓ ${t.name}` : `  ✗ ${t.name} — ${t.installHint}`)),
    r.ok ? "deps: all present" : "deps: install the missing tools above",
  ];
}
