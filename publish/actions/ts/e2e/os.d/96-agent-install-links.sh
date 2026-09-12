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
)" env GOV_PKG=/work/gov.tgz GOV_NODE_TARBALL=/work/node.tar.gz GOV_YES=1 bash /src/install.sh
require_gov "whether gov links what it installs (#209)" || return

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
# PLACED WHERE A LOGIN SHELL WILL FIND THEM. `export PATH="$STUBS:$PATH"` was not enough:
# `gov agent install` runs through `bash -lc` below (the only way gov is reachable on debian),
# and debian's and ubuntu's /etc/profile OVERWRITE PATH, so the stub dir was dropped and the
# real bob.ibm.com and the real npm registry were contacted on two of four images. See
# `stub_on_login_path` in os-run.sh.
stub_on_login_path "$STUBS/gh"   gh
stub_on_login_path "$STUBS/curl" curl
export PATH="$STUBS:$PATH"
# THE STUB IS IN EFFECT, PROVED RATHER THAN ASSUMED — in the same kind of shell that will run
# the install. Without this the whole fragment can quietly test the vendor's servers instead.
in_a_new_login_shell 'curl -fsSL https://bob.ibm.com/download/bobshell.sh | grep -q agent-double' \
  && pass "the vendor stub is in effect in a LOGIN shell, not just this one" \
  || fail "a login shell would reach the real bob.ibm.com — the stub is not on its PATH"
export GH_STUB_LOGIN=acme GH_STUB_LOG=/work/gh.log
: > /work/gh.log

# A governance workspace with ibm-bob approved, registered the way a joiner's would be.
WS="$HOME/.gov/acme/gov_repo"; mkdir -p "$WS/knowledge/policies" "$WS/agent"
printf 'org_name: "Acme Ltd"\norg_short_name: "Acme"\norg_slug: "ACME"\norg_slug_lower: "acme"\ngithub_org: "acme"\nworkspace_repo: "acme-gov"\ndefault_branch: "main"\ndefault_code_branch: "dev"\nagent_work_root: "%s/.gov/acme/projects"\npolicy_owner_email: "owner@example.test"\n' "$HOME" > "$WS/org-config.yaml"
printf '# llm governance\n\n```yaml\napproved_agents:\n  - id: ibm-bob\n    default: true\n```\n' > "$WS/knowledge/policies/llm-governance.md"
printf '# protocol\n' > "$WS/agent/session-protocol.md"
printf '[user]\n\tname = Adopter Bot\n\temail = adopter@example.test\n' > "$HOME/.gitconfig"
( cd "$WS" && git init -q . && git add -A && git -c user.email=e@x -c user.name=e commit -qm init ) >/dev/null 2>&1
# `< /dev/null`, AND IT IS NOT DECORATION.
#
# Without it these two hung the entire tier — twice, for hours, reporting neither a pass nor a
# failure. `gov org add` asks something when the workspace is already registered, and with
# stdout and stderr sent to /dev/null and stdin inherited from the runner, it waited on input
# that could never arrive, with the question it was waiting on discarded. Redirecting output
# without also closing input is how a silent test becomes a stuck one.
bash -lc "gov org add acme --home '$WS'" >/dev/null 2>&1 < /dev/null
bash -lc "gov org use acme" >/dev/null 2>&1 < /dev/null

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

# THE ASSERTIONS THIS FRAGMENT EXISTS FOR — and there are two shapes, because the right answer
# genuinely differs by distro.
#
# `linkAgentIntoPath` writes its shortcut into `~/.local/bin` and refuses when that directory is
# not on PATH, because a file nobody finds is worse than none. On rocky and fedora it IS on
# PATH; on debian:stable-slim and ubuntu:24.04 it is not, and `install.sh` says so itself
# (scenario 90 asserts the profile-edit fallback there).
#
# This fragment asserted rocky's answer on all four and so reported debian and ubuntu broken.
# They were not broken in the linking — gov's refusal is correct, and editing a shell profile
# from `gov` is ruled out (#211, which is about gov and not about install.sh). What WAS broken
# is that gov said nothing: three ways of declining all returned the same null, the caller
# printed none of them, and the line just above was `✓ … installed and runnable`. An adopter
# read that, typed `bob`, and got `command not found`.
#
# Resolved with option (b) (Policy Owner, 2026-09-11): keep the behaviour, SAY what is true.
# So on an image where the shortcut cannot be written, the thing to assert is the sentence.
if in_a_new_login_shell 'case ":$PATH:" in *":$HOME/.local/bin:"*) exit 0;; *) exit 1;; esac'; then
  info "~/.local/bin IS on PATH on this image — the shortcut can be written, so it must be"
  exists "#209 — gov wrote the wrapper into ~/.local/bin" "$HOME/.local/bin/bob"
  env -i HOME="$HOME" PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin" bash -c "bob --version" >/dev/null 2>&1 \
    && pass "#209 — and bob runs in a shell that has NEITHER gov's Node dir nor the profile edit" \
    || fail "#209 — still unreachable: this is the shell where 'bob --resume' was typed"
  saw "and gov says the shortcut works after it exits" "works after gov exits"
else
  info "~/.local/bin is NOT on PATH on this image — gov must not write there, and must say so"
  # The refusal itself: writing into a directory nobody's shell searches would be the defect,
  # not the fix. This is the one assertion that keeps option (a) from creeping back in silently.
  absent "gov did not write a shortcut nobody would find" "$HOME/.local/bin/bob"
  # AND IT IS SAID ON SCREEN, which is the whole of the fix. A `warn` in a log nobody switched
  # on was the entire previous record of the adopter's most likely next surprise.
  saw   "#209 — gov says bob will not be on the PATH after it exits" "will not be on your PATH after gov exits"
  saw   "and says why, naming the directory it declined to use"      "is not on your PATH"
  saw   "and where the binary really is"                             "$HOME/.local/share/gov/node/bin"
  saw   "and gives a remedy the adopter controls"                    "to your PATH and run this install"
  saw   "and one that works right now"                               "$HOME/.local/share/gov/node/bin/bob"
  # THE HALF-TRUTH THAT STARTED THIS. "installed and runnable" is still printed and still true
  # of gov's own process; what must never be printed on this image is the LINK claim.
  never "and never claims a link it did not make"                    "works after gov exits"
fi
