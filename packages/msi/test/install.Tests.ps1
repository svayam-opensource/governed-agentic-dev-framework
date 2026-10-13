# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# THE MSI ON A REAL WINDOWS MACHINE (PRJ-121 plan 04 T13; run by adopter-e2e / windows, T16). Pester 5.
#
#   $env:GOV_MSI              the .msi to test (required)
#   $env:GOV_MSI_VERSION      the gov version it carries (required)
#   $env:GOV_MSI_SIGNER       when set, the signature must be Valid and its subject must match this (e.g. 'CN=Svayam')
#
# Two phases, by tag, so a job can do real work between them on the installed gov:
#   Invoke-Pester -Path install.Tests.ps1 -Tag Install      install per-user, assert the shape
#   Invoke-Pester -Path install.Tests.ps1 -Tag Uninstall    uninstall, assert everything ours is gone and ~/.gov is kept
#
# "A new process" = the PATH a terminal opened after the install would get: the machine PATH (with any Node the
# runner ships removed) plus the USER PATH read back from the registry — never the PATH this test started with.

BeforeDiscovery {
  if (-not $env:GOV_MSI) { throw 'GOV_MSI is not set' }
}

BeforeAll {
  $script:Msi = (Resolve-Path $env:GOV_MSI).Path
  $script:Root = Join-Path $env:LOCALAPPDATA 'Programs\gov'
  $script:Bin = Join-Path $script:Root 'bin'
  $script:GovHome = Join-Path $env:USERPROFILE '.gov'

  function script:Split-PathList([string]$p) { @(($p -split ';') | Where-Object { $_ } | ForEach-Object { $_.TrimEnd('\') }) }
  function script:UserPath { [Environment]::GetEnvironmentVariable('Path', 'User') }
  function script:FreshPath {
    $machine = Split-PathList ([Environment]::GetEnvironmentVariable('Path', 'Machine')) |
      Where-Object { $_ -notmatch 'nodejs|\\node(\\|$)|nvm|hostedtoolcache' -and -not (Test-Path -LiteralPath (Join-Path $_ 'node.exe')) -and -not (Test-Path -LiteralPath (Join-Path $_ 'node.cmd')) }
    (@($machine) + @(Split-PathList (UserPath))) -join ';'
  }
  # Run a command line the way a new terminal would, and return its output and exit code.
  function script:Invoke-Fresh([string]$line, [string]$shell = 'cmd') {
    $saved = $env:PATH
    try {
      $env:PATH = FreshPath
      if ($shell -eq 'cmd') { $out = & cmd.exe /d /c $line 2>&1 }
      else { $out = & powershell.exe -NoProfile -ExecutionPolicy Restricted -Command $line 2>&1 }
      return @{ Out = ($out | Out-String).Trim(); Code = $LASTEXITCODE }
    } finally { $env:PATH = $saved }
  }
  function script:ProductCode {
    $i = New-Object -ComObject WindowsInstaller.Installer
    $db = $i.GetType().InvokeMember('OpenDatabase', 'InvokeMethod', $null, $i, @($script:Msi, 0))
    $v = $db.GetType().InvokeMember('OpenView', 'InvokeMethod', $null, $db, @("SELECT Value FROM Property WHERE Property='ProductCode'"))
    $v.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $v, $null) | Out-Null
    $r = $v.GetType().InvokeMember('Fetch', 'InvokeMethod', $null, $v, $null)
    $r.GetType().InvokeMember('StringData', 'GetProperty', $null, $r, 1)
  }
  function script:MsiProperty([string]$name) {
    $i = New-Object -ComObject WindowsInstaller.Installer
    $db = $i.GetType().InvokeMember('OpenDatabase', 'InvokeMethod', $null, $i, @($script:Msi, 0))
    $v = $db.GetType().InvokeMember('OpenView', 'InvokeMethod', $null, $db, @("SELECT Value FROM Property WHERE Property='$name'"))
    $v.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $v, $null) | Out-Null
    $r = $v.GetType().InvokeMember('Fetch', 'InvokeMethod', $null, $v, $null)
    if ($null -eq $r) { return $null }
    $r.GetType().InvokeMember('StringData', 'GetProperty', $null, $r, 1)
  }
  function script:Msiexec([string[]]$msiArgs, [string]$log) {
    $p = Start-Process msiexec.exe -ArgumentList ($msiArgs + @('/l*v', "`"$log`"")) -Wait -PassThru
    return $p.ExitCode
  }
}

Describe 'gov MSI — install (per-user)' -Tag Install {
  BeforeAll {
    $script:PathBefore = Split-PathList (UserPath)
    $script:InstallCode = Msiexec @('/i', "`"$script:Msi`"", '/qn') (Join-Path $env:RUNNER_TEMP 'gov-msi-install.log')
  }

  It 'is a per-user package: no elevation asked for, nothing machine-wide' {
    MsiProperty 'ALLUSERS' | Should -BeNullOrEmpty
    # Summary information, Word Count bit 3 (8): "elevated privileges are not required to install this package".
    $i = New-Object -ComObject WindowsInstaller.Installer
    $si = $i.GetType().InvokeMember('SummaryInformation', 'GetProperty', $null, $i, @($script:Msi, 0))
    $wc = $si.GetType().InvokeMember('Property', 'GetProperty', $null, $si, @(15))
    ($wc -band 8) | Should -Be 8
  }

  It 'installs with exit code 0' { $script:InstallCode | Should -Be 0 }

  It 'is registered as installed for this user only (AssignmentType 0)' {
    $i = New-Object -ComObject WindowsInstaller.Installer
    $code = ProductCode
    $i.GetType().InvokeMember('ProductInfo', 'GetProperty', $null, $i, @($code, 'AssignmentType')) | Should -Be '0'
  }

  It 'lays down node\, app\, bin\ under %LOCALAPPDATA%\Programs\gov' {
    Join-Path $script:Root 'node\node.exe' | Should -Exist
    Join-Path $script:Root 'node\npm.cmd' | Should -Exist
    Join-Path $script:Root 'app\package.json' | Should -Exist
    Join-Path $script:Root 'app\node_modules' | Should -Exist
    Join-Path $script:Bin 'gov.cmd' | Should -Exist
  }

  It 'bin\ holds only the launcher' {
    @(Get-ChildItem $script:Bin | ForEach-Object Name) | Should -Be @('gov.cmd')
  }

  It 'adds exactly one directory to the user PATH: bin\ (never node\)' {
    $after = Split-PathList (UserPath)
    $added = @($after | Where-Object { $script:PathBefore -notcontains $_ })
    $added | Should -Be @($script:Bin)
    @($after | Where-Object { $_ -like "*\Programs\gov\node*" }) | Should -BeNullOrEmpty
  }

  It 'a new terminal has no node — only gov' {
    (Invoke-Fresh 'where node').Code | Should -Not -Be 0
    (Invoke-Fresh 'where gov').Out | Should -Be (Join-Path $script:Bin 'gov.cmd')
  }

  It 'gov --version runs in a new process, from bin\ only' {
    $r = Invoke-Fresh 'gov --version'
    $r.Code | Should -Be 0
    $r.Out | Should -Match ([regex]::Escape($env:GOV_MSI_VERSION))
  }

  It 'gov --version runs from Windows PowerShell under the default Restricted execution policy' {
    $r = Invoke-Fresh 'gov --version; exit $LASTEXITCODE' 'powershell'
    $r.Code | Should -Be 0
    $r.Out | Should -Match ([regex]::Escape($env:GOV_MSI_VERSION))
  }

  It 'is signed, the signature is Valid and names the expected publisher' -Skip:(-not $env:GOV_MSI_SIGNER) {
    $sig = Get-AuthenticodeSignature $script:Msi
    $sig.Status | Should -Be 'Valid'
    $sig.SignerCertificate.Subject | Should -Match ([regex]::Escape($env:GOV_MSI_SIGNER))
    $sig.TimeStamperCertificate | Should -Not -BeNullOrEmpty
  }
}

Describe 'gov MSI — uninstall' -Tag Uninstall {
  BeforeAll {
    # ~/.gov is the user's: workspaces and preferences. A marker proves the uninstall left it alone.
    New-Item -ItemType Directory -Force $script:GovHome | Out-Null
    $script:Marker = Join-Path $script:GovHome 'kept-by-uninstall.txt'
    Set-Content $script:Marker 'gov uninstall must keep this'
    $script:UninstallCode = Msiexec @('/x', "`"$script:Msi`"", '/qn') (Join-Path $env:RUNNER_TEMP 'gov-msi-uninstall.log')
  }

  It 'uninstalls with exit code 0' { $script:UninstallCode | Should -Be 0 }

  It 'removes app\, node\ and bin\ — including what gov added after install (agents, shims)' {
    Join-Path $script:Root 'app' | Should -Not -Exist
    Join-Path $script:Root 'node' | Should -Not -Exist
    Join-Path $script:Root 'bin' | Should -Not -Exist
    $script:Root | Should -Not -Exist
  }

  It 'removes the PATH entry' {
    Split-PathList (UserPath) | Should -Not -Contain $script:Bin
  }

  It 'leaves no registration behind' {
    Test-Path 'HKCU:\Software\Svayam\gov' | Should -BeFalse
  }

  It 'keeps ~/.gov' {
    $script:Marker | Should -Exist
  }
}
