// MainActivity part 4 (v3.15, v3.20): split screen = 2 to 4 open documents shown at once, each pane a full page view with its own page, zoom and ink.
//
// The app keeps ONE active document in `this.*` (renderer, store, currentPage, pageView = firstPageView, ...). A split keeps
// `this.panes` = [{view, session}] in screen order (the slot index is the position) and `this.activeSlot`. Touching another pane
// makes it the active one (firstPageView / pageView / activeSession and friends are re-pointed to it) BEFORE the touch reaches the
// view, so every existing tool (pen, eraser, lasso, undo, thumbnails, page turns ...) keeps working on the pane that was touched, with
// no re-render and no lost zoom. The panes are CSS-grid items of `papers`; the layout is 'cols' (side by side), 'rows' (stacked) or
// 'grid' (3 panes: one wide on top and two below, 4 panes: 2 x 2). Dividers between the tracks are dragged to resize them.
import { h, icon as mkIcon } from './util.js';
import { AlertDialog } from './ui/alert.js';
import { AnchoredMenu, Row } from './ui/menu.js';
import { toast } from './ui/toast.js';

const WANT_MS = 3 * 60 * 1000;   // how long "open a second document" waits for the new document
const MAX_PANES = 4, MIN_FRAC = 0.15;

/** 'grid' only exists for 3 or 4 panes (two panes are 'cols' or 'rows'). */
const normLayout = (layout, n) => (layout === 'rows' ? 'rows' : (layout === 'grid' && n >= 3 ? 'grid' : 'cols'));
/** Number of grid columns / rows of a layout. */
function tracksOf(layout, n) { return layout === 'rows' ? { c: 1, r: n } : layout === 'grid' ? { c: 2, r: 2 } : { c: n, r: 1 }; }
/** Grid cell of pane i (1-based lines + spans). */
function cellOf(layout, n, i) {
  if (layout === 'rows') return { c: 1, r: i + 1, cs: 1 };
  if (layout === 'grid') return n === 3 ? (i === 0 ? { c: 1, r: 1, cs: 2 } : { c: i, r: 2, cs: 1 }) : { c: (i % 2) + 1, r: Math.floor(i / 2) + 1, cs: 1 };
  return { c: i + 1, r: 1, cs: 1 };
}
const cum = (a, k) => a.slice(0, k).reduce((s, x) => s + x, 0);
const equal = k => Array.from({ length: k }, () => 1 / k);
const LAYOUT_LABEL = {
  cols: n => (n === 2 ? '좌우로 나누기' : `가로로 ${n}등분`),
  rows: n => (n === 2 ? '상하로 나누기' : `세로로 ${n}등분`),
  grid: n => (n === 3 ? '위 1칸 · 아래 2칸' : '2 × 2 (4분할)'),
};

const methods = {
  isSplit() { return this.panes.length > 0; },
  paneIndex(session) { return this.panes.findIndex(p => p.session === session); },

  /** Header / view-menu toggle. One document: offers to open a second one; two or more: splits; more: asks which one goes in the second pane. */
  toggleSplit() {
    if (this.isSplit()) { this.exitSplit(); return; }
    if (this.renderer == null || this.activeSession == null) { toast('문서를 먼저 여세요'); return; }
    const others = this.sessions.filter(s => s !== this.activeSession);
    if (others.length === 0) {
      new AlertDialog.Builder().setTitle('화면 나누기')
        .setMessage('화면을 나누려면 문서가 두 개 필요합니다. 두 번째 문서를 열까요?\n(열면 지금 문서와 나란히 표시됩니다. 화면은 최대 4개까지, 좌우·상하·2×2로 나눌 수 있습니다)')
        .setPositiveButton('문서함 열기', () => { this._splitWanted = { session: this.activeSession, at: Date.now() }; this.showLibrary(); })
        .setNegativeButton('취소', null).show();
      return;
    }
    if (others.length === 1) { this.enterSplit(others[0]); return; }
    AnchoredMenu.showCentered('두 번째 문서 선택', others.map(s => new Row(s.title, 'ic_document_tab', () => this.enterSplit(s)).tint('#007AFF')));
  },

  /** Called after a document became active: finishes "split with a newly opened document" (the old document left, the new one right). */
  consumeSplitWanted(s) {
    const w = this._splitWanted; if (!w) return;
    this._splitWanted = null;
    if (Date.now() - w.at < WANT_MS && w.session !== s && this.sessions.includes(w.session) && !this.isSplit()) { this.enterSplit(w.session); this.swapSplitPanes(0, 1); }
  },

  /** A free page view of the pool (the ones not used by a pane). */
  freePaneView() { return this.paneViews.find(v => v !== this.firstPageView && !this.panes.some(p => p.view === v)); },
  prepPaneView(view) {
    view.copyToolsFrom(this.firstPageView);
    view.resetZoom();
    view.setPageSwipeEnabled(this.swipeEnabled); view.setVerticalPageSwipe(this.verticalPageSwipe);
    view.setDarkPage(this.darkPage());
  },

  /** Shows `session` (an open document other than the active one) in a second pane next to the active document. */
  enterSplit(session) {
    if (this.renderer == null || !session || session === this.activeSession || !this.sessions.includes(session)) return;
    if (this.isSplit()) { this.addPane(session); return; }
    this._twoPageBeforeSplit = this.twoPage;
    if (this.twoPage) { this.twoPage = false; setDisplay(this.secondPageView.el, false); this.showPage(this.currentPage); }
    this.secondPageView.clearPage(); setDisplay(this.secondPageView.el, false);
    const view = this.freePaneView();
    this.panes = [{ view: this.firstPageView, session: this.activeSession }, { view, session }];
    this.activeSlot = 0;
    this.splitLayout = normLayout(this.recentPrefs.getString('split_layout', 'cols'), 2);
    this.papers.classList.add('m-papers-split');
    this.prepPaneView(view);
    this.resetSplitSizes();
    this.applyMouseReadDrag(); this.applyEraserRadius();
    this.applyLayout();
    this.renderPane(1);
    this.updateTabs(); this.updateFloaters();
    toast('화면 나누기 · 필기할 화면을 터치하세요');
  },

  /** Adds a pane (2 -> 3 -> 4) that shows `session`; `activate` makes it the pane that is written on. */
  addPane(session, activate = false) {
    if (!this.isSplit() || this.panes.length >= MAX_PANES || !session || this.paneIndex(session) >= 0 || !this.sessions.includes(session)) return;
    const view = this.freePaneView(); if (!view) return;
    this.prepPaneView(view);
    this.panes.push({ view, session });
    this.splitLayout = normLayout(this.splitLayout, this.panes.length);
    this.resetSplitSizes();
    this.applyLayout();
    this.renderPane(this.panes.length - 1);
    if (activate) this.activateSplitPane(this.panes.length - 1);
    this.updateTabs(); this.updateFloaters();
  },

  /** Asks which open document goes into a new pane (or offers to open one). */
  promptAddPane() {
    if (!this.isSplit() || this.panes.length >= MAX_PANES) { toast('화면은 최대 4개까지 나눌 수 있습니다'); return; }
    const free = this.sessions.filter(s => this.paneIndex(s) < 0);
    if (free.length === 0) {
      new AlertDialog.Builder().setTitle('화면 추가')
        .setMessage('추가로 보여 줄 문서가 없습니다. 문서함에서 새 문서를 열까요?')
        .setPositiveButton('문서함 열기', () => { this._paneWanted = { at: Date.now() }; this.showLibrary(); })
        .setNegativeButton('취소', null).show();
      return;
    }
    if (free.length === 1) { this.addPane(free[0], true); return; }
    AnchoredMenu.showCentered('추가할 문서 선택', free.map(s => new Row(s.title, 'ic_document_tab', () => this.addPane(s, true)).tint('#007AFF')));
  },

  /** switchDocument hook: a document opened for "화면 추가" becomes a new pane instead of replacing the active one. */
  consumePaneWanted(s) {
    const w = this._paneWanted; if (!w) return false;
    this._paneWanted = null;
    if (Date.now() - w.at < WANT_MS && this.isSplit() && this.paneIndex(s) < 0 && this.panes.length < MAX_PANES && this.sessions.includes(s)) { this.addPane(s, true); return true; }
    return false;
  },

  /** Takes pane k off the screen (the remaining ones are re-laid out). With two panes left the split ends instead. */
  removePane(k) {
    if (!this.isSplit() || k < 0 || k >= this.panes.length) return;
    if (this.panes.length <= 2) { if (k === this.activeSlot) this.activateSplitPane(); this.exitSplit(); return; }
    if (k === this.activeSlot) this.activateSplitPane(k > 0 ? k - 1 : 1);
    const [gone] = this.panes.splice(k, 1);
    if (k < this.activeSlot) this.activeSlot--;
    this.hidePaneView(gone.view);
    this.splitLayout = normLayout(this.splitLayout, this.panes.length);
    this.resetSplitSizes();
    this.applyLayout();
    this.updateTabs(); this.updateFloaters();
  },

  hidePaneView(view) {
    view.clearPage(); setDisplay(view.el, false);
    view.el.classList.remove('pane-active');
    const st = view.el.style; st.gridColumn = ''; st.gridRow = ''; st.order = '';
  },

  /** Leaves split mode; the active pane's document stays on screen. */
  exitSplit() {
    if (!this.isSplit()) return;
    const keep = this.panes[this.activeSlot];
    for (const p of this.panes) { p.gen = (p.gen | 0) + 1; if (p !== keep) this.hidePaneView(p.view); }
    this.panes = []; this.activeSlot = 0;
    this.papers.classList.remove('m-papers-split');
    const ps = this.papers.style; ps.gridTemplateColumns = ''; ps.gridTemplateRows = '';
    keep.view.el.classList.remove('pane-active');
    const ks = keep.view.el.style; ks.gridColumn = ''; ks.gridRow = ''; ks.order = '';
    // the active view may sit AFTER the second page view of a spread in the DOM (it belonged to another slot of the pool): a two-page spread
    // would then be laid out mirrored. Put the first view back in front.
    { const f = this.firstPageView.el, sec = this.secondPageView.el; if (f.compareDocumentPosition(sec) & Node.DOCUMENT_POSITION_PRECEDING) this.papers.insertBefore(f, sec); }
    this.clearDividers();
    if (this.splitBar) { this.splitBar.style.display = 'none'; this.splitBar.replaceChildren(); }
    const two = this._twoPageBeforeSplit; this._twoPageBeforeSplit = false;
    if (two) { this.twoPage = true; setDisplay(this.secondPageView.el, true); }
    if (this.renderer != null) this.showPage(this.currentPage);
    this.updateTabs(); this.updateFloaters(); this.updateSplitArrows();
    toast('화면 나누기를 끝냈습니다');
  },

  /** Puts another open document into passive pane k. */
  setPaneDocument(k, session) {
    const p = this.panes[k]; if (!p || !session || !this.sessions.includes(session) || k === this.activeSlot) return;
    p.session = session; p.view.resetZoom();
    this.renderPane(k); this.updateSplitUi(); this.updateTabs();
  },

  /** (Re)draws passive pane k from its session. */
  async renderPane(k) {
    const p = this.panes[k]; if (!p) return;
    const session = p.session, view = p.view, gen = p.gen = (p.gen | 0) + 1;
    const doc = session.renderer, page = Math.max(0, Math.min(session.page, doc.pageCount - 1));
    try {
      const canvas = this.cachedPage(doc, page) || await this.renderPage(doc, page);
      if (gen !== p.gen || this.panes[k] !== p || session !== p.session || view !== p.view || k === this.activeSlot) return;
      const store = session.store;
      view.setSpread(0, null);
      view.showPage(canvas, page, store.marks, store.strokes, store.translations); view.setAnnotationStore(store);
      view.setDarkPage(this.darkPage());
    } catch (e) { toast('페이지 표시 실패: ' + (e && e.message || e)); }
  },

  // ---------------------------------------------------------------- layout
  /** Track sizes (fractions) for the current layout; the 2-track axes are remembered between runs. */
  resetSplitSizes() {
    const n = this.panes.length, t = tracksOf(this.splitLayout, n), prefs = this.recentPrefs;
    const sized = (k, key) => { if (k !== 2) return equal(k); const r = Math.min(0.85, Math.max(0.15, prefs.getFloat(key, 0.5) || 0.5)); return [r, 1 - r]; };
    this.splitSizes = { c: sized(t.c, 'split_ratio'), r: sized(t.r, 'split_vratio') };
  },
  setSplitLayout(layout) {
    if (!this.isSplit()) return;
    this.splitLayout = normLayout(layout, this.panes.length);
    this.recentPrefs.putString('split_layout', this.splitLayout);
    this.resetSplitSizes();
    this.applyLayout();
  },

  /** Lays the panes out as CSS-grid cells of `papers`, then dividers, name chips, frame and arrows. */
  applyLayout() {
    if (!this.isSplit()) return;
    const n = this.panes.length, L = this.splitLayout = normLayout(this.splitLayout, n), t = tracksOf(L, n);
    if (this.splitSizes.c.length !== t.c || this.splitSizes.r.length !== t.r) this.resetSplitSizes();
    const ps = this.papers.style;
    ps.gridTemplateColumns = this.splitSizes.c.map(f => `${Math.round(f * 1000)}fr`).join(' ');
    ps.gridTemplateRows = this.splitSizes.r.map(f => `${Math.round(f * 1000)}fr`).join(' ');
    this.panes.forEach((p, i) => {
      const c = cellOf(L, n, i), st = p.view.el.style;
      st.gridColumn = `${c.c} / span ${c.cs}`; st.gridRow = `${c.r} / span 1`; st.order = String(i);
      setDisplay(p.view.el, true);
    });
    this.buildDividers();
    this.updateSplitUi();
  },

  clearDividers() { for (const d of this.splitDivs || []) d.remove(); this.splitDivs = []; },
  /** Draggable dividers on the seams between the tracks. */
  buildDividers() {
    this.clearDividers();
    const n = this.panes.length, L = this.splitLayout, t = tracksOf(L, n);
    const make = (axis, i) => {
      const d = h('div', { class: 'm-splitdiv ' + (axis === 'c' ? 'v' : 'h'), title: '끌어서 화면 크기 조절 (두 번 누르면 같은 크기로)', 'aria-label': axis === 'c' ? '화면 너비 조절' : '화면 높이 조절', dataset: { tag: axis === 'c' ? 'split_divider' : 'split_divider_h', i: String(i) } }, h('span', { class: 'm-splitgrip' }));
      d._axis = axis; d._i = i;
      this.attachDividerDrag(d);
      this.papers.append(d); this.splitDivs.push(d);
    };
    for (let i = 0; i < t.c - 1; i++) make('c', i);
    for (let i = 0; i < t.r - 1; i++) make('r', i);
    this.positionDividers();
  },
  positionDividers() {
    const n = this.panes.length, L = this.splitLayout, { c, r } = this.splitSizes;
    for (const d of this.splitDivs || []) {
      const s = d.style, pos = cum(d._axis === 'c' ? c : r, d._i + 1) * 100;
      if (d._axis === 'c') { s.left = `${pos}%`; s.top = L === 'grid' && n === 3 ? `${r[0] * 100}%` : '0'; s.bottom = '0'; s.right = ''; s.width = ''; s.height = ''; }
      else { s.top = `${pos}%`; s.left = '0'; s.right = '0'; s.bottom = ''; }
    }
    this.updateSplitArrows(); this.positionChips();
  },
  attachDividerDrag(d) {
    d.addEventListener('pointerdown', e => {
      if (!this.isSplit()) return;
      e.preventDefault(); e.stopPropagation(); d.setPointerCapture(e.pointerId);
      const axis = d._axis, i = d._i, sizes = this.splitSizes[axis];
      const move = ev => {
        const rc = this.papers.getBoundingClientRect(), p = axis === 'c' ? (ev.clientX - rc.left) / rc.width : (ev.clientY - rc.top) / rc.height;
        const before = cum(sizes, i), pair = sizes[i] + sizes[i + 1], lo = before + Math.min(MIN_FRAC, pair / 2), hi = before + pair - Math.min(MIN_FRAC, pair / 2);
        const q = Math.min(hi, Math.max(lo, p));
        sizes[i] = q - before; sizes[i + 1] = pair - sizes[i];
        this.papers.style[axis === 'c' ? 'gridTemplateColumns' : 'gridTemplateRows'] = sizes.map(f => `${Math.round(f * 1000)}fr`).join(' ');
        this.positionDividers();
      };
      const up = () => {
        d.removeEventListener('pointermove', move); d.removeEventListener('pointerup', up); d.removeEventListener('pointercancel', up);
        if (sizes.length === 2) this.recentPrefs.putFloat(axis === 'c' ? 'split_ratio' : 'split_vratio', sizes[0]);
      };
      d.addEventListener('pointermove', move); d.addEventListener('pointerup', up); d.addEventListener('pointercancel', up);
    });
    d.addEventListener('dblclick', () => {
      const axis = d._axis, sizes = this.splitSizes[axis], eq = equal(sizes.length);
      sizes.splice(0, sizes.length, ...eq);
      if (sizes.length === 2) this.recentPrefs.putFloat(axis === 'c' ? 'split_ratio' : 'split_vratio', 0.5);
      this.applyLayout();
    });
  },

  /** Exchanges the positions of two panes (the documents move with them; the active document stays active). */
  swapSplitPanes(a = 0, b = 1) {
    if (!this.isSplit() || a === b || !this.panes[a] || !this.panes[b]) return;
    [this.panes[a], this.panes[b]] = [this.panes[b], this.panes[a]];
    if (this.activeSlot === a) this.activeSlot = b; else if (this.activeSlot === b) this.activeSlot = a;
    this.applyLayout();
  },

  /** Makes pane k (default: the first other pane) the active one (called when it is touched / scrolled, and from the tabs). */
  activateSplitPane(k) {
    if (!this.isSplit()) return;
    if (k == null) k = this.panes.findIndex((p, i) => i !== this.activeSlot);
    if (k < 0 || k === this.activeSlot || !this.panes[k]) return;
    this.commitInlineText(); this.onSelectionAdjustStarted(); this.stopInlinePlayer();
    const oldPane = this.panes[this.activeSlot], newPane = this.panes[k], newSession = newPane.session, newView = newPane.view, oldView = oldPane.view;
    if (this.searchOwner != null && this.searchOwner !== newSession) this.closeSearch();
    oldPane.session = this.activeSession; oldPane.session.page = this.currentPage;
    oldView.finishInkStroke();
    this.activeSlot = k; this.firstPageView = newView; this.pageView = newView; this.activeSession = newSession;
    this.renderer = newSession.renderer; this.documentUri = newSession.uri; this.documentTitle = newSession.title; this.store = newSession.store;
    this.currentPage = newView.getPageNumber(); newSession.page = this.currentPage;
    newView.copyToolsFrom(oldView);
    ++this.ocrGeneration; this._textSelectWanted = false;
    this.library.opened(newSession.uri);
    this.syncActiveChrome();
  },

  /** Title, page label, arrows, bookmark star, thumbnails ... after the active pane changed. */
  syncActiveChrome() {
    const session = this.activeSession, count = this.renderer.pageCount, first = this.currentPage, notebook = this.isNotebook(session);
    this.titleView.textContent = this.documentTitle;
    this.pageLabel.textContent = `${first + 1} / ${count}`;
    const vis = (el, on) => { el.style.display = on ? '' : 'none'; };
    vis(this.previousOverlay, first > 0); vis(this.nextOverlay, first + 1 < count || notebook);
    const nextLabel = first + 1 >= count && notebook ? '새 페이지 추가' : '다음 페이지';
    this.nextOverlay.setAttribute('aria-label', nextLabel); this.nextOverlay.title = nextLabel;
    this.applyMouseReadDrag(); this.syncOtherTools();
    this.updateSplitUi(); this.updateTabs(); this.updateZoomUi(); this.updateFloaters();
    this.updateBookmarkButton(); this.rebuildThumbnails(); this.refreshStudyPanel(); this.applyCrop(); this.saveSessionState();
    this.loadViewText(this.firstPageView);
  },

  /** Pane name chips (pick a document / layout / add / close / end) in each pane's corner and the highlight of the active pane. */
  updateSplitUi() {
    if (!this.splitBar) return;
    const on = this.isSplit();
    this.splitBar.style.display = on ? 'block' : 'none';
    this.splitBar.replaceChildren();
    if (!on) { this.updateSplitArrows(); return; }
    this.panes.forEach((p, k) => {
      const active = k === this.activeSlot, session = active ? this.activeSession : p.session;
      p.view.el.classList.toggle('pane-active', active);
      const chip = h('button', { class: 'm-panechip' + (active ? ' active' : ''), type: 'button', title: '이 화면의 문서·분할 메뉴', 'aria-label': '화면 문서: ' + session.title, dataset: { tag: 'split_pane_chip', slot: String(k) } },
        h('span', { class: 'm-panename' }, session.title), mkIcon('ic_chevron_down', 16, 'currentColor'));
      chip.addEventListener('click', () => this.showPaneMenu(chip, k));
      this.splitBar.append(chip);
    });
    this.positionChips(); this.updateSplitArrows();
  },
  positionChips() {
    if (!this.splitBar || !this.isSplit()) return;
    const chips = this.splitBar.children;
    this.panes.forEach((p, k) => {
      const c = chips[k]; if (!c) return;
      c.style.left = (this.papers.offsetLeft + p.view.el.offsetLeft + 10) + 'px'; c.style.top = (this.papers.offsetTop + p.view.el.offsetTop + 6) + 'px';
      c.style.maxWidth = Math.max(60, p.view.el.offsetWidth - 20) + 'px';
    });
  },

  /** In split view the page-turn arrows sit on the left and right edge (vertically centred) of the ACTIVE pane instead of the whole window. */
  updateSplitArrows() {
    const pv = this.previousOverlay, nx = this.nextOverlay, papers = this.papers; if (!pv || !nx || !papers) return;
    if (!this.isSplit()) { pv.style.left = ''; nx.style.right = ''; pv.style.top = ''; nx.style.top = ''; return; }
    const pane = this.firstPageView.el, w = papers.clientWidth, mid = (pane.offsetTop + pane.offsetHeight / 2) + 'px';
    pv.style.left = (pane.offsetLeft + 8) + 'px'; nx.style.right = (w - pane.offsetLeft - pane.offsetWidth + 8) + 'px';
    pv.style.top = mid; nx.style.top = mid;
  },

  /** Menu of pane k: its document, the layout, add / close / swap panes, end split. */
  showPaneMenu(anchor, k) {
    const n = this.panes.length, mine = k === this.activeSlot ? this.activeSession : this.panes[k].session;
    const rows = this.sessions.map(s => new Row(s.title, 'ic_document_tab', () => this.assignPaneDocument(k, s)).tint('#007AFF').selected(s === mine));
    rows.push(Row.divider());
    for (const L of ['cols', 'rows', 'grid']) {
      if (L === 'grid' && n < 3) continue;
      rows.push(new Row(LAYOUT_LABEL[L](n), 'ic_dual', () => this.setSplitLayout(L)).tint('#5856D6').selected(this.splitLayout === L));
    }
    if (n < MAX_PANES) rows.push(new Row(`화면 추가 (${n}/${MAX_PANES})`, 'ic_page_add', () => this.promptAddPane()).tint('#34C759'));
    if (n > 2) rows.push(new Row('이 화면 닫기', 'ic_close', () => this.removePane(k)).tint('#FF9500'));
    this.panes.forEach((p, j) => {
      if (j === k) return;
      rows.push(new Row(n === 2 ? '위치 바꾸기' : '위치 바꾸기 · ' + (j === this.activeSlot ? this.activeSession : p.session).title, 'ic_swipe', () => this.swapSplitPanes(k, j)).tint('#5856D6'));
    });
    rows.push(new Row('다른 문서 열기', 'ic_folder_open', () => { if (k !== this.activeSlot) this.activateSplitPane(k); this.showLibrary(); }).tint('#8E8E93'));
    rows.push(new Row('화면 나누기 끝내기', 'ic_close', () => this.exitSplit()).tint('#FF3B30'));
    AnchoredMenu.show(anchor, false, rows, null);
  },
  assignPaneDocument(k, session) {
    const active = k === this.activeSlot, mine = active ? this.activeSession : this.panes[k].session;
    if (session === mine) return;
    const j = this.paneIndex(session);
    if (j >= 0) { this.swapSplitPanes(k, j); return; }
    if (active) { this.switchDocument(session); this.updateSplitUi(); } else this.setPaneDocument(k, session);
  },

  /** closeDocument hook: a document that is shown in a pane leaves the split first. */
  closeDocumentPane(s) {
    if (!this.isSplit()) return;
    const k = this.paneIndex(s); if (k < 0) return;
    if (this.panes.length > 2) { this.removePane(k); return; }
    if (k === this.activeSlot) this.activateSplitPane();
    this.exitSplit();
  },
};

function setDisplay(el, on) { el.style.display = on ? '' : 'none'; }

/** Builds the pane chip layer (call once from buildUi) and the touch -> activate hooks on the papers element. */
export function buildSplit(app, viewport) {
  app.panes = []; app.activeSlot = 0; app.splitLayout = 'cols'; app.splitSizes = { c: [1], r: [1] }; app.splitDivs = [];
  app._splitWanted = null; app._paneWanted = null; app._twoPageBeforeSplit = false;
  // read-only views used by older code: "the other pane" of a split
  const other = () => (app.panes.length ? app.panes.find((p, i) => i !== app.activeSlot) : null);
  Object.defineProperty(app, 'splitSession', { configurable: true, get() { const p = other(); return p ? p.session : null; } });
  Object.defineProperty(app, 'splitView', { configurable: true, get() { const p = other(); return p ? p.view : null; } });
  const bar = app.splitBar = h('div', { class: 'm-splitbar', dataset: { tag: 'split_bar' } }); bar.style.display = 'none';
  viewport.append(bar);
  const hook = e => {
    if (!app.isSplit()) return;
    const k = app.panes.findIndex(p => p.view.el.contains(e.target));
    if (k < 0 || k === app.activeSlot || (e.type === 'pointerdown' && app.panes[k].view._palmRejected(e))) return;
    app.activateSplitPane(k);
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { app.updateSplitArrows(); app.positionChips(); }).observe(app.papers);
  app.papers.addEventListener('pointerdown', hook, true);
  app.papers.addEventListener('wheel', hook, true);
}

export function installSplit(cls) { Object.assign(cls.prototype, methods); }
