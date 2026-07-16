#!/usr/bin/env bats
# #109 — on-demand member-repo materialization (scripts/deploy/materialize-repo.sh).
#
# A catalog hook's logic (and the facts `catalog build` derives) live in a member
# repo that may not be cloned into the project. materialize-repo.sh brings it in
# on demand: local -> worktree of the project branch (reusing a sibling); other
# envs -> worktree of the code branch in a per-env folder. Hermetic: a local bare
# repo stands in for the remote (file:// URL), no network.
load helpers

MAT="$REPO_SRC/scripts/deploy/materialize-repo.sh"

setup() {
  sandbox_up
  # A fake "remote": bare repo on the code branch 'dev' with a hook script.
  REMOTE_BARE="$TEST_TMP/remote/Acme/991-LIB.git"
  mkdir -p "$(dirname "$REMOTE_BARE")"
  git init -q --bare -b dev "$REMOTE_BARE"
  local seed="$TEST_TMP/seed"
  git init -q -b dev "$seed"
  mkdir -p "$seed/scripts"; echo 'echo HOOK-RAN' > "$seed/scripts/hook.sh"
  git -C "$seed" add -A; git -C "$seed" commit -qm init
  git -C "$seed" remote add origin "$REMOTE_BARE"; git -C "$seed" push -q origin dev
  REMOTE="file://$REMOTE_BARE"

  # A fake workspace clone on a project branch, with an org-config the script reads.
  WS="$AGENT_WORK_ROOT/PRJ-99/svm-prj-work"; mkdir -p "$WS"
  git init -q -b BRNCH-99 "$WS"
  cat > "$WS/org-config.yaml" <<YAML
github_org: "Acme"
default_code_branch: dev
agent_work_root: "$AGENT_WORK_ROOT"
org_slug_lower: "acme"
YAML
  git -C "$WS" add -A; git -C "$WS" commit -qm ws
}
teardown() { sandbox_down; }

@test "materialize: dev env clones into a per-env folder on the code branch" {
  run bash "$MAT" "$REMOTE" dev "$WS"
  assert_success
  local dir="$output"
  [ -f "$dir/scripts/hook.sh" ]
  assert_equal "$(git -C "$dir" rev-parse --abbrev-ref HEAD)" "prj-env/dev"
  [[ "$dir" == "$AGENT_WORK_ROOT/.envs/dev/991-LIB" ]]
}

@test "materialize: same upstream branch in two envs coexists (no 'already checked out')" {
  run bash "$MAT" "$REMOTE" dev "$WS"; assert_success; local d1="$output"
  run bash "$MAT" "$REMOTE" uat "$WS"; assert_success; local d2="$output"
  [ -f "$d1/scripts/hook.sh" ] && [ -f "$d2/scripts/hook.sh" ]
  [ "$d1" != "$d2" ]
  # One shared base clone backs both worktrees.
  [ -d "$AGENT_WORK_ROOT/.bases/991-LIB/.git" ]
}

@test "materialize: local reuses an existing project sibling" {
  local sib="$AGENT_WORK_ROOT/PRJ-99/991-LIB"
  git clone -q "$REMOTE" "$sib"
  run bash "$MAT" "$REMOTE" local "$WS"
  assert_success
  assert_output "$sib"
}

@test "materialize: local with no sibling materializes (project branch absent -> code branch)" {
  run bash "$MAT" "$REMOTE" local "$WS"
  assert_success
  [ -f "$output/scripts/hook.sh" ]
}

@test "materialize: offline re-run (PRJ_NO_PULL=1) returns the cached worktree" {
  run bash "$MAT" "$REMOTE" dev "$WS"; assert_success; local d1="$output"
  run env PRJ_NO_PULL=1 bash "$MAT" "$REMOTE" dev "$WS"
  assert_success
  assert_output "$d1"
  [ -f "$output/scripts/hook.sh" ]
}

@test "materialize: owner/name (no URL) builds a github URL from github_org" {
  # No such repo on github from the sandbox — assert it TRIED that URL, not a crash.
  run bash "$MAT" "Acme/nonexistent-xyz" dev "$WS"
  assert_failure
  assert_output --partial "git@github.com:Acme/nonexistent-xyz.git"
}
