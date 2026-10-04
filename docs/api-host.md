# Host shell (host/), conversion (js/office.js), installer and CI

WPF (.NET 8) window hosting WebView2. The whole `web/**` tree is embedded in the exe as resources and served from
`https://app.pdfnote.local/*` (no loose folder). Protocol: header of `web/js/host.js`.

## Layout

| file | role |
|---|---|
| `host/Everynote.csproj` | assembly `Everynote.exe` (product Everynote, v3.0.0), net8.0-windows10.0.19041, WPF, `Microsoft.Web.WebView2` 1.0.2903.40, `System.Security.Cryptography.ProtectedData`, embeds `..\web\**\*` as `web/<relative path>` |
| `host/App.xaml.cs` | startup, single instance (named mutex + `PDFNote-open-<user>` pipe, CurrentUserOnly), command-line files, WebView2-runtime-missing dialog |
| `host/MainWindow.xaml.cs` | WebView2 setup/policies, fullscreen, window state, event/response posting |
| `host/WebServer.cs` | `app.pdfnote.local` (embedded resources) and `file.pdfnote.local/f?p=` (disk, Range) via `WebResourceRequested` (all source kinds, so workers work) |
| `host/Bridge.cs` | every protocol method |
| `host/Paths.cs` | folders, log, `PathPolicy` allow-list |
| `host/Office.cs`, `SpreadsheetPrep.cs` | Office/LibreOffice conversion, port of Android `SpreadsheetImport` (xlsx) |
| `host/Ocr.cs` | `Windows.Media.Ocr` |
| `installer/Everynote.iss` | Inno Setup script (+ `Korean.isl`, `everynote.ico`, wizard images, icon SVG) |
| `tools/installer-smoke.ps1` | CI test of the installer (silent install / uninstall) |
| `tools/make_icons.py` | `web/assets/everynote-icon.svg` -> PNGs, `host/Assets/app.ico`, installer images |
| `web/js/office.js` | JS side of conversion (HWP in a Web Worker, Office through the host) |
| `tools/prepare_hwp_engine.py` | Android's engine build/patch script, output `web/hwp/` |
| `tools/smoke.ps1`, `tools/smoke-host.js` | CI smoke test (see below) |

## Host protocol notes (beyond host.js)

* `app.info()` -> `library` = `Documents\PDF Note` (override: env `PDFNOTE_LIBRARY` or `%LOCALAPPDATA%\PDFNote\config.json` `{"library":"D:\\x"}`),
  `data` = `%LOCALAPPDATA%\PDFNote` (env `PDFNOTE_DATA`), `temp` = `<data>\tmp` (swept at start, >2 days), `documents`, `args` (files from the
  command line that were not yet delivered), `version`, `platform:'win'`. Calling `app.info` marks the page ready.
* Events: `{ev:'open.file', d:{path}}` for files passed by a second instance / shell after the page called `app.info` once (earlier ones are
  returned in `args`). `{ev:'office.progress', d:{id,text}}`.
* `fs.list` -> `mtime` in ms since epoch (UTC). `fs.move` of a directory across volumes copies then deletes. `fs.writeBegin/Chunk/End` write
  `<path>.<token>.part` and rename on `End` (atomic; nothing appears at `path` before `End`). `fs.writeText` is atomic as well.
* `fs.url` -> `https://file.pdfnote.local/f?p=<encoded path>`; supports `Range` (206/416), `HEAD`, CORS only for the app origin. Errors
  (not found / not allowed) are rejected promises with a Korean message.
* `dialog.open` returns `[]` on cancel, `dialog.save` returns `null`. Filters: `[{name, exts:['pdf']}]` plus an automatic "모든 파일".
* `shell.open({url})` accepts http/https/mailto only; `shell.open({path})` refuses executable/script types. `shell.reveal` selects the file in Explorer.
* `window.fullscreen({on})`: borderless maximized + topmost. HTML element fullscreen (`ContainsFullScreenElement`) toggles the same state.
* `power.keepAwake({on})`: `SetThreadExecutionState(ES_CONTINUOUS|SYSTEM|DISPLAY)` on the UI thread (released automatically on exit).
* `office.engines()` -> `{word, excel, powerpoint, libreoffice: path|null}` (ProgID registry keys; LibreOffice via `UNO\InstallPath`, Program Files, PATH).
* `office.convert({id,path,kind})` -> `{pdf: <temp path>}`; the caller imports/deletes the PDF (`host.delete`). Strategy per file family:
  Office COM (late bound, own STA thread, read-only, macros disabled, quits the app only if it left no other document open) ->
  on failure LibreOffice `soffice --headless --convert-to pdf` (persistent profile `<data>\lo-profile`) -> else error
  `LibreOffice 또는 Microsoft Office가 설치되어 있지 않습니다`. Excel: gridlines off / fit to 1 page wide (`.xls` borders removed via COM,
  `.xlsx` through `SpreadsheetPrep`, which is the C# port of Android `SpreadsheetImport` incl. the `<!DOCTYPE` / size limits and its
  error strings). Timeout 10 min (`변환 시간이 초과되었습니다`), cancel -> `변환이 중단되었습니다`. Progress texts:
  `문서를 준비하고 있습니다` then `원본 서식을 PDF로 변환하는 중`.
* `ocr.recognize({png:b64, lang})` -> `{width,height,words:[{text,x,y,w,h,line}]}` in pixels of the PNG. `lang` = BCP-47 tag
  (`ko`, `en-US`) or `auto`/omitted: user-profile languages engine, plus the Korean engine if installed (the result with more characters wins).
  Images larger than `OcrEngine.MaxImageDimension` are downscaled for recognition and the boxes scaled back.
  Without any OCR language the promise rejects with `OCR 언어 팩이 설치되어 있지 않습니다...`.
* `app.log({msg})` -> `%LOCALAPPDATA%\PDFNote\log.txt` (rotates at 2 MB). Host errors are logged too.

## JS API (`web/js/office.js`)

```js
import { convertHwp, convertOffice, officeEngines, makeCancelToken, isHwp, isOfficeDocument, canConvertOffice,
         OFFICE_INSTALL_GUIDANCE } from './office.js';
const token = makeCancelToken();                       // token.cancel() aborts; an AbortSignal works too
const pdf = await convertHwp(bytes /*Uint8Array*/, text => setStatus(text), token);   // -> Uint8Array
const { pdf: path } = await convertOffice(path, 'docx', text => setStatus(text), token);
```
* `looksLikeSpread(pdfBytes)` / `splitSpreads(pdfBytes)` (v1.30.0, pdf-lib; detection extended in v1.30.1): looks at the first <= 6 pages, ignores portrait pages (width <= 1.2 x height) and answers true when every landscape page is wide (width >= 1000pt and > 1.25 x height) **or** >= 70% of the landscape pages with enough text (>= 30 characters, `PdfDoc.textColumns`) have the body in two blobs with a blank gutter (left >= 25% and right >= 25% of the characters, <= 1.5% in the 45-55% centre band; false for rotated pages) -> ask to split. `hasLandscapePages(pdfBytes)` tells whether a split would change anything. The more-menu (export group) entry `두 쪽 나눈 사본 만들기` (`app.splitCurrentDocument`) runs `splitSpreads` on any open PDF with landscape pages, imports the copy as `<title> (한 쪽씩)` into the current library folder and opens it ("나눌 가로로 넓은 면이 없습니다" when there is nothing to cut); `splitSpreads` cuts every unrotated landscape page at the middle into left/right pages (duplicated page dict + MediaBox/CropBox, text kept) and resolves to new bytes; `app.convertHwp` falls back to the unsplit PDF on error.
* `convertHwp` runs rhwptopdf in a Blob-URL Worker (engine text + wasm fetched from `hwp/rhwptopdf.umd.js` / `_bg.wasm`; works even if the
  worker cannot fetch). Fonts read from `C:\Windows\Fonts` through `fs.url`: `batang.ttc`, `malgunbd.ttf`, `malgun.ttf` (+`gulim.ttc` when
  Batang or Malgun is missing); none readable -> `기기에서 변환용 글꼴을 읽지 못했습니다`. Limits like Android: 48 MiB input
  (`48MB 이하의 한글 문서를 선택하세요`), 180 s (`변환 시간이 초과되었습니다`), worker crash
  (`변환 엔진이 종료되었습니다. 더 작은 문서로 시도하세요`), result must be 5 B..128 MiB and start with `%PDF-`. Status strings:
  `한글 문서를 준비하고 있습니다` -> `표·그림과 페이지를 PDF로 변환하는 중`. Global name of the engine is resolved defensively
  (`RhwpToPdf`, `HwpToPdf`, `wasm_bindgen`).
* `convertOffice` rejects with `err.noEngine === true` (+ `err.guidance`) when no converter exists; user cancellation has `err.cancelled === true`
  (`변환이 중단되었습니다`). The caller (app.js) shows the Android dialogs/toasts and falls back to `offerOfficeImport`.
* Not implemented here (lead): the AlertDialogs, `importConverted`, `offerOfficeImport`, text-only preview.

## Printing

* Printing: done in the page with `window.print()` (print-only DOM); WebView2 shows its print dialog. Nothing to allow on the host side; Ctrl+P is a page shortcut because browser accelerator keys stay off.

## Security model

* Only the embedded app origin may talk to the host: `WebMessageReceived` is ignored unless `e.Source` starts with `https://app.pdfnote.local/`;
  top-level navigation away from it is cancelled (http/https opened in the system browser); new windows/downloads open externally
  (http/https) or, for `blob:` downloads, show a Save dialog.
* Read allow-list (fs.url/list/stat/readText/copy source, shell.reveal, office source): library, `%LOCALAPPDATA%\PDFNote`, system temp,
  `C:\Windows\Fonts`, and files the user picked (`dialog.open`, command line, second instance; persisted in `<data>\allowed.json`, max 500).
  Write allow-list (writeText/Begin, mkdir, move/copy target, delete): library, data, system temp, files chosen in `dialog.save`.
  Library/data roots themselves cannot be deleted. Paths are normalised with `GetFullPath` first (no `..` tricks); symlinks/junctions inside
  allowed roots are not resolved.
* `file.pdfnote.local` answers CORS only for `https://app.pdfnote.local`. Context menu, browser accelerator keys (F5/F12/Ctrl+P...), zoom
  and DevTools are off unless `--dev` / `PDFNOTE_DEV=1` (`PDFNOTE_DEV_URL=http://localhost:8123/` to load a dev server).
* Permissions: microphone and clipboard-read allowed for the app origin only, everything else denied.
* Office documents are opened read-only with macros force-disabled; LibreOffice runs with its own profile and without UI.

## Build / CI (`.github/workflows/build.yml`)

* `hwp-engine` (ubuntu): clone `sanguneo/rhwptopdf@adbc4bf`, rust wasm32 + wasm-pack, `tools/prepare_hwp_engine.py --out web/hwp`
  (same patch + regression test as Android, Noto CJK as test font), artifact `hwp-engine` (umd.js 16 KB, wasm ~6 MB). Engine files are git-ignored.
* `build` (windows-latest): downloads the artifact into `web/hwp/` (a build without it still works, HWP then reports the missing engine; on a
  tag it is an error), `dotnet publish host/Everynote.csproj` single-file self-contained ReadyToRun for `win-x64` and `win-arm64`
  (`out/<arch>/Everynote.exe`), `choco install innosetup`, compiles `installer/Everynote.iss` for both architectures
  (`/DAppVersion /DArch /DSourceExe /DOutputBase /DOutDir`), smoke tests the app, then the installer, then
  `dist/Everynote-<tag|dev>-win-{x64,arm64}.exe` + `dist/Everynote-Setup-<tag|dev>-{x64,arm64}.exe` as artifact `Everynote-windows`; on `v*` tags `gh release view` -> create or
  `upload --clobber`, notes from `docs/release-notes/<tag>.md` (falls back to `--generate-notes`). `Version` comes from the tag. Branches `main`, `host-dev`, `host-v3` build on push.
* Installer (`installer/Everynote.iss`): per-user by default (`{autopf}` = `%LOCALAPPDATA%\Programs\Everynote`, `PrivilegesRequiredOverridesAllowed=dialog commandline`), Start menu + optional
  desktop shortcut with `AppUserModelID=hdlee73.Everynote` (the exe sets the same id at startup so taskbar pinning works), Apps & features entry (AppId `{3D6B1F4E-...}`, key `..._is1`),
  Korean + English, closes a running instance (Restart Manager + `taskkill`), optional "Open with Everynote" task (ProgId `Everynote.Document`, `OpenWithProgids` of
  pdf/hwp/hwpx/doc/docx/ppt/pptx/xls/xlsx, Capabilities/RegisteredApplications; UserChoice is never written). Uninstall keeps `%LOCALAPPDATA%\PDFNote` and `Documents\PDF Note`
  unless the user answers the prompts (silent: `/PURGEDATA`, `/PURGELIBRARY`). Silent switches: `/VERYSILENT /CURRENTUSER|/ALLUSERS /TASKS="desktopicon,associate"`.
* `tools/installer-smoke.ps1` (CI): silent install, checks exe / product name / Start menu + desktop shortcut / uninstall entry / ProgId / `.pdf` default not hijacked, starts the installed app
  (left running; the uninstaller must close it), silent uninstall (files, shortcuts, registry gone, data kept), then reinstall without tasks (no desktop shortcut, no association) and uninstall with `/PURGEDATA`.
* Build errors are re-emitted as `::error` annotations (read with `gh api repos/hdlee73/PDF-Note-Windows/check-runs/<job>/annotations`).
* Smoke test (`tools/smoke.ps1`): launches the exe with `dev/samples/sample-ko.pdf`, env `PDFNOTE_DATA/LIBRARY` point to a temp dir,
  `PDFNOTE_DEBUG_PORT=9333` opens the DevTools port; waits for the page `https://app.pdfnote.local/...`, then evaluates
  `tools/smoke-host.js` inside the app: host protocol round trips (text/3 MB binary write+read, stat/list/move/copy/delete, Range fetch,
  allow-list denials, Windows font read, fullscreen/keepAwake, engines, **OCR of a generated image**) and reports `::notice`/`::error`;
  also screenshot (artifact `smoke-test`), process memory, app log. Manual run with input `test_libreoffice` installs LibreOffice via
  choco and converts a generated `.docx` through `office.convert`.
* WebView2 Evergreen runtime is required on the user's machine (preinstalled on Windows 11 and current Windows 10); otherwise a dialog with
  the download link appears.

## Known gaps

* Office COM paths (Word/Excel/PowerPoint) are written against the documented object models but could not be exercised in CI (no Office on
  runners). LibreOffice path is exercised only via the manual `test_libreoffice` run.
* `.xls` gridline/border cleanup only happens when Excel COM is used; with LibreOffice `.xls` is converted unmodified.
* Password-protected Office files fail (no prompt) or hit the 10 min timeout; Word/PowerPoint cancellation kills the Office process we started.
* No drag&drop of files from Explorer to paths (the page receives `File` objects only; read them with `file.arrayBuffer()` + `host.writeBytes`).
* Chosen-file allow-list entries for files opened from outside the library are remembered, but a file moved/deleted later simply fails to open.
* `Documents\PDF Note` is the default library (spec suggests `%LOCALAPPDATA%\PDFNote\documents`); change via `config.json` if the lead prefers.
* HWP: quality depends on fonts available in `C:\Windows\Fonts` (Korean Windows ships Malgun Gothic and Batang; non-Korean installs may lack them).
