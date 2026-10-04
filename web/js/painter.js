// Port of AnnotationPainter.java (+ the Typeface mapping). Java Canvas/Paint -> CanvasRenderingContext2D.
// Static method names / argument order follow Java. The Android `Context` first argument of elements()/all() is
// dropped, but a leading non-canvas argument (null / context object) is tolerated and ignored.
import { RectF, argb } from './util.js';
import { Shapes } from './shapes.js';
import { AnnotationStore } from './store.js';

const SANS = '"Segoe UI","Malgun Gothic","Noto Sans KR",sans-serif';
const FAMILIES = {
  sans: SANS,
  serif: '"Noto Serif KR","Noto Serif","Batang","Times New Roman",serif',
  mono: '"D2Coding","Consolas","Malgun Gothic","Noto Sans Mono",monospace',
  hand: '"Ink Free","Segoe Script","Nanum Pen Script","Malgun Gothic",cursive',
};
const EMOJI = '"Segoe UI Emoji","Noto Color Emoji","Apple Color Emoji","Segoe UI","Malgun Gothic",sans-serif';

/** android.graphics.Typeface stand-in: family + BOLD(1)/ITALIC(2) style flags. */
export class Typeface {
  static NORMAL = 0; static BOLD = 1; static ITALIC = 2; static BOLD_ITALIC = 3;
  constructor(family, style = 0) { this.family = family; this.style = style; }
  getStyle() { return this.style; }
  /** CSS font shorthand for a size in px. forceBold emulates Paint.setFakeBoldText. */
  css(size, forceBold = false) {
    return `${this.style & 2 ? 'italic ' : ''}${(this.style & 1) || forceBold ? 'bold ' : ''}${size}px ${this.family}`;
  }
  /** Android-style FontMetrics {ascent (negative), descent} for this face at `size` px. */
  metrics(c, size) {
    c.save(); c.font = this.css(size);
    const m = c.measureText('M');
    c.restore();
    const asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent;
    if (asc == null) return { ascent: -size * .93, descent: size * .24 };
    return { ascent: -asc, descent: desc };
  }
}
Typeface.DEFAULT = new Typeface(SANS, 0);
Typeface.SANS_SERIF = Typeface.DEFAULT;

const isHigh = u => u >= 0xD800 && u <= 0xDBFF, isLow = u => u >= 0xDC00 && u <= 0xDFFF;

// ---- text measuring (fitHeight needs a context even without a visible canvas) --------------------------------
let measureCtx = null;
function getMeasureCtx() {
  if (measureCtx) return measureCtx;
  try {
    if (typeof OffscreenCanvas !== 'undefined') measureCtx = new OffscreenCanvas(4, 4).getContext('2d');
    else if (typeof document !== 'undefined') measureCtx = document.createElement('canvas').getContext('2d');
  } catch (e) { /* no canvas (node) */ }
  return measureCtx;
}
/** Rough stand-in used only when no canvas exists (node unit tests): CJK = 1em, other = .55em. */
function fallbackMeasure(s, size) {
  let w = 0;
  for (const ch of s) w += (ch.codePointAt(0) >= 0x1100 ? 1 : .55) * size;
  return w;
}

/** Paint.breakText(text, true, maxWidth, null): number of UTF-16 units of the longest prefix that fits (>=1 here). */
function breakCount(measure, s, maxW) {
  if (measure(s) <= maxW) return s.length;
  let lo = 0, hi = s.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (measure(s.substring(0, mid)) <= maxW) lo = mid; else hi = mid - 1; }
  if (lo > 0 && lo < s.length && isHigh(s.charCodeAt(lo - 1)) && isLow(s.charCodeAt(lo))) lo--;
  let n = Math.max(1, lo);
  if (n === 1 && s.length > 1 && isHigh(s.charCodeAt(0)) && isLow(s.charCodeAt(1))) n = 2;
  return n;
}

// ---- image cache (Java: LruCache<String,Bitmap> of 12 MB keyed by file) -------------------------------------
const LIMIT = 96 * 1024 * 1024;
const images = new Map();          // asset name -> {bmp, bytes}  (insertion order = LRU order)
const loading = new Map();         // asset name -> Promise
const failed = new Set();
let imageBytes = 0;
const imageListeners = new Set();

function putImage(name, bmp) {
  const bytes = (bmp.width || 1) * (bmp.height || 1) * 4;
  const old = images.get(name); if (old) imageBytes -= old.bytes;
  images.set(name, { bmp, bytes }); imageBytes += bytes;
  for (const [k, v] of images) { if (imageBytes <= LIMIT || k === name) break; images.delete(k); imageBytes -= v.bytes; try { v.bmp.close?.(); } catch (e) { /* */ } }
}

export class AnnotationPainter {
  /** The text box being edited in place; it is drawn by the editor instead of the page. */
  static skip = null;
  /** True while a page is drawn on a dark paper: dark ink and text are lightened so they stay readable. */
  static dark = false;

  // ------------------------------------------------------------------------------------------ images
  /** Listener called (no args) whenever an asset image finishes loading so the page can redraw. Returns unsubscribe fn. */
  static addImageListener(fn) { imageListeners.add(fn); return () => imageListeners.delete(fn); }
  /** Convenience single callback property (pageview may just assign it). */
  static onImageLoaded = null;

  /** Synchronous lookup; starts an async load if the bitmap is not cached yet (then listeners fire). null if unavailable. */
  static image(name) {
    if (!name) return null;
    const hit = images.get(name);
    if (hit) { images.delete(name); images.set(name, hit); return hit.bmp; }
    if (!failed.has(name)) AnnotationPainter.loadImage(name).catch(() => {});
    return null;
  }
  /** Async load into the cache (dedupes). Resolves to ImageBitmap or null. */
  static loadImage(name) {
    const hit = images.get(name);
    if (hit) return Promise.resolve(hit.bmp);
    if (loading.has(name)) return loading.get(name);
    const p = (async () => {
      try {
        const url = await AnnotationStore.assetUrl(name);
        const blob = await (await fetch(url)).blob();
        const bmp = await createImageBitmap(blob);
        putImage(name, bmp); failed.delete(name);
        for (const f of [...imageListeners, AnnotationPainter.onImageLoaded]) { try { f && f(name); } catch (e) { console.error(e); } }
        return bmp;
      } catch (e) { failed.add(name); return null; }
      finally { loading.delete(name); }
    })();
    loading.set(name, p);
    return p;
  }
  /** Forget a cached/failed asset (after it is replaced or deleted). */
  static forgetImage(name) {
    const v = images.get(name); if (v) { imageBytes -= v.bytes; images.delete(name); try { v.bmp.close?.(); } catch (e) { /* */ } }
    failed.delete(name);
  }
  /** Await every image asset referenced on `page` (all pages if page == null); use before export/thumbnail rendering. */
  static async preload(store, page = null) {
    if (!store) return;
    const names = new Set();
    for (const e of store.elements) {
      if (page != null && e.page !== page) continue;
      if (e.kind === 'image' || e.kind === 'video' || e.kind === 'youtube') if (e.asset) names.add(e.asset);
    }
    await Promise.all([...names].map(n => AnnotationPainter.loadImage(n)));
  }

  // ------------------------------------------------------------------------------------------ fonts
  /** Maps a stored font id (sans, serif, mono, hand) plus style flags to a Typeface. */
  static typeface(font, bold, italic) {
    const style = (bold ? Typeface.BOLD : 0) | (italic ? Typeface.ITALIC : 0);
    return new Typeface(FAMILIES[font] || FAMILIES.sans, style);
  }

  // ------------------------------------------------------------------------------------------ text
  /**
   * Text layout shared by the page painter, fitHeight(), the check-box hit test and the inline editor (v3).
   * measure(s) -> width px of s in the box's font. opts: {align:'left'|'center'|'right', list:'none'|'bullet'|'number'|'check'}.
   * Returns {markerW, textW, pitch, lines:[{para, first, text, x, y}], height}; x = offset of the line's left edge from the box
   * left, y = baseline offset from the box top. Wrapping is character based (breakText), pitch size*1.35, first baseline at size.
   * List kinds reserve a marker column of 1.6*size (2.1*size for number lists of 10+ lines) on the left; the marker sits on the
   * first line of each '\n'-separated line ("paragraph"); wrapped continuation lines are indented by the column.
   * Alignment applies to the text area (box minus marker column); trailing blanks are ignored when centring/right-aligning.
   */
  static layoutText(measure, text, widthPx, size, opts = {}) {
    const list = opts.list || 'none', align = opts.align || 'left';
    const paragraphs = String(text ?? '').split('\n');
    const markerW = list === 'none' ? 0 : (list === 'number' && paragraphs.length >= 10 ? 2.1 : 1.6) * size;
    const textW = Math.max(size, widthPx - markerW), pitch = size * 1.35;
    const lines = []; let y = size;
    paragraphs.forEach((para, pi) => {
      let remaining = para, first = true;
      if (remaining === '') { lines.push({ para: pi, first: true, text: '', x: markerW, y, w: 0 }); y += pitch; return; }
      while (remaining.length) {
        const n = breakCount(measure, remaining, textW), seg = remaining.substring(0, n);
        const w = measure(seg.replace(/[ \t]+$/, ''));
        let x = markerW;
        if (align === 'center') x = markerW + (textW - w) / 2; else if (align === 'right') x = markerW + textW - w;
        lines.push({ para: pi, first, text: seg, x: Math.max(markerW > 0 ? markerW : -Infinity, x), y, w });
        y += pitch; remaining = remaining.substring(n); first = false;
      }
    });
    return { markerW, textW, pitch, lines, height: lines.length ? y - pitch + size * .35 : 0 };
  }

  /** The text(c, text, box, size, color, face) of Java plus the v3 formatting: opts {align, underline, list, checked[]}. */
  static textBlock(c, text, box, size, color, face = Typeface.DEFAULT, opts = {}) {
    box = RectF.from(box);
    c.save();
    try {
      c.beginPath(); c.rect(box.left, box.top, box.width(), box.height()); c.clip();
      c.font = face.css(size); c.fillStyle = argb(color); c.textAlign = 'left'; c.textBaseline = 'alphabetic';
      const L = AnnotationPainter.layoutText(s => c.measureText(s).width, text, box.width(), size, opts);
      const list = opts.list || 'none', checked = opts.checked || [];
      const css = argb(color), lum = .299 * ((color >>> 16) & 255) + .587 * ((color >>> 8) & 255) + .114 * (color & 255);
      let num = 0;
      for (const ln of L.lines) {
        const done = list === 'check' && !!checked[ln.para];
        const x = box.left + ln.x, y = box.top + ln.y;
        c.globalAlpha = done ? .5 : 1;
        if (ln.text !== '') c.fillText(ln.text, x, y);
        if (opts.underline && ln.w > 0) {
          c.fillRect(x, y + size * .12, ln.w, Math.max(1, size * .065));
        }
        if (ln.first && list !== 'none') {
          const mr = box.left + L.markerW - size * .35;       // right edge of the marker
          c.globalAlpha = 1;
          if (list === 'bullet') { c.beginPath(); c.arc(mr - size * .1, y - size * .33, size * .13, 0, Math.PI * 2); c.fill(); }
          else if (list === 'number') { c.textAlign = 'right'; c.fillText((ln.para + 1) + '.', mr, y); c.textAlign = 'left'; }
          else AnnotationPainter._checkBox(c, mr, y, size, css, done, lum > 150 ? '#1C1C1E' : '#fff');
        }
      }
    } finally { c.restore(); }
  }
  /** Check box of a check-list line: right edge mr, text baseline y. Geometry = checkBoxRect(). */
  static _checkBox(c, mr, y, size, css, done, mark = '#fff') {
    const r = AnnotationPainter.checkBoxRect(mr, y, size), rad = size * .14;
    c.save();
    c.lineWidth = Math.max(1, size * .08); c.strokeStyle = css; c.fillStyle = css;
    AnnotationPainter._roundRect(c, new RectF(r.left, r.top, r.right, r.bottom), rad, rad);
    if (done) { c.fill(); c.strokeStyle = mark; c.lineWidth = Math.max(1.2, size * .1); c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath(); c.moveTo(r.left + r.width() * .22, r.top + r.height() * .52); c.lineTo(r.left + r.width() * .43, r.top + r.height() * .72); c.lineTo(r.left + r.width() * .78, r.top + r.height() * .28); c.stroke(); }
    else c.stroke();
    c.restore();
  }
  /** Square of 0.8*size whose right edge is mr and whose bottom is 0.03*size under the baseline y. */
  static checkBoxRect(mr, y, size) { const s = size * .8; return new RectF(mr - s, y + size * .03 - s, mr, y + size * .03); }

  /** text(c, text, box, size, color[, face]) - wrapped, clipped text. First baseline at box.top+size, pitch size*1.35. */
  static text(c, text, box, size, color, face = Typeface.DEFAULT) { AnnotationPainter.textBlock(c, text, box, size, color, face); }

  /** The text-formatting options of a typing box ({align, underline, list, checked}). */
  static textOpts(e) { return { align: e.align || 'left', underline: !!e.underline, list: e.list || 'none', checked: e.checked || [] }; }

  /** Page-px rectangles of the check boxes of a check-list typing box ([{index, rect}]; index = '\n' line). d = page rect px. */
  static checkBoxes(d0, e) {
    if (e.kind !== 'text' || e.list !== 'check') return [];
    const d = RectF.from(d0), b = AnnotationPainter.box(d, e), size = Math.max(9, d.width() * e.textSize);
    const face = AnnotationPainter.typeface(e.font, e.bold, e.italic), ctx = getMeasureCtx();
    let measure; if (ctx) { ctx.font = face.css(size); measure = s => ctx.measureText(s).width; } else measure = s => fallbackMeasure(s, size);
    const L = AnnotationPainter.layoutText(measure, e.text, b.width(), size, AnnotationPainter.textOpts(e)), out = [];
    for (const ln of L.lines) if (ln.first && ln.y - size < b.height()) {
      const r = AnnotationPainter.checkBoxRect(b.left + L.markerW - size * .35, b.top + ln.y, size);
      out.push({ index: ln.para, rect: r });
    }
    return out;
  }

  /**
   * Height (fraction of the page height) a typing box needs so none of its text is clipped. Same wrapping as text().
   * pageAspect = page height / page width. list = 'none'|'bullet'|'number'|'check' (marker column narrows the text area).
   */
  static fitHeight(text, widthFraction, sizeFraction, pageAspect, face = Typeface.DEFAULT, list = 'none') {
    const pageWidth = 1000;
    const size = Math.max(1, sizeFraction * pageWidth);
    const ctx = getMeasureCtx();
    let measure;
    if (ctx) { ctx.font = face.css(size); measure = s => ctx.measureText(s).width; } else measure = s => fallbackMeasure(s, size);
    const boxWidth = Math.max(size, widthFraction * pageWidth);
    const lines = AnnotationPainter.layoutText(measure, text, boxWidth, size, { list }).lines.length;
    const heightPx = size * (1.35 * Math.max(1, lines) + .15);
    return heightPx / (pageWidth * Math.max(.1, pageAspect));
  }

  /** TextUtils.ellipsize(text, paint, avail, END) with the font already set on c. */
  static ellipsize(c, s, avail) {
    const measure = x => c.measureText(x).width;
    if (measure(s) <= avail) return s;
    const room = avail - measure('…');
    if (room < 0) return '';
    let lo = 0, hi = s.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (measure(s.substring(0, mid)) <= room) lo = mid; else hi = mid - 1; }
    if (lo > 0 && lo < s.length && isHigh(s.charCodeAt(lo - 1))) lo--;
    return s.substring(0, lo) + '…';
  }

  /** Element box in pixels. dest: RectF of the page in px. */
  static box(dest, e) {
    const w = dest.right - dest.left, h = dest.bottom - dest.top;
    return new RectF(dest.left + e.left * w, dest.top + e.top * h, dest.left + e.right * w, dest.top + e.bottom * h);
  }

  static lastOfGroup(store, e) {
    let after = false;
    for (const o of store.elements) {
      if (o === e) { after = true; continue; }
      if (after && o.kind === 'hyperlink' && o.page === e.page && o.color === e.color && o.text === e.text) return false;
    }
    return true;
  }

  /** Lightens dark ink on a dark page (no-op unless AnnotationPainter.dark). */
  static adj(color) {
    if (!AnnotationPainter.dark) return color;
    const a = (color >>> 24) & 255, r = (color >>> 16) & 255, g = (color >>> 8) & 255, b = color & 255;
    const f = Math.fround;
    if (f(f(f(.299) * r) + f(f(.587) * g)) + f(f(.114) * b) > 120) return color;
    const lift = v => v + Math.trunc(f((255 - v) * f(.88)));
    return ((a << 24) | (lift(r) << 16) | (lift(g) << 8) | lift(b)) | 0;
  }

  // ------------------------------------------------------------------------------------------ elements
  /** elements(c, d, store, page) - page elements of one page. d: RectF page rect in px. */
  static elements(...args) {
    if (args.length && !(args[0] && typeof args[0].save === 'function')) args.shift(); // Java Context arg
    const [c, d0, store, page] = args;
    if (!store) return;
    const d = RectF.from(d0), dw = d.width();
    c.save();
    try {
      for (const e of store.elements) {
        if (e.page !== page || e === AnnotationPainter.skip) continue;
        const b = AnnotationPainter.box(d, e);
        c.save();
        if (e.rot && AnnotationPainter.rotates(e)) AnnotationPainter.rotateAround(c, e.rot, b.centerX(), b.centerY());
        try { AnnotationPainter._element(c, d, dw, store, e, b); } finally { c.restore(); }
      }
    } finally { c.restore(); }
  }

  /** Elements that can be turned around their centre. */
  static rotates(e) { return e.kind === 'image' || e.kind === 'sticker' || e.kind === 'shape' || e.kind === 'table'; }
  /** Canvas.rotate(degrees, px, py): clockwise rotation around a pivot. */
  static rotateAround(c, deg, px, py) { c.translate(px, py); c.rotate(deg * Math.PI / 180); c.translate(-px, -py); }

  static _roundRect(c, b, rx, ry) {
    const w = b.width(), h = b.height(), k = Math.min(1, w / (2 * rx || 1), h / (2 * ry || 1));
    rx *= k; ry *= k;
    const x = b.left, y = b.top;
    c.beginPath();
    c.moveTo(x + rx, y); c.lineTo(x + w - rx, y); c.ellipse(x + w - rx, y + ry, rx, ry, 0, -Math.PI / 2, 0);
    c.lineTo(x + w, y + h - ry); c.ellipse(x + w - rx, y + h - ry, rx, ry, 0, 0, Math.PI / 2);
    c.lineTo(x + rx, y + h); c.ellipse(x + rx, y + h - ry, rx, ry, 0, Math.PI / 2, Math.PI);
    c.lineTo(x, y + ry); c.ellipse(x + rx, y + ry, rx, ry, 0, Math.PI, Math.PI * 1.5);
    c.closePath();
  }

  static _element(c, d, dw, store, e, b) {
    const kind = e.kind;
    if (kind === 'image') {
      const image = AnnotationPainter.image(e.asset);
      if (image) {
        const scale = Math.min(b.width() / image.width, b.height() / image.height);
        const fw = image.width * scale, fh = image.height * scale;
        c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
        c.drawImage(image, b.centerX() - fw / 2, b.centerY() - fh / 2, fw, fh);
      }
    } else if (kind === 'sticker') {
      const size = Math.min(b.width(), b.height()) * .82;
      c.font = `${size}px ${EMOJI}`; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = '#000';
      const m = c.measureText(e.text);
      const asc = m.fontBoundingBoxAscent ?? size * .93, desc = m.fontBoundingBoxDescent ?? size * .24;
      c.fillText(e.text, b.centerX(), b.centerY() - (-asc + desc) / 2);
    } else if (kind === 'video' || kind === 'youtube') {
      const frame = AnnotationPainter.image(e.asset);
      if (frame) { c.imageSmoothingEnabled = true; c.drawImage(frame, b.left, b.top, b.width(), b.height()); }
      else { c.fillStyle = argb(0xFF2C2C2E); AnnotationPainter._roundRect(c, b, b.width() * .03, b.width() * .03); c.fill(); }
      c.fillStyle = argb(0x55000000); c.fillRect(b.left, b.top, b.width(), b.height());
      let r = Math.min(b.width(), b.height()) * .17;
      const yt = kind === 'youtube', cx = b.centerX(), cy = b.centerY();
      if (yt) {
        r *= 1.15; c.fillStyle = argb(0xFFFF0000);
        AnnotationPainter._roundRect(c, new RectF(cx - r * 1.25, cy - r * .88, cx + r * 1.25, cy + r * .88), r * .5, r * .5); c.fill();
      } else { c.fillStyle = argb(0xE6FFFFFF); c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill(); }
      c.beginPath(); c.moveTo(cx - r * .32, cy - r * .5); c.lineTo(cx - r * .32, cy + r * .5); c.lineTo(cx + r * .55, cy); c.closePath();
      c.fillStyle = argb(yt ? 0xFFFFFFFF : 0xFF1C1C1E); c.fill();
    } else if (kind === 'shape') {
      Shapes.drawShape(c, b, e.text, dw);
    } else if (kind === 'table') {
      Shapes.drawTable(c, b, e.text, dw);
    } else if (kind === 'hyperlink') {
      c.fillStyle = argb(0x24007AFF); AnnotationPainter._roundRect(c, b, b.height() * .12, b.height() * .12); c.fill();
      const sw = Math.max(1.5, dw * .0028);
      c.strokeStyle = argb(0xFF007AFF); c.lineWidth = sw; c.lineCap = 'butt';
      c.beginPath(); c.moveTo(b.left, b.bottom - sw); c.lineTo(b.right, b.bottom - sw); c.stroke();
      if (AnnotationPainter.lastOfGroup(store, e)) {
        // a small blue badge with an arrow marks the end of every link
        const rad = Math.max(dw * .011, Math.min(b.height() * .42, dw * .02));
        const cx = Math.min(d.right - rad, b.right + rad * .3), cy = Math.max(d.top + rad, b.top - rad * .1);
        c.fillStyle = argb(0xFF007AFF); c.beginPath(); c.arc(cx, cy, rad, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#fff'; c.lineWidth = Math.max(1, rad * .26); c.lineCap = 'round'; c.lineJoin = 'round';
        const k = rad * .38;
        c.beginPath(); c.moveTo(cx - k, cy + k); c.lineTo(cx + k, cy - k); c.stroke();
        c.beginPath(); c.moveTo(cx - k * .1, cy - k); c.lineTo(cx + k, cy - k); c.lineTo(cx + k, cy + k * .1); c.stroke();
      }
    } else if (kind === 'audio') {
      const r = b.height() / 2;
      c.fillStyle = argb(0xFFE5F0FF); AnnotationPainter._roundRect(c, b, r, r); c.fill();
      c.lineWidth = Math.max(1, dw * .002); c.strokeStyle = argb(0xFF007AFF); AnnotationPainter._roundRect(c, b, r, r); c.stroke();
      const size = Math.max(8, b.height() * .46);
      AnnotationPainter.text(c, '▶  녹음 ' + e.text, new RectF(b.left + r * .9, b.top + (b.height() - size * 1.35) / 2, b.right - r * .4, b.bottom), size, 0xFF007AFF);
    } else if (kind === 'link') {
      AnnotationPainter.text(c, '↗ ' + e.text, b, Math.max(9, dw * .027), 0xFF007AFF);
    } else {
      AnnotationPainter.textBlock(c, e.text, b, Math.max(9, dw * e.textSize), AnnotationPainter.adj(e.color), AnnotationPainter.typeface(e.font, e.bold, e.italic), AnnotationPainter.textOpts(e));
    }
  }

  // ------------------------------------------------------------------------------------------ strokes
  /** Pen strokes of one page. Shared by the page view, export and handwriting search. */
  static strokes(c, d0, store, page) {
    const d = RectF.from(d0);
    for (const s of store.strokes) if (s.page === page) AnnotationPainter.stroke(c, d, s);
  }
  /** Names of the pen types (InkStroke.pen 0..4). */
  static PEN_NAMES = ['볼펜', '연필', '만년필', '붓', '사인펜'];

  /**
   * One stroke in the style of its pen: ballpoint, pencil, fountain pen (nib angle), brush (taper) or felt marker.
   * Translucent colours do not darken where the stroke overlaps itself (the stroke is drawn opaque on a layer that is
   * composited with the alpha once).
   */
  static stroke(c, d0, s) {
    const d = RectF.from(d0), pts = s.points, n = pts.length, dw = d.width(), dh = d.height();
    if (n === 0 || dw <= 0) return;
    const pen = s.pen | 0, argbv = AnnotationPainter.adj(s.color);
    const penAlpha = pen === 1 ? .78 : pen === 3 ? .92 : pen === 4 ? .82 : 1;
    const eff = Math.round(((argbv >>> 24) & 255) * penAlpha);
    const base = s.width * dw;
    const widthAt = (i) => {
      const b = pts[i], a = pts[Math.max(0, i - 1)];
      const pr = (a.pressure + b.pressure) / 2;
      const ax = d.left + a.x * dw, ay = d.top + a.y * dh, bx = d.left + b.x * dw, by = d.top + b.y * dh;
      let w;
      switch (pen) {
        case 1: w = base * .75 * (.5 + pr * .9); break;
        case 2: { const ang = Math.atan2(by - ay, bx - ax), cut = Math.abs(Math.sin(ang + Math.PI / 4)); w = base * (.32 + 1.05 * cut) * (.65 + pr * .7); break; }
        case 3: { const t = n <= 1 ? .5 : i / (n - 1), taper = Math.min(1, Math.min(t, 1 - t) * 7); w = base * 2.1 * (.35 + pr * .95) * (.35 + .65 * taper); break; }
        case 4: w = base * 1.5; break;
        default: w = base * (.45 + pr * 1.15);
      }
      return { w: Math.max(1.5, w), ax, ay, bx, by };
    };
    const paintInto = (g, ox, oy) => {
      g.save();
      try {
        g.strokeStyle = g.fillStyle = argb(argbv | 0xFF000000);
        g.lineCap = pen === 4 ? 'square' : 'round'; g.lineJoin = 'round';
        for (let i = 0; i < n; i++) {
          const { w, ax, ay, bx, by } = widthAt(i);
          if (i === 0) { g.beginPath(); g.arc(bx - ox, by - oy, w / 2, 0, Math.PI * 2); g.fill(); }
          else { g.lineWidth = w; g.beginPath(); g.moveTo(ax - ox, ay - oy); g.lineTo(bx - ox, by - oy); g.stroke(); }
        }
      } finally { g.restore(); }
    };
    if (eff >= 255) { paintInto(c, 0, 0); return; }
    // translucent: bounding box layer
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) { const x = d.left + p.x * dw, y = d.top + p.y * dh; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const pad = base * 2.6 + 3;
    const L = Math.max(d.left, minX - pad), T = Math.max(d.top, minY - pad), R = Math.min(d.right, maxX + pad), B = Math.min(d.bottom, maxY + pad);
    if (R <= L || B <= T) return;
    const m = c.getTransform ? c.getTransform() : null;
    const sx = Math.min(4, Math.max(.25, m ? Math.hypot(m.a, m.b) : 1)), sy = Math.min(4, Math.max(.25, m ? Math.hypot(m.c, m.d) : 1));
    const lw = Math.max(1, Math.ceil((R - L) * sx)), lh = Math.max(1, Math.ceil((B - T) * sy));
    const layer = AnnotationPainter._layer(lw, lh), g = layer.getContext('2d');
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, lw, lh);
    g.setTransform(sx, 0, 0, sy, 0, 0);
    paintInto(g, L, T);
    c.save();
    try { c.globalAlpha *= Math.max(8, eff) / 255; c.imageSmoothingEnabled = true; c.drawImage(layer, 0, 0, lw, lh, L, T, lw / sx, lh / sy); } finally { c.restore(); }
  }
  static _layer(w, h) {
    const l = AnnotationPainter._layerCanvas || (AnnotationPainter._layerCanvas = (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : document.createElement('canvas')));
    if (l.width < w || l.height < h) { l.width = Math.max(l.width, w); l.height = Math.max(l.height, h); }
    return l;
  }

  /** Everything of one page for export / thumbnails (flat note boxes, not the rounded stickies of the page view). */
  static all(...args) {
    if (args.length && !(args[0] && typeof args[0].save === 'function')) args.shift(); // Java Context arg
    const [c, d0, store, page] = args;
    const d = RectF.from(d0), dw = d.width(), dh = d.height();
    for (const m of store.marks) {
      if (m.page !== page) continue;
      const b = new RectF(d.left + m.left * dw, d.top + m.top * dh, d.left + m.right * dw, d.top + m.bottom * dh);
      if (!m.noteOnly) { c.fillStyle = argb(m.color); c.fillRect(b.left, b.top, b.width(), b.height()); }
      if (m.visible && m.note != null && m.note !== '') {
        const note = new RectF(b.right, b.top, Math.min(d.right, b.right + dw * .35), Math.min(d.bottom, b.top + dh * .12));
        c.fillStyle = argb(0xFFFFF7D6); c.fillRect(note.left, note.top, note.width(), note.height());
        AnnotationPainter.text(c, m.minimized ? '메모' : m.note, note, dw * .023, 0xFF1C1C1E);
      }
    }
    AnnotationPainter.strokes(c, d, store, page);
    for (const n of store.translations) {
      if (n.page !== page || !n.visible) continue;
      const box = new RectF(d.left + n.right * dw, d.top + n.top * dh, Math.min(d.right, d.left + n.right * dw + dw * .35), Math.min(d.bottom, d.top + n.top * dh + dh * .12));
      c.fillStyle = argb(0xFFF3E8FF); c.fillRect(box.left, box.top, box.width(), box.height());
      AnnotationPainter.text(c, n.minimized ? '번역' : n.translated, box, dw * .023, 0xFF1C1C1E);
    }
    AnnotationPainter.elements(c, d, store, page);
  }
}
