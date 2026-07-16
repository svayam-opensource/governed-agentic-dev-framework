#!/usr/bin/env bash
# schedules — install/inspect the catalog's scheduled deploys as cron jobs (#75/S5d).
# Reads knowledge/deployment/catalog/services.yaml `schedules:`; each {cron, job} becomes
# a crontab line running `./prj deploy …`. Idempotent via the `# svm-deploy` marker.
#
#   schedules list       # show the generated crontab lines (incl. SKIPPED notes)
#   schedules install    # write the runnable lines into YOUR crontab (replaces prior svm-deploy)
#   schedules uninstall  # remove svm-deploy lines from your crontab
#
# Per-human: cron runs on the machine where you install it, as you, using YOUR Jenkins creds.
set -euo pipefail
SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
CATALOG="python3 $SELF_DIR/catalog.py"
MARKER="# svm-deploy"

cmd_list() { $CATALOG schedules; }

# Only the runnable crontab lines (drop the SKIPPED/# notes).
_runnable() { $CATALOG schedules | grep -vE "^${MARKER}" || true; }

cmd_install() {
  local lines; lines=$(_runnable)
  if [[ -z "$lines" ]]; then echo "No runnable schedules in the catalog — nothing to install."; return 0; fi
  local existing; existing=$(crontab -l 2>/dev/null | grep -v "$MARKER" || true)
  printf '%s\n%s\n' "$existing" "$lines" | sed '/^$/d' | crontab -
  echo "Installed $(echo "$lines" | grep -c .) scheduled deploy(s) into your crontab. Verify: crontab -l | grep '$MARKER'"
}

cmd_uninstall() {
  local existing; existing=$(crontab -l 2>/dev/null | grep -v "$MARKER" || true)
  printf '%s\n' "$existing" | sed '/^$/d' | crontab -
  echo "Removed svm-deploy schedules from your crontab."
}

case "${1:-}" in
  list)      cmd_list ;;
  install)   cmd_install ;;
  uninstall) cmd_uninstall ;;
  *) echo "Usage: schedules.sh {list|install|uninstall}" >&2; exit 1 ;;
esac
