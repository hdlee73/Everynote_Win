# PDF Note for Windows v2 — port plan (READ FIRST)

Goal: pixel/feature-faithful port of the Android app (/home/claude/hdlee73/pdf-note, Java, v1.26.0) to Windows.
Stack: HTML/CSS/JS ES modules (no bundler) in /home/claude/pdf-note-windows/web, shown inside a WPF + WebView2 shell (host/).
Specs written from the Java source: /home/claude/spec/{main1,main2,main3,pageview,library}.md (+ icons in spec/icons). The Java source is the
ground truth: when a spec is unclear, read the Java (…/app/src/main/java/com/hdlee/pdfnote/*.java).

## Rules
* Port class by class; keep the Java public method/field names (camelCase as in Java) so app.js (port of MainActivity) can call them 1:1.
  Java `Canvas`/`Paint`/`Bitmap` -> Canvas2D (`CanvasRenderingContext2D`, `HTMLCanvasElement`/`OffscreenCanvas`). `RectF` -> `RectF` from js/util.js.
* 1 dp == 1 CSS px. Colours: Java ARGB ints stay numbers in data (JSON compatible with Android backups); use `argb(int)` from util.js for CSS.
* Synchronous Java file I/O becomes `async` through js/host.js (`host.readBytes/writeBytes/readText/writeText/list/move/...`).
* Never edit files you don't own (see ownership). Shared files (util.js, host.js, prefs.js, ui/*, css/app.css, pdfdoc.js, icons.js) are owned by the
  lead; if you need a change, make it append-only in your own module or message the lead in your final report. Put module CSS in css/<module>.css
  (the lead links it from index.html) or inject <style> from JS.
* No localStorage for documents; `prefs` (sync, localStorage) only for settings.
* Everything user-visible: exact Korean strings from the specs/Java.
* Test with Playwright (node, chromium): `import { chromium } from '/tmp/npmtest/node_modules/playwright/index.mjs'`,
  launch with `executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'`; serve web/ with `node dev/server.mjs <port>` (dev/server.mjs exports serve()).
  Sample PDFs: dev/samples/sample-ko.pdf (12 pages, Korean/English text), dev/samples/sample.pdf. Take screenshots and LOOK at them (Read tool on png).
  Put your harness in dev/<module>-test.html + dev/<module>-test.mjs. Fix what you see. Do not commit (the lead commits).
* End your work with docs/api-<module>.md (exports, constructor/method signatures, events/callbacks, known gaps) and a short report.

## Modules / ownership
| file | content | owner |
|---|---|---|
| js/util.js icons.js host.js prefs.js pdfdoc.js ui/alert.js ui/menu.js ui/toast.js css/app.css index.html app.js | foundation + MainActivity port | lead |
| js/store.js | AnnotationStore + Mark, InkStroke, OutlineItem, TranslationNote, PageElement, StudyEntry (+ JSON read/write identical to Android) | agent core-data |
| js/painter.js js/shapes.js | AnnotationPainter, Shapes (+ Glyph not needed) | agent core-data |
| js/pageview.js | PdfPageView (all gestures, tools, selection, lasso, rendering of page+annotations) | agent pageview |
| js/curl.js | PageCurlView | agent curl |
| js/library.js js/library-dialog.js | LibraryRepository, NotebookFiles, LibraryDialog, FolderTreeView, FolderIcon/Shape, PaperChoiceView | agent library |
| js/search.js | SearchScanner + search panel UI (buildSearchPanel) | agent search |
| host/ .github/workflows tools/ js/office.js | WPF+WebView2 shell, host protocol (see js/host.js header), Office/HWP conversion, OCR, CI | agent host |

## Key shared contracts
* `PdfDoc` (js/pdfdoc.js): `await PdfDoc.open(bytes)`, `.pageCount`, `await .pageSize(i)` -> {w,h} pt, `await .renderPage(i, ratio)` -> canvas, `await .pageText(i)`, `await .textRegions(i)` -> TextRegion[] {word,line,wordBounds,lineBounds}, `await .outline()`.
* A "document key" (`uri` in Java) is the absolute Windows path of the PDF inside the library (string). Sidecar annotations: `<data>\annotations\<sha1 of lowercase path>.json` unless the library spec says otherwise; library rename/move must carry sidecars along.
* PdfPageView API: same names as Java; constructed `new PdfPageView(listener)` where `listener` is a plain object with the Java Listener method names;
  root DOM element in `.el`. `showPage(canvas, pageNumber, marks, strokes, translations)`.
* host protocol: see header of js/host.js.
