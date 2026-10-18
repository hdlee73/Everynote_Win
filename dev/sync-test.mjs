// Device sync (newer side wins, picked items, whole-document overwrite): sync.js against the real Android server class (DeviceSync.java) when SYNC_PORT/SYNC_CODE/
// SYNC_LIB/SYNC_ASSETS are set (see docs/device-sync.md), plus pure unit checks.   node dev/sync-test.mjs
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { referencedAssets, parseAddress, relPath, buildRows, recordState, SyncClient, transferDocument, transferFolder, SyncError } from '../web/js/sync.js';
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };

ok(parseAddress('192.168.0.5:4000').port === 4000 && parseAddress('http://10.0.0.1:99').host === '10.0.0.1' && !parseAddress('example.com:80') && !parseAddress('300.1.1.1:5'), 'address parsing');
ok(referencedAssets(JSON.stringify({ elements: [{ asset: '11111111-1111-1111-1111-111111111111.png' }, { kind: 'video', text: '22222222-2222-2222-2222-222222222222.mp4', asset: 'tape-01.png' }] })).size === 2, 'referencedAssets');
ok(relPath('C:\\Lib\\Docs', 'C:\\Lib\\Docs\\폴더\\a b.pdf') === '폴더/a b.pdf' && relPath('C:\\Lib\\Docs', 'D:\\x.pdf') === null, 'relPath');
const T = 1e12, MIN = 60000;
{ // first sync (no record): the newer clock wins, equal clocks do nothing
  const rows = buildRows([{ path: 'a.pdf', size: 1, mtime: T }, { path: 'p.pdf', size: 1, mtime: 5 }, { path: 'same.pdf', size: 1, mtime: T }, { path: 'ph.pdf', size: 1, mtime: T + 10 * MIN }],
    [{ path: 'a.pdf', size: 2, mtime: T + 10 * MIN }, { path: 'c.pdf', size: 3, mtime: 5 }, { path: 'same.pdf', size: 1, mtime: T + MIN }, { path: 'ph.pdf', size: 1, mtime: T }]);
  const by = p => rows.find(r => r.path === p);
  ok(rows.length === 5, 'buildRows: one row per document');
  ok(by('a.pdf').dir === 'push' && by('a.pdf').newer === 'pc', 'PC newer -> push');
  ok(by('ph.pdf').dir === 'pull' && by('ph.pdf').newer === 'phone', 'phone newer -> pull');
  ok(by('same.pdf').dir === null, 'clocks within two minutes are the same');
  ok(by('p.pdf').dir === 'pull' && by('c.pdf').dir === 'push', 'one-sided documents are created on the other side');
}
{ // with a record only the side that moved on since the last sync counts; both moved = conflict, newer wins
  const state = { 'x.pdf': { pc: T, phone: T }, 'y.pdf': { pc: T, phone: T }, 'z.pdf': { pc: T, phone: T }, 'q.pdf': { pc: T, phone: T } };
  const rows = buildRows(
    [{ path: 'x.pdf', mtime: T }, { path: 'y.pdf', mtime: T + 30 * MIN }, { path: 'z.pdf', mtime: T + 20 * MIN }, { path: 'q.pdf', mtime: T }],
    [{ path: 'x.pdf', mtime: T + 30 * MIN }, { path: 'y.pdf', mtime: T }, { path: 'z.pdf', mtime: T + 40 * MIN }, { path: 'q.pdf', mtime: T }], state);
  const by = p => rows.find(r => r.path === p);
  ok(by('x.pdf').dir === 'push' && !by('x.pdf').conflict, 'record: only the PC changed -> push');
  ok(by('y.pdf').dir === 'pull' && !by('y.pdf').conflict, 'record: only the phone changed -> pull');
  ok(by('z.pdf').dir === 'push' && by('z.pdf').conflict, 'record: both changed -> conflict, the newer (PC) wins');
  ok(by('q.pdf').dir === null, 'record: nothing changed -> nothing to do');
  const next = recordState(state, [{ path: 'x.pdf', mtime: T + 31 * MIN }], [{ path: 'x.pdf', mtime: T + 30 * MIN }, { path: 'zz.pdf', mtime: 1 }]);
  ok(next['x.pdf'].pc === T + 30 * MIN && next['x.pdf'].phone === T + 31 * MIN && next['y.pdf'].pc === T && !next['zz.pdf'], 'recordState keeps old entries and updates the synced ones');
}
{ // folders: only those that are on one side and hold no document row get a row of their own
  const rows = buildRows([{ path: 'both/a.pdf', mtime: 1 }], [{ path: 'both/a.pdf', mtime: 1 }], {}, ['both', 'empty-phone', 'x'], ['both', 'empty-pc', 'x']);
  const folders = rows.filter(r => r.kind === 'folder');
  ok(folders.length === 2 && folders.find(f => f.path === 'empty-phone').dir === 'pull' && folders.find(f => f.path === 'empty-pc').dir === 'push', 'empty folders on one side only are listed');
}

const port = process.env.SYNC_PORT, code = process.env.SYNC_CODE, lib = process.env.SYNC_LIB, rassets = process.env.SYNC_ASSETS;
if (port) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-')), pcLib = path.join(tmp, 'lib'), own = n => path.join(tmp, n); fs.mkdirSync(pcLib);
  const notes = new Map(), events = [];
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
    mkdir: async rel => { fs.mkdirSync(path.join(pcLib, ...rel.split('/')), { recursive: true }); },
    beforeReplace: async rel => { events.push('before ' + rel); return rel === 'pcopen.pdf' ? 'was-open' : null; },
    afterReplace: async (rel, token) => { events.push('after ' + rel + ' ' + token); },
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
  // folders
  ok((await c.folders()).includes('폴더'), 'phone folders listed');
  await transferFolder(c, '빈/하위', 'push');
  ok(fs.statSync(path.join(lib, '빈', '하위')).isDirectory(), 'push: empty folder created on the phone');
  await transferFolder(c, 'pc폴더/안', 'pull');
  ok(fs.statSync(path.join(pcLib, 'pc폴더', '안')).isDirectory(), 'pull: folder created on the PC');
  // open documents are synced too: pulled ones are closed and reopened around the overwrite, pushed ones just go
  fs.writeFileSync(env.pcPath('pcopen.pdf'), 'x'); events.length = 0;
  fs.writeFileSync(path.join(lib, 'pcopen.pdf'), '%PDF-phone-open'); fs.writeFileSync(path.join(rassets, 'note-pcopen.pdf.json'), JSON.stringify({ format: 'PDF Note annotations v2', elements: [], bookmarks: [] }));
  await transferDocument(c, 'pcopen.pdf', 'pull');
  ok(fs.readFileSync(env.pcPath('pcopen.pdf'), 'utf8') === '%PDF-phone-open' && events.join('|') === 'before pcopen.pdf|after pcopen.pdf was-open', 'pull overwrites a document open on the PC (closed, then reopened)');
  fs.writeFileSync(env.pcPath('open.pdf'), '%PDF-pc-open'); notes.set('open.pdf', JSON.stringify({ format: 'PDF Note annotations v2', elements: [], bookmarks: [] }));
  await transferDocument(c, 'open.pdf', 'push');
  ok(fs.readFileSync(path.join(lib, 'open.pdf'), 'utf8') === '%PDF-pc-open', 'push replaces a document open on the phone');
  const bad = await env.http({ url: `http://${addr}/v1/pdf?p=${encodeURIComponent('../x.pdf')}`, headers: { 'X-Code': code } });
  ok(bad.status === 400, 'path traversal rejected');
}
console.log(fail ? fail + ' FAILED' : 'all passed'); process.exit(fail ? 1 : 0);
