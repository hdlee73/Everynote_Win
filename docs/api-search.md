# js/search.js - SearchScanner (port of `SearchScanner.java`)

```js
import { SearchScanner, scan, Hit, Line, MAX_HITS, contains, annotations, usableTextLayer, inkSignature, invalidate } from './js/search.js';
```
Scope: the scanner only (no panel UI; `buildSearchPanel` is not in this file - app.js/MainActivity port drives it as in Java `startSearch`).

## API
| export | Java | notes |
|---|---|---|
| `MAX_HITS = 500` | `MAX_HITS` | cap on body+ink hits, annotation hits count towards it but are never cut |
| `class Hit {page,x,y,box:RectF,kind,text,matchStart,matchEnd}` | `Hit` | `box` normalized; kinds `메모 번역 노트 타이핑 링크 본문 필기` |
| `class Line` (`fromWords`, `match`, `toJson`, `fromJson`) | `Line` | word-granular highlight boxes |
| `contains(text, q)`, `annotations(store, q)` | same | plain case-insensitive substring |
| `usableTextLayer(lines)`, `inkSignature(store, page)` | same | |
| `async scan(doc, uri, store, pageCount, startPage, query, forceOcr, canceled, listener)` -> `Promise<boolean truncated>` | `scan(context, uri, ...)` | `doc` = `PdfDoc` replaces `Context`; `uri` = document key (absolute path) |
| `invalidate(uri)` | - | drop the in-memory index (file replaced) |

`canceled` = `{value:false}`; set `canceled.value = true` to stop (like `AtomicBoolean`). On cancel `scan` resolves normally (Java behaviour: final `progress(pageCount,pageCount)` is still emitted, hits already delivered stay valid) - the caller decides what to do with the partial list and ignores stale scans via its own session token.

`listener = { progress(done,total), hits(list), warning?(message) }` - called in order on the main thread (sync functions). `hits` batches: first all annotation hits (marks, translations, studyEntries, elements; stored order, unsorted, uncapped), then one batch per page in cyclic order from `startPage`, each sorted by `box.top` (stable). `warning` (extra, optional): called once at the end if OCR was needed but `ocrHook.fn` is null: `OCR을 사용할 수 없어 스캔·손글씨 N쪽은 검색하지 못했습니다`. Errors from render/OCR/host propagate as rejections (toast `검색 실패: <message>` unless canceled).

`store` fields used (Java names): `marks[{page,left,top,right,bottom,note}]`, `translations[{page,left..bottom,source,translated}]`, `studyEntries[{page,x,y,text,comment}]`, `elements[{page,kind,text,left..bottom}]`, `strokes[{page,color,width,points[{x,y,pressure}]}]`. The caller should pass a snapshot (export/import JSON) like Java.

## Page text sources
1. Text layer: built from `PdfDoc.textRegions(i)` (consecutive regions sharing the same `lineBounds` object = one line, `wordBounds` = word boxes). Used when `usableTextLayer` (>=12 non-space chars, >=90% good chars); otherwise OCR.
2. OCR (`import { ocrHook } from './pdfdoc.js'`): page rendered with `doc.renderPage(i, min(2, 1600/max(w,h)))`, `await ocrHook.fn(canvas)` -> `[{text,x,y,w,h,line}]` pixels; words with the same `line` form a Line (without `line`, grouped by vertical overlap). Normal mode: only for pages without usable layer. Precise mode (`forceOcr=true`): every page, never touches the layer cache.
3. Ink OCR: for pages with pen strokes, strokes are drawn on a blank white canvas (uses `AnnotationPainter.strokes(ctx, RectF, store, page)` from `./painter.js` if it exists and works, otherwise an internal copy of the Java geometry) and OCR'd in both modes; cached by stroke hash.
If `ocrHook.fn` is null: OCR phases are skipped (nothing cached for those pages) and `listener.warning` is called.

## Cache
Memory LRU of 3 indexes keyed by `uri`; disk `<data>\search\<sha256(uri)>.json` (same JSON format as Java: `{sig,layer,ocr,ink:{page:{hash,lines}}}`, `LINE=[l,t,r,b,text,[[start,l,r],..]]`), `sig = "<size>-<mtime ms>"` from `host.stat(uri)` (missing file -> `x`, never persisted). Written once at the end of a scan when dirty (tmp file + move). Query-independent, so re-searching is instant.

## Known gaps / notes
- Text layer lines come from pdf.js via `textRegions`, which skips non-horizontal text and groups lines differently from PDFBox; the boxes are therefore slightly different from Android. Pages with only rotated text fall back to OCR.
- Ink hash differs numerically from Java (any stable hash is fine); Android caches are not shared.
- Cancel is checked between pages and between body/ink phases (an in-flight OCR call is not aborted).
- Test: `node dev/search-test.mjs` (Playwright; page `dev/search-test.html` polyfills `Map.getOrInsertComputed` for the old test Chromium so pdf.js `renderPage` works).
