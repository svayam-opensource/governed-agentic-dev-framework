# SPDX-License-Identifier: MIT
# FINDING A POLICY WITHOUT KNOWING WHERE IT LIVES (PRJ-121, 2026-09-23).
#
# The old framework policy (§8.8) used to require a published portal: a site, PDF exports, a vector store. None of it shipped, so
# every adopter was non-compliant on the day they adopted. What replaces it is this: the knowledge is already
# cloned, so gov reads it. The scenario walks the two questions a person actually has — "what do we say about
# X?" and "show me that file" — and the one an agent has: the same answer as JSON.
scenario "74 · knowledge search reads the workspace — no portal, no index, no network"

REMOTE="$GIT_STUB_REMOTES/acme-gov"
make_gov_repo "$REMOTE" "acme" "ACME"

# The org's own policy, where an adopter's would be — and a project's knowledge, the other layer.
mkdir -p "$REMOTE/policies" "$REMOTE/projects/PRJ-7-billing/knowledge"
cat > "$REMOTE/policies/data-classification.md" <<'MD'
# Data classification

## Restricted (C01)
Restricted data must never be written to a log at any level or through any transport.
MD
cat > "$REMOTE/projects/PRJ-7-billing/knowledge/decisions.md" <<'MD'
# Decisions

## 2026-09-01 — invoices are retained for seven years
MD
( cd "$REMOTE" && git add -A && git -c user.email=e@x -c user.name=e commit -qm knowledge )

mkdir -p "$HOME/.gov"
printf 'acme\t%s\n' "$REMOTE" > "$HOME/.gov/workspaces"
printf 'acme\n' > "$HOME/.gov/active"

info "the question a person has: what do we say about restricted data?"
out="$(cd "$REMOTE" && gov knowledge search "restricted data" 2>&1)"
printf '%s\n' "$out" > "$WORLD/k-search.out"
grep -qF "policies/data-classification.md" "$WORLD/k-search.out" \
  && pass "it names the file that owns the subject" || { fail "it names the file that owns the subject"; cat "$WORLD/k-search.out"; }
grep -qF "Restricted (C01)" "$WORLD/k-search.out" \
  && pass "and the heading inside it — where in the document" || fail "and the heading inside it — where in the document"
grep -qF "never be written to a log" "$WORLD/k-search.out" \
  && pass "with the line that answers the question" || fail "with the line that answers the question"
grep -qF "gov knowledge show" "$WORLD/k-search.out" \
  && pass "and the command to read the whole thing" || fail "and the command to read the whole thing"

info "every layer is searched, not just the org's"
out="$(cd "$REMOTE" && gov knowledge search invoices 2>&1)"
printf '%s\n' "$out" | grep -qF "projects/PRJ-7-billing/knowledge/decisions.md" \
  && pass "a project's own knowledge is findable from the workspace" || fail "a project's own knowledge is findable from the workspace"

info "show opens it by the name alone — not only by the path search printed"
out="$(cd "$REMOTE" && gov knowledge show data-classification.md 2>&1)"
printf '%s\n' "$out" | grep -qF "never be written to a log" \
  && pass "the document is printed" || fail "the document is printed"

info "the agent's answer is the same answer, as data"
# STDOUT ALONE, and it must be nothing but JSON. The context banner is real output an agent will see, and it
# belongs on stderr — so `gov knowledge search --json | jq` works without a single filter. Merging the two
# streams here would have tested the opposite thing, and passed.
( cd "$REMOTE" && gov knowledge search "restricted data" --json >"$WORLD/k-json.out" 2>"$WORLD/k-json.err" )
# Parsed with node, which every image that runs gov has: debian:stable-slim ships no python3, and a missing
# interpreter read as "not pure JSON" there.
node -e 'const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); if (!d.results[0].path.endsWith("data-classification.md")) process.exit(1)' "$WORLD/k-json.out" 2>/dev/null \
  && pass "stdout is pure JSON, and ranks the owning document first" || { fail "stdout is pure JSON, and ranks the owning document first"; cat "$WORLD/k-json.out"; }

info "a miss is a dead end that offers the next move"
out="$(cd "$REMOTE" && gov knowledge search zzznothing 2>&1)"
printf '%s\n' "$out" | grep -qF "gov knowledge list" \
  && pass "it says what to try instead" || fail "it says what to try instead"

info "reading writes NOTHING — the cache was measured and removed (12ms saved, 5.5MB spent)"
[ ! -d "$HOME/.gov/acme/projects/preferences" ] || [ -z "$(find "$HOME/.gov/acme/projects/preferences" -name 'knowledge-index*' 2>/dev/null)" ] \
  && pass "no index was left behind" || fail "no index was left behind"
( cd "$REMOTE" && git diff --quiet && git diff --cached --quiet ) \
  && pass "and the workspace is untouched" || fail "and the workspace is untouched"
