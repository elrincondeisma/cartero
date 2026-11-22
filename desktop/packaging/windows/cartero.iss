; Instalador de Cartero para Windows (Inno Setup 6). Lo genera la CI:
;   iscc /DVersion=0.1.0 /DSource=..\..\target\release packaging\windows\cartero.iss
#ifndef Version
  #define Version "0.0.0"
#endif
#ifndef Source
  #define Source "..\..\target\release"
#endif

[Setup]
AppId={{6A1D2F0E-5C3B-4E8A-9B7D-CA27E40C0B11}
AppName=Cartero
AppVersion={#Version}
AppPublisher=Cartero
AppPublisherURL=https://github.com/elrincondeisma/cartero
DefaultDirName={autopf}\Cartero
DefaultGroupName=Cartero
UninstallDisplayIcon={app}\cartero.exe
OutputDir=..\..\target\dist
OutputBaseFilename=Cartero-{#Version}-windows-x64-setup
SetupIconFile=..\icons\cartero.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequiredOverridesAllowed=dialog

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#Source}\cartero.exe"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Cartero"; Filename: "{app}\cartero.exe"
Name: "{autodesktop}\Cartero"; Filename: "{app}\cartero.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\cartero.exe"; Description: "{cm:LaunchProgram,Cartero}"; Flags: nowait postinstall skipifsilent
