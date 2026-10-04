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
check('lasso shapes are icon-only buttons with tooltips', await ev(() => [...app.lassoBar.querySelectorAll('.m3-lchip')].every(c => c.textContent.trim() === '' && c.title && c.querySelector('svg'))));
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
// v1.27: slim one-row bar, above the box, font/colour rows only after "Aa"
const geo = await ev(() => { const b = app.inlineBar.getBoundingClientRect(), t = app.inlineEdit.getBoundingClientRect(), l = app.viewportLayer.getBoundingClientRect(); return { barBottom: b.bottom, boxTop: t.top, barH: b.height, panelShown: getComputedStyle(app.inlineBar.querySelector('.m3-inline-panel')).display !== 'none', barL: b.left - l.left, barR: b.right - l.left, w: l.width }; });
check('style bar = two compact icon rows, hidden font/colour panel', geo.barH < 90 && !geo.panelShown, JSON.stringify(geo));
check('style bar sits above the box (clear of the text)', geo.barBottom <= geo.boxTop, JSON.stringify(geo));
await shot('04b-inline-bar-above');
await page.click('[data-tag="text_bold"]'); await page.click('[aria-label="글자 크게"]'); await page.click('[aria-label="글자 크게"]');
await page.click('[data-tag="text_style_toggle"]'); await page.waitForTimeout(150);
check('Aa opens font + colour rows (+ rainbow chip)', await ev(() => getComputedStyle(app.inlineBar.querySelector('.m3-inline-panel')).display !== 'none') && (await page.locator('[data-tag="text_colors"] [data-tag="color_more"]').count()) === 1);
await shot('04c-inline-bar-open');
// v3 toolbar: icon-only formatting buttons (tooltips + aria-labels)
const tb = await ev(() => { const b = [...app.inlineBar.querySelectorAll('.m3-tbtn,.m3-ib')].filter(x => x.dataset.tag !== 'text_style_toggle'); return { n: b.length, textless: b.every(x => x.textContent.trim() === '' && x.querySelector('svg') && x.title && x.getAttribute('aria-label')) }; });
check('typing toolbar: align/list/underline/B/I are icon buttons with tooltips', tb.n >= 13 && tb.textless, JSON.stringify(tb));
check('bold/size from toolbar applied to element', await ev(() => app.inlineElement.bold === true && app.inlineBar.querySelector('[data-tag="text_bold"]').classList.contains('on')));
await page.click('[data-tag="text_underline"]'); await page.click('[data-tag="text_align_center"]'); await page.click('[data-tag="text_strike"]');
check('underline + strike + center set on element (Android int align)', await ev(() => app.inlineElement.underline === true && app.inlineElement.strike === true && app.inlineElement.align === 1 && app.inlineEdit.style.textAlign === 'center' && app.inlineEdit.style.textDecoration.includes('underline') && app.inlineEdit.style.textDecoration.includes('line-through')));
// list markers are plain text typed into the box (like Android v1.29.0)
await page.keyboard.press('Control+A');
await page.click('[data-tag="text_list_bullet"]');
check('bullet list: every selected line gets "• "', await ev(() => app.inlineEdit.value === '• 안녕하세요 PDF Note\n• 두번째 줄 입력' && app.inlineElement.text === app.inlineEdit.value && app.inlineElement.list === undefined), await ev(() => JSON.stringify(app.inlineEdit.value)));
await shot('04d-inline-bullet');
await page.keyboard.press('Control+A'); await page.click('[data-tag="text_list_number"]');
check('numbered list: "1. " "2. " (switches kind)', await ev(() => app.inlineEdit.value === '1. 안녕하세요 PDF Note\n2. 두번째 줄 입력'));
await page.keyboard.press('Control+A'); await page.click('[data-tag="text_list_check"]');
check('check list: "☐ " on every line', await ev(() => app.inlineEdit.value === '☐ 안녕하세요 PDF Note\n☐ 두번째 줄 입력' && app.inlineBar.querySelector('[data-tag="text_list_check"]').classList.contains('on')));
await page.keyboard.press('Control+A'); await page.click('[data-tag="text_list_check"]');
check('check list button again: all lines become "☑ "', await ev(() => app.inlineEdit.value === '☑ 안녕하세요 PDF Note\n☑ 두번째 줄 입력'));
await shot('04e-inline-check');
await page.keyboard.press('Control+A'); await page.click('[data-tag="text_list_check"]');
check('check list button a third time removes the markers', await ev(() => app.inlineEdit.value === '안녕하세요 PDF Note\n두번째 줄 입력'));
// Enter continues a list item; Enter on an empty item ends the list
await page.keyboard.press('Control+A'); await page.click('[data-tag="text_list_number"]');
await page.keyboard.press('Control+End'); await page.keyboard.press('Enter'); await page.keyboard.type('셋째');
check('Enter in a numbered list starts "3. "', await ev(() => app.inlineEdit.value.endsWith('\n3. 셋째') && app.inlineElement.text === app.inlineEdit.value), await ev(() => JSON.stringify(app.inlineEdit.value)));
await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
check('Enter on an empty item ends the list (marker removed)', await ev(() => app.inlineEdit.value.endsWith('\n3. 셋째\n') && !/\n4\. $/.test(app.inlineEdit.value)), await ev(() => JSON.stringify(app.inlineEdit.value)));
await page.keyboard.press('Backspace');
await page.keyboard.press('Control+A'); await page.click('[data-tag="text_list_bullet"]'); await page.keyboard.press('Control+End'); await page.keyboard.press('Enter'); await page.keyboard.type('x');
check('Enter in a bullet list starts "• "', await ev(() => app.inlineEdit.value.endsWith('\n• x')), await ev(() => JSON.stringify(app.inlineEdit.value)));
await page.keyboard.press('Control+A'); await page.click('[data-tag="text_list_bullet"]');   // all bullets -> removed
await page.keyboard.press('Control+A'); await page.click('[data-tag="text_list_bullet"]'); await page.click('[data-tag="text_align_left"]'); await page.click('[data-tag="text_underline"]'); await page.click('[data-tag="text_strike"]');
await page.click('[data-tag="text_fonts"] .m2-seg-chip:nth-child(2)'); await page.click('[data-tag="text_colors"] .m2-dot:nth-child(3)');
await shot('05-inline-styled');
check('size 18pt', (await ev(() => app.inlineSize.textContent)) === '18pt', await ev(() => app.inlineSize.textContent));
// box near the top of the viewport: bar goes below; handles stay on screen
await ev(() => { const e = app.inlineElement; const h = e.bottom - e.top; e.top = 0; e.bottom = h; e.left = 0; e.right = Math.max(e.right - 0, .45); });
await page.waitForTimeout(250);
const geo2 = await ev(() => { const b = app.inlineBar.getBoundingClientRect(), t = app.inlineEdit.getBoundingClientRect(), l = app.viewportLayer.getBoundingClientRect(); const hs = [app.inlineMove, app.inlineDelete, app.inlineResize].map(x => { const r = x.getBoundingClientRect(); return r.left >= l.left && r.top >= l.top && r.right <= l.right && r.bottom <= l.bottom; }); return { below: b.top >= t.bottom - 1 || b.top <= l.top + 6, barTop: b.top - l.top, boxTop: t.top - l.top, hs }; });
check('bar moves below/top when there is no room above', geo2.barTop >= 0 && !(geo2.barTop < 0), JSON.stringify(geo2));
check('handles clamped inside the viewport', geo2.hs.every(Boolean), JSON.stringify(geo2));
await shot('05b-inline-top');
await ev(() => { const e = app.inlineElement; const h = e.bottom - e.top; e.top = .3; e.bottom = .3 + h; });
await page.waitForTimeout(300);
// drag move handle
const before = await ev(() => app.inlineElement.left);
const mb = await page.locator('.m3-handle').first().boundingBox();
await page.mouse.move(mb.x + 15, mb.y + 15); await page.mouse.down(); await page.mouse.move(mb.x + 75, mb.y + 55, { steps: 5 }); await page.mouse.up();
check('move handle moved element', (await ev(() => app.inlineElement.left)) > before);
await page.click('[data-tag="text_done"]');
check('committed into store', await ev(() => app.store.elements.length === 1 && app.store.elements[0].kind === 'text' && app.store.elements[0].bold && app.store.elements[0].font === 'serif' && !app.inlineEdit && window.AP.skip === null), '');
check('align/underline/strike persisted with the Android keys; list markers are plain text', await ev(() => { const e = app.store.elements[0], o = JSON.parse(JSON.stringify(e.toJson())); return e.text.startsWith('• ') && o.align === 0 && o.underline === false && o.strike === false && o.stretch === false && !('list' in o) && !('checked' in o); }));
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
const help = await ev(() => { const c = document.querySelector('.m3-help'), r = c.getBoundingClientRect(); return { heads: [...c.querySelectorAll('.m3-help-h')].map(x => x.textContent), items: c.querySelectorAll('.m3-help-item').length, align: getComputedStyle(c).textAlign, titleAlign: getComputedStyle(c.querySelector('.m3-help-title')).textAlign, w: r.width, h: r.height, win: innerHeight }; });
check('help: 14 chapters, 55 items, left aligned, tall card', help.heads.length === 14 && help.items === 55 && help.align === 'left' && help.h > help.win * .85 && help.heads[0] === '1. 기본 원리' && help.heads[13] === '14. 인터넷 연결이 없을 때', JSON.stringify({ ...help, heads: help.heads.length }));
const helpText = await ev(() => document.querySelector('.m3-help').textContent);
check('help: Everynote name, offline section lists internet-needed + offline features', await ev(() => document.querySelector('.m3-help-title').textContent) === 'Everynote 사용법' && !/PDF Note/.test(helpText)
  && ['구글 번역', '사전 웹 검색', 'YouTube', 'WebView2', 'LibreOffice', 'Windows OCR 언어팩', '인쇄', '문서함'].every(k => helpText.includes(k)));
check('help ch.6: 색·모양·굵기 wording of Android v1.30.0 (old wording gone)', helpText.includes('색·모양·굵기') && helpText.includes('색, 굵기 막대, 모양(직선 / 자유형)을 고를 수 있습니다') && helpText.includes('자유형은 손가락이나 펜으로 원하는 모양대로 그립니다') && !helpText.includes('색을 고를 수 있고, 무지개 칩'));
await page.evaluate(() => document.querySelector('.m3-help-body').scrollTo(0, 99999)); await shot('21b-help-end');
await page.click('.m3-help-ok'); await page.waitForTimeout(300);
check('help closed', (await page.locator('.m3-help').count()) === 0);
await ev(() => { window.__ui2 = []; for (const n of ['printDocument', 'showAboutOffline']) app[n] = () => window.__ui2.push(n); app.showTools(); }); await page.waitForTimeout(300);
for (const n of ['인쇄', '오프라인 사용 안내']) { await page.locator('.m2-tile[aria-label="' + n + '"]').first().click(); await page.waitForTimeout(250); await ev(() => app.showTools()); await page.waitForTimeout(250); }
check('tools sheet: print / offline guide call UI2 methods', (await ev(() => window.__ui2.join())) === 'printDocument,showAboutOffline', await ev(() => window.__ui2.join()));
await page.click('.m2-bs-head [aria-label=닫기]'); await page.waitForTimeout(300);
await ev(() => app.showTools()); await page.waitForTimeout(300);
check('export tiles: 원본 파일 내보내기 present, 본문 미리보기 저장 removed', (await page.locator('.m2-tile[aria-label="원본 파일 내보내기"]').count()) === 1 && (await page.locator('.m2-tile[aria-label="본문 미리보기 저장"]').count()) === 0);
await page.click('.m2-bs-head [aria-label=닫기]'); await page.waitForTimeout(300);

console.log(errors ? `ERRORS: ${errors}` : 'no console errors', fails ? `FAILS: ${fails}` : 'all passed');
await browser.close(); server.close(); process.exit(fails || errors ? 1 : 0);
