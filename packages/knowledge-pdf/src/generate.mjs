import { readFileSync, readdirSync, mkdirSync, statSync } from "node:fs";
import { resolve, basename } from "node:path";
import puppeteer from "puppeteer";
import { POLICIES_DIR, OUTPUT_DIR } from "./config.mjs";
import { loadRoleRegistry, buildMetadata } from "./metadata.mjs";
import { renderHtml, pageHeaderTemplate, pageFooterTemplate } from "./render.mjs";

/** Discover the top-level *.md docs directly in knowledge/policies/ (no recursion). */
export function discoverPolicyDocs() {
  return readdirSync(POLICIES_DIR)
    .filter((f) => f.endsWith(".md"))
    .filter((f) => statSync(resolve(POLICIES_DIR, f)).isFile())
    .sort()
    .map((f) => resolve(POLICIES_DIR, f));
}

/**
 * Generate one branded PDF per top-level policy doc.
 * Returns an array of per-doc result records.
 */
export async function generateAll({ docs } = {}) {
  const sources = docs && docs.length ? docs : discoverPolicyDocs();
  const registry = loadRoleRegistry();
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const results = [];
  try {
    for (const src of sources) {
      const stem = basename(src, ".md");
      const outPath = resolve(OUTPUT_DIR, `${stem}.pdf`);
      const raw = readFileSync(src, "utf8");
      const meta = buildMetadata(src, raw, registry);
      const html = renderHtml(meta);
      const hasMermaid = /class="mermaid"/.test(html);

      const page = await browser.newPage();
      await page.setContent(html, {
        waitUntil: hasMermaid ? "networkidle0" : "load",
      });
      if (hasMermaid) {
        // give the mermaid runtime a moment to render diagrams
        await new Promise((r) => setTimeout(r, 800));
      }
      await page.pdf({
        path: outPath,
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: pageHeaderTemplate(meta),
        footerTemplate: pageFooterTemplate(meta),
        margin: { top: "22mm", bottom: "20mm", left: "16mm", right: "16mm" },
      });
      await page.close();

      results.push({
        source: src,
        output: outPath,
        title: meta.title,
        version: meta.version,
        effectiveDate: meta.effectiveDate,
        effectiveDateSource: meta.effectiveDateSource,
        owner: meta.owner,
        compliance: meta.compliance,
        status: meta.status,
        hasMermaid,
      });
    }
  } finally {
    await browser.close();
  }
  return results;
}
