import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import MarkdownIt from "markdown-it";
import anchor from "markdown-it-anchor";
import { ORG_NAME } from "./config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(resolve(__dirname, "templates/brand.css"), "utf8");

const md = new MarkdownIt({ html: true, linkify: true, typographer: true }).use(anchor, {
  permalink: false,
});

// Render ```mermaid fences into <div class="mermaid"> so the browser-side
// mermaid runtime can draw them (diagrams render if present).
const defaultFence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token.info.trim() === "mermaid") {
    return `<div class="mermaid">${md.utils.escapeHtml(token.content)}</div>`;
  }
  return defaultFence(tokens, idx, options, env, self);
};

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

function complianceBadge(c) {
  if (!c) return "";
  const cls = /^c0?1$/i.test(c) ? "c01" : /^c0?2$/i.test(c) ? "c02" : /^c0?3$/i.test(c) ? "c03" : "other";
  return `<span class="badge ${cls}">${esc(c)}</span>`;
}

/**
 * Build the full branded HTML document for one policy doc.
 * `hasMermaid` controls whether the mermaid runtime is injected.
 */
export function renderHtml(meta) {
  const bodyHtml = md.render(meta.body);
  const hasMermaid = /class="mermaid"/.test(bodyHtml);
  const v = meta.version;
  const versionDisplay = v.full
    ? `<code>${esc(v.short)}</code> <span style="color:var(--muted)">(${esc(v.full)})</span>`
    : `<code>${esc(v.short)}</code>`;

  const mermaidScript = hasMermaid
    ? `<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
       <script>mermaid.initialize({ startOnLoad: true, theme: "neutral" });</script>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(meta.title || "Policy")} — ${esc(ORG_NAME)}</title>
<style>${CSS}</style>
</head>
<body>
  <header class="cover">
    <div class="org">${esc(ORG_NAME)}</div>
    <h1 class="doctitle">${esc(meta.title || "Untitled Policy")}</h1>
    <div class="subtitle">${esc(ORG_NAME)} Policy Document — Formal / External Distribution</div>
    <dl class="meta-grid">
      <dt>Version</dt><dd>${versionDisplay}</dd>
      <dt>Effective Date</dt><dd>${esc(meta.effectiveDate)}</dd>
      <dt>Policy Owner</dt><dd>${esc(meta.owner.name)} &middot; ${esc(meta.owner.role)}</dd>
      <dt>Compliance</dt><dd>${complianceBadge(meta.compliance) || "—"}</dd>
      <dt>Status</dt><dd>${esc(meta.status || "—")}</dd>
    </dl>
  </header>
  <main class="content">
    ${bodyHtml}
  </main>
  ${mermaidScript}
</body>
</html>`;
}

/**
 * Header/footer templates for puppeteer page.pdf — give page numbers + branding
 * on every page. Puppeteer requires inline styles and its magic span classes.
 */
export function pageHeaderTemplate(meta) {
  return `<div style="font-size:7pt;color:#5a6672;width:100%;padding:0 14mm;
      display:flex;justify-content:space-between;border-bottom:0.5px solid #d7dde2;">
    <span style="font-weight:700;color:#0b3d4f;">${esc(ORG_NAME)}</span>
    <span>${esc(meta.title || "")}</span>
  </div>`;
}

export function pageFooterTemplate(meta) {
  const ver = meta.version.short || "n/a";
  return `<div style="font-size:7pt;color:#5a6672;width:100%;padding:0 14mm;
      display:flex;justify-content:space-between;border-top:0.5px solid #d7dde2;">
    <span>${esc(ORG_NAME)} &middot; Version <code>${esc(ver)}</code> &middot; Effective ${esc(meta.effectiveDate)}</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>`;
}
