# Everynote v3: Google Drive sync, printing, splitters, offline notes (agent UI2)

Files: `web/js/sync.js` (logic), `web/js/sync-ui.js` (dialogs, scheduler), `web/js/print.js`, `web/css/sync.css`, additions in `web/js/app-main2.js` / `web/css/main2.css`.
Tests: `node dev/sync-test.mjs` (fake in-page Drive, 100+ checks), `node dev/main2-test2.mjs` (splitters, print, offline dialog); screenshots in `dev/out/sync-*.png`, `main2b-*.png`.

## MainActivity API (installed by app-main2.js)
* `this.showSyncSettings()` – settings dialog: opt-in switch (default OFF, pref `sync_enabled`), Google sign-in/out (shows e-mail), OAuth client ID/secret
  (`google.config`; the secret is never read back/shown), how-to for creating the Google Cloud "Desktop app" OAuth client, "지금 동기화" + cancel + progress,
  auto sync (`sync_auto`: 0 off, 1 on open + when the window is hidden, 2 every 10 min), what to sync (`sync_pdfs`, `sync_ann`, `sync_assets`), last status, log.
* `this.printDocument()` – dialog (현재 페이지 / 전체 / 범위, 필기·주석 포함), pages rendered one at a time (150 dpi, `PdfDoc.renderPage` + `AnnotationPainter.all`, JPEG blobs),
  print-only DOM `.m2-print-root`, `window.print()`, removed on `afterprint` (15 min fallback). `@media print` + named `@page` (portrait/landscape per page) in main2.css.
* `this.showAboutOffline()` – lists what needs the internet / what works offline (`OFFLINE_NEEDS`, `OFFLINE_WORKS` exported from sync-ui.js).
* Splitters: side panel (`side_w` pref, 140..min(520, 60% of window)) and study panel (`study_w` wide / `study_h` narrow, min 220/120, leaves >= 260/200 px for the document).
  Pointer events (mouse/touch/pen), arrow keys when focused, double click resets. `this.sidePanelWidth()` returns the remembered width.

## Host contract used
`google.status() -> {signedIn,email,configured}`, `google.config`, `google.signIn`, `google.signOut`, `google.request({method,url,headers,body,bodyBase64,uploadPath,savePath})
-> {status,headers,text|savedPath}` (full https URLs; host adds the bearer token). Header names are matched case-insensitively (resumable `Location`).
`status 0` or a rejected promise = network failure. Needs: PUT with `uploadPath` to the resumable session URL (streamed from disk), GET `alt=media` with `savePath` (to a path under `<data>\tmp`).

## Layout on Drive (scope drive.file)
```
My Drive/Everynote Sync/
  <library tree, every PDF at its relative path>        a.pdf, folder/b.pdf ...
  <pdf name>.pdfnote.json     e.g. a.pdf.pdfnote.json   Android "PDF Note annotations v2" (AnnotationStore.exportJson(rel, name); uri = relative path)
  assets/<uuid>.png|m4a|mp4                              same file names as <data>\assets (flat)
  manifest.json               {format, version, updated, files:{key:{modifiedTime(ms), sha1, size}}}
```
Every uploaded file carries `appProperties.sha1` and `modifiedTime` = local mtime. Library folders named `assets` at the top level are skipped (reserved). Conflict copies:
`name (충돌 사본 YYYYMMDD-HHMM).pdf`, `<pdf name>.pdfnote.conflict-YYYYMMDD-HHMM.json` (ignored by sync, kept for manual recovery).

## `DriveSync` (sync.js)
```js
const s = new DriveSync({ library, account /*e-mail: state is per account*/, options:{pdfs,annotations,assets}, log(text), onProgress({phase,text,done,total}),
                          confirmDeletions(list[{key,kind,side:'local'|'remote',name}]) -> Promise<string[]>, retryDelay });
const summary = await s.run();  // {uploaded,downloaded,deletedLocal,deletedRemote,conflicts,deferred,same,errors[],cancelled}
s.cancel();  s.changedLocal  // Set of local paths written (to refresh an open document)
```
* Three-way merge with `<data>\sync\state-<sha1(email)>.json` (per key: last local sha1 + last remote version + id). Only local changed -> upload; only remote -> download;
  both -> last writer wins by modified time, the loser is kept as conflict copy (PDF: copy beside it, annotations: json on Drive); no base + both exist + same sha1 -> adopted.
* Deletions never happen silently: a file missing on one side that was synced before is passed to `confirmDeletions`; confirmed -> local `library.trash()` (library trash)
  / Drive trash; not confirmed -> restored on the side that lost it. Without a callback (auto sync) the deletion is deferred (`summary.deferred`). Assets are never deleted.
* Files < 4 MB multipart (`bodyBase64`/`body`), larger resumable (`uploadPath`, whole file per attempt, 3 attempts). 429/5xx/rate-limit 403 retried with back-off.
  Per-file errors go to `summary.errors` and the run continues; offline/auth/quota/cancel abort. Errors are `SyncError` with `.code` in `offline|auth|config|quota|cancelled|http`
  and Korean messages (`MESSAGES`); `run()` rejects with them (`err.summary` attached), except cancel which resolves with `cancelled:true`.
* Annotations: local sidecar -> `exportJson`; remote -> `importJson(text, MAX)` into the store bound to the local PDF (a PDF that is not local is skipped). If the document is open
  the controller reloads the store and calls `redrawPages()`.

## sync-ui.js exports
`showSyncSettings(app)`, `showAboutOffline()`, `confirmDeletionsDialog(list)`, `SyncController` / `getSyncController(app)` (`syncNow({interactive})`, `auto()`, `applyAuto()`, `status()`),
`initSyncAuto(app)` (called from `initMain2`: 6 s after start and when the window becomes hidden, plus the 10-minute timer), `addLog/getLog/clearLog`.

## Known gaps
* Closing the window cannot wait for a sync; "열 때·닫을 때" syncs at start and when the window is hidden/minimized (>= 2 min since the last run).
* Resumable uploads restart from byte 0 after a failure (the host protocol streams whole files). Local mtimes cannot be set after a download, so after a download the base state (not mtime) decides.
* Remote listing is a full walk per run (one request per folder); the Drive `manifest.json` is only a fallback source of sha1 for files written by other clients.
* A PDF replaced under an open document is not reloaded; annotations of the open document are.
