// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Move a directory to its final home. A rename cannot cross filesystems: where the OS temp dir is its own device
 * (tmpfs /tmp on Fedora/Arch, GitHub's ubuntu runners) it fails with EXDEV, so the tree is copied — dotfiles and
 * `.git` included — and the source removed. Any other failure is the caller's to report.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export interface PlaceOps { rename(from: string, to: string): void }

export function placeDir(from: string, to: string, ops: PlaceOps = { rename: fs.renameSync }): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    ops.rename(from, to);
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "EXDEV") throw e;
    fs.cpSync(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}
