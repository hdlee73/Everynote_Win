// Playwright harness for web/js/search.js. usage: node dev/search-test.mjs
import { chromium } from '/tmp/npmtest/node_modules/playwright/index.mjs';
import { serve } from './server.mjs';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const server = await serve(8171);
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await browser.newPage();
page.on('console', m => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
// serve the harness page from dev/ through a route
await page.route('**/search-test.html', r => r.fulfill({ contentType: 'text/html', body: fs.readFileSync(path.join(here, 'search-test.html'), 'utf8') }));
await page.goto('http://localhost:8171/search-test.html');
await page.waitForFunction(() => window.ready, null, { timeout: 20000 });
const pdf = fs.readFileSync(path.join(here, 'samples/sample-ko.pdf')).toString('base64');

let fails = 0;
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const R = await page.evaluate(async (b64) => {
  const { PdfDoc, ocrHook, host, S } = window.T;
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  host._fake.put('C:\\Users\\dev\\Documents\\PDF Note\\sample-ko.pdf', bytes.slice());
  const doc = await PdfDoc.open(bytes.slice());
  const URI = 'C:\\Users\\dev\\Documents\\PDF Note\\sample-ko.pdf';
  const emptyStore = () => ({ marks: [], strokes: [], outlines: [], translations: [], elements: [], studyEntries: [], bookmarks: [] });
  const run = async (query, { store = emptyStore(), start = 0, precise = false, uri = URI, d = doc, cancelAfter = null, count = null } = {}) => {
    const hits = [], prog = [], warns = []; const canceled = { value: false };
    const t0 = performance.now();
    const truncated = await S.scan(d, uri, store, count ?? d.pageCount, start, query, precise, canceled, {
      progress(a, b) { prog.push([a, b]); if (cancelAfter != null && a >= cancelAfter) canceled.value = true; },
      hits(h) { hits.push(...h); }, warning(w) { warns.push(w); },
    });
    return { hits: hits.map(h => ({ page: h.page, kind: h.kind, text: h.text, ms: h.matchStart, me: h.matchEnd, box: [h.box.left, h.box.top, h.box.right, h.box.bottom], x: h.x, y: h.y })), prog, warns, truncated, ms: performance.now() - t0, canceled: canceled.value };
  };
  const out = {};
  out.pages = doc.pageCount;
  out.sample = [];
  for (let i = 0; i < doc.pageCount; i++) out.sample.push((await doc.pageText(i)).slice(0, 80).replace(/\n/g, '|'));
  out.fox = await run('fox'); out.foxCached = await run('FOX');
  out.squirrel = await run('다람쥐'); out.detail = await run('세부');
  out.none = await run('zzzqqq');
  out.cyclic = await run('fox', { start: 5 });
  out.cancel = await run('fox', { cancelAfter: 3, uri: URI + '2' });
  const st = emptyStore();
  st.marks.push({ page: 7, left: .1, top: .2, right: .3, bottom: .25, note: 'memo about FOX here' });
  st.translations.push({ page: 3, left: .1, top: .1, right: .4, bottom: .2, source: 'src', translated: 'a fox translated' });
  st.studyEntries.push({ page: 2, x: .5, y: .5, text: 'nothing', comment: 'fox comment' });
  st.elements.push({ page: 9, kind: 'text', text: 'typed fox', left: .1, top: .1, right: .5, bottom: .2 }, { page: 9, kind: 'image', text: 'fox', left: 0, top: 0, right: 1, bottom: 1 }, { page: 1, kind: 'link', text: 'fox link', left: 0, top: 0, right: 1, bottom: 1 });
  out.annot = await run('fox', { store: st, start: 4 });
  // OCR phases: no hook -> warning; with hook -> ink OCR + precise
  const ink = emptyStore();
  ink.strokes.push({ page: 1, color: 0xff000000 | 0, width: .004, points: [{ x: .1, y: .1, pressure: .5 }, { x: .4, y: .12, pressure: .5 }] });
  out.noOcr = await run('손글씨', { store: ink, uri: URI + '3' });
  let ocrCalls = 0; const kinds = [];
  ocrHook.fn = async (canvas) => { ocrCalls++; return [{ text: '손글씨', x: canvas.width * .1, y: canvas.height * .1, w: canvas.width * .2, h: canvas.height * .03, line: 0 }, { text: '쪽지', x: canvas.width * .32, y: canvas.height * .1, w: canvas.width * .2, h: canvas.height * .03, line: 0 }]; };
  out.inkOcr = await run('쪽지', { store: ink, uri: URI + '4' });
  out.inkCalls = ocrCalls;
  ocrCalls = 0; out.inkOcr2 = await run('손글씨', { store: ink, uri: URI + '4' }); out.inkCalls2 = ocrCalls; // cached ink
  ocrCalls = 0; out.precise = await run('손글씨', { precise: true, uri: URI + '5', count: 3 }); out.preciseCalls = ocrCalls;
  ocrHook.fn = null;
  // cap: fake doc, 100 pages x 10 lines
  const mk = (pg) => { const regs = []; for (let l = 0; l < 10; l++) { const lb = { l }; regs.push({ word: 'hello', line: 'hello x', wordBounds: { left: .1, top: l / 12, right: .2, bottom: (l + .5) / 12 }, lineBounds: lb }, { word: 'x' + l + 'abcdefg', line: '', wordBounds: { left: .3, top: l / 12, right: .5, bottom: (l + .5) / 12 }, lineBounds: lb }); } return regs; };
  const fake = { pageCount: 100, pageSize: async () => ({ w: 600, h: 800 }), textRegions: async p => mk(p) };
  out.cap = await run('hello', { d: fake, uri: 'fake1' });
  const st2 = emptyStore(); for (let i = 0; i < 20; i++) st2.marks.push({ page: 0, left: 0, top: 0, right: 1, bottom: 1, note: 'hello' });
  out.cap2 = await run('hello', { d: fake, uri: 'fake1', store: st2 });
  // persisted cache file
  const info = await host.info(); const files = [...host._fake.files.keys()].filter(k => k.includes('\\search\\'));
  out.cacheFiles = files.length;
  const f = files.find(k => !k.endsWith('.tmp'));
  out.cacheSig = f ? JSON.parse(await host.readText(f)).sig : null;
  // snippet building via direct calls
  const long = 'a'.repeat(50) + 'NEEDLE' + 'b'.repeat(80);
  const s2 = emptyStore(); s2.marks.push({ page: 0, left: 0, top: 0, right: 1, bottom: 1, note: long });
  out.snip = (await run('needle', { store: s2, d: fake, uri: 'fake2', count: 0 })).hits[0];
  return out;
}, pdf);

console.log('pages', R.pages); console.log(R.sample.join('\n'));
const sorted = a => a.every((v, i) => i === 0 || a[i - 1] <= v);
ok(R.fox.hits.length > 0, 'fox hits: ' + R.fox.hits.length + ' pages ' + R.fox.hits.map(h => h.page));
ok(R.fox.hits.every(h => h.kind === '본문' && /fox/i.test(h.text)), 'fox kind/snippet');
ok(R.fox.hits.every(h => h.text.slice(h.ms, h.me).toLowerCase() === 'fox'), 'matchStart/End covers query');
ok(R.fox.hits.every(h => h.box[0] >= 0 && h.box[2] <= 1 && h.box[2] > h.box[0] && h.box[3] > h.box[1]), 'boxes valid: ' + JSON.stringify(R.fox.hits[0] && R.fox.hits[0].box));
ok(sorted(R.fox.hits.map(h => h.page)), 'fox in page order from page 0');
ok(R.foxCached.hits.length === R.fox.hits.length, 'case-insensitive + cached run same count');
ok(R.squirrel.hits.length > 0, '다람쥐: ' + R.squirrel.hits.length + ' ' + (R.squirrel.hits[0] && R.squirrel.hits[0].text));
ok(R.detail.hits.length > 0, '세부: ' + R.detail.hits.length + ' ' + (R.detail.hits[0] && R.detail.hits[0].text));
ok(R.none.hits.length === 0 && !R.none.truncated, 'no hits');
ok(R.fox.prog[0][0] === 0 && R.fox.prog.at(-1)[0] === R.pages && R.fox.prog.at(-1)[1] === R.pages, 'progress 0..total');
const cp = R.cyclic.hits.map(h => h.page), firstWrap = cp.findIndex((p, i) => i && p < cp[i - 1]);
ok(cp.length === R.fox.hits.length && cp.every(p => p >= 5 || firstWrap >= 0), 'cyclic from page 5: ' + cp);
ok(cp.length === 0 || cp[0] >= 5 || cp.every(p => p < 5), 'cyclic order starts at/after page 5');
ok(R.cancel.canceled && R.cancel.hits.length > 0 && R.cancel.hits.length < R.fox.hits.length, 'cancel stops early: hits '+R.cancel.hits.length+' last progress ' + JSON.stringify(R.cancel.prog.at(-1)));
ok(R.annot.hits.slice(0, 5).map(h => h.kind).join() === '메모,번역,노트,타이핑,링크', 'annotation-first order: ' + R.annot.hits.slice(0, 6).map(h => h.kind + p(h)));
function p(h) { return ':' + h.page; }
ok(R.annot.hits.slice(5).every(h => h.kind === '본문'), 'body hits after annotations');
ok(R.annot.hits.length === 5 + R.fox.hits.length, 'annotation count (image element excluded)');
ok(R.annot.hits[2].box[2] - R.annot.hits[2].box[0] > 0.11 && Math.abs(R.annot.hits[2].box[3] - R.annot.hits[2].box[1] - .025) < 1e-6, 'note point box .12x.025');
ok(R.noOcr.hits.length === 0 && R.noOcr.warns.length === 1, 'no OCR hook -> skipped + warning: ' + R.noOcr.warns);
ok(R.inkOcr.hits.length === 1 && R.inkOcr.hits[0].kind === '필기' && R.inkOcr.hits[0].page === 1, 'ink OCR hit: ' + JSON.stringify(R.inkOcr.hits));
ok(R.inkOcr.hits[0] && Math.abs(R.inkOcr.hits[0].box[0] - .32) < .01, 'ink match is word-granular');
ok(R.inkCalls === 1 && R.inkCalls2 === 0, 'ink OCR cached by stroke hash (' + R.inkCalls + ',' + R.inkCalls2 + ')');
ok(R.precise.hits.length === 3 && R.precise.hits.every(h => h.kind === '본문') && R.preciseCalls === 3, 'precise mode OCRs every page: ' + R.preciseCalls);
ok(R.cap.truncated && R.cap.hits.length === 500, 'cap 500: ' + R.cap.hits.length + ' truncated=' + R.cap.truncated);
ok(R.cap2.truncated && R.cap2.hits.length === 500 && R.cap2.hits.slice(0, 20).every(h => h.kind === '메모'), 'cap includes annotation hits (20 + 480)');
ok(R.cap.hits.slice(0, 10).every((h, i) => h.page === 0 && (i === 0 || h.box[1] >= R.cap.hits[i - 1].box[1])), 'within page sorted by top');
ok(R.cacheFiles >= 1 && /^\d+-\d+$/.test(R.cacheSig), 'disk cache written, sig=' + R.cacheSig);
ok(R.snip && R.snip.text.startsWith('…') && R.snip.text.endsWith('…') && R.snip.text.slice(R.snip.ms, R.snip.me) === 'NEEDLE', 'long snippet ellipsis + match range: ' + (R.snip && R.snip.text.length));
console.log('time fox', R.fox.ms | 0, 'ms; cached', R.foxCached.ms | 0, 'ms');
await browser.close(); server.close();
console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
