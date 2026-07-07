// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * The guided Operate flow (enterprise) — the same spirit as Work: get something
 * done fast. Pick an action → unit → env, and delegate to the `gov-operate`
 * plugin (`gov catalog/deploy/promote`). Pure over injected run + prompt/print.
 */
export interface OperateFlowDeps {
  readonly run: (argv: readonly string[]) => Promise<number> | number;
  readonly prompt: (q: string) => Promise<string>;
  readonly print: (l: string) => void;
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
  if (c === "1") return await runCatalogFlow(deps);
  const verb = ({ "2": "deploy", "3": "data", "4": "promote" } as Record<string, string>)[c];
  if (!verb) { print("  unknown choice"); return 2; }
  const argv = await promptForCommand([verb], deps.prompt, print);
  return argv ? await deps.run(argv) : 2;
}

/** Fill an under-specified enterprise command interactively → the full argv (null on abort).
 *  Already-specified argv passes through. Shared by the Operate menu AND bare `gov <cmd>` on a TTY;
 *  the flag/positional form stays for agents/non-interactive use. */
export async function promptForCommand(argv: readonly string[], prompt: (q: string) => Promise<string>, print: (l: string) => void): Promise<string[] | null> {
  const a = [...argv];
  const [sub, sub2] = a;
  if (sub === "catalog" && sub2 === "create") return a[2] ? a : await promptCreateUnit(prompt, print);
  if (sub === "deploy" || sub === "data") {
    if (a.length >= 3) return a;
    const unit = (await prompt("  unit: ")).trim(); if (!unit) { print("  a unit is required"); return null; }
    print(`  env options: ${OPERATE_ENVS.join(" · ")}`);
    const env = (await prompt("  env: ")).trim();
    if (!(OPERATE_ENVS as readonly string[]).includes(env)) { print(`  env must be one of: ${OPERATE_ENVS.join(", ")}`); return null; }
    return [sub, unit, env];
  }
  if (sub === "promote") {
    if (a.length >= 4) return a;
    const unit = (await prompt("  unit: ")).trim();
    const from = (await prompt("  from env: ")).trim();
    const to = (await prompt("  to env: ")).trim();
    if (!unit || !from || !to) { print("  unit + from + to are required"); return null; }
    return ["promote", unit, from, to];
  }
  return a;
}

/** does this bare invocation want interactive prompting (only honored on a real TTY)? */
export function needsInteractive(argv: readonly string[]): boolean {
  const [sub, sub2] = argv;
  if (sub === "catalog") return sub2 === "create" && !argv[2];
  if (sub === "deploy" || sub === "data") return argv.length < 3;
  if (sub === "promote") return argv.length < 4;
  return false;
}

/** Operate → catalog: list, or CREATE a new unit interactively (delegates to `gov catalog create`). */
export async function runCatalogFlow(deps: OperateFlowDeps): Promise<number> {
  const { print } = deps;
  print("");
  print("    1) list     list units in the catalog");
  print("    2) create   create a new unit (interactive)");
  print("     0) back");
  const c = (await deps.prompt("  Choose: ")).trim();
  if (c === "1") return await deps.run(["catalog", "list"]);
  if (c === "2") {
    const argv = await promptCreateUnit(deps.prompt, print);
    return argv ? await deps.run(argv) : 2;
  }
  return 0;
}

/** Prompt for a new unit's non-secret fields → the `catalog create <id> --flags…` argv.
 *  The plugin validates (taxonomy, reuse, docs); this just gathers. Registries per env. */
export async function promptCreateUnit(prompt: (q: string) => Promise<string>, print: (l: string) => void): Promise<string[] | null> {
  const id = (await prompt("  unit id (e.g. gov-work): ")).trim();
  if (!id) { print("  a unit id is required"); return null; }
  const argv = ["catalog", "create", id];
  const add = async (label: string, flag: string): Promise<void> => { const v = (await prompt(`  ${label}: `)).trim(); if (v) argv.push(flag, v); };
  await add("type [svc | lib | cli | mobile | schedule | solution]", "--type");
  await add("sub-type (e.g. node · api · typescript)", "--sub-type");
  await add("packaging (e.g. npm · container)", "--packaging");
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
