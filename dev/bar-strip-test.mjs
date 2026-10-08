// v3.17: bottom bar (9 items), writing tool strip, split active frame + arrows, eraser default partial. usage: node dev/bar-strip-test.mjs
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
// eraser default
check('eraser default is partial', await ev(() => app.eraserMode() === 1));
// bottom bar
const labels = await ev(() => [...document.querySelectorAll('[data-tag="read_bar"] > *')].map(e => e.getAttribute('aria-label') || e.title));
console.log(labels.join(' | '));
check('bar has 8 items after the page label (eraser next to 필기 모드), no outline', labels.length === 9 && labels[4] === '지우개' && !labels.some(l => /개요/.test(l)) && labels[0] === '페이지 이동', labels.join('|'));
check('bar has layout button as 9th', await ev(() => !!document.querySelector('[data-tag="reading_toolbar"] > .m-barlayout')));
await ev(() => document.querySelector('[data-tag="page_indicator"]').click()); await page.waitForTimeout(300);
check('page button opens submenu with outline', await ev(() => /문서 개요/.test(document.body.innerText) && /마지막 페이지/.test(document.body.innerText)));
await page.keyboard.press('Escape'); await page.mouse.click(5, 5); await page.waitForTimeout(200);
// strip
const stripVis = () => ev(() => { const w = app.writeBar.parentElement; return getComputedStyle(w).display !== 'none' && w.getBoundingClientRect().height > 0; });
check('strip hidden in read mode', !(await stripVis()));
await ev(() => document.querySelector('[aria-label="필기 모드"]').click()); await page.waitForTimeout(200);
check('strip shown in write mode', await stripVis() && await ev(() => app.writeMode));
await ev(() => document.querySelector('[aria-label="필기 모드"]').click()); await page.waitForTimeout(200);
check('second tap hides strip, stays in write mode, remembered', !(await stripVis()) && await ev(() => app.writeMode && app.recentPrefs.getBoolean('write_strip', true) === false));
await ev(() => document.querySelector('[aria-label="필기 모드"]').click()); await page.waitForTimeout(200);
check('third tap shows again', await stripVis());
await ev(() => app.showInsertMenu(document.querySelector('[aria-label^="삽입"]'))); await page.waitForTimeout(250);
check('insert menu has 메모 추가', await ev(() => /메모 추가/.test(document.body.innerText)));
await page.mouse.click(5, 5); await page.waitForTimeout(200);
await page.screenshot({ path: path.join(out, 'bar-strip.png') });
// split frame + arrows
await ev(() => app.setWriteMode(false));
await open('sample.pdf', 'b.pdf'); await page.waitForTimeout(1200);
await ev(() => app.switchDocument(app.sessions[0])); await page.waitForTimeout(500);
await ev(() => app.toggleSplit()); await page.waitForTimeout(1200);
const geo = () => ev(() => { const p = app.firstPageView.el.getBoundingClientRect(), pv = app.previousOverlay.getBoundingClientRect(), nx = app.nextOverlay.getBoundingClientRect(), cs = getComputedStyle(app.firstPageView.el, '::after'); return { p: p.toJSON(), pv: pv.toJSON(), nx: nx.toJSON(), bw: cs.borderTopWidth, bc: cs.borderTopColor, bl: cs.borderLeftWidth, br: cs.borderRightWidth, bb: cs.borderBottomWidth, vis: [app.previousOverlay, app.nextOverlay].map(e => getComputedStyle(e).display) }; });
let g = await geo(); console.log(JSON.stringify(g));
check('active pane has 5px blue frame on all four sides', g.bw === '5px' && g.bl === '5px' && g.br === '5px' && g.bb === '5px' && g.bc === 'rgb(0, 122, 255)');
check('arrows sit inside the active pane edges', g.pv.left >= g.p.left && g.pv.left < g.p.left + 20 && g.nx.right <= g.p.right && g.nx.right > g.p.right - 20, `${g.pv.left} ${g.p.left} ${g.nx.right} ${g.p.right}`);
await ev(() => app.swapSplitPanes()); await page.waitForTimeout(200);
g = await geo(); const pl = await ev(() => parseFloat(app.previousOverlay.style.left)); check('after swap the arrows follow the active pane', Math.abs(pl - (g.p.left + 8)) < 1 && g.nx.right <= g.p.right + 1 && g.nx.right > g.p.right - 20, `${pl} ${g.p.left} ${g.nx.right} ${g.p.right}`);
await page.screenshot({ path: path.join(out, 'bar-split.png') });
await ev(() => app.exitSplit()); await page.waitForTimeout(300);
g = await geo(); check('after exit arrows back at window edges', g.pv.left < 20 + g.p.left && g.nx.right > g.p.right - 20 && await ev(() => app.previousOverlay.style.left === ''));
await browser.close(); server.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0);
