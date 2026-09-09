# SPDX-License-Identifier: MIT
# THE PATH THE ADOPTER ACTUALLY TAKES — `gov` → Work → nothing installed → install → sign in.
#
# 60 exercises the same install through `gov agent install`, a command with no readline of its
# own. The real route goes through `runWorkFlow`, which IS holding a readline on stdin for its
# own questions — and that difference hid a defect that 47 green journey assertions and 904
# unit tests all walked past:
#
#   the sign-in prompts read `readSync(0, …)` and answered themselves instantly, because the
#   flow's readline already owned fd 0. The adopter picked 2, was never asked for a key, and
#   landed in Bob's browser screen with nothing gov had offered.
#
# #194 wrote this lesson down — "two readers of the same terminal is how the first two attempts
# at this question answered themselves" — and it was walked into again one function over. The
# fix is /dev/tty, which `createStarterProject` already uses for exactly this reason. This
# scenario is the one that can tell.
scenario "62 · the work flow installs and signs in — with a readline already on stdin (#213)"

REMOTE="$GIT_STUB_REMOTES/acme-gov"
make_gov_repo "$REMOTE" "acme" "ACME"
approve_agents "$REMOTE" "ibm-bob"
( cd "$REMOTE" && git add -A && git -c user.email=e@x -c user.name=e commit -qm agents )

cat > "$WORLD/bin/curl" <<EOF
#!/usr/bin/env bash
case "\$*" in
  *bob.ibm.com/download/bobshell.sh*)
    printf 'cp %s %s/bin/bob && chmod +x %s/bin/bob\n' "$HERE/stub/agent-double" "$WORLD" "$WORLD" ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$WORLD/bin/curl"

# One board Work can offer, and its workspace already CLONED — so `workspaceState` says
# "ready" and the flow goes straight to the agent question. Seeding is not what this scenario
# is about, and a fixture for it would be a board fetch, an anchor and a branch push to make a
# point about a readline.
export GH_STUB_LOGIN=acme GH_STUB_BOARDS="9:Infra"
mkdir -p "$HOME/.gov/acme/projects/PRJ-9-infra/acme-gov/.git"

drive "$(conv <<C
> Select \\(A/B/C\\)
< B
> Q1 - What is the Github Organization ID
< acme
> Q2 - What is the name of your org
< acme-gov
~ 180
> start work now
< n
C
)" gov

# NO `--agent`, DELIBERATELY. Naming one skips the whole offer block — which is the block
# under test. The org's default is the only approved agent, nothing is installed, and that is
# the joiner's ordinary case (#196): gov offers to install it and then asks how to sign in.
drive "$(conv <<'C'
~ 240
> Proceed\? \(y/N\)
< y
# MATCHES THE RAW STREAM, WHICH CARRIES COLOUR. "Install IBM Bob now?" is painted bold
# (#204), so escape codes sit between the `?` and the ` (Y/n)` — a pattern spanning them
# never matches, and the run reads as a hang rather than a typo. Match inside one painted
# run, never across its edges.
> Install IBM Bob now
< y
# THE ASSERTION IS THAT THESE TWO PROMPTS ARE REACHED AND WAIT. Before the fix the whole
# screen scrolled past unanswered, because a readline already held fd 0.
> Choose \[1-3\]
< 2
> Paste the BOB_API_KEY
< sk-test-not-a-real-key
~ 120
> $
C
)" gov work --project=infra

info "#213 — the choice was ASKED, inside a flow that already owns stdin"
says "the question is reached" "How would you like to sign IBM Bob in?"
saw "and the key route is offered" "2. Paste an API key now"
saw "the key prompt is reached — it did not answer itself" "Paste the BOB_API_KEY"

info "and the answer was HONOURED, not skipped past"
never "nothing was skipped" "Nothing saved."
saw_re "the key was stored where a person can find it again" "written: .*preferences/.*/credentials"
exists "and it really is on disk" "$HOME/.gov/acme/projects/preferences/$GH_STUB_LOGIN/credentials"
runs grep -q "sk-test-not-a-real-key" "$HOME/.gov/acme/projects/preferences/$GH_STUB_LOGIN/credentials" \
  && pass "the backup copy holds the key that was typed" \
  || fail "the credentials file does not contain the key that was pasted"
