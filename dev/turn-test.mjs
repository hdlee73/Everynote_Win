// v3.6.2: zoom survives a page turn; the curl overlay spans the reading area.  node dev/turn-test.mjs
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
await pg.evaluate(async([b,p])=>{const {host}=await import('./js/host.js');host._fake.put(p,new Uint8Array(b));await app.openPdf(p);},[bytes,'C:\\Users\\dev\\Documents\\PDF Note\\sample.pdf']);
await pg.waitForTimeout(1500);
const pages=await pg.evaluate(()=>app.renderer.pageCount); check('sample has pages',pages>=3,String(pages));
for(const style of [0,1,2]) for(const z of [0.6,2]){
  await pg.evaluate(s=>{app.recentPrefs.putInt('page_anim_style',s); app.showPage(0);},style); await pg.waitForTimeout(500);
  const before=await pg.evaluate(z=>{app.pageView.setZoom(z);return app.pageView.scale},z);
  const p0=await pg.evaluate(()=>app.currentPage);
  await pg.evaluate(()=>app.animatePage(1)); await pg.waitForTimeout(1600);
  const r=await pg.evaluate(()=>({page:app.currentPage,scale:app.pageView.scale,label:app.zoomLabel.textContent}));
  check(`style ${style} zoom ${z}: next page keeps zoom`, r.page===p0+1&&Math.abs(r.scale-before)<0.01, JSON.stringify(r));
}
await pg.evaluate(()=>{app.recentPrefs.putInt('page_anim_style',0);app.showPage(1);app.pageView.resetZoom?.()}); await pg.waitForTimeout(500);
await pg.evaluate(()=>app.animatePage(1)); await pg.waitForTimeout(1600);
check('zoom 100% stays 100%', await pg.evaluate(()=>app.pageView.scale===1));
// curl overlay spans the viewport while turning
const geo=await pg.evaluate(async()=>{app.animatePage(-1);await new Promise(r=>setTimeout(r,250));const box=document.querySelector('.m-curl');const v=app.viewportLayer.getBoundingClientRect();const r=box&&box.getBoundingClientRect();return r&&{bw:r.width,bh:r.height,vw:v.width,vh:v.height}});
check('curl overlay covers the reading area', geo&&Math.abs(geo.bw-geo.vw)<2&&Math.abs(geo.bh-geo.vh)<2, JSON.stringify(geo));
await pg.screenshot({path:'dev/out/turn-mid.png'}); await pg.waitForTimeout(1500);
check('no page errors', errs.length===0, errs.join(' | '));
await b.close(); s.close?.(); console.log(fails?`${fails} FAILED`:'ALL PASS'); process.exit(fails?1:0);
