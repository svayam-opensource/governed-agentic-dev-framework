# SPDX-License-Identifier: MIT
# #211 — install.sh must not take the machine's own Node away from it.
#
# It used to PREPEND gov's private Node directory to the shell profile, on every image, even
# where the `~/.local/bin/gov` wrapper had just been proven to work. From the next terminal on,
# `node` meant gov's Node rather than the one the person had installed — against what the
# installer told them it would do ("leaving it alone and installing Node 24 alongside it").
#
# The ruling (Q13 B):
#   · the wrapper is proven (rocky, fedora — ~/.local/bin is on PATH) → the profile is not
#     touched at all; gov is reached through the wrapper, which carries its own Node.
#   · otherwise (debian, ubuntu) → ONE line is APPENDED, last in the file, so everything already
#     on PATH keeps precedence — and the output names the file in one line.
#
# A machine with its own Node is the only shape that can tell prepend from append, so this
# fragment gives the image one: a too-old `node` in /usr/bin, which install.sh must leave alone
# and install Node 24 beside. /usr/bin, not /usr/local/bin: on rocky the tester's login PATH
# (sudo's secure_path) has no /usr/local/bin, and none of these images ships a node of its own.
scenario "93 · the machine's own Node keeps its place on PATH (#211) (${OS_TIER_LABEL})"

MACHINE_NODE=/usr/bin/node
cat > /work/machine-node <<'N'
#!/bin/sh
# The machine's own Node, too old for gov — a stand-in for a distro's Node 18.
case "$1" in
  -v|--version) echo v18.20.0 ;;
  -e) printf 18 ;;
  *) echo "the machine's own node" ;;
esac
N
sudo install -m 0755 /work/machine-node "$MACHINE_NODE"

PROFILES=("$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile" "$HOME/.zshrc")
snapshot() { for p in "${PROFILES[@]}"; do printf '%s %s\n' "$p" "$( [ -f "$p" ] && cksum < "$p" || echo absent)"; done; }
profiles_before="$(snapshot)"

drive "$(conv <<'C'
~ 180
> Do you want to continue \(y/N\)\?
< n
> Continue now\? \[Y/n\]
< n
C
)" env GOV_PKG=/work/gov.tgz GOV_NODE_TARBALL=/work/node.tar.gz GOV_YES=1 bash /src/install.sh

if require_gov "where the machine's own Node sits on PATH"; then
  NODEBIN="$HOME/.local/share/gov/node/bin"
  says "the too-old Node is left alone, and the installer says so" "leaving it alone"

  # THE QUESTION #211 IS ABOUT, on every image: which `node` does tomorrow's terminal get?
  login_node="$(bash -lc 'command -v node' 2>/dev/null </dev/null)"
  # readlink -f: on a merged /usr the same file is /bin/node, /usr/sbin/node or /usr/bin/node,
  # depending on which PATH entry comes first.
  [ -n "$login_node" ] && [ "$(readlink -f "$login_node")" = "$(readlink -f "$MACHINE_NODE")" ] \
    && pass "#211 — a new login shell still finds the machine's own node ($MACHINE_NODE)" \
    || { fail "#211 — a new login shell finds a different node"; printf '%s     got: %s%s\n' "$DIM" "${login_node:-nothing}" "$RST"; }

  if [ -x "$HOME/.local/bin/gov" ]; then
    info "the wrapper is proven here (~/.local/bin is on PATH) — the profile must be untouched"
    profiles_after="$(snapshot)"
    [ "$profiles_before" = "$profiles_after" ] \
      && pass "#211 — no shell profile was changed" \
      || { fail "#211 — a shell profile was edited although the wrapper works"; printf '%s     before:\n%s\n     after:\n%s%s\n' "$DIM" "$profiles_before" "$profiles_after" "$RST"; }
    never "and nothing on screen claims a PATH edit" "to PATH at the end of"
    in_a_new_login_shell "gov --version" \
      && pass "gov runs in a new login shell, through the wrapper" \
      || fail "gov is not runnable in a new login shell"
  else
    info "no wrapper here (~/.local/bin is not on PATH) — one line appended, and named"
    changed=""
    for p in "${PROFILES[@]}"; do
      b="$(grep -F "$p " <<<"$profiles_before")"; a="$(grep -F "$p " <<<"$(snapshot)")"
      [ "$b" != "$a" ] && changed="$changed $p"
    done
    changed="${changed# }"
    case "$changed" in
      "") fail "#211 — no profile was edited, and there is no wrapper either" ;;
      *" "*) fail "#211 — more than one profile was edited: $changed" ;;
      *)
        pass "exactly one profile was edited: ${changed/#$HOME/~}"
        last="$(grep -v '^[[:space:]]*$' "$changed" | tail -1)"
        # gov's own wrapper folder, then its Node — both AFTER everything already on PATH.
        [ "$last" = "export PATH=\"\$PATH:$HOME/.local/share/gov/bin:$NODEBIN\"" ] \
          && pass "#211 — the PATH line is APPENDED (\$PATH first) and is the last line of the file" \
          || { fail "#211 — the last line of the profile is not the appended PATH line"; printf '%s     got: %s%s\n' "$DIM" "$last" "$RST"; }
        tilded="~${changed#"$HOME"}"
        grep -F -- "$tilded" "$PLAIN" | grep -q PATH \
          && pass "and the output names the file in one line ($tilded)" \
          || fail "the output does not name $tilded on a PATH line"
        ;;
    esac
    in_a_new_login_shell "gov --version" \
      && pass "gov runs in a new login shell, through the appended line" \
      || fail "gov is not runnable in a new login shell"
  fi
fi

# Not part of the next scenario's machine.
sudo rm -f "$MACHINE_NODE"
