// Port of LibraryDialog.java, FolderTreeView.java, FolderIconDrawable.java, FolderShapeDrawable.java, PaperChoiceView.java.
// Visual spec: spec/library.md (sections 2-8). Styles: css/library.css (linked by index.html).
//
//   const dlg = new LibraryDialog(activity, library, folderPath, actions);  dlg.show();
//   actions = { open(file), importFiles(folder), newNote(folder, refresh), changed(src, tgt, moved), selectedFolder(folder), removed(files) }
import { h, icon, argb, baseName } from './util.js';
import { ICONS } from './icons.js';
import { host } from './host.js';
import { AlertDialog, BUTTON_POSITIVE } from './ui/alert.js';
import { AnchoredMenu } from './ui/menu.js';
import { toast } from './ui/toast.js';
import { LibraryRepository, NotebookFiles, Paper, Sidecars, samePath, pathKey, parentOf, joinP, sha1Hex } from './library.js';

const INK = '#1C1C1E', MUTED = '#8E8E93', ACCENT = '#007AFF';
const ALL = 0, FAVORITES = 1, RECENT = 2, FOLDER = 3;
const LONG_TOAST = 3500;

// ================================================================= drawables (SVG) =================================================================
const ch = c => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
const rgbHex = a => '#' + a.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
const shade = (c, f) => rgbHex(ch(c).map(v => Math.round(v * f)));
const light = (c, f) => rgbHex(ch(c).map(v => Math.round(v + (255 - v) * f)));
let gradSeq = 0;

/** FolderIconDrawable(color, size): 64x64 virtual canvas, tree icon. */
export class FolderIconDrawable {
  constructor(color, size) { this.color = color | 0; this.size = size; }
  getIntrinsicWidth() { return this.size; }
  getIntrinsicHeight() { return this.size; }
  /** SVG markup, optionally at another pixel size */
  svg(size = this.size) {
    const c = this.color, id = 'fi' + (gradSeq++);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" style="display:block;flex:none">`
      + `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="27" x2="0" y2="54"><stop offset="0" stop-color="${light(c, .16)}"/><stop offset="1" stop-color="${rgbHex(ch(c))}"/></linearGradient></defs>`
      + `<rect x="5" y="46" width="54" height="10" rx="6" ry="6" fill="#0F172A" fill-opacity="${(20 / 255).toFixed(4)}"/>`
      + `<path d="M8,14 Q8,10 12,10 L25,10 Q28,10 30,14 L32,17 L52,17 Q57,17 57,22 L57,49 Q57,53 53,53 L12,53 Q8,53 8,49 Z" fill="${shade(c, .84)}"/>`
      + `<rect x="13" y="20" width="39" height="22" rx="3" ry="3" fill="#EFF5FC"/>`
      + `<path d="M9,27 L55,27 Q60,27 59,32 L56,50 Q55,54 51,54 L12,54 Q8,54 7,50 L4,32 Q3,27 9,27 Z" fill="url(#${id})"/>`
      + `<rect x="10" y="29" width="44" height="2" rx="1" ry="1" fill="#fff" fill-opacity="${(65 / 255).toFixed(4)}"/></svg>`;
  }
  /** element (span) ready to insert */
  el(size = this.size) { const s = h('span', { class: 'ico', style: `display:inline-flex;width:${size}px;height:${size}px;flex:none` }); s.innerHTML = this.svg(size); return s; }
}

/** FolderShapeDrawable(color): shelf folder, fills the whole w x h box (not uniformly scaled). */
export class FolderShapeDrawable {
  constructor(color) { this.color = color | 0; }
  svg(w, hh, cls = '') {
    const c = this.color, id = 'fs' + (gradSeq++), r = w * .09, f = v => +v.toFixed(2);
    const mix = t => light(c, t);
    const rr = (x0, y0, x1, y1, rad, fill) => `<rect x="${f(x0)}" y="${f(y0)}" width="${f(x1 - x0)}" height="${f(y1 - y0)}" rx="${f(rad)}" ry="${f(rad)}" fill="${fill}"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" class="${cls}" width="${f(w)}" height="${f(hh)}" viewBox="0 0 ${f(w)} ${f(hh)}">`
      + `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${f(hh * .3)}" x2="0" y2="${f(hh)}"><stop offset="0" stop-color="${mix(.8)}"/><stop offset="1" stop-color="${mix(.6)}"/></linearGradient></defs>`
      + rr(0, hh * .1, w, hh, r, mix(.5)) + rr(0, 0, w * .42, hh * .22, r * .8, mix(.5))
      + rr(w * .12, hh * .2, w * .88, hh * .6, r * .6, '#FFFFFF')
      + rr(w * .18, hh * .15, w * .82, hh * .5, r * .6, '#F2F2F7')
      + rr(w * .12, hh * .22, w * .88, hh * .6, r * .6, '#FFFFFF')
      + rr(0, hh * .3, w, hh, r, `url(#${id})`) + '</svg>';
  }
  /** element holding the SVG */
  el(w, hh, cls = '') { const s = h('span', { style: `display:block;width:${w}px;height:${hh}px;line-height:0` }); s.innerHTML = this.svg(w, hh, cls); return s; }
}

// ================================================================= small UI helpers =================================================================
/** Long press (touch / mouse hold 450 ms) or right click. fn(el, event). A click that ends a long press is swallowed. */
function onLongPress(el, fn) {
  let timer = null, sx = 0, sy = 0, fired = 0, swallow = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  el.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    swallow = false; sx = e.clientX; sy = e.clientY; cancel();
    timer = setTimeout(() => { timer = null; fired = Date.now(); swallow = true; fn(el, e); }, 450);
  });
  el.addEventListener('pointermove', e => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) cancel(); });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(t, cancel);
  el.addEventListener('contextmenu', e => { e.preventDefault(); if (Date.now() - fired < 800) return; fired = Date.now(); fn(el, e); });
  el.addEventListener('click', e => { if (swallow) { swallow = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
}

/** Replace the click behaviour of an AlertDialog button (Android: getButton(which).setOnClickListener) so it no longer auto-dismisses. */
export function rebindButton(dialog, which, fn) {
  const old = dialog.getButton(which), neu = old.cloneNode(true);
  old.replaceWith(neu); dialog.buttons[-which - 1] = neu;
  neu.addEventListener('click', fn);
  return neu;
}

/** single-line EditText with Android-style setError (red text below). */
export function inputField({ hint = '', text = '', label = null, cls = '' } = {}) {
  const input = h('input', { class: 'lib-in', type: 'text', placeholder: hint, value: text, spellcheck: 'false', 'aria-label': label || hint });
  input.value = text;
  const err = h('div', { class: 'lib-err' });
  const view = h('div', { class: 'lib-inwrap ' + cls }, input, err);
  input.addEventListener('input', () => { err.classList.remove('on'); input.classList.remove('bad'); });
  return { view, input, setError(m) { err.textContent = m || ''; err.classList.toggle('on', !!m); input.classList.toggle('bad', !!m); input.focus(); } };
}

/** android.app.ProgressDialog (modal, not cancelable, spinner + message) */
export const ProgressDialog = {
  show(title, message) {
    const root = h('div', { class: 'lib-prog', role: 'alertdialog', 'aria-label': message },
      h('div', { class: 'card' }, h('div', { class: 'lib-spin' }), h('div', { class: 'msg' }, message)));
    document.body.append(root);
    return { dismiss() { root.remove(); }, setMessage(m) { root.querySelector('.msg').textContent = m; } };
  },
};

function checkboxEl(on, label, click, cls = '') {
  const b = h('div', { class: 'lib-check ' + cls + (on ? ' on' : ''), role: 'checkbox', 'aria-checked': String(!!on), 'aria-label': label },
    h('i', null, icon('ic_check_bold', 14, '#fff')));
  b.addEventListener('click', e => { e.stopPropagation(); click(); });
  return b;
}

function dateText(time) {
  const now = new Date(), then = new Date(time);
  if (now.getFullYear() === then.getFullYear() && now.getMonth() === then.getMonth() && now.getDate() === then.getDate()) {
    const hr = then.getHours(), mm = String(then.getMinutes()).padStart(2, '0');
    return `${hr < 12 ? '오전' : '오후'} ${hr % 12 === 0 ? 12 : hr % 12}:${mm}`;
  }
  if (now.getFullYear() === then.getFullYear()) return `${then.getMonth() + 1}월 ${then.getDate()}일`;
  return `${then.getFullYear()}. ${then.getMonth() + 1}. ${then.getDate()}`;
}
export { dateText };

const stripPdf = n => n.replace(/\.pdf$/i, '');

// ================================================================= PaperChoiceView =================================================================
const TEMPLATE_LABEL = 'PDF·이미지 서식 고르기';
let templateDir = null;   // <data>\\templates, known after the first host.info()
const templateDirReady = () => templateDir ? Promise.resolve(templateDir) : host.info().then(i => (templateDir = i.data.replace(/[\\/]+$/, '') + '\\templates'));
const BUILTIN_BASE = new URL('../assets/templates/', import.meta.url).href;
const pdfPreviews = new Map();
export class PaperChoiceView {
  constructor(activity) {
    this.kind = 0; this.color = -1; this.selected = -1; this.builtin = null;
    // Android v1.32.0: the paper list is a menu card (bundled form templates first), not a native select
    const picker = h('div', { class: 'lib-picker', role: 'button', 'aria-label': '종이 형식', dataset: { tag: 'paper_picker' } });
    picker.addEventListener('click', () => {
      const R = AnchoredMenu.Row;
      AnchoredMenu.show(picker, false, NotebookFiles.PAPER_ORDER.map((k, i) => new R(NotebookFiles.PAPER_NAMES[k], k >= 10 ? 'ic_page' : k === NotebookFiles.CUSTOM ? 'ic_import' : 'ic_note_add', () => this.selectPosition(i))
        .tint(k >= 10 ? '#007AFF' : k === NotebookFiles.CUSTOM ? '#FF9500' : '#34C759').selected(i === this.selected)), null);
    });
    this.picker = picker;
    this.template = null; this._request = null;
    this.templateButton = h('div', { class: 'lib-tplbtn', role: 'button', style: { display: 'none' }, dataset: { tag: 'paper_template' } }, TEMPLATE_LABEL);
    this.templateButton.addEventListener('click', () => this._pickTemplate());
    this.canvas = h('canvas', { 'aria-label': '선택한 종이 미리보기', role: 'img' });
    this.chips = h('div', { class: 'lib-chips' });
    this.el = h('div', { class: 'lib-paper' }, picker, this.templateButton, this.canvas, this.chips);
    this.refreshColors();
    this.selectPosition(0);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.draw()).observe(this.canvas);
    requestAnimationFrame(() => this.draw());
  }
  /** Chooses a paper by its row in the list (the bundled form templates come first). */
  selectPosition(position) {
    this.selected = position; this.kind = NotebookFiles.PAPER_ORDER[position];
    this.picker.textContent = NotebookFiles.PAPER_NAMES[this.kind] + '  ▾';
    this.templateButton.style.display = this.kind === NotebookFiles.CUSTOM ? '' : 'none';
    this.builtin = null;
    if (this.kind >= 10) this._prepareBuiltin(this.kind);
    this.draw();
  }
  /** Chooses a paper by its kind. */
  selectKind(kind) { const i = NotebookFiles.PAPER_ORDER.indexOf(kind); if (i >= 0) this.selectPosition(i); }
  /** Copies the bundled form PDF into <data>\\templates once so it behaves like a user-chosen template. */
  async _prepareBuiltin(kind) {
    try {
      const name = NotebookFiles.BUILTIN_TEMPLATES[kind - 10], dir = await templateDirReady(), file = dir + '\\builtin-' + name;
      if (!(await host.exists(file))) { await host.mkdir(dir); await host.writeBytes(file, new Uint8Array(await (await fetch(BUILTIN_BASE + name)).arrayBuffer())); }
      if (this.kind === kind) this.builtin = file;
      this.draw();
    } catch (e) { if (this.kind === kind) this.builtin = null; }
  }
  async _previewOf(key, loader) {
    if (pdfPreviews.has(key)) return pdfPreviews.get(key);
    let canvas = null;
    try {
      const { PdfDoc } = await import('./pdfdoc.js');
      const doc = await PdfDoc.open(await loader()); const size = await doc.pageSize(0);
      canvas = await doc.renderPage(0, 300 / size.w);
    } catch (e) { canvas = null; }
    pdfPreviews.set(key, canvas); return canvas;
  }
  /** NotebookFiles.Paper */
  paper() {
    if (this.kind >= 10) { if (!this.builtin) throw new Error('서식 파일을 준비하는 중입니다. 잠시 후 다시 시도하세요'); return new Paper(NotebookFiles.CUSTOM, -1, this.builtin); }
    return new Paper(this.kind, this.color, this.template);
  }
  /**
   * Called when the user taps "PDF·이미지 서식 고르기"; the host opens a file picker and answers with setTemplate(path).
   * Without a request handler the view opens the file dialog itself, copies the pick into the app (NotebookFiles.importTemplate) and calls setTemplate.
   */
  onTemplateRequest(request) { this._request = request; }
  /** path of the PDF or image to use as the page background of every new page (null clears it). */
  setTemplate(file) {
    this.template = file || null;
    this.templateButton.textContent = file ? '서식: ' + baseName(file) + ' · 다시 고르기' : TEMPLATE_LABEL;
    this.draw();
  }
  async _pickTemplate() {
    if (this._request) { this._request(); return; }
    let r; try { r = await host.openDialog('서식으로 쓸 PDF·이미지', [{ name: 'PDF·이미지', exts: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }], false); } catch (e) { return; }
    if (!r || !r[0]) return;
    try { this.setTemplate(await NotebookFiles.importTemplate(r[0])); } catch (e) { toast(e && e.message || '서식 파일을 읽을 수 없습니다'); }
  }
  refreshColors() {
    this.chips.textContent = '';
    NotebookFiles.COLORS.forEach((c, i) => {
      const on = this.color === c;
      const chip = h('div', { class: 'lib-chip' + (on ? ' on' : ''), role: 'button', 'aria-label': '배경색 ' + NotebookFiles.COLOR_NAMES[i], dataset: { tag: 'paper_color:' + i }, style: { background: argb(c) } }, on ? icon('ic_check_bold', 18, ACCENT) : null);
      chip.addEventListener('click', () => { this.color = c; this.refreshColors(); this.draw(); });
      this.chips.append(chip);
    });
  }
  draw() {
    const cv = this.canvas, dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight || 158;
    if (!W) return;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const hh = H - 12, w = hh * 595 / 842, left = (W - w) / 2, top = 6, right = left + w, bottom = top + hh;
    g.fillStyle = argb(this.color); g.fillRect(left, top, w, hh);
    g.strokeStyle = '#BBC4CE'; g.lineWidth = 1 / dpr; g.beginPath();
    g.rect(left, top, w, hh);
    g.stroke();
    const formFile = this.kind >= 10 ? NotebookFiles.BUILTIN_TEMPLATES[this.kind - 10] : (this.kind === NotebookFiles.CUSTOM && this.template && /\.pdf$/i.test(this.template) ? this.template : null);
    if (formFile) {
      const key = this.kind >= 10 ? 'builtin:' + formFile : 'file:' + formFile, drawn = this.kind;
      if (pdfPreviews.has(key) && pdfPreviews.get(key)) { g.drawImage(pdfPreviews.get(key), left, top, w, hh); g.strokeStyle = '#BBC4CE'; g.strokeRect(left, top, w, hh); return; }
      if (!pdfPreviews.has(key)) this._previewOf(key, async () => this.kind >= 10 ? new Uint8Array(await (await fetch(BUILTIN_BASE + formFile)).arrayBuffer()) : host.readBytes(formFile)).then(() => { if (this.kind === drawn) this.draw(); });
    }
    if (this.kind === NotebookFiles.CUSTOM) {
      g.fillStyle = MUTED; g.font = '11px sans-serif'; g.textAlign = 'center';
      g.fillText(this.template ? baseName(this.template) : '서식을 고르세요', (left + right) / 2, (top + bottom) / 2); g.textAlign = 'left';
      return;
    }
    const f = hh / 842, fw = w / 595;
    for (const seg of NotebookFiles.layout(this.kind, 595, 842)) {
      const c = NotebookFiles.ruleColorOn(seg[4], this.color);
      g.strokeStyle = g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      const x1 = left + seg[0] * fw, y1 = bottom - seg[1] * f, x2 = left + seg[2] * fw, y2 = bottom - seg[3] * f;
      if (seg[4] === 3) { g.beginPath(); g.arc(x1, y1, Math.max(.6, fw * .9), 0, Math.PI * 2); g.fill(); }
      else { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
    }
  }
}

// ================================================================= FolderTreeView =================================================================
export class FolderTreeView {
  /** @param listener function(folderPath) called when a folder row is clicked */
  constructor(activity, repository, selected, listener) {
    this.repository = repository; this.listener = listener || (() => {}); this.sel = selected; this.menu = null;
    this.expandedSet = new Set(); this._v = 0;
    this.rows = h('div', { class: 'rows' });
    this.el = h('div', { class: 'lib-tree' }, this.rows);
    this._expandAncestors(selected);
    this.ready = this.reload();
  }
  setFolderMenu(fn) { this.menu = fn; }
  selected() { return this.sel; }
  _expandAncestors(folder) {
    const root = pathKey(this.repository.root);
    for (let p = folder; p; p = parentOf(p)) { this.expandedSet.add(pathKey(p)); if (pathKey(p) === root || !parentOf(p) || parentOf(p) === p) break; }
  }
  select(folder) { this.sel = folder; this._expandAncestors(folder); return this.reload(); }
  async reload() {
    const v = ++this._v, rows = [];
    await this._add(rows, this.repository.root, 0);
    if (v !== this._v) return;
    this.rows.replaceChildren(...rows);
  }
  async _add(out, folder, depth) {
    const repo = this.repository;
    const children = [];
    for (const f of await repo.list(folder)) if (repo.isDirectory(f)) children.push(f);
    const isSel = this.sel && samePath(folder, this.sel), isRoot = samePath(folder, repo.root);
    const expanded = this.expandedSet.has(pathKey(folder));
    const name = isRoot ? '모든 문서' : baseName(folder);
    const arrow = h('div', { class: 'arrow', 'aria-label': baseName(folder) + ' 하위 폴더 펼치기' }, children.length ? icon(expanded ? 'ic_chevron_down' : 'ic_chevron_right', 18, MUTED) : null);
    arrow.addEventListener('click', () => { const k = pathKey(folder); if (!this.expandedSet.delete(k)) this.expandedSet.add(k); this.reload(); });
    const fname = h('div', { class: 'fname', 'aria-label': '폴더 ' + name }, new FolderIconDrawable(repo.folderColor(folder), 26).el(), h('span', { class: 't' }, name));
    fname.addEventListener('click', () => { this.sel = folder; this.reload(); this.listener(folder); });
    onLongPress(fname, el => { if (this.menu) this.menu(folder, el); });
    out.push(h('div', { class: 'lib-trow' + (isSel ? ' sel' : ''), style: { paddingLeft: Math.min(depth, 12) * 12 + 'px' } }, arrow, fname));
    if (expanded) for (const c of children) await this._add(out, c, depth + 1);
  }
}

// ================================================================= cover thumbnails =================================================================
const coverCache = new Map(); // key -> {url, bytes}
let coverBytes = 0;
const COVER_LIMIT = 12 * 1024 * 1024;
function coverPut(key, url, bytes) {
  coverCache.set(key, { url, bytes }); coverBytes += bytes;
  while (coverBytes > COVER_LIMIT && coverCache.size > 1) { const k = coverCache.keys().next().value; coverBytes -= coverCache.get(k).bytes; coverCache.delete(k); }
}
const coverGet = key => { const v = coverCache.get(key); if (v) { coverCache.delete(key); coverCache.set(key, v); } return v ? v.url : null; };
export function clearCoverCache() { coverCache.clear(); coverBytes = 0; }

/** Hook that draws the annotations of page 0 onto a cover canvas: async (ctx, w, h, path). Replaceable (tests / other store versions). */
export const coverOverlay = {
  async fn(ctx, w, hh, path) {
    const [{ AnnotationPainter }, { AnnotationStore }, { RectF }] = await Promise.all([import('./painter.js'), import('./store.js'), import('./util.js')]);
    const store = new AnnotationStore(); await store.open(path);
    try { await AnnotationPainter.preload(store, 0); } catch { /* ignore */ }
    AnnotationPainter.all(ctx, new RectF(0, 0, w, hh), store, 0);
  },
};

async function renderCover(path) {
  const { PdfDoc } = await import('./pdfdoc.js');
  const doc = await PdfDoc.open(await host.readBytes(path));
  try {
    const size = await doc.pageSize(0);
    const scale = Math.min(320 / size.w, 480 / size.h);
    const canvas = await doc.renderPage(0, scale);
    try { await coverOverlay.fn(canvas.getContext('2d'), canvas.width, canvas.height, path); } catch { /* annotations optional */ }
    let out = canvas;
    if (canvas.height > canvas.width) { out = document.createElement('canvas'); out.width = canvas.width; out.height = canvas.width; out.getContext('2d').drawImage(canvas, 0, 0, canvas.width, canvas.width, 0, 0, canvas.width, canvas.width); }
    return await new Promise(res => out.toBlob(res, 'image/jpeg', 0.88));
  } finally { doc.destroy(); }
}

let thumbsDirP = null;
const thumbsDir = () => (thumbsDirP ||= host.info().then(i => joinP(i.data, 'thumbs')));

/** one-at-a-time background queue; jobs carry a generation check (Java: single-thread executor + `generation`). */
class CoverQueue {
  constructor() { this.jobs = []; this.running = false; }
  add(job) { this.jobs.push(job); if (!this.running) this._run(); }
  async _run() {
    this.running = true;
    while (this.jobs.length) { const j = this.jobs.shift(); try { await j(); } catch { /* placeholder stays */ } }
    this.running = false;
  }
}
const coverQueue = new CoverQueue();

async function loadCover(path, key) {
  let hit = coverGet(key); if (hit) return hit;
  const dir = await thumbsDir();
  const prefix = (await sha1Hex(pathKey(path))).slice(0, 16);
  const file = joinP(dir, `${prefix}-${(await sha1Hex(key)).slice(0, 16)}.jpg`);
  let bytes = null;
  try { const s = await host.stat(file); if (s.exists) bytes = await host.readBytes(file); } catch { bytes = null; }
  let blob;
  if (bytes && bytes.length) blob = new Blob([bytes], { type: 'image/jpeg' });
  else {
    blob = await renderCover(path);
    if (!blob) throw new Error('cover');
    try {
      await host.mkdir(dir);
      await host.writeBytes(file, new Uint8Array(await blob.arrayBuffer()));
      // drop outdated thumbnails of this document
      for (const f of await host.list(dir)) if (f.name.startsWith(prefix + '-') && f.name !== baseName(file)) host.delete(f.path || joinP(dir, f.name)).catch(() => {});
    } catch { /* cache is optional */ }
  }
  const url = URL.createObjectURL(blob);
  coverPut(key, url, 320 * 320 * 4);
  return url;
}

// ================================================================= LibraryDialog =================================================================
export class LibraryDialog {
  constructor(activity, repository, folder, actions) {
    this.activity = activity; this.repository = repository; this.actions = actions || {};
    this.folder = folder || repository.root; this.mode = FOLDER;
    this.selected = new Set(); this.selectionMode = false;
    this.generation = 0; this.loadVersion = 0; this.busy = false; this.showing = false; this.dismissL = null;
    this.drawerP = 0; this.drawerWidth = 320; this._items = []; this._meta = new Map(); this._anim = 0;
    this._build();
  }
  setOnDismissListener(fn) { this.dismissL = fn; return this; }
  isShowing() { return this.showing; }

  // ---------------------------------------------------------------- show / dismiss
  show() {
    if (this.showing) return;
    this.showing = true;
    document.body.append(this.el);
    this._key = e => { if (e.key === 'Escape') { e.preventDefault(); this.onBackPressed(); } };
    window.addEventListener('keydown', this._key);
    this._ro = new ResizeObserver(() => { const w = this.shelf.clientWidth; if (w !== this._lastW) { this._lastW = w; this._render(++this.generation); } });
    this._ro.observe(this.shelf);
    this.refresh();
  }
  dismiss() {
    if (!this.showing) return;
    this.showing = false; this.generation++; this.loadVersion++;
    window.removeEventListener('keydown', this._key);
    this._ro && this._ro.disconnect();
    this.el.remove();
    if (this.dismissL) this.dismissL(this);
  }
  onBackPressed() {
    if (this.drawer.classList.contains('on')) { this.closeDrawer(); return; }
    if (this.selectionMode) { this.selectionMode = false; this.selected.clear(); this.refreshGrid(); return; }
    if (this.searchRow.classList.contains('on')) { this.toggleSearch(); return; }
    if (this.mode === FOLDER && !samePath(this.folder, this.repository.root)) { this.selectFolder(parentOf(this.folder)); return; }
    this.dismiss();
  }

  // ---------------------------------------------------------------- layout
  _ib(name, label, click, extra = '') {
    const b = h('button', { class: 'lib-ib ' + extra, 'aria-label': label, title: label, type: 'button' }, icon(name, 24, INK));
    b.addEventListener('click', e => { e.stopPropagation(); click(b); });
    return b;
  }
  _build() {
    const repo = this.repository;
    // rail
    const rail = h('div', { class: 'lib-rail' });
    rail.append(this._ib('ic_menu', '폴더 트리 보기', () => this.openDrawer(), 'sq'), h('div', { class: 'gap' }));
    const icons = ['ic_document_tab', 'ic_star_outline', 'ic_clock', 'ic_delete'], names = ['전체 문서', '즐겨찾기 문서', '최근 문서', '휴지통'];
    this.railButtons = icons.map((n, i) => {
      const b = this._ib(n, names[i], () => { if (i === 3) this.showTrash(); else this.showMode(i); }, 'sq rb'); rail.append(b); return b;
    });
    rail.append(h('div', { class: 'lib-dots' }), this._ib('ic_folder_open', '폴더 열기', () => this.openDrawer(), 'sq fo'));
    this.rail = rail;
    // top bar
    const top = h('div', { class: 'lib-top' },
      this._ib('ic_chevron_left', '문서함 닫기', () => this.dismiss()),
      (this.menuButton = this._ib('ic_menu', '폴더 트리 보기', () => this.openDrawer(), 'lib-menu-btn')),
      h('div', { class: 'sp' }),
      this._ib('ic_search', '문서 이름 검색', () => this.toggleSearch()),
      this._ib('ic_more_vert', '문서함 메뉴', b => this.libraryMenu(b)));
    // search row
    this.search = h('input', { class: 'lib-search', type: 'text', placeholder: '문서 이름 검색', 'aria-label': '문서 이름 입력', spellcheck: 'false' });
    this.search.addEventListener('input', () => this.refreshGrid());
    this.searchRow = h('div', { class: 'lib-searchrow' }, this.search);
    // heading
    this.upButton = h('div', { class: 'lib-up', role: 'button', 'aria-label': '상위 폴더로', dataset: { tag: 'folder_up' } });
    this.upButton.addEventListener('click', () => { if (!samePath(this.folder, repo.root)) this.selectFolder(parentOf(this.folder)); });
    this.heading = h('span', null);
    this.subtitle = h('div', { class: 'lib-sub' });
    const head = h('div', { class: 'lib-heading' }, this.upButton, h('div', { class: 'lib-title', dataset: { tag: 'library_heading' } }, this.heading), this.subtitle);
    // shelf
    this.grid = h('div', { class: 'lib-grid' });
    this.shelf = h('div', { class: 'lib-shelf' }, this.grid);
    // selection bar
    this.selectionCount = h('div', { class: 'lib-selcount' }, '0개 선택');
    this.selectionCommands = h('div', { class: 'lib-selcmds' });
    this.selectionBar = h('div', { class: 'lib-selbar' }, this.selectionCount, this.selectionCommands);
    this.page = h('div', { class: 'lib-page' }, top, this.searchRow, head, this.shelf, this.selectionBar);
    // FAB
    this.compose = h('div', { class: 'lib-fab', role: 'button', 'aria-label': '새로 만들기', dataset: { tag: 'compose_button' } }, icon('ic_compose', 26, '#E5484D'));
    this.compose.addEventListener('click', () => this.newMenu(this.compose));
    this._buildDrawer();
    this.el = h('div', { class: 'lib-root', dataset: { tag: 'library_root' } }, rail, this.page, this.compose, this.drawer);
    this._edgeDrag();
  }

  rebuildSelectionCommands() {
    this.selectionCommands.textContent = '';
    for (const action of ['전체', '즐겨찾기', '이름 변경', '공유', '복사', '이동', '삭제']) {
      if (action === '이름 변경' && this.selected.size !== 1) continue;
      const c = h('div', { class: 'lib-cmd' + (action === '삭제' ? ' red' : ''), role: 'button', 'aria-label': '선택 문서 ' + action }, action);
      c.addEventListener('click', () => this.runSelectionCommand(action));
      this.selectionCommands.append(c);
    }
  }
  async runSelectionCommand(action) {
    const files = [...this.selected], repo = this.repository;
    if (action === '전체') { for (const f of await this.items()) if (!repo.isDirectory(f)) this.selected.add(f); this._render(++this.generation); return; }
    if (!files.length) { toast('문서를 선택하세요'); return; }
    if (action === '즐겨찾기') {
      const allFavorite = files.every(f => repo.favorite(f));
      for (const f of files) repo.favorite(f, !allFavorite);
      this.selectionMode = false; this.selected.clear(); this.refresh();
      toast(allFavorite ? '즐겨찾기에서 뺐습니다' : '즐겨찾기에 추가했습니다');
    } else if (action === '이름 변경') this.rename(files[0]);
    else if (action === '공유') this.share(files);
    else if (action === '삭제') this.deleteDocuments(files);
    else this.chooseDestination(files, action === '이동');
  }

  // ---------------------------------------------------------------- drawer
  _buildDrawer() {
    const repo = this.repository;
    this.drawerScrim = h('div', { class: 'lib-scrim' });
    this.drawerScrim.addEventListener('click', () => this.closeDrawer());
    const panel = h('div', { class: 'lib-panel' });
    this.drawerPanel = panel;
    panel.append(h('div', { class: 'lib-ptop' }, this._ib('ic_menu', '폴더 트리 닫기', () => this.closeDrawer())));
    const icons = ['ic_document_tab', 'ic_star_outline', 'ic_clock', 'ic_delete'], names = ['전체 문서', '즐겨찾기', '최근 문서', '휴지통'];
    this.drawerRows = [];
    this.drawerCounts = [];
    icons.forEach((n, i) => {
      const row = this._drawerRow(n, names[i], () => { this.closeDrawer(); if (i === 3) this.showTrash(); else this.showMode(i); });
      panel.append(row.el); this.drawerRows.push(row.el); this.drawerCounts.push(row.count);
    });
    panel.append(h('div', { class: 'lib-dots' }));
    const fr = this._drawerRow('ic_folder_open', '폴더', null); panel.append(fr.el); this.drawerCounts.push(fr.count);
    this.tree = new FolderTreeView(this.activity, repo, this.folder, f => this.selectFolder(f));
    this.tree.setFolderMenu((f, el) => this.folderMenu(f, el));
    this.tree.el.classList.add('transparent', 'tree');
    panel.append(this.tree.el);
    const manage = h('div', { class: 'lib-manage', role: 'button', 'aria-label': '폴더 관리' }, '폴더 관리');
    manage.addEventListener('click', () => this.folderManageMenu(manage));
    panel.append(manage);
    this.drawerWidth = Math.min(320, Math.round(window.innerWidth * .86));
    this.drawer = h('div', { class: 'lib-drawer', dataset: { tag: 'library_drawer' } }, this.drawerScrim, panel);
  }
  _drawerRow(iconName, title, click) {
    const count = h('div', { class: 'ct' });
    const el = h('div', { class: 'lib-drow' + (click ? ' click' : ''), 'aria-label': title, dataset: { tag: 'drawer_row:' + title } }, icon(iconName, 28, INK), h('div', { class: 'nm' }, title), count);
    if (click) el.addEventListener('click', click);
    return { el, count };
  }
  async updateDrawerCounts() {
    const repo = this.repository;
    for (let i = 0; i < 4; i++) this.drawerRows[i].classList.toggle('on', i < 3 && this.mode === i);
    const [all, fav, trash, folders] = await Promise.all([repo.allDocuments(''), repo.favorites(''), repo.trashItems(), repo.folderCount()]);
    const counts = [all.length, fav.length, '', trash.length, folders];
    counts.forEach((c, i) => { this.drawerCounts[i].textContent = String(c); });
  }
  setDrawerProgress(p) {
    this.drawerP = p;
    this.drawerWidth = Math.min(320, Math.round(window.innerWidth * .86));
    this.drawerPanel.style.width = this.drawerWidth + 'px';
    this.drawerPanel.style.transform = `translateX(${-this.drawerWidth * (1 - p)}px)`;
    this.drawerScrim.style.opacity = String(p);
  }
  settleDrawer(target) {
    cancelAnimationFrame(this._anim);
    this.drawer.classList.add('on');
    const from = this.drawerP, dur = Math.max(80, Math.round(220 * Math.abs(target - from))), t0 = performance.now();
    const step = now => {
      const t = Math.min(1, (now - t0) / dur), e = 1 - (1 - t) * (1 - t);
      this.setDrawerProgress(from + (target - from) * e);
      if (t < 1) this._anim = requestAnimationFrame(step);
      else { this.setDrawerProgress(target); if (target === 0) this.drawer.classList.remove('on'); }
    };
    this._anim = requestAnimationFrame(step);
  }
  openDrawer() {
    this.tree.select(this.folder); this.updateDrawerCounts();
    if (!this.drawer.classList.contains('on')) this.setDrawerProgress(0);
    this.drawer.classList.add('on'); this.settleDrawer(1);
  }
  closeDrawer() { if (this.drawer.classList.contains('on')) this.settleDrawer(0); }
  /** touch edge swipe (Java onInterceptTouchEvent): pen / touch only */
  _edgeDrag() {
    let st = null;
    const el = this.el;
    el.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') return; st = { id: e.pointerId, x: e.clientX, y: e.clientY, drag: false, hist: [[performance.now(), e.clientX]] }; });
    el.addEventListener('pointermove', e => {
      if (!st || e.pointerId !== st.id) return;
      const dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.drag) {
        const open = this.drawer.classList.contains('on') && this.drawerP > .5;
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.5 && ((!open && dx > 0 && st.x >= 28 && st.x <= 150) || (open && dx < 0))) {
          st.drag = true; st.startX = e.clientX; st.startP = this.drawerP; el.setPointerCapture(e.pointerId); cancelAnimationFrame(this._anim);
          if (!this.drawer.classList.contains('on')) { this.tree.select(this.folder); this.updateDrawerCounts(); this.setDrawerProgress(0); this.drawer.classList.add('on'); }
        } else return;
      }
      st.hist.push([performance.now(), e.clientX]); if (st.hist.length > 6) st.hist.shift();
      this.setDrawerProgress(Math.max(0, Math.min(1, st.startP + (e.clientX - st.startX) / this.drawerWidth)));
    });
    const end = e => {
      if (!st || e.pointerId !== st.id) return;
      const s = st; st = null;
      if (!s.drag) return;
      const a = s.hist[0], b = s.hist[s.hist.length - 1], vx = b[0] > a[0] ? (b[1] - a[1]) / (b[0] - a[0]) * 1000 : 0;
      this.settleDrawer((Math.abs(vx) > 900 ? vx > 0 : this.drawerP > .45) ? 1 : 0);
    };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  }
  toggleSearch() {
    const show = !this.searchRow.classList.contains('on');
    this.searchRow.classList.toggle('on', show);
    if (show) this.search.focus(); else { this.search.value = ''; this.search.blur(); this.refreshGrid(); }
  }

  // ---------------------------------------------------------------- modes and content
  showMode(m) { this.mode = m; this.selected.clear(); this.selectionMode = false; this.refresh(); }
  selectFolder(f) {
    this.selected.clear(); this.selectionMode = false; this.mode = FOLDER; this.folder = f;
    if (this.actions.selectedFolder) this.actions.selectedFolder(f);
    this.closeDrawer(); this.refresh();
  }
  async items() {
    const q = this.search.value, repo = this.repository;
    switch (this.mode) {
      case ALL: return repo.allDocuments(q);
      case FAVORITES: return repo.favorites(q);
      case RECENT: return repo.recent(q, 40);
      default: return repo.sorted(this.folder, q);
    }
  }
  refresh() { this.styleRail(); return this.refreshGrid(); }
  styleRail() { this.railButtons.forEach((b, i) => b.classList.toggle('on', i < 3 && this.mode === i)); }
  _updateHeading(items) {
    const repo = this.repository, root = repo.root;
    const title = this.mode === ALL ? '전체 문서' : this.mode === FAVORITES ? '즐겨찾기' : this.mode === RECENT ? '최근 문서' : samePath(this.folder, root) ? '문서함' : baseName(this.folder);
    this.heading.textContent = title;
    let folders = 0, docs = 0;
    for (const f of items) { if (repo.isDirectory(f)) folders++; else docs++; }
    this.subtitle.textContent = this.selectionMode ? `${this.selected.size}개 선택됨` : (folders > 0 ? `폴더 ${folders}개 · ` : '') + `문서 ${docs}개`;
    const nested = this.mode === FOLDER && !samePath(this.folder, root);
    this.upButton.classList.toggle('on', nested);
    if (nested) {
      const parent = parentOf(this.folder);
      this.upButton.textContent = '';
      this.upButton.append(icon('ic_chevron_left', 18, ACCENT), h('span', { style: 'white-space:pre' }, '  '), h('span', { class: 'nm' }, samePath(parent, root) ? '문서함' : baseName(parent)));
    }
  }
  /** Loads the current list + per-item data, then renders. */
  async refreshGrid() {
    if (!this.showing) return;
    const load = ++this.loadVersion, repo = this.repository;
    let items;
    try { items = await this.items(); } catch (e) { host.log('library: ' + e.message); items = []; }
    const meta = new Map();
    await Promise.all(items.map(async f => {
      if (repo.isDirectory(f)) meta.set(pathKey(f), { count: (await repo.list(f)).length });
      else meta.set(pathKey(f), await this._fileMeta(f));
    }));
    if (load !== this.loadVersion || !this.showing) return;
    this._items = items; this._meta = meta;
    this._render(++this.generation);
  }
  async _fileMeta(f) {
    let mtime = 0; try { const s = await host.stat(f); mtime = s.mtime || 0; } catch { /* ignore */ }
    const side = await Sidecars.modified(f);
    return { mtime, side, modified: Math.max(mtime, side) };
  }
  _render(version) {
    if (!this.showing) return;
    const repo = this.repository, items = this._items;
    this._updateHeading(items);
    this.selectionBar.classList.toggle('on', this.selectionMode);
    this.compose.style.display = this.selectionMode ? 'none' : '';
    if (this.selectionMode) { this.selectionCount.textContent = `${this.selected.size}개 선택`; this.rebuildSelectionCommands(); }
    const viewMode = repo.viewMode();
    const usable = Math.max(this.shelf.clientWidth, 240) - 28;
    const columns = viewMode === 2 ? 1 : Math.max(1, Math.min(6, Math.floor(usable / (viewMode === 1 ? 118 : 164))));
    const cell = viewMode === 2 ? 0 : Math.floor(usable / columns) - 14;
    this.grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    this.grid.textContent = '';
    if (!items.length) {
      this.grid.append(h('div', { class: 'lib-empty' }, this.search.value.length > 0 ? '검색 결과가 없습니다' : this.mode === FAVORITES ? '즐겨찾기한 문서가 없습니다' : '아직 문서가 없습니다'));
      return;
    }
    for (const f of items) this.grid.append(h('div', { class: 'lib-cell' }, viewMode === 2 ? this.listItem(f, version) : this.card(f, version, cell)));
  }

  _placeholder() {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('class', 'ph'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    s.innerHTML = ICONS.ic_note_add; return s;
  }
  /** Cover frame content for a document: placeholder first, then the rendered first page. */
  _cover(file, version, small) {
    const box = h('div', { class: 'lib-cover' + (small ? ' sm' : ''), 'aria-label': baseName(file) + ' 미리보기' });
    box.append(this._placeholder());
    const m = this._meta.get(pathKey(file)) || {};
    const key = `${file}:${m.mtime || 0}:${m.side || 0}:top`;
    const apply = url => { const img = h('img', { src: url, alt: '', draggable: 'false' }); box.replaceChildren(img); };
    const cached = coverGet(key);
    if (cached) apply(cached);
    else coverQueue.add(async () => {
      if (version !== this.generation || !this.showing) return;
      const url = await loadCover(file, key);
      if (this.showing && version === this.generation) apply(url);
    });
    return box;
  }
  card(file, version, cell) {
    const repo = this.repository, isDir = repo.isDirectory(file), name = baseName(file), m = this._meta.get(pathKey(file)) || {};
    const frame = h('div', { class: 'lib-frame', style: { height: cell + 'px' } });
    if (isDir) {
      const fh = Math.round(cell * .84);
      const shape = h('span', { class: 'lib-fshape', style: { height: fh + 'px' }, 'aria-label': name + ' 폴더' });
      shape.innerHTML = new FolderShapeDrawable(repo.folderColor(file)).svg(cell, fh);
      frame.append(shape, h('div', { class: 'lib-fcount', style: { top: (Math.round(cell * .16 + cell * .84 * .3) + 6) + 'px' } }, String(m.count ?? 0)));
    } else {
      frame.append(this._cover(file, version, false));
      if (repo.favorite(file)) frame.append(h('div', { class: 'lib-fav' }, icon('ic_star', 18, '#FFB020')));
      if (this.selectionMode) frame.append(checkboxEl(this.selected.has(file), '선택 ' + name, () => this.toggleSelected(file)));
    }
    const card = h('div', { class: 'lib-card', 'aria-label': name, dataset: { tag: 'document:' + name } }, frame, h('div', { class: 'lib-name' }, stripPdf(isDir ? name : name)));
    if (!isDir) card.append(h('div', { class: 'lib-date' }, dateText(m.modified || 0)));
    card.addEventListener('click', () => this.openOrSelect(file));
    onLongPress(card, el => this.longPressed(file, el));
    return card;
  }
  listItem(file, version) {
    const repo = this.repository, isDir = repo.isDirectory(file), name = baseName(file), m = this._meta.get(pathKey(file)) || {};
    const img = h('div', { class: 'img' });
    if (isDir) img.innerHTML = new FolderShapeDrawable(repo.folderColor(file)).svg(56, 56, 'fs');
    else img.append(this._cover(file, version, true));
    let meta;
    if (isDir) meta = `${m.count ?? 0}개 항목`;
    else {
      meta = dateText(m.modified || 0);
      if (this.mode === ALL || this.mode === FAVORITES || this.mode === RECENT) { const p = parentOf(file); meta += ' · ' + (samePath(p, repo.root) ? '문서함' : baseName(p)); }
    }
    const row = h('div', { class: 'lib-row', 'aria-label': name, dataset: { tag: 'document:' + name } }, img,
      h('div', { class: 'txt' }, h('div', { class: 'nm' }, stripPdf(name)), h('div', { class: 'meta' }, meta)));
    if (!isDir && repo.favorite(file)) row.append(icon('ic_star', 22, '#FFB020'));
    if (this.selectionMode && !isDir) row.append(checkboxEl(this.selected.has(file), '선택 ' + name, () => this.toggleSelected(file), 'row'));
    row.addEventListener('click', () => this.openOrSelect(file));
    onLongPress(row, el => this.longPressed(file, el));
    return row;
  }
  longPressed(file, anchor) {
    if (this.repository.isDirectory(file)) this.folderMenu(file, anchor);
    else { this.selectionMode = true; this.selected.add(file); this._render(++this.generation); }
  }
  openOrSelect(file) {
    if (this.repository.isDirectory(file)) this.selectFolder(file);
    else if (this.selectionMode) this.toggleSelected(file);
    else { this.dismiss(); if (this.actions.open) this.actions.open(file); }
  }
  toggleSelected(file) { if (!this.selected.delete(file)) this.selected.add(file); this._render(++this.generation); }

  // ---------------------------------------------------------------- menus and actions
  _menu(anchor, rows) { AnchoredMenu.show(anchor, false, rows); }
  newMenu(anchor) {
    const R = AnchoredMenu.Row, target = () => (this.mode === FOLDER ? this.folder : this.repository.root);
    AnchoredMenu.showCentered('문서 추가', [
      new R('새 노트 만들기', 'ic_compose', () => { if (this.actions.newNote) this.actions.newNote(target(), () => this.refresh()); }).tint('#34C759'),
      new R('파일 가져오기', 'ic_import', () => { this.dismiss(); if (this.actions.importFiles) this.actions.importFiles(target()); }).tint('#007AFF'),
      new R('폴더 만들기', 'ic_folder_open', () => this.createFolder(target(), () => { this.tree.reload(); this.refresh(); })).tint('#F5A623'),
    ]);
  }
  libraryMenu(anchor) {
    const R = AnchoredMenu.Row, repo = this.repository;
    const rows = [
      new R('선택', null, () => { this.selectionMode = !this.selectionMode; this.selected.clear(); this._render(++this.generation); }),
      new R('보기 방법', null, () => new AlertDialog.Builder().setTitle('보기 방법').setSingleChoiceItems(LibraryRepository.VIEW_NAMES, repo.viewMode(), (d, i) => { repo.viewMode(i); d.dismiss(); this._render(++this.generation); }).show()),
      new R('정렬', null, () => new AlertDialog.Builder().setTitle('정렬').setSingleChoiceItems(LibraryRepository.SORT_NAMES, repo.sortMode(), (d, i) => { repo.sortMode(i); d.dismiss(); this.refreshGrid(); }).show()),
      new R('즐겨찾기 맨 위 고정', null, () => { repo.pinFavorites(!repo.pinFavorites()); this.refreshGrid(); }).selected(repo.pinFavorites()),
    ];
    if (this.mode === FOLDER) rows.push(new R('폴더 색상', null, () => this.chooseFolderColor(this.folder)));
    rows.push(new R('휴지통', null, () => this.showTrash()));
    this._menu(anchor, rows);
  }
  folderMenu(target, anchor) {
    const R = AnchoredMenu.Row;
    this._menu(anchor, [
      new R('폴더 색상', null, () => this.chooseFolderColor(target)),
      new R('하위 폴더 만들기', null, () => this.createFolder(target, () => { this.tree.reload(); this.refresh(); })),
    ]);
  }
  folderManageMenu(anchor) {
    const R = AnchoredMenu.Row;
    this._menu(anchor, [
      new R('폴더 만들기', null, () => this.createFolder(this.tree.selected(), () => { this.tree.reload(); this.refresh(); })),
      new R('선택한 폴더 색상', null, () => this.chooseFolderColor(this.tree.selected())),
    ]);
  }
  chooseFolderColor(target) {
    const repo = this.repository;
    let current = 0; LibraryRepository.FOLDER_COLORS.forEach((c, i) => { if (c === repo.folderColor(target)) current = i; });
    new AlertDialog.Builder().setTitle('폴더 색상 · ' + (samePath(target, repo.root) ? '문서함' : baseName(target)))
      .setSingleChoiceItems(LibraryRepository.FOLDER_COLOR_NAMES, current, (d, i) => { repo.folderColor(target, LibraryRepository.FOLDER_COLORS[i]); d.dismiss(); this.tree.reload(); this.refreshGrid(); })
      .setNegativeButton('취소').show();
  }
  /** Windows: no share sheet in the host protocol, so the document is revealed in Explorer. */
  async share(files) {
    try { await host.reveal(files[0]); }
    catch (e) { toast('공유할 수 없습니다: ' + e.message, LONG_TOAST); }
  }
  rename(file) {
    const f = inputField({ text: stripPdf(baseName(file)), label: '이름' });
    const dialog = new AlertDialog.Builder().setTitle('이름 변경').setView(f.view).setPositiveButton('저장').setNegativeButton('취소').create();
    dialog.show();
    const save = () => {
      const name = f.input.value.trim();
      if (!name) { f.setError('이름을 입력하세요'); return; }
      dialog.dismiss(); this._transfer1(file, parentOf(file), name, true);
    };
    rebindButton(dialog, BUTTON_POSITIVE, save);
    f.input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    setTimeout(() => f.input.select(), 60);
  }
  chooseDestination(files, move) {
    const panel = h('div', null);
    const picker = new FolderTreeView(this.activity, this.repository, this.folder, () => {});
    picker.el.style.height = '340px';
    const add = h('div', { class: 'lib-picker-add', role: 'button', 'aria-label': '대상 폴더 만들기' }, '＋ 폴더 만들기');
    add.addEventListener('click', () => this.createFolder(picker.selected(), () => picker.reload()));
    panel.append(picker.el, add);
    new AlertDialog.Builder().setTitle(move ? '이동할 폴더' : '복사할 폴더').setView(panel)
      .setPositiveButton(move ? '이곳으로 이동' : '이곳에 복사', () => this.transferMany(files, picker.selected(), move)).setNegativeButton('취소').show();
  }
  async _transfer1(file, target, name, move) {
    if (this.busy) return; this.busy = true;
    const progress = ProgressDialog.show('', move ? '문서를 이동하는 중…' : '문서를 복사하는 중…');
    try {
      const saved = await this.repository.transfer(file, target, name, move);
      this.busy = false; progress.dismiss();
      if (this.actions.changed) this.actions.changed(file, saved, move);
      this.selectionMode = false; this.selected.clear(); this.refresh();
    } catch (e) { this.busy = false; progress.dismiss(); toast(e.message || '작업에 실패했습니다', LONG_TOAST); }
  }
  async transferMany(files, destination, move) {
    if (this.busy) return; this.busy = true;
    const progress = ProgressDialog.show('', move ? '문서를 이동하는 중…' : '문서를 복사하는 중…');
    const changes = []; let error = '';
    for (const file of files) {
      try { changes.push([file, await this.repository.transfer(file, destination, baseName(file), move)]); }
      catch (e) { error = e.message || '작업에 실패했습니다'; }
    }
    this.busy = false; progress.dismiss();
    if (this.actions.changed) for (const [a, b] of changes) this.actions.changed(a, b, move);
    this.selectionMode = false; this.selected.clear(); this.refresh();
    if (error) toast(error, LONG_TOAST);
  }
  deleteDocuments(files) {
    new AlertDialog.Builder().setTitle('문서 삭제').setMessage(`${files.length}개 문서를 휴지통으로 이동할까요?`)
      .setPositiveButton('삭제', async () => {
        if (this.busy) return; this.busy = true;
        const progress = ProgressDialog.show('', '휴지통으로 이동하는 중…');
        const removed = []; let error = '';
        for (const file of files) {
          try { await this.repository.trash(file); removed.push(file); }
          catch (e) { error = e.message || '삭제에 실패했습니다'; }
        }
        this.busy = false; progress.dismiss();
        if (this.actions.removed) this.actions.removed(removed);
        this.selectionMode = false; this.selected.clear(); this.refresh();
        if (error) toast(error, LONG_TOAST);
      }).setNegativeButton('취소').show();
  }
  async showTrash() {
    const repo = this.repository, items = await repo.trashItems();
    if (!items.length) { new AlertDialog.Builder().setTitle('휴지통').setMessage('휴지통이 비어 있습니다').setPositiveButton('닫기').show(); return; }
    new AlertDialog.Builder().setTitle('휴지통 · 눌러서 복원').setItems(items.map(i => i.name), async (d, index) => {
      try {
        const restored = await repo.restore(items[index]);
        if (this.actions.changed) this.actions.changed(items[index].file, restored, true);
        this.refresh(); toast('복원했습니다');
      } catch (e) { toast(e.message, LONG_TOAST); }
    }).setNeutralButton('휴지통 비우기', () => this.confirmEmptyTrash(items.length)).setNegativeButton('닫기').show();
  }
  confirmEmptyTrash(count) {
    new AlertDialog.Builder().setTitle('휴지통 비우기').setMessage(`휴지통의 문서 ${count}개를 영구 삭제할까요? 되돌릴 수 없습니다.`)
      .setPositiveButton('영구 삭제', async () => {
        if (this.busy) return; this.busy = true;
        try { const n = await this.repository.emptyTrash(); this.busy = false; this.refresh(); toast(`${n}개 문서를 영구 삭제했습니다`); }
        catch (e) { this.busy = false; toast(e.message || '삭제에 실패했습니다', LONG_TOAST); }
      }).setNegativeButton('취소').show();
  }
  createFolder(parent, done) {
    const f = inputField({ hint: '폴더 이름' });
    const dialog = new AlertDialog.Builder().setTitle('폴더 만들기').setView(f.view).setPositiveButton('만들기').setNegativeButton('취소').create();
    dialog.show();
    const make = async () => {
      try { await this.repository.createFolder(parent, f.input.value); dialog.dismiss(); done(); }
      catch (e) { f.setError(e.message); }
    };
    rebindButton(dialog, BUTTON_POSITIVE, make);
    f.input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); make(); } });
  }
}
