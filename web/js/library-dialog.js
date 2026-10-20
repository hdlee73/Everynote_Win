// Port of LibraryDialog.java, FolderTreeView.java, FolderIconDrawable.java, FolderShapeDrawable.java, PaperChoiceView.java.
// Visual spec: spec/library.md (sections 2-8). Styles: css/library.css (linked by index.html).
//
//   const dlg = new LibraryDialog(activity, library, folderPath, actions);  dlg.show();
//   actions = { open(file), importFiles(folder), newNote(folder, refresh), changed(src, tgt, moved), selectedFolder(folder), removed(files) }
import { h, icon, setIcon, argb, baseName } from './util.js';
import { ICONS, folderTint } from './icons.js';
import { host } from './host.js';
import { AlertDialog, BUTTON_POSITIVE } from './ui/alert.js';
import { AnchoredMenu } from './ui/menu.js';
import { toast } from './ui/toast.js';
import { LibraryRepository, NotebookFiles, Paper, Sidecars, samePath, pathKey, parentOf, joinP, sha1Hex } from './library.js';

const INK = '#010102', MUTED = '#848487', ACCENT = '#DB332A';
const ALL = 0, FAVORITES = 1, RECENT = 2, FOLDER = 3, TRASH = 4;
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
  return `${then.getFullYear()}년 ${then.getMonth() + 1}월 ${then.getDate()}일`;
}
export { dateText };

const stripPdf = n => n.replace(/\.pdf$/i, '');

// ================================================================= PaperChoiceView =================================================================
const TEMPLATE_LABEL = 'PDF·이미지 서식 고르기';
let templateDir = null;   // <data>\\templates, known after the first host.info()
const templateDirReady = () => templateDir ? Promise.resolve(templateDir) : host.info().then(i => (templateDir = i.data.replace(/[\\/]+$/, '') + '\\templates'));
const BUILTIN_BASE = new URL('../assets/templates/', import.meta.url).href;
const pdfPreviews = new Map();
/** The "기본 노트 스타일" setting: paper, colour and orientation that are pre-selected when a new note is made. */
export function defaultNoteStyle(prefs) {
  const kind = prefs.getInt('default_paper_kind', 10);
  return {
    kind: NotebookFiles.PAPER_ORDER.includes(kind) ? kind : 10,
    color: NotebookFiles.COLORS.includes(prefs.getInt('default_paper_color', -1)) ? prefs.getInt('default_paper_color', -1) : -1,
    landscape: prefs.getBoolean('default_paper_landscape', false),
  };
}
export function saveDefaultNoteStyle(prefs, view) {
  prefs.putInt('default_paper_kind', view.kind); prefs.putInt('default_paper_color', view.color); prefs.putBoolean('default_paper_landscape', view.layoutChoice && view.landscape);
}
export function describeNoteStyle(style) {
  const color = NotebookFiles.COLOR_NAMES[Math.max(0, NotebookFiles.COLORS.indexOf(style.color))];
  const paperName = style.kind === NotebookFiles.CUSTOM ? '내 PDF·이미지 서식' : NotebookFiles.PAPER_NAMES[style.kind];
  return paperName + ' · ' + color + (style.landscape && style.kind < 9 ? ' · 가로' : '');
}
const TILE_W = 72, TILE_H = 96;
export class PaperChoiceView {
  /** opts: { kind, color, landscape } initial choice (default: first form, white, portrait); layoutChoice: also offer portrait / landscape. */
  constructor(activity, opts = {}) {
    this.kind = 10; this.color = opts.color == null ? -1 : opts.color; this.selected = -1; this.builtin = null;
    this.layoutChoice = !!opts.layoutChoice; this.landscape = this.layoutChoice && !!opts.landscape;
    // Samsung Notes style: every paper is a small preview tile (bundled form templates first), not a drop-down list
    this.tiles = [];
    this.tileGrid = h('div', { class: 'lib-tiles', role: 'radiogroup', 'aria-label': '종이 형식' });
    NotebookFiles.PAPER_ORDER.forEach((k, i) => {
      const cv = h('canvas', { class: 'lib-tilecv' });
      const tile = h('div', { class: 'lib-tile', role: 'radio', 'aria-label': NotebookFiles.PAPER_NAMES[k], dataset: { tag: 'paper_tile:' + k } }, cv, h('div', { class: 'lib-tilename' }, k === NotebookFiles.CUSTOM ? '내 서식' : NotebookFiles.PAPER_NAMES[k]));
      tile.addEventListener('click', () => this.selectPosition(i));
      this.tiles.push({ tile, cv, kind: k }); this.tileGrid.append(tile);
    });
    this.template = null; this._request = null;
    this.templateButton = h('div', { class: 'lib-tplbtn', role: 'button', style: { display: 'none' }, dataset: { tag: 'paper_template' } }, TEMPLATE_LABEL);
    this.templateButton.addEventListener('click', () => this._pickTemplate());
    this.chips = h('div', { class: 'lib-chips' });
    this.layoutRow = h('div', { class: 'lib-layouts' });
    this.el = h('div', { class: 'lib-paper' }, h('div', { class: 'lib-sec' }, '종이'), this.tileGrid, this.templateButton, h('div', { class: 'lib-sec' }, '색상'), this.chips);
    if (this.layoutChoice) { this.el.append(h('div', { class: 'lib-sec' }, '레이아웃'), this.layoutRow); this.refreshLayout(); }
    this.refreshColors();
    const start = NotebookFiles.PAPER_ORDER.indexOf(opts.kind == null ? 10 : opts.kind);
    this.selectPosition(start >= 0 ? start : 0);
    requestAnimationFrame(() => this.draw());
  }
  /** Chooses a paper by its row in the list (the bundled form templates come first). */
  selectPosition(position) {
    this.selected = position; this.kind = NotebookFiles.PAPER_ORDER[position];
    this.tiles.forEach((t, i) => { t.tile.classList.toggle('on', i === position); t.tile.setAttribute('aria-checked', i === position ? 'true' : 'false'); });
    this.templateButton.style.display = this.kind === NotebookFiles.CUSTOM ? '' : 'none';
    this.builtin = null;
    if (this.kind >= 10) this._prepareBuiltin(this.kind);
    this.refreshLayout();
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
      const chip = h('div', { class: 'lib-chip' + (on ? ' on' : ''), role: 'button', 'aria-label': '배경색 ' + NotebookFiles.COLOR_NAMES[i], title: NotebookFiles.COLOR_NAMES[i], dataset: { tag: 'paper_color:' + i }, style: { background: argb(c) } }, on ? icon('ic_check_bold', 18, c === NotebookFiles.COLORS[8] ? '#fff' : ACCENT) : null);
      chip.addEventListener('click', () => { this.color = c; this.refreshColors(); this.draw(); });
      this.chips.append(chip);
    });
  }
  /** portrait / landscape choice (only for generated papers; a form PDF keeps its own page size) */
  refreshLayout() {
    if (!this.layoutChoice) return;
    const form = this.kind >= 10 || this.kind === NotebookFiles.CUSTOM;
    this.layoutRow.textContent = '';
    [['기본 (세로)', false], ['가로', true]].forEach(([label, land]) => {
      const on = this.landscape === land;
      const box = h('div', { class: 'lib-lay' + (on ? ' on' : '') + (form ? ' off' : ''), role: 'radio', 'aria-checked': on ? 'true' : 'false', 'aria-label': '레이아웃 ' + label, dataset: { tag: 'paper_layout:' + (land ? 'land' : 'port') } },
        h('div', { class: 'lib-layic' + (land ? ' land' : '') }), h('div', { class: 'lib-laynm' }, label));
      if (!form) box.addEventListener('click', () => { this.landscape = land; this.refreshLayout(); this.draw(); });
      this.layoutRow.append(box);
    });
    if (form) this.layoutRow.append(h('div', { class: 'lib-laynote' }, '서식 PDF는 서식의 크기를 따릅니다'));
  }
  draw() { this.tiles.forEach(t => this._drawTile(t.cv, t.kind)); }
  _drawTile(cv, kind) {
    const dpr = window.devicePixelRatio || 1, W = TILE_W, H = TILE_H;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px';
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const form = kind >= 10, custom = kind === NotebookFiles.CUSTOM, land = this.landscape && !form && !custom;
    const ptW = land ? 842 : 595, ptH = land ? 595 : 842;
    let pw = W - 8, ph = pw * ptH / ptW; if (ph > H - 8) { ph = H - 8; pw = ph * ptW / ptH; }
    const left = (W - pw) / 2, top = (H - ph) / 2, bottom = top + ph;
    g.fillStyle = form ? '#FFFFFF' : argb(this.color); g.fillRect(left, top, pw, ph);
    const border = () => { g.strokeStyle = '#CBD2DA'; g.lineWidth = 1; g.strokeRect(left + .5, top + .5, pw - 1, ph - 1); };
    const formFile = form ? NotebookFiles.BUILTIN_TEMPLATES[kind - 10] : (custom && this.template && /\.pdf$/i.test(this.template) ? this.template : null);
    if (formFile) {
      const key = form ? 'builtin:' + formFile : 'file:' + formFile;
      if (pdfPreviews.get(key)) { g.drawImage(pdfPreviews.get(key), left, top, pw, ph); border(); return; }
      if (!pdfPreviews.has(key)) this._previewOf(key, async () => form ? new Uint8Array(await (await fetch(BUILTIN_BASE + formFile)).arrayBuffer()) : host.readBytes(formFile)).then(() => this._drawTile(cv, kind));
      border(); return;
    }
    border();
    if (custom) { g.fillStyle = MUTED; g.font = '22px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(this.template ? '✓' : '+', W / 2, H / 2); g.textAlign = 'left'; g.textBaseline = 'alphabetic'; return; }
    const f = ph / ptH, fw = pw / ptW;
    for (const seg of NotebookFiles.layout(kind, ptW, ptH)) {
      const c = NotebookFiles.ruleColorOn(seg[4], this.color);
      g.strokeStyle = g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; g.lineWidth = 1;
      const x1 = left + seg[0] * fw, y1 = bottom - seg[1] * f, x2 = left + seg[2] * fw, y2 = bottom - seg[3] * f;
      if (seg[4] === 3) { g.beginPath(); g.arc(x1, y1, Math.max(.6, fw * .9), 0, Math.PI * 2); g.fill(); }
      else { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
    }
  }
}

// ================================================================= FolderTreeView =================================================================
/** Folder line icon tinted with the folder's colour (navigation pane, pickers). */
export function folderGlyph(color, size = 20) { return icon('ic_folder_open', size, folderTint(color)); }
export class FolderTreeView {
  /** @param listener function(folderPath) called when a folder row is clicked
   *  @param opts { hideRoot: list only the sub-folders of the library (navigation pane), counts: show the number of documents } */
  constructor(activity, repository, selected, listener, opts = {}) {
    this.repository = repository; this.listener = listener || (() => {}); this.sel = selected; this.menu = null;
    this.hideRoot = !!opts.hideRoot; this.counts = opts.counts !== false;
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
    const v = ++this._v, rows = [], repo = this.repository;
    if (this.hideRoot) { for (const f of await repo.list(repo.root)) if (repo.isDirectory(f)) await this._add(rows, f, 0); }
    else await this._add(rows, repo.root, 0);
    if (v !== this._v) return;
    this.rows.replaceChildren(...rows);
  }
  async _add(out, folder, depth) {
    const repo = this.repository;
    const children = []; let docs = 0;
    for (const f of await repo.list(folder)) { if (repo.isDirectory(f)) children.push(f); else docs++; }
    const isSel = this.sel && samePath(folder, this.sel), isRoot = samePath(folder, repo.root);
    const expanded = this.expandedSet.has(pathKey(folder));
    const name = isRoot ? '문서함' : baseName(folder);
    const arrow = h('div', { class: 'arrow', 'aria-label': baseName(folder) + ' 하위 폴더 펼치기' }, children.length ? icon(expanded ? 'ic_chevron_down' : 'ic_chevron_right', 16, '#848487') : null);
    arrow.addEventListener('click', e => { e.stopPropagation(); const k = pathKey(folder); if (!this.expandedSet.delete(k)) this.expandedSet.add(k); this.reload(); });
    const fname = h('div', { class: 'fname', 'aria-label': '폴더 ' + name }, folderGlyph(repo.folderColor(folder), 20), h('span', { class: 't' }, name));
    const row = h('div', { class: 'lib-trow' + (isSel ? ' sel' : ''), style: { paddingLeft: (Math.min(depth, 12) * 16 + 10) + 'px' }, dataset: { tag: 'folder_row:' + name } }, arrow, fname);
    if (this.counts && docs) row.append(h('div', { class: 'ct' }, String(docs)));
    fname.addEventListener('click', () => { this.sel = folder; this.reload(); this.listener(folder); });
    onLongPress(fname, el => { if (this.menu) this.menu(folder, el); });
    out.push(row);
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
  /** opts.mode: ALL (0) / FAVORITES (1) / RECENT (2) / FOLDER (3, default) / TRASH (4) */
  constructor(activity, repository, folder, actions, opts = {}) {
    this.activity = activity; this.repository = repository; this.actions = actions || {};
    this.folder = folder || repository.root; this.mode = opts.mode == null ? FOLDER : opts.mode;
    this.selected = new Set(); this.selectionMode = false;
    this.generation = 0; this.loadVersion = 0; this.busy = false; this.showing = false; this.dismissL = null;
    this.drawerP = 0; this.drawerWidth = 300; this._items = []; this._meta = new Map(); this._anim = 0; this._trash = new Map();
    this.docked = false;
    this._build();
    this.applyDocking();
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
    this._ro = new ResizeObserver(() => { this.applyDocking(); const w = this.shelf.clientWidth; if (w !== this._lastW) { this._lastW = w; this._render(++this.generation); } });
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
    if (!this.docked && this.drawer.classList.contains('on')) { this.closeDrawer(); return; }
    if (this.selectionMode) { this.selectionMode = false; this.selected.clear(); this.refreshGrid(); return; }
    if (this.page.classList.contains('searching')) { this.toggleSearch(); return; }
    if (this.search.value) { this.search.value = ''; this.refreshGrid(); return; }
    if (this.mode === FOLDER && !samePath(this.folder, this.repository.root)) { this.selectFolder(parentOf(this.folder)); return; }
    this.dismiss();
  }

  openSettings() { if (this.actions.settings) this.actions.settings(); }

  // ---------------------------------------------------------------- layout
  _ib(name, label, click, extra = '') {
    const b = h('button', { class: 'lib-ib ' + extra, 'aria-label': label, title: label, type: 'button' }, icon(name, 22, INK));
    b.addEventListener('click', e => { e.stopPropagation(); click(b); });
    return b;
  }
  /** Header text button with a small leading icon (노트 작성, PDF 가져오기, 편집, 보기 방식, 비우기 ...). */
  _tb(name, label, click, tag, extra = '') {
    const b = h('button', { class: 'lib-tb ' + extra, type: 'button', 'aria-label': label, title: label, dataset: { tag } }, name ? icon(name, 18, INK) : null, h('span', { class: 't' }, label));
    b.addEventListener('click', e => { e.stopPropagation(); click(b); });
    return b;
  }
  _target() { return this.mode === FOLDER ? this.folder : this.repository.root; }
  _build() {
    const repo = this.repository;
    // collapsed navigation pane: an icon rail (wide window, pane closed with ☰)
    const rail = h('div', { class: 'lib-rail' });
    rail.append(this._ib('ic_menu', '폴더 트리 보기', () => this.openDrawer(), 'sq'), h('div', { class: 'gap' }));
    const icons = ['ic_notes_all', 'ic_star_outline', 'ic_clock', 'ic_delete'], names = ['전체 문서', '즐겨찾기 문서', '최근 문서', '휴지통'];
    this.railButtons = icons.map((n, i) => {
      const b = this._ib(n, names[i], () => { if (i === 3) this.showTrash(); else this.showMode(i); }, 'sq rb'); rail.append(b); return b;
    });
    rail.append(h('div', { class: 'lib-dots' }), this._ib('ic_folder_check', '폴더 열기', () => this.openDrawer(), 'sq fo'));
    rail.append(h('div', { class: 'lib-railfill' }), this._ib('ic_settings', '설정', () => this.openSettings(), 'sq st'));
    this.rail = rail;

    // header: big title on the left, labelled actions + search box on the right (Samsung Notes for Windows layout). No back arrow.
    this.menuButton = this._ib('ic_menu', '폴더 트리 보기', () => this.openDrawer(), 'lib-menu-btn');
    this.heading = h('span', null);
    this.titleEl = h('div', { class: 'lib-title', dataset: { tag: 'library_heading' } }, this.heading);
    this.search = h('input', { class: 'lib-search', type: 'text', placeholder: '검색', 'aria-label': '문서 이름 입력', spellcheck: 'false' });
    this.search.addEventListener('input', () => this.refreshGrid());
    this.search.addEventListener('keydown', e => { if (e.key === 'Escape' && this.search.value) { e.preventDefault(); e.stopPropagation(); this.search.value = ''; this.refreshGrid(); } });
    const searchGo = this._ib('ic_search', '문서 이름 검색', () => { if (window.innerWidth < 600) this.toggleSearch(); else this.search.focus(); }, 'lib-sgo');
    this.searchRow = h('div', { class: 'lib-searchrow' });
    this.searchBox = h('div', { class: 'lib-sbox', dataset: { tag: 'library_search' } }, this.search, searchGo);
    this.actionsRow = h('div', { class: 'lib-actions', dataset: { tag: 'library_actions' } });
    this.moreButton = this._ib('ic_more_vert', '문서함 메뉴', b => this.libraryMenu(b), 'lib-more');
    const top = h('div', { class: 'lib-top' }, this.menuButton, this.titleEl, h('div', { class: 'sp' }), this.actionsRow, this.searchBox, this.moreButton);
    // second row: subtitle (trash notice / counts) on the left, sort control on the right
    this.subtitle = h('div', { class: 'lib-sub' });
    this.sortButton = h('button', { class: 'lib-tb lib-sortbtn', type: 'button', 'aria-label': '정렬 기준', title: '정렬 기준', dataset: { tag: 'library_sort' } }, icon('ic_sort', 18, INK), h('span', { class: 't' }, ''));
    this.sortButton.addEventListener('click', e => { e.stopPropagation(); this.sortMenu(this.sortButton); });
    this.sortDir = this._ib('ic_arrow_down', '정렬 방향 바꾸기', () => { repo.sortReverse(!repo.sortReverse()); this.refreshGrid(); }, 'lib-sortdir');
    this.sortBox = h('div', { class: 'lib-sortbox' }, this.sortButton, this.sortDir);
    const head = h('div', { class: 'lib-heading' }, this.subtitle, h('div', { class: 'sp' }), this.sortBox);
    // shelf
    this.grid = h('div', { class: 'lib-grid' });
    this.shelf = h('div', { class: 'lib-shelf' }, this.grid);
    // selection bar: replaces the header while documents are selected ("전체" check, "N개 선택됨", icon + label commands, 취소). No back arrow.
    this.selectAll = checkboxEl(false, '전체 선택', () => this.runSelectionCommand('전체'), 'all');
    this.selectionCount = h('div', { class: 'lib-selcount' }, '0개 선택됨');
    this.selectionCommands = h('div', { class: 'lib-selcmds' });
    const cancel = this._tb(null, '취소', () => this.onBackPressed(), 'selection_cancel', 'lib-selcancel');
    cancel.setAttribute('aria-label', '선택 해제');
    this.selectionBar = h('div', { class: 'lib-top lib-seltop' }, h('label', { class: 'lib-selall' }, this.selectAll, h('span', null, '전체')), this.selectionCount, h('div', { class: 'sp' }), this.selectionCommands, cancel);
    this.page = h('div', { class: 'lib-page' }, top, this.selectionBar, this.searchRow, head, this.shelf);
    // FAB (narrow window only): 노트 작성 / 가져오기 / 폴더
    this.compose = h('div', { class: 'lib-fab', role: 'button', 'aria-label': '새로 만들기', title: '노트 작성', dataset: { tag: 'compose_button' } }, icon('ic_compose', 24, INK));
    this.compose.addEventListener('click', () => this.newMenu(this.compose));
    this._buildDrawer();
    this.el = h('div', { class: 'lib-root', dataset: { tag: 'library_root' } }, rail, this.page, this.compose, this.drawer);
    this._edgeDrag();
  }
  /** Header buttons for the current view. */
  rebuildActions() {
    const a = this.actionsRow; a.textContent = '';
    if (this.mode === TRASH) {
      a.append(this._tb(null, '편집', () => this.startSelection(), 'library_edit'),
        this._tb(null, '비우기', () => this.confirmEmptyTrash(this._items.length), 'library_empty_trash'));
      return;
    }
    a.append(
      this._tb('ic_compose', '노트 작성', () => { if (this.actions.newNote) this.actions.newNote(this._target(), () => this.refresh()); }, 'library_new_note'),
      this._tb('ic_pdf_import', 'PDF 가져오기', () => { this.dismiss(); if (this.actions.importFiles) this.actions.importFiles(this._target()); }, 'library_import'),
      this._tb(null, '편집', () => this.startSelection(), 'library_edit'),
      this._tb('ic_grid', '보기 방식', b => this.viewMenu(b), 'library_view'));
  }
  startSelection() { this.selectionMode = true; this.selected.clear(); this._render(++this.generation); }
  sortLabel() { const m = this.repository.sortMode(); return m === 2 ? '수정 날짜 순' : m === 3 ? '열어본 날짜 순' : '이름 순'; }
  sortMenu(anchor) {
    const R = AnchoredMenu.Row, repo = this.repository, m = repo.sortMode();
    const pick = (mode, rev) => { repo.sortMode(mode); repo.sortReverse(rev); this.refreshGrid(); };
    this._menu(anchor, [
      new R('수정 날짜 순', null, () => pick(2, false)).selected(m === 2),
      new R('열어본 날짜 순', null, () => pick(3, false)).selected(m === 3),
      new R('이름 순', null, () => pick(0, false)).selected(m === 0 || m === 1)]);
  }
  viewMenu(anchor) {
    const R = AnchoredMenu.Row, repo = this.repository, v = repo.viewMode();
    this._menu(anchor, [
      new R('큰 표지', 'ic_grid', () => { repo.viewMode(0); this._render(++this.generation); }).selected(v === 0),
      new R('작은 표지', 'ic_thumbnails', () => { repo.viewMode(1); this._render(++this.generation); }).selected(v === 1),
      new R('목록', 'ic_list_view', () => { repo.viewMode(2); this._render(++this.generation); }).selected(v === 2),
      R.divider(),
      new R('즐겨찾기 맨 위 고정', 'ic_star_outline', () => { repo.pinFavorites(!repo.pinFavorites()); this.refreshGrid(); }).selected(repo.pinFavorites())]);
  }

  rebuildSelectionCommands() {
    this.selectionCommands.textContent = '';
    const all = this._allSelected();
    this.selectAll.classList.toggle('on', all); this.selectAll.setAttribute('aria-checked', String(all));
    const commands = this.mode === TRASH ? [['복원', 'ic_restore'], ['삭제', 'ic_delete']] : [['이동', 'ic_move'], ['공유', 'ic_share'], ['삭제', 'ic_delete'], [all ? '모두 해제' : '전체 선택', 'ic_check_circle']];
    for (const [label, name] of commands) {
      const c = h('div', { class: 'lib-cmd' + (label === '삭제' ? ' red' : ''), role: 'button', title: label, 'aria-label': '선택 문서 ' + label }, icon(name, 20, label === '삭제' ? ACCENT : INK), h('span', { class: 't' }, label));
      c.addEventListener('click', () => this.runSelectionCommand(label === '전체 선택' || label === '모두 해제' ? '전체' : label));
      this.selectionCommands.append(c);
    }
    if (this.mode === TRASH) return;
    const more = h('div', { class: 'lib-cmd more', role: 'button', title: '더 보기', 'aria-label': '선택 문서 더 보기' }, icon('ic_more_vert', 20, INK));
    more.addEventListener('click', e => { e.stopPropagation(); this.selectionMenu(more); });
    this.selectionCommands.append(more);
  }
  _allSelected() {
    const docs = this._items.filter(f => !this.repository.isDirectory(f));
    return docs.length > 0 && docs.every(f => this.selected.has(f));
  }
  /** ⋮ of the selection bar: the less common commands. */
  selectionMenu(anchor) {
    const R = AnchoredMenu.Row, repo = this.repository, files = [...this.selected];
    const allFavorite = files.length > 0 && files.every(f => repo.favorite(f));
    const rows = [], anyFolder = files.some(f => repo.isDirectory(f));
    if (files.length === 1) rows.push(new R('이름 변경', 'ic_rename', () => this.runSelectionCommand('이름 변경')));
    rows.push(new R(anyFolder ? '복사' : '복사본 만들기', 'ic_copy', () => this.runSelectionCommand('복사')));
    if (anyFolder) { this._menu(anchor, rows); return; }
    const here = files.length ? parentOf(files[0]) : this._target(), refreshed = () => { this.selectionMode = false; this.selected.clear(); this.refresh(); };
    if (files.length >= 2) rows.push(new R('문서 합치기', 'ic_page_add', async () => (await import('./pagetools.js')).mergeDialog(repo, this._orderedSelection(files), here, refreshed)));
    if (files.length === 1) rows.push(new R('페이지 발췌하여 새 파일 만들기', 'ic_page_add', async () => (await import('./pagetools.js')).extractDialog(repo, files[0], here, refreshed)));
    rows.push(new R(allFavorite ? '즐겨찾기 해제' : '즐겨찾기에 추가', allFavorite ? 'ic_star' : 'ic_star_outline', () => this.runSelectionCommand('즐겨찾기')));
    this._menu(anchor, rows);
  }
  /** Selected documents in the order they are shown on the shelf. */
  _orderedSelection(files) { const set = new Set(files); const shown = this._items.filter(f => set.has(f)); return shown.length === files.length ? shown : files; }
  async runSelectionCommand(action) {
    const files = [...this.selected], repo = this.repository;
    if (action === '전체') {
      if (this._allSelected()) this.selected.clear();
      else for (const f of this._items) if (!repo.isDirectory(f)) this.selected.add(f);
      this._render(++this.generation); return;
    }
    if (!files.length) { toast('문서나 폴더를 선택하세요'); return; }
    if (this.mode === TRASH) {
      const items = files.map(f => this._trash.get(pathKey(f))).filter(Boolean);
      if (action === '복원') this.restoreItems(items); else this.confirmPurge(items);
      return;
    }
    if (action === '즐겨찾기') {
      const allFavorite = files.every(f => repo.favorite(f));
      for (const f of files) repo.favorite(f, !allFavorite);
      this.selectionMode = false; this.selected.clear(); this.refresh();
      toast(allFavorite ? '즐겨찾기에서 뺐습니다' : '즐겨찾기에 추가했습니다');
    } else if (action === '이름 변경') this.rename(files[0]);
    else if (action === '공유') this.share(files.filter(f => !repo.isDirectory(f)).concat(files.filter(f => repo.isDirectory(f))));
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
    const icons = ['ic_notes_all', 'ic_star_outline', 'ic_clock', 'ic_delete'], names = ['모든 노트', '즐겨찾기', '최근 문서', '휴지통'];
    this.drawerRows = [];
    this.drawerCounts = [];
    icons.forEach((n, i) => {
      const row = this._drawerRow(n, names[i], () => { this._drawerPicked(); if (i === 3) this.showTrash(); else this.showMode(i); });
      panel.append(row.el); this.drawerRows.push(row.el); this.drawerCounts.push(row.count);
    });
    panel.append(h('div', { class: 'lib-dots' }));
    const fr = this._drawerRow('ic_folder_check', '폴더', () => this.selectFolder(repo.root));
    this.folderRow = fr.el; panel.append(fr.el); this.drawerCounts.push(fr.count);
    this.tree = new FolderTreeView(this.activity, repo, this.folder, f => this.selectFolder(f), { hideRoot: true });
    this.tree.setFolderMenu((f, el) => this.folderMenu(f, el));
    this.tree.el.classList.add('transparent', 'tree');
    panel.append(this.tree.el);
    panel.append(h('div', { class: 'lib-dots' }), this._drawerRow('ic_settings', '설정', () => { this._drawerPicked(); this.openSettings(); }).el);
    this.drawerWidth = Math.min(300, Math.round(window.innerWidth * .86));
    this.drawer = h('div', { class: 'lib-drawer', dataset: { tag: 'library_drawer' } }, this.drawerScrim, panel);
  }
  _drawerRow(iconName, title, click) {
    const count = h('div', { class: 'ct' });
    const el = h('div', { class: 'lib-drow' + (click ? ' click' : ''), 'aria-label': title, role: click ? 'button' : null, dataset: { tag: 'drawer_row:' + title } }, icon(iconName, 20, INK), h('div', { class: 'nm' }, title), count);
    if (click) el.addEventListener('click', click);
    return { el, count };
  }
  async updateDrawerCounts() {
    const repo = this.repository;
    for (let i = 0; i < 4; i++) this.drawerRows[i].classList.toggle('on', i === 3 ? this.mode === TRASH : this.mode === i);
    this.folderRow.classList.toggle('on', this.mode === FOLDER && samePath(this.folder, repo.root));
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
  // Folder tree: on a wide window it is docked as a column beside the document list (the default, remembered in the preferences); on a narrow one it slides over the list.
  _prefs() { return (this.activity && this.activity.recentPrefs) || null; }
  wantsDock() { const p = this._prefs(); return window.innerWidth >= 600 && (p ? p.getBoolean('lib_tree_docked', true) : true); }
  applyDocking() {
    const want = this.wantsDock();
    if (want === this.docked && this.el.classList.contains('docked') === want) return;
    this.docked = want; this.el.classList.toggle('docked', want);
    cancelAnimationFrame(this._anim);
    if (want) { this.drawer.classList.add('on'); this.drawerPanel.style.width = ''; this.drawerPanel.style.transform = ''; this.drawerScrim.style.opacity = ''; this.drawerP = 1; if (this.showing) { this.tree.select(this.folder); this.updateDrawerCounts().catch(() => {}); } }
    else { this.drawer.classList.remove('on'); this.setDrawerProgress(0); }
  }
  openDrawer() {
    if (window.innerWidth >= 600) { const p = this._prefs(); if (p) p.putBoolean('lib_tree_docked', true); this.applyDocking(); return; }
    this.tree.select(this.folder); this.updateDrawerCounts();
    if (!this.drawer.classList.contains('on')) this.setDrawerProgress(0);
    this.drawer.classList.add('on'); this.settleDrawer(1);
  }
  closeDrawer() {
    if (this.docked) { const p = this._prefs(); if (p) p.putBoolean('lib_tree_docked', false); this.applyDocking(); return; }
    if (this.drawer.classList.contains('on')) this.settleDrawer(0);
  }
  /** Picking something in the tree closes the sliding drawer but leaves a docked tree open. */
  _drawerPicked() { if (!this.docked) this.closeDrawer(); }
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
  /** Narrow window: the search box opens over the header (wide windows always show it). */
  toggleSearch() {
    const show = !this.page.classList.contains('searching');
    this.page.classList.toggle('searching', show); this.searchRow.classList.toggle('on', show);
    if (show) this.search.focus(); else { this.search.value = ''; this.search.blur(); this.refreshGrid(); }
  }

  // ---------------------------------------------------------------- modes and content
  showMode(m) { this.mode = m; this.selected.clear(); this.selectionMode = false; if (m !== FOLDER && this.tree) { this.tree.sel = null; this.tree.reload(); } this.refresh(); }
  selectFolder(f) {
    this.selected.clear(); this.selectionMode = false; this.mode = FOLDER; this.folder = f;
    if (this.actions.selectedFolder) this.actions.selectedFolder(f);
    this._drawerPicked(); this.refresh();
  }
  async items() {
    const q = this.search.value, repo = this.repository;
    switch (this.mode) {
      case ALL: return repo.allDocuments(q);
      case FAVORITES: return repo.favorites(q);
      case RECENT: return repo.recent(q, 40);
      case TRASH: {
        const query = q.trim().toLowerCase(), list = (await repo.trashItems()).filter(i => i.name.toLowerCase().includes(query));
        list.sort((a, b) => (b.deleted || 0) - (a.deleted || 0));
        this._trash = new Map(list.map(i => [pathKey(i.file), i]));
        return list.map(i => i.file);
      }
      default: return repo.sorted(this.folder, q);
    }
  }
  refresh() {
    this.styleRail(); this.rebuildActions();
    if (this.docked) { if (this.mode === FOLDER && !samePath(this.folder, this.repository.root)) this.tree.select(this.folder); else { this.tree.sel = null; this.tree.reload(); } this.updateDrawerCounts().catch(() => {}); }
    return this.refreshGrid();
  }
  styleRail() { this.railButtons.forEach((b, i) => b.classList.toggle('on', i === 3 ? this.mode === TRASH : this.mode === i)); }
  _updateHeading(items) {
    const repo = this.repository, root = repo.root;
    const title = this.mode === ALL ? '모든 노트' : this.mode === FAVORITES ? '즐겨찾기' : this.mode === RECENT ? '최근 문서' : this.mode === TRASH ? '휴지통' : samePath(this.folder, root) ? '문서함' : baseName(this.folder);
    this.heading.textContent = title;
    if (this.mode === TRASH) this.subtitle.textContent = '휴지통의 문서는 복원하거나 완전히 삭제할 수 있습니다. 각 항목에 삭제한 날짜가 표시됩니다.';
    else this.subtitle.textContent = '';   // Samsung Notes shows no count line under the title (the counts live in the navigation pane)
    this.sortBox.style.display = this.mode === TRASH || this.mode === RECENT ? 'none' : '';
    const rev = repo.sortReverse();
    this.sortButton.querySelector('.t').textContent = this.sortLabel();
    const dir = this.sortDir.querySelector('.ico'); if (dir) setIcon(dir, (repo.sortMode() === 1) !== rev ? 'ic_arrow_up' : 'ic_arrow_down');
    this.page.classList.toggle('trash', this.mode === TRASH);
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
    this.page.classList.toggle('selecting', this.selectionMode);
    this.compose.style.display = this.selectionMode || this.mode === TRASH ? 'none' : '';
    if (this.selectionMode) { this.selectionCount.textContent = `${this.selected.size}개 선택됨`; this.rebuildSelectionCommands(); }
    const viewMode = repo.viewMode();
    const cell = viewMode === 1 ? 92 : 120;
    this.grid.classList.toggle('list', viewMode === 2);
    this.grid.style.gridTemplateColumns = viewMode === 2 ? 'minmax(0, 1fr)' : `repeat(auto-fill, ${cell + 16}px)`;
    this.grid.textContent = '';
    if (!items.length) {
      this.grid.append(h('div', { class: 'lib-empty' }, this.search.value.length > 0 ? '검색 결과가 없습니다' : this.mode === FAVORITES ? '즐겨찾기한 문서가 없습니다' : this.mode === TRASH ? '휴지통이 비어 있습니다' : '아직 문서가 없습니다'));
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
    const repo = this.repository, isDir = repo.isDirectory(file), m = this._meta.get(pathKey(file)) || {};
    const trashItem = this.mode === TRASH ? this._trash.get(pathKey(file)) : null, name = trashItem ? trashItem.name : baseName(file);
    const frame = h('div', { class: 'lib-frame' + (isDir ? ' dir' : ''), style: { width: cell + 'px', height: cell + 'px' } });
    if (isDir) {
      frame.append(folderGlyph(repo.folderColor(file), Math.round(cell * .46)), h('div', { class: 'lib-fcount' }, String(m.count ?? 0)));
      if (this.selectionMode) frame.append(checkboxEl(this.selected.has(file), '선택 ' + name, () => this.toggleSelected(file)));
    } else {
      frame.append(this._cover(file, version, false));
      if (!trashItem && repo.favorite(file)) frame.append(h('div', { class: 'lib-fav' }, icon('ic_star', 14, '#FFB020')));
      if (this.selectionMode) frame.append(checkboxEl(this.selected.has(file), '선택 ' + name, () => this.toggleSelected(file)));
    }
    const card = h('div', { class: 'lib-card', 'aria-label': name, dataset: { tag: 'document:' + name } }, frame, h('div', { class: 'lib-name' }, stripPdf(name)));
    if (!isDir) card.append(h('div', { class: 'lib-date' }, trashItem ? '삭제 ' + dateText(trashItem.deleted || m.modified || 0) : dateText(m.modified || 0)));
    card.addEventListener('click', () => this.openOrSelect(file, card));
    onLongPress(card, el => this.longPressed(file, el));
    return card;
  }
  listItem(file, version) {
    const repo = this.repository, isDir = repo.isDirectory(file), m = this._meta.get(pathKey(file)) || {};
    const trashItem = this.mode === TRASH ? this._trash.get(pathKey(file)) : null, name = trashItem ? trashItem.name : baseName(file);
    const img = h('div', { class: 'img' });
    if (isDir) img.append(folderGlyph(repo.folderColor(file), 30));
    else img.append(this._cover(file, version, true));
    let meta;
    if (isDir) meta = `${m.count ?? 0}개 항목`;
    else if (trashItem) meta = '삭제 ' + dateText(trashItem.deleted || 0);
    else {
      meta = dateText(m.modified || 0);
      if (this.mode === ALL || this.mode === FAVORITES || this.mode === RECENT) { const p = parentOf(file); meta += ' · ' + (samePath(p, repo.root) ? '문서함' : baseName(p)); }
    }
    const row = h('div', { class: 'lib-row', 'aria-label': name, dataset: { tag: 'document:' + name } }, img,
      h('div', { class: 'txt' }, h('div', { class: 'nm' }, stripPdf(name)), h('div', { class: 'meta' }, meta)));
    if (!isDir && !trashItem && repo.favorite(file)) row.append(icon('ic_star', 18, '#FFB020'));
    if (this.selectionMode) row.append(checkboxEl(this.selected.has(file), '선택 ' + name, () => this.toggleSelected(file), 'row'));
    row.addEventListener('click', () => this.openOrSelect(file, row));
    onLongPress(row, el => this.longPressed(file, el));
    return row;
  }
  longPressed(file, anchor) {
    if (this.repository.isDirectory(file)) this.folderMenu(file, anchor);
    else { this.selectionMode = true; this.selected.add(file); this._render(++this.generation); }
  }
  openOrSelect(file, anchor) {
    if (this.repository.isDirectory(file)) this.selectFolder(file);
    else if (this.selectionMode) this.toggleSelected(file);
    else if (this.mode === TRASH) { const item = this._trash.get(pathKey(file)); if (item) this.trashItemMenu(item, anchor); }
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
      new R('폴더 일괄 불러오기', 'ic_folder_open', () => { if (this.actions.importFolder) this.actions.importFolder(target()); }).tint('#007AFF'),
    ]);
  }
  libraryMenu(anchor) {
    const R = AnchoredMenu.Row, repo = this.repository;
    const rows = [];
    if (window.innerWidth < 760 && this.mode !== TRASH) rows.push(
      new R('PDF 가져오기', 'ic_pdf_import', () => { this.dismiss(); if (this.actions.importFiles) this.actions.importFiles(this._target()); }),
      R.divider());
    rows.push(new R('폴더 만들기', 'ic_folder_add', () => this.createFolder(this._target(), () => { this.tree.reload(); this.refresh(); })));
    if (this.mode !== TRASH && this.actions.importFolder) rows.push(new R('폴더 일괄 불러오기', 'ic_folder_open', () => this.actions.importFolder(this._target())));
    rows.push(
      new R('선택', null, () => { this.selectionMode = !this.selectionMode; this.selected.clear(); this._render(++this.generation); }),
      new R('보기 방법', null, () => new AlertDialog.Builder().setTitle('보기 방법').setSingleChoiceItems(LibraryRepository.VIEW_NAMES, repo.viewMode(), (d, i) => { repo.viewMode(i); d.dismiss(); this._render(++this.generation); }).show()),
      new R('정렬', null, () => new AlertDialog.Builder().setTitle('정렬').setSingleChoiceItems(LibraryRepository.SORT_NAMES, repo.sortMode(), (d, i) => { repo.sortMode(i); d.dismiss(); this.refreshGrid(); }).show()),
      new R('즐겨찾기 맨 위 고정', null, () => { repo.pinFavorites(!repo.pinFavorites()); this.refreshGrid(); }).selected(repo.pinFavorites()));
    if (this.mode === FOLDER) rows.push(new R('폴더 색상', null, () => this.chooseFolderColor(this.folder)));
    if (this.mode === FOLDER) rows.push(...this._backupRows(this.folder));
    else if (this.actions.restoreBackup) rows.push(new R('백업 불러오기', null, () => this.actions.restoreBackup()));
    if (this.actions.deviceSync) rows.push(new R('다른 기기와 동기화', 'ic_sync', () => this.actions.deviceSync()));
    rows.push(new R('휴지통', null, () => this.showTrash()));
    rows.push(new R('설정', null, () => this.openSettings()));
    this._menu(anchor, rows);
  }
  /** Menu rows for backing a folder up (documents, notes, pictures, recordings) into one zip and for loading such a backup (also on another device). */
  _backupRows(folder) {
    const R = AnchoredMenu.Row, rows = [];
    if (folder && this.actions.backupFolder) rows.push(new R('이 폴더 일괄 백업', null, () => this.actions.backupFolder(folder)));
    if (this.actions.restoreBackup) rows.push(new R('백업 불러오기', null, () => this.actions.restoreBackup()));
    return rows;
  }
  folderMenu(target, anchor) {
    const R = AnchoredMenu.Row;
    this._menu(anchor, [
      new R('선택', null, () => { this.selectionMode = true; this.selected.clear(); this.selected.add(target); this._render(++this.generation); }),
      new R('이름 변경', 'ic_rename', () => this.rename(target)),
      new R('잘라내기 (이동)', 'ic_move', () => this.chooseDestination([target], true)),
      new R('복사', 'ic_copy', () => this.chooseDestination([target], false)),
      new R('삭제', 'ic_delete', () => this.deleteDocuments([target])).tint('#FF3B30'),
      R.divider(),
      new R('폴더 색상', null, () => this.chooseFolderColor(target)),
      new R('하위 폴더 만들기', null, () => this.createFolder(target, () => { this.tree.reload(); this.refresh(); })),
      ...this._backupRows(target),
    ]);
  }
  folderManageMenu(anchor) {
    const R = AnchoredMenu.Row;
    this._menu(anchor, [
      new R('폴더 만들기', null, () => this.createFolder(this.tree.selected(), () => { this.tree.reload(); this.refresh(); })),
      new R('선택한 폴더 색상', null, () => this.chooseFolderColor(this.tree.selected())),
      ...this._backupRows(this.tree.selected()),
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
    const dir = this.repository.isDirectory(file);
    const f = inputField({ text: dir ? baseName(file) : stripPdf(baseName(file)), label: '이름' });
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
      if (this.repository.isDirectory(file)) {
        const r = await this.repository.transferFolder(file, target, name, move);
        this.busy = false; progress.dismiss();
        if (this.actions.changed) for (const [a, b] of r.changes) this.actions.changed(a, b, move);
        this.tree.reload();
      } else {
        const saved = await this.repository.transfer(file, target, name, move);
        this.busy = false; progress.dismiss();
        if (this.actions.changed) this.actions.changed(file, saved, move);
      }
      this.selectionMode = false; this.selected.clear(); this.refresh();
    } catch (e) { this.busy = false; progress.dismiss(); toast(e.message || '작업에 실패했습니다', LONG_TOAST); }
  }
  async transferMany(files, destination, move) {
    if (this.busy) return; this.busy = true;
    const progress = ProgressDialog.show('', move ? '문서를 이동하는 중…' : '문서를 복사하는 중…');
    const changes = []; let error = '';
    for (const file of files) {
      try {
        if (this.repository.isDirectory(file)) changes.push(...(await this.repository.transferFolder(file, destination, baseName(file), move)).changes);
        else changes.push([file, await this.repository.transfer(file, destination, baseName(file), move)]);
      } catch (e) { error = e.message || '작업에 실패했습니다'; }
    }
    this.busy = false; progress.dismiss(); if (this.tree) this.tree.reload();
    if (this.actions.changed) for (const [a, b] of changes) this.actions.changed(a, b, move);
    this.selectionMode = false; this.selected.clear(); this.refresh();
    if (error) toast(error, LONG_TOAST);
  }
  deleteDocuments(files) {
    const folders = files.filter(f => this.repository.isDirectory(f)).length;
    new AlertDialog.Builder().setTitle(folders ? '삭제' : '문서 삭제').setMessage(folders ? `선택한 ${files.length}개 항목(폴더 ${folders}개 포함)을 삭제할까요? 폴더 안의 문서는 휴지통으로 이동합니다.` : `${files.length}개 문서를 휴지통으로 이동할까요?`)
      .setPositiveButton('삭제', async () => {
        if (this.busy) return; this.busy = true;
        const progress = ProgressDialog.show('', '휴지통으로 이동하는 중…');
        const removed = []; let error = '';
        for (const file of files) {
          try {
            if (this.repository.isDirectory(file)) removed.push(...await this.repository.trashFolder(file)); else { await this.repository.trash(file); removed.push(file); }
          }
          catch (e) { error = e.message || '삭제에 실패했습니다'; }
        }
        this.busy = false; progress.dismiss();
        if (this.actions.removed) this.actions.removed(removed);
        this.selectionMode = false; this.selected.clear(); if (this.tree) this.tree.reload(); this.refresh();
        if (error) toast(error, LONG_TOAST);
      }).setNegativeButton('취소').show();
  }
  /** 휴지통 is a view of the library (Samsung Notes style): a card per deleted document, 편집 / 비우기 in the header. */
  showTrash() { this.showMode(TRASH); }
  trashItemMenu(item, anchor) {
    const R = AnchoredMenu.Row;
    this._menu(anchor, [
      new R('복원', 'ic_restore', () => this.restoreItems([item])),
      new R('완전히 삭제', 'ic_delete', () => this.confirmPurge([item])).danger()]);
  }
  async restoreItems(items) {
    const repo = this.repository; let n = 0, error = '';
    for (const item of items) {
      try { const restored = await repo.restore(item); n++; if (this.actions.changed) this.actions.changed(item.file, restored, true); }
      catch (e) { error = e.message || '복원하지 못했습니다'; }
    }
    this.selectionMode = false; this.selected.clear(); this.refresh();
    toast(error || (n === 1 ? '복원했습니다' : `${n}개 문서를 복원했습니다`), error ? LONG_TOAST : undefined);
  }
  /** Samsung style confirm card: one sentence, 삭제 (accent) | 취소. */
  confirmPurge(items) {
    new AlertDialog.Builder().setMessage(`항목 ${items.length}개가 완전히 삭제됩니다. 되돌릴 수 없습니다.`)
      .setPositiveButton('삭제', async () => {
        if (this.busy) return; this.busy = true;
        let error = '';
        for (const item of items) { try { await this.repository.purge(item); } catch (e) { error = e.message || '삭제에 실패했습니다'; } }
        this.busy = false; this.selectionMode = false; this.selected.clear(); this.refresh();
        if (error) toast(error, LONG_TOAST);
      }).setNegativeButton('취소').show();
  }
  confirmEmptyTrash(count) {
    if (!count) { toast('휴지통이 비어 있습니다'); return; }
    new AlertDialog.Builder().setMessage(`휴지통의 항목 ${count}개가 완전히 삭제됩니다. 되돌릴 수 없습니다.`)
      .setPositiveButton('삭제', async () => {
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
