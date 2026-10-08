// v3.19: bar eraser, floating strip + shared width/colour row, real slide, curl/slide in split, spread after split, thumbnails default. usage: node dev/v319-test.mjs
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

// thumbnails: default is all pages
check('page preview default is all pages', await ev(() => app.showAllThumbnails === true && app.recentPrefs.getBoolean('thumb_all', true) === true));
// eraser next to 필기 모드 in the bottom bar
await ev(() => document.querySelector('[data-tag="reading_toolbar"] [aria-label="지우개"]').click()); await page.waitForTimeout(250);
check('bar eraser starts writing with the eraser (strip shown, no width/colour row)', await ev(() => app.writeMode && app.inkMode === 2 && app.inkOptions.style.display === 'none' && getComputedStyle(app.stripBox.parentElement).display !== 'none'));
await ev(() => app.eraserButton.click()); await ev(() => app.penButton.click()); await page.waitForTimeout(250);
check('pen: width + colour row appears under the strip', await ev(() => app.inkMode === 1 && app.inkOptions.style.display !== 'none' && app.inkOptions.querySelectorAll('.m-sw .dot').length === 17));
await page.keyboard.press('Escape'); await page.mouse.click(5, 5);
await ev(() => document.querySelectorAll('[data-tag="ink_options"] [data-tag="ink_widths"] .m-ibtn')[3].click());
check('shared width: pen gets step 4', await ev(() => app.inkWidth === 0.009));
await ev(() => app.hlButton.click()); await page.waitForTimeout(200);
check('highlighter shows its palette (5 + chip) in the same row', await ev(() => app.highlightMode && app.inkOptions.querySelectorAll('.m-sw .dot').length === 6));
await ev(() => document.querySelectorAll('[data-tag="ink_options"] [data-tag="ink_widths"] .m-ibtn')[0].click());
check('shared width: highlighter gets step 1, pen width untouched', await ev(() => app.highlightThick === 0.012 && app.inkWidth === 0.009));
// floating strip: drag the grip
await ev(() => app.penButton.click()); await page.waitForTimeout(200);
const gb = await ev(() => app.stripGrip.getBoundingClientRect().toJSON());
check('strip has a visible grip', gb.width > 10 && gb.height > 10);
await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2); await page.mouse.down(); await page.mouse.move(gb.x + 140, gb.y + 220, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
const moved = await ev(() => ({ tr: app.stripBox.style.translate, saved: app.recentPrefs.getString('strip_pos', '') , top: app.stripBox.getBoundingClientRect().top }));
check('dragging the grip moves the strip and remembers it', /px/.test(moved.tr) && moved.saved !== '' && moved.top > 150, JSON.stringify(moved));
await page.screenshot({ path: path.join(out, 'v319-strip.png') });
await ev(() => app.setWriteMode(false));
// slide: a real push-out / push-in overlay
const pages = await ev(() => app.renderer.pageCount); console.log('pageCount', pages);
await ev(() => { app.recentPrefs.putInt('page_anim_style', 1); app.showPage(0); }); await page.waitForTimeout(500);
await ev(() => app.animatePage(1)); await page.waitForTimeout(80);
check('slide: overlay with two page canvases while turning', await ev(() => !!document.querySelector('.m-slide') && document.querySelectorAll('.m-slide canvas').length === 2 && app.pageAnimating));
await page.waitForTimeout(700);
check('slide: finished, overlay gone, next page shown', await ev(() => !document.querySelector('.m-slide') && !app.pageAnimating && app.currentPage === 1));
await ev(() => app.animatePage(-1)); await page.waitForTimeout(800);
check('slide backwards returns to page 1', await ev(() => app.currentPage === 0 && !app.pageAnimating));
// split: curl and slide now work
await open('sample.pdf', 'b.pdf'); await page.waitForTimeout(1200);
await ev(() => app.switchDocument(app.sessions[0])); await page.waitForTimeout(500);
await ev(() => app.toggleSplit()); await page.waitForTimeout(1200);
for (const [style, sel] of [[1, '.m-slide'], [0, '.m-curl']]) {
  await ev(s => { app.recentPrefs.putInt('page_anim_style', s); app.showPage(0); }, style); await page.waitForTimeout(500);
  const before = await ev(() => ({ cur: app.currentPage, other: app.splitView.getPageNumber() }));
  await ev(() => app.animatePage(1)); let seen = false; for (let i = 0; i < 12 && !seen; i++) { await page.waitForTimeout(30); seen = await ev(q => !!document.querySelector(q), sel); }
  await page.waitForTimeout(1500);
  const after = await ev(() => ({ cur: app.currentPage, other: app.splitView.getPageNumber(), busy: app.pageAnimating }));
  check(`split + ${style === 1 ? 'slide' : 'curl'}: animation overlay shown, active pane turned, other pane untouched`, seen && after.cur === before.cur + 1 && after.other === before.other && !after.busy, JSON.stringify({ before, after, seen }));
}
// activate the right pane, end split with two-page view on: pages must sit side by side, not mirrored
await ev(() => app.exitSplit()); await page.waitForTimeout(300);
await ev(() => { if (!app.twoPage) app.toggleTwoPage(); }); await page.waitForTimeout(500);
await ev(() => app.toggleSplit()); await page.waitForTimeout(1200);
await ev(() => app.activateSplitPane()); await page.waitForTimeout(300);
await ev(() => app.exitSplit()); await page.waitForTimeout(1200);
const spread = await ev(() => ({ two: app.twoPage, f: app.firstPageView.el.getBoundingClientRect().toJSON(), s: app.secondPageView.el.getBoundingClientRect().toJSON(), sv: app.secondPageView.el.style.display }));
check('after split ends the spread is back: first page left of the second, both visible', spread.two && spread.f.width > 50 && spread.s.width > 50 && spread.f.left < spread.s.left, JSON.stringify(spread));
await page.screenshot({ path: path.join(out, 'v319-spread.png') });
await browser.close(); server.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
