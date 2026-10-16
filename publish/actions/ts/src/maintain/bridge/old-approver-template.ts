// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
// bridge: deleted in D01 (PRJ-121 intent 01, spec §4.1)
/**
 * Where a 1.x workspace holds the approver-check template it installed from, before the upgrade that moves it to
 * framework/build/templates/ (B07, ruling Q9): the re-render compares the installed copy with THIS file to tell gov's
 * bytes from a person's edit. 2.0.0 reads only the phase-tree path.
 */
export const OLD_APPROVER_TEMPLATE = "framework/templates/workflows/approver-check.yml";
