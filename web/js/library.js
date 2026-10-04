// Port of LibraryRepository.java + NotebookFiles.java.
//
// Java `File` / `Uri` == absolute Windows path string here. Everything that touches the disk is async (js/host.js);
// everything that only touches the preferences (favorite, folderColor, sortMode, paper, managed, ...) stays synchronous because the
// preferences (Android SharedPreferences "pdf_note_library") live in memory and are persisted to <data>\library.json.
//
// Construction: `const library = new LibraryRepository(); await library.ready;`  (`root` is only valid after `ready`.)
import { host } from './host.js';
import { baseName, dirName, uuid } from './util.js';

const PDFLIB_URL = '../vendor/pdflib/pdf-lib.esm.min.js';
let pdfLibPromise = null;
const pdfLib = () => (pdfLibPromise ||= import(PDFLIB_URL));

export class IOException extends Error { constructor(m) { super(m); this.name = 'IOException'; } }

// ---------------------------------------------------------------- path helpers (Windows semantics: case-insensitive, \ separator)
export const normPath = p => String(p).replace(/\//g, '\\').replace(/\\+$/, '');
export const pathKey = p => normPath(p).toLowerCase();
export const samePath = (a, b) => pathKey(a) === pathKey(b);
export const parentOf = p => dirName(normPath(p));
export const joinP = (dir, name) => normPath(dir) + '\\' + name;

/** java.lang.String.CASE_INSENSITIVE_ORDER */
export function jcmp(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const c1 = a.charCodeAt(i), c2 = b.charCodeAt(i);
    if (c1 !== c2) {
      const u1 = String.fromCharCode(c1).toUpperCase().charCodeAt(0), u2 = String.fromCharCode(c2).toUpperCase().charCodeAt(0);
      if (u1 !== u2) {
        const l1 = String.fromCharCode(u1).toLowerCase().charCodeAt(0), l2 = String.fromCharCode(u2).toLowerCase().charCodeAt(0);
        if (l1 !== l2) return l1 - l2;
      }
    }
  }
  return a.length - b.length;
}

const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
export async function sha1Hex(text) { return hex(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text))); }

async function exists(p) { try { return (await host.stat(p)).exists; } catch { return false; } }
async function isFile(p) { try { const s = await host.stat(p); return s.exists && !s.isDir; } catch { return false; } }
async function isDirectory(p) { try { const s = await host.stat(p); return s.exists && s.isDir; } catch { return false; } }
async function quietDelete(p) { try { await host.delete(p); } catch { /* ignore */ } }
const tmpName = (folder, prefix) => joinP(folder, `${prefix}${uuid().slice(0, 12)}.tmp`);

// ---------------------------------------------------------------- annotation sidecars (js/store.js, written by a teammate)
// Used (all guarded): AnnotationStore.moveSidecar(from,to), .cloneAnnotations(from,to,count), .deleteSidecar(path), .modified(path) -> ms.
// (An optional copySidecar(from,to,count) takes precedence.) Fallbacks implement the PLAN layout <data>\annotations\<sha1(lowercase path)>.json.
let storeMod = null;
async function annotationStore() {
  if (storeMod === null) { try { storeMod = (await import('./store.js')).AnnotationStore || false; } catch { storeMod = false; } }
  return storeMod;
}
let dataDirP = null;
const dataDir = () => (dataDirP ||= host.info().then(i => i.data));
async function sidecarPath(path) { return joinP(joinP(await dataDir(), 'annotations'), (await sha1Hex(pathKey(path))) + '.json'); }
export const Sidecars = {
  async move(from, to) {
    const S = await annotationStore();
    if (S && S.moveSidecar) return S.moveSidecar(from, to);
    const a = await sidecarPath(from), b = await sidecarPath(to);
    if (await isFile(a)) { await host.mkdir(dirName(b)); await quietDelete(b); await host.move(a, b); }
  },
  /** Copies the annotations of `from` onto `to` (Java cloneAnnotations); pages >= count are rejected by the store. No-op without a sidecar. */
  async copy(from, to, count) {
    const S = await annotationStore();
    if (S && S.copySidecar) return S.copySidecar(from, to, count);
    if (S && S.cloneAnnotations) { if (await Sidecars.modified(from) > 0) await S.cloneAnnotations(from, to, count); return; }
    const a = await sidecarPath(from), b = await sidecarPath(to);
    if (await isFile(a)) { await host.mkdir(dirName(b)); await quietDelete(b); await host.copy(a, b); }
  },
  async remove(path) {
    const S = await annotationStore();
    if (S && S.deleteSidecar) return S.deleteSidecar(path);
    await quietDelete(await sidecarPath(path));
  },
  /** AnnotationStore.modified(uri): lastModified of the sidecar, 0 if missing */
  async modified(path) {
    try {
      const S = await annotationStore();
      if (S && S.modified) return (await S.modified(path)) || 0;
      const s = await host.stat(await sidecarPath(path));
      return s.exists ? s.mtime : 0;
    } catch { return 0; }
  },
};

// ---------------------------------------------------------------- NotebookFiles
const A4_W = 595.27563, A4_H = 841.8898;
const asInt = c => c | 0;

export class Paper {
  /** template: for kind CUSTOM the path of the PDF or image used as the page background (a copy kept inside the app). */
  constructor(kind, color, template = null) {
    if (!(kind >= 0 && kind <= CUSTOM) || !Number.isInteger(kind)) throw new Error('종이 형식');
    if (kind === CUSTOM && !template) throw new Error('서식 파일을 먼저 고르세요');
    this.kind = kind; this.color = asInt(color); this.template = kind === CUSTOM ? String(template) : null;
  }
  /** "kind:color" or, for a custom template, "kind:color:path" (stored in the PDF Info /PDFNotePaper and the library prefs). */
  spec() { return `${this.kind}:${this.color}${this.template == null ? '' : ':' + this.template}`; }
  /** Throws on malformed values like Java Integer.parseInt / the constructor. */
  static parse(value) {
    const str = String(value), i = str.indexOf(':'); if (i < 0) throw new Error('paper spec');
    const j = str.indexOf(':', i + 1), kindS = str.slice(0, i), colorS = j < 0 ? str.slice(i + 1) : str.slice(i + 1, j);
    if (!/^-?\d+$/.test(kindS) || !/^-?\d+$/.test(colorS)) throw new Error('paper spec');
    return new Paper(parseInt(kindS, 10), parseInt(colorS, 10), j < 0 ? null : str.slice(j + 1));
  }
}
export const CUSTOM = 9;

/** One ruling mark of a paper type in PDF points (origin bottom-left): [x1,y1,x2,y2,style]. style 0 = faint line, 1 = red, 2 = dark, 3 = dot (x1==x2). */
export function layout(kind, w, h) {
  const out = [];
  switch (kind) {
    case 1: case 4: case 5: { const step = kind === 1 ? 25 : kind === 4 ? 18 : 32; for (let y = h - 54; y >= 42; y -= step) out.push([36, y, w - 36, y, 0]); break; }
    case 2: { for (let y = h - 54; y >= 42; y -= 18) out.push([36, y, w - 36, y, 0]); for (let x = 36; x <= w - 36; x += 18) out.push([x, 42, x, h - 54, 0]); break; }
    case 3: { out.push([36, h - 72, w - 36, h - 72, 1]); for (let y = h - 96; y >= 48; y -= 22) out.push([36, y, w - 36, y, 0]); out.push([74, h - 36, 74, 36, 1]); out.push([78, h - 36, 78, 36, 1]); break; }
    case 6: { for (let y = h - 54; y >= 42; y -= 18) for (let x = 36; x <= w - 36; x += 18) out.push([x, y, x, y, 3]); break; }
    case 7: { out.push([36, h - 60, w - 36, h - 60, 2]); for (let y = h - 84; y >= 190; y -= 24) out.push([36, y, w - 36, y, 0]); out.push([160, h - 60, 160, 190, 2]); out.push([36, 190, w - 36, 190, 2]); for (let y = 166; y >= 48; y -= 24) out.push([36, y, w - 36, y, 0]); break; }
    case 8: { for (let top = h - 60; top >= 110; top -= 72) for (let i = 0; i < 5; i++) out.push([36, top - i * 8, w - 36, top - i * 8, 2]); break; }
    default: break;
  }
  return out;
}
/** RGB (0..255) of a ruling style. */
export function ruleColor(style) { switch (style) { case 1: return [232, 140, 140]; case 2: return [120, 130, 140]; case 3: return [150, 160, 170]; default: return [185, 195, 205]; } }
/** Rule colour on a paper of the given colour (lines on a dark paper are lightened). */
export function ruleColorOn(style, paperColor) {
  const c = ruleColor(style), dark = ((paperColor >> 16) & 255) + ((paperColor >> 8) & 255) + (paperColor & 255) < 300;
  return dark ? c.map(v => Math.min(255, Math.trunc(v / 2) + 90)) : c;
}
const isPdfName = f => !!f && /\.pdf$/i.test(String(f));

function infoDict(doc) {
  if (doc.getInfoDict) { try { return doc.getInfoDict(); } catch { /* fall through */ } }
  return doc.context.lookup(doc.context.trailerInfo.Info);
}


const MARKER = new TextEncoder().encode('PDFNoteNotebook');
function hasMarker(bytes) {
  const n = bytes.length - MARKER.length;
  outer: for (let i = 0; i <= n; i++) {
    if (bytes[i] !== 80) continue;
    for (let j = 1; j < MARKER.length; j++) if (bytes[i + j] !== MARKER[j]) continue outer;
    return true;
  }
  return false;
}
/** Info /PDFNoteNotebook=true + /PDFNotePaper="kind:color" -> Paper | null. (pdf.js does not expose custom Info keys, so pdf-lib parses it; the raw scan keeps ordinary PDFs cheap.) */
export async function readNotebookPaper(bytes) {
  try {
    if (!hasMarker(bytes)) return null;
    const { PDFDocument, PDFName } = await pdfLib();
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    const info = infoDict(doc), text = k => { const v = info.get(PDFName.of(k)); return v && v.decodeText ? v.decodeText() : null; };
    if (text('PDFNoteNotebook') !== 'true') return null;
    return Paper.parse(String(text('PDFNotePaper')));
  } catch { return null; }
}

async function templateImage(doc, file, cache) {
  const key = 'img:' + file; if (cache[key]) return cache[key];
  const bytes = await host.readBytes(file);
  let img;
  try {
    const head = bytes.subarray ? bytes.subarray(0, 4) : new Uint8Array(bytes).subarray(0, 4);
    if (head[0] === 0x89 && head[1] === 0x50) img = await doc.embedPng(bytes);
    else if (head[0] === 0xFF && head[1] === 0xD8) img = await doc.embedJpg(bytes);
    else { // any other format the browser can decode (webp, bmp, gif ...): re-encode as JPEG
      const bmp = await createImageBitmap(new Blob([bytes]));
      const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(bmp, 0, 0);
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .9));
      img = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    }
  } catch { throw new IOException('서식 이미지를 읽을 수 없습니다'); }
  return (cache[key] = img);
}

/** cache: per-operation scratch (parsed template PDF / embedded image) so several pages share one template. */
async function addPaper(doc, paper, afterIndex = -1, cache = {}) {
  const { rgb, pushOperators, setStrokingRgbColor, setLineWidth, setLineCap, LineCapStyle, moveTo, lineTo, stroke } = await pdfLib();
  const n = doc.getPageCount();
  const at = (afterIndex < 0 || afterIndex >= n) ? -1 : afterIndex + 1;
  if (paper.kind === CUSTOM && isPdfName(paper.template)) {
    let source = cache.pdf;
    if (!source) {
      const { PDFDocument } = await pdfLib();
      try { source = cache.pdf = await PDFDocument.load(await host.readBytes(paper.template), { updateMetadata: false, ignoreEncryption: true }); }
      catch { throw new IOException('PDF를 읽을 수 없습니다'); }
    }
    if (source.getPageCount() < 1) throw new IOException('서식 PDF에 페이지가 없습니다');
    const [copy] = await doc.copyPages(source, [0]);
    if (at < 0) doc.addPage(copy); else doc.insertPage(at, copy);
    return;
  }
  const page = at < 0 ? doc.addPage([A4_W, A4_H]) : doc.insertPage(at, [A4_W, A4_H]);
  const width = A4_W, height = A4_H;
  const r = (paper.color >> 16) & 255, g = (paper.color >> 8) & 255, b = paper.color & 255;
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(r / 255, g / 255, b / 255), borderWidth: 0 });
  if (paper.kind === CUSTOM) {
    const img = await templateImage(doc, paper.template, cache);
    const scale = Math.min(width / img.width, height / img.height), w = img.width * scale, h = img.height * scale;
    page.drawImage(img, { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h });
    return;
  }
  if (paper.kind === 0) return;
  const segs = layout(paper.kind, width, height);
  for (let style = 0; style <= 3; style++) {
    const mine = segs.filter(sg => sg[4] === style); if (!mine.length) continue;
    const c = ruleColorOn(style, paper.color);
    const ops = [setStrokingRgbColor(c[0] / 255, c[1] / 255, c[2] / 255), setLineWidth(style === 3 ? 1.6 : style === 2 ? 0.7 : 0.45), setLineCap(style === 3 ? LineCapStyle.Round : LineCapStyle.Butt)];
    for (const sg of mine) ops.push(moveTo(sg[0], sg[1]), lineTo(sg[2], sg[3]));
    ops.push(stroke());
    page.pushOperators(...ops);
  }
}

async function loadForEdit(file, message) {
  const { PDFDocument } = await pdfLib();
  const bytes = await host.readBytes(file);
  try { return await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) {
    if (/encrypt/i.test(String(e && e.message))) throw new IOException(message);
    throw new IOException('PDF를 읽을 수 없습니다');
  }
}

export const NotebookFiles = {
  PAPER_NAMES: ['백지', '줄노트 (보통)', '모눈종이', '리걸노트', '줄노트 (좁게)', '줄노트 (넓게)', '점 격자', '코넬 노트', '오선지', '내 PDF·이미지 서식'],
  CUSTOM,
  COLORS: [0xFFFFFFFF, 0xFFFFF9E8, 0xFFFFF6B0, 0xFFEFF6FF, 0xFFF0F8EE, 0xFFFFF0F4, 0xFFEDEFF2, 0xFFF3ECFF, 0xFF1C1C1E].map(asInt),
  COLOR_NAMES: ['흰색', '크림', '리갈 옐로', '하늘', '연두', '분홍', '회색', '연보라', '검정'],
  Paper, layout, ruleColor, ruleColorOn, isPdf: isPdfName,
  WHITE: -1,

  /** NotebookFiles.root(Context): the library folder (created). */
  async root() { const r = (await host.info()).library; await host.mkdir(r); return normPath(r); },

  /** Copies a picked PDF/image into <data>\\templates so a CUSTOM paper keeps working when the original moves. Returns the copy's path. */
  async importTemplate(source) {
    const dir = (await host.info()).data.replace(/[\\/]+$/, '') + '\\templates';
    await host.mkdir(dir);
    const m = /\.[A-Za-z0-9]{1,5}$/.exec(String(source)), ext = m ? m[0].toLowerCase() : '.png';
    const target = joinP(dir, uuid() + ext);
    try { await host.copy(source, target); } catch { throw new IOException('서식 파일을 읽을 수 없습니다'); }
    return target;
  },
  name(text) {
    const n = String(text).trim();
    // eslint-disable-next-line no-control-regex
    if (n === '' || n === '.' || n === '..' || n.length > 100 || /[\\/:*?"<>|\u0000-\u001f\u007f]/.test(n)) throw new IOException('파일 이름에 사용할 수 없는 문자가 있습니다');
    return n;
  },
  pdfName(title) { const v = NotebookFiles.name(title); return v.toLowerCase().endsWith('.pdf') ? v : v + '.pdf'; },
  async unique(folder, name) {
    const v = NotebookFiles.name(name);
    let file = joinP(folder, v), count = 1;
    const dot = v.lastIndexOf('.');
    while (await exists(file)) {
      const stem = dot > 0 ? v.slice(0, dot) : v, ext = dot > 0 ? v.slice(dot) : '';
      file = joinP(folder, `${stem} (${count++})${ext}`);
    }
    return file;
  },
  blank(folder, title, pages) { return NotebookFiles.create(folder, title, pages, new Paper(0, -1)); },
  async create(folder, title, pages, paper) {
    if (pages < 1) throw new IOException('페이지 수가 올바르지 않습니다');
    const { PDFDocument, PDFName, PDFString } = await pdfLib();
    const target = await NotebookFiles.unique(folder, NotebookFiles.pdfName(title));
    const temp = tmpName(folder, '.note-');
    try {
      const doc = await PDFDocument.create({ updateMetadata: false });
      doc.setProducer('Everynote'); doc.setCreator('Everynote');
      const info = infoDict(doc);
      info.set(PDFName.of('PDFNoteNotebook'), PDFString.of('true'));
      info.set(PDFName.of('PDFNotePaper'), PDFString.of(paper.spec().replace(/[\\()]/g, m => '\\' + m)));
      const cache = {};
      for (let i = 0; i < pages; i++) await addPaper(doc, paper, -1, cache);
      await host.writeBytes(temp, await doc.save({ useObjectStreams: false }));
      await NotebookFiles.replace(temp, target);
      return target;
    } finally { await quietDelete(temp); }
  },
  async append(file, paper) {
    const doc = await loadForEdit(file, '페이지 추가가 허용되지 않는 PDF입니다');
    await addPaper(doc, paper);
    return NotebookFiles._save(doc, file);
  },
  /** Inserts a blank paper page right after afterIndex (the last page when out of range). */
  async insert(file, paper, afterIndex) {
    const doc = await loadForEdit(file, '페이지 추가가 허용되지 않는 PDF입니다');
    await addPaper(doc, paper, Math.min(afterIndex, doc.getPageCount() - 1));
    return NotebookFiles._save(doc, file);
  },
  /** Deletes one page and returns the remaining page count. The last remaining page cannot be deleted. */
  async delete(file, index) {
    const doc = await loadForEdit(file, '페이지 삭제가 허용되지 않는 PDF입니다');
    if (index < 0 || index >= doc.getPageCount()) throw new IOException('삭제할 페이지가 없습니다');
    if (doc.getPageCount() <= 1) throw new IOException('마지막 한 페이지는 삭제할 수 없습니다');
    doc.removePage(index);
    return NotebookFiles._save(doc, file);
  },
  async _save(doc, file) {
    const temp = tmpName(parentOf(file), '.page-');
    try {
      const count = doc.getPageCount();
      await host.writeBytes(temp, await doc.save({ useObjectStreams: false }));
      await NotebookFiles.replace(temp, file);
      return count;
    } finally { await quietDelete(temp); }
  },
  /** Files.move(temp, target, ATOMIC_MOVE, REPLACE_EXISTING) */
  async replace(temp, target) {
    try { await host.move(temp, target); }
    catch (e) { await host.delete(target); await host.move(temp, target); }
  },
};

// ---------------------------------------------------------------- LibraryRepository
export class TrashItem {
  constructor(file, name, parent, deleted) { this.file = file; this.name = name; this.parent = parent; this.deleted = deleted; }
}

export class LibraryRepository {
  static SORT_NAMES = ['이름 오름차순', '이름 내림차순', '최근 수정', '최근 열기'];
  static VIEW_NAMES = ['큰 표지', '작은 표지', '목록'];
  static FOLDER_COLORS = [0xFF8FA8F0, 0xFFF4B67E, 0xFF7FCFB2, 0xFFB9A0F2, 0xFFF2A3BA, 0xFFA6B2C6].map(asInt);
  static LEGACY_FOLDER_COLORS = [0xFF5C86BE, 0xFFDA9A43, 0xFF54A485, 0xFF9272C3, 0xFFD36D86, 0xFF718096].map(asInt);
  static FOLDER_COLOR_NAMES = ['블루', '오렌지', '그린', '퍼플', '로즈', '그레이'];

  constructor() {
    this.root = null;
    this._prefs = {};
    this._dirs = new Map();   // path key -> isDir, filled by list() (so the UI can answer File.isDirectory() synchronously)
    this._lock = Promise.resolve();
    this._save = Promise.resolve();
    this.ready = this._init();
  }
  async _init() {
    const info = await host.info();
    this.dataDir = info.data;
    this.prefsFile = joinP(info.data, 'library.json');
    this.root = await NotebookFiles.root();
    try { this._prefs = JSON.parse(await host.readText(this.prefsFile)) || {}; } catch { this._prefs = {}; }
    return this;
  }

  // ---- preferences (SharedPreferences "pdf_note_library"), persisted to <data>\library.json
  _get(k, d) { const v = this._prefs[k]; return v === undefined ? d : v; }
  _put(k, v) { if (v === null || v === undefined) delete this._prefs[k]; else this._prefs[k] = v; this._persist(); }
  _persist() {
    clearTimeout(this._t);
    this._t = setTimeout(() => this.flush(), 60);
  }
  /** writes library.json now (also awaited by tests) */
  flush() {
    clearTimeout(this._t);
    const text = JSON.stringify(this._prefs);
    this._save = this._save.then(async () => { try { await host.mkdir(this.dataDir); await host.writeText(this.prefsFile, text); } catch (e) { host.log('library.json: ' + e.message); } });
    return this._save;
  }
  /** `synchronized` */
  _sync(fn) { const run = this._lock.then(fn, fn); this._lock = run.catch(() => {}); return run; }

  // ---- paths
  managed(file) { const k = pathKey(file), r = pathKey(this.root); return k.startsWith(r + '\\'); }
  async _folder(folder) {
    if (!(samePath(folder, this.root) || this.managed(folder)) || !(await isDirectory(folder))) throw new IOException('문서함 폴더를 선택하세요');
  }
  /** File.isDirectory() for a path returned by list() / sorted() / ... (cached) */
  isDirectory(path) { return this._dirs.get(pathKey(path)) === true; }
  async _entries(directory) {
    let files;
    try { files = await host.list(directory); } catch { files = []; }
    const out = [];
    for (const f of files) {
      const name = f.name;
      if (name.startsWith('.')) continue;
      if (!(f.isDir || name.toLowerCase().endsWith('.pdf'))) continue;
      const path = joinP(directory, name);
      this._dirs.set(pathKey(path), !!f.isDir);
      out.push({ name, path, isDir: !!f.isDir, mtime: f.mtime || 0, size: f.size || 0 });
    }
    out.sort((a, b) => (a.isDir === b.isDir ? 0 : a.isDir ? -1 : 1) || jcmp(a.name, b.name));
    return out;
  }
  /** directories first, then names (case-insensitive); hidden (.xxx) entries and non-pdf files are skipped */
  async list(directory) { return (await this._entries(directory)).map(e => e.path); }

  // ---- settings
  sortMode(v) { if (v === undefined) return Math.max(0, Math.min(3, this._get('sort', 0) | 0)); this._put('sort', v | 0); }
  viewMode(v) { if (v === undefined) return Math.max(0, Math.min(2, this._get('view', 0) | 0)); this._put('view', v | 0); }
  pinFavorites(v) { if (v === undefined) return !!this._get('pin_favorites', false); this._put('pin_favorites', !!v); }
  folderColor(folder, color) {
    const key = 'color:' + normPath(folder);
    if (color === undefined) {
      const saved = this._get(key, LibraryRepository.FOLDER_COLORS[0]) | 0;
      const i = LibraryRepository.LEGACY_FOLDER_COLORS.indexOf(saved);
      return i >= 0 ? LibraryRepository.FOLDER_COLORS[i] : saved;
    }
    this._put(key, color | 0);
  }
  favorite(file, on) {
    const key = 'fav:' + normPath(file);
    if (on === undefined) return !!this._get(key, false);
    this._put(key, on ? true : null);
  }
  /** SharedPreferences "opened:<path>" (0 if never) */
  openedAt(file) { return this._get('opened:' + normPath(file), 0) || 0; }
  /** library.opened(uri): stamp "recently opened" for managed documents */
  opened(uri) { if (this.managed(uri)) this._put('opened:' + normPath(uri), Date.now()); }

  // ---- queries
  /** max(file.lastModified, sidecar.lastModified) */
  async modified(file) {
    let m = 0;
    try { const s = await host.stat(file); m = s.exists ? s.mtime : 0; } catch { /* ignore */ }
    return Math.max(m, await Sidecars.modified(file));
  }
  async _mods(paths) {
    const map = new Map();
    for (let i = 0; i < paths.length; i += 24) await Promise.all(paths.slice(i, i + 24).map(async p => map.set(pathKey(p), await this.modified(p))));
    return map;
  }
  /** returns a comparator(a,b) over path strings (Java order()) */
  async _order(paths) {
    const pin = this.pinFavorites(), mode = this.sortMode();
    const mods = (mode === 2) ? await this._mods(paths) : null;
    const byName = (a, b) => jcmp(baseName(a), baseName(b));
    let base = byName;
    if (mode === 1) base = (a, b) => byName(b, a);
    else if (mode === 2) base = (a, b) => (mods.get(pathKey(b)) - mods.get(pathKey(a))) || byName(a, b);
    else if (mode === 3) base = (a, b) => (this.openedAt(b) - this.openedAt(a)) || byName(a, b);
    return pin ? (a, b) => ((this.favorite(a) ? 0 : 1) - (this.favorite(b) ? 0 : 1)) || base(a, b) : base;
  }
  /** Folder view: sub-folders first, then documents, filtered by name substring, in the current sort order. */
  async sorted(directory, query = '') {
    let items = await this.list(directory);
    const q = String(query).trim().toLowerCase();
    items = items.filter(f => baseName(f).toLowerCase().includes(q));
    const cmp = await this._order(items);
    return items.sort((a, b) => ((this.isDirectory(a) ? 0 : 1) - (this.isDirectory(b) ? 0 : 1)) || cmp(a, b));
  }
  /** Every PDF and note in the library, whatever folder it lives in (the trash is excluded), in the current sort order. */
  async allDocuments(query = '') {
    const items = [];
    const walk = async dir => { for (const f of await this.list(dir)) { if (this.isDirectory(f)) await walk(f); else items.push(f); } };
    await walk(this.root);
    const q = String(query).trim().toLowerCase();
    const filtered = items.filter(f => baseName(f).toLowerCase().includes(q));
    return filtered.sort(await this._order(filtered));
  }
  async favorites(query = '') { return (await this.allDocuments(query)).filter(f => this.favorite(f)); }
  /** The most recently opened or edited documents, newest first. */
  async recent(query = '', limit = 40) {
    const items = await this.allDocuments(query);
    const mods = await this._mods(items);
    const t = f => Math.max(this.openedAt(f), mods.get(pathKey(f)) || 0);
    items.sort((a, b) => t(b) - t(a));
    return items.length > limit ? items.slice(0, limit) : items;
  }
  async folderCount() {
    const count = async d => { let n = 0; for (const i of await this.list(d)) if (this.isDirectory(i)) n += 1 + await count(i); return n; };
    return count(this.root);
  }

  // ---- trash
  async _trashFolder() { const f = joinP(this.root, '.trash'); await host.mkdir(f); return f; }
  _inTrash(file) { return pathKey(file).startsWith(pathKey(joinP(this.root, '.trash')) + '\\'); }
  trash(source) {
    return this._sync(async () => {
      if (this._inTrash(source)) throw new IOException('이미 휴지통에 있습니다');
      const name = baseName(source), parent = parentOf(source);
      const saved = await this._transfer(source, await this._trashFolder(), uuid().replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, '$1-$2-$3-$4-$5') + '.pdf', true);
      this._put('trash:' + normPath(saved), JSON.stringify({ name, parent, deleted: Date.now() }));
      await this.flush();
      return saved;
    });
  }
  async trashItems() {
    const result = [];
    for (const e of await this._entries(await this._trashFolder())) {
      if (e.isDir) continue;
      let info = null;
      try { info = JSON.parse(this._get('trash:' + normPath(e.path), '{}')); } catch { info = null; }
      result.push(info ? new TrashItem(e.path, info.name ?? e.name, info.parent ?? this.root, info.deleted ?? e.mtime) : new TrashItem(e.path, e.name, this.root, e.mtime));
    }
    return result.sort((a, b) => b.deleted - a.deleted);
  }
  restore(item) {
    return this._sync(async () => {
      if (!this._inTrash(item.file)) throw new IOException('휴지통 문서가 아닙니다');
      let destination = item.parent;
      if (!(await isDirectory(destination)) || !(samePath(destination, this.root) || this.managed(destination))) destination = this.root;
      const target = await NotebookFiles.unique(destination, NotebookFiles.pdfName(item.name));
      const restored = await this._transfer(item.file, destination, baseName(target), true);
      this._put('trash:' + normPath(item.file), null);
      await this.flush();
      return restored;
    });
  }
  /** Extra (not in the Android UI): remove a trashed document for good, together with its annotation sidecar. */
  purge(item) {
    return this._sync(async () => {
      if (!this._inTrash(item.file)) throw new IOException('휴지통 문서가 아닙니다');
      await quietDelete(item.file); await Sidecars.remove(item.file);
      for (const p of ['fav:', 'paper:', 'opened:', 'trash:']) this._put(p + normPath(item.file), null);
      await this.flush();
    });
  }
  async emptyTrash() { for (const i of await this.trashItems()) await this.purge(i); }

  // ---- creation
  createFolder(parent, title) {
    return this._sync(async () => {
      await this._folder(parent);
      const result = joinP(parent, NotebookFiles.name(title));
      if ((await exists(result))) throw new IOException('같은 이름의 폴더가 있습니다');
      try { await host.mkdir(result); } catch { throw new IOException('같은 이름의 폴더가 있습니다'); }
      this._dirs.set(pathKey(result), true);
      return result;
    });
  }
  createNote(parent, title, paper) {
    return this._sync(async () => {
      await this._folder(parent);
      const file = await NotebookFiles.create(parent, title, 1, paper);
      this._putPaper(file, paper); await this.flush();
      return file;
    });
  }
  /** Paper of a note created in-app (or imported with notebook metadata); null for plain PDFs */
  paper(file) {
    const value = this._get('paper:' + normPath(file), null);
    if (value == null) return null;
    try { return Paper.parse(value); } catch { return null; }
  }
  _putPaper(file, paper) { this._put('paper:' + normPath(file), paper.spec()); }

  // ---- import
  /** library copy created earlier for this external source path (or null) */
  async imported(uri) {
    const path = this._get('source:' + normPath(uri), null);
    if (!path) return null;
    return this.managed(path) && !this._inTrash(path) && await isFile(path) ? path : null;
  }
  importPdf(source, title, destination) {
    return this._sync(async () => {
      await this._folder(destination);
      const existing = await this.imported(source);
      if (existing) return existing;
      let safe = String(title).replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_'); // eslint-disable-line no-control-regex
      if (safe.trim() === '') safe = '문서.pdf';
      if (safe.length > 90) safe = safe.slice(0, 86) + '.pdf';
      const target = await NotebookFiles.unique(destination, NotebookFiles.pdfName(safe));
      const temp = tmpName(destination, '.import-');
      let paper = null, count;
      try {
        try { await host.copy(source, temp); } catch { throw new IOException('PDF를 읽을 수 없습니다'); }
        let doc, bytes;
        try { bytes = await host.readBytes(temp); paper = await readNotebookPaper(bytes); doc = await (await import('./pdfdoc.js')).PdfDoc.open(bytes); /* pdf.js detaches the buffer */ } catch { throw new IOException('PDF를 읽을 수 없습니다'); }
        try {
          count = doc.pageCount;
          if (count === 0) throw new IOException('빈 PDF입니다');
        } finally { doc.destroy(); }
        await Sidecars.copy(source, target, count);
        await NotebookFiles.replace(temp, target);
        if (paper) this._putPaper(target, paper);
        this._put('source:' + normPath(source), normPath(target));
        await this.flush();
        return target;
      } finally { await quietDelete(temp); }
    });
  }

  // ---- rename / move / copy
  transfer(source, destination, title, move) { return this._sync(() => this._transfer(source, destination, title, move)); }
  async _transfer(source, destination, title, move) {
    await this._folder(destination);
    if (!this.managed(source) || !(await isFile(source))) throw new IOException('저장된 PDF를 선택하세요');
    const name = NotebookFiles.pdfName(title);
    const exact = joinP(destination, name);
    if (move && samePath(source, exact)) return normPath(source);
    const target = move ? exact : await NotebookFiles.unique(destination, name);
    if (move && await exists(target)) throw new IOException('같은 이름의 PDF가 있습니다');
    if (move) {
      try { await host.move(source, target); } catch { throw new IOException('원본을 이동할 수 없습니다'); }
      await Sidecars.move(source, target);
      const s = normPath(source), t = normPath(target);
      const paper = this.paper(s);
      const fav = this._get('fav:' + s, false), opened = this._get('opened:' + s, 0);
      this._put('fav:' + s, null); this._put('paper:' + s, null); this._put('opened:' + s, null);
      if (paper) this._putPaper(t, paper);
      this._put('opened:' + t, opened);
      if (fav) this._put('fav:' + t, true);
      for (const [k, v] of Object.entries(this._prefs)) if (k.startsWith('source:') && typeof v === 'string' && samePath(v, s)) this._prefs[k] = t;
      await this.flush();
      return t;
    }
    const temp = tmpName(destination, '.copy-');
    try {
      await host.copy(source, temp);
      await NotebookFiles.replace(temp, target);
      const paper = this.paper(source);
      if (paper) this._putPaper(target, paper);
      await Sidecars.copy(source, target);
      await this.flush();
      return target;
    } finally { await quietDelete(temp); }
  }

  // ---- page operations on library notes / PDFs
  async _managedFile(file) { if (!this.managed(file) || !(await isFile(file))) throw new IOException('저장된 PDF가 아닙니다'); }
  insertPage(file, requested, afterIndex) { return this._sync(async () => { await this._managedFile(file); return NotebookFiles.insert(file, requested, afterIndex); }); }
  deletePage(file, index) { return this._sync(async () => { await this._managedFile(file); return NotebookFiles.delete(file, index); }); }
  append(file, requested) { return this._sync(async () => { await this._managedFile(file); return NotebookFiles.append(file, requested); }); }
}
