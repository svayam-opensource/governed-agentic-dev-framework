#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# green-streak.sh <branch> [n=3] — is adopter-e2e GREEN on <branch>, n times in a row? Computed, never read off a
# summary line (PRJ-121 intent 05, I05.1; Policy Owner rulings Q1 and Q2, 2026-10-12).
#
# Walks the branch's adopter-e2e runs newest first and counts consecutive runs that are green. A run counts only if:
#   • its event is workflow_dispatch (Q1: the proof is manual dispatches; any other run in between breaks the streak)
#   • it is on the same head commit as the newest counted run (Q1: a new commit resets the streak to 0)
#   • attempt 1 — a re-run is a retry, and "no retries" (I05.1)
#   • the run concluded success, and EVERY job concluded success — read from the run's jobs, not from the run
#     (on a dispatch every job is enabled, so a skipped job is a failure: no job is exempt for this event)
#   • no step in any job was skipped (a skipped live journey is a skipped step)
#   • no annotation on any job says "skipped" or "incomplete" (a skipped assertion: rule-model-journey.sh's skip(),
#     live-verdict.sh's "incomplete", live-guard.sh's visible skip)
# Runs not yet completed are listed and not counted. Prints one line per run it looked at, then STREAK k/n.
# Exit 0 only when k reaches n; 1 otherwise; 2 on a usage or gh error.
#
#   GREEN_STREAK_REPO   owner/repo (default svayam-opensource/governed-agentic-dev-framework)
#   GREEN_STREAK_LIMIT  how many runs to list (default 50)
set -euo pipefail

BRANCH="${1:-}"; N="${2:-3}"
if [ -z "$BRANCH" ] || ! [[ "$N" =~ ^[1-9][0-9]*$ ]]; then
  echo "usage: green-streak.sh <branch> [n=3]" >&2; exit 2
fi
REPO="${GREEN_STREAK_REPO:-svayam-opensource/governed-agentic-dev-framework}"
WORKFLOW="adopter-e2e.yml"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# JSON is read with node — present wherever gov is built — so the script needs nothing gh does not already need.
js() { node -e "$1" "${@:2}"; }

gh run list -R "$REPO" --workflow "$WORKFLOW" --branch "$BRANCH" -L "${GREEN_STREAK_LIMIT:-50}" \
  --json databaseId,headSha,conclusion,attempt,event,status >"$TMP/runs.json" \
  || { echo "green-streak: gh run list failed for $REPO $BRANCH" >&2; exit 2; }

# One tab-separated row per run, newest first: id sha event status conclusion attempt.
js 'for (const r of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")))
      console.log([r.databaseId, r.headSha, r.event, r.status, r.conclusion || "-", r.attempt ?? 1].join("\t"))' "$TMP/runs.json" >"$TMP/rows.tsv"

count=0; sha=""
while IFS=$'\t' read -r id head event status conclusion attempt; do
  short="${head:0:7}"
  if [ "$status" != "completed" ]; then
    printf '%s %s %s %s — in progress, not counted\n' "$id" "$short" "$event" "$status"; continue
  fi
  why=""
  if [ "$event" != "workflow_dispatch" ]; then why="event $event (only manual dispatches count)"
  elif [ -n "$sha" ] && [ "$head" != "$sha" ]; then why="different commit ($short, not ${sha:0:7}) — the streak restarts on a new commit"
  elif [ "$attempt" != "1" ]; then why="attempt $attempt — a re-run is a retry"
  fi
  if [ -z "$why" ]; then
    gh run view "$id" -R "$REPO" --json jobs,conclusion,attempt >"$TMP/view.json" \
      || { echo "green-streak: gh run view $id failed" >&2; exit 2; }
    # Every job, every step: every reason found, joined. Prints nothing for a clean run.
    why="$(js 'const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      const bad = [];
      if ((v.attempt ?? 1) !== 1) bad.push(`attempt ${v.attempt} — a re-run is a retry`);
      if (!v.jobs || v.jobs.length === 0) bad.push("no jobs reported");
      for (const j of v.jobs || []) {
        if (j.conclusion !== "success") bad.push(`job "${j.name}" ${j.conclusion || j.status}`);
        for (const s of j.steps || []) if (s.conclusion === "skipped") bad.push(`job "${j.name}" step skipped: ${s.name}`);
      }
      process.stdout.write(bad.join("; "));' "$TMP/view.json")"
    if [ -z "$why" ]; then
      rm -f "$TMP"/ann-*.json
      while read -r jid; do
        [ -n "$jid" ] || continue
        gh api "repos/$REPO/check-runs/$jid/annotations" >"$TMP/ann-$jid.json" 2>/dev/null || echo '[]' >"$TMP/ann-$jid.json"
      done < <(js 'for (const j of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).jobs || []) console.log(j.databaseId)' "$TMP/view.json")
      hit="$(js 'const fs = require("fs"), path = require("path");
        for (const f of fs.readdirSync(process.argv[1]).filter((n) => /^ann-\d+\.json$/.test(n))) {
          let a; try { a = JSON.parse(fs.readFileSync(path.join(process.argv[1], f), "utf8") || "[]"); } catch { a = []; }
          const m = (Array.isArray(a) ? a : []).find((x) => /\b(skipped|incomplete)\b/i.test(x.message || ""));
          if (m) { process.stdout.write(m.message.split("\n")[0]); break; }
        }' "$TMP")"
      [ -n "$hit" ] && why="annotation: $hit"
    fi
    # The jobs name the failure; the run's own conclusion is the last word when they do not.
    [ -z "$why" ] && [ "$conclusion" != "success" ] && why="run concluded $conclusion"
  fi
  if [ -n "$why" ]; then
    printf '%s %s %s attempt=%s BREAK: %s\n' "$id" "$short" "$event" "$attempt" "$why"; break
  fi
  sha="$head"; count=$((count + 1))
  printf '%s %s %s attempt=%s OK (every job success, nothing skipped)\n' "$id" "$short" "$event" "$attempt"
  [ "$count" -ge "$N" ] && break
done <"$TMP/rows.tsv"

echo "STREAK $count/$N${sha:+ on ${sha}}"
[ "$count" -ge "$N" ]
