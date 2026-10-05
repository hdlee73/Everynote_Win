// v3.9.0: bar placement, menu overflow hint + wrapped labels, renamed backup entries, player bars, YouTube drop.  node dev/batch4-test.mjs
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

// 7: bar placement
const place=async(p)=>pg.evaluate(async p=>{app.setBarPlace(p);await new Promise(r=>setTimeout(r,200));const r=document.querySelector('[data-tag="reading_toolbar"]').getBoundingClientRect();const c=document.querySelector('.m-content').getBoundingClientRect();return {w:r.width,h:r.height,l:r.left,r:r.right,cl:parseFloat(getComputedStyle(document.querySelector('.m-content')).paddingLeft),cr:parseFloat(getComputedStyle(document.querySelector('.m-content')).paddingRight),cls:document.querySelector('[data-tag="reading_toolbar"]').className};},p);
const bt=await place('bottom'); check('bottom: wide horizontal bar', bt.w>800&&bt.h<80, JSON.stringify(bt));
const lf=await place('left'); check('left rail: narrow, vertical, content shifted', lf.w<70&&lf.h>400&&lf.cl>=50&&lf.cls.includes('vert'), JSON.stringify(lf));
const rt=await place('right'); check('right rail: content right edge shifted', rt.w<70&&rt.cr>=50&&rt.cl===0, JSON.stringify(rt));
const fl=await place('float'); check('float horizontal', fl.w>300&&fl.h<80&&fl.cls.includes('float'), JSON.stringify(fl));
await pg.evaluate(()=>app.setBarOrientation(true)); await pg.waitForTimeout(200);
const fv=await pg.evaluate(()=>{const r=document.querySelector('[data-tag="reading_toolbar"]').getBoundingClientRect();return {w:r.width,h:r.height}});
check('float vertical', fv.w<80&&fv.h>300, JSON.stringify(fv));
await pg.evaluate(()=>{app.setBarOrientation(false);app.setBarPlace('bottom')});
check('layout button in the bar', await pg.evaluate(()=>!!document.querySelector('.m-barlayout')));
const lm=await pg.evaluate(async()=>{document.querySelector('.m-barlayout').click();await new Promise(r=>setTimeout(r,300));const t=[...document.querySelectorAll('.amenu-row .amenu-label')].map(e=>e.textContent);document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));return t});
check('layout menu rows', lm.includes('아래에 고정')&&lm.some(x=>x.includes('왼쪽'))&&lm.some(x=>x.includes('오른쪽')), JSON.stringify(lm));

// 4/6/5/8: main menu
await pg.setViewportSize({width:1100,height:500});
const mm=await pg.evaluate(async()=>{app.showMainMenu(document.body,false);await new Promise(r=>setTimeout(r,400));
  const labels=[...document.querySelectorAll('.amenu-row .amenu-label')].map(e=>e.textContent);const more=document.querySelector('[data-tag="menu_more"]');
  const sc=document.querySelector('.amenu-scroll');return {labels,moreShown:!!more&&more.style.display!=='none',canScroll:sc.scrollHeight>sc.clientHeight};});
check('overflowing menu shows 아래에 더 있음', mm.canScroll&&mm.moreShown, JSON.stringify(mm));
check('no 하단 메뉴 플로팅 row', !mm.labels.includes('하단 메뉴 플로팅'));
const i=l=>mm.labels.indexOf(l);
check('order: 사용법 < 오프라인 사용 안내 < 앱 정보 (library backup lives in 내보내기·백업 since v3.10)', i('모든 문서 백업·복원')<0&&i('사용법')>=0&&i('사용법')<i('오프라인 사용 안내')&&i('오프라인 사용 안내')<i('앱 정보·업데이트'), JSON.stringify(mm.labels));
await pg.keyboard.press('Escape'); await pg.setViewportSize({width:1100,height:800});
const tools=await pg.evaluate(async()=>{app.showTools();await new Promise(r=>setTimeout(r,400));return [...document.querySelectorAll('.m2-tile-name')].map(e=>e.textContent)});
check('renamed tiles', tools.includes('하단 메뉴 위치·방향')&&!tools.includes('하단 메뉴 플로팅'), JSON.stringify(tools));
const wrap=await pg.evaluate(()=>{const e=document.querySelector('.m2-tile-name');const c=getComputedStyle(e);return c.whiteSpace!=='nowrap'&&c.textOverflow!=='ellipsis'});
check('labels wrap instead of ellipsis', wrap);
await pg.keyboard.press('Escape');

// 2: YouTube ids from thumbnails / link elements
const ids=await pg.evaluate(async()=>{const m=await import('./js/app-main2.js');return [m.youtubeId('https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg'),m.youtubeId('<img src="https://i.ytimg.com/vi_webp/dQw4w9WgXcQ/maxresdefault.webp">'),m.youtubeId('https://youtu.be/dQw4w9WgXcQ')]});
check('youtubeId handles thumbnails', ids.every(x=>x==='dQw4w9WgXcQ'), JSON.stringify(ids));
const dropped=await pg.evaluate(async()=>{let got=null;app.importYoutube=id=>{got=id};const dt={files:[],getData:t=>t==='text/html'?'<a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ"><img src="https://i.ytimg.com/vi/dQw4w9WgXcQ/hq.jpg"></a>':''};app.handleDrop({dataTransfer:dt,clientX:300,clientY:300});return got});
check('dropping a YouTube thumbnail/html imports as YouTube', dropped==='dQw4w9WgXcQ', dropped);

// 1/2: player bars
const bars=await pg.evaluate(async()=>{
  const {PageElement}=await import('./js/store.js');
  const e=new PageElement(); e.kind='youtube'; e.text='dQw4w9WgXcQ'; e.page=0; e.left=.2;e.top=.2;e.right=.7;e.bottom=.5; app.store.elements.push(e);
  await app.playInline(e); await new Promise(r=>setTimeout(r,300));
  const y=[...document.querySelectorAll('.m2-inline-player [data-tag="video_bar"] button')].map(x=>x.textContent);
  app.stopInlinePlayer();
  const l=new PageElement(); l.kind='link'; l.text='https://www.youtube.com/watch?v=dQw4w9WgXcQ'; l.page=0; l.left=.2;l.top=.6;l.right=.5;l.bottom=.7; app.store.elements.push(l);
  app.onElementTapped(l); await new Promise(r=>setTimeout(r,300));
  const menu=[...document.querySelectorAll('.amenu-row .amenu-label')].map(x=>x.textContent);
  return {y,kind:l.kind,menu};});
check('YouTube inline has ±10s + play bar', bars.y.length===3&&bars.y[0].includes('10'), JSON.stringify(bars.y));
check('YouTube link element gets the YouTube menu', bars.kind==='youtube'&&bars.menu.includes('여기서 재생'), JSON.stringify(bars));
await pg.keyboard.press('Escape');
const vb=await pg.evaluate(()=>{const v=document.createElement('video');const bar=app._videoBar(v);return [...bar.querySelectorAll('button')].map(x=>x.textContent)});
check('video bar buttons', vb.length===3&&vb[0].includes('10')&&vb[2].includes('10'), JSON.stringify(vb));
check('no page errors', errs.length===0, errs.join(' | '));
await b.close(); s.close?.(); console.log(fails?`${fails} FAILED`:'ALL PASS'); process.exit(fails?1:0);
