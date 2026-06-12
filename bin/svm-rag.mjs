#!/usr/bin/env node
// svm-rag CLI shim. In dev, run via:  npx tsx src/cli.ts <cmd>
// After build:  node lib/esm/cli.js <cmd>
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const built = join(root, "lib", "esm", "src", "cli.js");
const target = existsSync(built) ? built : join(root, "src", "cli.ts");
const mod = await import(pathToFileURL(target).href);
await mod.main(process.argv.slice(2));
