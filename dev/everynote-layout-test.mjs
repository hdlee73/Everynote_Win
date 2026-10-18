// Everynote layout (Samsung Notes style): library nav pane + header actions (no "<" in the library), trash view,
// editor header + right tool strip, pen panel, insert menu, narrow window.
// usage: node dev/everynote-layout-test.mjs [screenshot dir]   (default dev/out/everynote-layout; LOOK at the pictures)
import { chromium } from '/tmp/npmtest/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)), web = path.join(here, '..', 'web');
const out = process.argv[2] || process.env.SHOTS || path.join(here, 'out', 'everynote-layout');
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.pdf': 'application/pdf', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf' };
const server = http.createServer((req, rsp) => {
  const p = decodeURIComponent(req.url.split('?')[0]); const f = path.join(web, p === '/' ? 'index.html' : p);
  if (!f.startsWith(web) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { rsp.writeHead(404); rsp.end('nf'); return; }
  rsp.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(rsp);
}).listen(0);
let fails = 0;
const check = (n, ok, x = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!ok) fails++; };
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
await page.addInitScript(() => { for (const C of [Map, WeakMap]) { if (!C.prototype.getOrInsertComputed) C.prototype.getOrInsertComputed = function (k, f) { if (!this.has(k)) this.set(k, f(k)); return this.get(k); }; } });
await page.goto(`http://localhost:${server.address().port}/`);
await page.waitForFunction(() => window.app && window.app.library, null, { timeout: 30000 });
await page.waitForTimeout(800);
const ev = (fn, arg) => page.evaluate(fn, arg);
const shot = name => page.screenshot({ path: path.join(out, name + '.png') });
const visible = sel => ev(s => [...document.querySelectorAll(s)].filter(e => e.checkVisibility() && e.getBoundingClientRect().width > 0).length, sel);
const put = (file, name) => ev(async ([b64, name]) => { const { host } = await import('/js/host.js'); const p = app.library.root + '\\' + name; host._fake.put(p, Uint8Array.from(atob(b64), c => c.charCodeAt(0))); return p; },
  [fs.readFileSync(path.join(here, 'samples', file)).toString('base64'), name]);

// ---- library, wide window
const docPath = await put('sample-ko.pdf', '영어문구.pdf'); await put('sample-ko.pdf', '지운 문서.pdf');
await put('sample-ko.pdf', '회의 메모.pdf');
await ev(async () => { const { host } = await import('/js/host.js'); await host.mkdir(app.library.root + '\\수업 노트'); await host.mkdir(app.library.root + '\\여행'); });
await ev(() => app.showLibrary()); await page.waitForTimeout(400);
await ev(() => app.libraryDialog.refresh()); await page.waitForTimeout(1200);
const nav = await ev(() => [...document.querySelectorAll('[data-tag^="drawer_row:"]')].filter(e => e.offsetParent !== null).map(e => e.dataset.tag.slice(11)));
check('nav pane rows: 모든 노트, 즐겨찾기, 최근 문서, 휴지통, 폴더, 설정', ['모든 노트', '즐겨찾기', '최근 문서', '휴지통', '폴더', '설정'].every(n => nav.includes(n)), nav.join());
check('nav pane: 모든 노트 is the selected row', await ev(() => { const r = document.querySelector('[data-tag="drawer_row:모든 노트"]'); return !!r && r.classList.contains('on') || getComputedStyle(r).backgroundColor !== 'rgba(0, 0, 0, 0)'; }));
check('library title is 모든 노트', (await ev(() => document.querySelector('[data-tag="library_heading"]').textContent.trim())) === '모든 노트');
const actions = await ev(() => [...document.querySelectorAll('[data-tag="library_actions"] .lib-tb')].filter(e => e.offsetParent !== null).map(e => e.dataset.tag));
check('header actions: 노트 작성, PDF 가져오기, 편집, 보기 방식', JSON.stringify(actions) === JSON.stringify(['library_new_note', 'library_import', 'library_edit', 'library_view']), actions.join());
check('header: search box and ⋮ menu', await visible('.lib-page .lib-search') === 1 && await visible('.lib-page [aria-label="문서함 메뉴"]') === 1);
check('header: sort control 수정 날짜 순', /수정 날짜 순/.test(await ev(() => document.querySelector('[data-tag="library_sort"]').textContent)));
const backs = await ev(() => [...document.querySelectorAll('.lib-page button, .lib-page [role="button"]')].filter(e => e.offsetParent !== null)
  .filter(e => /^(<|‹|뒤로|상위 폴더|위로)/.test((e.getAttribute('aria-label') || e.textContent || '').trim()) || e.classList.contains('lib-up')).map(e => e.outerHTML.slice(0, 80)));
check('no "<" (back / parent folder) button in the library', backs.length === 0 && await ev(() => !document.querySelector('.lib-up')), backs.join(' | '));
const cardSize = await ev(() => { const t = document.querySelector('[data-tag^="document:"] .lib-frame'); return t ? [t.offsetWidth, t.offsetHeight] : null; });
check('library cards are square thumbnails', !!cardSize && cardSize[0] >= 80 && Math.abs(cardSize[0] - cardSize[1]) <= 2, JSON.stringify(cardSize));
await shot('1-library-wide');

// ---- library trash
await ev(async p => { await app.library.trash(p); }, docPath.replace('영어문구', '지운 문서'));
await ev(() => app.libraryDialog.showTrash()); await page.waitForTimeout(700);
check('trash: title 휴지통 and actions 편집 + 비우기', (await ev(() => document.querySelector('[data-tag="library_heading"]').textContent.trim())) === '휴지통'
  && JSON.stringify(await ev(() => [...document.querySelectorAll('[data-tag="library_actions"] .lib-tb')].filter(e => e.offsetParent !== null).map(e => e.dataset.tag))) === JSON.stringify(['library_edit', 'library_empty_trash']));
check('trash: the deleted document is listed with its deleted date', /지운 문서/.test(await ev(() => document.querySelector('.lib-page').textContent)) && /삭제/.test(await ev(() => document.querySelector('.lib-page').textContent)));
await shot('2-library-trash');

// ---- editor
await ev(() => app.libraryDialog.showMode(0)); await page.waitForTimeout(300);
await ev(async p => { app.libraryDialog.dismiss(); await app.openPdf(p, false, 0, true); }, docPath); await page.waitForTimeout(1500);
check('editor: "<" back to library button is there', await visible('[data-tag="back_to_library"]') === 1);
const hdr = await ev(() => [...document.querySelectorAll('[data-tag="header_actions"] [data-tag]')].filter(e => e.offsetParent !== null).map(e => e.dataset.tag));
check('editor header actions: 전체 화면, 읽기 모드, 페이지 관리, 노트 스타일, 삽입, 공유, 파일로 저장, 인쇄, 검색',
  JSON.stringify(hdr) === JSON.stringify(['h_fullscreen', 'h_read', 'h_pages', 'h_style', 'h_insert', 'h_share', 'h_save', 'h_print', 'h_search']), hdr.join());
const strip = await ev(() => { const s = document.querySelector('[data-tag="reading_toolbar"]'); const r = s.getBoundingClientRect(); return { right: r.right, w: r.width, h: r.height, labels: [...s.querySelectorAll('.m-tb')].filter(e => e.offsetParent !== null).map(e => e.getAttribute('aria-label') || '') }; });
check('tool strip docks on the right edge, vertical', strip.right >= 1598 && strip.h > strip.w * 4, JSON.stringify([strip.right, strip.w, strip.h]));
const want = ['키보드', '펜', '형광펜', '지우개', '올가미', '실행 취소', '다시 실행', '테이프', '하이라이트', '메모', '도형', '텍스트 선택', '즐겨찾기', '화면 나누기'];
const missing = want.filter(w => !strip.labels.some(l => l === w || l.startsWith(w + ' ')));
check('tool strip tools: ' + want.join(', '), missing.length === 0, 'missing ' + missing.join());
await ev(() => app.setWriteMode(true)); await page.waitForTimeout(300);
await ev(() => app.penTap(app.penButton)); await page.waitForTimeout(500);
check('pen panel opens docked beside the strip', await ev(() => { const c = document.querySelector('.amenu.m-docked'); if (!c) return false; const r = c.getBoundingClientRect(), s = document.querySelector('[data-tag="reading_toolbar"]').getBoundingClientRect(); return r.right <= s.left + 1 && r.top <= s.top + 1; }));
check('pen panel: 굵기 / 투명도 steppers, colour rows, switches, floating toolbar pill',
  await visible('.m-docked .m-pp-step') >= 2 && await visible('.m-docked .m-switch') >= 2 && await visible('.m-docked [data-tag="floating_toolbar"]') === 1);
await shot('3-editor-pen');
await page.keyboard.press('Escape'); await page.mouse.click(1250, 600); await page.waitForTimeout(300);
await ev(() => app.showInsertMenu(app.insertButton)); await page.waitForTimeout(400);
const ins = await ev(() => [...document.querySelectorAll('.amenu .amenu-row')].map(r => r.textContent.trim()));
check('insert menu opens under 삽입 with image, sticker, shape, table, video, YouTube, memo, highlight',
  ['사진·이미지', '스티커', '도형', '표', '동영상', '유튜브 링크', '메모', '하이라이트'].every(t => ins.includes(t))
  && await ev(() => document.querySelector('.amenu').getBoundingClientRect().top >= app.insertButton.getBoundingClientRect().bottom - 1), ins.join());
await shot('4-editor-insert');
await page.keyboard.press('Escape'); await page.mouse.click(1250, 600); await page.waitForTimeout(300);

// ---- narrow window
await page.setViewportSize({ width: 560, height: 860 }); await page.waitForTimeout(700);
check('narrow: header labels hidden, tool strip moves to the bottom', await ev(() => { const s = document.querySelector('[data-tag="reading_toolbar"]').getBoundingClientRect(); const lab = [...document.querySelectorAll('[data-tag="header_actions"] .m-hbtn span')].filter(e => e.offsetParent !== null && e.textContent.trim()); return s.bottom >= innerHeight - 2 && s.width > s.height && lab.length === 0; }));
check('narrow: header buttons fit, no horizontal page scroll', await ev(() => document.documentElement.scrollWidth <= innerWidth && document.querySelector('[data-tag="header_actions"]').getBoundingClientRect().right <= innerWidth));
await shot('5-narrow-editor');
await ev(() => app.showLibrary()); await page.waitForTimeout(800);
check('narrow library: nav pane collapses behind ☰, compose button shown', await visible('.lib-menu-btn') === 1 && await visible('.lib-fab') === 1 && await ev(() => { const r = document.querySelector('[data-tag="drawer_row:모든 노트"]'); return !r || !r.checkVisibility() || r.getBoundingClientRect().right <= 0; }));
await shot('5-narrow-library');

check('no page errors', errors.length === 0, errors.join(' | '));
await browser.close(); server.close();
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
