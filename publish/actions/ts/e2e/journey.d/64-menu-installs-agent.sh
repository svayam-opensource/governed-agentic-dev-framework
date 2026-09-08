# SPDX-License-Identifier: MIT
# THE MENU — `gov`, then 1, then the project. The path an adopter actually types.
#
# 62 drives `gov work --project=…`, and it has been green through two walks that failed. The
# difference is the reader: `runMenu` creates a readline and keeps it open for the WHOLE loop,
# handing `io.prompt` to everything it dispatches, and it has already ASKED a question through
# it before the install begins. `runWork` creates one too, but on 62's path nothing had used
# it yet. A reader already in use behaves differently from one that has not been.
#
# Three walks have now failed on a path no scenario took. This one takes it.
scenario "64 · the MENU installs and signs in — the path adopters type (#213)"

REMOTE="$GIT_STUB_REMOTES/acme-gov"
make_gov_repo "$REMOTE" "acme" "ACME"
approve_agents "$REMOTE" "ibm-bob"
( cd "$REMOTE" && git add -A && git -c user.email=e@x -c user.name=e commit -qm agents )

# THE VENDOR'S INSTALLER, DOUBLED FAITHFULLY — including the part that matters.
#
# gov runs `sh -c "curl … | bash"` with stdio INHERITED, so the vendor's script has this
# terminal: it can print pages, it can read stdin, and it can leave the tty in a state gov did
# not choose. IBM's does at least the first two — it has its own package-manager step. A
# double that only copies a file proves the happy path of a script that does nothing, which is
# not the script anybody runs.
cat > "$WORLD/bin/curl" <<EOF
#!/usr/bin/env bash
case "\$*" in
  *bob.ibm.com/download/bobshell.sh*)
    cat <<'SCRIPT'
echo "Checking Node.js Installation"
echo "Package Manager Selection"
# The vendor's own step reads the terminal. Whatever it leaves behind, gov meets next.
read -r -t 1 _ignored </dev/tty 2>/dev/null || true
echo "Downloading Bob Shell"
echo "Installing Bob Shell"
SCRIPT
    printf 'cp %s %s/bin/bob && chmod +x %s/bin/bob\n' "$HERE/stub/agent-double" "$WORLD" "$WORLD" ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$WORLD/bin/curl"

export GH_STUB_LOGIN=acme GH_STUB_BOARDS="9:Infra"
mkdir -p "$HOME/.gov/acme/projects/PRJ-9-infra/acme-gov/.git"

# Register the org first, so `gov` opens on the menu rather than on first-run.
drive "$(conv <<C
> Select \\(A/B/C\\)
< B
> Governance repo \\(clone URL\\)
< https://github.test/acme/acme-gov.git
~ 180
> start work now
< n
C
)" gov

drive "$(conv <<'C'
~ 240
> Proceed\? \(y/N\)
< y
# The main menu. 1 = Work — and this is the question that puts the menu's reader INTO USE
# before anything else asks through it, which is the whole difference from 62.
> Choose:
< 1
> Choose:
< 1
> Install IBM Bob now
< y
> Choose \[1-3\]
< 2
> Paste the BOB_API_KEY
< sk-menu-path-key
~ 120
> $
C
)" gov

info "#213 — asked through the MENU's reader, which was already in use"
says "the sign-in question is reached" "How would you like to sign IBM Bob in?"
saw "the key prompt is reached" "Paste the BOB_API_KEY"
never "and it did not answer itself" "Nothing saved."
exists "the key was stored" "$HOME/.gov/acme/projects/preferences/$GH_STUB_LOGIN/credentials"
runs grep -q "sk-menu-path-key" "$HOME/.gov/acme/projects/preferences/$GH_STUB_LOGIN/credentials" \
  && pass "and it is the key that was typed, through the menu's own reader" \
  || fail "the credentials file does not hold the key typed on the menu path"

info "#213 — and the key never reached the screen"
never_re "the secret is not echoed anywhere in the transcript" "sk-menu-path-key"
