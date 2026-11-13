param(
    [Parameter(Mandatory)][string]$BuildDir,
    [Parameter(Mandatory)][string]$QtDir,
    [Parameter(Mandatory)][string]$DepsDir,
    [Parameter(Mandatory)][string]$LibP11Dir,
    [string]$OpenSSLDir = $DepsDir,
    [string]$OutputDir = "$PSScriptRoot/../dist",
    [string]$WebView2Bootstrapper
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$root = (Resolve-Path "$PSScriptRoot/..").Path
$BuildDir = (Resolve-Path $BuildDir).Path
$payload = Join-Path $BuildDir 'payload'
if (Test-Path $payload) { Remove-Item $payload -Recurse -Force }
New-Item $payload -ItemType Directory | Out-Null
cmake --install $BuildDir --config Release --prefix $payload
$exe = Join-Path $payload 'NHIS Checker.exe'
& "$QtDir/bin/windeployqt.exe" --release --no-compiler-runtime $exe
Copy-Item "$DepsDir/bin/*.dll" $payload
if ($OpenSSLDir -ne $DepsDir) {
    foreach ($library in @('libssl-3-x64.dll','libcrypto-3-x64.dll')) {
        Copy-Item "$OpenSSLDir/bin/$library" $payload
    }
}
Copy-Item "$LibP11Dir/src/libp11.dll" $payload
# Deploy the MSVC runtime beside the app, avoiding an elevated prerequisite installer.
$runtime = Join-Path $env:VCToolsRedistDir 'x64/Microsoft.VC143.CRT'
if (!(Test-Path "$runtime/msvcp140.dll")) { throw "MSVC runtime not found: $runtime" }
Copy-Item "$runtime/*.dll" $payload
Copy-Item "$root/LICENSE" "$payload/LICENSE.txt"
$licenses = New-Item "$payload/licenses" -ItemType Directory -Force
Copy-Item "$root/app/assets/licenses/*" $licenses.FullName
if (Test-Path "$QtDir/licenses") { Copy-Item "$QtDir/licenses/*" $licenses.FullName -Recurse -Force }
if (Test-Path "$QtDir/sbom") { Copy-Item "$QtDir/sbom" $licenses.FullName -Recurse }
if (Test-Path "$OpenSSLDir/share/openssl/copyright") {
    Copy-Item "$OpenSSLDir/share/openssl/copyright" "$licenses/openssl.txt"
}
foreach ($dependency in @('libxml2','zlib','libiconv')) {
    if (Test-Path "$DepsDir/share/$dependency/copyright") {
        Copy-Item "$DepsDir/share/$dependency/copyright" "$licenses/$dependency.txt"
    }
}
Copy-Item "$LibP11Dir/COPYING" "$licenses/libp11.txt"
$requiredFiles = @('Qt6Core.dll','platforms/qwindows.dll','libp11.dll','msvcp140.dll')
$webEngineFiles = @('Qt6WebEngineCore.dll','QtWebEngineProcess.exe','resources/icudtl.dat','resources/qtwebengine_resources.pak')
if ($WebView2Bootstrapper) {
    $WebView2Bootstrapper = (Resolve-Path $WebView2Bootstrapper).Path
    $signature = Get-AuthenticodeSignature -FilePath $WebView2Bootstrapper
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|, )O=Microsoft Corporation(,|$)') {
        throw 'The WebView2 bootstrapper must have a valid Microsoft signature.'
    }
    $requiredFiles += @('WebView2Loader.dll','licenses/webview2-sdk.txt')
    foreach ($file in $webEngineFiles) {
        if (Test-Path "$payload/$file") { throw "Unexpected WebEngine file in WebView2 package: $file" }
    }
} else {
    $requiredFiles += $webEngineFiles
}
foreach ($required in $requiredFiles) {
    if (!(Test-Path "$payload/$required")) { throw "Missing deployed dependency: $required" }
}
$version = (Get-Item $exe).VersionInfo.ProductVersion
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "Invalid app version: $version" }
New-Item $OutputDir -ItemType Directory -Force | Out-Null
$OutputDir = (Resolve-Path $OutputDir).Path
$iscc = "${env:ProgramFiles(x86)}/Inno Setup 6/ISCC.exe"
if (!(Test-Path $iscc)) { throw 'Install Inno Setup 6 before packaging.' }
$installerArgs = @("/DAppVersion=$version", "/DPayloadDir=$payload", "/DOutputDir=$OutputDir")
$installerName = "NHIS Checker $version - Windows x64 Setup.exe"
if ($WebView2Bootstrapper) {
    $installerArgs += "/DWebView2Bootstrapper=$WebView2Bootstrapper"
    $installerName = "NHIS-Checker-$version-Windows-x64-WebView2-Preview-Setup.exe"
}
& $iscc @installerArgs "$PSScriptRoot/windows-installer.iss"
$installer = Get-Item "$OutputDir/$installerName"
Get-FileHash $installer.FullName -Algorithm SHA256
Write-Host "Installer bytes: $($installer.Length)"
Write-Host "Application payload bytes: $((Get-ChildItem $payload -File -Recurse | Measure-Object Length -Sum).Sum)"
