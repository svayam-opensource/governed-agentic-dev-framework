#!/usr/bin/env bats
# #102.9 — a project's manifest lives on the PROJECT BRANCH inside that project's
# own gov clone ($AGENT_WORK_ROOT/<id>/<workspace_repo>), not in the home checkout
# (which stays on the default branch). get_project_yaml / get_project_dir must
# resolve the per-project clone first, falling back to the home checkout. This is
# the gap that broke `add-repo` (it looked under the home checkout for a file that
# only exists on the branch).
load helpers
setup() {
  sandbox_up
  export WORKSPACE_REPO="svm-prj-work"
  export REPO_ROOT="$TEST_TMP/home-gov"          # the on-main home checkout
  mkdir -p "$REPO_ROOT/projects/PRJ-9-demo"
  : > "$REPO_ROOT/projects/PRJ-9-demo/project.yaml"
  CLONE="$AGENT_WORK_ROOT/PRJ-9-demo/$WORKSPACE_REPO/projects/PRJ-9-demo"
  source "$REPO_SRC/scripts/lib.sh"
}
teardown() { sandbox_down; }

@test "get_project_yaml prefers the per-project clone over the home checkout (#102.9)" {
  mkdir -p "$CLONE"; : > "$CLONE/project.yaml"   # the branch copy exists
  run get_project_yaml PRJ-9-demo
  assert_success
  assert_output "$CLONE/project.yaml"
}

@test "get_project_dir prefers the per-project clone over the home checkout (#102.9)" {
  mkdir -p "$CLONE"
  run get_project_dir PRJ-9-demo
  assert_success
  assert_output "$CLONE"
}

@test "get_project_yaml falls back to the home checkout when no clone exists (#102.9)" {
  run get_project_yaml PRJ-9-demo                # no clone created this test
  assert_success
  assert_output "$REPO_ROOT/projects/PRJ-9-demo/project.yaml"
}
