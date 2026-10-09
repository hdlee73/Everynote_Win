// v3.22: split chips, ink-only preview filter, clear page/document, highlighter vs 하이라이트, floating strip above the bottom bar, 메모 label, lasso bar + capture. usage: node dev/v322-test.mjs
import { chromium } from '/tmp/npmtest/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), web = path.resolve(here, '../web'), out = path.join(here, 'out');
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.pdf': 'application/pdf', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };
const server = http.createServer((req, rsp) => {
  const p = decodeURIComponent(req.url.split('?')[0]); const f = p.startsWith('/dev/') ? path.join(here, p.slice(5)) : path.join(web, p === '/' ? 'index.html' : p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); rsp.end('nf'); return; }
  rsp.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(rsp);
}).listen(0);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1200, height: 760 } })).newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.addInitScript(() => { for (const C of [Map, WeakMap]) { if (!C.prototype.getOrInsertComputed) C.prototype.getOrInsertComputed = function (k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); }; if (!C.prototype.getOrInsert) C.prototype.getOrInsert = function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); }; } });
let fails = 0; const check = (n, ok, x = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!ok) fails++; };
await page.goto(`http://localhost:${server.address().port}/`);
await page.waitForFunction(() => window.app && window.app.library, null, { timeout: 30000 });
await page.waitForTimeout(1200);
const open = async (file, name) => page.evaluate(async ([b64, name]) => { const { host } = await import('/js/host.js'); const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); const p = app.library.root + '\\' + name; host._fake.put(p, bytes); await app.openPdf(p, false, 0, true); return p; }, [fs.readFileSync(path.join(here, 'samples', file)).toString('base64'), name]);
await open('sample-ko.pdf', 'a.pdf'); await page.waitForTimeout(1200);
await page.evaluate(() => { if (app.libraryDialog && app.libraryDialog.isShowing()) app.libraryDialog.dismiss(); }); await page.waitForTimeout(300);
const ev = (f, a) => page.evaluate(f, a);
const closeMenus = async () => { await page.keyboard.press('Escape'); await page.mouse.click(5, 5); await page.waitForTimeout(150); };
const stroke = (pg, pen = 0) => ev(async ([pg, pen]) => { const { AnnotationStore } = await import('/js/store.js'); const s = new AnnotationStore.InkStroke(); s.page = pg; s.pen = pen; s.color = 0xFF1C1C1E | 0; s.width = .006; for (let i = 0; i <= 8; i++) s.points.push(new AnnotationStore.InkPoint(.2 + i * .05, .3, .5)); app.store.strokes.push(s); app.store.save(); }, [pg, pen]);

// 1. split: pane name chips never overlap, even right after the split
await open('sample.pdf', 'b.pdf'); await page.waitForTimeout(1000);
await ev(() => { if (app.libraryDialog && app.libraryDialog.isShowing()) app.libraryDialog.dismiss(); });
await ev(() => app.switchDocument(app.sessions[0])); await page.waitForTimeout(400);
await ev(() => app.recentPrefs.putString('split_layout', 'cols'));
await ev(() => app.toggleSplit()); await ev(() => app.enterSplit(app.sessions[1])); await page.waitForTimeout(60);
check('split: pane chips do not overlap and sit in their own pane (right after splitting)', await ev(() => { const cs = [...document.querySelectorAll('[data-tag=split_pane_chip]')].map(c => c.getBoundingClientRect()); if (cs.length !== 2) return false; const [a, b] = cs; return a.right <= b.left && cs.every((c, i) => { const p = app.panes[i].view.el.getBoundingClientRect(); return c.left >= p.left - 1 && c.right <= p.right + 1; }); }));
await ev(() => app.exitSplit()); await page.waitForTimeout(600);
await ev(() => app.switchDocument(app.sessions[0])); await page.waitForTimeout(400);

// 8. 메모 label
await ev(() => app.showInsertMenu(app.insertButton)); await page.waitForTimeout(200);
check('삽입 menu: 메모, 하이라이트 (no 메모 추가)', await ev(() => { const t = [...document.querySelectorAll('.amenu .amenu-row')].map(r => r.textContent.trim()); return t.includes('메모') && t.includes('하이라이트') && !t.some(x => /메모 추가/.test(x)); }));
await closeMenus();

// 5. smooth pen-type samples (many points) and 6. single colour check
await ev(() => app.setWriteMode(true)); await ev(() => app.penButton.click()); await ev(() => app.penButton.click()); await page.waitForTimeout(250);
check('pen panel: exactly one colour (or the chip) is checked', await ev(() => document.querySelectorAll('.amenu [data-tag="pen_colors"] .dot .ico, .amenu .m-sw .dot .ico').length === 1));
await ev(() => document.querySelectorAll('.amenu .m-sw')[1].querySelectorAll('.dot')[1].click());
check('picking a second-row colour still checks exactly one', await ev(() => document.querySelectorAll('.amenu .m-sw .dot .ico').length === 1));
await closeMenus();

// 2. ink-only preview filter
await ev(() => { app.setWriteMode(false); app.selectPanelTab(1); }); await page.waitForTimeout(400);
await stroke(2, 0); await stroke(4, 5);
await ev(() => app.setThumbFilter('ink')); await page.waitForTimeout(500);
check('필기 있는 페이지만: lists only pages 3 and 5 (pen + highlighter strokes)', await ev(() => [...document.querySelectorAll('.m2-thumb')].map(x => +x.dataset.page).join() === '2,4' && app.thumbInkOnly));
await ev(() => app.showThumbnailMenu(app.sideMore)); await page.waitForTimeout(200);
check('preview menu has 필기 있는 페이지만 (checked) and 문서 전체 필기·삽입 지우기', await ev(() => { const t = [...document.querySelectorAll('.amenu .amenu-row')]; return t.some(r => /필기 있는 페이지만/.test(r.textContent) && r.querySelector('.ico + *, svg')) && t.some(r => /문서 전체 필기·삽입 지우기/.test(r.textContent)); }));
await closeMenus();

// 4. clear page / document
await ev(async () => { const { Mark, AnnotationStore } = await import('/js/store.js'); const m = new Mark(); m.page = 2; m.left = .1; m.top = .1; m.right = .4; m.bottom = .15; m.color = 0x66FFDE59; app.store.marks.push(m);
  const e = new AnnotationStore.PageElement(); e.page = 2; e.kind = 'shape'; e.text = 'rect|FF007AFF|00000000|3'; e.left = .3; e.top = .3; e.right = .6; e.bottom = .5; app.store.elements.push(e);
  const e2 = new AnnotationStore.PageElement(); e2.page = 4; e2.kind = 'shape'; e2.text = 'rect|FF007AFF|00000000|3'; e2.left = .3; e2.top = .3; e2.right = .6; e2.bottom = .5; app.store.elements.push(e2); });
await ev(() => app.confirmClearContent(2)); await page.waitForTimeout(200);
check('clear page: confirmation dialog first, nothing deleted yet', await ev(() => /되돌릴 수 없습니다/.test(document.body.innerText) && app.store.strokes.length === 2));
await page.locator('.ad-btn >> text=취소').click(); await page.waitForTimeout(150);
check('cancel keeps everything', await ev(() => app.store.strokes.length === 2 && app.store.marks.length === 1 && app.store.elements.length === 2));
await ev(() => app.confirmClearContent(2)); await page.waitForTimeout(150); await page.locator('.ad-btn >> text=모두 지우기').click(); await page.waitForTimeout(500);
check('clear page 3: strokes, marks and elements of that page gone, page 5 untouched', await ev(() => app.store.strokes.length === 1 && app.store.strokes[0].page === 4 && app.store.marks.length === 0 && app.store.elements.length === 1 && app.store.elements[0].page === 4));
check('ink filter refreshed: only page 5 left', await ev(() => [...document.querySelectorAll('.m2-thumb')].map(x => +x.dataset.page).join() === '4'));
await ev(() => app.confirmClearContent(null)); await page.waitForTimeout(150); await page.locator('.ad-btn >> text=모두 지우기').click(); await page.waitForTimeout(500);
check('clear whole document', await ev(() => app.store.strokes.length === 0 && app.store.elements.length === 0 && app.store.marks.length === 0));
check('empty ink filter shows a message', await ev(() => !!document.querySelector('[data-tag=thumb_empty]')));
await ev(() => app.setThumbFilter('all')); await page.waitForTimeout(300);

// 3. 형광펜 = ink; 하이라이트 mark appears in the 삽입 목록
await ev(() => { app.setWriteMode(true); app.highlightTap(app.hlButton); });
check('형광펜: ink pen 5', await ev(() => app.highlighterMode && app.pageView.inkPen === 5 && app.inkMode === 1));
await ev(() => app.eraserButton.click());
check('eraser leaves the highlighter (pen restored)', await ev(() => !app.highlighterMode && app.inkPen !== 5 && app.pageView.inkPen !== 5 && app.inkMode === 2));
await ev(async () => { const { Mark } = await import('/js/store.js'); const m = new Mark(); m.page = 1; m.left = .1; m.top = .2; m.right = .4; m.bottom = .25; m.color = 0x66FFDE59; app.store.marks.push(m); app.store.save(); app.setWriteMode(false); app.selectPanelTab(4); });
await page.waitForTimeout(300);
check('삽입 목록 lists a 하이라이트 without a note', await ev(() => [...document.querySelectorAll('[data-tag=mark_item]')].some(r => /하이라이트 \(p2\)/.test(r.textContent))));

// 7. strip stays above the (docked) bottom menu
await ev(() => { app.closeSidePanel(); app.setWriteMode(true); }); await page.waitForTimeout(300);
const gb = await ev(() => app.stripGrip.getBoundingClientRect().toJSON());
await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2); await page.mouse.down(); await page.mouse.move(gb.x + 100, 760, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(250);
check('strip dragged to the bottom stops above the bottom menu', await ev(() => { const s = app.stripBox.getBoundingClientRect(), b = app.bottomBar.getBoundingClientRect(); return s.bottom <= b.top + 1 && s.bottom > b.top - 120; }), await ev(() => JSON.stringify([app.stripBox.getBoundingClientRect().bottom, app.bottomBar.getBoundingClientRect().top])));
await ev(() => app.setBarPlace('float')); await page.waitForTimeout(400);
await ev(() => app.moveFloating(app.stripBox, 0, 5000)); await page.waitForTimeout(100);
check('with a floating bottom menu the strip also stays clear of it', await ev(() => { const s = app.stripBox.getBoundingClientRect(), b = app.bottomBar.getBoundingClientRect(); const overlapX = s.left < b.right && s.right > b.left; return !overlapX || s.bottom <= b.top + 1; }));
await ev(() => app.setBarPlace('bottom')); await page.waitForTimeout(300);

// 9. lasso: floating bar + restyled capture dialog
await ev(() => app.startLasso()); await page.waitForTimeout(250);
check('lasso bar floats like the strip: has a grip, 3 shape buttons, one marked on', await ev(() => !!app.lassoBar.querySelector('.m-grip') && app.lassoBar.querySelectorAll('.m3-lchip').length === 3 && app.lassoBar.querySelectorAll('.m3-lchip.on').length === 1));
const lg = await ev(() => app.lassoBar.querySelector('.m-grip').getBoundingClientRect().toJSON());
await page.mouse.move(lg.x + lg.width / 2, lg.y + lg.height / 2); await page.mouse.down(); await page.mouse.move(lg.x + 120, lg.y + 200, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
check('dragging the lasso bar moves it and remembers the place', await ev(() => /px/.test(app.lassoBar.style.translate) && app.recentPrefs.getString('lasso_pos', '') !== ''));
await ev(() => { const c = document.createElement('canvas'); c.width = 300; c.height = 200; c.getContext('2d').fillRect(0, 0, 300, 200); app.pageView.captureLasso = () => c; app.pageView.lassoText = () => ''; app.onLassoSelectionFinished(); }); await page.waitForTimeout(300);
check('lasso capture dialog: 6 tiles in 2 rows of 3, same soft look', await ev(() => document.querySelectorAll('.m2-ltile').length === 6 && document.querySelectorAll('.m2-lgrid').length === 2 && ['이미지 복사', 'PNG 저장', '이미지 공유', '글자 복사', '다시 선택', '선택 종료'].every(l => !!document.querySelector('.m2-ltile[aria-label="' + l + '"]'))));
await page.screenshot({ path: path.join(out, 'v322-lasso.png') });
await page.locator('.m2-ltile[aria-label="선택 종료"]').click(); await page.waitForTimeout(250);
check('선택 종료 ends the lasso', await ev(() => !app.pageView.isLassoMode() && app.lassoBar.style.display === 'none'));
await browser.close(); server.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
