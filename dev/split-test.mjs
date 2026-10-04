// usage: node dev/split-test.mjs  (HWP spread detection + splitSpreads with a pdf-lib generated wide-page PDF; screenshot dev/out/split-pages.png)
import { chromium } from '/tmp/npmtest/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), web = path.resolve(here, '../web'), out = path.join(here, 'out');
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm' };
const server = http.createServer((req, rsp) => {
  const p = decodeURIComponent(req.url.split('?')[0]), f = p.startsWith('/dev/') ? path.join(here, p.slice(5)) : path.join(web, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); rsp.end('nf'); return; }
  rsp.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(rsp);
}).listen(0);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 1100, height: 500 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.addInitScript(() => { for (const C of [Map, WeakMap]) { if (!C.prototype.getOrInsertComputed) C.prototype.getOrInsertComputed = function (k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); }; if (!C.prototype.getOrInsert) C.prototype.getOrInsert = function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); }; } });
await page.goto(`http://localhost:${server.address().port}/dev/split-test.html`);
await page.waitForFunction(() => window.__R, null, { timeout: 30000 });
const R = await page.evaluate(() => window.__R);
await page.waitForTimeout(300); await page.screenshot({ path: path.join(out, 'split-pages.png') });
let fails = 0; const check = (n, ok, x = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!ok) fails++; };
check('looksLikeSpread: three 1200x800 pages -> true', R.spreadWide === true);
check('looksLikeSpread: A4 portrait / narrow landscape (<1000pt) / squarish / mixed -> false', !R.spreadA4 && !R.spreadNarrowLandscape && !R.spreadSquarish && !R.spreadMixed);
check('looksLikeSpread: /Rotate 90 portrait counts as wide; garbage bytes -> false', R.spreadRotated === true && R.spreadGarbage === false);
check('before: 4 pages', R.before.length === 4 && R.before[0].w === 1200);
check('after: 3 wide pages become 6 + the A4 page stays (7 pages, %PDF header)', R.after.length === 7 && R.header === '%PDF-', R.after.map(p => p.w + 'x' + p.h).join(' '));
check('halves are 600x800 and the portrait page is untouched', R.after.slice(0, 6).every(p => p.w === 600 && p.h === 800) && R.after[6].w === 595 && R.after[6].h === 842);
check('text kept (each half has its own words, searchable)', R.after.slice(0, 6).every((p, i) => p.text.includes((i % 2 ? 'RIGHT-' : 'LEFT-') + (Math.floor(i / 2) + 1))), R.after.slice(0, 2).map(p => p.text).join(' | '));
const L = R.after.filter((_, i) => i < 6 && i % 2 === 0), Rt = R.after.filter((_, i) => i < 6 && i % 2 === 1);
check('left pages show only the blue half, right pages only the orange half', L.every(p => p.blue > p.cw * p.ch * .8 && p.orange < 50) && Rt.every(p => p.orange > p.cw * p.ch * .8 && p.blue < 50), `L.blue=${L[0].blue} L.orange=${L[0].orange} R.orange=${Rt[0].orange} R.blue=${Rt[0].blue}`);
check('rotated pages are not split; garbage input throws (caller falls back)', R.rotatedKept === 1 && R.garbageThrows === true);
await browser.close(); server.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
