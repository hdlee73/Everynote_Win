# API: store.js / painter.js / shapes.js  (port of AnnotationStore, AnnotationPainter, Shapes)

Tests: `node dev/store-test.mjs` (33 unit tests, ports of the Java tests, node only) and `node dev/painter-test.mjs`
(Playwright, writes `dev/out/painter-all-{light,dark}.png`).

## store.js
```js
import { AnnotationStore, Mark, OutlineItem, InkPoint, InkStroke, TranslationNote, StudyEntry, PageElement, JSONException, stringify } from './store.js';
```
Nested classes are also reachable as `AnnotationStore.Mark` etc. Field names/types are the Java ones (`page, left, top, right, bottom, color, note, noteOnly,
visible, minimized, paper, fontSp, boxSize`; `InkStroke.points[]` of `InkPoint{x,y,pressure}`; `PageElement.{kind,text,asset,textSize,color,font,bold,italic}`;
`PageElement.DEFAULT_TEXT_SIZE/DEFAULT_TEXT_COLOR/FONTS`). Colours are signed int32 (`0xFFFFF3A6|0`). `bookmarks` is a `Set<number>`.
`new Mark()` etc. have the Java defaults (`note` null, `paper -3162`, `fontSp 13`, `boxSize 1`, PageElement box .1/.1/.8/.3 ...).

### AnnotationStore instance (Java names)
| member | notes |
|---|---|
| `new AnnotationStore()` | empty, unbound (`key == null`; `save()` is a no-op until `open`/`rebind`) |
| `marks[] elements[] strokes[] translations[] outlines[] studyEntries[]`, `bookmarks:Set` | mutate directly, then `store.save()` |
| `await store.open(key)` | key = absolute PDF path. Clears, loads sidecar (missing/corrupt -> empty). Writes any pending save of the previous document first. Returns `this` |
| `store.rebind(newKey)` | document moved/renamed: switch key + save (returns promise) |
| `store.save()` | **debounced** (300 ms, `AnnotationStore.SAVE_DELAY`), non-blocking; coalesces calls; resolves `true` when on disk (`false` on failure/no key); never rejects. Snapshot is taken at write time |
| `await store.flush()` | write pending save now and wait |
| `await AnnotationStore.flushAll()` | all stores + all queued writes. **Host/app must call this before closing** (the module also hooks `pagehide`/`visibilitychange` best effort) |
| `store.toJson()` | sidecar text (compact, no format/document/uri), Android key order |
| `store.exportJson(uri, title)` | Android `exportJson`: `toString(2)`, `format:"PDF Note annotations v2"`, `document`, `uri` (pass the key/path or any string) then the arrays |
| `store.importJson(text, pageCount)` | Android `importJson`: needs format v1/v2 and the 5 required arrays, validates every item and page range (`JSONException`, store untouched on error), then replaces everything and **returns `save()` promise**. Throws synchronously |
| `store.loadJson(text, {strict})` / `AnnotationStore.fromJson(text, {strict})` | parse sidecar *or* export text with no format check (Java `open` semantics). `fromJson` returns a new unbound store. Default skips bad items individually (spec's recommended fix of the Java quirk where one bad element empties everything after it); `{strict:true}` throws on the first bad item |
| `store.removePage(i)`, `store.insertPageAfter(i)` | as Java, do not save |
| `store.referencedAssets()` | Set of asset file names used by elements |

### Statics (library / search / rename-move-delete)
* `await AnnotationStore.load(key)` -> new store opened on another document (for search / library features; read-only use).
* `await AnnotationStore.modified(key)` -> sidecar mtime ms, 0 if none (Java `AnnotationStore.modified`; waits for pending writes).
* `await AnnotationStore.moveSidecar(oldKey, newKey)` -> true if a sidecar moved (flushes pending save first; overwrites target). `await AnnotationStore.deleteSidecar(key)`.
* `await AnnotationStore.cloneAnnotations(srcKey, dstKey, count=Infinity)` = Java `LibraryRepository.cloneAnnotations` (pages >= count -> `JSONException`).
* `await AnnotationStore.sidecarPath(key)`.
* Library rename/move: `await AnnotationStore.moveSidecar(old,new)` (and if a store is open on it: `store.rebind(new)`).

### Persistence layout
* Sidecar: `<host.info().data>\annotations\<sha1 hex of lowercase(key)>.json`; key is normalised (`/`->`\`, trailing `\` dropped) before hashing.
  Written as `<file>.tmp` + `host.move` (atomic replace), falling back to a direct `writeText` if the host cannot overwrite on move.
  Format = Android sidecar (compact, no `format`) so an Android sidecar/backup can be dropped in and vice versa. (Android hashes the content URI with SHA-256
  under `doc_<sha256>.json`; the Windows key scheme is the spec's sha1-of-path - export/import files are the interchange format.)
* **Assets** (images, video/YouTube thumbnails, recordings, video files): flat folder `<data>\assets\<name>`. Decision: Android keeps them in one shared folder
  (`images/`, `videos/`, `recordings/` hold uuid names, cloned notebooks share the same files), so one shared folder keeps `cloneAnnotations`/import trivial; a
  per-document folder was rejected. Names must satisfy Android's validation: `<lowercase dashed uuid>.png|m4a` (asset) or `.mp4` (video, in `text`).
  * `AnnotationStore.newAssetName('png'|'m4a'|'mp4')`, `validAssetName(n)`, `await assetPath(n)`, `await saveAsset(name, Uint8Array|ArrayBuffer|Blob)`,
    `await readAsset(n)`, `await hasAsset(n)`, `await deleteAsset(n)`, `await assetUrl(n)` (host `fs.url`, usable for `<img>/<video>/<audio>`; range requests). Instance forwarders `store.assetUrl/saveAsset`.
  * Like Android, **the annotation export JSON contains only the file names, no binary data** (Android `exportJson` does not embed assets; nothing is base64-embedded).
    If the app wants a full backup it must copy `store.referencedAssets()` itself.
  * recordings: save the recorded blob under `newAssetName('m4a')` (even if the container is webm - the name regex only allows png|m4a).

### JSON fidelity (what is identical to org.json on Android)
Key names and order, defaults on read (`optInt/optDouble/optString/optBoolean` incl. string/number coercions, missing double geometry = NaN), clamps
(`fontSp 9..28`, `boxSize 0..2`, `textSize` outside [.004,.3] -> .027, unknown font -> sans), all PageElement / StudyEntry validation (`잘못된 노트 요소`,
`잘못된 페이지 링크`, `PDF Note 주석 백업이 아닙니다`, `문서 페이지 범위를 벗어난 주석`), floats are `Math.fround`-ed before writing so they print like
Android (`0.1f` -> `0.10000000149011612`), integral numbers print as ints, Java `Double.toString` style exponents (`5.0E-4`), strings escaped like
org.json (`/` -> `\/`, ` `, control chars `\u00XX`, non-ASCII raw), `null` members omitted, NaN/Infinity throw `JSONException` (save logs & skips),
bookmarks written ascending, `toString(2)` indentation (empty array `[]`). Verified byte for byte in `dev/store-test.mjs`.
Differences: `open()` skips bad items individually (see above); the legacy SharedPreferences fallback does not exist; JSON parse error messages differ.

## painter.js
```js
import { AnnotationPainter, Typeface } from './painter.js';
```
Canvas2D, all coordinates in CSS px; `d` is a `RectF` (or any `{left,top,right,bottom}`) = the page rectangle in px; `c` = `CanvasRenderingContext2D` (also OffscreenCanvas ctx).
Every method saves/restores the context state it touches.
* `AnnotationPainter.all(c, d, store, page)` - export/thumbnail version (flat note boxes, `strokes`, translations, `elements`). Java's leading `Context` arg is dropped but a leading
  `null`/non-canvas argument is tolerated, so `all(ctx,c,d,store,page)` also works.
* `AnnotationPainter.elements(c, d, store, page)`, `AnnotationPainter.strokes(c, d, store, page)` (export-version pen strokes, no pressure clamp).
* `AnnotationPainter.text(c, text, box, size, color, face = Typeface.DEFAULT)` - character wrapping via measureText, clip, pitch `size*1.35`. `color` = ARGB int.
* `AnnotationPainter.fitHeight(text, widthFraction, sizeFraction, pageAspect, face)` - same wrap rules (measure context is an OffscreenCanvas; in node a rough width estimate).
* `AnnotationPainter.typeface(font, bold, italic)` -> `Typeface {family, style(BOLD=1|ITALIC=2), css(sizePx), getStyle()}`; `Typeface.DEFAULT/BOLD/ITALIC`.
  sans `"Segoe UI","Malgun Gothic","Noto Sans KR",sans-serif`; serif `"Noto Serif KR","Noto Serif","Batang","Times New Roman",serif`;
  mono `"D2Coding","Consolas","Malgun Gothic","Noto Sans Mono",monospace`; hand `"Ink Free","Segoe Script","Nanum Pen Script","Malgun Gothic",cursive`; stickers use `"Segoe UI Emoji","Noto Color Emoji"`.
* `AnnotationPainter.box(dest, element)` -> RectF px; `lastOfGroup(store, e)`; `adj(argbInt)`; statics `AnnotationPainter.skip` (element being edited, not drawn) and `AnnotationPainter.dark` (dark paper ink lift).
* `AnnotationPainter.ellipsize(c, s, avail)` (TextUtils.ellipsize END; font must be set on c).
* **Images (async!)**: draw calls are synchronous. `AnnotationPainter.image(name)` returns a cached `ImageBitmap` or `null` and starts loading; when a bitmap arrives it calls
  `AnnotationPainter.onImageLoaded(name)` and every listener of `AnnotationPainter.addImageListener(fn)` (returns an unsubscribe fn) -> **PdfPageView must redraw on that event**.
  For export/thumbnail rendering `await AnnotationPainter.preload(store, page?)` first. `loadImage(name)` (promise), `forgetImage(name)`. LRU cache 96 MB. Missing/undecodable image: nothing drawn
  (video/youtube: dark rounded rect), like Java.

Sticky notes with rounded corners (`drawSticky`) and the live pen strokes with the pressure clamp are in PdfPageView, not here (as in Java).

## shapes.js
`import { Shapes, Table } from './shapes.js'` - `Shapes.KINDS, NAMES, SHAPE_PATTERN, TABLE_HEADER, hex(color), shapeSpec(kind,stroke,fill,width), validShape(text), validTable(text),
parseColor(hex), drawShape(c,b,spec,pageWidth), drawTable(c,b,text,pageWidth)`; `Shapes.Table` / `Table`: `parse(text)`, `create(rows,cols,line,head,fill)`, `.resized(r,c)`, `.serialize()`, fields `rows cols line head fill cells[]`.

## Known gaps / notes for other authors
* `store.save()` is asynchronous; `importJson` throws synchronously but returns a promise on success. Await `store.flush()` where Java relied on a synchronous save (e.g. before cloning or exporting a file on disk).
* Video file / audio playback is not part of this module: use `await AnnotationStore.assetUrl(name)`; for `kind:'video'` the mp4 name is `element.text`, the thumbnail `element.asset`.
* Hand font and serif quality depend on installed Windows fonts; the stacks degrade to generic families.
* Android never trims whitespace of the hyperlink regex target with Unicode spaces; the JS port uses Java's ASCII `\S` semantics.

## v1.27.0 additions
* `PageElement.rot` (float degrees clockwise, JSON `rot`, first key), `InkStroke.pen` (0..4, JSON `pen` after `width`, clamped on read), `Mark.boxW/boxH` (dp, 0 = use `boxSize`; JSON after `boxSize`; clamped 0..800 / 0..1200). Old data reads with 0 defaults; Android 1.27 sidecars round-trip byte for byte.
* painter.js: `AnnotationPainter.stroke(c, d, stroke)` (one stroke in its pen style; translucent colours are drawn opaque on a layer and composited once, so self-overlaps do not darken), `strokes()` uses it, `rotates(e)`, `rotateAround(c, deg, px, py)`, `PEN_NAMES`. `elements()` rotates image/sticker/shape/table around the box centre. Pen look: 1 pencil (.78 alpha, thinner), 2 fountain (width follows direction, 45° nib), 3 brush (taper at both ends, .92 alpha), 4 marker (square caps, constant 1.5x width, .82 alpha).
* shapes.js is unchanged (rotation is applied by the painter).
* `ui/colorpicker.js`: `ColorPicker.PALETTE` (32 ARGB ints, 4 rows of 8), `ColorPicker.show(context, title, initialArgb, alpha, onPick)` (context ignored; returns the AlertDialog; `onPick(argbInt)`, opacity 255 when `alpha` is false), plus `ColorPicker.colorToHSV/HSVToColor`. Styles in `css/colorpicker.css` (linked in index.html).
