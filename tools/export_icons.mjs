// Writes web/icons/<name>.svg for every icon in web/js/icons.js (standalone 24x24 files, same look as in the app). usage: node tools/export_icons.mjs
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { ICONS } = await import(pathToFileURL(path.join(root, 'web/js/icons.js')).href);
const dir = path.join(root, 'web/icons');
for (const f of fs.readdirSync(dir)) if (f.endsWith('.svg')) fs.unlinkSync(path.join(dir, f));
for (const [name, inner] of Object.entries(ICONS)) {
  fs.writeFileSync(path.join(dir, name + '.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#010102" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" color="#E8405A">${inner.replace(/currentColor/g, name.startsWith('tool_') ? '#E8405A' : '#010102')}</svg>\n`);
}
console.log(Object.keys(ICONS).length + ' icons written to web/icons');
