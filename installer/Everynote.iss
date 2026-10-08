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
AppPublisherURL=https://github.com/hdlee73/Everynote_Win
AppSupportURL=https://github.com/hdlee73/Everynote_Win/issues
AppUpdatesURL=https://github.com/hdlee73/Everynote_Win/releases
VersionInfoVersion={#AppVersion}
VersionInfoDescription=Everynote Setup
VersionInfoProductName=Everynote
DefaultDirName={autopf}\Everynote
DisableProgramGroupPage=yes
DisableDirPage=no
DirExistsWarning=auto
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
english.LibTitle=Documents folder
english.LibDesc=Where should Everynote keep your documents and notes?
english.LibSub=Documents, notes, recordings and videos are stored in this folder. Existing documents are not moved automatically; you can change this later in the settings file (%1\config.json).
english.LibPrompt=Documents folder:
english.TaskAssoc=Add "Open with Everynote" for PDF, HWP and Office documents (does not change your default apps)
english.GroupAssoc=File types:
english.PurgeData=Also delete Everynote settings and cache?%n%n(%1)%n%nYour documents are kept either way.
english.PurgeLibrary=Also delete your Everynote documents folder and the notes in it?%n%n(%1)%n%nThis cannot be undone.
english.RunApp=Launch Everynote
english.ModeTitle=Install type
english.ModeDesc=Everynote data from an earlier installation was found.
english.ModeSub=Choose how to install.%n%nDocuments folder: %2%nSettings and notes: %1
english.ModeUpdate=Update (recommended): keep all documents, notes and settings, replace only the program
english.ModeFresh=Fresh install: move the existing documents, notes and settings aside to a dated backup folder and start empty (nothing is deleted)
english.ModeWipe=Fresh install and delete: permanently delete the existing documents, notes and settings
english.WipeConfirm=The existing documents, notes and settings will be permanently deleted. This cannot be undone.%n%nContinue?
english.MovedInfo=The earlier data was moved here (restore it by renaming the folders back, or copy documents out of them):
korean.ModeTitle=설치 방식 선택
korean.ModeDesc=이전에 사용한 Everynote 데이터가 있습니다.
korean.ModeSub=설치 방식을 선택하세요.%n%n문서 폴더: %2%n설정·노트: %1
korean.ModeUpdate=업데이트 (권장): 문서·노트·설정을 모두 그대로 두고 프로그램만 교체합니다
korean.ModeFresh=새로 설치: 기존 문서·노트·설정을 날짜가 붙은 보관 폴더로 옮겨 두고 빈 상태로 시작합니다 (삭제하지 않음)
korean.ModeWipe=새로 설치하고 삭제: 기존 문서·노트·설정을 완전히 삭제합니다
korean.WipeConfirm=기존 문서·노트·설정이 완전히 삭제됩니다. 되돌릴 수 없습니다.%n%n계속할까요?
korean.MovedInfo=이전 데이터를 다음 위치로 옮겨 두었습니다 (폴더 이름을 되돌리거나 문서를 꺼내 쓸 수 있습니다):
korean.LibTitle=문서 저장 폴더
korean.LibDesc=문서와 노트를 저장할 폴더를 선택하세요.
korean.LibSub=문서, 노트, 녹음, 동영상이 이 폴더에 저장됩니다. 기존 문서는 자동으로 옮겨지지 않습니다. 나중에 설정 파일(%1\config.json)에서 바꿀 수도 있습니다.
korean.LibPrompt=문서 저장 폴더:
korean.TaskAssoc=PDF, HWP, Office 문서에 "Everynote로 열기" 추가 (기본 앱은 바뀌지 않습니다)
korean.GroupAssoc=파일 형식:
korean.PurgeData=Everynote 설정과 캐시도 함께 삭제할까요?%n%n(%1)%n%n문서는 어느 쪽을 선택해도 그대로 남습니다.
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
Root: HKA; Subkey: "Software\Classes\.pdf\OpenWithProgids"; ValueType: string; ValueName: "{#ProgId}"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associate
Root: HKA; Subkey: "Software\Everynote\Capabilities\FileAssociations"; ValueType: string; ValueName: ".pdf"; ValueData: "{#ProgId}"; Tasks: associate
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".pdf"; ValueData: ""; Tasks: associate
Root: HKA; Subkey: "Software\Classes\.hwp\OpenWithProgids"; ValueType: string; ValueName: "{#ProgId}"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associate
Root: HKA; Subkey: "Software\Everynote\Capabilities\FileAssociations"; ValueType: string; ValueName: ".hwp"; ValueData: "{#ProgId}"; Tasks: associate
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".hwp"; ValueData: ""; Tasks: associate
Root: HKA; Subkey: "Software\Classes\.hwpx\OpenWithProgids"; ValueType: string; ValueName: "{#ProgId}"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associate
Root: HKA; Subkey: "Software\Everynote\Capabilities\FileAssociations"; ValueType: string; ValueName: ".hwpx"; ValueData: "{#ProgId}"; Tasks: associate
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".hwpx"; ValueData: ""; Tasks: associate
Root: HKA; Subkey: "Software\Classes\.doc\OpenWithProgids"; ValueType: string; ValueName: "{#ProgId}"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associate
Root: HKA; Subkey: "Software\Everynote\Capabilities\FileAssociations"; ValueType: string; ValueName: ".doc"; ValueData: "{#ProgId}"; Tasks: associate
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".doc"; ValueData: ""; Tasks: associate
Root: HKA; Subkey: "Software\Classes\.docx\OpenWithProgids"; ValueType: string; ValueName: "{#ProgId}"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associate
Root: HKA; Subkey: "Software\Everynote\Capabilities\FileAssociations"; ValueType: string; ValueName: ".docx"; ValueData: "{#ProgId}"; Tasks: associate
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".docx"; ValueData: ""; Tasks: associate
Root: HKA; Subkey: "Software\Classes\.ppt\OpenWithProgids"; ValueType: string; ValueName: "{#ProgId}"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associate
Root: HKA; Subkey: "Software\Everynote\Capabilities\FileAssociations"; ValueType: string; ValueName: ".ppt"; ValueData: "{#ProgId}"; Tasks: associate
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".ppt"; ValueData: ""; Tasks: associate
Root: HKA; Subkey: "Software\Classes\.pptx\OpenWithProgids"; ValueType: string; ValueName: "{#ProgId}"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associate
Root: HKA; Subkey: "Software\Everynote\Capabilities\FileAssociations"; ValueType: string; ValueName: ".pptx"; ValueData: "{#ProgId}"; Tasks: associate
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".pptx"; ValueData: ""; Tasks: associate
Root: HKA; Subkey: "Software\Classes\.xls\OpenWithProgids"; ValueType: string; ValueName: "{#ProgId}"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associate
Root: HKA; Subkey: "Software\Everynote\Capabilities\FileAssociations"; ValueType: string; ValueName: ".xls"; ValueData: "{#ProgId}"; Tasks: associate
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".xls"; ValueData: ""; Tasks: associate
Root: HKA; Subkey: "Software\Classes\.xlsx\OpenWithProgids"; ValueType: string; ValueName: "{#ProgId}"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associate
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

var
  LibPage: TInputDirWizardPage;
  ModePage: TInputOptionWizardPage;
  FreshMode: Integer;   // 0 update (keep everything), 1 fresh install (old data moved aside), 2 fresh install (old data deleted)
  MovedList: String;

function DataDirPath(): String;
begin
  Result := ExpandConstant('{localappdata}\PDFNote');
end;

function DefaultLibDir(): String;
begin
  Result := ExpandConstant('{userdocs}\PDF Note');
end;

// library folder from an earlier installation's config.json ({"library": "C:\\path"}), else the default
function LibDirPath(): String;
var S: AnsiString; U: String; P, Q: Integer;
begin
  Result := DefaultLibDir();
  if not LoadStringFromFile(DataDirPath() + '\config.json', S) then Exit;
  U := String(S);
  P := Pos('"library"', U);
  if P = 0 then Exit;
  Delete(U, 1, P + 8);
  P := Pos('"', U);
  if P = 0 then Exit;
  Delete(U, 1, P);
  Q := Pos('"', U);
  if Q = 0 then Exit;
  U := Copy(U, 1, Q - 1);
  StringChangeEx(U, '\\', '\', True);
  if U <> '' then Result := U;
end;

function ParamValue(const Name: String): String;
var I: Integer; A: String;
begin
  Result := '';
  for I := 1 to ParamCount do
  begin
    A := ParamStr(I);
    if CompareText(Copy(A, 1, Length(Name) + 1), Name + '=') = 0 then begin Result := Copy(A, Length(Name) + 2, MaxInt); Exit; end;
  end;
end;

function HasExistingData(): Boolean;
begin
  Result := DirExists(DataDirPath()) or DirExists(LibDirPath());
end;

procedure InitializeWizard();
begin
  // /UPDATE (also used by the in-app updater) keeps everything and skips the page; /FRESH and /FRESHDELETE are the silent fresh installs
  FreshMode := 0;
  if HasParam('/FRESH') then FreshMode := 1;
  if HasParam('/FRESHDELETE') then FreshMode := 2;
  ModePage := CreateInputOptionPage(wpWelcome, CustomMessage('ModeTitle'), CustomMessage('ModeDesc'),
    FmtMessage(CustomMessage('ModeSub'), [DataDirPath(), LibDirPath()]), True, False);
  ModePage.Add(CustomMessage('ModeUpdate'));
  ModePage.Add(CustomMessage('ModeFresh'));
  ModePage.Add(CustomMessage('ModeWipe'));
  ModePage.SelectedValueIndex := 0;
  // documents folder (separate from the program folder); /LIBRARY="D:\Notes" sets it for silent installs
  LibPage := CreateInputDirPage(wpSelectDir, CustomMessage('LibTitle'), CustomMessage('LibDesc'), FmtMessage(CustomMessage('LibSub'), [DataDirPath()]), False, 'PDF Note');
  LibPage.Add(CustomMessage('LibPrompt'));
  if ParamValue('/LIBRARY') <> '' then LibPage.Values[0] := ParamValue('/LIBRARY') else LibPage.Values[0] := LibDirPath();
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if (LibPage <> nil) and (PageID = LibPage.ID) then
    Result := WizardSilent or (ParamValue('/LIBRARY') <> '');
  if (ModePage <> nil) and (PageID = ModePage.ID) then
    Result := WizardSilent or HasParam('/UPDATE') or HasParam('/FRESH') or HasParam('/FRESHDELETE') or (not HasExistingData());
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (ModePage <> nil) and (CurPageID = ModePage.ID) then
  begin
    if ModePage.SelectedValueIndex = 2 then
      Result := MsgBox(CustomMessage('WipeConfirm'), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
    if Result then FreshMode := ModePage.SelectedValueIndex;
  end;
end;

procedure SetAside(const Dir: String);
var Target: String;
begin
  if not DirExists(Dir) then Exit;
  Target := Dir + '.old-' + GetDateTimeString('yyyymmdd-hhnnss', #0, #0);
  if RenameFile(Dir, Target) then MovedList := MovedList + #13#10 + Target;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  CloseRunningApp();
  // update (the default) never touches documents or settings
  if FreshMode = 1 then begin SetAside(DataDirPath()); SetAside(LibDirPath()); end
  else if FreshMode = 2 then begin DelTree(DataDirPath(), True, True, True); DelTree(LibDirPath(), True, True, True); end;
  Result := '';
end;

procedure SaveLibraryChoice();
var Chosen, Json: String;
begin
  Chosen := RemoveBackslashUnlessRoot(Trim(LibPage.Values[0]));
  if Chosen = '' then Exit;
  // write config.json only when it differs from the default or an earlier choice must be replaced
  if (CompareText(Chosen, DefaultLibDir()) = 0) and (not FileExists(DataDirPath() + '\config.json')) then Exit;
  ForceDirectories(DataDirPath());
  ForceDirectories(Chosen);
  Json := Chosen;
  StringChangeEx(Json, '\', '\\', True);
  SaveStringToFile(DataDirPath() + '\config.json', '{"library": "' + Json + '"}', False);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then SaveLibraryChoice();
  if (CurStep = ssPostInstall) and (MovedList <> '') and (not WizardSilent) then
    MsgBox(CustomMessage('MovedInfo') + #13#10 + MovedList, mbInformation, MB_OK);
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
  LibDir := LibDirPath();
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
