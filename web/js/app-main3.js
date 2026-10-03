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
import { AlertDialog, showActionSheet as uiActionSheet } from './ui/alert.js';
import { AnnotationStore } from './store.js';
import { AnnotationPainter } from './painter.js';

const NAVY = 0xFF1C1C1E | 0, ACCENT = 0xFF007AFF | 0, ACTIVE_BG = 0xFFE5F0FF | 0, ACTIVE_FG = 0xFF007AFF | 0;
const GRAY = 0xFF8E8E93 | 0, DANGER = 0xFFFF3B30 | 0;
const CATEGORY_TITLES = ['문서', '보기·이동', '필기·삽입', '학습·주석', '내보내기·백업'];
const TEXT_COLORS = [0xFF1C1C1E, 0xFF8E8E93, 0xFF007AFF, 0xFF16835B, 0xFFEA580C, 0xFFFF3B30, 0xFFDB2777, 0xFF7C3AED].map(c => c | 0);
const FONT_IDS = ['sans', 'serif', 'mono', 'hand'];
const FONT_NAMES = ['고딕', '명조', '고정폭', '손글씨'];
const TEXT_PAGE_POINTS = 595;
const PAPER_COLORS = [0xFFFFF3A6, 0xFFFFD6E0, 0xFFCFE8FF, 0xFFD5F5D0, 0xFFFFE0B8, 0xFFE6D9FF, 0xFFFFFFFF].map(c => c | 0);
const SIDE_TITLES = ['검색', '페이지 미리보기', '개요', '음성 녹음'];
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
  const b = h('button', { class: 'm3-ib', type: 'button', 'aria-label': label, style: { width: w + 'px', height: hgt + 'px', padding: pad + 'px' } }, icon(name, 24, css(tint)));
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
        t.push(tile('현재 문서 이름 변경', 'ic_text', () => { if (this.activeSession) this.renameDocument(this.activeSession); else this.toast('문서를 먼저 여세요'); }));
        break;
      case 1:
        t.push(tile('페이지 미리보기', 'ic_thumbnails', run('toggleSidebar'), { selected: this.sidebarVisible }));
        t.push(tile('페이지로 이동', 'ic_page', run('goToPage')));
        t.push(tile('현재 페이지 뒤에 추가', 'ic_note_add', () => this.choosePageToInsert(this.currentPage)));
        t.push(tile('페이지 삭제', 'ic_delete', () => this.confirmDeletePage(this.currentPage), { tint: DANGER }));
        t.push(tile('두 쪽 보기 · ' + (this.twoPage ? '켜짐' : '꺼짐'), 'ic_thumbnails', run('toggleTwoPage'), { selected: this.twoPage }));
        t.push(tile('전체 화면', 'ic_fullscreen', run('toggleFullscreen')));
        t.push(tile('페이지 넘김 설정', 'ic_sliders', run('choosePageSwipeDirection')));
        t.push(tile('넘김 효과', 'ic_sliders', run('choosePageAnimation')));
        t.push(tile('읽기·페이지 넘김', 'ic_book', () => this.setInkMode(0)));
        break;
      case 2:
        t.push(tile('필기 모드', 'ic_ink', () => this.setWriteMode(true)));
        t.push(tile('올가미·영역 캡처', 'ic_lasso', run('startLasso')));
        t.push(tile('텍스트 선택', 'ic_scan', run('startTextSelection')));
        t.push(tile('타이핑', 'ic_text', run('toggleTyping')));
        t.push(tile('사진·이미지', 'ic_image', run('pickImage')));
        t.push(tile('스티커', 'ic_sticker', run('showStickerPicker')));
        t.push(tile('동영상', 'ic_video', run('pickVideo')));
        t.push(tile('하이퍼링크', 'ic_link', run('startHyperlink')));
        t.push(tile('이미지 붙여넣기', 'ic_copy', run('pasteImage')));
        t.push(tile('유튜브 링크', 'ic_video', run('askYoutube')));
        t.push(tile('음성 녹음', 'ic_mic', run('startRecording')));
        t.push(tile('메모 추가', 'ic_note_add', run('toggleMemoMode')));
        break;
      case 3:
        t.push(tile('문서·필기 검색', 'ic_search', run('searchDocument')));
        t.push(tile('듀얼 뷰 노트', 'ic_note_add', () => this.showStudy(false)));
        t.push(tile('발췌 바구니', 'ic_copy', () => this.showStudy(true)));
        t.push(tile('메모·하이라이트', 'ic_highlight', run('showMarkList')));
        t.push(tile('번역 포스트잇', 'ic_translate', run('showTranslations')));
        t.push(tile('책갈피', 'ic_star', run('showBookmarks')));
        t.push(tile('개요 목록', 'ic_outline', run('showOutlineList')));
        t.push(tile('개요 추가', 'ic_note_add', run('toggleOutlineMode')));
        t.push(tile('글자 다시 인식', 'ic_scan', () => this.recognizePageText(true)));
        break;
      default:
        t.push(tile('PDF 내보내기', 'ic_folder_open', run('exportPdf')));
        t.push(tile('노트·발췌 내보내기', 'ic_copy', run('exportStudy')));
        t.push(tile('주석 백업', 'ic_copy', run('exportAnnotations')));
        t.push(tile('주석 백업 복원', 'ic_undo', run('importSidecar')));
        t.push(tile('본문 미리보기 저장', 'ic_folder_open', run('saveToLibrary')));
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
    }, { selected: awake })]));
    sections.push(section('도움말', [tile('사용법', 'ic_outline', () => this.showHelp())]));
    return this.showSheet('메뉴', sections);
  },
  // ================================================================== lasso shape bar
  buildLassoBar() {
    const bar = this.lassoBar = h('div', { class: 'm3-lasso', dataset: { tag: 'lasso_bar' }, style: { display: 'none' } });
    const icons = ['ic_lasso', 'ic_rect', 'ic_circle'], names = ['자유', '네모', '원'];
    for (let i = 0; i < 3; i++) {
      const chip = h('div', { class: 'm3-lchip', role: 'button', 'aria-label': '올가미 ' + names[i], dataset: { tag: 'lasso_shape_' + i } },
        icon(icons[i], 20, css(NAVY)), h('span', { class: 'm3-llabel' }, names[i]));
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
    edit.addEventListener('input', () => { e.text = edit.value; this._inlineDirty = true; });
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
    if (edit.style.left !== left + 'px') edit.style.left = left + 'px';
    if (edit.style.top !== top + 'px') edit.style.top = top + 'px';
    if (edit.style.width !== width + 'px') { edit.style.width = width + 'px'; changed = true; }
    if (changed || this._inlineDirty) { this._inlineDirty = false; edit.style.height = 'auto'; edit.style.height = edit.scrollHeight + 2 + 'px'; }
    const height = edit.offsetHeight;
    this.placeHandle(this.inlineMove, left - 8, top - 34);
    this.placeHandle(this.inlineDelete, left + width - 22, top - 34);
    this.placeHandle(this.inlineResize, left + width - 12, top + Math.max(18, height) - 10);
  },
  placeHandle(handle, left, top) {
    if (!handle) return;
    if (handle.style.left !== left + 'px') handle.style.left = left + 'px';
    if (handle.style.top !== top + 'px') handle.style.top = top + 'px';
  },
  applyInlineStyle() {
    const edit = this.inlineEdit, e = this.inlineElement; if (!edit || !e) return;
    const tf = AnnotationPainter.typeface(e.font, e.bold, e.italic);
    edit.style.fontFamily = tf.family; edit.style.fontWeight = tf.getStyle() & 1 ? '700' : '400'; edit.style.fontStyle = tf.getStyle() & 2 ? 'italic' : 'normal';
    edit.style.color = css(e.color | 0xFF000000);
    if (this.inlineSize) this.inlineSize.textContent = this.pointsOf(e) + 'pt';
    this._inlineDirty = true; this.positionInlineText();
  },
  changeInlineSize(delta) {
    if (!this.inlineElement) return;
    const points = Math.max(8, Math.min(72, this.pointsOf(this.inlineElement) + delta));
    this.inlineElement.textSize = points / TEXT_PAGE_POINTS; this.applyInlineStyle();
  },
  /** Compact three-row style card (font / bold-italic-size-actions / colors) that floats at the bottom while typing. */
  buildInlineBar(e) {
    const card = h('div', { class: 'm3-inline-bar', dataset: { tag: 'inline_style_bar' } });
    const faces = this.segmented(FONT_NAMES, () => Math.max(0, FONT_IDS.indexOf(e.font)), i => { e.font = FONT_IDS[i]; this.applyInlineStyle(); });
    faces.dataset.tag = 'text_fonts'; faces.style.padding = '2px 0'; faces.style.height = '40px'; card.append(faces);
    const row = h('div', { class: 'm3-inline-row' });
    const bold = [!!e.bold], italic = [!!e.italic];
    const boldChip = this.toggleChip('B', 1, bold, () => { e.bold = bold[0]; this.applyInlineStyle(); }); boldChip.dataset.tag = 'text_bold';
    const italicChip = this.toggleChip('I', 2, italic, () => { e.italic = italic[0]; this.applyInlineStyle(); }); italicChip.dataset.tag = 'text_italic';
    Object.assign(boldChip.style, { width: '34px', height: '32px', margin: '0 2px' });
    Object.assign(italicChip.style, { width: '34px', height: '32px', margin: '0 8px 0 2px' });
    row.append(boldChip, italicChip);
    const minus = this.stepButton('−', '글자 작게'); minus.style.cssText += 'width:30px;height:32px;'; minus.addEventListener('click', () => this.changeInlineSize(-1));
    this.inlineSize = h('div', { class: 'm3-inline-size', dataset: { tag: 'text_size' } });
    const plus = this.stepButton('＋', '글자 크게'); plus.style.cssText += 'width:30px;height:32px;'; plus.addEventListener('click', () => this.changeInlineSize(1));
    row.append(minus, this.inlineSize, plus, h('div', { style: { flex: '1' } }));
    row.append(iconButton('ic_delete', '글상자 삭제', DANGER, () => this.deleteInlineText(), 36, 36, 7));
    const done = iconButton('ic_check', '입력 완료', 0xFFFFFFFF | 0, () => this.commitInlineText(), 36, 36, 7);
    done.dataset.tag = 'text_done'; done.style.background = css(ACCENT); done.style.borderRadius = '18px'; done.style.marginLeft = '4px';
    row.append(done);
    card.append(row);
    const palette = this.swatches(TEXT_COLORS, () => e.color | 0xFF000000, c => { e.color = c | 0xFF000000; this.applyInlineStyle(); }, 26);
    palette.dataset.tag = 'text_colors'; palette.style.padding = '2px 0'; palette.style.height = '34px'; card.append(palette);
    this.inlineBar = card;
    this.viewportLayer.append(card);
  },
  removeInlineViews() {
    AnnotationPainter.skip = null;
    if (this._inlineRaf) cancelAnimationFrame(this._inlineRaf); this._inlineRaf = 0;
    for (const v of [this.inlineEdit, this.inlineMove, this.inlineResize, this.inlineDelete, this.inlineBar]) if (v) v.remove();
    if (this.inlineEdit && document.activeElement === this.inlineEdit) this.inlineEdit.blur();
    this.inlineEdit = null; this.inlineMove = this.inlineResize = this.inlineDelete = null; this.inlineBar = null; this.inlineSize = null;
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
      e.text = text; this.fitTextElement(e);
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
      row.append(iconButton('ic_delete', '녹음 삭제', DANGER, ev => { ev.stopPropagation(); this.deleteRecording(clip); }, 44, 44, 10));
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
  showHelp() {
    new AlertDialog.Builder().setTitle('PDF Note 사용법 · v' + this.appVersion()).setMessage(HELP_TEXT).setPositiveButton('확인').show();
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

const HELP_TEXT = '• 읽기: 본문을 빠르게 스와이프해 페이지 넘기기, 확대 상태에서는 드래그로 이동\n• 텍스트 선택: 단어를 길게 누른 뒤 드래그, 또는 필기·삽입의 텍스트 선택 모드\n• 선택 팝업: 하이라이트·복사·번역·읽어주기·단어장 찾기·개요 추가·메모\n• 단어장 연결: ‘단어장 찾기’ 후 사전앱의 ‘PDF로 돌아가기’ 버튼\n• 포스트잇: 메모와 번역을 펼치기·최소화·숨기기로 관리, 메모는 글자 크기·색상·크기 조절 가능\n• 문서 추가: 상단 폴더 또는 탭의 + 버튼\n• HWP·HWPX·DOC·DOCX·PPT·PPTX·XLS·XLSX: PDF로 변환해 문서함에 가져와 엽니다(변환 임시 파일은 따로 남기지 않습니다). 서식은 변환 엔진과 글꼴에 따라 달라질 수 있습니다\n• HWP·DOC 본문 미리보기는 글자만 표시합니다\n• 문서 전환·닫기: 상단 문서 탭과 × 버튼\n• 앱 재실행: 열었던 탭과 마지막 페이지 자동 복원\n• 첨부·링크: 삽입 메뉴에서 사진·스티커·동영상을 넣고 모서리를 끌어 크기를 조절합니다. 글자를 선택해 ‘링크’를 누르면 웹 주소나 페이지로 연결됩니다\n• 전체 화면: 아래에서 위로 쓸어올리면 도구 모음이 나타납니다\n• 읽기·필기 모드: 아래 막대의 펜 아이콘으로 필기 모드, 책 아이콘으로 읽기 모드. 펜·형광펜을 다시 누르면 굵기·색상 카드가 열립니다\n• 페이지 패널: 상단 페이지 목록 아이콘 또는 돋보기. 검색·미리보기·개요·음성 녹음 탭으로 구성됩니다. 미리보기의 ⋮ 메뉴에서 ★즐겨찾기만 / 전체 보기, 페이지 추가·삭제\n• 개요 저장: 선택 팝업 또는 패널 개요 탭의 ‘개요 추가’\n• 페이지 넘김: 본문 양옆의 반투명 화살표\n• 스와이프 넘김: 읽기 모드에서 본문을 빠르게 좌우로 밀기. 확대 시 가장자리에서 넘기기, 보기·이동에서 방향 변경\n• 두 쪽 보기: 도구에서 전환, 각 페이지 터치 후 필기\n• 문서함: 정렬·표지/목록 보기·이름 검색, 폴더의 ⋮에서 색상 변경\n• 문서 선택: 여러 문서 복사·이동·삭제, 휴지통에서 복원\n• 메뉴: 문서 / 보기·이동 / 필기·삽입 / 학습·주석 / 내보내기·백업\n• PDF 가져오기: 선택한 폴더에 자동 저장, 탭 이름을 길게 눌러 이름 변경\n• 새 노트: 백지·줄노트·모눈종이와 배경색 선택, 마지막 장에서 넘기면 자동 추가\n• 페이지 미리보기: ＋ 페이지로 새 장 추가\n• 타이핑: 하단 ‘텍스트’ 버튼 → 페이지의 원하는 곳을 탭하면 그 자리에서 바로 입력합니다(별도 입력창 없음). 아래 서식 막대에서 글꼴·굵게·기울임·크기·색상을 바꾸고 ✥로 이동, ↔로 폭 조절. 쓴 글은 탭해서 수정·삭제\n• 문서명 변경: 맨 위 문서명을 눌러 바로 변경\n• 글상자 삭제: 입력 중인 글상자 오른쪽 위의 빨간 ✕ 버튼\n• 음성 녹음: 메뉴의 필기·삽입 ‘음성 녹음’ 또는 패널의 녹음 탭 → 정지하면 현재 페이지에 ▶ 표시로 첨부, 탭하면 재생·삭제\n• 문서 공유: 문서함에서 문서를 길게 눌러 선택 → 공유\n• 문서 즐겨찾기: 문서를 길게 눌러 선택 → 즐겨찾기, 왼쪽 메뉴의 ‘즐겨찾기’에서 모아보기\n• 문서함: 왼쪽 아이콘/메뉴에서 전체 문서·즐겨찾기·최근·휴지통·폴더 이동, 오른쪽 아래 버튼으로 새 노트·폴더·파일 가져오기\n• 페이지 추가·삭제: 메뉴의 보기·이동 또는 페이지 미리보기의 ⋮ 버튼\n• 이미지 붙여넣기·웹/YouTube 링크: 메뉴의 필기·삽입에서 선택 후 페이지에 배치\n• PDF 내보내기: 필기·타이핑·이미지를 포함해 저장\n• 검색: 상단 돋보기 → 검색어 입력 후 Enter. 현재 페이지부터 찾아 결과가 바로 쌓이고, 결과를 눌러도 목록이 유지됩니다(▲▼로 이전·다음 이동). 스캔·손글씨는 ‘정밀(OCR)’을 켜세요\n• 올가미: 하단 도구막대의 올가미 버튼 → 위쪽 막대에서 자유·네모·원 선택\n• 확대: 두 손가락으로 핀치\n• 확대 화면 이동: 한 손가락으로 상하좌우 드래그\n• 전체 화면: 위쪽 확장 아이콘, 하단 작은 도구막대로 개요·필기·메모 사용\n• 즐겨찾기: 별 아이콘\n\n필기·번역·개요·하이라이트·메모·즐겨찾기는 문서별로 저장되며 원본 PDF는 변경하지 않습니다. 번역은 번역 창에서 Google 번역으로 열거나 직접 붙여넣어 사용합니다(기기 내 번역은 지원하지 않습니다).';
