// usage: node dev/curl-test.mjs  -> writes dev/out/curl-*.png
import { chromium } from '/tmp/npmtest/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html' }); fs.createReadStream(f).pipe(r); }).listen(8131);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const pg = await b.newPage({ viewport: { width: 1800, height: 1500 } });
pg.on('console', m => console.log('console', m.text())); pg.on('pageerror', e => console.log('ERR', e.message));
await pg.goto('http://localhost:8131/dev/curl-test.html'); await pg.waitForFunction('window.__done', null, { timeout: 10000 });
console.log(JSON.stringify(await pg.evaluate('window.__done')));
fs.mkdirSync(path.join(root, 'dev/out'), { recursive: true });
for (const id of ['single', 'spine']) await (await pg.$('#' + id)).screenshot({ path: path.join(root, `dev/out/curl-${id}.png`) });
await b.close(); srv.close();
