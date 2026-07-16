#!/usr/bin/env bash
# Verify every shell/python/CLI script in the repo is committed with mode 100755.
# Catches the regression where setup.sh and scripts/install-deps.sh were
# accidentally committed as 100644.

TEST_NAME="exec_bits"
source "$(dirname "$0")/lib.sh"

# Files we expect to be executable
EXPECTED_EXEC=(
  "prj"
  "setup.sh"
  "scripts/install-deps.sh"
  "scripts/lib.sh"
  "scripts/seed.sh"
  "scripts/add-repo.sh"
  "scripts/pause.sh"
  "scripts/resume.sh"
  "scripts/sync.sh"
  "scripts/cancel.sh"
  "scripts/close-project.sh"
  "scripts/close-knowledge.sh"
  "scripts/create-task.sh"
  "scripts/merge-task.sh"
  "scripts/propose-knowledge.sh"
  "scripts/onboard-repo.sh"
  "scripts/test-merge.sh"
  "scripts/sync-from-publish.sh"
  "scripts/release-to-public.sh"
  "scripts/validate/run.py"
  "scripts/validate/check_privacy.py"
)

cd "$REPO_ROOT" || { t_fail "Cannot cd to REPO_ROOT"; exit 1; }

for f in "${EXPECTED_EXEC[@]}"; do
  if [[ ! -f "$f" ]]; then
    t_skip "$f does not exist on this branch"
    continue
  fi
  mode=$(git ls-files -s -- "$f" | awk '{print $1}')
  assert_eq "100755" "$mode" "$f mode is 100755"
done
