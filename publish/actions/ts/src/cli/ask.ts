// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * ONE READER, ALWAYS — and a hidden variant of it for a key (#213, #194).
 *
 * This exists because the same mistake was made three times in three different ways, and each
 * time the symptom was a prompt that answered itself:
 *
 *   #194  a question asked on /dev/tty while `runWorkFlow` held a readline. The empty read was
 *         taken for "yes" and recorded a repository mapping nobody had agreed to. Twice.
 *   #213  the sign-in choice read `readSync(0, …)` while the same readline was live. It
 *         returned nothing instantly, so an adopter who typed 2 was never asked for a key.
 *   #213  the fix for that opened a SECOND handle on /dev/tty. Better, and still two readers:
 *         it survived `gov work` (whose readline had never been used) and lost on the menu
 *         path (whose readline stays open across the whole loop), which is the path adopters
 *         actually take.
 *
 * The rule that removes the class: whoever owns the terminal does the asking, and everything
 * that needs to ask BORROWS that owner. Never open a second reader, however carefully.
 */
import * as readline from "node:readline";

export interface AskFns {
  /** Ask, and let the answer echo — the reader needs to see what they typed. */
  readonly line: (question: string) => Promise<string>;
  /** Ask with the echo off. A key must not reach the screen, the scrollback, or a shoulder. */
  readonly secret: (question: string) => Promise<string>;
}

/**
 * Build both from an existing readline and the `prompt` already derived from it.
 *
 * THE HIDDEN READ MUTES THE INTERFACE RATHER THAN THE TERMINAL. `stty -echo` acts on a
 * terminal device, which is the wrong object here: the question is being asked by a readline
 * whose output we control, and a process that turns the terminal's echo off owes the terminal
 * a restoration on every path — including a throw, a Ctrl-C, and a crash. Overriding what the
 * interface writes has none of that liability and needs no `finally` to be correct.
 */
export function askFns(rl: readline.Interface, prompt: (q: string) => Promise<string>): AskFns {
  return {
    line: prompt,
    secret: (question) =>
      new Promise((resolve) => {
        // `_writeToOutput` is readline's own hook for exactly this; Node's docs use it for
        // password prompts. Typed as unknown because it is not on the public interface.
        const iface = rl as unknown as { _writeToOutput?: (s: string) => void };
        const original = iface._writeToOutput;
        let muted = false;
        iface._writeToOutput = (s: string): void => {
          // The question itself must appear; everything typed after it must not.
          if (!muted && s.includes(question)) { original?.call(rl, s); muted = true; return; }
          if (!muted) { original?.call(rl, s); return; }
          // HIDDEN IS NOT THE SAME AS INVISIBLE (#218).
          //
          // Writing nothing at all was the classic password behaviour, and it is wrong for
          // the thing actually being asked for here. A password is TYPED, so the typist knows
          // they typed; an API key is PASTED, and a paste that produces no change on screen is
          // indistinguishable from a paste that did not arrive. A walk-through stalled on
          // exactly that: the key had landed, the screen said nothing, and the only way to
          // find out was to press Enter and see what happened.
          //
          // So redraw the line as one bullet per character held. The secret never reaches the
          // screen; the fact that it arrived, and how much of it, does. Length is not a
          // meaningful disclosure for a pasted credential — anyone watching the paste saw it.
          const out = (rl as unknown as { output?: NodeJS.WritableStream }).output;
          const held = (rl as unknown as { line?: string }).line?.length ?? 0;
          if (!out) return;
          try {
            readline.cursorTo(out as NodeJS.WritableStream & { columns?: number }, 0);
            readline.clearLine(out as NodeJS.WritableStream & { columns?: number }, 0);
          } catch {
            // Not a TTY (piped, or a test harness). Redrawing is meaningless there, and the
            // caller still gets the answer — so fall silent rather than corrupt the stream.
            return;
          }
          out.write(question + "•".repeat(held));
        };
        rl.question(question, (answer) => {
          iface._writeToOutput = original;
          // The typed newline was swallowed with the rest, so the next line starts on its own.
          rl.write("\n");
          resolve(answer.trim());
        });
      }),
  };
}
