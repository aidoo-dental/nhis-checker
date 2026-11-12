param(
    [Parameter(Mandatory)][string]$BuildDir,
    [Parameter(Mandatory)][string]$QtDir,
    [Parameter(Mandatory)][string]$DepsDir,
    [Parameter(Mandatory)][string]$LibP11Dir,
    [string]$OutputDir = "$PSScriptRoot/../dist"
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
foreach ($dependency in @('openssl','libxml2','zlib','libiconv')) {
    if (Test-Path "$DepsDir/share/$dependency/copyright") {
        Copy-Item "$DepsDir/share/$dependency/copyright" "$licenses/$dependency.txt"
    }
}
Copy-Item "$LibP11Dir/COPYING" "$licenses/libp11.txt"
# windeployqt includes Chromium's third-party notices with the WebEngine resources.
foreach ($required in @('Qt6Core.dll','Qt6WebEngineCore.dll','QtWebEngineProcess.exe','platforms/qwindows.dll','resources/icudtl.dat','resources/qtwebengine_resources.pak','libp11.dll','msvcp140.dll')) {
    if (!(Test-Path "$payload/$required")) { throw "Missing deployed dependency: $required" }
}
$version = (Get-Item $exe).VersionInfo.ProductVersion
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "Invalid app version: $version" }
New-Item $OutputDir -ItemType Directory -Force | Out-Null
$OutputDir = (Resolve-Path $OutputDir).Path
$iscc = "${env:ProgramFiles(x86)}/Inno Setup 6/ISCC.exe"
if (!(Test-Path $iscc)) { throw 'Install Inno Setup 6 before packaging.' }
& $iscc "/DAppVersion=$version" "/DPayloadDir=$payload" "/DOutputDir=$OutputDir" "$PSScriptRoot/windows-installer.iss"
Get-FileHash "$OutputDir/NHIS Checker $version - Windows x64 Setup.exe" -Algorithm SHA256
