# SPDX-License-Identifier: MIT
# THE HALF 94 COULD NOT REACH — a REAL `gov agent install`, on a real private-Node machine.
#
# 94 places the agent binary by hand, so `linkAgentIntoPath` is never called and the thing
# #209 is actually about is never exercised. That gap was written down (BACKLOG 96) and it
# bit on the very next walk:
#
#     Resume tasks with:  bob --resume
#     [tester@…]$ bob --resume
#     -bash: bob: command not found
#
# on ROCKY, where the fix was supposed to apply. Its guard read `pathDirs.includes(nodeBin)`
# against gov's OWN environment — and `install.sh` exports `$NODE_DIR/bin` before running
# gov, so that was always true during an install and the wrapper was never written.
#
# A test that cannot call the function cannot catch its guard. This one calls it.
scenario "96 · gov links what it installs (#209) (${OS_TIER_LABEL})"

drive "$(conv <<'C'
~ 180
> Do you want to continue \(y/N\)\?
< n
> Continue now\? \[Y/n\]
< n
C
)" env GOV_PKG=/work/gov.tgz GOV_YES=1 bash /src/install.sh
exists "gov is installed" "$HOME/.local/bin/gov"

# The doubles the journey tier uses, brought in here: gov reaches GitHub only through `gh`,
# and the vendor's installer only through `curl`. Everything between them is the real thing.
STUBS=/work/stubs; mkdir -p "$STUBS"
cp /src/publish/actions/ts/e2e/stub/gh "$STUBS/gh"
cat > "$STUBS/curl" <<EOF
#!/usr/bin/env bash
case "\$*" in
  *bob.ibm.com/download/bobshell.sh*)
    # Install where the VENDOR would: beside gov's private Node, which is the condition.
    printf 'cp %s %s/bob && chmod +x %s/bob\n' \\
      "/src/publish/actions/ts/e2e/stub/agent-double" "$HOME/.local/share/gov/node/bin" "$HOME/.local/share/gov/node/bin" ;;
  *) exit 1 ;;
esac
EOF
chmod +x "$STUBS/gh" "$STUBS/curl"
export PATH="$STUBS:$PATH"
export GH_STUB_LOGIN=acme GH_STUB_LOG=/work/gh.log
: > /work/gh.log

# A governance workspace with ibm-bob approved, registered the way a joiner's would be.
WS="$HOME/.gov/acme/gov_repo"; mkdir -p "$WS/knowledge/policies" "$WS/agent"
printf 'org_name: "Acme Ltd"\norg_short_name: "Acme"\norg_slug: "ACME"\norg_slug_lower: "acme"\ngithub_org: "acme"\nworkspace_repo: "acme-gov"\ndefault_branch: "main"\ndefault_code_branch: "dev"\nagent_work_root: "%s/.gov/acme/projects"\npolicy_owner_email: "owner@example.test"\n' "$HOME" > "$WS/org-config.yaml"
printf '# llm governance\n\n```yaml\napproved_agents:\n  - id: ibm-bob\n    default: true\n```\n' > "$WS/knowledge/policies/llm-governance.md"
printf '# protocol\n' > "$WS/agent/session-protocol.md"
printf '[user]\n\tname = Adopter Bot\n\temail = adopter@example.test\n' > "$HOME/.gitconfig"
( cd "$WS" && git init -q . && git add -A && git -c user.email=e@x -c user.name=e commit -qm init ) >/dev/null 2>&1
bash -lc "gov org add acme --home '$WS'" >/dev/null 2>&1
bash -lc "gov org use acme" >/dev/null 2>&1

info "the install itself — gov's own code, not a re-implementation of it"
drive "$(conv <<'C'
~ 240
> Proceed\? \(y/N\)
< y
> $
C
)" bash -lc "gov agent install ibm-bob"

saw "#201 — it installs from IBM's own channel" "bob.ibm.com/download/bobshell.sh"
exists "the vendor put bob beside gov's private Node, as npm and IBM's script both do" \
  "$HOME/.local/share/gov/node/bin/bob"

# THE ASSERTION THIS FRAGMENT EXISTS FOR.
exists "#209 — gov wrote the wrapper into ~/.local/bin" "$HOME/.local/bin/bob"
env -i HOME="$HOME" PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin" bash -c "bob --version" >/dev/null 2>&1 \
  && pass "#209 — and bob runs in a shell that has NEITHER gov's Node dir nor the profile edit" \
  || fail "#209 — still unreachable: this is the shell where 'bob --resume' was typed"
