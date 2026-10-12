// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd. — part of the OSS governed-agentic-dev-framework.
/**
 * The seam's JSON schemas (spec 02 §3–§4), shipped as plain `.schema.json` files beside this module so services in
 * other languages (the gov-licence service, the traffic-capture assertions) read the very same files. Every object
 * level says `additionalProperties: false`: an unknown field is refused, never carried along.
 */
import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

export const SCHEMA_NAMES = ["gov-evidence-1", "seal", "chain-entry", "lease-request", "usage-counts"] as const;
export type SchemaName = (typeof SCHEMA_NAMES)[number];

const load = (name: SchemaName): Readonly<Record<string, unknown>> =>
  JSON.parse(fs.readFileSync(fileURLToPath(new URL(`./schemas/${name}.schema.json`, import.meta.url)), "utf8")) as Record<string, unknown>;

export const SCHEMAS: Readonly<Record<SchemaName, Readonly<Record<string, unknown>>>> = Object.freeze(
  Object.fromEntries(SCHEMA_NAMES.map((n) => [n, load(n)])) as Record<SchemaName, Readonly<Record<string, unknown>>>,
);
