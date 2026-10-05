// v3.7.0: add-document menu, submenu placement, narrow search row, page add formats, picture import.  node dev/menus-test.mjs
import {chromium} from '/tmp/npmtest/node_modules/playwright/index.mjs';
import {serve} from './server.mjs'; import fs from 'fs';
const PORT=8200+Math.floor(Math.random()*700); const s=await serve(PORT);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const pg=await b.newPage({viewport:{width:1100,height:800}});
const errs=[]; pg.on('pageerror',e=>errs.push('PE '+e.message)); pg.on('console',m=>{if(m.type()==='error'&&!/404/.test(m.text()))errs.push('CE '+m.text())});
await pg.addInitScript(()=>{Map.prototype.getOrInsertComputed??=function(k,f){if(!this.has(k))this.set(k,f(k));return this.get(k)}});
await pg.goto(`http://localhost:${PORT}/index.html`); await pg.waitForTimeout(1500);
let fails=0; const check=(n,ok,x='')=>{console.log((ok?'PASS ':'FAIL ')+n+(x?'  '+x:''));if(!ok)fails++};
const bytes=[...fs.readFileSync('dev/samples/sample-ko.pdf')];
const LIB='C:\\Users\\dev\\Documents\\PDF Note\\sample.pdf';
await pg.evaluate(async([b,p])=>{const {host}=await import('./js/host.js');host._fake.put(p,new Uint8Array(b));await app.openPdf(p);},[bytes,LIB]);
await pg.waitForTimeout(1500);

// 3/4: tab "+" menu = same card style, order 새 노트 / 파일 가져오기 / 저장된 문서 열기
await pg.click('.m-tabadd'); await pg.waitForTimeout(300);
const labels=await pg.evaluate(()=>[...document.querySelectorAll('.amenu .amenu-row .amenu-label')].map(e=>e.textContent));
check('tab + menu order', JSON.stringify(labels)===JSON.stringify(['새 노트 만들기','파일 가져오기','저장된 문서 열기']), JSON.stringify(labels));
check('tab + menu is the anchored card', await pg.evaluate(()=>!!document.querySelector('.amenu')&&!document.querySelector('.m-sheet, .asheet')));
await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
const plus=await pg.evaluate(()=>{const a=document.querySelector('.m-tabadd'),s=a.querySelector('svg');const r=a.getBoundingClientRect(),q=s.getBoundingClientRect();return {dx:Math.abs((r.left+r.width/2)-(q.left+q.width/2)),dy:Math.abs((r.top+r.height/2)-(q.top+q.height/2))}});
check('tab + glyph centred', plus.dx<1&&plus.dy<1, JSON.stringify(plus));

// 2: submenu opens right beside the tapped row
for(const vw of [1100,420]){
  await pg.setViewportSize({width:vw,height:800}); await pg.waitForTimeout(300);
  await pg.evaluate(()=>app.showMainMenu(document.body,false)).catch(async()=>{await pg.evaluate(()=>app.showMainMenu(app.menuButton||document.body,false))}); await pg.waitForTimeout(300);
  const info=await pg.evaluate(()=>{const row=[...document.querySelectorAll('.amenu-row')].find(r=>r.textContent.includes('문서 추가'));row.click();return null}); await pg.waitForTimeout(350);
  const g=await pg.evaluate(()=>{const cards=[...document.querySelectorAll('.amenu')];const row=[...cards[0].querySelectorAll('.amenu-row')].find(r=>r.textContent.includes('문서 추가')).getBoundingClientRect();const p=cards[0].getBoundingClientRect(),c=cards[1]&&cards[1].getBoundingClientRect();return c&&{pl:p.left,pr:p.right,cl:c.left,cr:c.right,ct:c.top,rt:row.top,cw:c.width,sw:innerWidth}});
  check(`submenu beside row @${vw}`, g&&Math.abs(g.ct-(g.rt-6))<3&&(g.cl>=g.pr-1||g.cr<=g.pl+1||vw<600)&&g.cl>=0&&g.cr<=g.sw, JSON.stringify(g));
  await pg.keyboard.press('Escape'); await pg.waitForTimeout(150); await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
}
await pg.setViewportSize({width:1100,height:800}); await pg.waitForTimeout(300);

// 1: narrow panel keeps a usable search box
await pg.evaluate(()=>{app.selectPanelTab(0);app.sidePanel.style.width='140px';app.fitSideHead()}); await pg.waitForTimeout(300);
const sw=await pg.evaluate(()=>document.querySelector('.m2-search-in').getBoundingClientRect().width);
check('narrow panel search input stays wide', sw>=130, String(sw));
await pg.evaluate(()=>{app.sidePanel.style.width='';app.closeSidePanel()});

// 6: page add keeps size/orientation; other formats offered
const mk=await pg.evaluate(async()=>{const {PDFDocument}=await import('../vendor/pdflib/pdf-lib.esm.min.js');const d=await PDFDocument.create();d.addPage([800,500]);d.addPage([800,500]);const {host}=await import('./js/host.js');const path='C:\\Users\\dev\\Documents\\PDF Note\\wide.pdf';host._fake.put(path,await d.save());await app.openPdf(path);return path});
await pg.waitForTimeout(1500);
const sizeOf=async i=>pg.evaluate(async([p,i])=>{const {PDFDocument}=await import('../vendor/pdflib/pdf-lib.esm.min.js');const {host}=await import('./js/host.js');const d=await PDFDocument.load(await host.readBytes(p));const s=d.getPage(i).getSize();return [Math.round(s.width),Math.round(s.height),d.getPageCount()]},[mk,i]);
await pg.evaluate(()=>app.choosePageToInsert(0)); await pg.waitForTimeout(1500);
let z=await sizeOf(1); check('default add = same landscape size', z[0]===800&&z[1]===500&&z[2]===3, JSON.stringify(z));
await pg.evaluate(()=>app.chooseOtherPageFormat(0)); await pg.waitForTimeout(500);
check('other-format dialog has size options', await pg.evaluate(()=>document.querySelectorAll('[data-tag="page_size_choice"] input[type=radio]').length)===3);
await pg.evaluate(()=>{document.querySelectorAll('[data-tag="page_size_choice"] input')[1].click();[...document.querySelectorAll('.ad-btn')].find(b=>b.textContent.trim()==='추가').click()}); await pg.waitForTimeout(1500);
z=await sizeOf(1); check('other format: A4 portrait', Math.abs(z[0]-595)<=1&&Math.abs(z[1]-842)<=1&&z[2]===4, JSON.stringify(z));

// 5: pictures become documents
const pic=await pg.evaluate(async()=>{const {host}=await import('./js/host.js');const mkPng=async(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');g.fillStyle='#39c';g.fillRect(0,0,w,h);g.fillStyle='#fff';g.fillRect(10,10,w/2,h/4);return new Uint8Array(await (await new Promise(r=>c.toBlob(r,'image/png'))).arrayBuffer())};
  host._fake.put('C:\\Users\\dev\\Pictures\\photo.png',await mkPng(1200,800));host._fake.put('C:\\Users\\dev\\Pictures\\long.png',await mkPng(600,3000));
  const n0=app.sessions.length;await app.openPdf('C:\\Users\\dev\\Pictures\\photo.png');await app.openPdf('C:\\Users\\dev\\Pictures\\long.png');return {n:app.sessions.length-n0,titles:app.sessions.slice(-2).map(s=>s.title),pages:app.sessions.slice(-2).map(s=>s.renderer.pageCount)}});
check('pictures opened as documents', pic.n===2&&pic.titles[0].startsWith('photo')&&pic.titles[1].startsWith('long'), JSON.stringify(pic));
check('long picture is split into pages, photo is one', pic.pages[0]===1&&pic.pages[1]>=2, JSON.stringify(pic.pages));
check('no page errors', errs.length===0, errs.join(' | '));
await b.close(); s.close?.(); console.log(fails?`${fails} FAILED`:'ALL PASS'); process.exit(fails?1:0);
