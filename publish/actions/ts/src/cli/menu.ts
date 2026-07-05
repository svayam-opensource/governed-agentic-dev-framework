// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The interactive menu (`gov` with no args on a TTY) — a categorized launcher
 * that mirrors the legacy `prj` menu: a context banner, then Status / Work /
 * Admin / Maintain actions that drill into their commands. When the enterprise
 * `gov-operate` plugin is installed, an **Operate** category (catalog · deploy ·
 * data) is added. Rendering + choice-resolution are pure/testable; the readline
 * loop delegates each chosen command to `run`.
 */
import * as readline from "node:readline";

/** Best-effort context shown in the banner (gathered by main.gatherMenuContext). */
export interface MenuContext {
  readonly orgName?: string;
  readonly githubOrg?: string;
  readonly branch?: string;
  readonly user?: string;
  readonly workspaceCount?: number;
  readonly cliVersion?: string;
  readonly operateInstalled?: boolean;
}

export interface MenuCategory {
  readonly key: string;
  readonly label: string;
  readonly desc: string;
  readonly commands: readonly string[];
}

/** The menu categories; adds Operate when the enterprise plugin is present. */
export function menuCategories(operateInstalled = false): MenuCategory[] {
  const cats: MenuCategory[] = [
    { key: "status", label: "Status", desc: "Review current state", commands: ["list", "status"] },
    { key: "work", label: "Work", desc: "Start / continue a project", commands: ["seed", "join", "task", "merge", "sync", "add-repo", "close", "pause", "resume", "cancel"] },
    { key: "admin", label: "Admin", desc: "Administer governance", commands: ["manage", "anchor", "knowledge", "onboard", "org", "setup"] },
    { key: "maintain", label: "Maintain", desc: "CLI + workspace health", commands: ["validate", "doctor", "deps", "upgrade", "bump-version", "publish"] },
  ];
  if (operateInstalled) cats.push({ key: "operate", label: "Operate", desc: "Catalog · deploy · data (enterprise)", commands: ["catalog", "deploy", "data", "promote", "rollback", "drift"] });
  return cats;
}

const goesTo = (c: MenuCategory): string => c.commands.slice(0, 4).join(" · ") + (c.commands.length > 4 ? " · …" : "");
const RULE = "─".repeat(72);

export function formatMainMenu(ctx: MenuContext): string[] {
  const cats = menuCategories(ctx.operateInstalled);
  const out: string[] = ["", `  ▸ ${ctx.orgName ?? "Governed Agentic Development Framework"} — Governed Agentic Development Framework (v${ctx.cliVersion ?? "?"})`];
  const bits = [ctx.githubOrg && `Org: ${ctx.githubOrg}`, ctx.branch && `Branch: ${ctx.branch}`, ctx.user && `User: ${ctx.user}`].filter(Boolean) as string[];
  if (bits.length) out.push(`  ${bits.join("  |  ")}`);
  if (ctx.workspaceCount !== undefined) out.push(`  ${ctx.workspaceCount} governance workspace(s) registered — press o to switch the active org.`);
  out.push("", RULE, "", `  ${"Action".padEnd(10)}  ${"Description".padEnd(32)}  Goes to`, `  ${"-".repeat(10)}  ${"-".repeat(32)}  ${"-".repeat(30)}`);
  cats.forEach((c, i) => out.push(`  (${i + 1}) ${c.label.padEnd(6)}  ${c.desc.padEnd(32)}  ${goesTo(c)}`));
  if (!ctx.operateInstalled) out.push("", "  Catalog, deploy & data need the enterprise plugin:  gov catalog · gov deploy · gov data");
  out.push("", "  Type a number; o to switch org; 0 to exit.", RULE);
  return out;
}

export type TopChoice =
  | { readonly kind: "category"; readonly category: MenuCategory }
  | { readonly kind: "org" }
  | { readonly kind: "quit" }
  | { readonly kind: "unknown" };

export function resolveTopChoice(input: string, ctx: MenuContext): TopChoice {
  const t = input.trim().toLowerCase();
  if (t === "0" || t === "q" || t === "") return { kind: "quit" };
  if (t === "o") return { kind: "org" };
  const cats = menuCategories(ctx.operateInstalled);
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= cats.length) return { kind: "category", category: cats[n - 1] };
  const byName = cats.find((c) => c.key === t || c.label.toLowerCase() === t);
  return byName ? { kind: "category", category: byName } : { kind: "unknown" };
}

/** Run the interactive menu; delegates the chosen command to `run` (returns its exit code). */
export async function runMenu(ctx: MenuContext, run: (argv: string[]) => Promise<number> | number): Promise<number> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));
  try {
    for (;;) {
      for (const l of formatMainMenu(ctx)) process.stderr.write(`${l}\n`);
      const top = resolveTopChoice(await ask("  Choose: "), ctx);
      if (top.kind === "quit") return 0;
      if (top.kind === "unknown") { process.stderr.write("  unknown choice\n"); continue; }
      if (top.kind === "org") {
        const org = (await ask("  org to use: ")).trim();
        if (org) return await run(["org", "use", org]);
        continue;
      }
      const cat = top.category;
      process.stderr.write(`\n  ${cat.label}:\n`);
      cat.commands.forEach((c, i) => process.stderr.write(`    ${String(i + 1).padStart(2)}) ${c}\n`));
      process.stderr.write("     0) back\n");
      const sub = (await ask("  Choose: ")).trim();
      if (sub === "0" || sub === "") continue;
      const idx = Number(sub) - 1;
      const cmd = Number.isInteger(idx) && idx >= 0 && idx < cat.commands.length ? cat.commands[idx] : cat.commands.includes(sub) ? sub : null;
      if (!cmd) { process.stderr.write("  unknown choice\n"); continue; }
      const args = (await ask(`  args for '${cmd}' (space-separated, blank if none): `)).trim();
      return await run([cmd, ...(args ? args.split(/\s+/) : [])]);
    }
  } finally {
    rl.close();
  }
}
