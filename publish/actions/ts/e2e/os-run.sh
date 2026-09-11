#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# Runs as the TESTER inside the image. Same drop-in shape as journey.sh: every fragment in
# os.d/ gets the helpers below and a machine that starts bare.
set -uo pipefail
HERE=/src/publish/actions/ts/e2e
FILTER="${OS_TIER_FRAGMENT:-}"

BOLD=$'\033[1m'; CYA=$'\033[36m'; GRN=$'\033[32m'; RED=$'\033[31m'; DIM=$'\033[2m'; RST=$'\033[0m'
PASS=0; FAIL=0
scenario(){ printf '\n%s%s%s\n\n' "$BOLD" "$1" "$RST"; }
pass(){ printf '  %s✓%s %s\n' "$GRN" "$RST" "$*"; PASS=$((PASS+1)); }
fail(){ printf '  %s✗%s %s\n' "$RED" "$RST" "$*"; FAIL=$((FAIL+1)); }
info(){ printf '  %s→%s %s\n' "$CYA" "$RST" "$*"; }

TRANSCRIPT=/work/transcript.txt
PLAIN=/work/plain.txt
FLAT=/work/flat.txt

# Run something in a pty, answering from a conversation — the same driver journey.sh uses.
drive() {
  local conv="$1"; shift
  : > "$TRANSCRIPT"
  expect "$HERE/pty/drive.exp" "$TRANSCRIPT" "$conv" -- "$@" >/dev/null 2>/work/drive.err
  local rc=$?
  perl -pe 's/\e\[[0-9;]*[a-zA-Z]//g; s/\r//g' "$TRANSCRIPT" > "$PLAIN" 2>/dev/null \
    || sed -e 's/\x1b\[[0-9;]*[a-zA-Z]//g' "$TRANSCRIPT" > "$PLAIN"
  tr '\n' ' ' < "$PLAIN" | tr -s ' ' > "$FLAT"
  return $rc
}
conv() { local f=/work/conv.$$; cat > "$f"; echo "$f"; }

saw()   { grep -qF -- "$2" "$PLAIN" && pass "$1" || { fail "$1"; printf '%s     expected: %s%s\n' "$DIM" "$2" "$RST"; }; }
# For what differs by distro in SPELLING but not in shape — `dnf install -y git` against
# `apt-get install -y git`. Asserting one distro's wording on four distros is the same
# blindness this tier exists to catch.
saw_re(){ grep -qE -- "$2" "$PLAIN" && pass "$1" || { fail "$1"; printf '%s     expected /%s/%s\n' "$DIM" "$2" "$RST"; }; }
says()  { grep -qF -- "$2" "$FLAT" && pass "$1" || { fail "$1"; printf '%s     expected sentence: %s%s\n' "$DIM" "$2" "$RST"; }; }
never() { grep -qF -- "$2" "$PLAIN" && { fail "$1"; printf '%s     forbidden: %s%s\n' "$DIM" "$2" "$RST"; } || pass "$1"; }
exists(){ [ -e "$2" ] && pass "$1" || { fail "$1"; printf '%s     no such path: %s%s\n' "$DIM" "$2" "$RST"; }; }
# Run a command for its EXIT STATUS, quietly — the same helper journey.sh has, because a
# fragment that uses it there and not here fails with 127 and reads as a defect in gov.
#
# That happened: 98's eight assertions were all `runs test "${V%%|*}" = "no" && pass || fail`,
# `runs` did not exist in this tier, and every one of them reported the desktop probe broken
# while the probe's answers were exactly right. An undefined helper is indistinguishable from a
# real failure in the output, which is the worst possible place for the two to be confusable.
runs()  { "$@" >/dev/null 2>&1; }

# A PRECONDITION IS NOT AN ASSERTION — say which one failed.
#
# 94, 96 and 98 all begin by running install.sh to GET a machine with gov on it; none of them
# is testing install.sh. When the install fails — and it does, because six scenarios per image
# each re-download Node and nodejs.org throttles — every assertion after it fails too, blaming
# whatever that fragment was about. One throttled download reported as ten broken desktop
# probes, with the probe's answers perfectly correct underneath.
#
# An infrastructure failure that reads as a product failure is the same defect as the undefined
# `runs` above, and more expensive: it sends you to read code that was never wrong. So the
# precondition is checked once, named as a precondition, and the fragment stops.
#
#   require_gov "the desktop probe" || return
#
# `return` works because fragments are `source`d, so this ends the fragment and not the tier.
require_gov() {
  if [ -e "$HOME/.local/bin/gov" ] || in_a_new_login_shell "gov --version"; then
    pass "gov is installed"
    return 0
  fi
  fail "PRECONDITION: gov is not installed, so nothing below ran"
  printf '%s     install.sh did not complete — see the transcript above. This says NOTHING
' "$DIM"
  printf '     about %s; those assertions were skipped, not failed.%s
' "$1" "$RST"
  return 1
}
absent(){ [ -e "$2" ] && { fail "$1"; printf '%s     should not exist: %s%s\n' "$DIM" "$2" "$RST"; } || pass "$1"; }

# THE ONLY QUESTION THAT MATTERS FOR #209: does it work in a shell that gov did not start?
# `bash -lc` reads the login profile, which is where install.sh put its PATH edit — the same
# shell an adopter gets when they open a new terminal tomorrow.
in_a_new_login_shell() { bash -lc "$1" >/dev/null 2>&1; }

# A machine with nothing: no gov, no node of ours, no profile edit, no workspace.
reset_machine() {
  rm -rf "$HOME/.local/share/gov" "$HOME/.local/bin/gov" "$HOME/.gov" "$HOME/.config/prj" 2>/dev/null
  for p in "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
    [ -f "$p" ] && sed -i '/gov-work bootstrap/,+1d' "$p" 2>/dev/null
  done
  : > /work/agent.log
  export AGENT_DOUBLE_LOG=/work/agent.log
}

shopt -s nullglob
for f in "$HERE"/os.d/*.sh; do
  name="$(basename "$f" .sh)"
  [ -n "$FILTER" ] && [[ "$name" != *"$FILTER"* ]] && continue
  before=$FAIL
  reset_machine
  # NOTHING IN A FRAGMENT MAY READ THIS RUNNER'S STDIN.
  #
  # `drive` talks to gov through a pty, so no fragment ever needs stdin — but a plain command
  # inside one inherits it, and a gov command that asks a question then blocks forever on input
  # that cannot arrive is what stalled this tier twice (see 96). Interactive things belong in a
  # conversation; everything else gets EOF immediately, which turns a hang into a result.
  # shellcheck disable=SC1090
  source "$f" < /dev/null
  if [ "$FAIL" -gt "$before" ]; then
    printf '\n  %slast 30 lines of what the adopter saw:%s\n' "$DIM" "$RST"
    tail -30 "$PLAIN" 2>/dev/null | sed 's/^/      /'
    [ -s /work/drive.err ] && { printf '  %sdriver:%s\n' "$DIM" "$RST"; sed 's/^/      /' /work/drive.err; }
  fi
done
shopt -u nullglob

printf '\n%s%s: %d passed, %d failed%s\n' "$BOLD" "${OS_TIER_LABEL}" "$PASS" "$FAIL" "$RST"
[ "$FAIL" -eq 0 ]
