// SearchScanner: port of com.hdlee.pdfnote.SearchScanner (document search: annotations, PDF text layer, OCR, ink OCR).
// Same public names as the Java class; everything that touched I/O, rendering or OCR is async.
//
//   const hits = [];
//   const canceled = { value: false };
//   const truncated = await SearchScanner.scan(doc, uri, store, pageCount, startPage, query, forceOcr, canceled,
//        { progress(done, total) {}, hits(batch) { hits.push(...batch); }, warning(msg) {} });
import { RectF, joinPath } from './util.js';
import { host } from './host.js';
import { ocrHook } from './pdfdoc.js';

export const MAX_HITS = 500;
const SNIPPET_WINDOW = 100, SNIPPET_LEFT = 30;
const GOOD_EXTRA = '·…“”‘’「」『』《》〈〉';

const clamp = v => Math.max(0, Math.min(1, v));
const lower = s => s.toLowerCase();
// Java: replaceAll("\\s+"," ").trim()  (ASCII whitespace only; trim removes everything <= U+0020)
const flatten = s => s.replace(/[ \t\n\x0B\f\r]+/g, ' ').replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '');

/** One search result. `box` is in normalized page coordinates (0..1). */
export class Hit {
  constructor(page, box, kind, text, matchStart, matchEnd) {
    this.page = page;
    this.box = RectF.from(box);
    this.x = box.left;
    this.y = box.top;
    this.kind = kind;
    this.text = text;
    this.matchStart = matchStart;
    this.matchEnd = matchEnd;
  }
}

/** A line of text with per-word horizontal extents so a match can be highlighted precisely. */
export class Line {
  constructor(text, left, top, right, bottom, wordStart, wordLeft, wordRight) {
    this.text = text; this.left = left; this.top = top; this.right = right; this.bottom = bottom;
    this.wordStart = wordStart; this.wordLeft = wordLeft; this.wordRight = wordRight;
  }

  /** words: string[]; boxes: [l,t,r,b][] normalized. */
  static fromWords(words, boxes) {
    let text = '';
    const n = words.length, starts = new Array(n), lefts = new Array(n), rights = new Array(n);
    let l = 1, t = 1, r = 0, b = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) text += ' ';
      starts[i] = text.length;
      text += words[i];
      const box = boxes[i];
      lefts[i] = clamp(box[0]);
      rights[i] = clamp(box[2]);
      l = Math.min(l, box[0]); t = Math.min(t, box[1]); r = Math.max(r, box[2]); b = Math.max(b, box[3]);
    }
    return new Line(text, clamp(l), clamp(t), clamp(r), clamp(b), starts, lefts, rights);
  }

  match(start, end) {
    let l = Number.MAX_VALUE, r = -1;
    const n = this.wordStart.length;
    for (let i = 0; i < n; i++) {
      const wordEnd = i + 1 < n ? this.wordStart[i + 1] - 1 : this.text.length;
      if (wordEnd > start && this.wordStart[i] < end) {
        l = Math.min(l, this.wordLeft[i]);
        r = Math.max(r, this.wordRight[i]);
      }
    }
    if (r < 0) {
      const len = Math.max(1, this.text.length), width = this.right - this.left;
      l = this.left + width * start / len;
      r = this.left + width * end / len;
    }
    if (r - l < 0.01) r = Math.min(1, l + 0.01);
    return new RectF(clamp(l), this.top, clamp(r), this.bottom);
  }

  toJson() {
    return [this.left, this.top, this.right, this.bottom, this.text, this.wordStart.map((s, i) => [s, this.wordLeft[i], this.wordRight[i]])];
  }

  static fromJson(a) {
    const w = a[5];
    return new Line(String(a[4]), +a[0], +a[1], +a[2], +a[3], w.map(x => x[0] | 0), w.map(x => +x[1]), w.map(x => +x[2]));
  }
}

export function contains(text, query) {
  return text != null && lower(String(text)).includes(lower(query));
}

/** Builds a hit with a short snippet around the first match of `query`. */
function hit(page, box, kind, full, query) {
  const flat = full == null ? '' : flatten(String(full));
  const index = lower(flat).indexOf(lower(query));
  if (flat.length > SNIPPET_WINDOW) {
    const from = index < 0 ? 0 : Math.max(0, index - SNIPPET_LEFT);
    const to = Math.min(flat.length, from + SNIPPET_WINDOW);
    const snippet = (from > 0 ? '…' : '') + flat.substring(from, to) + (to < flat.length ? '…' : '');
    const shift = from > 0 ? 1 - from : -from;
    return new Hit(page, box, kind, snippet, index < 0 ? -1 : index + shift, index < 0 ? -1 : index + query.length + shift);
  }
  return new Hit(page, box, kind, flat, index, index < 0 ? -1 : index + query.length);
}

function point(x, y) { return new RectF(clamp(x), clamp(y), clamp(x + 0.12), clamp(y + 0.025)); }

/** Memos, translations, notes and typed text are stored as plain strings, so they need no OCR. */
export function annotations(store, q) {
  const hits = [];
  for (const m of store.marks || [])
    if (contains(m.note, q)) hits.push(hit(m.page, new RectF(m.left, m.top, m.right, m.bottom), '메모', m.note, q));
  for (const n of store.translations || [])
    if (contains(n.translated, q) || contains(n.source, q))
      hits.push(hit(n.page, new RectF(n.left, n.top, n.right, n.bottom), '번역', contains(n.translated, q) ? n.translated : n.source, q));
  for (const e of store.studyEntries || [])
    if (contains(e.text, q) || contains(e.comment, q))
      hits.push(hit(e.page, point(e.x, e.y), '노트', contains(e.text, q) ? e.text : e.comment, q));
  for (const e of store.elements || [])
    if (e.kind !== 'image' && contains(e.text, q))
      hits.push(hit(e.page, new RectF(e.left, e.top, e.right, e.bottom), e.kind === 'link' ? '링크' : '타이핑', e.text, q));
  return hits;
}

function lineHit(page, line, query, kind) {
  const lo = lower(line.text);
  const index = lo.indexOf(lower(query));
  if (index < 0) return null;
  const end = index + query.length;
  const box = lo.length === line.text.length ? line.match(index, end) : new RectF(line.left, line.top, line.right, line.bottom);
  return hit(page, box, kind, line.text, query);
}

// ---------------------------------------------------------------- cache

/** Per-document page text, kept in memory and mirrored to a JSON file under <data>\search. */
class Index {
  constructor(file, signature) {
    this.file = file; this.signature = signature;
    this.layer = new Map(); this.ocr = new Map(); this.inkHash = new Map(); this.ink = new Map();
    this.dirty = false;
  }
}

const MEMORY = new Map(); // access-order LRU of 3 indexes keyed by uri
function memoryGet(key) { const v = MEMORY.get(key); if (v) { MEMORY.delete(key); MEMORY.set(key, v); } return v; }
function memoryPut(key, v) { MEMORY.delete(key); MEMORY.set(key, v); while (MEMORY.size > 3) MEMORY.delete(MEMORY.keys().next().value); }

async function sha256(value) {
  try {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    let h = 0; for (let i = 0; i < value.length; i++) h = (Math.imul(31, h) + value.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16);
  }
}

function readLines(source, target) {
  if (!source) return;
  for (const key of Object.keys(source)) target.set(parseInt(key, 10), source[key].map(Line.fromJson));
}
function writeLines(source) {
  const out = {};
  for (const [k, v] of source) out[String(k)] = v.map(l => l.toJson());
  return out;
}

async function loadIndex(uri) {
  let signature = 'x';
  try {
    const st = await host.stat(uri);
    if (st && st.exists && !st.isDir) signature = st.size + '-' + st.mtime;
  } catch { /* keep 'x' */ }
  const cached = memoryGet(uri);
  if (cached && cached.signature === signature) return cached;
  let dataDir = null;
  try { dataDir = (await host.info()).data; } catch { /* no disk cache */ }
  const file = dataDir ? joinPath(dataDir, 'search', (await sha256(uri)) + '.json') : null;
  const index = new Index(file, signature);
  if (file && signature !== 'x') {
    try {
      if (await host.exists(file)) {
        const root = JSON.parse(await host.readText(file));
        if (root && root.sig === signature) {
          readLines(root.layer, index.layer);
          readLines(root.ocr, index.ocr);
          for (const key of Object.keys(root.ink || {})) {
            const e = root.ink[key];
            index.inkHash.set(parseInt(key, 10), e.hash | 0);
            index.ink.set(parseInt(key, 10), e.lines.map(Line.fromJson));
          }
        }
      }
    } catch {
      index.layer.clear(); index.ocr.clear(); index.ink.clear(); index.inkHash.clear();
    }
  }
  memoryPut(uri, index);
  return index;
}

async function save(index) {
  if (!index.dirty || index.signature === 'x' || !index.file) return;
  try {
    const ink = {};
    for (const [k, v] of index.ink) ink[String(k)] = { hash: index.inkHash.get(k), lines: v.map(l => l.toJson()) };
    const text = JSON.stringify({ sig: index.signature, layer: writeLines(index.layer), ocr: writeLines(index.ocr), ink });
    const dir = index.file.slice(0, index.file.lastIndexOf('\\'));
    await host.mkdir(dir);
    const tmp = index.file + '.tmp';
    await host.writeText(tmp, text);
    try { await host.move(tmp, index.file); }
    catch { try { await host.delete(index.file); } catch { /* ignore */ } await host.move(tmp, index.file); }
    index.dirty = false;
  } catch { /* cache is best effort */ }
}

/** Forget the in-memory index of a document (e.g. after the file was replaced). */
export function invalidate(uri) { MEMORY.delete(uri); }

// ------------------------------------------------------------- extraction

/** A text layer is only trusted when it holds enough readable characters. Scanned or mis-encoded pages fall back to OCR. */
export function usableTextLayer(lines) {
  let total = 0, good = 0;
  for (const line of lines) {
    for (let i = 0; i < line.text.length; i++) {
      const c = line.text[i], code = line.text.charCodeAt(i);
      if (c === ' ') continue;
      total++;
      if (/[\p{L}\p{Nd}]/u.test(c) || (code > 32 && code < 127) || GOOD_EXTRA.includes(c)) good++;
    }
  }
  return total >= 12 && good >= total * 0.9;
}

const f32 = new Float32Array(1), i32 = new Int32Array(f32.buffer);
function floatBits(v) { f32[0] = v; return i32[0]; }

export function inkSignature(store, page) {
  let hash = 17;
  for (const stroke of store.strokes || []) {
    if (stroke.page !== page) continue;
    hash = (Math.imul(31, hash) + stroke.points.length) | 0;
    for (const p of stroke.points) hash = (Math.imul(31, hash) + Math.imul(floatBits(p.x), 7) + floatBits(p.y)) | 0;
  }
  return hash;
}

/** Fallback pen renderer (used only when painter.js has no usable AnnotationPainter.strokes). Same geometry as the Java painter. */
function paintStrokes(ctx, d, store, page) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const s of store.strokes || []) {
    if (s.page !== page) continue;
    const c = s.color >>> 0;
    ctx.fillStyle = ctx.strokeStyle = `rgba(${(c >>> 16) & 255},${(c >>> 8) & 255},${c & 255},${((c >>> 24) & 255) / 255})`;
    for (let i = 0; i < s.points.length; i++) {
      const b = s.points[i], a = s.points[Math.max(0, i - 1)];
      const w = Math.max(1.5, s.width * (d.right - d.left) * (0.45 + ((a.pressure ?? 0.5) + (b.pressure ?? 0.5)) / 2 * 1.15));
      ctx.lineWidth = w;
      if (i === 0) { ctx.beginPath(); ctx.arc(d.left + b.x * (d.right - d.left), d.top + b.y * (d.bottom - d.top), w / 2, 0, Math.PI * 2); ctx.fill(); }
      else { ctx.beginPath(); ctx.moveTo(d.left + a.x * (d.right - d.left), d.top + a.y * (d.bottom - d.top)); ctx.lineTo(d.left + b.x * (d.right - d.left), d.top + b.y * (d.bottom - d.top)); ctx.stroke(); }
    }
  }
}

let painterPromise = null;
function loadPainter() {
  painterPromise ||= import('./painter.js').then(m => m.AnnotationPainter || null).catch(() => null);
  return painterPromise;
}

/** OCR words (pixel boxes) -> Lines. Words sharing `line` form a line; without `line` words are grouped by vertical overlap. */
function ocrToLines(words, w, h) {
  const groups = [];
  const byKey = new Map();
  for (const word of words || []) {
    const text = String(word.text ?? '').trim();
    if (!text || word.x == null) continue;
    const item = { t: text, b: [word.x / w, word.y / h, (word.x + word.w) / w, (word.y + word.h) / h] };
    if (word.line != null) {
      let g = byKey.get(word.line);
      if (!g) { g = []; byKey.set(word.line, g); groups.push(g); }
      g.push(item);
    } else {
      const cy = (item.b[1] + item.b[3]) / 2;
      const g = groups.find(gr => { const t = Math.min(...gr.map(x => x.b[1])), b = Math.max(...gr.map(x => x.b[3])); return cy >= t && cy <= b; });
      if (g) g.push(item); else groups.push([item]);
    }
  }
  return groups.map(g => Line.fromWords(g.map(x => x.t), g.map(x => x.b)));
}

/** Resources for one scan (the Java Engine). */
class Engine {
  constructor(doc, store) { this.doc = doc; this.store = store; this.layerUnavailable = false; this.ocrUnavailable = false; }

  /** Returns null when the page has no usable text layer. Lines come from PdfDoc.textRegions (word boxes + line grouping). */
  async textLayer(page) {
    if (this.layerUnavailable) return null;
    try {
      if (page >= this.doc.pageCount) return null;
      const regions = await this.doc.textRegions(page);
      const lines = [];
      let words = [], boxes = [], key = null;
      const flush = () => { if (words.length) lines.push(Line.fromWords(words, boxes)); words = []; boxes = []; };
      for (const r of regions) {
        if (key !== null && r.lineBounds !== key) flush();
        key = r.lineBounds;
        const w = r.word.trim();
        if (!w) continue;
        words.push(w);
        boxes.push([r.wordBounds.left, r.wordBounds.top, r.wordBounds.right, r.wordBounds.bottom]);
      }
      flush();
      return usableTextLayer(lines) ? lines : null;
    } catch {
      return null;
    }
  }

  /** Canvas at OCR resolution (white). pageImage=false leaves it blank for ink-only OCR. */
  async bitmap(page, pageImage) {
    const size = await this.doc.pageSize(page);
    const scale = Math.min(2, 1600 / Math.max(size.w, size.h));
    if (pageImage) return this.doc.renderPage(page, scale);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(size.w * scale)); canvas.height = Math.max(1, Math.round(size.h * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
  }

  /** null when no OCR engine is available. */
  async recognize(canvas) {
    if (!ocrHook.fn) { this.ocrUnavailable = true; return null; }
    const words = await ocrHook.fn(canvas);
    return ocrToLines(words, canvas.width, canvas.height);
  }
}

/**
 * Searches the whole document, starting at `startPage` so results near the reader appear first.
 * doc: PdfDoc; uri: document key (absolute path); store: AnnotationStore (use a snapshot); canceled: {value:boolean};
 * listener: {progress(done,total), hits(list), warning?(message)}. Resolves true when the result cap cut the search short.
 */
export async function scan(doc, uri, store, pageCount, startPage, query, forceOcr, canceled, listener) {
  const instant = annotations(store, query);
  let found = instant.length;
  if (instant.length) listener.hits(instant);
  const index = await loadIndex(uri);
  const inkPages = new Set((store.strokes || []).map(s => s.page));
  let truncated = false;
  const engine = new Engine(doc, store);
  let skippedOcr = 0;
  try {
    for (let step = 0; step < pageCount && !canceled.value; step++) {
      const page = (Math.max(0, startPage) + step) % pageCount;
      listener.progress(step, pageCount);
      let pageHits = [];
      for (const line of await bodyLines(engine, index, page, forceOcr, () => skippedOcr++)) {
        const h = lineHit(page, line, query, '본문');
        if (h) pageHits.push(h);
      }
      if (inkPages.has(page) && !canceled.value)
        for (const line of await inkLines(engine, index, store, page, () => skippedOcr++)) {
          const h = lineHit(page, line, query, '필기');
          if (h) pageHits.push(h);
        }
      if (canceled.value) break;
      if (pageHits.length) {
        pageHits = pageHits.map((h, i) => [h, i]).sort((a, b) => (a[0].box.top - b[0].box.top) || (a[1] - b[1])).map(x => x[0]); // stable
        if (found + pageHits.length > MAX_HITS) { pageHits = pageHits.slice(0, Math.max(0, MAX_HITS - found)); truncated = true; }
        found += pageHits.length;
        listener.hits(pageHits);
        if (truncated) break;
      }
      await Promise.resolve(); // let UI/cancel run
    }
    listener.progress(pageCount, pageCount);
  } finally {
    await save(index);
  }
  if (skippedOcr > 0 && listener.warning) listener.warning('OCR을 사용할 수 없어 스캔·손글씨 ' + skippedOcr + '쪽은 검색하지 못했습니다');
  return truncated;
}

async function bodyLines(engine, index, page, forceOcr, onSkip) {
  if (!forceOcr) {
    const cached = index.layer.get(page);
    if (cached) return cached;
  }
  const cachedOcr = index.ocr.get(page);
  if (cachedOcr && (forceOcr || !index.layer.has(page))) return cachedOcr;
  if (!forceOcr) {
    const layer = await engine.textLayer(page);
    if (layer) { index.layer.set(page, layer); index.dirty = true; return layer; }
  }
  const canvas = await engine.bitmap(page, true);
  const lines = await engine.recognize(canvas);
  canvas.width = canvas.height = 0;
  if (lines === null) { onSkip(); return []; }
  index.ocr.set(page, lines); index.dirty = true;
  return lines;
}

async function inkLines(engine, index, store, page, onSkip) {
  const signature = inkSignature(store, page);
  if (index.inkHash.get(page) === signature && index.ink.has(page)) return index.ink.get(page);
  if (!ocrHook.fn) { engine.ocrUnavailable = true; onSkip(); return []; }
  const canvas = await engine.bitmap(page, false);
  const ctx = canvas.getContext('2d');
  const rect = new RectF(0, 0, canvas.width, canvas.height);
  const Painter = await loadPainter();
  let done = false;
  if (Painter && typeof Painter.strokes === 'function') {
    try { Painter.strokes(ctx, rect, store, page); done = true; } catch { /* use fallback */ }
  }
  if (!done) paintStrokes(ctx, rect, store, page);
  const lines = await engine.recognize(canvas);
  canvas.width = canvas.height = 0;
  if (lines === null) { onSkip(); return []; }
  index.ink.set(page, lines); index.inkHash.set(page, signature); index.dirty = true;
  return lines;
}

export const SearchScanner = { MAX_HITS, Hit, Line, contains, annotations, usableTextLayer, inkSignature, scan, invalidate };
export default SearchScanner;
