// Playwright harness for app-main1.js (runs the real index.html). usage: node dev/main1-test.mjs
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
const port = server.address().port;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 720 } });
const page = await ctx.newPage();
let errors = 0;
page.on('response', r => { if (r.status() === 404) console.log('[404]', r.url()); });
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) { console.log('[console.error]', m.text()); errors++; } });
page.on('pageerror', e => { console.log('[pageerror]', e.message); errors++; });
await page.addInitScript(() => { for (const C of [Map, WeakMap]) { if (!C.prototype.getOrInsertComputed) C.prototype.getOrInsertComputed = function (k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); }; if (!C.prototype.getOrInsert) C.prototype.getOrInsert = function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); }; } });
let fails = 0;
const check = (n, ok, x = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!ok) fails++; };
const shot = async n => { await page.waitForTimeout(450); await page.screenshot({ path: path.join(out, 'main1-' + n + '.png') }); };
await page.goto(`http://localhost:${port}/`);
await page.waitForFunction(() => window.app && window.app.library, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(1500);
await shot('00-boot');
check('welcome: product name Everynote (title, header, card)', await page.evaluate(() => document.title === 'Everynote' && app.titleView.textContent === 'Everynote' && document.querySelector('.m-welcome-name').textContent === 'Everynote' && getComputedStyle(document.querySelector('.m-welcome')).display !== 'none' && getComputedStyle(app.zoomPill).display === 'none' && getComputedStyle(app.addPageButton).display === 'none'));
const b64 = fs.readFileSync(path.join(here, 'samples/sample-ko.pdf')).toString('base64');
const p = await page.evaluate(async b => { const { host } = await import('/js/host.js'); const bytes = Uint8Array.from(atob(b), c => c.charCodeAt(0)); const path = app.library.root + '\\sample-ko.pdf'; host._fake.put(path, bytes); await app.openPdf(path, false, 0, true); return path; }, b64);
await page.waitForTimeout(1500);
await shot('01-open');
const st = () => page.evaluate(() => ({ page: app.currentPage, n: app.renderer && app.renderer.pageCount, sessions: app.sessions.length, tabs: document.querySelectorAll('.m-tab').length, label: document.querySelector('.m-pagelabel')?.textContent }));
let s = await st(); check('opened', s.n > 0 && s.sessions === 1, JSON.stringify(s));
await page.evaluate(() => app.showPage(1)); await page.waitForTimeout(600); s = await st(); check('showPage', s.page === 1, JSON.stringify(s));
for (const mode of [0, 1, 2]) {
  await page.evaluate(m => { app.recentPrefs.putInt('page_anim_style', m); }, mode);
  const before = (await st()).page;
  await page.evaluate(() => app.animatePage(1)); if (mode === 0) await shot('curl-mid'); await page.waitForTimeout(900);
  s = await st(); check('animatePage style ' + mode, s.page === before + 1, JSON.stringify(s));
}
await shot('02-turned');
await page.evaluate(() => app.toggleTwoPage()); await page.waitForTimeout(1200); await shot('03-two');
await page.evaluate(() => app.toggleTwoPage()); await page.waitForTimeout(600);
for (const fn of ['showMainMenu', 'showViewMenu', 'showPenMenu', 'showHighlightMenu']) {
  try { await page.evaluate(f => app[f](document.querySelector('.m-ib')), fn); } catch (e) { check(fn, false, String(e)); }
  await shot('menu-' + fn); await page.keyboard.press('Escape'); await page.mouse.click(5, 400); await page.waitForTimeout(250);
}
await page.evaluate(() => app.toggleFullscreen()); await page.waitForTimeout(500); await shot('04-fullscreen');
await page.evaluate(() => app.toggleFullscreen()); await page.waitForTimeout(300);
await page.evaluate(() => app.toggleBookmark()); await shot('05-bookmark');
// ---- v1.27: reading bar, pen types / colour chips, unified selection menu
const bars = await page.evaluate(() => ({ readHasText: !!app.readBar.querySelector('[aria-label="타이핑"]'), writeHasText: !!app.writeBar.querySelector('[aria-label="타이핑"]'),
  order: [...app.readBar.querySelectorAll('.m-tb')].map(b => b.getAttribute('aria-label')).join('|') }));
check('typing button moved to reading bar next to pen', bars.readHasText && !bars.writeHasText && /필기 모드\|타이핑/.test(bars.order), bars.order);
await page.evaluate(() => { app.setWriteMode(true); app.showPenMenu(app.penButton); }); await page.waitForTimeout(300);
const pen = await page.evaluate(() => ({ chips: [...document.querySelectorAll('.amenu .m-iseg[data-tag^="pen_"]:not(.m-opts)')].map(r => [...r.children].map(c => c.getAttribute('aria-label')).join(',')),
  texts: [...document.querySelectorAll('.amenu .m-iseg .m-ibtn')].map(b => b.textContent.trim()).join(''), titles: [...document.querySelectorAll('.amenu .m-iseg .m-ibtn')].every(b => b.title && (b.querySelector('svg') || b.querySelector('canvas.m-pensample'))),
  samples: document.querySelectorAll('.amenu .m-pensample').length,
  opts: [...document.querySelectorAll('.amenu .m-opts .m-ibtn')].map(b => b.getAttribute('aria-label')).join('|'), rows: document.querySelectorAll('.amenu .amenu-row').length,
  dots: document.querySelectorAll('.amenu .m-sw .dot').length, more: document.querySelectorAll('.amenu [data-tag="color_more"]').length, op: !!document.querySelector('.amenu [data-tag="opacity_bar"]') }));
check('pen menu (v1.29): widths row first, then pen types; both are icon / sample-stroke buttons (no text, tooltips)', pen.chips.length === 2 && pen.chips[1] === '볼펜,연필,만년필,붓,사인펜' && pen.chips[0] === '굵기 · 얇게,굵기 · 보통,굵기 · 굵게,굵기 · 최대' && pen.texts === '' && pen.titles && pen.samples === 9, JSON.stringify(pen));
check('pen menu: 직선 + 손가락 필기 are icon toggles; no text rows left', /^직선.*\|손가락 필기$/.test(pen.opts) && pen.rows === 0, pen.opts + ' rows=' + pen.rows);
check('pen menu: 2 swatch rows (8+8+rainbow chip) + opacity bar', pen.dots === 17 && pen.more === 1 && pen.op, JSON.stringify(pen));
await shot('07-pen-menu');
await page.locator('.amenu [data-tag="pen_types"] .m-ibtn').nth(3).click();
check('pen type 붓 -> inkPen 3 + pref + pageView', await page.evaluate(() => app.inkPen === 3 && app.pageView.inkPen === 3 && app.recentPrefs.getInt('ink_pen', 0) === 3));
await page.evaluate(() => { const b = document.querySelector('.amenu [data-tag="opacity_bar"]'); b.value = 40; b.dispatchEvent(new Event('input', { bubbles: true })); });
check('opacity 40% -> alpha 102 and colour kept', await page.evaluate(() => (app.inkColor >>> 24) === 102 && (app.inkColor & 0xFFFFFF) === 0x1C1C1E), await page.evaluate(() => (app.inkColor >>> 0).toString(16)));
check('width icon -> inkWidth', await (async () => { await page.locator('.amenu [data-tag="pen_widths"] .m-ibtn').nth(2).click(); return page.evaluate(() => Math.abs(app.inkWidth - 0.0065) < 1e-9 && app.pageView.inkWidth === app.inkWidth); })());
check('pen button shows the chosen pen icon', await page.evaluate(() => app.penButton.querySelector('.ico').dataset.icon === 'ic_pen_brush'));
await page.locator('.amenu [data-tag="pen_line"]').click();
check('straight line toggle -> inkMode 3 (menu stays open) and back', await page.evaluate(() => app.inkMode === 3) && (await page.locator('.amenu').count()) === 1 && (await page.locator('.amenu [data-tag="pen_line"]').getAttribute('aria-pressed')) === 'true');
await page.locator('.amenu [data-tag="pen_line"]').click();
check('straight line toggle off -> pen', await page.evaluate(() => app.inkMode === 1));
await page.locator('.amenu [data-tag="pen_finger"]').click();
check('finger writing toggle', await page.evaluate(() => app.fingerInk === true)); await page.locator('.amenu [data-tag="pen_finger"]').click();
await page.locator('.amenu .m-sw').nth(0).locator('.dot').nth(2).click();
check('picking a preset keeps alpha', await page.evaluate(() => (app.inkColor >>> 24) === 102 && (app.inkColor & 0xFFFFFF) === 0x007AFF));
await page.click('.amenu [data-tag="color_more"]'); await page.waitForSelector('[data-tag="color_picker"]'); await shot('08-colorpicker');
await page.click('.ad-btn >> text=적용'); await page.waitForTimeout(300);
check('rainbow chip opens ColorPicker (alpha kept for pen)', await page.evaluate(() => (app.inkColor >>> 24) === 102));
await page.keyboard.press('Escape'); await page.mouse.click(5, 400); await page.waitForTimeout(200);
await page.evaluate(() => { app.inkColor = 0xFF1C1C1E | 0; app.pageView.setInkTool(app.inkMode, app.inkColor, app.inkWidth); app.setInkMode(0); app.setWriteMode(false); });
await page.evaluate(() => { app.toggleHighlight(); app.showHighlightMenu(app.hlButton); }); await page.waitForTimeout(250);
check('highlight menu has rainbow chip', (await page.locator('.amenu [data-tag="color_more"]').count()) === 1);
check('highlight menu: thickness slider (31 steps, label 굵기 N) + 직선/자유형 rows', await page.evaluate(() => { const b = document.querySelector('.amenu [data-tag="highlight_thick"]'), l = document.querySelector('.amenu [data-tag="highlight_thick_label"]'); return !!b && b.max === '30' && b.min === '0' && l.textContent === '굵기 22' && b.value === '6'; }));
check('highlight menu: rows 직선 (selected) and 자유형', await page.evaluate(() => { const t = [...document.querySelectorAll('.amenu .amenu-row, .amenu [role="menuitem"], .amenu div')].map(x => x.textContent.trim()); return t.includes('직선') && t.includes('자유형'); }));
await page.evaluate(() => { const b = document.querySelector('.amenu [data-tag="highlight_thick"]'); b.value = '30'; b.dispatchEvent(new Event('input', { bubbles: true })); });
check('thickness slider -> 굵기 80, pageView style updated', await page.evaluate(() => document.querySelector('.amenu [data-tag="highlight_thick_label"]').textContent === '굵기 80' && Math.abs(app.pageView.highlightThick - 0.08) < 1e-9 && Math.abs(app.highlightThick - 0.08) < 1e-9));
await shot('09b-highlight-menu-thick');
await page.locator('.amenu >> text=자유형').first().click(); await page.waitForTimeout(200);
check('자유형 row -> freehand on pageView and app', await page.evaluate(() => app.highlightFree === true && app.pageView.highlightFree === true && app.pageView.highlightThick > .07));
check('toast says "원하는 모양대로 그리세요" in freehand mode', await page.evaluate(() => { app.toggleHighlight(); app.toggleHighlight(); return true; }) && await page.evaluate(() => [...document.querySelectorAll('body *')].some(e => e.children.length === 0 && e.textContent === '원하는 모양대로 그리세요')));
await page.evaluate(() => { app.showHighlightMenu(app.hlButton); }); await page.waitForTimeout(250); await shot('09c-highlight-menu-free');
check('menu reopens with 자유형 selected and label 굵기 80', await page.evaluate(() => document.querySelector('.amenu [data-tag="highlight_thick_label"]').textContent === '굵기 80'));
await page.locator('.amenu >> text=직선').first().click(); await page.waitForTimeout(200);
await page.evaluate(() => { app.highlightThick = 0.022; app.applyHighlightStyle(); });
check('직선 row -> straight', await page.evaluate(() => app.highlightFree === false && app.pageView.highlightFree === false));
await page.keyboard.press('Escape'); await page.mouse.click(5, 400); await page.waitForTimeout(200);
await page.evaluate(() => app.setInkMode(0));
await page.evaluate(() => { window.__cleared = 0; app.pageView.clearTextSelectionOverlay = () => { window.__cleared++; };
  const u = { left: .2, top: .3, right: .5, bottom: .34 };
  app.showTextSelectionPopup({ text: 'Hello 안녕', bounds: [u], unionBounds: u }, 300, 300); });
await page.waitForTimeout(300);
const rowsText = await page.evaluate(() => [...document.querySelectorAll('.amenu .amenu-row')].map(r => r.getAttribute('aria-label')));
check('v1.29 selection popup = 9 actions + a 삽입 submenu row (insert items are not inline)', rowsText.join() === '하이라이트,복사,번역,읽어주기,단어장,개요,메모,발췌,링크,삽입', rowsText.join());
const geo = await page.evaluate(() => { const v = app.pageView, vr = v.el.getBoundingClientRect(), pr = v.pageRect(), u = { left: .2, top: .3, right: .5, bottom: .34 };
  const s = { l: vr.left + pr.left + u.left * pr.width(), t: vr.top + pr.top + u.top * pr.height(), r: vr.left + pr.left + u.right * pr.width(), b: vr.top + pr.top + u.bottom * pr.height() };
  const c = document.querySelector('.amenu').getBoundingClientRect(); return { s, c: { l: c.left, t: c.top, r: c.right, b: c.bottom } }; });
check('v1.29 selection popup does not cover the selected text (below / above / beside)', geo.c.r <= geo.s.l + 0.5 || geo.c.l >= geo.s.r - 0.5 || geo.c.b <= geo.s.t + 0.5 || geo.c.t >= geo.s.b - 0.5, JSON.stringify(geo));
await shot('06-selpop-avoid');
await page.locator('.amenu .amenu-row[aria-label="삽입"]').click(); await page.waitForTimeout(300);
const rows2 = await page.evaluate(() => [...document.querySelectorAll('.amenu .amenu-row')].map(r => r.getAttribute('aria-label')));
check('삽입 submenu lists the insert rows (incl. 하이퍼링크) and still avoids the text', rows2.includes('사진·이미지') && rows2.includes('도형') && rows2.includes('하이퍼링크') && await page.evaluate(g => { const c = document.querySelector('.amenu').getBoundingClientRect(); return c.right <= g.s.l + 0.5 || c.left >= g.s.r - 0.5 || c.bottom <= g.s.t + 0.5 || c.top >= g.s.b - 0.5; }, geo), rows2.join());
await page.evaluate(() => { window.__cleared = 0; app.showTextSelectionPopup({ text: 'Hello 안녕', bounds: [{ left: .2, top: .3, right: .5, bottom: .34 }], unionBounds: { left: .2, top: .3, right: .5, bottom: .34 } }, 300, 300); });
await page.waitForTimeout(300);
// 단어장: copies the word, toasts, nothing else (no web page, no other app)
await page.evaluate(async () => { const { host } = await import('/js/host.js'); window.__opened = 0; const o = host.shellOpen; host.shellOpen = (...a) => { window.__opened++; return Promise.resolve(); }; window.__copied = null;
  try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__copied = t; }, readText: async () => '' } }); } catch (e) { /* ignore */ } });
await page.locator('.amenu .amenu-row[aria-label="단어장"]').click(); await page.waitForTimeout(300);
check('단어장 copies the cleaned word and toasts "단어가 복사되었습니다", opens nothing', await page.evaluate(() => window.__copied === 'Hello' && window.__opened === 0 && document.querySelector('.toast').textContent === '단어가 복사되었습니다' && document.querySelector('.toast').classList.contains('show')), JSON.stringify(await page.evaluate(() => [window.__copied, window.__opened, document.querySelector('.toast').textContent])));
await page.evaluate(() => { window.__cleared = 0; app.showTextSelectionPopup({ text: 'Hello 안녕', bounds: [{ left: .2, top: .3, right: .5, bottom: .34 }], unionBounds: { left: .2, top: .3, right: .5, bottom: .34 } }, 300, 300); });
await page.waitForTimeout(300);
check('legacy tile popup is gone', (await page.locator('.m-selpop').count()) === 0);
check('selection popup registered', await page.evaluate(() => !!app.selectionPopup));
await shot('06-selpop');
await page.mouse.click(5, 400); await page.waitForTimeout(250);
check('dismissing the popup clears the selection overlay', (await page.evaluate(() => window.__cleared)) >= 1 && (await page.evaluate(() => app.selectionPopup)) === null);

// ---- v1.29 translation card: result is attached right away; original + editable translation; 복사 / 삭제 / 저장
{
  const n0 = await page.evaluate(() => app.store.translations.length);
  await page.evaluate(async () => { const { RectF } = await import('/js/util.js'); window.__copied = null; app.showTranslationResult('Hello world', '안녕 세상', new RectF(.2, .3, .5, .34)); });
  await page.waitForTimeout(300);
  const c = await page.evaluate(() => ({ card: !!document.querySelector('[data-tag="translation_card"]'), orig: document.querySelector('[data-tag="translation_original"]').textContent, val: document.querySelector('[data-tag="translation_result"]').value,
    pair: document.querySelector('.m-tc-pair').textContent, btns: [...document.querySelectorAll('.m-tc-btn')].map(b => b.textContent).join('|'), n: app.store.translations.length, last: app.store.translations.at(-1).translated }));
  check('translation card: new design, translation put on the page right away', c.card && c.orig === 'Hello world' && c.val === '안녕 세상' && c.pair === '영어 → 한국어' && c.n === n0 + 1 && c.last === '안녕 세상' && /^복사\|삭제\|표시\|닫기\|저장$/.test(c.btns), JSON.stringify(c));
  await shot('10-translation-card');
  await page.locator('[data-tag="translation_copy"]').click(); await page.waitForTimeout(150);
  check('translation card: 복사 copies the (edited) translation', await page.evaluate(() => window.__copied === '안녕 세상'));
  await page.locator('[data-tag="translation_result"]').fill('수정한 번역');
  await page.locator('[data-tag="translation_save"]').click(); await page.waitForTimeout(250);
  check('translation card: 수정 + 저장 updates the note', await page.evaluate(() => app.store.translations.at(-1).translated === '수정한 번역' && !document.querySelector('[data-tag="translation_card"]')));
  await page.evaluate(() => app.editTranslation(app.store.translations.at(-1))); await page.waitForTimeout(250);
  check('tapping a translation note opens the same card (Korean source -> English label)', await page.evaluate(() => document.querySelector('[data-tag="translation_original"]').textContent === 'Hello world' && document.querySelector('[data-tag="translation_result"]').value === '수정한 번역'));
  await page.locator('[data-tag="translation_delete"]').click(); await page.waitForTimeout(250);
  check('translation card: 삭제 removes the note', await page.evaluate(n => app.store.translations.length === n, n0));
  // manual flow (empty result): nothing is attached until 포스트잇 붙이기
  await page.evaluate(async () => { const { RectF } = await import('/js/util.js'); app.showTranslationResult('안녕', '', new RectF(.2, .3, .5, .34)); }); await page.waitForTimeout(250);
  check('empty translation: not attached yet, button is 포스트잇 붙이기', await page.evaluate(n => app.store.translations.length === n && document.querySelector('[data-tag="translation_save"]').textContent === '포스트잇 붙이기' && document.querySelector('.m-tc-pair').textContent === '한국어 → 영어', n0));
  await page.locator('[data-tag="translation_result"]').fill('hello'); await page.locator('[data-tag="translation_save"]').click(); await page.waitForTimeout(250);
  check('포스트잇 붙이기 attaches the pasted translation', await page.evaluate(n => app.store.translations.length === n + 1 && app.store.translations.at(-1).translated === 'hello', n0));
  await page.evaluate(() => { app.store.translations.length = 0; app.pageView.invalidate(); });
}

// ================= v3.0: zoom pill, add page, mouse/keyboard page turning, menu entries, element delete hook
await page.evaluate(() => { app.setInkMode(0); app.setWriteMode(false); app.showPage(2); }); await page.waitForTimeout(900);
const hasCoreZoom = await page.evaluate(() => typeof app.firstPageView.setZoom === 'function');
console.log('CORE zoom API present:', hasCoreZoom);
const zoomBox = await page.evaluate(() => { const r = e => e.getBoundingClientRect(), z = r(app.zoomPill), v = r(app.viewportLayer), a = r(app.previousOverlay), f = r(app.addPageButton);
  return { visible: getComputedStyle(app.zoomPill).display !== 'none', leftEdge: z.left - v.left < 24, vertical: z.height > z.width * 2, labels: [...app.zoomPill.querySelectorAll('button')].map(b => b.getAttribute('aria-label')).join('|'), text: app.zoomLabel.textContent,
    noOverlapArrow: z.bottom <= a.top + 1, fabRight: v.right - f.right < 24 && v.bottom - f.bottom < 24, fabText: app.addPageButton.textContent.trim() }; });
check('zoom pill: left edge, vertical, + / 100% / - , clear of the prev arrow', zoomBox.visible && zoomBox.leftEdge && zoomBox.vertical && zoomBox.labels === '확대|100%로 되돌리기|축소' && zoomBox.text === '100%' && zoomBox.noOverlapArrow, JSON.stringify(zoomBox));
check('floating 페이지 추가 button at the bottom right', zoomBox.fabRight && zoomBox.fabText === '페이지 추가', JSON.stringify(zoomBox));
await shot('10-zoom-pill');
await page.click('[data-tag="zoom_in"]'); await page.waitForTimeout(200);
let zs = await page.evaluate(() => ({ z: app.pageView.scale, label: app.zoomLabel.textContent, g: app.getZoomOf(app.pageView) }));
check('zoom + -> 125%', Math.abs(zs.z - 1.25) < .01 && zs.label === '125%', JSON.stringify(zs));
await page.click('[data-tag="zoom_in"]'); await page.click('[data-tag="zoom_in"]'); await page.waitForTimeout(200);
await shot('11-zoomed');
zs = await page.evaluate(() => ({ z: app.pageView.scale, label: app.zoomLabel.textContent }));
check('zoom + x3 -> 195%', zs.z > 1.9 && zs.label === Math.round(zs.z * 100) + '%', JSON.stringify(zs));
await page.click('[data-tag="zoom_out"]'); await page.waitForTimeout(150);
check('zoom - lowers', await page.evaluate(() => app.pageView.scale < 1.7 && app.pageView.scale > 1.4));
await page.click('[data-tag="zoom_reset"]'); await page.waitForTimeout(150);
check('click % -> 100%', await page.evaluate(() => app.pageView.scale === 1 && app.zoomLabel.textContent === '100%'));
await page.evaluate(() => app.pageView.setZoom ? app.pageView.setZoom(2.5) : (app.pageView.scale = 2.5, app.pageView.invalidate())); await page.waitForTimeout(250);
check('label follows view zoom (pinch/wheel path -> onZoomChanged)', await page.evaluate(() => app.zoomLabel.textContent === '250%'), await page.evaluate(() => app.zoomLabel.textContent));
await page.keyboard.press('Control+0'); await page.waitForTimeout(150);
check('Ctrl+0 resets zoom', await page.evaluate(() => app.pageView.scale === 1 && app.zoomLabel.textContent === '100%'));
await page.evaluate(() => { app.showPage(2); }); await page.waitForTimeout(600);
check('page change resets label', await page.evaluate(() => app.zoomLabel.textContent === '100%'));
// add page button
await page.evaluate(() => { window.__ins = []; app.choosePageToInsert = i => window.__ins.push(i); });
await page.click('[data-tag="add_page_fab"]');
check('페이지 추가 -> choosePageToInsert(current page)', await page.evaluate(() => window.__ins.join() === String(app.currentPage)), await page.evaluate(() => window.__ins.join()));
// page turning: keyboard, arrow buttons, onPageSwipe
await page.evaluate(() => { app.recentPrefs.putInt('page_anim_style', 2); app.showPage(3); }); await page.waitForTimeout(600);
const at = () => page.evaluate(() => app.currentPage);
await page.keyboard.press('ArrowRight'); await page.waitForTimeout(500); check('ArrowRight -> next page', (await at()) === 4);
await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(500); check('ArrowLeft -> previous page', (await at()) === 3);
await page.keyboard.press('PageDown'); await page.waitForTimeout(500); check('PageDown -> next page', (await at()) === 4);
await page.keyboard.press('PageUp'); await page.waitForTimeout(500); check('PageUp -> previous page', (await at()) === 3);
await page.keyboard.press('ArrowDown'); await page.waitForTimeout(500); check('ArrowDown -> next page', (await at()) === 4);
await page.keyboard.press('End'); await page.waitForTimeout(700); check('End -> last page', (await at()) === 11);
await page.keyboard.press('Home'); await page.waitForTimeout(700); check('Home -> first page', (await at()) === 0);
await page.click('.m-arrow.next'); await page.waitForTimeout(500); check('edge arrow button -> next page', (await at()) === 1);
await page.click('.m-arrow.prev'); await page.waitForTimeout(500); check('edge arrow button -> previous page', (await at()) === 0);
await page.evaluate(() => app.pageView.listener ? app.pageView.listener.onPageSwipe(1) : null); await page.waitForTimeout(500);
check('listener.onPageSwipe(+1) (mouse wheel path) -> next page', (await at()) === 1);
await page.mouse.move(500, 360); await page.mouse.wheel(0, 400); await page.waitForTimeout(900);
console.log('wheel at fit zoom -> page', await at(), '(CORE debounced onPageSwipe)');
// mouse read drag follows write mode
await page.evaluate(() => { window.__mrd = []; for (const v of [app.firstPageView, app.secondPageView]) { const orig = v.setMouseReadDrag; v.setMouseReadDrag = function (b) { window.__mrd.push(b); return orig && orig.call(this, b); }; } });
await page.evaluate(() => app.setWriteMode(true));
check('write mode -> setMouseReadDrag(false) on both views', await page.evaluate(() => window.__mrd.length >= 2 && window.__mrd.every(x => x === false)), await page.evaluate(() => JSON.stringify(window.__mrd)));
await page.evaluate(() => { window.__mrd.length = 0; app.setWriteMode(false); });
check('read mode -> setMouseReadDrag(true)', await page.evaluate(() => window.__mrd.length >= 2 && window.__mrd.every(x => x === true)));
check('arrows keep working while writing (keyboard)', await (async () => { await page.evaluate(() => app.setWriteMode(true)); const b = await at(); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(500); const a = await at(); await page.evaluate(() => app.setWriteMode(false)); return a === b + 1; })());
// main menu entries (UI2 methods stubbed)
await page.evaluate(() => { window.__ui2 = []; for (const n of ['printDocument', 'showAboutOffline']) app[n] = () => window.__ui2.push(n); app.showMainMenu(document.querySelector('.m-ib:last-child'), false); });
await page.waitForTimeout(250); await shot('12-main-menu');
const mm = await page.evaluate(() => [...document.querySelectorAll('.amenu .amenu-row')].map(r => r.getAttribute('aria-label')));
check('main menu has 인쇄 / 오프라인 사용 안내', ['인쇄', '오프라인 사용 안내'].every(x => mm.includes(x)), mm.join());
for (const n of ['인쇄', '오프라인 사용 안내']) {
  await page.locator('.amenu .amenu-row[aria-label="' + n + '"]').click(); await page.waitForTimeout(200);
  await page.evaluate(() => app.showMainMenu(document.querySelector('.m-ib:last-child'), false)); await page.waitForTimeout(200);
}
check('menu entries call printDocument / showAboutOffline', (await page.evaluate(() => window.__ui2.join())) === 'printDocument,showAboutOffline', await page.evaluate(() => window.__ui2.join()));
await page.keyboard.press('Escape'); await page.mouse.click(5, 400); await page.waitForTimeout(200);
await page.evaluate(() => { window.__ui2.length = 0; });
await page.keyboard.press('Control+p'); await page.waitForTimeout(150);
check('Ctrl+P -> printDocument', (await page.evaluate(() => window.__ui2.join())) === 'printDocument');
// element delete: listener.onElementDeleted and the Delete key
const del = await page.evaluate(async () => {
  const { AnnotationStore } = await import('/js/store.js'); const out = {};
  const mk = () => { const e = new AnnotationStore.PageElement(); e.page = app.currentPage; e.kind = 'shape'; e.left = .3; e.top = .3; e.right = .6; e.bottom = .5; return e; };
  const e1 = mk(); app.store.elements.push(e1); app.redrawPages();
  app.pageView.listener.onElementDeleted(e1); out.hook = !app.store.elements.includes(e1);
  const e2 = mk(); app.store.elements.push(e2); app.pageView.selectElement(e2); out.sel = app.selectedPageElement() === e2;
  return out;
});
check('listener.onElementDeleted removes the element from the store', del.hook, JSON.stringify(del));
await page.keyboard.press('Delete'); await page.waitForTimeout(200);
check('Delete key deletes the selected element', del.sel && await page.evaluate(() => app.store.elements.filter(e => e.kind === 'shape').length === 0 && !app.selectedPageElement()));
await page.evaluate(async () => { const { AnnotationStore } = await import('/js/store.js'); const e = new AnnotationStore.PageElement(); e.page = app.currentPage; e.kind = 'shape'; e.left = .3; e.top = .3; e.right = .6; e.bottom = .5; app.store.elements.push(e); app.pageView.selectElement(e); app.redrawPages(); });
await shot('13-element-selected');
await page.keyboard.press('Escape'); await page.waitForTimeout(150);
check('Esc deselects the element', await page.evaluate(() => !app.selectedPageElement()));
await page.evaluate(() => { app.store.elements.length = 0; app.redrawPages(); });
// write mode screenshot (icon toolbar)
await page.evaluate(() => { app.setWriteMode(true); app.showPenMenu(app.penButton); }); await page.waitForTimeout(300); await shot('14-write-pen-menu');
await page.keyboard.press('Escape'); await page.mouse.click(5, 400); await page.waitForTimeout(200);
await page.evaluate(() => { app.setWriteMode(false); });
check('no console errors', errors === 0, 'errors=' + errors);
await browser.close(); server.close();
console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
