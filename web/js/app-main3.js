// MainActivity part 3: the pieces of MainActivity.java 1300-1933 that no other part owns: tools sheet (showTools/categoryTiles),
// lasso shape bar, typing directly on the page (inline text editor), action sheet, voice recording (recorder bar, recordings tab
// rows, audio player), help dialog and lifecycle glue (onStop/onDestroy/flushAll/closeAllDocuments).
// The shared primitives (showSheet, swatches, segmented, toggleChip, pill, stepButton, showMemoEditor), the docked side panel
// (thumbnails/outline/marks), the docked search and the export/import/notebook flows live in app-main2.js; they are called by name.
// Java method/field names are kept; the methods are assigned onto MainActivity.prototype by installMain3().
import { h, icon, argb } from './util.js';
import { prefs } from './prefs.js';
import { host } from './host.js';
import { toast as showToast } from './ui/toast.js';
import { AnchoredMenu } from './ui/menu.js';
import { AlertDialog, showActionSheet as uiActionSheet } from './ui/alert.js';
import { AnnotationStore } from './store.js';
import { AnnotationPainter } from './painter.js';

const NAVY = 0xFF1C1C1E | 0, ACCENT = 0xFF007AFF | 0, ACTIVE_BG = 0xFFE5F0FF | 0, ACTIVE_FG = 0xFF007AFF | 0;
const GRAY = 0xFF8E8E93 | 0, DANGER = 0xFFFF3B30 | 0;
const CATEGORY_TITLES = ['문서', '보기·이동', '필기·삽입', '학습·주석', '내보내기·백업'];
const TEXT_COLORS = [0xFF1C1C1E, 0xFF8E8E93, 0xFF007AFF, 0xFF16835B, 0xFFEA580C, 0xFFFF3B30, 0xFFDB2777, 0xFF7C3AED].map(c => c | 0);
const FONT_IDS = ['sans', 'medium', 'light', 'black', 'condensed', 'serif', 'mono', 'typewriter', 'hand', 'casual'];
const FONT_NAMES = ['고딕 (기본)', '고딕 중간', '고딕 얇게', '고딕 굵게', '고딕 좁게', '명조', '고정폭', '타자기', '손글씨', '캐주얼'];
const TEXT_PAGE_POINTS = 595;
const PAPER_COLORS = [0xFFFFF3A6, 0xFFFFD6E0, 0xFFCFE8FF, 0xFFD5F5D0, 0xFFFFE0B8, 0xFFE6D9FF, 0xFFFFFFFF].map(c => c | 0);
const SIDE_TITLES = ['검색', '미리보기', '개요', '음성 녹음'];
const SIDE_ICONS = ['ic_search', 'ic_thumbnails', 'ic_outline', 'ic_mic'];
const LASSO_RECT = 1, LASSO_CIRCLE = 2;

const css = c => argb(c);
const same = (a, b) => (a | 0) === (b | 0);
const setShown = (el, on, display = 'flex') => { if (el) el.style.display = on ? display : 'none'; };
const roundBg = (color, r) => ({ background: css(color), borderRadius: r + 'px' });

/** Tile / Section as plain objects (duck-typed with the sheet implementation of part 2, which reads label/icon/action/selected/tintV/keepOpen). */
export function tile(label, iconName, action, opts = {}) {
  return { label, icon: iconName, action, selected: !!opts.selected, tint: opts.tint || 0, tintV: opts.tint || 0, keepOpen: !!opts.keepOpen };
}
export function section(title, tiles = [], custom = null) { return { title, tiles, custom }; }

/** ImageButton made by icon(): transparent, glyph centred at 24px, padding as given. */
function iconButton(name, label, tint, onClick, w, hgt, pad = 12) {
  const b = h('button', { class: 'm3-ib', type: 'button', 'aria-label': label, title: label, style: { width: w + 'px', height: hgt + 'px', padding: pad + 'px' } }, icon(name, 24, css(tint)));
  b.dataset.tint = String(tint);
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
function setTint(btn, tint) { const i = btn.querySelector('.ico'); if (i) i.style.color = css(tint); }

const clock = seconds => { seconds = Math.max(0, Math.floor(seconds)); return Math.floor(seconds / 60) + ':' + (seconds % 60 < 10 ? '0' : '') + (seconds % 60); };

const methods = {
  sectionOf(category, titled) { return section(titled ? CATEGORY_TITLES[category] : null, this.categoryTiles(category)); },
  categoryTiles(category) {
    const t = [];
    const run = name => () => this[name]();
    switch (category) {
      case 0:
        t.push(tile('문서함·파일 관리', 'ic_folder_open', run('showLibrary')));
        t.push(tile('문서 추가', 'ic_note_add', run('showAddDocumentMenu')));
        t.push(tile('새 노트', 'ic_note_add', run('newNotebook')));
        t.push(tile('현재 문서 이름 변경', 'ic_rename', () => { if (this.activeSession) this.renameDocument(this.activeSession); else this.toast('문서를 먼저 여세요'); }));
        break;
      case 1:
        t.push(tile('페이지 미리보기', 'ic_sidebar', run('toggleSidebar'), { selected: this.sidebarVisible }));
        t.push(tile('페이지로 이동', 'ic_page', run('goToPage')));
        t.push(tile('현재 페이지 뒤에 추가', 'ic_page_add', () => this.choosePageToInsert(this.currentPage)));
        t.push(tile('다른 형식으로 페이지 추가', 'ic_page_add', () => this.chooseOtherPageFormat(this.currentPage)));
        t.push(tile('페이지 삭제', 'ic_delete', () => this.confirmDeletePage(this.currentPage), { tint: DANGER }));
        t.push(tile('두 쪽 보기 · ' + (this.twoPage ? '켜짐' : '꺼짐'), 'ic_book', run('toggleTwoPage'), { selected: this.twoPage }));
        t.push(tile('전체 화면', 'ic_fullscreen', run('toggleFullscreen')));
        t.push(tile('페이지 넘김 설정', 'ic_swipe', run('choosePageSwipeDirection')));
        t.push(tile('넘김 효과', 'ic_magic', run('choosePageAnimation')));
        t.push(tile('읽기·페이지 넘김', 'ic_swipe', () => this.setInkMode(0)));
        break;
      case 2:
        t.push(tile('필기 모드', 'ic_ink', () => this.setWriteMode(true)));
        t.push(tile('올가미·영역 캡처', 'ic_lasso', run('startLasso')));
        t.push(tile('텍스트 선택', 'ic_select_text', run('startTextSelection')));
        t.push(tile('타이핑', 'ic_text', run('toggleTyping')));
        t.push(tile('사진·이미지', 'ic_image', run('insertImage')));
        t.push(tile('스티커', 'ic_sticker', run('showStickerPicker')));
        t.push(tile('동영상', 'ic_video', run('pickVideo')));
        t.push(tile('하이퍼링크', 'ic_link', run('startHyperlink')));
        t.push(tile('유튜브 링크', 'ic_youtube', run('askYoutube')));
        t.push(tile('음성 녹음', 'ic_mic', run('startRecording')));
        t.push(tile('메모 추가', 'ic_memo', run('toggleMemoMode')));
        break;
      case 3:
        t.push(tile('문서·필기 검색', 'ic_search', run('searchDocument')));
        t.push(tile('듀얼 뷰 노트', 'ic_dual', () => this.showStudy(false)));
        t.push(tile('발췌 바구니', 'ic_basket', () => this.showStudy(true)));
        t.push(tile('메모·하이라이트', 'ic_highlight', run('showMarkList')));
        t.push(tile('번역 포스트잇', 'ic_translate', run('showTranslations')));
        t.push(tile('책갈피', 'ic_star', run('showBookmarks')));
        t.push(tile('개요 목록', 'ic_outline', run('showOutlineList')));
        t.push(tile('개요 추가', 'ic_flag', run('toggleOutlineMode')));
        t.push(tile('글자 다시 인식', 'ic_scan', () => this.recognizePageText(true)));
        break;
      default:
        t.push(tile('인쇄', 'ic_print', () => this.callUi2('printDocument')));
        t.push(tile('PDF 내보내기', 'ic_pdf', run('exportPdf')));
        t.push(tile('노트·발췌 내보내기', 'ic_export', run('exportStudy')));
        t.push(tile('필기 백업 파일 저장', 'ic_backup', run('exportAnnotations')));
        t.push(tile('필기 백업 파일 불러오기', 'ic_import', run('importSidecar')));
        t.push(tile('원본 파일 내보내기', 'ic_original', run('exportOriginal')));
        t.push(tile('다른 기기와 동기화', 'ic_sync', run('showDeviceSync')));
        break;
    }
    return t;
  },
  /** One scrolling sheet with every tool group. */
  showTools() {
    const sections = [];
    if (!this.renderer) sections.push(this.sectionOf(0, true));
    else for (let c = 0; c < CATEGORY_TITLES.length; c++) sections.push(this.sectionOf(c, true));
    const awake = prefs.getBoolean('keep_awake', false);
    sections.push(section('읽기 편의', [tile('화면 켜 둠', 'ic_clock', () => {
      prefs.putBoolean('keep_awake', !awake); this.applyKeepAwake(); this.toast(!awake ? '읽는 동안 화면이 꺼지지 않습니다' : '화면 자동 꺼짐을 따릅니다');
    }, { selected: awake }),
      tile('하단 메뉴 플로팅', 'ic_float', () => this.toggleFloatBar(), { selected: this.floatBar() }),
      tile('전체 화면 메뉴 계속 표시', 'ic_float', () => this.toggleDockPinned(), { selected: this.dockPinned() })]));
    sections.push(section('인쇄', [
      tile('인쇄', 'ic_print', () => this.callUi2('printDocument'))]));
    sections.push(section('도움말', [tile('사용법', 'ic_outline', () => this.showHelp()),
      tile('오프라인 사용 안내', 'ic_wifi_off', () => this.callUi2('showAboutOffline'))]));
    return this.showSheet('메뉴', sections);
  },
  // ================================================================== lasso shape bar
  buildLassoBar() {
    const bar = this.lassoBar = h('div', { class: 'm3-lasso', dataset: { tag: 'lasso_bar' }, style: { display: 'none' } });
    const icons = ['ic_lasso', 'ic_rect', 'ic_circle'], names = ['자유', '네모', '원'];
    for (let i = 0; i < 3; i++) {
      const chip = h('div', { class: 'm3-lchip', role: 'button', 'aria-label': '올가미 ' + names[i], title: '올가미 · ' + names[i], dataset: { tag: 'lasso_shape_' + i } },
        icon(icons[i], 22, 'currentColor'));
      chip.addEventListener('click', () => this.chooseLassoShape(i));
      bar.append(chip);
    }
    bar.append(iconButton('ic_close', '올가미 종료', GRAY, () => this.setInkMode(0), 40, 40, 8));
    this.updateLassoBar();
    return bar;
  },
  chooseLassoShape(shape) {
    this.lassoShape = shape; prefs.putInt('lasso_shape', shape);
    this.pageView.setLassoShape(shape); this.syncOtherTools(); this.updateLassoBar();
    this.toast(shape === LASSO_RECT ? '네모: 대각선으로 드래그하세요' : shape === LASSO_CIRCLE ? '원: 중심에서 바깥쪽으로 드래그하세요' : '자유: 원하는 영역을 둘러 그리세요');
  },
  updateLassoBar() {
    if (!this.lassoBar || !this.pageView) return;
    const on = this.pageView.isLassoMode();
    setShown(this.lassoBar, on);
    if (!on) return;
    for (let i = 0; i < 3; i++) {
      const chip = this.lassoBar.querySelector(`[data-tag="lasso_shape_${i}"]`); if (!chip) continue;
      const selected = i === this.lassoShape;
      chip.style.background = selected ? css(ACTIVE_BG) : 'transparent';
      chip.style.color = css(selected ? ACTIVE_FG : NAVY);
    }
  },
  toggleLasso() {
    if (!this.renderer) { this.toast('PDF를 먼저 여세요'); return; }
    if (this.pageView.isLassoMode()) { this.setInkMode(0); this.toast('올가미를 종료했습니다'); } else this.startLasso();
  },
  startLasso() {
    if (!this.renderer) { this.toast('PDF를 먼저 여세요'); return; }
    this.onSelectionAdjustStarted();
    this.highlightMode = this.memoMode = this.outlineMode = false; this.placementKind = ''; this.inkMode = 0;
    this.pageView.setLassoShape(this.lassoShape); this.pageView.setLassoMode(true); this.updateToolStates();
    this.toast(this.lassoShape === LASSO_RECT ? '드래그해서 네모 영역을 지정하세요. 모양은 위쪽 막대에서 바꿀 수 있습니다.'
      : this.lassoShape === LASSO_CIRCLE ? '중심에서 바깥쪽으로 드래그해 원형 영역을 지정하세요.'
        : '손가락 또는 S펜으로 원하는 영역을 둘러 그리세요. 두 손가락으로 확대할 수 있습니다.');
  },

  // ================================================================== typing directly on the page
  typingActive() { return this.memoMode && this.placementKind === 'text'; },
  toggleTyping() {
    if (!this.renderer) { this.toast('문서를 먼저 여세요'); return; }
    if (this.typingActive()) { this.commitInlineText(); this.placementKind = ''; this.memoMode = false; this.pageView.setMemoMode(false); this.updateToolStates(); this.toast('타이핑을 종료했습니다'); return; }
    this.placeElement('text', '');
  },
  viewForPage(page) {
    for (const v of [this.firstPageView, this.secondPageView]) {
      if (v && v.el && v.el.style.display !== 'none' && !v.el.hidden && v.getPageNumber() === page) return v;
    }
    return null;
  },
  redrawPages() { if (this.firstPageView) this.firstPageView.invalidate(); if (this.secondPageView) this.secondPageView.invalidate(); },
  elementAt(page, x, y) {
    if (!this.store) return null;
    for (let i = this.store.elements.length - 1; i >= 0; i--) {
      const e = this.store.elements[i];
      if (e.page === page && e.kind === 'text' && x >= e.left && x <= e.right && y >= e.top && y <= e.bottom) return e;
    }
    return null;
  },
  loadTextStyle(e) {
    e.font = prefs.getString('text_font', 'sans'); if (!FONT_IDS.includes(e.font)) e.font = 'sans';
    e.bold = prefs.getBoolean('text_bold', false); e.italic = prefs.getBoolean('text_italic', false);
    e.color = prefs.getInt('text_color', AnnotationStore.PageElement.DEFAULT_TEXT_COLOR);
    const size = prefs.getFloat('text_size', AnnotationStore.PageElement.DEFAULT_TEXT_SIZE);
    e.textSize = size < .004 || size > .3 ? AnnotationStore.PageElement.DEFAULT_TEXT_SIZE : size;
  },
  saveTextStyle(e) {
    prefs.putString('text_font', e.font); prefs.putBoolean('text_bold', e.bold); prefs.putBoolean('text_italic', e.italic);
    prefs.putInt('text_color', e.color); prefs.putFloat('text_size', e.textSize);
  },
  /** Resizes the box height so the whole text is visible with the element's own width, size and typeface. */
  fitTextElement(e) {
    const view = this.viewForPage(e.page); const aspect = view ? view.pageAspect() : 1.414;
    let height = AnnotationPainter.fitHeight(e.text, e.right - e.left, e.textSize, aspect, AnnotationPainter.typeface(e.font, e.bold, e.italic));
    height = Math.min(.98, height);
    if (e.top + height > .99) e.top = Math.max(0, .99 - height);
    e.bottom = e.top + height;
  },
  pointsOf(e) { return Math.max(8, Math.min(72, Math.round(e.textSize * TEXT_PAGE_POINTS))); },
  newTextBox(page, x, y) {
    const box = new AnnotationStore.PageElement(); box.page = page; box.kind = 'text'; this.loadTextStyle(box);
    box.left = Math.max(0, Math.min(.72, x)); box.top = Math.max(0, Math.min(.92, y));
    box.right = Math.min(.97, box.left + .45); box.bottom = Math.min(.99, box.top + .06);
    return box;
  },
  /** Opens an editor right on the page: the typed text appears exactly where it will be saved. */
  async beginInlineText(element, fresh) {
    this.commitInlineText(); if (!this.store) return;
    let view = this.viewForPage(element.page);
    if (!view) { await this.showPage(element.page); view = this.viewForPage(element.page); }
    if (!view) return;
    const layer = this.viewportLayer; if (getComputedStyle(layer).position === 'static') layer.style.position = 'relative';
    this.inlineElement = element; this.inlineFresh = fresh; this.inlineStore = this.store; this.inlineView = view;
    AnnotationPainter.skip = element; this.redrawPages();
    const e = element;
    const edit = this.inlineEdit = h('textarea', { class: 'm3-inline-text', dataset: { tag: 'inline_text' }, placeholder: '글을 입력하세요', spellcheck: 'false', rows: 1 });
    edit.value = e.text || '';
    edit.style.setProperty('--ph', `rgba(${(e.color >> 16) & 255},${(e.color >> 8) & 255},${e.color & 255},.4)`);
    edit.style.width = '120px';
    edit.addEventListener('input', ev => {
      if (ev && ev.inputType === 'insertLineBreak') this.continueList(edit.selectionStart - 1);   // Enter inside a list line starts the next item
      e.text = edit.value; this._inlineDirty = true; if (this._inlineSync) this._inlineSync();
    });
    for (const t of ['keyup', 'click', 'select']) edit.addEventListener(t, () => { if (this._inlineSync) this._inlineSync(); });
    layer.append(edit);
    this.inlineMove = this.inlineHandle('✥', '글상자 이동', (dx, dy, page) => {
      const w = e.right - e.left, hh = e.bottom - e.top;
      const nx = Math.max(0, Math.min(1 - w, e.left + dx / page.width())), ny = Math.max(0, Math.min(1 - hh, e.top + dy / page.height()));
      e.left = nx; e.right = nx + w; e.top = ny; e.bottom = ny + hh;
    });
    this.inlineResize = this.inlineHandle('↔', '글상자 너비', (dx, dy, page) => { e.right = Math.max(e.left + .12, Math.min(1, e.right + dx / page.width())); });
    const del = this.inlineDelete = h('div', { class: 'm3-handle', role: 'button', 'aria-label': '글상자 삭제', dataset: { tag: 'inline_delete' }, style: { background: css(0xFFEF5B7C) } }, '✕');
    del.addEventListener('click', () => this.deleteInlineText());
    del.addEventListener('pointerdown', ev => ev.stopPropagation());
    layer.append(del);
    this.buildInlineBar(e); this.applyInlineStyle(); this.positionInlineText();
    const tick = () => { if (this.inlineEdit !== edit) return; this.positionInlineText(); this._inlineRaf = requestAnimationFrame(tick); };
    this._inlineRaf = requestAnimationFrame(tick);
    edit.focus(); const n = edit.value.length; edit.setSelectionRange(n, n);
  },
  /** drag(dx, dy, pageRect) with screen px deltas. */
  inlineHandle(glyph, description, drag) {
    const handle = h('div', { class: 'm3-handle', role: 'button', 'aria-label': description, style: { background: css(ACCENT) } }, glyph);
    let last = null;
    handle.addEventListener('pointerdown', ev => { last = [ev.clientX, ev.clientY]; handle.setPointerCapture(ev.pointerId); ev.preventDefault(); ev.stopPropagation(); });
    handle.addEventListener('pointermove', ev => {
      if (!last) return;
      const page = this.inlineView ? this.inlineView.pageRect() : null;
      if (page && page.width() > 0 && page.height() > 0) drag(ev.clientX - last[0], ev.clientY - last[1], page);
      last = [ev.clientX, ev.clientY];
    });
    const end = () => { last = null; };
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
    this.viewportLayer.append(handle);
    return handle;
  },
  positionInlineText() {
    const edit = this.inlineEdit, e = this.inlineElement, view = this.inlineView;
    if (!edit || !e || !view) return;
    const page = view.pageRect(); if (page.width() <= 0) return;
    const a = view.el.getBoundingClientRect(), b = this.viewportLayer.getBoundingClientRect();
    const left = Math.round(a.left - b.left + page.left + e.left * page.width());
    const top = Math.round(a.top - b.top + page.top + e.top * page.height());
    const width = Math.max(80, Math.round((e.right - e.left) * page.width()));
    const px = Math.max(9, page.width() * e.textSize);
    let changed = false;
    if (Math.abs((this._inlinePx || 0) - px) > .4) { this._inlinePx = px; edit.style.fontSize = px + 'px'; edit.style.lineHeight = (px * 1.35) + 'px'; changed = true; }
    if (edit.style.paddingLeft !== '3px') { edit.style.paddingLeft = '3px'; changed = true; }
    if (edit.style.left !== left + 'px') edit.style.left = left + 'px';
    if (edit.style.top !== top + 'px') edit.style.top = top + 'px';
    if (edit.style.width !== width + 'px') { edit.style.width = width + 'px'; changed = true; }
    if (changed || this._inlineDirty) { this._inlineDirty = false; edit.style.height = 'auto'; edit.style.height = edit.scrollHeight + 2 + 'px'; }
    const height = edit.offsetHeight;
    const editBottom = top + Math.max(18, height);
    this.placeHandle(this.inlineMove, left - 8, top - 34);
    this.placeHandle(this.inlineDelete, left + width - 22, top - 34);
    this.placeHandle(this.inlineResize, left + width - 12, editBottom - 10);
    this.placeInlineBar(top, editBottom);
  },
  /** Keeps the toolbar clear of the text being typed: above the box first (the keyboard covers the lower part), else below, else at the top. */
  placeInlineBar(editTop, editBottom) {
    const bar = this.inlineBar, layer = this.viewportLayer;
    if (!bar || !layer || layer.clientHeight <= 0) return;
    const barH = bar.offsetHeight > 0 ? bar.offsetHeight : 42, H = layer.clientHeight, gap = 4;
    let topMargin;
    if (editTop - 36 - barH - gap >= 2) topMargin = editTop - 36 - barH - gap;
    else if (H - editBottom - 14 >= barH + gap) topMargin = editBottom + 14 + gap;
    else topMargin = 4;
    topMargin = Math.max(0, Math.min(topMargin, Math.max(0, H - barH)));
    if (bar.style.top !== topMargin + 'px') bar.style.top = topMargin + 'px';
  },
  placeHandle(handle, left, top) {
    if (!handle) return;
    const layer = this.viewportLayer;
    if (layer && layer.clientWidth > 0) {
      left = Math.max(2, Math.min(left, layer.clientWidth - handle.offsetWidth - 2));
      top = Math.max(2, Math.min(top, layer.clientHeight - handle.offsetHeight - 2));
    }
    if (handle.style.left !== left + 'px') handle.style.left = left + 'px';
    if (handle.style.top !== top + 'px') handle.style.top = top + 'px';
  },
  applyInlineStyle() {
    const edit = this.inlineEdit, e = this.inlineElement; if (!edit || !e) return;
    const tf = AnnotationPainter.typeface(e.font, e.bold, e.italic);
    edit.style.fontFamily = tf.family; edit.style.fontWeight = tf.getStyle() & 1 ? '700' : '400'; edit.style.fontStyle = tf.getStyle() & 2 ? 'italic' : 'normal';
    edit.style.color = css(e.color | 0xFF000000);
    edit.style.textAlign = ['left', 'center', 'right'][AnnotationPainter.alignIndex(e.align)];
    edit.style.textDecoration = [e.underline ? 'underline' : '', e.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none';
    if (this._inlineSync) this._inlineSync();
    if (this.inlineSize) this.inlineSize.textContent = this.pointsOf(e) + 'pt';
    this._inlineDirty = true; this.positionInlineText();
  },
  // ---- list markers typed as plain text ('• ', '1. ', '☐ '/'☑ ') exactly like Android v1.29.0, so they survive export and backups
  /** Adds, switches or removes the marker on every line touched by the selection (or the cursor line). kind: 1 bullet, 2 number, 3 checklist. */
  toggleListMarker(kind) {
    const edit = this.inlineEdit; if (!edit) return;
    const PE = AnnotationStore.PageElement, all = edit.value;
    const a = Math.min(edit.selectionStart, edit.selectionEnd), b = Math.max(edit.selectionStart, edit.selectionEnd);
    const start = a === 0 ? 0 : all.lastIndexOf('\n', a - 1) + 1; let end = all.indexOf('\n', b); if (end < 0) end = all.length;
    const lines = all.substring(start, end).split('\n');
    const allSame = lines.every(l => PE.markerKind(l) === kind);
    const allUnchecked = kind === 3 && allSame && lines.every(l => l.startsWith(PE.CHECK));
    let number = 1;
    const out = lines.map(line => {
      const body = line.substring(PE.markerLength(line));
      if (allUnchecked) return PE.CHECKED + body;
      if (allSame) return body;
      return PE.markerFor(kind, number++) + body;
    }).join('\n');
    edit.setRangeText(out, start, end, 'end');
    this.inlineElement.text = edit.value; this._inlineDirty = true; this.positionInlineText(); if (this._inlineSync) this._inlineSync();
  },
  /** After Enter inside a list: starts the next item (numbers count up); Enter on an empty item ends the list. */
  continueList(newlineAt) {
    const edit = this.inlineEdit, PE = AnnotationStore.PageElement; if (!edit || newlineAt < 0 || edit.value[newlineAt] !== '\n') return;
    const text = edit.value, lineStart = newlineAt === 0 ? 0 : text.lastIndexOf('\n', newlineAt - 1) + 1;
    const previous = text.substring(lineStart, newlineAt), kind = PE.markerKind(previous); if (kind === 0) return;
    if (previous.length === PE.markerLength(previous)) { edit.setRangeText('', lineStart, newlineAt + 1, 'end'); return; }
    let number = 1; if (kind === 2) number = parseInt(/^(\d+)\. /.exec(previous)[1], 10) + 1;
    const marker = PE.markerFor(kind, number);
    edit.setRangeText(marker, newlineAt + 1, newlineAt + 1, 'end');
  },
  /** Marker kind of the line holding the caret (0 none, 1 bullet, 2 number, 3 checklist). */
  currentLineKind() {
    const edit = this.inlineEdit; if (!edit) return 0;
    const all = edit.value, at = Math.max(0, edit.selectionStart), start = at === 0 ? 0 : all.lastIndexOf('\n', at - 1) + 1; let end = all.indexOf('\n', start);
    return AnnotationStore.PageElement.markerKind(all.substring(start, end < 0 ? all.length : end));
  },
  setInlineFont(id) {
    if (!this.inlineElement || !AnnotationStore.PageElement.FONTS.includes(id)) return;
    this.inlineElement.font = id; if (this.inlineFontLabel) this.inlineFontLabel(); this.applyInlineStyle();
  },
  changeInlineSize(delta) {
    if (!this.inlineElement) return;
    const points = Math.max(8, Math.min(72, this.pointsOf(this.inlineElement) + delta));
    this.inlineElement.textSize = points / TEXT_PAGE_POINTS; this.applyInlineStyle();
  },
  /** Typing toolbar (icon buttons, Samsung Notes style): row 1 Aa . B I U . size . delete . done; row 2 align L/C/R . bullet / number / check list.
   *  The font and colour rows open only when "Aa" is tapped. */
  buildInlineBar(e) {
    const card = h('div', { class: 'm3-inline-bar', dataset: { tag: 'inline_style_bar' } });
    const panel = h('div', { class: 'm3-inline-panel', style: { display: 'none' } });
    // Android v1.32.0: the font is a combo box showing the chosen font in its own typeface; its menu previews every font
    const faces = h('div', { class: 'm3-fontbox', role: 'button', 'aria-label': '글꼴 선택', dataset: { tag: 'text_fonts' } });
    const showFont = () => { const at = Math.max(0, FONT_IDS.indexOf(e.font)); faces.textContent = '글꼴  ' + FONT_NAMES[at] + '  ▾'; faces.style.font = AnnotationPainter.typeface(e.font, false, false).css(14); };
    showFont(); this.inlineFontLabel = showFont;
    faces.addEventListener('mousedown', ev => ev.preventDefault());
    faces.addEventListener('click', () => {
      let menu;
      const rows = FONT_IDS.map((id, i) => {
        const sample = h('div', { class: 'm3-fontrow', role: 'button', 'aria-label': FONT_NAMES[i], dataset: { font: id }, style: { color: id === e.font ? '#007AFF' : '#1C1C1E', font: AnnotationPainter.typeface(id, false, false).css(16) } }, FONT_NAMES[i] + '   가나다 ABC abc');
        sample.addEventListener('click', () => { this.setInlineFont(id); if (menu) menu.close(); });
        return AnchoredMenu.Row.custom(sample);
      });
      menu = AnchoredMenu.show(faces, false, rows, null);
    });
    panel.append(faces);
    const palette = this.swatches(TEXT_COLORS, () => e.color | 0xFF000000, c => { e.color = c | 0xFF000000; this.applyInlineStyle(); }, 26, 1);
    palette.dataset.tag = 'text_colors'; palette.style.padding = '2px 0'; palette.style.height = '34px'; panel.append(palette);
    const tbtn = (content, label, tag, onClick) => {
      const b = h('button', { class: 'm3-tbtn', type: 'button', 'aria-label': label, title: label, 'aria-pressed': 'false', dataset: { tag } }, content);
      b.addEventListener('mousedown', ev => ev.preventDefault());     // keep the caret in the text box
      b.addEventListener('click', onClick); return b;
    };
    const row = h('div', { class: 'm3-inline-row' }), row2 = h('div', { class: 'm3-inline-row m3-inline-row2' });
    const style = tbtn('Aa', '글꼴·색 펼치기', 'text_style_toggle', () => {
      const open = panel.style.display === 'none'; panel.style.display = open ? '' : 'none'; style.classList.toggle('on', open);
    });
    style.classList.add('m3-aa');
    const bold = tbtn(h('span', { style: { fontWeight: '800', fontSize: '16px' } }, 'B'), '굵게', 'text_bold', () => { e.bold = !e.bold; this.applyInlineStyle(); });
    const italic = tbtn(icon('ic_italic', 20, 'currentColor'), '기울임', 'text_italic', () => { e.italic = !e.italic; this.applyInlineStyle(); });
    const underline = tbtn(icon('ic_underline', 20, 'currentColor'), '밑줄', 'text_underline', () => { e.underline = !e.underline; this.applyInlineStyle(); });
    const strike = tbtn(icon('ic_strike', 20, 'currentColor'), '취소선', 'text_strike', () => { e.strike = !e.strike; this.applyInlineStyle(); });
    const minus = tbtn(icon('ic_minus', 18, 'currentColor'), '글자 작게', 'text_smaller', () => this.changeInlineSize(-1));
    const plus = tbtn(icon('ic_plus', 18, 'currentColor'), '글자 크게', 'text_bigger', () => this.changeInlineSize(1));
    this.inlineSize = h('div', { class: 'm3-inline-size', dataset: { tag: 'text_size' } });
    row.append(style, bold, italic, underline, strike, h('div', { class: 'm3-sep' }), minus, this.inlineSize, plus, h('div', { style: { flex: '1' } }));
    row.append(iconButton('ic_delete', '글상자 삭제', DANGER, () => this.deleteInlineText(), 34, 34, 7));
    const done = iconButton('ic_check', '입력 완료', 0xFFFFFFFF | 0, () => this.commitInlineText(), 34, 34, 7);
    done.dataset.tag = 'text_done'; done.style.background = css(ACCENT); done.style.borderRadius = '17px'; done.style.marginLeft = '4px';
    row.append(done);
    const aligns = [[0, 'left', '왼쪽 정렬', 'ic_align_left'], [1, 'center', '가운데 정렬', 'ic_align_center'], [2, 'right', '오른쪽 정렬', 'ic_align_right']]
      .map(([v, name, label, ic]) => ({ v, b: tbtn(icon(ic, 20, 'currentColor'), label, 'text_align_' + name, () => { e.align = v; this.applyInlineStyle(); }) }));
    const lists = [[1, 'bullet', '글머리 기호', 'ic_list_bullet'], [2, 'number', '번호 매기기', 'ic_list_number'], [3, 'check', '체크리스트', 'ic_list_check']]
      .map(([v, name, label, ic]) => ({ v, b: tbtn(icon(ic, 20, 'currentColor'), label, 'text_list_' + name, () => { this.toggleListMarker(v); this.inlineEdit && this.inlineEdit.focus(); }) }));
    row2.append(...aligns.map(a => a.b), h('div', { class: 'm3-sep' }), ...lists.map(l => l.b));
    const mark = (b, on) => { b.classList.toggle('on', !!on); b.setAttribute('aria-pressed', String(!!on)); };
    this._inlineSync = () => {
      mark(bold, e.bold); mark(italic, e.italic); mark(underline, e.underline); mark(strike, e.strike);
      const al = AnnotationPainter.alignIndex(e.align), ck = this.currentLineKind();
      aligns.forEach(a => mark(a.b, al === a.v)); lists.forEach(l => mark(l.b, ck === l.v));
    };
    card.append(row, row2, panel);
    this.inlineBar = card;
    this.viewportLayer.append(card);
  },
  removeInlineViews() {
    AnnotationPainter.skip = null;
    if (this._inlineRaf) cancelAnimationFrame(this._inlineRaf); this._inlineRaf = 0;
    for (const v of [this.inlineEdit, this.inlineMove, this.inlineResize, this.inlineDelete, this.inlineBar]) if (v) v.remove();
    if (this.inlineEdit && document.activeElement === this.inlineEdit) this.inlineEdit.blur();
    this.inlineEdit = null; this._inlineSync = null; this.inlineMove = this.inlineResize = this.inlineDelete = null; this.inlineBar = null; this.inlineSize = null;
    this.inlineElement = null; this.inlineStore = null; this.inlineView = null; this._inlinePx = 0;
  },
  /** Saves the text being typed (an empty new box is dropped; emptying an old box deletes it). */
  commitInlineText() {
    if (!this.inlineElement) return;
    const e = this.inlineElement, target = this.inlineStore, fresh = this.inlineFresh;
    const text = (this.inlineEdit ? this.inlineEdit.value : e.text || '').trim();
    this.removeInlineViews();
    if (text === '') { if (!fresh && target) { const i = target.elements.indexOf(e); if (i >= 0) target.elements.splice(i, 1); target.save(); } }
    else {
      e.text = text;
      this.fitTextElement(e);
      if (fresh && target && !target.elements.includes(e)) target.elements.push(e);
      if (target) target.save();
      this.saveTextStyle(e);
    }
    this.redrawPages();
  },
  deleteInlineText() {
    if (!this.inlineElement) return;
    const e = this.inlineElement, target = this.inlineStore, fresh = this.inlineFresh;
    this.removeInlineViews();
    if (!fresh && target) { const i = target.elements.indexOf(e); if (i >= 0) target.elements.splice(i, 1); target.save(); }
    this.redrawPages();
  },

  // ================================================================== iOS-style action sheet and editor card
  showActionSheet(title, labels, checked, pick) { return uiActionSheet(title, labels, checked, pick); },
  showRecordingMenu(clip, anchor) {
    const R = AnchoredMenu.Row;
    AnchoredMenu.showRightOf(anchor || this.sidePanel, this.sidePanel, [
      new R('재생', 'ic_speaker', () => { Promise.resolve(this.showPage(clip.page)).then(() => this.showAudioPlayer(clip)); }).tint('#30B0C7'),
      new R('삭제', 'ic_delete', () => this.deleteRecording(clip)).danger()]);
  },
  rebuildRecordings() {
    this.recordingList.textContent = ''; if (!this.store) return;
    const rec = !!this.recorder;
    const record = this.pill(rec ? '■ 녹음 중 · 눌러서 정지·첨부' : '● 녹음 시작', '녹음 시작·정지', rec ? DANGER : 0xFFFFE3E8 | 0, rec ? 0xFFFFFFFF | 0 : 0xFFD6304E | 0, () => { if (this.recorder) this.stopRecording(true); else this.startRecording(); });
    record.dataset.tag = 'record_button'; record.style.height = '46px'; record.style.marginBottom = '8px'; this.recordingList.append(record);
    const clips = this.store.elements.filter(e => e.kind === 'audio').sort((a, b) => a.page - b.page || a.top - b.top);
    if (!clips.length) { this.recordingList.append(h('div', { class: 'm3-empty' }, '녹음하면 현재 페이지에 음성 메모가 첨부됩니다.\n페이지의 ‘▶ 녹음’ 표시를 탭하면 재생합니다.')); return; }
    for (const clip of clips) {
      const row = h('div', { class: 'm3-row m3-recrow', dataset: { tag: 'recording_item' } }, h('div', { class: 'm3-row-text' }, '▶  ' + clip.text + '\n페이지 ' + (clip.page + 1)));
      row.addEventListener('click', () => { Promise.resolve(this.showPage(clip.page)).then(() => this.showAudioPlayer(clip)); });
      this.swipeToDelete(row, () => this.deleteRecording(clip));
      { const mb = iconButton('ic_more_vert', '녹음 관리', NAVY, ev => { ev.stopPropagation(); this.showRecordingMenu(clip, mb); }, 44, 44, 10); row.append(mb); }
      this.recordingList.append(row);
    }
  },

  // ================================================================== voice recording attached to a page
  clock(seconds) { return clock(seconds); },
  async startRecording() {
    if (!this.renderer || !this.store) { this.toast('문서를 먼저 여세요'); return; }
    if (this.recorder || this._recStarting) { this.toast('이미 녹음 중입니다'); return; }
    this._recStarting = true;
    let stream;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('unsupported');
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      this._recStarting = false;
      this.toast(error && (error.name === 'NotAllowedError' || error.name === 'SecurityError') ? '마이크 권한이 있어야 녹음할 수 있습니다' : '녹음을 시작할 수 없습니다');
      return;
    }
    let mr, mime = '';
    try {
      mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
      mr = new MediaRecorder(stream, Object.assign({ audioBitsPerSecond: 96000 }, mime ? { mimeType: mime } : {}));
      const chunks = []; mr.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      mr.start(1000);
      this.recorder = { mr, stream, chunks, mime: mr.mimeType || mime || 'audio/webm' };
    } catch (error) {
      try { stream.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
      this._recStarting = false; this.toast('녹음을 시작할 수 없습니다'); return;
    }
    this._recStarting = false;
    this.recordingFile = AnnotationStore.newAssetName('m4a'); this.recordingStore = this.store; this.recordingPage = this.currentPage; this.recordingStarted = performance.now();
    this.showRecorderBar(); if (this.sidebarVisible && this.panelTab === 3) this.rebuildRecordings();
  },
  showRecorderBar() {
    const bar = this.recorderBar = h('div', { class: 'm3-recbar', dataset: { tag: 'recorder_bar' } });
    this.recorderTime = h('div', { class: 'm3-rectime', dataset: { tag: 'recorder_time' } }, '녹음 중 0:00');
    const stop = this.pill('정지·첨부', '녹음 정지 후 첨부', DANGER, 0xFFFFFFFF | 0, () => this.stopRecording(true)); stop.dataset.tag = 'recorder_stop'; stop.style.cssText += 'height:40px;padding:0 14px;';
    const cancel = this.pill('취소', '녹음 취소', 0xFFF2F2F7 | 0, NAVY, () => this.stopRecording(false)); cancel.dataset.tag = 'recorder_cancel'; cancel.style.cssText += 'height:40px;padding:0 14px;margin-left:6px;';
    bar.append(h('div', { style: { color: css(DANGER), fontSize: '16px' } }, '●'), this.recorderTime, stop, cancel);
    this.viewportLayer.append(bar);
    clearInterval(this._recTimer);
    this._recTimer = setInterval(() => {
      if (!this.recorder || !this.recorderBar) { clearInterval(this._recTimer); return; }
      this.recorderTime.textContent = '녹음 중 ' + clock((performance.now() - this.recordingStarted) / 1000);
    }, 500);
  },
  async stopRecording(attach) {
    const r = this.recorder; if (!r) return;
    this.recorder = null;
    const elapsed = performance.now() - this.recordingStarted, seconds = Math.floor(elapsed / 1000);
    clearInterval(this._recTimer);
    if (this.recorderBar) { this.recorderBar.remove(); this.recorderBar = null; }
    const file = this.recordingFile, target = this.recordingStore, page = this.recordingPage;
    this.recordingFile = null; this.recordingStore = null;
    if (this.sidebarVisible && this.panelTab === 3) this.rebuildRecordings();
    await new Promise(res => {
      let done = false; const fin = () => { if (!done) { done = true; res(); } };
      r.mr.addEventListener('stop', fin); setTimeout(fin, 3000);
      try { if (r.mr.state !== 'inactive') r.mr.stop(); else fin(); } catch { fin(); }
    });
    try { r.stream.getTracks().forEach(t => t.stop()); } catch { /* ignore */ }
    const blob = new Blob(r.chunks, { type: r.mime });
    const ok = blob.size > 0 && elapsed >= 600;
    if (!attach || !ok || !file || !target) {
      if (attach && !ok) this.toast('녹음이 너무 짧아 저장하지 않았습니다');
      return;
    }
    try { await AnnotationStore.saveAsset(file, blob); } catch (error) { this.toast('녹음을 저장할 수 없습니다: ' + (error && error.message)); return; }
    const count = target.elements.filter(o => o.page === page && o.kind === 'audio').length;
    const clip = new AnnotationStore.PageElement();
    clip.page = page; clip.kind = 'audio'; clip.asset = file; clip.text = clock(seconds);
    clip.left = .04; clip.top = Math.min(.9, .03 + .055 * (count % 16)); clip.right = .42; clip.bottom = clip.top + .045;
    target.elements.push(clip); target.save(); this.redrawPages();
    if (this.sidebarVisible && this.panelTab === 3) this.rebuildRecordings();
    this.toast('녹음을 p.' + (page + 1) + '에 첨부했습니다');
  },
  deleteRecording(clip) {
    if (!this.store) return;
    const i = this.store.elements.indexOf(clip); if (i >= 0) this.store.elements.splice(i, 1);
    this.store.save(); AnnotationStore.deleteAsset(clip.asset).catch(() => {});
    this.redrawPages(); if (this.sidebarVisible && this.panelTab === 3) this.rebuildRecordings();
  },
  async showAudioPlayer(clip) {
    let present = false; try { present = await AnnotationStore.hasAsset(clip.asset); } catch { /* ignore */ }
    if (!present) {
      new AlertDialog.Builder().setTitle('녹음').setMessage('녹음 파일을 찾을 수 없습니다. 이 기기에서 만든 녹음만 재생할 수 있습니다.')
        .setPositiveButton('닫기').setNegativeButton('삭제', () => this.deleteRecording(clip)).show();
      return;
    }
    let url; try { url = await AnnotationStore.assetUrl(clip.asset); } catch { this.toast('녹음을 재생할 수 없습니다'); return; }
    const audio = new Audio(); audio.preload = 'auto'; audio.src = url;
    const parsed = (() => { const m = /^(\d+):(\d+)$/.exec(clip.text || ''); return m ? (+m[1] * 60 + +m[2]) * 1000 : 0; })();
    const ready = await new Promise(res => {
      audio.addEventListener('loadedmetadata', () => res(true), { once: true }); audio.addEventListener('error', () => res(false), { once: true });
      setTimeout(() => res(audio.readyState > 0), 4000);
    });
    if (!ready) { try { audio.removeAttribute('src'); audio.load(); } catch { /* ignore */ } this.toast('녹음을 재생할 수 없습니다'); return; }
    let total = isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration * 1000) : parsed;
    if (!isFinite(audio.duration)) { // MediaRecorder webm has no duration: force the browser to compute it
      audio.currentTime = 1e7;
      await new Promise(res => { audio.addEventListener('timeupdate', res, { once: true }); setTimeout(res, 1500); });
      if (isFinite(audio.duration) && audio.duration > 0) total = Math.round(audio.duration * 1000);
      audio.currentTime = 0;
    }
    let alive = true;
    const time = h('div', { class: 'm3-audio-time', dataset: { tag: 'audio_time' } }, clock(0) + ' / ' + clock(total / 1000));
    const seek = h('input', { type: 'range', class: 'm3-seek', min: 0, max: Math.max(1, total), value: 0, step: 1 });
    const play = this.pill('▶ 재생', '녹음 재생', ACTIVE_BG, ACTIVE_FG, null); play.dataset.tag = 'audio_play'; play.style.height = '46px'; play.style.marginTop = '6px';
    const panel = h('div', { class: 'm3-audio' }, time, seek, play);
    const pos = () => Math.min(total, Math.round(audio.currentTime * 1000));
    const tick = () => {
      if (!alive) return;
      const p = pos(); seek.value = p; time.textContent = clock(p / 1000) + ' / ' + clock(total / 1000);
      if (!audio.paused && !audio.ended) setTimeout(tick, 250); else if (!audio.ended) play.textContent = '▶ 재생';
    };
    play.addEventListener('click', () => {
      if (!alive) return;
      if (!audio.paused) { audio.pause(); play.textContent = '▶ 재생'; }
      else { if (pos() >= total - 100) audio.currentTime = 0; audio.play().then(() => { play.textContent = '❚❚ 일시정지'; setTimeout(tick, 0); }).catch(() => this.toast('녹음을 재생할 수 없습니다')); }
    });
    audio.addEventListener('ended', () => { play.textContent = '▶ 재생'; seek.value = total; time.textContent = clock(total / 1000) + ' / ' + clock(total / 1000); });
    seek.addEventListener('input', () => { if (alive) { audio.currentTime = +seek.value / 1000; time.textContent = clock(+seek.value / 1000) + ' / ' + clock(total / 1000); } });
    new AlertDialog.Builder().setTitle('녹음 · p.' + (clip.page + 1)).setView(panel).setPositiveButton('닫기')
      .setNegativeButton('삭제', () => this.deleteRecording(clip))
      .setOnDismissListener(() => { alive = false; try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch { /* ignore */ } }).show();
  },

  // ================================================================== help
  /** Large, left aligned help card: sections by principle and by menu (13 chapters), scrolls inside the card. */
  showHelp() {
    const card = h('div', { class: 'm3-help', dataset: { tag: 'help_card' } });
    card.append(h('div', { class: 'm3-help-title' }, 'Everynote 사용법'), h('div', { class: 'm3-help-ver' }, '버전 ' + this.appVersion()));
    const body = h('div', { class: 'm3-help-body' });
    for (const sec of HELP) {
      body.append(h('div', { class: 'm3-help-h' }, sec[0]));
      for (let k = 1; k < sec.length; k++) {
        const bar = sec[k].indexOf('|');
        body.append(h('div', { class: 'm3-help-item' }, h('b', null, sec[k].slice(0, bar)), '\n' + sec[k].slice(bar + 1)));
      }
    }
    card.append(body, h('div', { class: 'm3-help-line' }));
    const root = h('div', { class: 'ad-root' }), dim = h('div', { class: 'ad-dim' }, card); root.append(dim);
    let done = false;
    const close = () => { if (done) return; done = true; document.removeEventListener('keydown', onKey, true); root.classList.remove('in'); root.classList.add('out'); setTimeout(() => root.remove(), 120); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
    const ok = h('div', { class: 'm3-help-ok', role: 'button', 'aria-label': '확인' }, '확인'); ok.addEventListener('click', close);
    card.append(ok);
    dim.addEventListener('mousedown', e => { if (e.target === dim) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(root); requestAnimationFrame(() => root.classList.add('in'));
  },
  appVersion() { return this._appVersion || ''; },
  toast(s) { showToast(s); },

  // ================================================================== lifecycle glue
  closeAllDocuments() {
    this.closeSearch();
    for (const s of [...(this.sessions || [])]) {
      try { if (s.renderer && s.renderer.destroy) s.renderer.destroy(); } catch { /* ignore */ }
      if (s.officePreview && host) host.delete(s.officePreview).catch(() => {});
    }
    this.sessions.length = 0; this.renderer = null;
  },
  /** Writes every pending annotation save (call before the window closes). */
  async flushAll() { try { await AnnotationStore.flushAll(); } catch { /* ignore */ } },
  onStop() {
    this.commitInlineText(); if (this.onSelectionAdjustStarted) this.onSelectionAdjustStarted();
    try { if (this.saveSessionState) this.saveSessionState(); } catch (e) { console.error(e); }
    this.flushAll();
  },
  onDestroy() {
    if (this._destroyed) return; this._destroyed = true;
    this.stopRecording(true);
    if (this.libraryDialog && this.libraryDialog.dismiss) { try { this.libraryDialog.dismiss(); } catch { /* ignore */ } }
    if (this.searchCanceled) this.searchCanceled.value = true;
    if (this.hwpConversion && this.hwpConversion.cancel) { try { this.hwpConversion.cancel(); } catch { /* ignore */ } }
    this.commitInlineText();
    try { if (this.saveSessionState) this.saveSessionState(); } catch (e) { console.error(e); }
    ++this.ocrGeneration;
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch { /* ignore */ }
    this.flushAll().then(() => this.closeAllDocuments());
  },
};

export function installMain3(cls) {
  Object.assign(cls.prototype, methods);
}

export function initMain3(app) {
  // only fill what part 1/2 have not set up already
  const dflt = (k, v) => { if (app[k] === undefined) app[k] = v; };
  for (const k of ['inlineEdit', 'inlineElement', 'inlineStore', 'inlineView', 'inlineMove', 'inlineResize', 'inlineDelete', 'inlineBar', 'inlineSize',
    'recorder', 'recordingFile', 'recordingStore', 'recorderBar', 'recorderTime', 'lassoBar']) dflt(k, null);
  dflt('inlineFresh', false); dflt('recordingStarted', 0); dflt('recordingPage', 0);
  app.lassoShape = prefs.getInt('lasso_shape', 0);
  app._appVersion = ''; app._destroyed = false;
  host.info().then(i => { app._appVersion = (i && i.version) || ''; }).catch(() => {});
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') app.onStop(); });
  window.addEventListener('pagehide', () => app.onDestroy());
}

const HELP = [
  ["1. 기본 원리",
    "문서 위에 겹쳐 쓰기|필기·하이라이트·메모·도형·사진 같은 모든 기록은 PDF 위에 얹는 별도 ‘주석 층’으로 앱 안에 저장됩니다. 원본 PDF 파일은 바뀌지 않으며, 내보내기를 하면 기록이 합쳐진 새 PDF가 만들어집니다.",
    "자동 저장|기록은 바로 저장되고, 앱을 다시 열면 열어 둔 탭과 마지막 페이지가 복원됩니다.",
    "문서함|상단 왼쪽 폴더 버튼에서 PDF·노트·Office 문서를 폴더별로 관리합니다. 새 문서는 폴더 버튼 또는 탭 줄의 + 버튼으로 추가합니다.",
    "여러 문서|상단 탭으로 문서를 전환하고 × 로 닫습니다. 기록은 문서마다 따로 저장됩니다."],
  ["2. 화면 구성",
    "상단 줄|문서함, 문서 이름, 페이지 미리보기, 검색, 전체 화면, 더보기(⋮) 메뉴가 있습니다.",
    "하단 도구 줄|읽기 · 펜 · 하이라이트 · 지우개 · 올가미 · 텍스트 · 메모 · 삽입 · 실행 취소 · 다시 실행 순서이며 모두 아이콘입니다(마우스를 올리면 이름이 보입니다). 선택한 도구는 배경이 진하게 표시되고, 선택된 도구를 한 번 더 누르면 굵기·색 같은 세부 설정이 열립니다.",
    "확대 · 축소 · 페이지 추가|화면 왼쪽의 알약 버튼으로 확대(＋) · 축소(－)하고, 가운데 % 표시를 누르면 100%로 돌아옵니다(Ctrl + 휠 · Ctrl + ＋/－/0도 됩니다). 화면 오른쪽 아래의 ‘페이지 추가’ 버튼은 현재 페이지 뒤에 새 페이지를 넣습니다.",
    "왼쪽 패널|검색 · 페이지 미리보기 · 개요 · 음성 녹음 탭이 있습니다. 개요 아이콘으로 열고 × 로 닫습니다.",
    "반투명 화살표|본문 양옆의 화살표를 누르면 이전·다음 페이지로 이동합니다."],
  ["3. 읽기와 이동",
    "마우스·키보드로 넘기기|읽기 모드에서 마우스 휠, 본문 좌우 가장자리의 화살표 버튼, 키보드 ← → ↑ ↓ · PageUp/PageDown(Home/End는 처음/마지막 페이지)으로 넘기고, 마우스로 페이지를 끌어도 손가락처럼 책장이 넘어갑니다. 필기 모드에서는 마우스가 펜처럼 글씨를 쓰므로 끌어서는 넘어가지 않습니다(휠 · 화살표 · 키보드는 사용 가능).",
    "페이지 넘기기|본문을 좌우로 쓸어 넘깁니다. 손가락을 따라 책장이 접히며, 아래쪽을 잡으면 아래 모서리부터, 위쪽을 잡으면 위쪽부터 넘어갑니다. 더보기 메뉴의 ‘넘김 효과’에서 책장 넘김 · 슬라이드 · 효과 없음 중에서 고를 수 있습니다.",
    "확대·이동|두 손가락으로 확대하고, 확대한 상태에서는 드래그로 화면을 옮깁니다. 확대 중에는 화면 가장자리에서 쓸어야 페이지가 넘어갑니다.",
    "전체 화면|상단의 전체 화면 버튼을 누르면 메뉴가 숨겨집니다. 화면 아래에서 위로 쓸어올리면 도구 모음이 다시 나타납니다.",
    "검은 문서 배경|더보기 메뉴에서 켜면 종이를 검게, 글자는 밝게 표시합니다. 어두운 색 필기는 자동으로 밝게 보정됩니다.",
    "두 쪽 보기|가로로 넓은 화면(태블릿·폴드)에서 두 페이지를 나란히 봅니다."],
  ["4. 텍스트 선택과 단어 찾기",
    "선택하기|단어를 길게 누른 뒤 드래그해서 범위를 정합니다.",
    "선택 팝업|선택한 글자를 가리지 않는 위치(아래 · 위 · 옆)에 열립니다. 하이라이트 · 복사 · 번역 · 읽어주기 · 단어장 · 개요 · 메모 · 발췌 · 링크가 있고, 맨 아래 ‘삽입’을 누르면 사진 · 스티커 · 도형 같은 삽입 항목이 열립니다.",
    "단어장|‘단어장’을 누르면 선택한 영어 단어가 복사되고 ‘단어가 복사되었습니다’ 메시지가 나타납니다. 복사한 단어는 원하는 사전이나 단어장 앱에 붙여넣어 사용하세요."],
  ["5. 필기 (펜)",
    "펜 선택|하단의 연필 아이콘을 눌러 필기 모드로 들어갑니다. S펜은 바로 쓰이고, 손가락 필기는 펜 메뉴의 ‘손가락 필기’를 켜야 합니다.",
    "펜 메뉴|펜 아이콘을 한 번 더 누르면 펜 종류(볼펜 · 연필 · 만년필 · 붓 · 사인펜), 굵기(선 4단계), 색, 투명도, 직선 · 손가락 필기 스위치가 아이콘으로 나타납니다.",
    "펜 종류|펜 메뉴 맨 위 두 줄은 아이콘입니다. 첫 줄은 굵기(4단계, 선이 굵어지는 순서), 둘째 줄은 볼펜 · 연필 · 만년필 · 붓 · 사인펜이며 각 칸에 실제 획 모양이 그려져 있습니다. 연필은 가늘고 살짝 흐리며, 만년필은 펜촉 각도에 따라 굵기가 변하고, 붓은 시작과 끝이 가늘어지며, 사인펜은 일정한 굵기로 쓰입니다.",
    "굵기·색·투명도|굵기는 선 아이콘 4단계(얇게~최대), 색은 기본 팔레트 또는 무지개 칩으로 원하는 색을 만들고, 투명도 막대로 흐리게 할 수 있습니다.",
    "직선|펜 메뉴의 직선(／) 아이콘을 켜면 시작점과 끝점을 잇는 반듯한 선을 긋습니다.",
    "지우개|지우개 아이콘으로 필기와 하이라이트를 지웁니다. 지울 부분을 문지르거나 눌러서 한 획(하이라이트는 한 덩어리)씩 지워집니다. 실행 취소·다시 실행도 사용할 수 있습니다.",
    "올가미|영역을 그려 필기를 선택하고 옮기거나 지웁니다. 올가미 모양(자유 · 네모 · 원)은 위쪽 아이콘 막대에서 바꿀 수 있습니다."],
  ["6. 하이라이트",
    "만드는 법|하이라이트 아이콘을 켜고 글자를 드래그하거나, 글자를 선택한 뒤 팝업의 ‘하이라이트’를 누릅니다.",
    "색·모양·굵기|하이라이트 아이콘을 한 번 더 누르면 색, 굵기 막대, 모양(직선 / 자유형)을 고를 수 있습니다. 직선은 좌우로 끌어 한 줄을 칠하고, 자유형은 손가락이나 펜으로 원하는 모양대로 그립니다.",
    "삭제|지우개로 문지르면 지워집니다. 하이라이트는 개요 목록에 나타나지 않습니다(메모가 붙은 것만 ‘메모’ 목록에 표시됩니다)."],
  ["7. 텍스트 상자",
    "넣기|하단의 T 아이콘을 누르고 문서를 탭하면 입력할 수 있습니다. 입력 중에는 글꼴 · 굵게 · 기울임 · 밑줄 · 취소선 · 크기 · 색과 정렬(왼쪽 · 가운데 · 오른쪽) · 글머리 기호 · 번호 매기기 · 체크리스트를 바꾸는 카드가 글상자 위나 아래에 나타납니다. 목록 줄에서 Enter를 누르면 다음 항목이 이어지고, 빈 항목에서 Enter를 누르면 목록이 끝납니다. 체크리스트 버튼을 한 번 더 누르면 ☑ 로 바뀌고, 또 누르면 해제됩니다(문서에서는 ☐ ☑ 를 눌러도 바뀝니다). 목록 표시는 글자로 저장되어 안드로이드 앱과 백업이 호환됩니다.",
    "정렬 · 목록 · 밑줄|카드의 둘째 줄에서 왼쪽 · 가운데 · 오른쪽 정렬과 글머리 기호(●) · 번호 목록(1. 2. 3.) · 체크리스트(☑)를 고릅니다. 체크리스트는 입력 중이나 입력을 마친 뒤에도 네모 칸을 눌러 완료 표시를 할 수 있습니다. ‘Aa’를 누르면 글꼴과 색 줄이 펼쳐집니다.",
    "이동·크기·삭제|입력 중 상자 위의 핸들로 이동하고, 모서리 핸들로 너비를 조절하며, 빨간 휴지통 또는 상자 위의 × 로 삭제합니다. ✓ 버튼으로 입력을 마칩니다."],
  ["8. 메모 포스트잇",
    "만들기|하단의 메모 아이콘을 누르고 문서를 탭해 내용을 입력합니다. 글자를 선택한 뒤 팝업의 ‘메모’로도 만들 수 있습니다.",
    "크기 조절|메모를 한 번 탭하면 점선 테두리와 오른쪽 아래 둥근 핸들이 나타납니다. 핸들을 끌어 가로·세로 크기를 자유롭게 바꿉니다. 이미 선택된 메모를 다시 탭하면 편집 창이 열립니다.",
    "편집 창|글자 크기(− ＋)는 메모 안 글자의 크기이고, 메모 상자 크기(작게·보통·크게)는 상자의 기본 크기입니다. 상자 크기를 고르면 직접 조절한 크기는 초기화됩니다. 메모 색은 기본 색, 무지개 칩, 투명도로 정합니다.",
    "숨기기·최소화|메모와 번역 포스트잇은 펼치기 · 최소화 · 숨기기로 관리합니다."],
  ["9. 삽입: 사진 · 스티커 · 도형 · 표 · 링크",
    "삽입 메뉴|하단의 + 상자 아이콘을 누르거나 문서의 빈 곳을 길게 눌러 열고, 넣을 종류를 고릅니다. 사진·동영상·유튜브 주소는 끌어다 놓거나 붙여넣기(Ctrl+V)도 됩니다.",
    "선택·이동·크기|넣은 개체를 한 번 탭하면 테두리와 핸들이 보입니다. 몸통을 끌면 이동, 네 모서리 핸들을 끌면 가로세로 비율을 유지한 채 크기 조절, 사진 · 스티커 · 동영상은 변 가운데의 막대 핸들을 끌어 가로 또는 세로만 따로 늘이거나 줄일 수 있습니다. 오른쪽 위의 빨간 × 를 누르면 바로 삭제됩니다. 메모와 번역 포스트잇도 한 번 탭하면 같은 방식으로 크기 · 회전(↻) · 삭제(×) · 이동을 할 수 있고, 한 번 더 탭하면 내용을 편집합니다. 마우스와 터치 모두 됩니다.",
    "삭제|선택한 개체의 ✕ 버튼을 누르거나 키보드 Delete 키를 누르면 지워집니다. 이미 선택된 개체를 한 번 더 탭하면 위치·크기 입력이나 색 설정 같은 세부 메뉴가 열립니다.",
    "회전|사진·스티커·도형·표는 선택하면 위쪽에 ↻ 핸들이 나타납니다. 끌면 돌아가고 15° 단위 근처에서 자석처럼 맞춰집니다. 도형은 모양 수정 창의 ‘회전’ 막대로 각도를 정할 수도 있습니다.",
    "도형·표|선 색, 채우기 색, 선 굵기를 정하고, 색마다 무지개 칩으로 원하는 색과 투명도를 고릅니다. 표는 행·열 수, 머리글 색, 칸 내용을 편집할 수 있습니다.",
    "하이퍼링크|글자를 선택한 뒤 팝업의 ‘링크’를 눌러 웹 주소, 현재 문서의 다른 페이지, 다른 문서로 연결합니다. 링크 글자는 파란 밑줄과 작은 화살표 배지로 표시되고, 탭하면 이동합니다."],
  ["10. 개요와 북마크",
    "개요 추가|개요 패널의 ‘＋ 개요 추가’를 누르고 문서의 원하는 위치를 탭한 뒤 제목을 입력합니다. 목록에는 ‘제목 (p19)’ 형식으로 표시되고 탭하면 그 위치로 이동합니다.",
    "관리|목록을 옆으로 밀면 삭제되고, ⋮ 버튼으로 이름 변경·삭제를 할 수 있습니다. 즐겨찾기(별)는 현재 페이지를 표시합니다."],
  ["11. 새 노트와 서식",
    "새 노트|문서함에서 새 노트를 만들면 종이 서식을 고릅니다. 백지 · 줄노트(보통·좁게·넓게) · 모눈종이 · 리걸노트 · 점 격자 · 코넬 노트 · 오선지가 있고, 종이 색도 고를 수 있습니다.",
    "내 서식|‘내 PDF·이미지 서식’을 고르면 가지고 있는 PDF의 첫 페이지나 이미지를 모든 페이지의 배경으로 씁니다.",
    "페이지 추가|‘페이지 추가’는 바로 앞 페이지와 같은 크기·방향·서식(백지, 금감원노트 등)의 새 페이지를 붙입니다. 노트의 마지막 장에서 다음으로 넘겨도 같은 페이지가 붙습니다. ‘다른 형식으로 페이지 추가’에서는 다른 종이와 A4 세로·가로 크기를 고를 수 있습니다."],
  ["12. 음성 녹음 · 검색 · 번역",
    "음성 녹음|개요 패널의 마이크 탭에서 녹음하면 현재 페이지에 ‘▶ 녹음’ 표시가 붙고, 탭하면 재생합니다.",
    "검색|돋보기 아이콘으로 본문 글자를 찾고, 손글씨 필기도 검색됩니다.",
    "번역·읽어주기|글자를 선택한 뒤 팝업에서 번역 또는 읽어주기를 고릅니다. 번역 결과가 있으면 바로 포스트잇으로 붙고 원문 · 번역 카드(수정 · 복사 · 삭제)가 열립니다. 기기 내 번역이 없으면 Google 번역이 열리고, 번역을 붙여넣은 뒤 ‘포스트잇 붙이기’를 누릅니다."],
  ["13. 문서 변환 · 내보내기",
    "Office·한글 문서|HWP · HWPX · DOC · DOCX · PPT · PPTX · XLS · XLSX는 PDF로 변환해 문서함에 가져와 엽니다. 서식은 변환 엔진과 글꼴에 따라 달라질 수 있고, HWP·DOC의 본문 미리보기는 글자만 표시합니다.",
    "내보내기·백업|더보기 메뉴에서 기록이 포함된 PDF를 내보내거나 기록을 파일로 백업·복원합니다.",
    "인쇄|더보기 메뉴의 ‘인쇄’(Ctrl + P)로 필기가 포함된 문서를 프린터나 PDF로 인쇄합니다."],
  ["14. 인터넷 연결이 없을 때",
    "인터넷이 필요한 기능|번역(구글 번역 열기) · 사전 웹 검색 · YouTube 링크 미리보기와 온라인 이미지 끌어오기, 그리고 WebView2 런타임을 처음 설치할 때 인터넷이 필요합니다. 연결이 없으면 해당 기능만 실패하고 나머지는 그대로 사용할 수 있습니다.",
    "인터넷 없이 되는 기능|PDF 열기 · 필기(펜·하이라이트·메모·도형) · 검색 · HWP·Office 문서 변환(PC에 Office 또는 LibreOffice가 설치되어 있어야 합니다) · OCR(글자 인식, Windows OCR 언어팩이 설치되어 있어야 합니다) · 내보내기 · 인쇄 · 문서함은 인터넷 없이 모두 동작합니다.",
    "회사 내부망에서|인터넷이 막힌 회사 내부망에서도 PDF를 열어 읽고 필기하고 인쇄하는 데는 지장이 없습니다. 번역은 외부 접속이 가능한 곳에서 사용하세요. 더보기 메뉴의 ‘오프라인 사용 안내’에서 같은 내용을 다시 볼 수 있습니다."]];
