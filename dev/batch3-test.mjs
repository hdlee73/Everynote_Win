// v3.8.0: icons, line spacing + ruler fit, inline player, whole-library backup/restore, app info + update check.  node dev/batch3-test.mjs
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

// 5: header / bottom-bar icons follow the mobile app (sidebar + eye, not the same four squares)
const ic=await pg.evaluate(()=>{const d=l=>{const e=document.querySelector(`[aria-label="${l}"] svg path`);return e?e.getAttribute('d').slice(0,12):null};return {head:d('페이지 목록'),view:d('보기 방법')}});
check('header page-list icon = sidebar', ic.head==='M5.5,4 h13 a', JSON.stringify(ic));
check('bottom view icon = eye', ic.view==='M2.5,12 C5,7', JSON.stringify(ic));

// 3: line spacing + fit to ruler
const ls=await pg.evaluate(async()=>{
  const {PageElement}=await import('./js/store.js'); const {AnnotationPainter:AP}=await import('./js/painter.js');
  const e=app.newTextBox(0,.2,.3); app.beginInlineText(e,true); await new Promise(r=>setTimeout(r,300));
  const out={}; out.def=e.line(); app.changeInlineLine(.5); out.more=e.lineSpacing; out.css=parseFloat(app.inlineEdit.style.lineHeight)/parseFloat(app.inlineEdit.style.fontSize);
  out.label=app.inlineLine.textContent;
  const f1=AP.fitHeight('a\nb\nc',.5,.027,1.414,undefined,1.35), f2=AP.fitHeight('a\nb\nc',.5,.027,1.414,undefined,2.7); out.fit=f2>f1*1.5;
  app.fitInlineToRuler(e,10); const size=e.textSize*595, pitch=32.6, heightPt=595*(app.viewForPage(0).pageAspect());
  const base=e.top*heightPt+size, n=(base+.22*size-69.88)/pitch; out.snap=Math.abs(n-Math.round(n))<.02; out.pitchOk=Math.abs(e.line()*size-pitch*Math.round(e.line()*size/pitch))<.3;
  out.line=e.line();
  const j=e.toJson(); out.json=j.lineSpacing; const back=PageElement.fromJson(JSON.parse(JSON.stringify(j))); out.back=back.lineSpacing;
  const plain=new PageElement(); plain.kind='text'; out.noKey=!('lineSpacing' in plain.toJson());
  out.bar=!!document.querySelector('[data-tag="text_fit_ruler"]');
  return out;});
check('default line 1.35, + step 0.5 -> 1.85', Math.abs(ls.def-1.35)<.001&&Math.abs(ls.more-1.85)<.01, JSON.stringify(ls));
check('editor line-height follows spacing', Math.abs(ls.css-1.85)<.02&&ls.label==='1.85', JSON.stringify(ls));
check('fitHeight grows with spacing', ls.fit);
check('fit to 금감원노트: baseline just above a rule, line step = rule pitch', ls.snap&&ls.pitchOk, JSON.stringify(ls));
check('lineSpacing json round trip, absent when default', Math.abs(ls.json-ls.back)<1e-6&&ls.json>0&&ls.noKey, JSON.stringify(ls));
check('ruler button on the style bar', ls.bar);
await pg.evaluate(()=>{app.removeInlineViews&&app.removeInlineViews()}); await pg.waitForTimeout(150);

// 2: in-document player
const pl=await pg.evaluate(async()=>{
  const el={kind:'youtube',text:'dQw4w9WgXcQ',page:0,left:.1,top:.1,right:.6,bottom:.4};
  app.playInline(el); await new Promise(r=>setTimeout(r,200));
  const box=document.querySelector('.m2-inline-player'); const ifr=box&&box.querySelector('iframe');
  const out={has:!!box,src:ifr?ifr.src:'',w:box?box.getBoundingClientRect().width:0};
  app.stopInlinePlayer(); out.gone=!document.querySelector('.m2-inline-player'); return out;});
check('youtube plays inside the page', pl.has&&pl.src.includes('/embed/dQw4w9WgXcQ')&&pl.w>=200&&pl.gone, JSON.stringify(pl));

// 7: thumbnails are not crammed
await pg.evaluate(()=>{if(!app.sidebarVisible)app.toggleSidebar();app.showAllThumbnails=true;app.selectPanelTab(1);app.rebuildThumbnails()}); await pg.waitForTimeout(1200);
const th=await pg.evaluate(()=>{const p=document.querySelector('.m2-thumb'),i=p&&p.querySelector('.m2-thumb-img');const pr=document.querySelector('.m2-thumbpanel').getBoundingClientRect(),ir=i.getBoundingClientRect();return {pad:getComputedStyle(p).padding,gap:(pr.width-ir.width)/2}});
check('thumbnail has side room', th.gap>=24&&th.pad==='8px 6px 10px', JSON.stringify(th));
await pg.evaluate(()=>app.closeSidePanel());

// 6: whole-library backup / restore round trip
const bk=await pg.evaluate(async([bytes])=>{
  const {host}=await import('./js/host.js'); const {AnnotationStore,PageElement}=await import('./js/store.js'); const {createBackup,restoreBackup}=await import('./js/backup.js');
  const root=app.library.root; const A=root+'\\A.pdf', B=root+'\\folder\\B.pdf';
  host._fake.put(A,new Uint8Array(bytes)); host._fake.put(B,new Uint8Array(bytes)); await host.mkdir(root+'\\folder');
  const st=new AnnotationStore(); await st.open(B); const e=new PageElement(); e.kind='text'; e.text='백업 노트'; e.page=0; e.left=.1;e.top=.1;e.right=.6;e.bottom=.2; e.lineSpacing=2; st.elements.push(e);
  const img=AnnotationStore.newAssetName('png'); await host.mkdir(await AnnotationStore.assetsDir()); host._fake.put(await AnnotationStore.assetPath(img),new Uint8Array([1,2,3]));
  app.library.favorite(B,true);
  const {builtinTemplate}=await import('./js/backup.js'); const {Paper}=await import('./js/library.js'); const {NotebookFiles}=await import('./js/library.js');
  app.library._putPaper(B,new Paper(NotebookFiles.CUSTOM,-1,await builtinTemplate('note_lines.pdf')));
  app.library.folderColor(root+'\\folder',0xFFF4B67E|0); await st.save?.();
  const out={}; const env=app.backupEnv(); const zip='C:\\Users\\dev\\Downloads\\bk.zip';
  out.n=await createBackup(env,zip);
  const names=(await host.zipEntries(zip)).map(x=>x.name); out.names=names; out.first=names[0];
  // lose everything, then restore over it
  await host.delete(B); await host.delete(await AnnotationStore.assetPath(img)); app.library.favorite(B,false);
  const r=await restoreBackup(env,zip,true); out.r=r;
  const st2=new AnnotationStore(); await st2.open(B); out.note=st2.elements.map(x=>x.text).join('|'); out.line=st2.elements[0]&&st2.elements[0].lineSpacing;
  out.asset=(await host.stat(await AnnotationStore.assetPath(img))).exists; out.fav=app.library.favorite(B); out.paper=(app.library.paper(B)||{}).template||'';
  // add-as-copy keeps the original and adds "B (1).pdf"
  const r2=await restoreBackup(env,zip,false); out.r2=r2; out.copy=(await host.stat(root+'\\folder\\B (1).pdf')).exists;
  return out;},[bytes]);
check('backup holds manifest first, each doc + notes, assets', bk.first==='everynote-backup.json'&&bk.names.some(n=>n==='docs/0.pdf')&&bk.names.filter(n=>n.startsWith('notes/')).length===bk.n&&bk.names.some(n=>n.startsWith('assets/')), JSON.stringify(bk.names));
check('restore (overwrite) brings back PDF, notes, asset, favourite', bk.r.documents>=2&&bk.note==='백업 노트'&&bk.line===2&&bk.asset&&bk.fav&&bk.paper.endsWith('builtin-note_lines.pdf'), JSON.stringify([bk.r,bk.note,bk.asset,bk.fav,bk.paper]));
check('restore (add) keeps originals and adds a copy', bk.copy, JSON.stringify(bk.r2));

// 9: app info + update check
const ab=await pg.evaluate(async()=>{
  const {host}=await import('./js/host.js'); app._appVersion='3.7.0';
  host._fake.updateHandler=async()=>({version:'3.8.0',page:'https://example.invalid/r',notes:'새 기능',setupUrl:'https://github.com/hdlee73/PDF-Note-Windows/releases/download/v3.8.0/Everynote-Setup-v3.8.0-x64.exe',exeUrl:null,installed:true,arch:'x64'});
  app.showAbout(); await new Promise(r=>setTimeout(r,300));
  const out={text:document.querySelector('[data-tag="about_info"]').textContent,auto:document.querySelector('[data-tag="auto_update"]').checked,inst:document.querySelector('[data-tag="auto_update_install"]').checked};
  [...document.querySelectorAll('.ad-btn')].find(x=>x.textContent.trim()==='업데이트 확인').click(); await new Promise(r=>setTimeout(r,500));
  out.status=document.querySelector('[data-tag="update_status"]').textContent; out.prompt=[...document.querySelectorAll('.ad-btn')].map(x=>x.textContent.trim());
  [...document.querySelectorAll('.ad-btn')].find(x=>x.textContent.trim()==='업데이트').click(); await new Promise(r=>setTimeout(r,300));
  out.installed=host._fake.installed||[];
  return out;});
check('about shows version and the maker line', ab.text.includes('버전 3.7.0')&&ab.text.includes('만든이 : 이현덕(with Claude), hdlee73@gmail.com'), ab.text);
check('auto-check on by default, auto-install off', ab.auto===true&&ab.inst===false);
check('update found -> prompt -> installer download of the Setup', ab.status.includes('3.8.0')&&ab.prompt.includes('업데이트')&&ab.installed.length===1&&ab.installed[0].endsWith('Setup-v3.8.0-x64.exe'), JSON.stringify([ab.status,ab.prompt,ab.installed]));
const same=await pg.evaluate(async()=>{const {host}=await import('./js/host.js');host._fake.updateHandler=async()=>({version:'3.7.0'});const el=document.createElement('div');await app.checkForUpdate(true,el);return el.textContent});
check('same version -> up to date', same.includes('최신 버전'), same);

// menus carry the new rows
const rows=await pg.evaluate(async()=>{app.showMainMenu(document.body,false);await new Promise(r=>setTimeout(r,300));return [...document.querySelectorAll('.amenu-row .amenu-label')].map(e=>e.textContent)});
check('main menu has backup + app info rows', rows.includes('전체 백업·복원')&&rows.includes('앱 정보·업데이트'), JSON.stringify(rows));
check('no page errors', errs.length===0, errs.join(' | '));
await b.close(); s.close?.(); console.log(fails?`${fails} FAILED`:'ALL PASS'); process.exit(fails?1:0);
