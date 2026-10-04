// Playwright harness for v3 additions in app-main2.js / print.js / offline.js (splitters, print, offline dialog).  usage: node dev/main2-test2.mjs
import { chromium } from '/tmp/npmtest/node_modules/playwright/index.mjs';
import { PDFDocument } from '/tmp/npmtest/node_modules/pdf-lib/cjs/index.js';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), web = path.resolve(here, '../web'), out = path.join(here, 'out');
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.pdf': 'application/pdf', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };
const server = http.createServer((req, rsp) => {
  const p = decodeURIComponent(req.url.split('?')[0]); const f = p.startsWith('/dev/') ? path.join(here, p.slice(5)) : path.join(web, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); rsp.end('nf'); return; }
  rsp.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(rsp);
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 700 } });
const page = await ctx.newPage();
let errors = 0, fails = 0;
page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) { console.log('[console.error]', m.text()); errors++; } });
page.on('pageerror', e => { console.log('[pageerror]', e.message); errors++; });
await page.addInitScript(() => { for (const C of [Map, WeakMap]) { if (!C.prototype.getOrInsertComputed) C.prototype.getOrInsertComputed = function (k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); }; if (!C.prototype.getOrInsert) C.prototype.getOrInsert = function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); }; } });
await page.goto(`http://localhost:${port}/dev/main2-test.html`);
await page.waitForFunction(() => window.READY && window.T.PageElement, null, { timeout: 30000 });
const ev = (fn, a) => page.evaluate(fn, a);
const check = (n, ok, x = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!ok) fails++; };
const shot = async n => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(out, 'main2b-' + n + '.png') }); };
const drag = async (sel, dx, dy = 0) => {
  const b = await page.locator(sel).boundingBox(); const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 }); await page.mouse.move(x + dx, y + dy, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(250);
};
const width = sel => ev(s => document.querySelector(s).getBoundingClientRect().width, sel);
const height = sel => ev(s => document.querySelector(s).getBoundingClientRect().height, sel);

await ev(async () => { T.prefs.remove('side_w'); T.prefs.remove('study_w'); T.prefs.remove('study_h'); await T.app.open(T.path); });

// ---------------------------------------------------------------- side panel splitter
await ev(() => T.app.selectPanelTab(1)); await page.waitForTimeout(500);
const w0 = await width('.m2-side');
check('side panel default width', Math.abs(w0 - 190) < 2, String(w0));
check('splitter handle exists', (await page.locator('[data-tag=side_splitter]').count()) === 1);
await shot('01-side-default');
await drag('[data-tag=side_splitter]', 90);
const w1 = await width('.m2-side');
check('mouse drag widens the side panel by ~90', Math.abs(w1 - (w0 + 90)) <= 3, String(w1));
check('width remembered in prefs', (await ev(() => T.prefs.getInt('side_w', 0))) === Math.round(w1));
await shot('02-side-wide');
await drag('[data-tag=side_splitter]', 900);
const w2 = await width('.m2-side');
check('max clamp (<= 520, <= 60% of window)', Math.abs(w2 - 520) <= 1, String(w2));
await drag('[data-tag=side_splitter]', -900);
const w3 = await width('.m2-side');
check('min clamp (140)', Math.abs(w3 - 140) <= 1, String(w3));
// touch + pen via synthetic pointer events
const synth = (type) => ev(async t => {
  const h = document.querySelector('[data-tag=side_splitter]'); const r = h.getBoundingClientRect(); const x0 = r.left + r.width / 2, y = r.top + r.height / 2;
  const fire = (n, x) => h.dispatchEvent(new PointerEvent(n, { pointerId: 9, pointerType: t, isPrimary: true, clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
  fire('pointerdown', x0); fire('pointermove', x0 + 40); fire('pointermove', x0 + 70); fire('pointerup', x0 + 70);
}, type);
await synth('touch'); const w4 = await width('.m2-side');
check('touch drag works', Math.abs(w4 - (w3 + 70)) <= 2, String(w4));
await synth('pen'); const w5 = await width('.m2-side');
check('pen drag works', Math.abs(w5 - (w4 + 70)) <= 2, String(w5));
await page.locator('[data-tag=side_splitter]').focus(); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100);
check('keyboard arrow resizes', Math.abs((await width('.m2-side')) - (w5 + 16)) <= 2);
await page.locator('[data-tag=side_splitter]').dblclick(); await page.waitForTimeout(150);
check('double click resets to default', Math.abs((await width('.m2-side')) - 190) <= 2 && (await ev(() => T.prefs.getInt('side_w', 0))) === 0);
await drag('[data-tag=side_splitter]', 60);
// persisted width is applied when the panel is built / reopened
await ev(() => { T.app.closeSidePanel(); T.app.selectPanelTab(1); }); await page.waitForTimeout(300);
check('width restored after close + reopen', Math.abs((await width('.m2-side')) - 250) <= 3, String(await width('.m2-side')));
// a narrower window re-clamps the remembered width
await page.setViewportSize({ width: 360, height: 700 }); await page.waitForTimeout(300);
check('narrow window clamps to 60%', (await width('.m2-side')) <= 360 * 0.6 + 1, String(await width('.m2-side')));
await page.setViewportSize({ width: 900, height: 700 }); await page.waitForTimeout(300);
await ev(() => T.app.closeSidePanel());

// ---------------------------------------------------------------- study panel splitter
await ev(() => { T.prefs.remove('study_w'); T.app.showStudy(false); }); await page.waitForTimeout(400);
const s0 = await width('.m2-study'), a0 = await width('#pdfarea');
check('study panel default ratio ~1:1.3', s0 > 300 && Math.abs(a0 / s0 - 1.3) < 0.1, `${s0}/${a0}`);
await shot('03-study-default');
await drag('[data-tag=study_splitter]', -120);
const s1 = await width('.m2-study');
check('study splitter widens panel (drag left)', Math.abs(s1 - (s0 + 120)) <= 3, String(s1));
check('study width in prefs', (await ev(() => T.prefs.getInt('study_w', 0))) === Math.round(s1));
await shot('04-study-wide');
await drag('[data-tag=study_splitter]', -2000);
const smax = await width('.m2-study'); const sw = await width('#split');
check('study max clamp leaves >= 260px for the document', Math.abs(smax - (sw - 260)) <= 2, `${smax} of ${sw}`);
await drag('[data-tag=study_splitter]', 2000);
check('study min clamp (220)', Math.abs((await width('.m2-study')) - 220) <= 1);
await page.locator('[data-tag=study_splitter]').dblclick(); await page.waitForTimeout(150);
check('study double click resets', (await ev(() => T.prefs.getInt('study_w', 0))) === 0 && Math.abs((await width('.m2-study')) - s0) <= 3);
// vertical layout (narrow window)
await page.setViewportSize({ width: 500, height: 700 }); await page.waitForTimeout(400);
const h0 = await height('.m2-study');
await drag('[data-tag=study_splitter]', 0, -100);
const h1 = await height('.m2-study');
check('narrow: vertical splitter (drag up grows)', Math.abs(h1 - (h0 + 100)) <= 3 && (await ev(() => T.prefs.getInt('study_h', 0))) === Math.round(h1), `${h0} -> ${h1}`);
await shot('05-study-narrow');
await page.setViewportSize({ width: 900, height: 700 }); await page.waitForTimeout(300);
await ev(() => { T.app.studyVisible = false; T.app.layoutStudyPanel(); });

// ---------------------------------------------------------------- offline dialog
await ev(() => T.app.showAboutOffline()); await shot('06-offline');
const txt = await page.locator('[data-tag=about_offline]').innerText();
for (const t of ['번역 (구글 번역 열기)', '사전 웹 검색', 'YouTube · 온라인 이미지', 'WebView2 런타임 최초 설치', 'PDF 열기', '필기', '검색', 'HWP 변환', 'Office 변환', 'OCR', '내보내기', '인쇄', '문서함'])
  check('offline dialog lists ' + t, txt.includes(t));
await page.click('.ad-btn >> text=닫기'); await page.waitForTimeout(300);

// ---------------------------------------------------------------- print
await ev(() => { window.__prints = []; window.print = () => { window.__prints.push(document.querySelectorAll('.m2-print-page').length); window.__printed = true; }; });
await ev(() => { const s = T.app.store; const m = new T.Mark(); m.page = 2; m.left = .1; m.top = .1; m.right = .6; m.bottom = .14; m.color = 0x66FFDE59 | 0; s.marks.push(m); });
const pdfPages = async () => { const b = await page.pdf({ preferCSSPageSize: true, printBackground: true }); fs.writeFileSync(path.join(out, 'main2b-print.pdf'), b); return (await PDFDocument.load(b)).getPageCount(); };
const runPrint = async (setup) => {
  await ev(() => { window.__printed = false; window.__prints.length = 0; T.app.printDocument(); });
  await page.waitForSelector('[data-tag=print_dialog]'); await setup();
  await page.click('.ad-btn >> text=인쇄'); await page.waitForFunction(() => window.__printed, null, { timeout: 60000 });
};
await ev(() => { T.app.currentPage = 2; });
await runPrint(async () => { await shot('07-print-dialog'); });
check('current page -> 1 page in print DOM', (await ev(() => window.__prints[0])) === 1);
check('print DOM is hidden on screen', (await ev(() => getComputedStyle(document.querySelector('.m2-print-root')).display)) === 'none');
check('PDF of the print view has 1 page', (await pdfPages()) === 1);
await ev(() => window.dispatchEvent(new Event('afterprint'))); await page.waitForTimeout(100);
check('cleanup after print', (await page.locator('.m2-print-root').count()) === 0);
await runPrint(async () => { await page.check('[data-tag="print_range:1"]'); });
check('all pages -> 12', (await ev(() => window.__prints[0])) === 12);
check('PDF has 12 pages (no blank spill)', (await pdfPages()) === 12);
await ev(() => window.dispatchEvent(new Event('afterprint')));
await runPrint(async () => { await page.fill('[data-tag=print_from]', '2'); await page.fill('[data-tag=print_to]', '4'); });
check('range 2~4 -> 3 pages', (await ev(() => window.__prints[0])) === 3 && (await pdfPages()) === 3);
await ev(() => window.dispatchEvent(new Event('afterprint')));
// invalid range keeps the dialog open
await ev(() => { window.__printed = false; T.app.printDocument(); }); await page.waitForSelector('[data-tag=print_dialog]');
await page.fill('[data-tag=print_from]', '5'); await page.fill('[data-tag=print_to]', '99'); await page.click('.ad-btn >> text=인쇄'); await page.waitForTimeout(300);
check('invalid range keeps the dialog + toast', (await page.locator('[data-tag=print_dialog]').count()) === 1 && (await page.locator('.toast').last().innerText()).includes('범위'));
await page.click('.ad-btn >> text=취소'); await page.waitForTimeout(300);
check('cancel prints nothing', !(await ev(() => window.__printed)));
// with / without annotations: compare rendered bytes of page 3
const blobHash = async (ann) => {
  await runPrint(async () => { await page.check('[data-tag=print_range\\:0]').catch(() => {}); if (!ann) await page.uncheck('[data-tag=print_annotations]'); });
  const h = await ev(async () => { const src = document.querySelector('.m2-print-page img').src; const b = await (await fetch(src)).arrayBuffer(); const d = await crypto.subtle.digest('SHA-1', b); window.dispatchEvent(new Event('afterprint')); return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('') + ':' + b.byteLength; });
  return h;
};
const withA = await blobHash(true), withoutA = await blobHash(false);
check('annotations are included only when asked', withA !== withoutA, `${withA.slice(-12)} vs ${withoutA.slice(-12)}`);
// visual check of the print DOM at screen size with print media emulated
await ev(() => { T.app.printDocument(); }); await page.waitForSelector('[data-tag=print_dialog]'); await page.click('.ad-btn >> text=인쇄'); await page.waitForFunction(() => window.__printed, null, { timeout: 60000 });
await page.emulateMedia({ media: 'print' }); await shot('08-print-media'); await page.emulateMedia({ media: 'screen' });
await ev(() => window.dispatchEvent(new Event('afterprint')));
// the page remains usable after printing
check('app DOM visible again', (await ev(() => getComputedStyle(document.getElementById('app')).display)) !== 'none');
console.log(`\n${fails} failed, ${errors} errors`);
await browser.close(); server.close(); process.exit(fails || errors ? 1 : 0);
