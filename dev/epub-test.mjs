// EPUB reader: zip/package parsing, reader layer, settings, back handling, PDF conversion. usage: node dev/epub-test.mjs
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), web = path.resolve(here, '../web');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.pdf': 'application/pdf', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };
const server = http.createServer((req, rsp) => {
  const p = decodeURIComponent(req.url.split('?')[0]); const f = path.join(web, p === '/' ? 'index.html' : p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); rsp.end('nf'); return; }
  rsp.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(rsp);
}).listen(0);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
await page.addInitScript(() => { for (const C of [Map, WeakMap]) { if (!C.prototype.getOrInsertComputed) C.prototype.getOrInsertComputed = function (k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); }; if (!C.prototype.getOrInsert) C.prototype.getOrInsert = function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); }; } });
let fails = 0; const check = (n, ok, x = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!ok) fails++; };
await page.goto(`http://localhost:${server.address().port}/`);
await page.waitForFunction(() => window.app && window.app.library, null, { timeout: 30000 });
await page.waitForTimeout(1000);
const b64 = fs.readFileSync(path.join(here, 'samples', 'sample.epub')).toString('base64');
const R = await page.evaluate(async b64 => {
  const out = {}; const { host } = await import('/js/host.js'); const E = await import('/js/epub.js');
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const book = await E.EpubBook.open(bytes);
  out.title = book.title; out.spine = book.spine; out.toc = book.toc.map(t => t.title); out.chTitle = book.chapterTitle(1);
  out.resolve = E.resolvePath('OEBPS/text/', '../img/c%20d.png');
  const p = app.library.root + '\\sample.epub'; host._fake.put(p, bytes);
  await app.openPdf(p, false, 0, true);
  await new Promise(r => setTimeout(r, 1200));
  const root = document.querySelector('.epub-root'); out.open = !!root;
  const fr = root && root.querySelector('iframe'); const d = fr && fr.contentDocument;
  out.heading = d && d.querySelector('h1') && d.querySelector('h1').textContent;
  out.noScript = d && d.querySelectorAll('script').length === 0;
  out.styled = d && !!d.getElementById('en-style');
  out.progress = root.querySelector('.epub-progress').textContent;
  // settings
  [...root.querySelectorAll('.epub-btn')].find(b => b.textContent === 'Aa').click();
  const panel = root.querySelector('.epub-panel'); out.panelShown = !panel.hidden;
  const range = panel.querySelector('input[type=range]'); range.value = 150; range.dispatchEvent(new Event('input'));
  out.zoomCss = d.getElementById('en-style').textContent.includes('zoom:1.5');
  // back closes panel first, then link history, then reader
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); out.panelClosed = panel.hidden && !!document.querySelector('.epub-root');
  d.querySelector('a').click(); await new Promise(r => setTimeout(r, 700));
  out.chapterAfterLink = document.querySelector('.epub-progress').textContent;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(r => setTimeout(r, 700));
  out.backToFirst = document.querySelector('.epub-progress').textContent.includes('1/2') && !!document.querySelector('.epub-root');
  // pdf
  const pdf = await E.buildPdf(book, E.loadSettings(), () => {}, () => false);
  out.pdfHead = String.fromCharCode(...pdf.slice(0, 5)); out.pdfSize = pdf.length;
  const { PDFDocument } = await import('/vendor/pdflib/pdf-lib.esm.min.js'); out.pages = (await PDFDocument.load(pdf)).getPageCount();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(r => setTimeout(r, 300));
  out.closed = !document.querySelector('.epub-root');
  return out;
}, b64);
console.log(JSON.stringify(R, null, 1));
check('title', R.title === '테스트 책'); check('spine', R.spine.length === 2 && R.spine[0] === 'OEBPS/text/a b.xhtml'); check('toc', R.toc.join() === '첫 장,둘째 장' && R.chTitle === '둘째 장');
check('resolve', R.resolve === 'OEBPS/img/c d.png'); check('reader opens', R.open && R.heading === '제목' && R.noScript && R.styled);
check('settings', R.panelShown && R.zoomCss); check('back order', R.panelClosed && R.chapterAfterLink.includes('2/2') && R.backToFirst); check('pdf', R.pdfHead === '%PDF-' && R.pages >= 2, 'pages ' + R.pages); check('closed', R.closed);
await browser.close(); server.close(); process.exit(fails ? 1 : 0);
