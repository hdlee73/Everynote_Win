// Port of AnnotationStore.java (+ nested Mark, OutlineItem, InkPoint, InkStroke, TranslationNote, StudyEntry, PageElement).
// JSON is byte-compatible with Android: same keys / order / defaults / clamping / validation, org.json style number
// formatting and string escaping. Persistence = sidecar file via js/host.js (see docs/api-store.md).
import { host } from './host.js';
import { Shapes } from './shapes.js';

// ======================================================================================================== org.json
export class JSONException extends Error { constructor(m) { super(m); this.name = 'JSONException'; } }

const has = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);

function toInt(v) {                                  // org.json JSON.toInteger
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 0;
    if (Number.isInteger(v)) return v >= -2147483648 && v <= 2147483647 ? v : Number(BigInt.asIntN(32, BigInt(v)));
    return Math.max(-2147483648, Math.min(2147483647, Math.trunc(v)));
  }
  if (typeof v === 'string') {
    const s = v.trim(); if (s === '') return null;
    const n = Number(s); if (Number.isNaN(n)) return null;
    return Math.max(-2147483648, Math.min(2147483647, Math.trunc(n)));
  }
  return null;
}
function toDouble(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const s = v.trim(); if (s === '') return null; const n = Number(s); return Number.isNaN(n) ? null : n; }
  return null;
}
function str(v) { return typeof v === 'string' ? v : (v !== null && typeof v === 'object') ? JSON.stringify(v) : String(v); }

const optInt = (o, k, fb = 0) => { const v = has(o, k) ? toInt(o[k]) : null; return v == null ? fb : v; };
const optDouble = (o, k, fb = NaN) => { const v = has(o, k) ? toDouble(o[k]) : null; return v == null ? fb : v; };
const optFloat = (o, k, fb = NaN) => Math.fround(optDouble(o, k, fb));
const optBoolean = (o, k, fb = false) => {
  if (!has(o, k)) return fb; const v = o[k];
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') { const s = v.toLowerCase(); if (s === 'true') return true; if (s === 'false') return false; }
  return fb;
};
const optString = (o, k, fb = '') => has(o, k) ? str(o[k]) : fb;
const optArray = (o, k) => has(o, k) && Array.isArray(o[k]) ? o[k] : null;
function getInt(o, k) {
  if (!has(o, k)) throw new JSONException('No value for ' + k);
  const v = toInt(o[k]); if (v == null) throw new JSONException('Value ' + str(o[k]) + ' at ' + k + ' of type ' + typeof o[k] + ' cannot be converted to int');
  return v;
}
function getString(o, k) { if (!has(o, k)) throw new JSONException('No value for ' + k); return str(o[k]); }
function getArray(o, k) {
  if (!has(o, k)) throw new JSONException('No value for ' + k);
  if (!Array.isArray(o[k])) throw new JSONException('Value at ' + k + ' cannot be converted to JSONArray');
  return o[k];
}
function itemObj(a, i) { const v = a[i]; if (!isObj(v)) throw new JSONException('Value at ' + i + ' cannot be converted to JSONObject'); return v; }
function itemInt(a, i) { const v = toInt(a[i]); if (v == null) throw new JSONException('Value at ' + i + ' cannot be converted to int'); return v; }

/** Parse like `new JSONObject(text)` (BOM skipped; must be an object). */
function parseRoot(text) {
  if (typeof text === 'string') {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    let v; try { v = JSON.parse(text); } catch (e) { throw new JSONException(e.message); }
    text = v;
  }
  if (!isObj(text)) throw new JSONException('Value of type ' + (Array.isArray(text) ? 'array' : typeof text) + ' cannot be converted to JSONObject');
  return text;
}

/** Java Double.toString for a finite non-integral double. */
function javaDouble(v) {
  const neg = v < 0, a = Math.abs(v); let s;
  if (a >= 1e-3 && a < 1e7) { s = String(a); if (!s.includes('.')) s += '.0'; }
  else { let [m, e] = a.toExponential().split('e'); if (!m.includes('.')) m += '.0'; s = m + 'E' + parseInt(e, 10); }
  return neg ? '-' + s : s;
}
/** org.json JSON.numberToString */
function numberToString(v) {
  if (!Number.isFinite(v)) throw new JSONException('Forbidden numeric value: ' + v);
  if (Object.is(v, -0)) return '-0';
  if (Number.isInteger(v)) return Math.abs(v) < 1e21 ? String(v) : BigInt(v).toString();
  return javaDouble(v);
}
function quote(s) {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i], c = s.charCodeAt(i);
    switch (ch) {
      case '"': case '\\': case '/': out += '\\' + ch; break;
      case '\t': out += '\\t'; break; case '\b': out += '\\b'; break; case '\n': out += '\\n'; break;
      case '\r': out += '\\r'; break; case '\f': out += '\\f'; break;
      default: out += (c <= 0x1f || c === 0x2028 || c === 0x2029) ? '\\u' + c.toString(16).padStart(4, '0') : ch;
    }
  }
  return out + '"';
}
/** org.json JSONStringer: indent=0 -> compact (toString()), indent=2 -> toString(2). null/undefined members are omitted (JSONObject.put(k,null)). */
export function stringify(value, indent = 0, level = 0) {
  const nl = n => indent ? '\n' + ' '.repeat(indent * n) : '';
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'number') return numberToString(value);
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return '[' + value.map(v => nl(level + 1) + stringify(v, indent, level + 1)).join(',') + nl(level) + ']';
  }
  const keys = Object.keys(value).filter(k => value[k] != null);
  if (!keys.length) return '{}';
  return '{' + keys.map(k => nl(level + 1) + quote(k) + (indent ? ': ' : ':') + stringify(value[k], indent, level + 1)).join(',') + nl(level) + '}';
}

const f = Math.fround;
const i32 = v => v | 0;
const uuid4 = () => (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });

// ======================================================================================================== data classes
export class Mark {
  constructor() {
    this.page = 0; this.left = 0; this.top = 0; this.right = 0; this.bottom = 0;
    this.color = 0; this.note = null; this.noteOnly = false; this.visible = true; this.minimized = false;
    /** Sticky-note look: paper color, text size in sp, and box size (0 small, 1 medium, 2 large). */
    this.paper = 0xFFFFF3A6 | 0; this.fontSp = 13; this.boxSize = 1;
    /** Own box size in dp (0 = use boxSize); set by dragging the corner handle of a selected memo. */
    this.boxW = 0; this.boxH = 0;
    /** Clockwise rotation in degrees (v1.29.0). */
    this.rot = 0;
    /** Freehand highlight (v1.30.0): thickness as a fraction of the page height and the stroke path (x0,y0,x1,y1,… normalized); path == null is the straight band. */
    this.thick = 0; this.path = null;
  }
  toJson() {
    return {
      paper: i32(this.paper), fontSp: i32(this.fontSp), boxSize: i32(this.boxSize), boxW: f(this.boxW), boxH: f(this.boxH), rot: f(this.rot), thick: f(this.thick),
      path: this.path ? Array.from(this.path, v => Math.round(f(f(v) * 10000)) / 10000) : null,
      page: i32(this.page), left: f(this.left), top: f(this.top), right: f(this.right), bottom: f(this.bottom),
      color: i32(this.color), note: this.note == null ? '' : this.note,
      noteOnly: !!this.noteOnly, visible: !!this.visible, minimized: !!this.minimized,
    };
  }
  static fromJson(o) {
    const m = new Mark();
    m.page = optInt(o, 'page'); m.left = optFloat(o, 'left'); m.top = optFloat(o, 'top');
    m.right = optFloat(o, 'right'); m.bottom = optFloat(o, 'bottom');
    m.color = optInt(o, 'color', 0x66FFEB3B); m.note = optString(o, 'note', '');
    m.noteOnly = optBoolean(o, 'noteOnly', false); m.visible = optBoolean(o, 'visible', true); m.minimized = optBoolean(o, 'minimized', false);
    m.paper = optInt(o, 'paper', 0xFFFFF3A6 | 0);
    m.fontSp = Math.max(9, Math.min(28, optInt(o, 'fontSp', 13)));
    m.boxSize = Math.max(0, Math.min(2, optInt(o, 'boxSize', 1)));
    m.boxW = f(Math.max(0, Math.min(800, optFloat(o, 'boxW', 0)))); m.boxH = f(Math.max(0, Math.min(1200, optFloat(o, 'boxH', 0))));
    m.rot = optFloat(o, 'rot', 0);
    m.thick = f(Math.max(0, Math.min(0.3, optDouble(o, 'thick', 0))));
    const pa = optArray(o, 'path');
    if (pa && pa.length >= 4) { m.path = new Array(pa.length - pa.length % 2); for (let i = 0; i < m.path.length; i++) m.path[i] = f(toDouble(pa[i]) ?? 0); }
    return m;
  }
}

export class OutlineItem {
  constructor() { this.page = 0; this.x = 0; this.y = 0; this.title = null; }
  toJson() { return { page: i32(this.page), x: f(this.x), y: f(this.y), title: this.title }; }
  static fromJson(o) {
    const it = new OutlineItem();
    it.page = optInt(o, 'page'); it.x = optFloat(o, 'x', .5); it.y = optFloat(o, 'y', .5); it.title = optString(o, 'title', '개요');
    return it;
  }
}

export class InkPoint {
  constructor(x = 0, y = 0, pressure = 0) { this.x = x; this.y = y; this.pressure = pressure; }
  toJson() { return { x: f(this.x), y: f(this.y), p: f(this.pressure) }; }
  static fromJson(o) { return new InkPoint(optFloat(o, 'x'), optFloat(o, 'y'), optFloat(o, 'p', .5)); }
}

export class InkStroke {
  constructor() { this.page = 0; this.color = 0; /** 0 ballpoint, 1 pencil, 2 fountain pen, 3 brush, 4 felt marker. */ this.pen = 0; this.width = 0; this.points = []; }
  toJson() { return { page: i32(this.page), color: i32(this.color), width: f(this.width), pen: i32(this.pen), points: this.points.map(p => p.toJson()) }; }
  static fromJson(o) {
    const s = new InkStroke();
    s.page = optInt(o, 'page'); s.color = optInt(o, 'color', 0xFF1C1C1E | 0); s.width = optFloat(o, 'width', .004);
    s.pen = Math.max(0, Math.min(4, optInt(o, 'pen', 0)));
    const a = optArray(o, 'points');
    if (a) for (let i = 0; i < a.length; i++) s.points.push(InkPoint.fromJson(itemObj(a, i)));
    return s;
  }
}

export class TranslationNote {
  constructor() { this.page = 0; this.left = 0; this.top = 0; this.right = 0; this.bottom = 0; this.source = null; this.translated = null; this.visible = true; this.minimized = false; this.boxW = 0; this.boxH = 0; this.rot = 0; }
  toJson() {
    return { boxW: f(this.boxW), boxH: f(this.boxH), rot: f(this.rot), page: i32(this.page), left: f(this.left), top: f(this.top), right: f(this.right), bottom: f(this.bottom),
      source: this.source, translated: this.translated, visible: !!this.visible, minimized: !!this.minimized };
  }
  static fromJson(o) {
    const n = new TranslationNote();
    n.page = optInt(o, 'page'); n.left = optFloat(o, 'left'); n.top = optFloat(o, 'top'); n.right = optFloat(o, 'right'); n.bottom = optFloat(o, 'bottom');
    n.source = optString(o, 'source', ''); n.translated = optString(o, 'translated', '');
    n.visible = optBoolean(o, 'visible', true); n.minimized = optBoolean(o, 'minimized', false);
    n.boxW = optFloat(o, 'boxW', 0); n.boxH = optFloat(o, 'boxH', 0); n.rot = optFloat(o, 'rot', 0);
    return n;
  }
}

export class StudyEntry {
  constructor() { this.id = uuid4(); this.page = 0; this.x = 0; this.y = 0; this.text = ''; this.comment = ''; this.excerpt = false; }
  toJson() { return { id: this.id, page: i32(this.page), x: f(this.x), y: f(this.y), text: this.text, comment: this.comment, excerpt: !!this.excerpt }; }
  static fromJson(o) {
    const e = new StudyEntry();
    e.id = optString(o, 'id', e.id); e.page = getInt(o, 'page');
    e.x = optFloat(o, 'x', .5); e.y = optFloat(o, 'y', .5);
    e.text = getString(o, 'text'); e.comment = optString(o, 'comment', ''); e.excerpt = optBoolean(o, 'excerpt');
    if (e.page < 0 || !Number.isFinite(e.x) || !Number.isFinite(e.y) || e.x < 0 || e.x > 1 || e.y < 0 || e.y > 1) throw new JSONException('잘못된 페이지 링크');
    return e;
  }
}

const KINDS = ['text', 'image', 'link', 'audio', 'sticker', 'video', 'hyperlink', 'shape', 'table', 'youtube'];
const ASSET_RE = /^([a-f0-9-]{36}\.(png|m4a)|tape-\d\d\.png)$/;
const BUILTIN_RE = /^tape-\d\d\.png$/;   // masking tapes shipped in web/assets/stickers (Android v1.32.0)
const MP4_RE = /^[a-f0-9-]{36}\.mp4$/;
const YT_RE = /^[A-Za-z0-9_-]{11}$/;
// Java \S = anything but [ \t\n\x0B\f\r]
const LINK_RE = /^(https?:\/\/[^ \t\n\x0B\f\r]+|page:[0-9]{1,6}|doc:[^ \t\n\x0B\f\r]{1,600})$/;

export class PageElement {
  static DEFAULT_TEXT_SIZE = Math.fround(.027);
  static DEFAULT_LINE = 1.35;
  static DEFAULT_TEXT_COLOR = 0xFF1C1C1E | 0;
  /** sans=고딕, serif=명조, mono=고정폭, hand=손글씨체 */
  static FONTS = ['sans', 'medium', 'light', 'black', 'condensed', 'serif', 'mono', 'typewriter', 'hand', 'casual'];
  /** Markers of list lines are plain text (Android v1.29.0): '• ', '1. ', '☐ ' / '☑ '. */
  static BULLET = '• '; static CHECK = '☐ '; static CHECKED = '☑ ';
  constructor() {
    this.page = 0; this.kind = 'text'; this.text = ''; this.asset = '';
    this.left = f(.1); this.top = f(.1); this.right = f(.8); this.bottom = f(.3);
    /** Text height as a fraction of the page width (typing boxes only). */
    this.textSize = PageElement.DEFAULT_TEXT_SIZE; this.color = PageElement.DEFAULT_TEXT_COLOR;
    this.font = 'sans'; this.bold = false; this.italic = false;
    /** Clockwise rotation in degrees around the box centre (pictures, stickers, shapes and tables). */
    this.rot = 0;
    /** Typing boxes: paragraph alignment (0 left, 1 centre, 2 right), underline and strike-through (Android v1.29.0 keys). */
    this.align = 0; this.underline = false; this.strike = false;
    /** Pictures: stretched to fill the box (width and height independent) instead of keeping the original ratio. */
    this.stretch = false;
    /** Opacity 0.05..1 of pictures, stickers, shapes and tables (Android v1.32.0 key `alpha`). */
    this.alpha = 1;
    /** Typing boxes: line step as a multiple of the font size (Android v1.36.0 key `lineSpacing`); 0 = default 1.35. */
    this.lineSpacing = 0;
  }
  /** Effective line step. */
  line() { return this.lineSpacing >= .8 && this.lineSpacing <= 4 ? this.lineSpacing : PageElement.DEFAULT_LINE; }
  toJson() {
    const o = { rot: f(this.rot), page: i32(this.page), kind: this.kind, text: this.text, asset: this.asset,
      left: f(this.left), top: f(this.top), right: f(this.right), bottom: f(this.bottom),
      textSize: f(this.textSize), color: i32(this.color), font: this.font, bold: !!this.bold, italic: !!this.italic,
      align: i32(this.align), underline: !!this.underline, strike: !!this.strike, stretch: !!this.stretch, alpha: f(this.alpha) };
    if (this.lineSpacing > 0) o.lineSpacing = f(this.lineSpacing);   // written only when set, so older sidecars stay byte-identical
    return o;
  }
  /** Same checks as Java (throws JSONException '잘못된 노트 요소'). Also reads the Windows v3.0 keys (align as 'left'|'center'|'right', list, checked[]). */
  static fromJson(o) {
    const e = new PageElement();
    e.page = getInt(o, 'page');
    e.kind = optString(o, 'kind', 'text'); e.text = optString(o, 'text'); e.asset = optString(o, 'asset');
    e.left = optFloat(o, 'left', .1); e.top = optFloat(o, 'top', .1); e.right = optFloat(o, 'right', .8); e.bottom = optFloat(o, 'bottom', .3);
    e.rot = optFloat(o, 'rot', 0);
    e.textSize = optFloat(o, 'textSize', PageElement.DEFAULT_TEXT_SIZE);
    e.color = optInt(o, 'color', PageElement.DEFAULT_TEXT_COLOR);
    e.font = optString(o, 'font', 'sans');
    if (!PageElement.FONTS.includes(e.font)) e.font = 'sans';
    e.bold = optBoolean(o, 'bold', false); e.italic = optBoolean(o, 'italic', false);
    const legacy = has(o, 'align') && typeof o.align === 'string' ? ['left', 'center', 'right'].indexOf(o.align.toLowerCase()) : -1;
    e.align = Math.max(0, Math.min(2, legacy >= 0 ? legacy : optInt(o, 'align', 0)));
    e.underline = optBoolean(o, 'underline', false);
    e.strike = optBoolean(o, 'strike', false);
    e.stretch = optBoolean(o, 'stretch', false);
    e.lineSpacing = optFloat(o, 'lineSpacing', 0); if (!Number.isFinite(e.lineSpacing) || e.lineSpacing < .8 || e.lineSpacing > 4) e.lineSpacing = 0;
    e.alpha = optFloat(o, 'alpha', 1); if (!Number.isFinite(e.alpha) || e.alpha > 1) e.alpha = 1; if (e.alpha < .05) e.alpha = .05;
    if (e.kind === 'text') PageElement.migrateLegacyList(e, o);
    if (!PageElement.valid(e)) throw new JSONException('잘못된 노트 요소');
    if (!Number.isFinite(e.textSize) || e.textSize < f(.004) || e.textSize > f(.3)) e.textSize = PageElement.DEFAULT_TEXT_SIZE;
    return e;
  }
  /** Windows v3.0 stored `list` ('bullet'|'number'|'check') + `checked[]` beside the text; turn that into plain-text markers. */
  static migrateLegacyList(e, o) {
    const kind = optString(o, 'list', 'none');
    if (kind !== 'bullet' && kind !== 'number' && kind !== 'check') return;
    const ck = optArray(o, 'checked') || [];
    e.text = String(e.text).split('\n').map((line, i) => {
      if (PageElement.markerKind(line)) return line;
      return (kind === 'bullet' ? PageElement.BULLET : kind === 'number' ? (i + 1) + '. ' : (ck[i] === true || ck[i] === 'true') ? PageElement.CHECKED : PageElement.CHECK) + line;
    }).join('\n');
  }
  /** Marker kind at the start of a line: 0 none, 1 bullet, 2 number, 3 checklist. */
  static markerKind(line) {
    if (line.startsWith(PageElement.BULLET)) return 1; if (/^\d+\. /.test(line)) return 2;
    if (line.startsWith(PageElement.CHECK) || line.startsWith(PageElement.CHECKED)) return 3; return 0;
  }
  static markerLength(line) {
    switch (PageElement.markerKind(line)) { case 1: return PageElement.BULLET.length; case 2: return /^\d+\. /.exec(line)[0].length; case 3: return PageElement.CHECK.length; default: return 0; }
  }
  /** Flips the leading ☐/☑ of the i-th '\n' line of a typing box; returns the new checked state (false when that line has no check marker). */
  toggleCheck(i) {
    const lines = String(this.text).split('\n'), l = lines[i]; if (l == null) return false;
    if (l.startsWith(PageElement.CHECK)) { lines[i] = PageElement.CHECKED + l.slice(2); this.text = lines.join('\n'); return true; }
    if (l.startsWith(PageElement.CHECKED)) { lines[i] = PageElement.CHECK + l.slice(2); this.text = lines.join('\n'); }
    return false;
  }
  static markerFor(kind, number) { return kind === 1 ? PageElement.BULLET : kind === 2 ? number + '. ' : kind === 3 ? PageElement.CHECK : ''; }
  /** Java's validation block of PageElement.fromJson. */
  static valid(e) {
    if (e.page < 0 || !Number.isFinite(e.left) || !Number.isFinite(e.top) || !Number.isFinite(e.right) || !Number.isFinite(e.bottom)) return false;
    if (e.left < 0 || e.top < 0 || e.right > 1 || e.bottom > 1 || e.left >= e.right || e.top >= e.bottom) return false;
    if (!KINDS.includes(e.kind)) return false;
    if (e.asset !== '' && !ASSET_RE.test(e.asset)) return false;
    if (e.kind === 'video' && !MP4_RE.test(e.text)) return false;
    if (e.kind === 'sticker' && (e.text === '' || e.text.length > 16)) return false;
    if (e.kind === 'youtube' && !YT_RE.test(e.text)) return false;
    if (e.kind === 'shape' && !Shapes.validShape(e.text)) return false;
    if (e.kind === 'table' && !Shapes.validTable(e.text)) return false;
    if (e.kind === 'hyperlink' && !LINK_RE.test(e.text)) return false;
    return true;
  }
}

// ======================================================================================================== host / paths
let infoP = null;
const dataDir = async () => (await (infoP ||= host.info())).data.replace(/[\\/]+$/, '');
const norm = p => String(p).replace(/\//g, '\\').replace(/\\+$/, '');

async function sha1hex(s) {
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Serialised writes per file; shared by every store instance and the static helpers.
const queues = new Map();      // path -> tail promise
const inflight = new Set();
const dirtyStores = new Set();
let dirReady = null;
function queue(path, job) {
  const tail = queues.get(path) || Promise.resolve();
  const p = tail.then(job, job);
  const done = p.catch(() => {});
  queues.set(path, done);
  inflight.add(done); done.then(() => { inflight.delete(done); if (queues.get(path) === done) queues.delete(path); });
  return p;
}
async function ensureDir(dir) {
  if (!dirReady || dirReady.dir !== dir) dirReady = { dir, p: host.mkdir(dir).catch(() => {}) };
  await dirReady.p;
}
async function writeSidecar(path, json) {
  await ensureDir(path.slice(0, path.lastIndexOf('\\')));
  const tmp = path + '.tmp';
  try { await host.writeText(tmp, json); await host.move(tmp, path); }   // atomic replace when the host allows it
  catch (e) { await host.writeText(path, json); try { await host.delete(tmp); } catch (e2) { /* */ } }
}

// ======================================================================================================== store
const ARRAYS = ['elements', 'studyEntries', 'marks', 'bookmarks', 'outlines', 'strokes', 'translations'];

export class AnnotationStore {
  static Mark = Mark; static OutlineItem = OutlineItem; static InkPoint = InkPoint; static InkStroke = InkStroke;
  static TranslationNote = TranslationNote; static StudyEntry = StudyEntry; static PageElement = PageElement;
  static JSONException = JSONException;
  /** Autosave debounce in ms. */
  static SAVE_DELAY = 300;
  static FORMAT = 'PDF Note annotations v2';

  constructor() {
    this.elements = []; this.studyEntries = []; this.marks = []; this.bookmarks = new Set();
    this.outlines = []; this.strokes = []; this.translations = [];
    /** document key = absolute path of the PDF; null until open()/rebind(). */
    this.key = null;
    this._timer = 0; this._dirty = false; this._waiters = [];
  }

  // ---------------------------------------------------------------- paths / statics
  /** `<data>\annotations\<sha1(lowercase key)>.json` */
  static async sidecarPath(key) { return `${await dataDir()}\\annotations\\${await sha1hex(norm(key).toLowerCase())}.json`; }
  /** Last modification time (ms) of a document's annotation sidecar, 0 if none (Java AnnotationStore.modified). */
  static async modified(key) {
    try { await AnnotationStore._settle(key); const s = await host.stat(await AnnotationStore.sidecarPath(key)); return s.exists ? s.mtime : 0; } catch (e) { return 0; }
  }
  /** Reads another document's annotations (search / library features). Returns a store bound to `key`. */
  static async load(key) { return new AnnotationStore().open(key); }
  /** Copies annotations of one document to another (Java LibraryRepository.cloneAnnotations); pages >= count -> JSONException. */
  static async cloneAnnotations(sourceKey, targetKey, count = Number.MAX_SAFE_INTEGER) {
    const original = await AnnotationStore.load(sourceKey), clone = await AnnotationStore.load(targetKey);
    await clone.importJson(original.exportJson(sourceKey, 'PDF'), count);
    await clone.flush();
    return clone;
  }
  /** Library rename/move: carries the sidecar along. Safe if the document has no sidecar. */
  static async moveSidecar(oldKey, newKey) {
    await AnnotationStore._settle(oldKey);
    const from = await AnnotationStore.sidecarPath(oldKey), to = await AnnotationStore.sidecarPath(newKey);
    if (from === to || !(await host.exists(from))) return false;
    await ensureDir(to.slice(0, to.lastIndexOf('\\')));
    if (await host.exists(to)) await host.delete(to);
    await host.move(from, to);
    return true;
  }
  static async deleteSidecar(key) {
    await AnnotationStore._settle(key);
    for (const s of [...dirtyStores]) if (s.key != null && norm(s.key).toLowerCase() === norm(key).toLowerCase()) { clearTimeout(s._timer); s._dirty = false; dirtyStores.delete(s); s._resolve(false); }
    const p = await AnnotationStore.sidecarPath(key);
    if (await host.exists(p)) await host.delete(p);
  }
  /** Writes pending saves of every store and waits for all file writes (call before shutdown). */
  static async flushAll() {
    await Promise.all([...dirtyStores].map(s => s.flush()));
    while (inflight.size) await Promise.all([...inflight]);
  }
  /** wait for pending writes of a document (flushing any dirty open store) */
  static async _settle(key) {
    const k = norm(key).toLowerCase();
    await Promise.all([...dirtyStores].filter(s => s.key != null && norm(s.key).toLowerCase() === k).map(s => s.flush()));
    const p = await AnnotationStore.sidecarPath(key);
    if (queues.has(p)) await queues.get(p);
  }

  // ---------------------------------------------------------------- JSON
  /** Parse sidecar or export text into a NEW store (not bound to a document). Bad items are skipped unless opts.strict. */
  static fromJson(text, opts) { const s = new AnnotationStore(); s.loadJson(text, opts); return s; }

  /** Replace contents from sidecar/export text (no format check). Java open() semantics, except that one bad item no longer
   *  aborts the rest (Java quirk); opts.strict:true throws on the first bad item instead. */
  loadJson(text, opts = {}) {
    const root = parseRoot(text), strict = !!opts.strict;
    this._clear();
    const each = (name, parse, add) => {
      const a = optArray(root, name); if (!a) return;
      for (let i = 0; i < a.length; i++) { try { add(parse(a, i)); } catch (e) { if (strict || !(e instanceof JSONException)) throw e; } }
    };
    each('elements', (a, i) => PageElement.fromJson(itemObj(a, i)), x => this.elements.push(x));
    each('studyEntries', (a, i) => StudyEntry.fromJson(itemObj(a, i)), x => this.studyEntries.push(x));
    each('marks', (a, i) => Mark.fromJson(itemObj(a, i)), x => this.marks.push(x));
    each('bookmarks', (a, i) => itemInt(a, i), x => this.bookmarks.add(x));
    each('outlines', (a, i) => OutlineItem.fromJson(itemObj(a, i)), x => this.outlines.push(x));
    each('strokes', (a, i) => InkStroke.fromJson(itemObj(a, i)), x => this.strokes.push(x));
    each('translations', (a, i) => TranslationNote.fromJson(itemObj(a, i)), x => this.translations.push(x));
    return this;
  }

  _clear() {
    this.marks.length = 0; this.bookmarks.clear(); this.outlines.length = 0; this.strokes.length = 0;
    this.translations.length = 0; this.studyEntries.length = 0; this.elements.length = 0;
  }

  _body(root) {
    root.elements = this.elements.map(e => e.toJson());
    root.studyEntries = this.studyEntries.map(e => e.toJson());
    root.marks = this.marks.map(m => m.toJson());
    root.bookmarks = [...this.bookmarks].sort((a, b) => a - b);
    root.outlines = this.outlines.map(o => o.toJson());
    root.strokes = this.strokes.map(s => s.toJson());
    root.translations = this.translations.map(t => t.toJson());
    return root;
  }
  /** Sidecar text (compact, key order elements, studyEntries, marks, bookmarks, outlines, strokes, translations). */
  toJson() { return stringify(this._body({}), 0); }
  /** Export / backup text: Java exportJson(uri,title) = toString(2) with format/document/uri first. */
  exportJson(uri, title) { return stringify(this._body({ format: AnnotationStore.FORMAT, document: title, uri: String(uri) }), 2); }

  /** Restore backup. Throws JSONException (store untouched) on any problem; saves on success (returns the save promise). */
  importJson(json, pageCount) {
    const root = parseRoot(json);
    const format = optString(root, 'format');
    if (format !== 'PDF Note annotations v1' && format !== 'PDF Note annotations v2') throw new JSONException('PDF Note 주석 백업이 아닙니다');
    const t = new AnnotationStore();
    const a = getArray(root, 'marks'), b = getArray(root, 'bookmarks'), o = getArray(root, 'outlines'),
      s = getArray(root, 'strokes'), tr = getArray(root, 'translations');
    for (let i = 0; i < a.length; i++) t.marks.push(Mark.fromJson(itemObj(a, i)));
    for (let i = 0; i < b.length; i++) t.bookmarks.add(itemInt(b, i));
    for (let i = 0; i < o.length; i++) t.outlines.push(OutlineItem.fromJson(itemObj(o, i)));
    for (let i = 0; i < s.length; i++) t.strokes.push(InkStroke.fromJson(itemObj(s, i)));
    for (let i = 0; i < tr.length; i++) t.translations.push(TranslationNote.fromJson(itemObj(tr, i)));
    const entries = optArray(root, 'studyEntries');
    if (entries) for (let i = 0; i < entries.length; i++) t.studyEntries.push(StudyEntry.fromJson(itemObj(entries, i)));
    const els = optArray(root, 'elements');
    if (els) for (let i = 0; i < els.length; i++) t.elements.push(PageElement.fromJson(itemObj(els, i)));
    const pages = [...t.bookmarks];
    for (const m of t.marks) pages.push(m.page); for (const m of t.outlines) pages.push(m.page);
    for (const m of t.strokes) pages.push(m.page); for (const m of t.translations) pages.push(m.page);
    for (const m of t.studyEntries) pages.push(m.page); for (const e of t.elements) pages.push(e.page);
    for (const p of pages) if (p < 0 || p >= pageCount) throw new JSONException('문서 페이지 범위를 벗어난 주석');
    this.marks.splice(0, Infinity, ...t.marks); this.bookmarks.clear(); t.bookmarks.forEach(x => this.bookmarks.add(x));
    this.outlines.splice(0, Infinity, ...t.outlines); this.strokes.splice(0, Infinity, ...t.strokes);
    this.translations.splice(0, Infinity, ...t.translations); this.studyEntries.splice(0, Infinity, ...t.studyEntries);
    this.elements.splice(0, Infinity, ...t.elements);
    return this.save();
  }

  // ---------------------------------------------------------------- persistence
  /** Binds the store to a document (absolute PDF path) and loads its sidecar. Pending saves of the previous document are written first. */
  async open(key) {
    if (this._dirty) this._commit();               // snapshot the old document now (sync) - written in the background
    this.key = norm(key);
    this._clear();
    try {
      const path = await AnnotationStore.sidecarPath(this.key);
      if (queues.has(path)) await queues.get(path);
      if (this.key !== norm(key)) return this;     // re-opened meanwhile
      if (await host.exists(path)) this.loadJson(await host.readText(path));
    } catch (e) { /* unreadable / corrupt sidecar -> empty (Java: ignored JSONException/IOException) */ }
    return this;
  }
  /** Java rebind(uri): the document moved/renamed - keep the data, switch the key, save. */
  rebind(key) { this.key = norm(key); return this.save(); }

  /** Debounced non-blocking save. Resolves true when written (false if nothing to save or failed); never rejects. */
  save() {
    if (this.key == null) return Promise.resolve(false);
    this._dirty = true; dirtyStores.add(this);
    const p = new Promise(res => this._waiters.push(res));
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this._commit(), AnnotationStore.SAVE_DELAY);
    return p;
  }
  _resolve(v) { const w = this._waiters; this._waiters = []; for (const r of w) r(v); }
  /** snapshot + enqueue the file write now */
  _commit() {
    clearTimeout(this._timer);
    const waiters = this._waiters; this._waiters = [];
    const key = this.key;
    this._dirty = false; dirtyStores.delete(this);
    let json;
    try { json = this.toJson(); } catch (e) { host.log('annotation save failed (' + e.message + ')'); waiters.forEach(r => r(false)); return Promise.resolve(false); }
    const job = AnnotationStore.sidecarPath(key).then(path => queue(path, () => writeSidecar(path, json)))
      .then(() => true, e => { host.log('annotation save failed: ' + (e && e.message)); return false; });
    job.then(v => waiters.forEach(r => r(v)));
    return job;
  }
  /** Writes any pending save right now and resolves when it is on disk. */
  async flush() {
    if (this._dirty) return this._commit();
    const p = this.key != null ? await AnnotationStore.sidecarPath(this.key) : null;
    if (p && queues.has(p)) await queues.get(p);
    return true;
  }

  // ---------------------------------------------------------------- page edits (Java removePage / insertPageAfter; do not save)
  /** Removes everything anchored to a deleted page and renumbers the pages after it. Does not save. */
  removePage(index) {
    const keep = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i].page === index) arr.splice(i, 1); };
    keep(this.marks); keep(this.strokes); keep(this.translations); keep(this.outlines); keep(this.elements); keep(this.studyEntries);
    this.bookmarks.delete(index);
    this._shiftPages(index + 1, -1);
  }
  /** Makes room for a page inserted right after afterIndex. Does not save. */
  insertPageAfter(afterIndex) { this._shiftPages(afterIndex + 1, 1); }
  _shiftPages(from, delta) {
    for (const list of [this.marks, this.strokes, this.translations, this.outlines, this.elements, this.studyEntries])
      for (const x of list) if (x.page >= from) x.page += delta;
    const moved = new Set();
    for (const p of this.bookmarks) moved.add(p >= from ? p + delta : p);
    this.bookmarks.clear(); moved.forEach(p => this.bookmarks.add(p));
  }

  // ---------------------------------------------------------------- assets (images / video thumbnails / recordings / videos)
  /** Asset files live in `<data>\assets\<name>` (flat, shared by all documents - as Android's images/, videos/, recordings/). */
  static async assetsDir() { return (await dataDir()) + '\\assets'; }
  /** New Android-compatible asset file name: lowercase dashed UUID + '.' + ext (png | m4a | mp4). */
  static newAssetName(ext) { return uuid4().toLowerCase() + '.' + ext; }
  static validAssetName(name) { return typeof name === 'string' && (ASSET_RE.test(name) || MP4_RE.test(name)); }
  static async assetPath(name) {
    if (!AnnotationStore.validAssetName(name)) throw new Error('invalid asset name: ' + name);
    return (await AnnotationStore.assetsDir()) + '\\' + name;
  }
  static async hasAsset(name) { if (BUILTIN_RE.test(name)) return true; try { return await host.exists(await AnnotationStore.assetPath(name)); } catch (e) { return false; } }
  /** bytes: Uint8Array | ArrayBuffer | Blob */
  static async saveAsset(name, bytes) {
    const path = await AnnotationStore.assetPath(name);
    await host.mkdir(await AnnotationStore.assetsDir());
    if (typeof Blob !== 'undefined' && bytes instanceof Blob) bytes = new Uint8Array(await bytes.arrayBuffer());
    else if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
    await host.writeBytes(path, bytes);
    try { (await import('./painter.js')).AnnotationPainter.forgetImage(name); } catch (e) { /* */ }
    urlCache.delete(name);
    return name;
  }
  static async readAsset(name) { return host.readBytes(await AnnotationStore.assetPath(name)); }
  static async deleteAsset(name) {
    if (BUILTIN_RE.test(name)) return;
    try { const p = await AnnotationStore.assetPath(name); if (await host.exists(p)) await host.delete(p); } catch (e) { /* */ }
    urlCache.delete(name);
    try { (await import('./painter.js')).AnnotationPainter.forgetImage(name); } catch (e) { /* */ }
  }
  /** Drop the cached URL after an asset file was replaced on disk (video converted in place). */
  static forgetAssetUrl(name) { urlCache.delete(name); }
  /** URL usable in <img>/<video>/<audio>/fetch (host fs.url; supports Range). */
  static async assetUrl(name) {
    if (BUILTIN_RE.test(name)) return new URL('../assets/stickers/' + name, import.meta.url).href;
    if (urlCache.has(name)) return urlCache.get(name);
    const url = await host.call('fs.url', { path: await AnnotationStore.assetPath(name) });
    urlCache.set(name, url);
    return url;
  }
  /** Instance forwarders so callers can write store.assetUrl(name). */
  assetUrl(name) { return AnnotationStore.assetUrl(name); }
  saveAsset(name, bytes) { return AnnotationStore.saveAsset(name, bytes); }
  /** Asset file names referenced by this store's elements (image/video/youtube thumbs, recordings, mp4 files). */
  referencedAssets() {
    const s = new Set();
    for (const e of this.elements) { if (e.asset) s.add(e.asset); if (e.kind === 'video' && e.text) s.add(e.text); }
    return s;
  }
}
const urlCache = new Map();

// best-effort shutdown flush (the host should also call AnnotationStore.flushAll() before closing)
if (typeof window !== 'undefined' && window.addEventListener) {
  const bg = () => { AnnotationStore.flushAll().catch(() => {}); };
  window.addEventListener('pagehide', bg);
  window.addEventListener('visibilitychange', () => { if (typeof document !== 'undefined' && document.visibilityState === 'hidden') bg(); });
}
