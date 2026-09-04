#!/usr/bin/env bash
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# Runs as ROOT inside a throwaway image, and does the only two things root is for: install
# the tools the image does not ship, and stop being root.
#
# A REAL ADOPTER IS NOT ROOT. Half of what #186 found — `EACCES` on the global npm folder,
# `sudo` missing, a PATH edit landing in the wrong profile — only exists for a normal user
# with sudo. Running the suite as root would test a machine nobody has.
set -uo pipefail
echo "── preparing the image (${OS_TIER_LABEL}) ──"
# SHOW THE REASON. Swallowing this cost a debug cycle on the first run — Rocky's `curl`
# conflicts with the `curl-minimal` it ships, and the message that said so was thrown away.
# The same fault this suite exists to catch in gov.
if ! eval "${OS_TIER_DEPS}" > /tmp/deps.log 2>&1; then
  echo "could not install the image's own tools:"
  tail -20 /tmp/deps.log | sed 's/^/    /'
  exit 2
fi

id -u tester >/dev/null 2>&1 || useradd -m tester
echo 'tester ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/tester
chmod 0440 /etc/sudoers.d/tester

# /src is read-only, so the fragments write to a home the tester owns.
install -d -o tester -g tester /work
cp /tmp/gov.tgz /work/gov.tgz && chown tester:tester /work/gov.tgz

exec su - tester -c "OS_TIER_LABEL='${OS_TIER_LABEL}' OS_TIER_FRAGMENT='${OS_TIER_FRAGMENT:-}' bash /src/publish/actions/ts/e2e/os-run.sh"
