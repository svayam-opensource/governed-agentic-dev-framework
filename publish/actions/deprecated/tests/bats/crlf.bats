#!/usr/bin/env bats
# Windows / line-ending safety. Two kinds of protection:
#   (guard)     no tracked CLI/test file is committed with CRLF (.gitattributes
#               enforces LF; this catches a slip on any OS, incl. Windows CI).
#   (tolerance) the parsers survive CRLF in data/input anyway (defensive).
load helpers
setup() { sandbox_up; }
teardown() { sandbox_down; }

@test "no CRLF in tracked CLI / test files" {
  cd "$REPO_SRC"
  local cr bad
  cr=$(printf '\r')
  bad=$(git ls-files -- prj bin/prj '*.sh' '*.bash' '*.bats' '*.py' '*.yaml' '*.yml' \
            Jenkinsfile .framework-version 'tests/bats/golden/*' \
        | while IFS= read -r f; do [ -f "$f" ] && grep -Il "$cr" -- "$f" || true; done)
  if [ -n "$bad" ]; then echo "CRLF found in:"; echo "$bad"; return 1; fi
}

@test "bats @test names are ASCII (Windows bats mangles non-ASCII names)" {
  cd "$REPO_SRC"
  run python3 -c "
import glob
bad=[]
for f in glob.glob('tests/bats/*.bats'):
    for i,l in enumerate(open(f, encoding='utf-8'), 1):
        if l.startswith('@test ') and any(ord(c) > 127 for c in l):
            bad.append('%s:%d: %s' % (f, i, l.strip()))
print('\n'.join(bad))
"
  assert_success
  assert_output ""
}

@test "resolution tolerates a CRLF gov-workspace pointer file" {
  make_gov_repo "$TEST_TMP/gov"
  mkdir -p "$XDG_CONFIG_HOME/prj"
  printf '%s\r\n' "$TEST_TMP/gov" > "$XDG_CONFIG_HOME/prj/gov-workspace"
  cd /tmp
  run resolved_workspace
  assert_success
  assert_output "$TEST_TMP/gov"
}

@test "menu tolerates CRLF-piped input" {
  make_gov_repo "$TEST_TMP/gov"; export ADF_WORKSPACE="$TEST_TMP/gov"
  run bash -c "printf '4\r\n0\r\n0\r\n' | ADF_WORKSPACE='$ADF_WORKSPACE' bash '$PRJ_BIN'"
  assert_success
  assert_output --partial "Help — prj command-line use"
  assert_output --partial "Bye."
}
