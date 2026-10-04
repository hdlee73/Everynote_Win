// PdfDoc: thin wrapper around pdf.js replacing android.graphics.pdf.PdfRenderer (+ text extraction for selection/search).
import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';
import { RectF } from './util.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
const BASE = new URL('../vendor/pdfjs/', import.meta.url).href;

/** Optional OCR hook for scanned pages: async (canvas) -> [{text,x,y,w,h,line}] in canvas pixels. Set by app.js. */
export const ocrHook = { fn: null };

export class TextRegion {
  /** word: string, line: string, wordBounds/lineBounds: RectF normalized to the page */
  constructor(word, line, wordBounds, lineBounds) { this.word = word; this.line = line; this.wordBounds = wordBounds; this.lineBounds = lineBounds; }
}

let measureCtx = null;
function measure(str) {
  measureCtx ||= document.createElement('canvas').getContext('2d');
  measureCtx.font = '20px sans-serif';
  return measureCtx.measureText(str).width;
}

export class PdfDoc {
  static async open(data) { // data: Uint8Array | ArrayBuffer
    const task = pdfjs.getDocument({
      data: data instanceof Uint8Array ? data : new Uint8Array(data),
      cMapUrl: BASE + 'cmaps/', cMapPacked: true, standardFontDataUrl: BASE + 'standard_fonts/',
      wasmUrl: BASE + 'wasm/', iccUrl: BASE + 'iccs/', useSystemFonts: true, isEvalSupported: false,
    });
    const doc = await task.promise;
    return new PdfDoc(doc);
  }
  constructor(doc) { this.doc = doc; this.pageCount = doc.numPages; this._pages = new Map(); this._sizes = new Map(); this._text = new Map(); }

  async _page(i) {
    let p = this._pages.get(i);
    if (!p) { p = this.doc.getPage(i + 1); this._pages.set(i, p); if (this._pages.size > 12) this._pages.delete(this._pages.keys().next().value); }
    return p;
  }
  /** page size in PDF points (width, height) after rotation */
  async pageSize(i) {
    let s = this._sizes.get(i);
    if (!s) { const v = (await this._page(i)).getViewport({ scale: 1 }); s = { w: v.width, h: v.height }; this._sizes.set(i, s); }
    return s;
  }
  /** Renders onto a white canvas. ratio = canvas pixels per PDF point. */
  async renderPage(i, ratio) {
    const page = await this._page(i);
    const vp = page.getViewport({ scale: ratio });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(vp.width)); canvas.height = Math.max(1, Math.floor(vp.height));
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp, background: 'rgb(255,255,255)' }).promise;
    return canvas;
  }

  /** Plain text of a page (for search). */
  async pageText(i) {
    if (this._text.has(i)) return this._text.get(i);
    const page = await this._page(i);
    const tc = await page.getTextContent();
    let out = '';
    for (const it of tc.items) { out += it.str; out += it.hasEOL ? '\n' : ''; }
    this._text.set(i, out);
    return out;
  }

  /** Where the characters of a page sit horizontally (Android centersShare): counts of characters whose centre lies left of 45%, right of 55% and in the
   *  45-55% centre band, plus the total. Null for rotated pages. Used to spot two printed pages side by side. */
  async textColumns(i) {
    const page = await this._page(i);
    if (((page.rotate % 360) + 360) % 180 !== 0) return null;
    const vp = page.getViewport({ scale: 1 }), tc = await page.getTextContent();
    const r = { left: 0, right: 0, center: 0, total: 0 };
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const m = pdfjs.Util.transform(vp.transform, it.transform), w = (it.width || 0) * vp.scale, n = it.str.length;
      for (let k = 0; k < n; k++) {
        if (!it.str[k].trim()) continue;
        const x = (m[4] + w * (k + 0.5) / n) / vp.width;
        r.total++; if (x >= 0.45 && x <= 0.55) r.center++; else if (x < 0.5) r.left++; else r.right++;
      }
    }
    return r;
  }

  /** Word-level regions with line boxes, normalized (ML Kit TextRegion equivalent). Empty array if the page has no text layer. */
  async textRegions(i) {
    const page = await this._page(i);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const words = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const m = pdfjs.Util.transform(vp.transform, it.transform);
      const fh = Math.hypot(m[2], m[3]) || it.height || 10;
      const horizontal = Math.abs(m[1]) < Math.abs(m[0]) * 0.5;
      if (!horizontal) continue;
      const x0 = m[4], base = m[5];
      const total = Math.abs(it.width * vp.scale) || measure(it.str) * fh / 20;
      const tokens = it.str.match(/\S+|\s+/g) || [];
      const mw = tokens.map(t => measure(t));
      const mt = mw.reduce((a, b) => a + b, 0) || 1;
      let off = 0;
      for (let k = 0; k < tokens.length; k++) {
        const wdt = mw[k] / mt * total;
        if (tokens[k].trim()) words.push({ t: tokens[k], x: x0 + off, y: base, w: wdt, fh });
        off += wdt;
      }
    }
    if (!words.length) return [];
    // group into lines by baseline
    words.sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const w of words) {
      const L = lines.find(l => Math.abs(l.y - w.y) < Math.max(2, l.fh * 0.45) && w.x >= l.minX - l.fh);
      if (L) { L.words.push(w); L.minX = Math.min(L.minX, w.x); L.fh = Math.max(L.fh, w.fh); }
      else lines.push({ y: w.y, fh: w.fh, minX: w.x, words: [w] });
    }
    lines.sort((a, b) => a.y - b.y);
    const W = vp.width, H = vp.height;
    const out = [];
    for (const L of lines) {
      L.words.sort((a, b) => a.x - b.x);
      const text = L.words.map(w => w.t).join(' ');
      const box = r => new RectF(Math.max(0, r.x / W), Math.max(0, (r.y - r.fh * 0.88) / H), Math.min(1, (r.x + r.w) / W), Math.min(1, (r.y + r.fh * 0.22) / H));
      const lb = new RectF(1, 1, 0, 0);
      const wbs = L.words.map(w => { const b = box(w); lb.left = Math.min(lb.left, b.left); lb.top = Math.min(lb.top, b.top); lb.right = Math.max(lb.right, b.right); lb.bottom = Math.max(lb.bottom, b.bottom); return b; });
      L.words.forEach((w, k) => out.push(new TextRegion(w.t, text, wbs[k], lb)));
    }
    return out;
  }

  /** Embedded PDF outline: [{title, page, level}] */
  async outline() {
    const res = [];
    let ol; try { ol = await this.doc.getOutline(); } catch { ol = null; }
    if (!ol) return res;
    const walk = async (items, level) => {
      for (const it of items) {
        let page = -1;
        try {
          let dest = it.dest; if (typeof dest === 'string') dest = await this.doc.getDestination(dest);
          if (Array.isArray(dest)) page = await this.doc.getPageIndex(dest[0]);
        } catch { /* ignore */ }
        res.push({ title: it.title, page, level });
        if (it.items && it.items.length) await walk(it.items, level + 1);
      }
    };
    await walk(ol, 0);
    return res;
  }
  destroy() { try { this.doc.destroy(); } catch { /* ignore */ } }
}
