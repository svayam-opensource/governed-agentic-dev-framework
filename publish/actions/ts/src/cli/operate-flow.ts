// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The guided Operate flow (enterprise) — the same spirit as Work: get something
 * done fast. Pick an action → unit → env, and delegate to the `gov-operate`
 * plugin (`gov catalog/deploy/promote`). Pure over injected run + prompt/print.
 */
import type { PluginTaxonomy, PluginUnitInfo } from "../plugin/loader.js";

export interface OperateFlowDeps {
  readonly run: (argv: readonly string[]) => Promise<number> | number;
  readonly prompt: (q: string) => Promise<string>;
  readonly print: (l: string) => void;
  /** the org's active value sets — drives contextual sub-type/packaging prompts on create. */
  readonly taxonomy?: readonly PluginTaxonomy[];
  /** the catalog units — drives the pick-a-unit list for deploy/data/promote/view/update/delete. */
  readonly units?: readonly PluginUnitInfo[];
}

export const OPERATE_ENVS = ["local", "dev", "uat", "prod"] as const;

export async function runOperateFlow(deps: OperateFlowDeps): Promise<number> {
  const { print } = deps;
  print("");
  print("  Operate — build & deploy units (enterprise)");
  print("    1) catalog   list / create units");
  print("    2) deploy    deploy a unit to an env");
  print("    3) data      apply a data/config unit to its engine");
  print("    4) promote   promote a proven unit to the next env");
  print("     0) back");
  const c = (await deps.prompt("  Choose: ")).trim();
  if (c === "0" || c === "") return 0;
  const verb = ({ "1": "catalog", "2": "deploy", "3": "data", "4": "promote" } as Record<string, string>)[c];
  if (!verb) { print("  unknown choice"); return 2; }
  // ONE mechanism: every bare command → its guided prompts/sub-menu, identical to the CLI path.
  const argv = await promptForCommand([verb], deps.prompt, print, deps.taxonomy, deps.units);
  if (argv === null) return 2;
  if (argv.length === 0) return 0;                                // backed out of a sub-menu
  return await deps.run(argv);
}

/** Fill an under-specified enterprise command interactively → the full argv (null on abort).
 *  Already-specified argv passes through. Shared by the Operate menu AND bare `gov <cmd>` on a TTY;
 *  the flag/positional form stays for agents/non-interactive use. */
export async function promptForCommand(argv: readonly string[], prompt: (q: string) => Promise<string>, print: (l: string) => void, tax?: readonly PluginTaxonomy[], units?: readonly PluginUnitInfo[]): Promise<string[] | null> {
  const a = [...argv];
  const [sub, sub2] = a;
  if (sub === "catalog") {
    if (sub2 === "create") return a[2] ? a : await promptCreateUnit(prompt, print, tax);
    // catalog view/update/delete <id>: pick the unit from the list when the id is missing
    if ((sub2 === "view" || sub2 === "update" || sub2 === "delete") && !a[2]) {
      const unit = await pickUnit(prompt, print, units); if (!unit) return null;
      return ["catalog", sub2, unit];
    }
    if (!sub2) {                                                  // bare `gov catalog` → submenu
      print("    1) list     list units in the catalog");
      print("    2) create   create a new unit (interactive)");
      print("    3) view     view a unit's details");
      print("    4) update   update a unit (interactive)");
      print("    5) delete   delete a branch-only unit");
      print("     0) back");
      const c = (await prompt("  Choose: ")).trim();
      if (c === "1") return ["catalog", "list"];
      if (c === "2") return await promptCreateUnit(prompt, print, tax);
      const verb = ({ "3": "view", "4": "update", "5": "delete" } as Record<string, string>)[c];
      if (verb) { const unit = await pickUnit(prompt, print, units); return unit ? ["catalog", verb, unit] : (unit === null ? null : []); }
      return [];                                                  // back → clean no-op (exit 0)
    }
    return a;                                                     // `catalog list <id>` etc. → pass through
  }
  if (sub === "deploy" || sub === "data") {
    if (a.length >= 3) return a;
    const unit = await pickUnit(prompt, print, units); if (!unit) return null;
    // A branch-only unit (not yet in main) may ONLY target `local` — assume it, don't ask.
    const info = units?.find((u) => u.id === unit);
    let env: string | null;
    if (info && info.inMain === false) {
      env = "local";
      print("  env: local  (branch-only unit — dev/uat/prod unlock after it merges to main)");
    } else {
      env = await chooseFrom(prompt, print, "env", [...OPERATE_ENVS]);
    }
    if (!env) return null;
    return [sub, unit, env];
  }
  if (sub === "promote") {
    if (a.length >= 4) return a;
    const unit = await pickUnit(prompt, print, units); if (!unit) return null;
    const from = await chooseFrom(prompt, print, "from env", [...OPERATE_ENVS]);
    if (!from) return null;
    const to = await chooseFrom(prompt, print, "to env", [...OPERATE_ENVS]);
    if (!to) return null;
    return ["promote", unit, from, to];
  }
  return a;
}

/** Pick a unit: show the catalog list (numbered) and accept a number OR a typed id. Falls back to
 *  a free-text prompt when no list is available (empty catalog / plugin without units()). */
export async function pickUnit(prompt: (q: string) => Promise<string>, print: (l: string) => void, units?: readonly PluginUnitInfo[]): Promise<string | null> {
  if (!units || units.length === 0) {
    const u = (await prompt("  unit: ")).trim();
    if (!u) { print("  a unit is required"); return null; }
    return u;
  }
  print("  units:");
  units.forEach((u, i) => print(`    ${String(i + 1).padStart(2)}) ${u.id.padEnd(22)} ${u.type}${u.subType ? "/" + u.subType : ""}`));
  const ans = (await prompt(`  pick a unit [1-${units.length}] or type its id: `)).trim();
  if (!ans) { print("  a unit is required"); return null; }
  const n = Number(ans);
  if (Number.isInteger(n) && n >= 1 && n <= units.length) return units[n - 1].id;
  if (units.some((u) => u.id === ans)) return ans;
  print(`  '${ans}' isn't a listed unit`);
  return null;
}

/** does this bare invocation want interactive prompting (only honored on a real TTY)? */
export function needsInteractive(argv: readonly string[]): boolean {
  const [sub, sub2] = argv;
  if (sub === "catalog") return !sub2 || (["create", "view", "update", "delete"].includes(sub2 ?? "") && !argv[2]);
  if (sub === "deploy" || sub === "data") return argv.length < 3;
  if (sub === "promote") return argv.length < 4;
  return false;
}

/** Prompt for a new unit's non-secret fields → the `catalog create <id> --flags…` argv.
 *  When the taxonomy is available, `type` drives the valid sub-type/packaging choices (a `cli`
 *  offers `node`, never `api`) and a sole option is the Enter-default. The plugin still validates. */
export async function promptCreateUnit(prompt: (q: string) => Promise<string>, print: (l: string) => void, tax?: readonly PluginTaxonomy[]): Promise<string[] | null> {
  const id = (await prompt("  unit id (e.g. gov-work): ")).trim();
  if (!id) { print("  a unit id is required"); return null; }
  const argv = ["catalog", "create", id];
  const add = async (label: string, flag: string): Promise<void> => { const v = (await prompt(`  ${label}: `)).trim(); if (v) argv.push(flag, v); };
  if (tax?.length) {
    // taxonomy-driven: `type` gates the VALID sub-type/packaging — only valid combinations proceed.
    const type = await chooseFrom(prompt, print, "type", tax.map((t) => t.type));
    if (type === null) return null;
    argv.push("--type", type);
    const entry = tax.find((t) => t.type === type);
    const subType = await chooseFrom(prompt, print, "sub-type", [...(entry?.subTypes ?? [])]);
    if (subType === null) return null;
    if (subType) argv.push("--sub-type", subType);
    const packaging = await chooseFrom(prompt, print, "packaging", [...(entry?.packagings ?? [])]);
    if (packaging === null) return null;
    if (packaging) argv.push("--packaging", packaging);
  } else {
    // no taxonomy available (plugin didn't expose it) → free text; the plugin still validates.
    await add("type", "--type");
    await add("sub-type", "--sub-type");
    await add("packaging", "--packaging");
  }
  await add("source repo (owner/name)", "--repo");
  await add("source path (within the repo)", "--path");
  print("  per-env publish registry (blank to skip an env):");
  for (const env of ["dev", "uat", "prod"] as const) {
    const url = (await prompt(`    ${env} registry URL: `)).trim();
    if (url) argv.push("--registry", `${env}=${url}`);
  }
  await add("justification (why a new unit)", "--justification");
  return argv;
}

/** Offer the VALID options for a choice → the chosen value; "" when there are no options (axis N/A,
 *  e.g. `solution` has no sub-type); null when the answer isn't one of them (caller aborts). A sole
 *  option is the Enter-default. This is what keeps interactive choices to valid combinations only. */
export async function chooseFrom(prompt: (q: string) => Promise<string>, print: (l: string) => void, label: string, options: readonly string[]): Promise<string | null> {
  if (options.length === 0) return "";                               // this axis doesn't apply
  const sole = options.length === 1 ? options[0] : undefined;
  const def = sole ? ` (Enter = ${sole})` : "";
  const v = (await prompt(`  ${label} [${options.join(" | ")}]${def}: `)).trim() || (sole ?? "");
  if (!options.includes(v)) { print(`  ${label} must be one of: ${options.join(", ")}`); return null; }
  return v;
}
