// MainActivity port, part 2 — MainActivity.java lines 660-1300 (lists/dialogs, study panel, page insert/delete, elements, drag/paste,
// library glue) plus the pieces the lead moved here: shared sheet/dialog primitives (showSheet, swatches, segmented, toggleChip,
// showMemoEditor), the docked side panel (thumbnails / outline / marks) and the docked search panel.
// Java names are kept (camelCase). All methods are assigned onto MainActivity.prototype by installMain2(); helpers that other parts
// may also provide (viewForPage, redrawPages, pill, ...) are only installed when no other part defined them.
import { h, icon, argb, clamp, RectF, baseName, dirName, joinPath } from './util.js';
import { AlertDialog, BUTTON_POSITIVE, BUTTON_NEGATIVE, BUTTON_NEUTRAL } from './ui/alert.js';
import { AnchoredMenu } from './ui/menu.js';
import { toast } from './ui/toast.js';
import { host } from './host.js';
import { AnnotationStore, Mark, StudyEntry, PageElement, OutlineItem } from './store.js';
import { Shapes, Table } from './shapes.js';
import { AnnotationPainter } from './painter.js';
import { PdfDoc } from './pdfdoc.js';
import { NotebookFiles, samePath } from './library.js';
import { SettingsView } from './settings.js';
import { LibraryDialog, PaperChoiceView, ProgressDialog, rebindButton, inputField, defaultNoteStyle } from './library-dialog.js';
import * as Search from './search.js';
import { ColorPicker } from './ui/colorpicker.js';
import { printDocument } from './print.js';
import { showAboutOffline } from './offline.js';
import { createBackup, restoreBackup, compareVersions, AUTHOR_LINE } from './backup.js';
import { SyncClient, SyncError, transferDocument, buildRows, relPath } from './sync.js';

// ------------------------------------------------------------------------------------------------------------------ constants
export const NAVY = '#1C1C1E', ACCENT = '#007AFF', ACTIVE_BG = '#E5F0FF', ACTIVE_FG = '#007AFF', GRAY = '#8E8E93', RED = '#FF3B30';
export const CATEGORY_TITLES = ['문서', '보기·이동', '필기·삽입', '학습·주석', '내보내기·백업'];
export const INK_COLORS = [0xFF1C1C1E, 0xFF636366, 0xFF007AFF, 0xFF16835B, 0xFF7C3AED, 0xFFEA580C, 0xFFDB2777, 0xFFFF3B30].map(c => c | 0);
export const INK_COLORS2 = [0xFF8E1B14, 0xFFB35900, 0xFF8A6D00, 0xFF00746E, 0xFF0040A8, 0xFF2E2C8A, 0xFFFF9AA2, 0xFFA6CBFF].map(c => c | 0);
const RAINBOW = 'conic-gradient(#FF3B30,#FFCC00,#34C759,#00C7BE,#007AFF,#AF52DE,#FF3B30)';
export const INK_WIDTHS = [0.0022, 0.004, 0.0065, 0.009];
export const HIGHLIGHT_COLORS = [0x66FFDE59, 0x6654C27A, 0x66FF6B9A, 0x66549CF5, 0x66B67CF2];
export const TEXT_COLORS = [0xFF1C1C1E, 0xFF8E8E93, 0xFF007AFF, 0xFF16835B, 0xFFEA580C, 0xFFFF3B30, 0xFFDB2777, 0xFF7C3AED].map(c => c | 0);
export const FONT_IDS = ['sans', 'medium', 'light', 'black', 'condensed', 'serif', 'mono', 'typewriter', 'hand', 'casual'];
export const FONT_NAMES = ['고딕 (기본)', '고딕 중간', '고딕 얇게', '고딕 굵게', '고딕 좁게', '명조', '고정폭', '타자기', '손글씨', '캐주얼'];
export const TEXT_PAGE_POINTS = 595;
export const PAPER_COLORS = [0xFFFFF3A6, 0xFFFFD6E0, 0xFFCFE8FF, 0xFFD5F5D0, 0xFFFFE0B8, 0xFFE6D9FF, 0xFFFFFFFF].map(c => c | 0);
export const SIDE_TITLES = ['검색', '미리보기', '개요', '음성 녹음', '삽입 목록'];
const SIDE_TINTS = ['#30B0C7', '#007AFF', '#007AFF', '#FF3B30', '#5856D6'];
export const SIDE_ICONS = ['ic_search', 'ic_thumbnails', 'ic_outline', 'ic_mic', 'ic_link'];
export const STICKER_TITLES = ['별·하트', '낙엽·꽃', '응원·표시', '메모용', '표정·동물', '날씨·생활'];
export const STICKER_GROUPS = [
  ['⭐', '🌟', '✨', '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💖', '💯'],
  ['🍂', '🍁', '🍃', '🌿', '🍀', '🌸', '🌼', '🌻', '🌹', '🌷', '🌲', '🌵'],
  ['👍', '👏', '🙏', '💪', '👀', '🎉', '🎈', '🎁', '🏆', '🥇', '🎯', '🚩'],
  ['💡', '📌', '📍', '✅', '❗', '❓', '⚠️', '🔥', '📝', '🔖', '💬', '🔎'],
  ['😀', '😍', '😎', '🤔', '😮', '😢', '😴', '🥳', '🐶', '🐱', '🦋', '🌈'],
  ['☀️', '🌙', '☁️', '⚡', '❄️', '☕', '🍎', '🍰', '📚', '⏰', '🎵', '✈️']];

// ------------------------------------------------------------------------------------------------------------------ sheet model
/** MainActivity.Section / Tile (bottom sheet content). tint/ARGB ints or css strings are both accepted. */
export class Tile {
  constructor(label, iconName, action) { this.label = label; this.icon = iconName; this.action = action; this.tintV = 0; this.selected = false; this.keepOpen = false; }
  tint(c) { this.tintV = c; return this; }
  select(v = true) { this.selected = v; return this; }
  keepOpenOnClick(v = true) { this.keepOpen = v; return this; }
}
export class Section {
  constructor(title) { this.title = title == null ? null : title; this.tiles = []; this.custom = null; }
  add(tile) { this.tiles.push(tile); return this; }
  setCustom(el) { this.custom = el; return this; }
}

// ------------------------------------------------------------------------------------------------------------------ small helpers
const css = c => typeof c === 'number' ? argb(c) : c;
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));
const later = (fn, ms = 0) => setTimeout(fn, ms);
const errMsg = e => (e && e.message != null) ? e.message : String(e);
const stripPdf = t => String(t || '').replace(/\.pdf$/i, '');
const clearList = l => { if (!l) return; if (Array.isArray(l)) l.length = 0; else if (l.clear) l.clear(); };
const toInt = v => v | 0;

/** android ImageButton from MainActivity.icon(): 24px glyph centered, transparent. */
export function iconButton(name, desc, tint, onClick, w = 44, hh = 44) {
  const b = h('div', { class: 'm2-ib', role: 'button', tabindex: '-1', 'aria-label': desc, title: desc, style: { width: w + 'px', height: hh + 'px', color: css(tint) } }, icon(name, 24, 'currentColor'));
  if (onClick) b.addEventListener('click', e => { e.stopPropagation(); onClick(e); });
  return b;
}
export function setTint(btn, tint) { btn.style.color = css(tint); }

/** EditText with min/max lines (textarea) or single line (input). */
export function editText({ hint = '', value = '', minLines = 1, maxLines = 1, numeric = false, decimal = false, center = false, cls = 'field', style = null } = {}) {
  const multi = maxLines > 1 || minLines > 1;
  const el = h(multi ? 'textarea' : 'input', { class: cls + ' m2-edit', placeholder: hint, spellcheck: 'false', 'aria-label': hint || null });
  if (!multi) el.type = 'text';
  if (numeric) el.setAttribute('inputmode', 'numeric');
  if (decimal) el.setAttribute('inputmode', 'decimal');
  el.value = value == null ? '' : String(value);
  if (center) el.style.textAlign = 'center';
  if (style) Object.assign(el.style, style);
  if (multi) {
    el.rows = minLines;
    const fit = () => {
      el.style.height = 'auto';
      const cs = getComputedStyle(el), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
      const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
      const min = lh * minLines + pad, max = maxLines >= 1000 ? 1e9 : lh * maxLines + pad;
      el.style.height = Math.max(min, Math.min(max, el.scrollHeight + (parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth)))) + 'px';
    };
    el.addEventListener('input', fit);
    requestAnimationFrame(() => requestAnimationFrame(fit)); setTimeout(fit, 60);
    el._fit = fit;
  }
  return el;
}

/** Overlay shell: dim backdrop + content, outside click / Esc dismiss, fade or bottom-sheet animation (css .ad-root). */
class Overlay {
  constructor(content, { sheet = false, cancelable = true, onDismiss = null, z = 9000 } = {}) {
    this.sheet = sheet; this.dismissed = false; this.onDismiss = onDismiss; this.cancelable = cancelable;
    this.root = h('div', { class: 'ad-root m2-overlay' + (sheet ? ' sheet' : ''), style: { zIndex: z } });
    this.dim = h('div', { class: 'ad-dim' }); this.root.append(this.dim); this.dim.append(content); this.content = content;
    this.dim.addEventListener('mousedown', e => { if (e.target === this.dim && this.cancelable) this.dismiss(); });
  }
  show() {
    document.body.append(this.root);
    requestAnimationFrame(() => this.root.classList.add('in'));
    this._key = e => { if (e.key === 'Escape' && this.cancelable) { e.stopPropagation(); e.preventDefault(); this.dismiss(); } };
    document.addEventListener('keydown', this._key, true);
    return this;
  }
  dismiss() {
    if (this.dismissed) return; this.dismissed = true;
    document.removeEventListener('keydown', this._key, true);
    this.root.classList.remove('in'); this.root.classList.add('out');
    setTimeout(() => this.root.remove(), this.sheet ? 170 : 120);
    if (this.onDismiss) this.onDismiss(this);
  }
  isShowing() { return !this.dismissed; }
}

/** Build + show an AlertDialog card quickly. buttons: {positive:[label,fn], negative:[..], neutral:[..]} */
function alertCard({ title = null, message = null, view = null, positive = null, negative = null, neutral = null, onDismiss = null, cancelable = true }) {
  const b = new AlertDialog.Builder();
  if (title != null) b.setTitle(title);
  if (message != null) b.setMessage(message);
  if (view) b.setView(view);
  if (positive) b.setPositiveButton(positive[0], positive[1] || null);
  if (negative) b.setNegativeButton(negative[0], negative[1] || null);
  if (neutral) b.setNeutralButton(neutral[0], neutral[1] || null);
  if (onDismiss) b.setOnDismissListener(onDismiss);
  b.setCancelable(cancelable);
  return b.show();
}
function listDialog(title, labels, onPick, negative = null) {
  const b = new AlertDialog.Builder();
  if (title != null) b.setTitle(title);
  b.setItems(labels, (d, i) => onPick(i));
  if (negative) b.setNegativeButton(negative, null);
  return b.show();
}
function wrapScroll(el, extraStyle) {
  return h('div', { class: 'm2-scroll', style: extraStyle || null }, el);
}

function dialogWidth(dlg, { width = null, maxHeight = null, maxWidth = null } = {}) {
  const card = dlg.root.querySelector('.ad-card'); if (!card) return;
  if (width) card.style.width = width; if (maxWidth) card.style.maxWidth = maxWidth;
  if (maxHeight) { card.style.maxHeight = maxHeight; card.style.display = 'flex'; card.style.flexDirection = 'column'; const body = card.querySelector('.ad-body'); if (body) { body.style.overflow = 'auto'; body.style.flex = '1 1 auto'; body.style.minHeight = '0'; } }
}

// ---- saving / opening files through the host ------------------------------------------------------------------------
async function saveBytesAs(title, name, exts, bytes) {
  const path = await host.saveDialog(title, name, [{ name: exts.join(', ').toUpperCase(), exts }]);
  if (!path) return null;
  await host.writeBytes(path, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  return path;
}
const utf8 = s => new TextEncoder().encode(s);
async function canvasPng(canvas) {
  return await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('PNG 저장 실패')), 'image/png'));
}

// ---- tiny zip writer (stored) for the xlsx export ---------------------------------------------------------------------------------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = ~0; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return ~c >>> 0; }
function zipStore(files) {
  const chunks = [], central = []; let offset = 0;
  const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  for (const [name, data] of files) {
    const nm = utf8(name), crc = crc32(data);
    const local = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nm.length), ...u16(0)]);
    chunks.push(local, nm, data);
    central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nm);
    offset += local.length + nm.length + data.length;
  }
  let csize = 0; for (const c of central) csize += c.length;
  const end = new Uint8Array([0x50, 0x4b, 5, 6, 0, 0, 0, 0, ...u16(files.length), ...u16(files.length), ...u32(csize), ...u32(offset), 0, 0]);
  const all = [...chunks, ...central, end]; let n = 0; for (const c of all) n += c.length;
  const out = new Uint8Array(n); let o = 0; for (const c of all) { out.set(c, o); o += c.length; }
  return out;
}

// ---- StudyExporter ------------------------------------------------------------------------------------------------------------------
const xml = s => String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const htmlEsc = s => xml(s).replace(/\r/g, '').replace(/\n/g, '<br>').replace(/\t/g, '&#9;');
const csvEsc = s => { s = String(s); if (/^\s*[=+@-]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
export function exportStudyBytes(entries, title, format) {
  if (format === 2) return workbook(entries, title);
  if (format === 3) return pdfBytes(entries, title);
  if (format === 4) return docxBytes(entries, title);
  let out = '';
  if (format === 0) out += '# ' + title + '\n\n';
  if (format === 1) out += '﻿document,page,text,comment\r\n';
  for (const e of entries) {
    if (format === 0) out += '## [p.' + (e.page + 1) + ']\n\n' + e.text + '\n\n' + e.comment + '\n\n';
    else out += csvEsc(title) + ',' + (e.page + 1) + ',' + csvEsc(e.text) + ',' + csvEsc(e.comment) + '\r\n';
  }
  return utf8(out);
}
/** Android v1.32.0 StudyExporter.docx: minimal Word package (title, "[p.N]" headings, text, comment). */
function docxBytes(entries, title) {
  const para = (text, bold, size) => '<w:p><w:r><w:rPr>' + (bold ? '<w:b/>' : '') + `<w:sz w:val="${size}"/></w:rPr>` +
    String(text).replace(/\r/g, '').split('\n').map((l, i) => (i ? '<w:br/>' : '') + `<w:t xml:space="preserve">${xml(l)}</w:t>`).join('') + '</w:r></w:p>';
  let body = para(title, true, '32');
  for (const e of entries) { body += para('[p.' + (e.page + 1) + ']', true, '22') + para(e.text, false, '24'); if (e.comment) body += para(e.comment, false, '22'); }
  return zipStore([
    ['[Content_Types].xml', utf8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')],
    ['_rels/.rels', utf8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')],
    ['word/document.xml', utf8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '</w:body></w:document>')],
  ]);
}
/** A4 PDF of the notes. Text is drawn on a canvas (system fonts cover Korean) and each page embedded as a JPEG. Async. */
async function pdfBytes(entries, title) {
  const { PDFDocument } = await import('../vendor/pdflib/pdf-lib.esm.min.js');
  const W = 595, H = 842, M = 48, TW = W - 2 * M, S = 2, FONT = '"Malgun Gothic","Noto Sans KR","Apple SD Gothic Neo",sans-serif';
  const blocks = [{ t: title, size: 20, bold: true, color: '#000', gap: 20 }];
  for (const e of entries) {
    blocks.push({ t: '[p.' + (e.page + 1) + ']', size: 11, bold: true, color: '#0A84FF', gap: 3 });
    blocks.push({ t: String(e.text), size: 12, color: '#000', gap: 4 });
    if (e.comment) blocks.push({ t: String(e.comment), size: 11, color: '#555', gap: 4 });
    blocks[blocks.length - 1].gap = 14;
  }
  const doc = await PDFDocument.create();
  let canvas, ctx, y;
  const newPage = () => { canvas = document.createElement('canvas'); canvas.width = W * S; canvas.height = H * S; ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W * S, H * S); ctx.scale(S, S); ctx.textBaseline = 'top'; y = M; };
  const flush = async () => {
    const jpg = await new Promise(res => canvas.toBlob(res, 'image/jpeg', .92));
    const img = await doc.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
    doc.addPage([W, H]).drawImage(img, { x: 0, y: 0, width: W, height: H });
  };
  newPage();
  for (const b of blocks) {
    ctx.font = (b.bold ? 'bold ' : '') + b.size + 'px ' + FONT;
    const lines = [];
    for (const para of b.t.replace(/\r/g, '').split('\n')) {
      let cur = '';
      for (const ch of para) { if (ctx.measureText(cur + ch).width > TW && cur) { lines.push(cur); cur = ch; } else cur += ch; }
      lines.push(cur);
    }
    const lh = b.size * 1.25, hgt = lines.length * lh;
    if (y + hgt > H - M && y > M) { await flush(); newPage(); ctx.font = (b.bold ? 'bold ' : '') + b.size + 'px ' + FONT; }
    ctx.fillStyle = b.color; lines.forEach((l, i) => ctx.fillText(l, M, y + i * lh));
    y += hgt + b.gap;
  }
  await flush();
  return new Uint8Array(await doc.save());
}
function workbook(entries, title) {
  const row = (n, vals) => `<row r="${n}">` + vals.map((v, i) => `<c r="${String.fromCharCode(65 + i)}${n}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`).join('') + '</row>';
  let sheet = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + row(1, ['document', 'page', 'text', 'comment']);
  let i = 2; for (const e of entries) sheet += row(i++, [title, String(e.page + 1), e.text, e.comment]);
  sheet += '</sheetData></worksheet>';
  return zipStore([
    ['[Content_Types].xml', utf8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')],
    ['_rels/.rels', utf8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')],
    ['xl/workbook.xml', utf8('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Notes" sheetId="1" r:id="rId1"/></sheets></workbook>')],
    ['xl/_rels/workbook.xml.rels', utf8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')],
    ['xl/worksheets/sheet1.xml', utf8(sheet)],
  ]);
}

export function youtubeId(text) {
  if (text == null) return null;
  const m = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^\s]*&)?v=|shorts\/|embed\/|live\/|v\/)|i\d?\.ytimg\.com\/vi(?:_webp)?\/)([A-Za-z0-9_-]{11})/.exec(String(text).trim());
  return m ? m[1] : null;
}

// ====================================================================================================================
// Methods (assigned onto MainActivity.prototype)
// ====================================================================================================================
const M = {};   // methods that always override
const F = {};   // fallbacks installed only when no other part provides the method

// ---- shared UI primitives ---------------------------------------------------------------------------------------------------------------
/** Menu card (MainActivity.showSheet, Android v1.31.0): the same rounded card as the anchored menus - gray caption, grouped rows
 *  (small icon, label, check on the selected one), hairline between groups. sections: Section[] (or duck-typed objects). Returns a dialog with dismiss(). */
M.showSheet = function (title, sections) {
  const sheet = h('div', { class: 'm2-bsheet', dataset: { tag: 'menu_sheet' } });
  let dlg;
  sheet.append(h('div', { class: 'm2-bs-title' }, title));
  const body = h('div', { class: 'm2-bs-body', style: { maxHeight: Math.round(window.innerHeight * .72) + 'px' } });
  sections.forEach((section, s) => {
    if (s > 0) body.append(h('div', { class: 'm2-bs-line' }));
    if (section.title != null) body.append(h('div', { class: 'm2-bs-label' }, section.title));
    if (section.custom) body.append(section.custom);
    for (const tile of section.tiles) body.append(this.sheetTile(() => dlg, tile));
  });
  sheet.append(body);
  dlg = new Overlay(sheet);
  dlg.show();
  return dlg;
};
M.sheetTile = function (dialogOrGetter, tile) {
  const dialog = typeof dialogOrGetter === 'function' ? dialogOrGetter : () => dialogOrGetter;
  const sel = !!tile.selected;
  const cell = h('div', { class: 'm2-tile' + (sel ? ' sel' : ''), role: 'button', 'aria-label': tile.label });
  if (tile.icon) cell.append(icon(tile.icon, 20, tile.tintV ? css(tile.tintV) : ACCENT, 'margin-right:12px;flex:none'));
  cell.append(h('span', { class: 'm2-tile-name', style: { color: sel ? ACCENT : '#1C1C1E', fontWeight: sel ? '700' : '400' } }, tile.label));
  if (sel) cell.append(icon('ic_check_bold', 20, ACCENT, 'margin-left:8px;flex:none'));
  cell.addEventListener('click', () => { if (!tile.keepOpen) dialog().dismiss(); tile.action && tile.action(); });
  return cell;
};
/** colour dots with a check. more: 0 = presets only, 1 = + rainbow chip (ColorPicker), 2 = the same with an opacity slider. */
M.swatches = function (colors, current, choose, size = 32, more = 0) {
  const row = h('div', { class: 'm2-swatches' });
  const dots = [];
  let chip = null;
  const refresh = () => {
    const now = current() | 0;
    dots.forEach((dot, i) => {
      const on = (colors[i] | 0) === now;
      dot.style.background = argb((colors[i] | 0xFF000000) >>> 0);
      dot.style.border = (on ? 3 : 1) + 'px solid ' + (on ? NAVY : '#D5DCE6');
      dot.textContent = ''; if (on) dot.append(icon('ic_check', 20, '#fff'));
    });
    if (chip) {
      const custom = !colors.some(c => (c | 0) === now);
      chip.style.background = custom ? argb(now >>> 0) : RAINBOW;
      chip.style.border = (custom ? 3 : 1) + 'px solid ' + (custom ? NAVY : '#D5DCE6');
      chip.textContent = ''; if (custom) chip.append(icon('ic_check', 20, '#fff'));
    }
  };
  colors.forEach((c, i) => {
    const dot = h('div', { class: 'm2-dot', role: 'button', 'aria-label': '색상 ' + (i + 1), style: { width: size + 'px', height: size + 'px' } });
    dot.addEventListener('click', () => { choose(c); refresh(); });
    dots.push(dot); row.append(dot);
  });
  if (more > 0) {
    chip = h('div', { class: 'm2-dot', role: 'button', 'aria-label': '다른 색 선택', dataset: { tag: 'color_more' }, style: { width: size + 'px', height: size + 'px' } });
    chip.addEventListener('click', () => ColorPicker.show(null, '색 선택', current() | 0, more === 2, c => { choose(c | 0); refresh(); }));
    row.append(chip);
  }
  refresh();
  return row;
};
M.segmented = function (labels, current, choose) {
  const row = h('div', { class: 'm2-seg' });
  const chips = [];
  const refresh = () => chips.forEach((chip, i) => { chip.classList.toggle('on', i === current()); });
  labels.forEach((l, i) => {
    const chip = h('div', { class: 'm2-seg-chip', role: 'button' }, l);
    chip.addEventListener('click', () => { choose(i); refresh(); });
    chips.push(chip); row.append(chip);
  });
  refresh();
  return row;
};
/** flag is a one element array [bool]; typefaceStyle 0 normal, 1 bold, 2 italic, 3 both */
M.toggleChip = function (label, typefaceStyle, flag, changed) {
  const chip = h('div', { class: 'm2-toggle', role: 'button', style: { fontWeight: typefaceStyle & 1 ? '700' : '400', fontStyle: typefaceStyle & 2 ? 'italic' : 'normal' } }, label);
  const paint = () => chip.classList.toggle('on', !!flag[0]);
  chip.addEventListener('click', () => { flag[0] = !flag[0]; paint(); changed && changed(); });
  paint();
  return chip;
};
M.colorRow = function (colors, chosen) {
  const row = h('div', { class: 'm2-colorrow' });
  const sw = [];
  let more = null;
  const refresh = () => {
    let custom = true;
    sw.forEach((v, i) => {
      const none = (colors[i] >>> 24) === 0, on = (chosen[0] | 0) === (colors[i] | 0);
      if (on) custom = false;
      v.style.background = none ? '#fff' : argb(colors[i]);
      v.style.border = (on ? 3 : 1) + 'px solid ' + (on ? ACCENT : '#C7C7CC');
    });
    more.style.background = custom ? argb(chosen[0] >>> 0) : RAINBOW;
    more.style.border = custom ? '3px solid ' + ACCENT : '1px solid #C7C7CC';
  };
  colors.forEach((c, i) => {
    const v = h('div', { class: 'm2-cdot', role: 'button', 'aria-label': (c >>> 24) === 0 ? '없음' : '색상' });
    // semi transparent fills are drawn at their alpha over white
    v.addEventListener('click', () => { chosen[0] = c | 0; refresh(); });
    sw.push(v); row.append(v);
  });
  more = h('div', { class: 'm2-cdot m2-cdot-more', role: 'button', 'aria-label': '다른 색·투명도 선택', dataset: { tag: 'color_more' } });
  more.addEventListener('click', () => ColorPicker.show(null, '색·투명도', chosen[0] === 0 ? 0x80007AFF | 0 : chosen[0] | 0, true, c => { chosen[0] = c | 0; refresh(); }));
  row.append(more);
  refresh();
  return row;
};
M.sectionLabel = function (text) { return h('div', { class: 'm2-seclabel' }, text); };
F.pill = function (text, description, background, foreground, action) {
  const b = h('div', { class: 'm2-pill', role: 'button', 'aria-label': description, style: { background: css(background), color: css(foreground) } }, text);
  if (action) b.addEventListener('click', action);
  return b;
};
F.stepButton = function (label, description) { return h('div', { class: 'm2-step', role: 'button', 'aria-label': description }, label); };
F.dialogButton = function (label, color, bold, action) {
  const b = h('div', { class: 'm2-dbtn', role: 'button', 'aria-label': label, style: { color: css(color), fontWeight: bold ? '700' : '400' } }, label);
  b.addEventListener('click', () => action());
  return b;
};
/** menuTile(row, label, icon, action): tile used by the lasso dialog and the text-selection popup. Returns the title element. */
F.menuTile = function (row, label, iconName, action) {
  const title = h('div', { class: 'm2-mt-title' }, label);
  const tile = h('div', { class: 'm2-menutile', role: 'button', 'aria-label': label }, h('div', { class: 'm2-mt-chip' }, icon(iconName, 20, ACCENT)), title);
  tile.addEventListener('click', () => action());
  row.append(tile);
  return title;
};
F.showActionSheet = function (title, labels, checked, pick) {
  const b = new AlertDialog.Builder();
  if (title != null) b.setTitle(title);
  const d = b.setSingleChoiceItems(labels, checked, (dlg, i) => { dlg.dismiss(); pick(i); }).create();
  d.show();
  return d;
};

/** Centered memo/highlight editor card (MainActivity.showMemoEditor). */
M.showMemoEditor = function (title, mark, saveLabel, onSave, dangerLabel, onDanger, extraLabel, onExtra) {
  const style = [mark.paper | 0, mark.fontSp, mark.boxSize], origBox = mark.boxSize;
  const card = h('div', { class: 'm2-memo', dataset: { tag: 'memo_editor' } });
  card.append(h('div', { class: 'm2-memo-h' }, title));
  const input = editText({ hint: '메모를 입력하세요', value: mark.note == null ? '' : mark.note, minLines: 3, maxLines: 6, cls: 'm2-memo-in' });
  card.append(input);
  const preview = h('div', { class: 'm2-memo-pv' });
  const applyPreview = () => { preview.style.background = argb(style[0] >>> 0); preview.style.fontSize = style[1] + 'px'; preview.textContent = '미리보기 · ' + style[1] + 'pt'; };
  const sizeRow = h('div', { class: 'm2-memo-size' }, h('div', { style: { flex: '1 1 0', fontSize: '13px', color: GRAY } }, '메모 안 글자 크기'));
  const minus = this.stepButton('−', '글자 작게'); minus.style.cssText = 'width:34px;height:32px'; minus.addEventListener('click', () => { style[1] = Math.max(9, style[1] - 1); applyPreview(); });
  const plus = this.stepButton('＋', '글자 크게'); plus.style.cssText = 'width:34px;height:32px;margin-left:6px'; plus.addEventListener('click', () => { style[1] = Math.min(28, style[1] + 1); applyPreview(); });
  sizeRow.append(minus, plus); card.append(sizeRow);
  card.append(h('div', { class: 'm2-memo-boxlabel', dataset: { tag: 'memo_box_label' } }, '메모 상자 크기 (메모를 한 번 탭하면 모서리를 끌어 직접 조절)'));
  const box = this.segmented(['작게', '보통', '크게'], () => style[2], i => { style[2] = i; });
  box.dataset.tag = 'memo_box_size'; box.style.cssText = 'height:44px;padding:6px 6px 2px 2px;margin-top:0;box-sizing:content-box'; card.append(box);
  const paper = this.swatches(PAPER_COLORS, () => style[0], c => { style[0] = c | 0; applyPreview(); }, 30, 2);
  paper.dataset.tag = 'memo_paper_colors'; paper.style.cssText += ';height:42px;padding:4px 0'; card.append(paper);
  card.append(preview); applyPreview();
  card.append(h('div', { class: 'm2-memo-line' }));
  const buttons = h('div', { class: 'm2-memo-btns' });
  let dlg;
  if (extraLabel != null) buttons.append(this.dialogButton(extraLabel, ACCENT, false, () => { dlg.dismiss(); onExtra && onExtra(); }));
  buttons.append(h('div', { style: { flex: '1 1 0' } }));
  if (dangerLabel != null) buttons.append(this.dialogButton(dangerLabel, RED, false, () => { dlg.dismiss(); onDanger && onDanger(); }));
  buttons.append(this.dialogButton('취소', GRAY, false, () => dlg.dismiss()));
  buttons.append(this.dialogButton(saveLabel, ACCENT, true, () => { mark.paper = style[0]; mark.fontSp = style[1]; if (style[2] !== origBox) { mark.boxW = mark.boxH = 0; } mark.boxSize = style[2]; dlg.dismiss(); onSave(input.value.trim()); }));
  card.append(buttons);
  const scroll = h('div', { class: 'm2-memo-wrap' }, card);
  dlg = new Overlay(scroll, {});
  dlg.show();
  setTimeout(() => input.focus(), 40);
  return dlg;
};

// ---- 660-702: annotation lists & edit dialogs ---------------------------------------------------------------------------------------
/** showPage(page) (may be async) then focus a normalized point once laid out. */
M._goTo = async function (page, x, y) {
  await this.showPage(page);
  if (x != null) { await nextFrame(); if (this.pageView && this.pageView.focusOnPoint) this.pageView.focusOnPoint(x, y); }
};
const DISPLAY_CHOICES = ['펼쳐서 표시', '최소화', '숨기기'];
M.showTranslationDisplayOptions = function (note) {
  const checked = !note.visible ? 2 : (note.minimized ? 1 : 0);
  this.showActionSheet('번역 포스트잇 표시', DISPLAY_CHOICES, checked, w => { note.visible = w !== 2; note.minimized = w === 1; this.store.save(); this.redrawPages(); });
};
M.showTranslations = function () {
  if (!this.store || this.store.translations.length === 0) { toast('저장된 번역 포스트잇이 없습니다'); return; }
  const items = [...this.store.translations];
  const labels = items.map(n => {
    const state = !n.visible ? '숨김' : (n.minimized ? '최소화' : '펼침');
    const t = n.translated == null ? '' : n.translated;
    return 'p.' + (n.page + 1) + '  [' + state + '] ' + (t.length > 35 ? t.substring(0, 35) + '…' : t);
  });
  listDialog('번역 포스트잇', labels, i => { this._goTo(items[i].page); this.editTranslation(items[i]); });
};
M.editMark = function (mark) {
  this.showMemoEditor('페이지 ' + (mark.page + 1) + (mark.noteOnly ? ' 메모 포스트잇' : ' 하이라이트'), mark, '저장',
    text => { mark.note = text; mark.visible = true; this.store.save(); this.redrawPages(); },
    mark.noteOnly ? '메모 삭제' : '하이라이트 삭제',
    () => { const a = this.store.marks, i = a.indexOf(mark); if (i >= 0) a.splice(i, 1); this.store.save(); this.redrawPages(); toast(mark.noteOnly ? '메모를 삭제했습니다' : '하이라이트를 삭제했습니다'); },
    '표시 설정', () => this.showMemoDisplayOptions(mark));
};
M.showMemoDisplayOptions = function (mark) {
  const checked = !mark.visible ? 2 : (mark.minimized ? 1 : 0);
  this.showActionSheet('메모 포스트잇 표시', DISPLAY_CHOICES, checked, w => { mark.visible = w !== 2; mark.minimized = w === 1; this.store.save(); this.redrawPages(); });
};
/** Android addDocumentRows: 새 노트 만들기 / 파일 가져오기 / 저장된 문서 열기. */
M.addDocumentRows = function () {
  const R = AnchoredMenu.Row;
  return [new R('새 노트 만들기', 'ic_compose', () => this.newNotebook()).tint('#34C759'), new R('파일 가져오기', 'ic_import', () => this.choosePdf()).tint('#007AFF'), new R('저장된 문서 열기', 'ic_folder_open', () => this.showLibrary()).tint('#F5A623')];
};
M.showAddDocumentMenu = function () { AnchoredMenu.showCentered('문서 추가', this.addDocumentRows()); };
M.showOutlineList = function () {
  if (!this.store) { toast('PDF를 먼저 여세요'); return; }
  if (this.sidebarVisible && this.panelTab === 2) { this.closeSidePanel(); return; }
  this.selectPanelTab(2);
};
M.showOutlineItem = function (item, anchor) {
  const R = AnchoredMenu.Row;
  AnchoredMenu.showRightOf(anchor || this.sidePanel, this.sidePanel, [
    new R('이동', 'ic_page', () => { this._goTo(item.page, item.x, item.y); }).tint('#30B0C7'),
    new R('삭제', 'ic_delete', () => {
      const a = this.store.outlines, i = a.indexOf(item); if (i >= 0) a.splice(i, 1);
      this.store.save(); toast('개요 항목을 삭제했습니다');
      if (this.sidebarVisible && this.panelTab === 2) this.rebuildOutlinePanel();
    }).danger()]);
};
M.choosePageSwipeDirection = function () {
  const choices = ['화살표만 · 드래그 넘김 끄기', '수평 · 좌우로 넘기기', '수직 · 위아래로 넘기기'];
  const b = new AlertDialog.Builder().setTitle('페이지 넘김');
  b.setSingleChoiceItems(choices, !this.swipeEnabled ? 0 : this.verticalPageSwipe ? 2 : 1, (dialog, which) => {
    this.swipeEnabled = which !== 0; this.verticalPageSwipe = which === 2;
    for (const v of [this.pageView, ...this.allPageViews()]) if (v) { v.setVerticalPageSwipe && v.setVerticalPageSwipe(this.verticalPageSwipe); v.setPageSwipeEnabled && v.setPageSwipeEnabled(this.swipeEnabled); }
    this.recentPrefs.putBoolean('vertical_page_swipe', this.verticalPageSwipe);
    this.recentPrefs.putBoolean('page_swipe_enabled_v2', this.swipeEnabled);
    if (this.syncOtherTools) this.syncOtherTools();
    dialog.dismiss();
    toast(this.swipeEnabled ? '스와이프로도 페이지를 넘깁니다' : '본문의 반투명 화살표로 페이지를 넘기세요');
  });
  b.setNegativeButton('취소', null); b.show();
};
M.showMarkList = function () {
  const items = [...this.store.marks];
  if (items.length === 0) { toast('저장된 하이라이트나 메모가 없습니다'); return; }
  const labels = items.map(mark => {
    const note = mark.note;
    const state = note == null || note === '' ? '' : (!mark.visible ? '[숨김] ' : (mark.minimized ? '[최소화] ' : '[펼침] '));
    return 'p.' + (mark.page + 1) + '  ' + state + (note == null || note === '' ? '(메모 없음)' : note);
  });
  listDialog('메모·하이라이트', labels, i => { this._goTo(items[i].page); this.editMark(items[i]); });
};
M.showBookmarks = function () {
  if (this.store.bookmarks.size === 0) { toast('즐겨찾기한 페이지가 없습니다'); return; }
  const pages = [...this.store.bookmarks].sort((a, b) => a - b);
  listDialog('즐겨찾기', pages.map(p => '페이지 ' + (p + 1)), i => this._goTo(pages[i]));
};
M.goToPage = function () {
  if (!this.renderer) return;
  const input = editText({ hint: '1 ~ ' + this.renderer.pageCount, numeric: true, style: { margin: '0 0' } });
  const go = () => {
    const v = parseInt(input.value, 10);
    if (!Number.isFinite(v) || !/^\s*[+-]?\d+\s*$/.test(input.value)) { toast('올바른 페이지를 입력하세요'); return; }
    this.showPage(v - 1);
  };
  const d = alertCard({ title: '페이지로 이동', view: input, positive: ['이동', go], negative: ['취소'] });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); d.buttons[0].click(); } });
};
M.exportAnnotations = async function () {
  if (this.documentUri == null) return;
  let json;
  try { json = this.pendingJsonExport = this.store.exportJson(this.documentUri, this.documentTitle); } catch (e) { toast('백업 실패'); return; }
  try {
    const path = await saveBytesAs('이 문서 필기 백업 저장', stripPdf(this.documentTitle) + '_annotations.json', ['json'], utf8(json));
    if (path) toast('주석을 내보냈습니다');
  } catch (e) { toast('백업 실패: ' + errMsg(e)); } finally { this.pendingJsonExport = null; }
};

// ---- 679-725: lasso capture ----------------------------------------------------------------------------------------------------------
M.onLassoSelectionFinished = function () {
  let capture;
  try { capture = this.pageView.captureLasso(); } catch (e) { this.pageView.clearLassoSelection(); toast('캡처할 영역을 조금 줄여 주세요'); return; }
  if (!capture) return;
  const selectedText = this.pageView.lassoText() || '';
  const capturedPage = this.currentPage, capturedTitle = this.documentTitle;
  let handedOff = false;
  const panel = h('div', { class: 'm2-lasso' });
  const preview = h('canvas', { class: 'm2-lasso-pv' });
  preview.width = capture.width; preview.height = capture.height; preview.getContext('2d').drawImage(capture, 0, 0);
  panel.append(preview, h('div', { class: 'm2-lasso-hint' }, '선택 영역 · p.' + (capturedPage + 1)));
  const labels = ['이미지 복사', 'PNG 저장', '이미지 공유', '글자 복사', '다시 선택', '선택 종료'];
  const icons = ['ic_copy', 'ic_folder_open', 'ic_share', 'ic_scan', 'ic_lasso', 'ic_check'];
  let dialog;
  const mk = this.menuTile.bind(this);
  for (let row = 0; row < 3; row++) {
    const group = h('div', { class: 'm2-mt-row' }); panel.append(group);
    for (let col = 0; col < 2; col++) {
      const index = row * 2 + col;
      mk(group, labels[index], icons[index], () => {
        if (index < 3) { handedOff = true; dialog.dismiss(); this.writeCapture(capture, index, capturedTitle, capturedPage); }
        else if (index === 3) {
          if (selectedText === '') { toast('인식된 글자가 없습니다. 이미지 복사를 사용하거나 글자를 다시 인식하세요'); return; }
          this.copySelectedText(selectedText); dialog.dismiss();
        } else { dialog.dismiss(); if (index === 5) { this.setInkMode(0); this.updateToolStates(); } }
      });
    }
  }
  dialog = alertCard({
    title: '올가미 캡처', view: panel, negative: ['닫기'],
    onDismiss: () => { try { this.pageView.clearLassoSelection(); } catch (e) { /* ignore */ } preview.width = 1; },
  });
  dialogWidth(dialog, { width: '92vw', maxWidth: '520px', maxHeight: 'min(600px, calc(100vh - 100px))' });
};
M.writeCapture = async function (image, action, title, page) {
  try {
    const blob = await canvasPng(image);
    if (action === 0) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('이미지를 복사했습니다. 이미지 붙여넣기를 지원하는 앱에서 사용하세요');
    } else {
      const name = stripPdf(title) + '_p' + (page + 1) + '_capture.png';
      if (action === 2 && navigator.canShare) {
        const file = new File([blob], name, { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: '캡처 이미지 공유' }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
        }
      }
      let path;
      try { path = await saveBytesAs(action === 2 ? '캡처 이미지 공유' : 'PNG 저장', name, ['png'], new Uint8Array(await blob.arrayBuffer())); }
      catch (e) { toast('캡처 저장 실패: ' + errMsg(e)); return; }
      if (path) toast('PNG 캡처를 저장했습니다');
    }
  } catch (e) { toast('캡처 실패: ' + errMsg(e)); }
};

// ---- splitters (side panel / study panel) -------------------------------------------------------------------------------------------------
/** Pointer-driven splitter handle (mouse, touch and pen share pointer events). axis/min/max are functions; apply(v, final) sets the size. */
function attachSplitter(handle, { axis, sign = 1, read, apply, min, max, commit, reset }) {
  handle.setAttribute('role', 'separator'); handle.tabIndex = 0;
  handle.addEventListener('pointerdown', e => {
    if (e.button != null && e.button > 0) return;
    e.preventDefault(); e.stopPropagation();
    const ax = axis(), start = ax === 'x' ? e.clientX : e.clientY, v0 = read(); let cur = v0;
    try { handle.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
    handle.classList.add('drag'); document.body.classList.add('m2-resizing'); document.body.dataset.m2Axis = ax;
    const move = ev => { if (ev.pointerId !== e.pointerId) return; cur = clamp(Math.round(v0 + ((ax === 'x' ? ev.clientX : ev.clientY) - start) * sign), min(), max()); apply(cur, false); };
    const up = ev => {
      if (ev.pointerId !== e.pointerId) return;
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up);
      try { handle.releasePointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      handle.classList.remove('drag'); document.body.classList.remove('m2-resizing'); delete document.body.dataset.m2Axis;
      apply(cur, true); if (commit) commit(cur);
    };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', up); handle.addEventListener('pointercancel', up);
  });
  handle.addEventListener('keydown', e => {
    const ax = axis(), dec = ax === 'x' ? 'ArrowLeft' : 'ArrowUp', inc = ax === 'x' ? 'ArrowRight' : 'ArrowDown';
    if (e.key !== dec && e.key !== inc) return;
    e.preventDefault(); const v = clamp(read() + (e.key === inc ? 16 : -16) * sign, min(), max()); apply(v, true); if (commit) commit(v);
  });
  handle.addEventListener('dblclick', e => { e.preventDefault(); if (reset) reset(); });
  return handle;
}
export const SPLIT = { sideMin: 168, sideMaxAbs: 520, studyMinW: 220, studyMinH: 120 };
const resizeSoon = (() => { let raf = 0; return () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; window.dispatchEvent(new Event('resize')); }); }; })();


// ---- study panel -----------------------------------------------------------------------------------------------------------------------
M.buildStudyPanel = function () {
  const panel = h('div', { class: 'm2-study', dataset: { tag: 'study_panel' } });
  this.studyHeading = h('div', { class: 'm2-study-h' });
  const bar = h('div', { class: 'm2-study-bar' }, this.studyHeading,
    iconButton('ic_note_add', '현재 페이지에 노트 추가', NAVY, () => this.addStudyEntry('', 0.5, 0.5, false)),
    iconButton('ic_more_vert', '노트 메뉴', NAVY, () => listDialog(null, ['전체 노트', '발췌만 보기', '내보내기', '닫기'], i => {
      if (i < 2) { this.basketOnly = i === 1; this.refreshStudyPanel(); } else if (i === 2) this.exportStudy(); else { this.studyVisible = false; this.layoutStudyPanel(); }
    })));
  this.studyRows = h('div', { class: 'm2-study-rows' });
  panel.append(bar, h('div', { class: 'm2-study-scroll' }, this.studyRows));
  this.studyPanel = panel;
  this.studySplitter = h('div', { class: 'm2-splitter', dataset: { tag: 'study_splitter' }, title: '끌어서 너비 조절 (두 번 누르면 기본값)', 'aria-label': '노트 패널 크기 조절' });
  attachSplitter(this.studySplitter, {
    axis: () => (this.studyWide() ? 'x' : 'y'), sign: -1,
    read: () => (this.studyWide() ? panel.getBoundingClientRect().width : panel.getBoundingClientRect().height),
    min: () => (this.studyWide() ? SPLIT.studyMinW : SPLIT.studyMinH), max: () => this.studyMax(),
    apply: v => { panel.style.flex = '0 0 ' + v + 'px'; if (this.pdfArea) this.pdfArea.style.flex = '1 1 0'; resizeSoon(); },
    commit: v => this.recentPrefs.putInt(this.studyWide() ? 'study_w' : 'study_h', Math.round(v)),
    reset: () => { this.recentPrefs.remove(this.studyWide() ? 'study_w' : 'study_h'); this.applyStudySize(); resizeSoon(); },
  });
  panel.prepend(this.studySplitter);
  return panel;
};
M.studyWide = function () { return window.innerWidth >= 600; };
M.studyMax = function () {
  const r = this.studySplit ? this.studySplit.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight };
  return Math.max(this.studyWide() ? SPLIT.studyMinW : SPLIT.studyMinH, Math.floor(this.studyWide() ? r.width - 260 : r.height - 200));
};
/** Applies the remembered (clamped) study panel size, or the default ratio when none was set. */
M.applyStudySize = function () {
  const panel = this.studyPanel, area = this.pdfArea; if (!panel) return;
  const wide = this.studyWide(), saved = this.recentPrefs.getInt(wide ? 'study_w' : 'study_h', 0);
  if (this.studySplitter) { this.studySplitter.classList.toggle('v', wide); this.studySplitter.classList.toggle('h', !wide); this.studySplitter.setAttribute('aria-orientation', wide ? 'vertical' : 'horizontal'); }
  if (saved > 0 && this.studyVisible) {
    const v = clamp(saved, wide ? SPLIT.studyMinW : SPLIT.studyMinH, this.studyMax());
    panel.style.flex = '0 0 ' + v + 'px'; if (area) area.style.flex = '1 1 0';
  } else { panel.style.flex = '1 1 0'; if (area) area.style.flex = (this.studyVisible ? '1.3' : '1') + ' 1 0'; }
};
M.layoutStudyPanel = function () {
  if (!this.studySplit) return;
  if (!this.studyPanel) this.buildStudyPanel();
  const wide = window.innerWidth >= 600;
  const split = this.studySplit, panel = this.studyPanel, area = this.pdfArea;
  if (panel.parentElement !== split) split.append(panel);
  split.style.display = 'flex'; split.style.flexDirection = wide ? 'row' : 'column';
  panel.style.display = this.studyVisible ? 'flex' : 'none';
  if (area) { area.style.minWidth = '0'; area.style.minHeight = '0'; }
  panel.style.minWidth = '0'; panel.style.minHeight = '0';
  this.applyStudySize();
  if (this.studyVisible) { window.dispatchEvent(new Event('resize')); }
};
M.showStudy = function (basket) {
  if (!this.store) { toast('PDF를 먼저 여세요'); return; }
  this.studyVisible = true; this.basketOnly = !!basket; this.layoutStudyPanel(); this.refreshStudyPanel();
};
M.addStudyEntry = function (text, x, y, excerpt) {
  if (!this.store) return;
  const entry = new StudyEntry(); entry.page = this.currentPage; entry.x = x; entry.y = y; entry.text = text; entry.excerpt = !!excerpt;
  if (excerpt) { this.store.studyEntries.push(entry); this.store.save(); this.showStudy(true); toast('발췌 바구니에 저장했습니다'); }
  else this.editStudyEntry(entry, true);
};
M.editStudyEntry = function (entry, fresh) {
  const target = this.store;
  const panel = h('div', { style: { padding: '0 18px' } });
  const text = editText({ hint: '노트 / 발췌 원문 · Markdown 입력', value: entry.text, minLines: 3, maxLines: 6 });
  const comment = editText({ hint: '설명 / Anki 뒷면', value: entry.comment, minLines: 1, maxLines: 4, style: { marginTop: '8px' } });
  panel.append(text, comment);
  const d = alertCard({
    title: '[p.' + (entry.page + 1) + '] ' + (entry.excerpt ? '발췌' : '노트'), view: panel,
    positive: ['저장'], negative: ['취소'],
    neutral: [fresh ? '닫기' : '삭제', () => { if (!fresh) { const a = target.studyEntries, i = a.indexOf(entry); if (i >= 0) a.splice(i, 1); target.save(); this.refreshStudyPanel(); } }],
  });
  // Android dismisses even when validation fails; here the dialog stays open so the typed text is not lost.
  rebindButton(d, BUTTON_POSITIVE, () => {
    if (text.value.trim() === '') { toast('노트 내용을 입력하세요'); text.focus(); return; }
    entry.text = text.value; entry.comment = comment.value;
    if (fresh) target.studyEntries.push(entry);
    target.save(); d.dismiss(); this.showStudy(false);
  });
};
M.refreshStudyPanel = function () {
  if (!this.studyRows) return;
  this.studyRows.textContent = '';
  this.studyHeading.textContent = (this.basketOnly ? '발췌 바구니' : '노트') + ' · p.' + (this.currentPage + 1);
  if (!this.store) return;
  let count = 0;
  for (const entry of this.store.studyEntries) {
    if (this.basketOnly && !entry.excerpt) continue;
    count++;
    const card = h('div', { class: 'm2-study-card', style: { background: entry.page === this.currentPage ? '#FFEDB6' : '#FFFFFF' } });
    const link = h('div', { class: 'm2-study-link', role: 'button' }, '[p.' + (entry.page + 1) + '] ↗');
    link.addEventListener('click', () => this._goTo(entry.page, entry.x, entry.y));
    const body = h('div', { class: 'm2-study-body' }, entry.text + (!entry.comment ? '' : '\n\n' + entry.comment));
    body.addEventListener('click', () => this.editStudyEntry(entry, false));
    card.append(link, body); this.studyRows.append(card);
  }
  if (count === 0) this.studyRows.append(h('div', { class: 'm2-study-empty' }, this.basketOnly ? '본문을 드래그한 뒤 ‘발췌’를 누르세요' : '＋로 현재 페이지에 연결된 노트를 작성하세요.\n[p.] 링크를 누르면 원문 위치로 이동합니다.'));
};
M.exportStudy = function () {
  if (!this.store) return;
  listDialog('노트·발췌 내보내기', ['Markdown (.md)', 'CSV (.csv)', 'Excel (.xlsx)', 'PDF (.pdf)', 'Word (.docx)'], async format => {
    const entries = this.store.studyEntries.filter(e => !this.basketOnly || e.excerpt);
    if (entries.length === 0) { toast('내보낼 항목이 없습니다'); return; }
    let bytes;
    try { bytes = await exportStudyBytes(entries, this.documentTitle, format); } catch (e) { toast('내보내기 실패'); return; }
    const ext = ['md', 'csv', 'xlsx', 'pdf', 'docx'][format];
    try {
      const path = await saveBytesAs('노트·발췌 내보내기', stripPdf(this.documentTitle) + '_notes.' + ext, [ext], bytes);
      if (path) toast('내보냈습니다');
    } catch (e) { toast('내보내기 실패: ' + errMsg(e)); }
  });
};
M.importSidecar = async function () {
  if (!this.store) return;
  const target = this.store, session = this.activeSession;
  this.importTarget = target; this.importSession = session;
  let path;
  try { [path] = await host.openDialog('이 문서 필기 백업 불러오기', [{ name: 'JSON', exts: ['json'] }], false); } catch (e) { path = null; }
  this.importTarget = null; this.importSession = null;
  if (!path) return;
  if (!session || !this.sessions.includes(session)) return;
  let json, root;
  try {
    const st = await host.stat(path);
    if (st.size > 16 * 1024 * 1024) throw new Error('백업은 16MB 이하만 지원합니다');
    try { json = await host.readText(path); } catch (e) { throw new Error('파일을 읽을 수 없습니다'); }
    if (json.length > 16 * 1024 * 1024) throw new Error('백업은 16MB 이하만 지원합니다');
    root = JSON.parse(json.replace(/^﻿/, ''));
    if (root == null || typeof root !== 'object' || Array.isArray(root)) throw new Error('JSON 객체가 아닙니다');
  } catch (e) { toast('백업 읽기 실패: ' + errMsg(e)); return; }
  alertCard({
    title: '이 문서 필기 백업 불러오기',
    message: '백업 문서: ' + (root.document == null ? '' : root.document) + '\n현재 문서: ' + session.title + '\n\n현재 문서의 주석·노트·발췌를 이 백업으로 교체합니다.',
    positive: ['복원', async () => {
      if (!this.sessions.includes(session)) return;
      try { await target.importJson(json, session.renderer.pageCount); clearList(session.redoStrokes); await this.switchDocument(session); toast('주석과 노트를 복원했습니다'); }
      catch (e) { toast('복원 실패: ' + errMsg(e)); }
    }],
    negative: ['취소'],
  });
};

// ---- same-network device sync (phone shows address + code; user picks documents + direction; whole-document overwrite) -----------------
M.showDeviceSync = function () {
  const addr = inputField({ hint: '주소 (예: 192.168.0.12:43125)', text: this.recentPrefs.getString('sync_address', '') });
  const code = inputField({ hint: '코드 6자리', text: '' });
  code.input.inputMode = 'numeric'; code.input.maxLength = 6;
  const note = h('div', { class: 'sync-note' }, '휴대폰 앱의 ‘도구 → 다른 기기와 동기화’를 열어 두고 표시된 주소와 코드를 입력하세요. 다음 화면에서 문서와 방향을 고릅니다. 자동으로 동기화되지 않습니다.');
  alertCard({
    title: '기기 동기화', view: h('div', { class: 'sync-view' }, note, addr.view, code.view),
    positive: ['연결', () => this.connectDeviceSync(addr.input.value, code.input.value)], negative: ['취소'],
  });
};
M.syncEnv = function () {
  const lib = this.library;
  const full = rel => lib.root.replace(/[\\/]+$/, '') + '\\' + rel.split('/').join('\\');
  const sessionOf = rel => this.sessions.find(s => samePath(s.uri, full(rel)));
  return {
    http: o => host.netHttp(o),
    pcPath: full,
    isOpen: async rel => !!sessionOf(rel),
    exportNote: async rel => {
      const open = sessionOf(rel); if (open && open.store) return open.store.exportJson(open.uri, open.title);
      const st = new AnnotationStore(); await st.open(full(rel)); return st.exportJson(full(rel), baseName(rel));
    },
    importNote: async (rel, text) => { const st = new AnnotationStore(); await st.open(full(rel)); await st.importJson(text, Infinity); },
    assetPath: n => AnnotationStore.assetPath(n),
    hasAsset: n => AnnotationStore.hasAsset(n),
  };
};
M.connectDeviceSync = async function (address, codeText) {
  const retry = msg => alertCard({ title: '동기화 실패', message: msg, positive: ['다시 시도', () => this.showDeviceSync()], negative: ['닫기'] });
  let progress = null;
  try {
    const client = new SyncClient(this.syncEnv(), address, codeText);
    this.recentPrefs.putString('sync_address', address.trim());
    progress = ProgressDialog.show('기기 동기화', '연결하는 중…');
    const phone = await client.library();
    const pc = [];
    for (const f of await this.library.allDocuments('')) {
      const rel = relPath(this.library.root, f); if (rel == null) continue;
      const st = await host.stat(f);
      pc.push({ path: rel, size: st.size, mtime: Math.max(st.mtime, await AnnotationStore.modified(f)) });
    }
    progress.dismiss(); progress = null;
    this.pickSyncDocuments(client, buildRows(phone, pc), address, codeText);
  } catch (e) {
    if (progress) progress.dismiss();
    retry(e instanceof SyncError ? e.message : '연결에 실패했습니다: ' + errMsg(e));
  }
};
M.pickSyncDocuments = function (client, rows, address, codeText) {
  const fmt = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
  let dir = 'push'; const picked = new Set();
  const dirRow = h('div', { class: 'sync-dir' });
  const list = h('div', { class: 'sync-list' });
  const foot = h('div', { class: 'sync-note' });
  const render = () => {
    const src = dir === 'push' ? 'pc' : 'phone', dst = dir === 'push' ? 'phone' : 'pc';
    for (const r of rows) if (!r[src]) picked.delete(r.path);
    list.textContent = '';
    for (const r of rows) {
      const usable = !!r[src], cb = h('input', { type: 'checkbox' }); cb.checked = picked.has(r.path); cb.disabled = !usable;
      cb.addEventListener('change', () => { if (cb.checked) picked.add(r.path); else picked.delete(r.path); render2(); });
      const info = `PC ${r.pc ? fmt(r.pc.mtime) : '없음'} · 휴대폰 ${r.phone ? fmt(r.phone.mtime) : '없음'}` + (r.newer ? ` · ${r.newer === 'pc' ? 'PC' : '휴대폰'}가 더 최신` : '');
      list.append(h('label', { class: 'sync-row' + (usable ? '' : ' off') }, cb, h('span', {}, h('b', {}, r.path), h('small', {}, info + (r[dst] ? '' : ' · 새로 만들어짐')))));
    }
    if (!rows.length) list.append(h('div', { class: 'sync-note' }, '양쪽 모두 문서가 없습니다.'));
    render2();
  };
  const render2 = () => { foot.textContent = picked.size ? `선택한 ${picked.size}개를 ${dir === 'push' ? '휴대폰' : '이 PC'}에 통째로 덮어씁니다 (PDF·노트·그림·녹음). 같은 이름의 문서는 되돌릴 수 없습니다.` : '덮어쓸 문서를 고르세요.'; };
  for (const [v, label] of [['push', 'PC → 휴대폰'], ['pull', '휴대폰 → PC']]) {
    const r = h('input', { type: 'radio', name: 'sync-dir' }); r.checked = v === dir; r.addEventListener('change', () => { dir = v; render(); });
    dirRow.append(h('label', { class: 'sync-dirbtn' }, r, h('b', {}, label)));
  }
  render();
  const dlg = alertCard({
    title: '덮어쓸 문서 선택', view: h('div', { class: 'sync-view' }, dirRow, list, foot),
    positive: ['덮어쓰기', () => { if (picked.size) this.runDeviceSync(client, rows.filter(r => picked.has(r.path)).map(r => r.path), dir); else toast('문서를 먼저 고르세요'); }],
    negative: ['취소'],
  });
  dialogWidth(dlg, { width: '520px', maxWidth: '94vw', maxHeight: '86vh' });
};
M.runDeviceSync = async function (client, paths, dir) {
  const progress = ProgressDialog.show('기기 동기화', '준비 중…'); const failed = []; let done = 0;
  for (let i = 0; i < paths.length; i++) {
    const rel = paths[i];
    try { await transferDocument(client, rel, dir, t => progress.setMessage(`(${i + 1}/${paths.length}) ${baseName(rel)}\n${t}`)); done++; }
    catch (e) { failed.push(`${rel}: ${e instanceof SyncError ? e.message : errMsg(e)}`); if (/코드/.test(String(e && e.message))) break; }
  }
  progress.dismiss();
  if (this.libraryDialog && this.libraryDialog.isShowing && this.libraryDialog.isShowing() && this.libraryDialog.refresh) { try { this.libraryDialog.refresh(); } catch (e) { /* */ } }
  if (!failed.length) toast(`동기화 완료 (${done}개)`);
  else alertCard({ title: `동기화 완료 ${done}개 · 실패 ${failed.length}개`, message: failed.join('\n'), positive: ['확인'] });
};

// ---- 758-858: library glue, notebooks, page insert/delete ------------------------------------------------------------------------------
M.showSettings = function () { new SettingsView(this).show(); };
M.showLibrary = function () {
  if (this.onSelectionAdjustStarted) this.onSelectionAdjustStarted();
  if (this.store) this.store.save();
  if (this.libraryDialog && this.libraryDialog.isShowing()) return;
  if (!this.libraryFolder || !this.library.isDirectory(this.libraryFolder)) this.libraryFolder = this.library.root;
  this.libraryDialog = new LibraryDialog(this, this.library, this.libraryFolder, {
    open: file => this.openPdf(file),
    importFiles: folder => { this.libraryFolder = folder; this.choosePdf(); },
    newNote: (folder, refresh) => this.createNotebook(folder, refresh),
    settings: () => this.showSettings(),
    changed: (source, target, moved) => { if (moved) this.libraryChanged(source, target); },
    selectedFolder: folder => { this.libraryFolder = folder; },
    removed: files => { for (const s of [...this.sessions]) if (files.some(f => samePath(f, s.uri))) this.closeDocument(s); },
  });
  this.libraryDialog.show();
};
/** Lets the user pick a PDF or picture to use as the background of new note pages (kept as a private copy). */
M.requestTemplate = async function (target) {
  this.templateTarget = target;
  let picked;
  try { picked = await host.openDialog('서식 PDF·이미지 고르기', [{ name: 'PDF·이미지', exts: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }], false); }
  catch (e) { toast('파일 선택기를 열 수 없습니다'); return; }
  const path = Array.isArray(picked) ? picked[0] : picked;
  if (path) await this.receiveTemplate(path);
};
M.receiveTemplate = async function (source) {
  const target = this.templateTarget; if (!target) return;
  try {
    const copy = await NotebookFiles.importTemplate(source);   // private copy in <data>\templates (NotebookFiles.importTemplate)
    if (target.setTemplate) target.setTemplate(copy);
  } catch (e) { toast('서식 파일을 가져오지 못했습니다'); }
};
M.newNotebook = function () { this.createNotebook(this.libraryFolder == null ? this.library.root : this.libraryFolder, () => {}); };
M.createNotebook = function (folder, refresh) {
  const panel = h('div');
  const name = inputField({ hint: '노트 이름', text: '새 노트', cls: 'lib-notename' });
  const paper = new PaperChoiceView(this, Object.assign(defaultNoteStyle(this.recentPrefs), { layoutChoice: true }));   // 설정 > 기본 노트 스타일 is the first choice
  if (paper.onTemplateRequest) paper.onTemplateRequest(() => this.requestTemplate(paper));
  panel.append(name.view, paper.el);
  const dialog = new AlertDialog.Builder().setTitle('새 노트').setView(panel).setPositiveButton('만들기', null).setNegativeButton('취소', null).create();
  dialog.show();
  const btn = rebindButton(dialog, BUTTON_POSITIVE, async () => {
    let title, selected;
    try { title = NotebookFiles.name(name.input.value); selected = paper.paper(); } catch (e) { name.setError(errMsg(e)); return; }
    btn.style.pointerEvents = 'none'; btn.style.opacity = '.4';
    try {
      const file = await this.library.createNote(folder, title, selected, paper.landscape);
      dialog.dismiss(); if (refresh) refresh();
      if (this.libraryDialog) { try { this.libraryDialog.dismiss(); } catch (e) { /* already gone */ } }
      this.openPdf(file); toast('마지막 장에서 넘기면 새 페이지가 추가됩니다');
    } catch (e) { btn.style.pointerEvents = ''; btn.style.opacity = ''; name.setError(errMsg(e)); }
  });
  name.input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } });
  setTimeout(() => { name.input.focus(); name.input.select(); }, 60);
};
M.isNotebook = function (session) { return !!session && this.library.managed(session.uri) && this.library.paper(session.uri) != null; };
M.chooseAddedPage = function () { this.choosePageToInsert(!this.renderer ? 0 : this.renderer.pageCount - 1); };
M.appendPage = function (session, paper) { return this.insertPage(session, paper, session.renderer.pageCount - 1); };
M.choosePageToInsert = function (afterIndex) {
  if (!this.activeSession) return;
  const session = this.activeSession;
  if (!this.library.managed(session.uri)) { toast('문서함에 저장한 뒤 페이지를 추가하세요'); return; }
  // default: a page like the one before it (same size, orientation and paper); "다른 형식으로 페이지 추가" offers other papers and sizes
  const same = this.library.paper(session.uri);
  this.insertPage(session, same != null ? same : new NotebookFiles.Paper(0, NotebookFiles.WHITE), afterIndex, 0);
};
/** Lets the user pick another paper and size for the new page (default: same size as the previous page). */
M.chooseOtherPageFormat = function (afterIndex) {
  if (!this.activeSession) return;
  const session = this.activeSession;
  if (!this.library.managed(session.uri)) { toast('문서함에 저장한 뒤 페이지를 추가하세요'); return; }
  const paper = new PaperChoiceView(this);
  if (paper.onTemplateRequest) paper.onTemplateRequest(() => this.requestTemplate(paper));
  const name = 'pagesize' + Date.now(), radios = [];
  const sizes = h('div', { class: 'm2-pagesize', dataset: { tag: 'page_size_choice' }, style: { padding: '4px 22px 4px 22px' } });
  ['이전 페이지와 같은 크기·방향', 'A4 세로', 'A4 가로'].forEach((label, i) => {
    const input = h('input', { type: 'radio', name, value: String(i) }); if (i === 0) input.checked = true; radios.push(input);
    sizes.append(h('label', { style: { display: 'flex', alignItems: 'center', gap: '10px', height: '36px', fontSize: '15px', cursor: 'pointer' } }, input, label));
  });
  const note = h('div', { style: { fontSize: '12px', color: '#8E8E93', padding: '0 22px 6px' } }, '서식 PDF를 고르면 그 서식의 크기를 따릅니다');
  alertCard({ title: '다른 형식으로 추가 · p.' + (afterIndex + 1) + ' 뒤', view: h('div', {}, paper.el, sizes, note), positive: ['추가', () => { let chosen; try { chosen = paper.paper(); } catch (e) { toast(errMsg(e)); return; } this.insertPage(session, chosen, afterIndex, Math.max(0, radios.findIndex(r => r.checked))); }], negative: ['취소'] });
};
M.insertPage = function (session, paper, afterIndex, sizeMode = 0) {
  const file = session.uri;
  return this.modifyPages(session, '새 페이지를 추가하는 중…', () => this.library.insertPage(file, paper, afterIndex, sizeMode), () => session.store.insertPageAfter(afterIndex), afterIndex + 1, '페이지 추가 실패');
};
M.confirmDeletePage = function (index) {
  if (!this.activeSession || !this.renderer) return;
  const session = this.activeSession;
  if (!this.library.managed(session.uri)) { toast('문서함에 저장한 뒤 페이지를 삭제하세요'); return; }
  if (this.renderer.pageCount <= 1) { toast('마지막 한 페이지는 삭제할 수 없습니다'); return; }
  alertCard({ title: '페이지 ' + (index + 1) + ' 삭제', message: '이 페이지와 그 위의 필기·메모·하이라이트·즐겨찾기가 함께 삭제되며 되돌릴 수 없습니다.', positive: ['삭제', () => this.deletePage(session, index)], negative: ['취소'] });
};
M.deletePage = function (session, index) {
  const file = session.uri;
  return this.modifyPages(session, '페이지를 삭제하는 중…', () => this.library.deletePage(file, index), () => session.store.removePage(index), index, '페이지 삭제 실패');
};
/** Page menu of the preview sidebar: go / add after / delete. */
M.showPageMenu = function (page, anchor) {
  if (!this.renderer) return;
  const R = AnchoredMenu.Row;
  AnchoredMenu.showRightOf(anchor || this.sidePanel, this.sidePanel, [
    new R('이 페이지로 이동', 'ic_page', () => this.showPage(page)).tint('#30B0C7'),
    new R('뒤에 페이지 추가', 'ic_page_add', () => this.choosePageToInsert(page)).tint('#34C759'),
    new R('다른 형식으로 뒤에 추가', 'ic_page_add', () => this.chooseOtherPageFormat(page)).tint('#34C759'),
    new R('이 페이지 삭제', 'ic_delete', () => this.confirmDeletePage(page)).danger()]);
};
/** Runs a file-level page edit, then re-opens the renderer and shifts the annotations to match. */
M.modifyPages = async function (session, message, operation, annotations, target, failure) {
  if (this.appending.has(session)) return;
  this.appending.add(session);
  if (this.onSelectionAdjustStarted) this.onSelectionAdjustStarted();
  session.store.save();
  const progress = ProgressDialog.show('', message);
  const file = session.uri;
  let count;
  try {
    await session.store.flush();
    count = await operation();
  } catch (e) { this.appending.delete(session); progress.dismiss(); toast(failure + ': ' + errMsg(e)); return; }
  this.appending.delete(session); progress.dismiss();
  if (!this.sessions.includes(session)) return;
  try {
    Search.invalidate(file);
    const next = await PdfDoc.open(await host.readBytes(file));
    annotations(); session.store.save();
    const old = session.renderer; session.renderer = next; session.descriptor = null;
    try { old && old.destroy && old.destroy(); } catch (e) { /* ignore */ }
    clearList(session.redoStrokes); clearList(session.textRegions);
    const page = Math.max(0, Math.min(target, count - 1)); session.page = page;
    if (session === this.activeSession) { this.renderer = next; this.descriptor = null; this._thumbAspectCache = null; await this.showPage(page); this.rebuildThumbnails(); }
    if (this.saveSessionState) this.saveSessionState();
  } catch (e) { toast('페이지를 다시 열 수 없습니다: ' + errMsg(e)); }
};
M.libraryChanged = function (before, after) {
  for (const s of this.sessions) if (samePath(s.uri, before)) {
    s.uri = after; s.title = baseName(after); s.store.rebind(after);
    if (s === this.activeSession) { this.documentUri = after; this.documentTitle = s.title; if (this.titleView) this.titleView.textContent = this.documentTitle; }
  }
  const last = this.recentPrefs.getString('last_uri', '');
  if (last !== '' && samePath(last, before)) { this.recentPrefs.putString('last_uri', after); this.recentPrefs.putString('last_title', baseName(after)); }
  if (this.updateTabs) this.updateTabs();
  if (this.saveSessionState) this.saveSessionState();
};
M.renameDocument = function (session) {
  if (!this.library.managed(session.uri)) { toast('문서함에 저장한 뒤 이름을 변경하세요'); return; }
  if (this.onSelectionAdjustStarted) this.onSelectionAdjustStarted();
  session.store.save();
  const before = session.uri;
  const f = inputField({ hint: '', text: stripPdf(session.title), label: '이름 변경' });
  const dialog = new AlertDialog.Builder().setTitle('이름 변경').setView(f.view).setPositiveButton('저장', null).setNegativeButton('취소', null).create();
  dialog.show();
  const btn = rebindButton(dialog, BUTTON_POSITIVE, async () => {
    let name;
    try { name = NotebookFiles.pdfName(f.input.value); } catch (e) { f.setError(errMsg(e)); return; }
    btn.style.pointerEvents = 'none'; btn.style.opacity = '.4';
    try {
      await session.store.flush();
      const after = await this.library.transfer(before, dirName(before), name, true);
      dialog.dismiss(); this.libraryChanged(before, after);
    } catch (e) { btn.style.pointerEvents = ''; btn.style.opacity = ''; f.setError(errMsg(e)); }
  });
  f.input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); btn.click(); } });
  setTimeout(() => { f.input.focus(); f.input.select(); }, 60);
};
/** Rename right in the title bar (replaces the old rename dialog on a title tap). */
M.beginTitleEdit = function () {
  const session = this.activeSession; if (!session || this._titleEdit) return;
  if (!this.library.managed(session.uri)) { toast('문서함에 저장한 뒤 이름을 변경하세요'); return; }
  if (this.onSelectionAdjustStarted) this.onSelectionAdjustStarted();
  session.store.save();
  const before = session.uri, input = h('input', { class: 'm-title m-title-edit', type: 'text', spellcheck: 'false', 'aria-label': '문서 이름', dataset: { tag: 'document_title_edit' } });
  input.value = stripPdf(session.title);
  this._titleEdit = input;
  let done = false;
  const finish = async save => {
    if (done) return; done = true; this._titleEdit = null;
    const text = input.value.trim();
    input.replaceWith(this.titleView); this.titleView.style.display = '';
    if (!save || !text || text === stripPdf(session.title) || !this.sessions.includes(session)) return;
    try {
      const name = NotebookFiles.pdfName(text);
      await session.store.flush();
      const after = await this.library.transfer(before, dirName(before), name, true);
      this.libraryChanged(before, after);
    } catch (e) { toast('이름을 바꿀 수 없습니다: ' + errMsg(e)); }
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } });
  input.addEventListener('blur', () => finish(true));
  this.titleView.style.display = 'none'; this.titleView.after(input);
  input.focus(); input.select();
};
M.saveToLibrary = async function () {
  if (!this.activeSession) return;
  if (this.library.managed(this.activeSession.uri)) { this.showLibrary(); return; }
  const session = this.activeSession;
  const source = session.officePreview == null ? session.uri : session.officePreview;
  if (session.officePreview != null) {
    try {
      const copy = new AnnotationStore(); await copy.open(source);
      copy.importJson(session.store.exportJson(session.uri, session.title), session.renderer.pageCount);
      await copy.flush();
    } catch (e) { toast('주석 저장 실패'); return; }
  }
  this.importPdfToLibrary(source, session.title.replace(/\.[^.]+$/, '') + '.pdf', this.currentPage, true);
};

// ---- PDF export (annotations flattened onto the original pages; vector content stays vector) ----------------------------------------------
function pageHasAnnotations(store, i) {
  return store.marks.some(m => m.page === i) || store.strokes.some(s => s.page === i) || store.translations.some(n => n.page === i) || store.elements.some(e => e.page === i);
}
export async function exportAnnotatedPdf(sourcePath, annotations, pageCount) {
  const PDFLib = await import('../vendor/pdflib/pdf-lib.esm.min.js');
  const { PDFDocument, degrees } = PDFLib;
  const doc = await PDFDocument.load(await host.readBytes(sourcePath), { ignoreEncryption: true });
  const pages = doc.getPages();
  await AnnotationPainter.preload(annotations);
  const prevDark = AnnotationPainter.dark; AnnotationPainter.dark = false;
  try {
    for (let i = 0; i < pages.length && i < pageCount; i++) {
      if (!pageHasAnnotations(annotations, i)) continue;
      const page = pages[i];
      const box = page.getCropBox ? page.getCropBox() : page.getMediaBox();
      const W = box.width, H = box.height, rot = ((page.getRotation().angle % 360) + 360) % 360;
      const vw = rot === 90 || rot === 270 ? H : W, vh = rot === 90 || rot === 270 ? W : H;
      const ratio = Math.min(3, 4096 / Math.max(vw, vh));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(vw * ratio)); canvas.height = Math.max(1, Math.round(vh * ratio));
      const ctx = canvas.getContext('2d');
      AnnotationPainter.all(ctx, new RectF(0, 0, canvas.width, canvas.height), annotations, i);
      const png = await doc.embedPng(new Uint8Array(await (await canvasPng(canvas)).arrayBuffer()));
      const ox = box.x, oy = box.y;
      if (rot === 0) page.drawImage(png, { x: ox, y: oy, width: W, height: H });
      else if (rot === 90) page.drawImage(png, { x: ox + W, y: oy, width: vw, height: vh, rotate: degrees(90) });
      else if (rot === 180) page.drawImage(png, { x: ox + W, y: oy + H, width: W, height: H, rotate: degrees(180) });
      else page.drawImage(png, { x: ox, y: oy + H, width: vw, height: vh, rotate: degrees(270) });
    }
  } finally { AnnotationPainter.dark = prevDark; }
  return await doc.save();
}
/** Saves the untouched source file (no ink, notes or other annotations) wherever the user picks. */
M.exportOriginal = async function () {
  if (!this.activeSession || this.documentUri == null) { toast('문서를 먼저 여세요'); return; }
  const source = this.documentUri;
  let target;
  try { target = await host.saveDialog('원본 파일 내보내기', baseName(this.documentTitle || source) || baseName(source), null); } catch (e) { toast('저장 위치를 열 수 없습니다'); return; }
  if (!target) return;
  try { await host.copy(source, target); toast('원본 파일을 내보냈습니다'); }
  catch (e) { toast('원본 내보내기에 실패했습니다'); }
};
/** Android v1.30.1 splitCurrentDocument: makes a copy of the open PDF with every landscape page cut into a left and a right page and opens it from the library. */
M.splitCurrentDocument = async function () {
  if (!this.activeSession || this.documentUri == null) { toast('문서를 먼저 여세요'); return; }
  const source = this.documentUri, title = stripPdf(this.documentTitle || baseName(source) || '문서');
  toast('한 쪽씩 나누는 중입니다');
  let tmp = null;
  try {
    const office = await import('./office.js');
    const bytes = await host.readBytes(source);
    if (!(await office.hasLandscapePages(bytes))) { toast('나눌 가로로 넓은 면이 없습니다'); return; }
    const cut = await office.splitSpreads(bytes);
    tmp = await this.tempFile('.pdf'); await host.writeBytes(tmp, cut);
    const saved = await this.importConverted(tmp, title + ' (한 쪽씩)');
    await this.openPdf(saved); toast('나눈 사본을 문서함에 저장했습니다');
  } catch (e) { toast('나누기 실패: ' + errMsg(e)); }
  finally { if (tmp) host.delete(tmp).catch(() => {}); }
};
M.exportPdf = async function () {
  if (!this.activeSession) return;
  const session = this.activeSession;
  let source, snapshot, count;
  try {
    source = this.exportSource = session.officePreview == null ? this.documentUri : session.officePreview;
    snapshot = this.exportSnapshot = this.store.exportJson(this.documentUri, this.documentTitle);
    count = this.exportPageCount = this.renderer.pageCount;
  } catch (e) { toast('PDF 준비 실패'); return; }
  let target;
  try { target = await host.saveDialog('PDF 내보내기', stripPdf(this.documentTitle) + '_notes.pdf', [{ name: 'PDF', exts: ['pdf'] }]); } catch (e) { target = null; }
  if (!target) { this.exportSource = this.exportSnapshot = null; return; }
  await this.receivePdfExport(target);
};
M.receivePdfExport = async function (target) {
  const source = this.exportSource, snapshot = this.exportSnapshot, count = this.exportPageCount;
  this.exportSource = this.exportSnapshot = null;
  if (source == null || snapshot == null) { toast('다시 내보내세요'); return; }
  const progress = ProgressDialog.show('PDF 내보내기', '필기·타이핑·이미지를 PDF에 담는 중입니다…');
  try {
    const annotations = new AnnotationStore(); annotations.importJson(snapshot, count);
    const bytes = await exportAnnotatedPdf(source, annotations, count);
    await host.writeBytes(target, bytes);
    progress.dismiss(); toast('PDF를 내보냈습니다');
  } catch (e) { progress.dismiss(); toast('PDF 내보내기 실패: ' + errMsg(e)); }
};

// ---- 859-1000: page elements (typing, images, stickers, shapes, tables, video, YouTube) ---------------------------------------------------
const NEEDS_TEXT = k => k === 'sticker' || k === 'video' || k === 'shape' || k === 'table' || k === 'youtube';
M.placeElement = function (kind, asset) {
  const t = this.freshDrop();
  if (this.renderer && t != null && kind !== 'text') {
    if (!NEEDS_TEXT(kind)) this.placementText = '';
    this.stopInk(); this.highlightMode = this.outlineMode = false; this.placementKind = kind; this.placementAsset = asset;
    this.createPlacedElement(t[0] | 0, t[1], t[2]); return;
  }
  this.placeElementArmed(kind, asset);
};
M.freshDrop = function () {
  const t = this.dropTarget; this.dropTarget = null;
  return t != null && Date.now() - this.dropTime <= 90000 ? t : null;
};
M.placeElementArmed = function (kind, asset) {
  if (!this.renderer) { toast('문서를 먼저 여세요'); return; }
  this.stopInk(); this.highlightMode = this.outlineMode = false; this.memoMode = true; this.placementKind = kind; this.placementAsset = asset;
  if (!NEEDS_TEXT(kind)) this.placementText = '';
  this.pageView.setHighlightMode(false, this.selectedColor); this.pageView.setOutlineMode(false); this.pageView.setMemoMode(true);
  this.updateToolStates();
  toast(kind === 'text' ? '글을 넣을 위치를 탭하세요. 이미 쓴 글은 탭하면 수정합니다. 끝나면 ‘텍스트’ 버튼을 다시 누르세요' : '넣을 위치를 터치하세요');
};
async function assetRatio(name) {
  try { const bmp = await AnnotationPainter.loadImage(name); if (bmp && bmp.width > 0 && bmp.height > 0) return bmp.width / bmp.height; } catch (e) { /* ignore */ }
  return 0;
}
M.createPlacedElement = async function (page, x, y) {
  if (this.placementKind === 'text') {
    this.commitInlineText();
    const existing = this.elementAt(page, x, y);
    if (existing) { this.beginInlineText(existing, false); return; }
    this.beginInlineText(this.newTextBox(page, x, y), true); return;
  }
  const element = new PageElement(); element.page = page; element.kind = this.placementKind; element.asset = this.placementAsset; element.text = this.placementText; this.placementText = ''; element.rot = this.placementRot || 0; this.placementRot = 0;
  const kind = element.kind;
  const pr = this.pageView.pageRect();
  const pageRatio = pr.height() > 0 ? pr.width() / pr.height() : .707;
  const finish = (msg) => {
    this.placementKind = ''; this.memoMode = false; this.pageView.setMemoMode(false); this.updateToolStates();
    this.store.elements.push(element); this.store.save(); this.pageView.selectElement(element); toast(msg);
  };
  if (kind === 'image' || kind === 'video' || kind === 'sticker' || kind === 'youtube') {
    let ratio = kind === 'youtube' ? 16 / 9 : 1;
    if (kind !== 'sticker' && kind !== 'youtube') { const r = await assetRatio(element.asset); if (r > 0) ratio = r; }
    let w = kind === 'sticker' ? .16 : String(element.asset).startsWith('tape-') ? .32 : .5, hh = w * pageRatio / ratio;
    if (hh > .6) { hh = .6; w = hh * ratio / pageRatio; }
    element.left = Math.max(0, Math.min(1 - w, x - w / 2)); element.top = Math.max(0, Math.min(1 - hh, y - hh / 2));
    element.right = element.left + w; element.bottom = element.top + hh;
    finish('모서리를 끌어 크기를, 본문을 끌어 위치를 바꿉니다'); return;
  }
  if (kind === 'shape' || kind === 'table') {
    const linear = kind === 'shape' && (element.text.startsWith('line') || element.text.startsWith('arrow'));
    const w = kind === 'table' ? .7 : linear ? .4 : .3;
    let hh = kind === 'table' ? Math.max(.08, Table.parse(element.text).rows * .045) : linear ? .05 : w * pageRatio;
    if (hh > .7) hh = .7;
    element.left = Math.max(0, Math.min(1 - w, x - w / 2)); element.top = Math.max(0, Math.min(1 - hh, y - hh / 2));
    element.right = element.left + w; element.bottom = element.top + hh;
    finish('모서리를 끌어 크기를, 본문을 끌어 위치를 바꿉니다. 한 번 더 탭하면 색·내용 메뉴'); return;
  }
  element.left = Math.min(.75, x); element.top = Math.min(.8, y); element.right = Math.min(.97, element.left + .6); element.bottom = Math.min(.98, element.top + .07);
  this.placementKind = ''; this.memoMode = false; this.pageView.setMemoMode(false); this.updateToolStates();
  this.editPageElement(element, true);
};
M.onElementTapped = function (element) {
  if (element.kind === 'audio') { this.showAudioPlayer(element); return; }
  if (element.kind === 'text') { this.beginInlineText(element, false); return; }
  if (element.kind === 'hyperlink') { this.openHyperlink(element); return; }
  if (element.kind === 'link' && youtubeId(element.text) != null) { element.kind = 'youtube'; element.text = youtubeId(element.text); this.store.save(); }
  const kind = element.kind, R = AnchoredMenu.Row, rows = [];
  if (kind === 'link') rows.push(new R('링크 열기', 'ic_link', () => { if (this.validWebUrl(element.text)) this._openExternal(element.text, '링크를 열 앱이 없습니다'); }).tint('#5856D6'));
  if (kind === 'video') { rows.push(new R('여기서 재생', 'ic_video', () => this.playInline(element)).tint('#FF3B30')); rows.push(new R('크게 보기', 'ic_fullscreen', () => this.showVideoPlayer(element)).tint('#8E8E93')); }
  if (kind === 'youtube') { rows.push(new R('여기서 재생', 'ic_youtube', () => this.playInline(element)).tint('#FF0000')); rows.push(new R('유튜브 앱·브라우저에서 열기', 'ic_link', () => this.openYoutube(element.text)).tint('#8E8E93')); }
  if (kind === 'shape') rows.push(new R('색·선 굵기', 'ic_palette', () => this.showShapeDialog(element)).tint('#AF52DE'));
  if (kind === 'table') { rows.push(new R('셀 내용 편집', 'ic_table', () => this.editTableCells(element)).tint('#30B0C7')); rows.push(new R('행·열·색상', 'ic_sliders', () => this.showTableDialog(element)).tint('#AF52DE')); }
  if (kind === 'link' || !['youtube', 'shape', 'table', 'image', 'sticker', 'video'].includes(kind)) rows.push(new R('수정', 'ic_compose', () => this.editPageElement(element, false)).tint('#007AFF'));
  rows.push(new R('위치·크기', 'ic_fullscreen', () => this.editElementGeometry(element)).tint('#34C759'));
  if (AnnotationPainter.rotates(element)) rows.push(R.custom(this.opacityRow(element)));
  rows.push(new R('삭제', 'ic_delete', () => this.deleteElement(element)).danger());
  AnchoredMenu.showCentered('페이지 ' + (element.page + 1), rows);
};
/** An inline slider inside the element menu (Android v1.32.0): fades a picture, sticker, shape or table (10-100 %); the page repaints live. */
M.opacityRow = function (element) {
  const target = this.store;
  const label = h('div', { style: { fontSize: '13px', color: '#636366' } }, '투명도  ' + Math.round(element.alpha * 100) + '%');
  const bar = h('input', { type: 'range', min: '10', max: '100', step: '1', value: String(Math.max(10, Math.min(100, Math.round(element.alpha * 100)))), class: 'm2-opacity-bar', 'aria-label': '투명도 조절', dataset: { tag: 'opacity_bar' } });
  bar.addEventListener('input', () => { const v = Number(bar.value); element.alpha = v / 100; label.textContent = '투명도  ' + v + '%'; if (this.pageView) this.pageView.invalidate(); this.redrawPages(); });
  bar.addEventListener('change', () => { if (target) target.save(); });
  return h('div', { class: 'm2-opacity-row', dataset: { tag: 'opacity_row' }, style: { padding: '8px 14px 6px' } }, label, bar);
};
M._openExternal = async function (url, failToast) { try { await host.shellOpen(url); } catch (e) { toast(failToast); } };
M.editPageElement = function (element, fresh) {
  if (element.kind === 'text') { this.beginInlineText(element, fresh); return; }
  const target = this.store;
  const input = editText({ hint: element.kind === 'link' ? 'https://… 또는 YouTube 주소' : '타이핑할 내용', value: element.text, minLines: 3, maxLines: 1000 });
  const d = alertCard({
    title: element.kind === 'link' ? '웹·유튜브 링크' : '타이핑', view: input, positive: ['저장'], negative: ['취소'],
    neutral: [fresh ? '닫기' : '삭제', () => { if (!fresh) { const a = target.elements, i = a.indexOf(element); if (i >= 0) a.splice(i, 1); target.save(); this.redrawPages(); } }],
  });
  rebindButton(d, BUTTON_POSITIVE, () => {
    const text = input.value.trim();
    if (text === '') { d.dismiss(); return; }
    if (element.kind === 'link' && !this.validWebUrl(text)) { toast('http 또는 https 주소를 입력하세요'); return; }
    element.text = text; if (fresh) target.elements.push(element);
    target.save(); this.redrawPages(); d.dismiss();
  });
};
M.validWebUrl = function (value) {
  try { const u = new URL(value); return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname; } catch (e) { return false; }
};
M.deleteElement = function (element) {
  if (!this.store) return;
  const els = this.store.elements;
  const remove = pred => { for (let i = els.length - 1; i >= 0; i--) if (pred(els[i])) els.splice(i, 1); };
  if (element.kind === 'hyperlink') remove(e => e.kind === 'hyperlink' && e.page === element.page && e.color === element.color && e.text === element.text);
  else remove(e => e === element);
  if (element.kind === 'video') AnnotationStore.deleteAsset(element.text).catch(() => {});
  this.store.save(); this.pageView.selectElement(null); this.redrawPages();
  if (this.sidebarVisible && this.panelTab === 4) this.rebuildInsertions();
};

// ---- pick / import ------------------------------------------------------------------------------------------------------------------------------
M.pickImage = async function () {
  if (!this.renderer) { toast('문서를 먼저 여세요'); return; }
  let r; try { r = await host.openDialog('이미지 선택', [{ name: '이미지', exts: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }], false); } catch (e) { return; }
  if (r && r[0]) this.importImage(r[0]);
};
/** Android v1.32.0 insertImage: a menu card first, so the picker can be cancelled by tapping outside. */
M.insertImage = function () {
  if (!this.renderer) { toast('문서를 먼저 여세요'); return; }
  const R = AnchoredMenu.Row;
  AnchoredMenu.showCentered('사진·이미지 넣기', [
    new R('파일에서 선택', 'ic_folder_open', () => this.pickImage()).tint('#FF9500'),
    new R('복사한 이미지 붙여넣기', 'ic_paste', () => this.pasteImage()).tint('#34C759')]);
};
M.pickVideo = async function () {
  if (!this.renderer) { toast('문서를 먼저 여세요'); return; }
  let r; try { r = await host.openDialog('동영상 선택', [{ name: '동영상', exts: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'wmv'] }], false); } catch (e) { return; }
  if (r && r[0]) this.importVideo(r[0]);
};
/** source: file path (host dialog) | File | Blob */
M.importImage = async function (source) {
  const session = this.activeSession;
  try {
    let blob = source;
    if (typeof source === 'string') blob = new Blob([await host.readBytes(source)]);
    if (!blob || blob.size === 0) throw new Error('이미지를 읽을 수 없습니다');
    let bmp; try { bmp = await createImageBitmap(blob); } catch (e) { throw new Error('이미지 형식이 지원되지 않습니다'); }
    if (!(bmp.width > 0 && bmp.height > 0)) throw new Error('이미지를 읽을 수 없습니다');
    let sample = 1; while (Math.max(bmp.width, bmp.height) / sample > 1600) sample *= 2;
    const cw = Math.max(1, Math.floor(bmp.width / sample)), ch = Math.max(1, Math.floor(bmp.height / sample));
    const canvas = document.createElement('canvas'); canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(bmp, 0, 0, cw, ch); bmp.close && bmp.close();
    const name = AnnotationStore.newAssetName('png');
    try { await AnnotationStore.saveAsset(name, await canvasPng(canvas)); } catch (e) { throw new Error('이미지 저장 실패'); }
    if (session && this.sessions.includes(session)) { await this.switchDocument(session); this.placeOrDrop('image', name); }
  } catch (e) { toast('이미지 가져오기 실패: ' + errMsg(e)); }
};
async function videoPoster(url) {
  return await new Promise((res, rej) => {
    const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.playsInline = true;
    const timer = setTimeout(() => { cleanup(); rej(new Error('timeout')); }, 15000);
    const cleanup = () => { clearTimeout(timer); v.removeAttribute('src'); v.load(); };
    v.addEventListener('error', () => { cleanup(); rej(Object.assign(new Error('video'), { decode: true })); });   // a decode / format error (not a timeout or a failed seek)
    v.addEventListener('loadedmetadata', () => { try { v.currentTime = Math.min(0.5, (v.duration || 1) / 2); } catch (e) { cleanup(); rej(e); } });
    v.addEventListener('seeked', () => {
      try {
        const w = v.videoWidth, hh = v.videoHeight; if (!w || !hh) throw new Error('size');
        const shrink = Math.min(1, 900 / Math.max(w, hh));
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * shrink)); c.height = Math.max(1, Math.round(hh * shrink));
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); cleanup(); res(c);
      } catch (e) { cleanup(); rej(e); }
    }, { once: true });
    v.src = url;
  });
}
M.importVideo = async function (source) {
  const session = this.activeSession;
  toast('동영상을 가져오는 중…');
  const name = AnnotationStore.newAssetName('mp4');
  let created = false;
  try {
    const LIMIT = 2048 * 1024 * 1024;
    const target = await AnnotationStore.assetPath(name);
    try {
      if (typeof source === 'string') {
        const st = await host.stat(source); if (st.size > LIMIT) throw new Error('2GB 이하의 동영상만 넣을 수 있습니다');
        await host.copy(source, target);
      } else {
        if (source.size > LIMIT) throw new Error('2GB 이하의 동영상만 넣을 수 있습니다');
        await host.writeBytes(target, new Uint8Array(await source.arrayBuffer()));
      }
      created = true;
    } catch (e) { try { await AnnotationStore.deleteAsset(name); } catch (e2) { /* ignore */ } throw e; }
    let frame, undecodable = false;
    try { frame = await videoPoster(await AnnotationStore.assetUrl(name)); } catch (e) { frame = null; undecodable = !!(e && e.decode); }
    if (!frame && undecodable) {   // AVI, WMV, old MOV/MKV codecs...: WebView2 cannot decode them, so convert to MP4 (H.264) with Windows once, here (only when the player really reported a decode error, not for a slow or failed preview frame)
      try {
        await this.convertVideoAsset(name, typeof source === 'string' ? source : null);
        videoConverted(name, true);
        frame = await videoPoster(await AnnotationStore.assetUrl(name));
      } catch (e) { frame = null; toast('MP4로 바꾸지 못했습니다: ' + errMsg(e) + ' · 재생할 때 Windows 동영상 앱으로 엽니다'); }
    }
    if (!frame) { frame = document.createElement('canvas'); frame.width = 640; frame.height = 360; const g = frame.getContext('2d'); g.fillStyle = '#2C2C2E'; g.fillRect(0, 0, 640, 360); }   // unusual codec: keep the video with a plain dark card, it still plays
    const thumb = AnnotationStore.newAssetName('png');
    try { await AnnotationStore.saveAsset(thumb, await canvasPng(frame)); } catch (e) { throw new Error('미리보기 저장 실패'); }
    if (session && this.sessions.includes(session)) { await this.switchDocument(session); this.placementText = name; this.placeOrDrop('video', thumb); }
  } catch (e) { toast('동영상 가져오기 실패: ' + errMsg(e)); }
};
/** Converts assets/<name> (or `from`, the original file) to an H.264/AAC MP4 written over assets/<name>, with a progress toast. */
M.convertVideoAsset = async function (name, from) {
  const target = await AnnotationStore.assetPath(name), tmp = target.replace(/\.mp4$/i, '') + '.converting.mp4', id = 'v' + Date.now();
  toast('재생할 수 있도록 MP4로 변환하는 중…');
  const onProgress = d => { if (d && d.id === id && d.percent % 10 === 0 && d.percent > 0 && d.percent < 100) toast(`MP4로 변환하는 중… ${d.percent}%`); };
  host.on('media.progress', onProgress);
  try {
    await host.call('media.transcode', { id, from: from || target, to: tmp });
    await host.move(tmp, target);
  } catch (e) { try { if (await host.exists(tmp)) await host.delete(tmp); } catch (e2) { /* ignore */ } throw e; }
  finally { host.off('media.progress', onProgress); }
  AnnotationStore.forgetAssetUrl(name);
  toast('MP4로 변환했습니다');
};
/** Remembers (per video asset, also across restarts) that the file was already converted to H.264/AAC MP4, so it is never converted twice. */
function videoConverted(name, set) {
  const key = 'everynote.videoConverted.' + name;
  try { if (set) localStorage.setItem(key, '1'); else return localStorage.getItem(key) === '1'; } catch (e) { /* storage unavailable */ }
  return false;
}
/** A <video> failed to decode: convert the asset (once only); if it still fails, or Windows cannot convert it, open it in the default player. */
M._recoverVideo = async function (element, media) {
  if (media._recovering || !media.isConnected || !media.error || (media.error.code !== 3 && media.error.code !== 4)) return;   // 3 decode, 4 unsupported format
  media._recovering = true;
  const name = element.text, openExternal = async () => {
    toast('앱 안에서 재생할 수 없는 형식이라 Windows 동영상 앱으로 엽니다');
    try { await host.call('media.openExternal', { path: await AnnotationStore.assetPath(name) }); } catch (e2) { toast('동영상을 열 수 없습니다: ' + errMsg(e2)); }
  };
  if (videoConverted(name)) { await openExternal(); return; }   // already MP4 from our own conversion: converting again cannot help
  try {
    await this.convertVideoAsset(name);
    videoConverted(name, true);
    if (!media.isConnected) return;
    media._recovering = false;   // a failure of the converted file goes to the default player instead of converting again
    media.src = await AnnotationStore.assetUrl(name); media.play().catch(() => {});
  } catch (e) { await openExternal(); }
};
/** In-document playback (Android playInline): the player opens right on the element's rectangle; page changes, zoom and closing stop it. */
M.stopInlinePlayer = function () {
  const p = this._inlinePlayer; this._inlinePlayer = null;
  if (!p) return;
  try { const yb = p.querySelector('.m2-ybar'); if (yb && yb._dispose) yb._dispose(); } catch (e) { /* ignore */ }
  try { const v = p.querySelector('video'); if (v) { v.pause(); v.removeAttribute('src'); v.load(); } const f = p.querySelector('iframe'); if (f) f.src = 'about:blank'; } catch (e) { /* ignore */ }
  p.remove();
};
M._inlineBox = function (element) {
  const view = [this.firstPageView, this.secondPageView].find(v => v && v.getPageNumber() === element.page) || this.pageView;
  if (!view || !view.el) return null;
  const host = view.el.getBoundingClientRect(), r = view.pageRect();
  if (r.width() <= 0) return null;
  let l = host.left + r.left + element.left * r.width(), t = host.top + r.top + element.top * r.height();
  let w = Math.max(240, (element.right - element.left) * r.width()), hgt = Math.max(135, (element.bottom - element.top) * r.height());
  w = Math.min(w, window.innerWidth - 16); hgt = Math.min(hgt, window.innerHeight - 16);
  const cx = host.left + r.left + (element.left + element.right) / 2 * r.width(), cy = host.top + r.top + (element.top + element.bottom) / 2 * r.height();
  l = Math.max(8, Math.min(window.innerWidth - w - 8, cx - w / 2)); t = Math.max(8, Math.min(window.innerHeight - hgt - 8, cy - hgt / 2));
  return { l, t, w, h: hgt };
};
M.playInline = async function (element) {
  this.stopInlinePlayer();
  const box = this._inlineBox(element); if (!box) { toast('재생할 위치를 찾을 수 없습니다'); return; }
  let media;
  if (element.kind === 'youtube') {
    media = h('iframe', { src: 'https://www.youtube.com/embed/' + element.text + '?autoplay=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1', allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: 'true', referrerpolicy: 'strict-origin-when-cross-origin', style: { width: '100%', height: '100%', border: '0', background: '#000' } });
  } else {
    let url;
    try { if (!(await AnnotationStore.hasAsset(element.text))) throw new Error(); url = await AnnotationStore.assetUrl(element.text); } catch (e) { toast('동영상 파일을 찾을 수 없습니다'); return; }
    media = h('video', { autoplay: true, playsinline: true, style: { width: '100%', height: '100%', background: '#000', objectFit: 'contain' } });
    media.addEventListener('error', () => this._recoverVideo(element, media));
    media.src = url;
  }
  const close = iconButton('ic_close', '재생 닫기', '#fff', () => this.stopInlinePlayer(), 32, 32);
  Object.assign(close.style, { position: 'absolute', top: '4px', right: '4px', background: 'rgba(0,0,0,.6)', borderRadius: '16px' });
  const kids = [media, close, element.kind === 'video' ? this._videoBar(media) : this._youtubeBar(media)];
  if (element.kind === 'video') {
    const big = iconButton('ic_fullscreen', '크게 보기', '#fff', () => { this.stopInlinePlayer(); this.showVideoPlayer(element); }, 32, 32);
    Object.assign(big.style, { position: 'absolute', top: '4px', left: '4px', background: 'rgba(0,0,0,.6)', borderRadius: '16px' }); kids.push(big);
  }
  const frame = h('div', { class: 'm2-inline-player', dataset: { tag: 'inline_player' }, style: { position: 'fixed', left: box.l + 'px', top: box.t + 'px', width: box.w + 'px', height: box.h + 'px', background: '#000', zIndex: '900', boxShadow: '0 4px 18px rgba(0,0,0,.35)', borderRadius: '6px', overflow: 'hidden' } }, ...kids);
  document.body.append(frame); this._inlinePlayer = frame;
  if (media.play) media.play().catch(() => {});
};
/** Always-visible ⏪10 / play-pause / 10⏩ bar with a seek slider (video files). */
M._videoBar = function (video) {
  const btn = (t, f) => { const b = h('button', { type: 'button', class: 'm2-vbtn' }, t); b.addEventListener('click', f); return b; };
  const play = btn('⏸', () => { if (video.paused) video.play().catch(() => {}); else video.pause(); });
  const seek = h('input', { type: 'range', min: '0', max: '1000', value: '0', class: 'm2-vseek', 'aria-label': '재생 위치' });
  const time = h('span', { class: 'm2-vtime' }, '0:00');
  const fmt = t => { t = Math.max(0, Math.floor(t || 0)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  seek.addEventListener('input', () => { if (video.duration) video.currentTime = video.duration * seek.value / 1000; });
  const upd = () => { if (video.duration) seek.value = String(Math.round(video.currentTime / video.duration * 1000)); play.textContent = video.paused ? '▶' : '⏸'; time.textContent = fmt(video.currentTime) + ' / ' + fmt(video.duration); };
  video.addEventListener('timeupdate', upd); video.addEventListener('play', upd); video.addEventListener('pause', upd); video.addEventListener('loadedmetadata', upd);
  video.addEventListener('click', () => play.click());
  return h('div', { class: 'm2-vbar', dataset: { tag: 'video_bar' } }, btn('⏪10', () => { video.currentTime = Math.max(0, video.currentTime - 10); }), play, btn('10⏩', () => { video.currentTime = Math.min(video.duration || 1e9, video.currentTime + 10); }), seek, time);
};
/** YouTube embeds are driven through the IFrame API's postMessage commands. */
M._youtubeBar = function (iframe) {
  const state = { t: 0, s: -1 };
  const send = (func, args) => { try { iframe.contentWindow.postMessage(JSON.stringify({ event: 'command', func, args: args || [] }), '*'); } catch (e) { /* ignore */ } };
  const onMsg = ev => { if (ev.source !== iframe.contentWindow) return; let d; try { d = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data; } catch (e) { return; } const i = d && d.info; if (i) { if (typeof i.currentTime === 'number') state.t = i.currentTime; if (typeof i.playerState === 'number') state.s = i.playerState; } };
  window.addEventListener('message', onMsg);
  iframe.addEventListener('load', () => { try { iframe.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 1 }), '*'); } catch (e) { /* ignore */ } });
  const btn = (t, f) => { const b = h('button', { type: 'button', class: 'm2-vbtn' }, t); b.addEventListener('click', f); return b; };
  const bar = h('div', { class: 'm2-vbar m2-ybar', dataset: { tag: 'video_bar' } },
    btn('⏪ 10초', () => send('seekTo', [Math.max(0, state.t - 10), true])), btn('▶/⏸', () => send(state.s === 1 ? 'pauseVideo' : 'playVideo')), btn('10초 ⏩', () => send('seekTo', [state.t + 10, true])));
  bar._dispose = () => window.removeEventListener('message', onMsg);
  return bar;
};
M.showVideoPlayer = async function (element) {
  let url;
  try { if (!(await AnnotationStore.hasAsset(element.text))) throw new Error(); url = await AnnotationStore.assetUrl(element.text); } catch (e) { toast('동영상 파일을 찾을 수 없습니다'); return; }
  const video = h('video', { class: 'm2-video', autoplay: true, playsinline: true });
  video.addEventListener('error', () => this._recoverVideo(element, video));
  let dlg;
  const frame = h('div', { class: 'm2-videoframe' }, video, this._videoBar(video), iconButton('ic_close', '동영상 닫기', '#fff', () => dlg.dismiss(), 48, 48));
  frame.lastChild.classList.add('m2-video-close');
  dlg = new Overlay(frame, { onDismiss: () => { try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e) { /* ignore */ } } });
  dlg.root.classList.add('m2-videoroot'); dlg.show();
  video.src = url; video.play().catch(() => {});
};

// ---- sticker picker -------------------------------------------------------------------------------------------------------------------------------------
M.showStickerPicker = function () {
  if (!this.renderer) { toast('문서를 먼저 여세요'); return; }
  let holder;
  const box = h('div', { class: 'm2-stickers' });
  STICKER_GROUPS.forEach((group, g) => {
    box.append(h('div', { class: 'm2-st-title' }, STICKER_TITLES[g]));
    let row = null;
    group.forEach((sticker, i) => {
      if (i % 6 === 0) { row = h('div', { class: 'm2-st-row' }); box.append(row); }
      const cell = h('div', { class: 'm2-st-cell', role: 'button', 'aria-label': '스티커 ' + sticker }, sticker);
      cell.addEventListener('click', () => { if (holder) holder.dismiss(); this.placementText = sticker; this.placeElement('sticker', ''); });
      row.append(cell);
    });
  });
  box.append(h('div', { class: 'm2-st-title' }, '마스킹 테이프'));
  { let row = null;
    for (let i = 1; i <= 16; i++) {
      if ((i - 1) % 4 === 0) { row = h('div', { class: 'm2-st-row m2-tape-row' }); box.append(row); }
      const name = 'tape-' + (i < 10 ? '0' : '') + i + '.png';
      const cell = h('div', { class: 'm2-tape-cell', role: 'button', 'aria-label': '마스킹 테이프 ' + i, dataset: { tape: name } }, h('img', { src: new URL('../assets/stickers/' + name, import.meta.url).href, alt: '', draggable: 'false' }));
      cell.addEventListener('click', () => { if (holder) holder.dismiss(); this.placementText = ''; this.placementRot = -4; this.placeElement('image', name); });
      row.append(cell);
    } }
  const mine = this.pill('내 이미지로 스티커 만들기', '이미지 선택', ACTIVE_BG, ACTIVE_FG, () => { if (holder) holder.dismiss(); this.pickImage(); });
  mine.style.cssText += ';height:44px;margin-top:10px';
  box.append(mine);
  holder = alertCard({ title: '스티커', view: wrapScroll(box, { maxHeight: 'calc(100vh - 220px)' }), negative: ['닫기'] });
};

// ---- insert menu --------------------------------------------------------------------------------------------------------------------------------------------------
M.insertRows = function () {
  const R = AnchoredMenu.Row;
  return [
    new R('사진·이미지', 'ic_image', () => this.insertImage()).tint('#007AFF'),
    new R('스티커', 'ic_sticker', () => this.showStickerPicker()).tint('#FF9500'),
    new R('도형', 'ic_rect', () => this.showShapeDialog(null)).tint('#AF52DE'),
    new R('표', 'ic_table', () => this.showTableDialog(null)).tint('#30B0C7'),
    new R('동영상', 'ic_video', () => this.pickVideo()).tint('#FF3B30'),
    new R('유튜브 링크', 'ic_youtube', () => this.askYoutube()).tint('#FF0000'),
  ];
};
M.showInsertMenu = function (anchor) {
  if (!this.renderer) { toast('문서를 먼저 여세요'); return; }
  this.dropTarget = null;
  const R = AnchoredMenu.Row;
  AnchoredMenu.show(anchor, true, [new R('메모 추가', 'ic_note_add', () => this.toggleMemoMode()).tint('#FF9500').selected(!!this.memoMode), ...this.insertRows()], null);
};
/** Long press on empty paper: the same insert menu, and whatever is chosen is placed right there. */
M.showInsertMenuAt = function (view, page, x, y, viewX, viewY) {
  if (!this.renderer || !view) return;
  this.dropTarget = [page, x, y]; this.dropTime = Date.now();
  later(() => this.showMenuAt(view, viewX, viewY, this.insertRows(), null));
};
M.placeOrDrop = function (kind, asset) { this.placeElement(kind, asset); };

// ---- 1002-1070: shape / table dialogs -------------------------------------------------------------------------------------------------------------------------
M.showShapeDialog = function (existing) {
  if (!this.renderer) { toast('문서를 먼저 여세요'); return; }
  const strokeColors = [0xFF1C1C1E, 0xFFFF3B30, 0xFFFF9500, 0xFFF5C400, 0xFF34C759, 0xFF30B0C7, 0xFF007AFF, 0xFFAF52DE].map(toInt);
  const fillColors = [0x00000000, 0x66FF3B30, 0x66FF9500, 0x66F5C400, 0x6634C759, 0x6630B0C7, 0x66007AFF, 0x66AF52DE];
  const cur = existing != null && Shapes.validShape(existing.text) ? existing.text.split('|') : ['rect', 'FF007AFF', '00000000', '3'];
  const stroke = [Shapes.parseColor(cur[1])], fill = [Shapes.parseColor(cur[2])], width = [parseInt(cur[3], 10)], kind = [cur[0]];
  const box = h('div', { class: 'm2-shapebox' });
  if (existing == null) {
    const buttons = [];
    const refresh = () => buttons.forEach((b, i) => { const on = Shapes.KINDS[i] === kind[0]; b.classList.toggle('on', on); });
    let line = null;
    Shapes.KINDS.forEach((id, i) => {
      if (i % 3 === 0) { line = h('div', { class: 'm2-shape-line' }); box.append(line); }
      const b = h('div', { class: 'm2-shape-btn', role: 'button' }, Shapes.NAMES[i]);
      b.addEventListener('click', () => { kind[0] = id; refresh(); });
      buttons.push(b); line.append(b);
    });
    refresh();
  }
  box.append(this.sectionLabel('선 색'), this.colorRow(strokeColors, stroke));
  box.append(this.sectionLabel('채우기 색 (왼쪽 흰 원 = 없음)'), this.colorRow(fillColors, fill));
  const widthLabel = this.sectionLabel('선 굵기 ' + width[0]); box.append(widthLabel);
  const bar = h('input', { type: 'range', min: 1, max: 12, step: 1, value: width[0], class: 'm2-seek', 'aria-label': '선 굵기' });
  bar.addEventListener('input', () => { width[0] = +bar.value; widthLabel.textContent = '선 굵기 ' + width[0]; });
  box.append(bar);
  const turn = [existing == null ? 0 : (existing.rot || 0)];
  const turnLabel = this.sectionLabel('회전 ' + Math.round(turn[0]) + '°'); box.append(turnLabel);
  const turnBar = h('input', { type: 'range', min: 0, max: 72, step: 1, value: Math.round(turn[0] / 5) % 73, class: 'm2-seek', 'aria-label': '회전', dataset: { tag: 'shape_rotation' } });
  turnBar.addEventListener('input', () => { turn[0] = +turnBar.value * 5; turnLabel.textContent = '회전 ' + Math.round(turn[0]) + '°'; });
  box.append(turnBar);
  alertCard({
    title: existing == null ? '도형' : '도형 모양 수정', view: wrapScroll(box, { maxHeight: 'calc(100vh - 220px)' }),
    positive: [existing == null ? '넣기' : '적용', () => {
      const spec = Shapes.shapeSpec(kind[0], stroke[0], fill[0], width[0]);
      if (existing == null) { this.placementText = spec; this.placementRot = turn[0]; this.placeElement('shape', ''); }
      else { existing.text = spec; existing.rot = turn[0]; this.store.save(); this.redrawPages(); }
    }],
    negative: ['취소'],
  });
};
M.showTableDialog = function (existing) {
  if (!this.renderer) { toast('문서를 먼저 여세요'); return; }
  const lineColors = [0xFF1C1C1E, 0xFF8E8E93, 0xFFFF3B30, 0xFFFF9500, 0xFF34C759, 0xFF30B0C7, 0xFF007AFF, 0xFFAF52DE].map(toInt);
  const headColors = [0x00000000, 0xFFE5F0FF, 0xFFFFE3E8, 0xFFFFF4CC, 0xFFE3F7E8, 0xFFEDE3FA, 0xFFD9D9DE, 0xFF1C1C1E].map(toInt);
  const fillColors = [0x00000000, 0xFFFFFFFF, 0xFFF2F2F7, 0xFFFFF9E0, 0xFFEAF6EC, 0xFFEAF2FF, 0xFFFCEAF0, 0xFFF3ECFA].map(toInt);
  const base = existing != null ? Table.parse(existing.text) : Table.create(3, 3, 0xFF3A3A3C | 0, 0xFFE5F0FF | 0, 0x00FFFFFF);
  const line = [base.line], head = [base.head], fill = [base.fill];
  const box = h('div', { class: 'm2-shapebox' });
  const rowsInput = editText({ numeric: true, value: base.rows, center: true, style: { width: '64px' } });
  const colsInput = editText({ numeric: true, value: base.cols, center: true, style: { width: '64px' } });
  box.append(h('div', { class: 'm2-tbl-size' }, h('span', null, '행'), rowsInput, h('span', { style: { marginLeft: '14px' } }, '열'), colsInput));
  box.append(this.sectionLabel('선 색'), this.colorRow(lineColors, line));
  box.append(this.sectionLabel('머리글 칸 색 (첫 줄)'), this.colorRow(headColors, head));
  box.append(this.sectionLabel('바탕 색'), this.colorRow(fillColors, fill));
  let painted = base;
  const paintCells = h('div', { role: 'button', style: { color: ACCENT, fontWeight: '700', fontSize: '15px', padding: '14px 2px 8px', cursor: 'pointer' } }, '셀별 색 지정 …');
  paintCells.addEventListener('click', () => {
    let r = 3, c = 3;
    if (/^\d+$/.test(rowsInput.value.trim()) && /^\d+$/.test(colsInput.value.trim())) { r = parseInt(rowsInput.value.trim(), 10); c = parseInt(colsInput.value.trim(), 10); }
    r = Math.max(1, Math.min(30, r)); c = Math.max(1, Math.min(12, c));
    painted = painted.resized(r, c); this.showCellColorEditor(painted, null);
  });
  box.append(paintCells);
  alertCard({
    title: existing == null ? '표 만들기' : '표 모양 수정', view: wrapScroll(box, { maxHeight: 'calc(100vh - 220px)' }),
    positive: [existing == null ? '넣기' : '적용', () => {
      let r = 3, c = 3;
      const pr = parseInt(rowsInput.value.trim(), 10), pc = parseInt(colsInput.value.trim(), 10);
      if (Number.isFinite(pr) && Number.isFinite(pc) && /^\d+$/.test(rowsInput.value.trim()) && /^\d+$/.test(colsInput.value.trim())) { r = pr; c = pc; }
      r = Math.max(1, Math.min(30, r)); c = Math.max(1, Math.min(12, c));
      const t = painted.resized(r, c); t.line = line[0]; t.head = head[0]; t.fill = fill[0];
      if (existing == null) { this.placementText = t.serialize(); this.placeElement('table', ''); }
      else { existing.text = t.serialize(); this.store.save(); this.redrawPages(); }
    }],
    negative: ['취소'],
  });
};
/** Cell-colour painter: pick a colour (the first swatch clears) and click cells to paint them; works on t.bg in place. */
M.showCellColorEditor = function (t, done) {
  const palette = [0x00000000, 0xFFFFF4CC, 0xFFFFE3E8, 0xFFE3F7E8, 0xFFE5F0FF, 0xFFEDE3FA, 0xFFD9D9DE, 0xFFFFB3B3, 0xFFFFD6A5, 0xFFB9E6C4, 0xFF9EC9FF, 0xFF1C1C1E].map(toInt);
  const chosen = [palette[1]];
  const box = h('div', { class: 'm2-shapebox' });
  box.append(this.sectionLabel('칠할 색을 고른 뒤 칸을 누르세요 (맨 앞 흰 동그라미 = 색 지우기)'), this.colorRow(palette, chosen));
  const side = Math.max(30, Math.min(56, Math.floor(280 / t.cols)));
  const grid = h('div', { class: 'm2-cells', style: { marginTop: '10px' } });
  for (let r = 0; r < t.rows; r++) {
    const line = h('div', { class: 'm2-cell-row' });
    for (let c = 0; c < t.cols; c++) {
      const index = r * t.cols + c, label = String(t.cells[index] == null ? '' : t.cells[index]).trim();
      const cell = h('div', { role: 'button', 'aria-label': '셀 ' + (r + 1) + '행 ' + (c + 1) + '열', style: { width: side + 'px', height: side + 'px', boxSizing: 'border-box', border: '1px solid #8E8E93', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', whiteSpace: 'nowrap', cursor: 'pointer' } }, label);
      const paint = () => {
        const color = t.bg[index] | 0, on = (color >>> 24) !== 0;
        cell.style.background = on ? argb(color >>> 0) : '#fff';
        cell.style.color = on && (0.299 * ((color >> 16) & 255) + 0.587 * ((color >> 8) & 255) + 0.114 * (color & 255)) < 110 ? '#fff' : '#1C1C1E';
      };
      paint(); cell.addEventListener('click', () => { t.bg[index] = chosen[0] | 0; paint(); });
      line.append(cell);
    }
    grid.append(line);
  }
  box.append(grid);
  alertCard({ title: '셀 색 지정', view: wrapScroll(box, { maxHeight: 'calc(100vh - 220px)', overflow: 'auto' }), positive: ['확인', () => { if (done) done(); }] });
};
M.editTableCells = function (element) {
  const t = Table.parse(element.text);
  const grid = h('div', { class: 'm2-cells' });
  const inputs = [];
  const cw = Math.max(84, Math.floor(300 / t.cols));
  for (let r = 0; r < t.rows; r++) {
    const line = h('div', { class: 'm2-cell-row' });
    for (let c = 0; c < t.cols; c++) {
      const input = editText({ hint: r === 0 ? '제목' : '', value: t.cells[r * t.cols + c], style: { width: cw + 'px', fontSize: '13px' } });
      inputs[r * t.cols + c] = input; line.append(input);
    }
    grid.append(line);
  }
  alertCard({
    title: '표 내용', view: wrapScroll(grid, { maxHeight: 'calc(100vh - 220px)', overflow: 'auto' }),
    positive: ['저장', () => { for (let i = 0; i < inputs.length; i++) t.cells[i] = inputs[i].value; element.text = t.serialize(); this.store.save(); this.redrawPages(); }],
    neutral: ['셀 색', () => { for (let i = 0; i < inputs.length; i++) t.cells[i] = inputs[i].value; this.showCellColorEditor(t, () => { element.text = t.serialize(); this.store.save(); this.redrawPages(); }); }],
    negative: ['취소'],
  });
};

// ---- YouTube ------------------------------------------------------------------------------------------------------------------------------------------------------------
M.youtubeId = youtubeId;
M.askYoutube = function () {
  if (!this.renderer) { toast('문서를 먼저 여세요'); return; }
  const input = editText({ hint: 'https://youtu.be/… 또는 youtube.com/watch?v=…', style: { padding: '12px 24px' } });
  const d = alertCard({
    title: '유튜브 링크', view: input, positive: ['넣기'], negative: ['취소'],
  });
  rebindButton(d, BUTTON_POSITIVE, () => {
    const id = youtubeId(input.value);
    if (id == null) { toast('유튜브 주소를 입력하세요'); return; }
    d.dismiss(); this.importYoutube(id);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); d.buttons[0].click(); } });
  try { navigator.clipboard.readText().then(t => { if (t && youtubeId(t) != null && input.value === '') input.value = t; }).catch(() => {}); } catch (e) { /* no clipboard access */ }
};
M.openYoutube = function (id) { this._openExternal('https://www.youtube.com/watch?v=' + id, '유튜브를 열 앱이 없습니다'); };
/** A YouTube video is stored as its video id plus a downloaded thumbnail; tapping it opens the video in the browser. */
M.importYoutube = async function (id) {
  const session = this.activeSession;
  toast('유튜브 영상 정보를 가져오는 중…');
  let thumb = '';
  try {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch('https://img.youtube.com/vi/' + id + '/mqdefault.jpg', { signal: ctl.signal, mode: 'cors' });
      if (!r.ok) throw new Error('http ' + r.status);
      const bmp = await createImageBitmap(await r.blob());
      const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; c.getContext('2d').drawImage(bmp, 0, 0);
      const name = AnnotationStore.newAssetName('png');
      await AnnotationStore.saveAsset(name, await canvasPng(c)); thumb = name;
    } finally { clearTimeout(timer); }
  } catch (e) { /* thumbnail is optional: the element is drawn as a placeholder */ }
  if (session && this.sessions.includes(session)) { await this.switchDocument(session); this.placementText = id; this.placeOrDrop('youtube', thumb); }
};

// ---- drag & drop / paste ----------------------------------------------------------------------------------------------------------------------------------------------------
M.installDrop = function (target) {
  if (!target || target._m2drop) return; target._m2drop = true;
  const ok = e => {
    if (!this.renderer || !e.dataTransfer) return false;
    const types = [...(e.dataTransfer.types || [])];
    return types.includes('Files') || types.includes('text/uri-list') || types.includes('text/plain') || types.includes('text/html');
  };
  target.addEventListener('dragover', e => { if (ok(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  target.addEventListener('drop', e => { if (ok(e)) { e.preventDefault(); this.handleDrop(e); } });
};
M.handleDrop = function (e) {
  if (!this.renderer) return false;
  const dt = e.dataTransfer; if (!dt) return false;
  let file = null, uri = null;
  for (const f of dt.files || []) { if (/^(image|video)\//.test(f.type) || /\.(png|jpe?g|gif|webp|bmp|mp4|m4v|mov|webm|mkv|avi|wmv)$/i.test(f.name)) { file = f; break; } }
  if (!file) {
    const ytDrop = youtubeId(dt.getData('text/uri-list')) || youtubeId(dt.getData('text/plain')) || youtubeId(dt.getData('text/html')) || youtubeId(dt.getData('text/x-moz-url'));
    if (ytDrop != null) {
      const hit0 = this.firstPageView, second0 = this.secondPageView; let hv = hit0;
      if (this.twoPage && second0 && second0.el.offsetParent !== null && e.clientX >= second0.el.getBoundingClientRect().left) hv = second0;
      if (hv) { const rr = hv.el.getBoundingClientRect(), nn = hv.toPage(e.clientX - rr.left, e.clientY - rr.top); this.dropTarget = [hv.getPageNumber(), nn[0], nn[1]]; this.dropTime = Date.now(); }
      this.importYoutube(ytDrop); return true;
    }
    const html = dt.getData('text/html'), text = (dt.getData('text/uri-list') || dt.getData('text/plain') || '').trim();
    if (html) { const m = /src=["']([^"']+)["']/.exec(html); if (m) uri = m[1]; }
    if (!uri && /^https?:\/\/\S+$/.test(text.split(/\r?\n/).find(l => l && !l.startsWith('#')) || '')) uri = text.split(/\r?\n/).find(l => l && !l.startsWith('#'));
    if (!uri && text) { const t0 = text.split(/\r?\n/)[0]; if (/^https?:\/\/\S+$/.test(t0)) uri = t0; }
  }
  if (!file && !uri) { toast('끌어 놓은 항목에서 이미지나 동영상을 찾지 못했습니다'); return false; }
  let hit = this.firstPageView;
  const second = this.secondPageView;
  if (this.twoPage && second && second.el.offsetParent !== null && e.clientX >= second.el.getBoundingClientRect().left) hit = second;
  if (!hit) return false;
  const r = hit.el.getBoundingClientRect();
  const n = hit.toPage(e.clientX - r.left, e.clientY - r.top);
  this.dropTarget = [hit.getPageNumber(), n[0], n[1]]; this.dropTime = Date.now();
  if (file) { if (/^video\//.test(file.type) || /\.(mp4|m4v|mov|webm|mkv|avi|wmv)$/i.test(file.name)) this.importVideo(file); else this.importImage(file); return true; }
  const yt = youtubeId(uri); if (yt != null) { this.importYoutube(yt); return true; }
  if (/^https?:/i.test(uri)) { this.downloadDroppedImage(uri); return true; }
  return false;
};
M.downloadDroppedImage = async function (address) {
  toast('이미지를 가져오는 중…');
  try {
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 20000);
    let blob;
    try {
      const r = await fetch(address, { signal: ctl.signal, mode: 'cors' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const type = r.headers.get('content-type');
      if (type && type.startsWith('video/')) throw new Error('동영상은 파일로 저장한 뒤 끌어 놓으세요');
      const len = +r.headers.get('content-length') || 0;
      if (len > 40 * 1024 * 1024) throw new Error('이미지가 너무 큽니다');
      blob = await r.blob();
      if (blob.size > 40 * 1024 * 1024) throw new Error('이미지가 너무 큽니다');
    } finally { clearTimeout(timer); }
    await this.importImage(blob);
  } catch (e) { this.dropTarget = null; toast('이미지를 가져오지 못했습니다: ' + errMsg(e)); }
};
/** Ctrl+V outside text fields (document 'paste' event) */
M.onPasteEvent = function (e) {
  if (!this.renderer) return;
  const t = e.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  const cd = e.clipboardData; if (!cd) return;
  const img = [...(cd.files || [])].find(f => f.type.startsWith('image/'));
  if (img) { e.preventDefault(); this.importImage(img); return; }
  const text = cd.getData('text/plain'); const id = youtubeId(text);
  if (id != null) { e.preventDefault(); this.importYoutube(id); return; }
  e.preventDefault(); this._pasteDialog();
};
M._pasteDialog = function () {
  alertCard({ title: '이미지 붙여넣기', message: '클립보드에 이미지가 없습니다. 브라우저의 ‘이미지 복사’를 사용하거나 저장된 이미지를 선택하세요.', positive: ['이미지 선택', () => this.pickImage()], negative: ['닫기'] });
};
M.pasteImage = async function () {
  if (!this.renderer) return;
  try {
    if (navigator.clipboard && navigator.clipboard.read) {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const it = item.types.find(t => t.startsWith('image/'));
        if (it) { this.importImage(await item.getType(it)); return; }
      }
      for (const item of items) if (item.types.includes('text/plain')) {
        const id = youtubeId(await (await item.getType('text/plain')).text());
        if (id != null) { this.importYoutube(id); return; }
      }
    } else if (navigator.clipboard && navigator.clipboard.readText) {
      const id = youtubeId(await navigator.clipboard.readText()); if (id != null) { this.importYoutube(id); return; }
    }
  } catch (e) { /* permission denied / empty: fall through to the hint dialog */ }
  this._pasteDialog();
};

// ---- 1146-1205: hyperlinks, geometry -------------------------------------------------------------------------------------------------------------------------------------
M.startHyperlink = function () {
  if (!this.renderer) { toast('문서를 먼저 여세요'); return; }
  this.startTextSelection(); toast('링크를 걸 글자를 드래그해 선택한 뒤 ‘링크’를 누르세요');
};
/** Accepts a web address or a page number and returns the stored target, or null when it is not valid. */
M.linkTarget = function (input) {
  let text = input == null ? '' : String(input).trim(); if (text === '') return null;
  if (/^\d{1,6}$/.test(text)) { const page = parseInt(text, 10); return this.renderer && page >= 1 && page <= this.renderer.pageCount ? 'page:' + (page - 1) : null; }
  if (!text.includes('://') && text.includes('.') && !text.includes(' ')) text = 'https://' + text;
  return this.validWebUrl(text) && !text.includes(' ') ? text : null;
};
M.createHyperlink = function (selection) {
  if (!this.store) return;
  const target = this.store, page = this.currentPage;
  this.chooseLinkTarget(link => {
    const group = Math.floor(Math.random() * 2147483647) + 1;
    const pieces = !selection.bounds || selection.bounds.length === 0 ? [selection.unionBounds] : selection.bounds;
    for (const b of pieces) {
      const e = new PageElement(); e.page = page; e.kind = 'hyperlink'; e.text = link; e.color = group;
      e.left = Math.max(0, b.left); e.top = Math.max(0, b.top); e.right = Math.min(1, b.right); e.bottom = Math.min(1, b.bottom);
      if (e.right - e.left < .005 || e.bottom - e.top < .003) continue;
      target.elements.push(e);
    }
    target.save(); this.redrawPages(); for (const v of [this.firstPageView, this.secondPageView]) if (v && v.stopTextSelection) v.stopTextSelection();
    this.syncOtherTools && this.syncOtherTools();
    if (this.sidebarVisible && this.panelTab === 4) this.rebuildInsertions();
    toast('링크를 만들었습니다. 글자를 클릭하면 바로 열리고, 길게 누르거나 오른쪽 클릭하면 수정·삭제 메뉴가 나옵니다');
  });
};
M.chooseLinkTarget = function (done) {
  const kinds = ['웹 주소', '이 문서의 페이지', '다른 문서'];
  listDialog('연결 대상', kinds, index => {
    if (index === 0) this.askLinkText('웹 주소', 'https://…', false, done);
    else if (index === 1) this.askLinkText('이 문서의 페이지 (1~' + (!this.renderer ? 1 : this.renderer.pageCount) + ')', '페이지 번호', true, done);
    else this.pickLinkDocument(done);
  }, '취소');
};
M.askLinkText = function (title, hint, number, done) {
  const input = editText({ hint, numeric: number, style: { padding: '12px 24px' } });
  const d = alertCard({ title, view: input, positive: ['확인'], negative: ['취소'] });
  rebindButton(d, BUTTON_POSITIVE, () => {
    const link = this.linkTarget(input.value);
    if (link == null) { toast(number ? '올바른 페이지 번호를 입력하세요' : 'http(s) 주소를 입력하세요'); return; }
    d.dismiss(); done(link);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); d.buttons[0].click(); } });
};
M.pickLinkDocument = async function (done) {
  let docs;
  try { docs = await this.library.allDocuments(''); } catch (e) { docs = []; }
  if (docs.length === 0) { toast('문서함에 연결할 문서가 없습니다'); return; }
  const shown = docs.length > 300 ? docs.slice(0, 300) : docs;
  const names = shown.map(f => stripPdf(baseName(f)));
  listDialog('연결할 문서', names, index => {
    const file = shown[index];
    const root = this.library.root.replace(/[\\/]+$/, '');
    if (!file.toLowerCase().startsWith(root.toLowerCase() + '\\')) { toast('문서를 연결할 수 없습니다'); return; }
    const relative = file.slice(root.length + 1).replace(/\\/g, '/');
    const input = editText({ hint: '페이지 번호 (비우면 처음 페이지)', numeric: true, style: { padding: '12px 24px' } });
    alertCard({
      title: names[index], view: input,
      positive: ['연결', () => { let page = 1; const p = parseInt(input.value.trim(), 10); if (Number.isFinite(p)) page = Math.max(1, p); done('doc:' + encodeURIComponent(relative).replace(/%2F/gi, '/') + '#' + (page - 1)); }],
      negative: ['취소'],
    });
  }, '취소');
};
M.describeLink = function (link) {
  if (link.startsWith('page:')) { const n = parseInt(link.substring(5), 10); return Number.isFinite(n) ? '이 문서 ' + (n + 1) + '쪽' : link; }
  if (link.startsWith('doc:')) {
    const body = link.substring(4), hash = body.lastIndexOf('#');
    let path; try { path = decodeURIComponent(hash >= 0 ? body.substring(0, hash) : body); } catch (e) { path = hash >= 0 ? body.substring(0, hash) : body; }
    const name = stripPdf(baseName(path)); let page = 1;
    if (hash >= 0) { const p = parseInt(body.substring(hash + 1), 10); if (Number.isFinite(p)) page = p + 1; }
    return name + ' · ' + page + '쪽';
  }
  return link;
};
M.openHyperlink = function (element) {
  if (element.text.startsWith('page:')) { const n = parseInt(element.text.substring(5), 10); if (Number.isFinite(n)) this.showPage(n); return; }
  if (element.text.startsWith('doc:')) {
    let body = element.text.substring(4); const hash = body.lastIndexOf('#'); let page = 0;
    if (hash >= 0) { const p = parseInt(body.substring(hash + 1), 10); if (Number.isFinite(p)) page = p; body = body.substring(0, hash); }
    let rel; try { rel = decodeURIComponent(body); } catch (e) { rel = body; }
    const file = joinPath(this.library.root, rel.replace(/\//g, '\\'));
    host.exists(file).then(ex => {
      if (!this.library.managed(file) || !ex) { toast('연결된 문서를 찾을 수 없습니다'); return; }
      this.openPdf(file, false, page, true);
    }).catch(() => toast('연결된 문서를 찾을 수 없습니다'));
    return;
  }
  if (this.validWebUrl(element.text)) this._openExternal(element.text, '링크를 열 앱이 없습니다');
};
/** A click / tap follows the link at once; a long press or right click asks what to do with it (the side-panel list offers the same). */
M.onHyperlinkTapped = function (element, longPress) { if (longPress) this.showHyperlinkMenu(element); else this.openHyperlink(element); };
M.showHyperlinkMenu = function (element) {
  const title = this.describeLink(element.text);
  listDialog(title.length > 60 ? title.substring(0, 60) + '…' : title, ['열기', '링크 수정', '링크 삭제'], index => {
    if (index === 0) this.openHyperlink(element);
    else if (index === 1) this.editHyperlink(element);
    else { this.deleteElement(element); toast('링크를 삭제했습니다'); }
  });
};
M.editHyperlink = function (element) {
  this.chooseLinkTarget(link => {
    const old = element.text;
    for (const e of this.store.elements) if (e.kind === 'hyperlink' && e.page === element.page && e.color === element.color && e.text === old) e.text = link;
    this.store.save(); this.redrawPages();
    if (this.sidebarVisible && this.panelTab === 4) this.rebuildInsertions();
  });
};
// ---- side-panel list of everything inserted in the document: links, pictures, videos, recordings, shapes, tables, typed text
const INSERT_LABELS = { hyperlink: '링크', link: '웹 링크', audio: '녹음', image: '사진', video: '동영상', youtube: '유튜브', sticker: '스티커', shape: '도형', table: '표' };
M.rebuildInsertions = function () {
  const list = this.insertList; if (!list) return;
  list.textContent = ''; if (!this.store) return;
  const seen = new Set(), items = [];
  for (const e of this.store.elements) { if (e.kind === 'audio') continue; if (e.kind === 'hyperlink') { const k = e.page + '|' + e.color + '|' + e.text; if (seen.has(k)) continue; seen.add(k); } items.push(e); }
  items.sort((a, b) => a.page - b.page || a.top - b.top);
  list.append(h('div', { class: 'm3-empty', dataset: { tag: 'insert_heading' }, style: { textAlign: 'left', padding: '4px 6px 6px' } }, '삽입한 항목 ' + items.length + '개'));
  if (!items.length) list.append(h('div', { class: 'm3-empty' }, '링크·사진·동영상·도형·표·타이핑·메모를 넣으면 여기에 모여 보입니다.\n항목을 누르면 그 위치로 이동하고, ⋮ 로 열기·수정·삭제를 합니다.'));
  const go = item => Promise.resolve(this.showPage(item.page)).then(() => { if (this.pageView && this.pageView.focusOnPoint) this.pageView.focusOnPoint((item.left + item.right) / 2, (item.top + item.bottom) / 2); });
  for (const item of items) {
    let detail = item.kind === 'hyperlink' ? this.describeLink(item.text) : (item.kind === 'link' || item.kind === 'audio' || !(item.kind in INSERT_LABELS)) ? String(item.text || '').trim() : '';
    if (detail.length > 40) detail = detail.substring(0, 40) + '…';
    const row = h('div', { class: 'm3-row', dataset: { tag: 'insert_item' } }, h('div', { class: 'm3-row-text' }, (INSERT_LABELS[item.kind] || '타이핑') + ' · p' + (item.page + 1) + (detail ? '\n' + detail : '')));
    row.addEventListener('click', () => go(item));
    { const mb = iconButton('ic_more_vert', '삽입 항목 관리', NAVY, ev => { ev.stopPropagation(); this.showInsertionMenu(item, mb, go); }, 40, 40, 10); row.append(mb); }
    list.append(row);
  }
  this.appendMarkList(list);
};
M.showInsertionMenu = function (item, anchor, go) {
  const R = AnchoredMenu.Row, rows = [new R('이동', 'ic_page', () => go(item)).tint('#30B0C7')];
  if (item.kind === 'hyperlink' || item.kind === 'link') rows.push(new R('열기', 'ic_link', () => { if (item.kind === 'hyperlink') this.openHyperlink(item); else if (this.validWebUrl(item.text)) this._openExternal(item.text, '링크를 열 앱이 없습니다'); }).tint('#5856D6'));
  if (item.kind === 'video' || item.kind === 'youtube') rows.push(new R('재생', 'ic_video', () => Promise.resolve(this.showPage(item.page)).then(() => this.playInline(item))).tint('#FF3B30'));
  if (item.kind === 'hyperlink') rows.push(new R('수정', 'ic_compose', () => this.editHyperlink(item)).tint('#007AFF'));
  else if (item.kind === 'link' || item.kind === 'text') rows.push(new R('수정', 'ic_compose', () => Promise.resolve(this.showPage(item.page)).then(() => this.editPageElement(item, false))).tint('#007AFF'));
  if (item.kind !== 'hyperlink') rows.push(new R('위치·크기', 'ic_fullscreen', () => this.editElementGeometry(item)).tint('#34C759'));
  rows.push(new R('삭제', 'ic_delete', () => { if (item.kind === 'audio' && this.deleteRecording) this.deleteRecording(item); else this.deleteElement(item); if (this.sidebarVisible && this.panelTab === 4) this.rebuildInsertions(); toast('삭제했습니다'); }).danger());
  AnchoredMenu.showRightOf(anchor || this.sidePanel, this.sidePanel, rows);
};
M.editElementGeometry = function (element) {
  const panel = h('div', { class: 'm2-geo' });
  const labels = ['왼쪽 (%)', '위쪽 (%)', '너비 (%)', '높이 (%)'];
  const values = [element.left * 100, element.top * 100, (element.right - element.left) * 100, (element.bottom - element.top) * 100];
  const inputs = labels.map((l, i) => { const e = editText({ hint: l, decimal: true, value: values[i].toFixed(1) }); e.style.marginBottom = '6px'; panel.append(e); return e; });
  alertCard({
    title: '위치·크기 · %', view: panel,
    positive: ['적용', () => {
      const n = inputs.map(i => (/^\s*[+-]?(\d+\.?\d*|\.\d+)\s*$/.test(i.value) ? parseFloat(i.value) : NaN));
      const [x, y, w, hh] = n.map(v => v / 100);
      if (![x, y, w, hh].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || hh <= 0 || x + w > 1 || y + hh > 1) { toast('페이지 안에 들어가는 위치와 크기를 입력하세요'); return; }
      element.left = x; element.top = y; element.right = x + w; element.bottom = y + hh; this.store.save(); this.redrawPages();
    }],
    negative: ['취소'],
  });
};

// ====================================================================================================================
// Side panel: search / page previews / outline (+marks) / recordings
// ====================================================================================================================
M.sidePanelWidth = function () {
  const def = Math.max(SPLIT.sideMin, Math.min(190, Math.round(window.innerWidth * .42))), saved = this.recentPrefs ? this.recentPrefs.getInt('side_w', 0) : 0;
  const max = Math.max(SPLIT.sideMin, Math.min(SPLIT.sideMaxAbs, Math.round(window.innerWidth * .6)));
  return saved > 0 ? clamp(saved, SPLIT.sideMin, max) : def;
};
M.buildSidePanel = function () {
  if (!this.searchPanel) this.buildSearchPanel();
  if (!this.thumbnailPanel) {
    this.thumbnailPanel = h('div', { class: 'm2-thumbpanel m2-scrollv' });
    this.thumbnailList = h('div', { class: 'm2-thumblist' }); this.thumbnailPanel.append(this.thumbnailList);
  } else if (!this.thumbnailList) { this.thumbnailList = this.thumbnailPanel.firstElementChild; }
  this.thumbnailPanel.classList.add('m2-thumbpanel', 'm2-scrollv');
  this.thumbnailList.classList.add('m2-thumblist');
  const panel = h('div', { class: 'm2-side', dataset: { tag: 'side_panel' } });
  panel.style.display = 'none';
  this.sideTitle = h('div', { class: 'm2-side-title', dataset: { tag: 'side_title' } });
  this.sideMore = iconButton('ic_more_vert', '미리보기 메뉴', NAVY, e => this.showThumbnailMenu(this.sideMore), 36, 48);
  this.sideMore.style.padding = '12px 6px'; this.sideMore.dataset.tag = 'side_more'; this.sideMore.classList.add('m2-side-btn');
  const close = iconButton('ic_close', '패널 닫기', NAVY, () => this.closeSidePanel(), 38, 48); close.style.padding = '12px 7px'; close.classList.add('m2-side-btn');
  panel.append(h('div', { class: 'm2-side-head' }, this.sideTitle, this.sideMore, close));
  const tabs = h('div', { class: 'm2-side-tabs' });
  const names = ['검색 탭', '페이지 미리보기 탭', '개요 탭', '음성 녹음 탭', '삽입 목록 탭'];
  this.sideTabs = [];
  for (let i = 0; i < 5; i++) {
    const b = iconButton(SIDE_ICONS[i], names[i], NAVY, () => this.selectPanelTab(i), 0, 40);
    b.classList.add('m2-side-tab'); b.dataset.tag = 'side_tab:' + i; this.sideTabs.push(b); tabs.append(b);
  }
  panel.append(tabs);
  this.outlineList = h('div', { class: 'm2-sidelist' });
  this.outlineScroll = h('div', { class: 'm2-sidepane m2-scrollv' }, this.outlineList);
  this.recordingList = h('div', { class: 'm2-sidelist' });
  this.recordingScroll = h('div', { class: 'm2-sidepane m2-scrollv' }, this.recordingList);
  this.insertList = h('div', { class: 'm2-sidelist' });
  this.insertScroll = h('div', { class: 'm2-sidepane m2-scrollv' }, this.insertList);
  this.searchPanel.classList.add('m2-sidepane'); this.thumbnailPanel.classList.add('m2-sidepane');
  this.sideContent = h('div', { class: 'm2-side-content' }, this.searchPanel, this.thumbnailPanel, this.outlineScroll, this.recordingScroll, this.insertScroll);
  panel.append(this.sideContent);
  this.sidePanel = panel;
  this.sideSplitter = h('div', { class: 'm2-splitter side', dataset: { tag: 'side_splitter' }, title: '끌어서 너비 조절 (두 번 누르면 기본값)', 'aria-label': '왼쪽 패널 너비 조절', 'aria-orientation': 'vertical' });
  attachSplitter(this.sideSplitter, {
    axis: () => 'x', sign: 1, read: () => panel.getBoundingClientRect().width,
    min: () => SPLIT.sideMin, max: () => Math.max(SPLIT.sideMin, Math.min(SPLIT.sideMaxAbs, Math.round(window.innerWidth * .6))),
    apply: (v, fin) => { panel.style.width = v + 'px'; this.fitSideHead(); resizeSoon(); if (fin) { this.recentPrefs.putInt('side_w', Math.round(v)); this.sidePanelResized(); } },
    reset: () => { this.recentPrefs.remove('side_w'); panel.style.width = this.sidePanelWidth() + 'px'; resizeSoon(); this.sidePanelResized(); },
  });
  panel.append(this.sideSplitter);
  return panel;
};
/** Thumbnails are sized from the panel width: rebuild once a drag has ended. */
M.sidePanelResized = function () { clearTimeout(this._thumbT); this._thumbT = setTimeout(() => { if (this.sidebarVisible && this.panelTab === 1 && this.rebuildThumbnails) this.rebuildThumbnails(); }, 120); };
/** Same icon as the matching menu entry (a star while only the favourites are shown) + the word. */
M.setSideTitle = function (tab) {
  const star = tab === 1 && !this.showAllThumbnails;
  this.sideTitle.replaceChildren(icon(star ? 'ic_star' : SIDE_ICONS[tab], 20, star ? '#F5A623' : SIDE_TINTS[tab]), h('span', { class: 'm2-side-label' }, SIDE_TITLES[tab]));
};
/** The header never loses its title: narrow panels get smaller buttons and padding, the text shrinks to fit. */
M.fitSideHead = function () {
  if (!this.sidePanel) return;
  this.sidePanel.classList.toggle('narrow', this.sidePanel.getBoundingClientRect().width < 190);
  const label = this.sideTitle.querySelector('.m2-side-label'); if (label) fitText(label, 8, 15);
};
M.selectPanelTab = function (tab) {
  if (!this.sidePanel) this.buildSidePanel();
  const panel = this.sidePanel;
  if (!panel.isConnected && this.viewerRow) this.viewerRow.insertBefore(panel, this.viewerRow.firstChild);
  this.panelTab = tab; this.sidebarVisible = true; panel.style.display = 'flex';
  this.searchPanel.style.display = tab === 0 ? 'flex' : 'none';
  this.thumbnailPanel.style.display = tab === 1 ? 'block' : 'none';
  this.outlineScroll.style.display = tab === 2 ? 'block' : 'none';
  this.recordingScroll.style.display = tab === 3 ? 'block' : 'none';
  this.insertScroll.style.display = tab === 4 ? 'block' : 'none';
  this.setSideTitle(tab);
  this.sideMore.style.display = tab === 1 ? 'flex' : 'none';
  this.sideTabs.forEach((b, i) => { const on = i === tab; b.style.color = on ? ACTIVE_FG : NAVY; b.style.background = on ? ACTIVE_BG : 'transparent'; });
  const width = this.sidePanelWidth(); panel.style.width = width + 'px';
  this.fitSideHead();
  if (tab === 0) { this.searchInput.focus(); } else this.hideKeyboard();
  this.rebuildThumbnails(); this.applySearchHighlights();
  window.dispatchEvent(new Event('resize'));
};
function fitText(el, min, max) {
  el.style.fontSize = max + 'px';
  requestAnimationFrame(() => { let s = max; while (s > min && el.scrollWidth > el.clientWidth) { s--; el.style.fontSize = s + 'px'; } });
}
M.closeSidePanel = function () {
  const searched = this.panelTab === 0 && this.searchHits && this.searchHits.length > 0;
  this.sidebarVisible = false; if (this.sidePanel) this.sidePanel.style.display = 'none';
  this.closeSearch(); this.hideKeyboard(); this.applySearchHighlights();
  if (searched && this.renderer && this.resetZoomAll) this.resetZoomAll();   // Android v1.32.0: the zoom of a search jump does not stay
  window.dispatchEvent(new Event('resize'));
};
/** Preview panel ⋮ menu (Android v1.32.0): favorites only / all pages (checked), add page, delete page. */
M.showThumbnailMenu = function (anchor) {
  const R = AnchoredMenu.Row;
  AnchoredMenu.show(anchor, false, [
    new R('즐겨찾기 페이지만', 'ic_star', () => { this.showAllThumbnails = false; this.recentPrefs.putBoolean('thumb_all', false); this.selectPanelTab(1); }).tint('#F5A623').selected(!this.showAllThumbnails),
    new R('전체 페이지', 'ic_thumbnails', () => { this.showAllThumbnails = true; this.recentPrefs.putBoolean('thumb_all', true); this.selectPanelTab(1); }).tint('#007AFF').selected(this.showAllThumbnails),
    R.divider(),
    new R('페이지 추가', 'ic_page_add', () => this.chooseAddedPage()).tint('#34C759'),
    new R('다른 형식으로 페이지 추가', 'ic_page_add', () => this.chooseOtherPageFormat(!this.renderer ? 0 : this.renderer.pageCount - 1)).tint('#34C759'),
    new R('페이지 삭제', 'ic_delete', () => this.confirmDeletePage(this.currentPage)).danger()], null);
};
/** Lets a list row be swiped away (either direction) to delete it. iOS Mail style (Android v1.32.0): a red area with a trash icon is revealed
 *  under the row; past the 40% line it turns darker and the icon grows. Taps and vertical scrolling keep working. */
M.swipeToDelete = function (row, del) {
  let sx = 0, sy = 0, dragging = false, id = null, dx = 0, bg = null, ic = null, armed = false;
  const slop = 8;
  row.classList.add('m2-swipe');
  const sync = () => {
    if (!bg) return;
    const w = row.offsetWidth, was = armed; armed = Math.abs(dx) > w * .4;
    if (armed && !was && navigator.vibrate) try { navigator.vibrate(8); } catch (err) { /* ignore */ }
    bg.style.background = armed ? '#D92D20' : '#FF3B30';
    const sz = armed ? 25 : 22, left = dx < 0;
    ic.style.width = ic.style.height = sz + 'px';
    ic.style.top = (row.offsetHeight - sz) / 2 + 'px';
    ic.style.left = ''; ic.style.right = '';
    if (left) ic.style[armed ? 'left' : 'right'] = '18px'; else ic.style[armed ? 'right' : 'left'] = '18px';
    bg.style.display = Math.abs(dx) < 22 + 18 ? 'none' : '';
  };
  const mkBg = () => {
    const par = row.parentElement; if (!par) return;
    if (getComputedStyle(par).position === 'static') par.style.position = 'relative';
    bg = h('div', { class: 'm2-swipe-bg' }); ic = icon('ic_delete', 22, '#fff'); ic.style.position = 'absolute'; bg.append(ic);
    bg.style.top = row.offsetTop + 'px'; bg.style.left = row.offsetLeft + 'px'; bg.style.width = row.offsetWidth + 'px'; bg.style.height = row.offsetHeight + 'px';
    par.insertBefore(bg, row);
  };
  const rmBg = () => { if (bg) bg.remove(); bg = ic = null; armed = false; };
  row.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button !== 0) return; sx = e.clientX; sy = e.clientY; dragging = false; id = e.pointerId; dx = 0; });
  row.addEventListener('pointermove', e => {
    if (e.pointerId !== id) return;
    dx = e.clientX - sx; const dy = e.clientY - sy;
    if (!dragging && Math.abs(dx) > slop * 1.5 && Math.abs(dx) > Math.abs(dy) * 1.4) { dragging = true; try { row.setPointerCapture(id); } catch (err) { /* ignore */ } row.style.transition = 'none'; mkBg(); }
    if (dragging) { row.style.transform = 'translateX(' + dx + 'px)'; sync(); }
  });
  const end = e => {
    if (e.pointerId !== id) return; id = null;
    if (!dragging) return;
    dragging = false;
    const gone = e.type === 'pointerup' && Math.abs(dx) > row.offsetWidth * .4;
    row._swiped = true; setTimeout(() => { row._swiped = false; }, 50);
    row.style.transition = 'transform .16s';
    if (gone) { row.style.transform = 'translateX(' + Math.sign(dx) * row.offsetWidth + 'px)'; dx = Math.sign(dx) * row.offsetWidth; sync(); setTimeout(() => { rmBg(); del(); }, 160); }
    else { row.style.transform = ''; dx = 0; setTimeout(rmBg, 170); }
  };
  row.addEventListener('pointerup', end); row.addEventListener('pointercancel', end);
  row.addEventListener('click', e => { if (row._swiped) { e.stopImmediatePropagation(); e.preventDefault(); } }, true);
};
M.rebuildOutlinePanel = function () { this.rebuildOutlineItems(); };
/** Lists every highlight with a note and every sticky memo of the document in the 삽입 목록 tab (the outline tab keeps outlines only). */
M.appendMarkList = function (list) {
  if (!this.store) return;
  const listed = this.store.marks.filter(m => m.noteOnly || (m.note != null && m.note.trim() !== ''));
  if (listed.length === 0) return;
  list.append(h('div', { class: 'm2-marks-h' }, '메모 ' + listed.length));
  const marks = [...listed].sort((a, b) => a.page - b.page || a.top - b.top);
  for (const mark of marks) {
    const row = h('div', { class: 'm2-mark', dataset: { tag: 'mark_item' }, role: 'button' });
    const dot = h('div', { class: 'm2-mark-dot', style: { background: argb(((mark.noteOnly ? mark.paper : (mark.color | 0xFF000000)) | 0) >>> 0) } });
    const note = mark.note == null ? '' : mark.note.trim();
    row.append(dot, h('div', { class: 'm2-mark-text' }, (mark.noteOnly ? '메모' : '하이라이트') + ' (p' + (mark.page + 1) + ')' + (note === '' ? '' : '\n' + note)));
    row.addEventListener('click', () => this._goTo(mark.page, (mark.left + mark.right) / 2, (mark.top + mark.bottom) / 2));
    this.swipeToDelete(row, () => { const a = this.store.marks, i = a.indexOf(mark); if (i >= 0) a.splice(i, 1); this.store.save(); this.redrawPages(); this.rebuildInsertions(); toast('삭제했습니다'); });
    list.append(row);
  }
};
M.rebuildOutlineItems = function () {
  this.outlineList.textContent = '';
  if (!this.store) return;
  const add = this.pill('＋ 개요 추가', '개요 추가', ACTIVE_BG, ACTIVE_FG, () => this.toggleOutlineMode());
  add.dataset.tag = 'outline_add'; add.style.cssText += ';height:44px;margin-bottom:8px';
  this.outlineList.append(add);
  const items = [...this.store.outlines].sort((a, b) => a.page - b.page || a.y - b.y);
  if (items.length === 0) { this.outlineList.append(h('div', { class: 'm2-empty' }, '기억할 위치를 제목과 함께 저장하세요.\n위의 ‘개요 추가’를 누른 뒤 본문을 탭합니다.')); return; }
  for (const item of items) {
    const row = h('div', { class: 'm2-outline', dataset: { tag: 'outline_item' }, role: 'button' });
    row.append(h('div', { class: 'm2-outline-t' }, item.title, h('span', { class: 'm2-outline-p' }, '  (p' + (item.page + 1) + ')')));
    row.addEventListener('click', () => this._goTo(item.page, item.x, item.y));
    this.swipeToDelete(row, () => { const a = this.store.outlines, i = a.indexOf(item); if (i >= 0) a.splice(i, 1); this.store.save(); this.rebuildOutlinePanel(); toast('개요를 삭제했습니다'); });
    { const mb = iconButton('ic_more_vert', '개요 관리', NAVY, ev => { ev.stopPropagation(); this.showOutlineItem(item, mb); }); row.append(mb); }
    this.outlineList.append(row);
  }
};
M.thumbnailModeToggle = function () {
  const row = h('div', { class: 'm2-thumbtoggle', dataset: { tag: 'thumb_toggle' } });
  ['★ 즐겨찾기', '전체'].forEach((label, i) => {
    const all = i === 1, on = all === this.showAllThumbnails;
    const chip = h('div', { class: 'm2-ttchip' + (on ? ' on' : ''), role: 'button', 'aria-label': all ? '전체 페이지 미리보기' : '즐겨찾기한 페이지만 미리보기', style: { flex: (all ? 2 : 3) + ' 1 0' } }, label);
    chip.addEventListener('click', () => { if (this.showAllThumbnails === all) return; this.showAllThumbnails = all; this.recentPrefs.putBoolean('thumb_all', all); this.rebuildThumbnails(); });
    row.append(chip);
  });
  return row;
};
M.thumbnailPages = function () {
  const pages = []; const total = !this.renderer ? 0 : this.renderer.pageCount;
  if (this.showAllThumbnails) { for (let i = 0; i < total; i++) pages.push(i); }
  else if (this.store) { for (const p of this.store.bookmarks) if (p != null && p >= 0 && p < total) pages.push(p); pages.sort((a, b) => a - b); }
  return pages;
};
/** Height/width of the first page, used to size thumbnail placeholders so the whole page always fits. */
M.thumbnailAspect = async function () {
  if (!this.renderer || this.renderer.pageCount === 0) return 1.41;
  const c = this._thumbAspectCache; if (c && c.doc === this.renderer) return c.v;
  let v = 1.41;
  try { const s = await this.renderer.pageSize(0); v = Math.max(.5, Math.min(2.2, s.h / Math.max(1, s.w))); } catch (e) { /* default */ }
  this._thumbAspectCache = { doc: this.renderer, v };
  return v;
};
M.rebuildThumbnails = async function () {
  if (!this.sidebarVisible) return;
  if (this.panelTab === 2) { this.rebuildOutlinePanel(); return; }
  if (this.panelTab === 3) { if (this.rebuildRecordings) this.rebuildRecordings(); return; }
  if (this.panelTab === 4) { this.rebuildInsertions(); return; }
  if (this.panelTab !== 1) return;
  const generation = ++this.thumbnailGeneration;
  this.thumbnailList.textContent = '';
  if (!this.renderer) return;
  const pages = this.thumbnailPages();
  if (pages.length === 0) { this.thumbnailList.append(h('div', { class: 'm2-empty', dataset: { tag: 'thumb_empty' } }, '즐겨찾기한 페이지가 없습니다.\n\n아래쪽 ★를 누르면\n이곳에 미리보기가 나타납니다.')); return; }
  const aspect = await this.thumbnailAspect();
  if (generation !== this.thumbnailGeneration) return;
  const pw = this.sidePanelWidth() - 60, ph = Math.round(pw * aspect);
  for (const page of pages) {
    const item = h('div', { class: 'm2-thumb', dataset: { page } });
    const preview = h('div', { class: 'm2-thumb-img', style: { width: pw + 'px', height: ph + 'px' } });
    const number = h('div', { class: 'm2-thumb-num' }, String(page + 1));
    const more = h('div', { class: 'm2-thumb-more', role: 'button', 'aria-label': '페이지 ' + (page + 1) + ' 메뉴' }, '⋮');
    more.addEventListener('click', e => { e.stopPropagation(); this.showPageMenu(page, more); });
    item.append(preview, h('div', { class: 'm2-thumb-row' }, number, more));
    item.addEventListener('click', () => this.showPage(page));
    item.addEventListener('contextmenu', e => { e.preventDefault(); this.showPageMenu(page, item); });
    this.thumbnailList.append(item);
  }
  if (this.updateThumbnailSelection) this.updateThumbnailSelection();
  this.renderThumbnail(pages, 0, generation, this.activeSession);
};
M.renderThumbnail = async function (pages, position, generation, session) {
  if (generation !== this.thumbnailGeneration || session !== this.activeSession || !this.renderer || position >= pages.length) return;
  await new Promise(r => setTimeout(r, 0));
  if (generation !== this.thumbnailGeneration || session !== this.activeSession || !this.renderer) return;
  const index = pages[position];
  try {
    const size = await this.renderer.pageSize(index);
    const canvas = await this.renderer.renderPage(index, 300 / size.w);
    if (generation !== this.thumbnailGeneration || session !== this.activeSession) return;
    try { await AnnotationPainter.preload(session.store, index); } catch (e) { /* ignore */ }
    const prev = AnnotationPainter.dark; AnnotationPainter.dark = false;
    try { AnnotationPainter.all(canvas.getContext('2d'), new RectF(0, 0, canvas.width, canvas.height), session.store, index); } finally { AnnotationPainter.dark = prev; }
    const item = this.thumbnailList.querySelector('[data-page="' + index + '"]');
    if (item) { const slot = item.firstElementChild; slot.textContent = ''; canvas.className = 'm2-thumb-canvas'; slot.append(canvas); }
  } catch (e) { /* ignore: leave the white placeholder */ }
  this.renderThumbnail(pages, position + 1, generation, session);
};

// ====================================================================================================================
// Docked search
// ====================================================================================================================
M.buildSearchPanel = function () {
  const panel = h('div', { class: 'm2-search', dataset: { tag: 'search_panel' } });
  panel.style.display = 'none';
  const input = h('input', { class: 'm2-search-in', type: 'text', placeholder: '검색어를 입력하고 Enter', spellcheck: 'false', enterkeyhint: 'search', 'aria-label': '검색어', dataset: { tag: 'search_input' } });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); this.startSearch(); } });
  this.searchInput = input;
  panel.append(h('div', { class: 'm2-search-row' }, input,
    iconButton('ic_chevron_up', '이전 결과', NAVY, () => this.stepSearch(-1), 40, 40),
    iconButton('ic_chevron_down', '다음 결과', NAVY, () => this.stepSearch(1), 40, 40),
    iconButton('ic_close', '검색 닫기', GRAY, () => this.closeSearch(), 40, 40)));
  this.searchStatus = h('div', { class: 'm2-search-status', dataset: { tag: 'search_status' } });
  const precise = h('div', { class: 'm2-precise', role: 'button', dataset: { tag: 'search_precise' }, 'aria-label': '스캔·손글씨까지 글자 인식으로 정밀 검색' }, '정밀(OCR)');
  const paint = () => precise.classList.toggle('on', !!this.searchPrecise);
  precise.addEventListener('click', () => { this.searchPrecise = !this.searchPrecise; paint(); if (input.value.trim().length > 0) this.startSearch(); });
  paint();
  panel.append(h('div', { class: 'm2-search-info' }, this.searchStatus, precise));
  this.searchList = h('div', { class: 'm2-search-list' });
  this.searchScroll = h('div', { class: 'm2-search-scroll m2-scrollv' }, this.searchList); this.searchScroll.style.display = 'none';
  panel.append(this.searchScroll, h('div', { class: 'm2-search-div' }));
  this.searchPanel = panel;
  this.updateSearchStatus();
  return panel;
};
M.searchDocument = function () {
  if (!this.activeSession) { toast('문서를 먼저 여세요'); return; }
  this.selectPanelTab(0); this.searchInput.select();
};
M.hideKeyboard = function () { if (this.searchInput && document.activeElement === this.searchInput) this.searchInput.blur(); };
M.startSearch = async function () {
  if (!this.activeSession) return;
  const query = this.searchInput.value.trim();
  if (query === '') { toast('검색어를 입력하세요'); return; }
  this.hideKeyboard();
  const session = this.activeSession;
  const source = session.officePreview == null ? session.uri : session.officePreview;
  let json;
  try { json = session.store.exportJson(session.uri, session.title); } catch (e) { return; }
  const count = session.renderer.pageCount;
  const start = Math.max(0, Math.min(count - 1, this.currentPage));
  const precise = this.searchPrecise;
  if (this.searchCanceled) this.searchCanceled.value = true;
  const cancel = { value: false }; this.searchCanceled = cancel;
  const token = ++this.searchSession; this.searchOwner = session;
  this.searchHits = []; this.searchCurrent = -1; this.searchList.textContent = ''; this.searchScroll.style.display = 'none';
  this.searching = true; this.searchDone = 0; this.searchTotal = count; this.searchTruncated = false;
  this.applySearchHighlights(); this.updateSearchStatus();
  try {
    const snapshot = new AnnotationStore(); snapshot.importJson(json, count);
    const truncated = await Search.scan(session.renderer, source, snapshot, count, start, query, precise, cancel, {
      progress: (done, total) => { if (token !== this.searchSession) return; this.searchDone = done; this.searchTotal = total; this.updateSearchStatus(); },
      hits: batch => { if (token === this.searchSession) this.addSearchHits([...batch]); },
      warning: msg => { if (token === this.searchSession) toast(msg); },
    });
    if (token !== this.searchSession) return;
    this.searching = false; this.searchTruncated = truncated; this.updateSearchStatus();
  } catch (e) {
    if (token !== this.searchSession) return;
    this.searching = false; this.updateSearchStatus();
    if (!cancel.value) toast('검색 실패: ' + errMsg(e));
  }
};
M.addSearchHits = function (hits) {
  const first = this.searchHits.length === 0;
  for (const hit of hits) { const index = this.searchHits.length; this.searchHits.push(hit); this.searchList.append(this.hitRow(index, hit)); }
  this.searchScroll.style.display = this.searchHits.length === 0 ? 'none' : 'block';
  if (first && this.searchHits.length > 0) this.selectHit(0, false); else { this.applySearchHighlights(); this.updateSearchStatus(); }
};
M.hitRow = function (index, hit) {
  const row = h('div', { class: 'm2-hit', dataset: { tag: 'search_hit_' + index }, role: 'button', 'aria-label': '검색 결과 ' + (index + 1) });
  row.append(h('div', { class: 'm2-hit-meta' }, 'p.' + (hit.page + 1) + ' · ' + hit.kind));
  const t = hit.text == null ? '' : hit.text;
  const text = h('div', { class: 'm2-hit-text' });
  if (hit.matchStart >= 0 && hit.matchEnd > hit.matchStart && hit.matchEnd <= t.length) {
    text.append(t.substring(0, hit.matchStart), h('span', { class: 'm2-hit-mark' }, t.substring(hit.matchStart, hit.matchEnd)), t.substring(hit.matchEnd));
  } else text.textContent = t;
  row.append(text);
  row.addEventListener('click', () => { this.hideKeyboard(); this.selectHit(index, true); });
  return row;
};
/** Jumps to one result without touching the result list, so the others stay one tap away. */
M.selectHit = async function (index, scrollToRow) {
  if (index < 0 || index >= this.searchHits.length || !this.activeSession) return;
  this.searchCurrent = index; const hit = this.searchHits[index];
  if (hit.page !== this.currentPage || !this.viewForPage(hit.page)) await this.showPage(hit.page);
  if (this.searchCurrent !== index) return;
  this.applySearchHighlights(); this.updateSearchStatus();
  [...this.searchList.children].forEach((row, i) => { row.style.background = i === index ? '#E5E5EA' : 'transparent'; });
  const row = this.searchList.children[index];
  if (scrollToRow && row) this.searchScroll.scrollTo({ top: Math.max(0, row.offsetTop - 8), behavior: 'smooth' });
  await nextFrame();
  const target = this.viewForPage(hit.page); if (target && this.searchCurrent === index) target.focusOnPoint(hit.x, hit.y);
};
M.stepSearch = function (direction) {
  if (this.searchHits.length === 0) { if (this.searchInput.value.trim().length > 0 && !this.searching) this.startSearch(); return; }
  const n = this.searchHits.length;
  const next = this.searchCurrent < 0 ? (direction > 0 ? 0 : n - 1) : (this.searchCurrent + direction + n) % n;
  this.selectHit(next, true);
};
M.applySearchHighlights = function () {
  for (const view of [this.firstPageView, this.secondPageView]) {
    if (!view) continue;
    if (this.searchHits.length === 0 || !this.searchPanel || this.searchPanel.style.display === 'none') { view.clearSearchHighlights(); continue; }
    const others = []; let current = null;
    this.searchHits.forEach((hit, i) => { if (hit.page !== view.getPageNumber()) return; if (i === this.searchCurrent) current = hit.box; else others.push(hit.box); });
    view.setSearchHighlights(view.getPageNumber(), others, current);
  }
};
M.updateSearchStatus = function () {
  if (!this.searchStatus) return;
  let text;
  if (this.searching) text = '검색 중 ' + this.searchDone + '/' + this.searchTotal + '쪽 · 결과 ' + this.searchHits.length + '개';
  else if (this.searchHits.length === 0) text = this.searchOwner == null ? 'Enter를 누르면 본문·필기·메모를 검색합니다' : '결과가 없습니다' + (this.searchPrecise ? '' : ' · 손글씨·스캔은 ‘정밀(OCR)’로 다시 찾아보세요');
  else text = '결과 ' + this.searchHits.length + '개' + (this.searchTruncated ? '+ (상위 ' + Search.MAX_HITS + '개만 표시)' : '') + (this.searchCurrent >= 0 ? ' · ' + (this.searchCurrent + 1) + '번째' : '');
  this.searchStatus.textContent = text;
};
M.closeSearch = function () {
  if (this.searchCanceled) this.searchCanceled.value = true;
  ++this.searchSession; this.searching = false; this.searchOwner = null;
  this.searchHits = []; this.searchCurrent = -1;
  if (this.searchList) this.searchList.textContent = '';
  if (this.searchScroll) this.searchScroll.style.display = 'none';
  if (this.searchPanel) { this.hideKeyboard(); this.searchPanel.style.display = 'none'; if (this.sidebarVisible && this.panelTab === 0) this.selectPanelTab(1); }
  this.updateSearchStatus(); this.applySearchHighlights();
};

// ---- fallbacks for helpers that normally live in other parts of MainActivity -------------------------------------------------------------------------
F.viewForPage = function (page) {
  const vis = v => v && v.el && v.el.offsetParent !== null;
  if (this.firstPageView && vis(this.firstPageView) && this.firstPageView.getPageNumber() === page) return this.firstPageView;
  if (this.secondPageView && vis(this.secondPageView) && this.secondPageView.getPageNumber() === page) return this.secondPageView;
  return null;
};
F.redrawPages = function () { for (const v of this.allPageViews()) v.invalidate(); };
F.updateThumbnailSelection = function () {
  if (!this.thumbnailList) return;
  let selected = null;
  for (const v of this.thumbnailList.children) {
    if (v.dataset.page == null) continue;
    const on = +v.dataset.page === this.currentPage;
    v.style.background = on ? '#E5F0FF' : 'transparent'; v.style.boxShadow = on ? 'inset 0 0 0 2px #007AFF' : 'none'; if (on) selected = v;
  }
  if (this.sidebarVisible && selected) this.thumbnailPanel.scrollTo({ top: Math.max(0, selected.offsetTop - 16), behavior: 'smooth' });
};

// ---- v3: print / offline notes (implemented in print.js, offline.js) ---------------------------------------------------------
M.printDocument = function () { return printDocument(this); };

// ---- whole-library backup / restore, app info and update check (Android v1.36.0 parity) ---------------------------------------------------------
M.backupEnv = function () {
  const env = this.syncEnv();
  return { library: this.library, version: this.appVersion(), exportNote: env.exportNote, isOpenPath: async p => this.sessions.some(s => samePath(s.uri, p)) };
};
M.startLibraryBackup = async function () {
  try {
    if (typeof this.commitInlineText === 'function') this.commitInlineText();
    const d = new Date(), z = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`;
    const out = await host.saveDialog('모든 문서 백업', `Everynote-백업-${stamp}.zip`, [{ name: 'Everynote 백업', exts: ['zip'] }]);
    if (!out) return;
    const progress = ProgressDialog.show('전체 백업', '문서와 필기를 모으는 중… 잠시 기다려 주세요');
    try {
      const n = await createBackup(this.backupEnv(), out); progress.dismiss();
      alertCard({ title: '백업 완료', message: `문서 ${n}개 (필기·사진·녹음·동영상 포함)\n${out}`, positive: ['확인'], neutral: ['폴더 열기', () => host.reveal(out).catch(() => {})] });
    } catch (e) { progress.dismiss(); toast('백업 실패: ' + errMsg(e)); }
  } catch (e) { toast('백업 실패: ' + errMsg(e)); }
};
M.startLibraryRestore = async function () {
  try {
    const picked = await host.openDialog('모든 문서 복원', [{ name: 'Everynote 백업', exts: ['zip'] }], false);
    if (!picked || !picked.length) return;
    const zip = picked[0];
    const run = async overwrite => {
      const progress = ProgressDialog.show('복원', '문서와 필기를 복원하는 중… 잠시 기다려 주세요');
      try {
        const r = await restoreBackup(this.backupEnv(), zip, overwrite); progress.dismiss();
        alertCard({ title: '복원 완료', message: `문서 ${r.documents}개 · 필기 ${r.notes}개 · 첨부 ${r.assets}개 · 폴더 ${r.folders}개` + (r.skipped ? `\n열려 있어 건너뜀 ${r.skipped}개` : '') + (r.failed ? `\n실패 ${r.failed}개` : ''), positive: ['확인'] });
      } catch (e) { progress.dismiss(); toast('복원 실패: ' + errMsg(e)); }
    };
    alertCard({
      title: '모든 문서 복원',
      message: '백업의 문서·필기·사진·녹음·동영상을 문서함으로 복원합니다.\n\n• 추가 복원: 기존 문서는 그대로 두고, 같은 이름은 사본 (1)로 추가\n• 덮어쓰기: 같은 위치·이름의 문서를 백업 내용으로 교체 (열려 있는 문서는 건너뜀)',
      positive: ['추가 복원', () => run(false)], neutral: ['덮어쓰기', () => run(true)], negative: ['취소'],
    });
  } catch (e) { toast('복원 실패: ' + errMsg(e)); }
};
const RELEASES_URL = 'https://github.com/hdlee73/Everynote_Win/releases';
M.pendingUpdateVersion = function () {
  const v = this.recentPrefs.getString('update_version', '');
  return v && compareVersions(v, this.appVersion()) > 0 ? v : null;
};
M.showAbout = function () {
  const info = h('div', { class: 'm2-about', dataset: { tag: 'about_info' } }, h('div', { class: 'm2-about-name' }, 'Everynote'), h('div', null, '버전 ' + this.appVersion()), h('div', { class: 'm2-about-by' }, AUTHOR_LINE));
  const releaseLink = h('a', { class: 'm2-about-link', href: RELEASES_URL, dataset: { tag: 'about_releases' } }, '업데이트 정보 (GitHub 릴리스 페이지)');
  releaseLink.addEventListener('click', e => { e.preventDefault(); host.shellOpen(RELEASES_URL).catch(() => toast('브라우저를 열 수 없습니다')); });
  const status = h('div', { class: 'm2-about-status', dataset: { tag: 'update_status' } });
  const waiting = this.pendingUpdateVersion();
  if (waiting) { status.textContent = '새 버전 v' + waiting + ' 이(가) 있습니다. 아래 ‘업데이트 확인’을 누르세요'; status.classList.add('m2-about-new'); }
  const mk = (key, dflt, label, tag) => {
    const box = h('input', { type: 'checkbox', dataset: { tag } }); box.checked = this.recentPrefs.getBoolean(key, dflt);
    box.addEventListener('change', () => this.recentPrefs.putBoolean(key, box.checked));
    return h('label', { class: 'm2-about-check' }, box, h('span', null, label));
  };
  const view = h('div', null, info, releaseLink, status, mk('auto_update_check', true, '앱을 열 때 새 버전 자동 확인', 'auto_update'),
    mk('auto_update_install', false, '새 버전이 있으면 확인 없이 자동으로 설치', 'auto_update_install'));
  const dlg = new AlertDialog.Builder().setTitle('앱 정보').setView(view).setPositiveButton('업데이트 확인', null).setNegativeButton('닫기', null).show();
  rebindButton(dlg, BUTTON_POSITIVE, () => this.checkForUpdate(true, status));
};
M.checkForUpdate = async function (manual, status) {
  const say = t => { if (status) status.textContent = t; else if (manual) toast(t); };
  say('확인 중…');
  let r;
  try { r = await host.updateCheck(); } catch (e) { say('업데이트를 확인하지 못했습니다 (' + errMsg(e) + ')'); return; }
  const newer = compareVersions(r.version, this.appVersion()) > 0;
  this.recentPrefs.putString('update_version', newer ? r.version : '');
  if (!newer) { say('최신 버전입니다 (v' + this.appVersion() + ')'); return; }
  say('새 버전 v' + r.version + ' 이(가) 있습니다'); if (status) status.classList.add('m2-about-new');
  if (!manual && !status) { if (this.recentPrefs.getString('update_notified', '') === r.version) return; this.recentPrefs.putString('update_notified', r.version); }
  const direct = !!(r.installed && r.setupUrl);
  const install = async () => {
    const progress = ProgressDialog.show('업데이트', '새 버전을 내려받는 중… 완료되면 설치 프로그램이 앱을 닫고 업데이트합니다');
    try { await host.updateInstall(r.setupUrl); } catch (e) { progress.dismiss(); toast('업데이트 실패: ' + errMsg(e)); }
  };
  if (!manual && direct && this.recentPrefs.getBoolean('auto_update_install', false)) { install(); return; }
  let notes = (r.notes || '').trim(); if (notes.length > 500) notes = notes.slice(0, 500) + '…';
  alertCard({
    title: '새 버전 v' + r.version,
    message: '현재 v' + this.appVersion() + (notes ? '\n\n' + notes : '') + '\n\n' + (direct ? '업데이트하면 설치 프로그램이 앱을 닫고 새 버전으로 바꿉니다. 문서와 필기는 그대로 유지됩니다.' : '내려받기 페이지를 엽니다.'),
    positive: [direct ? '업데이트' : '내려받기', () => { if (direct) install(); else host.shellOpen(r.exeUrl || r.page).catch(() => {}); }], negative: ['나중에'],
  });
};
M.autoCheckForUpdate = function () {
  if (!host.native || !this.recentPrefs.getBoolean('auto_update_check', true)) return;
  const now = Date.now(); if (now - (this.recentPrefs.getFloat('update_checked', 0) || 0) < 6 * 3600 * 1000) return;
  this.recentPrefs.putFloat('update_checked', now); this.checkForUpdate(false, null);
};
M.showAboutOffline = function () { return showAboutOffline(this); };

// ====================================================================================================================
// install
// ====================================================================================================================
export function initMain2(app) {
  app.dropTarget = null; app.dropTime = 0; app.placementText = ''; app.placementRot = 0; app.exportOriginalSource = null;
  app.placementKind = app.placementKind || ''; app.placementAsset = app.placementAsset || '';
  app.pendingJsonExport = null; app.pendingExport = null; app.exportSource = null; app.exportSnapshot = null; app.exportPageCount = 0;
  app.importTarget = null; app.importSession = null; app.searchCanceled = null;
  app.studyPanel = null; app.studyRows = null; app.studyHeading = null;
  app.sidePanel = null; app.searchPanel = null; app.searchInput = null; app.searchStatus = null; app.searchList = null; app.searchScroll = null;
  app.outlineList = null; app.recordingList = null; app.insertList = null; app.sideTabs = []; app._thumbAspectCache = null;
  app.showAllThumbnails = app.recentPrefs.getBoolean('thumb_all', true);
  document.addEventListener('paste', e => app.onPasteEvent(e));
  window.addEventListener('resize', () => {
    if (app.studySplit) { const wide = window.innerWidth >= 600; app.studySplit.style.flexDirection = wide ? 'row' : 'column'; if (app.applyStudySize) app.applyStudySize(); }
    if (app.sidePanel && app.sidebarVisible && !app.sideSplitter?.classList.contains('drag')) app.sidePanel.style.width = app.sidePanelWidth() + 'px';
  });
}
export function installMain2(cls) {
  Object.assign(cls.prototype, M);
  for (const k of Object.keys(F)) if (!Object.prototype.hasOwnProperty.call(cls.prototype, k)) cls.prototype[k] = F[k];
  Object.assign(cls, { Section, Tile, CATEGORY_TITLES, INK_COLORS, INK_WIDTHS, HIGHLIGHT_COLORS, TEXT_COLORS, FONT_IDS, FONT_NAMES, TEXT_PAGE_POINTS, PAPER_COLORS, SIDE_TITLES, SIDE_ICONS, STICKER_GROUPS, STICKER_TITLES, youtubeId });
  for (const k of ['CATEGORY_TITLES', 'INK_COLORS', 'INK_WIDTHS', 'HIGHLIGHT_COLORS', 'TEXT_COLORS', 'FONT_IDS', 'FONT_NAMES', 'TEXT_PAGE_POINTS', 'PAPER_COLORS', 'SIDE_TITLES', 'SIDE_ICONS'])
    if (!(k in cls.prototype)) cls.prototype[k] = cls[k];
}
