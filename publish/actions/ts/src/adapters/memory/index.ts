// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE `memory` ADAPTERS — the reference implementation of each port, held in process (PRJ-121 intent 03, D7).
 *
 * One file per port beside this one (`work-tracker.ts`, `vcs.ts`, `ci-identity.ts`), each registered in
 * `../registry.ts` under the id below. They are what unit tests and each port's conformance suite run against;
 * the same suite runs against the GitHub adapter in the live tier, so the two cannot drift.
 *
 * Tests only: an organization cannot select `memory` in org-config.yaml — a tracker that forgets everything when
 * the process exits would be the silent no-op the ports exist to end.
 */
export const MEMORY_ADAPTER_ID = "memory";
