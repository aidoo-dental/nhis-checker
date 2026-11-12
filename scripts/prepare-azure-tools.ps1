param([Parameter(Mandatory)][string]$Directory)
$ErrorActionPreference = 'Stop'
New-Item $Directory -ItemType Directory -Force | Out-Null
$report = @()
foreach ($id in @('microsoft.windows.sdk.buildtools','microsoft.artifactsigning.client')) {
    $base = "https://api.nuget.org/v3-flatcontainer/$id"
    $version = (Invoke-RestMethod "$base/index.json").versions | Where-Object { $_ -match '^\d+\.\d+\.\d+(?:\.\d+)?$' } | Sort-Object { [version]$_ } -Descending | Select-Object -First 1
    $zip = Join-Path $Directory "$id.zip"
    Invoke-WebRequest "$base/$version/$id.$version.nupkg" -OutFile $zip
    $target = Join-Path $Directory $id
    Expand-Archive $zip $target
    $report += @{package=$id;version=$version;sha256=(Get-FileHash $zip -Algorithm SHA256).Hash}
}
$signTool = Get-ChildItem "$Directory/microsoft.windows.sdk.buildtools" -Filter signtool.exe -Recurse | Where-Object { $_.Directory.Name -ceq 'x64' } | Sort-Object { [version]$_.VersionInfo.FileVersionRaw } -Descending | Select-Object -First 1
if (!$signTool -or $signTool.VersionInfo.FileVersionRaw -lt [version]'10.0.22621.755' -or $signTool.VersionInfo.FileVersionRaw.Build -eq 20348) { throw 'Unsupported SignTool' }
$dlib = Join-Path $Directory 'microsoft.artifactsigning.client/bin/x64/Azure.CodeSigning.Dlib.dll'
foreach ($file in @($signTool.FullName,$dlib)) {
    $sig = Get-AuthenticodeSignature $file
    if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch '(^|,\s*)O=Microsoft Corporation(,|$)') { throw "Invalid Microsoft tool signature: $file" }
}
Write-Host "##vso[task.setvariable variable=NHIS_SIGNTOOL]$($signTool.FullName)"
Write-Host "##vso[task.setvariable variable=NHIS_DLIB]$dlib"
$report | ConvertTo-Json | Set-Content "$Directory/tools.json"
