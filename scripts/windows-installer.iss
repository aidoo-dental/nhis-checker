#ifndef AppVersion
  #error AppVersion must be supplied
#endif
#ifndef PayloadDir
  #error PayloadDir must be supplied
#endif
#ifndef OutputDir
  #error OutputDir must be supplied
#endif
[Setup]
AppId={{41F0FAAE-9694-4D9F-B30E-8CBB5439C116}
AppName=NHIS Checker
AppVersion={#AppVersion}
AppPublisher=AIDOO
AppPublisherURL=https://github.com/aidoo-dental/nhis-checker
AppSupportURL=https://github.com/aidoo-dental/nhis-checker/issues
DefaultDirName={localappdata}\Programs\NHIS Checker
DefaultGroupName=NHIS Checker
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#OutputDir}
OutputBaseFilename=NHIS Checker {#AppVersion} - Windows x64 Setup
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
[Icons]
Name: "{group}\NHIS Checker"; Filename: "{app}\NHIS Checker.exe"
Name: "{autodesktop}\NHIS Checker"; Filename: "{app}\NHIS Checker.exe"; Tasks: desktopicon
[Run]
Filename: "{app}\NHIS Checker.exe"; Description: "Launch NHIS Checker"; Flags: nowait postinstall skipifsilent
