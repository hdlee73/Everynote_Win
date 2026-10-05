// Device sync: sync.js against the real Android server class (DeviceSync.java) when SYNC_PORT/SYNC_CODE/SYNC_DIR are set,
// plus pure unit checks of the merge. Usage: node dev/sync-test.mjs   (server: see docs/device-sync.md)
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { mergeSidecars, referencedAssets, parseAddress, SyncClient, syncDocument, SyncError } from '../web/js/sync.js';
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };

// ---- merge
const A = JSON.stringify({ format: 'PDF Note annotations v2', elements: [{ page: 0, left: 0.1234567 }], marks: [{ id: 'm', page: 0 }], bookmarks: [3], strokes: [{ page: 0, points: [{ x: 0.5, y: 0.5, p: 1 }] }] });
const B = JSON.stringify({ elements: [{ left: 0.12346, page: 0 }, { page: 1 }], marks: [{ id: 'm', page: 1 }, { id: 'n', page: 2 }], bookmarks: [1, 3] });
const M = JSON.parse(mergeSidecars(A, B));
ok(M.elements.length === 2, 'merge: float-noise duplicate collapsed, new element kept');
ok(M.marks.length === 2 && M.marks[0].page === 0, 'merge: marks by id, local wins');
ok(M.bookmarks.join() === '1,3', 'merge: bookmarks union sorted');
ok(M.strokes.length === 1 && M.format === 'PDF Note annotations v2', 'merge: keeps header and strokes');
ok(mergeSidecars(A, A) === mergeSidecars(mergeSidecars(A, A), A), 'merge: idempotent');
ok(parseAddress('192.168.0.5:4000').port === 4000 && parseAddress('http://10.0.0.1:99').host === '10.0.0.1' && !parseAddress('example.com:80') && !parseAddress('300.1.1.1:5'), 'address parsing');
ok(referencedAssets(JSON.stringify({ elements: [{ asset: '11111111-1111-1111-1111-111111111111.png' }, { kind: 'video', text: '22222222-2222-2222-2222-222222222222.mp4', asset: 'tape-01.png' }] })).size === 2, 'referencedAssets');

// ---- against the real server
const port = process.env.SYNC_PORT, code = process.env.SYNC_CODE, rdir = process.env.SYNC_DIR;
if (port) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-')); const own = n => path.join(tmp, n);
  const env = {
    async http(o) {
      const init = { method: o.method || 'GET', headers: o.headers || {} };
      if (o.readPath) init.body = fs.readFileSync(o.readPath); else if (o.text != null) init.body = o.text;
      const r = await fetch(o.url, init);
      if (o.savePath && r.ok) { fs.writeFileSync(o.savePath, Buffer.from(await r.arrayBuffer())); return { status: r.status, text: '' }; }
      return { status: r.status, text: init.method === 'HEAD' ? '' : await r.text() };
    },
    assetPath: n => own(n), hasAsset: n => fs.existsSync(own(n)),
  };
  const id = 'a'.repeat(64), addr = '127.0.0.1:' + port;
  try { await new SyncClient(env, addr, '000000').docs(); ok(false, 'wrong code rejected'); } catch (e) { ok(e instanceof SyncError && /코드/.test(e.message), 'wrong code rejected'); }
  const c = new SyncClient(env, addr, code);
  ok((await c.docs())[0].id === id, 'list documents');
  const mineAsset = '33333333-3333-3333-3333-333333333333.png'; fs.writeFileSync(own(mineAsset), 'PNGDATA-local');
  const local = { elements: [{ rot: 0, page: 2, kind: 'image', text: '', asset: mineAsset, left: 0.2, top: 0.2, right: 0.6, bottom: 0.5 }], studyEntries: [], marks: [], bookmarks: [4], outlines: [], strokes: [], translations: [] };
  let applied = null;
  const r = await syncDocument(c, id, { json: JSON.stringify({ format: 'PDF Note annotations v2', ...local }), apply: async t => { applied = JSON.parse(t); } }, 'merge');
  ok(applied.elements.length === 2 && applied.bookmarks.join() === '2,4', 'merge applied locally (2 elements, bookmarks 2,4)');
  ok(r.received === 1 && fs.readFileSync(own('11111111-1111-1111-1111-111111111111.png'), 'utf8') === 'PNGDATA-remote', 'remote image downloaded');
  ok(r.sent === 1 && fs.readFileSync(path.join(rdir, mineAsset), 'utf8') === 'PNGDATA-local', 'local image uploaded');
  const remoteNow = JSON.parse(fs.readFileSync(path.join(rdir, 'remote-doc.json'), 'utf8'));
  ok(remoteNow.elements.length === 2 && remoteNow.bookmarks.length === 2, 'merged notes stored on the phone');
  const r2 = await syncDocument(c, id, { json: JSON.stringify(applied), apply: async t => { applied = JSON.parse(t); } }, 'merge');
  ok(applied.elements.length === 2 && r2.sent === 0 && r2.received === 0, 'second merge changes nothing');
  await syncDocument(c, id, { json: JSON.stringify({ format: 'PDF Note annotations v2', elements: [], bookmarks: [] }), apply: async () => { } }, 'push');
  ok(JSON.parse(fs.readFileSync(path.join(rdir, 'remote-doc.json'), 'utf8')).elements.length === 0, 'push overwrites the phone');
  await syncDocument(c, id, { json: '{}', apply: async t => { applied = JSON.parse(t); } }, 'pull');
  ok(Array.isArray(applied.elements) && applied.elements.length === 0, 'pull gets the phone notes');
  try { await syncDocument(c, 'b'.repeat(64), { json: '{}', apply: async () => { } }, 'merge'); ok(false, 'unopened doc'); } catch (e) { ok(/열려 있지 않습니다/.test(e.message), 'unopened document reported'); }
}
console.log(fail ? fail + ' FAILED' : 'all passed'); process.exit(fail ? 1 : 0);
