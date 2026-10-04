// Regression test: "crop margins" must keep a consistent scale across pages. Page 2 has text only on its top ~40%; it used to get a short,
// wide crop box, became width-limited and was shown MUCH larger with its bottom margin removed.  usage: node dev/crop-test.mjs
import { chromium } from '/tmp/npmtest/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), web = path.resolve(here, '../web'), out = path.join(here, 'out');
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json' };
const server = http.createServer((req, rsp) => {
  const p = decodeURIComponent(req.url.split('?')[0]), f = p.startsWith('/dev/') ? path.join(here, p.slice(5)) : path.join(web, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); rsp.end('nf'); return; }
  rsp.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(rsp);
}).listen(0);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.addInitScript(() => { for (const C of [Map, WeakMap]) { if (!C.prototype.getOrInsertComputed) C.prototype.getOrInsertComputed = function (k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); }; if (!C.prototype.getOrInsert) C.prototype.getOrInsert = function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); }; } });
await page.goto(`http://localhost:${server.address().port}/dev/crop-test.html`);
await page.waitForFunction(() => window.READY, null, { timeout: 30000 });
let fails = 0; const check = (n, ok, x = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!ok) fails++; };
const ev = (fn, a) => page.evaluate(fn, a);
const info = () => ev(() => { const v = T.view, s = v.contentSize(), r = v.pageRect(), c = v.crop, b = v.contentBounds();
  const visTop = Math.max(0, (0 - r.top) / r.height()), visBottom = Math.min(1, (v.height - r.top) / r.height());
  return { w: s[0], h: s[1], crop: [c.left, c.top, c.right, c.bottom], bounds: [b.left, b.top, b.right, b.bottom], visTop, visBottom, pageW: r.width(), pageH: r.height(), vw: v.width, vh: v.height }; });
const f2 = a => a.map(x => +x.toFixed(3));
for (const [vw, vh] of [[900, 700], [420, 800]]) {
  await page.setViewportSize({ width: vw, height: vh }); await page.waitForTimeout(150);
  await ev(() => T.show(T.view, 0)); const a = await info(); await page.screenshot({ path: path.join(out, `crop-${vw}-p1.png`) });
  await ev(() => T.show(T.view, 1)); const b = await info(); await page.screenshot({ path: path.join(out, `crop-${vw}-p2.png`) });
  const tag = `[${vw}x${vh}] `;
  console.log(tag + 'p1 contentSize', f2([a.w, a.h]), 'crop', f2(a.crop), '| p2 contentSize', f2([b.w, b.h]), 'bounds', f2(b.bounds), 'crop', f2(b.crop));
  check(tag + 'page 2 text really occupies only the top ~half (analysis sanity)', b.bounds[3] < 0.55 && a.bounds[3] > 0.9);
  check(tag + 'page 2 contentSize ~ page 1 (consistent scale, within 8%)', Math.abs(b.w / a.w - 1) < 0.08 && Math.abs(b.h / a.h - 1) < 0.08, `ratio ${(b.w / a.w).toFixed(3)} x ${(b.h / a.h).toFixed(3)}`);
  check(tag + 'vertical crop >= 90% of the page', b.crop[3] - b.crop[1] >= 0.9 - 1e-9);
  check(tag + 'page 2 bottom is visible (view shows the page down to >= 90%)', b.visBottom >= 0.9, `visBottom=${b.visBottom.toFixed(3)}`);
  check(tag + 'page 2 is no longer than the view', b.pageH * (b.crop[3] - b.crop[1]) <= b.vh + 1);
  // zoom / pan limits still work on the clamped crop
  const z = await ev(() => { const v = T.view; v.setZoom(2.5); v.panX = 1e5; v.panY = 1e5; v.clampPan(); const r = v.pageRect(), c = v.crop; const R = { z: v.getZoom(), cropTop: r.top + c.top * r.height(), cropBottom: r.top + c.bottom * r.height(), cropLeft: r.left + c.left * r.width(), cropRight: r.left + c.right * r.width(), vw: v.width, vh: v.height };
    v.panX = -1e5; v.panY = -1e5; v.clampPan(); const r2 = v.pageRect(); R.bottomEdge = r2.top + c.bottom * r2.height(); R.rightEdge = r2.left + c.right * r2.width(); v.resetZoom(); return R; });
  check(tag + 'zoom 2.5x: panned to top/left shows the crop top/left edge; to bottom/right shows the crop bottom/right edge', z.z === 2.5 && z.cropTop >= -2 && z.cropTop <= 30 && z.cropLeft >= -2 && z.cropLeft <= 60 && z.bottomEdge >= z.vh - 30 && z.bottomEdge <= z.vh + 2 && z.rightEdge >= z.vw - 60 && z.rightEdge <= z.vw + 2, JSON.stringify(Object.fromEntries(Object.entries(z).map(([k, v]) => [k, Math.round(v * 10) / 10]))));
  // crop off -> whole page, same scale family
  await ev(() => T.show(T.view, 1, false)); const c = await info();
  check(tag + 'crop margins off: full page crop', f2(c.crop).join() === '0,0,1,1');
}
// normal content keeps the Android behaviour: page 1 crop == its content bounds
await page.setViewportSize({ width: 900, height: 700 }); await page.waitForTimeout(100);
await ev(() => T.show(T.view, 0)); const n1 = await info();
check('normal page: crop == content bounds (Android behaviour kept)', f2(n1.crop).join() === f2(n1.bounds).join(), f2(n1.crop).join() + ' vs ' + f2(n1.bounds).join());
// two-page view: union of both pages' bounds, each side keeps the same scale
await ev(() => { T.view.el.style.flex = '1 1 0'; T.view2.el.style.display = ''; });
await page.waitForTimeout(150);
await ev(async () => { await T.show(T.view, 0); await T.show(T.view2, 1); const box = T.view.contentBounds(); box.union(T.view2.contentBounds()); T.view.setCrop(box); T.view2.setCrop(box); T.view.flush(); T.view2.flush(); });
const two = await ev(() => { const a = T.view, b = T.view2; return { a: a.contentSize(), b: b.contentSize(), ca: [a.crop.top, a.crop.bottom], cb: [b.crop.top, b.crop.bottom], ra: a.pageRect().bottom, rb: b.pageRect().bottom, vh: a.height }; });
await page.screenshot({ path: path.join(out, 'crop-two-page.png') });
check('two-page view: both sides same size, shared crop >= 90% tall', Math.abs(two.a[0] - two.b[0]) < 1 && Math.abs(two.a[1] - two.b[1]) < 1 && two.ca[1] - two.ca[0] >= 0.9 - 1e-9 && two.ca.join() === two.cb.join(), JSON.stringify(two));
await browser.close(); server.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
