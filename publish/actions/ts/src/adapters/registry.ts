// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE ADAPTER REGISTRY (PRJ-121 intent 03, D7, Q15) — each port bound to an adapter by id.
 *
 * Which platform answers a port is a deployment fact, so it is read from `adapters:` in org-config.yaml
 * (`config/org-config.ts` → {@link AdapterSelection}), `github` for any port the block does not name. An id
 * nobody registered is an {@link UnknownAdapterError} that names it — never a quiet fallback to another adapter,
 * which would have gov report work done on a platform it never touched.
 *
 * Learned from gov-cicd's `adapters/registry.ts`. Each port's task adds its factories to {@link builtInProviders}:
 * plan 05 T04 / plan 03 L02 the work tracker, L03 the VCS host, L04 CI identity.
 */
import { PORT_NAMES, PORT_CONFIG_KEYS, type PortName, type PortTypes, type Ports } from "../ports/index.js";
import { MEMORY_ADAPTER_ID } from "./memory/index.js";

export type AdapterId = string;

/** The adapter every port uses unless org-config.yaml says otherwise (Q15). */
export const DEFAULT_ADAPTER: AdapterId = "github";

/**
 * What an adapter may be handed when it is built. Everything is optional and injectable, so a unit test passes
 * fakes and production passes nothing (each adapter then reads the real thing).
 */
export interface AdapterContext {
  /** Environment variables (default: `process.env`). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** HTTP (default: the global `fetch`). */
  readonly fetch?: typeof globalThis.fetch;
}

export type AdapterFactory<K extends PortName> = (ctx: AdapterContext) => PortTypes[K];

/** Every registered adapter, by port and id. */
export type AdapterProviders = { readonly [K in PortName]: Readonly<Record<AdapterId, AdapterFactory<K>>> };

/** Which adapter answers each port. */
export type AdapterSelection = { readonly [K in PortName]: AdapterId };

export const DEFAULT_SELECTION: AdapterSelection = Object.freeze(
  Object.fromEntries(PORT_NAMES.map((p) => [p, DEFAULT_ADAPTER])) as Record<PortName, AdapterId>,
);

/**
 * The ids an ORGANIZATION may select for each port. `memory` is registered for tests but is not here: a tracker
 * that forgets everything when the process exits is the silent no-op the ports exist to end.
 */
export const SELECTABLE_ADAPTERS: { readonly [K in PortName]: readonly AdapterId[] } = {
  workTracker: ["github"],
  vcs: ["github"],
  ciIdentity: ["github"],
};

/**
 * The adapters gov ships. A port's table fills in as its task lands — the empty ones are the spots it fills:
 * `workTracker` (plan 05 T04: `github/work-tracker.ts`; plan 03 L02: + `memory`), `vcs` (L03), `ciIdentity` (L04).
 */
export const builtInProviders: AdapterProviders = {
  workTracker: {},
  vcs: {},
  ciIdentity: {},
};

/** No adapter registered under that id for that port. The message names the id, the port and what exists. */
export class UnknownAdapterError extends Error {
  constructor(readonly port: PortName, readonly id: AdapterId, readonly available: readonly AdapterId[]) {
    super(`no adapter '${id}' for port ${port} (adapters: ${PORT_CONFIG_KEYS[port]} in org-config.yaml) — registered: ${available.join(", ") || "none"}`);
    this.name = "UnknownAdapterError";
  }
}

/** Build one port's adapter by id. Throws {@link UnknownAdapterError} for an id nobody registered. */
export function pickAdapter<K extends PortName>(providers: AdapterProviders, port: K, id: AdapterId, ctx: AdapterContext = {}): PortTypes[K] {
  const table = providers[port] as Readonly<Record<AdapterId, AdapterFactory<K>>>;
  const factory = Object.prototype.hasOwnProperty.call(table, id) ? table[id] : undefined;
  if (!factory) throw new UnknownAdapterError(port, id, Object.keys(table));
  return factory(ctx);
}

/** Build every port from a selection. Any unknown id fails the whole build. */
export function buildPorts(selection: AdapterSelection = DEFAULT_SELECTION, providers: AdapterProviders = builtInProviders, ctx: AdapterContext = {}): Ports {
  const out: Partial<Record<PortName, unknown>> = {};
  for (const p of PORT_NAMES) out[p] = pickAdapter(providers, p, selection[p], ctx);
  return out as Ports;
}

/**
 * What is wrong with an organization's selection — one line per port whose id it may not select. Empty = fine.
 * Pure; `gov doctor` turns a non-empty list into a failing row.
 */
export function selectionProblems(selection: AdapterSelection): string[] {
  const out: string[] = [];
  for (const p of PORT_NAMES) {
    const id = selection[p];
    if (SELECTABLE_ADAPTERS[p].includes(id)) continue;
    const why = id === MEMORY_ADAPTER_ID ? " (memory is for tests only)" : "";
    out.push(`${PORT_CONFIG_KEYS[p]}: '${id}' is not an adapter gov has${why} — choose ${SELECTABLE_ADAPTERS[p].join(" or ")}`);
  }
  return out;
}
