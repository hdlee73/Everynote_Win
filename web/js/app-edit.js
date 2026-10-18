// Object clipboard for inserted items (typing boxes, shapes, tables, pictures, stickers, videos): cut / copy / paste / duplicate (v3.27.0).
// A selected item (the one with the blue frame and handles) gets a small bar with 잘라내기 · 복사 · 복제 · 붙여넣기 · 삭제; Ctrl+X / C / V / D do the same.
// The copy lives inside the app (it carries the whole item and its file names) and also puts a short text on the system clipboard so a stale picture there is not pasted by mistake.
import { h, icon } from './util.js';
import { toast } from './ui/toast.js';
import { PageElement } from './store.js';

const SHIFT = 0.03;     // each further paste lands this much (page fraction) down and right of the previous one
const KIND_NAMES = { text: '글상자', image: '사진', sticker: '스티커', video: '동영상', shape: '도형', table: '표', youtube: '유튜브' };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const E = {};

E.hasElementClip = function () { return !!this.elementClip; };

/** The view that currently shows the selected item. */
E.selectedElementView = function () {
  return this.allPageViews().find(v => v.selectedElement && v.selectedElement()) || null;
};

E.copySelectedElement = function (cut) {
  const el = this.selectedPageElement();
  if (!el || !this.store) return false;
  const label = KIND_NAMES[el.kind] || '개체';
  const sys = el.kind === 'text' && String(el.text).trim() !== '' ? String(el.text) : 'Everynote ' + label;
  this.elementClip = { json: JSON.parse(JSON.stringify(el.toJson())), sys, source: this.store, page: el.page, cut: !!cut, pastes: 0 };
  try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(sys).catch(() => {}); } catch (e) { /* the app's own copy is enough */ }
  if (cut) this.deleteElement(el);
  this.refreshElementBar();
  toast(label + (cut ? '을(를) 잘라냈습니다' : '을(를) 복사했습니다') + ' · 붙여넣기: Ctrl+V');
  return true;
};

/** Several items at once (the lasso's 선택한 개체 복사 / 잘라내기): the clipboard keeps a copy of each; a paste puts the group back with its top-left corner at the pointed spot. */
E.copyElements = function (items, cut) {
  if (!this.store) return false;
  const ok = items.filter(e => e.kind !== 'hyperlink' && e.kind !== 'audio' && this.store.elements.includes(e));
  if (!ok.length) { toast('복사할 수 있는 개체가 없습니다'); return false; }
  const group = ok.map(e => JSON.parse(JSON.stringify(e.toJson())));
  const sys = 'Everynote 개체 ' + ok.length + '개';
  this.elementClip = { json: group[0], group: group.length > 1 ? group : null, sys, source: this.store, page: ok[0].page, cut: !!cut, pastes: 0 };
  try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(sys).catch(() => {}); } catch (e) { /* the app's own copy is enough */ }
  if (cut) {
    const set = new Set(ok), els = this.store.elements;
    for (let i = els.length - 1; i >= 0; i--) if (set.has(els[i])) els.splice(i, 1);
    this.store.save();
    for (const v of this.allPageViews()) if (v.selectElement) v.selectElement(null);
    this.redrawPages();
    if (this.sidebarVisible && this.panelTab === 4 && this.rebuildInsertions) this.rebuildInsertions();
  }
  this.refreshElementBar();
  toast(`${ok.length}개 개체를 ${cut ? '잘라냈습니다' : '복사했습니다'} · 붙여넣기: Ctrl+V`);
  return true;
};

/** Pastes the copied group: its top-left corner at the pointed spot, else a little down and right of where it was (a cut group comes back exactly where it was). */
E._placeGroup = function (clip, steps, at) {
  const view = this.pageView, page = at && at.page != null ? at.page : (view ? view.getPageNumber() : this.currentPage);
  const items = clip.group.map(j => { const d = JSON.parse(JSON.stringify(j)); d.page = page; return PageElement.fromJson(d); });
  let minL = 1, minT = 1, maxR = 0, maxB = 0;
  for (const e of items) { minL = Math.min(minL, e.left); minT = Math.min(minT, e.top); maxR = Math.max(maxR, e.right); maxB = Math.max(maxB, e.bottom); }
  let dx = at && at.x != null ? at.x - minL : SHIFT * steps, dy = at && at.y != null ? at.y - minT : SHIFT * steps;
  dx = clamp(dx, -minL, 1 - maxR); dy = clamp(dy, -minT, 1 - maxB);
  let skipped = 0;
  for (const e of items) {
    if (e.kind === 'video' && clip.source !== this.store) { skipped++; continue; }   // a video file belongs to the document it was added to
    e.left += dx; e.right += dx; e.top += dy; e.bottom += dy; this.store.elements.push(e);
  }
  this.store.save();
  for (const v of this.allPageViews()) if (v.selectElement) v.selectElement(null);
  this.redrawPages();
  if (this.sidebarVisible && this.panelTab === 4 && this.rebuildInsertions) this.rebuildInsertions();
  return skipped;
};

/** Adds a copy of `json` to the current page of the active view. at = { page, x, y } puts its centre at that point. */
E._placeCopy = function (json, shiftSteps, at) {
  const view = this.pageView, page = at && at.page != null ? at.page : (view ? view.getPageNumber() : this.currentPage);
  const data = JSON.parse(JSON.stringify(json)); data.page = page;
  const e = PageElement.fromJson(data);
  const w = e.right - e.left, hh = e.bottom - e.top;
  let left = e.left + SHIFT * shiftSteps, top = e.top + SHIFT * shiftSteps;
  if (at && at.x != null) { left = at.x - w / 2; top = at.y - hh / 2; }
  left = clamp(left, 0, Math.max(0, 1 - w)); top = clamp(top, 0, Math.max(0, 1 - hh));
  e.left = left; e.right = left + w; e.top = top; e.bottom = top + hh;
  this.store.elements.push(e); this.store.save();
  const shown = this.allPageViews().find(v => v.getPageNumber() === page) || view;
  for (const v of this.allPageViews()) if (v !== shown && v.selectElement) v.selectElement(null);
  if (shown && shown.selectElement) shown.selectElement(e);
  this.redrawPages();
  if (this.sidebarVisible && this.panelTab === 4 && this.rebuildInsertions) this.rebuildInsertions();
  return e;
};

E.pasteElement = function (at) {
  const clip = this.elementClip;
  if (!clip || !this.store || !this.renderer) { toast('붙여넣을 개체가 없습니다'); return false; }
  const pageNow = at && at.page != null ? at.page : (this.pageView ? this.pageView.getPageNumber() : this.currentPage);
  const same = clip.source === this.store && clip.page === pageNow;
  const steps = at && at.x != null ? 0 : same ? (clip.cut ? clip.pastes : clip.pastes + 1) : clip.pastes;   // a cut item comes back exactly where it was
  if (clip.group) { const skipped = this._placeGroup(clip, steps, at); clip.pastes++; toast(skipped ? '붙여넣었습니다 (동영상은 제외)' : '붙여넣었습니다'); return true; }
  this._placeCopy(clip.json, steps, at);
  clip.pastes++;
  toast('붙여넣었습니다');
  return true;
};

E.duplicateSelectedElement = function () {
  const el = this.selectedPageElement();
  if (!el || !this.store) return false;
  this._placeCopy(el.toJson(), 1, { page: el.page, x: null });
  toast('복제했습니다');
  return true;
};

// ---- selection bar ----------------------------------------------------------------------------------------------------------------------------
E.onElementSelected = function (el) {
  const ok = el && el.kind !== 'audio' && el.kind !== 'hyperlink';
  if (!ok) { this.hideElementBar(); return; }
  this.showElementBar();
};
E.showElementBar = function () {
  if (!this.elementBar) {
    const bar = h('div', { class: 'm-elbar', dataset: { tag: 'element_bar' }, style: { display: 'none' } });
    const add = (name, label, tag, tint, run) => {
      const b = h('button', { class: 'm-elbtn', type: 'button', 'aria-label': label, title: label, dataset: { tag } }, icon(name, 20, tint), h('span', { class: 't' }, label));
      b.addEventListener('mousedown', ev => ev.preventDefault());
      b.addEventListener('click', ev => { ev.stopPropagation(); run(); });
      bar.append(b); return b;
    };
    add('ic_cut', '잘라내기', 'element_cut', '#1C1C1E', () => this.copySelectedElement(true));
    add('ic_copy', '복사', 'element_copy', '#1C1C1E', () => this.copySelectedElement(false));
    add('ic_duplicate', '복제', 'element_duplicate', '#1C1C1E', () => this.duplicateSelectedElement());
    this.elementPasteButton = add('ic_paste', '붙여넣기', 'element_paste', '#1C1C1E', () => this.pasteElement());
    add('ic_delete', '삭제', 'element_delete', '#FF3B30', () => { const el = this.selectedPageElement(); if (el) this.deleteElement(el); });
    bar.addEventListener('pointerdown', ev => ev.stopPropagation());
    this.viewportLayer.append(bar);
    this.elementBar = bar;
  }
  this.refreshElementBar();
  if (!this._elementBarRaf) { const tick = () => { this._elementBarRaf = 0; if (!this.elementBar || !this.selectedPageElement()) return; this.positionElementBar(); this._elementBarRaf = requestAnimationFrame(tick); }; this._elementBarRaf = requestAnimationFrame(tick); }
};
E.hideElementBar = function () {
  if (this.elementBar) this.elementBar.style.display = 'none';
  if (this._elementBarRaf) { cancelAnimationFrame(this._elementBarRaf); this._elementBarRaf = 0; }
};
E.refreshElementBar = function () {
  if (this.elementPasteButton) this.elementPasteButton.style.display = this.elementClip ? '' : 'none';
};
E.positionElementBar = function () {
  const bar = this.elementBar, el = this.selectedPageElement(), view = this.selectedElementView();
  if (!bar || !el || !view) { if (bar) bar.style.display = 'none'; return; }
  if (this.inlineElement || view.elementDrag || (view.panning && view.gestureMoved)) { bar.style.display = 'none'; return; }
  const dest = view.contentRect(), vp = this.viewportLayer.getBoundingClientRect(), vr = view.el.getBoundingClientRect();
  const left = vr.left - vp.left + dest.left + el.left * dest.width(), right = vr.left - vp.left + dest.left + el.right * dest.width();
  const top = vr.top - vp.top + dest.top + el.top * dest.height(), bottom = vr.top - vp.top + dest.top + el.bottom * dest.height();
  bar.style.display = 'flex';
  const bw = bar.offsetWidth, bh = bar.offsetHeight;
  let y = bottom + 18; if (y + bh > vp.height - 8) y = Math.max(8, top - bh - 44);
  const x = clamp((left + right) / 2 - bw / 2, 8, Math.max(8, vp.width - bw - 8));
  bar.style.left = Math.round(x) + 'px'; bar.style.top = Math.round(y) + 'px';
};

/** Shown by the page's blank long-press menu: the item to paste, if one is on the clipboard. */
E.pasteElementRow = function (R) {
  if (!this.elementClip) return [];
  return [new R('복사한 개체 붙여넣기', 'ic_paste', () => {
    const t = this.dropTarget; const fresh = t && Date.now() - this.dropTime < 30000;
    this.pasteElement(fresh ? { page: t[0], x: t[1], y: t[2] } : null);
  }).tint('#34C759')];
};

export function initEdit(app) { app.elementClip = null; app.elementBar = null; app.elementPasteButton = null; app._elementBarRaf = 0; }
export function installEdit(cls) { Object.assign(cls.prototype, E); }
