# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
# SCENARIO — the adopter presses Ctrl-C at EVERY question of the founding interview (#215).
#
# #215's promise is printed in the interview header: "Nothing is created until the last answer is
# in — Ctrl-C before then costs nothing." Scenario 30 proves the ORDER (the create line comes after
# Q12's confirmation). This proves the CONSEQUENCE, question by question: interrupt at Qn, and
# GitHub was never asked to create a repository, no template copy exists, and no workspace landed
# on the machine. Before #215 the repository was created between the second and third questions,
# and an interrupt after that left a repo `gh` cannot delete.
scenario "31 · adopter interrupts the founding interview at each question — nothing is created"

export GH_STUB_LOGIN="acme"
export GH_STUB_GOVERNED=""

# Each step: the prompt to wait for, and the answer an adopter gives when NOT interrupting there.
# `-` means press Enter (accept the default). The last is Q12's read-back — the last answer before
# anything irreversible happens. (The "Create it?" that follows the creation is the starter-project
# offer, asked about a repository that by then exists; it is not part of the interview.)
STEPS=(
  "Q1 - What is full legal name|Acme Incorporated"
  "Q2 - What is short name|-"
  "Q3 - What is the Github Organization ID|acme"
  "Q4 - What would you like the name of your new governance repo|acme-gov"
  "Q5 - What would you like the identifier|ACME"
  "Q6 - Default branch to be used for production|-"
  "Q7 - Default branch to be used for development|-"
  "Q8 - Who is the Policy Owner|adopter"
  "Q9 - Who is the Check Owner|adopter"
  "Q10 - What contact email|adopter@acme.test"
  "Q11 - What governance posture|-"
  "default for your organization|8"
  "add any other AI agent|-"
  "happy with your AI agent selection|y"
)

for ((stop = 0; stop < ${#STEPS[@]}; stop++)); do
  at="${STEPS[$stop]%%|*}"
  : > "$GH_STUB_LOG"
  rm -rf "${GIT_STUB_REMOTES:?}/acme-gov" "$HOME/.gov/acme"
  c="$WORLD/conv.ctrlc.$stop"
  { printf '> Select \\(A/B/C\\)\n< A\n~ 240\n'
    for ((i = 0; i < stop; i++)); do
      ans="${STEPS[$i]#*|}"; [ "$ans" = "-" ] && ans=""
      printf '> %s\n< %s\n' "${STEPS[$i]%%|*}" "$ans"
    done
    printf '> %s\n^C\n' "$at"
  } > "$c"
  drive "$c" gov
  label="Ctrl-C at '${at//\\/}'"
  saw "$label — the question was reached" "${at//\\/}"
  # "did not exit" is the driver's own verdict on its 30-second drain. (Its "ignored SIGTERM" note is not
  # one: the child has already exited and is an unreaped zombie when it is probed, so it reads alive.)
  ! grep -q "did not exit" "$WORLD/drive.err" && pass "$label — gov stopped on the interrupt" \
    || { fail "$label — gov kept running after the interrupt"; cat "$WORLD/drive.err"; }
  gh_never "$label — GitHub was never asked to create a repository" "repo create"
  [ ! -e "$GIT_STUB_REMOTES/acme-gov" ] && pass "$label — no repository exists" \
    || fail "$label — a repository exists after the interrupt"
  [ ! -e "$HOME/.gov/acme/gov_repo" ] && pass "$label — no workspace landed on the machine" \
    || fail "$label — a workspace landed on the machine after the interrupt"
done

# #210 ON THE FOUNDING PATH. Q1 now comes before the organization is known (#215: names first), so there is
# no default to offer — and Enter there is the documented way out, not an answer to refuse. The defect was
# a first question that invited Enter and then said "cannot be empty".
info "#210 — Enter at the first question is a clean stop, never a refusal"
: > "$GH_STUB_LOG"
drive "$(conv <<'C'
> Select \(A/B/C\)
< A
~ 240
> Q1 - What is full legal name
<
C
)" gov
saw "it says nothing was created, and how to come back" "Nothing created. When you are ready:"
never "the empty answer it invited is not refused" "cannot be empty"
gh_never "and nothing was asked of GitHub's repo API" "repo create"
