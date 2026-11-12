param([Parameter(Mandatory)][string]$Path)
$ErrorActionPreference = 'Stop'
& $env:NHIS_SIGNTOOL sign /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib $env:NHIS_DLIB /dmdf $env:NHIS_SIGNING_METADATA $Path
if ($LASTEXITCODE -ne 0) { throw 'Azure signing failed' }
& $env:NHIS_SIGNTOOL verify /pa /all /v $Path
if ($LASTEXITCODE -ne 0) { throw 'Signature verification failed' }
$signature = Get-AuthenticodeSignature -LiteralPath $Path
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -cne 'CN=Aidoo LTD, O=Aidoo LTD, L=Sofia, S=Sofia City, C=BG' -or $null -eq $signature.TimeStamperCertificate) {
    throw 'Expected a valid, timestamped AIDOO signature'
}
