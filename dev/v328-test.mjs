// v3.30.0: lasso panel, merge / extract, folder import, shape / table / sticky memo popovers, no tab strip.  node dev/v328-test.mjs
import {chromium} from '/tmp/npmtest/node_modules/playwright/index.mjs';
import {serve} from './server.mjs'; import fs from 'fs';
const PORT=8200+Math.floor(Math.random()*700); const s=await serve(PORT);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const pg=await b.newPage({viewport:{width:1280,height:800}});
const errs=[]; pg.on('pageerror',e=>errs.push('PE '+e.message)); pg.on('console',m=>{if(m.type()==='error'&&!/404/.test(m.text()))errs.push('CE '+m.text())});
await pg.addInitScript(()=>{Map.prototype.getOrInsertComputed??=function(k,f){if(!this.has(k))this.set(k,f(k));return this.get(k)}});
await pg.goto(`http://localhost:${PORT}/index.html`); await pg.waitForTimeout(1500);
let fails=0; const check=(n,ok,x='')=>{console.log((ok?'PASS ':'FAIL ')+n+(x?'  '+x:''));if(!ok)fails++};
const shot=async n=>{if(process.env.SHOTS)await pg.screenshot({path:`${process.env.SHOTS}/${n}.png`})};
const bytes=[...fs.readFileSync('dev/samples/sample-ko.pdf')];
const ROOT='C:\\Users\\dev\\Documents\\Everynote';
await pg.evaluate(async([b,p])=>{const {host}=await import('./js/host.js');await host.mkdir(p.replace(/\\[^\\]+$/,''));host._fake.put(p,new Uint8Array(b));await app.library.importPdf(p,'A.pdf',app.library.root);await app.library.importPdf(p.replace('sample','s2'),'B.pdf',app.library.root).catch(()=>{});},[bytes,ROOT+'\\sample.pdf']);
// open document A from the library
const A=await pg.evaluate(async()=>{const l=await app.library.list(app.library.root);return l.filter(f=>/A\.pdf$/i.test(f))[0]});
check('A imported', !!A, A);
await pg.evaluate(async f=>{await app.openPdf(f)},A); await pg.waitForTimeout(1500);
// 1: tab strip never shown, even with two documents
await pg.evaluate(async([b,p])=>{const {host}=await import('./js/host.js');host._fake.put(p,new Uint8Array(b));await app.openPdf(p);},[bytes,ROOT+'\\x2.pdf']); await pg.waitForTimeout(1200);
check('tab strip hidden', await pg.evaluate(()=>getComputedStyle(document.querySelector('.m-tabstrip')).display==='none'));
// 4: lasso panel
await pg.click('[aria-label="올가미 선택"]'); await pg.waitForTimeout(300);
await pg.click('[aria-label="올가미 선택"]'); await pg.waitForTimeout(300); await shot('lasso');
check('lasso panel rows', await pg.evaluate(()=>!!document.querySelector('[data-tag="lasso_menu"]')&&document.querySelectorAll('[data-tag^="lassopanel_shape_"]').length===3&&!!document.querySelector('[data-tag="lasso_partial"]')));
await pg.click('[data-tag="lassopanel_shape_1"]'); await pg.waitForTimeout(200);
check('lasso shape rect', await pg.evaluate(()=>app.lassoShape===1));
await pg.click('[data-tag="lasso_partial"]'); await pg.waitForTimeout(200);
check('partial toggled off', await pg.evaluate(()=>app.lassoPartial()===false&&app.pageView.lassoPartial===false));
await pg.keyboard.press('Escape'); await pg.evaluate(()=>app.setInkMode(0)); await pg.waitForTimeout(200);
// 6: shape dialog
await pg.click('[aria-label="도형"]'); await pg.waitForTimeout(400); await shot('shape');
check('shape tiles with previews', await pg.evaluate(()=>document.querySelectorAll('.m2-shape-btn canvas').length===9));
await pg.keyboard.press('Escape'); await pg.evaluate(()=>document.querySelector('.ad-card')?.parentElement?.click()); await pg.waitForTimeout(200);
// 7: table setup, popup
await pg.evaluate(()=>app.showTableDialog(null)); await pg.waitForTimeout(300); await shot('tablesetup');
check('table setup wheels', await pg.evaluate(()=>document.querySelector('[data-tag="table_rows"]').value()===2&&document.querySelector('[data-tag="table_cols"]').value()===3));
await pg.click('[data-tag="table_rows"] .sx-wv.near >> nth=1'); await pg.waitForTimeout(100);
check('rows wheel steps', await pg.evaluate(()=>document.querySelector('[data-tag="table_rows"]').value()===3));
await pg.evaluate(()=>[...document.querySelectorAll('.ad-card button, .ad-card .ad-btn')].find(x=>x.textContent.trim()==='취소')?.click()); await pg.waitForTimeout(200);
// table element + popup
const el=await pg.evaluate(async()=>{const {PageElement}=await import('./js/store.js');const {Table}=await import('./js/shapes.js');const e=new PageElement();e.kind='table';e.page=0;e.left=.1;e.top=.2;e.right=.8;e.bottom=.35;e.text=Table.create(2,3,0xFFB7B3A4|0,0x00E5F0FF,0x00FFFFFF).serialize();app.store.elements.push(e);app.redrawPages();window.__el=e;return true});
await pg.waitForTimeout(500);
await pg.evaluate(()=>app.onElementTapped(window.__el)); await pg.waitForTimeout(300); await shot('tablepopup');
check('table popup', await pg.evaluate(()=>!!document.querySelector('[data-tag="table_popup"]')));
await pg.evaluate(()=>[...document.querySelectorAll('.sx-row')].find(x=>x.textContent==='행 추가').click()); await pg.waitForTimeout(200);
check('row added', await pg.evaluate(()=>window.__el.text.startsWith('3,3,')), await pg.evaluate(()=>window.__el.text.split('\n')[0]));
// sticky memo
await pg.evaluate(async()=>{const {Mark}=await import('./js/store.js');const m=new Mark();m.page=0;m.left=.3;m.right=.5;m.top=.5;m.bottom=.55;m.noteOnly=true;m.note='hello';m.paper=0xFFFFE5B0|0;app.store.marks.push(m);app.redrawPages();window.__m=m});
await pg.waitForTimeout(400);
await pg.evaluate(()=>app.editMark(window.__m)); await pg.waitForTimeout(300); await shot('sticky');
check('sticky popup', await pg.evaluate(()=>document.querySelectorAll('.sx-sw').length===4));
await pg.evaluate(()=>document.querySelectorAll('.sx-sw')[1].click()); await pg.waitForTimeout(200);
check('sticky colour', await pg.evaluate(()=>(window.__m.paper>>>0)===(0xFFD6F0E0>>>0)));
// merge / extract
const res=await pg.evaluate(async A=>{const l=app.library;const B=(await l.list(l.root)).filter(f=>/\.pdf$/i.test(f));
 const r=await l.composeDocument([{file:A,pages:[0,1]},{file:A,pages:[2]}],'M',l.root);return {n:B.length,r}},A);
check('merge composes 3 pages', res.r.pages===3, JSON.stringify(res.r));
const cnt=await pg.evaluate(async f=>{const {pageCountOf}=await import('./js/pagetools.js');return pageCountOf(f)},res.r.file);
check('merged file has 3 pages', cnt===3, String(cnt));
const parsed=await pg.evaluate(async()=>{const {parsePageRanges}=await import('./js/pagetools.js');return [parsePageRanges('1-3, 5',6),parsePageRanges('2-',4),(()=>{try{parsePageRanges('9',3)}catch(e){return e.message}})()]});
check('range parser', JSON.stringify(parsed[0])==='[0,1,2,4]'&&JSON.stringify(parsed[1])==='[1,2,3]'&&/1~3/.test(parsed[2]), JSON.stringify(parsed));
// folder import
const tree=await pg.evaluate(async([b])=>{const {host}=await import('./js/host.js');const R='D:\\Docs';await host.mkdir(R);await host.mkdir(R+'\\sub');
 host._fake.put(R+'\\one.pdf',new Uint8Array(b));host._fake.put(R+'\\sub\\two.pdf',new Uint8Array(b));
 const r=await app.library.importTree([{path:R+'\\one.pdf',rel:'one.pdf'},{path:R+'\\sub\\two.pdf',rel:'sub\\two.pdf'}],'Docs',app.library.root);
 const inner=await app.library.list(r.folder);return {r,inner}},[bytes]);
check('folder import keeps structure', tree.r.imported===2&&tree.inner.length===2, JSON.stringify(tree));
await shot('end');
console.log(errs.length?errs.join('\n'):'no page errors'); check('no errors', errs.length===0);
await b.close(); s.close&&s.close(); console.log(fails?`${fails} FAILED`:'ALL PASS'); process.exit(fails?1:0);
