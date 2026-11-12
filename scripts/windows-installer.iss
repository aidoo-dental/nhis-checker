#ifndef AppVersion
  #error AppVersion must be supplied
#endif
#ifndef PayloadDir
  #error PayloadDir must be supplied
#endif
#ifndef OutputDir
  #error OutputDir must be supplied
#endif
#ifdef WebView2Bootstrapper
  #define InstallName "NHIS Checker WebView2 Preview"
#else
  #define InstallName "NHIS Checker"
#endif
[Setup]
#ifdef WebView2Bootstrapper
AppId={{4551189C-94D1-4F0E-820D-25F5D46011E0}
AppVerName={#InstallName} {#AppVersion}
UninstallDisplayName={#InstallName}
#else
AppId={{41F0FAAE-9694-4D9F-B30E-8CBB5439C116}
#endif
AppName=NHIS Checker
AppVersion={#AppVersion}
AppPublisher=AIDOO
AppPublisherURL=https://github.com/aidoo-dental/nhis-checker
AppSupportURL=https://github.com/aidoo-dental/nhis-checker/issues
DefaultDirName={localappdata}\Programs\{#InstallName}
DefaultGroupName={#InstallName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#OutputDir}
#ifdef WebView2Bootstrapper
OutputBaseFilename=NHIS-Checker-{#AppVersion}-Windows-x64-WebView2-Preview-Setup
#else
OutputBaseFilename=NHIS Checker {#AppVersion} - Windows x64 Setup
#endif
SetupIconFile=..\app\assets\NHIS-Checker.ico
UninstallDisplayIcon={app}\NHIS Checker.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no
#ifdef SignWithAzure
SignTool=aidoo
SignedUninstaller=yes
#endif
[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked
[Files]
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
#ifdef WebView2Bootstrapper
Source: "{#WebView2Bootstrapper}"; Flags: dontcopy
#endif
[Icons]
Name: "{group}\{#InstallName}"; Filename: "{app}\NHIS Checker.exe"
Name: "{autodesktop}\{#InstallName}"; Filename: "{app}\NHIS Checker.exe"; Tasks: desktopicon
[Run]
Filename: "{app}\NHIS Checker.exe"; Description: "Launch NHIS Checker"; Flags: nowait postinstall skipifsilent

#ifdef WebView2Bootstrapper
[Code]
const
  WebView2Client = 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function HasWebView2Version(RootKey: Integer): Boolean;
var
  Version: String;
  Encoded: Int64;
begin
  Result := RegQueryStringValue(RootKey, WebView2Client, 'pv', Version) and
    StrToVersion(Version, Encoded) and (Encoded > 0);
end;

function HasWebView2: Boolean;
begin
  Result := HasWebView2Version(HKLM32) or HasWebView2Version(HKCU);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ExitCode: Integer;
begin
  Result := '';
  if HasWebView2 then Exit;
  ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
  if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '',
      SW_HIDE, ewWaitUntilTerminated, ExitCode) then
    Result := 'Microsoft Edge WebView2 Runtime installer could not start. Error ' + IntToStr(ExitCode)
  else if not HasWebView2 then
    Result := 'Microsoft Edge WebView2 Runtime could not be installed. Check your internet connection and retry. Exit code ' + IntToStr(ExitCode);
end;
#endif
