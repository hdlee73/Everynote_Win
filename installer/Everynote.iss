; Everynote installer (Inno Setup 6.3+). Build:
;   iscc installer\Everynote.iss /DAppVersion=3.0.0 /DArch=x64 /DSourceExe=..\out\x64\Everynote.exe /DOutputBase=Everynote-Setup-v3.0.0-x64 /DOutDir=..\dist
; Per-user install by default (%LOCALAPPDATA%\Programs\Everynote, no admin); the dialog / /ALLUSERS offers an all-users install.

#ifndef AppVersion
  #define AppVersion "3.0.0"
#endif
#ifndef Arch
  #define Arch "x64"
#endif
#ifndef SourceExe
  #define SourceExe "..\out\" + Arch + "\Everynote.exe"
#endif
#ifndef OutputBase
  #define OutputBase "Everynote-Setup-v" + AppVersion + "-" + Arch
#endif
#ifndef OutDir
  #define OutDir "..\dist"
#endif
#if Arch == "arm64"
  #define ArchAllowed "arm64"
#else
  #define ArchAllowed "x64compatible"
#endif
#define AppExe "Everynote.exe"
#define AppId "{{3D6B1F4E-8A27-4C59-B0E3-5F9A2C7D1E84}"
#define AumId "hdlee73.Everynote"
#define ProgId "Everynote.Document"
; Korean messages: prefer the compiler's own file (same version as the compiler), else the copy next to this script.
#define KoFile CompilerPath + "Languages\Korean.isl"
#if !FileExists(KoFile)
  #define KoFile SourcePath + "Korean.isl"
#endif

[Setup]
AppId={#AppId}
AppName=Everynote
AppVersion={#AppVersion}
AppVerName=Everynote {#AppVersion}
AppPublisher=hdlee73
AppPublisherURL=https://github.com/hdlee73/pdf-note-windows
AppSupportURL=https://github.com/hdlee73/pdf-note-windows/issues
AppUpdatesURL=https://github.com/hdlee73/pdf-note-windows/releases
VersionInfoVersion={#AppVersion}
VersionInfoDescription=Everynote Setup
VersionInfoProductName=Everynote
DefaultDirName={autopf}\Everynote
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog commandline
ArchitecturesAllowed={#ArchAllowed}
ArchitecturesInstallIn64BitMode={#ArchAllowed}
OutputDir={#OutDir}
OutputBaseFilename={#OutputBase}
SetupIconFile=everynote.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName=Everynote
WizardStyle=modern
WizardImageFile=wizard-large.bmp
WizardSmallImageFile=wizard-small.bmp
Compression=lzma2/fast
SolidCompression=yes
CloseApplications=yes
CloseApplicationsFilter={#AppExe}
RestartApplications=no
ChangesAssociations=yes
UsePreviousTasks=yes
ShowLanguageDialog=auto
LanguageDetectionMethod=uilanguage

[Languages]
Name: "korean"; MessagesFile: "{#KoFile}"
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
english.TaskAssoc=Add "Open with Everynote" for PDF, HWP and Office documents (does not change your default apps)
english.GroupAssoc=File types:
english.PurgeData=Also delete Everynote settings, Google sign-in and cache?%n%n(%1)%n%nYour documents are kept either way.
english.PurgeLibrary=Also delete your Everynote documents folder and the notes in it?%n%n(%1)%n%nThis cannot be undone.
english.RunApp=Launch Everynote
korean.TaskAssoc=PDF, HWP, Office 문서에 "Everynote로 열기" 추가 (기본 앱은 바뀌지 않습니다)
korean.GroupAssoc=파일 형식:
korean.PurgeData=Everynote 설정, Google 로그인 정보, 캐시도 함께 삭제할까요?%n%n(%1)%n%n문서는 어느 쪽을 선택해도 그대로 남습니다.
korean.PurgeLibrary=Everynote 문서 폴더와 그 안의 노트도 함께 삭제할까요?%n%n(%1)%n%n되돌릴 수 없습니다.
korean.RunApp=Everynote 실행

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "associate"; Description: "{cm:TaskAssoc}"; GroupDescription: "{cm:GroupAssoc}"; Flags: unchecked

[Files]
Source: "{#SourceExe}"; DestDir: "{app}"; DestName: "{#AppExe}"; Flags: ignoreversion

[Icons]
; AppUserModelID = the id the app sets at startup, so pinning the shortcut to the taskbar/Start works
Name: "{autoprograms}\Everynote"; Filename: "{app}\{#AppExe}"; AppUserModelID: "{#AumId}"
Name: "{autodesktop}\Everynote"; Filename: "{app}\{#AppExe}"; AppUserModelID: "{#AumId}"; Tasks: desktopicon

[Registry]
; ProgId + "Open with" entries (never touches the UserChoice / default app of any extension)
Root: HKA; Subkey: "Software\Classes\{#ProgId}"; ValueType: string; ValueName: ""; ValueData: "Everynote"; Flags: uninsdeletekey; Tasks: associate
Root: HKA; Subkey: "Software\Classes\{#ProgId}\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#AppExe},0"; Tasks: associate
Root: HKA; Subkey: "Software\Classes\{#ProgId}\shell\open"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "Everynote"; Tasks: associate
Root: HKA; Subkey: "Software\Classes\{#ProgId}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""; Tasks: associate
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "Everynote"; Flags: uninsdeletekey; Tasks: associate
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""; Tasks: associate
Root: HKA; Subkey: "Software\Classes\.pdf\OpenWithProgids"; ValueType: none; ValueName: "{#ProgId}"; Flags: uninsdeletevalue; Tasks: associate
Root: HKA; Subkey: "Software\Everynote\Capabilities\FileAssociations"; ValueType: string; ValueName: ".pdf"; ValueData: "{#ProgId}"; Tasks: associate
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".pdf"; ValueData: ""; Tasks: associate
Root: HKA; Subkey: "Software\Classes\.hwp\OpenWithProgids"; ValueType: none; ValueName: "{#ProgId}"; Flags: uninsdeletevalue; Tasks: associate
Root: HKA; Subkey: "Software\Everynote\Capabilities\FileAssociations"; ValueType: string; ValueName: ".hwp"; ValueData: "{#ProgId}"; Tasks: associate
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".hwp"; ValueData: ""; Tasks: associate
Root: HKA; Subkey: "Software\Classes\.hwpx\OpenWithProgids"; ValueType: none; ValueName: "{#ProgId}"; Flags: uninsdeletevalue; Tasks: associate
Root: HKA; Subkey: "Software\Everynote\Capabilities\FileAssociations"; ValueType: string; ValueName: ".hwpx"; ValueData: "{#ProgId}"; Tasks: associate
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".hwpx"; ValueData: ""; Tasks: associate
Root: HKA; Subkey: "Software\Classes\.doc\OpenWithProgids"; ValueType: none; ValueName: "{#ProgId}"; Flags: uninsdeletevalue; Tasks: associate
Root: HKA; Subkey: "Software\Everynote\Capabilities\FileAssociations"; ValueType: string; ValueName: ".doc"; ValueData: "{#ProgId}"; Tasks: associate
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".doc"; ValueData: ""; Tasks: associate
Root: HKA; Subkey: "Software\Classes\.docx\OpenWithProgids"; ValueType: none; ValueName: "{#ProgId}"; Flags: uninsdeletevalue; Tasks: associate
Root: HKA; Subkey: "Software\Everynote\Capabilities\FileAssociations"; ValueType: string; ValueName: ".docx"; ValueData: "{#ProgId}"; Tasks: associate
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".docx"; ValueData: ""; Tasks: associate
Root: HKA; Subkey: "Software\Classes\.ppt\OpenWithProgids"; ValueType: none; ValueName: "{#ProgId}"; Flags: uninsdeletevalue; Tasks: associate
Root: HKA; Subkey: "Software\Everynote\Capabilities\FileAssociations"; ValueType: string; ValueName: ".ppt"; ValueData: "{#ProgId}"; Tasks: associate
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".ppt"; ValueData: ""; Tasks: associate
Root: HKA; Subkey: "Software\Classes\.pptx\OpenWithProgids"; ValueType: none; ValueName: "{#ProgId}"; Flags: uninsdeletevalue; Tasks: associate
Root: HKA; Subkey: "Software\Everynote\Capabilities\FileAssociations"; ValueType: string; ValueName: ".pptx"; ValueData: "{#ProgId}"; Tasks: associate
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".pptx"; ValueData: ""; Tasks: associate
Root: HKA; Subkey: "Software\Classes\.xls\OpenWithProgids"; ValueType: none; ValueName: "{#ProgId}"; Flags: uninsdeletevalue; Tasks: associate
Root: HKA; Subkey: "Software\Everynote\Capabilities\FileAssociations"; ValueType: string; ValueName: ".xls"; ValueData: "{#ProgId}"; Tasks: associate
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".xls"; ValueData: ""; Tasks: associate
Root: HKA; Subkey: "Software\Classes\.xlsx\OpenWithProgids"; ValueType: none; ValueName: "{#ProgId}"; Flags: uninsdeletevalue; Tasks: associate
Root: HKA; Subkey: "Software\Everynote\Capabilities\FileAssociations"; ValueType: string; ValueName: ".xlsx"; ValueData: "{#ProgId}"; Tasks: associate
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".xlsx"; ValueData: ""; Tasks: associate
Root: HKA; Subkey: "Software\Everynote\Capabilities"; ValueType: string; ValueName: "ApplicationName"; ValueData: "Everynote"; Flags: uninsdeletekey; Tasks: associate
Root: HKA; Subkey: "Software\Everynote\Capabilities"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "Everynote - PDF notes"; Tasks: associate
Root: HKA; Subkey: "Software\Everynote"; Flags: uninsdeletekeyifempty; Tasks: associate
Root: HKA; Subkey: "Software\RegisteredApplications"; ValueType: string; ValueName: "Everynote"; ValueData: "Software\Everynote\Capabilities"; Flags: uninsdeletevalue; Tasks: associate

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:RunApp}"; Flags: nowait postinstall skipifsilent

[Code]
function HasParam(const Name: String): Boolean;
var I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), Name) = 0 then begin Result := True; Exit; end;
end;

procedure CloseRunningApp();
var Rc: Integer;
begin
  // ask politely (WM_CLOSE), give it a moment to save, then end whatever is left
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/IM {#AppExe}', '', SW_HIDE, ewWaitUntilTerminated, Rc);
  Sleep(1500);
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /T /IM {#AppExe}', '', SW_HIDE, ewWaitUntilTerminated, Rc);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  CloseRunningApp();
  Result := '';
end;

function InitializeUninstall(): Boolean;
begin
  CloseRunningApp();
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir, LibDir: String;
  Purge, PurgeLib: Boolean;
begin
  if CurUninstallStep <> usPostUninstall then Exit;
  DataDir := ExpandConstant('{localappdata}\PDFNote');
  LibDir := ExpandConstant('{userdocs}\PDF Note');
  // user data is kept unless chosen: dialog when interactive, /PURGEDATA and /PURGELIBRARY when silent
  Purge := HasParam('/PURGEDATA');
  PurgeLib := HasParam('/PURGELIBRARY');
  if (not UninstallSilent) and DirExists(DataDir) then
    Purge := MsgBox(FmtMessage(CustomMessage('PurgeData'), [DataDir]), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
  if Purge and DirExists(DataDir) then DelTree(DataDir, True, True, True);
  if Purge and (not UninstallSilent) and DirExists(LibDir) then
    PurgeLib := MsgBox(FmtMessage(CustomMessage('PurgeLibrary'), [LibDir]), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
  if PurgeLib and DirExists(LibDir) then DelTree(LibDir, True, True, True);
end;
