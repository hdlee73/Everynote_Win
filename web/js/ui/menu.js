// Port of AnchoredMenu.java: floating card anchored above/below a button.
import { h, icon } from '../util.js';

export const INK = '#1C1C1E', ACCENT = '#007AFF', GRAY = '#8E8E93', LINE = '#E5E5EA', RED = '#FF3B30';

export class Row {
  constructor(label, iconName, action) { this.label = label; this.icon = iconName || null; this.action = action || null; this.selectedV = false; this.dangerV = false; this.submenuV = false; this.dividerV = false; this.customEl = null; this.tintV = null; }
  static divider() { const r = new Row('', null, null); r.dividerV = true; return r; }
  static custom(el) { const r = new Row('', null, null); r.customEl = el; return r; }
  tint(c) { this.tintV = c; return this; }
  selected(v = true) { this.selectedV = v; return this; }
  danger() { this.dangerV = true; return this; }
  submenu() { this.submenuV = true; return this; }
}
export class Shortcut { constructor(description, iconName, active, action) { this.description = description; this.icon = iconName; this.active = active; this.action = action; } }

let current = null;
export function dismissMenu() { if (current) { current.close(); current = null; } }

/** @param anchor HTMLElement  @param above true = above the anchor (toolbar menus), false = below, right aligned */
export function show(anchor, above, rows, shortcuts, onDismiss) {
  dismissMenu();
  const screenW = window.innerWidth, screenH = window.innerHeight;
  const card = h('div', { class: 'amenu', dataset: { tag: 'anchored_menu' } });
  const list = h('div', { class: 'amenu-list' });
  let wide = false;
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    backdrop.remove(); card.remove(); document.removeEventListener('keydown', onKey, true); if (current && current.card === card) current = null;
    if (onDismiss) onDismiss();
  };
  for (const row of rows) {
    if (row.customEl) { list.append(row.customEl); wide = true; continue; }
    if (row.dividerV) { list.append(h('div', { class: 'amenu-div' })); continue; }
    const line = h('div', { class: 'amenu-row', role: 'button', 'aria-label': row.label });
    if (row.icon) line.append(icon(row.icon, 20, row.dangerV ? RED : (row.tintV || ACCENT), 'margin-right:12px'));
    line.append(h('span', { class: 'amenu-label', style: { color: row.dangerV ? RED : row.selectedV ? ACCENT : INK, fontWeight: row.selectedV ? '700' : '400' } }, row.label));
    if (row.selectedV || row.submenuV) line.append(icon(row.submenuV ? 'ic_chevron_right' : 'ic_check_bold', row.submenuV ? 18 : 20, row.submenuV ? GRAY : ACCENT, 'margin-left:8px'));
    line.addEventListener('click', () => { close(); if (row.action) row.action(); });
    list.append(line);
  }
  card.append(h('div', { class: 'amenu-scroll' }, list));
  if (shortcuts && shortcuts.length) {
    card.append(h('div', { class: 'amenu-sdiv' }));
    const icons = h('div', { class: 'amenu-shortcuts' });
    for (const s of shortcuts) {
      const b = h('div', { class: 'amenu-sc', role: 'button', 'aria-label': s.description }, icon(s.icon, 24, s.active ? '#F5A623' : '#5856D6'));
      b.addEventListener('click', () => { close(); s.action(); });
      icons.append(b);
    }
    card.append(icons);
  }
  const w = Math.min(screenW - 24, wide ? 268 : 240);
  card.style.width = w + 'px';
  const backdrop = h('div', { class: 'amenu-backdrop' });
  backdrop.addEventListener('mousedown', close);
  backdrop.addEventListener('contextmenu', e => { e.preventDefault(); close(); });
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  card.style.visibility = 'hidden';
  document.body.append(backdrop, card);
  const hgt = card.offsetHeight;
  const r = anchor.getBoundingClientRect();
  const margin = 8, gap = 6;
  let x = above ? r.left + r.width / 2 - w / 2 : r.right - w;
  x = Math.max(margin, Math.min(screenW - w - margin, x));
  let y = above ? r.top - hgt - gap : r.bottom + gap;
  y = Math.max(margin, Math.min(screenH - hgt - margin, y));
  card.style.left = x + 'px'; card.style.top = y + 'px'; card.style.visibility = 'visible';
  card.classList.add('in');
  current = { card, close };
  return { close };
}
export const AnchoredMenu = { show, Row, Shortcut, dismiss: dismissMenu };
