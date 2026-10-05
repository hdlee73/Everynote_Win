// v3.6.0 UI: side-panel header, library add menu, inline title rename, floating menus.  node dev/ui2-test.mjs
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

// 1+2 side panel header
for(let t=0;t<4;t++){ await pg.evaluate(t=>app.selectPanelTab(t),t); await pg.waitForTimeout(150);
  const r=await pg.evaluate(()=>{const e=document.querySelector('.m2-side-title');return {txt:e.textContent,svg:e.querySelectorAll('svg').length}});
  check('tab '+t+' title = icon + word', r.svg===1&&!/[\u{1F300}-\u{1FAFF}]/u.test(r.txt), JSON.stringify(r)); }
await pg.evaluate(()=>{app.showAllThumbnails=false;app.selectPanelTab(1)});
check('favourites-only preview uses the star', await pg.evaluate(()=>document.querySelector('.m2-side-title .ico').style.color==='rgb(245, 166, 35)'));
await pg.evaluate(()=>{app.selectPanelTab(3);app.sidePanel.style.width='140px';app.fitSideHead()}); await pg.waitForTimeout(300);
const vis=await pg.evaluate(()=>{const t=document.querySelector('.m2-side-label').getBoundingClientRect(),m=document.querySelector('.m2-side-head').getBoundingClientRect();return {w:t.width,right:t.right<=m.right,narrow:app.sidePanel.classList.contains('narrow')}});
check('narrow panel keeps the title visible', vis.w>30&&vis.right&&vis.narrow, JSON.stringify(vis));
await pg.screenshot({path:'dev/out/ui2-1-narrow.png'});
await pg.evaluate(()=>app.closeSidePanel());

// 3 library add menu
await pg.evaluate(()=>app.showLibrary()); await pg.waitForTimeout(500);
await pg.click('.lib-compose, [aria-label="새로 만들기"], .lib-new').catch(async()=>{await pg.evaluate(()=>app.libraryDialog.newMenu(app.libraryDialog.compose))});
await pg.waitForTimeout(400);
const menu=await pg.evaluate(()=>[...document.querySelectorAll('.amenu .amenu-row')].map(e=>e.textContent.trim()));
check('library add menu = 문서 추가 card with 3 icon rows', menu.length===3&&menu[0].includes('새 노트 만들기')&&menu[1].includes('파일 가져오기')&&menu[2].includes('폴더 만들기'), JSON.stringify(menu));
check('rows have icons', await pg.locator('.amenu svg').count()>=3);
await pg.screenshot({path:'dev/out/ui2-2-libmenu.png'});
await pg.keyboard.press('Escape'); await pg.evaluate(()=>app.libraryDialog&&app.libraryDialog.dismiss&&app.libraryDialog.dismiss()); await pg.waitForTimeout(300);

// 4 inline rename
await pg.click('[data-tag="document_title"]'); await pg.waitForTimeout(300);
check('title tap shows an inline field, no dialog', await pg.locator('input.m-title-edit').count()===1&&await pg.locator('.ad-card').count()===0);
await pg.screenshot({path:'dev/out/ui2-3-titleedit.png'});
await pg.fill('input.m-title-edit','바뀐 이름'); await pg.keyboard.press('Enter'); await pg.waitForTimeout(1200);
const t=await pg.evaluate(()=>({title:app.activeSession.title,shown:document.querySelector('[data-tag="document_title"]').textContent,edit:document.querySelectorAll('input.m-title-edit').length}));
check('Enter renames the document', t.title==='바뀐 이름.pdf'&&t.shown.includes('바뀐 이름')&&t.edit===0, JSON.stringify(t));
await pg.click('[data-tag="document_title"]'); await pg.keyboard.press('Escape'); await pg.waitForTimeout(200);
check('Esc cancels', await pg.evaluate(()=>app.activeSession.title)==='바뀐 이름.pdf'&&await pg.locator('input.m-title-edit').count()===0);

// 5 floating bottom bar
await pg.evaluate(()=>app.toggleFloatBar()); await pg.waitForTimeout(300);
const f=await pg.evaluate(()=>{const b=app.bottomBar;return {inRoot:b.parentElement===app.root,cls:b.classList.contains('float'),grip:getComputedStyle(app.barGrip).display!=='none',w:b.getBoundingClientRect().width}});
check('bottom bar floats over the page', f.inRoot&&f.cls&&f.grip&&f.w<=481, JSON.stringify(f));
await pg.screenshot({path:'dev/out/ui2-4-float.png'});
const g=await pg.evaluate(()=>{const r=app.barGrip.getBoundingClientRect();return {x:r.x,y:r.y}}); const before=await pg.evaluate(()=>app.bottomBar.getBoundingClientRect().left);
await pg.mouse.move(g.x+9,g.y+20); await pg.mouse.down(); await pg.mouse.move(g.x-150,g.y-200,{steps:6}); await pg.mouse.up(); await pg.waitForTimeout(200);
const after=await pg.evaluate(()=>({l:app.bottomBar.getBoundingClientRect().left,saved:app.recentPrefs.getString('bar_pos','')}));
check('grip drags the floating bar and remembers the spot', after.l<before-100&&after.saved!=='', JSON.stringify(after));
await pg.evaluate(()=>app.toggleFloatBar()); await pg.waitForTimeout(200);
check('toggle off docks it again', await pg.evaluate(()=>app.bottomBar.parentElement===app.contentCol&&!app.bottomBar.classList.contains('float')));

// fullscreen toolbar stays
await pg.evaluate(()=>{app.toggleDockPinned();app.toggleFullscreen()}); await pg.waitForTimeout(4500);
check('pinned fullscreen toolbar does not auto-hide', await pg.evaluate(()=>getComputedStyle(app.fullscreenDock).display!=='none'&&getComputedStyle(app.dockGrip).display!=='none'));
await pg.screenshot({path:'dev/out/ui2-5-dock.png'});
await pg.evaluate(()=>{app.toggleFullscreen();app.toggleDockPinned()});

// typing toolbar with the side panel open: inside the page area, scrolls sideways when narrower than its content
await pg.evaluate(()=>{app.selectPanelTab(1);app.sidePanel.style.width='300px';window.dispatchEvent(new Event('resize'))}); await pg.waitForTimeout(300);
await pg.setViewportSize({width:560,height:800}); await pg.waitForTimeout(300);
await pg.evaluate(()=>{const e=app.newTextBox(0,.2,.3);app.beginInlineText(e,true)}); await pg.waitForSelector('.m3-inline-text'); await pg.waitForTimeout(300);
const bar=await pg.evaluate(()=>{const b=app.inlineBar.getBoundingClientRect(),l=app.viewportLayer.getBoundingClientRect();return {l:b.left>=l.left-1,r:b.right<=l.right+1,w:b.width,layer:l.width,scroll:app.inlineBar.scrollWidth>app.inlineBar.clientWidth}});
check('typing toolbar stays inside the page area', bar.l&&bar.r, JSON.stringify(bar));
check('narrow toolbar scrolls sideways', bar.scroll||bar.w>=300, JSON.stringify(bar));
const reach=await pg.evaluate(()=>{const b=app.inlineBar;b.scrollLeft=9999;const done=b.querySelector('[data-tag="text_done"],[aria-label="입력 완료"]');const r=done.getBoundingClientRect(),br=b.getBoundingClientRect();return r.right<=br.right+1&&r.left>=br.left-1});
check('last button (완료) reachable by scrolling', reach);
await pg.screenshot({path:'dev/out/ui2-6-narrowbar.png'});
await pg.evaluate(()=>app.commitInlineText());
console.log(errs.join('\n')); console.log(fails?fails+' FAILED':'all passed'); await b.close(); s.close(); process.exit(fails?1:0);
