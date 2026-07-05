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

export const OPERATE_ENVS = ["dev", "uat", "prod"] as const;

export async function runOperateFlow(deps: OperateFlowDeps): Promise<number> {
  const { print } = deps;
  print("");
  print("  Operate — build & deploy units (enterprise)");
  print("    1) catalog   list units in the catalog");
  print("    2) deploy    deploy a built unit to an env");
  print("    3) promote   promote a proven unit to the next env");
  print("     0) back");
  const c = (await deps.prompt("  Choose: ")).trim();
  if (c === "0" || c === "") return 0;
  if (c === "1") return await deps.run(["catalog", "list"]);
  if (c === "2" || c === "3") {
    const verb = c === "2" ? "deploy" : "promote";
    const unit = (await deps.prompt("  unit: ")).trim();
    if (!unit) { print("  a unit is required"); return 2; }
    print(`  env options: ${OPERATE_ENVS.join(" · ")}`);
    const env = (await deps.prompt("  env: ")).trim();
    if (!(OPERATE_ENVS as readonly string[]).includes(env)) { print(`  env must be one of: ${OPERATE_ENVS.join(", ")}`); return 2; }
    return await deps.run([verb, unit, "--env", env]);
  }
  print("  unknown choice");
  return 2;
}
