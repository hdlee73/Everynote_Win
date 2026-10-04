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
`setHighlightMode(enabled, color)`, `setHighlightStyle(free, thickFraction)` (v1.30.0: straight band or freehand stroke; thickness = fraction of page height, clamped .006..0.08, default 0.022; the straight band is `max(6, h*thick)` high; copied by `copyToolsFrom`), `setMemoMode(b)`, `setOutlineMode(b)`, `setInkTool(mode, color, width)` (mode 0 none, 1 pen, 2 eraser, 3 straight line),
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
* Mouse: only the left button starts a gesture; wheel scrolls/pans when zoomed; `Ctrl+wheel` (also trackpad pinch) zooms 0.4..4 around the cursor (does NOT call `onZoomGestureStarted`); right click (`contextmenu`) on empty paper calls `onBlankLongPress` (desktop addition). Mouse acts as stylus, so text selection starts by dragging from a word.
* Two-finger pinch emulates Android's ScaleGestureDetector (min span 27 mm ≈ 102 px, span slop 16 px).
* Thresholds identical to Java (touch slop 14, swipe max(48, min(10% of size, 100)), edge band 72, long press 420/650 ms, tap 20, handles 22, pan damping 0.8, zoom 0.4..4). Haptics are no-ops.

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
* Freehand highlight (v1.30.0): with `setHighlightStyle(true, t)` a highlight drag collects points (>= 3 px apart, clamped to the page), draws a live translucent stroke and on release thins to <= 600 points and emits `onHighlightCreated(mark)` with `mark.path`, `mark.thick = t` and a bbox that includes half the thickness. A single point creates nothing.
* Eraser also deletes a highlight mark under the pointer (not note-only marks; for path marks it tests the distance to the stroke); strokes are drawn through `AnnotationPainter.stroke`.
* Text recognition radius is 3 px (10 px with `directTextSelection`) instead of 16.

## v3.0.0 additions (Everynote)
Tests: `node dev/pageview-test.mjs` (screenshots `dev/out/12-*` backdrop, `13..16` handles, `17/18` text formats).

### Zoom API (requirement 11)
| member | meaning |
|---|---|
| `getZoom()` | current zoom = `view.scale`; **1 = whole page fitted ("100%")**, min 0.4 ("40%"), max 4 (`PdfPageView.ZOOM_MIN/ZOOM_MAX`) |
| `setZoom(z, fx?, fy?)` | clamps to 0.4..4, keeps the view point (fx, fy) fixed (default: view centre), returns the new zoom |
| `zoomBy(f, fx?, fy?)` | `setZoom(zoom * f)` — use 1.25 / 0.8 for the +/- buttons |
| `resetZoom()` | zoom 1, pan 0 ("100%" button) |
| `listener.onZoomChanged(z)` | fires after **any** change: buttons, pinch, Ctrl+wheel / trackpad pinch, `focusOnPoint`, `showPage`/`clearPage` reset (checked synchronously by the API calls and once per repaint for direct `view.scale = …` writes). Not fired when the value does not change. `onZoomGestureStarted` is unchanged (finger pinch only) |

### Backdrop vs paper (requirement 4)
* The view is now the *backdrop* and the page is a sheet on it: `view.pagePadding` (default 12 px, public field) keeps a margin around the page at zoom 1, the sheet has a soft shadow and a 1 px hairline border.
  `pageRect()`/`contentRect()`/`toPage()` all include the padding, so callers using them need no change. Zoom 1 = "fit inside the padding".
* Colours come from CSS custom properties on `.pdf-page-view` (css/pageview.css): `--pv-backdrop` (#D9DADF), `--pv-paper-border`, `--pv-paper-shadow`; variants for `[data-dark-page="true"]` (#2B2C31) and `:root[data-theme="dark"]`.
  The root element's own CSS `background` is the backdrop and the canvas is transparent over it. `view.refreshTheme()` re-reads the variables (call it after switching `data-theme`); `setDarkPage()` does it automatically; `theme()` returns `{backdrop,border,shadow}`.
* `snapshot()` (curl textures, export of the view) now paints the backdrop colour around the sheet instead of the paper colour, so the curl matches what is on screen. Pass `view.snapshot(dark, scale)` as before.
* `applyBackground()` now only sets `data-dark-page` + refreshes the theme (the page itself is never filled with the detected paper colour any more).

### Element selection: handles, delete, rotation, stretch (Android v1.29.0)
* Selected image / sticker / video / youtube / shape / table / **text box** (`PdfPageView.selectable(e)`; `resizable(e)` = everything except audio/hyperlink) show: 4 corner handles (circles), the rotation knob (image/sticker/shape/table), and a red ✕ delete button at **(right + 14 dp, top - 28 dp)** (the top-right; below the bottom-right corner when there is no room above).
* **Edge-middle bar handles**: image / sticker / video / youtube *always* show four rounded bars (left/right 8x18, top/bottom 18x8). Dragging one moves only that side (other three sides fixed, min 0.04 x 0.03 of the page), sets `e.stretch = true` (cancel restores it) and so resizes width and height independently; the picture then fills the box (`AnnotationPainter` uses the whole box when `stretch`). Corner handles of these kinds keep the *current* box ratio. Shape/table/text boxes keep the Windows square edge handles (hidden on sides shorter than 44 px) and resize freely.
* Works with **mouse, pen and finger** (hit radius mouse 14 / pen 18 / touch 24 px; edge handles 75 %). With a writing tool active a mouse or pen only grabs handles, never the element body.
* A resize/move/rotate fires `onInkChanged()` on release (cancel restores). A tap on the **body of an already selected** element fires `onElementTapped(e)`.
* `listener.onElementDeleted(e)`: the ✕ button (also `view.deleteSelectedElement()`) **removes the element from `annotationStore.elements` itself**, clears the selection and then calls `onElementDeleted(e)`; if the listener has none, `onInkChanged()` is called.
* `listener.onElementSelected(e|null)` (optional): fires whenever the selection changes.

### Post-it selection (memos and translation notes)
First tap on an expanded memo (`Mark`) or `TranslationNote` selects it (`view.selSticky`; `view.selectedMemo` is an alias) instead of opening it: rotated dashed frame, 4 corner handles (resize `boxW/boxH` in dp, min 90 x 48, max 560/700; the opposite corner stays - the anchor `(right, top)` moves), a stem + blue ↻ knob 28 dp above the top centre (rotation `rot`, snaps within 4° to 0/90/180/270), a red × at (right + 14, top - 28) (deletes from `marks` / `translations`, fires `onInkChanged`), and a body drag moves the anchor. A second tap on the body calls `onMarkTapped` / `onTranslationTapped` (open the editor). Tapping elsewhere deselects; selecting an element clears the post-it selection. Hit tests run in the post-it's rotated frame; translation notes are checked before memos. Minimized post-its cannot be selected. `_drawSticky(..., rot)` draws the rotated body; `memoHitBoxes` / `noteHitBoxes` stay unrotated.

### Check markers
Lists are plain text (api-store.md). A tap (no movement) on the leading `☐`/`☑` of a line of a text box flips it (`e.toggleCheck(line)`), repaints, fires `listener.onCheckToggled(e, lineIndex, checked)` then `onInkChanged()`; it does not select the element.

### Mouse page turning (requirement 2)
* Wheel (no Ctrl) at zoom 1: `listener.onPageSwipe(+1)` (down/right) or `-1` (up/left) once per ≥ 40 px of wheel travel, debounced (450 ms lock + inertia swallowing, accumulator resets after 250 ms idle). Zoomed in: the wheel pans. `view.setWheelPageTurn(false)` disables it. Ignored while a pointer is down.
* Ctrl+wheel / trackpad pinch: `setZoom` around the cursor (+ `onZoomChanged`).
* Mouse drag in read mode: the mouse now counts as a swipe pointer, so a left-button drag on blank paper at zoom 1 behaves exactly like a finger drag: `PageDrag.start/move/end` (curl) when `setPageDrag` is set, otherwise `onPageSwipe(±1)` on release. `view.setMouseReadDrag(bool)` (default **true**; `isMouseReadDrag()`); requires `setPageSwipeEnabled(true)` like finger swipes. The mouse never turns pages when a writing tool is active (`inkMode !== 0`, highlight, lasso, memo, outline, direct text selection), so mouse writing is untouched; call `setMouseReadDrag(false)` as well in write mode if you also want to be explicit. A drag that starts on a word still selects text; zoomed in, a drag pans (no edge-swipe for the mouse). Pen never turns pages.

### Other
`PdfPageView.ZOOM_MIN/ZOOM_MAX`, `pagePadding`, `mouseReadDrag`, `wheelPageTurn` public fields; listener additions `onZoomChanged`, `onElementDeleted`, `onElementSelected`, `onCheckToggled` (all optional).

## Page curl (curl.js, Android v1.29.0)
`PageCurlView.setup()` resets the latch; `setTouch(fraction)` latches the grabbed corner (top / bottom) at the first call after `setup()`. Afterwards only the finger height changes the fold angle: `rise = max(0, cornerY - touch*h)` (limited to `2.6 * max(dx, .1*w)`), `dy = max(dy*.3, rise*(1 - .45*t))`.

## Anchored menu (ui/menu.js)
`AnchoredMenu.show(anchor, above, rows, shortcuts, onDismiss, avoid)`: `avoid` = `{left, top, right, bottom}` viewport rectangle the card must not cover. Placement order: below it, above it, right of it, left of it (sides are clamped vertically); when nothing fits the card docks at the screen edge covering the least of the rectangle. `AnchoredMenu.placeAvoiding(avoid, w, h, screenW, screenH)` is the pure function. The text-selection menu passes the selected text's rectangle and shows the insert items behind a `삽입` submenu row (`app.showMenuAt(view, x, y, rows, onDismiss, avoid)`).

## v3.3.0 (Android v1.30.1 / v1.31.0 port; crop fix)
* **Zoom out to 40%** (`ZOOM_MIN = 0.4`; Android `MIN_ZOOM`): `setZoom`, `zoomBy`, pinch and `Ctrl+wheel` go below 1. Below 1 the pan is locked to 0 (`clampPan`), so the page (the cropped printed area when "crop margins" is on) is drawn centred on the grey backdrop; `contentSize()` simply scales down. Page swiping / drag-reading stay active at `scale <= 1`. The app's zoom pill shows `40%`..`400%`, the "-" button steps by 1/1.25 down to 40%.
* **Crop margins keep one scale across pages**: `setCrop(box)` trims left/right/top as before, but the vertical crop is never shorter than `MIN_CROP_HEIGHT = 0.9` of the page (a short box is extended downwards first, then upwards). Before, a page whose text filled only its top ~40% got a short, wide crop box, became width-limited in `contentSize()` and was shown far larger than the other pages with its bottom margin cut off. Pages with normal content (crop >= 90% tall) behave exactly as in Android; `applyCrop` (two-page view: union of both bounds) is unchanged and both views get the same clamped box.
* Tests: `dev/crop-test.mjs` (generated 2-page PDF: page 1 full, page 2 text on the top 40% only; asserts page-2 `contentSize()` ~ page-1, crop >= 90%, bottom visible, zoom/pan limits, two-page view; screenshots `dev/out/crop-*.png`), zoom 40% checks in `dev/pageview-test.mjs` and `dev/main1-test.mjs`.
