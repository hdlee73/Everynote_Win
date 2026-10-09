// Playwright harness for app-main2.js.  usage: node dev/main2-test.mjs  (screenshots in dev/out/main2-*.png)
import { chromium } from '/tmp/npmtest/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { execSync } from 'node:child_process';
const here = path.dirname(fileURLToPath(import.meta.url)), web = path.resolve(here, '../web'), out = path.join(here, 'out');
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.pdf': 'application/pdf', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };
const server = http.createServer((req, rsp) => {
  const p = decodeURIComponent(req.url.split('?')[0]); const f = p.startsWith('/dev/') ? path.join(here, p.slice(5)) : path.join(web, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); rsp.end('nf'); return; }
  rsp.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(rsp);
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const W = +process.env.W || 900, Hh = +process.env.H || 700;
const ctx = await browser.newContext({ viewport: { width: W, height: Hh }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
let errors = 0;
page.on('response', r => { if (r.status() === 404) console.log('[404]', r.url()); });
page.on('console', m => { if (m.type() === 'error') { console.log('[console.error]', m.text()); errors++; } });
page.on('pageerror', e => { console.log('[pageerror]', e.message); errors++; });
await page.addInitScript(() => { for (const C of [Map, WeakMap]) { if (!C.prototype.getOrInsertComputed) C.prototype.getOrInsertComputed = function (k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); }; if (!C.prototype.getOrInsert) C.prototype.getOrInsert = function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); }; } });
await page.goto(`http://localhost:${port}/dev/main2-test.html`);
await page.waitForFunction(() => window.READY && window.T.PageElement, null, { timeout: 30000 });
let fails = 0;
const ev = (fn, a) => page.evaluate(fn, a);
const check = (n, ok, x = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!ok) fails++; };
const shot = async n => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(out, 'main2-' + n + '.png') }); };
const textOf = sel => page.locator(sel).first().innerText();

await ev(async () => { await T.app.open(T.path); });
await shot('00-open');

// ---------------------------------------------------------------- study panel
await ev(() => { const s = T.app.store; const e = new T.StudyEntry(); e.page = 0; e.x = .3; e.y = .4; e.text = '첫 번째 노트\n두 줄'; e.comment = '설명 문장'; s.studyEntries.push(e);
  const f = new T.StudyEntry(); f.page = 2; f.text = 'fox 발췌 원문'; f.excerpt = true; s.studyEntries.push(f); T.app.showStudy(false); });
await shot('01-study');
check('study heading', (await textOf('.m2-study-h')) === '노트 · p.1');
check('study cards', (await page.locator('.m2-study-card').count()) === 2);
const bg = await ev(() => [...document.querySelectorAll('.m2-study-card')].map(c => getComputedStyle(c).backgroundColor));
check('current page card highlighted', bg[0] === 'rgb(255, 237, 182)' && bg[1] === 'rgb(255, 255, 255)', bg.join('|'));
await ev(() => { T.app.basketOnly = true; T.app.refreshStudyPanel(); });
check('basket filter', (await page.locator('.m2-study-card').count()) === 1 && (await textOf('.m2-study-h')) === '발췌 바구니 · p.1');
await ev(() => { T.app.basketOnly = false; T.app.refreshStudyPanel(); });
await page.click('[aria-label="현재 페이지에 노트 추가"]'); await shot('02-study-edit');
await page.click('.ad-btn >> text=저장'); await page.waitForTimeout(200);
check('empty note keeps dialog + toast', (await page.locator('.ad-root').count()) === 1 && (await textOf('.toast')).includes('노트 내용을 입력하세요'));
await page.fill('.ad-root textarea >> nth=0', 'new note'); await page.fill('.ad-root textarea >> nth=1', 'comment');
await page.click('.ad-btn >> text=저장'); await page.waitForTimeout(300);
check('note saved', (await ev(() => T.app.store.studyEntries.length)) === 3 && (await ev(() => T.app.studyVisible)));
await ev(() => T.app.addStudyEntry('발췌 텍스트', .2, .3, true)); await page.waitForTimeout(200);
check('excerpt -> basket', (await ev(() => T.app.basketOnly)) && (await ev(() => T.app.store.studyEntries.length)) === 4);
// split layout: wide -> row, narrow -> column
check('wide split row', (await ev(() => getComputedStyle(T.app.studySplit).flexDirection)) === 'row');
await page.setViewportSize({ width: 500, height: 700 }); await page.waitForTimeout(300);
check('narrow split column', (await ev(() => getComputedStyle(T.app.studySplit).flexDirection)) === 'column'); await shot('03-study-narrow');
await page.setViewportSize({ width: W, height: Hh });
// exporters
const ex = await ev(() => { const es = T.app.store.studyEntries; const d = new TextDecoder(); return { md: d.decode(T.exportStudyBytes(es, 'a.pdf', 0)), csv: d.decode(T.exportStudyBytes([{ page: 0, text: '=1+1\n"q"', comment: '' }], 'a.pdf', 1)), docx: Array.from(T.exportStudyBytes(es, 'a.pdf', 4)), x: Array.from(T.exportStudyBytes(es, 'a.pdf', 2)) }; });
const pdfOut = await ev(async () => Array.from(await T.exportStudyBytes(T.app.store.studyEntries, '한글 노트.pdf', 3)));
check('md', ex.md.startsWith('# a.pdf\n\n## [p.1]\n\n첫 번째 노트\n두 줄\n\n설명 문장\n\n'));
check('csv', ex.csv.endsWith('"a.pdf",1,"\'=1+1\n""q""",""\r\n'), JSON.stringify(ex.csv));
fs.writeFileSync('/tmp/m2-test.docx', Buffer.from(ex.docx)); fs.writeFileSync('/tmp/m2-test.pdf', Buffer.from(pdfOut));
{ const l = execSync('python3 -c "import zipfile;z=zipfile.ZipFile(\'/tmp/m2-test.docx\');print(z.testzip());d=z.read(\'word/document.xml\').decode();print(\'[p.1]\' in d and \'첫 번째 노트\' in d)" 2>&1 || true').toString(); check('docx export valid (Android v1.32.0)', l.startsWith('None') && l.includes('True'), l); }
check('pdf export valid', Buffer.from(pdfOut).subarray(0, 5).toString() === '%PDF-' && pdfOut.length > 2000, String(pdfOut.length));
fs.writeFileSync('/tmp/m2-test.xlsx', Buffer.from(ex.x));
try { const l = execSync('python3 -c "import zipfile;z=zipfile.ZipFile(\'/tmp/m2-test.xlsx\');print(z.testzip());print(z.namelist());import openpyxl" 2>&1 || true').toString(); console.log(l.trim()); check('xlsx zip valid', l.startsWith('None')); } catch (e) { check('xlsx zip', false, String(e)); }

// ---------------------------------------------------------------- lists & dialogs
await ev(() => { const s = T.app.store; const m = new T.Mark(); m.page = 1; m.left = .1; m.top = .2; m.right = .4; m.bottom = .26; m.color = 0x66FFDE59; m.note = '하이라이트 메모'; s.marks.push(m);
  const n = new T.Mark(); n.page = 3; n.left = .5; n.top = .5; n.right = .55; n.bottom = .55; n.noteOnly = true; n.note = '포스트잇 메모'; n.minimized = true; s.marks.push(n);
  const t = new T.TranslationNote(); t.page = 2; t.left = .1; t.top = .1; t.right = .3; t.bottom = .2; t.source = 'hello'; t.translated = '안녕하세요 이것은 번역된 텍스트이며 서른다섯 글자를 훌쩍 넘기는 아주 긴 문장입니다'; s.translations.push(t);
  const o = new T.OutlineItem(); o.page = 4; o.x = .3; o.y = .3; o.title = '2. 세부 검토사항'; s.outlines.push(o); const o2 = new T.OutlineItem(); o2.page = 1; o2.x = .5; o2.y = .1; o2.title = '서론'; s.outlines.push(o2);
  s.bookmarks.add(0); s.bookmarks.add(3); s.bookmarks.add(5); });
await ev(() => T.app.showMarkList()); await shot('04-marklist');
const items = await page.locator('.ad-cell').allInnerTexts();
check('mark list labels', items.map(x => x.replace(/\s+/g, ' ')).join('|') === 'p.2 [펼침] 하이라이트 메모|p.4 [최소화] 포스트잇 메모', JSON.stringify(items));
await page.click('.ad-cell >> nth=0'); await page.waitForTimeout(500); await shot('05-memo-editor');
check('memo editor open', (await page.locator('.m2-memo').count()) === 1 && (await textOf('.m2-memo-h')) === '페이지 2 하이라이트');
await page.click('.m2-dot >> nth=2'); await page.click('.m2-seg-chip >> nth=2'); await page.click('[aria-label="글자 크게"]'); await shot('06-memo-editor2');
await page.fill('.m2-memo-in', '수정된 메모'); await page.click('.m2-dbtn >> text=저장'); await page.waitForTimeout(250);
const mk = await ev(() => { const m = T.app.store.marks[0]; return [m.note, m.paper, m.fontSp, m.boxSize]; });
check('memo saved', mk[0] === '수정된 메모' && mk[2] === 14 && mk[3] === 2 && (mk[1] >>> 0) === 0xFFCFE8FF, JSON.stringify(mk));
await ev(() => T.app.showTranslations()); await shot('07-translations');
check('translation label', (await page.locator('.ad-cell >> nth=0').innerText()).replace(/\s+/g, ' ').startsWith('p.3 [펼침] 안녕하세요') && (await page.locator('.ad-cell >> nth=0').innerText()).endsWith('…'));
await page.click('.ad-cell >> nth=0'); await page.waitForTimeout(300);
check('editTranslation called', await ev(() => T.calls.some(c => c[0] === 'editTranslation')));
await ev(() => T.app.showTranslationDisplayOptions(T.app.store.translations[0])); await shot('08-display-options');
await page.click('.ad-cell >> text=최소화'); await page.waitForTimeout(250);
check('translation minimized', await ev(() => T.app.store.translations[0].minimized && T.app.store.translations[0].visible));
await ev(() => T.app.showBookmarks()); check('bookmarks', (await page.locator('.ad-cell').allInnerTexts()).join() === '페이지 1,페이지 4,페이지 6'); await page.click('.ad-cell >> nth=1'); await page.waitForTimeout(500);
check('bookmark goes to page', (await ev(() => T.app.currentPage)) === 3);
await ev(() => T.app.goToPage()); await shot('09-gotopage'); await page.fill('.ad-root input', '7'); await page.click('.ad-btn >> text=이동'); await page.waitForTimeout(500);
check('go to page 7', (await ev(() => T.app.currentPage)) === 6);
await ev(() => T.app.goToPage()); await page.fill('.ad-root input', 'x'); await page.click('.ad-btn >> text=이동'); await page.waitForTimeout(200); check('go to page invalid toast', (await textOf('.toast')) === '올바른 페이지를 입력하세요');
await ev(() => T.app.choosePageSwipeDirection()); await shot('10-swipe-dir'); await page.click('.ad-cell >> nth=2'); await page.waitForTimeout(250);
check('swipe pref', (await ev(() => [T.app.swipeEnabled, T.app.verticalPageSwipe, T.prefs.getBoolean('vertical_page_swipe', false)])).join() === 'true,true,true');
await ev(() => T.app.showAddDocumentMenu()); await shot('11-add-doc'); await page.keyboard.press('Escape'); await page.waitForTimeout(250);
await ev(() => T.app.showOutlineItem(T.app.store.outlines[0])); await shot('12-outline-item'); check('outline item menu: 이동 / 삭제 rows in a menu card', (await page.locator('.amenu .amenu-row').count()) === 2); await page.keyboard.press('Escape'); await page.waitForTimeout(250);

// ---------------------------------------------------------------- sheets
await ev(() => T.app.showPageMenu(2)); await shot('13-page-menu');
check('page menu rows (anchored menu card, Android v1.32.0)', (await page.locator('.amenu .amenu-row').count()) === 5);
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
check('sheet closed', (await page.locator('.amenu').count()) === 0);

// ---------------------------------------------------------------- side panel + search
await ev(() => { T.app.showAllThumbnails = false; T.app.selectPanelTab(1); }); await shot('14-thumbs'); await page.waitForTimeout(1200); await shot('14b-thumbs');
check('3 thumbnails', (await page.locator('.m2-thumb').count()) === 3 && (await page.locator('.m2-thumb-canvas').count()) === 3);
check('title is the menu icon + 미리보기 (Android v1.34.0)', (await textOf('.m2-side-title')) === '미리보기' && (await page.locator('.m2-side-title svg').count()) === 1);
await ev(() => { T.app.showAllThumbnails = true; T.app.selectPanelTab(1); }); await page.waitForTimeout(2500); await shot('15-thumbs-all');
check('all thumbnails', (await page.locator('.m2-thumb').count()) === 12);
await ev(() => { T.app.showAllThumbnails = false; T.app.selectPanelTab(2); }); await shot('16-outline');
check('outline rows (outline tab lists outlines only)', (await page.locator('.m2-outline').count()) === 2 && (await page.locator('.m2-mark').count()) === 0);
await ev(() => { T.app.selectPanelTab(4); });
check('memo rows are listed in the 삽입 목록 tab', (await page.locator('.m2-mark').count()) === 2);
await ev(() => { T.app.selectPanelTab(2); });
await ev(() => T.app.selectPanelTab(0)); await page.fill('.m2-search-in', 'fox'); await page.press('.m2-search-in', 'Enter'); await page.waitForTimeout(2500); await shot('17-search');
check('search hits', (await ev(() => T.app.searchHits.length)) > 0, String(await ev(() => T.app.searchHits.length)));
check('search status', (await textOf('.m2-search-status')).startsWith('결과 '), await textOf('.m2-search-status'));
await page.click('[aria-label="다음 결과"]'); await page.waitForTimeout(600); await shot('18-search-next');
await ev(() => T.app.closeSidePanel());
check('panel closed', (await ev(() => T.app.sidebarVisible)) === false && (await ev(() => T.app.searchHits.length)) === 0);

// ---------------------------------------------------------------- elements
await ev(() => { T.app.dropTarget = null; });
await ev(() => T.app.showStickerPicker()); await shot('19-stickers'); await page.click('.m2-st-cell >> nth=3'); await page.waitForTimeout(300);
check('sticker armed', await ev(() => T.app.placementKind === 'sticker' && T.app.memoMode && T.app.placementText === '❤️'));
await ev(() => T.app.onMemoPointRequested ? 0 : 0); await ev(() => T.app.createPlacedElement(T.app.currentPage, .5, .5)); await page.waitForTimeout(300);
let el = await ev(() => { const e = T.app.store.elements.at(-1); return e && { kind: e.kind, t: e.text, l: e.left, r: e.right, b: e.bottom, top: e.top }; });
check('sticker placed', el && el.kind === 'sticker' && Math.abs((el.r - el.l) - .16) < 1e-6, JSON.stringify(el));
await ev(() => T.app.showShapeDialog(null)); await shot('20-shape'); await page.click('.m2-shape-btn >> text=별'); await page.click('.m2-cdot >> nth=2'); await page.click('.ad-btn >> text=넣기'); await page.waitForTimeout(250);
check('shape armed', await ev(() => T.app.placementKind === 'shape' && /^star\|FFFF9500\|00000000\|3$/.test(T.app.placementText)), await ev(() => T.app.placementText));
await ev(() => T.app.createPlacedElement(T.app.currentPage, .3, .3)); await page.waitForTimeout(200);
await ev(() => T.app.showTableDialog(null)); await shot('21-table'); await page.fill('.ad-root input >> nth=0', '4'); await page.click('.ad-btn >> text=넣기'); await page.waitForTimeout(250);
check('table armed', await ev(() => T.app.placementKind === 'table' && T.app.placementText.split('\n').length === 1 + 4 * 3 && T.app.placementText.startsWith('4,3,')), await ev(() => T.app.placementText.slice(0, 30)));
await ev(() => T.app.createPlacedElement(T.app.currentPage, .5, .7)); await page.waitForTimeout(400); await shot('22-placed');
check('elements', (await ev(() => T.app.store.elements.map(e => e.kind).join())) === 'sticker,shape,table');
await ev(() => T.app.onElementTapped(T.app.store.elements[2])); await shot('23-element-menu'); await page.click('.amenu-row >> text=셀 내용 편집'); await page.waitForTimeout(250); await shot('24-table-cells');
await page.fill('.ad-root input >> nth=0', '제목1'); await page.click('.ad-btn >> text=저장'); await page.waitForTimeout(200);
check('table cell saved', await ev(() => T.app.store.elements[2].text.split('\n')[1] === '제목1'));
await ev(() => T.app.editElementGeometry(T.app.store.elements[0])); await shot('25-geometry'); await page.fill('.ad-root input >> nth=2', '30'); await page.click('.ad-btn >> text=적용'); await page.waitForTimeout(200);
check('geometry', await ev(() => Math.abs(T.app.store.elements[0].right - T.app.store.elements[0].left - .3) < 1e-6));
await ev(() => T.app.deleteElement(T.app.store.elements[0])); check('delete element', (await ev(() => T.app.store.elements.length)) === 2);
// insert menu
await ev(() => T.app.showInsertMenu(document.getElementById('hdr'))); await shot('26-insert-menu'); await page.mouse.click(5, 650); await page.waitForTimeout(200);
// image import (png from canvas)
const imgOk = await ev(async () => { const c = document.createElement('canvas'); c.width = 3200; c.height = 1800; const x = c.getContext('2d'); x.fillStyle = '#c33'; x.fillRect(0, 0, 3200, 1800); x.fillStyle = '#fff'; x.font = '300px sans-serif'; x.fillText('IMG', 600, 1000);
  const blob = await new Promise(r => c.toBlob(r, 'image/png')); await T.app.importImage(blob); await new Promise(r => setTimeout(r, 300)); T.app.createPlacedElement(T.app.currentPage, .5, .3); await new Promise(r => setTimeout(r, 400));
  const e = T.app.store.elements.at(-1); const bmp = await (await import('/js/painter.js')).AnnotationPainter.loadImage(e.asset); return { kind: e.kind, w: bmp.width, h: bmp.height, ratio: (e.right - e.left) }; });
check('image imported (<=1600) + placed', imgOk.kind === 'image' && Math.max(imgOk.w, imgOk.h) === 1600 && imgOk.ratio === .5, JSON.stringify(imgOk));
await shot('27-image');
// hyperlinks
await ev(() => { T.app.startHyperlink(); T.app.createHyperlink({ bounds: [{ left: .1, top: .1, right: .3, bottom: .12 }, { left: .1, top: .12, right: .2, bottom: .14 }], unionBounds: { left: .1, top: .1, right: .3, bottom: .14 } }); });
await shot('28-link-target'); await page.click('.ad-cell >> text=이 문서의 페이지'); await page.fill('.ad-root input', '3'); await page.click('.ad-btn >> text=확인'); await page.waitForTimeout(250);
check('hyperlink group', await ev(() => { const h = T.app.store.elements.filter(e => e.kind === 'hyperlink'); return h.length === 2 && h[0].text === 'page:2' && h[0].color === h[1].color; }));
const linkPt = await ev(() => { const v = T.app.pageView, r = v.el.getBoundingClientRect(), d = v.contentRect(), e = T.app.store.elements.find(x => x.kind === 'hyperlink'); return [r.left + d.left + (e.left + e.right) / 2 * d.width(), r.top + d.top + (e.top + e.bottom) / 2 * d.height()]; });
await page.mouse.click(linkPt[0], linkPt[1]); await page.waitForTimeout(600);
check('mouse click follows the hyperlink at once', await ev(() => T.app.currentPage === 2));
await ev(() => T.app.showPage(0)); await page.waitForTimeout(500);
await ev(() => T.app.selectPanelTab(4)); await page.waitForTimeout(200);
check('insert list shows the link once', await ev(() => [...document.querySelectorAll('[data-tag=insert_item]')].filter(r => r.textContent.startsWith('링크')).length === 1));
await ev(() => T.app.selectPanelTab(1)); await ev(() => T.app.closeSidePanel && T.app.closeSidePanel());
await ev(() => T.app.showHyperlinkMenu(T.app.store.elements.find(e => e.kind === 'hyperlink'))); await shot('29-link-menu'); check('link title', (await textOf('.ad-sheet-title')) === '이 문서 3쪽'); await page.click('.ad-cell >> text=링크 삭제'); await page.waitForTimeout(200);
check('hyperlink deleted as group', await ev(() => T.app.store.elements.filter(e => e.kind === 'hyperlink').length === 0));
check('linkTarget', await ev(() => [T.app.linkTarget('5'), T.app.linkTarget('13'), T.app.linkTarget('example.com/a'), T.app.linkTarget('a b'), T.app.linkTarget('http://x.y')].map(String).join('|')) === 'page:4|null|https://example.com/a|null|http://x.y');
check('youtubeId', await ev(() => [T.app.youtubeId('https://youtu.be/dQw4w9WgXcQ?t=1'), T.app.youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&x=1'), T.app.youtubeId('https://youtube.com/shorts/abcdefghijk'), T.app.youtubeId('nope')].map(String).join('|')) === 'dQw4w9WgXcQ|dQw4w9WgXcQ|abcdefghijk|null');

// ---------------------------------------------------------------- lasso dialog
await ev(() => { const c = document.createElement('canvas'); c.width = 500; c.height = 300; const x = c.getContext('2d'); x.fillStyle = '#9cf'; x.fillRect(0, 0, 500, 300); x.fillStyle = '#000'; x.font = '60px sans-serif'; x.fillText('Lasso', 40, 150);
  T.app.pageView.captureLasso = () => c; T.app.pageView.lassoText = () => 'selected words'; T.app.onLassoSelectionFinished(); });
await shot('30-lasso'); await page.click('[aria-label="글자 복사"]'); await page.waitForTimeout(300);
check('copySelectedText', await ev(() => T.calls.some(c => c[0] === 'copySelectedText' && c[1] === 'selected words')));
await ev(() => T.app.onLassoSelectionFinished()); await page.click('[aria-label="이미지 복사"]'); await page.waitForTimeout(700); console.log('toast:', await textOf('.toast'));

// ---------------------------------------------------------------- notebooks / page edit
await ev(() => { T.app.libraryFolder = T.app.library.root; T.app.newNotebook(); }); await shot('31-new-notebook');
await page.fill('.lib-notename input', '테스트 노트'); await page.click('.ad-btn >> text=만들기'); await page.waitForTimeout(2500);
check('notebook opened', await ev(() => T.calls.some(c => c[0] === 'openPdf' && String(c[1]).endsWith('테스트 노트.pdf'))));
await ev(() => { window.nb = T.app.activeSession; }); await shot('32-notebook');
check('isNotebook', await ev(() => T.app.isNotebook(T.app.activeSession)));
const before = await ev(() => T.app.renderer.pageCount);
await ev(async () => { await T.app.insertPage(T.app.activeSession, T.app.library.paper(T.app.activeSession.uri), 0); }); await page.waitForTimeout(500);
check('page inserted', (await ev(() => T.app.renderer.pageCount)) === before + 1 && (await ev(() => T.app.currentPage)) === 1, String(await ev(() => T.app.renderer.pageCount)));
await ev(() => T.app.confirmDeletePage(1)); await shot('33-delete-page'); await page.click('.ad-btn >> text=삭제'); await page.waitForTimeout(1500);
check('page deleted', (await ev(() => T.app.renderer.pageCount)) === before);
await ev(() => { window.sess = T.app.sessions[0]; T.app.activeSession = T.app.sessions[0]; });
await ev(async () => { await T.app.switchDocument(T.app.sessions[0]); }); await ev(() => T.app.confirmDeletePage(0)); await page.waitForTimeout(300);
check('not managed -> toast', (await textOf('.toast')).includes('문서함에 저장한 뒤') || (await ev(() => T.app.library.managed(T.app.activeSession.uri))));
await ev(() => T.app.renameDocument(T.app.sessions[1])); await shot('34-rename'); await page.fill('.lib-inwrap input', '이름바꿈'); await page.click('.ad-btn >> text=저장'); await page.waitForTimeout(800);
check('renamed', await ev(() => T.app.sessions[1].title === '이름바꿈.pdf' && T.app.sessions[1].uri.endsWith('이름바꿈.pdf')), await ev(() => T.app.sessions[1].title));

// ---------------------------------------------------------------- v1.27 additions
await ev(async () => { document.querySelectorAll('.ad-root').forEach(r => r.remove()); await T.app.switchDocument(T.app.sessions[0]); });   // drop the delete-page confirm left open above
// memo editor: two size notions, rainbow chip + opacity, box size resets the free size
await ev(() => { const m = T.app.store.marks[1]; m.boxW = 200; m.boxH = 120; window.__m = m; T.app.showMemoEditor('v127', m, '저장', () => {}, null, null, null, null); }); await page.waitForTimeout(300);
const lbl = await ev(() => [...document.querySelectorAll('.m2-memo div')].map(d => d.textContent).filter(t => /크기/.test(t) && t.length < 80));
check('memo editor: 메모 안 글자 크기 / 메모 상자 크기', lbl.some(t => t === '메모 안 글자 크기') && lbl.some(t => t.startsWith('메모 상자 크기')), JSON.stringify(lbl));
check('memo paper colours have a rainbow chip', (await page.locator('[data-tag="memo_paper_colors"] [data-tag="color_more"]').count()) === 1);
await shot('37-memo-editor-v127');
await page.click('[data-tag="memo_paper_colors"] [data-tag="color_more"]'); await page.waitForSelector('[data-tag="color_picker"]'); await shot('38-memo-colorpicker');
check('memo colour picker has opacity row', (await page.locator('.cp-box .cp-row').count()) === 4);
await page.click('.ad-btn >> text=적용'); await page.waitForTimeout(250);
check('memo paper takes picked colour (opaque initial -> same rgb)', await ev(() => (document.querySelector('.m2-memo-pv').style.background || '').length > 0));
await page.click('.m2-seg-chip >> nth=0'); await page.click('.m2-dbtn >> text=저장'); await page.waitForTimeout(250);
check('changing the box size clears the free size', await ev(() => window.__m.boxW === 0 && window.__m.boxH === 0 && window.__m.boxSize === 0));
await ev(() => { const m = T.app.store.marks[1]; m.boxW = 200; m.boxH = 120; T.app.showMemoEditor('v127', m, '저장', () => {}, null, null, null, null); }); await page.waitForTimeout(250);
await page.click('.m2-dbtn >> text=저장'); await page.waitForTimeout(250);
check('keeping the box size keeps the free size', await ev(() => window.__m.boxW === 200 && window.__m.boxH === 120));
// outline panel: 'title (p19)', highlights excluded unless a memo is attached
await ev(() => { const s = T.app.store; const m = new T.Mark(); m.page = 2; m.left = .1; m.top = .1; m.right = .3; m.bottom = .15; m.color = 0x66FFDE59; m.note = ''; s.marks.push(m); window.__plain = m; T.app.selectPanelTab(2); });
await page.waitForTimeout(300);
const ol = await ev(() => { const o = { outline: [...document.querySelectorAll('.m2-outline')].map(e => e.textContent), small: getComputedStyle(document.querySelector('.m2-outline-t')).fontSize, p: getComputedStyle(document.querySelector('.m2-outline-p')).color }; T.app.selectPanelTab(4); o.marks = document.querySelectorAll('.m2-mark').length; o.head = document.querySelector('.m2-marks-h').textContent; o.markText = document.querySelector('.m2-mark-text').textContent; return o; });
check('outline item text is "제목  (pN)" with a small grey page', ol.outline[0].includes('서론') && /서론\s+\(p2\)/.test(ol.outline[0]) && ol.small === '12.5px' && ol.p === 'rgb(142, 142, 147)', JSON.stringify(ol));
check('plain highlight (no memo) is not listed; heading says 메모', ol.marks === 2 && ol.head === '메모 2' && /\(p\d+\)/.test(ol.markText), JSON.stringify(ol));
await shot('39-outline-panel');
await ev(() => { window.__plain.note = '붙은 메모'; T.app.rebuildInsertions(); });
check('highlight with a memo is listed', (await page.locator('.m2-mark').count()) === 3);
await ev(() => { const a = T.app.store.marks, i = a.indexOf(window.__plain); a.splice(i, 1); T.app.closeSidePanel(); });
// colour rows in shape/table dialogs have the rainbow chip; picker result lands in the spec
await ev(() => T.app.showShapeDialog(null)); await page.waitForTimeout(250);
check('shape dialog: chip on stroke + fill rows, rotation bar', (await page.locator('.m2-colorrow [data-tag="color_more"]').count()) === 2 && (await page.locator('[data-tag="shape_rotation"]').count()) === 1);
await page.locator('.m2-colorrow [data-tag="color_more"]').nth(1).click(); await page.waitForSelector('[data-tag="color_picker"]');
await page.click('.ad-btn >> text=적용'); await page.waitForTimeout(250);
await ev(() => { const b = document.querySelector('[data-tag="shape_rotation"]'); b.value = 9; b.dispatchEvent(new Event('input', { bubbles: true })); });
check('rotation label follows the bar (45°)', (await page.locator('.m2-seclabel >> text=회전 45°').count()) === 1);
await shot('40-shape-dialog');
await page.click('.ad-btn >> text=넣기'); await page.waitForTimeout(250);
check('shape placement carries the rotation', await ev(() => T.app.placementRot === 45 && /^rect\|/.test(T.app.placementText)), await ev(() => T.app.placementText));
await ev(() => T.app.createPlacedElement(T.app.currentPage, .5, .5)); await page.waitForTimeout(200);
check('placed element has rot 45; placementRot reset', await ev(() => T.app.store.elements.at(-1).rot === 45 && T.app.placementRot === 0));
await ev(() => T.app.showShapeDialog(T.app.store.elements.at(-1))); await page.waitForTimeout(250);
check('editing a shape shows its angle', (await page.locator('.m2-seclabel >> text=회전 45°').count()) === 1);
await ev(() => { const b = document.querySelector('[data-tag="shape_rotation"]'); b.value = 18; b.dispatchEvent(new Event('input', { bubbles: true })); });
await page.click('.ad-btn >> text=적용'); await page.waitForTimeout(200);
check('edit applies the new angle (90°)', await ev(() => T.app.store.elements.at(-1).rot === 90));
await ev(() => T.app.showTableDialog(null)); await page.waitForTimeout(200);
check('table dialog: chip on 3 colour rows', (await page.locator('.m2-colorrow [data-tag="color_more"]').count()) === 3); await page.click('.ad-btn >> text=취소'); await page.waitForTimeout(200);
// export original (copy of the untouched file through host.saveDialog + host.copy)
await ev(() => { window.__calls = []; const h0 = T.host; window.__save = h0.saveDialog; h0.saveDialog = async (t, n) => { window.__calls.push(['save', t, n]); return 'C:\\Out\\' + n; }; });
await ev(async () => { await T.app.exportOriginal(); }); await page.waitForTimeout(300);
const orig = await ev(async () => { const b = await T.host.readBytes('C:\\Out\\sample-ko.pdf'); return { len: b.length, same: b.length === T.bytes.length, head: String.fromCharCode(...b.slice(0, 5)), calls: window.__calls }; });
check('원본 파일 내보내기 copies the original bytes', orig.same && orig.head === '%PDF-' && orig.calls[0][2] === 'sample-ko.pdf', JSON.stringify(orig));
check('toast 원본 파일을 내보냈습니다', (await textOf('.toast')) === '원본 파일을 내보냈습니다');
// own PDF / image as template: new-note dialog -> host.openDialog -> NotebookFiles.importTemplate -> paper.setTemplate
await ev(() => { T.host.openDialog = async () => { T.host._fake.put('C:\\Users\\dev\\Downloads\\my-form.pdf', T.bytes); return ['C:\\Users\\dev\\Downloads\\my-form.pdf']; }; T.app.libraryFolder = T.app.library.root; T.app.newNotebook(); }); await page.waitForTimeout(300);
await page.click('[data-tag="paper_tile:9"]'); await page.waitForTimeout(200);
await shot('41-new-note-template');
check('template button appears for 내 PDF·이미지 서식', await page.locator('.lib-paper >> text=PDF·이미지 서식 고르기').isVisible());
await page.click('.lib-paper >> text=PDF·이미지 서식 고르기'); await page.waitForTimeout(500);
const tpl = await ev(() => { const b = [...document.querySelectorAll('.lib-paper *')].map(x => x.textContent).find(t => /^서식: /.test(t)); return { label: b, target: !!T.app.templateTarget, path: T.app.templateTarget && T.app.templateTarget.template }; });
check('picked template is copied (private copy) and shown', /^서식: .+다시 고르기/.test(tpl.label || '') && /templates\\/.test(tpl.path || ''), JSON.stringify(tpl));
await page.fill('.lib-notename input', 'V127 서식 노트'); await page.click('.ad-btn >> text=만들기'); await page.waitForTimeout(2500);
check('note created from own template', await ev(() => T.calls.some(c => c[0] === 'openPdf' && String(c[1]).endsWith('V127 서식 노트.pdf'))));
await shot('42-template-note');
await ev(() => T.app.newNotebook()); await page.waitForTimeout(300); await page.click('[data-tag="paper_tile:9"]'); await page.click('.ad-btn >> text=만들기'); await page.waitForTimeout(400);
check('custom paper without a template stays open with an error', (await page.locator('.ad-root').count()) >= 1);
await page.click('.ad-btn >> text=취소'); await page.waitForTimeout(200);

// ---------------------------------------------------------------- PDF export (annotations flattened)
const exp = await ev(async () => {
  await T.app.switchDocument(T.app.sessions[0]);
  const s = T.app.store; const st = new T.AnnotationStore(); st.importJson(s.exportJson(T.app.documentUri, 't'), T.app.renderer.pageCount);
  const out = await T.exportAnnotatedPdf(T.path, st, T.app.renderer.pageCount);
  const doc = await T.PdfDoc.open(out.slice()); const c = await doc.renderPage(1, 1.2); document.body.dataset.exp = c.toDataURL('image/png');
  const t0 = await doc.pageText(0); return { len: out.length, pages: doc.pageCount, text: t0.slice(0, 30) };
});
check('exported pdf', exp.pages === 12 && exp.text.length > 5, JSON.stringify(exp));
fs.writeFileSync(path.join(out, 'main2-35-export-page2.png'), Buffer.from((await ev(() => document.body.dataset.exp)).split(',')[1], 'base64'));
// rotated page export
const rot = await ev(async () => {
  const lib = await import('/vendor/pdflib/pdf-lib.esm.min.js'); const d = await lib.PDFDocument.load(T.bytes); d.getPage(0).setRotation(lib.degrees(90)); const b = await d.save();
  T.host._fake.put(T.path + '.rot.pdf', b);
  const st = new T.AnnotationStore(); const m = new T.Mark(); m.page = 0; m.left = .05; m.top = .05; m.right = .4; m.bottom = .1; m.color = 0x99FF0000; m.note = 'ROT'; st.marks.push(m);
  const o = await T.exportAnnotatedPdf(T.path + '.rot.pdf', st, 12); const doc = await T.PdfDoc.open(o.slice()); const c = await doc.renderPage(0, 1); return c.toDataURL('image/png');
});
fs.writeFileSync(path.join(out, 'main2-36-export-rot90.png'), Buffer.from(rot.split(',')[1], 'base64'));

console.log(`\n${fails} failed, ${errors} errors`);
await browser.close(); server.close();
process.exit(fails || errors ? 1 : 0);
