// Samsung Notes style popovers (rounded light card, dashed dividers) and the two-column number wheel used by 표 설정.
import { h, icon } from './util.js';

let lastPointer = { x: 200, y: 200 };
if (typeof document !== 'undefined') document.addEventListener('pointerdown', e => { lastPointer = { x: e.clientX, y: e.clientY }; }, true);
export const pointerPosition = () => lastPointer;

let open = null;
export function dismissPopover() { if (open) { const o = open; open = null; o.scrim.remove(); } }

/** Shows `content` in a card next to (x, y) (default: the last pointer position), kept inside the window. Returns { dismiss, el }. */
export function showPopover(content, { x = lastPointer.x, y = lastPointer.y, width = 224, tag = '' } = {}) {
  dismissPopover();
  const card = h('div', { class: 'sx-pop', role: 'menu', style: { width: width + 'px' }, dataset: tag ? { tag } : {} }, content);
  const scrim = h('div', { class: 'sx-scrim' }, card);
  scrim.addEventListener('pointerdown', e => { if (e.target === scrim) { e.preventDefault(); e.stopPropagation(); dismissPopover(); } });
  scrim.addEventListener('contextmenu', e => { e.preventDefault(); dismissPopover(); });
  document.body.append(scrim);
  const place = () => {
    const w = card.offsetWidth, hh = card.offsetHeight, W = window.innerWidth, H = window.innerHeight;
    let left = x - w / 2, top = y + 12;
    if (top + hh > H - 8) top = Math.max(8, y - hh - 12);
    left = Math.max(8, Math.min(W - w - 8, left)); top = Math.max(8, Math.min(H - hh - 8, top));
    card.style.left = left + 'px'; card.style.top = top + 'px';
  };
  place();
  const handle = { el: card, dismiss: dismissPopover };
  open = { scrim };
  document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { dismissPopover(); document.removeEventListener('keydown', esc); } });
  return handle;
}

export const sxTitle = text => h('div', { class: 'sx-title' }, text);
export const sxDivider = () => h('div', { class: 'sx-div' });
export function sxRow(label, iconName, action, { danger = false } = {}) {
  const r = h('div', { class: 'sx-row' + (danger ? ' danger' : ''), role: 'menuitem', tabindex: '0' }, iconName ? icon(iconName, 20, 'currentColor') : null, h('span', null, label));
  r.addEventListener('click', () => { dismissPopover(); action(); });
  r.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); r.click(); } });
  return r;
}
/** items: [{ icon, label, action, disabled }]; an item null draws a thin separator. */
export function sxIconRow(items) {
  const row = h('div', { class: 'sx-icons' });
  for (const it of items) {
    if (!it) { row.append(h('div', { class: 'sx-vsep' })); continue; }
    const b = h('button', { class: 'sx-ib', type: 'button', title: it.label, 'aria-label': it.label }, icon(it.icon, 20, 'currentColor'));
    if (it.disabled) b.disabled = true; else b.addEventListener('click', () => { dismissPopover(); it.action(); });
    row.append(b);
  }
  return row;
}
/** colors: ARGB ints; current: selected ARGB (or null). */
export function sxSwatches(colors, current, pick) {
  const row = h('div', { class: 'sx-swatches' });
  for (const c of colors) {
    const argb = c >>> 0, css = `rgb(${(argb >> 16) & 255},${(argb >> 8) & 255},${argb & 255})`;
    const b = h('button', { class: 'sx-sw', type: 'button', style: { background: css }, 'aria-label': '배경 색상 ' + css, title: css });
    if (current != null && (current | 0) === (c | 0)) b.append(icon('ic_check', 14, '#3A3A3D'));
    b.addEventListener('click', () => { dismissPopover(); pick(c); });
    row.append(b);
  }
  return row;
}

/** Vertical wheel for one number: shows the previous / current / next value; mouse wheel, arrow keys, click on a neighbour or drag change it. */
export function numberWheel(min, max, value) {
  let v = Math.max(min, Math.min(max, value));
  const cell = cls => h('div', { class: 'sx-wv ' + cls });
  const a = cell('far'), b = cell('near'), c = cell('cur'), d = cell('near'), e = cell('far');
  const el = h('div', { class: 'sx-wheel', tabindex: '0', role: 'spinbutton', 'aria-valuemin': String(min), 'aria-valuemax': String(max) }, a, b, c, d, e);
  const draw = () => {
    [[a, -2], [b, -1], [c, 0], [d, 1], [e, 2]].forEach(([n, k]) => { const x = v + k; n.textContent = x >= min && x <= max ? String(x) : ''; });
    el.setAttribute('aria-valuenow', String(v));
  };
  const set = n => { v = Math.max(min, Math.min(max, n)); draw(); };
  el.addEventListener('wheel', ev => { ev.preventDefault(); set(v + (ev.deltaY > 0 ? 1 : -1)); }, { passive: false });
  el.addEventListener('keydown', ev => { if (ev.key === 'ArrowUp') { ev.preventDefault(); set(v - 1); } else if (ev.key === 'ArrowDown') { ev.preventDefault(); set(v + 1); } });
  b.addEventListener('click', () => set(v - 1)); d.addEventListener('click', () => set(v + 1));
  a.addEventListener('click', () => set(v - 2)); e.addEventListener('click', () => set(v + 2));
  let y0 = null, v0 = v;
  el.addEventListener('pointerdown', ev => { y0 = ev.clientY; v0 = v; });
  el.addEventListener('pointermove', ev => { if (y0 == null) return; if (Math.abs(ev.clientY - y0) > 6 && !el.hasPointerCapture(ev.pointerId)) el.setPointerCapture(ev.pointerId); const steps = Math.round((y0 - ev.clientY) / 28); if (v0 + steps !== v) set(v0 + steps); });
  const end = () => { y0 = null; }; el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  draw();
  el.value = () => v;
  return el;
}
