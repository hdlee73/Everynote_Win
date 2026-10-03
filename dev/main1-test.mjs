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
await page.evaluate(() => app.showTextSelectionPopup('Hello 안녕', 300, 300)); await shot('06-selpop');
check('no console errors', errors === 0, 'errors=' + errors);
await browser.close(); server.close();
console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
