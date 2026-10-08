// v3.15: split screen (two documents side by side), palm rejection / pen pressure, partial eraser, clear page. usage: node dev/pane-erase-test.mjs
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
await ev(() => app.setWriteMode(true)); await page.waitForTimeout(200);

// ---- helpers: synthetic pointer events on the active view
const send = (type, x, y, o = {}) => page.evaluate(([type, x, y, o]) => {
  const el = (o.pane === 'split' ? app.splitView : app.firstPageView).el, r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: o.id ?? 1, pointerType: o.type ?? 'pen', clientX: r.left + x, clientY: r.top + y,
    pressure: o.pressure ?? (type === 'pointerup' ? 0 : 0.5), buttons: o.buttons ?? (type === 'pointerup' ? 0 : 1), button: 0, isPrimary: o.primary ?? true, width: o.w ?? 1, height: o.h ?? 1 }));
}, [type, x, y, o]);
const geom = () => ev(() => { const r = app.pageView.contentRect(); return { l: r.left, t: r.top, w: r.width(), h: r.height() }; });
const strokes = () => ev(() => app.store.strokes.map(s => ({ page: s.page, n: s.points.length, w: s.width, color: s.color, pen: s.pen, p: s.points.map(q => +q.pressure.toFixed(3)), x0: s.points[0].x, x1: s.points[s.points.length - 1].x })));

// ---- 2. pen pressure + palm rejection
await ev(() => app.setInkMode(1)); let g = await geom();
await send('pointerdown', g.l + 100, g.t + 100, { pressure: 0.2 });
await send('pointermove', g.l + 140, g.t + 100, { pressure: 0.9 });
await send('pointermove', g.l + 180, g.t + 100, { pressure: 0.5 });
check('palm during pen stroke: touch pointerdown is ignored', true);
await send('pointerdown', g.l + 300, g.t + 300, { type: 'touch', id: 5, w: 70, h: 70, pressure: 0.5 });
await send('pointerdown', g.l + 320, g.t + 300, { type: 'touch', id: 6, w: 8, h: 8, pressure: 0.5 });   // a small touch while the pen is down: also ignored (pen guard)
check('pen stroke survives a palm: still one pointer, stroke active', await ev(() => app.firstPageView._ptrs.length === 1 && !!app.firstPageView.activeStroke));
check('no pinch zoom from palm + pen', await ev(() => app.firstPageView.scale === 1 && !app.firstPageView.scaleDetector.isInProgress()));
await send('pointermove', g.l + 220, g.t + 100, { pressure: 0.7 });
await send('pointerup', g.l + 220, g.t + 100, {});
let s = await strokes();
check('pen pressure stored per point (0.2 / 0.9 / 0.5 / 0.7)', s.length === 1 && s[0].p.includes(0.2) && s[0].p.includes(0.9) && s[0].p.includes(0.7), JSON.stringify(s[0] && s[0].p));
await send('pointerdown', g.l + 300, g.t + 400, { type: 'touch', id: 7, w: 8, h: 8 }); await send('pointerup', g.l + 300, g.t + 400, { type: 'touch', id: 7 });
check('touch right after the pen lifted (<500 ms) is ignored', await ev(() => app.firstPageView._ptrs.length === 0));
await ev(() => app.firstPageView.setFingerInk(true)); await page.waitForTimeout(650);
await send('pointerdown', g.l + 300, g.t + 150, { type: 'touch', id: 8, w: 90, h: 90 });
check('large-contact (palm) touch is ignored in write mode', await ev(() => app.firstPageView._ptrs.length === 0));
await send('pointerdown', g.l + 300, g.t + 150, { type: 'touch', id: 9, w: 10, h: 10 });
check('a normal finger works again after the guard time (finger ink on)', await ev(() => app.firstPageView._ptrs.length === 1));
await send('pointerup', g.l + 300, g.t + 150, { type: 'touch', id: 9 });
await ev(() => { app.firstPageView.setFingerInk(false); app.store.strokes.length = 0; app.pageView.invalidate(); });
// mouse: constant pressure 0.65
await page.waitForTimeout(100);
const vb = await ev(() => app.firstPageView.el.getBoundingClientRect().toJSON());
await page.mouse.move(vb.left + g.l + 100, vb.top + g.t + 120); await page.mouse.down(); await page.mouse.move(vb.left + g.l + 160, vb.top + g.t + 120, { steps: 5 }); await page.mouse.up();
s = await strokes();
check('mouse stroke has constant pressure 0.65', s.length === 1 && s[0].p.every(p => p === 0.65), JSON.stringify(s));

// ---- 4/5. eraser: partial vs whole, clear page
await ev(() => { app.store.strokes.length = 0; });
const addLine = () => ev(() => { const { InkStroke, InkPoint } = window.__ink; const st = new InkStroke(); st.page = app.currentPage; st.color = 0xFFFF0000 | 0; st.width = 0.004; st.pen = 2; for (let i = 0; i <= 20; i++) st.points.push(new InkPoint(0.2 + i * 0.03, 0.5, 0.3 + i * 0.03)); app.store.strokes.push(st); app.pageView.invalidate(); });
await ev(async () => { window.__ink = await import('/js/store.js'); });
await addLine();
await ev(() => { app.recentPrefs.putInt('eraser_mode', 1); app.applyEraserRadius(); app.setInkMode(2); });
g = await geom();
const cx = g.l + g.w * 0.5, cy = g.t + g.h * 0.5, vr = { left: 0, top: 0 };   // local view coordinates
await send('pointerdown', cx - vr.left, cy - vr.top, { type: 'mouse' }); await send('pointerup', cx - vr.left, cy - vr.top, { type: 'mouse' });
s = await strokes();
const r = await ev(() => app.firstPageView.eraserRadius);
check('partial eraser: one tap splits the stroke into two sub-strokes', s.length === 2, JSON.stringify(s.map(x => x.n)));
check('sub-strokes keep colour / width / pen and per-point pressure', s.length === 2 && s.every(x => x.color === (0xFFFF0000 | 0) && x.w === 0.004 && x.pen === 2 && x.p.every(p => p >= 0.3 - 1e-6 && p <= 0.9 + 1e-6)), JSON.stringify(s.map(x => [x.color, x.w, x.pen, x.p[0], x.p[x.p.length - 1]])));
const gapPx = s.length === 2 ? (s[1].x0 - s[0].x1) * g.w : 0;
check('cut width ~ eraser diameter (' + (r * 2) + 'px)', Math.abs(gapPx - 2 * r) < Math.max(6, r * 0.5), gapPx.toFixed(1) + 'px');
// drag across the rest: everything under the path disappears, the far ends survive
await send('pointerdown', cx - vr.left - 60, cy - vr.top, { type: 'mouse' });
await send('pointermove', cx - vr.left - 160, cy - vr.top, { type: 'mouse' }); await send('pointerup', cx - vr.left - 160, cy - vr.top, { type: 'mouse' });
s = await strokes();
check('swept erase removes the middle part of the left piece', s.length >= 1 && s.every(x => x.n >= 2), JSON.stringify(s.map(x => [x.n, +x.x0.toFixed(2), +x.x1.toFixed(2)])));
check('eraser circle drawn while partial mode', await ev(() => { const v = app.firstPageView; return v.eraserMode === 1 && v.inkMode === 2; }));
// whole-stroke mode
await ev(() => { app.store.strokes.length = 0; }); await addLine();
await ev(() => { app.recentPrefs.putInt('eraser_mode', 0); app.applyEraserRadius(); });
await send('pointerdown', cx - vr.left, cy - vr.top, { type: 'mouse' }); await send('pointerup', cx - vr.left, cy - vr.top, { type: 'mouse' });
check('stroke mode removes the whole stroke', (await strokes()).length === 0);
// pen eraser end in partial mode
await ev(() => { app.recentPrefs.putInt('eraser_mode', 1); app.applyEraserRadius(); app.setInkMode(1); }); await addLine();
await send('pointerdown', cx - vr.left, cy - vr.top, { type: 'pen', buttons: 32 }); await send('pointerup', cx - vr.left, cy - vr.top, { type: 'pen' });
check('pen eraser end / button follows partial mode', (await strokes()).length === 2);
// eraser menu: mode switch + clear page
await ev(() => { app.setInkMode(2); app.showEraserMenu(app.eraserButton); }); await page.waitForTimeout(250);
check('eraser menu has 획 지우기 / 부분 지우기 chips + clear button', await ev(() => { const m = document.querySelector('[data-tag="eraser_mode"]'); return !!m && /획 지우기/.test(m.textContent) && /부분 지우기/.test(m.textContent) && !!document.querySelector('[data-tag="eraser_clear_page"]'); }));
await page.click('[data-tag="eraser_mode"] .chip:first-child'); await page.waitForTimeout(100);
check('mode choice persisted (eraser_mode=0) and applied to views', await ev(() => app.recentPrefs.getInt('eraser_mode', -1) === 0 && app.firstPageView.eraserMode === 0));
await page.click('[data-tag="eraser_clear_page"]'); await page.waitForTimeout(300);
check('clear page asks for confirmation first', await ev(() => !!document.querySelector('.ad-root')) && (await strokes()).length === 2);
await page.screenshot({ path: path.join(out, 'pane-erase-confirm.png') });
await page.getByText('모두 지우기', { exact: true }).click(); await page.waitForTimeout(300);
check('clear page removes all ink of the page', (await strokes()).length === 0);
await ev(() => app.undoInk());
check('undo brings the cleared page back', (await strokes()).length === 2);

// ---- 1. split screen
await ev(() => { app.store.strokes.length = 0; app.setWriteMode(false); });
await ev(() => app.toggleSplit()); await page.waitForTimeout(300);
check('one document: split offers to open a second one (dialog)', await ev(() => !!document.querySelector('.ad-root')) && !(await ev(() => app.isSplit())));
await page.keyboard.press('Escape'); await page.getByText('취소', { exact: true }).click().catch(() => {}); await page.waitForTimeout(200);
await open('sample.pdf', 'b.pdf'); await page.waitForTimeout(1200);
await ev(() => app.switchDocument(app.sessions[0])); await page.waitForTimeout(500);
await ev(() => app.toggleSplit()); await page.waitForTimeout(1200);
check('split on: two panes visible side by side', await ev(() => { const a = app.firstPageView.el.getBoundingClientRect(), b = app.splitView.el.getBoundingClientRect(); return app.isSplit() && a.width > 300 && b.width > 300 && Math.abs(a.top - b.top) < 2 && b.left >= a.right - 1; }));
const names = () => ev(() => ({ active: app.activeSession.title, other: app.splitSession.title, chips: [...document.querySelectorAll('.m-panename')].map(e => e.textContent), left: app.firstPageView.el.style.order, bm: !!app.splitView.bitmap }));
let nm = await names(); check('pane chips list both documents; passive pane rendered', nm.chips.length === 2 && nm.bm && nm.active !== nm.other, JSON.stringify(nm));
await page.screenshot({ path: path.join(out, 'pane-split.png') });
// write in the right pane with the mouse: it becomes active, the stroke lands in ITS document
const rb = await ev(() => app.splitView.el.getBoundingClientRect().toJSON());
await ev(() => { app.setWriteMode(true); app.setInkMode(1); });
const before = await ev(() => app.activeSession.title);
await page.mouse.move(rb.left + rb.width / 2 - 40, rb.top + 300); await page.mouse.down(); await page.mouse.move(rb.left + rb.width / 2 + 60, rb.top + 320, { steps: 6 }); await page.mouse.up();
const after = await ev(() => ({ active: app.activeSession.title, strokesActive: app.store.strokes.length, other: app.splitSession.title, strokesOther: app.splitSession.store.strokes.length, pv: app.pageView === app.firstPageView }));
check('touching the other pane activates it and writes into its own document', after.active !== before && after.strokesActive === 1 && after.strokesOther === 0 && after.pv, JSON.stringify(after));
// and back
const lb = await ev(() => app.splitView.el.getBoundingClientRect().toJSON());
await page.mouse.move(lb.left + 120, lb.top + 200); await page.mouse.down(); await page.mouse.move(lb.left + 220, lb.top + 220, { steps: 6 }); await page.mouse.up();
const back = await ev(() => ({ active: app.activeSession.title, a: app.store.strokes.length, o: app.splitSession.store.strokes.length }));
check('touching the first pane again writes into the first document', back.active === before && back.a === 1 && back.o === 1, JSON.stringify(back));
// per-pane page + zoom
await ev(() => app.showPage(1)); await page.waitForTimeout(500);
await ev(() => app.zoomTo(2));
const pz = await ev(() => ({ a: app.currentPage, az: app.firstPageView.scale, bz: app.splitView.scale, bp: app.splitView.getPageNumber(), bs: app.splitSession.page }));
check('each pane has its own page and zoom', pz.a === 1 && pz.az === 2 && pz.bz === 1 && pz.bp === 0, JSON.stringify(pz));
await page.screenshot({ path: path.join(out, 'pane-split-2.png') });
// swap + pick
const l0 = await ev(() => document.querySelector('.m-panename').textContent);
await ev(() => app.swapSplitPanes());
check('swap exchanges left/right', (await ev(() => document.querySelector('.m-panename').textContent)) !== l0);
{ // v3.18: draggable divider changes the two widths; zoom stays per pane
  const box = await page.locator('[data-tag=split_divider]').boundingBox(); const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 150, y, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(400);
  const wd = await ev(() => { const a = app.firstPageView.el.getBoundingClientRect().width, b = app.splitView.el.getBoundingClientRect().width; return { l: Math.min(a, b) === a ? a : b, saved: app.recentPrefs.getFloat('split_ratio', 0) }; });
  const ws = await ev(() => [app.firstPageView.el, app.splitView.el].map(e => ({ x: e.getBoundingClientRect().left, w: e.getBoundingClientRect().width })).sort((p, q) => p.x - q.x));
  check('divider drag: left pane wider than right, ratio saved', ws[0].w > ws[1].w + 100 && wd.saved > 0.55 && wd.saved <= 0.8, JSON.stringify({ ws, saved: wd.saved }));
  await page.locator('[data-tag=split_divider]').dblclick(); await page.waitForTimeout(300);
  const ws2 = await ev(() => [app.firstPageView.el, app.splitView.el].map(e => e.getBoundingClientRect().width));
  check('divider double click: equal widths again', Math.abs(ws2[0] - ws2[1]) < 6);
}
await ev(() => app.exitSplit()); await page.waitForTimeout(500);
check('exit: one pane again, active document kept', await ev(() => !app.isSplit() && getComputedStyle(app.splitView.el).display === 'none' && app.firstPageView.el.getBoundingClientRect().width > 700));
await ev(() => app.enterSplit(app.sessions.find(x => x !== app.activeSession))); await page.waitForTimeout(600);
await ev(() => app.closeDocument(app.splitSession)); await page.waitForTimeout(400);
check('closing a split document ends the split', await ev(() => !app.isSplit() && app.sessions.length === 1));
await browser.close(); server.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
