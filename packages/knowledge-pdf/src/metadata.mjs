import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import matter from "gray-matter";
import { ROLES_DOC, POLICIES_GIT_ROOT } from "./config.mjs";

/**
 * Convert an owner front-matter slug (e.g. "policy-owner") to the role title
 * heading used in roles.md (e.g. "Policy Owner").
 */
/** Normalise a YAML date (Date object or string) to a YYYY-MM-DD string. */
function toIsoDate(v) {
  if (!v) return null;
  if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return s || null;
}

function slugToRoleTitle(slug) {
  return String(slug)
    .split("-")
    .map((w) => (w.toLowerCase() === "cicd" ? "CI/CD" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * Parse roles.md into a map: roleTitle -> { holder, role }.
 * Each role is a `## <Role Title>` section with a "Current Holder" table row.
 */
export function loadRoleRegistry() {
  let text;
  try {
    text = readFileSync(ROLES_DOC, "utf8");
  } catch {
    return {};
  }
  const body = matter(text).content;
  const registry = {};
  // Split on level-2 headings.
  const sections = body.split(/^##\s+/m).slice(1);
  for (const sec of sections) {
    const titleLine = sec.split("\n", 1)[0].trim();
    if (!titleLine) continue;
    // "Current Holder | <value>"
    const holderMatch = sec.match(/Current Holder\s*\|\s*([^|\n]+?)\s*(?:\||\n)/i);
    const holder = holderMatch ? holderMatch[1].trim() : null;
    registry[titleLine] = { role: titleLine, holder };
  }
  return registry;
}

/**
 * Resolve the policy owner's display name + role from the owner slug.
 * Falls back gracefully if the role/holder is not found.
 */
export function resolveOwner(ownerSlug, registry) {
  if (!ownerSlug) return { name: "Unassigned", role: "—", slug: null };
  const roleTitle = slugToRoleTitle(ownerSlug);
  const entry = registry[roleTitle];
  if (!entry) {
    return { name: "Unassigned", role: roleTitle, slug: ownerSlug };
  }
  // Holder may be a placeholder token like <POLICY_OWNER_EMAIL> or "TBD (… acting)".
  const name = entry.holder && entry.holder !== "TBD" ? entry.holder : "Unassigned";
  return { name, role: roleTitle, slug: ownerSlug };
}

/**
 * Git commit SHA (full + short) and ISO date of the commit that last touched
 * the source file. This is the document Version per the publication spec.
 */
export function gitVersion(absSourcePath) {
  const rel = relative(POLICIES_GIT_ROOT, absSourcePath);
  try {
    const out = execFileSync(
      "git",
      ["log", "-1", "--format=%H%x1f%h%x1f%cI", "--", rel],
      { cwd: POLICIES_GIT_ROOT, encoding: "utf8" },
    ).trim();
    if (!out) return { full: null, short: "uncommitted", date: null };
    const [full, short, date] = out.split("\x1f");
    return { full, short, date };
  } catch {
    return { full: null, short: "unknown", date: null };
  }
}

/**
 * Assemble the full metadata block for one policy doc.
 */
export function buildMetadata(absSourcePath, rawText, registry) {
  const fm = matter(rawText).data || {};
  const owner = resolveOwner(fm.owner, registry);
  const version = gitVersion(absSourcePath);

  // Title: first H1 in the body, else front-matter title, else file stem.
  const body = matter(rawText).content;
  const h1 = body.match(/^#\s+(.+)$/m);
  const title = (h1 && h1[1].trim()) || fm.title || null;

  // Effective date: front-matter effective_date, then policy_effective_date fallback,
  // then the commit date of the source as a last resort (so the field is never blank).
  // gray-matter parses unquoted YAML dates into JS Date objects — normalise to YYYY-MM-DD.
  const effectiveDate =
    toIsoDate(fm.effective_date) ||
    toIsoDate(fm.policy_effective_date) ||
    version.date?.slice(0, 10) ||
    "—";
  const effectiveDateSource = fm.effective_date
    ? "front-matter:effective_date"
    : fm.policy_effective_date
      ? "front-matter:policy_effective_date"
      : version.date
        ? "git-commit-date (fallback)"
        : "none";

  return {
    title,
    version, // { full, short, date }
    effectiveDate,
    effectiveDateSource,
    owner, // { name, role, slug }
    compliance: fm.compliance ?? null,
    status: fm.status ?? null,
    frontmatter: fm,
    body,
  };
}
