// v3.32: lasso over several inserted objects: copy / cut / delete them together, paste the group. usage: node dev/lasso-objects-test.mjs
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
await page.evaluate(() => localStorage.clear());
const setup = () => page.evaluate(async () => {
  const { PageElement } = await import('/js/store.js');
  const els = app.store.elements; els.length = 0;
  for (const [l, t, txt] of [[.1, .1, 'one'], [.3, .1, 'two'], [.7, .7, 'far']]) { const e = new PageElement(); e.page = 0; e.kind = 'text'; e.text = txt; e.left = l; e.top = t; e.right = l + .15; e.bottom = t + .08; els.push(e); }
  app.redrawPages(); return els.length;
});
const lasso = () => page.evaluate(() => {
  const v = app.pageView; v.lassoPoints.length = 0; v.lassoPoints.push({ x: .05, y: .05 }, { x: .6, y: .05 }, { x: .6, y: .3 }, { x: .05, y: .3 });
  return v.lassoElements().map(e => e.text);
});
check('setup: three objects', await setup() === 3);
check('lassoElements picks the objects whose centre is inside', JSON.stringify(await lasso()) === '["one","two"]');
const panel = async () => { await page.evaluate(() => { const v = app.pageView; v.lassoPoints.length = 0; v.lassoPoints.push({ x: .05, y: .05 }, { x: .6, y: .05 }, { x: .6, y: .3 }, { x: .05, y: .3 }); app.onLassoSelectionFinished(); }); await page.waitForTimeout(300); };
await panel();
check('lasso panel offers copy / cut / delete of the picked objects', await page.locator('.m-pp-sec:has-text("선택한 개체 2개")').count() === 1 && await page.locator('.m2-ltile[aria-label="잘라내기"]').count() === 1);
await page.screenshot({ path: 'dev/out/lasso-objects.png' });
await page.locator('.m2-ltile[aria-label="복사"]').click(); await page.waitForTimeout(300);
check('copy keeps both on the page and fills the clipboard', await page.evaluate(() => app.store.elements.length === 3 && app.elementClip && app.elementClip.group.length === 2));
await page.evaluate(() => app.pasteElement({ page: 0, x: .4, y: .5 })); await page.waitForTimeout(200);
const pasted = await page.evaluate(() => app.store.elements.slice(3).map(e => [e.text, +e.left.toFixed(3), +e.top.toFixed(3)]));
check('paste puts the group back with its top-left at the spot', pasted.length === 2 && pasted[0][0] === 'one' && Math.abs(pasted[0][1] - .4) < .001 && Math.abs(pasted[0][2] - .5) < .001 && Math.abs(pasted[1][1] - .6) < .001, JSON.stringify(pasted));
await setup(); await panel();
await page.locator('.m2-ltile[aria-label="잘라내기"]').click(); await page.waitForTimeout(300);
check('cut removes them from the page', await page.evaluate(() => app.store.elements.map(e => e.text).join() === 'far'));
await page.evaluate(() => app.pasteElement()); await page.waitForTimeout(200);
check('a cut group comes back where it was', await page.evaluate(() => app.store.elements.length === 3 && Math.abs(app.store.elements[1].left - .1) < .001));
await setup(); await panel();
await page.locator('.m2-ltile[aria-label="삭제"]').click(); await page.waitForTimeout(300);
check('delete removes them', await page.evaluate(() => app.store.elements.map(e => e.text).join() === 'far'));
console.log(fails ? fails + ' FAILED' : 'all passed'); await browser.close(); server.close(); process.exit(fails ? 1 : 0);
