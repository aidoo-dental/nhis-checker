param(
    [Parameter(Mandatory=$true)][string]$BinaryDir,
    [Parameter(Mandatory=$true)][string]$QtDir,
    [Parameter(Mandatory=$true)][string]$OpenSslRoot,
    [Parameter(Mandatory=$true)][string]$LibP11Root,
    [Parameter(Mandatory=$true)][string]$LibXml2Dll,
    [ValidateSet('debug','release')][string]$Configuration = 'release'
)
$ErrorActionPreference = 'Stop'
$BinaryDir = (Resolve-Path -LiteralPath $BinaryDir).Path
$runtimeFiles = @(
    (Join-Path $OpenSslRoot 'bin/libcrypto-3-x64.dll'),
    (Join-Path $OpenSslRoot 'bin/libssl-3-x64.dll'),
    (Join-Path $LibP11Root 'libp11.dll'),
    $LibXml2Dll
)
foreach ($file in $runtimeFiles) {
    if (!(Test-Path -LiteralPath $file)) { throw "Missing runtime dependency: $file. Configure local.pri." }
    Copy-Item -LiteralPath $file -Destination $BinaryDir -Force
}
& "$QtDir/bin/windeployqt.exe" "--$Configuration" --no-translations --compiler-runtime "$BinaryDir/NHIS Checker.exe"
if ($LASTEXITCODE -ne 0) { throw "windeployqt failed ($LASTEXITCODE)" }
