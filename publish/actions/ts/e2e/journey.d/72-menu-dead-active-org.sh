# SPDX-License-Identifier: MIT
# THE MENU WITH A DEAD ACTIVE ORG — the state a local walk found on 2026-09-22 (PRJ-121).
#
# Two orgs registered; the ACTIVE one points at a folder that no longer exists (an adopter-smoke run had
# left it there). `gov` then said "no organization set up on this machine yet", hid Admin — and with it
# `org use`, the one way out — redrew its header on every return, and sent every sub-menu's `0` back to
# the main menu. No scenario drove the menu at all, which is how all four went unseen.
scenario "72 · the menu with a dead active org: the real state, Admin → org, 0 goes up one level"

mkdir -p "$HOME/.gov"
printf 'acme\t%s\nghost\t%s\n' "$HOME/.gov/acme/gov_repo" "$WORLD/deleted-by-a-test" > "$HOME/.gov/workspaces"
printf 'ghost\n' > "$HOME/.gov/active"

drive "$(conv <<'C'
~ 60
> Type a number
< 2
> Admin:
< 1
> org:
< 0
> Admin:
< 0
> Type a number
< 0
C
)" gov

info "the banner names the state that is actually true"
never "not 'nothing set up' — two orgs are registered" "no organization set up on this machine yet"
says "it names the broken org and its folder" "The registry points ghost →"
says "and offers the way out, by name" "Or switch: \`gov org use acme\`"
never "not 'org add' alone for a folder that is gone" "Fix it with \`gov org add\`"
says "it can drop the dead entry too" "drop it with \`gov org remove ghost\`"
saw "Work says to choose an org, not to set one up" "Choose a working org first"
never "and the title is not doubled" "Development Framework — Governed Agentic Development Framework"

info "Admin, and org under it, are there with no workspace resolved"
saw_re "Admin is offered in NONE" "\\(2\\) Admin"
saw "and org is its first command" "1) org"

info "navigation is a stack: 0 goes up ONE level"
[ "$(grep -c '^  Admin:' "$PLAIN")" -ge 2 ] && pass "0 in org → back to Admin, not the main menu" \
  || { fail "0 in org → back to Admin, not the main menu"; dump; }

info "the header prints once; the action list on every return"
[ "$(grep -c '▸ ' "$PLAIN")" -eq 1 ] && pass "header printed exactly once" || fail "header printed $(grep -c '▸ ' "$PLAIN") times"
[ "$(grep -c 'Type a number' "$PLAIN")" -ge 2 ] && pass "the action list came back" || fail "the action list did not come back"

info "Help is not a menu item; the footer points at the command line"
never_re "no Help entry" "\\([0-9]\\) Help"
saw "the footer names the CLI help" "Command line: \`gov help\`"
