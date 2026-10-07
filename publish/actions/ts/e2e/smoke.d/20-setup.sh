# Given a cloned template, `gov setup` derives github_org/workspace_repo from origin.
mkdir -p "$WS"; cp -R "$CONTENT_DIR"/. "$WS"/
( cd "$WS" && git init -q && git config user.email a@b.c && git config user.name a \
  && git remote add origin https://github.com/adopter-org/adopter-gov.git )
cat > "$WS/org-config.yaml" <<YAML
org_name: "Adopter Org"
org_short_name: "Adopter"
org_slug: "adopter"
gov_workspace: "$WS"
YAML
SETUP_OUT="$( cd "$WS" && gov setup --non-interactive 2>&1 || true )"
grep -q 'github_org: "adopter-org"' "$WS/org-config.yaml" \
  && pass "gov setup derived github_org from origin" || fail "setup did not configure org-config"
# F17: in place, on the default branch, setup never leaves governance changes uncommitted on main with no word — it
# names GOV-FRM-040 and prints the branch / commit / PR commands (non-interactive: it commits nothing itself).
has "$SETUP_OUT" "GOV-FRM-040" "F17 — setup says why its changes land by a pull request"
has "$SETUP_OUT" "git switch -c gov-setup-" "F17 — setup prints the branch to put them on"
has "$SETUP_OUT" "gh pr create --base main --head gov-setup-" "F17 — and the pull request to open"
[ -z "$(git -C "$WS" log --oneline 2>/dev/null)" ] && pass "F17 — nothing was committed to the default branch" \
  || fail "F17 — setup committed on the default branch"
# F20: CODEOWNERS follows the owners setup just wrote, in the same change.
grep -q '@adopter-bot' "$WS/CODEOWNERS" 2>/dev/null && pass "F20 — CODEOWNERS regenerated for the Policy Owner setup named" \
  || fail "F20 — CODEOWNERS was not regenerated"
grep -q '<[A-Z_]*_OWNER_GITHUB>' "$WS/policies/authorized-representatives.md" 2>/dev/null \
  && fail "F19 — the role list still carries a raw token after setup" || pass "F19 — no raw token left in the role list"
