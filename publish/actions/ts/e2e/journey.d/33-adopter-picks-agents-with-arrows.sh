# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
# SCENARIO 33 — the founding adopter answers Q12 with the ARROW PICKER (PRJ-121 F158, ruling Q12 A, 2026-11-25).
#
# Every other scenario pins the numbered form (GOV_PLAIN_PROMPTS=1 in new_world), because their conversations type
# numbers. This one is the person at a real terminal: no `CI`, no pin, a TERM that is not `dumb` — so gov draws the
# picker, and the answer is given with ↑/↓, Space and Enter. The default is a single-select; the others a
# multi-select. What must hold afterwards: the approved list says exactly what was picked, IBM Bob is the default,
# and the terminal came back (the read-back and the Y/n after the picker are typed and echoed normally).
scenario "33 · adopter picks the agents with the arrow keys — a single-select, then a multi-select"

export GH_STUB_LOGIN="acme"
export GH_STUB_GOVERNED=""
export GH_STUB_REPOS="acme/acme-gov"

# The vendor installer, doubled at `curl`, as scenario 30 does for IBM Bob.
cat > "$WORLD/bin/curl" <<EOF
#!/usr/bin/env bash
case "\$*" in
  *bob.ibm.com/download/bobshell.sh*)
    printf 'cp %s %s/bin/bob && chmod +x %s/bin/bob\n' "$HERE/stub/agent-double" "$WORLD" "$WORLD" ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$WORLD/bin/curl"

drive "$(conv <<'C'
> Select \(A/B/C\)
< A
~ 240
> Q1 - What is full legal name
< Acme Incorporated
> Q2 - What is short name
<
> Q3 - What is the Github Organization ID
< acme
~ 240
> Q4 - What would you like the name of your new governance repo
< acme-gov
> Q5 - What would you like the identifier
< ACME
> Q6 - Default branch to be used for production
<
> Q7 - Default branch to be used for development
<
> Q8 - Who is the Policy Owner
< adopter
> Q9 - Who will approve your own changes
< none
> Q10 - What contact email
< adopter@acme.test
> Q11 - What governance posture
<
~ 240
# Q12 — the default: the list ends with `none`, then Aider, then IBM Bob — so End, Up, Up.
> Enter choose
<k end up up enter
# The others: Claude Code is first (the cursor starts there), Aider is last. Space on each, then Enter.
> Space select
<k space end space enter
> happy with your AI agent selection
< y
~ 240
> review your governance policies now
< n
C
)" env -u CI -u GOV_PLAIN_PROMPTS TERM=xterm-256color gov

info "F158 — Q12 is the shared picker in a real terminal"
saw "the default is asked with the ruling's question" "Which AI agent would you like to use as the default in your organization?"
saw "the single-select draws its hint line" "↑/↓ move · Enter choose"
saw "the multi-select draws its own" "↑/↓ move · Space select · Enter done"
never "and the numbered label is not offered beside the picker" "Choose [1/2/3/4/5/6/7/8/9/10]"
saw "the chosen default is read back on its own line" "✓ IBM Bob"
saw "and so are the others" "✓ Claude Code, Aider"
saw "the selection is read back, the default named" "'IBM Bob' (default), 'Claude Code' and 'Aider'"

G="$HOME/.gov/acme/gov_repo/policies/governance.yaml"
runs grep -qE '^[[:space:]]+default: "?ibm-bob"?' "$G" \
  && pass "governance.yaml records IBM Bob as the default (default: true in the approved list)" \
  || fail "governance.yaml does not record ibm-bob as the default"
for id in claude-code aider; do
  runs grep -q "$id" "$G" && pass "governance.yaml allows $id" || fail "governance.yaml does not allow $id"
done
for id in cursor openai-codex; do
  runs grep -q "$id" "$G" && fail "governance.yaml allows $id, which was never selected" || pass "and not $id, which was never selected"
done
saw "the founding went ahead after the picker gave the terminal back" "creating acme/acme-gov"
