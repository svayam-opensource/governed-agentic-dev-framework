// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * THE `command` PROVIDER — any CLI the org approved, as a pipe (P3 wave 2).
 *
 * `models.command` in `policies/governance.yaml` names a program and its arguments (`claude -p`, `llm -m …`).
 * gov writes the whole request to its stdin as plain text — the instructions, then the section — and reads the
 * reply from its stdout. It is run through the run-process chokepoint, so the run is logged; stdout never is.
 *
 * The command is split on whitespace, with single or double quotes grouping. No shell: `$VAR`, pipes and
 * redirections are passed through as literal text.
 */
import type { ModelPort, ModelRequest } from "../model-port.js";
import { ModelProviderError } from "./anthropic.js";

/** Run `cmd args` with `input` on stdin and return stdout; throws when the program fails. */
export type RunWithInput = (cmd: string, args: readonly string[], input: string) => string;

export function splitCommand(s: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.push(m[1] ?? m[2] ?? m[3]!);
  return out;
}

/** The request as one prompt: the CLI has no separate system channel. */
export const commandPrompt = (req: ModelRequest): string => `${req.system}\n\n---\n\n${req.user}\n`;

export function commandModel(o: { readonly command: string; readonly run: RunWithInput }): ModelPort {
  const [cmd, ...args] = splitCommand(o.command);
  return {
    async complete(req) {
      if (!cmd) throw new ModelProviderError("models.command is empty, so there is no program to run");
      let out: string;
      try {
        out = o.run(cmd, args, commandPrompt(req));
      } catch (e) {
        throw new ModelProviderError(`\`${cmd}\` failed: ${(e as Error)?.message?.split("\n")[0] ?? String(e)}`);
      }
      if (!out.trim()) throw new ModelProviderError(`\`${cmd}\` wrote nothing on stdout`);
      return out;
    },
  };
}
