# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# gov upgrade — Windows (PowerShell 5.1 or newer). Brings gov (the client) AND your organization's governance
# repository up to the release this site serves (PRJ-121 F55, Policy Owner ruling A, 2026-11-12):
#
#   irm https://gov.svayamtech.com/upgrade.ps1 | iex
#
# 1. The client: this site's own install.ps1 (run as a child PowerShell, so its `exit` cannot end this script), which
#    installs or updates gov to the version the site pins — per user, nothing elevated.
# 2. The governance repository: `gov upgrade` shows what the release changes, then — if you agree —
#    `gov upgrade --pr` opens a pull request for you to review. Nothing is merged for you.
#
#   $env:GOV_YES = '1'             answer yes to every question
#   $env:GOV_UPGRADE_NO_PR = '1'   stop after showing the changes; open no pull request
#   $env:GOV_SITE_URL              the site to upgrade from (pinned by the site that serves this script)

$ErrorActionPreference = 'Stop'
$SiteUrl = if ($env:GOV_SITE_URL) { $env:GOV_SITE_URL.TrimEnd('/') } else { 'https://gov.svayamtech.com' }

function Say  ($m) { Write-Host $m }
function Step ($m) { Write-Host ""; Write-Host "==> $m" -ForegroundColor White }
function Die  ($m) { Write-Host ""; Write-Host "error: $m" -ForegroundColor Red; exit 1 }
function Confirm-Yes ($q) {
  if ($env:GOV_YES -eq '1') { return $true }
  if ([Console]::IsInputRedirected) { return $false }
  $a = Read-Host "  $q [y/N]"
  return ($a -match '^(y|yes)$')
}

Say "gov upgrade - from $SiteUrl"
Say "1. gov, the client: updated to the version this site serves (it asks before installing anything)."
Say "2. your governance repository: the changes shown first, then a pull request if you agree."

# ── 1. the client, through this site's own installer ──────────────────────────────────────────────────────────
Step "1. gov, the client"
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $script = Join-Path $tmp 'install.ps1'
  try { Invoke-WebRequest -UseBasicParsing -Uri "$SiteUrl/install.ps1" -OutFile $script }
  catch { Die "could not download $SiteUrl/install.ps1 ($($_.Exception.Message))" }
  if ((Get-Content -Raw $script) -match '^\s*<') { Die "$SiteUrl/install.ps1 is a web page, not a script - nothing was changed" }
  $env:GOV_NO_FIX = '1'   # the installer updates gov and reports; this script goes on
  $ps = (Get-Process -Id $PID).Path
  & $ps -NoProfile -ExecutionPolicy Bypass -File $script
  if ($LASTEXITCODE -ne 0) { Die "the installer stopped - gov was not upgraded (its output above says why)" }
} finally {
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  Remove-Item Env:\GOV_NO_FIX -ErrorAction SilentlyContinue
}

# The installer set gov on the USER PATH; this window started before that, so read it back in.
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + $env:Path
if (-not (Get-Command gov -ErrorAction SilentlyContinue)) { Die "gov is not on PATH after installing - open a new window and run: gov upgrade --pr" }
Say "  gov is now $((& gov --version) | Select-Object -First 1)"

# ── 2. the governance repository ──────────────────────────────────────────────────────────────────────────────
Step "2. your governance repository"
& gov upgrade
if ($LASTEXITCODE -ne 0) {
  Say ""
  Say "No governance repository could be upgraded from here - the client is upgraded."
  Say "From your organization's governance repository, run: gov upgrade --pr"
  exit 0
}
if ($env:GOV_UPGRADE_NO_PR -eq '1') { Say ""; Say "Stopped before the pull request (GOV_UPGRADE_NO_PR=1). To open it: gov upgrade --pr"; exit 0 }
Say ""
if (Confirm-Yes "Open these changes as a pull request now?") {
  & gov upgrade --pr
  Say ""; Say "Done. Review and merge the pull request; gov is upgraded."
} else {
  Say ""; Say "No pull request opened. When you are ready, from your governance repository: gov upgrade --pr"
}
