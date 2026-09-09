# SPDX-License-Identifier: MIT
# THE THIRD CALL SITE — the offer that closes a run (#203), and the one the walk took.
#
# Three places build a work flow: `runWork`, the menu handler, and `reviewNow` — the "would
# you like to start work now?" that ends adoption and joining. 62 covered the first, 64 the
# second, and the third had no asker at all. So an adopter chose "2. Paste an API key", and
# instead of a prompt got:
#
#     Paste the BOB_API_KEY (hidden), or press Enter to skip: (cannot hide input here — skipped)
#     Nothing saved. IBM Bob will ask you to sign in when it starts.
#
# — a fallback that read as an answer, which is #199's lesson rebuilt by hand. `ask` is
# required now, so a fourth call site cannot repeat it without failing to compile. This
# scenario is what proves the third one is wired.
scenario "66 · the closing offer installs and signs in (#203 → #213)"

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

export GH_STUB_LOGIN=acme GH_STUB_BOARDS="9:Infra"
mkdir -p "$HOME/.gov/acme/projects/PRJ-9-infra/acme-gov/.git"

# One run, start to finish: join, take the offer, install, and sign in — without ever
# returning to a shell in between. That continuity is the point; the reader that asks the
# key question is the one `reviewNow` made, three questions earlier.
drive "$(conv <<C
> Select \\(A/B/C\\)
< B
> Q1 - What is the Github Organization ID
< acme
> Q2 - What is the name of your org
< acme-gov
~ 240
> start work now
< y
> Choose:
< 1
> Install IBM Bob now
< y
> Choose \\[1-3\\]
< 2
> Paste the BOB_API_KEY
< sk-review-offer-key
~ 120
# The prompt gov cannot inject is now SHOWN and HELD (#218): printing it first was not
# enough against an agent whose UI takes the alternate screen and erases what came before.
> Press Enter to start
<
~ 120
> $
C
)" gov

info "#213 — the third call site asks for real"
says "the sign-in question is reached" "How would you like to sign IBM Bob in?"
saw "the key prompt is reached" "Paste the BOB_API_KEY"
never_says "and it is NOT the fallback that answered" "cannot hide input here"
never "nor did it report a skip nobody asked for" "Nothing saved."
exists "the key was stored" "$HOME/.gov/acme/projects/preferences/$GH_STUB_LOGIN/credentials"
runs grep -q "sk-review-offer-key" "$HOME/.gov/acme/projects/preferences/$GH_STUB_LOGIN/credentials" \
  && pass "and it holds the key that was typed at the closing offer" \
  || fail "the credentials file does not hold the key typed on the review-offer path"
never_re "the secret never reached the screen" "sk-review-offer-key"
# HIDDEN IS NOT INVISIBLE (#218). A password is typed, so the typist knows they typed; an API
# key is PASTED, and a paste that changes nothing on screen cannot be told apart from one that
# never arrived. A walk stalled there. One bullet per character says "it landed" without
# saying what landed.
saw "a paste is visibly received, one bullet per character" "skip: •"

info "#213 — and the agent gov launched actually RECEIVED it"
# The assertion that was missing. Storing a key and then launching the agent without it is
# indistinguishable, from gov's own output, from storing it and launching correctly — and the
# adopter finds out when the agent asks for a browser a second later.
ran "IBM Bob was launched with BOB_API_KEY set in its environment" "env=BOB_API_KEY:set"

info "#218 — the first message survives the agent taking the screen"
# The walk that found this ended with Bob idle at its own prompt, the instruction gone, and
# the session-start protocol never run. Printing first was not the fix: an agent whose UI
# takes the alternate screen erases what came before rather than competing with it.
saw "the prompt to paste is still printed" "runs the session-start protocol"
saw "it is also written somewhere the UI cannot erase" "session-prompt.md"
exists "and the file is really there" "$HOME/.gov/acme/projects/PRJ-9-infra/.gov/session-prompt.md"
runs grep -q "session-start protocol" "$HOME/.gov/acme/projects/PRJ-9-infra/.gov/session-prompt.md" \
  && pass "holding the prompt itself, not a description of it" \
  || fail "session-prompt.md does not contain the prompt"
saw "gov waits instead of launching over the instruction" "Press Enter to start"
# The licence screen is IBM's, not gov's — but a walk lost eighteen seconds to it, pressing
# Enter at a prompt that wanted `y`. Naming it costs two lines and gov cannot help once the
# agent owns the terminal.
saw "and it warns about IBM Bob's own licence screen before handing over" "Press \`y\` to accept"
