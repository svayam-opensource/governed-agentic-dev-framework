# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# gov bootstrap installer — Windows (PowerShell 5.1 or newer).
#
#   irm https://raw.githubusercontent.com/svayam-opensource/governed-agentic-dev-framework/main/install.ps1 | iex
#
# The Windows half of install.sh, and it makes the same promise: nothing is
# installed machine-wide and nothing is elevated. Node is unpacked from the
# official zip into the user's own profile, so it cannot collide with a Node the
# machine already has, and npm's global folder is inside that same tree — which is
# what removes the permission failure the Unix side hits as EACCES.

$ErrorActionPreference = 'Stop'

$NodeMajor = 24
# Overridable so a pre-release build can be tested through the SAME path an adopter
# takes: $env:GOV_PKG = 'C:\path\to\pkg.tgz'
$GovPkg    = if ($env:GOV_PKG) { $env:GOV_PKG } else { '@svayam-opensource/gov' }
$GovHome   = Join-Path $env:LOCALAPPDATA 'gov'
$NodeDir   = Join-Path $GovHome 'node'

function Say  ($m) { Write-Host $m }
function Step ($m) { Write-Host "==> $m" -ForegroundColor White }
function Ok   ($m) { Write-Host "  [ok] $m" -ForegroundColor Green }
function Skip ($m) { Write-Host "  [--] $m (already present)" -ForegroundColor DarkGray }
function Warn ($m) { Write-Host "  [!]  $m" -ForegroundColor Yellow }
function Die  ($m) { Write-Host "`nerror: $m" -ForegroundColor Red; exit 1 }

function Get-Arch {
  switch ($env:PROCESSOR_ARCHITECTURE) {
    'AMD64' { 'x64' }
    'ARM64' { 'arm64' }
    default { Die "unsupported CPU architecture: $env:PROCESSOR_ARCHITECTURE. Node $NodeMajor ships for x64 and arm64." }
  }
}

function Get-NodeMajor {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { return 0 }
  try { return [int]((& node -e 'process.stdout.write(process.versions.node.split(".")[0])') 2>$null) } catch { return 0 }
}

# PATH is set for the USER, not the machine — no elevation, and it survives reboots.
function Add-UserPath ($dir) {
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ($current -and ($current -split ';' | Where-Object { $_ -eq $dir })) {
    Skip "PATH entry"
  } else {
    [Environment]::SetEnvironmentVariable('Path', "$dir;$current", 'User')
    Ok "added to your PATH"
    $script:PathChanged = $true
  }
  $env:Path = "$dir;$env:Path"
}

function Install-Node ($arch) {
  $have = Get-NodeMajor
  if ($have -ge $NodeMajor) { Skip "Node $(& node -v)"; return }
  if (Test-Path (Join-Path $NodeDir 'node.exe')) {
    $env:Path = "$NodeDir;$env:Path"
    Skip "Node $(& node -v) (installed here previously)"
    return
  }
  if ($have -gt 0) { Warn "Node v$have is installed and too old — leaving it alone and installing Node $NodeMajor alongside it" }

  Step "Downloading Node $NodeMajor for win-$arch"
  $listing = (Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/latest-v$NodeMajor.x/").Content
  $m = [regex]::Match($listing, "node-v$NodeMajor\.[0-9.]+-win-$arch\.zip")
  if (-not $m.Success) { Die "no Node $NodeMajor build published for win-$arch" }
  $url = "https://nodejs.org/dist/latest-v$NodeMajor.x/$($m.Value)"

  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  $zip = Join-Path $tmp 'node.zip'
  Invoke-WebRequest -UseBasicParsing $url -OutFile $zip

  Step "Unpacking into $NodeDir"
  if (Test-Path $NodeDir) { Remove-Item -Recurse -Force $NodeDir }
  New-Item -ItemType Directory -Path $GovHome -Force | Out-Null
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  # The zip contains one top-level folder (node-vX.Y.Z-win-arch); lift it to $NodeDir
  # so the path we put on PATH never carries a version number in it.
  Move-Item (Get-ChildItem -Directory $tmp | Select-Object -First 1).FullName $NodeDir
  Remove-Item -Recurse -Force $tmp

  Add-UserPath $NodeDir
  Ok "Node $(& "$NodeDir\node.exe" -v)"
}

function Install-Gov {
  Step "Installing $GovPkg"
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Die "npm did not come with Node — the install is incomplete. Delete $NodeDir and re-run."
  }
  & npm install -g --silent $GovPkg
  if ($LASTEXITCODE -ne 0) { Die "npm could not install $GovPkg — the output above says why" }
  Ok "gov installed"
}

$script:PathChanged = $false
$arch = Get-Arch

Say ""
Say "gov installer - win-$arch"
Say "Nothing is installed machine-wide, and no administrator rights are needed."
Say ""

Step "Checking what you already have"
Install-Node $arch
Install-Gov

Say ""
Say "Done."
if ($script:PathChanged) {
  Say ""
  Warn "Open a NEW PowerShell window so that gov is on your PATH."
}
Say ""
Say "Then check your setup:"
Say "  gov doctor --fix    install Git and the GitHub CLI, and sign you in"
Say "  gov                 the menu - start here if you are new"
Say ""

# Hand over: show the report now, so the user sees a result rather than a prompt.
#
# Its exit code is deliberately DISCARDED. `gov doctor` exits 1 on a machine with
# no workspace configured yet — which is the correct report for someone who has
# just installed the tool and not run `gov setup`. Letting that become the
# installer's own exit code says "the install failed" about an install that
# succeeded, and in CI it fails the job. What this script reports on is the
# install; what doctor reports on is the machine.
if (Get-Command gov -ErrorAction SilentlyContinue) {
  Step "gov doctor"
  & gov doctor
  $global:LASTEXITCODE = 0
}
exit 0
