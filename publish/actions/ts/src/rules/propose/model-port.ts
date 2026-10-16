// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE MODEL, AS THE PROPOSER SEES IT (rule-model-design.md Q2, Q16/17; W4, 2026-10-06).
 *
 * A request goes in, text comes out. Nothing here says WHICH model or HOW it is reached: that is the org's choice
 * (framework spec §9.3 — the org declares the model it has approved, and CI may only use one the org has approved
 * for CI). The provider adapter is wired by the CLI (P3); the engine is tested against a recorded fake.
 *
 * The reply is untrusted text. It is parsed strictly ({@link ./parse.js}) and never trusted for an id.
 */
export interface ModelRequest {
  readonly system: string;
  readonly user: string;
  /** JSON Schema the reply must satisfy, for a provider that can enforce structured output. Advisory: gov re-checks. */
  readonly schema?: object;
}

export interface ModelPort {
  complete(req: ModelRequest): Promise<string>;
}
