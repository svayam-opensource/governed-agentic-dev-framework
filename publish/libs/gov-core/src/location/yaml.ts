// SPDX-License-Identifier: MIT
/**
 * The two file-shaped primitives `org-config.yaml` needs, and nothing more.
 *
 * A top-level scalar reader rather than a YAML parser: `org-config.yaml` is a flat key/value file, every
 * client must read it identically, and a dependency-free reader is what lets `gov-core` stay a package an
 * adopter can install without pulling a parser in behind it.
 */
import * as os from "node:os";
import * as path from "node:path";

/** `~` / `~/x` → the user's home. Left alone otherwise — an absolute or relative path is already usable. */
export function expandTilde(p: string, home: string = os.homedir()): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return path.join(home, p.slice(2));
  return p;
}

/** Strip quotes and any inline `#` comment from a scalar, so `"a" # note` and `a` read the same. */
function cleanScalar(value: string): string {
  let v = value.trim();
  if (v.startsWith('"')) {
    const end = v.indexOf('"', 1);
    return end >= 0 ? v.slice(1, end) : v.slice(1);
  }
  if (v.startsWith("'")) {
    const end = v.indexOf("'", 1);
    return end >= 0 ? v.slice(1, end) : v.slice(1);
  }
  const hash = v.indexOf(" #"); // inline comment on an unquoted scalar
  if (hash >= 0) v = v.slice(0, hash);
  return v.trim();
}

/**
 * Read one TOP-LEVEL key. Indented lines are skipped deliberately: a nested `org_name:` under some other
 * block is a different key, and reading it would silently answer with the wrong value.
 */
export function readTopLevelScalar(text: string, key: string): string | null {
  const re = new RegExp(`^${key}\\s*:\\s*(.*)$`);
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (/^\s/.test(line)) continue; // indented → not a top-level key
    const m = line.match(re);
    if (!m) continue;
    return cleanScalar(m[1]);
  }
  return null;
}
