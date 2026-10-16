// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * A predicate from its parameters, written compactly — `kind=list-membership when=**\/package.json list=x on_miss=fail`
 * — for the tests of the two predicate engines (diff-check.ts, verb-gate.ts). The inline `gov:check` notation is
 * retired; this is only a fixture shorthand for the `Check` a rule row's binding becomes.
 */
import { CHECK_KINDS, type Check, type CheckKind, type GateableVerb } from "../../src/rules/checks/predicates.js";

export function checkFrom(text: string): Check {
  const a: Record<string, string> = {};
  for (const m of text.matchAll(/([a-z][a-z0-9_-]*)=(?:"([^"]*)"|(\S+))/gi)) a[m[1]!.toLowerCase()] = m[2] ?? m[3] ?? "";
  const { kind, when, on_miss: onMiss, ...attrs } = a;
  if (!kind || !(CHECK_KINDS as readonly string[]).includes(kind)) throw new Error(`fixture: no such predicate kind=${kind}`);
  const parts = (when ?? "").split(",").map((w) => w.trim()).filter(Boolean);
  const trigger = parts.length === 1 && parts[0]!.startsWith("verb:")
    ? { on: "verb" as const, verb: parts[0]!.slice("verb:".length) as GateableVerb }
    : { on: "files" as const, globs: parts };
  return { kind: kind as CheckKind, trigger, attrs, onMiss: onMiss === "warn" ? "warn" : "fail" };
}
