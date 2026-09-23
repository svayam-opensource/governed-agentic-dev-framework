// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * READING AND WRITING a person's preferences file — the disk half of preferences.ts.
 *
 * Created with the defaults the first time gov needs it and announced once (never silently: a file that appears
 * in someone's tree without a word is a file they cannot trust). Missing is not an error — it is the state of
 * every org set up before this existed, and of every org until its first `gov` run.
 */
import * as fsSync from "node:fs";
import * as path from "node:path";
import { log } from "../log.js";
import { preferencesFile } from "../state-paths.js";
import { parsePreferences, renderPreferences, starterPreferences, type PrefValue, type Preferences } from "../preferences.js";
import { ensureLogin, runContext } from "./run-context.js";

export interface PreferencesFile {
  /** Where it is (or would be). Empty when gov does not yet know whose preferences these are. */
  readonly file: string;
  readonly prefs: Preferences;
}

/** The file for this run's person, or "" when the org or the login is not known yet. */
export function preferencesPath(cwd: string = process.cwd()): string {
  const ctx = runContext(cwd);
  // A command that is ABOUT the person's folder may pay for the answer once; the log never does (see ensureLogin).
  const login = ensureLogin(ctx);
  return ctx.workRoot && login ? preferencesFile(ctx.workRoot, login) : "";
}

/**
 * Load them, creating the file with the defaults if it is missing. `announce` is called ONCE, with the path,
 * when the file is created — the caller decides where that line goes (stderr for a command, the manifest for a
 * first run). Never throws: an unwritable folder means gov uses the defaults and says so in the log.
 */
export function loadPreferences(announce?: (file: string) => void, cwd: string = process.cwd()): PreferencesFile {
  const file = preferencesPath(cwd);
  if (!file) return { file: "", prefs: parsePreferences(null) };
  let text: string | null = null;
  try {
    text = fsSync.readFileSync(file, "utf8");
  } catch {
    /* not there yet — create it below, which is the ordinary first run for an org */
    try {
      fsSync.mkdirSync(path.dirname(file), { recursive: true });
      fsSync.writeFileSync(file, starterPreferences(), { mode: 0o644 });
      text = starterPreferences();
      log("info", "created a preferences file", "gov-work:cli:preferences-io", "loadPreferences", { file });
      announce?.(file);
    } catch (e) {
      log("warn", "could not create the preferences file — using defaults", "gov-work:cli:preferences-io", "loadPreferences", { file, message: (e as Error)?.message });
    }
  }
  const prefs = parsePreferences(text);
  for (const p of prefs.problems) log("warn", "preferences problem", "gov-work:cli:preferences-io", "loadPreferences", { file, problem: p });
  return { file, prefs };
}

/** Write one value (or remove it, with `null` for a setting whose default is not null). Returns the new state. */
export function savePreference(file: string, prefs: Preferences, key: string, value: PrefValue | undefined): Preferences {
  const values = new Map(prefs.values);
  if (value === undefined) values.delete(key); else values.set(key, value);
  fsSync.mkdirSync(path.dirname(file), { recursive: true });
  fsSync.writeFileSync(file, renderPreferences(values), { mode: 0o644 });
  log("info", value === undefined ? "reset a preference" : "set a preference", "gov-work:cli:preferences-io", "savePreference", { file, key, value: value ?? null });
  return { values, problems: prefs.problems };
}
