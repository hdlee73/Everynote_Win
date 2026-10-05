// Port of AnchoredMenu.java: floating card anchored above/below a button.
import { h, icon } from '../util.js';

export const INK = '#1C1C1E', ACCENT = '#007AFF', GRAY = '#8E8E93', LINE = '#E5E5EA', RED = '#FF3B30';

export class Row {
  constructor(label, iconName, action) { this.label = label; this.icon = iconName || null; this.action = action || null; this.selectedV = false; this.dangerV = false; this.submenuV = false; this.dividerV = false; this.customEl = null; this.tintV = null; this.childrenV = null; }
  static divider() { const r = new Row('', null, null); r.dividerV = true; return r; }
  static custom(el) { const r = new Row('', null, null); r.customEl = el; return r; }
  tint(c) { this.tintV = c; return this; }
  selected(v = true) { this.selectedV = v; return this; }
  danger() { this.dangerV = true; return this; }
  submenu() { this.submenuV = true; return this; }
  children(rows) { this.childrenV = rows; this.submenuV = true; return this; }
  copy(action) { const r = new Row(this.label, this.icon, action); r.selectedV = this.selectedV; r.dangerV = this.dangerV; r.submenuV = this.submenuV; r.dividerV = this.dividerV; r.customEl = this.customEl; r.tintV = this.tintV; r.childrenV = this.childrenV; return r; }
}
export class Shortcut { constructor(description, iconName, active, action) { this.description = description; this.icon = iconName; this.active = active; this.action = action; } }

let current = null;
export function dismissMenu() { if (current) { current.close(); current = null; } }

/** Android v1.29.0 AnchoredMenu avoid: where the card goes so it does not cover `avoid` ({left,top,right,bottom} in viewport px):
 *  below the rect, above it, right of it, left of it - whichever fits; else docked at the screen edge that hides the least of it. Returns [x, y]. */
export function placeAvoiding(avoid, w, h, screenW, screenH, margin = 8, gap = 6, topLimit = 24) {
  const cx = (avoid.left + avoid.right) / 2, cy = (avoid.top + avoid.bottom) / 2;
  const tries = [[cx - w / 2, avoid.bottom + gap], [cx - w / 2, avoid.top - h - gap], [avoid.right + gap, cy - h / 2], [avoid.left - w - gap, cy - h / 2]];
  for (let i = 0; i < tries.length; i++) {
    const tx = Math.max(margin, Math.min(screenW - w - margin, tries[i][0])); let ty = tries[i][1];
    if (ty < topLimit || ty + h > screenH - margin) { if (i >= 2) ty = Math.max(topLimit, Math.min(screenH - h - margin, ty)); else continue; }
    if (tx + w + gap / 2 <= avoid.left || tx >= avoid.right + gap / 2 || ty + h + gap / 2 <= avoid.top || ty >= avoid.bottom + gap / 2) return [tx, ty];
  }
  const topY = topLimit, bottomY = screenH - h - margin;
  const cover = y => Math.max(0, Math.min(y + h, avoid.bottom) - Math.max(y, avoid.top));
  return [Math.max(margin, Math.min(screenW - w - margin, cx - w / 2)), cover(topY) <= cover(bottomY) ? topY : bottomY];
}

/** @param anchor HTMLElement  @param above true = above the anchor (toolbar menus), false = below, right aligned
 *  @param avoid optional {left,top,right,bottom} viewport rectangle the card must not cover (the selected text) */
export function show(anchor, above, rows, shortcuts, onDismiss, avoid, mode = 0, isChild = false, rowRect = null) {
  anchor = anchor || document.body;
  if (!isChild) dismissMenu();
  const beside = mode === 1;
  // a vertical toolbar rail (left/right/floating vertical bottom bar): menus open beside it, never on top of it
  const rail = anchor.closest ? anchor.closest('.m-bottom.vert') : null;
  const railRect = rail ? rail.getBoundingClientRect() : null;
  const railOnRight = railRect ? railRect.left + railRect.width / 2 > window.innerWidth / 2 : false;
  let childMenu = null;
  const screenW = window.innerWidth, screenH = window.innerHeight;
  const card = h('div', { class: 'amenu', dataset: { tag: 'anchored_menu' } });
  const list = h('div', { class: 'amenu-list' });
  let wide = false;
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    if (childMenu) childMenu.close(); backdrop.remove(); card.remove(); document.removeEventListener('keydown', onKey, true); if (current && current.card === card) current = null;
    if (onDismiss) onDismiss();
  };
  for (const row of rows) {
    if (row.customEl) { list.append(row.customEl); wide = true; continue; }
    if (row.dividerV) { list.append(h('div', { class: 'amenu-div' })); continue; }
    const line = h('div', { class: 'amenu-row', role: 'button', 'aria-label': row.label });
    if (row.icon) line.append(icon(row.icon, 20, row.dangerV ? RED : (row.tintV || ACCENT), 'margin-right:12px'));
    line.append(h('span', { class: 'amenu-label', style: { color: row.dangerV ? RED : row.selectedV ? ACCENT : INK, fontWeight: row.selectedV ? '700' : '400' } }, row.label));
    if (row.selectedV || row.submenuV) line.append(icon(row.submenuV ? 'ic_chevron_right' : 'ic_check_bold', row.submenuV ? 18 : 20, row.submenuV ? GRAY : ACCENT, 'margin-left:8px'));
    line.addEventListener('click', () => {
      if (row.childrenV) {
        const rr = line.getBoundingClientRect();
        if (childMenu) childMenu.close();
        const b = card.getBoundingClientRect();
        const inner = row.childrenV.map(c => (c.customEl || c.dividerV) ? c : c.copy(() => { close(); if (c.action) c.action(); }));
        childMenu = show(anchor, above, inner, null, null, { left: b.left, top: b.top, right: b.right, bottom: b.bottom }, 1, true, { top: rr.top, bottom: rr.bottom });
        return;
      }
      close(); if (row.action) row.action();
    });
    list.append(line);
  }
  const scroll = h('div', { class: 'amenu-scroll' }, list);
  const more = h('div', { class: 'amenu-more', dataset: { tag: 'menu_more' }, role: 'button', 'aria-label': '아래에 더 있음', title: '아래에 더 있음' });
  more.innerHTML = '<svg width="22" height="18" viewBox="0 0 22 18" aria-hidden="true"><path d="M6 3.5l5 4.5 5-4.5M6 9.5l5 4.5 5-4.5" fill="none" stroke="#007AFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  more.style.display = 'none';
  const updateMore = () => { more.style.display = scroll.scrollTop + scroll.clientHeight < scroll.scrollHeight - 2 ? '' : 'none'; };
  scroll.addEventListener('scroll', updateMore);
  more.addEventListener('click', () => scroll.scrollBy({ top: Math.round(scroll.clientHeight * 0.7), behavior: 'smooth' }));
  card.append(h('div', { class: 'amenu-scrollbox' }, scroll, more));
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
  let w = Math.min(screenW - 24, wide ? 268 : 240);
  let sideRight = true;
  if (beside && avoid) {   // a submenu opens right next to its parent, on whichever side has room; narrowed (rows ellipsize) when the window is tight
    const roomRight = screenW - avoid.right - 14, roomLeft = avoid.left - 14;
    if (railOnRight && roomLeft >= w) sideRight = false;
    else if (roomRight >= w) sideRight = true; else if (roomLeft >= w) sideRight = false;
    else { sideRight = roomRight >= roomLeft; w = Math.min(screenW - 24, Math.max(Math.min(w, 150), Math.max(roomRight, roomLeft))); }
  }
  card.style.width = w + 'px';
  const backdrop = h('div', { class: 'amenu-backdrop' });
  if (isChild) backdrop.style.pointerEvents = 'none';
  backdrop.addEventListener('mousedown', close);
  backdrop.addEventListener('contextmenu', e => { e.preventDefault(); close(); });
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  card.style.visibility = 'hidden';
  document.body.append(backdrop, card);
  updateMore();
  const hgt = card.offsetHeight;
  const r = anchor.getBoundingClientRect();
  const margin = 8, gap = 6;
  let x = above ? r.left + r.width / 2 - w / 2 : r.right - w;
  x = Math.max(margin, Math.min(screenW - w - margin, x));
  let y = above ? r.top - hgt - gap : r.bottom + gap;
  y = Math.max(margin, Math.min(screenH - hgt - margin, y));
  if (avoid && mode === 3) { x = Math.min(screenW - w - margin, avoid.right + gap); y = Math.max(margin, Math.min(screenH - hgt - margin, r.top + r.height / 2 - hgt / 2)); }
  else if (avoid && beside) {
    x = sideRight ? avoid.right + 4 : avoid.left - w - 4;
    x = Math.max(margin, Math.min(screenW - w - margin, x));
    const rowTop = rowRect ? rowRect.top - 6 : avoid.top;   // the first child row sits level with the tapped row
    y = Math.max(margin, Math.min(screenH - hgt - margin, rowTop));
  }
  else if (avoid) [x, y] = placeAvoiding(avoid, w, hgt, screenW, screenH, margin, gap);
  else if (railRect) {
    x = railOnRight ? railRect.left - w - gap - 2 : railRect.right + gap + 2;
    x = Math.max(margin, Math.min(screenW - w - margin, x));
    y = Math.max(margin, Math.min(screenH - hgt - margin, r.top + r.height / 2 - hgt / 2));
  }
  if (mode === 2) { x = (screenW - w) / 2; y = Math.max(margin, (screenH - hgt) / 3); }
  card.style.left = x + 'px'; card.style.top = y + 'px'; card.style.visibility = 'visible';
  card.classList.add('in');
  if (!isChild) current = { card, close };
  return { close, card };
}
/** Android showRightOf: a card to the right of a panel, level with the tapped ⋮ button. */
export function showRightOf(anchor, panelEl, rows) {
  anchor = anchor || document.body;
  const b = (panelEl && panelEl.isConnected ? panelEl : anchor).getBoundingClientRect();
  return show(anchor, false, rows, null, null, { left: b.left, top: b.top, right: b.right, bottom: b.bottom }, 3);
}
/** Android showCentered: a titled card in the middle of the screen. */
export function showCentered(title, rows) {
  const all = [];
  if (title) all.push(Row.custom(h('div', { style: { fontSize: '13px', color: GRAY, padding: '8px 12px 4px' } }, title)));
  all.push(...rows);
  return show(document.body, false, all, null, null, null, 2);
}
export const AnchoredMenu = { show, showRightOf, showCentered, Row, Shortcut, dismiss: dismissMenu, placeAvoiding };
