// MainActivity port, part 1 = MainActivity.java lines 1-660 (+ the few shared helpers it needs).
// Boot (onCreate, host info, library, session restore, file args, drag&drop, Esc/back), buildUi, header/tabs/bars/dock, tools, menus,
// selection popup, translate/TTS, undo/redo, bookmarks, page turning (curl / slide / none, two-page view), OCR wiring.
// All methods keep the Java names and are assigned onto MainActivity.prototype by installMain1().
// Android -> web notes: Uri == absolute path string, PdfRenderer == PdfDoc (this.renderer), Bitmap == HTMLCanvasElement,
// sync file/bitmap work became async (showPage/openPdf return promises; state fields are updated early so callers may ignore them).
import { h, icon as mkIcon, setIcon, argb, RectF, sleep, baseName, joinPath, uuid } from './util.js';
import { prefs } from './prefs.js';
import { host } from './host.js';
import { AlertDialog, showActionSheet, BUTTON_POSITIVE, BUTTON_NEGATIVE, BUTTON_NEUTRAL } from './ui/alert.js';
import { AnchoredMenu, Row, Shortcut } from './ui/menu.js';
import { toast } from './ui/toast.js';
import { PdfDoc, ocrHook, TextRegion } from './pdfdoc.js';
import { PdfPageView } from './pageview.js';
import { PageCurlView, snapshotSlice, animateCurl, commitDecision, mirror, paperBack } from './curl.js';
import { AnnotationStore, Mark, OutlineItem, TranslationNote } from './store.js';
import { LibraryRepository, samePath } from './library.js';
import { FolderIconDrawable, ProgressDialog, rebindButton } from './library-dialog.js';
import * as office from './office.js';

// ------------------------------------------------------------------------------------------------ constants
const NAVY = 0xFF1C1C1E, ACCENT = 0xFF007AFF, ACTIVE_BG = 0xFFE5F0FF, ACTIVE_FG = 0xFF007AFF;
const INK_COLORS = [0xFF1C1C1E, 0xFF007AFF, 0xFFFF3B30, 0xFF16835B, 0xFF7C3AED, 0xFFEA580C, 0xFFDB2777];
const INK_WIDTHS = [0.0022, 0.004, 0.0065, 0.009];
const HIGHLIGHT_COLORS = [0x66FFDE59, 0x6654C27A, 0x66FF6B9A, 0x66549CF5, 0x66B67CF2];
const OFFICE_EXTS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'hwp', 'hwpx'];
const sameColor = (a, b) => (a | 0) === (b | 0);

// ------------------------------------------------------------------------------------------------ small helpers
/** Session record (Java DocumentSession). `uri` is the absolute file path. */
class DocumentSession {
  constructor() {
    this.uri = null; this.title = null; this.renderer = null; this.store = null; this.page = 0; this.officePreview = null;
    this.redoStrokes = []; this.textRegions = new Map();
  }
}

/** android View visibility helpers on an element. mode: 'visible' | 'invisible' | 'gone' */
function setVis(el, mode) {
  el.style.display = mode === 'gone' ? 'none' : '';
  el.style.visibility = mode === 'invisible' ? 'hidden' : '';
}
function isShown(view) { const s = view.el.style; return s.display !== 'none' && s.visibility !== 'hidden'; }
const isTyping = t => !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
const overlayOpen = () => !!document.querySelector('.ad-root,.amenu,.lib-root,.lib-prog');

/** segmented(labels, current, choose): row of pill chips (MainActivity.segmented). */
function segmentedView(labels, current, choose) {
  const row = h('div', { class: 'm-seg' });
  const chips = labels.map((label, i) => {
    const chip = h('div', { class: 'chip', role: 'button' }, label);
    chip.addEventListener('click', () => { choose(i); refresh(); });
    row.append(chip); return chip;
  });
  const refresh = () => chips.forEach((chip, i) => chip.classList.toggle('on', i === current()));
  refresh();
  return row;
}
/** swatches(colors, current, choose, size): colour dots (MainActivity.swatches). */
function swatchesView(colors, current, choose, size = 32) {
  const row = h('div', { class: 'm-sw' });
  const dots = colors.map((color, i) => {
    const dot = h('div', { class: 'dot', role: 'button', 'aria-label': '색상 ' + (i + 1), style: { width: size + 'px', height: size + 'px', background: argb(color | 0xFF000000) } });
    dot.addEventListener('click', () => { choose(color); refresh(); });
    row.append(dot); return dot;
  });
  const refresh = () => dots.forEach((dot, i) => {
    const on = sameColor(colors[i], current());
    dot.classList.toggle('on', on);
    const g = dot.querySelector('.ico'); if (g) g.remove();
    if (on) dot.append(mkIcon('ic_check', 24, '#fff'));
  });
  refresh();
  return row;
}

function blobToBase64(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
}
/** OCR through the host (Windows.Media.Ocr): canvas -> [{text,x,y,w,h,line}] in canvas pixels. */
async function ocrCanvas(canvas) {
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  if (!blob) return [];
  const res = await host.call('ocr.recognize', { png: await blobToBase64(blob), lang: 'auto' });
  return (res && res.words) || [];
}
const normalized = (r, w, hgt) => new RectF(Math.max(0, r.left / w), Math.max(0, r.top / hgt), Math.min(1, r.right / w), Math.min(1, r.bottom / hgt));

/** Words (pixel boxes) -> TextRegion[]; words sharing a `line` id (or a vertical position) form a line. */
function regionsFromWords(words, w, hgt) {
  const items = words.filter(x => x && x.text && String(x.text).trim() !== '' && isFinite(x.x) && isFinite(x.y));
  const lines = [];
  if (items.some(x => x.line == null)) {
    const sorted = items.slice().sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2) || a.x - b.x);
    for (const x of sorted) {
      const cy = x.y + x.h / 2;
      const L = lines.find(l => cy > l.top && cy < l.bottom);
      if (L) { L.words.push(x); L.top = Math.min(L.top, x.y); L.bottom = Math.max(L.bottom, x.y + x.h); } else lines.push({ top: x.y, bottom: x.y + x.h, words: [x] });
    }
  } else {
    const map = new Map();
    for (const x of items) { if (!map.has(x.line)) map.set(x.line, { words: [] }); map.get(x.line).words.push(x); }
    lines.push(...map.values());
  }
  const out = [];
  for (const L of lines) {
    L.words.sort((a, b) => a.x - b.x);
    const text = L.words.map(x => String(x.text).trim()).join(' ');
    const lb = new RectF(Infinity, Infinity, -Infinity, -Infinity);
    for (const x of L.words) { lb.left = Math.min(lb.left, x.x); lb.top = Math.min(lb.top, x.y); lb.right = Math.max(lb.right, x.x + x.w); lb.bottom = Math.max(lb.bottom, x.y + x.h); }
    const lineBox = normalized(lb, w, hgt);
    for (const x of L.words) out.push(new TextRegion(String(x.text).trim(), text, normalized(new RectF(x.x, x.y, x.x + x.w, x.y + x.h), w, hgt), lineBox));
  }
  return out;
}

function getVoices() {
  return new Promise(res => {
    const synth = window.speechSynthesis; if (!synth) { res([]); return; }
    const now = synth.getVoices(); if (now && now.length) { res(now); return; }
    let done = false;
    const fin = () => { if (done) return; done = true; synth.removeEventListener('voiceschanged', fin); res(synth.getVoices() || []); };
    synth.addEventListener('voiceschanged', fin); setTimeout(fin, 1500);
  });
}

/** PdfPageView.Listener of one page view; every callback first makes that view the active one (two-page spreads). */
function makePageListener(app) {
  const l = { view: null };
  const active = () => {
    if (l.view && app.renderer && app.pageView !== l.view) {
      app.pageView = l.view; app.currentPage = l.view.getPageNumber(); app.activeSession.page = app.currentPage;
      app.updateBookmarkButton(); app.refreshStudyPanel();
    }
  };
  for (const n of ['onHighlightCreated', 'onMarkTapped', 'onMemoPointRequested', 'onZoomGestureStarted', 'onPageSwipe', 'onOutlinePointRequested', 'onInkChanged',
    'onTextSelectionFinished', 'onTranslationTapped', 'onSelectionAdjustStarted', 'onLassoSelectionFinished', 'onElementTapped']) {
    l[n] = (...a) => { active(); return app[n](...a); };
  }
  l.onBlankLongPress = (page, x, y, viewX, viewY) => { active(); app.showInsertMenuAt(l.view, page, x, y, viewX, viewY); };
  return l;
}

/** PdfPageView.PageDrag: finger drag turns the page with the curl overlay. */
function makePageDrag(app) {
  return {
    start(direction) {
      if (app.pageAnimating || !app.renderer || app.verticalPageSwipe || app.pageAnimStyle() !== 0) return false;
      const target = app.twoPage ? Math.floor(app.currentPage / 2) * 2 + direction * 2 : app.currentPage + direction;
      if (target < 0 || target >= app.renderer.pageCount) return false;
      if (!app.pagesCached(target)) { app.ensurePages(target).catch(() => {}); return false; }   // not rendered yet: plain swipe (animated) instead
      app.pageAnimating = true;
      const curl = app.beginCurl(direction, target);
      if (!curl) { app.pageAnimating = app.curlConsumed; return false; }
      app.dragCurl = curl; app.dragSpan = Math.max(120, (curl._w || curl.width || 0) * (app.twoPage ? 0.5 : 1) * 1.1);
      return true;
    },
    touchAt(fraction) { if (app.dragCurl) app.dragCurl.setTouch(fraction); },
    move(distance) { if (app.dragCurl) app.dragCurl.setProgress(distance / app.dragSpan); },
    end(velocity) {
      if (!app.dragCurl) return;
      const curl = app.dragCurl; app.dragCurl = null;
      const p = curl.progress();
      app.finishCurl(curl, p, commitDecision(velocity, p) ? 1 : 0);
    },
  };
}

// ------------------------------------------------------------------------------------------------ init
export function initMain1(app) {
  Object.assign(app, {
    hostInfo: null, dockShown: false, _dockTimer: 0, _dockHideEnd: 0, writeBar: null, readBar: null,
    selectionPopup: null, speech: null, speechReady: false, speechPending: null, speechLocale: 'en-US',
    pendingSource: null, pendingBounds: null, pendingSession: null, pendingPage: 0,
    awaitingOfficeReturn: false, officeConverting: false, hwpConversion: null, officeToken: null,
    dragCurl: null, curlOrigin: 0, dragSpan: 120, curlConsumed: false, _showGen: 0, _prefetchGen: 0, _textSelectWanted: false,
    descriptor: null,
  });
  if (app.inlineElement === undefined) app.inlineElement = null;
  app.dockHider = () => app.hideFullscreenDock(true);
  app.pageDragHandler = makePageDrag(app);
}

// ------------------------------------------------------------------------------------------------ methods
const methods = {
  // ============================================================ lifecycle
  /** Android onCreate(): host info, library, preferences, UI, session restore / file arguments. */
  async onCreate() {
    let info = {};
    try { info = (await host.info()) || {}; } catch (e) { console.error(e); }
    this.hostInfo = info;
    const p = this.recentPrefs;
    this.verticalPageSwipe = p.getBoolean('vertical_page_swipe', false);
    this.fingerInk = p.getBoolean('finger_ink', false);
    this.swipeEnabled = p.getBoolean('page_swipe_enabled_v2', true);
    this.twoPage = p.getBoolean('two_page', false);
    this.library = new LibraryRepository();
    await this.library.ready;
    this.libraryFolder = this.library.root;
    this.lassoShape = p.getInt('lasso_shape', PdfPageView.LASSO_FREE);
    this.showAllThumbnails = p.getBoolean('thumb_all', false);
    this.buildUi();
    this.pageView.setLassoShape(this.lassoShape);
    this.applyDarkPage();
    this.pageView.setFingerInk(this.fingerInk);
    this.pageView.setPageSwipeEnabled(this.swipeEnabled);
    this.pageView.setVerticalPageSwipe(this.verticalPageSwipe);
    this.syncOtherTools();
    ocrHook.fn = async canvas => { try { return await ocrCanvas(canvas); } catch (e) { host.log('ocr: ' + (e && e.message)); return []; } };
    this.installGlobalHandlers();
    this.applyKeepAwake();
    const args = (info.args || []).filter(Boolean);
    let restored = false;
    try { restored = await this.restoreSession(); } catch (e) { console.error(e); }
    host.log('boot: args=' + JSON.stringify(args) + ' restored=' + restored);
    for (const a of args) { try { await this.openPdf(a); host.log('boot: opened ' + a + ' sessions=' + this.sessions.length); } catch (e) { host.log('boot: open failed ' + (e && e.stack || e)); } }
    if (!args.length && !restored) this.showWelcome();
    window.dispatchEvent(new Event('pdfnote-ready'));
  },

  /** Keyboard (Esc = back), focus (= onResume), host open.file events, file drag&drop, fullscreen sync. */
  installGlobalHandlers() {
    host.on('open.file', d => { if (d && d.path) this.openPdf(d.path); });
    window.addEventListener('keydown', e => this.onKeyDown(e));
    window.addEventListener('focus', () => this.onResume());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.onResume(); });
    window.addEventListener('resize', () => { try { this.layoutStudyPanel(); } catch (err) { /* part 2 */ } });
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && this.fullscreen && !host.native) this.toggleFullscreen(); });
    const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    window.addEventListener('dragover', e => { if (hasFiles(e) && !e.defaultPrevented && this._droppableDocs(e.dataTransfer)) e.preventDefault(); });
    window.addEventListener('drop', e => { if (!hasFiles(e) || e.defaultPrevented) return; const files = this._documentFiles(e.dataTransfer); if (!files.length) return; e.preventDefault(); this.openDroppedFiles(files); });
    // desktop: moving the mouse to the very bottom edge in full screen brings the dock back (the touch swipe-up has no mouse twin)
    window.addEventListener('pointermove', e => {
      if (this.fullscreen && this.fullscreenDock && !this.dockShown && e.pointerType === 'mouse' && e.clientY >= window.innerHeight - 4) this.showFullscreenDock(false);
    });
    window.addEventListener('pagehide', () => { try { this.saveSessionState(); AnnotationStore.flushAll(); } catch (e) { /* ignore */ } });
  },
  _documentFiles(dt) { return [...(dt.files || [])].filter(f => OFFICE_EXTS.includes((/\.([^.]+)$/.exec(f.name) || [])[1]?.toLowerCase())); },
  _droppableDocs(dt) {
    const items = [...(dt.items || [])]; if (!items.length) return true;
    return items.some(i => i.kind === 'file' && (i.type === 'application/pdf' || i.type === '' || /officedocument|msword|ms-excel|ms-powerpoint|hwp|hancom/.test(i.type)));
  },
  /** Files dropped from Explorer arrive as File objects: write them to a temp folder and open that path. */
  async openDroppedFiles(files) {
    for (const f of files) {
      let dir = null;
      try {
        const temp = (this.hostInfo && this.hostInfo.temp) || joinPath((this.hostInfo && this.hostInfo.data) || 'C:\\', 'tmp');
        dir = joinPath(temp, 'drop-' + uuid());
        await host.mkdir(dir).catch(() => {});
        const path = joinPath(dir, f.name.replace(/[\\/:*?"<>|]/g, '_'));
        await host.writeBytes(path, new Uint8Array(await f.arrayBuffer()));
        await this.openPdf(path);
      } catch (e) { toast('문서 열기 실패: ' + (e && e.message || e)); }
      finally { if (dir) host.delete(dir).catch(() => {}); }
    }
  },

  onKeyDown(e) {
    if (e.defaultPrevented) return;
    if (e.key === 'Escape') { if (overlayOpen() || isTyping(e.target) && this.inlineElement == null && !(this.searchPanel && this.searchPanel.contains(e.target))) return; if (this.onBackPressed()) e.preventDefault(); return; }
    if (isTyping(e.target) || overlayOpen()) return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'F11') { e.preventDefault(); this.toggleFullscreen(); return; }
    if (ctrl && !e.altKey) {
      const k = e.key.toLowerCase(); let used = true;
      if (k === 'o') this.choosePdf();
      else if (k === 'f') this.searchDocument();
      else if (k === 'g') this.goToPage();
      else if (k === 'z' && !e.shiftKey) this.undoInk();
      else if (k === 'y' || (k === 'z' && e.shiftKey)) this.redoInk();
      else if (k === 'w' && this.activeSession) this.closeDocument(this.activeSession);
      else if (e.key === 'Tab' && this.sessions.length > 1) {
        const i = this.sessions.indexOf(this.activeSession), n = this.sessions.length;
        this.switchDocument(this.sessions[(i + (e.shiftKey ? n - 1 : 1)) % n]);
      } else used = false;
      if (used) e.preventDefault();
      return;
    }
    if (e.altKey || !this.renderer) return;
    const vert = this.verticalPageSwipe;
    if (e.key === 'PageDown' || e.key === (vert ? 'ArrowDown' : 'ArrowRight')) { e.preventDefault(); this.animatePage(1); }
    else if (e.key === 'PageUp' || e.key === (vert ? 'ArrowUp' : 'ArrowLeft')) { e.preventDefault(); this.animatePage(-1); }
  },

  applyKeepAwake() { host.call('power.keepAwake', { on: this.recentPrefs.getBoolean('keep_awake', false) }).catch(() => {}); },

  onResume() {
    this.applyKeepAwake();
    if (this.awaitingOfficeReturn) {
      this.awaitingOfficeReturn = false;
      setTimeout(() => new AlertDialog.Builder().setTitle('문서로 돌아왔습니다')
        .setMessage('문서 앱에서 PDF로 내보냈다면 파일을 가져와 필기와 주석을 이어갈 수 있습니다.')
        .setPositiveButton('PDF 가져오기', () => this.chooseConvertedPdf()).setNegativeButton('나중에', null).show(), 0);
    }
  },

  dp(n) { return n; },

  // ============================================================ UI construction
  /** ImageButton made by icon(): glyph drawn at 24px in the centre, tinted with `tint` (ARGB int). */
  icon(name, label, tint, click, cls = 'm-ib') {
    const b = h('button', { class: cls, type: 'button', 'aria-label': label, title: label });
    b.append(mkIcon(name, 24, 'currentColor'));
    if (tint != null) b.style.color = argb(tint);
    b.addEventListener('click', () => click(b));
    return b;
  },
  dockIcon(name, description, tint, action) { return this.icon(name, description, tint, action, 'm-dockbtn'); },
  barIcon(bar, name, description, tint, action) {
    const b = this.icon(name, description, tint, action, 'm-tb');
    this.baseTint.set(b, tint); bar.append(b); return b;
  },

  buildUi() {
    const root = this.root = h('div', { class: 'm-root', dataset: { tag: 'root' } });
    const content = h('div', { class: 'm-content' });
    root.append(content);

    // ---- header (52)
    this.header = h('div', { class: 'm-header', dataset: { tag: 'header' } });
    const libraryButton = h('button', { class: 'm-libbtn', type: 'button', 'aria-label': '문서함', title: '문서함' });
    libraryButton.append(new FolderIconDrawable(LibraryRepository.FOLDER_COLORS[1], 30).el());
    libraryButton.addEventListener('click', () => this.showLibrary());
    this.titleView = h('div', { class: 'm-title', dataset: { tag: 'document_title' }, role: 'button' });
    this.titleView.addEventListener('click', () => { if (this.activeSession != null) this.renameDocument(this.activeSession); else this.showLibrary(); });
    this.header.append(libraryButton, this.titleView, h('div', { class: 'm-spacer' }),
      this.icon('ic_thumbnails', '페이지 목록', 0xFF007AFF, () => this.toggleSidebar()),
      this.icon('ic_search', '문서·필기 검색', 0xFF30B0C7, () => this.searchDocument()),
      this.icon('ic_fullscreen', '전체 화면', 0xFFAF52DE, () => this.toggleFullscreen()),
      this.icon('ic_more_vert', '도구', NAVY, v => this.showMainMenu(v, false)));
    content.append(this.header);

    // ---- tab strip (40)
    this.tabStrip = h('div', { class: 'm-tabstrip', dataset: { tag: 'tab_strip' } });
    this.tabRow = h('div', { class: 'm-tabrow' });
    this.tabStrip.append(this.tabRow);
    this.tabStrip.addEventListener('wheel', e => { if (e.deltaX === 0 && e.deltaY !== 0) { this.tabStrip.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
    content.append(this.tabStrip);

    // ---- viewer row: side panel (built by part 3) + viewport
    const viewerRow = h('div', { class: 'm-viewer' });
    this.thumbnailPanel = h('div', { class: 'm-thumbpanel', style: { background: '#F2F2F7', overflowY: 'auto', height: '100%', width: '100%' } });
    this.thumbnailList = h('div', { class: 'm-thumblist', style: { position: 'relative', display: 'flex', flexDirection: 'column', padding: '14px 8px 96px' } });
    this.thumbnailPanel.append(this.thumbnailList);
    this.buildSearchPanel(); this.buildSidePanel();
    if (this.sidePanel) { this.sidePanel.style.flex = 'none'; this.sidePanel.style.height = '100%'; if (!this.sidePanel.style.width) this.sidePanel.style.width = this.sidePanelWidth() + 'px'; viewerRow.append(this.sidePanel); }

    const viewport = this.viewportLayer = h('div', { class: 'm-viewport', dataset: { tag: 'viewport' } });
    this.installViewportSwipe(viewport);
    this.installDrop(viewport);
    const papers = this.papers = h('div', { class: 'm-papers' });
    const firstListener = makePageListener(this), secondListener = makePageListener(this);
    this.firstPageView = new PdfPageView(firstListener); this.secondPageView = new PdfPageView(secondListener);
    firstListener.view = this.firstPageView; secondListener.view = this.secondPageView;
    this.pageView = this.firstPageView;
    this.firstPageView.setPageDrag(this.pageDragHandler); this.secondPageView.setPageDrag(this.pageDragHandler);
    papers.append(this.firstPageView.el, this.secondPageView.el);
    setVis(this.secondPageView.el, this.twoPage ? 'visible' : 'gone');
    viewport.append(papers);

    this.previousOverlay = h('button', { class: 'm-arrow prev', type: 'button', 'aria-label': '이전 페이지', title: '이전 페이지' }, mkIcon('ic_chevron_left', 24, argb(NAVY)));
    this.nextOverlay = h('button', { class: 'm-arrow next', type: 'button', 'aria-label': '다음 페이지', title: '다음 페이지' }, mkIcon('ic_chevron_right', 24, argb(NAVY)));
    this.previousOverlay.addEventListener('click', () => this.animatePage(-1));
    this.nextOverlay.addEventListener('click', () => this.animatePage(1));
    viewport.append(this.previousOverlay, this.nextOverlay);
    this.buildLassoBar();
    if (this.lassoBar) viewport.append(h('div', { class: 'm-lassowrap' }, this.lassoBar));
    viewerRow.append(viewport);

    this.pdfArea = h('div', { class: 'm-pdfarea' }, viewerRow);
    this.studySplit = h('div', { class: 'm-split', dataset: { tag: 'study_split' } }, this.pdfArea);
    this.buildStudyPanel();
    if (this.studyPanel) this.studySplit.append(this.studyPanel);
    content.append(this.studySplit);
    this.layoutStudyPanel();

    // ---- bottom bar (54)
    this.bottomBar = h('div', { class: 'm-bottom', dataset: { tag: 'reading_toolbar' } });
    const readBar = this.readBar = h('div', { class: 'm-bar', dataset: { tag: 'read_bar' } });
    const writeBar = this.writeBar = h('div', { class: 'm-bar', dataset: { tag: 'writing_toolbar' } });
    writeBar.style.display = 'none';
    this.pageLabel = h('div', { class: 'm-pagelabel', role: 'button', 'aria-label': '페이지 번호 · 눌러 이동', title: '페이지 번호 · 눌러 이동', dataset: { tag: 'page_indicator' } });
    this.pageLabel.addEventListener('click', () => { if (this.renderer == null) this.showAddDocumentMenu(); else this.goToPage(); });
    readBar.append(this.pageLabel);
    this.barIcon(readBar, 'ic_outline', '문서 개요', 0xFF007AFF, () => this.showOutlineList());
    this.barIcon(readBar, 'ic_thumbnails', '보기 방법', 0xFF30B0C7, v => this.showViewMenu(v));
    this.bookmarkButton = this.barIcon(readBar, 'ic_star_outline', '즐겨찾기', 0xFFF5A623, () => this.toggleBookmark());
    this.barIcon(readBar, 'ic_insert', '삽입 · 사진 스티커 도형 표', 0xFFFF2D55, v => this.showInsertMenu(v));
    this.inkButton = this.barIcon(readBar, 'ic_ink', '필기 모드', 0xFF5856D6, () => this.setWriteMode(true));
    this.barIcon(writeBar, 'ic_book', '읽기 모드', 0xFF007AFF, () => this.setWriteMode(false));
    this.penButton = this.barIcon(writeBar, 'ic_ink', '펜', 0xFF1C1C1E, v => this.penTap(v));
    this.hlButton = this.barIcon(writeBar, 'ic_highlight', '형광펜', 0xFFF5C400, v => this.highlightTap(v));
    this.eraserButton = this.barIcon(writeBar, 'ic_eraser', '지우개', 0xFFFF6B8A, () => { if (this.renderer == null) toast('문서를 먼저 여세요'); else this.setInkMode(2); });
    this.lassoButton = this.barIcon(writeBar, 'ic_lasso', '올가미 선택', 0xFFAF52DE, () => this.toggleLasso());
    this.textButton = this.barIcon(writeBar, 'ic_text', '타이핑', 0xFF34C759, () => this.toggleTyping());
    this.memoButton = this.barIcon(writeBar, 'ic_note_add', '메모 추가', 0xFFFF9500, () => this.toggleMemoMode());
    this.barIcon(writeBar, 'ic_insert', '삽입 · 사진 스티커 도형 표', 0xFFFF2D55, v => this.showInsertMenu(v));
    this.barIcon(writeBar, 'ic_undo', '실행 취소', 0xFF8E8E93, () => this.undoInk());
    this.barIcon(writeBar, 'ic_redo', '다시 실행', 0xFF8E8E93, () => this.redoInk());
    this.bottomBar.append(readBar, writeBar);
    content.append(this.bottomBar);

    // ---- fullscreen dock + handle (overlays of root)
    const dock = this.fullscreenDock = h('div', { class: 'm-dock', dataset: { tag: 'fullscreen_toolbar' } });
    dock.append(
      this.dockIcon('ic_outline', '전체 화면 개요', NAVY, () => this.showOutlineList()),
      this.dockIcon('ic_thumbnails', '전체 화면 보기 방법', NAVY, v => this.showViewMenu(v)),
      this.dockIcon('ic_ink', '전체 화면 필기도구', NAVY, v => this.penTap(v)),
      this.dockIcon('ic_note_add', '전체 화면 메모 추가', NAVY, () => this.toggleMemoMode()),
      this.dockIcon('ic_insert', '전체 화면 삽입', NAVY, v => this.showInsertMenu(v)),
      this.dockIcon('ic_text', '전체 화면 타이핑', NAVY, () => this.toggleTyping()),
      this.dockIcon('ic_lasso', '전체 화면 올가미', NAVY, () => this.toggleLasso()),
      this.dockIcon('ic_more_vert', '전체 화면 메뉴', NAVY, v => this.showMainMenu(v, true)),
      this.fullscreenExit = this.dockIcon('ic_fullscreen_exit', '전체 화면 종료', NAVY, () => this.toggleFullscreen()));
    root.append(h('div', { class: 'm-dockwrap' }, dock));
    const rearm = () => { if (this.dockShown) { clearTimeout(this._dockTimer); this._dockTimer = setTimeout(this.dockHider, 6000); } };
    const hold = () => { if (this.dockShown) clearTimeout(this._dockTimer); };
    dock.addEventListener('pointerdown', hold); dock.addEventListener('pointerup', rearm); dock.addEventListener('pointercancel', rearm);
    dock.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') hold(); });
    dock.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') rearm(); });
    this.dockHandle = h('div', { class: 'm-dockhandle', dataset: { tag: 'fullscreen_handle' }, 'aria-label': '도구 모음 열기 · 위로 쓸어올리기' });
    this.dockHandle.addEventListener('click', () => this.showFullscreenDock(false));
    root.append(this.dockHandle);

    const mount = document.getElementById('app') || document.body;
    mount.append(root);
    this.showWelcome();
  },

  /** In full screen a finger swipe up from the bottom area brings the tool dock back (viewport touch interception). */
  installViewportSwipe(viewport) {
    let downX = 0, downY = 0, tracking = false, stolen = false;
    viewport.addEventListener('pointerdown', e => {
      if (!e.isTrusted) return;
      if (!this.fullscreen || !this.fullscreenDock) { stolen = false; return; }
      const r = viewport.getBoundingClientRect();
      downX = e.clientX; downY = e.clientY; stolen = false;
      tracking = !this.dockShown && e.pointerType === 'touch' && !(this.inkMode !== 0 && this.fingerInk) && (downY - r.top) > r.height - 170;
    }, true);
    viewport.addEventListener('pointermove', e => {
      if (!e.isTrusted || !this.fullscreen || !this.fullscreenDock) return;
      if (tracking && !stolen) {
        const dy = downY - e.clientY, dx = Math.abs(e.clientX - downX);
        if (dy > 30 && dy > dx * 1.4) {
          stolen = true; this.showFullscreenDock(false);
          e.target.dispatchEvent(new PointerEvent('pointercancel', { pointerId: e.pointerId, pointerType: e.pointerType, bubbles: true, cancelable: true }));
          e.stopPropagation(); return;
        }
      }
      if (stolen) e.stopPropagation();
    }, true);
    const end = e => { if (!e.isTrusted) return; if (stolen) { stolen = false; tracking = false; e.stopPropagation(); } };
    viewport.addEventListener('pointerup', end, true); viewport.addEventListener('pointercancel', end, true);
  },

  sidePanelWidth() { return Math.min(190, Math.round(window.innerWidth * 0.42)); },

  // ============================================================ write mode / tool buttons
  /** Samsung Notes style: reading mode shows page tools, writing mode shows pen tools. */
  setWriteMode(on) {
    if (on && this.renderer == null) { toast('문서를 먼저 여세요'); return; }
    this.writeMode = on;
    this.readBar.style.display = on ? 'none' : '';
    this.writeBar.style.display = on ? '' : 'none';
    if (on) { if (this.inkMode === 0 && !this.highlightMode && !this.memoMode && !this.outlineMode && !this.pageView.isLassoMode()) this.setInkMode(1); else this.updateToolStates(); }
    else if (this.renderer != null) this.setInkMode(0); else this.updateToolStates();
  },
  penTap(anchor) {
    if (this.renderer == null) { toast('문서를 먼저 여세요'); return; }
    if (!this.writeMode) { this.setWriteMode(true); return; }
    if (!this.highlightMode && (this.inkMode === 1 || this.inkMode === 3)) this.showPenMenu(anchor); else this.setInkMode(1);
  },
  highlightTap(anchor) {
    if (this.renderer == null) { toast('문서를 먼저 여세요'); return; }
    if (this.highlightMode) this.showHighlightMenu(anchor); else this.toggleHighlight();
  },
  widthIndex() {
    let best = 0;
    for (let i = 0; i < INK_WIDTHS.length; i++) if (Math.abs(INK_WIDTHS[i] - this.inkWidth) < Math.abs(INK_WIDTHS[best] - this.inkWidth)) best = i;
    return best;
  },
  showPenMenu(anchor) {
    const box = h('div', { class: 'm-menubox', style: { padding: '4px 2px 0' } });
    box.append(segmentedView(['얇게', '보통', '굵게', '최대'], () => this.widthIndex(), i => {
      this.inkWidth = INK_WIDTHS[i]; this.pageView.setInkTool(this.inkMode, this.inkColor, this.inkWidth); this.syncOtherTools();
    }));
    box.append(swatchesView(INK_COLORS, () => this.inkColor, c => {
      this.inkColor = c; this.pageView.setInkTool(this.inkMode, this.inkColor, this.inkWidth); this.syncOtherTools(); this.updateInkButton();
    }, 25));
    AnchoredMenu.show(anchor, true, [
      Row.custom(box), Row.divider(),
      new Row('직선', 'ic_line', () => this.setInkMode(3)).selected(this.inkMode === 3).tint(argb(this.inkColor | 0xFF000000)),
      new Row('손가락 필기', 'ic_ink', () => this.toggleFingerInk()).tint('#007AFF').selected(this.fingerInk)], null);
  },
  showHighlightMenu(anchor) {
    const box = h('div', { class: 'm-menubox', style: { padding: '6px 2px 0' } });
    box.append(swatchesView(HIGHLIGHT_COLORS, () => this.selectedColor, c => {
      this.selectedColor = c; this.pageView.setHighlightMode(this.highlightMode, this.selectedColor); this.syncOtherTools(); this.updateInkButton();
    }, 30));
    AnchoredMenu.show(anchor, true, [Row.custom(box)], null);
  },

  // ============================================================ menus
  showViewMenu(anchor) {
    if (this.renderer == null) { toast('문서를 먼저 여세요'); return; }
    AnchoredMenu.show(anchor, true, [
      new Row('페이지 미리보기', 'ic_thumbnails', () => this.toggleSidebar()).tint('#007AFF').selected(this.sidebarVisible),
      new Row('두 쪽 보기', 'ic_book', () => this.toggleTwoPage()).tint('#5856D6').selected(this.twoPage),
      new Row('페이지로 이동', 'ic_page', () => this.goToPage()).tint('#30B0C7'),
      new Row('전체 화면', 'ic_fullscreen', () => this.toggleFullscreen()).tint('#AF52DE'),
      new Row('여백 자르기', 'ic_scan', () => {
        this.recentPrefs.putBoolean('crop_margins', !this.cropMargins()); this.applyCrop();
        toast(this.cropMargins() ? '문서 여백을 잘라 화면에 꽉 채웁니다' : '원래 여백을 그대로 보여줍니다');
      }).tint('#34C759').selected(this.cropMargins()),
      new Row('검은 문서 배경', 'ic_circle', () => this.toggleDarkPage()).tint('#3A3A3C').selected(this.darkPage()),
      new Row('페이지 넘김 설정', 'ic_sliders', () => this.choosePageSwipeDirection()).tint('#8E8E93'),
      new Row('넘김 효과', 'ic_sliders', () => this.choosePageAnimation()).tint('#8E8E93'),
      Row.divider(),
      new Row('페이지 추가', 'ic_note_add', () => this.choosePageToInsert(this.currentPage)).tint('#34C759'),
      new Row('페이지 삭제', 'ic_delete', () => this.confirmDeletePage(this.currentPage)).danger()], null);
  },
  rowsOf(category) {
    return this.categoryTiles(category).map(t => {
      const r = new Row(t.label, t.icon, t.action).selected(!!t.selected);
      if (t.tint) r.danger();
      return r;
    });
  },
  /** Compact top-right menu: the common actions, with the long tail grouped into sub menus. */
  showMainMenu(anchor, above) {
    const doc = this.renderer != null, awake = this.recentPrefs.getBoolean('keep_awake', false);
    const rows = [];
    rows.push(new Row('문서 추가', 'ic_note_add', () => this.showAddDocumentMenu()).tint('#007AFF'));
    rows.push(new Row('새 노트', 'ic_compose', () => this.newNotebook()).tint('#34C759'));
    if (this.activeSession != null) rows.push(new Row('이름 변경', 'ic_text', () => this.renameDocument(this.activeSession)).tint('#8E8E93'));
    if (doc) {
      rows.push(Row.divider());
      rows.push(new Row('메모·하이라이트', 'ic_highlight', () => this.showMarkList()).tint('#FF9500'));
      rows.push(new Row('책갈피 목록', 'ic_star', () => this.showBookmarks()).tint('#F5A623'));
      rows.push(new Row('번역 포스트잇', 'ic_translate', () => this.showTranslations()).tint('#AF52DE'));
      rows.push(new Row('삽입', 'ic_copy', () => AnchoredMenu.show(anchor, above, this.rowsOf(2), null)).tint('#5856D6').submenu());
      rows.push(new Row('학습·주석', 'ic_scan', () => AnchoredMenu.show(anchor, above, this.rowsOf(3), null)).tint('#30B0C7').submenu());
      rows.push(new Row('내보내기·백업', 'ic_share', () => AnchoredMenu.show(anchor, above, this.rowsOf(4), null)).tint('#007AFF').submenu());
    }
    rows.push(Row.divider());
    rows.push(new Row('화면 켜 둠', 'ic_clock', () => {
      this.recentPrefs.putBoolean('keep_awake', !awake); this.applyKeepAwake();
      toast(!awake ? '읽는 동안 화면이 꺼지지 않습니다' : '화면 자동 꺼짐을 따릅니다');
    }).tint('#8E8E93').selected(awake));
    rows.push(new Row('사용법', 'ic_outline', () => this.showHelp()).tint('#8E8E93'));
    const shortcuts = [];
    shortcuts.push(new Shortcut('문서함', 'ic_folder_open', false, () => this.showLibrary()));
    shortcuts.push(new Shortcut('문서·필기 검색', 'ic_search', false, () => this.searchDocument()));
    if (doc) { const marked = this.store.bookmarks.has(this.currentPage); shortcuts.push(new Shortcut('즐겨찾기', marked ? 'ic_star' : 'ic_star_outline', marked, () => this.toggleBookmark())); }
    AnchoredMenu.show(anchor, above, rows, shortcuts);
  },

  showWelcome() {
    if (this.writeMode) { this.writeMode = false; this.readBar.style.display = ''; this.writeBar.style.display = 'none'; }
    setVis(this.previousOverlay, 'gone'); setVis(this.nextOverlay, 'gone');
    this.titleView.textContent = 'PDF Note';
    this.pageLabel.textContent = '문서 열기';
  },

  // ============================================================ sessions persistence
  saveSessionState() {
    if (this.restoringSessions || this.importing.size) return;
    try {
      const a = this.sessions.map(s => ({ uri: s.uri, page: s === this.activeSession ? this.currentPage : s.page, text_only: s.officePreview != null }));
      this.recentPrefs.putString('open_sessions', JSON.stringify(a));
      this.recentPrefs.putString('active_uri', this.activeSession == null ? '' : this.activeSession.uri);
    } catch (e) { /* ignore */ }
  },
  async restoreSession() {
    const raw = this.recentPrefs.getString('open_sessions', null);
    if (raw == null) return false;
    this.restoringSessions = true;
    try {
      const saved = JSON.parse(raw), active = this.recentPrefs.getString('active_uri', '');
      for (const entry of saved) {
        if (!entry || !entry.uri) continue;
        try { if (!(await host.exists(entry.uri))) continue; } catch (e) { continue; }   // file deleted since last run: skip silently
        await this.openPdf(entry.uri, !!entry.text_only, Math.max(0, entry.page | 0), entry.uri === active);
      }
    } catch (e) { console.error(e); } finally { this.restoringSessions = false; }
    if (this.importing.size === 0) this.saveSessionState();
    return this.sessions.length > 0 || this.importing.size > 0;
  },

  // ============================================================ file choosing / routing
  async choosePdf() {
    let files = [];
    try { files = await host.openDialog('문서 열기', [{ name: 'PDF·Office·한글 문서', exts: OFFICE_EXTS }], true); } catch (e) { toast('문서 열기 실패: ' + (e && e.message || e)); return; }
    for (const f of files || []) await this.openPdf(f);
  },
  async chooseConvertedPdf() {
    let files = [];
    try { files = await host.openDialog('PDF 가져오기', [{ name: 'PDF', exts: ['pdf'] }], false); } catch (e) { toast('문서 열기 실패: ' + (e && e.message || e)); return; }
    if (files && files[0]) await this.openPdf(files[0]);
  },
  isOfficeDocument(name) { return office.isOfficeDocument(name); },
  canConvertOffice(name) { return office.canConvertOffice(name); },
  queryName(uri) { const n = baseName(String(uri || '')); return n || 'PDF'; },

  /** Imports a converted temporary PDF straight into the app library. Returns the saved path. */
  async importConverted(pdf, sourceName) {
    let base = sourceName.replace(/\.(hwpx?|docx?|pptx?|xlsx?)$/i, '').replace(/[\\/:*?"<>|]/g, '_');
    if (base.trim() === '') base = '문서';
    return this.library.importPdf(pdf, base + '.pdf', await this.importDestination());
  },
  async importDestination() {
    try { if (this.libraryFolder && (await host.stat(this.libraryFolder)).isDir) return this.libraryFolder; } catch (e) { /* fall through */ }
    return this.library.root;
  },
  async tempFile(ext) {
    const dir = (this.hostInfo && this.hostInfo.temp) || joinPath((this.hostInfo && this.hostInfo.data) || 'C:\\', 'tmp');
    await host.mkdir(dir).catch(() => {});
    return joinPath(dir, 'conv-' + uuid() + ext);
  },

  async convertHwp(source, name) {
    if (this.officeConverting) { toast('다른 문서를 변환하고 있습니다'); return; }
    this.officeConverting = true;
    const token = office.makeCancelToken(); this.officeToken = token;
    const status = h('div', { class: 'm-statusview' }, '한글 문서를 준비하고 있습니다');
    const dialog = new AlertDialog.Builder().setTitle('한글 문서 → PDF').setView(status).setCancelable(false).setNegativeButton('취소', null).create();
    dialog.show();
    rebindButton(dialog, BUTTON_NEGATIVE, () => { token.cancel(); this.officeToken = null; this.officeConverting = false; dialog.dismiss(); });
    let pdf = null;
    try {
      const bytes = await host.readBytes(source);
      pdf = await office.convertHwp(bytes, t => { status.textContent = t; }, token);
      if (token.cancelled) return;
    } catch (e) {
      if (token.cancelled || (e && e.cancelled)) { this.officeConverting = false; return; }
      this.officeToken = null; this.officeConverting = false; dialog.dismiss();
      new AlertDialog.Builder().setTitle('한글 문서 변환 실패').setMessage('PDF 변환을 완료하지 못했습니다.\n\n' + (e && e.message || e))
        .setPositiveButton('다른 방법으로 열기', () => this.offerOfficeImport(source, name)).setNegativeButton('닫기', null).show();
      return;
    }
    this.officeToken = null; status.textContent = '문서함에 저장하는 중';
    dialog.getButton(BUTTON_NEGATIVE).classList.add('m-dim-btn');
    let tmp = null;
    try {
      tmp = await this.tempFile('.pdf'); await host.writeBytes(tmp, pdf);
      const saved = await this.importConverted(tmp, name);
      this.officeConverting = false; dialog.dismiss();
      await this.openPdf(saved); toast('문서함에 PDF로 변환해 저장했습니다');
    } catch (e) { this.officeConverting = false; dialog.dismiss(); toast('PDF 저장 실패: ' + (e && e.message || e)); }
    finally { if (tmp) host.delete(tmp).catch(() => {}); }
  },

  async convertOffice(source, name) {
    if (this.officeConverting) { toast('다른 문서를 변환하고 있습니다'); return; }
    this.officeConverting = true;
    const token = office.makeCancelToken(); this.officeToken = token;
    let finished = false, timer = 0;
    const status = h('div', { class: 'm-statusview' }, '문서를 준비하고 있습니다');
    const progress = new AlertDialog.Builder().setTitle('PDF로 변환').setView(status).setCancelable(false).setNegativeButton('취소', null).create();
    progress.show();
    const abort = () => { if (finished) return; finished = true; clearTimeout(timer); token.cancel(); this.officeToken = null; this.officeConverting = false; progress.dismiss(); toast('변환이 중단되었습니다'); };
    rebindButton(progress, BUTTON_NEGATIVE, abort);
    timer = setTimeout(abort, 600000);
    const ext = (/\.([^.\\/]+)$/.exec(name) || [, ''])[1].toLowerCase();
    let result;
    try {
      status.textContent = '원본 서식을 PDF로 변환하는 중';
      result = await office.convertOffice(source, ext, t => { if (!finished) status.textContent = t; }, token);
    } catch (e) {
      if (finished) return;
      finished = true; clearTimeout(timer); this.officeToken = null; this.officeConverting = false; progress.dismiss();
      if (e && e.cancelled) { toast('변환이 중단되었습니다'); return; }
      toast('자동 변환 실패: ' + ((e && e.message) || '알 수 없는 오류'));
      this.offerOfficeImport(source, name);
      return;
    }
    if (finished) { host.delete(result.pdf).catch(() => {}); return; }
    clearTimeout(timer); this.officeToken = null;
    status.textContent = '문서함에 저장하는 중'; progress.getButton(BUTTON_NEGATIVE).classList.add('m-dim-btn');
    try {
      const saved = await this.importConverted(result.pdf, name);
      finished = true; progress.dismiss(); this.officeConverting = false;
      await this.openPdf(saved); toast('문서함에 PDF로 변환해 저장했습니다');
    } catch (e) { finished = true; progress.dismiss(); this.officeConverting = false; toast('PDF 저장 실패: ' + (e && e.message || e)); }
    finally { host.delete(result.pdf).catch(() => {}); }
  },

  async openOfficeOriginal(uri, name) {
    try { this.awaitingOfficeReturn = true; await host.shellOpen(uri); }
    catch (e) { this.awaitingOfficeReturn = false; toast('원본 형식을 열 수 있는 문서 앱이 없습니다'); }
  },
  offerOfficeImport(uri, name) {
    // the "본문만 미리보기" (text-only preview) button does not exist on Windows: no OfficeImporter port
    new AlertDialog.Builder().setTitle(name)
      .setMessage('원본 서식·표·그림은 설치된 문서 앱에서 확인할 수 있습니다. 해당 앱에서 PDF로 내보낸 뒤 다시 가져오면 PDF Note에서 필기와 주석을 사용할 수 있습니다.')
      .setPositiveButton('원본 보기', () => this.openOfficeOriginal(uri, name))
      .setNegativeButton('PDF 가져오기', () => this.chooseConvertedPdf()).show();
  },
  openOfficeText(uri) { return this.openPdf(uri, true); },

  /** openPdf(uri, textOnly, requestedPage, activate). Resolves when the document is open (or the flow finished). */
  async openPdf(uri, textOnly = false, requestedPage = -1, activate = true) {
    const title = this.queryName(uri);
    if (this.isOfficeDocument(title) && !textOnly) {
      const lower = title.toLowerCase();
      if (lower.endsWith('.hwp') || lower.endsWith('.hwpx')) await this.convertHwp(uri, title);
      else if (this.canConvertOffice(title)) await this.convertOffice(uri, title);
      else this.offerOfficeImport(uri, title);
      return;
    }
    if (textOnly) { toast('본문 미리보기는 Windows 버전에서 지원하지 않습니다'); return; }
    if (!this.library.managed(uri)) {
      const saved = await this.library.imported(uri);
      if (saved) { await this.openPdf(saved, false, requestedPage, activate); return; }
      await this.importPdfToLibrary(uri, title, requestedPage, activate); return;
    }
    const existing = this.sessions.find(s => samePath(s.uri, uri));
    if (existing) {
      if (requestedPage >= 0) existing.page = Math.min(requestedPage, existing.renderer.pageCount - 1);
      if (activate || this.activeSession == null) await this.switchDocument(existing);
      return;
    }
    const session = new DocumentSession();
    try {
      session.title = title;
      session.renderer = await PdfDoc.open(await host.readBytes(uri));
      session.uri = uri;
      session.store = new AnnotationStore(); await session.store.open(uri);
      session.page = requestedPage < 0 ? 0 : Math.min(requestedPage, session.renderer.pageCount - 1);
      this.sessions.push(session);
      this.recentPrefs.putString('last_uri', uri); this.recentPrefs.putString('last_title', title);
      if (activate || this.activeSession == null) await this.switchDocument(session); else this.updateTabs();
      this.saveSessionState();
    } catch (error) {
      if (session.renderer && !this.sessions.includes(session)) session.renderer.destroy();
      toast('문서 열기 실패: ' + (error && error.message || error));
      if (this.sessions.length === 0) this.showWelcome();
    }
  },

  async importPdfToLibrary(source, title, page, activate) {
    if (this.importing.has(source)) return;
    this.importing.add(source);
    const destination = await this.importDestination();
    const announce = !this.restoringSessions;
    const progress = announce ? ProgressDialog.show('PDF 가져오기', '문서함에 저장하는 중…') : null;
    try {
      const saved = await this.library.importPdf(source, title, destination);
      this.importing.delete(source);
      if (progress) progress.dismiss();
      await this.openPdf(saved, false, page, activate);
      if (announce) toast('문서함에 자동 저장했습니다');
      this.saveSessionState();
    } catch (error) {
      this.importing.delete(source);
      if (progress) progress.dismiss();
      toast('가져오기 실패: ' + (error && error.message || error));
    }
  },

  isNotebook(session) { return session != null && this.library.managed(session.uri) && this.library.paper(session.uri) != null; },

  // ============================================================ switch / close / tabs
  /** switchDocument(s): makes the session active. Returns the showPage promise. */
  switchDocument(s) {
    this.commitInlineText();
    if (this.searchOwner != null && this.searchOwner !== s) this.closeSearch();
    this.library.opened(s.uri);
    if (this.activeSession != null) this.activeSession.page = this.currentPage;
    this.activeSession = s; this.renderer = s.renderer; this.documentUri = s.uri; this.documentTitle = s.title; this.store = s.store;
    this.titleView.textContent = this.documentTitle;
    this._textSelectWanted = false;
    this.highlightMode = this.memoMode = this.outlineMode = false; this.inkMode = 0;
    const pv = this.pageView;
    pv.setLassoMode(false); pv.stopTextSelection();
    pv.setHighlightMode(false, this.selectedColor); pv.setMemoMode(false); pv.setOutlineMode(false); pv.setInkTool(0, this.inkColor, this.inkWidth);
    this.updateToolStates(); this.updateInkButton(); this.updateTabs();
    const shown = this.showPage(Math.min(s.page, this.renderer.pageCount - 1));
    this.rebuildThumbnails(); this.saveSessionState();
    return shown;
  },
  closeDocument(s) {
    this.commitInlineText();
    if (s === this.searchOwner) this.closeSearch();
    const oldIndex = this.sessions.indexOf(s);
    if (oldIndex < 0) return;
    this.sessions.splice(oldIndex, 1);
    if (s.renderer) { try { s.renderer._pc && s.renderer._pc.clear(); s.renderer.destroy(); } catch (e) { /* ignore */ } }
    if (s === this.activeSession) {
      this.activeSession = null;
      if (this.sessions.length === 0) {
        this.renderer = null; this.documentUri = null; this.store = null; this._showGen++;
        this.firstPageView.clearPage(); this.secondPageView.clearPage();
        this.thumbnailList.replaceChildren(); this.refreshStudyPanel(); this.updateTabs(); this.showWelcome();
      } else this.switchDocument(this.sessions[Math.max(0, Math.min(oldIndex, this.sessions.length - 1))]);
    } else this.updateTabs();
    this.saveSessionState();
  },
  updateTabs() {
    this.tabRow.replaceChildren(); let activeTab = null;
    for (const session of this.sessions) {
      const active = session === this.activeSession;
      const chip = h('div', { class: 'm-tab' + (active ? ' active' : ''), dataset: { tag: 'document_tab' } });
      const documentIcon = mkIcon('ic_document_tab', 20, active ? argb(ACCENT) : argb(0xFFAEAEB2));
      const name = h('div', { class: 'm-tabname', dataset: { tag: 'document_tab_title' }, title: session.title }, session.title);
      let pressTimer = 0, longDone = false;
      name.addEventListener('pointerdown', e => {
        longDone = false; clearTimeout(pressTimer);
        if (e.pointerType !== 'mouse') pressTimer = setTimeout(() => { longDone = true; this.renameDocument(session); }, 500);
      });
      for (const t of ['pointerup', 'pointercancel', 'pointerleave']) name.addEventListener(t, () => clearTimeout(pressTimer));
      name.addEventListener('click', () => { if (longDone) { longDone = false; return; } this.switchDocument(session); });
      name.addEventListener('contextmenu', e => { e.preventDefault(); this.renameDocument(session); });
      const close = h('div', { class: 'm-tabclose', role: 'button', 'aria-label': session.title + ' 닫기', title: '닫기' }, '×');
      close.addEventListener('click', () => this.closeDocument(session));
      chip.append(documentIcon, name, close);
      this.tabRow.append(chip); if (active) activeTab = chip;
    }
    const add = h('div', { class: 'm-tabadd', role: 'button', 'aria-label': '문서 추가', title: '문서 추가' }, '＋');
    add.addEventListener('click', () => this.showAddDocumentMenu());
    this.tabRow.append(add);
    if (activeTab) requestAnimationFrame(() => this.tabStrip.scrollTo({ left: Math.max(0, activeTab.offsetLeft - 8), behavior: 'smooth' }));
  },

  toggleSidebar() { if (this.sidebarVisible && this.panelTab === 1) this.closeSidePanel(); else this.selectPanelTab(1); },

  /** Tag (page index) of a thumbnail list child: el.tag, data-page or data-tag. */
  thumbTag(el) {
    if (typeof el.tag === 'number') return el.tag;
    const d = el.dataset || {};
    for (const k of ['page', 'tag']) if (d[k] != null && d[k] !== '' && /^-?\d+$/.test(d[k])) return +d[k];
    return null;
  },
  updateThumbnailSelection() {
    let selected = null;
    for (const v of this.thumbnailList.children) {
      const tag = this.thumbTag(v); if (tag == null) continue;
      const on = tag === this.currentPage;
      v.style.borderRadius = '8px'; v.style.background = on ? '#E5F0FF' : 'transparent'; v.style.boxShadow = on ? 'inset 0 0 0 2px #007AFF' : 'none';
      if (on) selected = v;
    }
    if (this.sidebarVisible && selected) requestAnimationFrame(() => this.thumbnailPanel.scrollTo({ top: Math.max(0, selected.offsetTop - 16), behavior: 'smooth' }));
  },

  // ============================================================ rendering / showPage
  screenWidthPx() { return Math.round(window.innerWidth * (window.devicePixelRatio || 1)); },
  _renderWidth() { return Math.max(1080, this.screenWidthPx() * (this.twoPage ? 1 : 2)); },
  _cacheKey(index) { return index + '|' + this._renderWidth(); },
  /** Page bitmap if it is already rendered (sync), else null. */
  cachedPage(doc, index) { const e = doc._pc && doc._pc.get(this._cacheKey(index)); return e && e.canvas ? e.canvas : null; },
  /** renderPage(renderer, index): white-background canvas, ratio = min(2.5, width / pageWidthPts). Cached (LRU). */
  renderPage(doc, index) {
    const key = this._cacheKey(index), width = this._renderWidth();
    const cache = doc._pc || (doc._pc = new Map());
    const hit = cache.get(key);
    if (hit) { cache.delete(key); cache.set(key, hit); return hit.promise; }
    const entry = { canvas: null, promise: null };
    entry.promise = (async () => {
      const size = await doc.pageSize(index);
      let ratio = Math.min(2.5, width / size.w);
      const px = size.w * size.h * ratio * ratio; if (px > 24e6) ratio *= Math.sqrt(24e6 / px);   // keep huge sheets within canvas limits
      entry.canvas = await doc.renderPage(index, ratio);
      return entry.canvas;
    })();
    cache.set(key, entry);
    entry.promise.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
    const cap = this.twoPage ? 8 : 5;
    while (cache.size > cap) cache.delete(cache.keys().next().value);
    return entry.promise;
  },
  invalidateRenderCache(session) { const d = (session || this.activeSession) && (session || this.activeSession).renderer; if (d && d._pc) d._pc.clear(); },
  _spread(index) {
    const doc = this.renderer, first = this.twoPage ? Math.floor(index / 2) * 2 : index;
    return { first, second: this.twoPage && first + 1 < doc.pageCount ? first + 1 : -1 };
  },
  pagesCached(target) {
    const doc = this.renderer; if (!doc) return false;
    const { first, second } = this._spread(target);
    return !!this.cachedPage(doc, first) && (second < 0 || !!this.cachedPage(doc, second));
  },
  async ensurePages(target) {
    const doc = this.renderer, { first, second } = this._spread(target);
    await this.renderPage(doc, first); if (second >= 0) await this.renderPage(doc, second);
  },

  /** showPage(index): returns a promise that resolves when the page is on screen (synchronous when its bitmaps are cached). */
  showPage(index) {
    this.commitInlineText(); this.onSelectionAdjustStarted();
    const doc = this.renderer;
    if (doc == null || index < 0 || index >= doc.pageCount) return Promise.resolve(false);
    ++this.ocrGeneration; this.resetPageTransforms();
    const gen = ++this._showGen, session = this.activeSession;
    const { first, second } = this._spread(index);
    this.currentPage = index; session.page = index;
    this.pageView = (this.twoPage && index !== first) ? this.secondPageView : this.firstPageView;
    const c1 = this.cachedPage(doc, first), c2 = second >= 0 ? this.cachedPage(doc, second) : null;
    if (c1 && (second < 0 || c2)) { this._applyPage(session, doc, index, first, second, c1, c2); return Promise.resolve(true); }
    return (async () => {
      try {
        const a = await this.renderPage(doc, first), b = second >= 0 ? await this.renderPage(doc, second) : null;
        if (gen !== this._showGen || session !== this.activeSession || doc !== this.renderer) return false;
        this._applyPage(session, doc, index, first, second, a, b);
        return true;
      } catch (e) {
        if (this.sessions.includes(session) && doc === this.renderer) toast('페이지 표시 실패: ' + (e && e.message || e));
        return false;
      }
    })();
  },
  _applyPage(session, doc, index, first, second, c1, c2) {
    const store = session.store, two = this.twoPage, count = doc.pageCount;
    this.firstPageView.showPage(c1, first, store.marks, store.strokes, store.translations); this.firstPageView.setAnnotationStore(store);
    if (second >= 0) {
      setVis(this.secondPageView.el, 'visible');
      this.secondPageView.showPage(c2, second, store.marks, store.strokes, store.translations); this.secondPageView.setAnnotationStore(store);
    } else { this.secondPageView.clearPage(); setVis(this.secondPageView.el, two ? 'invisible' : 'gone'); }
    this.pageView = (two && index !== first) ? this.secondPageView : this.firstPageView;
    this.currentPage = index; session.page = index;
    if (this._textSelectWanted) this.pageView.setDirectTextSelection(true);
    this.syncOtherTools();
    const step = two ? 2 : 1, notebook = this.isNotebook(session);
    setVis(this.previousOverlay, first > 0 ? 'visible' : 'gone');
    setVis(this.nextOverlay, first + step < count || notebook ? 'visible' : 'gone');
    const nextLabel = first + step >= count && notebook ? '새 페이지 추가' : '다음 페이지';
    this.nextOverlay.setAttribute('aria-label', nextLabel); this.nextOverlay.title = nextLabel;
    this.pageLabel.textContent = two ? `${first + 1}\u2013${Math.min(first + 2, count)} / ${count}` : `${index + 1} / ${count}`;
    this.applyCrop(); this.updateBookmarkButton(); this.updateThumbnailSelection(); this.refreshStudyPanel(); this.saveSessionState(); this.applySearchHighlights();
    this.loadViewText(this.firstPageView); if (two && isShown(this.secondPageView)) this.loadViewText(this.secondPageView);
    this.schedulePrefetch(doc, first, second);
  },
  /** Renders the neighbouring pages in the background so page turns (curl snapshots) are instant. */
  schedulePrefetch(doc, first, second) {
    const gen = ++this._prefetchGen, step = this.twoPage ? 2 : 1, count = doc.pageCount;
    const list = [];
    for (const f of [first + step, first - step]) if (f >= 0 && f < count) { list.push(f); if (this.twoPage && f + 1 < count) list.push(f + 1); }
    setTimeout(async () => {
      for (const idx of list) {
        if (gen !== this._prefetchGen || doc !== this.renderer) return;
        while (this.pageAnimating) await sleep(120);
        try { await this.renderPage(doc, idx); } catch (e) { return; }
        await sleep(30);
      }
    }, 350);
  },
  loadViewText(view) {
    const cached = this.activeSession.textRegions.get(view.getPageNumber());
    if (cached) view.setTextRegions(cached, false); else setTimeout(() => this.recognizeViewText(view, false), 0);
  },
  syncOtherTools() {
    if (this.firstPageView && this.secondPageView) {
      const other = this.pageView === this.firstPageView ? this.secondPageView : this.firstPageView;
      other.copyToolsFrom(this.pageView);
    }
  },
  toggleTwoPage() {
    this.twoPage = !this.twoPage; this.recentPrefs.putBoolean('two_page', this.twoPage);
    if (this.renderer != null) this.showPage(this.currentPage); else setVis(this.secondPageView.el, this.twoPage ? 'invisible' : 'gone');
    toast(this.twoPage ? '두 쪽 보기 · 각 페이지를 터치해 필기하세요' : '한 쪽 보기');
  },

  // ============================================================ tool modes
  toggleHighlight() {
    if (this.renderer == null) return;
    this.highlightMode = !this.highlightMode; this.memoMode = this.outlineMode = false; this.stopInk(); this.updateToolStates();
    this.pageView.setMemoMode(false); this.pageView.setOutlineMode(false); this.pageView.setHighlightMode(this.highlightMode, this.selectedColor);
    toast(this.highlightMode ? '문장을 따라 좌우로 드래그하세요' : '하이라이트를 종료했습니다');
  },
  toggleMemoMode() {
    this.placementKind = ''; if (this.renderer == null) return;
    this.memoMode = !this.memoMode; this.highlightMode = this.outlineMode = false; this.stopInk(); this.updateToolStates();
    this.pageView.setHighlightMode(false, this.selectedColor); this.pageView.setOutlineMode(false); this.pageView.setMemoMode(this.memoMode);
    toast(this.memoMode ? '메모를 놓을 위치를 탭하세요' : '메모 추가를 종료했습니다');
  },
  toggleOutlineMode() {
    if (this.renderer == null) return;
    this.outlineMode = !this.outlineMode; this.highlightMode = this.memoMode = false; this.stopInk();
    this.pageView.setHighlightMode(false, this.selectedColor); this.pageView.setMemoMode(false); this.pageView.setOutlineMode(this.outlineMode); this.updateToolStates();
    toast(this.outlineMode ? '개요로 저장할 정확한 위치를 탭하세요' : '개요 지점 선택을 종료했습니다');
  },
  /** paintTool(button, on, background, foreground): active tool = tinted pill. */
  paintTool(button, on, background, foreground) {
    if (!button) return;
    const base = this.baseTint.has(button) ? this.baseTint.get(button) : NAVY;
    button.style.color = argb(on ? foreground : base);
    button.style.background = on ? argb(background) : '';
  },
  updateToolStates() {
    this.commitInlineText(); this.syncOtherTools(); this.updateInkButton();
    const typing = this.typingActive(), memo = this.memoMode && !typing;
    this.paintTool(this.memoButton, memo, ACTIVE_BG, ACTIVE_FG);
    this.paintTool(this.textButton, typing, ACTIVE_BG, ACTIVE_FG);
    this.paintTool(this.lassoButton, this.pageView != null && this.pageView.isLassoMode(), ACTIVE_BG, ACTIVE_FG);
  },
  stopInk() { this.pageView.setLassoMode(false); this.inkMode = 0; this.pageView.setInkTool(0, this.inkColor, this.inkWidth); this.updateInkButton(); },
  setInkMode(mode) {
    this.placementKind = ''; if (this.renderer == null) return;
    this.pageView.setLassoMode(false); this.inkMode = mode; this.pageView.setDirectTextSelection(false); this._textSelectWanted = false;
    this.highlightMode = this.memoMode = this.outlineMode = false;
    this.pageView.setHighlightMode(false, this.selectedColor); this.pageView.setMemoMode(false); this.pageView.setOutlineMode(false);
    this.pageView.setInkTool(mode, this.inkColor, this.inkWidth); this.updateToolStates(); this.updateInkButton();
    toast(mode === 3 ? '직선: 시작점에서 끝점까지 드래그하세요'
      : mode === 1 ? (this.fingerInk ? '손가락 또는 S펜으로 필기하세요' : 'S펜으로 필기하세요. 손가락 필기는 필기도구에서 켤 수 있습니다')
      : mode === 2 ? '지울 획을 터치하세요'
      : '읽기 모드 · 빠르게 스와이프하면 페이지를 넘깁니다');
  },
  soft(color) { return ((color & 0xFFFFFF) | 0x26000000) >>> 0; },
  updateInkButton() {
    this.updateLassoBar();
    const hl = this.highlightMode, eraser = this.inkMode === 2 && !hl, pen = !hl && (this.inkMode === 1 || this.inkMode === 3);
    const penColor = (this.inkColor | 0xFF000000) >>> 0, hlColor = (this.selectedColor | 0xFF000000) >>> 0;
    if (this.penButton) this.baseTint.set(this.penButton, penColor);
    if (this.hlButton) this.baseTint.set(this.hlButton, hlColor);
    this.paintTool(this.penButton, pen, this.soft(penColor), penColor);
    this.paintTool(this.hlButton, hl, this.soft(hlColor), hlColor);
    this.paintTool(this.eraserButton, eraser, 0xFFFFE3E8, 0xFFFF3B30);
    if (this.penButton) this.penButton.setAttribute('aria-label', '펜');
    if (this.inkButton) this.inkButton.setAttribute('aria-label', '필기 모드');
  },
  toggleFingerInk() {
    this.fingerInk = !this.fingerInk; this.recentPrefs.putBoolean('finger_ink', this.fingerInk);
    this.pageView.setFingerInk(this.fingerInk); this.syncOtherTools();
    toast(this.fingerInk ? '펜·지우개는 손가락으로도 사용합니다. 두 손가락으로 확대하세요' : '손가락은 선택·이동, S펜은 필기에 사용합니다');
  },
  startTextSelection() {
    if (this.renderer == null) return;
    this.setInkMode(0); this.pageView.setDirectTextSelection(true); this._textSelectWanted = true; this.syncOtherTools();
    this.recognizePageText(true); toast('텍스트 선택: 단어에서 드래그하세요');
  },
  onZoomGestureStarted() {
    if (this.highlightMode || this.memoMode || this.outlineMode) {
      this.highlightMode = this.memoMode = this.outlineMode = false;
      this.pageView.setHighlightMode(false, this.selectedColor); this.pageView.setMemoMode(false); this.pageView.setOutlineMode(false); this.updateToolStates();
    }
  },

  // ============================================================ undo / redo / bookmarks
  undoInk() {
    if (this.store == null) return;
    const strokes = this.store.strokes;
    for (let i = strokes.length - 1; i >= 0; i--) {
      const s = strokes[i];
      if (s.page === this.currentPage) {
        strokes.splice(i, 1); this.activeSession.redoStrokes.push(s); this.store.save(); this.pageView.invalidate();
        toast('마지막 필기를 취소했습니다'); return;
      }
    }
    toast('취소할 필기가 없습니다');
  },
  redoInk() {
    if (this.activeSession == null || this.activeSession.redoStrokes.length === 0) { toast('다시 실행할 필기가 없습니다'); return; }
    const s = this.activeSession.redoStrokes.pop();
    this.store.strokes.push(s); this.store.save();
    if (s.page !== this.currentPage) this.showPage(s.page); else this.pageView.invalidate();
  },
  showInkHelp() {
    new AlertDialog.Builder().setTitle('필기 안내')
      .setMessage('• S펜: 필기 또는 지우개\n• 손가락 필기 켜기: 펜·지우개 사용\n• 손가락 필기 끄기: 글자 선택·화면 이동\n• 두 손가락: 확대·이동\n• 필압: 누르는 힘에 따라 선 굵기 변화\n• S펜 측면 버튼: 누르는 동안 임시 지우개\n• 펜 뒤쪽 지우개: 지원 기기에서 자동 인식\n\n일반 정전식 펜과 손가락은 필압을 지원하지 않습니다.')
      .setPositiveButton('확인', null).show();
  },
  toggleBookmark() {
    if (this.renderer == null) return;
    const b = this.store.bookmarks;
    if (b.has(this.currentPage)) b.delete(this.currentPage); else b.add(this.currentPage);
    this.store.save(); this.updateBookmarkButton();
    if (this.sidebarVisible && !this.showAllThumbnails) this.rebuildThumbnails();
  },
  updateBookmarkButton() {
    if (!this.bookmarkButton) return;
    const marked = this.renderer != null && this.store != null && this.store.bookmarks.has(this.currentPage);
    setIcon(this.bookmarkButton.querySelector('.ico'), marked ? 'ic_star' : 'ic_star_outline');
    this.bookmarkButton.style.color = argb(marked ? 0xFFF59E0B : NAVY);
    const label = marked ? '즐겨찾기 해제' : '즐겨찾기 추가';
    this.bookmarkButton.setAttribute('aria-label', label); this.bookmarkButton.title = label;
  },

  // ============================================================ fullscreen
  showFullscreenDock(brief) {
    this.dockShown = true;
    this.dockHandle.style.display = 'none';
    clearTimeout(this._dockTimer); clearTimeout(this._dockHideEnd);
    const d = this.fullscreenDock;
    d.style.transition = 'none'; d.style.display = 'flex'; d.style.opacity = '0'; d.style.transform = 'translateY(60px)';
    void d.offsetWidth;
    d.style.transition = 'opacity 180ms ease-in-out, transform 180ms ease-in-out'; d.style.opacity = '1'; d.style.transform = 'translateY(0)';
    this._dockTimer = setTimeout(this.dockHider, brief ? 3500 : 6000);
  },
  hideFullscreenDock(animate) {
    this.dockShown = false; clearTimeout(this._dockTimer); clearTimeout(this._dockHideEnd);
    this.dockHandle.style.display = 'none';
    const d = this.fullscreenDock;
    if (!this.fullscreen || !animate) { d.style.transition = 'none'; d.style.display = 'none'; return; }
    d.style.transition = 'opacity 160ms ease-in-out, transform 160ms ease-in-out'; d.style.opacity = '0'; d.style.transform = 'translateY(60px)';
    this._dockHideEnd = setTimeout(() => { if (!this.dockShown) d.style.display = 'none'; }, 170);
  },
  toggleFullscreen() {
    this.fullscreen = !this.fullscreen;
    const disp = this.fullscreen ? 'none' : '';
    this.header.style.display = disp; this.tabStrip.style.display = disp; this.bottomBar.style.display = disp;
    if (this.fullscreen) this.showFullscreenDock(true); else this.hideFullscreenDock(false);
    host.call('window.fullscreen', { on: this.fullscreen }).catch(() => {});
  },
  /** Back button == Esc: selection popup (desktop), inline text, search panel, full screen. Returns true when handled. */
  onBackPressed() {
    if (this.selectionPopup) { this.onSelectionAdjustStarted(); if (this.pageView) this.pageView.clearTextSelectionOverlay(); return true; }
    if (this.inlineElement != null) { this.commitInlineText(); return true; }
    if (this.searchPanel && this.searchPanel.offsetParent !== null) { this.closeSearch(); return true; }
    if (this.fullscreen) { this.toggleFullscreen(); return true; }
    return false;
  },

  // ============================================================ PdfPageView.Listener
  onHighlightCreated(mark) { this.store.marks.push(mark); this.store.save(); this.pageView.invalidate(); },
  onMemoPointRequested(page, x, y) {
    if (this.placementKind !== '') { this.createPlacedElement(page, x, y); return; }
    const m = new Mark();
    m.page = page; m.left = Math.max(0, x - 0.025); m.right = Math.min(1, x + 0.025); m.top = Math.max(0, y - 0.025); m.bottom = Math.min(1, y + 0.025);
    m.color = this.selectedColor | 0; m.note = ''; m.noteOnly = true;
    this.showMemoEditor('새 메모 포스트잇', m, '저장', note => {
      if (!note) return;
      m.note = note; this.store.marks.push(m); this.store.save(); this.pageView.invalidate(); toast('메모 포스트잇을 저장했습니다');
    }, null, null, null, null);
  },
  onMarkTapped(mark) { this.editMark(mark); },
  onPageSwipe(direction) { this.animatePage(direction); },
  onOutlinePointRequested(page, x, y) { this.promptOutline(page, x, y, ''); },
  onInkChanged() { if (this.store != null) { this.store.save(); if (this.activeSession != null) this.activeSession.redoStrokes.length = 0; } },
  onTextSelectionFinished(selection, anchorX, anchorY) { this.showTextSelectionPopup(selection, anchorX, anchorY); },
  onTranslationTapped(note) { this.editTranslation(note); },
  onSelectionAdjustStarted() { if (this.selectionPopup) { this.selectionPopup.remove(); this.selectionPopup = null; } },

  // ============================================================ page turning
  resetPageTransforms() {
    for (const v of [this.firstPageView, this.secondPageView]) {
      if (!v) continue;
      clearTimeout(v._animT);
      v.el.style.transition = 'none'; v.el.style.opacity = ''; v.el.style.transform = '';
    }
  },
  animatePage(direction) {
    if (this.pageAnimating || this.renderer == null) return;
    const count = this.renderer.pageCount;
    const target = this.twoPage ? Math.floor(this.currentPage / 2) * 2 + direction * 2 : this.currentPage + direction;
    if (target < 0) return;
    if (target >= count) {
      if (direction > 0 && this.isNotebook(this.activeSession)) this.appendPage(this.activeSession, this.library.paper(this.activeSession.uri));
      return;
    }
    this.pageAnimating = true;
    const style = this.pageAnimStyle();
    if (style === 2) {
      this.showPage(target).then(() => this.resetPageTransforms()).finally(() => { this.pageAnimating = false; });
      return;
    }
    const slide = () => this.slidePage(direction, target);
    if (style === 0 && !this.verticalPageSwipe) {
      this.curlPage(direction, target).then(handled => { if (!handled) slide(); }).catch(() => { this.pageAnimating = false; });
      return;
    }
    slide();
  },
  /** Slide + fade page turn (style 1, curl fallback, vertical mode). */
  slidePage(direction, target) {
    const offset = 26 * direction, vertical = this.verticalPageSwipe, moving = this.pageView;
    const ease = 'cubic-bezier(.42,0,.58,1)', el = moving.el;
    const finish = () => { this.resetPageTransforms(); this.pageAnimating = false; };
    el.style.transition = `opacity 110ms ${ease}, transform 110ms ${ease}`;
    el.style.opacity = '0.45'; el.style.transform = vertical ? `translateY(${-offset}px)` : `translateX(${-offset}px)`;
    moving._animT = setTimeout(async () => {
      try { await this.showPage(target); } catch (e) { /* ignore */ }
      this.resetPageTransforms();
      const pv = this.pageView.el;
      pv.style.opacity = '0.45'; pv.style.transform = vertical ? `translateY(${offset}px)` : `translateX(${offset}px)`;
      void pv.offsetWidth;
      pv.style.transition = `opacity 170ms ${ease}, transform 170ms ${ease}`;
      pv.style.opacity = '1'; pv.style.transform = 'translate(0,0)';
      this.pageView._animT = setTimeout(finish, 175);
    }, 112);
  },
  /** Snapshot of the papers area (both page views composed) at device resolution; background black in dark mode. */
  snapshot(papers) {
    const S = window.devicePixelRatio || 1, W = Math.max(1, papers.clientWidth), H = Math.max(1, papers.clientHeight), dark = this.darkPage();
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(W * S)); c.height = Math.max(1, Math.round(H * S)); c.scale = S;
    const ctx = c.getContext('2d'); ctx.fillStyle = dark ? '#000' : '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    for (const v of [this.firstPageView, this.secondPageView]) {
      if (!isShown(v)) continue;
      ctx.drawImage(v.snapshot(dark, S), Math.round(v.el.offsetLeft * S), Math.round(v.el.offsetTop * S));
    }
    return c;
  },
  slice(source, x, y, w, hh) { const S = source.scale || 1; return snapshotSlice(source, x * S, y * S, w * S, hh * S); },
  /** The part of the reading area that is really paper: the page rectangles (both pages for a spread). */
  curlRegion(papers, two) {
    let union = null;
    for (const v of (two ? [this.firstPageView, this.secondPageView] : [this.firstPageView])) {
      const vw = v.el.clientWidth, vh = v.el.clientHeight;
      let r = v.pageRect();
      if (r.isEmpty()) r = new RectF(0, 0, vw, vh);
      if (!r.intersect(new RectF(0, 0, vw, vh))) r = new RectF(0, 0, vw, vh);
      r.offset(v.el.offsetLeft, v.el.offsetTop);
      if (union == null) union = r.copy(); else union.union(r);
    }
    if (two) { union.left = 0; union.right = papers.clientWidth; }
    return union;
  },
  /** Builds the curl overlay for the page rectangle and switches the pages underneath it; null when it cannot. Needs the target bitmaps cached. */
  beginCurl(direction, target) {
    this.curlConsumed = false;
    const papers = this.papers, viewport = this.viewportLayer;
    if (!papers || papers.clientWidth <= 0 || papers.clientHeight <= 0 || this.firstPageView.el.clientWidth <= 0) return null;
    const forward = direction > 0, two = this.twoPage && this.secondPageView.el.clientWidth > 0;
    const region = this.curlRegion(papers, two);
    let rl = Math.round(region.left), rt = Math.round(region.top), w = Math.round(region.width()), hh = Math.round(region.height());
    if (w < 8 || hh < 8) return null;
    if (!this.pagesCached(target)) return null;
    this.curlOrigin = this.currentPage;
    let oldFull, newFull;
    try { oldFull = this.snapshot(papers); this.showPage(target); this.resetPageTransforms(); newFull = this.snapshot(papers); }
    catch (error) { this.showPage(target); this.curlConsumed = true; return null; }
    const curl = new PageCurlView();
    const S = (a, b, c2, d) => this.slice(oldFull, a, b, c2, d), N = (a, b, c2, d) => this.slice(newFull, a, b, c2, d);
    if (!two) {
      const oldPage = S(rl, rt, w, hh), newPage = N(rl, rt, w, hh);
      if (forward) curl.setup(null, newPage, oldPage, paperBack(mirror(oldPage)), false, 0);
      else curl.setup(null, mirror(newPage), mirror(oldPage), paperBack(oldPage), true, 0);
    } else {
      const spine = this.secondPageView.el.offsetLeft, half = Math.min(spine, papers.clientWidth - spine);
      rl = spine - half; w = half * 2;
      const oldFirst = S(spine - half, rt, half, hh), oldSecond = S(spine, rt, half, hh), newFirst = N(spine - half, rt, half, hh), newSecond = N(spine, rt, half, hh);
      if (forward) curl.setup(oldFirst, newSecond, oldSecond, paperBack(mirror(newFirst)), false, 0.5);
      else curl.setup(mirror(oldSecond), mirror(newFirst), mirror(oldFirst), paperBack(newSecond), true, 0.5);
    }
    const box = h('div', { class: 'm-curl', style: { left: (rl + papers.offsetLeft) + 'px', top: (rt + papers.offsetTop) + 'px', width: w + 'px', height: hh + 'px' } }, curl.el);
    viewport.insertBefore(box, viewport.children[1] || null);
    curl._box = box; curl._w = w;
    if (curl.resize) curl.resize();
    return curl;
  },
  finishCurl(curl, from, to) {
    animateCurl(curl, from, to, () => {
      if (to < 0.5) this.showPage(this.curlOrigin);
      const box = curl._box; curl.release(); if (box) box.remove();
      this.resetPageTransforms(); this.pageAnimating = false;
    });
  },
  /** Turns the page like paper (single page and two-page spread). Resolves true when it handled the turn, false when it cannot animate. */
  async curlPage(direction, target) {
    const doc = this.renderer, session = this.activeSession, origin = this.currentPage;
    if (!this.pagesCached(target)) await this.ensurePages(target);
    if (doc !== this.renderer || session !== this.activeSession || origin !== this.currentPage) { this.pageAnimating = false; return true; }
    const curl = this.beginCurl(direction, target);
    if (!curl) { if (this.curlConsumed) { this.pageAnimating = false; return true; } return false; }
    this.finishCurl(curl, 0, 1); return true;
  },
  /** Page-turn effect: 0 = paper curl (default), 1 = slide and fade, 2 = none. */
  pageAnimStyle() { return this.recentPrefs.getInt('page_anim_style', 0); },
  choosePageAnimation() {
    const choices = ['책장 넘김 (종이처럼 접히며 넘어감)', '슬라이드 (밀리며 나타남)', '효과 없음 (바로 전환)'];
    new AlertDialog.Builder().setTitle('넘김 효과').setSingleChoiceItems(choices, this.pageAnimStyle(), (dialog, which) => {
      this.recentPrefs.putInt('page_anim_style', which); dialog.dismiss(); toast('넘김 효과: ' + choices[which].split(' (')[0]);
    }).setNegativeButton('취소', null).show();
  },

  // ============================================================ dark page / crop
  darkPage() { return this.recentPrefs.getBoolean('dark_page', false); },
  applyDarkPage() {
    const on = this.darkPage(); PageCurlView.backTint = 0x00FFFFFF;
    if (this.firstPageView) this.firstPageView.setDarkPage(on);
    if (this.secondPageView) this.secondPageView.setDarkPage(on);
  },
  toggleDarkPage() {
    this.recentPrefs.putBoolean('dark_page', !this.darkPage()); this.applyDarkPage();
    toast(this.darkPage() ? '문서 배경을 검게 표시합니다. 어두운 글씨 필기는 밝게 보입니다' : '문서를 원래 색으로 표시합니다');
  },
  cropMargins() { return this.recentPrefs.getBoolean('crop_margins', true); },
  /** Trims blank page margins so the printed area fills the screen (not for notebooks, where the margins are writing space). */
  applyCrop() {
    let box = null;
    if (this.renderer != null && this.cropMargins() && !this.isNotebook(this.activeSession)) {
      box = this.firstPageView.contentBounds();
      if (this.twoPage && isShown(this.secondPageView)) box.union(this.secondPageView.contentBounds());
    }
    this.firstPageView.setCrop(box); this.secondPageView.setCrop(box);
  },

  // ============================================================ outline prompt
  promptOutline(page, x, y, suggested) {
    const input = h('input', { class: 'field', type: 'text', placeholder: '예: 2. 세부 검토사항', spellcheck: 'false', style: { padding: '12px 24px' }, 'aria-label': '개요 제목' });
    if (suggested != null && suggested !== '') input.value = suggested.length > 60 ? suggested.slice(0, 60) + '…' : suggested;
    const dlg = new AlertDialog.Builder().setTitle('개요 제목').setView(input).setPositiveButton('저장', () => {
      let title = input.value.trim(); if (title === '') title = '페이지 ' + (page + 1);
      const item = new OutlineItem(); item.page = page; item.x = x; item.y = y; item.title = title;
      this.store.outlines.push(item); this.store.save();
      if (this.sidebarVisible && this.panelTab === 2) this.rebuildOutlinePanel();
      this.outlineMode = false; this.pageView.setOutlineMode(false); this.updateToolStates(); toast('개요에 저장했습니다');
    }).setNegativeButton('취소', null).show();
    input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); dlg.getButton(BUTTON_POSITIVE).click(); } });
  },

  // ============================================================ OCR / text regions
  recognizePageText(announce) {
    ++this.ocrGeneration; this.recognizeViewText(this.pageView, announce);
    if (this.twoPage) this.recognizeViewText(this.pageView === this.firstPageView ? this.secondPageView : this.firstPageView, false);
  },
  /** Text regions for selection: the PDF text layer (pdf.js) when the page has one, else OCR through the host (ocrHook). */
  async recognizeViewText(view, announce) {
    if (this.renderer == null || !isShown(view)) return;
    const session = this.activeSession, doc = this.renderer, page = view.getPageNumber(), gen = this.ocrGeneration;
    if (announce) toast('글자를 다시 인식하는 중입니다…');
    let regions = null;
    try { const r = await doc.textRegions(page); if (r && r.length) regions = r; } catch (e) { /* no text layer */ }
    const stale = () => gen !== this.ocrGeneration || session !== this.activeSession || page !== view.getPageNumber();
    if (!regions) {
      if (stale()) return;
      const copy = view.copyPageBitmap(); if (!copy) return;
      regions = await this.ocrRegions(copy);
    }
    if (stale()) return;
    if (!regions || !regions.length) { if (announce) toast('글자를 인식하지 못했습니다'); return; }
    session.textRegions.set(page, regions);
    view.setTextRegions(regions, announce);
  },
  async ocrRegions(canvas) {
    if (!ocrHook.fn) return null;
    try { return this.makeTextRegions(await ocrHook.fn(canvas), canvas.width, canvas.height); } catch (e) { return null; }
  },
  makeTextRegions(words, width, height) { return regionsFromWords(words || [], width, height); },
  normalized(r, w, hh) { return normalized(r, w, hh); },

  // ============================================================ text selection popup
  menuTile(row, label, iconName, action) {
    const chip = h('div', { class: 'chip' }, mkIcon(iconName, 20, argb(ACCENT)));
    const title = h('div', { class: 'lbl' }, label);
    const tile = h('div', { class: 'm-tile', role: 'button', 'aria-label': label, title: label }, chip, title);
    tile.addEventListener('click', () => action());
    row.append(tile);
    return title;
  },
  showTextSelectionPopup(selection, anchorX, anchorY) {
    this.onSelectionAdjustStarted();
    const panel = h('div', { class: 'm-selpop', dataset: { tag: 'selection_popup' } });
    const labels = ['하이라이트', '복사', '번역', '읽어주기', '단어장', '개요', '메모', '발췌', '링크'];
    const icons = ['ic_highlight', 'ic_copy', 'ic_translate', 'ic_speaker', 'ic_dictionary', 'ic_outline', 'ic_note_add', 'ic_copy', 'ic_link'];
    const u = selection.unionBounds;
    const actions = [
      () => this.addOcrHighlights(selection.bounds), () => this.copySelectedText(selection.text), () => this.translateText(selection.text, selection.unionBounds),
      () => this.readAloud(selection.text), () => this.openDictionary(selection.text), () => this.promptOutline(this.currentPage, u.left, u.top, selection.text),
      () => this.onMemoPointRequested(this.currentPage, u.right, u.top),
      () => this.addStudyEntry(selection.text, u.left, u.top, true), () => this.createHyperlink(selection)];
    for (let row = 0; row < 3; row++) {
      const group = h('div', { class: 'm-selrow' }); panel.append(group);
      for (let col = 0; col < 4; col++) {
        const index = row * 4 + col;
        if (index >= labels.length) { group.append(h('div', { class: 'm-selempty' })); continue; }
        this.menuTile(group, labels[index], icons[index], () => { this.onSelectionAdjustStarted(); actions[index](); this.pageView.clearTextSelectionOverlay(); });
      }
    }
    const rootW = this.root.clientWidth, rootH = this.root.clientHeight;
    const width = Math.min(376, rootW - 20);
    panel.style.width = width + 'px';
    const pv = this.pageView.el.getBoundingClientRect(), r = this.root.getBoundingClientRect();
    let y = pv.top + Math.round(anchorY) + 20;
    if (y + 160 > r.top + rootH) y = pv.top + Math.round(anchorY) - 176;
    panel.style.left = Math.round(r.left + (rootW - width) / 2) + 'px';
    panel.style.top = Math.round(Math.max(r.top + 8, y)) + 'px';
    document.body.append(panel);
    this.selectionPopup = panel;
  },
  async copySelectedText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = h('textarea', { style: { position: 'fixed', left: '-1000px', top: '0' } }); ta.value = text; document.body.append(ta); ta.select();
      try { document.execCommand('copy'); } catch (e2) { /* ignore */ } ta.remove();
    }
    toast('선택한 내용을 복사했습니다');
  },
  /** The LEXI dictionary app does not exist on Windows: open a web dictionary for the selection instead. */
  async openDictionary(word) {
    let query = word.replace(/^[^A-Za-z]+|[^A-Za-z'-]+$/g, '').trim();
    if (query === '') query = word.trim();
    try { await host.shellOpen('https://en.dict.naver.com/#/search?query=' + encodeURIComponent(query)); }
    catch (e) {
      new AlertDialog.Builder().setTitle('단어장 앱이 필요합니다').setMessage('LEXI 단어장 앱을 설치하면 선택한 단어를 바로 검색할 수 있습니다.').setPositiveButton('확인', null).show();
    }
  },
  addOcrHighlights(bounds) {
    for (const b of bounds) {
      const m = new Mark(); m.page = this.currentPage; m.left = b.left; m.top = b.top; m.right = b.right; m.bottom = b.bottom; m.color = this.selectedColor | 0;
      this.store.marks.push(m);
    }
    this.store.save(); this.pageView.invalidate(); toast('선택한 범위를 하이라이트했습니다');
  },

  // ============================================================ translate / read aloud
  /** Windows has no "Translate" app intent: try the built-in browser translator, else open Google Translate and the paste dialog. */
  async translateText(source, bounds) {
    const korean = /[가-힣]/.test(source);
    this.pendingSource = source; this.pendingBounds = bounds.copy ? bounds.copy() : RectF.from(bounds); this.pendingSession = this.activeSession; this.pendingPage = this.currentPage;
    let result = null;
    try { result = await this.builtinTranslate(source, korean); } catch (e) { result = null; }
    if (result == null) {
      try { host.shellOpen(`https://translate.google.com/?sl=auto&tl=${korean ? 'en' : 'ko'}&text=${encodeURIComponent(source)}&op=translate`).catch(() => {}); }
      catch (e) { toast('Translate를 열 수 없습니다'); }
    }
    this.receiveExternalTranslation(true, result || '');
  },
  /** Chromium/Edge built-in Translator API (offline model download on first use). Returns null when unavailable. */
  async builtinTranslate(source, korean) {
    if (typeof window.Translator === 'undefined') return null;
    const opts = { sourceLanguage: korean ? 'ko' : 'en', targetLanguage: korean ? 'en' : 'ko' };
    const avail = await window.Translator.availability(opts);
    if (avail === 'unavailable') return null;
    const progress = avail === 'available' ? null : ProgressDialog.show('번역', '번역 모델을 준비하는 중입니다…');
    try {
      const t = await window.Translator.create(opts);
      const out = await t.translate(source);
      if (t.destroy) t.destroy();
      return out;
    } catch (e) { toast('번역 실패: 인터넷 연결을 확인하세요'); return null; }
    finally { if (progress) progress.dismiss(); }
  },
  translateOffline(source, bounds) { return this.translateText(source, bounds); },
  receiveExternalTranslation(ok, translated) {
    if (this.pendingSource == null || this.pendingSession == null) return;
    const source = this.pendingSource, bounds = this.pendingBounds.copy(), target = this.pendingSession, page = this.pendingPage;
    this.pendingSource = null; this.pendingSession = null;
    if (!this.sessions.includes(target)) { toast('원래 PDF를 다시 열어 번역하세요'); return; }
    if (target !== this.activeSession) this.switchDocument(target);
    if (page !== this.currentPage || target !== this.activeSession) this.showPage(page);
    this.showTranslationResult(source, ok && translated ? String(translated) : '', bounds);
  },
  readAloud(source) {
    const labels = ['미국식 영어', '영국식 영어', '호주식 영어', '한국어', '읽기 중지'], locales = ['en-US', 'en-GB', 'en-AU', 'ko-KR'];
    new AlertDialog.Builder().setTitle('읽어주기 · 발음 선택').setItems(labels, (d, index) => {
      if (index === 4) { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } return; }
      this.speechLocale = locales[index]; this.speechPending = source;
      if (!this.speech) {
        if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') { toast('음성 엔진을 시작할 수 없습니다'); return; }
        this.speech = window.speechSynthesis; this.speechReady = true;
      }
      this.speakPending();
    }).show();
  },
  async speakPending() {
    if (!this.speech || !this.speechReady || this.speechPending == null) return;
    const lang = this.speechLocale.toLowerCase(), voices = await getVoices();
    const norm = v => String(v.lang).replace('_', '-').toLowerCase();
    const voice = voices.find(v => norm(v) === lang) || (lang.startsWith('ko') ? voices.find(v => norm(v).startsWith('ko')) : null);
    if (!voice) { toast('선택한 발음의 음성이 기기에 없습니다'); this.speechPending = null; return; }
    const text = this.speechPending; this.speechPending = null;
    this.speech.cancel();
    const u = new SpeechSynthesisUtterance(text); u.voice = voice; u.lang = voice.lang;
    this.speech.speak(u);
  },

  // ============================================================ translation sticky notes
  showTranslationResult(source, translated, bounds) {
    const targetStore = this.store, targetPage = this.currentPage;
    const original = h('div', { class: 'm-original' }, '원문\n' + source);
    const result = h('textarea', { class: 'm-result', placeholder: '번역 앱에서 결과를 복사한 뒤 붙여넣으세요', rows: 3, spellcheck: 'false', 'aria-label': '번역 결과' });
    result.value = translated;
    const grow = () => { result.style.height = 'auto'; result.style.height = Math.min(172, Math.max(92, result.scrollHeight + 2)) + 'px'; };
    result.addEventListener('input', grow);
    const panel = h('div', { class: 'm-transpanel' }, original, result);
    const dialog = new AlertDialog.Builder().setTitle('번역 · 포스트잇').setView(panel)
      .setPositiveButton('포스트잇 저장', () => {
        const value = result.value.trim(); if (value === '') return;
        const n = new TranslationNote(); n.page = targetPage; n.left = bounds.left; n.top = bounds.top; n.right = bounds.right; n.bottom = bounds.bottom;
        n.source = source; n.translated = value; targetStore.translations.push(n); targetStore.save(); this.pageView.invalidate(); toast('번역 포스트잇을 저장했습니다');
      }).setNeutralButton('붙여넣기', null).setNegativeButton('닫기', null).create();
    rebindButton(dialog, BUTTON_NEUTRAL, async () => {
      try { const t = await navigator.clipboard.readText(); if (t) { result.value = t; grow(); } } catch (e) { toast('클립보드를 읽을 수 없습니다'); }
    });
    dialog.show(); grow();
  },
  editTranslation(note) {
    const input = h('textarea', { class: 'field m-edittext', rows: 3, spellcheck: 'false', 'aria-label': '번역' }); input.value = note.translated;
    new AlertDialog.Builder().setTitle('번역 포스트잇 · p.' + (note.page + 1)).setMessage('원문: ' + note.source).setView(input)
      .setPositiveButton('저장', () => { note.translated = input.value.trim(); this.store.save(); this.pageView.invalidate(); })
      .setNegativeButton('삭제', () => {
        const i = this.store.translations.indexOf(note); if (i >= 0) this.store.translations.splice(i, 1);
        this.store.save(); this.pageView.invalidate(); toast('번역 포스트잇을 삭제했습니다');
      })
      .setNeutralButton('표시 설정', () => this.showTranslationDisplayOptions(note)).show();
  },
  showTranslationDisplayOptions(note) {
    const choices = ['펼쳐서 표시', '최소화', '숨기기'], checked = !note.visible ? 2 : (note.minimized ? 1 : 0);
    showActionSheet('번역 포스트잇 표시', choices, checked, w => { note.visible = w !== 2; note.minimized = w === 1; this.store.save(); this.pageView.invalidate(); });
  },
  showTranslations() {
    if (this.store == null || this.store.translations.length === 0) { toast('저장된 번역 포스트잇이 없습니다'); return; }
    const items = this.store.translations.slice();
    const labels = items.map(n => {
      const state = !n.visible ? '숨김' : (n.minimized ? '최소화' : '펼침'), t = n.translated || '';
      return 'p.' + (n.page + 1) + '  [' + state + '] ' + (t.length > 35 ? t.slice(0, 35) + '…' : t);
    });
    new AlertDialog.Builder().setTitle('번역 포스트잇').setItems(labels, (d, i) => { this.showPage(items[i].page); this.editTranslation(items[i]); }).show();
  },
  editMark(mark) {
    this.showMemoEditor('페이지 ' + (mark.page + 1) + (mark.noteOnly ? ' 메모 포스트잇' : ' 하이라이트'), mark, '저장',
      text => { mark.note = text; mark.visible = true; this.store.save(); this.pageView.invalidate(); },
      mark.noteOnly ? '메모 삭제' : '하이라이트 삭제',
      () => {
        const i = this.store.marks.indexOf(mark); if (i >= 0) this.store.marks.splice(i, 1);
        this.store.save(); this.pageView.invalidate(); toast(mark.noteOnly ? '메모를 삭제했습니다' : '하이라이트를 삭제했습니다');
      }, '표시 설정', () => this.showMemoDisplayOptions(mark));
  },
};

export function installMain1(cls) {
  Object.assign(cls.prototype, methods);
}
