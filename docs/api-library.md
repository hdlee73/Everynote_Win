# api-library: library.js / library-dialog.js / library.css

Ports of `LibraryRepository`, `NotebookFiles`, `LibraryDialog`, `FolderTreeView`, `FolderIconDrawable`, `FolderShapeDrawable`, `PaperChoiceView`.
Java `File`/`Uri` == absolute Windows path string. Everything touching the disk is `async` (via `js/host.js`); preference-only methods stay **sync**.
Test harness: `dev/library-test.html` + `node dev/library-test.mjs` (55 assertions, screenshots in `dev/out/library-*.png`).

## js/library.js

```js
import { LibraryRepository, NotebookFiles, Paper, IOException, TrashItem, Sidecars, readNotebookPaper,
         normPath, pathKey, samePath, parentOf, joinP, jcmp, sha1Hex } from './library.js';
```

### `new LibraryRepository()` — `await library.ready`
`root` (string, normalised `C:\...\PDF Note`) is only valid after `ready` (resolves to the repository). Preferences = Android `pdf_note_library`
SharedPreferences, kept in memory, persisted to `<data>\library.json` (same keys: `sort view pin_favorites color:<path> fav:<path> opened:<path> trash:<path> paper:<path> source:<path>`).
`await library.flush()` writes now (writes are otherwise debounced 60 ms; mutating operations flush themselves).

| Java | JS | |
|---|---|---|
| `root` | `root` | string |
| `managed(File/Uri)` | `managed(path)` | sync, case-insensitive prefix test |
| `list(dir)` | `await list(dir)` -> `string[]` | dirs first, case-insensitive Java order, hides `.x`, non-pdf |
| `file.isDirectory()` | `isDirectory(path)` | sync, answered from the cache filled by `list/sorted/allDocuments/...` |
| `sorted(dir,q)` / `allDocuments(q)` / `favorites(q)` / `recent(q,limit)` | same, async -> `string[]` | |
| `folderCount()` | `await folderCount()` | |
| `sortMode()` `sortMode(v)` `viewMode()` `viewMode(v)` `pinFavorites()` `pinFavorites(v)` | same, **sync** | |
| `folderColor(f)` / `folderColor(f,c)` | sync (signed ARGB int, legacy colours mapped) | |
| `favorite(f)` / `favorite(f,on)` | sync | |
| `opened(uri)` | `opened(path)` sync (stamps `opened:`); `openedAt(path)` reads it | |
| `trash(f)` `trashItems()` `restore(item)` | async; `TrashItem{file,name,parent,deleted}` | |
| `createFolder(parent,title)` `createNote(parent,title,paper)` | async -> path | |
| `paper(file)` | **sync** -> `Paper \| null` | pref `paper:<path>` |
| `imported(uri)` | async -> path \| null | |
| `importPdf(src,title,destFolder)` | async -> path | validates with pdf.js (`빈 PDF입니다` / `PDF를 읽을 수 없습니다`), keeps notebook metadata -> paper pref |
| `transfer(src,destFolder,title,move)` | async -> path | rename/move/copy; move uses `host.move` |
| `insertPage(file,paper,afterIndex)` `deletePage(file,index)` `append(file,paper)` | async -> page count | |
| `modified(file)` | async: `max(file mtime, sidecar mtime)` | |
| `purge(item)` `emptyTrash()` | async; `emptyTrash()` permanently deletes every trashed document (+ sidecars) and resolves to the count (Android v1.31.0 `emptyTrash`) | |

Static: `SORT_NAMES`, `VIEW_NAMES`, `FOLDER_COLORS` (signed ints as in Java), `LEGACY_FOLDER_COLORS`, `FOLDER_COLOR_NAMES`.
All mutators are serialised (Java `synchronized`). Errors are `IOException` (`.message` = the Korean string of the spec).
Sidecars: `transfer(move)` calls `AnnotationStore.moveSidecar`, copy / `importPdf` call `AnnotationStore.cloneAnnotations(from,to,count)` (only if a sidecar exists),
`purge` calls `deleteSidecar`, dates use `AnnotationStore.modified`; all via guarded dynamic import of `./store.js` with a PLAN-layout fallback (`Sidecars` export).

### `NotebookFiles`
`PAPER_NAMES`, `COLORS` (signed ints), `COLOR_NAMES`, `Paper(kind,color)`, `await root()`, `name(text)`, `pdfName(title)`, `await unique(folder,name)`,
`await create(folder,title,pages,paper)`, `await blank(...)`, `await append(file,paper)`, `await insert(file,paper,afterIndex)`, `await delete(file,index)`, `await replace(temp,target)`.
Notebook PDFs are written with pdf-lib (A4 595.27563x841.8898, fill, ruling #B9C3CD 0.45pt, step 25/18, Info `PDFNoteNotebook=true`, `PDFNotePaper=kind:signedColor`),
saved **without object streams** so the Info dictionary stays plain (PDFBox on Android reads it; `readNotebookPaper` greps for it because pdf.js does not expose custom Info keys).

## js/library-dialog.js

```js
import { LibraryDialog, FolderTreeView, FolderIconDrawable, FolderShapeDrawable, PaperChoiceView,
         ProgressDialog, rebindButton, inputField, coverOverlay, clearCoverCache, dateText } from './library-dialog.js';
```

### `new LibraryDialog(activity, library, folderPath, actions)`
`actions` (all optional) = `{ open(file), importFiles(folder), newNote(folder, refresh), changed(src, tgt, moved), selectedFolder(folder), removed(files) }`
(same semantic as the Java `Actions`; `open` is called after the dialog dismissed itself; `importFiles` after dismiss too).
Methods: `show()`, `dismiss()`, `isShowing()`, `onBackPressed()` (Esc is wired), `refresh()`, `setOnDismissListener(fn)`.
Full-screen overlay (`.lib-root`, z-index 5000; AlertDialog 9000, menus 9500, progress 9100). Wide layout (rail) = viewport >= 600 px, live via CSS media query.
Windows decisions: `공유` reveals the first selected file in Explorer (`host.reveal`); right-click == long-press; edge swipe for the drawer only for touch/pen;
`setError` is a red line under the field; `PaperChoiceView` uses a native `<select>`.
Cover thumbnails: page 1 via `PdfDoc`, scale `min(320/pw,480/ph)`, annotations of page 0 via `AnnotationPainter.all` (hook `coverOverlay.fn(ctx,w,h,path)`), top square crop,
JPEG cached in `<data>\thumbs\<sha1(path)[:16]>-<sha1(path:mtime:sidecarMtime:top)[:16]>.jpg` (outdated files of the same document are deleted), plus a 12 MiB in-memory LRU; one render at a time; stale jobs skipped.

### Other classes
* `FolderIconDrawable(color,size)`: `.svg(size?)` string, `.el(size?)` element (for the MainActivity library button: `new FolderIconDrawable(FOLDER_COLORS[1], 30).el()`).
* `FolderShapeDrawable(color)`: `.svg(w,h,cls?)`, `.el(w,h)`.
* `FolderTreeView(activity, library, selectedPath, listener(folder))`: `.el`, `.selected()`, `await .select(folder)`, `await .reload()`, `.setFolderMenu((folder, el) => ...)`, `.ready`.
* `PaperChoiceView(activity)`: `.el`, `.paper()` -> `Paper`; use inside `AlertDialog.Builder().setView(pc.el)` for the new-note / add-page dialogs.
* `ProgressDialog.show(title, message)` -> `{dismiss(), setMessage(m)}` (modal spinner; usable for `PDF 가져오기` / `문서함에 저장하는 중…`).
* `rebindButton(dialog, BUTTON_POSITIVE, fn)`: replaces the click handler of an `AlertDialog` button so it does not auto-dismiss (Android `getButton().setOnClickListener`).
* `inputField({hint,text,label})` -> `{view,input,setError(msg)}` (single-line EditText with Android-style error).

## Known gaps / notes
* Needs `Map.prototype.getOrInsertComputed` (pdf.js 5) — present in WebView2 current; the test page polyfills it for the bundled Playwright Chromium.
* Folder rename/move/delete do not exist in the Android UI and are not added.
* The cover placeholder is the Android `ic_note_add` glyph scaled with CENTER_CROP (large black outline) exactly as specified; flashes briefly while a cover loads.
* In-memory cover blob URLs are never revoked (small JPEGs, LRU only bounds the lookup table).
* `host.move` is assumed to move files/folders on the same volume; `NotebookFiles.replace` falls back to delete + move if the host refuses to overwrite.

## v1.27.0 additions (new-note templates)
* `NotebookFiles.PAPER_NAMES` (10: 백지, 줄노트 (보통), 모눈종이, 리걸노트, 줄노트 (좁게), 줄노트 (넓게), 점 격자, 코넬 노트, 오선지, 내 PDF·이미지 서식), `NotebookFiles.CUSTOM = 9`, `COLORS` (9, adds 리갈 옐로, 연보라, 검정) / `COLOR_NAMES`; `NotebookFiles.layout(kind, w, h)` / `ruleColor(style)` / `ruleColorOn(style, paperColor)` (dark papers lighten the rules), `NotebookFiles.isPdf(path)`.
* `new Paper(kind, color, template = null)`; kind 0..9; kind 9 needs `template` (path of a PDF or image; else throws `서식 파일을 먼저 고르세요`). `paper.spec()` = `kind:color[:template]` (stored in prefs and in the PDF Info `PDFNotePaper`, backslashes escaped), `Paper.parse(spec)` (Java `Paper.parse`, throws on malformed). `lib.paper(file)` / import / copy / move keep the template.
* `await NotebookFiles.importTemplate(srcPath)` copies a picked PDF/image to `<data>\templates\<uuid>.<ext>` and returns the copy's path (do this before `setTemplate`/`new Paper(9, c, path)` so the template survives the original moving). Custom PDF template: first page imported per new page; image: fit-centred on the paper colour (non png/jpeg decoded via canvas and re-encoded as JPEG).
* `PaperChoiceView`: `.setTemplate(path|null)`, `.onTemplateRequest(fn)` (Java `onTemplateRequest`; if no handler is set the view opens the file dialog itself, calls `importTemplate` and `setTemplate`), `.paper()` throws `서식 파일을 먼저 고르세요` for kind 9 until a template is set — wrap `paper()` in try/catch where the dialog's positive button uses it (`insertPage` in app-main2 line ~711 currently does not).

## v3.3.0 (Android v1.31.0 port)
* Trash dialog (`LibraryDialog.showTrash`): list rows (tap = restore) plus a neutral `휴지통 비우기` button (red) -> `confirmEmptyTrash(count)` ("영구 삭제" / "취소") -> `repository.emptyTrash()` -> refresh + toast `N개 문서를 영구 삭제했습니다`.
* List dialogs (trash, view method, sort, folder colour, page animation, add document, ... = `AlertDialog.Builder.setItems/setSingleChoiceItems` and `showActionSheet`) are no longer bottom sheets: they are centred menu cards in the style of `ui/menu.js` (18px radius, hairline border, 44px left-aligned rows, gray caption, accent bold label + check on the selected row, red `삭제/비우기` buttons, buttons as rows under a hairline, no separate cancel card; tap outside / Esc closes). DOM: `.ad-sheet[data-tag=action_sheet] > .ad-list[data-tag=anchored_menu]`, rows `.ad-cell` (`aria-label` = label).
* Overflow `메뉴` and the page menu (`showSheet`, `.m2-bsheet[data-tag=menu_sheet]`) use the same card: rows `.m2-tile` (20px icon, label, ✓ when `selected`), group captions and hairlines between sections; no grabber / icon tiles / close button (Esc or tap outside).
