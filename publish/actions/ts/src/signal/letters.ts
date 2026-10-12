// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * LETTERS ARE RETIRED (spec 03 Q9). Before `gov signal`, projects wrote `for-<project>.md` letters into their own
 * folders. Five exist; they stay as history. A new one is a `gov doctor` advisory pointing at `gov signal`.
 */
import type { Diagnostic } from "../maintain/doctor.js";

/** The letters written before signals existed (Svayamtech's gov repo), kept as history. */
export const LETTERS_KEPT_AS_HISTORY: readonly string[] = [
  "projects/PRJ-112-gov-cicd/knowledge/for-gov-infra.md",
  "projects/PRJ-113-gov-infra/knowledge/for-gov-cicd.md",
  "projects/PRJ-113-gov-infra/knowledge/for-gov-work.md",
  "projects/PRJ-115-gov-work/knowledge/for-gov-cicd.md",
  "projects/PRJ-115-gov-work/knowledge/for-gov-infra.md",
];

const LETTER = /^projects\/[^/]+\/(?:.*\/)?for-[^/]+\.md$/;

/** undefined in = not listed → no row; a new letter → warn. */
export function lettersDiagnostic(projectFiles: readonly string[] | undefined): Diagnostic | null {
  if (!projectFiles) return null;
  const fresh = projectFiles.filter((f) => LETTER.test(f) && !LETTERS_KEPT_AS_HISTORY.includes(f));
  if (!fresh.length) return null;
  return { name: "letters", status: "warn", detail: `${fresh.join(", ")} — letters between projects are retired; send it with \`gov signal ask|depends|notice\` instead` };
}
