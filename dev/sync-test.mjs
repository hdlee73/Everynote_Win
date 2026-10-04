// Playwright harness for js/sync.js + js/sync-ui.js against an in-page fake Google Drive (dev/sync-test.html).  usage: node dev/sync-test.mjs
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
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 900, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
let errors = 0, fails = 0;
page.on('console', m => { if (m.type() === 'error' && !/404/.test(m.text())) { console.log('[console.error]', m.text()); errors++; } });
page.on('pageerror', e => { console.log('[pageerror]', e.message); errors++; });
await page.addInitScript(() => { for (const C of [Map, WeakMap]) { if (!C.prototype.getOrInsertComputed) C.prototype.getOrInsertComputed = function (k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); }; if (!C.prototype.getOrInsert) C.prototype.getOrInsert = function (k, v) { if (!this.has(k)) this.set(k, v); return this.get(k); }; } });
await page.goto(`http://localhost:${port}/dev/sync-test.html`);
await page.waitForFunction(() => window.READY, null, { timeout: 30000 });
const ev = (fn, a) => page.evaluate(fn, a);
const check = (n, ok, x = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!ok) fails++; };
const shot = async n => { await page.waitForTimeout(350); await page.screenshot({ path: path.join(out, 'sync-' + n + '.png') }); };

// ---- in-page helpers
await ev(() => {
  const { host, lib, AnnotationStore, Mark, DriveSync } = T;
  const w = r => lib.root + '\\' + r.replace(/\//g, '\\');
  const sample = new Uint8Array(1000); crypto.getRandomValues(sample);
  T.mkPdf = (rel, bytes, mtime) => { host._fake.put(w(rel), bytes); if (mtime) host._fake.files.get(w(rel)).mtime = mtime; };
  T.annotate = async (rel, note, mtime) => {
    const s = new AnnotationStore(); await s.open(w(rel)); const m = new Mark(); m.page = 0; m.left = .1; m.top = .1; m.right = .5; m.bottom = .2; m.color = 0x66FFDE59 | 0; m.note = note; s.marks.length = 0; s.marks.push(m); s.save(); await s.flush();
    if (mtime) { const p = await AnnotationStore.sidecarPath(w(rel)); host._fake.files.get(p).mtime = mtime; }
  };
  T.notes = async rel => { try { const s = await AnnotationStore.load(w(rel)); return s.marks.map(m => m.note); } catch (e) { return null; } };
  T.localPdfs = () => [...host._fake.files.entries()].filter(([k, v]) => !v.dir && k.startsWith(lib.root + '\\') && !k.includes('\\.')).map(([k]) => k.slice(lib.root.length + 1).replace(/\\/g, '/')).sort();
  T.readLocal = rel => host._fake.files.get(w(rel))?.bytes;
  T.wipeDevice = () => { const info = { data: 'C:\\Users\\dev\\AppData\\Local\\PDFNote' }; for (const k of [...host._fake.files.keys()]) if ((k.startsWith(lib.root + '\\') && k !== lib.root) || k.startsWith(info.data + '\\annotations') || k.startsWith(info.data + '\\sync') || k.startsWith(info.data + '\\assets')) host._fake.files.delete(k); };
  T.logs = [];
  T.run = async (o = {}) => {
    T.logs.length = 0;
    const s = new DriveSync({ library: lib, account: 'tester@example.com', options: o.options, log: t => T.logs.push(t), onProgress: p => (T.progress ||= []).push(p), confirmDeletions: o.confirm || null, retryDelay: 1 });
    T.last = s;
    try { return { ok: true, sum: await s.run() }; } catch (e) { return { ok: false, code: e.code, message: e.message, sum: e.summary || null }; }
  };
  T.sample = sample;
  F.google.configured = true; F.google.signedIn = true; F.google.email = 'tester@example.com';
});
const sha = bytes => ev(async b => { const d = await crypto.subtle.digest('SHA-1', new Uint8Array(b)); return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join(''); }, bytes);

// ---------------------------------------------------------------- 1. first upload
await ev(async () => {
  const mk = (n, seed) => { const b = new Uint8Array(1500 + n); for (let i = 0; i < b.length; i++) b[i] = (i * seed) & 255; return b; };
  T.mkPdf('a.pdf', mk(1, 7)); T.mkPdf('folder/b.pdf', mk(2, 11)); T.mkPdf('folder/sub/c.pdf', mk(3, 13));
  await T.annotate('a.pdf', 'note-a');
  await T.AnnotationStore.saveAsset('11111111-1111-4111-8111-111111111111.png', new Uint8Array([1, 2, 3, 4, 5]));
});
let r = await ev(() => T.run());
check('first sync ok', r.ok, JSON.stringify(r));
check('uploaded 3 pdf + 1 annotation + 1 asset', r.ok && r.sum.uploaded === 5 && r.sum.errors.length === 0, JSON.stringify(r.sum));
let tree = await ev(() => F.tree());
console.log('   drive:', tree.join(' | '));
check("folder 'Everynote Sync' in My Drive", tree.includes('Everynote Sync/'));
for (const t of ['a.pdf', 'folder/', 'folder/b.pdf', 'folder/sub/', 'folder/sub/c.pdf', 'a.pdf.pdfnote.json', 'assets/', 'assets/11111111-1111-4111-8111-111111111111.png', 'manifest.json'])
  check('drive has ' + t, tree.includes('Everynote Sync/' + t));
const ann = await ev(() => JSON.parse(new TextDecoder().decode(F.byPath('Everynote Sync/a.pdf.pdfnote.json').bytes)));
check('annotation file uses the Android export format', ann.format === 'PDF Note annotations v2' && ann.document === 'a.pdf' && ann.uri === 'a.pdf' && ann.marks[0].note === 'note-a', JSON.stringify(Object.keys(ann)));
const man = await ev(() => JSON.parse(new TextDecoder().decode(F.byPath('Everynote Sync/manifest.json').bytes)));
check('manifest has modifiedTime + sha1 per file', man.files['a.pdf'] && man.files['a.pdf'].sha1 && man.files['a.pdf'].modifiedTime > 0 && Object.keys(man.files).length === 5, Object.keys(man.files).join(','));
const aSha = await ev(() => F.byPath('Everynote Sync/a.pdf').appProperties.sha1);
check('appProperties.sha1 is the file sha1', aSha === await sha(await ev(() => [...T.readLocal('a.pdf')])));
check('multipart used for small files (no resumable)', (await ev(() => F.resumed || 0)) === 0);
r = await ev(() => T.run());
check('second sync is a no-op', r.ok && r.sum.uploaded === 0 && r.sum.downloaded === 0 && r.sum.errors.length === 0, JSON.stringify(r.sum));

// ---------------------------------------------------------------- 2. second device downloads everything
await ev(() => T.wipeDevice());
check('device wiped', (await ev(() => T.localPdfs())).length === 0);
r = await ev(() => T.run());
check('device 2: downloads 3 pdf + annotation + asset', r.ok && r.sum.downloaded === 5 && r.sum.uploaded === 0, JSON.stringify(r.sum));
check('device 2: local library mirrors relative paths', JSON.stringify(await ev(() => T.localPdfs())) === JSON.stringify(['a.pdf', 'folder/b.pdf', 'folder/sub/c.pdf']));
check('device 2: annotations imported', JSON.stringify(await ev(() => T.notes('a.pdf'))) === '["note-a"]');
check('device 2: asset restored', await ev(() => T.AnnotationStore.hasAsset('11111111-1111-4111-8111-111111111111.png')));
check('device 2: pdf bytes identical', await sha(await ev(() => [...T.readLocal('folder/b.pdf')])) === await ev(() => F.byPath('Everynote Sync/folder/b.pdf').appProperties.sha1));
r = await ev(() => T.run()); check('device 2: next sync no-op', r.ok && r.sum.uploaded + r.sum.downloaded + r.sum.conflicts === 0, JSON.stringify(r.sum));

// ---------------------------------------------------------------- 3. edits flow in both directions
await ev(async () => { await T.annotate('a.pdf', 'note-a-v2'); });
r = await ev(() => T.run()); check('local annotation edit uploaded', r.ok && r.sum.uploaded === 1 && r.sum.downloaded === 0, JSON.stringify(r.sum));
check('drive annotation updated', (await ev(() => JSON.parse(new TextDecoder().decode(F.byPath('Everynote Sync/a.pdf.pdfnote.json').bytes)).marks[0].note)) === 'note-a-v2');
await ev(() => { const f = F.byPath('Everynote Sync/folder/b.pdf'); f.bytes = new Uint8Array(2200).fill(9); f.modifiedTime = new Date(Date.now() + 5000).toISOString(); delete f.appProperties.sha1; });
r = await ev(() => T.run()); check('remote pdf change downloaded (no sha1 in appProperties)', r.ok && r.sum.downloaded === 1 && r.sum.uploaded === 0, JSON.stringify(r.sum));
check('local pdf has the new bytes', (await ev(() => T.readLocal('folder/b.pdf').length)) === 2200);
r = await ev(() => T.run()); check('stable afterwards', r.ok && r.sum.uploaded + r.sum.downloaded + r.sum.conflicts === 0, JSON.stringify(r.sum));

// ---------------------------------------------------------------- 4. conflicts (last writer wins + keep both)
const t0 = Date.now();
await ev(async t => { await T.annotate('a.pdf', 'local-edit', t + 20000); const f = F.byPath('Everynote Sync/a.pdf.pdfnote.json'); const j = JSON.parse(new TextDecoder().decode(f.bytes)); j.marks[0].note = 'remote-edit'; f.bytes = new TextEncoder().encode(JSON.stringify(j)); f.modifiedTime = new Date(t + 10000).toISOString(); f.appProperties.sha1 = 'deadbeef'; }, t0);
r = await ev(() => T.run()); check('annotation conflict resolved: local newer wins', r.ok && r.sum.conflicts === 1, JSON.stringify(r.sum));
tree = await ev(() => F.tree());
check('conflict copy kept on Drive', tree.some(x => /a\.pdf\.pdfnote\.conflict-\d{8}-\d{4}\.json$/.test(x)), tree.filter(x => x.includes('conflict')).join(','));
check('Drive now has the local text, copy has the remote text', (await ev(() => JSON.parse(new TextDecoder().decode(F.byPath('Everynote Sync/a.pdf.pdfnote.json').bytes)).marks[0].note)) === 'local-edit'
  && (await ev(() => { const c = [...F.files.values()].find(f => f.name.includes('conflict')); return JSON.parse(new TextDecoder().decode(c.bytes)).marks[0].note; })) === 'remote-edit');
// pdf conflict, remote newer
await ev(async t => { T.mkPdf('folder/b.pdf', new Uint8Array(3000).fill(1), t + 1000); const f = F.byPath('Everynote Sync/folder/b.pdf'); f.bytes = new Uint8Array(3100).fill(2); f.modifiedTime = new Date(t + 60000).toISOString(); f.appProperties.sha1 = 'abc123'; }, t0);
r = await ev(() => T.run()); check('pdf conflict: remote newer wins', r.ok && r.sum.conflicts === 1, JSON.stringify(r.sum));
let pdfs = await ev(() => T.localPdfs());
console.log('   local:', pdfs.join(' | '));
check('local loser kept as 충돌 사본', pdfs.some(p => /^folder\/b \(충돌 사본 \d{8}-\d{4}\)\.pdf$/.test(p)));
check('local original now has remote bytes', (await ev(() => T.readLocal('folder/b.pdf').length)) === 3100);
r = await ev(() => T.run()); check('conflict copy is uploaded as a new file next time', r.ok && r.sum.uploaded >= 1 && r.sum.errors.length === 0, JSON.stringify(r.sum));
tree = await ev(() => F.tree()); check('copy visible on Drive', tree.some(x => /b \(충돌 사본/.test(x)));
// pdf conflict, local newer -> drive copy
await ev(async t => { T.mkPdf('a.pdf', new Uint8Array(1800).fill(5), t + 900000); const f = F.byPath('Everynote Sync/a.pdf'); f.bytes = new Uint8Array(1700).fill(6); f.modifiedTime = new Date(t + 100000).toISOString(); f.appProperties.sha1 = 'zzz'; }, t0);
r = await ev(() => T.run()); check('pdf conflict: local newer wins, remote copied', r.ok && r.sum.conflicts === 1, JSON.stringify(r.sum));
tree = await ev(() => F.tree()); check('Drive keeps remote loser as a copy', tree.some(x => /Everynote Sync\/a \(충돌 사본 \d{8}-\d{4}\)\.pdf$/.test(x)) && (await ev(() => F.byPath('Everynote Sync/a.pdf').bytes.length)) === 1800);

// ---------------------------------------------------------------- 5. deletions need confirmation
await ev(async () => { await T.lib.trash(T.lib.root + '\\folder\\sub\\c.pdf'); });
r = await ev(() => T.run());
check('local deletion without confirm callback is deferred (Drive keeps the file)', r.ok && r.sum.deletedRemote === 0 && r.sum.deferred >= 1 && (await ev(() => !!F.byPath('Everynote Sync/folder/sub/c.pdf'))), JSON.stringify(r.sum));
let asked = null;
r = await ev(() => T.run({ confirm: async list => { window.__asked = list; return []; } }));
asked = await ev(() => window.__asked);
check('confirmation lists the file with the side', asked && asked.some(x => x.key === 'folder/sub/c.pdf' && x.side === 'remote' && x.kind === 'pdf'), JSON.stringify(asked));
check('declined deletion restores the file locally', r.ok && r.sum.deletedRemote === 0 && (await ev(() => T.localPdfs())).includes('folder/sub/c.pdf'), JSON.stringify(r.sum));
await ev(async () => { await T.lib.trash(T.lib.root + '\\folder\\sub\\c.pdf'); });
r = await ev(() => T.run({ confirm: async list => list.map(x => x.key) }));
check('confirmed deletion trashes the Drive file', r.ok && r.sum.deletedRemote >= 1 && (await ev(() => !F.byPath('Everynote Sync/folder/sub/c.pdf'))) && (await ev(() => [...F.files.values()].some(f => f.name === 'c.pdf' && f.trashed))), JSON.stringify(r.sum));
await ev(() => { F.byPath('Everynote Sync/folder/b.pdf'); const f = [...F.files.values()].find(x => x.name === 'a.pdf' && !x.trashed); f.trashed = true; });
r = await ev(() => T.run({ confirm: async list => list.map(x => x.key) }));
check('remote deletion removed locally (to the library trash)', r.ok && r.sum.deletedLocal >= 1 && !(await ev(() => T.localPdfs())).includes('a.pdf'), JSON.stringify(r.sum));
check('...and sits in the library trash', (await ev(async () => (await T.lib.trashItems()).map(i => i.name))).includes('a.pdf'));
await shot('00-before-ui');

// ---------------------------------------------------------------- 6. big file -> resumable upload
await ev(() => { const b = new Uint8Array(5 * 1024 * 1024); for (let i = 0; i < b.length; i += 1024) b[i] = i >> 10; T.big = b; T.mkPdf('big.pdf', b); });
r = await ev(() => T.run());
check('5 MB file uploaded via resumable session', r.ok && (await ev(() => F.resumed)) === 1, JSON.stringify(r.sum));
check('resumable content identical', (await ev(() => F.byPath('Everynote Sync/big.pdf').bytes.length)) === 5 * 1024 * 1024);
await ev(() => T.wipeDevice()); r = await ev(() => T.run());
check('big file downloaded to disk (savePath)', r.ok && (await ev(() => T.readLocal('big.pdf')?.length)) === 5 * 1024 * 1024, JSON.stringify(r.sum));

// ---------------------------------------------------------------- 7. errors degrade gracefully
await ev(() => { T.mkPdf('new1.pdf', new Uint8Array(500).fill(3)); F.offline = true; });
r = await ev(() => T.run());
check('offline -> code offline + Korean message', !r.ok && r.code === 'offline' && r.message.includes('인터넷에 연결할 수 없어'), JSON.stringify(r));
await ev(() => { F.offline = false; });
await ev(() => { F.fail.push({ status: 503 }, { status: 503 }); });
r = await ev(() => T.run()); check('transient 503 is retried', r.ok && r.sum.uploaded === 1, JSON.stringify(r));
await ev(() => { T.mkPdf('new2.pdf', new Uint8Array(500).fill(4)); F.fail.push({ status: 403, reason: 'rateLimitExceeded', message: 'Rate Limit Exceeded' }); });
r = await ev(() => T.run()); check('rateLimit 403 is retried', r.ok && r.sum.uploaded === 1, JSON.stringify(r));
await ev(() => { T.mkPdf('new3.pdf', new Uint8Array(500).fill(5)); F.fail.push({ status: 403, match: 'uploadType', message: 'The user does not have sufficient permissions for this file.' }); });
r = await ev(() => T.run()); check('a per-file hard error is collected, sync continues', r.ok && r.sum.errors.length >= 1, JSON.stringify(r.sum && r.sum.errors));
r = await ev(() => T.run()); check('failed file succeeds on the next run', r.ok && r.sum.errors.length === 0 && (await ev(() => !!F.byPath('Everynote Sync/new3.pdf'))), JSON.stringify(r.sum));
await ev(() => { F.fail.push({ status: 403, reason: 'storageQuotaExceeded', message: 'quota' }); T.mkPdf('new4.pdf', new Uint8Array(500).fill(6)); });
r = await ev(() => T.run()); check('quota exceeded -> clear message', !r.ok && r.code === 'quota' && r.message.includes('저장 공간'), JSON.stringify(r));
await ev(() => { F.google.signedIn = false; });
r = await ev(() => T.run()); check('signed out -> auth error with Korean message', !r.ok && r.code === 'auth' && r.message.includes('로그인'), JSON.stringify(r));
await ev(() => { F.google.signedIn = true; F.google.configured = false; });
r = await ev(() => T.run()); check('not configured -> config error', !r.ok && r.code === 'config' && r.message.includes('클라이언트'), JSON.stringify(r));
await ev(() => { F.google.configured = true; });
await ev(() => { F.google.signedIn = true; const real = F.handle; F.handle = async a => { if (!F.google.signedIn) return real(a); const r = await real(a); return r; }; });
// token expired mid-run -> 401 -> auth
await ev(() => { T.mkPdf('new5.pdf', new Uint8Array(500).fill(7)); F.fail.push({ status: 401, message: 'Invalid Credentials' }); });
r = await ev(() => T.run()); check('401 mid-run -> auth error', !r.ok && r.code === 'auth', JSON.stringify(r));
r = await ev(() => T.run()); check('recovers after the error', r.ok, JSON.stringify(r));

// ---------------------------------------------------------------- 8. subset + cancel
await ev(() => { T.mkPdf('opt.pdf', new Uint8Array(500).fill(8)); });
r = await ev(() => T.run({ options: { pdfs: false, annotations: true, assets: false } }));
check('PDF sync switched off: PDF not uploaded', r.ok && !(await ev(() => F.byPath('Everynote Sync/opt.pdf'))), JSON.stringify(r.sum));
r = await ev(() => T.run({ options: { pdfs: true, annotations: false, assets: false } }));
check('subset: PDFs only uploads the PDF', r.ok && !!(await ev(() => F.byPath('Everynote Sync/opt.pdf'))));
await ev(() => { for (let i = 0; i < 6; i++) T.mkPdf('many' + i + '.pdf', new Uint8Array(500).fill(20 + i)); let n = 0; F.onRequest = async () => { if (++n === 8) T.last.cancel(); }; });
r = await ev(() => T.run()); await ev(() => { F.onRequest = null; });
check('cancel stops the run', r.ok && r.sum.cancelled === true, JSON.stringify(r.sum));
check('cancel left some files for the next run', (await ev(() => F.tree().filter(x => x.includes('many')).length)) < 6);
r = await ev(() => T.run()); check('next run finishes the rest', r.ok && (await ev(() => F.tree().filter(x => /many\d\.pdf$/.test(x)).length)) === 6, JSON.stringify(r.sum));

// ---------------------------------------------------------------- 9. UI
await ev(() => { T.prefs.remove('sync_enabled'); T.prefs.remove('sync_auto'); F.google.configured = false; F.google.signedIn = false; F.google.email = ''; });
check('sync is OFF by default', (await ev(() => T.prefs.getBoolean('sync_enabled', false))) === false);
await ev(() => T.app.showSyncSettings?.() || T.UI.showSyncSettings(T.app)); await page.waitForSelector('[data-tag=sync_settings]'); await shot('01-ui-off');
check('switch is off by default', (await page.getAttribute('[data-tag=sync_enable]', 'aria-checked')) === 'false');
await page.click('[data-tag=sync_enable]'); await page.waitForTimeout(300);
check('toggle enables (pref saved)', await ev(() => T.prefs.getBoolean('sync_enabled', false)));
check('sign-in disabled until configured', await page.isDisabled('[data-tag=sync_signin]') && (await page.innerText('.sy-account')).includes('먼저 OAuth 클라이언트를 설정하세요'));
await shot('02-ui-unconfigured');
check('OAuth box is open while unconfigured and explains the how-to', (await page.getAttribute('[data-tag=sync_oauth]', 'open')) !== null && (await page.innerText('[data-tag=sync_oauth]')).includes('데스크톱 앱')); await shot('03-ui-howto');
await page.fill('[data-tag=sync_client_id]', 'abc.apps.googleusercontent.com'); await page.fill('[data-tag=sync_client_secret]', 'GOCSPX-secret'); await page.click('[data-tag=sync_save_config]'); await page.waitForTimeout(300);
check('config saved through google.config', (await ev(() => F.google.clientId)) === 'abc.apps.googleusercontent.com' && !(await page.isDisabled('[data-tag=sync_signin]')));
check('secret is not echoed back', (await page.inputValue('[data-tag=sync_client_secret]')) === '');
await page.click('[data-tag=sync_signin]'); await page.waitForTimeout(400);
check('sign-in shows the account e-mail', (await page.innerText('.sy-account')).includes('tester@example.com'));
await ev(() => { F.offline = true; }); await page.click('[data-tag=sync_signout]'); await page.waitForTimeout(300);
await page.click('[data-tag=sync_signin]'); await page.waitForTimeout(400);
check('offline sign-in -> readable Korean error', (await page.innerText('[data-tag=sync_last]')).includes('인터넷에 연결할 수 없어') || (await page.locator('.toast').last().innerText()).includes('인터넷'));
await ev(() => { F.offline = false; }); await page.click('[data-tag=sync_signin]'); await page.waitForTimeout(400);
await page.click('[data-tag=sync_auto\\:2]'); await page.waitForTimeout(100);
check('auto interval choice saved', (await ev(() => T.prefs.getInt('sync_auto', 0))) === 2);
await page.uncheck('[data-tag=sync_assets]'); check('subset pref saved', (await ev(() => T.prefs.getBoolean('sync_assets', true))) === false); await page.check('[data-tag=sync_assets]');
await ev(() => { T.mkPdf('ui.pdf', new Uint8Array(700).fill(33)); });
await page.click('[data-tag=sync_now]'); await page.waitForFunction(() => /마지막 동기화/.test(document.querySelector('[data-tag=sync_last]').textContent), null, { timeout: 20000 }); await shot('04-ui-done');
const last = await page.innerText('[data-tag=sync_last]'); check('last sync status shown', /올림 \d/.test(last), last);
check('log shows entries', (await page.innerText('[data-tag=sync_log]')).includes('동기화 시작'));
// progress state
await ev(() => { T.mkPdf('slow.pdf', new Uint8Array(700).fill(34)); F.onRequest = () => new Promise(r => setTimeout(r, 350)); });
await page.click('[data-tag=sync_now]'); await page.waitForTimeout(900); await shot('05-ui-running');
check('cancel button visible while running', await page.isVisible('[data-tag=sync_cancel]'));
await page.click('[data-tag=sync_cancel]'); await page.waitForFunction(() => document.querySelector('[data-tag=sync_cancel]').style.display === 'none', null, { timeout: 20000 }); await ev(() => { F.onRequest = null; });
check('cancel reflected in the UI', (await page.innerText('[data-tag=sync_progress]')).includes('취소'), await page.innerText('[data-tag=sync_progress]'));
// offline run from the UI
await ev(() => { F.offline = true; T.mkPdf('ui2.pdf', new Uint8Array(700).fill(35)); });
await page.click('[data-tag=sync_now]'); await page.waitForFunction(() => /실패/.test(document.querySelector('[data-tag=sync_last]').textContent), null, { timeout: 20000 });
check('offline sync shows a clear Korean failure', (await page.innerText('[data-tag=sync_last]')).includes('인터넷에 연결할 수 없어'));
await shot('06-ui-offline'); await ev(() => { F.offline = false; });
// deletion confirmation dialog (interactive)
await ev(async () => { await T.lib.trash(T.lib.root + '\\ui.pdf'); });
await page.click('[data-tag=sync_now]'); await page.waitForSelector('[data-tag=sync_delete_list]'); await shot('07-ui-delete-confirm');
check('deletion list shows the file', (await page.innerText('[data-tag=sync_delete_list]')).includes('ui.pdf'));
await page.click('.ad-btn >> text=삭제 안 함'); await page.waitForTimeout(1200);
check('declining keeps the Drive copy', await ev(() => !!F.byPath('Everynote Sync/ui.pdf')));
await shot('08-ui-final');
await page.click('.ad-btn >> text=닫기'); await page.waitForTimeout(300);
// controller auto-sync (unattended: deletions are deferred, no dialogs)
await ev(async () => { T.mkPdf('auto1.pdf', new Uint8Array(700).fill(36)); T.prefs.putInt('sync_auto', 1); await T.UI.getSyncController(T.app).auto(); });
check('auto sync uploads in the background without a dialog', (await ev(() => !!F.byPath('Everynote Sync/auto1.pdf'))) && (await page.locator('.ad-root').count()) === 0);
console.log(`\n${fails} failed, ${errors} errors`);
await browser.close(); server.close(); process.exit(fails || errors ? 1 : 0);
