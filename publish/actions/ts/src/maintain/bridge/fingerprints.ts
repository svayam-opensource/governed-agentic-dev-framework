// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// bridge: deleted in D01 (PRJ-121 intent 01, spec §4.1)
/**
 * THE OLD WORLD'S FRAMEWORK FILES, BY FINGERPRINT (PRJ-121 intent 01, spec §4.2 commit 1; ruling Q3).
 *
 * A layout-1.0 repository (Svayamtech's) carries the framework's files where 1.0 put them: the agent harness copied to
 * the root, the session-start hooks, the templates under knowledge/. 2.0 ships its own copies under framework/ and
 * agent/harness/, so the old ones are retired — but ONLY a file whose bytes are exactly the framework's. A file at
 * the same path with any other body is the organization's: it is kept and listed in the PR body (Q3).
 *
 * A fingerprint is the path and the sha256 of the framework body at that path, as Svayamtech's repository held it
 * (svm-prj-work@9b153366, 2026-10-12). Only the hashes are kept here, never the text. The hook set is one unit: the
 * hooks, and the settings that wire them (`.claude/settings.json`, `.cursor/hooks.json`, the gate rule), go together,
 * or every session would call a script that is gone.
 *
 * The exception TEMPLATE.md files are the framework's too (2.0 has one framework/common/templates/exception-template.md);
 * they are retired beside the org's exception records, which move in commit 2.
 */
import { createHash } from "node:crypto";

export interface Fingerprint {
  readonly path: string;
  readonly sha256: string;
  /** The upgrade-PR commit its retirement lands in. */
  readonly commit: "framework" | "org-moves";
}

export const FINGERPRINTS: readonly Fingerprint[] = [
  { path: "AGENTS.md", sha256: "20397ccc1f19eb63faafb23e1707eb023ef3d33fca697983178a0e3ec790c8ff", commit: "framework" },
  { path: "CLAUDE.md", sha256: "abcc3962226d8edeba1946050be3be6434cfb3adf79b5d9507f1f5a2c6d1b54c", commit: "framework" },
  { path: "CONVENTIONS.md", sha256: "20397ccc1f19eb63faafb23e1707eb023ef3d33fca697983178a0e3ec790c8ff", commit: "framework" },
  { path: "agent.md", sha256: "7af617516652d9215c6db8c2eba01faf38327381a74ee5253926fad4d1902ec6", commit: "framework" },
  { path: ".clinerules/agent.md", sha256: "20397ccc1f19eb63faafb23e1707eb023ef3d33fca697983178a0e3ec790c8ff", commit: "framework" },
  { path: ".continue/rules.md", sha256: "20397ccc1f19eb63faafb23e1707eb023ef3d33fca697983178a0e3ec790c8ff", commit: "framework" },
  { path: ".cursor/rules/agent.mdc", sha256: "ee6eb6c0b046bd3e62c52de986fe762cc79da079df1699cbf846f0f1fe6b6c30", commit: "framework" },
  { path: ".cursor/rules/session-start-gate.mdc", sha256: "679ec4058be1c37c17dcb111a024fb29b8c3cee31a4e2982b601d0b3cc0b1f80", commit: "framework" },
  { path: ".windsurf/rules/agent.md", sha256: "20397ccc1f19eb63faafb23e1707eb023ef3d33fca697983178a0e3ec790c8ff", commit: "framework" },
  { path: ".github/copilot-instructions.md", sha256: "20397ccc1f19eb63faafb23e1707eb023ef3d33fca697983178a0e3ec790c8ff", commit: "framework" },
  { path: ".gemini/styleguide.md", sha256: "20397ccc1f19eb63faafb23e1707eb023ef3d33fca697983178a0e3ec790c8ff", commit: "framework" },
  { path: ".claude/hooks/pre-tool-gate.sh", sha256: "189c5ac4bcca5d2bb893b8064f12f20812bc159d2e05267b36a956b2851041fd", commit: "framework" },
  { path: ".claude/hooks/session-ack.sh", sha256: "25066c910ea16bf2d78b6e777d3ed34ac6f3cca17af5cdd38201dd4cf0cc5835", commit: "framework" },
  { path: ".claude/hooks/session-start.sh", sha256: "29dc1473e759e8e93f5e1955c5d3d0ac08e77ce49256838a57f92652fdd91afb", commit: "framework" },
  { path: ".claude/settings.json", sha256: "98dadbab4aa37602d0158e033a7abd0f989036b775c359f39f01a7e653152c40", commit: "framework" },
  { path: ".claude/commands/session-start.md", sha256: "0e94ebb5a148c25fa911e2e9e5ecf1cf5945c6e011040d02e1462326ec6c0cb4", commit: "framework" },
  { path: ".cursor/hooks.json", sha256: "8423f4f6bd239b6e97aea534a0f17e9708583e93254e54fb18cebe7d68379779", commit: "framework" },
  { path: ".cursor/hooks/session-ack.sh", sha256: "3571d26ec3fb626037c08e9331f7e43c0260624526698b19658b1799f6f90aa3", commit: "framework" },
  { path: ".cursor/hooks/session-gate.sh", sha256: "2c2f31aa8978d88ab114efef59e274aeaa80635f59035e14212792dfdab34803", commit: "framework" },
  { path: ".cursor/hooks/session-start.sh", sha256: "bd2a91302d4f41399b4afa45e9e0db4722568f2644b075d6ca91acbadfed9d88", commit: "framework" },
  { path: "knowledge/guidance/compliance-template.md", sha256: "e63ed8b5810a546b03c7fd8e4eb2ff40e57c357fc17cb4b12ab8069e7e682c00", commit: "framework" },
  { path: "knowledge/guidance/preferences-template.md", sha256: "7e380c1675573cd22ffa5422b0e83cabcfdb8bcf7ad2804f9d3d547ee5849e7d", commit: "framework" },
  { path: "knowledge/guidance/project-impact-template.md", sha256: "876dcb215fad261b52b1075e951b384bc7b10d632e34c310738bea4424f996fb", commit: "framework" },
  { path: "knowledge/guidance/repo-agent-template.md", sha256: "0fc0620e5c5cd66941e95213331e25c5b9266d26bf3c2369e2737f617862b14d", commit: "framework" },
  { path: "knowledge/guidance/todo-template.md", sha256: "58dcb20d897f9cade797576b8aec820034276936c7e78440efe462baa49442ce", commit: "framework" },
  { path: "knowledge/policies/procedures/templates/compliance-template.md", sha256: "68adc6408981d45495ee1f2a92ac63248e19705c2251979d219b7fc5126749e1", commit: "framework" },
  { path: "knowledge/policies/procedures/templates/preferences-template.md", sha256: "96c51228729b01e8db359959b98ac8a43ae363fd93c933da4db4d142c186e06a", commit: "framework" },
  { path: "knowledge/policies/procedures/templates/project-impact-template.md", sha256: "1021e15052844944e6ba3eb72c6160a636ab6e50aa1b7d81e0f9cbf065e782aa", commit: "framework" },
  { path: "knowledge/policies/procedures/templates/repo-agent-template.md", sha256: "0ce88479f69acba8d66816367589596c8a9ceee7a4486d03801795ec735f7bcf", commit: "framework" },
  { path: "knowledge/policies/procedures/templates/todo-template.md", sha256: "c77f50aa7dc95d8de6faed19689167ca10dbd27a9c971a3ae70d8d0bd34cc045", commit: "framework" },
  { path: "knowledge/policies/exceptions/architecture/TEMPLATE.md", sha256: "6152e4c5d9ac00a4cb26e6f42e94a2c0e8b2405ef2bce2f3f77badfdc3767b2a", commit: "org-moves" },
  { path: "knowledge/policies/exceptions/infrastructure/TEMPLATE.md", sha256: "cbbb3e313d5cbc68dd47c9115e3858205860d9f0ca57ca339d156aaca858f67c", commit: "org-moves" },
  { path: "knowledge/policies/exceptions/legal/TEMPLATE.md", sha256: "e1f9c07c8eb74bd5d2894a7983a5a6618bf90352c62302115afab1aaaaf7a6a1", commit: "org-moves" },
  { path: "knowledge/policies/exceptions/policy/TEMPLATE.md", sha256: "f7b76ca6f9c09d3b6ad66a5d13cbb41573afa0255d884fb3ddc03c3b323aa245", commit: "org-moves" },
];

/** The body's sha256, line endings normalised (a Windows checkout of the same bytes is the same file). */
export const sha256 = (text: string): string => createHash("sha256").update(text.replace(/\r\n/g, "\n")).digest("hex");

/** What the fingerprints say about a repository: the framework's files to retire, and same-named files that are not. */
export interface FingerprintMatch {
  readonly retire: readonly Fingerprint[];
  /** At a fingerprinted path, but with another body — the org's, kept. */
  readonly changed: readonly string[];
}

/** `read(path)` is the file's text, or null when absent. */
export function matchFingerprints(read: (rel: string) => string | null): FingerprintMatch {
  const retire: Fingerprint[] = [];
  const changed: string[] = [];
  for (const f of FINGERPRINTS) {
    const text = read(f.path);
    if (text === null) continue;
    if (sha256(text) === f.sha256) retire.push(f);
    else changed.push(f.path);
  }
  return { retire, changed };
}
