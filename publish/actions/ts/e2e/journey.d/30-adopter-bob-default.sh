# SPDX-License-Identifier: MIT
# SCENARIO 3 — the founding adopter, choosing IBM Bob as the organization's default.
#
# The path that has never once completed on a container: every walk so far pivoted to
# JOINER because the org used for testing was already governed (#197 doing its job). So the
# agent-approval question, the starter project and the adopter's closing offer have only
# ever been exercised by unit tests that inject the whole world.
scenario "30 · adopter founds an org, IBM Bob as the default"

export GH_STUB_LOGIN="acme"          # the org we adopt for, and the board owner
export GH_STUB_GOVERNED=""           # nobody has adopted for it yet

# The vendor installer, doubled at `curl` — the command gov runs is unchanged.
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
> Which organization
< acme
~ 240
> Name for the governance repository
< acme-gov
> uppercase token
< ACME
# `gov setup` asks its own seven, every one of them defaulted — so an adopter who trusts
# the defaults presses Enter seven times, and so does this.
~ 240
> Full legal name of your organization
<
> Short display name
<
> Default branch for all repositories
<
> Default branch in code repositories
<
> Policy Owner email
<
> Policy effective date
<
> Allowed agents
< ibm-bob
> Create it\? \[y/N\]
< y
~ 240
> review your governance policies now
< n
C
)" gov

info "founding"
saw "it creates the repository from the framework template" "creating acme/acme-gov"
gh_ran "and does so through gh, with --template" "repo create acme/acme-gov --template"
exists "the workspace lands where every tool looks" "$HOME/.gov/acme/gov_repo/org-config.yaml"

info "#196 — the org decides which agents it allows, during adoption"
says "the question is asked" "Which AI agents may be used in this organization"
saw_re "and the answer is written to the policy, not remembered" "approved_agents|IBM Bob"
runs grep -q "ibm-bob" "$HOME/.gov/acme/gov_repo/knowledge/policies/llm-governance.md" \
  && pass "ibm-bob is in llm-governance.md — the approved list is a file, not a memory" \
  || fail "ibm-bob was not written to llm-governance.md"

info "#193 — no placeholder survives into the adopter's own policies"
never "<ORG_NAME> is resolved" "<ORG_NAME>"
never "and so is <GITHUB_ORG>" "<GITHUB_ORG>"

info "#186 — the closing screen is the founder's, and it is the truth"
saw "the ADOPTER's next steps" "Install complete — for ADOPTERS"
never "not the joiner's" "Install complete — for JOINERS"
saw_re "#203 — and it offers the review rather than printing three steps to retype" "review your governance policies now"
