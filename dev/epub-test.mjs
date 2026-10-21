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
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const root = document.querySelector('.epub-root'); out.open = !!root;
  const fr = root && root.querySelector('iframe'); const d = fr && fr.contentDocument;
  out.heading = d && d.querySelector('h1') && d.querySelector('h1').textContent;
  out.noScript = d && d.querySelectorAll('script').length === 0;
  out.styled = d && !!d.getElementById('en-style');
  const click = (x, y) => d.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y, bubbles: true }));
  const W = fr.contentWindow.innerWidth;
  // full screen: no bars until the centre is tapped
  out.fullScreen = root.querySelector('.epub-top').hidden && root.querySelector('.epub-bottom').hidden && fr.getBoundingClientRect().height === window.innerHeight;
  out.footer = root.querySelector('.epub-footer').textContent;
  click(W / 2, 200); out.menuShown = !root.querySelector('.epub-top').hidden && !root.querySelector('.epub-bottom').hidden;
  out.progress = root.querySelector('.epub-progress').textContent;
  // settings: larger text re-paginates (page count grows, the frame size stays)
  const total = () => +/\/ (\d+)쪽/.exec(root.querySelector('.epub-progress').textContent)[1];
  const before = total(), frameBefore = fr.getBoundingClientRect().height;
  [...root.querySelectorAll('.epub-btn')].find(b => b.textContent === 'Aa').click();
  const panel = root.querySelector('.epub-panel'); out.panelShown = !panel.hidden;
  const range = panel.querySelector('input[type=range]'); range.value = 250; range.dispatchEvent(new Event('input')); range.dispatchEvent(new Event('change'));
  await sleep(900);
  out.zoomCss = parseFloat(getComputedStyle(d.querySelector('p') || d.body).fontSize) > 29;
  out.pagesBefore = before; out.pagesAfter = total(); out.frameSame = fr.getBoundingClientRect().height === frameBefore;
  // back closes panel first, then menu, then link history, then reader
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); out.panelClosed = panel.hidden && !!document.querySelector('.epub-root');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); out.menuClosed = root.querySelector('.epub-top').hidden && !!document.querySelector('.epub-root');
  d.querySelector('a').click(); await sleep(900);
  const d2 = fr.contentDocument; d2.dispatchEvent(new MouseEvent('click', { clientX: W / 2, clientY: 200, bubbles: true }));
  out.chapterAfterLink = document.querySelector('.epub-progress').textContent;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(900);   // back to the page before the link
  out.backToFirst = fr.contentDocument.querySelector('h1') && fr.contentDocument.querySelector('h1').textContent === '제목';
  out.backAlive = !!document.querySelector('.epub-root');
  // page turn by keyboard stays inside the reader
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); out.turned = !!document.querySelector('.epub-root');
  // the book is kept on the shelf
  const shelfBooks = await E.listBooks(app); out.shelf = shelfBooks.map(b => b.name);
  // pdf
  const pdf = await E.buildPdf(book, E.loadSettings(), () => {}, () => false);
  out.pdfHead = String.fromCharCode(...pdf.slice(0, 5)); out.pdfSize = pdf.length;
  const { PDFDocument } = await import('/vendor/pdflib/pdf-lib.esm.min.js'); out.pages = (await PDFDocument.load(pdf)).getPageCount();
  for (let i = 0; i < 2; i++) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(r => setTimeout(r, 300)); }
  out.closed = !document.querySelector('.epub-root');
  return out;
}, b64);
console.log(JSON.stringify(R, null, 1));
check('title', R.title === '테스트 책'); check('spine', R.spine.length === 2 && R.spine[0] === 'OEBPS/text/a b.xhtml'); check('toc', R.toc.join() === '첫 장,둘째 장' && R.chTitle === '둘째 장');
check('resolve', R.resolve === 'OEBPS/img/c d.png'); check('reader opens', R.open && R.heading === '제목' && R.noScript && R.styled);
check('full screen', R.fullScreen && R.footer.includes('쪽')); check('centre tap shows menu', R.menuShown);
check('settings', R.panelShown && R.zoomCss && R.frameSame); check('re-paginates', R.pagesAfter > R.pagesBefore, R.pagesBefore + ' -> ' + R.pagesAfter);
check('back order', R.panelClosed && R.menuClosed && R.backAlive && R.backToFirst && R.chapterAfterLink.includes('둘째 장') && R.turned); check('shelf', R.shelf.length === 1 && /sample/.test(R.shelf[0]), JSON.stringify(R.shelf)); check('pdf', R.pdfHead === '%PDF-' && R.pages >= 2, 'pages ' + R.pages); check('closed', R.closed);
await browser.close(); server.close(); process.exit(fails ? 1 : 0);
