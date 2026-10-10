; JSON 工具 Windows 安装版（Inno Setup 6）
; 构建：powershell -File setup\build.ps1（内部调用 ISCC.exe 编译本文件）
; 产物：setup\out\json-tools-setup-v<版本>.exe
; 说明：per-user 安装（PrivilegesRequired=lowest，无需管理员），
;       装到 %LOCALAPPDATA%\Programs\json-tools，数据在 %APPDATA%\json-tools（卸载保留）。

#define MyAppVersion "1.2.1"

[Setup]
AppId={{B7D9E2C4-5F1A-4C8B-9D3E-2A6F8C1E4B7A}
AppName=JSON 工具
AppVersion={#MyAppVersion}
AppVerName=JSON 工具 v{#MyAppVersion}
AppPublisher=fenghaichao
AppPublisherURL=https://github.com/fenghaichao/json-tools
AppSupportURL=https://github.com/fenghaichao/json-tools/issues
DefaultDirName={localappdata}\Programs\json-tools
DisableProgramGroupPage=yes
DisableWelcomePage=no
LicenseFile=..\LICENSE
OutputDir=out
OutputBaseFilename=json-tools-setup-v{#MyAppVersion}
SetupIconFile=app.ico
UninstallDisplayName=JSON 工具
UninstallDisplayIcon={app}\scripts\app.ico
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
VersionInfoProductName=JSON 工具

[Files]
Source: "node.exe"; DestDir: "{app}"
Source: "..\server.js"; DestDir: "{app}\app"
Source: "..\lib\*"; DestDir: "{app}\app\lib"; Flags: recursesubdirs
Source: "..\public\*"; DestDir: "{app}\app\public"; Flags: recursesubdirs
Source: "..\LICENSE"; DestDir: "{app}"
Source: "app.ico"; DestDir: "{app}\scripts"
Source: "ensure.vbs"; DestDir: "{app}\scripts"
Source: "stop.vbs"; DestDir: "{app}\scripts"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"

[Icons]
Name: "{autoprograms}\打开 JSON 工具"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\scripts\ensure.vbs"" open"; WorkingDir: "{app}\scripts"; IconFilename: "{app}\scripts\app.ico"
Name: "{autoprograms}\停止 JSON 工具服务"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\scripts\stop.vbs"""; WorkingDir: "{app}\scripts"
Name: "{autodesktop}\JSON 工具"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\scripts\ensure.vbs"" open"; WorkingDir: "{app}\scripts"; IconFilename: "{app}\scripts\app.ico"; Tasks: desktopicon

[Registry]
; 登录后后台常驻：HKCU Run 静默拉起服务（ensure.vbs 无 open 参数时只启动、不开浏览器）
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "json-tools"; ValueData: """{sys}\wscript.exe"" ""{app}\scripts\ensure.vbs"""; Flags: uninsdeletevalue

[Code]
// 升级安装时先停掉正在运行的旧服务，否则 node.exe 被占用无法覆盖
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
begin
  if FileExists(ExpandConstant('{app}\scripts\stop.vbs')) then
    Exec(ExpandConstant('{sys}\wscript.exe'),
      '"' + ExpandConstant('{app}\scripts\stop.vbs') + '"', '',
      SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := '';
end;

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\scripts\ensure.vbs"" open"; Flags: nowait postinstall skipifsilent; Description: "立即启动并打开 JSON 工具"

[UninstallRun]
; 卸载前先停止服务并删除 server.pid；%APPDATA%\json-tools 下的用户数据有意保留
Filename: "{sys}\wscript.exe"; Parameters: """{app}\scripts\stop.vbs"""; Flags: runhidden; RunOnceId: "StopJsonTools"
