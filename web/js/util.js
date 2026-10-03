// Shared helpers. Conventions: 1 Android dp == 1 CSS px. Java ARGB ints are kept as numbers in data
// (so Android backup JSON stays compatible) and converted for CSS with argb().
import { ICONS } from './icons.js';

/** hyperscript: h('div', {class:'x', style:{color:'red'}, onclick:fn, dataset:{a:1}}, child, 'text', ...) */
export function h(tag, props, ...children) {
  const el = tag.startsWith('svg:') ? document.createElementNS('http://www.w3.org/2000/svg', tag.slice(4)) : document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') { if (typeof v === 'string') el.style.cssText = v; else Object.assign(el.style, v); }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Inline 24x24 stroke icon (Android vector drawable port). size in px, color any CSS colour. */
export function icon(name, size = 24, color = 'currentColor', extraStyle = '') {
  const inner = ICONS[name];
  if (!inner) throw new Error('unknown icon ' + name);
  const wrap = document.createElement('span');
  wrap.className = 'ico';
  wrap.style.cssText = `display:inline-flex;width:${size}px;height:${size}px;color:${color};flex:none;${extraStyle}`;
  wrap.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  return wrap;
}
export function setIcon(el, name) { // replace glyph inside an .ico span
  el.querySelector('svg').innerHTML = ICONS[name];
}

/** Java ARGB int (signed or unsigned) -> css rgba() string. */
export function argb(c) {
  c = c >>> 0;
  const a = (c >>> 24) & 255, r = (c >>> 16) & 255, g = (c >>> 8) & 255, b = c & 255;
  return a === 255 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${+(a / 255).toFixed(4)})`;
}
export function hex6(c) { return '#' + ((c >>> 0) & 0xffffff).toString(16).padStart(6, '0'); }
export function alphaOf(c) { return ((c >>> 24) & 255) / 255; }
export function withAlpha(c, a255) { return ((a255 & 255) << 24 | (c & 0xffffff)) >>> 0; }

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
export const isMac = false;

export function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/-/g, ''); }

/** Rect helper mirroring android.graphics.RectF (normalized or pixel). */
export class RectF {
  constructor(l = 0, t = 0, r = 0, b = 0) { this.left = l; this.top = t; this.right = r; this.bottom = b; }
  static from(o) { return new RectF(o.left, o.top, o.right, o.bottom); }
  width() { return this.right - this.left; }
  height() { return this.bottom - this.top; }
  centerX() { return (this.left + this.right) / 2; }
  centerY() { return (this.top + this.bottom) / 2; }
  isEmpty() { return this.left >= this.right || this.top >= this.bottom; }
  set(r) { this.left = r.left; this.top = r.top; this.right = r.right; this.bottom = r.bottom; return this; }
  copy() { return new RectF(this.left, this.top, this.right, this.bottom); }
  contains(x, y) { return x >= this.left && x < this.right && y >= this.top && y < this.bottom; }
  union(r) {
    if (r.isEmpty()) return this;
    if (this.isEmpty()) return this.set(r);
    this.left = Math.min(this.left, r.left); this.top = Math.min(this.top, r.top);
    this.right = Math.max(this.right, r.right); this.bottom = Math.max(this.bottom, r.bottom); return this;
  }
  intersect(r) {
    if (this.left < r.right && r.left < this.right && this.top < r.bottom && r.top < this.bottom) {
      this.left = Math.max(this.left, r.left); this.top = Math.max(this.top, r.top);
      this.right = Math.min(this.right, r.right); this.bottom = Math.min(this.bottom, r.bottom); return true;
    }
    return false;
  }
  static intersects(a, b) { return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; }
  offset(dx, dy) { this.left += dx; this.right += dx; this.top += dy; this.bottom += dy; return this; }
  inset(dx, dy) { this.left += dx; this.right -= dx; this.top += dy; this.bottom -= dy; return this; }
  equals(o) { return !!o && o.left === this.left && o.top === this.top && o.right === this.right && o.bottom === this.bottom; }
}

export function fmtDate(ms) {
  const d = new Date(ms); const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function baseName(path) { return path.replace(/\\/g, '/').split('/').pop(); }
export function dirName(path) { const p = path.replace(/\\/g, '/'); const i = p.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i); }
export function joinPath(...parts) {
  return parts.filter(Boolean).map((p, i) => i === 0 ? p.replace(/[\\/]+$/, '') : p.replace(/^[\\/]+|[\\/]+$/g, '')).join('\\');
}
export function stripExt(name) { return name.replace(/\.[^.]*$/, ''); }
