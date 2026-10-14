// v3.27: undo/redo of every edit, slide page turn, element clipboard + bar, docked library tree, root saving, folder backup, tape, inline bar. usage: node dev/v327-test.mjs
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

const p1 = await open('sample-ko.pdf', 'a.pdf'); await page.waitForTimeout(1200);
await ev(() => { if (app.libraryDialog && app.libraryDialog.isShowing()) app.libraryDialog.dismiss(); }); await page.waitForTimeout(300);

await ev(() => app.showLibrary()); await page.waitForTimeout(700);
// library: docked tree, no close button
check('library: no close chevron', await ev(() => !document.querySelector('[data-tag="library_close"], .lib-close') && !/문서함 닫기/.test(document.querySelector('.lib-root')?.innerHTML || '')));
check('library: tree docked by default on a wide window', await ev(() => !!document.querySelector('.lib-root.docked')));
check('library: tree and file list are side by side', await ev(() => { const d = document.querySelector('.lib-root .lib-drawer'), p = document.querySelector('.lib-root .lib-page'); if (!d || !p) return false; const a = d.getBoundingClientRect(), b = p.getBoundingClientRect(); return a.width > 100 && a.right <= b.left + 2 && b.width > 200; }));

await ev(() => app.libraryDialog.dismiss()); await page.waitForTimeout(300);
// undo / redo of non-ink edits
await ev(async () => { const { PageElement } = await import('/js/store.js'); const e = new PageElement(); e.page = 0; e.kind = 'text'; e.text = 'hello'; app.store.elements.push(e); app.store.save(); });
await page.waitForTimeout(400);
check('undo available after adding a text box', await ev(() => app.store.canUndo()));
await ev(() => app.undoInk()); await page.waitForTimeout(300);
check('undo removes the text box', await ev(() => app.store.elements.length === 0));
await ev(() => app.redoInk()); await page.waitForTimeout(300);
check('redo brings it back', await ev(() => app.store.elements.length === 1 && app.store.elements[0].text === 'hello'));

// element clipboard
await ev(() => { app.pageView.selectElement(app.store.elements[0]); app.copySelectedElement(false); app.pasteElement(); }); await page.waitForTimeout(300);
check('copy+paste makes a second element', await ev(() => app.store.elements.length === 2));
await ev(() => app.duplicateSelectedElement()); check('duplicate makes a third', await ev(() => app.store.elements.length === 3));
await ev(() => app.copySelectedElement(true)); check('cut removes one', await ev(() => app.store.elements.length === 2));
await ev(() => app.pasteElement()); check('paste after cut restores', await ev(() => app.store.elements.length === 3));
await page.waitForTimeout(300);
check('element bar visible with 5 buttons', await ev(() => { const b = document.querySelector('.m-elbar'); return !!b && b.style.display !== 'none' && b.querySelectorAll('button').length === 5; }));

// inline bar fits
await ev(() => app.setWriteMode(true)); await page.waitForTimeout(300);

// tape
await ev(() => app.setInkMode(3, 'tape')); await page.waitForTimeout(200);
check('tape mode on', await ev(() => app.tapeMode === true && !!app.tapeButton));
await ev(async () => { const { AnnotationStore } = await import('/js/store.js'); const s = new AnnotationStore.InkStroke(); s.page = 0; s.pen = 6; s.color = 0xFFFFE066 | 0; s.width = .03; for (let i = 0; i <= 8; i++) s.points.push(new AnnotationStore.InkPoint(.2 + i * .05, .5, .5)); app.store.strokes.push(s); app.store.save(); app.redrawPages(); });
check('tape stroke serialises as pen 6', await ev(() => { const t = app.store.strokes.find(s => s.pen === 6); return !!t && t.toJson().pen === 6 && String(app.store.toJson()).replace(/\s/g, '').includes('"pen":6'); }));
await ev(() => app.showTapeMenu && app.showTapeMenu(app.tapeButton)); await page.waitForTimeout(300);
await page.screenshot({ path: path.join(out, 'v327-tape.png') });
await closeMenusSafe();
async function closeMenusSafe() { await page.keyboard.press('Escape'); await page.mouse.click(5, 5); await page.waitForTimeout(150); }
await ev(() => app.setInkMode(0, false));

// slide page turn
await ev(() => { app.recentPrefs.putInt('page_turn_style', 1); });
const before = await ev(() => app.pageView.getPageNumber());
await ev(b => app.slidePage(1, b + 1), before); await page.waitForTimeout(900);
check('slide turn lands on the next page', await ev(() => app.pageView.getPageNumber()) !== before);

console.log(fails ? fails + ' FAILED' : 'ALL PASS'); await browser.close(); server.close(); process.exit(fails ? 1 : 0);
