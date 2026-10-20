// v3.33: folder rename/move/copy/delete, import folder names, text paste, cover page, table cell sizes. usage: node dev/v333-test.mjs
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

const R = await page.evaluate(async () => {
  const out = {};
  const { Table, Shapes } = await import('/js/shapes.js');
  const { LibraryRepository, NotebookFiles } = await import('/js/library.js');
  const { host } = await import('/js/host.js');
  // ---- table weights
  let t = Table.create(3, 4, 0xFF3A3A3C | 0, 0xFFE5F0FF | 0, 0);
  out.plain = t.serialize().includes('@') === false;
  t.setColWeights(Table.dragBorder(t.colWeights(), 0, .1)); t.setRowWeights(Table.dragBorder(t.rowWeights(), 1, .9));
  const s = t.serialize(), back = Table.parse(s);
  out.tableLine = s.split('\n').pop();
  out.tableRound = Math.abs(back.colWeights()[0] - .1) < 1e-3 && Math.abs(back.colWeights().reduce((a, b) => a + b) - 1) < 1e-3 && Math.abs(back.rowWeights()[2] - (1 - .9)) < 1e-3;
  const min = Table.dragBorder([.5, .5], 0, 0, .04); out.minWeight = Math.abs(min[0] - .04) < 1e-9 && Math.abs(min[1] - .96) < 1e-9;
  out.resetOnResize = Table.parse(back.resized(4, 5).serialize()).colW === null;
  out.valid = Shapes.validTable(s);
  const withBg = Table.parse(s); withBg.bg[0] = 0xFFFF0000 | 0; const s2 = withBg.serialize(); const p2 = Table.parse(s2);
  out.bgAndWeights = p2.bg[0] !== 0 && p2.colW && p2.colW.length === 4;
  const c = document.createElement('canvas'); c.width = 300; c.height = 200; Shapes.drawTable(c.getContext('2d'), { left: 10, top: 10, right: 290, bottom: 190, width: () => 280, height: () => 180 }, s2, 300); out.drawn = true;
  // ---- folder names
  out.n1 = LibraryRepository.folderTitle('D:'); out.n2 = LibraryRepository.folderTitle('a:b*c?. '); out.n3 = LibraryRepository.folderTitle('CON'); out.n4 = LibraryRepository.folderTitle('');
  // ---- folder ops
  const lib = app.library, root = lib.root, pdf = host._fake.files.get([...host._fake.files.keys()].find(k => k.endsWith('a.pdf'))).bytes;
  const A = root + '\\주제', B = root + '\\다른';
  await lib.createFolder(root, '주제'); await lib.createFolder(root, '다른'); await lib.createFolder(A, '하위');
  host._fake.put(A + '\\one.pdf', pdf); host._fake.put(A + '\\하위\\two.pdf', pdf);
  lib.folderColor(A, LibraryRepository.FOLDER_COLORS[2]); lib.favorite(A + '\\one.pdf', true);
  await lib.list(A); await lib.list(root);
  const r1 = await lib.transferFolder(A, root, '이름바꿈', true);
  out.renamed = r1.folder.endsWith('이름바꿈') && !(await host.exists(A)) && (await host.exists(r1.folder + '\\하위\\two.pdf'));
  out.keepColor = lib.folderColor(r1.folder) === LibraryRepository.FOLDER_COLORS[2];
  out.keepFav = lib.favorite(r1.folder + '\\one.pdf');
  const r2 = await lib.transferFolder(r1.folder, B, '이름바꿈', false);
  out.copied = (await host.exists(r2.folder + '\\하위\\two.pdf')) && (await host.exists(r1.folder + '\\one.pdf'));
  let intoSelf = false; try { await lib.transferFolder(r1.folder, r1.folder + '\\하위', 'x', true); } catch (e) { intoSelf = true; }
  out.intoSelf = intoSelf;
  const r3 = await lib.transferFolder(r2.folder, root, '옮김', true);
  out.moved = (await host.exists(r3.folder + '\\하위\\two.pdf')) && !(await host.exists(r2.folder));
  const removed = await lib.trashFolder(r3.folder);
  out.trashed = removed.length === 2 && !(await host.exists(r3.folder));
  // ---- bulk import names
  const SRC = 'C:\\Ext\\자료: 모음.';
  host._fake.put(SRC + '\\a.pdf', pdf); host._fake.put(SRC + '\\sub:x\\b.pdf', pdf);
  const imp = await lib.importTree([{ path: SRC + '\\a.pdf', rel: 'a.pdf' }, { path: SRC + '\\sub:x\\b.pdf', rel: 'sub:x\\b.pdf' }], '자료: 모음.', root);
  out.import = imp.imported === 2 && imp.folder.endsWith('자료_ 모음') && (await host.exists(imp.folder + '\\sub_x\\b.pdf'));
  return out;
});
for (const [k, v] of Object.entries(R)) check(k, v === true || (typeof v === 'string' && v !== ''), typeof v === 'string' ? v : '');
check('n1', R.n1 === 'D 드라이브', R.n1); check('n2', R.n2 === 'a_b_c_', R.n2); check('n3', R.n3 === '_CON', R.n3); check('n4', R.n4 === '가져온 폴더', R.n4);

// ---- text paste -> text box
const pasted = await page.evaluate(async () => {
  const before = app.store.elements.length;
  app.dropTarget = [0, .3, .4]; app.dropTime = Date.now();
  app.pasteText('외부에서 복사한 글자\r\n둘째 줄');
  const e = app.store.elements[app.store.elements.length - 1];
  return { added: app.store.elements.length - before, kind: e.kind, text: e.text, left: e.left, top: e.top, h: e.bottom - e.top };
});
check('paste text box', pasted.added === 1 && pasted.kind === 'text' && pasted.text === '외부에서 복사한 글자\n둘째 줄' && Math.abs(pasted.left - .3) < .01 && pasted.h > 0.02, JSON.stringify(pasted));
const viaEvent = await page.evaluate(() => {
  const before = app.store.elements.length;
  const dt = new DataTransfer(); dt.setData('text/plain', '붙여넣기 이벤트');
  document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  return app.store.elements.length - before;
});
check('Ctrl+V text event', viaEvent === 1);

// ---- cover page
const cover = await page.evaluate(async () => {
  const s = app.activeSession, before = app.renderer.pageCount;
  const { coverPng, drawCover, COVER_TEMPLATES } = await import('/js/cover.js');
  const sizes = []; for (let i = 0; i < COVER_TEMPLATES.length; i++) sizes.push((await coverPng({ tpl: i, color: i % 6, title: '영어 단어장 ' + i, subtitle: '2학기', name: '홍길동' })).length);
  const info = await app.library.coverInfo(s.uri);
  const png = await coverPng({ tpl: 1, color: 1, title: '표지' }, info.aspect);
  s.store.save();
  await app.modifyPages(s, 'x', () => app.library.putCover(s.uri, png, false), () => s.store.insertPageAfter(-1), 0, 'fail');
  const mid = app.renderer.pageCount, info2 = await app.library.coverInfo(s.uri);
  await app.modifyPages(s, 'x', () => app.library.putCover(s.uri, png, true), () => {}, 0, 'fail');
  return { sizes, before, mid, after: app.renderer.pageCount, has1: info.has, has2: info2.has, pasteMoved: app.store.elements.some(e => e.page === 1) };
});
check('cover templates render', cover.sizes.length === 8 && cover.sizes.every(n => n > 3000), cover.sizes.join(','));
check('cover inserted as page 1', cover.mid === cover.before + 1 && !cover.has1 && cover.has2 && cover.pasteMoved, JSON.stringify(cover));
check('cover replaced keeps page count', cover.after === cover.mid);

// ---- table border grips on the page
const grip = await page.evaluate(async () => {
  const { PageElement } = await import('/js/store.js'); const { Table } = await import('/js/shapes.js');
  const els = app.store.elements; els.length = 0;
  const e = new PageElement(); e.page = app.currentPage; e.kind = 'table'; e.text = Table.create(2, 3, 0xFF3A3A3C | 0, 0xFFE5F0FF | 0, 0).serialize(); e.left = .1; e.top = .1; e.right = .7; e.bottom = .4; els.push(e);
  const view = app.viewForPage(e.page); app.redrawPages(); view.selectElement(e);
  const dest = view.contentRect(), b = { l: dest.left + e.left * dest.width(), t: dest.top + e.top * dest.height(), w: (e.right - e.left) * dest.width(), h: (e.bottom - e.top) * dest.height() };
  const spots = view._handleSpots(e, { left: b.l, top: b.t, right: b.l + b.w, bottom: b.t + b.h, centerX: () => 0, centerY: () => 0, width: () => b.w, height: () => b.h }, dest);
  const g = spots.find(sp => sp.id === 101);   // border between column 1 and 2
  const ev = (action, x, y) => ({ action, x, y, pointerCount: 1, toolType: 'mouse', pressure: 1, getX() { return x; }, getY() { return y; } });
  view._handleElementGesture(ev(0, g.x, g.y), dest);
  view._handleElementGesture(ev(2, g.x + 60, g.y), dest);
  const live = Table.parse(e.text).colWeights();
  view._handleElementGesture(ev(1, g.x + 60, g.y), dest);
  return { n: spots.filter(sp => sp.kind === 'g').length, live, saved: e.text.split('\n').pop() };
});
check('table grips (2 col borders + 1 row border)', grip.n === 3, JSON.stringify(grip));
check('dragging a column grip resizes live and stores @ line', grip.live[0] > 0.45 && grip.saved.startsWith('@'), JSON.stringify(grip));
await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); process.exit(fails ? 1 : 0);
