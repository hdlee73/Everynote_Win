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
const pen = await page.evaluate(() => ({ chips: [...document.querySelectorAll('.amenu .m-seg')].map(r => [...r.children].map(c => c.textContent).join(',')),
  dots: document.querySelectorAll('.amenu .m-sw .dot').length, more: document.querySelectorAll('.amenu [data-tag="color_more"]').length, op: !!document.querySelector('.amenu [data-tag="opacity_bar"]') }));
check('pen menu: width + 5 pen types', pen.chips.length === 2 && pen.chips[1] === '볼펜,연필,만년필,붓,사인펜', JSON.stringify(pen.chips));
check('pen menu: 2 swatch rows (8+8+rainbow chip) + opacity bar', pen.dots === 17 && pen.more === 1 && pen.op, JSON.stringify(pen));
await shot('07-pen-menu');
await page.locator('.amenu .m-seg').nth(1).locator('.chip').nth(3).click();
check('pen type 붓 -> inkPen 3 + pref + pageView', await page.evaluate(() => app.inkPen === 3 && app.pageView.inkPen === 3 && app.recentPrefs.getInt('ink_pen', 0) === 3));
await page.evaluate(() => { const b = document.querySelector('.amenu [data-tag="opacity_bar"]'); b.value = 40; b.dispatchEvent(new Event('input', { bubbles: true })); });
check('opacity 40% -> alpha 102 and colour kept', await page.evaluate(() => (app.inkColor >>> 24) === 102 && (app.inkColor & 0xFFFFFF) === 0x1C1C1E), await page.evaluate(() => (app.inkColor >>> 0).toString(16)));
await page.locator('.amenu .m-sw').nth(0).locator('.dot').nth(2).click();
check('picking a preset keeps alpha', await page.evaluate(() => (app.inkColor >>> 24) === 102 && (app.inkColor & 0xFFFFFF) === 0x007AFF));
await page.click('.amenu [data-tag="color_more"]'); await page.waitForSelector('[data-tag="color_picker"]'); await shot('08-colorpicker');
await page.click('.ad-btn >> text=적용'); await page.waitForTimeout(300);
check('rainbow chip opens ColorPicker (alpha kept for pen)', await page.evaluate(() => (app.inkColor >>> 24) === 102));
await page.keyboard.press('Escape'); await page.mouse.click(5, 400); await page.waitForTimeout(200);
await page.evaluate(() => { app.inkColor = 0xFF1C1C1E | 0; app.pageView.setInkTool(app.inkMode, app.inkColor, app.inkWidth); app.setInkMode(0); app.setWriteMode(false); });
await page.evaluate(() => { app.toggleHighlight(); app.showHighlightMenu(app.hlButton); }); await page.waitForTimeout(250);
check('highlight menu has rainbow chip', (await page.locator('.amenu [data-tag="color_more"]').count()) === 1);
await shot('09-highlight-menu'); await page.keyboard.press('Escape'); await page.mouse.click(5, 400); await page.waitForTimeout(200);
await page.evaluate(() => app.setInkMode(0));
await page.evaluate(() => { window.__cleared = 0; app.pageView.clearTextSelectionOverlay = () => { window.__cleared++; };
  const u = { left: .2, top: .3, right: .5, bottom: .34 };
  app.showTextSelectionPopup({ text: 'Hello 안녕', bounds: [u], unionBounds: u }, 300, 300); });
await page.waitForTimeout(300);
const rowsText = await page.evaluate(() => [...document.querySelectorAll('.amenu .amenu-row')].map(r => r.getAttribute('aria-label')));
check('selection popup = one list (9 actions + insert rows, no hyperlink)', rowsText.slice(0, 9).join() === '하이라이트,복사,번역,읽어주기,단어장,개요,메모,발췌,링크' && rowsText.includes('사진·이미지') && rowsText.includes('도형') && rowsText.filter(x => x === '하이퍼링크').length === 0, rowsText.join());
check('legacy tile popup is gone', (await page.locator('.m-selpop').count()) === 0);
check('selection popup registered', await page.evaluate(() => !!app.selectionPopup));
await shot('06-selpop');
await page.mouse.click(5, 400); await page.waitForTimeout(250);
check('dismissing the popup clears the selection overlay', (await page.evaluate(() => window.__cleared)) >= 1 && (await page.evaluate(() => app.selectionPopup)) === null);
check('no console errors', errors === 0, 'errors=' + errors);
await browser.close(); server.close();
console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
