// Device sync (whole-document overwrite): sync.js against the real Android server class (DeviceSync.java) when SYNC_PORT/SYNC_CODE/
// SYNC_LIB/SYNC_ASSETS are set (see docs/device-sync.md), plus pure unit checks.   node dev/sync-test.mjs
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { referencedAssets, parseAddress, relPath, buildRows, SyncClient, transferDocument, SyncError } from '../web/js/sync.js';
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };

ok(parseAddress('192.168.0.5:4000').port === 4000 && parseAddress('http://10.0.0.1:99').host === '10.0.0.1' && !parseAddress('example.com:80') && !parseAddress('300.1.1.1:5'), 'address parsing');
ok(referencedAssets(JSON.stringify({ elements: [{ asset: '11111111-1111-1111-1111-111111111111.png' }, { kind: 'video', text: '22222222-2222-2222-2222-222222222222.mp4', asset: 'tape-01.png' }] })).size === 2, 'referencedAssets');
ok(relPath('C:\\Lib\\Docs', 'C:\\Lib\\Docs\\폴더\\a b.pdf') === '폴더/a b.pdf' && relPath('C:\\Lib\\Docs', 'D:\\x.pdf') === null, 'relPath');
const rows = buildRows([{ path: 'a.pdf', size: 1, mtime: 1e12 }, { path: 'p.pdf', size: 1, mtime: 5 }], [{ path: 'a.pdf', size: 2, mtime: 1e12 + 600000 }, { path: 'c.pdf', size: 3, mtime: 5 }]);
ok(rows.length === 3 && rows.find(r => r.path === 'a.pdf').newer === 'pc' && !rows.find(r => r.path === 'p.pdf').pc && !rows.find(r => r.path === 'c.pdf').phone, 'buildRows');

const port = process.env.SYNC_PORT, code = process.env.SYNC_CODE, lib = process.env.SYNC_LIB, rassets = process.env.SYNC_ASSETS;
if (port) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-')), pcLib = path.join(tmp, 'lib'), own = n => path.join(tmp, n); fs.mkdirSync(pcLib);
  const notes = new Map();
  const env = {
    async http(o) {
      const init = { method: o.method || 'GET', headers: o.headers || {} };
      if (o.readPath) init.body = fs.readFileSync(o.readPath); else if (o.text != null) init.body = o.text;
      const r = await fetch(o.url, init);
      if (o.savePath && r.ok) { fs.mkdirSync(path.dirname(o.savePath), { recursive: true }); fs.writeFileSync(o.savePath, Buffer.from(await r.arrayBuffer())); return { status: r.status, text: '' }; }
      return { status: r.status, text: init.method === 'HEAD' ? '' : await r.text() };
    },
    pcPath: rel => path.join(pcLib, ...rel.split('/')),
    isOpen: async rel => rel === 'pcopen.pdf',
    exportNote: async rel => notes.get(rel),
    importNote: async (rel, t) => { notes.set(rel, t); },
    assetPath: n => own(n), hasAsset: n => fs.existsSync(own(n)),
  };
  const addr = '127.0.0.1:' + port;
  try { await new SyncClient(env, addr, '000000').library(); ok(false, 'wrong code rejected'); } catch (e) { ok(e instanceof SyncError && /코드/.test(e.message), 'wrong code rejected'); }
  const c = new SyncClient(env, addr, code);
  const list = await c.library();
  ok(list.some(d => d.path === 'a.pdf') && list.some(d => d.path === '폴더/b c.pdf'), 'phone library listed (incl. folder + Korean/space names)');

  // pull: phone -> PC
  const r1 = await transferDocument(c, 'a.pdf', 'pull');
  ok(fs.readFileSync(env.pcPath('a.pdf'), 'utf8') === '%PDF-phone-A', 'pull: PDF downloaded');
  ok(fs.readFileSync(own('11111111-1111-1111-1111-111111111111.png'), 'utf8') === 'PNGDATA-phone' && r1.files === 2, 'pull: image downloaded');
  ok(JSON.parse(notes.get('a.pdf')).bookmarks[0] === 2, 'pull: notes applied');
  await transferDocument(c, '폴더/b c.pdf', 'pull');
  ok(fs.readFileSync(env.pcPath('폴더/b c.pdf'), 'utf8') === '%PDF-phone-B', 'pull: nested Korean path created');

  // push: PC -> phone (overwrite existing + new + pc-only image)
  fs.writeFileSync(env.pcPath('a.pdf'), '%PDF-pc-A-edited');
  const mine = '33333333-3333-3333-3333-333333333333.png'; fs.writeFileSync(own(mine), 'PNGDATA-pc');
  notes.set('a.pdf', JSON.stringify({ format: 'PDF Note annotations v2', elements: [{ page: 0, kind: 'image', asset: mine, text: '' }], bookmarks: [7] }));
  const r2 = await transferDocument(c, 'a.pdf', 'push');
  ok(fs.readFileSync(path.join(lib, 'a.pdf'), 'utf8') === '%PDF-pc-A-edited', 'push: phone PDF overwritten');
  ok(fs.readFileSync(path.join(rassets, mine), 'utf8') === 'PNGDATA-pc' && r2.files === 2, 'push: image uploaded');
  ok(JSON.parse(fs.readFileSync(path.join(rassets, 'note-a.pdf.json'), 'utf8')).bookmarks[0] === 7, 'push: notes stored on phone');
  fs.mkdirSync(path.dirname(env.pcPath('새/문서.pdf')), { recursive: true }); fs.writeFileSync(env.pcPath('새/문서.pdf'), '%PDF-new'); notes.set('새/문서.pdf', JSON.stringify({ format: 'PDF Note annotations v2', elements: [], bookmarks: [] }));
  await transferDocument(c, '새/문서.pdf', 'push');
  ok(fs.readFileSync(path.join(lib, '새', '문서.pdf'), 'utf8') === '%PDF-new', 'push: new document with new folder created on phone');
  // guards
  try { fs.writeFileSync(env.pcPath('pcopen.pdf'), 'x'); await transferDocument(c, 'pcopen.pdf', 'pull'); ok(false, 'pc-open guard'); } catch (e) { ok(/열려 있는/.test(e.message), 'pull refuses a document open on the PC'); }
  try { fs.writeFileSync(env.pcPath('open.pdf'), 'x'); notes.set('open.pdf', '{}'); await transferDocument(c, 'open.pdf', 'push'); ok(false, 'phone-open guard'); } catch (e) { ok(/열려 있는/.test(e.message), 'push refuses a document open on the phone'); }
  const bad = await env.http({ url: `http://${addr}/v1/pdf?p=${encodeURIComponent('../x.pdf')}`, headers: { 'X-Code': code } });
  ok(bad.status === 400, 'path traversal rejected');
}
console.log(fail ? fail + ' FAILED' : 'all passed'); process.exit(fail ? 1 : 0);
