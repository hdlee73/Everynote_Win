// PdfPageView: port of PdfPageView.java (Android) -> DOM element + canvas + Pointer Events.
// Public method names follow the Java class 1:1. See docs/api-pageview.md.
//
// Mapping notes:
//  * 1 dp == 1 CSS px (DP = 1); the canvas backing store uses devicePixelRatio.
//  * MotionEvent -> an internal event object built from Pointer Events (see _dispatch). pointerType 'pen' and 'mouse'
//    count as STYLUS (isStylus), 'touch' is a finger. Pen eraser tip (buttons&32 / button 5) and pen barrel button
//    (buttons&2) are the "temporary eraser".
//  * requestDisallowInterceptTouchEvent is a no-op (nothing above us scrolls).
import { RectF, clamp, argb } from './util.js';
import { AnnotationPainter } from './painter.js';
import { Mark, InkStroke, InkPoint } from './store.js';

const DP = 1;
const FONT_SANS = 'Roboto, "Noto Sans KR", "Malgun Gothic", "Segoe UI", sans-serif';
const DEFAULT_PAPER = 0xFFDDDDDD | 0;

// Action codes (MotionEvent.ACTION_*)
const DOWN = 0, UP = 1, MOVE = 2, CANCEL = 3, POINTER_DOWN = 5, POINTER_UP = 6;

const LASSO_FREE = 0, LASSO_RECT = 1, LASSO_CIRCLE = 2;

// ---------------------------------------------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------------------------------------------
/** Java String.split(sep) with a literal separator: trailing empty strings dropped, no match -> [str]. */
function javaSplit(str, sep) {
  if (str.indexOf(sep) < 0) return [str];
  const parts = str.split(sep);
  while (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

function roundRectPath(ctx, l, t, r, b, rx, ry) {
  ctx.beginPath();
  const w = r - l, h = b - t;
  const rad = Math.max(0, Math.min(rx, w / 2, h / 2));
  if (ctx.roundRect) ctx.roundRect(l, t, w, h, rad);
  else {
    ctx.moveTo(l + rad, t); ctx.arcTo(r, t, r, b, rad); ctx.arcTo(r, b, l, b, rad); ctx.arcTo(l, b, l, t, rad); ctx.arcTo(l, t, r, t, rad); ctx.closePath();
  }
}
function fillRoundRect(ctx, l, t, r, b, rx, color) { roundRectPath(ctx, l, t, r, b, rx, rx); ctx.fillStyle = argb(color); ctx.fill(); }
function fillCircle(ctx, x, y, rad, color) { ctx.beginPath(); ctx.arc(x, y, Math.max(0, rad), 0, Math.PI * 2); ctx.fillStyle = argb(color); ctx.fill(); }

function boxOf(dest, e) {
  return new RectF(dest.left + e.left * dest.width(), dest.top + e.top * dest.height(), dest.left + e.right * dest.width(), dest.top + e.bottom * dest.height());
}

/** Dark page filter (Android DARK_FILTER = invert, then hue rotation): see spec 3.10. */
function darkFilterCanvas(src) {
  const w = src.width, h = src.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(src, 0, 0);
  const img = x.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    d[i] = 255 + 0.574 * r - 1.430 * g - 0.144 * b;
    d[i + 1] = 255 - 0.426 * r - 0.430 * g - 0.144 * b;
    d[i + 2] = 255 - 0.426 * r - 1.430 * g + 0.856 * b;
  }
  x.putImageData(img, 0, 0);
  return c;
}

function bitmapSize(bmp) { return [bmp.width || bmp.naturalWidth || 0, bmp.height || bmp.naturalHeight || 0]; }

/** Paper colour + content box of a page bitmap (Java analyze()). Returns {paper (ARGB int), bounds (RectF)}. */
function analyzeBitmap(bmp) {
  const bounds = new RectF(0, 0, 1, 1); let paper = 0xFFFFFFFF | 0;
  try {
    const [bw, bh] = bitmapSize(bmp);
    const w = Math.min(200, bw), h = Math.min(Math.max(1, Math.floor(bh * (w / bw) + 0.5)), bh);
    const tmp = document.createElement('canvas'); tmp.width = bw; tmp.height = bh;
    const tc = tmp.getContext('2d', { willReadFrequently: true });
    tc.drawImage(bmp, 0, 0);
    const data = tc.getImageData(0, 0, bw, bh).data;
    const R = new Uint8Array(w * h), G = new Uint8Array(w * h), B = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const sy = Math.min(bh - 1, Math.floor(y * bh / h));
      for (let x = 0; x < w; x++) {
        const sx = Math.min(bw - 1, Math.floor(x * bw / w)); const o = (sy * bw + sx) * 4, i = y * w + x;
        R[i] = data[o]; G[i] = data[o + 1]; B[i] = data[o + 2];
      }
    }
    const votes = new Map(); let best = -1, bestVotes = 0;
    for (let i = 0; i < w * h; i++) {
      const x = i % w, y = Math.floor(i / w);
      if (x > 2 && x < w - 3 && y > 2 && y < h - 3) continue;
      const key = ((R[i] & 0xF0) << 16) | ((G[i] & 0xF0) << 8) | (B[i] & 0xF0);
      const n = (votes.get(key) || 0) + 1; votes.set(key, n);
      if (n > bestVotes) { bestVotes = n; best = i; }
    }
    const pr = best >= 0 ? R[best] : 255, pg = best >= 0 ? G[best] : 255, pb = best >= 0 ? B[best] : 255;
    paper = ((0xFF << 24) | (pr << 16) | (pg << 8) | pb) | 0;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; const diff = Math.abs(R[i] - pr) + Math.abs(G[i] - pg) + Math.abs(B[i] - pb);
      if (diff > 60) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (maxX >= minX && maxY >= minY) {
      const pad = 0.03;
      bounds.set(new RectF(Math.max(0, minX / w - pad), Math.max(0, minY / h - pad), Math.min(1, (maxX + 1) / w + pad), Math.min(1, (maxY + 1) / h + pad)));
      if (bounds.width() * bounds.height() < 0.1) bounds.set(new RectF(0, 0, 1, 1));
    }
  } catch (err) { bounds.set(new RectF(0, 0, 1, 1)); }
  return { paper, bounds };
}
const analysisCache = new WeakMap();

/** Minimal android.view.VelocityTracker (linear least squares over the last 100 ms). */
class VelocityTracker {
  constructor() { this.s = []; this.vx = 0; }
  addMovement(e) { this.s.push({ t: e.time, x: e.x }); const cut = e.time - 200; while (this.s.length > 2 && this.s[0].t < cut) this.s.shift(); }
  computeCurrentVelocity(units) {
    const last = this.s[this.s.length - 1]; if (!last) { this.vx = 0; return; }
    const pts = this.s.filter(p => last.t - p.t <= 100);
    if (pts.length < 2) { this.vx = 0; return; }
    const n = pts.length; let st = 0, sx = 0; for (const p of pts) { st += p.t; sx += p.x; }
    const mt = st / n, mx = sx / n; let num = 0, den = 0;
    for (const p of pts) { num += (p.t - mt) * (p.x - mx); den += (p.t - mt) * (p.t - mt); }
    this.vx = den > 0 ? num / den * (units / 1) : 0; // px per ms * 1000
  }
  getXVelocity() { return this.vx; }
  recycle() { this.s = []; }
}

/** Plain-object ScaleGestureDetector emulation (spans, slop, begin/end semantics of Android). */
class ScaleDetector {
  constructor(l) {
    this.l = l; this.inProgress = false; this.focusX = 0; this.focusY = 0; this.currSpan = 0; this.prevSpan = 0; this.initialSpan = 0;
    this.scaleFactor = 1; this.minSpan = 27 / 25.4 * 96; this.spanSlop = 16;
  }
  isInProgress() { return this.inProgress; }
  getScaleFactor() { return this.scaleFactor; }
  onTouchEvent(e) {
    const action = e.action;
    const streamComplete = action === UP || action === CANCEL;
    if (action === DOWN || streamComplete) {
      if (this.inProgress) { this.l.onScaleEnd(this); this.inProgress = false; this.initialSpan = 0; }
      else this.initialSpan = 0;
      if (streamComplete) return true;
    }
    const configChanged = action === DOWN || action === POINTER_UP || action === POINTER_DOWN;
    const pointerUp = action === POINTER_UP; const skip = pointerUp ? e.actionIndex : -1;
    let sx = 0, sy = 0, count = 0;
    for (let i = 0; i < e.pointerCount; i++) { if (i === skip) continue; sx += e.getX(i); sy += e.getY(i); count++; }
    const fx = count ? sx / count : 0, fy = count ? sy / count : 0;
    let dx = 0, dy = 0;
    for (let i = 0; i < e.pointerCount; i++) { if (i === skip) continue; dx += Math.abs(e.getX(i) - fx); dy += Math.abs(e.getY(i) - fy); }
    dx = count ? dx / count : 0; dy = count ? dy / count : 0;
    const span = Math.hypot(dx * 2, dy * 2);
    this.focusX = fx; this.focusY = fy;
    const wasInProgress = this.inProgress;
    if (this.inProgress && (span < this.minSpan || configChanged)) { this.l.onScaleEnd(this); this.inProgress = false; this.initialSpan = span; }
    if (configChanged) { this.prevSpan = this.currSpan = this.initialSpan = span; }
    if (!this.inProgress && span >= this.minSpan && count >= 2 && (wasInProgress || Math.abs(span - this.initialSpan) > this.spanSlop)) {
      this.prevSpan = this.currSpan = span;
      this.inProgress = this.l.onScaleBegin(this);
    }
    if (action === MOVE && count >= 2) {
      this.currSpan = span;
      if (this.inProgress) {
        this.scaleFactor = this.prevSpan > 0 ? this.currSpan / this.prevSpan : 1;
        if (this.l.onScale(this)) this.prevSpan = this.currSpan;
      }
    }
    return true;
  }
}

// ---------------------------------------------------------------------------------------------------------------
export class PdfPageView {
  /** @param {object} listener plain object with the Java Listener method names */
  constructor(listener) {
    this.listener = listener || {};
    const el = this.el = document.createElement('div');
    el.className = 'pdf-page-view';
    el.style.cssText = 'flex:1 1 0;position:relative;overflow:hidden;min-width:0;touch-action:none;user-select:none;-webkit-user-select:none;outline:none;';
    el.style.background = argb(DEFAULT_PAPER);
    const cv = this.canvas = document.createElement('canvas');
    cv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;pointer-events:none;';
    el.appendChild(cv);
    this._ctx = cv.getContext('2d');

    // ---- state (Java fields)
    this.bitmap = null; this._darkBitmap = null;
    this.annotationStore = null;
    this.edgeSwipe = false; this.bodySwipeCandidate = false; this.directTextSelection = false; this.edgeStartTime = 0;
    this.marks = null; this.strokes = null; this.translations = null;
    this.textRegions = []; this.selectedTextRegions = [];
    this.noteHitBoxes = new Map(); this.memoHitBoxes = new Map();
    this.lassoMode = false; this.lassoDrawing = false; this.suppressSelection = false;
    this.lassoPoints = []; this.lassoShape = LASSO_FREE; this.lassoAnchor = null;
    this.searchPage = -1; this.searchBoxes = []; this.searchCurrent = null;
    this.textSelectMode = false; this.showTextBounds = false;
    this.page = 0;
    this.highlightMode = false; this.memoMode = false; this.highlightColor = 0x66FFEB3B | 0;
    this.startX = 0; this.startY = 0; this.currentX = 0; this.currentY = 0; this.lastX = 0; this.lastY = 0;
    this.panX = 0; this.panY = 0;
    this.drawing = false; this.panning = false; this.gestureMoved = false; this.scalingOccurred = false;
    this.verticalPageSwipe = false; this.outlineMode = false;
    this.inkMode = 0; this.inkColor = 0xFF1C1C1E | 0; this.inkWidth = 0.004;
    this.activeStroke = null; this.stylusDrawing = false;
    this.fingerInk = false; this.pageSwipeEnabled = false;
    this.scale = 1;
    this.crop = new RectF(0, 0, 1, 1); this.bounds = new RectF(0, 0, 1, 1);
    this._paper = DEFAULT_PAPER;
    this.pageDrag = null; this.dragging = false; this.dragDirection = 0; this.dragTracker = null;
    this._selectedElement = null; this.elementDrag = 0; this.elementMoved = false; this.elementStartX = 0; this.elementStartY = 0; this.elementOrigin = new RectF();
    this.selectionStartRegion = null; this.selectionEndRegion = null; this.selectionCandidate = false; this.selectingText = false;
    this.darkPage = false;
    this._beginTimer = 0; this._blankTimer = 0;
    this._ptrs = []; this._dirty = false; this._raf = 0;
    this._cw = 0; this._ch = 0;

    this.scaleDetector = new ScaleDetector({
      onScaleBegin: () => {
        this.clearLassoSelection();
        this._cancelBeginTextSelection();
        this.selectingText = this.selectionCandidate = false;
        this.selectedTextRegions.length = 0;
        this._L('onSelectionAdjustStarted');
        this.finishInkStroke();
        this.drawing = false;
        this.panning = false;
        this.scalingOccurred = true;
        this._L('onZoomGestureStarted');
        return true;
      },
      onScale: (d) => {
        const before = this.contentRect();
        const fx = d.focusX, fy = d.focusY;
        const nx = before.width() === 0 ? 0.5 : (fx - before.left) / before.width();
        const ny = before.height() === 0 ? 0.5 : (fy - before.top) / before.height();
        this.scale = Math.max(1, Math.min(4, this.scale * d.getScaleFactor()));
        const size = this.contentSize();
        this.panX = fx - nx * size[0] - this.baseLeft(size);
        this.panY = fy - ny * size[1] - this.baseTop(size);
        this.clampPan();
        this.invalidate();
        return true;
      },
      onScaleEnd: () => { this.clampPan(); },
    });

    // ---- DOM events
    const opt = { passive: false };
    el.addEventListener('pointerdown', e => this._onPointerDown(e), opt);
    el.addEventListener('pointermove', e => this._onPointerMove(e), opt);
    el.addEventListener('pointerup', e => this._onPointerUp(e), opt);
    el.addEventListener('pointercancel', e => this._onPointerCancel(e), opt);
    el.addEventListener('wheel', e => this._onWheel(e), opt);
    el.addEventListener('contextmenu', e => this._onContextMenu(e));
    el.addEventListener('dragstart', e => e.preventDefault());
    if (typeof ResizeObserver !== 'undefined') { this._ro = new ResizeObserver(() => this._resize()); this._ro.observe(el); }
    this._unsubImages = (AnnotationPainter.addImageListener ? AnnotationPainter.addImageListener(() => this.invalidate()) : null);
  }

  static get LASSO_FREE() { return LASSO_FREE; }
  static get LASSO_RECT() { return LASSO_RECT; }
  static get LASSO_CIRCLE() { return LASSO_CIRCLE; }
  get LASSO_FREE() { return LASSO_FREE; }
  get LASSO_RECT() { return LASSO_RECT; }
  get LASSO_CIRCLE() { return LASSO_CIRCLE; }

  // ---- size / canvas -----------------------------------------------------------------------------------------
  get width() { return this.el.clientWidth; }
  get height() { return this.el.clientHeight; }
  getWidth() { return this.el.clientWidth; }
  getHeight() { return this.el.clientHeight; }

  _resize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    this._cw = w; this._ch = h;
    this.clampPan();
    this.invalidate();
  }
  _syncCanvas() {
    const dpr = window.devicePixelRatio || 1, w = this.el.clientWidth, h = this.el.clientHeight;
    const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) { this.canvas.width = pw; this.canvas.height = ph; }
    return dpr;
  }
  _L(name, ...args) { const f = this.listener && this.listener[name]; if (typeof f === 'function') return f.apply(this.listener, args); }

  /** Schedules a repaint (coalesced through requestAnimationFrame). */
  invalidate() {
    if (this._dirty) return;
    this._dirty = true;
    this._raf = requestAnimationFrame(() => { this._raf = 0; if (this._dirty) this.flush(); });
  }
  /** Paints now (synchronously). */
  flush() {
    this._dirty = false;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    const dpr = this._syncCanvas(), ctx = this._ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._paintAll(ctx, this.el.clientWidth, this.el.clientHeight);
  }
  _paintAll(ctx, W, H) {
    ctx.save();
    ctx.fillStyle = this.darkPage ? '#000' : argb(this._paper);
    ctx.fillRect(0, 0, W, H);
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    this.onDraw(ctx);
    ctx.restore();
  }
  applyBackground() { this.el.style.background = this.darkPage ? '#000' : argb(this._paper); }

  /** What View.draw(canvas) gives: the visible view on a white (black when dark) underlay. Returns an HTMLCanvasElement of
   *  width*scale x height*scale pixels (scale defaults to devicePixelRatio, stored as canvas.scale). */
  snapshot(dark = this.darkPage, scale = (window.devicePixelRatio || 1)) {
    const W = this.el.clientWidth, H = this.el.clientHeight;
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(W * scale)); c.height = Math.max(1, Math.round(H * scale)); c.scale = scale;
    const ctx = c.getContext('2d');
    ctx.fillStyle = dark ? '#000' : '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    this._paintAll(ctx, W, H);
    return c;
  }

  // ---- page management ---------------------------------------------------------------------------------------
  showPage(pageBitmap, pageNumber, allMarks, allStrokes, allTranslations) {
    this.clearLassoSelection();
    this.stopTextSelection();
    this.noteHitBoxes.clear(); this.memoHitBoxes.clear(); this._selectedElement = null; this.elementDrag = 0;
    if (this.bitmap !== pageBitmap) this._darkBitmap = null;
    this.bitmap = pageBitmap;
    this.page = pageNumber;
    this.marks = allMarks; this.strokes = allStrokes; this.translations = allTranslations;
    this.textRegions = []; this.selectedTextRegions.length = 0; this.textSelectMode = false;
    this.scale = 1; this.panX = this.panY = 0;
    this.analyze();
    this.invalidate();
  }
  clearPage() {
    this.clearLassoSelection();
    this.stopTextSelection();
    this.noteHitBoxes.clear(); this.memoHitBoxes.clear();
    this.bitmap = null; this._darkBitmap = null;
    this.bounds.set(new RectF(0, 0, 1, 1)); this.crop.set(new RectF(0, 0, 1, 1)); this._paper = DEFAULT_PAPER; this.applyBackground();
    this.marks = null; this.strokes = null; this.translations = null; this.textRegions = []; this.selectedTextRegions.length = 0; this.textSelectMode = false;
    this.scale = 1; this.panX = this.panY = 0;
    this.invalidate();
  }
  getPageNumber() { return this.page; }
  /** Copy of the page bitmap (canvas) or null. */
  copyPageBitmap() {
    if (!this.bitmap) return null;
    const [w, h] = bitmapSize(this.bitmap);
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(this.bitmap, 0, 0);
    return c;
  }
  pageAspect() { if (!this.bitmap) return 1.414; const [w, h] = bitmapSize(this.bitmap); return w === 0 ? 1.414 : h / w; }

  // ---- tools -------------------------------------------------------------------------------------------------
  setHighlightMode(enabled, color) {
    this.highlightMode = enabled;
    if (enabled) { this.setLassoMode(false); this.memoMode = false; this.outlineMode = false; }
    if (color !== undefined) this.highlightColor = color;
    this.invalidate();
  }
  setMemoMode(enabled) {
    this.memoMode = enabled;
    if (enabled) { this.setLassoMode(false); this.highlightMode = false; this.outlineMode = false; }
    this.invalidate();
  }
  setOutlineMode(enabled) {
    this.outlineMode = enabled;
    if (enabled) { this.setLassoMode(false); this.highlightMode = false; this.memoMode = false; }
    this.invalidate();
  }
  setInkTool(mode, color, width) {
    this.inkMode = mode; this.inkColor = color; this.inkWidth = width;
    if (mode !== 0) { this.setLassoMode(false); this.highlightMode = this.memoMode = this.outlineMode = false; }
    this.invalidate();
  }
  setDirectTextSelection(enabled) { this.directTextSelection = enabled; this.clearTextSelectionOverlay(); }
  copyToolsFrom(other) {
    this.darkPage = other.darkPage; this._darkBitmap = null; this.applyBackground(); this.directTextSelection = other.directTextSelection;
    this.highlightMode = other.highlightMode; this.memoMode = other.memoMode; this.outlineMode = other.outlineMode; this.highlightColor = other.highlightColor;
    this.inkMode = other.inkMode; this.inkColor = other.inkColor; this.inkWidth = other.inkWidth; this.fingerInk = other.fingerInk;
    this.pageSwipeEnabled = other.pageSwipeEnabled; this.verticalPageSwipe = other.verticalPageSwipe; this.lassoShape = other.lassoShape;
    if (this.lassoMode !== other.lassoMode) { this.lassoMode = other.lassoMode; this.clearLassoSelection(); }
    this.invalidate();
  }
  setAnnotationStore(store) { this.annotationStore = store; this.invalidate(); }
  setFingerInk(enabled) { this.fingerInk = enabled; }
  setPageSwipeEnabled(enabled) { this.pageSwipeEnabled = enabled; }
  setVerticalPageSwipe(vertical) { this.verticalPageSwipe = vertical; }
  setPageDrag(drag) { this.pageDrag = drag; }
  isLassoMode() { return this.lassoMode; }
  getLassoShape() { return this.lassoShape; }
  setLassoMode(enabled) {
    this.lassoMode = enabled; this.clearLassoSelection(); this.clearTextSelectionOverlay();
    if (enabled) { this.finishInkStroke(); this.inkMode = 0; this.highlightMode = this.memoMode = this.outlineMode = false; }
  }
  setLassoShape(shape) { this.lassoShape = Math.max(LASSO_FREE, Math.min(LASSO_CIRCLE, shape)); this.clearLassoSelection(); }
  setDarkPage(enabled) { this.darkPage = enabled; this.applyBackground(); this.invalidate(); }
  isDarkPage() { return this.darkPage; }

  // ---- text selection ----------------------------------------------------------------------------------------
  setTextRegions(regions, showBounds) {
    this._cancelBeginTextSelection();
    this.clearTextSelectionOverlay();
    this.textRegions = regions ? Array.from(regions) : []; this.textSelectMode = true; this.showTextBounds = !!showBounds;
    this.invalidate();
  }
  stopTextSelection() {
    this.directTextSelection = false; this.textSelectMode = false; this.textRegions = []; this.clearTextSelectionOverlay();
  }
  clearTextSelectionOverlay() {
    this._cancelBeginTextSelection();
    this.selectionCandidate = this.selectingText = false;
    this.selectedTextRegions.length = 0; this.selectionStartRegion = this.selectionEndRegion = null;
    this.drawing = this.panning = this.gestureMoved = false; this.bodySwipeCandidate = false;
    this.invalidate();
  }
  /** Call when the view is removed from the document (Java onDetachedFromWindow). */
  onDetachedFromWindow() { this.clearLassoSelection(); this.clearTextSelectionOverlay(); }
  destroy() { this.onDetachedFromWindow(); if (this._ro) this._ro.disconnect(); if (this._unsubImages) this._unsubImages(); clearTimeout(this._blankTimer); }

  // ---- search highlights -------------------------------------------------------------------------------------
  setSearchHighlights(pageNumber, others, current) { this.searchPage = pageNumber; this.searchBoxes = others ? Array.from(others) : []; this.searchCurrent = current ? RectF.from(current) : null; this.invalidate(); }
  clearSearchHighlights() { this.searchPage = -1; this.searchBoxes = []; this.searchCurrent = null; this.invalidate(); }

  // ---- geometry ----------------------------------------------------------------------------------------------
  highlightHeight(dest) { return Math.max(12, dest.height() * 0.022); }
  /** Finds the paper colour and the content box (Java analyze()). Cached per bitmap. */
  analyze() {
    this.bounds.set(new RectF(0, 0, 1, 1)); this.crop.set(new RectF(0, 0, 1, 1)); this._paper = 0xFFFFFFFF | 0;
    if (this.bitmap) {
      let a = analysisCache.get(this.bitmap);
      const [bw, bh] = bitmapSize(this.bitmap);
      if (!a || a.bw !== bw || a.bh !== bh) { a = analyzeBitmap(this.bitmap); a.bw = bw; a.bh = bh; analysisCache.set(this.bitmap, a); }
      this._paper = a.paper; this.bounds.set(a.bounds);
    }
    this.applyBackground();
  }
  /** Forget the cached content analysis of the current bitmap (call after drawing into it) and redo it. */
  reanalyze() { if (this.bitmap) analysisCache.delete(this.bitmap); this.analyze(); this.invalidate(); }
  contentBounds() { return this.bounds.copy(); }
  paperColor() { return this._paper; }
  setCrop(box) {
    if (!box || box.width() < 0.2 || box.height() < 0.2) this.crop.set(new RectF(0, 0, 1, 1)); else this.crop.set(box);
    this.panX = this.panY = 0; this.invalidate();
  }
  contentSize() {
    if (!this.bitmap) return [0, 0];
    const [bw, bh] = bitmapSize(this.bitmap);
    const base = Math.min(this.width / (bw * this.crop.width()), this.height / (bh * this.crop.height()));
    return [bw * base * this.scale, bh * base * this.scale];
  }
  baseLeft(size) { return (this.width - size[0]) / 2 - (this.crop.centerX() - 0.5) * size[0]; }
  baseTop(size) { return (this.height - size[1]) / 2 - (this.crop.centerY() - 0.5) * size[1]; }
  clampPan() {
    if (!this.bitmap) return;
    const size = this.contentSize();
    const maxX = Math.max(0, (size[0] * this.crop.width() - this.width) / 2), maxY = Math.max(0, (size[1] * this.crop.height() - this.height) / 2);
    this.panX = Math.max(-maxX, Math.min(maxX, this.panX)); this.panY = Math.max(-maxY, Math.min(maxY, this.panY));
    if (this.scale <= 1) this.panX = this.panY = 0;
  }
  /** Where the page is drawn inside this view (follows zoom and pan), in view px. */
  pageRect() { return this.contentRect(); }
  contentRect() {
    if (!this.bitmap) return new RectF();
    const size = this.contentSize();
    const left = this.baseLeft(size) + this.panX, top = this.baseTop(size) + this.panY;
    return new RectF(left, top, left + size[0], top + size[1]);
  }
  /** View point -> normalized page point (clamped), as [x, y]. */
  toPage(vx, vy) {
    const d = this.contentRect(); if (d.width() <= 0 || d.height() <= 0) return [0.5, 0.5];
    return [clamp((vx - d.left) / d.width(), 0, 1), clamp((vy - d.top) / d.height(), 0, 1)];
  }
  pageFraction(y) { const r = this.pageRect(); return r.height() <= 0 ? 0.5 : clamp((y - r.top) / r.height(), 0, 1); }
  focusOnPoint(x, y) {
    if (!this.bitmap) return;
    this.scale = Math.max(this.scale, 1.7);
    const size = this.contentSize();
    this.panX = this.width / 2 - (this.baseLeft(size) + x * size[0]);
    this.panY = this.height / 2 - (this.baseTop(size) + y * size[1]);
    this.clampPan(); this.invalidate();
  }

  // ---- element selection -------------------------------------------------------------------------------------
  selectElement(element) { this._selectedElement = element; this.invalidate(); }
  selectedElement() { return this._selectedElement; }
  static resizable(e) { return !!e && e.kind !== 'text' && e.kind !== 'audio'; }
  static selectable(e) { return e.kind === 'image' || e.kind === 'sticker' || e.kind === 'video' || e.kind === 'shape' || e.kind === 'table' || e.kind === 'youtube'; }
  static aspectLocked(e) { return e.kind === 'image' || e.kind === 'sticker' || e.kind === 'video' || e.kind === 'youtube'; }

  _drawElementHandles(ctx, dest) {
    const se = this._selectedElement;
    if (!se || se.page !== this.page || !this.annotationStore || !this.annotationStore.elements.includes(se) || dest.width() <= 0) return;
    const d = DP, b = boxOf(dest, se);
    ctx.lineWidth = 2 * d; ctx.strokeStyle = argb(0xFF007AFF); ctx.strokeRect(b.left, b.top, b.width(), b.height());
    const corners = [[b.left, b.top], [b.right, b.top], [b.left, b.bottom], [b.right, b.bottom]];
    for (const c of corners) {
      ctx.beginPath(); ctx.arc(c[0], c[1], 9 * d, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.beginPath(); ctx.arc(c[0], c[1], 9 * d, 0, Math.PI * 2); ctx.stroke();
    }
  }

  _handleElementGesture(e, dest) {
    const se = this._selectedElement;
    if (!se || !this.annotationStore || dest.width() <= 0) return false;
    if (se.page !== this.page || !this.annotationStore.elements.includes(se)) { this._selectedElement = null; return false; }
    const action = e.action, density = DP;
    if (action === DOWN && e.pointerCount === 1 && !this.isStylus(e)) {
      const b = boxOf(dest, se), reach = 24 * density; let hit = 0;
      if (Math.hypot(e.x - b.left, e.y - b.top) <= reach) hit = 2; else if (Math.hypot(e.x - b.right, e.y - b.top) <= reach) hit = 3;
      else if (Math.hypot(e.x - b.left, e.y - b.bottom) <= reach) hit = 4; else if (Math.hypot(e.x - b.right, e.y - b.bottom) <= reach) hit = 5;
      else if (b.contains(e.x, e.y)) hit = 1;
      if (hit === 0) { this._selectedElement = null; this.invalidate(); return false; }
      if (hit > 1 && !PdfPageView.resizable(se)) hit = 1;
      this._L('onSelectionAdjustStarted'); this.elementDrag = hit; this.elementMoved = false; this.elementStartX = e.x; this.elementStartY = e.y;
      this.elementOrigin.set(new RectF(se.left, se.top, se.right, se.bottom));
      return true;
    }
    if (this.elementDrag === 0) return false;
    if (action === MOVE) {
      const dx = (e.x - this.elementStartX) / dest.width(), dy = (e.y - this.elementStartY) / dest.height();
      if (!this.elementMoved && Math.hypot(e.x - this.elementStartX, e.y - this.elementStartY) < 8 * density) return true;
      this.elementMoved = true; const el = se, o = this.elementOrigin, w = o.width(), h = o.height();
      if (this.elementDrag === 1) {
        const left = Math.max(0, Math.min(1 - w, o.left + dx)), top = Math.max(0, Math.min(1 - h, o.top + dy));
        el.left = left; el.top = top; el.right = left + w; el.bottom = top + h;
      } else {
        const leftCorner = this.elementDrag === 2 || this.elementDrag === 4, topCorner = this.elementDrag === 2 || this.elementDrag === 3;
        const fx = leftCorner ? o.right : o.left, fy = topCorner ? o.bottom : o.top;
        const nx = Math.max(0, Math.min(1, (e.x - dest.left) / dest.width())), ny = Math.max(0, Math.min(1, (e.y - dest.top) / dest.height()));
        let nw = Math.max(0.04, leftCorner ? fx - nx : nx - fx), nh = Math.max(0.03, topCorner ? fy - ny : ny - fy);
        if (PdfPageView.aspectLocked(el)) {
          const ratio = (w * dest.width()) / (h * dest.height()); nh = nw * dest.width() / (ratio * dest.height());
          const room = topCorner ? fy : 1 - fy; if (nh > room) { nh = room; nw = nh * ratio * dest.height() / dest.width(); }
          const roomX = leftCorner ? fx : 1 - fx; if (nw > roomX) { nw = roomX; nh = nw * dest.width() / (ratio * dest.height()); }
        }
        el.left = leftCorner ? fx - nw : fx; el.right = leftCorner ? fx : fx + nw; el.top = topCorner ? fy - nh : fy; el.bottom = topCorner ? fy : fy + nh;
      }
      this.invalidate(); return true;
    }
    if (action === UP || action === CANCEL) {
      const moved = this.elementMoved; this.elementDrag = 0; this.elementMoved = false;
      if (action === CANCEL) { const o = this.elementOrigin; se.left = o.left; se.top = o.top; se.right = o.right; se.bottom = o.bottom; this.invalidate(); }
      else if (moved) this._L('onInkChanged'); else this._L('onElementTapped', se);
      return true;
    }
    return true;
  }

  // ---- rendering ---------------------------------------------------------------------------------------------
  _strokeWidth(base, pressure, dest) { const p = Math.max(0.12, Math.min(1, pressure)); return Math.max(1.5, base * dest.width() * (0.45 + p * 1.15)); }
  _pageImage() {
    if (!this.darkPage) return this.bitmap;
    if (!this._darkBitmap || this._darkBitmap.src !== this.bitmap) { this._darkBitmap = darkFilterCanvas(this.bitmap); this._darkBitmap.src = this.bitmap; }
    return this._darkBitmap;
  }

  /** Java onDraw. ctx is in view px (already scaled for devicePixelRatio). */
  onDraw(ctx) {
    if (!this.bitmap) return;
    const dest = this.contentRect(), dw = dest.width(), dh = dest.height();
    ctx.fillStyle = this.darkPage ? '#000' : '#fff';
    ctx.fillRect(dest.left, dest.top, dw, dh);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this._pageImage(), dest.left, dest.top, dw, dh);
    AnnotationPainter.dark = this.darkPage;
    const sup = this.suppressSelection;
    try {
      if (!sup && this.textSelectMode && this.showTextBounds) {
        ctx.lineWidth = 1.5 * DP; ctx.strokeStyle = argb(0xAA2563EB);
        for (const r of this.textRegions) {
          const b = r.wordBounds;
          roundRectPath(ctx, dest.left + b.left * dw, dest.top + b.top * dh, dest.left + b.right * dw, dest.top + b.bottom * dh, 4, 4); ctx.stroke();
        }
      }
      if (!sup && this.selectedTextRegions.length) {
        ctx.fillStyle = argb(0x663B82F6);
        for (const b of this.selectionLineBounds()) {
          roundRectPath(ctx, dest.left + b.left * dw, dest.top + b.top * dh, dest.left + b.right * dw, dest.top + b.bottom * dh, 5, 5); ctx.fill();
        }
        const first = this.selectedTextRegions[0].wordBounds, last = this.selectedTextRegions[this.selectedTextRegions.length - 1].wordBounds, handle = 5 * DP;
        fillCircle(ctx, dest.left + first.left * dw, dest.top + first.bottom * dh, handle, 0xFF007AFF);
        fillCircle(ctx, dest.left + last.right * dw, dest.top + last.bottom * dh, handle, 0xFF007AFF);
      }
      if (this.marks) for (const m of this.marks) if (m.page === this.page && !m.noteOnly) {
        ctx.fillStyle = argb(m.color);
        ctx.fillRect(dest.left + m.left * dw, dest.top + m.top * dh, (m.right - m.left) * dw, (m.bottom - m.top) * dh);
      }
      if (this.strokes) {
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        for (const s of this.strokes) if (s.page === this.page && s.points.length > 0) {
          const col = argb(AnnotationPainter.adj(s.color)); const pts = s.points;
          if (pts.length === 1) {
            const p = pts[0]; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(dest.left + p.x * dw, dest.top + p.y * dh, this._strokeWidth(s.width, p.pressure, dest) / 2, 0, Math.PI * 2); ctx.fill();
          } else {
            ctx.strokeStyle = col;
            for (let i = 1; i < pts.length; i++) {
              const a = pts[i - 1], b = pts[i];
              ctx.lineWidth = this._strokeWidth(s.width, (a.pressure + b.pressure) / 2, dest);
              ctx.beginPath(); ctx.moveTo(dest.left + a.x * dw, dest.top + a.y * dh); ctx.lineTo(dest.left + b.x * dw, dest.top + b.y * dh); ctx.stroke();
            }
          }
        }
      }
      this.memoHitBoxes.clear();
      if (this.marks) for (const m of this.marks) if (m.page === this.page && m.visible && (m.noteOnly || (m.note != null && m.note.length > 0))) this._drawMemo(ctx, dest, m);
      this.noteHitBoxes.clear();
      if (this.translations) for (const n of this.translations) if (n.page === this.page && n.visible) this._drawTranslation(ctx, dest, n);
      if (!sup && this.drawing) {
        ctx.fillStyle = argb(this.highlightColor);
        const centerY = (this.startY + this.currentY) / 2, half = this.highlightHeight(dest) / 2;
        const l = Math.min(this.startX, this.currentX), r = Math.max(this.startX, this.currentX);
        ctx.fillRect(l, centerY - half, r - l, half * 2);
      }
      if (this.annotationStore) AnnotationPainter.elements(ctx, dest, this.annotationStore, this.page);
    } finally { AnnotationPainter.dark = false; }
    if (!sup) this._drawElementHandles(ctx, dest);
    if (!sup && this.searchPage === this.page) this._drawSearchHighlights(ctx, dest);
    if (!sup && this.lassoPoints.length) {
      const path = this._lassoPath(dest);
      ctx.fillStyle = argb(0x222563EB); ctx.fill(path);
      ctx.lineWidth = 2 * DP; ctx.strokeStyle = argb(0xFF007AFF); ctx.setLineDash([8, 5]); ctx.lineDashOffset = 0; ctx.lineCap = 'butt'; ctx.stroke(path); ctx.setLineDash([]);
    }
  }

  _searchRect(b, dest, pad) { return new RectF(dest.left + b.left * dest.width() - pad, dest.top + b.top * dest.height() - pad, dest.left + b.right * dest.width() + pad, dest.top + b.bottom * dest.height() + pad); }
  _drawSearchHighlights(ctx, dest) {
    const d = DP;
    for (const b of this.searchBoxes) { const r = this._searchRect(b, dest, d); fillRoundRect(ctx, r.left, r.top, r.right, r.bottom, 3 * d, 0x66FFD54F); }
    if (this.searchCurrent) {
      const r = this._searchRect(this.searchCurrent, dest, 2 * d);
      fillRoundRect(ctx, r.left, r.top, r.right, r.bottom, 4 * d, 0x99FF9800);
      roundRectPath(ctx, r.left, r.top, r.right, r.bottom, 4 * d, 4 * d); ctx.lineWidth = 2 * d; ctx.strokeStyle = argb(0xFFEA580C); ctx.stroke();
    }
  }

  _drawSticky(ctx, dest, nx, ny, text, minimized, accent, paper = 0xFFFFF3A6 | 0, fontSp = 13, boxSize = 1) {
    const d = DP;
    const anchorX = dest.left + nx * dest.width(), anchorY = dest.top + ny * dest.height();
    if (minimized) {
      const r = 14 * d; const box = new RectF(anchorX - r, anchorY - r, anchorX + r, anchorY + r);
      fillCircle(ctx, anchorX, anchorY, r, accent);
      ctx.fillStyle = '#fff'; ctx.font = `${17 * d}px ${FONT_SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('▣', anchorX, anchorY + 6 * d); ctx.textAlign = 'left';
      return box;
    }
    const boxW = [150, 220, 300], boxH = [64, 96, 170];
    boxSize = Math.max(0, Math.min(2, boxSize | 0));
    const w = Math.min(boxW[boxSize] * d, dest.width() * (boxSize === 2 ? 0.7 : 0.46)), h = boxH[boxSize] * d;
    let left = Math.min(dest.right - w - 6 * d, anchorX + 8 * d); if (left < dest.left) left = dest.left + 6 * d;
    const top = Math.max(dest.top + 6 * d, Math.min(dest.bottom - h - 6 * d, anchorY));
    const box = new RectF(left, top, left + w, top + h);
    fillRoundRect(ctx, box.left, box.top, box.right, box.bottom, 10 * d, paper);
    fillCircle(ctx, anchorX, anchorY, 6 * d, accent);
    ctx.fillStyle = argb(0xFF3F3A2D); ctx.font = `${fontSp * d}px ${FONT_SANS}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const lineHeight = fontSp * 1.4 * d; const x = box.left + 10 * d; let y = box.top + (fontSp + 9) * d; const max = box.width() - 20 * d;
    for (const paragraph of javaSplit(text == null ? '' : text, '\n')) {
      let line = '';
      for (const word of javaSplit(paragraph, ' ')) {
        const candidate = line === '' ? word : line + ' ' + word;
        if (ctx.measureText(candidate).width > max && line !== '') {
          ctx.fillText(line, x, y); y += lineHeight; line = word; if (y > box.bottom - 12 * d) return box;
        } else line = candidate;
      }
      if (line !== '') { ctx.fillText(line, x, y); y += 18 * d; if (y > box.bottom - 12 * d) return box; }
    }
    return box;
  }
  _drawMemo(ctx, dest, m) { this.memoHitBoxes.set(m, this._drawSticky(ctx, dest, m.right, m.top, m.note, m.minimized, 0xFFFFB300 | 0, m.paper, m.fontSp, m.boxSize)); }
  _drawTranslation(ctx, dest, n) { this.noteHitBoxes.set(n, this._drawSticky(ctx, dest, n.right, n.top, n.translated, n.minimized, 0xFF7C3AED | 0)); }

  // ---- lasso -------------------------------------------------------------------------------------------------
  _normalizedPoint(x, y, dest) { return { x: Math.max(0, Math.min(1, (x - dest.left) / dest.width())), y: Math.max(0, Math.min(1, (y - dest.top) / dest.height())) }; }
  _updateLassoShape(x, y, dest) {
    if (!this.lassoAnchor || dest.width() <= 0 || dest.height() <= 0) return;
    const end = this._normalizedPoint(x, y, dest); this.lassoPoints.length = 0;
    const a = this.lassoAnchor, left = Math.min(a.x, end.x), right = Math.max(a.x, end.x), top = Math.min(a.y, end.y), bottom = Math.max(a.y, end.y);
    if (this.lassoShape === LASSO_RECT) {
      this.lassoPoints.push({ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom });
    } else {
      const steps = 72, cx = (left + right) / 2, cy = (top + bottom) / 2, rx = (right - left) / 2, ry = (bottom - top) / 2;
      for (let i = 0; i < steps; i++) { const ang = 2 * Math.PI * i / steps; this.lassoPoints.push({ x: cx + rx * Math.cos(ang), y: cy + ry * Math.sin(ang) }); }
    }
  }
  clearLassoSelection() { this.lassoAnchor = null; this.lassoDrawing = false; this.lassoPoints.length = 0; this.invalidate(); }
  getLassoPoints() { return this.lassoPoints.map(p => ({ x: p.x, y: p.y })); }
  _addLassoPoint(x, y, dest) {
    if (dest.width() <= 0 || dest.height() <= 0) return;
    const p = { x: Math.max(0, Math.min(1, (x - dest.left) / dest.width())), y: Math.max(0, Math.min(1, (y - dest.top) / dest.height())) };
    if (this.lassoPoints.length) { const l = this.lassoPoints[this.lassoPoints.length - 1]; if (Math.hypot((p.x - l.x) * dest.width(), (p.y - l.y) * dest.height()) < 2) return; }
    if (this.lassoPoints.length < 8192) this.lassoPoints.push(p);
  }
  _lassoPath(dest) {
    const path = new Path2D();
    this.lassoPoints.forEach((p, i) => { const x = dest.left + p.x * dest.width(), y = dest.top + p.y * dest.height(); if (i === 0) path.moveTo(x, y); else path.lineTo(x, y); });
    path.closePath(); return path;
  }
  _validLasso(dest) {
    const pts = this.lassoPoints; if (pts.length < 3) return false;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) { const x = dest.left + p.x * dest.width(), y = dest.top + p.y * dest.height(); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    let area = 0;
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a.x * b.y - b.x * a.y; }
    const minimum = 8 * DP;
    return (maxX - minX) >= minimum && (maxY - minY) >= minimum && Math.abs(area) * dest.width() * dest.height() / 2 >= minimum * minimum;
  }
  /** Renders the lassoed area (page + annotations, no selection UI) into a transparent canvas, or null. */
  captureLasso() {
    const dest = this.contentRect(); if (!this.bitmap || !this._validLasso(dest)) return null;
    const [bw, bh] = bitmapSize(this.bitmap);
    let nl = Infinity, nt = Infinity, nr = -Infinity, nb = -Infinity;
    for (const p of this.lassoPoints) { nl = Math.min(nl, p.x); nr = Math.max(nr, p.x); nt = Math.min(nt, p.y); nb = Math.max(nb, p.y); }
    const left = Math.max(0, Math.floor(nl * bw)), top = Math.max(0, Math.floor(nt * bh));
    const right = Math.min(bw, Math.ceil(nr * bw)), bottom = Math.min(bh, Math.ceil(nb * bh));
    const outputScale = Math.min(1, Math.sqrt(8000000 / ((right - left) * (bottom - top))));
    const width = Math.max(1, Math.ceil((right - left) * outputScale)), height = Math.max(1, Math.ceil((bottom - top) * outputScale));
    const cap = document.createElement('canvas'); cap.width = width; cap.height = height;
    const ctx = cap.getContext('2d');
    ctx.scale(outputScale, outputScale); ctx.translate(-left, -top);
    ctx.beginPath(); this.lassoPoints.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x * bw, p.y * bh); else ctx.lineTo(p.x * bw, p.y * bh); }); ctx.closePath(); ctx.clip();
    ctx.scale(bw / dest.width(), bh / dest.height()); ctx.translate(-dest.left, -dest.top);
    this.suppressSelection = true;
    try { this.onDraw(ctx); } finally { this.suppressSelection = false; }
    return cap;
  }
  /** Words of the text regions whose centre lies inside the lasso, joined by ' ' (same line) or '\n'. */
  lassoText() {
    const pts = this.lassoPoints; if (pts.length < 3) return '';
    const poly = pts.map(p => [Math.max(0, Math.min(10000, p.x * 10000)), Math.max(0, Math.min(10000, p.y * 10000))]);
    const inside = (px, py) => { // non-zero winding
      let wn = 0;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const cross = (b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1]);
        if (a[1] <= py) { if (b[1] > py && cross > 0) wn++; } else if (b[1] <= py && cross < 0) wn--;
      }
      return wn !== 0;
    };
    let text = '', prevLine = null;
    for (const word of this.textRegions) {
      const cx = Math.trunc(word.wordBounds.centerX() * 10000), cy = Math.trunc(word.wordBounds.centerY() * 10000);
      if (cx >= 0 && cx < 10000 && cy >= 0 && cy < 10000 && inside(cx + 0.5, cy + 0.5)) {
        if (text.length > 0) text += (prevLine != null && !prevLine.equals(word.lineBounds)) ? '\n' : ' ';
        text += word.word; prevLine = word.lineBounds;
      }
    }
    return text;
  }

  // ---- text-selection helpers --------------------------------------------------------------------------------
  textRegionAt(x, y, dest) {
    if (!this.textSelectMode || dest.width() === 0 || !dest.contains(x, y)) return null;
    const nx = (x - dest.left) / dest.width(), ny = (y - dest.top) / dest.height(), tol = 16 * DP;
    let best = null, bestD = Infinity;
    for (const r of this.textRegions) {
      const dx = (nx - Math.max(r.wordBounds.left, Math.min(nx, r.wordBounds.right))) * dest.width();
      const dy = (ny - Math.max(r.wordBounds.top, Math.min(ny, r.wordBounds.bottom))) * dest.height();
      const dd = dx * dx + dy * dy; if (dd < bestD) { bestD = dd; best = r; }
    }
    return bestD <= tol * tol ? best : null;
  }
  nearestTextRegion(x, y, dest) {
    const hit = this.textRegionAt(x, y, dest); if (hit) return hit;
    if (dest.width() === 0 || !this.textRegions.length) return null;
    const nx = Math.max(0, Math.min(1, (x - dest.left) / dest.width())), ny = Math.max(0, Math.min(1, (y - dest.top) / dest.height()));
    let best = null, bestD = Infinity;
    for (const r of this.textRegions) {
      const dx = nx - Math.max(r.wordBounds.left, Math.min(nx, r.wordBounds.right)), dy = ny - Math.max(r.wordBounds.top, Math.min(ny, r.wordBounds.bottom));
      const dd = dx * dx + dy * dy * 2; if (dd < bestD) { bestD = dd; best = r; }
    }
    return best;
  }
  _cancelBeginTextSelection() { clearTimeout(this._beginTimer); this._beginTimer = 0; }
  _beginTextSelection() {
    this._beginTimer = 0;
    if (!this.selectionCandidate || !this.selectionStartRegion) return;
    this.bodySwipeCandidate = false; this.selectingText = true; this.selectionCandidate = false; this.panning = false;
    this.selectedTextRegions.length = 0; this.selectedTextRegions.push(this.selectionStartRegion);
    this.invalidate();
  }
  beginTextSelectionNow() {
    this._cancelBeginTextSelection();
    if (this.selectingText || !this.selectionStartRegion) return;
    this.selectingText = true; this.selectionCandidate = false; this.bodySwipeCandidate = false; this.panning = false;
    this.selectedTextRegions.length = 0; this.selectedTextRegions.push(this.selectionStartRegion);
    this.invalidate();
  }
  updateTextSelection(end) {
    if (!end || !this.selectionStartRegion) return;
    this.selectionEndRegion = end;
    const a = this.textRegions.indexOf(this.selectionStartRegion), b = this.textRegions.indexOf(end);
    if (a < 0 || b < 0) return;
    this.selectedTextRegions.length = 0;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) this.selectedTextRegions.push(this.textRegions[i]);
    this.invalidate();
  }
  selectionLineBounds() {
    const bounds = []; let prevLine = null, cur = null;
    for (const region of this.selectedTextRegions) {
      if (prevLine && prevLine.equals(region.lineBounds)) cur.union(region.wordBounds);
      else { cur = region.wordBounds.copy(); bounds.push(cur); prevLine = region.lineBounds; }
    }
    return bounds;
  }
  finishTextSelection() {
    if (!this.selectedTextRegions.length) return null;
    const bounds = this.selectionLineBounds(); const union = this.selectedTextRegions[0].wordBounds.copy(); const words = [];
    for (const r of this.selectedTextRegions) { words.push(r.word); union.union(r.wordBounds); }
    return { text: words.join(' '), bounds, unionBounds: union, singleWord: this.selectedTextRegions.length === 1 };
  }

  // ---- ink ---------------------------------------------------------------------------------------------------
  isStylus(e) { return e.toolType === 'pen' || e.toolType === 'mouse' || e.toolType === 'eraser'; }
  temporaryEraser(e) { return e.toolType === 'eraser' || (e.toolType === 'pen' && (e.buttonState & 2) !== 0); }
  inputPressure(e) { return this.isStylus(e) ? Math.max(0.05, Math.min(1, e.pressure)) : 0.65; }
  finishInkStroke() {
    if (this.activeStroke && this.activeStroke.points.length) this._L('onInkChanged');
    this.activeStroke = null; this.stylusDrawing = false;
  }
  _addInkPoint(e, dest) {
    if (!this.activeStroke || !dest.contains(e.x, e.y)) return;
    const x = (e.x - dest.left) / dest.width(), y = (e.y - dest.top) / dest.height(), pressure = this.inputPressure(e), pts = this.activeStroke.points;
    if (!pts.length) { pts.push(new InkPoint(x, y, pressure)); return; }
    if (this.inkMode === 3) { const end = new InkPoint(x, y, pressure); if (pts.length === 1) pts.push(end); else pts[1] = end; return; }
    const last = pts[pts.length - 1], dx = x - last.x, dy = y - last.y;
    if (dx * dx + dy * dy > 0.000002) pts.push(new InkPoint(x, y, pressure));
  }
  _eraseAt(e, dest) {
    if (!this.strokes || dest.width() === 0) return;
    const x = (e.x - dest.left) / dest.width(), y = (e.y - dest.top) / dest.height(), threshold = Math.max(0.012, 18 / dest.width());
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i]; if (s.page !== this.page) continue;
      for (const p of s.points) if (Math.hypot(p.x - x, p.y - y) <= threshold) { this.strokes.splice(i, 1); this._L('onInkChanged'); this.invalidate(); return; }
    }
  }

  touchSlop() { return Math.max(14 * DP, 8 * 1.5); }
  swipeDistance() { return Math.max(48 * DP, Math.min((this.verticalPageSwipe ? this.height : this.width) * 0.1, 100 * DP)); }

  // ---- blank long press --------------------------------------------------------------------------------------
  _fireBlankPress() {
    this._blankTimer = 0;
    if (this.scalingOccurred || this.dragging || this.selectingText) return;
    const d = this.contentRect(); if (d.width() <= 0 || !d.contains(this.startX, this.startY)) return;
    this.bodySwipeCandidate = false; this.gestureMoved = true;
    const n = this.toPage(this.startX, this.startY);
    this._L('onBlankLongPress', this.page, n[0], n[1], this.startX, this.startY);
  }
  _cancelBlankPress() { clearTimeout(this._blankTimer); this._blankTimer = 0; }

  // ---- Pointer Events -> MotionEvent --------------------------------------------------------------------------
  _local(pe) { const r = this.el.getBoundingClientRect(); return [pe.clientX - r.left, pe.clientY - r.top]; }
  _toolOf(pe) {
    if (pe.pointerType === 'pen') return (pe.buttons & 32) || pe.button === 5 ? 'eraser' : 'pen';
    return pe.pointerType === 'touch' ? 'touch' : 'mouse';
  }
  _onPointerDown(pe) {
    if (pe.pointerType === 'mouse' && pe.button !== 0) return;
    pe.preventDefault();
    try { this.el.setPointerCapture(pe.pointerId); } catch (_) { /* ignore */ }
    const stale = this._ptrs.findIndex(p => p.id === pe.pointerId);
    if (stale >= 0) this._ptrs.splice(stale, 1);
    const [x, y] = this._local(pe);
    const rec = { id: pe.pointerId, x, y, tool: this._toolOf(pe), pressure: pe.pressure, buttons: pe.buttons };
    const first = this._ptrs.length === 0;
    this._ptrs.push(rec);
    this._dispatch(first ? DOWN : POINTER_DOWN, rec, pe, null);
  }
  _onPointerMove(pe) {
    const rec = this._ptrs.find(p => p.id === pe.pointerId); if (!rec) return;
    pe.preventDefault();
    const hist = [];
    if (this._ptrs[0] === rec && pe.getCoalescedEvents) {
      const co = pe.getCoalescedEvents(); const r = this.el.getBoundingClientRect();
      for (let i = 0; i < co.length - 1; i++) hist.push({ x: co[i].clientX - r.left, y: co[i].clientY - r.top, pressure: co[i].pressure });
    }
    const [x, y] = this._local(pe); rec.x = x; rec.y = y; rec.pressure = pe.pressure; rec.buttons = pe.buttons; rec.tool = this._toolOf(pe);
    this._dispatch(MOVE, rec, pe, hist);
  }
  _onPointerUp(pe) {
    const idx = this._ptrs.findIndex(p => p.id === pe.pointerId); if (idx < 0) return;
    pe.preventDefault();
    const rec = this._ptrs[idx]; const [x, y] = this._local(pe); rec.x = x; rec.y = y; rec.pressure = pe.pressure; rec.buttons = pe.buttons;
    const last = this._ptrs.length === 1;
    this._dispatch(last ? UP : POINTER_UP, rec, pe, null);
    this._ptrs.splice(this._ptrs.indexOf(rec), 1);
    try { this.el.releasePointerCapture(pe.pointerId); } catch (_) { /* ignore */ }
  }
  _onPointerCancel(pe) {
    const rec = this._ptrs.find(p => p.id === pe.pointerId); if (!rec) return;
    this._dispatch(CANCEL, rec, pe, null);
    this._ptrs.length = 0;
  }
  _dispatch(action, rec, pe, hist) {
    const ptrs = this._ptrs.map(p => ({ x: p.x, y: p.y }));
    const p0 = this._ptrs[0] || rec;
    const e = {
      action, actionIndex: Math.max(0, this._ptrs.indexOf(rec)), pointerCount: ptrs.length,
      x: p0.x, y: p0.y, getX: i => ptrs[i].x, getY: i => ptrs[i].y,
      toolType: p0.tool, buttonState: p0.buttons, pressure: p0.pressure, time: pe.timeStamp,
      history: hist || [], getHistorySize() { return this.history.length; },
    };
    try { this.onTouchEvent(e); } catch (err) { console.error('PdfPageView.onTouchEvent', err); }
  }
  _onWheel(we) {
    if (!this.bitmap) return;
    we.preventDefault();
    const r = this.el.getBoundingClientRect(); const fx = we.clientX - r.left, fy = we.clientY - r.top;
    const unit = we.deltaMode === 1 ? 16 : we.deltaMode === 2 ? this.height : 1;
    if (we.ctrlKey) { // zoom around the pointer (also trackpad pinch)
      const before = this.contentRect();
      const nx = before.width() === 0 ? 0.5 : (fx - before.left) / before.width(), ny = before.height() === 0 ? 0.5 : (fy - before.top) / before.height();
      this.scale = Math.max(1, Math.min(4, this.scale * Math.exp(-we.deltaY * unit * 0.0025)));
      const size = this.contentSize();
      this.panX = fx - nx * size[0] - this.baseLeft(size); this.panY = fy - ny * size[1] - this.baseTop(size);
      this.clampPan(); this.invalidate();
    } else if (this.scale > 1) {
      let dx = we.deltaX * unit, dy = we.deltaY * unit; if (we.shiftKey && dx === 0) { dx = dy; dy = 0; }
      this.panX -= dx; this.panY -= dy; this.clampPan(); this.invalidate();
    }
  }
  _onContextMenu(ce) {
    ce.preventDefault();
    // Desktop addition: right click on empty paper = long press on blank paper (insert menu)
    if (ce.pointerType === 'touch' || !this.bitmap) return;
    const r = this.el.getBoundingClientRect(); const x = ce.clientX - r.left, y = ce.clientY - r.top;
    const d = this.contentRect(); if (d.width() <= 0 || !d.contains(x, y)) return;
    if (this.textRegionAt(x, y, d)) return;
    const n = this.toPage(x, y);
    this._L('onBlankLongPress', this.page, n[0], n[1], x, y);
  }

  // ---- onTouchEvent (exact transcription of the Java) ---------------------------------------------------------
  onTouchEvent(e) {
    this.scaleDetector.onTouchEvent(e);
    if (this.scaleDetector.isInProgress()) return true;
    const dest = this.contentRect();
    const stylus = this.isStylus(e);
    const am = e.action;
    if (am === UP || am === CANCEL || am === POINTER_DOWN || (am === MOVE && Math.hypot(e.x - this.startX, e.y - this.startY) > this.touchSlop())) this._cancelBlankPress();
    if (this._handleElementGesture(e, dest)) return true;
    if (am === DOWN) this.scalingOccurred = false;
    if (am === POINTER_DOWN) { this.finishInkStroke(); this.clearLassoSelection(); }
    if (am === DOWN) {
      this._L('onSelectionAdjustStarted');
      const edge = 72 * DP;
      const eligible = this.pageSwipeEnabled && !stylus && !this.directTextSelection && !this.lassoMode && !this.highlightMode && !this.memoMode && !this.outlineMode && !(this.inkMode !== 0 && this.fingerInk);
      this.bodySwipeCandidate = eligible && this.scale <= 1; this.edgeStartTime = e.time;
      this.edgeSwipe = eligible && this.scale > 1 && (this.verticalPageSwipe ? (e.y < edge || e.y > this.height - edge) : (e.x < edge || e.x > this.width - edge));
      if (this.edgeSwipe) { this.startX = e.x; this.startY = e.y; this.edgeStartTime = e.time; this._cancelBeginTextSelection(); return true; }
    }
    if (am === POINTER_DOWN) {
      this.edgeSwipe = this.bodySwipeCandidate = false;
      if (this.dragging) { this.dragging = false; if (this.dragTracker) { this.dragTracker.recycle(); this.dragTracker = null; } this.pageDrag.end(-1e6); }
    }
    if (this.edgeSwipe) {
      if (am === UP) {
        const along = this.verticalPageSwipe ? e.y - this.startY : e.x - this.startX, cross = this.verticalPageSwipe ? e.x - this.startX : e.y - this.startY;
        this.edgeSwipe = false;
        const threshold = this.swipeDistance();
        if (Math.abs(along) >= threshold && Math.abs(along) > Math.abs(cross) * 1.5 && e.time - this.edgeStartTime <= 1200) this._L('onPageSwipe', along < 0 ? 1 : -1);
      } else if (am === CANCEL) { this.edgeSwipe = false; }
      return true;
    }
    if (this.lassoMode) {
      const action = am;
      if (action === DOWN) {
        this._L('onSelectionAdjustStarted'); this.clearLassoSelection(); this.clearTextSelectionOverlay();
        if (dest.contains(e.x, e.y)) {
          this.lassoDrawing = true; this.lassoAnchor = this._normalizedPoint(e.x, e.y, dest);
          if (this.lassoShape === LASSO_FREE) this._addLassoPoint(e.x, e.y, dest);
        }
        this.invalidate(); return true;
      }
      if (action === CANCEL) { this.clearLassoSelection(); return true; }
      if (e.pointerCount !== 1 || this.scalingOccurred) return true;
      if (action === MOVE && this.lassoDrawing) {
        if (this.lassoShape === LASSO_FREE) { for (const h of e.history) this._addLassoPoint(h.x, h.y, dest); this._addLassoPoint(e.x, e.y, dest); }
        else this._updateLassoShape(e.x, e.y, dest);
        this.invalidate(); return true;
      }
      if (action === UP && this.lassoDrawing) {
        if (this.lassoShape === LASSO_FREE) this._addLassoPoint(e.x, e.y, dest); else this._updateLassoShape(e.x, e.y, dest);
        this.lassoDrawing = false;
        if (this._validLasso(dest)) this._L('onLassoSelectionFinished'); else this.clearLassoSelection();
        this.invalidate(); return true;
      }
      return true;
    }
    if (this.inkMode !== 0 && (stylus || this.fingerInk) && e.pointerCount === 1 && !this.scalingOccurred) {
      const action = am; const erase = this.inkMode === 2 || this.temporaryEraser(e);
      if (action === DOWN) {
        this.stylusDrawing = true;
        if (erase) this._eraseAt(e, dest);
        else if (dest.contains(e.x, e.y)) {
          const s = new InkStroke(); s.page = this.page; s.color = this.inkColor; s.width = this.inkWidth; this.activeStroke = s;
          this._addInkPoint(e, dest); if (this.strokes) this.strokes.push(s);
        }
        this.invalidate(); return true;
      }
      if (action === MOVE && this.stylusDrawing) {
        if (erase) this._eraseAt(e, dest);
        else {
          for (let i = 0; this.inkMode !== 3 && i < e.getHistorySize(); i++) {
            const h = e.history[i];
            if (this.activeStroke && dest.contains(h.x, h.y)) {
              const x = (h.x - dest.left) / dest.width(), y = (h.y - dest.top) / dest.height(), p = stylus ? Math.max(0.05, Math.min(1, h.pressure)) : 0.65;
              this.activeStroke.points.push(new InkPoint(x, y, p));
            }
          }
          this._addInkPoint(e, dest);
        }
        this.invalidate(); return true;
      }
      if ((action === UP || action === CANCEL) && this.stylusDrawing) {
        if (!erase && this.activeStroke) {
          if (action === CANCEL) { if (this.strokes) { const k = this.strokes.indexOf(this.activeStroke); if (k >= 0) this.strokes.splice(k, 1); } }
          else { this._addInkPoint(e, dest); if (this.activeStroke.points.length) this._L('onInkChanged'); }
        }
        this.activeStroke = null; this.stylusDrawing = false; this.invalidate(); return true;
      }
    }
    if (am === DOWN) {
      this._L('onSelectionAdjustStarted');
      this._cancelBeginTextSelection();
      this.startX = this.currentX = this.lastX = e.x; this.startY = this.currentY = this.lastY = e.y; this.gestureMoved = false;
      if (this.selectedTextRegions.length) {
        const first = this.selectedTextRegions[0], last = this.selectedTextRegions[this.selectedTextRegions.length - 1];
        const radius = 22 * DP;
        const leftDistance = Math.hypot(e.x - (dest.left + first.wordBounds.left * dest.width()), e.y - (dest.top + first.wordBounds.bottom * dest.height()));
        const rightDistance = Math.hypot(e.x - (dest.left + last.wordBounds.right * dest.width()), e.y - (dest.top + last.wordBounds.bottom * dest.height()));
        let onWord = false;
        for (const region of this.textRegions) {
          const b = region.wordBounds;
          if (new RectF(dest.left + b.left * dest.width(), dest.top + b.top * dest.height(), dest.left + b.right * dest.width(), dest.top + b.bottom * dest.height()).contains(e.x, e.y)) { onWord = true; break; }
        }
        const left = leftDistance < radius && leftDistance <= rightDistance, right = rightDistance < radius && !left;
        if (!onWord && (left || right)) {
          this.selectionStartRegion = left ? last : first; this.selectionEndRegion = left ? first : last;
          this.selectingText = true; this.selectionCandidate = false; this.bodySwipeCandidate = false; this.panning = false; this.drawing = false; this.scalingOccurred = false;
          return true;
        }
        this.clearTextSelectionOverlay();
      }
      this.startX = this.currentX = e.x; this.startY = this.currentY = e.y; this.lastX = this.startX; this.lastY = this.startY;
      this.gestureMoved = false; this.scalingOccurred = false;
      this.bodySwipeCandidate = this.pageSwipeEnabled && !stylus && !this.directTextSelection && !this.lassoMode && !this.highlightMode && !this.memoMode && !this.outlineMode && !(this.inkMode !== 0 && this.fingerInk) && this.scale <= 1;
      this.drawing = this.highlightMode && dest.contains(this.startX, this.startY);
      this.selectionStartRegion = (!this.drawing && !this.memoMode && !this.outlineMode && this.inkMode === 0) ? this.textRegionAt(this.startX, this.startY, dest) : null;
      this.selectionEndRegion = this.selectionStartRegion; this.selectionCandidate = this.selectionStartRegion != null; this.selectingText = false;
      if (this.selectionCandidate) this._beginTimer = setTimeout(() => this._beginTextSelection(), 420);
      this._cancelBlankPress();
      if (!this.selectionCandidate && !this.drawing && !this.memoMode && !this.outlineMode && this.inkMode === 0 && !this.lassoMode && !this.directTextSelection && !stylus && this.scale <= 1.05 && dest.contains(this.startX, this.startY))
        this._blankTimer = setTimeout(() => this._fireBlankPress(), 650);
      this.panning = this.scale > 1 && !this.outlineMode && !this.selectionCandidate;
      this.invalidate(); return true;
    }
    if (am === POINTER_DOWN) {
      this._cancelBeginTextSelection(); this.selectionCandidate = this.selectingText = false; this.selectedTextRegions.length = 0;
      this.drawing = false; this.panning = false; this.scalingOccurred = true;
      return true;
    }
    if (am === MOVE && this.selectionCandidate && Math.hypot(e.x - this.startX, e.y - this.startY) > this.touchSlop()) {
      if (this.directTextSelection || stylus) { this.beginTextSelectionNow(); this.updateTextSelection(this.nearestTextRegion(e.x, e.y, dest)); return true; }
      this._cancelBeginTextSelection(); this.selectionCandidate = false; this.panning = this.scale > 1;
    }
    if (this.dragging && am === MOVE) {
      this.dragTracker.addMovement(e); this.pageDrag.touchAt(this.pageFraction(e.y));
      const ddx = e.x - this.startX; this.pageDrag.move(Math.max(0, this.dragDirection > 0 ? -ddx : ddx)); return true;
    }
    if (this.bodySwipeCandidate && !this.selectingText && am === MOVE) {
      if (Math.hypot(e.x - this.startX, e.y - this.startY) > this.touchSlop()) {
        this.gestureMoved = true; this._cancelBeginTextSelection(); this.selectionCandidate = false;
        if (this.pageDrag && !this.verticalPageSwipe) {
          const dx = e.x - this.startX, dy = e.y - this.startY;
          if (!this.dragging && Math.abs(dx) > Math.abs(dy) * 1.5) {
            this.dragDirection = dx < 0 ? 1 : -1; this.dragging = !!this.pageDrag.start(this.dragDirection);
            if (this.dragging) { this.pageDrag.touchAt(this.pageFraction(e.y)); this.dragTracker = new VelocityTracker(); }
          }
          if (this.dragging) { this.dragTracker.addMovement(e); this.pageDrag.move(Math.max(0, this.dragDirection > 0 ? -dx : dx)); }
        }
      }
      return true;
    }
    if (this.dragging && (am === UP || am === CANCEL)) {
      this.dragging = false; this.bodySwipeCandidate = false;
      this.dragTracker.addMovement(e); this.dragTracker.computeCurrentVelocity(1000);
      const v = this.dragTracker.getXVelocity() * (this.dragDirection > 0 ? -1 : 1); this.dragTracker.recycle(); this.dragTracker = null;
      this.pageDrag.end(am === CANCEL ? -1e6 : v); return true;
    }
    if (this.bodySwipeCandidate && am === UP) {
      this.bodySwipeCandidate = false;
      if (!this.selectingText && this.gestureMoved) {
        this._cancelBeginTextSelection(); this.selectionCandidate = false;
        const along = this.verticalPageSwipe ? e.y - this.startY : e.x - this.startX, cross = this.verticalPageSwipe ? e.x - this.startX : e.y - this.startY;
        if (Math.abs(along) >= this.swipeDistance() && Math.abs(along) > Math.abs(cross) * 1.5 && e.time - this.edgeStartTime <= 1200) this._L('onPageSwipe', along < 0 ? 1 : -1);
        return true;
      }
    }
    if (am === MOVE && this.selectingText) {
      this.currentX = e.x; this.currentY = e.y; this.updateTextSelection(this.nearestTextRegion(this.currentX, this.currentY, dest)); return true;
    }
    if (am === POINTER_UP && this.scale > 1) {
      const remaining = e.actionIndex === 0 ? 1 : 0;
      if (remaining < e.pointerCount) {
        this.lastX = e.getX(remaining); this.lastY = e.getY(remaining); this.startX = this.lastX; this.startY = this.lastY; this.panning = true; this.gestureMoved = false;
      }
      return true;
    }
    if (am === MOVE && this.drawing) { this.currentX = e.x; this.currentY = e.y; this.invalidate(); return true; }
    if (am === MOVE && this.panning && e.pointerCount === 1) {
      if (!this.gestureMoved && Math.hypot(e.x - this.startX, e.y - this.startY) <= this.touchSlop()) return true;
      const dx = e.x - this.lastX, dy = e.y - this.lastY;
      this.panX += dx * 0.8; this.panY += dy * 0.8;
      this.lastX = e.x; this.lastY = e.y;
      if (Math.hypot(e.x - this.startX, e.y - this.startY) > this.touchSlop()) this.gestureMoved = true;
      this.clampPan(); this.invalidate(); return true;
    }
    if (am === UP) {
      this._cancelBeginTextSelection();
      if (this.selectingText) {
        this.updateTextSelection(this.nearestTextRegion(e.x, e.y, dest)); const sel = this.finishTextSelection(); this.selectingText = this.selectionCandidate = false;
        if (sel) { this._L('onTextSelectionFinished', sel, e.x, e.y); return true; }
      }
      if (this.selectionCandidate && this.selectionStartRegion && (this.directTextSelection || stylus)) {
        this.selectedTextRegions.length = 0; this.selectedTextRegions.push(this.selectionStartRegion);
        const sel = this.finishTextSelection(); this.selectionCandidate = false;
        this._L('onTextSelectionFinished', sel, e.x, e.y); this.invalidate(); return true;
      }
      this.selectionCandidate = false;
      if (this.panning && this.gestureMoved) { this.panning = false; return true; }
      if (this.scalingOccurred) { this.panning = false; return true; }
      if (Math.hypot(e.x - this.startX, e.y - this.startY) < 20) {
        for (const [n, b] of Array.from(this.noteHitBoxes).reverse()) if (b && b.contains(e.x, e.y)) { this._L('onTranslationTapped', n); return true; }
        for (const [m, b] of Array.from(this.memoHitBoxes).reverse()) if (b && b.contains(e.x, e.y)) { this._L('onMarkTapped', m); return true; }
      }
      if (this.drawing) {
        this.currentX = Math.max(dest.left, Math.min(dest.right, e.x)); this.currentY = Math.max(dest.top, Math.min(dest.bottom, e.y));
        if (Math.abs(this.currentX - this.startX) > 12) {
          const m = new Mark(); m.page = this.page;
          m.left = (Math.min(this.startX, this.currentX) - dest.left) / dest.width(); m.right = (Math.max(this.startX, this.currentX) - dest.left) / dest.width();
          const centerY = (this.startY + this.currentY) / 2, half = this.highlightHeight(dest) / 2;
          m.top = (Math.max(dest.top, centerY - half) - dest.top) / dest.height(); m.bottom = (Math.min(dest.bottom, centerY + half) - dest.top) / dest.height();
          m.color = this.highlightColor; this._L('onHighlightCreated', m);
        }
        this.drawing = false; this.invalidate(); return true;
      }
      if (Math.hypot(e.x - this.startX, e.y - this.startY) < 20 && this.memoMode && dest.contains(e.x, e.y)) {
        this._L('onMemoPointRequested', this.page, (e.x - dest.left) / dest.width(), (e.y - dest.top) / dest.height()); return true;
      }
      if (Math.hypot(e.x - this.startX, e.y - this.startY) < 20 && this.outlineMode && dest.contains(e.x, e.y)) {
        this._L('onOutlinePointRequested', this.page, (e.x - dest.left) / dest.width(), (e.y - dest.top) / dest.height()); return true;
      }
      if (Math.hypot(e.x - this.startX, e.y - this.startY) < 20 && this.marks) {
        const nx = (e.x - dest.left) / dest.width(), ny = (e.y - dest.top) / dest.height();
        if (this.annotationStore) for (let i = this.annotationStore.elements.length - 1; i >= 0; i--) {
          const el = this.annotationStore.elements[i];
          if (el.page === this.page && nx >= el.left && nx <= el.right && ny >= el.top && ny <= el.bottom) {
            if (PdfPageView.selectable(el)) { if (el === this._selectedElement) this._L('onElementTapped', el); else { this._selectedElement = el; this.invalidate(); } }
            else this._L('onElementTapped', el);
            return true;
          }
        }
        for (let i = this.marks.length - 1; i >= 0; i--) {
          const m = this.marks[i];
          if (m.page === this.page && nx >= m.left && nx <= m.right && ny >= m.top && ny <= m.bottom) { this._L('onMarkTapped', m); return true; }
        }
      }
    }
    if (am === CANCEL) { this.edgeSwipe = this.bodySwipeCandidate = false; this.clearTextSelectionOverlay(); }
    return true;
  }
}

export default PdfPageView;
