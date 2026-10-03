// Port of AlertDialog.java (iOS-like card / bottom action sheet) + showActionSheet() of MainActivity.
import { h, icon } from '../util.js';

export const BUTTON_POSITIVE = -1, BUTTON_NEGATIVE = -2, BUTTON_NEUTRAL = -3;

function checkLabel(text) {
  const w = h('span', { class: 'check-label' }, icon('ic_check_bold', 18, '#007AFF'), h('span', null, text));
  return w;
}

export class AlertDialog {
  static Builder = class {
    constructor() {
      this.title = null; this.message = null; this.view = null; this.items = null; this.checked = -1; this.choice = false;
      this.itemListener = null; this.labels = [null, null, null]; this.listeners = [null, null, null];
      this.cancelable = true; this.dismissL = null; this.cancelL = null;
    }
    setTitle(t) { this.title = t; return this; }
    setMessage(m) { this.message = m; return this; }
    setView(v) { this.view = v; return this; }
    setItems(list, l) { this.items = list; this.itemListener = l; this.choice = false; return this; }
    setSingleChoiceItems(list, selected, l) { this.items = list; this.checked = selected; this.itemListener = l; this.choice = true; return this; }
    setPositiveButton(t, l) { this.labels[0] = t; this.listeners[0] = l || null; return this; }
    setNegativeButton(t, l) { this.labels[1] = t; this.listeners[1] = l || null; return this; }
    setNeutralButton(t, l) { this.labels[2] = t; this.listeners[2] = l || null; return this; }
    setCancelable(c) { this.cancelable = c; return this; }
    setOnDismissListener(l) { this.dismissL = l; return this; }
    setOnCancelListener(l) { this.cancelL = l; return this; }
    show() { const d = this.create(); d.show(); return d; }
    create() { return new AlertDialog(this); }
  };

  constructor(b) {
    this.b = b; this.sheet = b.items != null; this.buttons = [null, null, null]; this.titleView = null; this.messageView = null; this.dismissed = false;
    const which = [BUTTON_POSITIVE, BUTTON_NEGATIVE, BUTTON_NEUTRAL];
    for (let i = 0; i < 3; i++) {
      const el = h('div', { class: 'ad-btn' + (i === 0 ? ' bold' : ''), role: 'button', 'aria-label': b.labels[i] || '' }, b.labels[i] || '');
      if (i === 1 && b.labels[i] && String(b.labels[i]).includes('삭제')) el.style.color = '#FF3B30';
      el.addEventListener('click', () => { const l = b.listeners[i]; if (l) l(this, which[i]); this.dismiss(); });
      this.buttons[i] = el;
    }
    this.root = h('div', { class: 'ad-root' + (this.sheet ? ' sheet' : '') });
    this.dim = h('div', { class: 'ad-dim' });
    this.dim.addEventListener('mousedown', e => {
      if (e.target !== this.dim) return;
      if (b.cancelable) { if (b.cancelL) b.cancelL(this); this.dismiss(); }
    });
    this.dim.append(this.sheet ? this._sheet() : this._card());
    this.root.append(this.dim);
  }
  getButton(w) { return this.buttons[-w - 1]; }
  getTitleText() { return this.titleView ? this.titleView.textContent : null; }
  show() {
    document.body.append(this.root);
    requestAnimationFrame(() => this.root.classList.add('in'));
    this._key = e => { if (e.key === 'Escape' && this.b.cancelable) { e.stopPropagation(); e.preventDefault(); if (this.b.cancelL) this.b.cancelL(this); this.dismiss(); } };
    document.addEventListener('keydown', this._key, true);
    const f = this.root.querySelector('input,textarea'); if (f) setTimeout(() => f.focus(), 30);
    return this;
  }
  dismiss() {
    if (this.dismissed) return; this.dismissed = true;
    document.removeEventListener('keydown', this._key, true);
    this.root.classList.remove('in'); this.root.classList.add('out');
    setTimeout(() => this.root.remove(), this.sheet ? 170 : 120);
    if (this.b.dismissL) this.b.dismissL(this);
  }
  isShowing() { return !this.dismissed; }

  _card() {
    const b = this.b;
    const card = h('div', { class: 'ad-card', dataset: { tag: 'alert_card' } });
    const body = h('div', { class: 'ad-body' });
    if (b.title != null) { this.titleView = h('div', { class: 'ad-title' }, b.title); body.append(this.titleView); }
    if (b.message != null) {
      this.messageView = h('div', { class: 'ad-msg-inner' }, b.message);
      body.append(h('div', { class: 'ad-msg', style: { marginTop: (b.title == null ? 0 : 8) + 'px' } }, this.messageView));
    }
    if (b.view) { const w = h('div', { style: { marginTop: (b.title == null && b.message == null ? 0 : 12) + 'px' } }, b.view); body.append(w); }
    card.append(body);
    const count = b.labels.filter(l => l != null).length;
    if (count === 0) return card;
    card.append(h('div', { class: 'hair' }));
    const row = count <= 2 && b.labels[2] == null;
    const bar = h('div', { class: 'ad-bar' + (row ? ' row' : '') });
    let first = true;
    for (const slot of (row ? [1, 0] : [0, 2, 1])) {
      if (b.labels[slot] == null) continue;
      if (!first) bar.append(h('div', { class: row ? 'vhair' : 'hair' })); first = false;
      bar.append(this.buttons[slot]);
    }
    card.append(bar);
    return card;
  }

  _sheet() {
    const b = this.b;
    const root = h('div', { class: 'ad-sheet', dataset: { tag: 'action_sheet' } });
    const list = h('div', { class: 'ad-list' });
    if (b.title != null) { this.titleView = h('div', { class: 'ad-sheet-title' }, b.title); list.append(this.titleView); }
    if (b.message != null) list.append(h('div', { class: 'ad-sheet-msg' }, b.message));
    const rows = h('div', { class: 'ad-rows' });
    const cells = []; let current = b.checked;
    const refresh = () => cells.forEach((c, i) => {
      const on = b.choice && i === current; c.textContent = ''; c.append(on ? checkLabel(b.items[i]) : document.createTextNode(b.items[i]));
      c.style.fontWeight = on ? '700' : '400';
    });
    b.items.forEach((label, i) => {
      if (i > 0 || b.title != null || b.message != null) rows.append(h('div', { class: 'hair' }));
      const cell = h('div', { class: 'ad-cell', role: 'button', 'aria-label': label });
      cell.addEventListener('click', () => {
        if (b.choice) { current = i; refresh(); }
        if (b.itemListener) b.itemListener(this, i);
        if (!b.choice) this.dismiss();
      });
      cells.push(cell); rows.append(cell);
    });
    refresh();
    list.append(h('div', { class: 'ad-scroll' }, rows));
    for (const slot of [0, 2]) if (b.labels[slot] != null) { list.append(h('div', { class: 'hair' })); const bt = this.buttons[slot]; bt.classList.add('sheet-btn'); list.append(bt); }
    if (b.view) list.append(b.view);
    root.append(list);
    let c = this.buttons[1];
    if (b.labels[1] == null) { c = h('div', { class: 'ad-btn', 'aria-label': '취소' }, '취소'); c.addEventListener('click', () => this.dismiss()); this.buttons[1] = c; }
    c.classList.add('ad-cancel');
    root.append(c);
    return root;
  }
}

/** MainActivity.showActionSheet(title, labels, checkedIndex, onPick) */
export function showActionSheet(title, labels, checked, onPick) {
  const b = new AlertDialog.Builder();
  if (title != null) b.setTitle(title);
  // identical look to Mode B but always dismisses itself and calls onPick afterwards
  const d = b.setSingleChoiceItems(labels, checked, (dlg, i) => { dlg.dismiss(); onPick(i); }).create();
  d.show();
  return d;
}
