param(
    [Parameter(Mandatory)][string]$Path,
    [switch]$PreserveValid
)
$ErrorActionPreference = 'Stop'
if ($PreserveValid) {
    $existing = Get-AuthenticodeSignature -LiteralPath $Path
    if ($existing.Status -eq 'Valid') {
        # Without /a, SignTool checks the embedded signature, even on a machine with a matching catalog.
        $PSNativeCommandUseErrorActionPreference = $false
        & $env:NHIS_SIGNTOOL verify /pa /all /tw $Path *> $null
        if ($LASTEXITCODE -eq 0) { return }
    } elseif ($existing.Status -ne 'NotSigned') {
        throw "Unexpected signature on $([IO.Path]::GetFileName($Path)): $($existing.Status)"
    }
}
& $env:NHIS_SIGNTOOL sign /v /debug /fd SHA256 /tr http://timestamp.acs.microsoft.com /td SHA256 /dlib $env:NHIS_DLIB /dmdf $env:NHIS_SIGNING_METADATA $Path
if ($LASTEXITCODE -ne 0) { throw "Azure signing failed (exit $LASTEXITCODE)" }
& $env:NHIS_SIGNTOOL verify /pa /all /v $Path
if ($LASTEXITCODE -ne 0) { throw 'Signature verification failed' }
$signature = Get-AuthenticodeSignature -LiteralPath $Path
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -cne 'CN=Aidoo LTD, O=Aidoo LTD, L=Sofia, S=Sofia City, C=BG' -or $null -eq $signature.TimeStamperCertificate) {
    throw 'Expected a valid, timestamped AIDOO signature'
}
