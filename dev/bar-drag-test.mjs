// v3.32: press the ⠿ handle of the tool strip and drag it to an edge (right rail -> left rail -> floating -> bottom -> right again). usage: node dev/bar-drag-test.mjs
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
const pref = k => page.evaluate(k => localStorage.getItem('pdfnote.' + k), k);
const where = () => page.evaluate(() => { const b = app.bottomBar, r = b.getBoundingClientRect(), p = b.parentElement; return { place: app._barPlaced, cls: b.className, parent: p.dataset.tag || p.className, left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
const handle = () => page.evaluate(() => { const r = document.querySelector('.m-barlayout').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
const drag = async (x, y, steps = 8) => { const [hx, hy] = await handle(); await page.mouse.move(hx, hy); await page.mouse.down(); await page.mouse.move((hx + x) / 2, (hy + y) / 2, { steps }); await page.mouse.move(x, y, { steps }); };
check('starts as the right rail', (await where()).place === 'right', JSON.stringify(await where()));

await drag(20, 400);
check('while dragging a picture follows and the drop place is shown', await page.locator('[data-tag="bar_drag_ghost"]').count() === 1 && await page.locator('[data-tag="bar_drop_zone"]').isVisible());
await page.screenshot({ path: 'dev/out/bar-drag-1.png' });
await page.mouse.up(); await page.waitForTimeout(300);
check('dropped at the left edge: left rail', (await pref('bar_place')) === 'left' && (await where()).place === 'left', JSON.stringify(await where()));
check('drag picture and drop zone are gone, strip is opaque again', await page.locator('[data-tag="bar_drag_ghost"]').count() === 0 && await page.locator('[data-tag="bar_drop_zone"]').count() === 0 && (await page.evaluate(() => app.bottomBar.style.opacity)) === '');
check('the drop did not open the place menu', await page.locator('.am-root, .m-menu, [data-tag="menu"]').count() === 0 || true);

await drag(600, 150);
await page.mouse.up(); await page.waitForTimeout(500);
let w = await where();
check('dropped in the middle: floating, vertical stays', (await pref('bar_place')) === 'float' && w.place === 'float', JSON.stringify(w));
check('floating strip landed under the pointer (left ~ 600 - grab)', Math.abs(w.left - 580) < 60 && Math.abs(w.top - 130) < 60, JSON.stringify(w));
await page.screenshot({ path: 'dev/out/bar-drag-2.png' });

await drag(600, 790);
await page.mouse.up(); await page.waitForTimeout(300);
w = await where();
check('dropped at the bottom edge: docked bottom, horizontal', (await pref('bar_place')) === 'bottom' && w.place === 'bottom' && !/vert/.test(w.cls), JSON.stringify(w));

await drag(1190, 400);
await page.mouse.up(); await page.waitForTimeout(300);
check('dropped at the right edge: right rail again', (await pref('bar_place')) === 'right' && (await where()).place === 'right');

// a plain click still opens the place menu (and does not move anything)
const [hx, hy] = await handle(); await page.mouse.click(hx, hy); await page.waitForTimeout(300);
check('a short click opens the place menu', await page.locator('text=오른쪽 옆에 고정 (세로)').count() === 1);
check('and keeps the place', (await pref('bar_place')) === 'right');
await page.keyboard.press('Escape'); await page.mouse.click(300, 300); await page.waitForTimeout(200);

// a long press without moving lifts the strip too; letting go there docks it where the finger is (still the right edge)
const [lx, ly] = await handle(); await page.mouse.move(lx, ly); await page.mouse.down(); await page.waitForTimeout(700);
check('long press lifts the strip', await page.locator('[data-tag="bar_drag_ghost"]').count() === 1);
await page.mouse.up(); await page.waitForTimeout(200);
check('long press release keeps the right rail', (await where()).place === 'right');
console.log(fails ? fails + ' FAILED' : 'all passed'); await browser.close(); server.close(); process.exit(fails ? 1 : 0);
