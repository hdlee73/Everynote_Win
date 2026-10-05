// Whole-library backup / restore (same ZIP layout as the Android app, so a backup made on either app restores on the other).
//   everynote-backup.json first, then docs/N.pdf + notes/N.json per document, then assets/NAME.
// The zip itself is written / read by the host (zip.create / zip.entries / zip.readText / zip.extract); this file holds the logic.
import { host } from './host.js';
import { AnnotationStore } from './store.js';
import { NotebookFiles, Paper, joinP } from './library.js';
import { baseName, dirName } from './util.js';

const BUILTIN_BASE = new URL('../assets/templates/', import.meta.url).href;
const templateDir = async () => (await host.info()).data.replace(/[\\/]+$/, '') + '\\templates';
/** The copy of a bundled form template (금감원노트 …) kept in <data>\\templates, created on first use. */
export async function builtinTemplate(name) {
  if (!NotebookFiles.BUILTIN_TEMPLATES.includes(name)) throw new Error('서식 이름');
  const dir = await templateDir(), file = dir + '\\builtin-' + name;
  if (!(await host.exists(file))) { await host.mkdir(dir); await host.writeBytes(file, new Uint8Array(await (await fetch(BUILTIN_BASE + name)).arrayBuffer())); }
  return file;
}
const extOf = p => { const n = baseName(p), i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1).replace(/[^A-Za-z0-9]/g, '') || 'pdf' : 'pdf'; };
import { ASSET_NAME, relPath } from './sync.js';

export const BACKUP_FORMAT = 'Everynote backup v1';
export const BACKUP_MANIFEST = 'everynote-backup.json';

/** Library-relative path check (slash separated, no dot parts, optionally must end in .pdf). */
export function safeRel(rel, pdf) {
  if (typeof rel !== 'string' || !rel || rel.length > 400 || rel.startsWith('/') || rel.includes('\\') || rel.includes('\0')) return false;
  if (pdf && !rel.toLowerCase().endsWith('.pdf')) return false;
  return rel.split('/').every(p => p && p !== '.' && p !== '..' && !p.startsWith('.'));
}
const toWin = rel => rel.split('/').join('\\');

/** Writes every document, its notes and all pictures / recordings / videos into one zip. Returns the number of documents. */
export async function createBackup(env, outPath) {
  const lib = env.library, docs = [], folders = [];
  const walk = async dir => {
    for (const f of await lib.list(dir)) {
      const rel = relPath(lib.root, f); if (rel == null) continue;
      if (lib.isDirectory(f)) { folders.push({ path: rel, color: lib.folderColor(f) | 0 }); await walk(f); } else docs.push({ file: f, rel });
    }
  };
  await walk(lib.root);
  const assetNames = [];
  try { for (const e of await host.list(await AnnotationStore.assetsDir())) if (!e.isDir && ASSET_NAME.test(e.name)) assetNames.push(e.name); } catch { /* no assets yet */ }
  const manifest = { format: BACKUP_FORMAT, created: Date.now(), app: 'windows', version: env.version || '', documents: [], folders, assets: assetNames };
  const entries = [{ name: BACKUP_MANIFEST, text: '' }];
  for (let i = 0; i < docs.length; i++) {
    const d = docs[i], o = { i, path: d.rel, favorite: !!lib.favorite(d.file) };
    const paper = lib.paper(d.file), tpl = [];
    if (paper) {
      if (paper.kind !== NotebookFiles.CUSTOM) o.paper = paper.kind + ':' + paper.color;
      else if (paper.template && baseName(paper.template).startsWith('builtin-')) o.paper = 'builtin:' + baseName(paper.template).slice(8) + ':' + paper.color;
      else if (paper.template && (await host.stat(paper.template)).exists) { const ext = extOf(paper.template); o.paper = 'custom:' + paper.color + ':' + ext; tpl.push({ name: `templates/${i}.${ext}`, file: paper.template }); }
    }
    manifest.documents.push(o);
    entries.push(...tpl);
    entries.push({ name: `docs/${i}.pdf`, file: d.file }, { name: `notes/${i}.json`, text: await env.exportNote(d.rel) });
  }
  for (const n of assetNames) entries.push({ name: 'assets/' + n, file: await AnnotationStore.assetPath(n) });
  entries[0].text = JSON.stringify(manifest, null, 2);
  await host.zipCreate(outPath, entries);
  return docs.length;
}

/** overwrite=false: a document whose path exists is added as a copy ("name (1).pdf"); true: replaced unless it is open. */
export async function restoreBackup(env, zipPath, overwrite) {
  const lib = env.library, names = new Set((await host.zipEntries(zipPath)).map(e => e.name));
  if (!names.has(BACKUP_MANIFEST)) throw new Error('Everynote 백업 파일이 아닙니다');
  let m; try { m = JSON.parse(await host.zipReadText(zipPath, BACKUP_MANIFEST)); } catch { throw new Error('Everynote 백업 파일이 아닙니다'); }
  if (!m || m.format !== BACKUP_FORMAT) throw new Error('Everynote 백업 파일이 아닙니다');
  const r = { documents: 0, notes: 0, assets: 0, folders: 0, skipped: 0, failed: 0 };
  for (const o of m.folders || []) {
    if (!o || !safeRel(o.path, false)) continue;
    const dir = joinP(lib.root, toWin(o.path)), st = await host.stat(dir);
    if (!st.exists) { await host.mkdir(dir); lib.folderColor(dir, (o.color | 0) || LibraryColor0()); r.folders++; }
  }
  for (const o of m.documents || []) {
    try {
      if (!o || !safeRel(o.path, true) || !names.has(`docs/${o.i}.pdf`)) { r.failed++; continue; }
      let target = joinP(lib.root, toWin(o.path));
      if ((await host.stat(target)).exists) {
        if (overwrite) { if (await env.isOpenPath(target)) { r.skipped++; continue; } }
        else target = await NotebookFiles.unique(dirName(target), baseName(target));
      }
      await host.mkdir(dirName(target));
      await host.zipExtract(zipPath, `docs/${o.i}.pdf`, target); r.documents++;
      if (o.favorite) lib.favorite(target, true);
      if (typeof o.paper === 'string' && o.paper) {
        try {
          const q = o.paper.split(':');
          if (q[0] === 'builtin') lib._putPaper(target, new Paper(NotebookFiles.CUSTOM, parseInt(q[2], 10), await builtinTemplate(q[1])));
          else if (q[0] === 'custom') {
            const ext = (q[2] || 'pdf').replace(/[^A-Za-z0-9]/g, '') || 'pdf', entry = `templates/${o.i}.${ext}`;
            if (names.has(entry)) { const file = (await templateDir()) + `\\restored-${Date.now()}-${o.i}.${ext}`; await host.zipExtract(zipPath, entry, file); lib._putPaper(target, new Paper(NotebookFiles.CUSTOM, parseInt(q[1], 10), file)); }
          } else lib._putPaper(target, Paper.parse(o.paper));
        } catch { /* unknown paper */ }
      }
      if (names.has(`notes/${o.i}.json`)) {
        const text = await host.zipReadText(zipPath, `notes/${o.i}.json`), st = new AnnotationStore();
        try { await st.open(target); await st.importJson(text, Infinity); r.notes++; } catch { r.failed++; }
      }
    } catch { r.failed++; }
  }
  for (const n of names) {
    if (!n.startsWith('assets/')) continue;
    const name = n.slice(7); if (!ASSET_NAME.test(name)) continue;
    try {
      const dest = await AnnotationStore.assetPath(name);
      if (!overwrite && (await host.stat(dest)).exists) continue;
      await host.zipExtract(zipPath, n, dest); r.assets++;
    } catch { r.failed++; }
  }
  return r;
}
function LibraryColor0() { return 0xFF8FA8F0 | 0; }

// ---- update check -----------------------------------------------------------------------------------------------------------------------------
/** Numeric comparison of dotted versions ("v3.7.0" vs "3.8.0"): > 0 when a is newer than b. */
export function compareVersions(a, b) {
  const p = v => String(v || '').trim().replace(/^[vV]/, '').split(/[.-]/).map(x => parseInt(x, 10) || 0);
  const x = p(a), y = p(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
}
export const AUTHOR_LINE = '만든이 : 이현덕(with Claude), hdlee73@gmail.com';
