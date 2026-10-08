// MainActivity part 4 (v3.15): split screen = two open documents side by side, each pane a full page view with its own page, zoom and ink.
//
// The app keeps ONE active document in `this.*` (renderer, store, currentPage, pageView = firstPageView, ...). A split adds a second
// page view (this.splitView) that shows `this.splitSession`. Touching the other pane makes it the active one by swapping the two
// view references (and the session fields) BEFORE the touch reaches the view, so every existing tool (pen, eraser, lasso, undo,
// thumbnails, page turns ...) keeps working on the pane that was touched, with no re-render and no lost zoom. The DOM position of a
// pane never changes on activation (it belongs to the element); "swap" only exchanges the flex order of the two elements.
import { h, icon as mkIcon } from './util.js';
import { AlertDialog } from './ui/alert.js';
import { AnchoredMenu, Row } from './ui/menu.js';
import { toast } from './ui/toast.js';

const WANT_MS = 3 * 60 * 1000;   // how long "open a second document" waits for the new document

const methods = {
  isSplit() { return this.splitSession != null; },

  /** Header / view-menu toggle. One document: offers to open a second one; two: splits; more: asks which one goes in the second pane. */
  toggleSplit() {
    if (this.splitSession) { this.exitSplit(); return; }
    if (this.renderer == null || this.activeSession == null) { toast('문서를 먼저 여세요'); return; }
    const others = this.sessions.filter(s => s !== this.activeSession);
    if (others.length === 0) {
      new AlertDialog.Builder().setTitle('화면 나누기')
        .setMessage('화면을 나누려면 문서가 두 개 필요합니다. 두 번째 문서를 열까요?\n(열면 지금 문서와 좌우로 나란히 표시됩니다)')
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
    if (Date.now() - w.at < WANT_MS && w.session !== s && this.sessions.includes(w.session) && !this.splitSession) { this.enterSplit(w.session); this.swapSplitPanes(); }
  },

  /** Shows `session` (an open document other than the active one) in a second pane next to the active document. */
  enterSplit(session) {
    if (this.renderer == null || !session || session === this.activeSession || !this.sessions.includes(session)) return;
    if (this.splitSession) { this.setSplitDocument(session); return; }
    this._twoPageBeforeSplit = this.twoPage;
    this.splitSession = session;
    if (this.twoPage) { this.twoPage = false; setDisplay(this.secondPageView.el, false); this.showPage(this.currentPage); }
    this.secondPageView.clearPage(); setDisplay(this.secondPageView.el, false);
    this.papers.classList.add('m-papers-split');
    this.firstPageView.el.style.order = '0'; this.splitView.el.style.order = '1';
    setDisplay(this.splitView.el, true);
    this.splitView.copyToolsFrom(this.firstPageView);
    this.splitView.resetZoom();
    this.splitView.setPageSwipeEnabled(this.swipeEnabled); this.splitView.setVerticalPageSwipe(this.verticalPageSwipe);
    this.applyMouseReadDrag(); this.applyEraserRadius();
    this.renderSplitPane();
    this.updateSplitUi(); this.updateTabs(); this.updateFloaters();
    toast('화면 나누기 · 필기할 화면을 터치하세요');
  },

  /** Leaves split mode; the active pane's document stays on screen. */
  exitSplit() {
    if (!this.splitSession) return;
    this._splitGen = (this._splitGen | 0) + 1;
    this.splitSession = null;
    this.papers.classList.remove('m-papers-split');
    this.splitView.clearPage(); setDisplay(this.splitView.el, false);
    this.firstPageView.el.style.order = ''; this.splitView.el.style.order = '';
    this.firstPageView.el.classList.remove('pane-active'); this.splitView.el.classList.remove('pane-active');
    if (this.splitBar) this.splitBar.style.display = 'none';
    this.applySplitRatio();
    const two = this._twoPageBeforeSplit; this._twoPageBeforeSplit = false;
    if (two) { this.twoPage = true; setDisplay(this.secondPageView.el, true); }
    if (this.renderer != null) this.showPage(this.currentPage);
    this.updateTabs(); this.updateFloaters(); this.updateSplitArrows();
    toast('화면 나누기를 끝냈습니다');
  },

  /** Puts another open document into the passive pane. */
  setSplitDocument(session) {
    if (!this.splitSession || !session || !this.sessions.includes(session)) return;
    if (session === this.activeSession) { this.swapSplitPanes(); return; }
    this.splitSession = session;
    this.splitView.resetZoom();
    this.renderSplitPane(); this.updateSplitUi(); this.updateTabs();
  },

  /** (Re)draws the passive pane from its session. */
  async renderSplitPane() {
    const session = this.splitSession; if (!session) return;
    const gen = this._splitGen = (this._splitGen | 0) + 1, view = this.splitView;
    const doc = session.renderer, page = Math.max(0, Math.min(session.page, doc.pageCount - 1));
    try {
      const canvas = this.cachedPage(doc, page) || await this.renderPage(doc, page);
      if (gen !== this._splitGen || session !== this.splitSession || view !== this.splitView) return;
      const store = session.store;
      view.setSpread(0, null);
      view.showPage(canvas, page, store.marks, store.strokes, store.translations); view.setAnnotationStore(store);
      view.setDarkPage(this.darkPage());
    } catch (e) { toast('페이지 표시 실패: ' + (e && e.message || e)); }
  },

  /** Exchanges the left / right position of the two documents. */
  /** Width of the left pane as a share of the screen (draggable divider, remembered). */
  splitRatio() { const r = this.recentPrefs ? this.recentPrefs.getFloat('split_ratio', 0.5) : 0.5; return Math.min(0.8, Math.max(0.2, r || 0.5)); },
  applySplitRatio(r = this.splitRatio()) {
    const a = this.firstPageView.el, b = this.splitView.el, div = this.splitDivider;
    const ord = (el, d) => (el.style.order === '' ? d : +el.style.order), aLeft = ord(a, 0) <= ord(b, 1), left = aLeft ? a : b, right = aLeft ? b : a;
    if (!this.splitSession) { a.style.flex = ''; b.style.flex = ''; if (div) div.style.display = 'none'; return; }
    left.style.flex = `${r} 1 0`; right.style.flex = `${1 - r} 1 0`;
    if (div) { div.style.display = 'block'; div.style.left = `${r * 100}%`; }
    const cells = this.splitBar && this.splitBar.children; if (cells && cells.length === 2) { cells[0].style.flex = `${r} 1 0`; cells[1].style.flex = `${1 - r} 1 0`; }
    this.updateSplitArrows();
  },

  swapSplitPanes() {
    if (!this.splitSession) return;
    const a = this.firstPageView.el, b = this.splitView.el, oa = a.style.order || '0';
    a.style.order = b.style.order || '1'; b.style.order = oa;
    this.updateSplitUi();
  },

  /** Makes the passive pane the active one (called when it is touched / scrolled, and from the tabs). */
  activateSplitPane() {
    if (!this.splitSession) return;
    this.commitInlineText(); this.onSelectionAdjustStarted(); this.stopInlinePlayer();
    if (this.searchOwner != null && this.searchOwner !== this.splitSession) this.closeSearch();
    const oldView = this.firstPageView, newView = this.splitView, oldSession = this.activeSession, newSession = this.splitSession;
    oldSession.page = this.currentPage;
    oldView.finishInkStroke();
    this.firstPageView = newView; this.splitView = oldView; this.pageView = newView;
    this.splitSession = oldSession; this.activeSession = newSession;
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

  /** Pane title chips (pick a document / swap / end) and the highlight of the active pane. */
  updateSplitUi() {
    this.updateSplitArrows();
    if (!this.splitBar) return;
    const on = !!this.splitSession;
    this.splitBar.style.display = on ? 'flex' : 'none';
    this.splitBar.replaceChildren();
    if (!on) return;
    const a = this.firstPageView, b = this.splitView;
    a.el.classList.add('pane-active'); b.el.classList.remove('pane-active');
    const panes = [{ view: a, session: this.activeSession, active: true }, { view: b, session: this.splitSession, active: false }];
    panes.sort((p, q) => (+p.view.el.style.order || 0) - (+q.view.el.style.order || 0));
    for (const p of panes) {
      const chip = h('button', { class: 'm-panechip' + (p.active ? ' active' : ''), type: 'button', title: '이 화면에 보일 문서 선택', 'aria-label': '화면 문서: ' + p.session.title, dataset: { tag: 'split_pane_chip' } },
        h('span', { class: 'm-panename' }, p.session.title), mkIcon('ic_chevron_down', 16, 'currentColor'));
      chip.addEventListener('click', () => this.showPaneMenu(chip, p.view));
      this.splitBar.append(h('div', { class: 'm-panecell' }, chip));
    }
    this.applySplitRatio();
  },

  /** In split view the page-turn arrows sit on the left and right edge of the ACTIVE pane instead of the whole window. */
  updateSplitArrows() {
    const pv = this.previousOverlay, nx = this.nextOverlay, papers = this.papers; if (!pv || !nx || !papers) return;
    if (!this.splitSession) { pv.style.left = ''; nx.style.right = ''; return; }
    const pane = this.firstPageView.el, w = papers.clientWidth;
    pv.style.left = (pane.offsetLeft + 8) + 'px'; nx.style.right = (w - pane.offsetLeft - pane.offsetWidth + 8) + 'px';
  },

  /** Document list for one pane + swap + end split. */
  showPaneMenu(anchor, view) {
    const mine = view === this.firstPageView ? this.activeSession : this.splitSession;
    const rows = this.sessions.map(s => new Row(s.title, 'ic_document_tab', () => this.assignPaneDocument(view, s)).tint('#007AFF').selected(s === mine));
    rows.push(Row.divider());
    rows.push(new Row('좌우 바꾸기', 'ic_swipe', () => this.swapSplitPanes()).tint('#5856D6'));
    rows.push(new Row('다른 문서 열기', 'ic_folder_open', () => { if (view !== this.firstPageView) this.activateSplitPane(); this.showLibrary(); }).tint('#8E8E93'));
    rows.push(new Row('화면 나누기 끝내기', 'ic_close', () => this.exitSplit()).tint('#FF3B30'));
    AnchoredMenu.show(anchor, false, rows, null);
  },
  assignPaneDocument(view, session) {
    const active = view === this.firstPageView, mine = active ? this.activeSession : this.splitSession, other = active ? this.splitSession : this.activeSession;
    if (session === mine) return;
    if (session === other) { this.swapSplitPanes(); return; }
    if (active) { this.switchDocument(session); this.updateSplitUi(); } else this.setSplitDocument(session);
  },
};

function setDisplay(el, on) { el.style.display = on ? '' : 'none'; }

/** Builds the pane chip bar (call once from buildUi) and the touch -> activate hooks on the papers element. */
export function buildSplit(app, viewport) {
  app.splitSession = null; app._splitWanted = null; app._twoPageBeforeSplit = false; app._splitGen = 0;
  const bar = app.splitBar = h('div', { class: 'm-splitbar', dataset: { tag: 'split_bar' } }); bar.style.display = 'none';
  viewport.append(bar);
  const hook = e => {
    if (!app.splitSession) return;
    const v = app.splitView;
    if (!v.el.contains(e.target) || (e.type === 'pointerdown' && v._palmRejected(e))) return;
    app.activateSplitPane();
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => app.updateSplitArrows()).observe(app.papers);
  const div = app.splitDivider = h('div', { class: 'm-splitdiv', title: '끌어서 두 화면의 너비 조절 (두 번 누르면 절반씩)', 'aria-label': '화면 너비 조절', dataset: { tag: 'split_divider' } }, h('span', { class: 'm-splitgrip' }));
  div.style.display = 'none'; app.papers.append(div);
  div.addEventListener('pointerdown', e => {
    if (!app.splitSession) return;
    e.preventDefault(); e.stopPropagation(); div.setPointerCapture(e.pointerId);
    const move = ev => { const rc = app.papers.getBoundingClientRect(); app._splitDrag = Math.min(0.8, Math.max(0.2, (ev.clientX - rc.left) / rc.width)); app.applySplitRatio(app._splitDrag); };
    const up = () => { div.removeEventListener('pointermove', move); div.removeEventListener('pointerup', up); div.removeEventListener('pointercancel', up); if (app._splitDrag != null) app.recentPrefs.putFloat('split_ratio', app._splitDrag); app._splitDrag = null; };
    div.addEventListener('pointermove', move); div.addEventListener('pointerup', up); div.addEventListener('pointercancel', up);
  });
  div.addEventListener('dblclick', () => { app.recentPrefs.putFloat('split_ratio', 0.5); app.applySplitRatio(0.5); });
  app.papers.addEventListener('pointerdown', hook, true);
  app.papers.addEventListener('wheel', hook, true);
}

export function installSplit(cls) { Object.assign(cls.prototype, methods); }
