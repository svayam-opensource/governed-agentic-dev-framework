#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# Guard against the one mistake install.sh has now made three times: calling a
# shell function that is defined further down the file.
#
# Bash resolves a function name when the call EXECUTES, not when the file is
# parsed — so `bash -n` is silent, and the script dies at runtime with
# "command not found". Under `set -e` that ends everything instantly, and the
# reader sees a blank prompt (`add_to_path`), or a message blaming them for a
# refusal they never made (`confirm`).
#
# So: find every function definition and every call, and fail when a call site
# appears above the definition it needs.

set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
for script in install.sh; do
  [ -f "$script" ] || continue

  # Definitions: `name() {` at the start of a line, with their line numbers.
  defs=$(grep -nE '^[a-z_][a-z0-9_]*\(\) *\{' "$script" | sed 's/(.*//' | tr -d ' ')

  while IFS=: read -r defline name; do
    [ -n "$name" ] || continue
    # Call sites: the bare word in command position, anywhere before the definition.
    # Deliberately crude — a false positive is a comment away, a false negative is
    # an installer that dies on someone's laptop.
    while IFS=: read -r callline _; do
      [ -n "$callline" ] || continue
      [ "$callline" -lt "$defline" ] || continue
      printf '%s:%s: calls `%s`, which is not defined until line %s\n' "$script" "$callline" "$name" "$defline" >&2
      fail=1
    done < <(grep -nE "(^|[;&|(]| )${name}( |$|\)|;)" "$script" \
             | grep -vE "^[0-9]+: *#" \
             | grep -vE "^${defline}:" \
             | grep -vE "^[0-9]+:[a-z_]*${name}\(\)" || true)
  done <<< "$defs"
done

if [ $fail -ne 0 ]; then
  echo "" >&2
  echo "A shell function must be defined ABOVE every line that calls it." >&2
  exit 1
fi
echo "install.sh: every function is defined before it is called"
