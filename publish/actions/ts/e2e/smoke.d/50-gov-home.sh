# --gov-home overrides cwd-based resolution (Gap-2), regardless of cwd.
has "$(gov doctor --gov-home "$WS" 2>&1 || true)" "adopter-gov" "gov doctor --gov-home resolves the workspace"
has "$(cd /tmp && gov doctor --gov-home "$WS" 2>&1 || true)" "resolved" "--gov-home overrides cwd resolution"
