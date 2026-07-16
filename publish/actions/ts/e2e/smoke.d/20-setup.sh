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
( cd "$WS" && gov setup --non-interactive >/dev/null 2>&1 || true )
grep -q 'github_org: "adopter-org"' "$WS/org-config.yaml" \
  && pass "gov setup derived github_org from origin" || fail "setup did not configure org-config"
