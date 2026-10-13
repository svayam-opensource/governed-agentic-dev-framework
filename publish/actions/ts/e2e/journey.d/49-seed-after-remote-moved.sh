# SPDX-License-Identifier: MIT
# gadf#180 (PRJ-121 intent 05, Item 2, ruling Q3) — SEED AFTER THE GOVERNANCE REPO MOVED.
#
# Someone merged a policy change to the governance repo after this machine last fetched. `gov seed` used to cut the
# project branch from the LOCAL default branch — so the project started on the old policy, and nothing said so.
# Now seed fetches first and cuts from the remote's default branch, and leaves the developer's local `main` exactly
# where it was (it is theirs; they may be standing on it).
#
# Real git all the way: the remote is a repository on disk, reached through the `github.com` rewrite in stub/git.
scenario "49 · seed after another push to the governance repo"

REMOTE="$GIT_STUB_REMOTES/acme-gov"
make_gov_repo "$REMOTE" "acme" "ACME"

# This machine's clone of the governance repo — the gov home — taken BEFORE the remote moved.
GOV_HOME="$HOME/.gov/acme/acme-gov"
mkdir -p "$(dirname "$GOV_HOME")"
/usr/bin/git clone -q "$REMOTE" "$GOV_HOME"
/usr/bin/git -C "$GOV_HOME" remote set-url origin "https://github.com/acme/acme-gov.git"
# stub/git rewrites a github URL on the COMMAND LINE; a fetch of `origin` reads the URL from config, so the same
# rewrite is said to git itself. Scoped to this world's HOME, like the rest of its git config.
/usr/bin/git config --global url."$REMOTE".insteadOf "https://github.com/acme/acme-gov.git"
printf 'acme\t%s\n' "$GOV_HOME" > "$HOME/.gov/workspaces"
printf 'acme\n' > "$HOME/.gov/active"
LOCAL_MAIN="$(/usr/bin/git -C "$GOV_HOME" rev-parse main)"

# THE REMOTE MOVES: two policy commits land on main after the clone.
( cd "$REMOTE" \
  && mkdir -p policies && echo "# a rule merged this morning" > policies/new-rule.md \
  && git add -A && git -c user.email=e@x -c user.name=e commit -qm "policy: a new rule" \
  && echo "more" >> policies/new-rule.md \
  && git add -A && git -c user.email=e@x -c user.name=e commit -qm "policy: amend the new rule" )
REMOTE_MAIN="$(/usr/bin/git -C "$REMOTE" rev-parse main)"
info "the home's main is at ${LOCAL_MAIN:0:8}; the remote's is two commits ahead at ${REMOTE_MAIN:0:8}"

export GH_STUB_LOGIN=acme GH_STUB_PROJECT="Alpha|https://github.com/acme/acme-gov"
cd "$GOV_HOME" || exit 1
drive "$(conv <<'C'
~ 120
> seeded on BRNCH-7-alpha
C
)" env GOV_YES=1 gov seed https://github.com/orgs/acme/projects/7
cd - >/dev/null || true

saw "the seed succeeds" "Project PRJ-7-alpha seeded on BRNCH-7-alpha"
never "and never cut the branch from a mirror it could not refresh" "could not fetch origin/main"
if /usr/bin/git -C "$REMOTE" merge-base --is-ancestor "$REMOTE_MAIN" BRNCH-7-alpha 2>/dev/null; then
  pass "the pushed project branch carries the policy merged after the last fetch"
else
  fail "the pushed project branch carries the policy merged after the last fetch"
  printf '     remote main %s; BRNCH-7-alpha %s\n' "$REMOTE_MAIN" "$(/usr/bin/git -C "$REMOTE" rev-parse BRNCH-7-alpha 2>&1)"
fi
exists "and the project's worktree has the new rule in it" "$HOME/.gov/acme/projects/PRJ-7-alpha/acme-gov/policies/new-rule.md"
if [ "$(/usr/bin/git -C "$GOV_HOME" rev-parse main)" = "$LOCAL_MAIN" ]; then
  pass "the developer's local main was left where it was"
else
  fail "the developer's local main was left where it was"
fi
if [ "$(/usr/bin/git -C "$GOV_HOME" rev-parse refs/remotes/origin/main)" = "$REMOTE_MAIN" ]; then
  pass "only the remote-tracking ref moved"
else
  fail "only the remote-tracking ref moved"
fi
