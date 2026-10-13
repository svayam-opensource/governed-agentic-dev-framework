# `gov setup --join <github_org>/<repo>` — the JOINER's machine path (PRJ-121 intent 05, Item 4, ruling Q5): with no
# terminal, clone an org's governance repo to ~/.gov/<slug>/gov_repo, register it and make it active, asking nothing.
# The live joiner journey (e2e/joiner-journey.sh) runs exactly this as a second identity; here it runs hermetically,
# against a local "GitHub" (a bare repo) that a gh shim clones from, in a HOME of its own.
JREMOTES="$WORK/join-remotes"; JBIN="$WORK/join-bin"; JHOME="$WORK/joiner-home"
mkdir -p "$JREMOTES" "$JBIN" "$JHOME"
# The governed repo: the workspace 20-setup configured, committed (setup itself commits nothing on main — F17).
JSRC="$WORK/join-src"; cp -R "$WS" "$JSRC"
( cd "$JSRC" && git add -A && git commit -qm "governed" ) >/dev/null 2>&1
git clone -q --bare "$JSRC" "$JREMOTES/adopter-gov.git" 2>/dev/null
# …and an ungoverned one (no org-config.yaml), which --join must refuse rather than found.
JBARE="$WORK/join-bare-src"; mkdir -p "$JBARE" && ( cd "$JBARE" && git init -q && echo x > README.md && git add -A && git commit -qm x ) >/dev/null 2>&1
git clone -q --bare "$JBARE" "$JREMOTES/bare-repo.git" 2>/dev/null
cat > "$JBIN/gh" <<GH
#!/usr/bin/env bash
if [ "\$1 \$2" = "repo clone" ]; then git clone -q "$JREMOTES/\${3##*/}.git" "\$4" && exit 0; exit 1; fi
exec "$BIN/gh" "\$@"
GH
chmod +x "$JBIN/gh"
JOIN_OUT="$(HOME="$JHOME" PATH="$JBIN:$PATH" gov setup --join adopter-org/adopter-gov </dev/null 2>&1)"; JOIN_RC=$?
[ "$JOIN_RC" -eq 0 ] && pass "gov setup --join exits 0 with no terminal" || { echo "$JOIN_OUT" | tail -8; fail "gov setup --join exited $JOIN_RC"; }
has "$JOIN_OUT" "Joining adopter-org." "it joins, and says whose org it is"
[ -f "$JHOME/.gov/adopter/gov_repo/org-config.yaml" ] && pass "cloned to ~/.gov/<slug>/gov_repo" || fail "no clone at ~/.gov/adopter/gov_repo"
has "$(HOME="$JHOME" gov org list 2>&1)" "adopter-org" "registered — gov org list shows it"
has "$(cat "$JHOME/.gov/active" 2>/dev/null)" "adopter-org" "and made active"
case "$JOIN_OUT" in *"[Y/n]"*|*"Select (A/B/C)"*|*"start work now"*) fail "--join asked or offered something" ;; *) pass "nothing asked, nothing offered" ;; esac
JHOME2="$WORK/joiner-home-2"; mkdir -p "$JHOME2"
BARE_OUT="$(HOME="$JHOME2" PATH="$JBIN:$PATH" gov setup --join adopter-org/bare-repo </dev/null 2>&1)" \
  && fail "--join accepted a repo with no org-config.yaml" || has "$BARE_OUT" "no org-config.yaml" "an ungoverned repo is refused, not founded"
[ -z "$(ls -A "$JHOME2/.gov" 2>/dev/null | grep -v '^logs$')" ] && pass "and nothing was registered" || fail "the refused join left state in ~/.gov: $(ls -A "$JHOME2/.gov")"
