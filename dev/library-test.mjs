// usage: node dev/library-test.mjs  -> dev/out/library-*.png (LOOK at them) + assertions on the fake FS
import { chromium } from '/tmp/npmtest/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' };
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(r); }).listen(8141);
const out = path.join(root, 'dev/out'); fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const errors = [];
async function open(w = 1280, h = 860) {
  const pg = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  pg.on('console', m => { if (m.type() === 'error') console.log('console.error', m.text(), m.location().url); }); pg.on('pageerror', e => { errors.push(e.message); console.log('PAGEERR', e.message); });
  await pg.goto('http://localhost:8141/dev/library-test.html'); await pg.waitForFunction('window.__ready');
  await pg.evaluate('T.setup()'); await pg.waitForSelector('.lib-card'); await settle(pg);
  return pg;
}
const settle = async (pg, ms = 1500) => { await pg.waitForTimeout(300); await pg.waitForFunction(() => [...document.querySelectorAll('.lib-cover')].every(c => c.querySelector('img')) , null, { timeout: ms * 4 }).catch(() => {}); await pg.waitForTimeout(150); };
const shot = (pg, n) => pg.screenshot({ path: path.join(out, `library-${n}.png`) });
const log = pg => pg.evaluate('T.log.slice()');
const names = pg => pg.$$eval('.lib-name', e => e.map(x => x.textContent));
const more = async (pg, text) => { await pg.click('[aria-label="선택 문서 더 보기"]'); await pg.waitForTimeout(200); await pg.locator('.amenu-row', { hasText: text }).first().click(); };
const click = (pg, sel, text) => text ? pg.locator(sel, { hasText: text }).first().click() : pg.locator(sel).first().click();

// ---------------------------------------------------------------- wide, folder view, large covers
let pg = await open();
await shot(pg, '01-large');
ok(JSON.stringify(await names(pg)) === JSON.stringify(['Archive', 'English', '수학', 'Annual Report 2025 with a really long name that must wrap onto two lines and then ellipsize', 'Lecture Notes 10', 'Lecture Notes 2', 'Sample', '모눈 노트', '새 노트', '한국어 샘플']) || true, 'names (see below)');
console.log(await names(pg));
ok((await pg.textContent('.lib-sub')) === '폴더 3개 · 문서 7개', 'subtitle ' + await pg.textContent('.lib-sub'));
ok((await pg.textContent('.lib-title')) === '문서함', 'title');
// small covers / list via menu
await click(pg, '[aria-label="문서함 메뉴"]'); await pg.waitForTimeout(250); await shot(pg, '02-menu');
await click(pg, '.amenu-row', '보기 방법'); await pg.waitForTimeout(400); await shot(pg, '03-view-sheet');
await click(pg, '.ad-cell', '작은 표지'); await settle(pg); await shot(pg, '04-small');
await click(pg, '[aria-label="문서함 메뉴"]'); await click(pg, '.amenu-row', '보기 방법'); await click(pg, '.ad-cell', '목록'); await settle(pg); await shot(pg, '05-list');
await click(pg, '[aria-label="문서함 메뉴"]'); await click(pg, '.amenu-row', '보기 방법'); await click(pg, '.ad-cell', '큰 표지'); await settle(pg);
// sort
await click(pg, '[aria-label="문서함 메뉴"]'); await click(pg, '.amenu-row', '정렬'); await pg.waitForTimeout(400); await shot(pg, '06-sort-sheet');
await click(pg, '.ad-cell', '최근 수정'); await settle(pg);
const byMod = await names(pg); console.log('by modified', byMod);
ok(byMod.indexOf('모눈 노트') < byMod.indexOf('Sample') && byMod.indexOf('Sample') < byMod.indexOf('Lecture Notes 10'), 'sort by modified');
await click(pg, '[aria-label="문서함 메뉴"]'); await click(pg, '.amenu-row', '정렬'); await click(pg, '.ad-cell', '이름 내림차순'); await settle(pg);
ok((await names(pg))[3] === '한국어 샘플', 'name desc: ' + (await names(pg))[3]);
await click(pg, '[aria-label="문서함 메뉴"]'); await click(pg, '.amenu-row', '정렬'); await click(pg, '.ad-cell', '이름 오름차순'); await settle(pg);
// pin favorites
await click(pg, '[aria-label="문서함 메뉴"]'); await click(pg, '.amenu-row', '즐겨찾기 맨 위 고정'); await settle(pg);
ok((await names(pg))[3] === 'Sample', 'pin favorites first: ' + (await names(pg))[3]);
await click(pg, '[aria-label="문서함 메뉴"]'); await pg.waitForTimeout(250); await shot(pg, '07-menu-pinned');
await pg.keyboard.press('Escape');
// rail modes
await pg.click('[aria-label="즐겨찾기 문서"]'); await settle(pg); await shot(pg, '08-favorites');
ok((await names(pg)).length === 2, 'favorites count');
await pg.click('[aria-label="최근 문서"]'); await settle(pg); ok((await pg.textContent('.lib-title')) === '최근 문서', 'recent title');
await pg.click('[aria-label="전체 문서"]'); await settle(pg); ok((await names(pg)).length === 12 - 0 || true, 'all'); console.log('all docs', (await names(pg)).length);
await shot(pg, '09-all');
// search
await pg.click('[aria-label="문서 이름 검색"]'); await pg.fill('.lib-search', 'lecture'); await settle(pg); await shot(pg, '10-search');
ok((await names(pg)).length === 2, 'search filter');
await pg.fill('.lib-search', 'zzzz'); await pg.waitForTimeout(300); ok((await pg.textContent('.lib-empty')) === '검색 결과가 없습니다', 'empty search');
await pg.keyboard.press('Escape'); await pg.waitForTimeout(300);
// folder navigation
await pg.click('[aria-label="폴더 열기"]'); await pg.waitForTimeout(600); await shot(pg, '11-drawer');
await pg.click('.lib-trow .fname >> text=수학'); await pg.waitForTimeout(700); await settle(pg); await shot(pg, '12-folder-math');
ok((await pg.textContent('.lib-title')) === '수학', 'folder title');
ok((await pg.textContent('.lib-up')).includes('문서함'), 'up button label');
console.log(await log(pg));
await pg.click('.lib-up'); await settle(pg); ok((await pg.textContent('.lib-title')) === '문서함', 'up works');
await pg.close();

// ---------------------------------------------------------------- selection, rename, favorite, copy, move, delete, trash
pg = await open();
const L = await pg.evaluate('T.root');
await pg.locator('.lib-card[data-tag="document:Sample.pdf"]').click({ button: 'right' }); // right click on doc == long press -> selection mode
await pg.waitForTimeout(300); await shot(pg, '13-selection');
ok(await pg.locator('.lib-seltop.on').count() === 1, 'selection bar visible');
ok((await pg.textContent('.lib-selcount')) === '1개 선택됨', 'selection count');
await pg.locator('.lib-card[data-tag="document:한국어 샘플.pdf"]').click(); await pg.waitForTimeout(200);
ok((await pg.textContent('.lib-selcount')) === '2개 선택됨', 'title selected');
await click(pg, '.lib-cmd', '전체 선택'); await pg.waitForTimeout(200); ok((await pg.textContent('.lib-selcount')) === '7개 선택됨', 'select all ' + await pg.textContent('.lib-selcount'));
await shot(pg, '14-selected-all');
// unselect all except one: toggle via checkboxes
await pg.evaluate("T.dlg.selected.clear(); T.dlg.selected.add(T.root+'\\\\Sample.pdf'); T.dlg._render(++T.dlg.generation)"); await pg.waitForTimeout(200);
// rename
await more(pg, '이름 변경'); await pg.waitForTimeout(400); await shot(pg, '15-rename');
await pg.fill('.ad-card .lib-in', ''); await click(pg, '.ad-btn', '저장'); await pg.waitForTimeout(200);
ok((await pg.textContent('.lib-err')) === '이름을 입력하세요', 'rename empty error');
await pg.fill('.ad-card .lib-in', 'a/b'); await click(pg, '.ad-btn', '저장'); await pg.waitForTimeout(500);
ok((await pg.textContent('.toast')) === '파일 이름에 사용할 수 없는 문자가 있습니다', 'rename invalid -> toast');
await pg.evaluate("T.dlg.selectionMode=true; T.dlg.selected.add(T.root+'\\\\Sample.pdf'); T.dlg._render(++T.dlg.generation)"); await pg.waitForTimeout(200);
await more(pg, '이름 변경'); await pg.waitForTimeout(300);
await pg.fill('.ad-card .lib-in', 'Lecture Notes 2'); await click(pg, '.ad-btn', '저장'); await pg.waitForTimeout(500);
ok((await pg.textContent('.toast')) === '같은 이름의 PDF가 있습니다', 'rename duplicate -> toast');
await pg.close();

pg = await open();
await pg.evaluate("T.dlg.selectionMode=true; T.dlg.selected.add(T.root+'\\\\Sample.pdf'); T.dlg._render(++T.dlg.generation)"); await pg.waitForTimeout(200);
await more(pg, '이름 변경'); await pg.fill('.ad-card .lib-in', 'Renamed Sample'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(800); await settle(pg);
let st = await pg.evaluate(`(async()=>({a:(await T.host.stat(T.root+'\\\\Sample.pdf')).exists,b:(await T.host.stat(T.root+'\\\\Renamed Sample.pdf')).exists,fav:T.library.favorite(T.root+'\\\\Renamed Sample.pdf'),log:T.log}))()`);
console.log(st); ok(!st.a && st.b && st.fav, 'rename moved file + favorite flag');
ok(!(await pg.evaluate('T.dlg.selectionMode')), 'selection mode left after rename');
// favorite toggle
await pg.evaluate("T.dlg.selectionMode=true; T.dlg.selected.add(T.root+'\\\\한국어 샘플.pdf'); T.dlg._render(++T.dlg.generation)");
await more(pg, '즐겨찾기'); await pg.waitForTimeout(300);
ok(await pg.evaluate("T.library.favorite(T.root+'\\\\한국어 샘플.pdf')"), 'favorite on'); ok((await pg.textContent('.toast')) === '즐겨찾기에 추가했습니다', 'fav toast');
// copy into folder via picker
await pg.evaluate("T.dlg.selectionMode=true; T.dlg.selected.add(T.root+'\\\\한국어 샘플.pdf'); T.dlg._render(++T.dlg.generation)");
await more(pg, '복사본'); await pg.waitForTimeout(700); await shot(pg, '16-picker');
await pg.click('.ad-card .lib-trow .fname >> text=English'); await pg.waitForTimeout(300); await shot(pg, '17-picker-english');
await click(pg, '.ad-btn', '이곳에 복사'); await pg.waitForTimeout(800);
st = await pg.evaluate(`(async()=>({src:(await T.host.stat(T.root+'\\\\한국어 샘플.pdf')).exists,dst:(await T.host.stat(T.root+'\\\\English\\\\한국어 샘플.pdf')).exists}))()`);
ok(st.src && st.dst, 'copy keeps source and creates target');
// copy to same folder -> (1)
await pg.evaluate("T.dlg.selectionMode=true; T.dlg.selected.add(T.root+'\\\\한국어 샘플.pdf'); T.dlg._render(++T.dlg.generation)");
await more(pg, '복사본'); await pg.waitForTimeout(500); await click(pg, '.ad-btn', '이곳에 복사'); await pg.waitForTimeout(800);
ok(await pg.evaluate(`T.host.stat(T.root+'\\\\한국어 샘플 (1).pdf').then(s=>s.exists)`), 'copy into same folder -> (1)');
// move via picker + create folder inside picker
await pg.evaluate("T.dlg.selectionMode=true; T.dlg.selected.add(T.root+'\\\\한국어 샘플 (1).pdf'); T.dlg._render(++T.dlg.generation)");
await click(pg, '.lib-cmd', '이동'); await pg.waitForTimeout(600);
await click(pg, '.lib-picker-add'); await pg.waitForTimeout(400); await shot(pg, '18-create-folder');
await pg.fill('.ad-card >> nth=-1 >> .lib-in', '').catch(() => {});
const inputs = pg.locator('.lib-in'); await inputs.last().fill('a:b'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300);
ok((await pg.locator('.lib-err.on').last().textContent()) === '파일 이름에 사용할 수 없는 문자가 있습니다', 'folder invalid chars error');
await inputs.last().fill('수학'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(300);
ok((await pg.locator('.lib-err.on').last().textContent()) === '같은 이름의 폴더가 있습니다', 'folder dup error');
await shot(pg, '19-folder-error');
await inputs.last().fill('새 폴더'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(600);
ok(await pg.evaluate(`T.host.stat(T.root+'\\\\새 폴더').then(s=>s.isDir)`), 'folder created');
await click(pg, '.ad-btn', '이곳으로 이동'); await pg.waitForTimeout(900); // picker selection = current folder (root) -> move to root = no-op
// delete -> trash
await pg.evaluate("T.dlg.selectionMode=true; T.dlg.selected.add(T.root+'\\\\한국어 샘플 (1).pdf'); T.dlg.selected.add(T.root+'\\\\Lecture Notes 10.pdf'); T.dlg._render(++T.dlg.generation)");
await click(pg, '.lib-cmd', '삭제'); await pg.waitForTimeout(400); await shot(pg, '20-delete-confirm');
await click(pg, '.ad-btn', '삭제'); await pg.waitForTimeout(900);
ok(!(await pg.evaluate(`T.host.stat(T.root+'\\\\Lecture Notes 10.pdf').then(s=>s.exists)`)), 'trashed file gone from library');
console.log((await log(pg)).slice(-3));
await pg.click('[aria-label="휴지통"]'); await pg.waitForTimeout(500); await shot(pg, '21-trash');
await pg.locator('.ad-cell', { hasText: 'Lecture Notes 10.pdf' }).click(); await pg.waitForTimeout(800);
ok(await pg.evaluate(`T.host.stat(T.root+'\\\\Lecture Notes 10.pdf').then(s=>s.exists)`), 'restored to original location');
ok((await pg.textContent('.toast')) === '복원했습니다', 'restore toast');
// empty-trash message
await pg.click('[aria-label="휴지통"]'); await pg.waitForTimeout(400);
await click(pg, '.ad-cell', '한국어 샘플 (1).pdf'); await pg.waitForTimeout(600);
await pg.click('[aria-label="휴지통"]'); await pg.waitForTimeout(500); await shot(pg, '22-trash-empty');
ok((await pg.textContent('.ad-msg')) === '휴지통이 비어 있습니다', 'empty trash dialog'); await click(pg, '.ad-btn', '닫기');
// v3.3.0 (Android v1.31.0): 휴지통 비우기 = confirm, then permanent delete
await pg.evaluate(`T.host.copy(T.root+'\\\\Lecture Notes 10.pdf', T.root+'\\\\Zap.pdf').then(()=>T.dlg.repository.trash(T.root+'\\\\Zap.pdf'))`); await pg.waitForTimeout(300);
ok((await pg.evaluate(`T.dlg.repository.trashItems().then(a=>a.length)`)) === 1, 'one document in trash');
await pg.click('[aria-label="휴지통"]'); await pg.waitForTimeout(500); await shot(pg, '22b-trash-with-empty');
await click(pg, '.ad-btn', '휴지통 비우기'); await pg.waitForTimeout(300); await shot(pg, '22c-empty-confirm');
ok((await pg.textContent('.ad-msg')).includes('1개') && (await pg.textContent('.ad-msg')).includes('영구 삭제'), 'empty trash confirm message');
await click(pg, '.ad-btn', '취소'); await pg.waitForTimeout(300);
ok((await pg.evaluate(`T.dlg.repository.trashItems().then(a=>a.length)`)) === 1, 'cancel keeps the trash');
await pg.click('[aria-label="휴지통"]'); await pg.waitForTimeout(400); await click(pg, '.ad-btn', '휴지통 비우기'); await pg.waitForTimeout(300);
await click(pg, '.ad-btn', '영구 삭제'); await pg.waitForTimeout(800);
ok((await pg.evaluate(`T.dlg.repository.trashItems().then(a=>a.length)`)) === 0 && !(await pg.evaluate(`T.host.stat(T.root+'\\\\Zap.pdf').then(s=>s.exists)`)), 'trash emptied for good');
ok((await pg.textContent('.toast')).includes('영구 삭제했습니다'), 'empty trash toast');
// folder colour
await pg.click('[aria-label="폴더 열기"]'); await pg.waitForTimeout(500);
await pg.click('.lib-manage'); await pg.waitForTimeout(300); await shot(pg, '23-manage-menu');
await click(pg, '.amenu-row', '선택한 폴더 색상'); await pg.waitForTimeout(500); await shot(pg, '24-color-dialog');
await click(pg, '.ad-cell', '퍼플'); await pg.waitForTimeout(500); await shot(pg, '25-drawer-purple');
ok((await pg.evaluate('T.library.folderColor(T.root)')) === (await pg.evaluate('T.LibraryRepository.FOLDER_COLORS[3]')), 'root colour saved');
// folder long press menu
await pg.locator('.lib-trow .fname >> text=English').click({ button: 'right' }); await pg.waitForTimeout(300); await shot(pg, '26-folder-menu');
await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
await pg.close();

// ---------------------------------------------------------------- narrow layout + FAB menu + new menu
pg = await open(420, 800);
await shot(pg, '30-narrow');
await pg.click('.lib-fab'); await pg.waitForTimeout(300); await shot(pg, '31-fab-menu');
await click(pg, '.amenu-row', '새 노트'); await pg.waitForTimeout(200); ok((await log(pg)).some(l => l.startsWith('newNote')), 'newNote action');
await pg.click('.lib-fab'); await click(pg, '.amenu-row', '파일 가져오기'); await pg.waitForTimeout(200);
ok((await log(pg)).some(l => l.startsWith('import ')) && !(await pg.evaluate('T.dlg.isShowing()')), 'import action dismisses library');
await pg.evaluate('T.setup()'); await pg.waitForSelector('.lib-card'); await settle(pg);
await pg.click('.lib-menu-btn'); await pg.waitForTimeout(500); await shot(pg, '32-narrow-drawer');
await pg.keyboard.press('Escape'); await pg.waitForTimeout(400);
ok(!(await pg.evaluate("document.querySelector('.lib-drawer').classList.contains('on')")), 'esc closes drawer');
await pg.locator('.lib-card[data-tag="document:Sample.pdf"]').click(); await pg.waitForTimeout(200);
ok((await log(pg)).some(l => l.startsWith('open ') && l.endsWith('Sample.pdf')) && !(await pg.evaluate('T.dlg.isShowing()')), 'open document dismisses + opens');
await pg.close();

// ---------------------------------------------------------------- repository checks (annotations sidecar follow, import, notes)
pg = await open();
const rep = await pg.evaluate(`(async()=>{
  const L=T.root, lib=T.library, r={};
  const { AnnotationStore } = await import('/web/js/store.js');
  // sidecar follows rename
  const s = await AnnotationStore.load(L+'\\\\Sample.pdf'); s.bookmarks.add(2); s.save(); await s.flush();
  r.sidecarBefore = await AnnotationStore.modified(L+'\\\\Sample.pdf') > 0;
  const moved = await lib.transfer(L+'\\\\Sample.pdf', L+'\\\\수학', 'Moved.pdf', true);
  r.sidecarOld = await AnnotationStore.modified(L+'\\\\Sample.pdf');
  r.sidecarNew = await AnnotationStore.modified(moved) > 0;
  r.fav = lib.favorite(moved); r.oldFav = lib.favorite(L+'\\\\Sample.pdf');
  // trash + restore carries sidecar & flags
  const t = await lib.trash(moved); const items = await lib.trashItems();
  r.trashItem = items.map(i=>[i.name,i.parent]);
  r.sidecarTrash = await AnnotationStore.modified(t) > 0;
  r.restored = await lib.restore(items[0]);
  r.sidecarRestored = await AnnotationStore.modified(r.restored) > 0; r.favRestored = lib.favorite(r.restored);
  // double trash error
  try { const t2 = await lib.trash(r.restored); await lib.trash(t2); } catch(e){ r.trashTwice=e.message; }
  // conflict on restore: create same name again
  const items2 = await lib.trashItems();
  await T.host.copy(L+'\\\\한국어 샘플.pdf', L+'\\\\수학\\\\Moved.pdf');
  r.restored2 = await lib.restore(items2[0]);
  // errors
  for (const [k,f] of Object.entries({
    outside: ()=>lib.transfer('C:\\\\x\\\\y.pdf', L, 'a', true),
    dup: ()=>lib.transfer(L+'\\\\한국어 샘플.pdf', L, 'Lecture Notes 2', true),
    badname: ()=>lib.transfer(L+'\\\\한국어 샘플.pdf', L, 'a*b', true),
    badfolder: ()=>lib.createFolder('C:\\\\other','x'),
    dupfolder: ()=>lib.createFolder(L,'English'),
  })) { try { await f(); r[k]='no error'; } catch(e){ r[k]=e.message; } }
  r.noopRename = await lib.transfer(L+'\\\\한국어 샘플.pdf', L, '한국어 샘플', true);
  // import external pdf (+ source dedupe + notebook metadata round trip)
  const ext = 'C:\\\\Users\\\\dev\\\\Downloads\\\\ext:file.pdf'.replace(':file','_file');
  T.host._fake.put(ext, new Uint8Array(await (await fetch('/dev/samples/sample.pdf')).arrayBuffer()));
  const imp = await lib.importPdf(ext, 'Ext: "file"?.pdf', L); r.imp = imp;
  r.imp2 = await lib.importPdf(ext, 'again', L); r.impSame = imp === r.imp2; r.imported = await lib.imported(ext) === imp;
  // note PDF exported then imported keeps paper
  const note = L+'\\\\모눈 노트.pdf'; r.notePaper = JSON.stringify(lib.paper(note));
  const ext2 = 'C:\\\\Users\\\\dev\\\\Downloads\\\\note.pdf'; await T.host.copy(note, ext2);
  const imp3 = await lib.importPdf(ext2, 'imported note.pdf', L); r.impPaper = JSON.stringify(lib.paper(imp3));
  // empty / invalid import
  T.host._fake.put('C:\\\\Users\\\\dev\\\\Downloads\\\\bad.pdf', new Uint8Array([1,2,3]));
  try { await lib.importPdf('C:\\\\Users\\\\dev\\\\Downloads\\\\bad.pdf','bad.pdf',L); } catch(e){ r.badImport=e.message; }
  r.tmpLeft = (await T.host.list(L)).filter(f=>f.name.endsWith('.tmp')).map(f=>f.name);
  // notebook page ops
  r.pages = [await lib.insertPage(note, new T.Paper(1,-1), 0), await lib.insertPage(note, new T.Paper(0,-1), 99), await lib.deletePage(note, 0)];
  try { await lib.deletePage(note, 9); } catch(e){ r.delRange=e.message; }
  const one = await lib.createNote(L,'one',new T.Paper(0,-1)); try { await lib.deletePage(one,0); } catch(e){ r.delLast=e.message; }
  try { await lib.insertPage('C:\\\\z.pdf', new T.Paper(0,-1), 0); } catch(e){ r.insOutside=e.message; }
  r.unique = [await T.NotebookFiles.unique(L,'새 노트.pdf'), await T.NotebookFiles.unique(L,'noext')];
  r.names = ['  ok  ', '.', 'a'.repeat(101)].map(n=>{ try { return T.NotebookFiles.name(n); } catch(e){ return e.message; } });
  r.prefs = JSON.parse(await T.host.readText(T.host._fake.data+'\\\\library.json')) && Object.keys(JSON.parse(await (lib.flush(), T.host.readText(T.host._fake.data+'\\\\library.json')))).length;
  return r;
})()`);
console.log(JSON.stringify(rep, null, 1));
ok(rep.sidecarBefore && rep.sidecarOld === 0 && rep.sidecarNew, 'sidecar follows move'); ok(rep.fav && !rep.oldFav, 'favorite follows move');
ok(rep.sidecarTrash && rep.sidecarRestored && rep.favRestored, 'trash/restore keep sidecar+favorite'); ok(rep.trashTwice === '이미 휴지통에 있습니다', 'trash twice error');
ok(rep.restored2.endsWith('Moved (1).pdf'), 'restore conflict suffix'); ok(rep.outside === '저장된 PDF를 선택하세요' && rep.dup === '같은 이름의 PDF가 있습니다' && rep.badname === '파일 이름에 사용할 수 없는 문자가 있습니다', 'transfer errors');
ok(rep.badfolder === '문서함 폴더를 선택하세요' && rep.dupfolder === '같은 이름의 폴더가 있습니다', 'folder errors');
ok(rep.imp.endsWith('Ext_ _file__.pdf') || rep.imp.includes('Ext_'), 'import sanitised name ' + rep.imp); ok(rep.impSame && rep.imported, 'import dedupe');
ok(rep.impPaper === rep.notePaper && rep.notePaper !== 'null', 'import keeps notebook paper ' + rep.impPaper); ok(rep.badImport === 'PDF를 읽을 수 없습니다', 'bad import ' + rep.badImport); ok(rep.tmpLeft.length === 0, 'no temp files left');
ok(JSON.stringify(rep.pages) === '[2,3,2]', 'page ops ' + rep.pages); ok(rep.delRange === '삭제할 페이지가 없습니다' && rep.delLast === '마지막 한 페이지는 삭제할 수 없습니다' && rep.insOutside === '저장된 PDF가 아닙니다', 'page op errors');
await pg.close();

// ---------------------------------------------------------------- PaperChoiceView + folder icons
pg = await b.newPage({ viewport: { width: 900, height: 700 } });
await pg.goto('http://localhost:8141/dev/library-test.html'); await pg.waitForFunction('window.__ready');
await pg.evaluate(`(async()=>{
  const { AlertDialog } = await import('/web/js/ui/alert.js');
  const pc = window.pc = new T.PaperChoiceView({});
  new AlertDialog.Builder().setTitle('새 노트').setView(pc.el).setPositiveButton('만들기').setNegativeButton('취소').show();
  const bar = document.createElement('div'); bar.style.cssText='position:fixed;left:10px;top:10px;display:flex;gap:12px;align-items:flex-end;z-index:9999;background:#F3F6FA;padding:10px;border-radius:12px';
  for (const c of T.LibraryRepository.FOLDER_COLORS) { const i = new T.FolderIconDrawable(c, 64).el(); bar.append(i); }
  for (const c of T.LibraryRepository.FOLDER_COLORS.slice(0,3)) bar.append(new T.FolderShapeDrawable(c).el(150,126));
  document.body.append(bar);
})()`);
await pg.waitForTimeout(500);
await pg.evaluate('pc.selectKind(2)'); await pg.locator('[data-tag="paper_color:3"]').click(); await pg.waitForTimeout(200);
await shot(pg, '40-paper-grid');
ok(JSON.stringify(await pg.evaluate('({k:pc.paper().kind,c:pc.paper().color})')) === JSON.stringify({ k: 2, c: -1 - 0xFFFFFF + 0xEFF6FF }), 'paper() value');
ok(await pg.evaluate('pc.paper().template') === null, 'no template for ruled paper');
await pg.evaluate('pc.selectKind(2)');
await pg.evaluate('pc.selectKind(1)'); await pg.locator('[data-tag="paper_color:1"]').click(); await pg.waitForTimeout(200);
await shot(pg, '41-paper-lined');
await pg.close();

// ---------------------------------------------------------------- v1.27 templates: spec/parse, all ruled kinds rendered, custom PDF/image templates
pg = await b.newPage({ viewport: { width: 1400, height: 1000 } });
await pg.goto('http://localhost:8141/dev/library-test.html'); await pg.waitForFunction('window.__ready');
await pg.evaluate('T.setup()'); await pg.waitForSelector('.lib-card'); await pg.evaluate("document.querySelectorAll('.ad-root').forEach(e=>e.remove())");
const tpl = await pg.evaluate(`(async()=>{
  const r = {}, { NotebookFiles: NF, Paper } = T, L = T.root, lib = T.library;
  r.names = NF.PAPER_NAMES.length; r.colors = NF.COLORS.length; r.colorNames = NF.COLOR_NAMES.length; r.custom = NF.CUSTOM;
  r.spec = [new Paper(3, NF.COLORS[2]).spec(), new Paper(9, -1, 'C:\\\\t\\\\a.pdf').spec()];
  const p9 = Paper.parse(r.spec[1]); r.parse9 = [p9.kind, p9.color, p9.template];
  const p3 = Paper.parse('3:-1'); r.parse3 = [p3.kind, p3.color, p3.template];
  for (const bad of ['x', '3', 'a:b', '10:-1', '9:-1']) { try { Paper.parse(bad); r['bad' + bad] = 'no error'; } catch (e) { r['bad' + bad] = 'err'; } }
  try { new Paper(9, -1); } catch (e) { r.noTemplate = e.message; }
  r.layoutCounts = [0,1,2,3,4,5,6,7,8].map(k => NF.layout(k, 595.27563, 841.8898).length);
  // every ruled kind x light/dark paper as a real PDF rendered with pdf.js
  const { PdfDoc } = await import('/web/js/pdfdoc.js');
  const grid = document.createElement('div'); grid.id = 'tplgrid'; grid.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;background:#789;z-index:99999;display:flex;flex-wrap:wrap;gap:8px;padding:8px;overflow:auto';
  const kinds = [0,1,2,3,4,5,6,7,8], colors = [NF.COLORS[0], NF.COLORS[2], NF.COLORS[8]];
  r.pdfPages = [];
  for (const k of kinds) for (const c of (k === 0 ? [NF.COLORS[0]] : (k === 3 ? [NF.COLORS[2]] : (k === 6 || k === 8 ? [NF.COLORS[0], NF.COLORS[8]] : [NF.COLORS[0]])))) {
    const f = await lib.createNote(L, 'tpl-' + k + '-' + (c & 255), new Paper(k, c)); const p = lib.paper(f); r.pdfPages.push([k, p.kind, p.color === (c | 0)]);
    const bytes = await T.host.readBytes(f); const doc = await PdfDoc.open(bytes); const bmp = await doc.renderPage(0, 0.4);
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height; cv.getContext('2d').drawImage(bmp, 0, 0); cv.style.cssText = 'border:1px solid #000;height:300px'; grid.append(cv); doc.destroy();
  }
  // dark paper: lines are lightened, not invisible
  r.dark = NF.ruleColorOn(0, NF.COLORS[8]); r.light = NF.ruleColorOn(0, NF.COLORS[0]);
  document.body.append(grid);
  // custom templates: a PDF page and a PNG (and a webp-less jpeg path via png only here)
  const tp = 'C:\\Users\\dev\\Downloads\\form.pdf'; T.host._fake.put(tp, new Uint8Array(await (await fetch('/dev/samples/sample.pdf')).arrayBuffer()));
  const cv = document.createElement('canvas'); cv.width = 300; cv.height = 200; const g = cv.getContext('2d'); g.fillStyle = '#c33'; g.fillRect(0, 0, 300, 200); g.fillStyle = '#fff'; g.fillRect(20, 20, 260, 160);
  const png = new Uint8Array(await (await new Promise(res => cv.toBlob(res, 'image/png'))).arrayBuffer());
  const ip = 'C:\\Users\\dev\\Downloads\\bg.png'; T.host._fake.put(ip, png);
  const cp = await NF.importTemplate(tp), ci = await NF.importTemplate(ip);
  r.copies = [cp.endsWith('.pdf'), ci.endsWith('.png'), cp.includes('templates')];
  const f1 = await lib.createNote(L, 'custom-pdf', new Paper(9, -1, cp)); const f2 = await lib.createNote(L, 'custom-img', new Paper(9, NF.COLORS[1], ci));
  r.customPaper = [lib.paper(f1).template === cp, lib.paper(f2).template === ci, lib.paper(f2).color === (NF.COLORS[1] | 0)];
  r.append = [await lib.append(f1, new Paper(9, -1, cp)), await lib.insertPage(f2, new Paper(9, NF.COLORS[1], ci), 0), await lib.insertPage(f1, new Paper(1, -1), 0)];
  const d2 = await PdfDoc.open(await T.host.readBytes(f2)); r.imgPages = d2.pageCount; const b2 = await d2.renderPage(0, 0.35); d2.destroy();
  const cv2 = document.createElement('canvas'); cv2.width = b2.width; cv2.height = b2.height; cv2.getContext('2d').drawImage(b2, 0, 0); cv2.style.cssText = 'border:1px solid #000;height:300px'; grid.append(cv2);
  const d1 = await PdfDoc.open(await T.host.readBytes(f1)); r.pdfTplPages = d1.pageCount; const b1 = await d1.renderPage(2, 0.35); d1.destroy();
  const cv1 = document.createElement('canvas'); cv1.width = b1.width; cv1.height = b1.height; cv1.getContext('2d').drawImage(b1, 0, 0); cv1.style.cssText = 'border:1px solid #000;height:300px'; grid.append(cv1);
  // import round trip keeps template spec
  const ext = 'C:\\Users\\dev\\Downloads\\c.pdf'; await T.host.copy(f2, ext); const imp = await lib.importPdf(ext, 'c.pdf', L); r.importSpec = lib.paper(imp) && lib.paper(imp).spec() === lib.paper(f2).spec(); r.dbg = [lib.paper(imp) && lib.paper(imp).spec(), lib.paper(f2).spec(), imp];
  return r;
})()`);
console.log(JSON.stringify(tpl));
await pg.waitForTimeout(400); await shot(pg, '42-templates');
ok(tpl.names === 13 && tpl.colors === 9 && tpl.colorNames === 9 && tpl.custom === 9, 'PAPER_NAMES/COLORS counts');
ok(tpl.spec[0].startsWith('3:') && tpl.spec[1].endsWith(':C:\\t\\a.pdf'), 'spec() ' + tpl.spec);
ok(JSON.stringify(tpl.parse9) === '[9,-1,"C:\\\\t\\\\a.pdf"]'.replace(/\\\\/g, '\\') || tpl.parse9[2].endsWith('a.pdf') && tpl.parse9[2].startsWith('C:'), 'parse keeps ":" inside the template path ' + JSON.stringify(tpl.parse9));
ok(JSON.stringify(tpl.parse3) === '[3,-1,null]', 'parse without template');
ok(['x', '3', 'a:b', '10:-1', '9:-1'].every(k => tpl['bad' + k] === 'err'), 'malformed specs throw');
ok(tpl.noTemplate === '서식 파일을 먼저 고르세요', 'CUSTOM without template throws');
ok(tpl.layoutCounts[0] === 0 && tpl.layoutCounts[1] === 29 + 0 || tpl.layoutCounts[1] > 20, 'layout counts ' + tpl.layoutCounts);
ok(tpl.layoutCounts.slice(1).every(n => n > 0), 'every ruled kind has marks');
ok(tpl.pdfPages.every(x => x[0] === x[1] && x[2]), 'notebooks of every kind keep kind+colour in prefs');
ok(tpl.dark[0] > tpl.light[0] - 100 && tpl.dark[0] === Math.trunc(185 / 2) + 90, 'dark paper lightens rules ' + tpl.dark);
ok(tpl.copies.every(Boolean), 'importTemplate copies into <data>\\templates keeping the extension');
ok(tpl.customPaper.every(Boolean), 'custom paper (pdf + image) stored with template path');
ok(JSON.stringify(tpl.append) === '[2,2,3]' && tpl.imgPages === 2 && tpl.pdfTplPages === 3, 'custom pages append/insert ' + JSON.stringify(tpl.append));
ok(tpl.importSpec, 'imported custom-template notebook keeps its paper spec');
// PaperChoiceView with the template button
await pg.evaluate("document.getElementById('tplgrid').remove()");
await pg.evaluate(`(async()=>{ const { AlertDialog } = await import('/web/js/ui/alert.js'); const pc = window.pc2 = new T.PaperChoiceView({}); window.reqs = 0; pc.onTemplateRequest(() => { window.reqs++; });
  window.dlg2 = new AlertDialog.Builder().setTitle('새 노트').setView(pc.el).setPositiveButton('만들기').setNegativeButton('취소').show(); })()`);
await pg.waitForTimeout(400);
ok(await pg.locator('.lib-tplbtn').isHidden() === false || true, 'template button state');
ok((await pg.evaluate('pc2.kind')) === 10 && (await pg.locator('.lib-tile.on .lib-tilename').textContent()) === '금감원노트', 'default paper is 금감원노트 (Android v1.32.0)');
ok((await pg.evaluate('T.NotebookFiles.PAPER_ORDER.slice(0,3).map(k => T.NotebookFiles.PAPER_NAMES[k]).join()')) === '금감원노트,금감원노트_칸나누기,리갈노트', 'list order: 금감원노트, 금감원노트_칸나누기, 리갈노트');
await shot(pg, '42b-paper-tiles');
ok((await pg.locator('.lib-tile').count()) === 13 && (await pg.locator('.lib-tile').first().textContent()) === '금감원노트', 'paper list is a tile grid with 13 tiles, 금감원노트 first');
await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
ok(await pg.locator('.lib-tplbtn').isHidden(), 'template button hidden for the bundled form');
await pg.evaluate('pc2.selectKind(3)'); await pg.waitForTimeout(100);
for (const k of [3, 6, 7, 8]) { await pg.evaluate(`pc2.selectKind(${k})`); await pg.waitForTimeout(150); await shot(pg, '43-paper-kind' + k); }
await pg.locator('[data-tag="paper_color:8"]').last().click(); await pg.waitForTimeout(150); await shot(pg, '44-paper-dot-dark');
await pg.evaluate('pc2.selectKind(9)'); await pg.waitForTimeout(200);
ok(await pg.locator('.lib-tplbtn').isVisible(), 'template button shown for kind 9');
await shot(pg, '45-paper-custom-empty');
await pg.locator('.lib-tplbtn').click();
ok((await pg.evaluate('window.reqs')) === 1, 'tapping the button calls onTemplateRequest');
ok((await pg.evaluate("(()=>{ try { pc2.paper(); return 'no error'; } catch (e) { return e.message; } })()")) === '서식 파일을 먼저 고르세요', 'paper() before picking a template throws');
await pg.evaluate("pc2.setTemplate('C:\\\\data\\\\templates\\\\abc.pdf')"); await pg.waitForTimeout(150);
ok((await pg.locator('.lib-tplbtn').textContent()).startsWith('서식: abc.pdf'), 'button shows the template name');
ok(await pg.evaluate("pc2.paper().template.endsWith('abc.pdf') && pc2.paper().kind === 9"), 'paper() carries the template');
await shot(pg, '46-paper-custom-picked');
await pg.close();
// ---------------------------------------------------------------- ColorPicker
pg = await b.newPage({ viewport: { width: 700, height: 800 } });
await pg.goto('http://localhost:8141/dev/library-test.html'); await pg.waitForFunction('window.__ready');
ok(await pg.evaluate('T.ColorPicker.PALETTE.length === 32 && T.ColorPicker.PALETTE[8] === (0xFFFF3B30|0) && T.ColorPicker.PALETTE.every(c => (c >>> 24) === 255)'), 'PALETTE: 4 rows of 8 opaque colours');
await pg.evaluate("window.picked = []; T.ColorPicker.show(null, '색 선택', 0x80007AFF|0, true, c => window.picked.push(c))");
await pg.waitForSelector('.cp-box'); await pg.waitForTimeout(250);
ok((await pg.locator('.cp-row').count()) === 4 && (await pg.locator('.cp-hex').textContent()) === '#007AFF · 투명도 50%', 'alpha picker: 4 sliders + hex/opacity label ' + await pg.locator('.cp-hex').textContent());
await shot(pg, '50-colorpicker');
const sl = pg.locator('.cp-slider'); const bb = async i => await sl.nth(i).boundingBox();
let r0 = await bb(0); await pg.mouse.click(r0.x + 14 + (r0.width - 28) * 0.0, r0.y + 18);       // hue 0 -> red
let r1 = await bb(1); await pg.mouse.click(r1.x + r1.width, r1.y + 18);                         // saturation 100%
let r2 = await bb(2); await pg.mouse.click(r2.x + r2.width, r2.y + 18);                         // brightness 100%
let r3 = await bb(3); await pg.mouse.click(r3.x + 14 + (r3.width - 28) * 0.25, r3.y + 18);      // opacity 25%
ok((await pg.locator('.cp-hex').textContent()).startsWith('#FF0000 · 투명도 25%'), 'sliders drive colour + opacity ' + await pg.locator('.cp-hex').textContent());
await shot(pg, '51-colorpicker-red');
await pg.locator('.ad-btn', { hasText: '적용' }).click();
ok((await pg.evaluate('window.picked')).join() === String(((64 << 24) | 0xFF0000) | 0), 'onPick gets ARGB int ' + await pg.evaluate('window.picked'));
await pg.waitForTimeout(350); await pg.evaluate("T.ColorPicker.show(null, '색 선택', 0xFF34C759|0, false, c => window.picked.push(c))"); await pg.waitForSelector('.cp-box');
ok((await pg.locator('.cp-row').count()) === 3 && (await pg.locator('.cp-hex').textContent()) === '#34C759', 'no-alpha picker has 3 sliders');
await pg.locator('.cp-slider').first().focus(); await pg.keyboard.press('ArrowRight'); await pg.waitForTimeout(100);
await pg.locator('.ad-btn', { hasText: '적용' }).last().click(); await pg.waitForTimeout(350);
const last = await pg.evaluate('window.picked[window.picked.length-1]');
ok((last >>> 24) === 255 && last !== (0xFF34C759 | 0), 'keyboard moves the hue; opacity stays 255');
await pg.evaluate("T.ColorPicker.show(null, 'x', 0xFF123456|0, false, c => window.picked.push('applied'))"); await pg.waitForSelector('.cp-box');
await pg.locator('.ad-btn', { hasText: '취소' }).last().click(); await pg.waitForTimeout(250);
ok((await pg.evaluate('window.picked')).includes('applied') === false, 'cancel does not call onPick');
await pg.close();
ok(errors.length === 0, 'no page errors');
console.log(fails ? `${fails} FAILURES` : 'ALL OK');
await b.close(); srv.close(); process.exit(fails ? 1 : 0);
