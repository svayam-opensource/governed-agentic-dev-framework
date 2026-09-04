# SPDX-License-Identifier: MIT
# SCENARIO 3a — the org's default agent is IBM Bob, installed on a bare machine.
#
# Four rounds of defects lived in this one screen and every one of them shipped past 890
# unit tests, because a unit test injects the install and the spawn. What is asserted here
# is what an adopter reads and what the machine is left holding.
scenario "60 · agent install — IBM Bob (#200 · #201 · #202 · #208 · #209)"

REMOTE="$GIT_STUB_REMOTES/acme-gov"
make_gov_repo "$REMOTE" "acme" "ACME"
approve_agents "$REMOTE" "ibm-bob"
( cd "$REMOTE" && git add -A && git -c user.email=e@x -c user.name=e commit -qm agents )

drive "$(conv <<'C'
> Select \(A/B/C\)
< B
> Governance repo \(clone URL\)
< https://github.test/acme/acme-gov.git
~ 120
> start work now
< n
C
)" gov

# THE VENDOR'S INSTALLER, DOUBLED. gov runs `sh -c "curl … | bash"`, so the seam is `curl`:
# a curl that emits an installer script, which installs the agent double. Nothing leaves the
# world, and the command gov actually runs is unchanged.
cat > "$WORLD/bin/curl" <<EOF
#!/usr/bin/env bash
# Only the vendor URL gov was told to fetch; anything else is not this test's business.
case "\$*" in
  *bob.ibm.com/download/bobshell.sh*)
    printf 'cp %s %s/bin/bob && chmod +x %s/bin/bob\n' "$HERE/stub/agent-double" "$WORLD" "$WORLD" ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$WORLD/bin/curl"

# EVERY `gov <verb>` PASSES A CONTEXT GATE FIRST — itself a human step, and one no
# non-interactive test had ever answered, because none of them was ever asked.
drive "$(conv <<'C'
~ 120
> Proceed\? \(y/N\)
< y
> $
C
)" gov agent install ibm-bob

says "#201 — the vendor is named BEFORE anything runs" "Vendor: https://bob.ibm.com"
never "#201 — and never the package that was not IBM's" "@bobsworkshop/cli"
saw "#201 — IBM's own channel is what runs" "bob.ibm.com/download/bobshell.sh"
says "#208 — it does NOT ask for a key from an agent that opens its own browser" "signs you in itself"
never "#208 — so no key prompt" "Paste the BOB_API_KEY"
