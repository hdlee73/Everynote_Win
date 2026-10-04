// PageCurlView port (Java -> Canvas2D) + page-turn controller helpers.
// Bitmaps are HTMLCanvasElement / OffscreenCanvas / ImageBitmap. Leaf bitmaps are stretched to the leaf area (width - spine, height)
// in CSS px, so their pixel size may be any multiple of it (e.g. device-pixel-ratio snapshots).

const rgba = (argb) => `rgba(${(argb >>> 16) & 255},${(argb >>> 8) & 255},${argb & 255},${(((argb >>> 24) & 255) / 255).toFixed(4)})`;
const mkCanvas = (w, h) => (typeof document !== 'undefined')
  ? Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) })
  : new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));

/** Half-plane {sign * n.(P-M) >= 0} as a big quad. */
function halfPlane(mx, my, nx, ny, tx, ty, big, sign) {
  const ax = nx * sign * big, ay = ny * sign * big, p = new Path2D();
  p.moveTo(mx + tx * big, my + ty * big); p.lineTo(mx - tx * big, my - ty * big);
  p.lineTo(mx - tx * big + ax, my - ty * big + ay); p.lineTo(mx + tx * big + ax, my + ty * big + ay); p.closePath();
  return p;
}
/** Gradient band between offsets a..b along the normal (positive = finger side). */
function band(ctx, mx, my, nx, ny, tx, ty, big, a, b, ca, cb) {
  const p = new Path2D();
  p.moveTo(mx + tx * big + nx * a, my + ty * big + ny * a); p.lineTo(mx - tx * big + nx * a, my - ty * big + ny * a);
  p.lineTo(mx - tx * big + nx * b, my - ty * big + ny * b); p.lineTo(mx + tx * big + nx * b, my + ty * big + ny * b); p.closePath();
  const g = ctx.createLinearGradient(mx + nx * a, my + ny * a, mx + nx * b, my + ny * b);
  g.addColorStop(0, rgba(ca)); g.addColorStop(1, rgba(cb));
  ctx.fillStyle = g; ctx.fill(p);
}
/** The leaf rectangle cut by the fold, keeping the corner side (n.(P-M) <= 0); Sutherland-Hodgman. */
function clipRectByHalfPlane(s, w, h, mx, my, nx, ny) {
  const inn = [[s, 0], [w, 0], [w, h], [s, h]], out = [];
  for (let i = 0; i < 4; i++) {
    const a = inn[i], b = inn[(i + 1) % 4];
    const da = nx * (a[0] - mx) + ny * (a[1] - my), db = nx * (b[0] - mx) + ny * (b[1] - my);
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) { const u = da / (da - db); out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]); }
  }
  return out;
}

export class PageCurlView {
  /** Tint laid over the mirrored page to make the back of the leaf (white on light pages, black on dark ones). ARGB int. */
  static backTint = 0x00FFFFFF;

  constructor() {
    this.el = document.createElement('canvas');
    this.el.className = 'page-curl';
    this.el.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;';
    this.ctx = this.el.getContext('2d');
    this.fixedHalf = this.under = this.front = this.back = null;
    this.mirrored = false; this.spine = 0; this._progress = 0; this._touch = .88; this._touched = false; this._grabBottom = true;
    this.width = 0; this.height = 0; this._dpr = 1; this._raf = 0; this._released = false;
    // keep the backing store in sync with the CSS box
    this._ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    if (this._ro) this._ro.observe(this.el);
  }

  /** fixedHalf: page left of the spine that stays put (null for single-page turns); the other bitmaps cover the leaf area. */
  setup(fixedHalf, under, front, back, mirrored, spineFraction) {
    this.fixedHalf = fixedHalf; this.under = under; this.front = front; this.back = back;
    this.mirrored = !!mirrored; this.spine = spineFraction || 0;
    this._touched = false; this._touch = .88;   // Android v1.29.0: the grabbed corner is latched on first touch
    this.invalidate();
  }
  setProgress(value) { this._progress = Math.max(0, Math.min(1, value)); this.invalidate(); }
  progress() { return this._progress; }
  /** The corner (top / bottom) is latched when the finger first lands; afterwards only the finger height changes the fold angle. */
  setTouch(fraction) {
    const v = Math.max(0, Math.min(1, fraction));
    if (!this._touched) { this._touched = true; this._grabBottom = v > .5; }
    if (v !== this._touch) { this._touch = v; this.invalidate(); }
  }
  get touch() { return this._touch; }

  release() {
    for (const b of [this.fixedHalf, this.under, this.front, this.back]) { try { if (b && typeof b.close === 'function') b.close(); } catch (e) {} }
    this.fixedHalf = this.under = this.front = this.back = null;
    this._released = true;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    this.el.remove();
  }

  /** Sizes the backing store to the CSS box (devicePixelRatio aware); sets width/height (CSS px). */
  resize() {
    const r = this.el.getBoundingClientRect();
    const w = this.el.clientWidth || r.width, h = this.el.clientHeight || r.height;
    const dpr = window.devicePixelRatio || 1;
    this.width = w; this.height = h; this._dpr = dpr;
    const bw = Math.max(1, Math.round(w * dpr)), bh = Math.max(1, Math.round(h * dpr));
    if (this.el.width !== bw || this.el.height !== bh) { this.el.width = bw; this.el.height = bh; }
    this.invalidate();
  }

  invalidate() {
    if (this._raf || this._released) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); });
  }

  /** Synchronous redraw (also used by tests). */
  draw() {
    if (this._released) return;
    if (!this.width || !this.height) this.resize2();
    const ctx = this.ctx, d = this._dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.el.width, this.el.height);
    ctx.setTransform(d, 0, 0, d, 0, 0);
    this.onDraw(ctx, this.width, this.height);
  }
  resize2() { // size without scheduling a redraw
    const w = this.el.clientWidth, h = this.el.clientHeight, dpr = window.devicePixelRatio || 1;
    this.width = w; this.height = h; this._dpr = dpr;
    const bw = Math.max(1, Math.round(w * dpr)), bh = Math.max(1, Math.round(h * dpr));
    if (this.el.width !== bw || this.el.height !== bh) { this.el.width = bw; this.el.height = bh; }
  }

  onDraw(ctx, w, h) {
    const { fixedHalf, under, front, back } = this;
    if (!front || !under || !back || w <= 0 || h <= 0) return;
    const s = this.spine * w, lw = w - s, t = this._progress;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.save();
    if (this.mirrored) { ctx.translate(w / 2, 0); ctx.scale(-1, 1); ctx.translate(-w / 2, 0); }
    if (fixedHalf) ctx.drawImage(fixedHalf, 0, 0, s, h);
    ctx.drawImage(under, s, 0, lw, h);
    if (t <= 0.004) ctx.drawImage(front, s, 0, lw, h);
    else if (t < 0.995) this.drawFold(ctx, s, w, h, lw, t);
    ctx.restore();
  }

  /** The turning leaf: the grabbed corner C goes to the finger point G, the fold is their perpendicular bisector. */
  drawFold(ctx, s, w, h, lw, t) {
    const { front, back } = this;
    const touched = !!this._touched, cy = (touched ? this._grabBottom : this._touch > .5) ? h : 0, dir = cy > 0 ? -1 : 1;
    const dx = 2.04 * lw * Math.pow(t, 1.2);
    let dy = dx * .38 * Math.pow(1 - t, 1.2) * (h / Math.max(1, lw));
    if (touched) {   // follow the finger: the higher it is lifted from the grabbed corner, the steeper the fold tilts
      let rise = Math.max(0, cy > 0 ? cy - this._touch * h : this._touch * h);
      rise = Math.min(rise, Math.max(dx, .1 * w) * 2.6);
      dy = Math.max(dy * .3, rise * (1 - .45 * t));
    }
    const gx = w - dx, gy = cy + dir * dy;
    let nx = gx - w, ny = gy - cy; const len = Math.hypot(nx, ny); nx /= len; ny /= len;
    const mx = (w + gx) / 2, my = (cy + gy) / 2, tx = -ny, ty2 = nx, big = 4 * (w + h);
    const k = 2 * (nx * mx + ny * my);
    const R = { a: 1 - 2 * nx * nx, b: -2 * nx * ny, c: -2 * nx * ny, d: 1 - 2 * ny * ny, e: k * nx, f: k * ny };
    const leafRect = () => { const p = new Path2D(); p.rect(s, 0, w - s, h); return p; };
    // 1) the part of the leaf not turned yet (finger side)
    ctx.save(); ctx.clip(leafRect()); ctx.clip(halfPlane(mx, my, nx, ny, tx, ty2, big, 1));
    ctx.drawImage(front, s, 0, lw, h); ctx.restore();
    // 2) soft shadow on the page being uncovered
    const reach = lw * .10;
    ctx.save(); ctx.clip(leafRect()); ctx.clip(halfPlane(mx, my, nx, ny, tx, ty2, big, -1));
    band(ctx, mx, my, nx, ny, tx, ty2, big, -reach, 0, 0x00000000, 0x4A000000); ctx.restore();
    // 3) back of the turned part, mirrored across the fold (clips evaluated in the reflected frame)
    ctx.save(); ctx.transform(R.a, R.b, R.c, R.d, R.e, R.f);
    ctx.clip(leafRect()); ctx.clip(halfPlane(mx, my, nx, ny, tx, ty2, big, -1));
    ctx.drawImage(back, s, 0, lw, h); ctx.restore();
    // flap outline = leaf rect cut to the corner side, reflected
    const poly = clipRectByHalfPlane(s, w, h, mx, my, nx, ny);
    const flap = new Path2D(); let first = true;
    for (const p of poly) {
      const qx = R.a * p[0] + R.c * p[1] + R.e, qy = R.b * p[0] + R.d * p[1] + R.f;
      if (first) { flap.moveTo(qx, qy); first = false; } else flap.lineTo(qx, qy);
    }
    if (!first) {
      flap.closePath();
      ctx.save(); ctx.clip(flap);
      band(ctx, mx, my, nx, ny, tx, ty2, big, 0, lw * .07, 0x3C000000, 0x00000000);
      ctx.restore();
      ctx.lineWidth = 1; ctx.strokeStyle = rgba(0x22000000); ctx.stroke(flap);
    }
  }

  /** Horizontally flipped copy. */
  static mirror(source) {
    const c = mkCanvas(source.width, source.height), g = c.getContext('2d');
    g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(source, 0, 0);
    return c;
  }
  /** Copy of `front` with backTint laid over it (SRC_OVER). */
  static paperBack(front) {
    const c = mkCanvas(front.width, front.height), g = c.getContext('2d');
    g.drawImage(front, 0, 0);
    g.fillStyle = rgba(PageCurlView.backTint); g.fillRect(0, 0, c.width, c.height);
    return c;
  }
}
export const mirror = PageCurlView.mirror;
export const paperBack = PageCurlView.paperBack;
export default PageCurlView;

// ---------------------------------------------------------------- page-turn controller helpers
/** Copy of a rectangle of `canvas` (source pixel coordinates) as a new canvas of size w x h. */
export function snapshotSlice(canvas, x, y, w, h) {
  x = Math.round(x); y = Math.round(y); w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  const c = mkCanvas(w, h);
  c.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return c;
}
/** ms: max(200, round(1000*|to-from|)). */
export function curlDuration(from, to) { return Math.max(200, Math.round(1000 * Math.abs(to - from))); }
/** Fling/release decision; velocity in px/s along the turn direction, progress 0..1. */
export function commitDecision(velocity, progress) { return velocity > 700 || (velocity > -700 && progress > .4); }

const accelDecel = (x) => Math.cos((x + 1) * Math.PI) / 2 + .5;     // android AccelerateDecelerateInterpolator
const decel = (x) => 1 - (1 - x) * (1 - x);                         // android DecelerateInterpolator(1)
/**
 * Animates curl progress from -> to. Ease-in-out when from==0 else decelerate. Returns {cancel()}; onDone() fires at the end
 * (not when cancelled).
 */
export function animateCurl(curl, from, to, onDone) {
  const dur = curlDuration(from, to), ease = from === 0 ? accelDecel : decel;
  let start = 0, raf = 0, dead = false;
  const step = (now) => {
    if (dead) return;
    if (!start) start = now;
    const f = Math.min(1, (now - start) / dur);
    curl.setProgress(from + (to - from) * ease(f));
    if (f < 1) raf = requestAnimationFrame(step);
    else { curl.setProgress(to); if (onDone) onDone(); }
  };
  curl.setProgress(from);
  raf = requestAnimationFrame(step);
  return { cancel() { dead = true; cancelAnimationFrame(raf); } };
}
