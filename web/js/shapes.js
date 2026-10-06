// Port of Shapes.java: drawing shapes and tables placed on a page.
// Shape text: "kind|STROKE|FILL|width" (colors as 8 hex digits AARRGGBB).
// Table text: "rows,cols,LINE,HEAD,FILL" then one line per cell (row-major), then an optional "~" line with a per-cell background (8 hex digits, empty = none).
import { RectF, argb } from './util.js';
import { AnnotationPainter, Typeface } from './painter.js';

export const KINDS = ['rect', 'round', 'oval', 'triangle', 'diamond', 'star', 'heart', 'line', 'arrow'];
export const NAMES = ['사각형', '둥근 사각형', '원', '삼각형', '마름모', '별', '하트', '선', '화살표'];
const SHAPE_RE = /^(rect|round|oval|triangle|diamond|star|heart|line|arrow)\|[0-9A-F]{8}\|[0-9A-F]{8}\|[0-9]{1,2}$/;
const TABLE_HEADER_RE = /^[0-9]{1,2},[0-9]{1,2},[0-9A-F]{8},[0-9A-F]{8},[0-9A-F]{8}$/;

const alphaOf = c => (c >>> 24) & 255;

function rr(c, x, y, w, h, rx, ry) {
  const k = Math.min(1, w / (2 * rx || 1), h / (2 * ry || 1));
  rx *= k; ry *= k;
  c.moveTo(x + rx, y);
  c.lineTo(x + w - rx, y); c.ellipse(x + w - rx, y + ry, rx, ry, 0, -Math.PI / 2, 0);
  c.lineTo(x + w, y + h - ry); c.ellipse(x + w - rx, y + h - ry, rx, ry, 0, 0, Math.PI / 2);
  c.lineTo(x + rx, y + h); c.ellipse(x + rx, y + h - ry, rx, ry, 0, Math.PI / 2, Math.PI);
  c.lineTo(x, y + ry); c.ellipse(x + rx, y + ry, rx, ry, 0, Math.PI, Math.PI * 1.5);
  c.closePath();
}

export class Table {
  constructor() { this.rows = 3; this.cols = 3; this.line = 0xFF3A3A3C | 0; this.head = 0xFFE5F0FF | 0; this.fill = 0x00FFFFFF; this.cells = []; this.bg = []; }

  static parse(text) {
    const t = new Table();
    if (!Shapes.validTable(text)) { t.cells = new Array(9).fill(''); t.bg = new Array(9).fill(0); return t; }
    const lines = text.split('\n'), p = lines[0].split(',');
    t.rows = parseInt(p[0], 10); t.cols = parseInt(p[1], 10);
    t.line = Shapes.parseColor(p[2]); t.head = Shapes.parseColor(p[3]); t.fill = Shapes.parseColor(p[4]);
    t.cells = new Array(t.rows * t.cols);
    for (let i = 0; i < t.cells.length; i++) t.cells[i] = i + 1 < lines.length ? lines[i + 1] : '';
    t.bg = new Array(t.cells.length).fill(0);
    const colorLine = t.cells.length + 1;
    if (colorLine < lines.length && lines[colorLine].startsWith('~')) {
      const parts = lines[colorLine].substring(1).split(',');
      for (let i = 0; i < t.bg.length && i < parts.length; i++) if (/^[0-9A-F]{8}$/.test(parts[i])) t.bg[i] = Shapes.parseColor(parts[i]);
    }
    return t;
  }

  static create(rows, cols, line, head, fill) {
    const t = new Table();
    t.rows = rows; t.cols = cols; t.line = line | 0; t.head = head | 0; t.fill = fill | 0;
    t.cells = new Array(rows * cols).fill('');
    t.bg = new Array(rows * cols).fill(0);
    return t;
  }

  /** Keeps existing cell text when the grid size changes. */
  resized(newRows, newCols) {
    const t = Table.create(newRows, newCols, this.line, this.head, this.fill);
    for (let r = 0; r < Math.min(this.rows, newRows); r++)
      for (let c = 0; c < Math.min(this.cols, newCols); c++) { t.cells[r * newCols + c] = this.cells[r * this.cols + c]; t.bg[r * newCols + c] = this.bg[r * this.cols + c]; }
    return t;
  }

  serialize() {
    let s = `${this.rows},${this.cols},${Shapes.hex(this.line)},${Shapes.hex(this.head)},${Shapes.hex(this.fill)}`;
    for (const cell of this.cells) s += '\n' + (cell == null ? '' : String(cell).replace(/[\n\r]/g, ' '));
    const bg = this.bg || []; if (bg.some(color => alphaOf(color) !== 0)) s += '\n~' + bg.map(color => (alphaOf(color) !== 0 ? Shapes.hex(color) : '')).join(',');
    return s;
  }
}

export class Shapes {
  static KINDS = KINDS;
  static NAMES = NAMES;
  static SHAPE_PATTERN = SHAPE_RE;
  static TABLE_HEADER = TABLE_HEADER_RE;
  static Table = Table;

  /** 8 upper-case hex digits AARRGGBB of a (signed or unsigned) ARGB int. */
  static hex(color) { return (color >>> 0).toString(16).toUpperCase().padStart(8, '0'); }
  static shapeSpec(kind, stroke, fill, width) { return `${kind}|${Shapes.hex(stroke)}|${Shapes.hex(fill)}|${width}`; }
  static validShape(text) { return typeof text === 'string' && SHAPE_RE.test(text); }
  static validTable(text) {
    if (typeof text !== 'string' || text.length > 30000) return false;
    const head = text.split('\n')[0];
    if (!TABLE_HEADER_RE.test(head)) return false;
    const p = head.split(','), r = parseInt(p[0], 10), c = parseInt(p[1], 10);
    return r >= 1 && r <= 30 && c >= 1 && c <= 12;
  }
  /** Long.parseLong(hex,16) cast to int. */
  static parseColor(hex) { return Number(BigInt.asIntN(32, BigInt('0x' + hex))); }

  /** c: CanvasRenderingContext2D, b: RectF (px), spec: shape text, pageWidth: page width in px. */
  static drawShape(c, b, spec, pageWidth) {
    if (!Shapes.validShape(spec)) return;
    b = RectF.from(b);
    const p = spec.split('|');
    const stroke = AnnotationPainter.adj(Shapes.parseColor(p[1])), fill = Shapes.parseColor(p[2]);
    const width = Math.max(1, parseInt(p[3], 10) * pageWidth * .0016);
    const r = b.copy(); r.inset(width / 2, width / 2);
    if (r.width() <= 0 || r.height() <= 0) return;
    const kind = p[0];
    c.save();
    try {
      c.lineJoin = 'round'; c.lineCap = 'round';
      if (kind === 'line' || kind === 'arrow') {
        c.lineWidth = width; c.strokeStyle = argb(stroke);
        const y = b.centerY();
        c.beginPath(); c.moveTo(b.left + width, y); c.lineTo(b.right - width, y); c.stroke();
        if (kind === 'arrow') {
          const head = Math.min(b.width() * .4, Math.max(width * 4, b.height() * .9));
          c.beginPath();
          c.moveTo(b.right - head, y - head * .55); c.lineTo(b.right - width, y); c.lineTo(b.right - head, y + head * .55);
          c.stroke();
        }
        return;
      }
      c.beginPath();
      switch (kind) {
        case 'round': { const k = Math.min(r.width(), r.height()) * .22; rr(c, r.left, r.top, r.width(), r.height(), k, k); break; }
        case 'oval': c.ellipse(r.centerX(), r.centerY(), r.width() / 2, r.height() / 2, 0, 0, Math.PI * 2); c.closePath(); break;
        case 'triangle': c.moveTo(r.centerX(), r.top); c.lineTo(r.right, r.bottom); c.lineTo(r.left, r.bottom); c.closePath(); break;
        case 'diamond': c.moveTo(r.centerX(), r.top); c.lineTo(r.right, r.centerY()); c.lineTo(r.centerX(), r.bottom); c.lineTo(r.left, r.centerY()); c.closePath(); break;
        case 'star':
          for (let i = 0; i < 10; i++) {
            const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 === 0 ? 1 : .42;
            const ux = Math.cos(a) * rad, uy = Math.sin(a) * rad;
            const x = r.left + (ux + .951) / 1.902 * r.width(), y = r.top + (uy + 1) / 1.809 * r.height();
            if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
          }
          c.closePath(); break;
        case 'heart': {
          const w = r.width(), h = r.height(), x = r.left, y = r.top;
          c.moveTo(x + w * .5, y + h);
          c.bezierCurveTo(x - w * .1, y + h * .62, x + w * .02, y - h * .08, x + w * .5, y + h * .28);
          c.bezierCurveTo(x + w * .98, y - h * .08, x + w * 1.1, y + h * .62, x + w * .5, y + h);
          c.closePath(); break;
        }
        default: c.rect(r.left, r.top, r.width(), r.height());
      }
      if (alphaOf(fill) > 0) { c.fillStyle = argb(fill); c.fill(); }
      if (alphaOf(stroke) > 0) { c.lineWidth = width; c.strokeStyle = argb(stroke); c.stroke(); }
    } finally { c.restore(); }
  }

  static drawTable(c, b, text, pageWidth) {
    const t = Table.parse(text);
    b = RectF.from(b);
    const cw = b.width() / t.cols, ch = b.height() / t.rows;
    c.save();
    try {
      if (alphaOf(t.fill) > 0) { c.fillStyle = argb(t.fill); c.fillRect(b.left, b.top, b.width(), b.height()); }
      if (alphaOf(t.head) > 0) { c.fillStyle = argb(t.head); c.fillRect(b.left, b.top, b.width(), ch); }
      for (let r = 0; r < t.rows; r++) for (let col = 0; col < t.cols; col++) {
        const color = t.bg[r * t.cols + col];
        if (alphaOf(color) === 0) continue;
        c.fillStyle = argb(color); c.fillRect(b.left + col * cw, b.top + r * ch, cw, ch);
      }
      const width = Math.max(1, pageWidth * .0022);
      c.lineWidth = width; c.strokeStyle = argb(AnnotationPainter.adj(t.line)); c.lineCap = 'butt'; c.lineJoin = 'miter';
      c.strokeRect(b.left, b.top, b.width(), b.height());
      c.beginPath();
      for (let i = 1; i < t.rows; i++) { c.moveTo(b.left, b.top + i * ch); c.lineTo(b.right, b.top + i * ch); }
      for (let j = 1; j < t.cols; j++) { c.moveTo(b.left + j * cw, b.top); c.lineTo(b.left + j * cw, b.bottom); }
      c.stroke();
      const size = Math.max(6, Math.min(ch * .46, pageWidth * .03));
      c.textAlign = 'left'; c.textBaseline = 'alphabetic';
      const fm = Typeface.DEFAULT.metrics(c, size);
      const headLit = alphaOf(t.head) > 0, fillLit = alphaOf(t.fill) > 0;
      for (let r = 0; r < t.rows; r++) for (let col = 0; col < t.cols; col++) {
        const s = t.cells[r * t.cols + col];
        if (s == null || s === '') continue;
        const avail = cw - size * .6;
        if (avail <= 0) continue;
        const bold = r === 0 && headLit;
        c.font = Typeface.DEFAULT.css(size, bold);
        const shown = AnnotationPainter.ellipsize(c, s, avail);
        const cellBg = t.bg[r * t.cols + col], cellLit = alphaOf(cellBg) > 0;
        const dark = cellLit && (0.299 * ((cellBg >> 16) & 255) + 0.587 * ((cellBg >> 8) & 255) + 0.114 * (cellBg & 255)) < 110;
        const lit = cellLit || (r === 0 && headLit) || (r > 0 && fillLit);
        c.fillStyle = argb(dark ? 0xFFFFFFFF : lit ? 0xFF1C1C1E : AnnotationPainter.adj(0xFF1C1C1E));
        c.fillText(shown, b.left + col * cw + size * .3, b.top + r * ch + ch / 2 - (fm.ascent + fm.descent) / 2);
      }
    } finally { c.restore(); }
  }
}
