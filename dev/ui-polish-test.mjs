// v3.10.0 UI polish checks: dialog button centering, swatch circles, rail menus, fullscreen dock tint, two-page gap. usage: node dev/ui-polish-test.mjs [outdir]
import {chromium} from '/tmp/npmtest/node_modules/playwright/index.mjs';
import {serve} from './server.mjs'; import fs from 'fs';
const OUT=process.argv[2]||'dev/out'; fs.mkdirSync(OUT,{recursive:true});
const PORT=8200+Math.floor(Math.random()*700); const s=await serve(PORT);
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const pg=await b.newPage({viewport:{width:1280,height:800}});
const errs=[]; pg.on('pageerror',e=>errs.push('PE '+e.message)); pg.on('console',m=>{if(m.type()==='error')errs.push('CE '+m.text())});
await pg.addInitScript(()=>{Map.prototype.getOrInsertComputed??=function(k,f){if(!this.has(k))this.set(k,f(k));return this.get(k)}});
await pg.goto(`http://localhost:${PORT}/index.html`); await pg.waitForTimeout(1500);
const bytes=[...fs.readFileSync('dev/samples/sample-ko.pdf')];
await pg.evaluate(async b=>{const {host}=await import('./js/host.js');host._fake.put('C:\\Docs\\sample-ko.pdf',new Uint8Array(b));await app.openPdf('C:\\Docs\\sample-ko.pdf')},bytes);
await pg.waitForTimeout(1500);
let fails=0; const check=(n,ok,info='')=>{console.log((ok?'PASS ':'FAIL ')+n+(info?' '+info:'')); if(!ok)fails++;};
// labels must be centered in their button (both axes)
const centered=async()=>pg.evaluate(()=>[...document.querySelectorAll('.ad-root .ad-bar .ad-btn')].filter(b=>b.offsetParent).map(b=>{const r=b.getBoundingClientRect(),l=(b.querySelector('.ad-btn-label')||b).getBoundingClientRect();return {t:b.textContent,dx:Math.round((l.left+l.right)/2-(r.left+r.right)/2),dy:Math.round((l.top+l.bottom)/2-(r.top+r.bottom)/2)}}));
const closeAll=async()=>{await pg.keyboard.press('Escape');await pg.waitForTimeout(250);await pg.evaluate(()=>document.querySelectorAll('.ad-root').forEach(e=>e.remove()))};
for (const [name,fn] of [['youtube','askYoutube'],['table','showTableDialog'],['newnote','newNotebook']]) {
  await pg.evaluate(f=>app[f](),fn); await pg.waitForTimeout(400);
  const c=await centered(); check(name+' buttons centered', c.length>=2&&c.every(x=>Math.abs(x.dx)<=1&&Math.abs(x.dy)<=1), JSON.stringify(c));
  if(name==='table'){const d=await pg.evaluate(()=>[...document.querySelectorAll('.m2-cdot')].map(e=>{const r=e.getBoundingClientRect();return [Math.round(r.width),Math.round(r.height)]}));check('table swatches are circles',d.length>0&&d.every(([w,h])=>w===h),JSON.stringify(d.slice(0,3)));}
  await pg.locator('.ad-card').last().screenshot({path:`${OUT}/dlg-${name}.png`}); await closeAll();
}
await pg.evaluate(async()=>{const {AlertDialog}=await import('./js/ui/alert.js');new AlertDialog.Builder().setTitle('휴지통').setMessage('휴지통이 비어 있습니다').setPositiveButton('닫기').show();}); await pg.waitForTimeout(300);
{const c=await centered(); check('trash close centered',c.length===1&&Math.abs(c[0].dx)<=1&&Math.abs(c[0].dy)<=1,JSON.stringify(c));}
await pg.locator('.ad-card').last().screenshot({path:`${OUT}/dlg-trash.png`}); await closeAll();
// main menu: no duplicated whole-library backup row; renamed rows in the export submenu
await pg.evaluate(()=>app.showMainMenu(document.querySelector('[data-tag=reading_toolbar]'),true)); await pg.waitForTimeout(300);
const labels=await pg.evaluate(()=>[...document.querySelectorAll('.amenu-label')].map(e=>e.textContent));
check('main menu has no 모든 문서 백업·복원', !labels.includes('모든 문서 백업·복원'), labels.join('|'));
await pg.locator('.amenu-row[aria-label="내보내기·백업"]').click(); await pg.waitForTimeout(300);
const sub=await pg.evaluate(()=>[...document.querySelectorAll('.amenu-label')].map(e=>e.textContent));
check('submenu renamed', sub.includes('모든 문서 백업')&&sub.includes('모든 문서 복원')&&!sub.some(t=>t.includes('통째로')), '');
check('more indicator is an icon', await pg.evaluate(()=>{const m=document.querySelector('.amenu-more');return !!m&&!!m.querySelector('svg')&&m.textContent.trim()===''}));
await closeAll(); await pg.evaluate(()=>document.querySelectorAll('.amenu,.amenu-backdrop').forEach(e=>e.remove()));
// vertical rail: menus open beside the bar, page label centered
for (const side of ['right','left']) {
  await pg.evaluate(sd=>app.setBarPlace(sd),side); await pg.waitForTimeout(400);
  await pg.locator('[data-tag=read_bar] [aria-label="보기 방법"]').click(); await pg.waitForTimeout(400);
  const ov=await pg.evaluate(()=>{const bar=document.querySelector('[data-tag=reading_toolbar]').getBoundingClientRect(),m=document.querySelector('.amenu').getBoundingClientRect();return {overlap:Math.max(0,Math.min(bar.right,m.right)-Math.max(bar.left,m.left)),bar:[bar.left,bar.right],m:[m.left,m.right]}});
  check('rail '+side+' menu beside bar', ov.overlap===0, JSON.stringify(ov));
  await pg.locator('.amenu-row[aria-label="페이지 넘김 설정"]').click(); await pg.waitForTimeout(300);
  const ov2=await pg.evaluate(()=>{const bar=document.querySelector('[data-tag=reading_toolbar]').getBoundingClientRect();const ms=[...document.querySelectorAll('.amenu')].map(m=>m.getBoundingClientRect());return ms.map(m=>Math.max(0,Math.min(bar.right,m.right)-Math.max(bar.left,m.left)))});
  check('rail '+side+' submenu beside bar', ov2.every(x=>x===0), JSON.stringify(ov2));
  await pg.screenshot({path:`${OUT}/rail-${side}.png`});
  await closeAll(); await pg.evaluate(()=>document.querySelectorAll('.amenu,.amenu-backdrop').forEach(e=>e.remove()));
  const pl=await pg.evaluate(()=>{const e=app.pageLabel,r=e.getBoundingClientRect(),rg=document.createRange();rg.selectNodeContents(e);const t=rg.getBoundingClientRect();return Math.round((t.top+t.bottom)/2-(r.top+r.bottom)/2)});
  check('rail '+side+' page label vertically centered', Math.abs(pl)<=1, 'dy='+pl);
}
await pg.evaluate(()=>app.setBarPlace('bottom')); await pg.waitForTimeout(300);
// fullscreen dock icons are tinted like the bottom bar
await pg.evaluate(()=>app.toggleFullscreen()); await pg.waitForTimeout(500);
const tints=await pg.evaluate(()=>[...document.querySelectorAll('[data-tag=fullscreen_toolbar] svg')].map(s=>getComputedStyle(s).color));
check('fullscreen dock colored', new Set(tints).size>=5, JSON.stringify(tints));
await pg.screenshot({path:`${OUT}/fullscreen.png`});
await pg.evaluate(()=>app.toggleFullscreen()); await pg.waitForTimeout(300);
// highlighter transparency menu: slider + quick buttons, kept in prefs, applied to the highlight colour
await pg.evaluate(()=>{app.setWriteMode(true);}); await pg.waitForTimeout(200);
await pg.evaluate(()=>app.highlightTap(app.hlButton)); await pg.waitForTimeout(200);
await pg.evaluate(()=>app.highlightTap(app.hlButton)); await pg.waitForTimeout(300);
check('highlighter menu has opacity slider + presets', await pg.evaluate(()=>!!document.querySelector('[data-tag=highlight_opacity] input')&&document.querySelectorAll('[data-tag=highlight_opacity_presets] .m-alpha-chip').length===4));
await pg.locator('[data-tag=highlight_opacity_presets] .m-alpha-chip').nth(2).click(); await pg.waitForTimeout(200);
const hl=await pg.evaluate(()=>({a:(app.selectedColor>>>24)&255,pref:app.recentPrefs.getInt('highlight_alpha',-1),view:(app.pageView.highlightColor>>>24)&255}));
check('60% preset sets highlight alpha', hl.a===153&&hl.pref===153&&hl.view===153, JSON.stringify(hl));
await pg.locator('.amenu').screenshot({path:`${OUT}/highlight-menu.png`});
await closeAll(); await pg.evaluate(()=>document.querySelectorAll('.amenu,.amenu-backdrop').forEach(e=>e.remove()));
// eraser range menu
await pg.evaluate(()=>app.eraserTap(app.eraserButton)); await pg.waitForTimeout(150);
await pg.evaluate(()=>app.eraserTap(app.eraserButton)); await pg.waitForTimeout(300);
check('eraser menu opens on second tap', await pg.evaluate(()=>document.querySelectorAll('[data-tag=eraser_sizes] .m-eraser-cell').length===5));
await pg.locator('[data-tag=eraser_sizes] .m-eraser-cell').nth(4).click(); await pg.waitForTimeout(200);
const er=await pg.evaluate(()=>({pref:app.recentPrefs.getInt('eraser_radius',-1),v1:app.firstPageView.eraserRadius,v2:app.secondPageView.eraserRadius}));
check('largest eraser size applied to both views', er.pref===48&&er.v1===48&&er.v2===48, JSON.stringify(er));
await pg.locator('.amenu').screenshot({path:`${OUT}/eraser-menu.png`});
await closeAll(); await pg.evaluate(()=>{document.querySelectorAll('.amenu,.amenu-backdrop').forEach(e=>e.remove());app.setWriteMode(false);});
// two-page view: pages touch, also after zoom
await pg.evaluate(()=>app.toggleTwoPage()); await pg.waitForTimeout(1200);
const gap=async()=>pg.evaluate(()=>{const a=app.firstPageView,b=app.secondPageView;const ra=a.el.getBoundingClientRect(),rb=b.el.getBoundingClientRect();const pa=a.pageRect(),pb=b.pageRect();return Math.round((rb.left+pb.left)-(ra.left+pa.right))});
let g=await gap(); check('two-page spread touches', Math.abs(g)<=1, 'gap='+g); await pg.screenshot({path:`${OUT}/twopage.png`});
for(let i=0;i<4;i++){await pg.click('[data-tag="zoom_out"]');await pg.waitForTimeout(250);}
g=await gap(); check('two-page touches zoomed out', Math.abs(g)<=1, 'gap='+g); await pg.screenshot({path:`${OUT}/twopage-out.png`});
for(let i=0;i<8;i++){await pg.click('[data-tag="zoom_in"]');await pg.waitForTimeout(250);}
g=await gap(); check('two-page touches zoomed in', Math.abs(g)<=1, 'gap='+g); await pg.screenshot({path:`${OUT}/twopage-in.png`});
await pg.evaluate(()=>{const v=app.firstPageView;v.panX+=60;v.panY-=30;v.clampPan();v.invalidate();}); await pg.waitForTimeout(300);
g=await gap(); const pan=await pg.evaluate(()=>[app.firstPageView.panX,app.secondPageView.panX]);
check('two-page touches after panning (pan shared)', Math.abs(g)<=1&&pan[0]===pan[1], 'gap='+g+' pan='+pan); await pg.screenshot({path:`${OUT}/twopage-pan.png`});
console.log(errs.join('\n')); console.log(fails?`${fails} FAILED`:'ALL PASS'); await b.close(); s.close(); process.exit(fails?1:0);
