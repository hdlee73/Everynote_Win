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
let lastPen = 0;   // palm rejection (v3.15): a touch right after the pen is ignored, so wait out the 500 ms guard like a real hand would
async function ptr(type, x, y, o = {}) {
  if ((o.type ?? 'pen') === 'pen') lastPen = Date.now();
  else if (type === 'pointerdown') { const w = lastPen + 540 - Date.now(); if (w > 0) await page.waitForTimeout(w); }
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

// --- v1.30.0 freehand highlight + thickness ---------------------------------------------------------------
await ev(() => { T.view.setHighlightStyle(false, 0.05); });
check('setHighlightStyle clamps (.006..0.08)', await ev(() => { T.view.setHighlightStyle(true, 0.5); const hi = T.view.highlightThick; T.view.setHighlightStyle(true, 0.001); const lo = T.view.highlightThick; T.view.setHighlightStyle(false, 0.022); return hi === 0.08 && lo === 0.006; }));
await ev(() => { T.view.setHighlightStyle(false, 0.05); T.view.setHighlightMode(true, 0x66FFEB3B | 0); }); await clearLog();
await drag(line(px(0.15), py(0.25), px(0.6), py(0.25), 8), { type: 'touch', id: 7 });
const th = await ev(() => { const m = T.log.filter(l => l.n === 'onHighlightCreated').pop().a[0]; return [m.top, m.bottom, m.path]; });
check('straight band height follows thickness (max(6,h*thick))', Math.abs((th[1] - th[0]) - 0.05) < 0.004 && th[2] == null, JSON.stringify(th.slice(0, 2).map(v => +v.toFixed(3))));
await ev(() => { T.view.setHighlightStyle(true, 0.03); }); await clearLog();
const wave = Array.from({ length: 40 }, (_, i) => [px(0.2 + 0.5 * i / 39), py(0.35 + 0.05 * Math.sin(i / 39 * Math.PI * 4))]);
await ev(() => { window.__freeStart = performance.now(); });
await ptr('pointerdown', wave[0][0], wave[0][1], { type: 'touch', id: 8 });
for (const q of wave.slice(1)) await ptr('pointermove', q[0], q[1], { type: 'touch', id: 8 });
await ptr('pointermove', wave[39][0] + 1, wave[39][1], { type: 'touch', id: 8 });   // < 3 px from the last point: not added
await shot('hl-free-live');
check('live freehand stroke collects points >= 3px apart', await ev(() => T.view.freePts.length > 20 && T.view.freePts.length <= 41), String(await ev(() => T.view.freePts.length)));
await ptr('pointerup', wave[39][0], wave[39][1], { type: 'touch', id: 8 });
const fm = await ev(() => { const m = T.log.filter(l => l.n === 'onHighlightCreated').pop().a[0]; T.store.marks.push(m); T.view.invalidate(); return { path: m.path, thick: m.thick, l: m.left, t: m.top, r: m.right, b: m.bottom, color: m.color }; });
check('freehand mark: thick + path (even count, normalized 0..1)', fm.thick === 0.03 && fm.path.length >= 4 && fm.path.length % 2 === 0 && fm.path.every(v => v >= 0 && v <= 1), `n=${fm.path.length / 2}`);
const ys = fm.path.filter((_, i) => i % 2), xs = fm.path.filter((_, i) => i % 2 === 0);
check('freehand bbox includes half thickness', Math.abs(fm.t - (Math.min(...ys) - 0.015)) < 1e-6 && Math.abs(fm.b - (Math.max(...ys) + 0.015)) < 1e-6 && fm.l < Math.min(...xs) && fm.r > Math.max(...xs));
check('freehand stroke cleared after release', (await ev(() => T.view.freePts.length)) === 0);
// long stroke thins to <= 600 points
await clearLog();
const big = Array.from({ length: 1500 }, (_, i) => [px(0.05 + 0.9 * (i % 750) / 750), py(0.55 + 0.002 * Math.floor(i / 750) + 0.2 * Math.sin(i / 60))]);
await ptr('pointerdown', big[0][0], big[0][1], { type: 'touch', id: 9 });
for (const q of big.slice(1)) await ptr('pointermove', q[0], q[1], { type: 'touch', id: 9 });
await ptr('pointerup', big[1499][0], big[1499][1], { type: 'touch', id: 9 });
check('long freehand stroke thinned to <= 600 points', await ev(() => { const m = T.log.filter(l => l.n === 'onHighlightCreated').pop()?.a[0]; return !!m && m.path.length <= 1200 && m.path.length >= 400; }));
// tap without moving makes nothing
await clearLog(); await drag([[px(0.5), py(0.9)], [px(0.5), py(0.9)]], { type: 'touch', id: 10 });
check('freehand tap without movement creates no mark', (await logOf('onHighlightCreated')) === 0);
await ev(() => { T.view.setHighlightMode(false); T.view.setHighlightStyle(false, 0.022); });
await shot('hl-free-done');
// eraser removes a freehand mark when touched on the stroke (and not on empty page area inside its bbox)
const nMarks = await ev(() => T.store.marks.length);
await ev(() => T.view.setInkTool(2, 0xFF1C1C1E | 0, 0.004)); await clearLog();
await drag([[px(0.25), py(0.5) - 3], [px(0.25) + 1, py(0.5) - 3]], { type: 'pen' });   // inside the wave's bbox, far from its stroke
check('eraser ignores empty area inside a freehand bbox', (await ev(() => T.store.marks.length)) === nMarks);
const hit = fm.path.slice(20, 22);
await drag([[px(hit[0]), py(hit[1])], [px(hit[0]) + 1, py(hit[1])]], { type: 'pen' });
check('eraser removes the freehand highlight on its stroke', (await ev(() => T.store.marks.length)) === nMarks - 1 && (await logOf('onInkChanged')) >= 1);
await ev(() => T.view.setInkTool(0, 0xFF1C1C1E | 0, 0.004));
// copyToolsFrom carries style
check('copyToolsFrom copies freehand style + thickness', await ev(() => { T.view.setHighlightStyle(true, 0.04); const o = new T.view.constructor(T.view.listener || {}); o.copyToolsFrom(T.view); const r = o.highlightFree === true && o.highlightThick === 0.04; T.view.setHighlightStyle(false, 0.022); return r; }));

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
const box = await ev(() => { const m = T.store.marks[T.store.marks.length - 1]; const b = T.view.memoHitBoxes.get(m); return [(b.left + b.right) / 2, (b.top + b.bottom) / 2]; });
await drag([box, box], { type: 'touch', id: 7 });
check('v1.27: first tap selects the memo (no onMarkTapped yet)', (await logOf('onMarkTapped')) === 0);
await drag([box, box], { type: 'touch', id: 71 });
check('onMarkTapped on memo sticky (second tap)', (await logOf('onMarkTapped')) === 1);

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

// --- v1.27: rotation handle, rotated hit-testing, memo resize, pen plumbing -------------------------------------
await ev(() => { T.view.selectElement(T.el); T.view.invalidate(); });
const geo = () => ev(() => { const el = T.el, d = T.view.pageRect(); const L = d.left + el.left * d.width(), R = d.left + el.right * d.width(), Tp = d.top + el.top * d.height(), B = d.top + el.bottom * d.height(); return { cx: (L + R) / 2, cy: (Tp + B) / 2, top: Tp, w: R - L, h: B - Tp }; });
let g = await geo();
check('rotates(): shape yes, text no', await ev(async () => { const { AnnotationPainter } = await import('/js/painter.js'); return AnnotationPainter.rotates(T.el) && !AnnotationPainter.rotates({ kind: 'text' }); }));
await shot('12-rot-handle');
await clearLog();
// drag the knob (centre, 28 above the top) to the right of the centre -> 90 degrees (snapped)
await drag(line(g.cx, g.top - 28, g.cx + 100, g.cy + 2, 8), { type: 'touch', id: 51 });
let rot = await ev(() => T.el.rot);
check('rotation handle drag snaps to 90', rot === 90, 'rot=' + rot);
check('rotation reports onInkChanged', (await logOf('onInkChanged')) === 1);
await shot('13-rotated-90');
// the knob of a 90deg element sits to the right of the centre: pick it there and turn to ~45 (up-right) -> snap 45
await ev(() => { T.el.rot = 90; T.view.invalidate(); });
g = await geo();
await drag(line(g.cx + g.h / 2 + 28, g.cy, g.cx + 100, g.cy - 100, 8), { type: 'touch', id: 53 });
rot = await ev(() => T.el.rot);
check('rotated element: knob found at rotated position, turns to 45', rot === 45, 'rot=' + rot);
await shot('14-rotated-45');
// hit-test: a point inside the unrotated box but outside the rotated one is a miss; a point in the rotated area is a hit
await ev(() => { T.el.rot = 90; T.view.invalidate(); });
g = await geo();
const hits = await ev(([cx, cy, w, h]) => { const v = T.view, el = T.el; return [v.elementContains(el, cx + w / 2 - 3, cy), v.elementContains(el, cx, cy + w / 2 - 3), v.elementContains(el, cx + w / 2 - 3, cy + h / 2 - 3)]; }, [g.cx, g.cy, g.w, g.h]);
check('rotated hit-test (w>h, 90deg): wide edge now vertical', hits[0] === false && hits[1] === true, JSON.stringify(hits));
// resize of a rotated element keeps working in the element frame
await ev(() => { T.el.rot = 90; T.view.selectElement(T.el); T.view.invalidate(); });
g = await geo(); const w0 = g.w;
// BR corner of the rotated box is at (cx - h/2, cy + w/2) (rotated 90 cw: local (+w/2,+h/2) -> (-h/2,+w/2))
await drag(line(g.cx - g.h / 2, g.cy + w0 / 2, g.cx - g.h / 2, g.cy + w0 / 2 + 30, 6), { type: 'touch', id: 54 });
const g2 = await geo();
check('rotated element resizes along its own axis', g2.w > w0 + 5, `w ${w0.toFixed(0)} -> ${g2.w.toFixed(0)}`);
await ev(() => { T.el.rot = 0; T.view.selectElement(null); });
// pen type plumbing
await ev(() => { T.view.setInkTool(1, 0xFF1C1C1E | 0, 0.004); T.view.setInkPen(3); T.view.setFingerInk(true); T.store.strokes.length = 0; });
await drag(line(px(.2), py(.9), px(.5), py(.92), 8), { type: 'touch', id: 55 });
const pens = await ev(() => T.store.strokes.map(s => s.pen));
check('new stroke carries the selected pen', pens.length === 1 && pens[0] === 3, JSON.stringify(pens));
await ev(() => { T.view.setInkPen(99); }); check('setInkPen clamps to 0..4', (await ev(() => T.view.inkPen)) === 4);
await shot('15-pen-stroke');
await ev(() => { T.view.setInkTool(0, 0xFF1C1C1E | 0, 0.004); T.view.setFingerInk(false); T.store.strokes.length = 0; T.el.rot = 0; T.view.selectElement(null); });
// memo: first tap selects (dashed frame + handle), handle drag resizes, second tap edits
await ev(() => { const m = new T.Mark(); m.page = 0; m.left = .1; m.right = .2; m.top = .3; m.bottom = .32; m.noteOnly = true; m.note = '메모 크기 조절 테스트'; T.store.marks.push(m); T.memo = m; T.view.invalidate(); T.view.flush(); });
const mb = () => ev(() => { const b = T.view.memoHitBoxes.get(T.memo); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; });
let mbox = await mb(); await clearLog();
await drag([[ (mbox.l + mbox.r) / 2, (mbox.t + mbox.b) / 2 ], [ (mbox.l + mbox.r) / 2, (mbox.t + mbox.b) / 2 ]], { type: 'touch', id: 61 });
check('first memo tap selects instead of opening', (await ev(() => T.view.selectedMemo === T.memo)) && (await logOf('onMarkTapped')) === 0);
await shot('16-memo-selected');
await drag(line(mbox.r, mbox.b, mbox.r + 70, mbox.b + 50, 8), { type: 'touch', id: 62 });
const sized = await ev(() => [T.memo.boxW, T.memo.boxH]);
check('memo handle drag sets own mbox size (dp)', sized[0] > (mbox.r - mbox.l) + 40 && sized[1] > (mbox.b - mbox.t) + 30, JSON.stringify(sized));
check('memo resize reports onInkChanged', (await logOf('onInkChanged')) >= 1);
await shot('17-memo-resized');
mbox = await mb();
await clearLog();
await drag([[ (mbox.l + mbox.r) / 2, mbox.t + 20 ], [ (mbox.l + mbox.r) / 2, mbox.t + 20 ]], { type: 'touch', id: 63 });
check('second tap opens the memo', (await logOf('onMarkTapped')) === 1 && (await ev(() => T.view.selectedMemo)) === null);
// --- v1.29: post-it selection like shapes (4 corner sizes, rotate knob, red x delete, body move), for memos and translation notes
{
  await ev(() => { const m = T.store.marks[0]; T.memo2 = m; m.boxW = 0; m.boxH = 0; T.view.selectedMemo = null; T.view.invalidate(); T.view.flush(); });
  await clearLog();
  let bb = await mb();
  await drag([[ (bb.l + bb.r) / 2, (bb.t + bb.b) / 2 ], [ (bb.l + bb.r) / 2, (bb.t + bb.b) / 2 ]], { type: 'touch', id: 640 });
  check('v1.29: first tap selects the post-it', await ev(() => T.view.selectedMemo === T.memo));
  // top-left corner shrinks from the top-left and keeps the opposite corner; anchor (right, top) follows
  const a0 = await ev(() => [T.memo.right, T.memo.top]);
  await drag(line(bb.l, bb.t, bb.l - 40, bb.t - 20, 5), { type: 'touch', id: 641 });
  const bb1 = await mb(); const sz1 = await ev(() => [T.memo.boxW, T.memo.boxH]);
  check('v1.29: TL corner enlarges width/height from the top-left', bb1.l < bb.l - 20 && bb1.t < bb.t - 10 && Math.abs(bb1.r - bb.r) < 3 && Math.abs(bb1.b - bb.b) < 3 && sz1[0] > 0, JSON.stringify([bb, bb1, sz1]));
  // rotate knob: 28 dp above the top centre -> drag to the right of the centre = 90 degrees
  const cx = (bb1.l + bb1.r) / 2, cy = (bb1.t + bb1.b) / 2;
  await drag(line(cx, bb1.t - 28, cx + 120, cy, 8), { type: 'touch', id: 642 });
  check('v1.29: rotate knob turns the post-it (snaps to 90)', (await ev(() => T.memo.rot)) === 90, String(await ev(() => T.memo.rot)));
  await shot('19-sticky-rotated');
  // body drag moves the anchor
  const aBefore = await ev(() => [T.memo.right, T.memo.top]);
  await drag(line(cx, cy, cx + 30, cy + 30, 5), { type: 'touch', id: 643 });
  const aAfter = await ev(() => [T.memo.right, T.memo.top]);
  check('v1.29: body drag moves the post-it', aAfter[0] > aBefore[0] + 0.01 && aAfter[1] > aBefore[1] + 0.01, JSON.stringify([aBefore, aAfter]));
  // translation note: selectable the same way, stores boxW/boxH/rot
  await ev(() => { const n = new T.TranslationNote(); n.page = 0; n.left = .5; n.right = .55; n.top = .2; n.bottom = .25; n.source = 'hello'; n.translated = '안녕하세요 번역 테스트'; T.store.translations.push(n); T.note = n; T.view.selectedMemo = null; T.view.invalidate(); T.view.flush(); });
  const nb = await ev(() => { const b = T.view.noteHitBoxes.get(T.note); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; });
  await clearLog();
  await drag([[ (nb.l + nb.r) / 2, (nb.t + nb.b) / 2 ], [ (nb.l + nb.r) / 2, (nb.t + nb.b) / 2 ]], { type: 'touch', id: 644 });
  check('v1.29: first tap on a translation note selects it', (await ev(() => T.view.selectedMemo === T.note)) && (await logOf('onTranslationTapped')) === 0);
  await drag(line(nb.r, nb.b, nb.r + 50, nb.b + 40, 5), { type: 'touch', id: 645 });
  check('v1.29: translation note resize writes boxW/boxH', (await ev(() => T.note.boxW > 0 && T.note.boxH > 0)));
  // delete x (right + 14, top - 28)
  const nb2 = await ev(() => { const b = T.view.noteHitBoxes.get(T.note); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; });
  await drag([[nb2.r + 14, nb2.t - 28], [nb2.r + 14, nb2.t - 28]], { type: 'touch', id: 646 });
  check('v1.29: red x deletes the translation note', !(await ev(() => T.store.translations.includes(T.note))) && (await ev(() => T.view.selectedMemo)) === null);
  check('v1.29: second tap on a selected translation note opens it', await (async () => {
    await ev(() => { const n = new T.TranslationNote(); n.page = 0; n.left = .5; n.right = .55; n.top = .2; n.bottom = .25; n.source = 'a'; n.translated = 'b c d e'; T.store.translations.push(n); T.note = n; T.view.invalidate(); T.view.flush(); });
    const q = await ev(() => { const b = T.view.noteHitBoxes.get(T.note); return [(b.left + b.right) / 2, (b.top + b.bottom) / 2]; });
    await clearLog(); await drag([q, q], { type: 'touch', id: 647 }); await drag([q, q], { type: 'touch', id: 648 });
    return (await logOf('onTranslationTapped')) === 1;
  })());
  await ev(() => { T.store.translations.length = 0; });
}
await ev(() => { T.store.marks.length = 0; T.view.invalidate(); });
// text recognition radius: 3dp (touch) / 10dp (direct selection) instead of 16dp
const radius = await ev(() => { const v = T.view, d = v.contentRect(); v.textSelectMode = true; const R = { wordBounds: { left: .4, top: .4, right: .5, bottom: .42 } }; v.textRegions = [R];
  const at = dx => v.textRegionAt(d.left + .5 * d.width() + dx, d.top + .41 * d.height(), d) === R;
  v.directTextSelection = false; const a = [at(2), at(5)]; v.directTextSelection = true; const b = [at(8), at(13)]; v.textRegions = []; return a.concat(b); });
check('text recognition radius 3dp / 10dp', JSON.stringify(radius) === '[true,false,true,false]', JSON.stringify(radius));

// =====================================================================================================================
// v3: zoom API, backdrop, handles + delete, wheel / mouse page turning, text formatting
// =====================================================================================================================
await ev(() => { T.store.elements.length = 0; T.view.selectElement(null); T.view.resetZoom(); T.view.setInkTool(0, 0, 0); T.view.setPageSwipeEnabled(false); });
await page.waitForTimeout(50);
await clearLog();

// --- zoom API ---------------------------------------------------------------------------------------------------
{
  const z = await ev(() => { const v = T.view; const out = [v.getZoom()]; v.setZoom(2); out.push(v.getZoom()); v.zoomBy(0.5); out.push(v.getZoom()); v.setZoom(9); out.push(v.getZoom()); v.setZoom(0.2); out.push(v.getZoom());
    v.setZoom(3); v.resetZoom(); out.push(v.getZoom(), v.panX, v.panY); return out; });
  check('zoom API setZoom/zoomBy/clamp(0.4..4)/resetZoom', JSON.stringify(z) === '[1,2,1,4,0.4,1,0,0]', JSON.stringify(z));
  // Android v1.30.1: zoom out to 40%, the page is shown centred on the grey backdrop
  const zo = await ev(() => { const v = T.view; v.resetZoom(); const r1 = v.pageRect(); v.setZoom(0.4); const r = v.pageRect(); const R = { z: v.getZoom(), w: r.width() / r1.width(), h: r.height() / r1.height(), cx: (r.left + r.right) / 2 - v.width / 2, cy: (r.top + r.bottom) / 2 - v.height / 2, panX: v.panX, panY: v.panY };
    v.panX = 300; v.panY = 300; v.clampPan(); const r2 = v.pageRect(); R.cx2 = (r2.left + r2.right) / 2 - v.width / 2; R.cy2 = (r2.top + r2.bottom) / 2 - v.height / 2; v.setZoom(0.2); R.min = v.getZoom(); v.resetZoom(); return R; });
  check('zoom 40%: page is 0.4x the fitted size and centred on the backdrop (pan locked)', zo.z === 0.4 && Math.abs(zo.w - 0.4) < 0.005 && Math.abs(zo.h - 0.4) < 0.005 && Math.abs(zo.cx) < 1 && Math.abs(zo.cy) < 1 && Math.abs(zo.cx2) < 1 && Math.abs(zo.cy2) < 1 && zo.min === 0.4, JSON.stringify(zo));
  await ev(() => T.view.setZoom(0.4)); await shot('zoom-40'); await ev(() => T.view.resetZoom());
  await ev(() => { T.log.length = 0; const v = T.view; v.setZoom(2); v.zoomBy(0.5); v.setZoom(9); v.setZoom(0.2); v.setZoom(3); v.resetZoom(); });
  const zl = await ev(() => T.log.filter(l => l.n === 'onZoomChanged').map(l => +l.a[0].toFixed(3)));
  check('onZoomChanged fired for each real change', JSON.stringify(zl) === '[2,1,4,0.4,3,1]', JSON.stringify(zl));
  await clearLog();
  const cz = await ev(() => { const v = T.view, r = v.contentRect(); v.setZoom(2, r.left + r.width() * .75, r.top + r.height() * .25); const [nx, ny] = v.toPage(r.left + r.width() * .75, r.top + r.height() * .25); const q = v.contentRect(); v.resetZoom(); return [Math.abs(q.width() / r.width() - 2) < .001]; });
  check('setZoom(z, fx, fy) keeps the focus point stable-ish and doubles the page', cz[0]);
  await clearLog();
  await page.mouse.move(450, 350); await page.keyboard.down('Control'); await page.mouse.wheel(0, -300); await page.keyboard.up('Control');
  check('ctrl+wheel zoom reports onZoomChanged', (await logOf('onZoomChanged')) >= 1 && (await ev(() => T.view.getZoom())) > 1);
  await ev(() => T.view.resetZoom());
  await clearLog();
}

// --- backdrop vs paper (requirement 4) ----------------------------------------------------------------------------
{
  await ev(() => { T.view.setDarkPage(false); T.view.flush(); });
  const px0 = await ev(() => { const v = T.view, c = v.snapshot(false, 1), g = c.getContext('2d'), r = v.pageRect();
    const at = (x, y) => Array.from(g.getImageData(Math.round(x), Math.round(y), 1, 1).data).slice(0, 3).join(',');
    return { corner: at(3, 3), paper: at(r.left + 8, r.top + 8), outside: at(r.left - 1, r.top + 100), outsideFar: at(r.left - 8, r.top + 100), cs: getComputedStyle(v.el).backgroundColor }; });
  check('light backdrop #D9DADF around the paper', px0.corner === '217,218,223' && px0.cs === 'rgb(217, 218, 223)', JSON.stringify(px0));
  check('paper is lighter than the backdrop', px0.paper === '255,255,255' && px0.outside !== px0.corner, JSON.stringify(px0));
  await shot('12-backdrop-light');
  await ev(() => T.view.setDarkPage(true)); await shot('12-backdrop-dark');
  const dk = await ev(() => getComputedStyle(T.view.el).backgroundColor);
  check('dark page uses the dark backdrop variant', dk === 'rgb(43, 44, 49)', dk);
  await ev(() => T.view.setDarkPage(false));
}

// --- resize handles, delete button -------------------------------------------------------------------------------
{
  await ev(async () => {
    const { PageElement } = await import('/js/store.js');
    const mk = (kind, text, l, t, r, b, asset = '') => { const e = new PageElement(); e.page = 0; e.kind = kind; e.text = text; e.asset = asset; e.left = l; e.top = t; e.right = r; e.bottom = b; T.store.elements.push(e); return e; };
    T.shape = mk('shape', 'rect|FF007AFF|2200AAFF|3', .45, .55, .75, .7);
    T.img = mk('image', '', .1, .3, .3, .4);                        // 2:1 in page px? aspect = (.2*w)/(.1*h)
    T.tb = mk('text', 'Hello text box', .1, .8, .6, .9);
    T.view.invalidate();
  });
  const box = n => ev(n => { const e = T[n], r = T.view.pageRect(); return { l: r.left + e.left * r.width(), t: r.top + e.top * r.height(), r: r.left + e.right * r.width(), b: r.top + e.bottom * r.height(), W: r.width(), H: r.height() }; }, n);
  const geo = n => ev(n => { const e = T[n]; return [e.left, e.top, e.right, e.bottom]; }, n);
  const tap = (x, y, o) => drag([[x, y], [x, y]], o);
  await tap(px(.6), py(.62), { type: 'touch', id: 71 });
  check('shape tap selects', await ev(() => T.view.selectedElement() === T.shape));
  check('onElementSelected fired', (await ev(() => T.log.filter(l => l.n === 'onElementSelected').length)) >= 1);
  await shot('13-handles-8');
  // right edge handle (mouse): only the width changes
  let b = await box('shape'); const g0 = await geo('shape');
  await drag(line(b.r, (b.t + b.b) / 2, b.r + 60, (b.t + b.b) / 2 + 20, 6), { type: 'mouse', id: 72 });
  let g1 = await geo('shape');
  check('edge handle R (mouse) widens only', g1[2] > g0[2] + 0.05 && Math.abs(g1[1] - g0[1]) < 1e-6 && Math.abs(g1[3] - g0[3]) < 1e-6 && Math.abs(g1[0] - g0[0]) < 1e-6, JSON.stringify([g0, g1]));
  // top edge handle (pen)
  b = await box('shape');
  await drag(line((b.l + b.r) / 2, b.t, (b.l + b.r) / 2 + 10, b.t - 50, 6), { type: 'pen', id: 73 });
  const g2 = await geo('shape');
  check('edge handle T (pen) grows upward only', g2[1] < g1[1] - 0.03 && Math.abs(g2[3] - g1[3]) < 1e-6 && Math.abs(g2[0] - g1[0]) < 1e-6, JSON.stringify([g1, g2]));
  // left edge handle (touch) and bottom-left corner
  b = await box('shape');
  await drag(line(b.l, (b.t + b.b) / 2, b.l - 40, (b.t + b.b) / 2, 5), { type: 'touch', id: 74 });
  const g3 = await geo('shape');
  check('edge handle L (touch)', g3[0] < g2[0] - 0.03 && Math.abs(g3[2] - g2[2]) < 1e-6, JSON.stringify([g2, g3]));
  b = await box('shape');
  await drag(line(b.l, b.b, b.l + 30, b.b + 30, 5), { type: 'mouse', id: 75 });
  const g4 = await geo('shape');
  check('corner BL (mouse) moves two sides', g4[0] > g3[0] + 0.01 && g4[3] > g3[3] + 0.01 && Math.abs(g4[2] - g3[2]) < 1e-6 && Math.abs(g4[1] - g3[1]) < 1e-6, JSON.stringify([g3, g4]));
  await shot('14-shape-resized');
  // body move with the mouse (no tool active)
  b = await box('shape');
  await drag(line((b.l + b.r) / 2, (b.t + b.b) / 2, (b.l + b.r) / 2 - 40, (b.t + b.b) / 2 - 40, 5), { type: 'mouse', id: 76 });
  const g5 = await geo('shape');
  check('mouse drags the selected element body', g5[0] < g4[0] - 0.02 && Math.abs((g5[2] - g5[0]) - (g4[2] - g4[0])) < 1e-6, JSON.stringify([g4, g5]));
  // image (aspect locked): select, drag corner and edge, ratio stays
  await tap(px(.2), py(.35), { type: 'touch', id: 77 });
  check('image selected', await ev(() => T.view.selectedElement() === T.img));
  const ratio = n => ev(n => { const e = T[n], r = T.view.pageRect(); return ((e.right - e.left) * r.width()) / ((e.bottom - e.top) * r.height()); }, n);
  const r0 = await ratio('img'); b = await box('img');
  await drag(line(b.r, b.b, b.r + 50, b.b + 5, 5), { type: 'mouse', id: 78 });
  const r1 = await ratio('img'); const gi1 = await geo('img');
  check('image corner keeps aspect', Math.abs(r1 - r0) < 0.02 && gi1[2] > .3 + 0.02, `r ${r0.toFixed(3)} -> ${r1.toFixed(3)}`);
  b = await box('img');
  await drag(line((b.l + b.r) / 2, b.b, (b.l + b.r) / 2, b.b + 30, 5), { type: 'touch', id: 79 });
  const r2 = await ratio('img'); const gi2 = await geo('img');
  check('v1.29: image edge-middle bar handle stretches one axis only and sets stretch', Math.abs(r2 - r0) > 0.02 && gi2[3] > gi1[3] + 0.005 && Math.abs(gi2[0] - gi1[0]) < 1e-6 && Math.abs(gi2[2] - gi1[2]) < 1e-6 && (await ev(() => T.img.stretch)) === true, `r ${r2.toFixed(3)} ${JSON.stringify([gi1, gi2])}`);
  // corners keep the (now stretched) box ratio
  const rs0 = await ratio('img'); b = await box('img');
  await drag(line(b.r, b.b, b.r + 40, b.b + 40, 5), { type: 'mouse', id: 790 });
  check('v1.29: corner of a stretched image keeps its ratio', Math.abs((await ratio('img')) - rs0) < 0.03);
  // left / top bars
  b = await box('img'); const gl0 = await geo('img');
  await drag(line(b.l, (b.t + b.b) / 2, b.l - 20, (b.t + b.b) / 2, 4), { type: 'mouse', id: 791 });
  const gl1 = await geo('img'); check('v1.29: left bar moves only the left edge', gl1[0] < gl0[0] - 0.01 && Math.abs(gl1[2] - gl0[2]) < 1e-6 && Math.abs(gl1[1] - gl0[1]) < 1e-6 && Math.abs(gl1[3] - gl0[3]) < 1e-6);
  b = await box('img');
  await drag(line((b.l + b.r) / 2, b.t, (b.l + b.r) / 2, b.t - 15, 4), { type: 'mouse', id: 792 });
  const gt1 = await geo('img'); check('v1.29: top bar moves only the top edge', gt1[1] < gl1[1] - 0.005 && Math.abs(gt1[3] - gl1[3]) < 1e-6);
  const delPos = await ev(() => { const v = T.view, e = T.img, r = v.pageRect(), s = v._handleSpots(e, new (r.constructor)(r.left + e.left * r.width(), r.top + e.top * r.height(), r.left + e.right * r.width(), r.top + e.bottom * r.height()), r); const d = s.find(h => h.kind === 'd'), b = { r: r.left + e.right * r.width(), t: r.top + e.top * r.height() }; return [d.x - b.r, d.y - b.t]; });
  check('v1.29: red x delete button sits at the top-right (right+14, top-28)', Math.abs(delPos[0] - 14) < 0.5 && Math.abs(delPos[1] + 28) < 0.5, JSON.stringify(delPos));
  await shot('15-image-resized');
  // text box: select + resize + second tap edits
  await clearLog();
  await tap(px(.3), py(.85), { type: 'touch', id: 80 });
  check('text box tap selects (first tap)', (await ev(() => T.view.selectedElement() === T.tb)) && (await logOf('onElementTapped')) === 0);
  b = await box('tb'); const t0 = await geo('tb');
  await drag(line(b.r, b.b, b.r - 40, b.b + 10, 5), { type: 'mouse', id: 81 });
  const t1 = await geo('tb');
  check('text box resizes by corner', t1[2] < t0[2] - 0.02 && t1[3] > t0[3], JSON.stringify([t0, t1]));
  await tap(px((t1[0] + t1[2]) / 2), py((t1[1] + t1[3]) / 2), { type: 'touch', id: 82 });
  check('second tap on a selected text box -> onElementTapped', (await logOf('onElementTapped')) === 1);
  await shot('16-textbox-selected');
  // delete button
  await clearLog();
  b = await box('tb'); const n0 = await ev(() => T.store.elements.length);
  await tap(b.r + 14, b.t - 28, { type: 'mouse', id: 83 });
  const n1 = await ev(() => T.store.elements.length);
  check('delete button removes the element', n1 === n0 - 1 && !(await ev(() => T.store.elements.includes(T.tb))) && (await ev(() => T.view.selectedElement())) === null);
  check('onElementDeleted(e) fired once', (await logOf('onElementDeleted')) === 1 && (await ev(() => T.log.find(l => l.n === 'onElementDeleted').a[0] === T.tb)));
  // delete with touch on the image + deleteSelectedElement API
  await tap(px(.2), py(.35), { type: 'touch', id: 84 }); b = await box('img');
  await tap(b.r + 14, b.t - 28, { type: 'touch', id: 85 });
  check('delete button works with touch', !(await ev(() => T.store.elements.includes(T.img))));
  await tap(px(.6), py(.62), { type: 'touch', id: 86 });
  check('deleteSelectedElement() API', (await ev(() => T.view.selectedElement() === T.shape && T.view.deleteSelectedElement())) && (await ev(() => T.store.elements.length)) === 0);
  // handles are usable while the pen is the active tool, but the body is not grabbed (the pen writes)
  await ev(async () => { const { PageElement } = await import('/js/store.js'); const e = new PageElement(); e.page = 0; e.kind = 'shape'; e.text = 'rect|FF007AFF|2200AAFF|3'; e.left = .4; e.top = .5; e.right = .7; e.bottom = .65; T.store.elements.push(e); T.shape = e; T.view.selectElement(e); T.view.setInkTool(1, 0xFF000000 | 0, .004); });
  const sc0 = await ev(() => T.store.strokes.length); b = await box('shape');
  await drag(line((b.l + b.r) / 2 - 20, (b.t + b.b) / 2, (b.l + b.r) / 2 + 20, (b.t + b.b) / 2 + 10, 5), { type: 'pen', id: 87 });
  check('pen in write mode draws over a selected element (no body grab)', (await ev(() => T.store.strokes.length)) === sc0 + 1 && (await geo('shape'))[0] === .4);
  await ev(() => { T.store.strokes.length = 0; T.store.elements.length = 0; T.view.setInkTool(0, 0, 0); T.view.selectElement(null); });
}

// --- wheel page turn + mouse read drag -----------------------------------------------------------------------------
{
  await clearLog();
  await page.mouse.move(450, 350);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(60);
  check('wheel down at zoom 1 -> onPageSwipe(+1)', JSON.stringify(await ev(() => T.log.filter(l => l.n === 'onPageSwipe').map(l => l.a[0]))) === '[1]');
  await page.mouse.wheel(0, 120); await page.mouse.wheel(0, 100); await page.waitForTimeout(60);
  check('wheel inertia is debounced', (await logOf('onPageSwipe')) === 1);
  await page.waitForTimeout(700);
  await page.mouse.wheel(0, -120); await page.waitForTimeout(60);
  check('wheel up -> onPageSwipe(-1)', JSON.stringify(await ev(() => T.log.filter(l => l.n === 'onPageSwipe').map(l => l.a[0]))) === '[1,-1]');
  await page.waitForTimeout(700); await clearLog();
  await page.mouse.wheel(0, 8); await page.waitForTimeout(60);
  check('tiny wheel movement does not turn', (await logOf('onPageSwipe')) === 0);
  await ev(() => T.view.setWheelPageTurn(false)); await page.waitForTimeout(500);
  await page.mouse.wheel(0, 200); await page.waitForTimeout(60);
  check('setWheelPageTurn(false)', (await logOf('onPageSwipe')) === 0);
  await ev(() => { T.view.setWheelPageTurn(true); T.view.setZoom(2); }); await page.waitForTimeout(500);
  const pan0 = await ev(() => T.view.panY); await page.mouse.wheel(0, 100); await page.waitForTimeout(60);
  check('zoomed: wheel pans, no page turn', (await logOf('onPageSwipe')) === 0 && (await ev(() => T.view.panY)) !== pan0);
  await ev(() => T.view.resetZoom());

  // mouse drag in read mode
  await clearLog();
  await ev(() => { T.view.setPageSwipeEnabled(true); T.view.setMouseReadDrag(true); T.view.setDirectTextSelection(false); });
  const dragTurn = async (o, id) => { await clearLog(); await drag(line(px(.8), py(.9), px(.2), py(.9), 8), { ...o, id }); return ev(() => T.log.filter(l => l.n === 'onPageSwipe').map(l => l.a[0])); };
  check('mouse drag left in read mode -> onPageSwipe(+1)', JSON.stringify(await dragTurn({ type: 'mouse' }, 91)) === '[1]');
  await clearLog(); await drag(line(px(.2), py(.9), px(.8), py(.9), 8), { type: 'mouse', id: 92 });
  check('mouse drag right -> onPageSwipe(-1)', JSON.stringify(await ev(() => T.log.filter(l => l.n === 'onPageSwipe').map(l => l.a[0]))) === '[-1]');
  check('pen drag never turns pages', (await dragTurn({ type: 'pen' }, 93)).length === 0);
  await ev(() => T.view.setMouseReadDrag(false));
  check('setMouseReadDrag(false) disables it', (await dragTurn({ type: 'mouse' }, 94)).length === 0 && (await ev(() => T.view.isMouseReadDrag())) === false);
  await ev(() => { T.view.setMouseReadDrag(true); T.view.setInkTool(1, 0xFF000000 | 0, .004); });
  const sc1 = await ev(() => T.store.strokes.length);
  check('write mode: mouse writes, does not turn the page', (await dragTurn({ type: 'mouse' }, 95)).length === 0 && (await ev(() => T.store.strokes.length)) === sc1 + 1);
  await ev(() => { T.store.strokes.length = 0; T.view.setInkTool(0, 0, 0); });
  // a mouse drag that starts on a word still selects text
  await ev(() => { T.view.setDirectTextSelection(true); });
  await ev(() => { T.view.setDirectTextSelection(false); T.view.setPageSwipeEnabled(false); });
  // pageDrag hook is used by the mouse too
  await ev(() => { T.dragLog = []; T.view.setPageSwipeEnabled(true); T.view.setPageDrag({ start: d => { T.dragLog.push('start' + d); return true; }, move: m => T.dragLog.push('move'), end: v => T.dragLog.push('end'), touchAt: () => {} }); });
  await drag(line(px(.8), py(.9), px(.3), py(.9), 8), { type: 'mouse', id: 96 });
  check('mouse drag drives PageDrag (curl)', await ev(() => T.dragLog[0] === 'start1' && T.dragLog.includes('move') && T.dragLog.at(-1) === 'end'), JSON.stringify(await ev(() => T.dragLog)));
  await ev(() => { T.view.setPageDrag(null); T.view.setPageSwipeEnabled(false); });
}

// --- text formatting (painter == inline editor layout) -----------------------------------------------------------
{
  await clearLog();
  await ev(async () => {
    const { PageElement } = await import('/js/store.js');
    const mk = (o) => { const e = Object.assign(new PageElement(), { page: 0, kind: 'text', textSize: .03 }, o); T.store.elements.push(e); return e; };
    mk({ text: 'Left aligned plain', left: .06, top: .42, right: .48, bottom: .47 });
    mk({ text: 'Centered\nunderlined text', left: .06, top: .49, right: .48, bottom: .57, align: 1, underline: true });
    mk({ text: 'Right aligned\n오른쪽 정렬', left: .06, top: .59, right: .48, bottom: .67, align: 2, strike: true });
    mk({ text: '\u2022 First bullet\n\u2022 Second bullet with a very long line that must wrap around\n\u2022 Third', left: .06, top: .69, right: .48, bottom: .83 });
    mk({ text: '1. One\n2. Two\n3. Three\n\n4. Five', left: .52, top: .42, right: .94, bottom: .56 });
    T.chk = mk({ text: '\u2611 Buy milk\n\u2610 Call mom\n\u2611 Send the report', left: .52, top: .58, right: .94, bottom: .68 });
    mk({ text: '\u2022 Centered bullets\n\u2022 underline + strike', left: .52, top: .70, right: .94, bottom: .80, align: 1, underline: true, strike: true });
    T.view.invalidate();
  });
  await shot('17-text-formats');
  const lay = await ev(async () => {
    const { AnnotationPainter } = await import('/js/painter.js'); const c = document.createElement('canvas').getContext('2d'); c.font = '20px sans-serif'; const m = s => c.measureText(s).width;
    const L = AnnotationPainter.layoutText(m, 'ab\nlonger line', 300, 20, { align: 2 });
    const C = AnnotationPainter.layoutText(m, 'ab', 300, 20, { align: 1 });
    return { rightEdge: L.lines[1].x + L.lines[1].w, centerMid: C.lines[0].x + C.lines[0].w / 2, y: L.lines.map(l => l.y) };
  });
  check('layoutText: right/center alignment (Android int align)', Math.abs(lay.rightEdge - 300) < 0.01 && Math.abs(lay.centerMid - 150) < 0.01 && lay.y[0] === 20 && Math.abs(lay.y[1] - 47) < 1e-9, JSON.stringify(lay));
  // pixel checks: centred text is centred in its box, right text ends at the right edge
  const cen = await ev(() => { const v = T.view, r = v.pageRect(), c = v.snapshot(false, 1), g = c.getContext('2d'); const e = T.store.elements[1];
    const x0 = Math.round(r.left + e.left * r.width()), x1 = Math.round(r.left + e.right * r.width()), y0 = Math.round(r.top + (e.top) * r.height()), y1 = Math.round(r.top + (e.top + .035) * r.height());
    const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data; let lo = 1e9, hi = -1; for (let y = 0; y < y1 - y0; y++) for (let x = 0; x < x1 - x0; x++) if (d[(y * (x1 - x0) + x) * 4] < 120) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    return { left: lo, right: (x1 - x0) - hi, w: x1 - x0 }; });
  check('painted centred line is centred (first line "Centered")', Math.abs(cen.left - cen.right) <= 3, JSON.stringify(cen));
  const rt = await ev(() => { const v = T.view, r = v.pageRect(), c = v.snapshot(false, 1), g = c.getContext('2d'); const e = T.store.elements[2];
    const x0 = Math.round(r.left + e.left * r.width()), x1 = Math.round(r.left + e.right * r.width()), y0 = Math.round(r.top + (e.top) * r.height()), y1 = Math.round(r.top + (e.top + .035) * r.height());
    const d = g.getImageData(x0, y0, x1 - x0, y1 - y0).data; let hi = -1; for (let y = 0; y < y1 - y0; y++) for (let x = 0; x < x1 - x0; x++) if (d[(y * (x1 - x0) + x) * 4] < 120) hi = Math.max(hi, x);
    return (x1 - x0) - hi; });
  check('painted right-aligned line ends at the box edge', rt <= 3, 'gap ' + rt);
  // clickable check boxes
  await clearLog();
  const cb = await ev(async () => { const { AnnotationPainter } = await import('/js/painter.js'); const r = T.view.pageRect(); return AnnotationPainter.checkBoxes(r, T.chk).map(c => ({ i: c.index, x: (c.rect.left + c.rect.right) / 2, y: (c.rect.top + c.rect.bottom) / 2 })); });
  check('checkBoxes() lists one box per line', cb.length === 3 && cb[1].y > cb[0].y, JSON.stringify(cb));
  await drag([[cb[1].x, cb[1].y], [cb[1].x, cb[1].y]], { type: 'touch', id: 101 });
  check('tap on a leading marker toggles it in the text', (await ev(() => T.chk.text)) === '\u2611 Buy milk\n\u2611 Call mom\n\u2611 Send the report' && (await logOf('onCheckToggled')) === 1 && (await logOf('onInkChanged')) === 1 && (await ev(() => T.view.selectedElement())) === null);
  await drag([[cb[0].x, cb[0].y], [cb[0].x, cb[0].y]], { type: 'mouse', id: 102 });
  check('mouse click toggles the first marker off', (await ev(() => T.chk.text.split('\n')[0])) === '\u2610 Buy milk');
  await shot('18-check-toggled');
  const js = await ev(async () => { const { stringify } = await import('/js/store.js'); return stringify(T.chk.toJson()); });
  check('markers persist as plain text; no list/checked keys', js.includes('\\u2610 Buy milk') === false && js.includes('\u2610 Buy milk') && !/"list"|"checked"/.test(js), js);
  await ev(() => { T.store.elements.length = 0; T.view.selectElement(null); T.view.invalidate(); });
}

// --- v3.10: memo resize / rotate with the MOUSE (not only finger and pen) ----------------------------------------------
{
  await ev(() => { T.view.setInkTool(0, 0xFF1C1C1E | 0, 0.004); T.view.selectElement(null); const m = new T.Mark(); m.page = 0; m.left = .55; m.right = .6; m.top = .2; m.bottom = .22; m.noteOnly = true; m.note = '마우스 메모'; T.store.marks.push(m); T.mm = m; T.view.selectedMemo = null; T.view.invalidate(); T.view.flush(); });
  const mbx = () => ev(() => { const b = T.view.memoHitBoxes.get(T.mm); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; });
  let q = await mbx(); const M = { type: 'mouse', id: 1 };
  await drag([[(q.l + q.r) / 2, (q.t + q.b) / 2], [(q.l + q.r) / 2, (q.t + q.b) / 2]], M);
  check('mouse click selects the memo', await ev(() => T.view.selectedMemo === T.mm));
  await ev(() => { T.view.invalidate(); T.view.flush(); }); q = await mbx();
  await drag(line(q.r, q.b, q.r + 60, q.b + 40, 8), M);
  const sz = await ev(() => [T.mm.boxW, T.mm.boxH]);
  check('mouse drags the memo corner to resize', sz[0] > (q.r - q.l) + 30 && sz[1] > (q.b - q.t) + 20, JSON.stringify(sz));
  await ev(() => { T.view.invalidate(); T.view.flush(); }); q = await mbx();
  const knob = [(q.l + q.r) / 2, q.t - 28 * (await ev(() => window.devicePixelRatio ? 1 : 1))];
  await drag([knob, [q.r + 80, (q.t + q.b) / 2], [q.r + 120, (q.t + q.b) / 2]], M);
  check('mouse drags the knob to rotate the memo', (await ev(() => T.mm.rot || 0)) > 30, String(await ev(() => T.mm.rot)));
  await ev(() => { T.view.selectedMemo = null; const i = T.store.marks.indexOf(T.mm); if (i >= 0) T.store.marks.splice(i, 1); T.view.invalidate(); });
}
// --- v3.10: eraser range ------------------------------------------------------------------------------------------------
{
  await ev(() => { T.store.strokes.length = 0; const S = T.view.strokes; const mk = (x) => { const s = new T.InkStroke(); s.page = 0; s.color = 0xFF1C1C1E | 0; s.width = .004; s.points.push(new T.InkPoint(x, .7, .5), new T.InkPoint(x, .75, .5)); T.store.strokes.push(s); }; mk(.40); mk(.46); mk(.52); T.view.invalidate(); });
  const cx = px(.46), cy = py(.72), gap = .06 * R.w;
  await ev(() => { T.view.setInkTool(2, 0xFF1C1C1E | 0, 0.004); T.view.setEraserRadius(8); });
  await drag([[cx, cy], [cx, cy]], { type: 'pen', id: 71 });
  check('small eraser removes only the stroke under it', (await ev(() => T.store.strokes.length)) === 2);
  await ev(r => T.view.setEraserRadius(r), Math.ceil(gap + 6));
  await drag([[cx, cy], [cx, cy]], { type: 'pen', id: 72 });
  check('large eraser removes every stroke in its range', (await ev(() => T.store.strokes.length)) === 0, 'r=' + Math.ceil(gap + 6));
  await ev(() => { T.view.setInkTool(0, 0xFF1C1C1E | 0, 0.004); T.view.setEraserRadius(18); });
}

// --- dark page, snapshot -----------------------------------------------------------------------------------
await ev(() => T.view.setDarkPage(true));
await shot('11-dark');
const snap = await ev(() => { const c = T.view.snapshot(true, 1); return [c.width, c.height, c.getContext('2d').getImageData(2, 2, 1, 1).data.join(',')]; });
check('snapshot dark size + dark backdrop (page stays distinct)', snap[0] === 900 && snap[1] === 700 && snap[2] === '43,44,49,255', JSON.stringify(snap));
await ev(() => T.view.setDarkPage(false));
const cpb = await ev(() => { const c = T.view.copyPageBitmap(); return [c.width, c.height]; });
check('copyPageBitmap', cpb[0] > 100);
check('getPageNumber', (await ev(() => T.view.getPageNumber())) === 0);
await ev(() => T.view.clearPage());
check('clearPage -> empty rect', (await ev(() => T.view.pageRect().isEmpty())));

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
await browser.close(); server.close(); process.exit(fails ? 1 : 0);
