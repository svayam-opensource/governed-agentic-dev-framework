// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// bridge: deleted in D01 (PRJ-121 intent 01, spec §4.1)
/**
 * THE BRIDGE — every migration to the 2.0 layout, in one pre-release, deleted by the next (spec 01 §4.1, Q1).
 *
 * `gov upgrade` runs it as an UpgradeExtension: its planned actions are shown by a dry run and applied in their commit
 * of the upgrade PR; its proposals are commit 4. On a repository it does not recognise it does nothing.
 */
import type { UpgradeExtension } from "../upgrade-commits.js";

export const BRIDGE: UpgradeExtension = {};
