import { readFileSync, existsSync } from "node:fs";
import { relative } from "node:path";
import { generateAll } from "./generate.mjs";
import { REPO_ROOT } from "./config.mjs";

/**
 * Minimal dependency-free PDF inspector: counts pages via the /Type /Page
 * objects and confirms the file is a real PDF. Avoids pulling a parser dep
 * just for verification.
 */
function inspectPdf(path) {
  const buf = readFileSync(path);
  const head = buf.subarray(0, 5).toString("latin1");
  const isPdf = head === "%PDF-";
  const txt = buf.toString("latin1");
  // Count page objects (/Type /Page not /Pages).
  const pageMatches = txt.match(/\/Type\s*\/Page(?![s])/g) || [];
  return { isPdf, pages: pageMatches.length, bytes: buf.length };
}

console.log("[verify] regenerating + inspecting Form 2 policy PDFs\n");
const results = await generateAll();

let failures = 0;
for (const r of results) {
  const checks = [];
  const ok = existsSync(r.output);
  let pdf = { isPdf: false, pages: 0, bytes: 0 };
  if (ok) pdf = inspectPdf(r.output);

  checks.push(["file produced", ok]);
  checks.push(["valid PDF header", pdf.isPdf]);
  checks.push([`page count > 0 (=${pdf.pages})`, pdf.pages > 0]);
  checks.push(["title present", !!r.title]);
  checks.push([`SHA version present (${r.version.short})`, !!r.version.full]);
  checks.push([`effective date present (${r.effectiveDate})`, r.effectiveDate && r.effectiveDate !== "—"]);
  checks.push([`owner role present (${r.owner.role})`, !!r.owner.role && r.owner.role !== "—"]);

  const docOk = checks.every(([, v]) => v);
  if (!docOk) failures++;

  console.log(`${docOk ? "PASS" : "FAIL"}  ${relative(REPO_ROOT, r.output)}  (${pdf.pages} pages, ${(pdf.bytes / 1024).toFixed(0)} KB)`);
  for (const [label, v] of checks) {
    console.log(`        ${v ? "✓" : "✗"} ${label}`);
  }
  console.log(
    `        meta: title="${r.title}" | owner=${r.owner.name} (${r.owner.role}) | ` +
      `eff=${r.effectiveDate} [${r.effectiveDateSource}] | compliance=${r.compliance} | status=${r.status}` +
      (r.hasMermaid ? " | mermaid=yes" : ""),
  );
  console.log();
}

console.log(`[verify] ${results.length - failures}/${results.length} docs passed all checks`);
process.exit(failures ? 1 : 0);
