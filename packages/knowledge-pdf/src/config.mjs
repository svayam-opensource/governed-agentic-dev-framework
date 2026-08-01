import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Workspace root: packages/tools/knowledge-pdf -> up 4 = monorepo root (911-SVM-LIB-SVC)
export const REPO_ROOT = resolve(__dirname, "../../../..");

// READ-ONLY source-of-truth policies dir (sibling svm-prj-work checkout). Never edited.
export const POLICIES_DIR = resolve(
  REPO_ROOT,
  "../svm-prj-work/knowledge/policies",
);

// The git repo that the policy docs live in (for `git log` SHA lookup of the source path).
export const POLICIES_GIT_ROOT = resolve(REPO_ROOT, "../svm-prj-work");

export const ROLES_DOC = resolve(POLICIES_DIR, "roles.md");

// Generated output (git-ignored via root .gitignore `dist`). Track A site links here.
export const OUTPUT_DIR = resolve(REPO_ROOT, "dist/pdf");

// Org branding.
export const ORG_NAME = "Svayam";

// One PDF per top-level policy doc in knowledge/policies/ (the *.md files directly in
// policies/, NOT per-subfolder docs). Discovered at runtime, but this is the canonical
// scope for reference / fallback.
export const FORM2_DOC_GLOB = "*.md";
