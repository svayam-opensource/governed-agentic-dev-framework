# SPDX-License-Identifier: MIT
# SCENARIO 48 — the founding adopter whose TEMPLATE is older than their gov (PRJ-121 intent 05, Item 7b).
#
# `gov setup <org>/<repo>` copies the framework TEMPLATE (its default branch) and then seeds the new repo from the
# content THIS gov carries. Everywhere else in this suite the two are the same tree, so nothing could see what the
# svm-geneva walk (2026-10-07) saw: the template's default branch was a release behind, setup judged "stray" root
# entries by the template copy's own publish/content/MANIFEST.yaml, and deleted the framework/ and policies/ the
# seed had just written. The adopter got the OLD layout. Fixed in d087f8e (strays judged by the SEEDED manifest).
#
# THE OLDER TEMPLATE IS NEVER HAND-MAINTAINED. It is `git archive` of this repository at the newest RELEASE tag whose
# shipped layout (the top level of every MANIFEST destination) differs from this checkout's — so it is always a real
# template an adopter could have been handed, and a release on the current layout does not quietly turn this into a
# same-tree test. Releases are tagged `gov-work-<semver>` (the old `v*` tags predate MANIFEST.yaml, which makes them
# blind to this defect). Needs the tags: CI's `journey` job checks out with full history.
#
# Proven both ways on the day it was written: against a local revert of d087f8e it fails (framework/ and policies/
# gone, governance/ back); on head it passes.
scenario "48 · adopter whose template is older than gov (seeded layout, not the template's)"

REPO_ROOT="$(cd "$TS_DIR/../../.." && pwd)"
layout_of() { grep -oE 'dst:[[:space:]]*[^[:space:],}]+' | sed -E 's/dst:[[:space:]]*//; s#/.*##' | sort -u | tr '\n' ' '; }
# `-c safe.directory=*`: in a CI container the checkout is owned by another uid, and this world's HOME is not the
# one actions/checkout marked safe.
rgit() { /usr/bin/env git -c safe.directory='*' -C "$REPO_ROOT" "$@"; }
HEAD_LAYOUT="$(layout_of < "$CONTENT_DIR/MANIFEST.yaml")"
OLD_TAG=""
for t in $(rgit tag -l 'gov-work-*' --sort=-v:refname 2>/dev/null); do
  m="$(rgit show "$t:publish/content/MANIFEST.yaml" 2>/dev/null)" || continue
  [ "$(printf '%s\n' "$m" | layout_of)" != "$HEAD_LAYOUT" ] && { OLD_TAG="$t"; break; }
done

if [ -z "$OLD_TAG" ]; then
  # NEVER A SILENT SKIP: no tags means the checkout is shallow, and a pass here would prove nothing.
  fail "no gov-work-* release tag with an older layout is reachable — fetch tags (git fetch --tags; CI: fetch-depth 0)"
else
  info "template = this repository at $OLD_TAG (layout: $(rgit show "$OLD_TAG:publish/content/MANIFEST.yaml" | layout_of))"
  OLD_TEMPLATE="$WORLD/template-$OLD_TAG"; mkdir -p "$OLD_TEMPLATE"
  rgit archive "$OLD_TAG" | tar -C "$OLD_TEMPLATE" -xf -
  export GH_STUB_TEMPLATE="$OLD_TEMPLATE"     # what `gh repo create --template` copies (stub/gh)
  export GH_STUB_LOGIN="acme" GH_STUB_GOVERNED=""

  # The same founding interview as 32 (no agents — this scenario is about the layout, not an install).
  drive "$(conv <<'C'
> Select \(A/B/C\)
< A
~ 240
> Q1 - What is full legal name
< Older Template Ltd
> Q2 - What is short name
<
> Q3 - What is the Github Organization ID
< acme
~ 240
> Q4 - What would you like the name of your new governance repo
< acme-gov
> Q5 - What would you like the identifier
< ACME
> Q6 - Default branch to be used for production
<
> Q7 - Default branch to be used for development
<
> Q8 - Who is the Policy Owner
< adopter
> Q9 - Who is the Check Owner
< adopter
> Q10 - What contact email
< adopter@acme.test
> Q11 - What governance posture
<
~ 240
> default for your organization
< none
> happy with this
< y
> Create it\? \[y/N\]
< y
~ 240
> review its policies now
< n
C
)" gov

  GOV_REPO="$HOME/.gov/acme/gov_repo"
  saw "the adoption completes" "Install complete — for ADOPTERS"

  info "the new repository has the layout THIS gov seeds, not the template's"
  exists "framework/ — the seed wrote it and it is still there" "$GOV_REPO/framework"
  exists "policies/governance.yaml — the org's governance file is in the current place" "$GOV_REPO/policies/governance.yaml"
  exists "the framework rules the current layout carries" "$GOV_REPO/framework/rules"
  [ ! -e "$GOV_REPO/governance" ] && pass "no governance/ — the older layout's root is not resurrected" \
    || fail "governance/ is in the new repository — it came out in $OLD_TAG's layout"
  [ ! -e "$GOV_REPO/publish" ] && pass "and the template's publish/ (the seed's source) is not left behind" \
    || fail "publish/ was left in the new repository"

  # Every root entry is one the SEEDED manifest produces (or setup generates) — the whole root, not a sample.
  expected=" $HEAD_LAYOUT .git CODEOWNERS "
  odd=""
  for path in "$GOV_REPO"/* "$GOV_REPO"/.[!.]*; do
    [ -e "$path" ] || continue
    e="${path##*/}"; case "$expected" in *" $e "*) ;; *) odd="$odd $e" ;; esac
  done
  [ -z "$odd" ] && pass "every root entry is one the seeded manifest produces" \
    || fail "root entries the seeded manifest does not produce:$odd"

  # NO `cmp` (diffutils): the rocky:9 image the interactive job runs in does not ship it, so `runs cmp -s` failed as
  # "command not found" while the two values printed identically below (run 38363809954, rocky only). Bash compares
  # the two files byte for byte on every image — $(<file) drops only trailing newlines, which neither side differs in.
  [ "$(<"$CONTENT_DIR/VERSION")" = "$(<"$GOV_REPO/VERSION")" ] \
    && pass "VERSION is the content this gov carries ($(cat "$CONTENT_DIR/VERSION"))" \
    || fail "VERSION is $(cat "$GOV_REPO/VERSION" 2>/dev/null || echo missing), gov carries $(cat "$CONTENT_DIR/VERSION")"

  # And it is COMMITTED that way — the working tree is not the thing the org's members will clone.
  for p in framework policies; do
    [ -n "$(git -C "$GOV_REPO" ls-files -- "$p" | head -1)" ] && pass "$p/ is in the first commit" \
      || fail "$p/ is not in the first commit"
  done
fi
