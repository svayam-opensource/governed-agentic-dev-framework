// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE FRAMEWORK'S OWN README, LEFT IN AN ORG REPO BY THE TEMPLATE COPY (F22, 2026-10-07).
 *
 * An org repo created from the framework template starts with the FRAMEWORK's root README ("Governed Agentic
 * Development Framework — the source repository for the gov CLI…"). The MANIFEST's `README.md → README.md,
 * seed-once` then finds a README present and never seeds the org's ("<ORG_NAME> — governance repository…"), and
 * the engine rightly never overwrites a seed-once file. svm-geneva's repo carries it to this day.
 *
 * So the framework's README is a TEMPLATE LEFTOVER, like `publish/` and `site/` (upgrade-sync TEMPLATE_LEFTOVERS),
 * recognised the same way — by a FINGERPRINT only the framework's copy has: the sha256 of every version the framework
 * ever shipped at its root (line endings read as LF). It is replaced, once, by the org README with the org's tokens
 * filled. A README that matches none of them is the org's and is never touched (GOV-FRM-445) — not even one that
 * starts from the framework's text and changes a word. Once replaced it no longer matches, so it runs once.
 *
 * WHEN THE FRAMEWORK'S README CHANGES, its new fingerprint is added here — a test fails until it is, because a
 * template copy made after that change would otherwise keep the framework's README again.
 */
import * as crypto from "node:crypto";

/** sha256 (LF-normalised) of every root README.md the framework has shipped — `git log -- README.md`. */
export const FRAMEWORK_README_FINGERPRINTS: ReadonlySet<string> = new Set([
  "93c6e5580c092c46e899549b042f6ca30897d70d3070fc11aba7ad6b6c8bfffb",   // 5a5d9666d327
  "8e0bd6808e3ec030ea1e2eb1b5059f29c484cb6a43d2489cedfe605fe4b6aa07",   // 6ed7a665355b
  "a9ad36c7eedcb692e1299b482324ba759412d6a2c417e944a8c3803ea4133b3f",   // 9f263f748803
  "09e15b8bf88c9adf063dd4fb08aaf4d570904d32016f6277d33d5666a7542b40",   // dba868269fbf
  "f806d77174a79a61f5e8bca64da071b3ac5246667fd6a436c0101c76e9007e7e",   // 765b90b94970
  "3ec5ce2cb2a3c3fae7ae4da0421898c0279bf5d746a053cd8bfe32c8c0fa37bc",   // 835fe155c627
  "346c203b7ce206480ee132505635b6092eada44354188cd3c6a433659a529e1b",   // 28e1499edcc0
  "34ab0f4bb4ef9dad106772f41a8ed171f73eab6555a2c9975e65104f1f4689fb",   // 6f38d50bf543
  "6e4ada9d2e35317a33271daeab9d309b427c47ca57ae14757a32e13e6824af1a",   // 25773fcd67d2
  "ccfb2981ceabadd8fd8ba69f081ee2c911980afd3bad6f3e9913db4e6a5c295a",   // 775ece3ae39a
  "9ecd07ae76651d736b37b90bfb8e1de70bb31f100f021b2e35df8c7b93404db4",   // a6bbfa381566
  "84b8596d585fe8cfb5e1b2d69d8bbed529e552fc74ddd6692f23e21d5245cbf4",   // c78f34d16d22
  "59a8abf640bbaf0b18b2ca01f2d6a6d8a9a5030d63b242c2086030b2bc1c8514",   // 1398cd57864f
  "cd072548a00fc6368f82f98e6f1650bd00abfb18750db14cb1eb58db24d6624a",   // 4b313de55e2c
  "b6928e05726e3f37f1041bad10db3aad4ef7d4336daef4f3d306098d1d23c70b",   // 6335ce1bfca7
]);

export const readmeFingerprint = (text: string): string => crypto.createHash("sha256").update(text.replace(/\r\n/g, "\n"), "utf8").digest("hex");

/** Is this README the framework's own, byte for byte (some version the framework shipped)? */
export const isFrameworkReadme = (text: string): boolean => FRAMEWORK_README_FINGERPRINTS.has(readmeFingerprint(text));

/**
 * The org's README in place of a recognised framework README: `orgReadme` (the content's README.md) with the tokens
 * `fill` resolves. null when there is nothing to replace — no README, or one the org wrote.
 */
export function settleFrameworkReadme(readme: string | null, orgReadme: string | null, fill: (text: string) => string): string | null {
  if (readme === null || orgReadme === null || !isFrameworkReadme(readme)) return null;
  return fill(orgReadme);
}
