// v3.20: split screen with 2 to 4 panes (left/right, top/bottom, 2x2), dividers, active frame, chips, arrows. usage: node dev/split4-test.mjs
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

const rect = i => ev(i => app.panes[i].view.el.getBoundingClientRect().toJSON(), i);
await open('sample.pdf', 'b.pdf'); await open('sample-ko.pdf', 'c.pdf'); await open('sample.pdf', 'd.pdf'); await page.waitForTimeout(1200);
await ev(() => { if (app.libraryDialog && app.libraryDialog.isShowing()) app.libraryDialog.dismiss(); });
await ev(() => app.switchDocument(app.sessions[0])); await page.waitForTimeout(400);
check('4 documents open', await ev(() => app.sessions.length === 4));
await ev(() => app.recentPrefs.putString('split_layout', 'cols'));
await ev(() => app.toggleSplit()); await page.waitForTimeout(300);
await page.keyboard.press('Escape'); // closes the picker menu if one appeared
await ev(() => app.enterSplit(app.sessions[1])); await page.waitForTimeout(900);
check('2 panes side by side', await ev(() => { const a = app.panes[0].view.el.getBoundingClientRect(), b = app.panes[1].view.el.getBoundingClientRect(); return app.isSplit() && app.panes.length === 2 && b.left >= a.right - 1 && Math.abs(a.top - b.top) < 2 && a.width > 300; }));
check('1 vertical divider, no horizontal', await ev(() => document.querySelectorAll('.m-splitdiv.v').length === 1 && document.querySelectorAll('.m-splitdiv.h').length === 0));
// layout: top / bottom
await ev(() => app.setSplitLayout('rows')); await page.waitForTimeout(500);
let a = await rect(0), b = await rect(1);
check('rows: panes stacked, same width', b.top >= a.bottom - 1 && Math.abs(a.left - b.left) < 2 && Math.abs(a.width - b.width) < 2 && a.height > 150, JSON.stringify([a.top, a.bottom, b.top]));
check('rows: horizontal divider only', await ev(() => document.querySelectorAll('.m-splitdiv.v').length === 0 && document.querySelectorAll('.m-splitdiv.h').length === 1));
await page.screenshot({ path: path.join(out, 'split4-rows.png') });
// drag horizontal divider
{ const d = await ev(() => document.querySelector('.m-splitdiv.h').getBoundingClientRect().toJSON()); const before = (await rect(0)).height;
  await page.mouse.move(d.left + d.width / 2, d.top + d.height / 2); await page.mouse.down(); await page.mouse.move(d.left + d.width / 2, d.top + d.height / 2 + 100, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
  const after = (await rect(0)).height; check('dragging the horizontal divider resizes panes', after > before + 60, `${before} -> ${after}`);
  check('2-pane row ratio remembered', await ev(() => app.recentPrefs.getFloat('split_vratio', 0.5) > 0.55)); }
await ev(() => document.querySelector('.m-splitdiv.h').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))); await page.waitForTimeout(200);
check('double click resets to equal', await ev(() => Math.abs(app.splitSizes.r[0] - 0.5) < 0.001));
// back to cols, add third pane
await ev(() => app.setSplitLayout('cols')); await page.waitForTimeout(200);
await ev(() => app.addPane(app.sessions[2])); await page.waitForTimeout(900);
check('3 panes in a row', await ev(() => app.panes.length === 3 && document.querySelectorAll('.m-splitdiv.v').length === 2));
let r3 = [await rect(0), await rect(1), await rect(2)];
check('3 columns equal width', r3.every(r => Math.abs(r.width - r3[0].width) < 3) && r3[1].left >= r3[0].right - 1 && r3[2].left >= r3[1].right - 1, JSON.stringify(r3.map(r => Math.round(r.width))));
await ev(() => app.setSplitLayout('grid')); await page.waitForTimeout(500);
r3 = [await rect(0), await rect(1), await rect(2)];
check('3 panes grid: one wide on top, two below', r3[0].width > r3[1].width * 1.9 && r3[1].top >= r3[0].bottom - 1 && Math.abs(r3[1].top - r3[2].top) < 2 && r3[2].left >= r3[1].right - 1, JSON.stringify(r3.map(r => [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)])));
check('3-grid dividers: 1 vertical (bottom half only) + 1 horizontal', await ev(() => { const v = document.querySelector('.m-splitdiv.v').getBoundingClientRect(), p0 = app.panes[0].view.el.getBoundingClientRect(); return document.querySelectorAll('.m-splitdiv.v').length === 1 && document.querySelectorAll('.m-splitdiv.h').length === 1 && v.top >= p0.bottom - 4; }));
await page.screenshot({ path: path.join(out, 'split4-grid3.png') });
// fourth pane, 2x2
await ev(() => app.addPane(app.sessions[3], true)); await page.waitForTimeout(900);
check('4 panes, new pane is active', await ev(() => app.panes.length === 4 && app.activeSlot === 3 && app.activeSession === app.sessions[3] && app.firstPageView === app.panes[3].view));
check('2x2 grid', await ev(() => { const r = app.panes.map(p => p.view.el.getBoundingClientRect()); return app.splitLayout === 'grid' && r[1].left >= r[0].right - 1 && Math.abs(r[0].top - r[1].top) < 2 && r[2].top >= r[0].bottom - 1 && Math.abs(r[2].left - r[0].left) < 2 && Math.abs(r[3].top - r[2].top) < 2 && Math.abs(r[3].left - r[1].left) < 2; }));
check('2x2: one vertical + one horizontal divider, both full length', await ev(() => { const v = document.querySelector('.m-splitdiv.v').getBoundingClientRect(), hh = document.querySelector('.m-splitdiv.h').getBoundingClientRect(), pp = app.papers.getBoundingClientRect(); return document.querySelectorAll('.m-splitdiv').length === 2 && v.height > pp.height - 4 && hh.width > pp.width - 4; }));
check('exactly one pane has the blue frame, the active one', await ev(() => app.panes.map(p => p.view.el.classList.contains('pane-active')).join() === 'false,false,false,true'));
check('4 name chips, each inside its pane corner', await ev(() => { const cs = [...document.querySelectorAll('[data-tag=split_pane_chip]')]; return cs.length === 4 && cs.every((c, i) => { const r = c.getBoundingClientRect(), p = app.panes[i].view.el.getBoundingClientRect(); return r.left >= p.left && r.left < p.left + 30 && r.top >= p.top && r.top < p.top + 20; }); }));
check('adding a 5th pane is refused', await ev(() => { app.addPane(app.sessions[0]); return app.panes.length === 4; }));
// arrows follow the active pane
await page.screenshot({ path: path.join(out, 'split4-grid4.png') });
check('arrows centred on the active pane edges', await ev(() => { const p = app.firstPageView.el.getBoundingClientRect(), pv = app.previousOverlay.getBoundingClientRect(), nx = app.nextOverlay.getBoundingClientRect(); const cy = p.top + p.height / 2; return parseFloat(app.previousOverlay.style.left) === Math.round(p.left - app.papers.getBoundingClientRect().left) + 8 && nx.right <= p.right && nx.right > p.right - 20 && Math.abs((nx.top + nx.height / 2) - cy) < 3 && getComputedStyle(app.nextOverlay).display !== 'none'; }));
// drag the vertical divider and the horizontal one
{ const d = await ev(() => document.querySelector('.m-splitdiv.v').getBoundingClientRect().toJSON()); const w0 = (await rect(0)).width;
  await page.mouse.move(d.left + d.width / 2, d.top + 50); await page.mouse.down(); await page.mouse.move(d.left + d.width / 2 + 120, d.top + 50, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
  const w1 = (await rect(0)).width, w2 = (await rect(2)).width; check('vertical divider resizes both rows of the grid', w1 > w0 + 80 && Math.abs(w1 - w2) < 2, `${w0} -> ${w1} / ${w2}`); }
{ const d = await ev(() => document.querySelector('.m-splitdiv.h').getBoundingClientRect().toJSON()); const h0 = (await rect(0)).height;
  await page.mouse.move(d.left + 40, d.top + d.height / 2); await page.mouse.down(); await page.mouse.move(d.left + 40, d.top + d.height / 2 - 80, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
  const h1 = (await rect(0)).height; check('horizontal divider resizes the grid rows', h1 < h0 - 50, `${h0} -> ${h1}`); }
// touching another pane activates it
{ const r = await rect(1); await page.mouse.click(r.left + r.width / 2, r.top + r.height / 2); await page.waitForTimeout(300);
  check('touching pane 2 makes it active (session, view, frame)', await ev(() => app.activeSlot === 1 && app.firstPageView === app.panes[1].view && app.activeSession === app.panes[1].session && app.panes[1].view.el.classList.contains('pane-active') && !app.panes[3].view.el.classList.contains('pane-active'))); }
// per-pane zoom stays separate
await ev(() => { app.panes[1].view.zoomTo ? app.panes[1].view.zoomTo(2) : app.panes[1].view.restoreView(2, 0, 0); });
check('zoom of one pane does not change another', await ev(() => Math.abs(app.panes[0].view.scale - 1) < 0.01 && app.panes[1].view.scale > 1.5));
// ink in a pane
{ await ev(() => { app.setWriteMode(true); app.setInkMode(1); }); await page.waitForTimeout(200);
  const send = (type, x, y) => ev(([type, x, y]) => { const el = app.panes[2].view.el, r = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'pen', clientX: r.left + x, clientY: r.top + y, pressure: type === 'pointerup' ? 0 : 0.5, buttons: type === 'pointerup' ? 0 : 1, button: 0, isPrimary: true, width: 1, height: 1 })); }, [type, x, y]);
  const g = await ev(() => { const r = app.panes[2].view.contentRect(); return { l: r.left, t: r.top }; });
  await send('pointerdown', g.l + 40, g.t + 40); for (let k = 1; k <= 8; k++) await send('pointermove', g.l + 40 + k * 10, g.t + 40 + k * 4); await send('pointerup', g.l + 120, g.t + 72); await page.waitForTimeout(300);
  check('writing in pane 3 draws into its own document', await ev(() => app.activeSlot === 2 && app.store.strokes.length >= 1 && app.panes[2].session.store === app.store && app.panes[0].session.store.strokes.length === 0), await ev(() => JSON.stringify([app.activeSlot, app.store.strokes.length]))); }
// swap panes
await ev(() => { app._s = app.panes.map(p => p.session.title); app.swapSplitPanes(0, 3); });
check('swap exchanges positions, active document unchanged', await ev(() => app.panes[0].session.title === app._s[3] && app.panes[3].session.title === app._s[0] && app.activeSession === app.panes[2].session));
// menu
{ const chip = page.locator('[data-tag=split_pane_chip]').nth(0); await chip.click(); await page.waitForTimeout(300);
  const txt = await ev(() => document.body.innerText);
  check('pane menu offers layouts, close, swap, end', /2 × 2/.test(txt) && /가로로 4등분/.test(txt) && /세로로 4등분/.test(txt) && /이 화면 닫기/.test(txt) && /위치 바꾸기/.test(txt) && /화면 나누기 끝내기/.test(txt) && !/화면 추가/.test(txt)); await page.screenshot({ path: path.join(out, 'split4-menu.png') }); await page.keyboard.press('Escape'); await page.mouse.click(5, 5); await page.waitForTimeout(200); }
// close a pane -> 3
await ev(() => app.removePane(0)); await page.waitForTimeout(500);
check('closing one of four leaves three, layout kept valid', await ev(() => app.panes.length === 3 && app.splitLayout === 'grid' && app.panes.every(p => p.view.el.style.display !== 'none') && app.paneViews.filter(v => v.el.style.display !== 'none').length === 3));
check('active pane still consistent', await ev(() => app.firstPageView === app.panes[app.activeSlot].view && app.activeSession === app.panes[app.activeSlot].session));
// close document that is in a pane
await ev(() => app.closeDocument(app.panes[0].session)); await page.waitForTimeout(500);
check('closing a shown document removes its pane', await ev(() => app.panes.length === 2 && app.sessions.length === 3));
await ev(() => app.setSplitLayout('rows')); await page.waitForTimeout(200);
// exit
await ev(() => app.exitSplit()); await page.waitForTimeout(500);
check('exit: one pane shown, grid styles cleared, arrows reset', await ev(() => { const vis = app.paneViews.filter(v => v.el.style.display !== 'none'); return !app.isSplit() && vis.length === 1 && vis[0] === app.firstPageView && app.papers.style.gridTemplateColumns === '' && app.previousOverlay.style.left === '' && app.previousOverlay.style.top === '' && document.querySelectorAll('.m-splitdiv').length === 0; }));
check('exit: single view fills the area', await ev(() => { const r = app.firstPageView.el.getBoundingClientRect(), p = app.papers.getBoundingClientRect(); return r.width > p.width - 4 && r.height > p.height - 4; }));
// two-page after split still ok
await ev(() => app.toggleTwoPage && app.toggleTwoPage()); await page.waitForTimeout(500);
check('two-page spread works after leaving split', await ev(() => { const a = app.firstPageView.el.getBoundingClientRect(), b = app.secondPageView.el.getBoundingClientRect(); return app.twoPage && b.left >= a.right - 2 && a.width > 200; }));
await browser.close(); server.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
