// Playwright harness for js/pageview.js.  usage: node dev/pageview-test.mjs  (screenshots in dev/out/)
import { chromium } from '/tmp/npmtest/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), web = path.resolve(here, '../web'), out = path.join(here, 'out');
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.pdf': 'application/pdf', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, rsp) => {
  let p = decodeURIComponent(req.url.split('?')[0]), f;
  if (p.startsWith('/dev/')) f = path.join(here, p.slice(5)); else f = path.join(web, p);
  if (p === '/js/store.js' && !fs.existsSync(f)) f = path.join(here, 'stubs/store.js');   // temporary stub until the real store.js lands
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); rsp.end('nf'); return; }
  rsp.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(rsp);
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, hasTouch: true });
const page = await ctx.newPage();
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.text()); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.addInitScript(() => { // test chromium is older than WebView2: polyfill what pdf.js needs
  for (const C of [Map, WeakMap]) {
    if (!C.prototype.getOrInsertComputed) C.prototype.getOrInsertComputed = function (k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); };
    if (!C.prototype.getOrInsert) C.prototype.getOrInsert = function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); };
  }
});
await page.goto(`http://localhost:${port}/dev/pageview-test.html`);
await page.waitForFunction(() => window.READY, null, { timeout: 30000 });

let fails = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!ok) fails++; };
const shot = async n => { await page.evaluate(() => T.view.flush()); await page.screenshot({ path: path.join(out, n + '.png') }); };
const ev = (fn, arg) => page.evaluate(fn, arg);
const logOf = async name => (await ev(n => T.log.filter(l => l.n === n).length, name));
const clearLog = () => ev(() => { T.log.length = 0; });

// --- synthetic pointer events -----------------------------------------------------------------------------
async function ptr(type, x, y, o = {}) {
  await page.evaluate(([type, x, y, o]) => {
    const el = T.view.el, r = el.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, pointerId: o.id ?? 1, pointerType: o.type ?? 'pen', clientX: r.left + x, clientY: r.top + y,
      pressure: o.pressure ?? (type === 'pointerup' ? 0 : 0.5), buttons: o.buttons ?? (type === 'pointerup' ? 0 : 1), button: o.button ?? 0, isPrimary: o.primary ?? true, width: 1, height: 1 };
    el.dispatchEvent(new PointerEvent(type, init));
  }, [type, x, y, o]);
}
async function drag(pts, o = {}, delay = 0) {
  await ptr('pointerdown', pts[0][0], pts[0][1], { ...o, pressure: pts[0][2] ?? o.pressure });
  for (const p of pts.slice(1, -1)) { await ptr('pointermove', p[0], p[1], { ...o, pressure: p[2] ?? o.pressure }); if (delay) await page.waitForTimeout(delay); }
  const l = pts[pts.length - 1]; await ptr('pointermove', l[0], l[1], { ...o, pressure: l[2] ?? o.pressure });
  await ptr('pointerup', l[0], l[1], o);
}
const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);

const R = await ev(() => { const r = T.view.pageRect(); return { l: r.left, t: r.top, w: r.width(), h: r.height() }; });
console.log('pageRect', R);
const px = fx => R.l + fx * R.w, py = fy => R.t + fy * R.h;
check('pageRect fits view', R.w > 300 && R.h > 300 && Math.abs(R.l + R.w / 2 - 450) < 1);
const b = await ev(() => { const r = T.view.contentBounds(); return [r.left, r.top, r.right, r.bottom]; });
check('contentBounds sane', b[2] > b[0] && b[3] > b[1] && b[0] >= 0 && b[2] <= 1, JSON.stringify(b.map(v => +v.toFixed(3))));
check('paperColor white', (await ev(() => T.view.paperColor())) === -1);
await shot('01-page');

// --- pen stroke with pressure ---------------------------------------------------------------------------
await ev(() => T.view.setInkTool(1, 0xFF007AFF | 0, 0.004));
await clearLog();
await drag(Array.from({ length: 30 }, (_, i) => [px(0.2) + i * 8, py(0.15) + Math.sin(i / 3) * 20, 0.1 + i / 30 * 0.9]), { type: 'pen' });
check('pen stroke stored', (await ev(() => T.store.strokes.length)) === 1);
check('pen onInkChanged', (await logOf('onInkChanged')) === 1);
const pr = await ev(() => T.store.strokes[0].points.map(p => +p.pressure.toFixed(2)));
check('pen pressure varies', pr[0] < 0.3 && pr[pr.length - 1] > 0.8, pr.slice(0, 3) + '...' + pr.slice(-2));
// finger does not draw without fingerInk
await drag(line(px(0.2), py(0.3), px(0.6), py(0.3)), { type: 'touch', id: 2 });
check('finger no ink by default', (await ev(() => T.store.strokes.length)) === 1);
await ev(() => T.view.setFingerInk(true));
await drag(line(px(0.2), py(0.3), px(0.6), py(0.32), 8), { type: 'touch', id: 3 });
const fp = await ev(() => T.store.strokes[1] && T.store.strokes[1].points[0].pressure);
check('finger ink (0.65)', (await ev(() => T.store.strokes.length)) === 2 && fp === 0.65);
await ev(() => T.view.setFingerInk(false));
// straight line
await ev(() => T.view.setInkTool(3, 0xFFFF3B30 | 0, 0.0065));
await drag(line(px(0.2), py(0.4), px(0.7), py(0.45), 10), { type: 'pen' });
check('straight line 2 points', (await ev(() => T.store.strokes[2].points.length)) === 2);
// highlight-colored thick pen with alpha
await ev(() => T.view.setInkTool(1, 0x80FF9500 | 0, 0.009));
await drag(line(px(0.2), py(0.5), px(0.7), py(0.55), 14), { type: 'pen' });
await shot('02-pen');
// undo hook = host splices store and invalidates
await ev(() => { T.store.strokes.pop(); T.view.invalidate(); });
check('undo via store+invalidate', (await ev(() => T.store.strokes.length)) === 3);
// eraser (inkMode 2)
await ev(() => T.view.setInkTool(2, 0xFF1C1C1E | 0, 0.004));
await clearLog();
await drag(line(px(0.3), py(0.3) - 5, px(0.35), py(0.3) - 5, 4), { type: 'pen' });
check('eraser removes stroke', (await ev(() => T.store.strokes.length)) === 2 && (await logOf('onInkChanged')) >= 1);
// pen eraser tip in pen mode
await ev(() => T.view.setInkTool(1, 0xFF1C1C1E | 0, 0.004));
const p0 = await ev(() => { const s = T.store.strokes[0].points[Math.min(3, T.store.strokes[0].points.length - 1)]; return [s.x, s.y]; });
await drag([[px(p0[0]), py(p0[1])], [px(p0[0]) + 1, py(p0[1])]], { type: 'pen', buttons: 32, button: 5 });
check('pen eraser tip erases in pen mode', (await ev(() => T.store.strokes.length)) === 1);
// barrel button = temporary eraser
await drag(line(px(0.2), py(0.6), px(0.5), py(0.6), 8), { type: 'pen' });
const p1 = await ev(() => { const s = T.store.strokes[1].points[2]; return [s.x, s.y]; });
await drag([[px(p1[0]), py(p1[1])], [px(p1[0]) + 1, py(p1[1])]], { type: 'pen', buttons: 3 });
check('barrel button erases', (await ev(() => T.store.strokes.length)) === 1);
await ev(() => { T.store.strokes.length = 0; T.view.invalidate(); });
await ev(() => T.view.setInkTool(0, 0xFF1C1C1E | 0, 0.004));

// --- highlight drag --------------------------------------------------------------------------------------
await ev(() => T.view.setHighlightMode(true, 0x66FFEB3B | 0));
await clearLog();
await drag(line(px(0.15), py(0.2), px(0.6), py(0.2), 8), { type: 'touch', id: 4 });
check('highlight onHighlightCreated', (await logOf('onHighlightCreated')) === 1);
const hm = await ev(() => { const l = T.log.find(l => l.n === 'onHighlightCreated'); const m = l.a[0]; T.store.marks.push(m); T.view.invalidate(); return [m.left, m.top, m.right, m.bottom, m.color, m.page]; });
check('highlight rect', Math.abs(hm[0] - 0.15) < 0.01 && Math.abs(hm[2] - 0.6) < 0.01 && hm[3] - hm[1] > 0.015 && hm[3] - hm[1] < 0.03, JSON.stringify(hm.map(v => +v.toFixed(3))));
await ev(() => T.view.setHighlightMode(false));

// --- memo + outline ---------------------------------------------------------------------------------------
await ev(() => T.view.setMemoMode(true)); await clearLog();
await drag([[px(0.3), py(0.5)], [px(0.3), py(0.5)]], { type: 'touch', id: 5 });
const mp = await ev(() => T.log.find(l => l.n === 'onMemoPointRequested')?.a);
check('onMemoPointRequested', mp && Math.abs(mp[1] - 0.3) < 0.01 && Math.abs(mp[2] - 0.5) < 0.01, JSON.stringify(mp));
await ev(() => T.view.setMemoMode(false)); await ev(() => T.view.setOutlineMode(true)); await clearLog();
await drag([[px(0.4), py(0.6)], [px(0.4), py(0.6)]], { type: 'touch', id: 6 });
check('onOutlinePointRequested', (await logOf('onOutlinePointRequested')) === 1);
await ev(() => T.view.setOutlineMode(false));
// memo mark sticky + tap
await ev(() => { const m = new T.Mark(); m.page = 0; m.left = .25; m.right = .3; m.top = .55; m.bottom = .6; m.noteOnly = true; m.note = '메모 테스트 문장입니다 hello world'; T.store.marks.push(m); T.view.invalidate(); });
await shot('03-memo');
await clearLog();
const box = await ev(() => { const m = T.store.marks[T.store.marks.length - 1]; const b = T.view.memoHitBoxes.get(m); return [b.left + 10, b.top + 10]; });
await drag([box, box], { type: 'touch', id: 7 });
check('onMarkTapped on memo sticky', (await logOf('onMarkTapped')) === 1);

// --- text selection ---------------------------------------------------------------------------------------
const nreg = await ev(() => T.view.textRegions.length);
check('text regions loaded', nreg > 20, 'n=' + nreg);
const r0 = await ev(() => T.view.textRegions.slice(0, 40).map(r => r.word));
console.log('first words:', r0.join(' | '));
// direct mode: stylus drag from word 2 to word 8
await ev(() => { T.store.marks.length = 0; T.view.invalidate(); });
await ev(() => T.view.setDirectTextSelection(true)); await clearLog();
const wb = i => ev(i => { const d = T.view.pageRect(), b = T.view.textRegions[i].wordBounds; return [d.left + b.centerX() * d.width(), d.top + b.centerY() * d.height()]; }, i);
const a = await wb(2), z = await wb(8);
await drag(line(a[0], a[1], z[0], z[1], 6), { type: 'pen' });
const sel = await ev(() => T.log.find(l => l.n === 'onTextSelectionFinished')?.a[0]);
const expect = (await ev(() => T.view.textRegions.slice(2, 9).map(r => r.word))).join(' ');
check('direct drag selects words 2..8', sel && sel.text === expect, JSON.stringify(sel && sel.text));
await shot('04-selection');
// handle drag: grab right handle and extend to word 12
const end = await ev(() => { const d = T.view.pageRect(), l = T.view.selectedTextRegions; const b = l[l.length - 1].wordBounds; return [d.left + b.right * d.width(), d.top + b.bottom * d.height()]; });
const w12 = await wb(12); await clearLog();
await drag(line(end[0], end[1], w12[0], w12[1], 5), { type: 'touch', id: 8 });
const sel2 = await ev(() => T.log.find(l => l.n === 'onTextSelectionFinished')?.a[0]);
const expect2 = (await ev(() => T.view.textRegions.slice(2, 13).map(r => r.word))).join(' ');
check('handle drag extends selection', sel2 && sel2.text === expect2, JSON.stringify(sel2 && sel2.text));
await ev(() => T.view.setDirectTextSelection(false));
// long press by finger
await ev(() => T.view.clearTextSelectionOverlay()); await clearLog();
const w5 = await wb(5);
await ptr('pointerdown', w5[0], w5[1], { type: 'touch', id: 9 });
await page.waitForTimeout(550);
await ptr('pointerup', w5[0], w5[1], { type: 'touch', id: 9 });
const sel3 = await ev(() => T.log.find(l => l.n === 'onTextSelectionFinished')?.a[0]);
check('finger long press selects one word', sel3 && sel3.singleWord && sel3.text === r0[5], JSON.stringify(sel3 && sel3.text));
await ev(() => T.view.clearTextSelectionOverlay());
// blank long press
await clearLog();
await ptr('pointerdown', px(0.9), py(0.95), { type: 'touch', id: 10 });
await page.waitForTimeout(800);
await ptr('pointerup', px(0.9), py(0.95), { type: 'touch', id: 10 });
const bl = await ev(() => T.log.find(l => l.n === 'onBlankLongPress')?.a);
check('onBlankLongPress', bl && bl[0] === 0 && Math.abs(bl[1] - 0.9) < 0.01, JSON.stringify(bl && bl.map(v => +v.toFixed?.(3) ?? v)));

// --- lasso -----------------------------------------------------------------------------------------------
await ev(() => T.view.setLassoMode(true)); await clearLog();
const lt = await wb(0), lb = await wb(10);
await drag([[lt[0] - 20, lt[1] - 20], [lb[0] + 60, lt[1] - 20], [lb[0] + 60, lb[1] + 20], [lt[0] - 20, lb[1] + 20], [lt[0] - 20, lt[1] - 18]], { type: 'pen' });
check('free lasso finished', (await logOf('onLassoSelectionFinished')) === 1);
const lasso = await ev(() => ({ text: T.view.lassoText(), cap: T.view.captureLasso() && [T.view.captureLasso().width, T.view.captureLasso().height] }));
check('lassoText has words', lasso.text.length > 5, JSON.stringify(lasso.text));
check('captureLasso bitmap', lasso.cap && lasso.cap[0] > 20, JSON.stringify(lasso.cap));
await shot('05-lasso');
await ev(() => T.view.setLassoShape(1)); await clearLog();
await drag(line(px(0.1), py(0.1), px(0.5), py(0.3), 6), { type: 'pen' });
check('rect lasso 4 points', (await ev(() => T.view.lassoPoints.length)) === 4 && (await logOf('onLassoSelectionFinished')) === 1);
await ev(() => T.view.setLassoShape(2)); await clearLog();
await drag(line(px(0.1), py(0.1), px(0.5), py(0.3), 6), { type: 'pen' });
check('ellipse lasso 72 points', (await ev(() => T.view.lassoPoints.length)) === 72);
await shot('06-ellipse-lasso');
await ev(() => { T.view.setLassoShape(0); T.view.setLassoMode(false); });

// --- pinch zoom -------------------------------------------------------------------------------------------
await clearLog();
const cx = 450, cy = 350;
await ptr('pointerdown', cx - 80, cy, { type: 'touch', id: 21, primary: true });
await ptr('pointerdown', cx + 80, cy, { type: 'touch', id: 22, primary: false });
for (let i = 1; i <= 10; i++) { const s = 80 + i * 14; await ptr('pointermove', cx - s, cy, { type: 'touch', id: 21 }); await ptr('pointermove', cx + s, cy, { type: 'touch', id: 22, primary: false }); }
await ptr('pointerup', cx - 220, cy, { type: 'touch', id: 21 }); await ptr('pointerup', cx + 220, cy, { type: 'touch', id: 22, primary: false });
const sc = await ev(() => T.view.scale);
check('pinch zoom scale > 1.5', sc > 1.5 && sc <= 4, 'scale=' + sc.toFixed(2));
check('onZoomGestureStarted', (await logOf('onZoomGestureStarted')) === 1);
await shot('07-zoomed');
// pan with damping
const pan0 = await ev(() => [T.view.panX, T.view.panY]);
await drag(line(450, 350, 450 + 100, 350 + 60, 8), { type: 'touch', id: 23 });
const pan1 = await ev(() => [T.view.panX, T.view.panY]);
check('pan moves (damped 0.8)', Math.abs(pan1[0] - pan0[0]) > 20 && Math.abs(pan1[0] - pan0[0]) < 100, JSON.stringify([pan0, pan1].map(a => a.map(v => +v.toFixed(1)))));
// wheel ctrl zoom
await page.mouse.move(450, 350); await page.keyboard.down('Control'); await page.mouse.wheel(0, 400); await page.keyboard.up('Control');
await page.waitForTimeout(50);
check('ctrl+wheel zoom out', (await ev(() => T.view.scale)) < sc);
await ev(() => T.show(0));
check('showPage resets scale', (await ev(() => T.view.scale)) === 1);

// --- page swipe -------------------------------------------------------------------------------------------
await ev(() => T.view.setPageSwipeEnabled(true)); await clearLog();
await drag(line(px(0.8), py(0.5), px(0.2), py(0.52), 8), { type: 'touch', id: 31 });
const swp = await ev(() => T.log.filter(l => l.n === 'onPageSwipe').map(l => l.a[0]));
check('swipe left -> onPageSwipe(+1)', swp.length === 1 && swp[0] === 1, JSON.stringify(swp));
await clearLog();
await drag(line(px(0.2), py(0.5), px(0.8), py(0.5), 8), { type: 'touch', id: 32 });
check('swipe right -> onPageSwipe(-1)', (await ev(() => T.log.filter(l => l.n === 'onPageSwipe').map(l => l.a[0])))[0] === -1);
// stylus never swipes
await clearLog();
await drag(line(px(0.8), py(0.5), px(0.2), py(0.5), 8), { type: 'pen' });
check('stylus does not swipe', (await logOf('onPageSwipe')) === 0);
// vertical
await ev(() => T.view.setVerticalPageSwipe(true)); await clearLog();
await drag(line(px(0.5), py(0.8), px(0.5), py(0.3), 8), { type: 'touch', id: 33 });
check('vertical swipe up -> +1', (await ev(() => T.log.filter(l => l.n === 'onPageSwipe').map(l => l.a[0])))[0] === 1);
await ev(() => T.view.setVerticalPageSwipe(false));
// page drag hook
await ev(() => { T.pd = []; T.view.setPageDrag({ start: d => { T.pd.push(['start', d]); return true; }, move: x => T.pd.push(['move', Math.round(x)]), end: v => T.pd.push(['end', Math.round(v)]), touchAt: f => T.pd.push(['touch', +f.toFixed(2)]) }); });
await clearLog();
await drag(line(px(0.8), py(0.7), px(0.3), py(0.7), 10), { type: 'touch', id: 34 }, 10);
const pd = await ev(() => T.pd);
check('page drag start/move/end', pd[0][0] === 'start' && pd[0][1] === 1 && pd.some(p => p[0] === 'move' && p[1] > 100) && pd[pd.length - 1][0] === 'end', JSON.stringify(pd.slice(0, 4)) + '...' + JSON.stringify(pd[pd.length - 1]));
check('no onPageSwipe when drag handled', (await logOf('onPageSwipe')) === 0);
await ev(() => T.view.setPageDrag(null)); await ev(() => T.view.setPageSwipeEnabled(false));

// --- crop -------------------------------------------------------------------------------------------------
await ev(() => { const r = T.view.contentBounds(); T.view.setCrop(r); T.view.flush(); });
const R2 = await ev(() => { const r = T.view.pageRect(); return { w: r.width(), h: r.height() }; });
check('crop enlarges page rect', R2.w > R.w * 1.05, `w ${R.w.toFixed(0)} -> ${R2.w.toFixed(0)}`);
await shot('08-crop');
await ev(() => T.view.setCrop(null));

// --- element select / move / resize -------------------------------------------------------------------------
await ev(() => { const e = new (T.store.elements.constructor === Array ? Object : Object)(); });
await ev(async () => {
  const { PageElement } = await import('/js/store.js');
  const e = new PageElement(); e.page = 0; e.kind = 'shape'; e.text = 'rect|FF007AFF|2200AAFF|3'; e.left = .5; e.top = .6; e.right = .8; e.bottom = .75; T.store.elements.push(e); T.el = e; T.view.invalidate();
});
await clearLog();
await drag([[px(.6), py(.65)], [px(.6), py(.65)]], { type: 'touch', id: 41 });
check('tap selects shape', (await ev(() => T.view.selectedElement() === T.el)));
await shot('09-element-selected');
await drag(line(px(.6), py(.65), px(.5), py(.55), 6), { type: 'touch', id: 42 });
const moved = await ev(() => [T.el.left, T.el.top, T.el.right, T.el.bottom].map(v => +v.toFixed(3)));
check('element moved', moved[0] < 0.45 && Math.abs((moved[2] - moved[0]) - 0.3) < 0.001 && (await logOf('onInkChanged')) === 1, JSON.stringify(moved));
await drag(line(px(moved[2]), py(moved[3]), px(moved[2]) + 60, py(moved[3]) + 40, 6), { type: 'touch', id: 43 });
const rs = await ev(() => [T.el.left, T.el.top, T.el.right, T.el.bottom].map(v => +v.toFixed(3)));
check('element resized (BR corner)', rs[2] > moved[2] + 0.03, JSON.stringify(rs));
await shot('10-element-resized');
await ev(() => T.view.selectElement(null));

// --- dark page, snapshot -----------------------------------------------------------------------------------
await ev(() => T.view.setDarkPage(true));
await shot('11-dark');
const snap = await ev(() => { const c = T.view.snapshot(true, 1); return [c.width, c.height, c.getContext('2d').getImageData(2, 2, 1, 1).data.join(',')]; });
check('snapshot dark size+bg', snap[0] === 900 && snap[1] === 700 && snap[2].startsWith('0,0,0'), JSON.stringify(snap));
await ev(() => T.view.setDarkPage(false));
const cpb = await ev(() => { const c = T.view.copyPageBitmap(); return [c.width, c.height]; });
check('copyPageBitmap', cpb[0] > 100);
check('getPageNumber', (await ev(() => T.view.getPageNumber())) === 0);
await ev(() => T.view.clearPage());
check('clearPage -> empty rect', (await ev(() => T.view.pageRect().isEmpty())));

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
await browser.close(); server.close(); process.exit(fails ? 1 : 0);
