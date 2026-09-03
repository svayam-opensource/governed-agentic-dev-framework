// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Reading a secret from a terminal, with the echo off (#200).
 *
 * `installAgent` is synchronous and runs between two `spawnSync` calls, so this does not use the
 * async readline the rest of the CLI shares — a second reader on the one terminal is how #194's
 * fork question answered itself twice. It turns the echo off, reads one line straight from fd 0,
 * and turns the echo back on in a `finally`, because a terminal left with no echo is a broken
 * terminal long after gov has exited.
 *
 * Every side effect is injected, so the one thing worth testing — that the echo is restored on
 * every path, including a throw — is testable without a tty.
 */

export interface SecretIo {
  /** the prompt, written where prompts go. */
  write(s: string): void;
  /** turn terminal echo on/off. */
  setEcho(on: boolean): void;
  /** read one line from the terminal. */
  readLine(): string;
}

/**
 * Ask, read, restore. Returns the trimmed answer — EMPTY IS A REAL ANSWER, meaning "not now",
 * and the caller owes that person a way to finish later rather than a dead end.
 *
 * The newline is written by us: with the echo off, the one the person typed never appeared, and
 * without it the next line of output lands on the prompt.
 */
export function readSecret(prompt: string, io: SecretIo): string {
  io.write(prompt);
  io.setEcho(false);
  try {
    return io.readLine().trim();
  } finally {
    io.setEcho(true);
    io.write("\n");
  }
}
