# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# THE ADOPTER PATH ON WINDOWS, on the gov the MSI installed (PRJ-121 plan 04 T16; spec 04 §4.5, ruling Q11 B).
# Run by adopter-e2e / windows between the MSI's install and uninstall phases (packages/msi/test/install.Tests.ps1).
#
#   1. hermetic smoke: `gov setup --non-interactive` against the gh double (the machine path, I01.5)
#   2. REAL `gov agent install claude-code` — real npm, real registry: the #223 path that died with ENOENT
#   3. `claude --version` via the bin\ shim gov wrote, in a FRESH process (the #209 promise on Windows)
#
# Every command runs the way a new terminal would: machine PATH (any runner Node removed) + the user PATH read back
# from the registry, so nothing this job set up on its own PATH can make gov look reachable when it is not.
$ErrorActionPreference = 'Continue'   # native stderr is output to read, not an exception
$Root = Join-Path $env:LOCALAPPDATA 'Programs\gov'
$Bin = Join-Path $Root 'bin'
$Node = Join-Path $Root 'node'
$Here = $PSScriptRoot
$Content = (Resolve-Path (Join-Path $Here '..\..\..\..\content')).Path
$Work = Join-Path $env:RUNNER_TEMP 'adopter-windows'
$Stub = Join-Path $Work 'stub'
$script:Pass = 0; $script:Fail = 0
function Step([string]$s) { Write-Host "`n▶ $s" -ForegroundColor Cyan }
function Pass([string]$s) { Write-Host "  ✓ $s" -ForegroundColor Green; $script:Pass++ }
function Fail([string]$s) { Write-Host "  ✗ $s" -ForegroundColor Red; Write-Host "::error::$s"; $script:Fail++ }
function Check([bool]$ok, [string]$s, [string]$got = '') { if ($ok) { Pass $s } else { if ($got) { Write-Host "     got: $got" }; Fail $s } }

function Split-PathList([string]$p) { @(($p -split ';') | Where-Object { $_ }) }
function FreshPath([switch]$WithStub) {
  $machine = Split-PathList ([Environment]::GetEnvironmentVariable('Path', 'Machine')) |
    Where-Object { $_ -notmatch 'nodejs|\\node(\\|$)|nvm|hostedtoolcache' -and -not (Test-Path -LiteralPath (Join-Path $_ 'node.exe')) -and -not (Test-Path -LiteralPath (Join-Path $_ 'node.cmd')) }
  $user = Split-PathList ([Environment]::GetEnvironmentVariable('Path', 'User'))
  $all = @($machine) + @($user)
  if ($WithStub) { $all = @($Stub) + $all }
  $all -join ';'
}
# Run `line` through cmd.exe in a fresh-terminal environment; optional stdin text. Returns output + exit code.
function Fresh([string]$line, [string]$stdin = $null, [switch]$WithStub, [string]$Cwd = $Work) {
  $saved = $env:PATH; $savedLoc = Get-Location
  try {
    $env:PATH = FreshPath -WithStub:$WithStub
    Set-Location $Cwd
    if ($null -ne $stdin) { $out = $stdin | & cmd.exe /d /c $line 2>&1 } else { $out = & cmd.exe /d /c "$line < NUL" 2>&1 }
    $code = $LASTEXITCODE
    $text = ($out | ForEach-Object { "$_" }) -join "`n"
    Write-Host ($text -split "`n" | ForEach-Object { "    | $_" } | Out-String)
    return @{ Out = $text; Code = $code }
  } finally { $env:PATH = $saved; Set-Location $savedLoc }
}

New-Item -ItemType Directory -Force $Work, $Stub | Out-Null
Copy-Item (Join-Path $Here 'gh.cmd') (Join-Path $Stub 'gh.cmd')
# gov's own git commits in the workspace need an identity; the runner's HOME has none.
$env:GIT_AUTHOR_NAME = 'adopter-bot'; $env:GIT_AUTHOR_EMAIL = 'adopter-bot@example.invalid'
$env:GIT_COMMITTER_NAME = 'adopter-bot'; $env:GIT_COMMITTER_EMAIL = 'adopter-bot@example.invalid'
# The context gate (a human step) is answered once for the whole run, as GOV_YES does for every non-interactive tier.
$env:GOV_YES = '1'

Step 'a new terminal finds gov in bin\ and no node at all'
$r = Fresh 'where gov'
Check ($r.Code -eq 0 -and $r.Out.Trim() -eq (Join-Path $Bin 'gov.cmd')) 'gov resolves to bin\gov.cmd' $r.Out
$r = Fresh 'where node'
Check ($r.Code -ne 0) 'node is not on PATH — gov must bring its own' $r.Out

Step 'hermetic smoke: gov setup --non-interactive against the gh double'
$WS = Join-Path $Work 'adopter-gov'
Copy-Item -Recurse $Content $WS
git -C $WS init -q 2>&1 | Out-Null
git -C $WS remote add origin https://github.com/adopter-org/adopter-gov.git
@"
org_name: "Adopter Org"
org_short_name: "Adopter"
org_slug: "adopter"
"@ | Set-Content -Encoding utf8 (Join-Path $WS 'org-config.yaml')
$r = Fresh 'gov setup --non-interactive' -WithStub -Cwd $WS
$cfg = Get-Content -Raw (Join-Path $WS 'org-config.yaml')
Check ($cfg -match 'github_org: "adopter-org"') 'gov setup derived github_org from origin' $cfg
Check ($r.Out -match 'GOV-FRM-040') 'setup says why its changes land by a pull request (F17)' $r.Out

Step 'register the workspace (gov org add / use)'
# The org is the GitHub org setup derived from origin (gov org add <github_org> --home <path>).
$r = Fresh "gov org add adopter-org --home `"$WS`"" -WithStub
Check ($r.Code -eq 0) 'gov org add adopter-org' $r.Out
$r = Fresh 'gov org use adopter-org' -WithStub
Check ($r.Code -eq 0) 'gov org use adopter-org' $r.Out

Step 'REAL gov agent install claude-code (#223: npm is a .cmd — this died with ENOENT before T10)'
# Answers: Proceed? y — then the credential choice, 3 = skip (what is under test is the install and the shim).
$r = Fresh 'gov agent install claude-code' -stdin "y`n3`n" -WithStub
Check ($r.Code -eq 0) 'gov agent install claude-code exits 0' "exit $($r.Code)"
Check ($r.Out -notmatch 'ENOENT') 'no ENOENT anywhere in the install' $r.Out
Check (Test-Path (Join-Path $Node 'claude.cmd')) 'npm put claude.cmd beside gov''s Node (node\ is npm''s global prefix)'
Check (Test-Path (Join-Path $Bin 'claude.cmd')) 'gov wrote bin\claude.cmd — the one directory on the user PATH (#209 on Windows)'

Step 'claude --version via the bin\ shim, in a fresh process'
$r = Fresh 'where claude'
Check ($r.Code -eq 0 -and ($r.Out -split "`n")[0].Trim() -eq (Join-Path $Bin 'claude.cmd')) 'claude resolves to bin\claude.cmd' $r.Out
$r = Fresh 'claude --version'
Check ($r.Code -eq 0 -and $r.Out -match '\d+\.\d+\.\d+') 'claude --version runs from a new terminal' $r.Out

Write-Host "`n═══ adopter-windows: $($script:Pass) passed, $($script:Fail) failed ═══"
if ($script:Fail -gt 0) { exit 1 }
exit 0
