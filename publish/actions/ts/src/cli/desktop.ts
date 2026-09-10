// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
/**
 * Does this machine plausibly have a desktop? (#221)
 *
 * ADVISORY, AND THE RETURN TYPE SAYS SO. There is no boolean here, because a boolean invites a
 * caller to branch on it and withhold something. `DesktopHint` carries a verdict AND the reason,
 * and the only sanctioned use is to ORDER and ANNOTATE what is offered.
 *
 * ## Why it is advisory, and why that is not timidity
 *
 * `src/cli/main.ts` records the ruling this narrows:
 *
 *   "AND GOV DOES NOT TRY TO DETECT IT. Every heuristic — $DISPLAY, xdg-open, $SSH_CONNECTION
 *    — is wrong on some real machine, and being wrong here means silently withholding the only
 *    way through."
 *
 * That was written after a container walk where IBM Bob printed a `callback_uri` on the
 * container's loopback and waited for a browser that was on the host. It still stands for
 * SIGN-IN, and this module must never be used there.
 *
 * What differs for INSTALL OFFERS is the cost of being wrong. A wrong guess about a browser
 * removes the only route to authenticate; a wrong guess about a desktop mis-orders a menu, and
 * the guided-install loop that follows re-probes and corrects itself. So the heuristic is
 * allowed to be wrong here in a way it is not allowed to be wrong there.
 *
 * The case that decides the design is X11 forwarding: `$DISPLAY` is set, the machine is
 * GUI-capable, and the display is somewhere else entirely. Someone in that position must still
 * be OFFERED the editor route — annotated, not removed — because they are the one person who
 * knows whether it will work.
 */

export interface DesktopHint {
  /**
   * `yes` — a desktop session is almost certainly present.
   * `no`  — nothing suggests one.
   * `remote` — GUI-capable, but the display is not local (X11 over SSH). Offer it and say so.
   */
  readonly verdict: "yes" | "no" | "remote";
  /** What led to the verdict, for the annotation. Never a bare boolean's worth of nothing. */
  readonly because: string;
}

/**
 * Read the environment, not the machine.
 *
 * PURE, with both inputs injected, so every branch is decidable in a test — which matters more
 * here than usual: the whole reason the old ruling refused detection is that every heuristic is
 * wrong somewhere, and the only defence against that is being able to state each case.
 */
export function desktopHint(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): DesktopHint {
  // macOS and Windows have a window server whenever a user is logged in. A headless CI runner
  // on either is possible, and being wrong there costs an annotation.
  if (platform === "darwin") return { verdict: "yes", because: "macOS" };
  if (platform === "win32") return { verdict: "yes", because: "Windows" };

  const display = env["DISPLAY"] ?? "";
  const wayland = env["WAYLAND_DISPLAY"] ?? "";
  const remote = Boolean(env["SSH_CONNECTION"] ?? env["SSH_TTY"]);

  if (wayland) return { verdict: remote ? "remote" : "yes", because: `WAYLAND_DISPLAY=${wayland}` };
  if (display) {
    // X11 FORWARDING IS THE CASE THAT MATTERS. `$DISPLAY` plus an SSH session is a real desktop
    // on someone else's screen — usable, often slow, and absolutely not gov's call to refuse.
    return remote
      ? { verdict: "remote", because: `DISPLAY=${display} over SSH — X11 forwarding, or a display that is not local` }
      : { verdict: "yes", because: `DISPLAY=${display}` };
  }
  if (remote) return { verdict: "no", because: "an SSH session with no DISPLAY" };
  return { verdict: "no", because: "no DISPLAY or WAYLAND_DISPLAY" };
}

/**
 * The line that goes beside an editor route when gov has doubts.
 *
 * Null when there is nothing worth saying — a desktop was detected, so the route needs no
 * caveat and adding one would be noise.
 */
export function desktopCaveat(hint: DesktopHint): string | null {
  if (hint.verdict === "yes") return null;
  return hint.verdict === "remote"
    ? `this looks like a remote display (${hint.because}) — an editor will open on the machine holding it`
    : `gov did not detect a desktop here (${hint.because}) — an editor may have nowhere to open`;
}

/**
 * Should CLI routes be listed before editor routes?
 *
 * ORDERING IS THE WHOLE PERMITTED USE. Nothing is dropped: an adopter on a machine gov thinks
 * is headless still sees every route, in an order that puts the one likely to work first.
 */
export const preferCli = (hint: DesktopHint): boolean => hint.verdict !== "yes";
