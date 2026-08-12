#!/usr/bin/env node
import { relative } from "node:path";
import { generateAll } from "./generate.mjs";
import { REPO_ROOT, OUTPUT_DIR } from "./config.mjs";

const cmd = process.argv[2] || "generate";

if (cmd !== "generate") {
  console.error(`Unknown command "${cmd}". Usage: knowledge-pdf generate`);
  process.exit(2);
}

const t0 = Date.now();
console.log(`[knowledge-pdf] generating Form 2 policy PDFs -> ${relative(REPO_ROOT, OUTPUT_DIR)}/`);

try {
  const results = await generateAll();
  for (const r of results) {
    console.log(
      `  ✓ ${r.title ?? "(untitled)"}\n` +
        `      out:        ${relative(REPO_ROOT, r.output)}\n` +
        `      version:    ${r.version.short} (${r.version.full ?? "n/a"})\n` +
        `      effective:  ${r.effectiveDate}  [${r.effectiveDateSource}]\n` +
        `      owner:      ${r.owner.name} · ${r.owner.role}\n` +
        `      compliance: ${r.compliance ?? "—"}   status: ${r.status ?? "—"}`,
    );
  }
  console.log(
    `[knowledge-pdf] done: ${results.length} PDF(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );
} catch (err) {
  console.error("[knowledge-pdf] FAILED:", err);
  process.exit(1);
}
