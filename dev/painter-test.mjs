// usage: node dev/painter-test.mjs -> dev/out/painter-*.png (look at them!)
import { chromium } from '/tmp/npmtest/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); }).listen(8137);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pg = await b.newPage({ viewport: { width: 1360, height: 960 }, deviceScaleFactor: 1 });
pg.on('console', m => console.log('console', m.text())); pg.on('pageerror', e => console.log('ERR', e.message));
await pg.goto('http://localhost:8137/dev/painter-test.html'); await pg.waitForFunction('window.__done', null, { timeout: 15000 });
const done = await pg.evaluate('window.__done'); console.log(JSON.stringify(done));
let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } else console.log('ok  ', m); };
ok(done.v127.rotates.join() === 'true,true,true,true,false', 'rotates() only image/sticker/shape/table');
ok(done.v127.names.length === 5, 'five pen names');
ok(done.v127.minG >= 170 && done.v127.minG <= 178, 'translucent loop is one flat tone where it overlaps itself (darkest G=' + done.v127.minG + ', flat core 174)');
ok(done.v3.diff === 0, 'text() == textBlock() with default options (refactor keeps pixels)');
ok(done.v3.boxes === 3, 'check list: one tappable marker per line (' + done.v3.boxes + ')');
ok(done.v3.stretch.stretchedTopRowInk > 20 && done.v3.stretch.letterboxedTopRowInk < 3, 'stretch fills the whole box, default keeps the ratio (' + JSON.stringify(done.v3.stretch) + ')');
const v = done.v130, white = a => a.join() === '255,255,255', eq = (a, b) => a.every((x, i) => Math.abs(x - b[i]) <= 1);
ok(!white(v.single) && eq(v.single, v.cross), 'freehand highlight: self-crossing is one flat tone ' + v.single + ' vs ' + v.cross);
ok(!white(v.capEnd), 'freehand highlight: round cap past the first point ' + v.capEnd);
ok(!white(v.dot), 'freehand highlight: one-point-ish path still paints a round dot ' + v.dot);
ok(white(v.outside) && white(v.noteOnlyPx), 'freehand highlight: nothing outside the stroke, note-only marks draw no highlight');
ok(!white(v.band), 'straight band still painted as a flat rectangle ' + v.band);
fs.mkdirSync(path.join(root, 'dev/out'), { recursive: true });
for (const id of ['all-light', 'all-dark', 'v127', 'v3text', 'v3text-dark', 'v130']) await (await pg.$('#' + id)).screenshot({ path: path.join(root, `dev/out/painter-${id}.png`) });
await b.close(); srv.close(); if (bad) process.exitCode = 1;
