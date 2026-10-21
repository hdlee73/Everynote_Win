// EPUB support (Windows port of Android v1.69.0 EpubReaderActivity / EpubBook / EpubPdf).
//
//   openEpub(app, path, name)  opens a read-only reflowable reader as a full-window layer. Font size, line spacing, margins, font and
//                              theme exist only in this layer, so the document screens used for PDFs keep their menus. "필기" turns the
//                              book into a PDF with the same settings (pages drawn on a canvas, one JPEG per page) and opens it in the
//                              normal note editor; changing the settings later makes a new PDF and does not carry over annotations.
//   readZip / EpubBook / chapterBlocks / layoutBlocks are exported for tests.
import { h, baseName, joinPath, uuid } from './util.js';
import { host } from './host.js';
import { AlertDialog } from './ui/alert.js';
import { toast } from './ui/toast.js';

// ---------------------------------------------------------------- zip (central directory + DecompressionStream)
export async function readZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let e = bytes.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('EPUB 파일이 아닙니다');
  const count = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const entries = new Map();
  const dec = new TextDecoder('utf-8');
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('EPUB 구조를 읽을 수 없습니다');
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true),
      elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    if (!name.endsWith('/')) entries.set(name.toLowerCase(), { name, method, csize, lho });
    p += 46 + nlen + elen + clen;
  }
  return {
    names: [...entries.values()].map(x => x.name),
    has: n => entries.has(String(n).toLowerCase()),
    async read(n) {
      const en = entries.get(String(n).toLowerCase());
      if (!en) return null;
      const start = en.lho + 30 + dv.getUint16(en.lho + 26, true) + dv.getUint16(en.lho + 28, true);
      const data = bytes.subarray(start, start + en.csize);
      if (en.method === 0) return data;
      if (en.method !== 8) throw new Error('지원하지 않는 압축 방식입니다');
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    },
  };
}

// ---------------------------------------------------------------- package
const MIME = {
  html: 'text/html', xhtml: 'text/html', htm: 'text/html', css: 'text/css', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
};
export const mimeOf = path => MIME[(/\.([^./]+)$/.exec(path) || [, ''])[1].toLowerCase()] || 'application/octet-stream';

/** Resolves a (URL-encoded, maybe ../) href against a folder inside the package. */
export function resolvePath(base, href) {
  let u = href;
  try { u = decodeURIComponent(href); } catch (e) { /* keep as is */ }
  u = u.startsWith('/') ? u.slice(1) : base + u;
  const out = [];
  for (const s of u.split('/')) { if (s === '' || s === '.') continue; if (s === '..') out.pop(); else out.push(s); }
  return out.join('/');
}
const dirOf = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
const local = el => (el.localName || el.nodeName || '').replace(/^.*:/, '');
const parseXml = text => new DOMParser().parseFromString(text, 'application/xml');
const parseHtml = text => new DOMParser().parseFromString(text, 'text/html');
const textOf = bytes => new TextDecoder('utf-8').decode(bytes);

export class EpubBook {
  constructor(zip) { this.zip = zip; this.spine = []; this.toc = []; this.title = ''; }
  static async open(bytes) {
    const book = new EpubBook(await readZip(bytes));
    await book.parse();
    return book;
  }
  async text(path) { const b = await this.zip.read(path); return b ? textOf(b) : null; }
  spineIndex(path) { const l = String(path).toLowerCase(); return this.spine.findIndex(s => s.toLowerCase() === l); }
  /** Title of the table-of-contents entry that chapter [index] belongs to. */
  chapterTitle(index) {
    let found = null;
    for (const t of this.toc) { const at = this.spineIndex(t.path); if (at >= 0 && at <= index) found = t.title; }
    return found;
  }
  async parse() {
    const container = await this.text('META-INF/container.xml');
    if (!container) throw new Error('EPUB 파일이 아닙니다');
    const root = [...parseXml(container).getElementsByTagName('*')].find(e => local(e) === 'rootfile');
    const opfPath = root && root.getAttribute('full-path') ? resolvePath('', root.getAttribute('full-path')) : null;
    const opfText = opfPath && await this.text(opfPath);
    if (!opfText) throw new Error('EPUB 본문 목록을 찾을 수 없습니다');
    const base = dirOf(opfPath);
    const doc = parseXml(opfText);
    const all = [...doc.getElementsByTagName('*')];
    const titleEl = all.find(e => local(e) === 'title');
    this.title = titleEl ? titleEl.textContent.trim() : '';
    const manifest = new Map();
    for (const e of all) if (local(e) === 'item' && e.getAttribute('id') && e.getAttribute('href'))
      manifest.set(e.getAttribute('id'), { path: resolvePath(base, e.getAttribute('href')), type: e.getAttribute('media-type') || '', props: e.getAttribute('properties') || '' });
    const spineEl = all.find(e => local(e) === 'spine');
    const ncxId = spineEl ? spineEl.getAttribute('toc') : null;
    for (const e of all) if (local(e) === 'itemref') {
      const item = manifest.get(e.getAttribute('idref'));
      if (item && /html/i.test(item.type) && this.zip.has(item.path)) this.spine.push(item.path);
    }
    if (!this.spine.length) throw new Error('읽을 수 있는 본문이 없습니다');
    const items = [...manifest.values()];
    const nav = items.find(i => /(^|\s)nav(\s|$)/.test(i.props));
    if (nav) await this.parseNav(nav.path);
    if (!this.toc.length) {
      const ncx = (ncxId && manifest.get(ncxId)) || items.find(i => /dtbncx/i.test(i.type));
      if (ncx) await this.parseNcx(ncx.path);
    }
  }
  addToc(dir, href, text) {
    const title = String(text).replace(/\s+/g, ' ').trim();
    const path = resolvePath(dir, href.split('#')[0]);
    if (title && this.spineIndex(path) >= 0) this.toc.push({ title, path });
  }
  async parseNav(path) {
    const t = await this.text(path);
    if (!t) return;
    const doc = parseHtml(t), dir = dirOf(path);
    const navs = [...doc.querySelectorAll('nav')];
    const nav = navs.find(n => /toc/.test(n.getAttribute('epub:type') || n.getAttribute('type') || '')) || navs[0];
    if (nav) for (const a of nav.querySelectorAll('a[href]')) this.addToc(dir, a.getAttribute('href'), a.textContent);
  }
  async parseNcx(path) {
    const t = await this.text(path);
    if (!t) return;
    const dir = dirOf(path);
    for (const p of parseXml(t).getElementsByTagName('*')) if (local(p) === 'navPoint') {
      const label = [...p.children].find(c => local(c) === 'navLabel'), content = [...p.children].find(c => local(c) === 'content');
      if (label && content && content.getAttribute('src')) this.addToc(dir, content.getAttribute('src'), label.textContent);
    }
  }
}

// ---------------------------------------------------------------- settings
export const ZOOM = { min: 70, max: 250, step: 10 }, LINE = { min: 12, max: 30 }, MARGIN = { max: 48, step: 4 };
export const FONT_NAMES = ['기본', '명조', '고딕'], THEME_NAMES = ['흰색', '크림', '회색', '검정'];
export const THEME_BG = ['#ffffff', '#f4ecd8', '#3a3a3c', '#000000'], THEME_FG = ['#1c1c1e', '#4a3b28', '#e5e5ea', '#d1d1d6'];
const BAR = ['#f2f2f7', '#e9dfc6', '#2c2c2e', '#111111'];
const FONT_STACK = [null, '"Batang","Noto Serif KR",serif', '"Malgun Gothic","Noto Sans KR",sans-serif'];
const clampInt = (v, lo, hi, d) => { v = parseInt(v, 10); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };

export function loadSettings() {
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem('everynote.epub.settings') || '{}') || {}; } catch (e) { /* defaults */ }
  return {
    zoom: clampInt(raw.zoom, ZOOM.min, ZOOM.max, 100), line: clampInt(raw.line, LINE.min, LINE.max, 16), margin: clampInt(raw.margin, 0, MARGIN.max, 16),
    font: clampInt(raw.font, 0, 2, 0), theme: clampInt(raw.theme, 0, 3, 0),
  };
}
const saveSettings = s => { try { localStorage.setItem('everynote.epub.settings', JSON.stringify(s)); } catch (e) { /* ignore */ } };

/** Style sheet injected into every chapter: overrides the book's own sizes only where the reader has a control. */
export function readerCss(s) {
  const fam = FONT_STACK[s.font], dark = s.theme >= 2, link = dark ? '#8ab4ff' : '#0a5bd8', lh = (s.line / 10).toFixed(1);
  return `html{zoom:${s.zoom / 100};background:${THEME_BG[s.theme]} !important;color:${THEME_FG[s.theme]} !important;}`
    + `body{margin:0 !important;padding:16px ${Math.round(s.margin * 100 / s.zoom)}px 56px !important;box-sizing:border-box !important;max-width:none !important;width:auto !important;overflow-wrap:break-word;background:transparent !important;}`
    + `body,body *{line-height:${lh} !important;color:inherit !important;background-color:transparent !important;max-width:100%;box-sizing:border-box;${fam ? `font-family:${fam} !important;` : ''}}`
    + `code,pre,tt,kbd{font-family:monospace !important;}img,svg,video{max-width:100% !important;height:auto !important;}a,a *{color:${link} !important;}`;
}

// ---------------------------------------------------------------- reader
const posKey = key => 'everynote.epub.pos.' + key;

export async function openEpub(app, path, name) {
  document.querySelectorAll('.epub-root').forEach(e => e.remove());
  toast('책을 불러오는 중…', 1500);
  let book, size = 0;
  try {
    const bytes = await host.readBytes(path);
    size = bytes.length;
    book = await EpubBook.open(bytes);
  } catch (e) { toast('책을 열 수 없습니다: ' + (e && e.message || e), 4000); return; }
  new EpubReader(app, book, name || baseName(path), (name || path) + '|' + size).start();
}

class EpubReader {
  constructor(app, book, name, key) {
    this.app = app; this.book = book; this.name = name; this.key = key;
    this.s = loadSettings(); this.chapter = 0; this.history = []; this.urls = []; this.ratio = 0; this.token = 0; this.busy = false;
  }
  start() {
    const b = this.book;
    const btn = (label, fn, cls = '') => h('button', { class: 'epub-btn ' + cls, type: 'button', onClick: fn }, label);
    this.titleEl = h('div', { class: 'epub-title' }, b.title || this.name);
    this.frame = h('iframe', { class: 'epub-frame', sandbox: 'allow-same-origin' });
    this.progress = h('div', { class: 'epub-progress' });
    this.top = h('div', { class: 'epub-bar epub-top' }, btn('‹', () => this.back(), 'epub-back'), this.titleEl, btn('목차', () => this.showToc()), btn('Aa', () => this.togglePanel()), btn('필기', () => this.confirmConvert()));
    this.bottom = h('div', { class: 'epub-bar epub-bottom' }, btn('‹ 이전', () => this.step(-1)), this.progress, btn('다음 ›', () => this.step(1)));
    this.panel = h('div', { class: 'epub-panel', hidden: true });
    this.root = h('div', { class: 'epub-root' }, this.top, h('div', { class: 'epub-body' }, this.frame), this.bottom, this.panel);
    document.body.append(this.root);
    this.applyTheme();
    this.keys = e => {
      if (document.querySelector('.ad-root')) return;
      if (e.key === 'Escape' || e.key === 'BrowserBack') { e.preventDefault(); e.stopImmediatePropagation(); this.back(); }
      else if (e.key === 'ArrowRight') this.step(1);
      else if (e.key === 'ArrowLeft') this.step(-1);
    };
    document.addEventListener('keydown', this.keys, true);
    this.mouse = e => { if (e.button === 3) { e.preventDefault(); e.stopPropagation(); this.back(); } };
    window.addEventListener('mouseup', this.mouse, true);
    let at = 0, ratio = 0;
    try { const p = JSON.parse(localStorage.getItem(posKey(this.key)) || 'null'); if (p) { at = p.c | 0; ratio = +p.r || 0; } } catch (e) { /* first time */ }
    this.open(Math.max(0, Math.min(b.spine.length - 1, at)), ratio, null);
  }

  doc() { try { return this.frame.contentDocument; } catch (e) { return null; } }
  scroller() { const d = this.doc(); return d && (d.scrollingElement || d.documentElement); }
  currentRatio() { const s = this.scroller(); if (!s) return 0; const r = s.scrollHeight - s.clientHeight; return r <= 0 ? 0 : Math.max(0, Math.min(1, s.scrollTop / r)); }

  applyTheme() {
    const r = this.root.style;
    r.setProperty('--epub-bg', THEME_BG[this.s.theme]); r.setProperty('--epub-fg', THEME_FG[this.s.theme]); r.setProperty('--epub-bar', BAR[this.s.theme]);
  }
  applyStyle() {
    const d = this.doc();
    if (!d || !d.head) return;
    let st = d.getElementById('en-style');
    if (!st) { st = d.createElement('style'); st.id = 'en-style'; d.head.append(st); }
    st.textContent = readerCss(this.s);
  }

  /** Loads chapter [index]; pictures, style sheets and fonts of the zip are given to the sandboxed frame as blob URLs. */
  async open(index, ratio, fragment) {
    const my = ++this.token;
    this.chapter = Math.max(0, Math.min(this.book.spine.length - 1, index));
    const path = this.book.spine[this.chapter];
    this.updateProgress(ratio);
    let html;
    try { html = await this.render(path); } catch (e) { toast('장을 표시할 수 없습니다'); return; }
    if (my !== this.token) return;
    this.revoke();
    this.urls = html.urls;
    await new Promise(res => { this.frame.onload = res; this.frame.srcdoc = html.text; });
    if (my !== this.token) return;
    const d = this.doc();
    if (!d) return;
    this.applyStyle();
    d.addEventListener('click', ev => this.onLink(ev, path));
    d.addEventListener('scroll', () => this.updateProgress(), { passive: true });
    d.addEventListener('keydown', this.keys, true);
    const place = () => {
      const t = fragment && (d.getElementById(fragment) || d.getElementsByName(fragment)[0]);
      if (t) t.scrollIntoView(); else { const s = this.scroller(); if (s && ratio > 0) s.scrollTop = ratio * (s.scrollHeight - s.clientHeight); }
      this.updateProgress();
    };
    place(); setTimeout(place, 400);   // again once pictures have their final height
  }
  revoke() { for (const u of this.urls) URL.revokeObjectURL(u); this.urls = []; }

  async render(path) {
    const text = await this.book.text(path);
    if (text == null) throw new Error('missing');
    const doc = parseHtml(text), dir = dirOf(path), urls = [];
    doc.querySelectorAll('script,iframe,object,embed,base').forEach(e => e.remove());
    const blobUrl = async rel => {
      if (!rel || /^(data:|https?:|blob:|#)/i.test(rel)) return null;
      const p = resolvePath(dir, rel), bytes = await this.book.zip.read(p);
      if (!bytes) return null;
      const u = URL.createObjectURL(new Blob([bytes], { type: mimeOf(p) }));
      urls.push(u); return u;
    };
    for (const img of doc.querySelectorAll('img[src]')) { const u = await blobUrl(img.getAttribute('src')); if (u) img.setAttribute('src', u); img.removeAttribute('srcset'); }
    for (const img of doc.querySelectorAll('image')) {
      const a = img.getAttribute('xlink:href') ? 'xlink:href' : 'href', u = await blobUrl(img.getAttribute(a));
      if (u) img.setAttribute(a, u);
    }
    for (const link of [...doc.querySelectorAll('link[rel~="stylesheet"][href]')]) {
      const p = resolvePath(dir, link.getAttribute('href')), css = await this.book.text(p);
      link.remove();
      if (css == null) continue;
      const st = doc.createElement('style');
      st.textContent = await this.cssUrls(css, dirOf(p), blobUrl);
      doc.head.append(st);
    }
    const meta = doc.createElement('meta'); meta.setAttribute('charset', 'utf-8'); doc.head.prepend(meta);
    return { text: '<!doctype html>' + doc.documentElement.outerHTML, urls };
  }
  async cssUrls(css, dir, blobUrl) {
    const found = [...css.matchAll(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/g)];
    let out = css;
    for (const m of found) { const u = await blobUrl(resolveRel(dir, m[2])); if (u) out = out.split(m[0]).join(`url("${u}")`); }
    return out;
  }

  onLink(ev, path) {
    const a = ev.target.closest && ev.target.closest('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    ev.preventDefault();
    if (/^https?:/i.test(href)) { host.shellOpen(href).catch(() => {}); return; }
    if (/^(mailto|javascript|data):/i.test(href)) return;
    const [file, frag] = href.split('#');
    const target = file ? resolvePath(dirOf(path), file) : path;
    const at = this.book.spineIndex(target);
    if (at < 0) return;
    if (at === this.chapter) {
      const d = this.doc(), t = frag && d && (d.getElementById(frag) || d.getElementsByName(frag)[0]);
      if (t) t.scrollIntoView();
      return;
    }
    this.push(); this.open(at, 0, frag || null);
  }
  push() { if (this.history.length > 50) this.history.shift(); this.history.push({ c: this.chapter, r: this.currentRatio() }); }
  step(dir) {
    const next = this.chapter + dir;
    if (next < 0 || next >= this.book.spine.length) { toast(dir < 0 ? '첫 부분입니다' : '마지막 부분입니다'); return; }
    this.open(next, 0, null);
  }
  updateProgress(ratio) {
    const r = ratio == null ? this.currentRatio() : ratio, t = this.book.chapterTitle(this.chapter);
    this.progress.textContent = (t ? t + ' · ' : '') + (this.chapter + 1) + '/' + this.book.spine.length + ' · ' + Math.round(r * 100) + '%';
    if (ratio == null) this.save();
  }
  save() { try { localStorage.setItem(posKey(this.key), JSON.stringify({ c: this.chapter, r: this.currentRatio() })); } catch (e) { /* ignore */ } }

  // Back: settings panel, then the position before the last link / table-of-contents jump, then the previous screen.
  back() {
    if (!this.panel.hidden) { this.panel.hidden = true; return; }
    if (this.history.length) { const p = this.history.pop(); this.open(p.c, p.r, null); return; }
    this.close();
  }
  close() {
    this.save();
    document.removeEventListener('keydown', this.keys, true);
    window.removeEventListener('mouseup', this.mouse, true);
    this.token++; this.revoke(); this.root.remove();
  }

  showToc() {
    const b = this.book, entries = b.toc.length ? b.toc : b.spine.map((p, i) => ({ title: (i + 1) + '.', path: p }));
    const cur = b.toc.length ? b.chapterTitle(this.chapter) : null;
    const items = entries.map((e, i) => (b.toc.length ? (e.title === cur && b.spineIndex(e.path) <= this.chapter) : i === this.chapter) ? '● ' + e.title : '    ' + e.title);
    new AlertDialog.Builder().setTitle('목차').setItems(items, (d, which) => {
      const at = b.spineIndex(entries[which].path);
      if (at >= 0) { this.push(); this.open(at, 0, null); }
    }).setNegativeButton('닫기', null).show();
  }

  togglePanel() {
    if (!this.panel.hidden) { this.panel.hidden = true; return; }
    this.buildPanel(); this.panel.hidden = false;
  }
  buildPanel() {
    const s = this.s, set = () => { saveSettings(s); this.applyStyle(); };
    const slider = (label, value, min, max, step, fmt, on) => {
      const shown = h('span', { class: 'epub-val' }, fmt(value));
      const input = h('input', { type: 'range', min, max, step, value, onInput: () => { const v = +input.value; on(v); shown.textContent = fmt(v); set(); } });
      return h('label', { class: 'epub-row' }, h('span', { class: 'epub-label' }, label), input, shown);
    };
    const chips = (label, names, current, on, swatch) => h('div', { class: 'epub-row' }, h('span', { class: 'epub-label' }, label),
      ...names.map((n, i) => h('button', {
        type: 'button', class: 'epub-chip' + (i === current ? ' on' : ''), style: swatch ? { background: THEME_BG[i], color: THEME_FG[i] } : null,
        onClick: () => { on(i); set(); this.applyTheme(); this.buildPanel(); },
      }, n)));
    this.panel.replaceChildren(
      slider('글자 크기', s.zoom, ZOOM.min, ZOOM.max, ZOOM.step, v => v + '%', v => { s.zoom = v; }),
      slider('줄 간격', s.line, LINE.min, LINE.max, 1, v => (v / 10).toFixed(1), v => { s.line = v; }),
      slider('여백', s.margin, 0, MARGIN.max, MARGIN.step, v => String(v), v => { s.margin = v; }),
      chips('글꼴', FONT_NAMES, s.font, i => { s.font = i; }),
      chips('배경', THEME_NAMES, s.theme, i => { s.theme = i; }, true));
  }

  // ---- conversion to a PDF for note taking
  confirmConvert() {
    new AlertDialog.Builder().setTitle('PDF로 변환해 필기하기')
      .setMessage('지금의 글자 크기·줄 간격·여백·글꼴로 책을 PDF로 만들어 문서함에 저장하고, 필기 화면에서 엽니다.\n\n'
        + '나중에 설정을 바꿔 다시 변환하면 새 PDF가 따로 만들어지며, 이미 쓴 필기는 새 PDF로 옮겨지지 않습니다. 표나 복잡한 그림이 있는 책은 읽기 화면과 모양이 다를 수 있습니다.')
      .setPositiveButton('변환', () => this.convert()).setNegativeButton('취소', null).show();
  }
  async convert() {
    if (this.busy) return;
    this.busy = true;
    const status = h('div', { class: 'm-statusview' }, 'PDF를 만드는 중…');
    let cancelled = false;
    const dlg = new AlertDialog.Builder().setTitle('PDF로 변환').setView(status).setCancelable(false).setNegativeButton('취소', () => { cancelled = true; }).create();
    dlg.show();
    let tmp = null;
    try {
      const bytes = await buildPdf(this.book, this.s, (d, t) => { status.textContent = `PDF를 만드는 중… ${d}/${t}`; }, () => cancelled);
      status.textContent = '문서함에 저장하는 중';
      tmp = joinPath(await tempDir(this.app), 'epub-' + uuid() + '.pdf');
      await host.writeBytes(tmp, bytes);
      const base = (this.name.replace(/\.epub$/i, '').replace(/[\\/:*?"<>|]/g, '_').trim()) || '책';
      const saved = await this.app.library.importPdf(tmp, base + '.pdf', await this.app.importDestination());
      dlg.dismiss();
      this.close();
      await this.app.openPdf(saved);
      toast('EPUB을 PDF로 변환해 열었습니다. 필기할 수 있습니다', 3000);
    } catch (e) {
      dlg.dismiss();
      if (!cancelled) toast('PDF 변환 실패: ' + (e && e.message || e), 4000);
    } finally {
      this.busy = false;
      if (tmp) host.delete(tmp).catch(() => {});
    }
  }
}

async function tempDir(app) {
  const dir = (app.hostInfo && app.hostInfo.temp) || joinPath((app.hostInfo && app.hostInfo.data) || 'C:\\', 'tmp');
  await host.mkdir(dir).catch(() => {});
  return dir;
}
function resolveRel(dir, href) { return /^\//.test(href) ? href.slice(1) : dir + href; }

// ---------------------------------------------------------------- PDF (A5, canvas pages)
export const PAGE = { w: 420, h: 595, scale: 2.5, base: 14 };
const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'TR', 'SECTION', 'ARTICLE', 'UL', 'OL', 'TABLE', 'FIGURE', 'FIGCAPTION', 'HR', 'DT', 'DD', 'HEADER', 'FOOTER', 'ASIDE', 'BODY']);
const HEADING = { H1: 1.6, H2: 1.4, H3: 1.2, H4: 1.1, H5: 1.05, H6: 1.0 };

/** Flattens a chapter into blocks: {runs:[{t,b,i}], size, before} text blocks and {img: Blob-URL-less bytes} picture blocks. */
export async function chapterBlocks(book, path) {
  const text = await book.text(path);
  if (text == null) return [];
  const doc = parseHtml(text), dir = dirOf(path), blocks = [];
  let cur = null;
  const flush = () => {
    if (cur) {
      const runs = cur.runs;
      if (runs.length) { runs[0].t = runs[0].t.replace(/^\s+/, ''); runs[runs.length - 1].t = runs[runs.length - 1].t.replace(/\s+$/, ''); }
      if (runs.some(r => r.t.length)) blocks.push(cur);
    }
    cur = null;
  };
  const ensure = (size, bullet) => { if (!cur) cur = { runs: bullet ? [{ t: '• ', b: false, i: false }] : [], size, before: 0 }; return cur; };
  const walk = (node, st) => {
    if (node.nodeType === 3) {
      const t = node.nodeValue.replace(/\s+/g, ' ');
      if (!t.trim() && !cur) return;
      ensure(st.size).runs.push({ t, b: st.b, i: st.i });
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toUpperCase();
    if (['SCRIPT', 'STYLE', 'HEAD', 'TITLE'].includes(tag)) return;
    if (tag === 'BR') { ensure(st.size).runs.push({ t: '\n', b: false, i: false }); return; }
    if (tag === 'IMG' || tag === 'IMAGE') {
      flush();
      const src = node.getAttribute('src') || node.getAttribute('xlink:href') || node.getAttribute('href');
      if (src && !/^(data:|https?:)/i.test(src)) blocks.push({ img: resolvePath(dir, src) });
      return;
    }
    const block = BLOCK.has(tag);
    const next = { size: HEADING[tag] || st.size, b: st.b || !!HEADING[tag] || tag === 'B' || tag === 'STRONG', i: st.i || tag === 'I' || tag === 'EM' || tag === 'CITE' };
    if (block) { flush(); if (tag === 'LI') ensure(next.size, true); }
    for (const c of node.childNodes) walk(c, next);
    if (block) flush();
  };
  walk(doc.body || doc.documentElement, { size: 1, b: false, i: false });
  flush();
  return blocks;
}

const isCjk = ch => /[\u1100-\u11ff\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/.test(ch);
function tokens(text) {
  const out = []; let word = '';
  for (const ch of text) {
    if (ch === '\n') { if (word) out.push(word); word = ''; out.push('\n'); }
    else if (isCjk(ch)) { if (word) out.push(word); word = ''; out.push(ch); }
    else { word += ch; if (ch === ' ') { out.push(word); word = ''; } }
  }
  if (word) out.push(word);
  return out;
}

/** Lays text blocks out into pages. Returns pages of drawing items; [measure(text, font)] returns the width in points. */
export function layoutBlocks(blocks, measure, opts) {
  const { width, height, fontSize, lineSpacing, family, images } = opts;
  const pages = [[]]; let y = 0;
  const page = () => pages[pages.length - 1];
  const newPage = () => { if (page().length) { pages.push([]); } y = 0; };
  for (const b of blocks) {
    if (b.img) {
      const im = images.get(b.img);
      if (!im) continue;
      let w = Math.min(im.width * 0.5, width), hgt = im.height * (w / im.width);
      const max = height * 0.9;
      if (hgt > max) { w *= max / hgt; hgt = max; }
      if (y + hgt > height) newPage();
      page().push({ img: b.img, x: 0, y, w, h: hgt }); y += hgt + fontSize * 0.5;
      continue;
    }
    const size = fontSize * b.size, lh = size * lineSpacing;
    let line = [], lw = 0;
    const emit = () => {
      if (!line.length) return;
      if (y + lh > height) newPage();
      page().push({ line, x: 0, y, size, lh }); y += lh; line = []; lw = 0;
    };
    for (const run of b.runs) {
      const font = `${run.i ? 'italic ' : ''}${run.b ? 'bold ' : ''}${size}px ${family}`;
      for (const tk of tokens(run.t)) {
        if (tk === '\n') { emit(); continue; }
        const w = measure(tk, font);
        if (lw + w > width && line.length) emit();
        if (!line.length && /^\s+$/.test(tk)) continue;
        line.push({ t: tk, font, x: lw }); lw += w;
      }
    }
    emit();
    y += size * 0.5;
  }
  return pages.filter(p => p.length);
}

export async function buildPdf(book, s, progress, isCancelled) {
  const { PDFDocument } = await import('../vendor/pdflib/pdf-lib.esm.min.js');
  const pdf = await PDFDocument.create();
  const margin = 20 + s.margin, width = PAGE.w - 2 * margin, height = PAGE.h - 2 * margin;
  const family = FONT_STACK[s.font] || '"Malgun Gothic","Segoe UI",sans-serif';
  const probe = document.createElement('canvas').getContext('2d');
  const measure = (t, font) => { probe.font = font; return probe.measureText(t).width; };
  let count = 0;
  for (let c = 0; c < book.spine.length; c++) {
    if (isCancelled()) throw new Error('변환이 취소되었습니다');
    progress(c, book.spine.length);
    const blocks = await chapterBlocks(book, book.spine[c]);
    const images = new Map();
    for (const b of blocks) if (b.img && !images.has(b.img)) {
      const bytes = await book.zip.read(b.img);
      try { images.set(b.img, bytes ? await createImageBitmap(new Blob([bytes], { type: mimeOf(b.img) })) : null); } catch (e) { images.set(b.img, null); }
    }
    const pages = layoutBlocks(blocks, measure, { width, height, fontSize: PAGE.base * s.zoom / 100, lineSpacing: s.line / 10, family, images });
    for (const items of pages) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(PAGE.w * PAGE.scale); canvas.height = Math.round(PAGE.h * PAGE.scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(PAGE.scale, PAGE.scale); ctx.translate(margin, margin);
      ctx.fillStyle = '#1c1c1e'; ctx.textBaseline = 'alphabetic';
      for (const it of items) {
        if (it.img) ctx.drawImage(images.get(it.img), it.x, it.y, it.w, it.h);
        else for (const seg of it.line) { ctx.font = seg.font; ctx.fillText(seg.t, seg.x, it.y + it.size * 0.5 + (it.lh - it.size) / 2 + it.size * 0.35); }
      }
      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
      const jpg = await pdf.embedJpg(new Uint8Array(await blob.arrayBuffer()));
      pdf.addPage([PAGE.w, PAGE.h]).drawImage(jpg, { x: 0, y: 0, width: PAGE.w, height: PAGE.h });
      canvas.width = canvas.height = 0; count++;
    }
    for (const im of images.values()) if (im && im.close) im.close();
  }
  if (!count) throw new Error('PDF로 옮길 본문이 없습니다');
  progress(book.spine.length, book.spine.length);
  return pdf.save();
}
