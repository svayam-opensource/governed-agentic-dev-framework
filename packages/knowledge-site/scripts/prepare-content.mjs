#!/usr/bin/env node
// prepare-content.mjs — build-time content materialisation for @svayam/knowledge-site
//
// POL-402 / C01: the site is a pure GENERATED FACE over the single source of
// truth. Content is NEVER committed and NEVER edited. This script (re)creates the
// site's `content/` directory as a build-time symlink (default) or rsync mirror
// of the org knowledge tree, immediately before `quartz build`.
//
// Sources (in order):
//   1. <SVM_PRJ_WORK>/knowledge                      (the org SoT, 164 docs)
//   2. <SVM_PRJ_WORK>/projects/* / knowledge         (optional, --with-projects)
//
// Config (env, all optional — defaults target this project's checkout):
//   SVM_PRJ_WORK   absolute path to the svm-prj-work governance/content repo
//   CONTENT_MODE   "symlink" (default) | "rsync"
//
// Usage:
//   node scripts/prepare-content.mjs                 # symlink org knowledge/
//   CONTENT_MODE=rsync node scripts/prepare-content.mjs
//   node scripts/prepare-content.mjs --with-projects # also mirror projects/*/knowledge
//
// SAFETY: only ever writes inside this workspace's `content/`. Never touches the
// source tree.

import { existsSync, lstatSync, rmSync, mkdirSync, symlinkSync, cpSync, readdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITE_ROOT = resolve(__dirname, "..");

// Default svm-prj-work location: sibling-of-sibling of the monorepo.
// 911-SVM-LIB-SVC/packages/tools/knowledge-site -> up 4 -> PRJ-010 dir -> /svm-prj-work
const DEFAULT_PRJ_WORK = resolve(SITE_ROOT, "../../../../svm-prj-work");
const PRJ_WORK = resolve(process.env.SVM_PRJ_WORK || DEFAULT_PRJ_WORK);
const MODE = (process.env.CONTENT_MODE || "symlink").toLowerCase();
const WITH_PROJECTS = process.argv.includes("--with-projects");

const ORG_KNOWLEDGE = join(PRJ_WORK, "knowledge");
const CONTENT = join(SITE_ROOT, "content");

function die(msg) {
  console.error(`[prepare-content] ERROR: ${msg}`);
  process.exit(1);
}

if (!existsSync(ORG_KNOWLEDGE)) {
  die(`org knowledge tree not found at ${ORG_KNOWLEDGE}\n` +
      `  set SVM_PRJ_WORK to the absolute path of the svm-prj-work checkout.`);
}

// Always start clean so a stale symlink/copy never lingers.
if (existsSync(CONTENT) || isSymlink(CONTENT)) {
  rmSync(CONTENT, { recursive: true, force: true });
}

function isSymlink(p) {
  try { return lstatSync(p).isSymbolicLink(); } catch { return false; }
}

if (MODE === "symlink" && !WITH_PROJECTS) {
  // Simplest, zero-copy: content/ IS the org knowledge tree.
  symlinkSync(ORG_KNOWLEDGE, CONTENT, "dir");
  console.log(`[prepare-content] symlinked ${CONTENT} -> ${ORG_KNOWLEDGE}`);
} else {
  // rsync mode, or symlink+projects (multiple sources => materialise a dir of symlinks/copies).
  mkdirSync(CONTENT, { recursive: true });
  const sources = [["", ORG_KNOWLEDGE]];

  if (WITH_PROJECTS) {
    const projectsDir = join(PRJ_WORK, "projects");
    if (existsSync(projectsDir)) {
      for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const pk = join(projectsDir, entry.name, "knowledge");
        if (existsSync(pk)) sources.push([`projects/${entry.name}`, pk]);
      }
    }
  }

  for (const [rel, src] of sources) {
    const dest = rel ? join(CONTENT, rel) : CONTENT;
    if (rel) mkdirSync(dirname(dest), { recursive: true });
    if (MODE === "rsync") {
      // CI mode: a real mirror (no symlink), so the build is hermetic.
      mkdirSync(dest, { recursive: true });
      execFileSync("rsync", ["-a", "--delete", `${src}/`, `${dest}/`], { stdio: "inherit" });
      console.log(`[prepare-content] rsynced ${src} -> ${dest}`);
    } else {
      // symlink + projects: link each source into its slot.
      symlinkSync(src, dest, "dir");
      console.log(`[prepare-content] symlinked ${dest} -> ${src}`);
    }
  }
}

// Sanity: the home page (knowledge/README.md) must be reachable.
if (!existsSync(join(CONTENT, "README.md"))) {
  die(`content/README.md not found after prepare — site home would be missing.`);
}
console.log(`[prepare-content] content ready (mode=${MODE}, with-projects=${WITH_PROJECTS}).`);
