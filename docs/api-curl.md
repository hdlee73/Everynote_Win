# api-curl — web/js/curl.js (port of PageCurlView.java + page-turn helpers)

```js
import { PageCurlView, snapshotSlice, curlDuration, animateCurl, commitDecision, mirror, paperBack } from './curl.js';
```

## PageCurlView
* `new PageCurlView()` — owns a `<canvas>` in `.el` (CSS: `display:block; width:100%; height:100%`). Put it in a positioned container
  sized to the page region (the container's size defines the view size). A ResizeObserver keeps the backing store in sync (dpr aware);
  `width`/`height` (CSS px, Java getWidth/getHeight) are set by `resize()`. Call `curl.resize()` right after attaching if you need
  `curl.width` immediately (the beginCurl rule `dragSpan = max(120, curl.width*(two?.5:1)*1.1)`); `resize2()` does the same without scheduling a redraw.
* `setup(fixedHalf, under, front, back, mirrored, spineFraction)` — bitmaps are canvases / OffscreenCanvas / ImageBitmap. They are stretched to
  the leaf area (`w - spine*w` x `h` CSS px; `fixedHalf` to `spine*w` x `h`), so snapshots may have dpr-multiplied pixel sizes.
  Argument recipes are in spec/pageview.md §11 / main1.md §13.
* `setProgress(v)` (clamped 0..1), `progress()`, `setTouch(f)` (clamped, default .88; >.5 grabs the bottom-right corner), `touch` getter.
* `invalidate()` -> redraw on next rAF; `draw()` synchronous redraw; `release()` closes ImageBitmaps, drops refs, stops observing and removes `el`.
* `PageCurlView.mirror(canvas)` / `PageCurlView.paperBack(canvas)` -> new canvas (same size); `PageCurlView.backTint` (static, ARGB int, default `0x00FFFFFF`;
  set `0xFF000000`-style value for dark pages; paperBack lays it SRC_OVER). `mirror`/`paperBack` are also exported by name.
* Maths/shading are verbatim from the Java (fold bisector, reflect matrix, front/shadow/back/crease bands, 1px 0x22 outline, t<=.004 / >=.995 shortcuts).

## Helpers (pure)
* `snapshotSlice(canvas, x, y, w, h)` -> new canvas w x h with that rectangle (source pixel coordinates, rounded; multiply by dpr yourself if the source is hi-dpi).
* `curlDuration(from, to)` -> `max(200, round(1000*|to-from|))` ms.
* `animateCurl(curl, from, to, onDone)` -> `{cancel()}`; rAF loop calling `curl.setProgress`; ease-in-out (Android AccelerateDecelerate) when `from===0`, otherwise
  decelerate (1-(1-x)^2). `onDone()` fires after the last frame (progress set exactly to `to`); not called after `cancel()`.
  The caller does the Java onEnd work (restore page if `to<.5`, `release()`, reset flags).
* `commitDecision(velocity, progress)` -> `velocity>700 || (velocity>-700 && progress>.4)`.

## Test
`node dev/curl-test.mjs` (own tiny server on :8131, serves repo root) renders `dev/curl-test.html` -> `dev/out/curl-single.png`, `curl-spine.png`
(progress .1/.3/.5/.7/.9; forward/backward; touch .9/.2; single and spine variants). Visually checked: corner lift, mirrored back, soft shadow, crease shading, mirrored turns.

## Known gaps / notes
* Anti-aliased clip edges come from Canvas2D (no separate ANTI_ALIAS flag); no behavioural differences observed.
* Pixel units: bitmaps are stretched, not drawn 1:1 as in Java, so a dpr-scaled snapshot of the same CSS region works unchanged.
