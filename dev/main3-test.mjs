// Playwright harness for app-main3.js.  usage: node dev/main3-test.mjs  (screenshots in dev/out/main3-*.png)
import { chromium } from '/tmp/npmtest/node_modules/playwright/index.mjs';
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
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 700 }, permissions: ['microphone'] });
const page = await ctx.newPage();
let errors = 0;
page.on('response', r => { if (r.status() >= 400) console.log('[http]', r.status(), r.url()); });
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') { console.log('[console]', m.text()); if (m.type() === 'error') errors++; } });
page.on('pageerror', e => { console.log('[pageerror]', e.message); errors++; });
await page.addInitScript(() => { for (const C of [Map, WeakMap]) { if (!C.prototype.getOrInsertComputed) C.prototype.getOrInsertComputed = function (k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); }; if (!C.prototype.getOrInsert) C.prototype.getOrInsert = function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); }; } });
await page.goto(`http://localhost:${port}/dev/main3-test.html`);
await page.waitForFunction(() => window.READY, null, { timeout: 30000 });
await page.evaluate(async () => { window.AP = (await import('/js/painter.js')).AnnotationPainter; });
let fails = 0;
const ev = (fn, a) => page.evaluate(fn, a);
const check = (n, ok, x = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!ok) fails++; };
const shot = async n => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(out, 'main3-' + n + '.png') }); };
const click = sel => page.click(sel);

// ---- tools sheet
await ev(() => app.showTools()); await shot('01-tools');
check('tools sheet tiles', (await page.locator('.m2-tile').count()) >= 35, String(await page.locator('.m2-tile').count()));
await page.click('.m2-tile[aria-label="올가미·영역 캡처"]'); await page.waitForTimeout(250);
check('lasso on + bar visible', await ev(() => app.pageView.isLassoMode() && app.lassoBar.style.display !== 'none'));
await shot('02-lasso');
await page.click('[data-tag="lasso_shape_1"]'); await shot('03-lasso-rect');
check('lasso shape rect', (await ev(() => app.lassoShape)) === 1);
await page.click('[aria-label="올가미 종료"]');
check('lasso end calls setInkMode(0)', await ev(() => calls.some(c => c[0] === 'setInkMode' && c[1] === 0)) && (await ev(() => app.lassoBar.style.display)) === 'none');
await ev(() => app.showTools()); await page.click('.m2-tile[aria-label="화면 켜 둠"]'); await page.waitForTimeout(250);
check('keep_awake pref toggled', await ev(() => localStorage.getItem('pdfnote.keep_awake') === 'true'));
await ev(() => { localStorage.removeItem('pdfnote.keep_awake'); });

// ---- inline typing
await ev(() => { const e = app.newTextBox(0, .2, .3); app.beginInlineText(e, true); });
await page.waitForSelector('.m3-inline-text'); await page.waitForTimeout(200);
await page.keyboard.type('안녕하세요 PDF Note\n두번째 줄 입력');
await shot('04-inline');
check('inline textarea has focus + text', await ev(() => app.inlineEdit.value.includes('두번째') && app.inlineElement.text.includes('안녕')));
await page.click('[data-tag="text_bold"]'); await page.click('[aria-label="글자 크게"]'); await page.click('[aria-label="글자 크게"]');
await page.click('[data-tag="text_fonts"] .m2-seg-chip:nth-child(2)'); await page.click('[data-tag="text_colors"] .m2-dot:nth-child(3)');
await shot('05-inline-styled');
check('size 18pt', (await ev(() => app.inlineSize.textContent)) === '18pt', await ev(() => app.inlineSize.textContent));
// drag move handle
const before = await ev(() => app.inlineElement.left);
const mb = await page.locator('.m3-handle').first().boundingBox();
await page.mouse.move(mb.x + 15, mb.y + 15); await page.mouse.down(); await page.mouse.move(mb.x + 75, mb.y + 55, { steps: 5 }); await page.mouse.up();
check('move handle moved element', (await ev(() => app.inlineElement.left)) > before);
await page.click('[data-tag="text_done"]');
check('committed into store', await ev(() => app.store.elements.length === 1 && app.store.elements[0].kind === 'text' && app.store.elements[0].bold && app.store.elements[0].font === 'serif' && !app.inlineEdit && window.AP.skip === null), '');
await shot('06-after-commit');
const h0 = await ev(() => { const e = app.store.elements[0]; return [e.bottom - e.top, e.textSize]; });
check('box fitted to content', h0[0] > .03, JSON.stringify(h0));
check('text style prefs saved', await ev(() => localStorage.getItem('pdfnote.text_font') === 'serif'));
// edit existing, then delete
await ev(() => { const e0 = app.store.elements[0]; app.beginInlineText(app.elementAt(0, (e0.left + e0.right) / 2, (e0.top + e0.bottom) / 2), false); }); await page.waitForSelector('.m3-inline-text');
await page.click('[data-tag="inline_delete"]');
check('delete removes element', await ev(() => app.store.elements.length === 0 && !app.inlineElement));
// empty fresh box dropped
await ev(() => app.beginInlineText(app.newTextBox(0, .1, .1), true)); await page.waitForSelector('.m3-inline-text'); await ev(() => app.commitInlineText());
check('empty fresh dropped', await ev(() => app.store.elements.length === 0));

// ---- action sheet
await ev(() => app.showActionSheet('메모 포스트잇 표시', ['펼쳐서 표시', '최소화', '숨기기'], 1, i => { window.picked = i; })); await shot('09-action-sheet');
await page.click('.ad-cell:has-text("숨기기")'); await page.waitForTimeout(250);
check('action sheet pick', (await ev(() => window.picked)) === 2);

// ---- recordings
await ev(() => app.selectPanelTab(3)); await shot('15-recordings-empty');
await page.click('[data-tag="record_button"]'); await page.waitForSelector('[data-tag="recorder_bar"]'); await page.waitForTimeout(1800);
await shot('16-recording');
check('recorder active + time', await ev(() => !!app.recorder && /녹음 중 0:0[1-9]/.test(app.recorderTime.textContent)), await ev(() => app.recorderTime.textContent));
await page.click('[data-tag="recorder_stop"]'); await page.waitForTimeout(1500);
check('clip attached', await ev(() => app.store.elements.some(e => e.kind === 'audio' && e.asset.endsWith('.m4a') && /^0:0\d$/.test(e.text))), await ev(() => JSON.stringify(app.store.elements.map(e => [e.kind, e.asset, e.text, e.page]))));
check('recorder bar removed', (await page.locator('[data-tag="recorder_bar"]').count()) === 0);
await shot('17-recordings-list');
await page.click('[data-tag="recording_item"]'); await page.waitForSelector('[data-tag="audio_play"]'); await page.waitForTimeout(500); await shot('18-audio-player');
check('audio time label', /0:0\d \/ 0:0\d/.test(await page.locator('[data-tag="audio_time"]').textContent()), await page.locator('[data-tag="audio_time"]').textContent());
await page.click('[data-tag="audio_play"]'); await page.waitForTimeout(700);
check('audio playing label', (await page.locator('[data-tag="audio_play"]').textContent()).includes('일시정지'));
await page.click('.ad-btn:has-text("닫기")'); await page.waitForTimeout(300);
// short recording discarded
await ev(() => app.startRecording()); await page.waitForTimeout(300); await ev(() => app.stopRecording(true)); await page.waitForTimeout(800);
check('short recording discarded', await ev(() => app.store.elements.filter(e => e.kind === 'audio').length === 1));
// delete recording
await page.locator('[aria-label="녹음 삭제"]').first().click(); await page.waitForTimeout(300);
check('recording deleted', await ev(() => app.store.elements.filter(e => e.kind === 'audio').length === 0));

// ---- lifecycle
await ev(async () => { app.onStop(); await app.flushAll(); });
check('onStop/flushAll ok', true);
// ---- help
await ev(() => app.showHelp()); await shot('21-help');
await page.click('.ad-btn:has-text("확인")'); await page.waitForTimeout(300);
console.log(errors ? `ERRORS: ${errors}` : 'no console errors', fails ? `FAILS: ${fails}` : 'all passed');
await browser.close(); server.close(); process.exit(fails || errors ? 1 : 0);
