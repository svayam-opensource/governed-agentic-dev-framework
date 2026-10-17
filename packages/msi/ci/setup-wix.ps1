# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
# Install the WiX toolset the MSI build needs (a .NET global tool + the UI and Util extensions), pinned.
# Used by .github/workflows/msi-build.yml and adopter-e2e.yml (windows). The runner image ships the .NET SDK.
$ErrorActionPreference = 'Stop'
$WixVersion = '4.0.5'
dotnet tool install --global wix --version $WixVersion
if ($LASTEXITCODE -ne 0) { throw "dotnet tool install wix $WixVersion failed" }
$tools = Join-Path $env:USERPROFILE '.dotnet\tools'
$env:PATH = "$tools;$env:PATH"
if ($env:GITHUB_PATH) { $tools | Out-File -FilePath $env:GITHUB_PATH -Append -Encoding utf8 }
foreach ($ext in 'WixToolset.UI.wixext', 'WixToolset.Util.wixext') {
  wix extension add -g "$ext/$WixVersion"
  if ($LASTEXITCODE -ne 0) { throw "wix extension add $ext/$WixVersion failed" }
}
wix --version
