#!/usr/bin/env bash
# Run every tests/test_*.sh file. Exits 0 if all pass, 1 if any fail.
# Used locally and in CI.

cd "$(dirname "$0")" || { echo "Cannot cd to tests dir"; exit 2; }

GREEN='\033[0;32m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

TESTS=(test_*.sh)
TOTAL_FAIL=0
TOTAL_PASS=0
FAILED=()

echo ""
echo -e "${BOLD}Running ${#TESTS[@]} test file(s)${NC}"
echo "─────────────────────────────────────────"

for t in "${TESTS[@]}"; do
  echo ""
  echo -e "${CYAN}▶${NC} $t"
  if bash "$t"; then
    TOTAL_PASS=$((TOTAL_PASS + 1))
  else
    TOTAL_FAIL=$((TOTAL_FAIL + 1))
    FAILED+=("$t")
  fi
done

echo ""
echo "─────────────────────────────────────────"
if [[ "$TOTAL_FAIL" -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}All ${#TESTS[@]} test files passed.${NC}"
  exit 0
else
  echo -e "${RED}${BOLD}$TOTAL_FAIL of ${#TESTS[@]} test files FAILED:${NC}"
  for f in "${FAILED[@]}"; do
    echo -e "  ${RED}-${NC} $f"
  done
  exit 1
fi
