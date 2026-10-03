# js/pageview.js — `PdfPageView` (port of PdfPageView.java)

```js
import { PdfPageView } from './pageview.js';          // also `export default`
const view = new PdfPageView(listener);                // listener: plain object, Java Listener method names
parent.appendChild(view.el);                           // root <div class="pdf-page-view"> (flex:1 1 0; position:relative; overflow:hidden; min-width:0; touch-action:none)
```
Dependencies: `util.js` (RectF, argb, clamp), `painter.js` (`AnnotationPainter.dark/adj/elements/addImageListener`), `store.js` (`Mark`, `InkStroke`, `InkPoint`).
CSS: `css/pageview.css` (optional, all layout is also inline). The view paints into one `<canvas>` (backing store x devicePixelRatio) with rAF-coalesced `invalidate()`; it needs the element to be attached to size itself (ResizeObserver).

## Size / misc
| member | meaning |
|---|---|
| `el` | root element; `canvas` = inner canvas |
| `width`, `height` (getters) and `getWidth()`, `getHeight()` | CSS px client size of `el` |
| `invalidate()` | schedule repaint (rAF); `flush()` paints synchronously |
| `snapshot(dark = darkPage, scale = devicePixelRatio)` | HTMLCanvasElement of the visible view (= `view.draw(canvas)`): white/black underlay, paper background, page + annotations + selection UI. Canvas is `width*scale` x `height*scale` px; `canvas.scale` holds the scale (use `scale=1` to get view-pixel sized bitmaps for the curl) |
| `pageRect()` | visible page rect in view px (`RectF`; empty when no page) — same as Java |
| `contentBounds()` | normalized `RectF` of non-blank content (copy); computed in `showPage` and cached per bitmap (WeakMap). Call `reanalyze()` if you draw into the same canvas afterwards |
| `paperColor()` | ARGB int (signed) of the detected paper colour (`0xFFDDDDDD` without a page) |
| `copyPageBitmap()` | new canvas copy of the page bitmap or `null` |
| `getPageNumber()`, `pageAspect()`, `toPage(vx,vy)` -> `[nx,ny]`, `pageFraction(y)` | as Java |
| `destroy()` / `onDetachedFromWindow()` | clears lasso + selection, disconnects observers |

## Page / state API (names as Java)
`showPage(canvas, pageNumber, marks, strokes, translations)` (the arrays are the store's live arrays; strokes are pushed/spliced in place), `clearPage()`,
`setAnnotationStore(store)`, `selectElement(el|null)`, `selectedElement()`, `setSearchHighlights(page, others[RectF], current|null)`, `clearSearchHighlights()`,
`setDarkPage(b)`, `isDarkPage()`, `setCrop(RectF|null)`, `focusOnPoint(x,y)`,
`setHighlightMode(enabled, color)`, `setMemoMode(b)`, `setOutlineMode(b)`, `setInkTool(mode, color, width)` (mode 0 none, 1 pen, 2 eraser, 3 straight line),
`setLassoMode(b)`, `isLassoMode()`, `setLassoShape(0|1|2)`, `getLassoShape()`, `clearLassoSelection()`, `captureLasso()` -> canvas|null, `lassoText()` -> string, `getLassoPoints()` (normalized copy),
`setDirectTextSelection(b)`, `setTextRegions(regions, showBounds)`, `stopTextSelection()`, `clearTextSelectionOverlay()`,
`setFingerInk(b)`, `setPageSwipeEnabled(b)`, `setVerticalPageSwipe(b)`, `setPageDrag(handler|null)`, `copyToolsFrom(otherView)`.
Constants: `PdfPageView.LASSO_FREE/LASSO_RECT/LASSO_CIRCLE` (0/1/2, also on instances). Statics: `PdfPageView.selectable(el)`.
Mutable public fields kept from Java for convenience: `scale`, `panX`, `panY`, `crop`, `darkPage`, `highlightMode`, `memoMode`, `outlineMode`, `inkMode`, `lassoMode`, `textRegions`, `selectedTextRegions`, `memoHitBoxes` (Map Mark->RectF), `noteHitBoxes` (Map TranslationNote->RectF).
Quirk kept: `showPage()` calls `stopTextSelection()` which resets `directTextSelection` to false (host must call `setDirectTextSelection(true)` again after a page change, as on Android).

## Listener (all optional-safe; called with `listener` as `this`)
`onHighlightCreated(mark)`, `onMarkTapped(mark)`, `onMemoPointRequested(page,x,y)`, `onZoomGestureStarted()`, `onPageSwipe(+1|-1)`, `onOutlinePointRequested(page,x,y)`,
`onInkChanged()`, `onTextSelectionFinished({text,bounds:RectF[],unionBounds:RectF,singleWord}, anchorX, anchorY)`, `onTranslationTapped(note)`, `onSelectionAdjustStarted()`,
`onLassoSelectionFinished()`, `onElementTapped(el)`, `onBlankLongPress(page,x,y,viewX,viewY)`.

## PageDrag (`setPageDrag`)
`{ start(direction):bool, move(distance>=0), end(velocityPxPerSec | -1e6 = cancel), touchAt(yFraction 0..1) }` exactly as in Java (drag only in horizontal mode, body swipe at scale<=1, finger only; if `start` returns false the plain swipe -> `onPageSwipe` on release is used).

## Input mapping
* Pointer Events on `el` with pointer capture. `pen` and `mouse` = STYLUS (never page-swipe, ink pressure from `e.pressure` clamped 0.05..1; finger/touch pressure constant 0.65). `touch` = finger.
* Pen eraser tip (`buttons&32` / `button===5`) and pen barrel button (`buttons&2`) = temporary eraser (works in any ink mode; only while an ink tool is active, as in Java).
* Mouse: only the left button starts a gesture; wheel scrolls/pans when zoomed; `Ctrl+wheel` (also trackpad pinch) zooms 1..4 around the cursor (does NOT call `onZoomGestureStarted`); right click (`contextmenu`) on empty paper calls `onBlankLongPress` (desktop addition). Mouse acts as stylus, so text selection starts by dragging from a word.
* Two-finger pinch emulates Android's ScaleGestureDetector (min span 27 mm ≈ 102 px, span slop 16 px).
* Thresholds identical to Java (touch slop 14, swipe max(48, min(10% of size, 100)), edge band 72, long press 420/650 ms, tap 20, handles 22, pan damping 0.8, zoom 1..4). Haptics are no-ops.

## Painter / store contract used
`AnnotationPainter.dark` set around marks/strokes/elements; `AnnotationPainter.adj(color)`; `AnnotationPainter.elements(ctx, destRectF, store, page)`; `AnnotationPainter.addImageListener(fn)` (view repaints when an element image finishes loading).
Everything else (highlight rects, per-segment pen strokes, stickies, selection/lasso/search overlays, element handles) is drawn by pageview.js itself, as in `onDraw`. Dark page uses a cached per-pixel copy of the bitmap (DARK_FILTER matrix).

## Known gaps / notes
* Page bitmap resolution is the host's job: the view only scales the canvas you pass (re-`showPage` with a higher-ratio render when zoomed if sharper output is wanted).
* Sticky/translation fonts use the sans stack `Roboto, Noto Sans KR, Malgun Gothic, Segoe UI` — line breaks differ slightly from Android.
* Tap hit order for stickies is topmost-first (Java's IdentityHashMap order is arbitrary).
* `dev/pageview-test.mjs` (Playwright) covers pen/pressure, straight line, eraser (tip, barrel, mode), highlight, memo, outline, text selection (direct, handles, long press), blank long press, free/rect/ellipse lasso, lassoText/captureLasso, pinch, pan, wheel zoom, swipes (horizontal/vertical/edge), PageDrag, crop, element select/move/resize, dark snapshot. The test serves a temporary `dev/stubs/store.js` only if `web/js/store.js` does not exist.

## v1.27.0 additions (Android 1.27.0 port)
* **Pen type**: `view.setInkPen(pen)` (0 ballpoint, 1 pencil, 2 fountain, 3 brush, 4 felt marker; clamped), copied by `copyToolsFrom`. New strokes get `stroke.pen`. `AnnotationPainter.PEN_NAMES = ['볼펜','연필','만년필','붓','사인펜']`. Call `setInkPen` after `setInkTool`; colour alpha (`inkColor >>> 24`) is the stroke opacity.
* **Element rotation**: `AnnotationPainter.rotates(e)` (image/sticker/shape/table). Selected elements of those kinds show a stem + round `↻` knob 28 px above the top edge (hit radius 24); dragging turns `e.rot` (degrees clockwise, 15° snap within 4°), `onInkChanged` fires on release (cancel restores). Taps, corner handles and resize hit-test in the element's rotated frame. Extra: `view.elementContains(el, x, y)` and static `PdfPageView.unrotate(x, y, cx, cy, rot)`; `AnnotationPainter.rotateAround(ctx, deg, px, py)`.
* **Memo resize**: first tap on an expanded memo selects it (`view.selectedMemo`, dashed frame + `↘` handle) and does NOT call `onMarkTapped`; tap again opens it (`onMarkTapped`). Dragging the handle sets `mark.boxW/boxH` (dp, min 90x48) and fires `onInkChanged`. Tapping elsewhere deselects. The UI must reset `boxW = boxH = 0` when the user picks a box size in the edit dialog (Java: `if (style[2] != origBox) mark.boxW = mark.boxH = 0`).
* Eraser also deletes a highlight mark under the pointer (not note-only marks); strokes are drawn through `AnnotationPainter.stroke`.
* Text recognition radius is 3 px (10 px with `directTextSelection`) instead of 16.
