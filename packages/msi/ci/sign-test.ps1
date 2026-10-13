# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Svayam Infoware Pvt. Ltd.
#
# TEST SIGNING, FOR CI ONLY (spec 04 §4.3: "a PR build signs with a test certificate and asserts the same shape").
# Makes a throwaway code-signing certificate in THIS runner's store — the private key is generated here, never
# exported, never written to a file, and dies with the runner — trusts it on this machine only, and signs the given
# file with an RFC 3161 timestamp. Production signing is gov-cicd's, with its HSM-held key (ruling Q8 A); this
# script is never used for a release.
#
#   pwsh -File sign-test.ps1 <file>        (as the signer command: sign.mjs --signer "pwsh -NoProfile -File …\sign-test.ps1 {file}")
param([Parameter(Mandatory = $true)][string]$File)
$ErrorActionPreference = 'Stop'
$Subject = 'CN=Svayam (TEST - CI only)'
$cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object Subject -eq $Subject | Select-Object -First 1
if (-not $cert) {
  $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $Subject -CertStoreLocation Cert:\CurrentUser\My `
    -KeyExportPolicy NonExportable -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -NotAfter (Get-Date).AddDays(2)
  # Trust it on this machine (the runner is admin): a chain to a trusted root, and a trusted publisher.
  $pub = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2(, $cert.RawData)
  foreach ($store in 'Root', 'TrustedPublisher') {
    $s = New-Object System.Security.Cryptography.X509Certificates.X509Store($store, 'LocalMachine')
    $s.Open('ReadWrite'); $s.Add($pub); $s.Close()
  }
}
$signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
  Sort-Object FullName -Descending | Select-Object -First 1
if ($signtool) {
  & $signtool.FullName sign /fd SHA256 /sha1 $cert.Thumbprint /s My /tr 'http://timestamp.digicert.com' /td SHA256 /d 'gov' $File
  if ($LASTEXITCODE -ne 0) { throw "signtool failed ($LASTEXITCODE)" }
} else {
  $r = Set-AuthenticodeSignature -FilePath $File -Certificate $cert -HashAlgorithm SHA256 -TimestampServer 'http://timestamp.digicert.com'
  if ($r.Status -ne 'Valid') { throw "Set-AuthenticodeSignature: $($r.Status) $($r.StatusMessage)" }
}
