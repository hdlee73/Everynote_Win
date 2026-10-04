// Bridge to the native Windows shell (WPF + WebView2). In a plain browser (dev/tests) an in-memory fake is used.
//
// PROTOCOL  (JSON via chrome.webview.postMessage / PostWebMessageAsJson)
//   page -> host : {id, m:'fs.list', a:{...}}
//   host -> page : {id, ok:true, r:<result>}  |  {id, ok:false, e:'message'}
//   host -> page events : {ev:'name', d:<data>}   (e.g. office.progress, open.file)
// METHODS (all async):
//   app.info()                         -> {library, data, temp, documents, args:[paths], version, platform:'win'}
//   app.log({msg})                     -> true
//   fs.list({path})                    -> [{name,path,isDir,size,mtime(ms)}]
//   fs.stat({path})                    -> {exists,isDir,size,mtime}
//   fs.url({path})                     -> 'https://file.pdfnote.local/f?p=...'  (GET returns bytes, supports Range)
//   fs.readText({path}) / fs.writeText({path,text})
//   fs.writeBegin({path}) -> token ; fs.writeChunk({token,b64}) ; fs.writeEnd({token})
//   fs.mkdir({path}) fs.move({from,to}) fs.copy({from,to}) fs.delete({path})  (delete is recursive)
//   dialog.open({title,filters:[{name,exts:['pdf']}],multi}) -> [paths]   dialog.save({title,name,filters}) -> path|null
//   shell.open({path|url})  shell.reveal({path})
//   window.fullscreen({on}) power.keepAwake({on})
//   office.engines() -> {word,excel,powerpoint,libreoffice:path|null}
//   office.convert({id,path,kind}) -> {pdf:path}   (events office.progress {id,text}); office.cancel({id})
//   ocr.recognize({png:b64,lang}) -> {width,height,words:[{text,x,y,w,h,line}]}  (pixel boxes)
import { baseName, dirName } from './util.js';

const wv = window.chrome && window.chrome.webview;
const pending = new Map();
const listeners = new Map();
let nextId = 1;

function emit(ev, d) { (listeners.get(ev) || []).forEach(f => { try { f(d); } catch (e) { console.error(e); } }); }

if (wv) {
  wv.addEventListener('message', e => {
    const m = e.data;
    if (m && m.ev) { emit(m.ev, m.d); return; }
    const p = m && pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.r); else p.reject(new Error(m.e || 'host error'));
  });
}

function nativeCall(m, a) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    wv.postMessage({ id, m, a: a || {} });
  });
}

// ---------------------------------------------------------------- dev fallback (browser only)
const fake = {
  files: new Map(), // 'C:\\x\\y' -> {dir:boolean, bytes:Uint8Array|null, mtime}
  lib: 'C:\\Users\\dev\\Documents\\PDF Note',
  data: 'C:\\Users\\dev\\AppData\\Local\\PDFNote',
  inited: false,
  init() {
    if (this.inited) return; this.inited = true;
    for (const d of [this.lib, this.data, 'C:\\Users\\dev\\Documents', 'C:\\Users\\dev', 'C:\\Users', 'C:']) this.files.set(d, { dir: true, mtime: Date.now() });
  },
  norm(p) { return p.replace(/\//g, '\\').replace(/\\+$/, ''); },
  mkdirs(p) { p = this.norm(p); const parts = p.split('\\'); let cur = ''; for (const s of parts) { cur = cur ? cur + '\\' + s : s; if (!this.files.has(cur)) this.files.set(cur, { dir: true, mtime: Date.now() }); } },
  put(path, bytes) { path = this.norm(path); this.mkdirs(dirName(path)); this.files.set(path, { dir: false, bytes, mtime: Date.now() }); },
  async call(m, a) {
    this.init();
    const P = a && a.path ? this.norm(a.path) : null;
    switch (m) {
      case 'app.info': return { library: this.lib, data: this.data, temp: this.data + '\\tmp', documents: 'C:\\Users\\dev\\Documents', args: [], version: 'dev', platform: 'web' };
      case 'app.log': console.log('[host.log]', a.msg); return true;
      case 'fs.list': {
        const out = []; const pre = P + '\\';
        for (const [k, v] of this.files) if (k.startsWith(pre) && !k.slice(pre.length).includes('\\')) out.push({ name: k.slice(pre.length), path: k, isDir: v.dir, size: v.bytes ? v.bytes.length : 0, mtime: v.mtime });
        return out;
      }
      case 'fs.stat': { const v = this.files.get(P); return v ? { exists: true, isDir: v.dir, size: v.bytes ? v.bytes.length : 0, mtime: v.mtime } : { exists: false, isDir: false, size: 0, mtime: 0 }; }
      case 'fs.url': { const v = this.files.get(P); if (!v || v.dir) throw new Error('not found: ' + P); return URL.createObjectURL(new Blob([v.bytes])); }
      case 'fs.readText': { const v = this.files.get(P); if (!v || v.dir) throw new Error('not found: ' + P); return new TextDecoder().decode(v.bytes); }
      case 'fs.writeText': this.put(P, new TextEncoder().encode(a.text)); return true;
      case 'fs.writeBegin': { const t = 'w' + (nextId++); (this.w ||= new Map()).set(t, { path: P, parts: [] }); return t; }
      case 'fs.writeChunk': { this.w.get(a.token).parts.push(Uint8Array.from(atob(a.b64), c => c.charCodeAt(0))); return true; }
      case 'fs.writeEnd': { const w = this.w.get(a.token); this.w.delete(a.token); let n = 0; w.parts.forEach(p => n += p.length); const all = new Uint8Array(n); let o = 0; w.parts.forEach(p => { all.set(p, o); o += p.length; }); this.put(w.path, all); return true; }
      case 'fs.mkdir': this.mkdirs(P); return true;
      case 'fs.move': case 'fs.copy': {
        const from = this.norm(a.from), to = this.norm(a.to);
        const moves = [];
        for (const [k, v] of this.files) if (k === from || k.startsWith(from + '\\')) moves.push([k, to + k.slice(from.length), v]);
        if (!moves.length) throw new Error('not found: ' + from);
        this.mkdirs(dirName(to));
        for (const [k, nk, v] of moves) { this.files.set(nk, { ...v, mtime: Date.now() }); if (m === 'fs.move') this.files.delete(k); }
        return true;
      }
      case 'fs.delete': for (const k of [...this.files.keys()]) if (k === P || k.startsWith(P + '\\')) this.files.delete(k); return true;
      case 'dialog.open': return await new Promise(res => {
        const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = !!a.multi;
        if (a.filters) inp.accept = a.filters.flatMap(f => f.exts.map(e => '.' + e)).join(',');
        inp.onchange = async () => {
          const out = [];
          for (const f of inp.files) { const p = 'C:\\Users\\dev\\Downloads\\' + f.name; this.put(p, new Uint8Array(await f.arrayBuffer())); out.push(p); }
          res(out);
        };
        inp.oncancel = () => res([]);
        inp.click();
      });
      case 'dialog.save': return 'C:\\Users\\dev\\Downloads\\' + (a.name || 'file');
      case 'shell.open': case 'shell.reveal': console.log('[host]', m, a); return true;
      case 'window.fullscreen': if (a.on) document.documentElement.requestFullscreen?.().catch(() => {}); else document.exitFullscreen?.().catch(() => {}); return true;
      case 'power.keepAwake': return true;
      case 'office.engines': return { word: false, excel: false, powerpoint: false, libreoffice: null };
      case 'office.convert': throw new Error('변환 엔진이 없습니다');
      case 'office.cancel': return true;
      case 'ocr.recognize': throw new Error('OCR unavailable in browser');
      default: throw new Error('unknown host method ' + m);
    }
  },
};


export const host = {
  native: !!wv,
  call(m, a) { return wv ? nativeCall(m, a) : fake.call(m, a); },
  on(ev, cb) { if (!listeners.has(ev)) listeners.set(ev, []); listeners.get(ev).push(cb); },
  off(ev, cb) { const l = listeners.get(ev); if (l) { const i = l.indexOf(cb); if (i >= 0) l.splice(i, 1); } },
  _emit: emit,
  /** dev/test only: fake file system access */
  _fake: fake,

  info: () => (host._infoP ||= host.call('app.info')),  // cached: the first call hands out (and clears) the startup file args
  log: msg => host.call('app.log', { msg: String(msg) }).catch(() => {}),
  list: path => host.call('fs.list', { path }),
  stat: path => host.call('fs.stat', { path }),
  exists: async path => (await host.stat(path)).exists,
  mkdir: path => host.call('fs.mkdir', { path }),
  move: (from, to) => host.call('fs.move', { from, to }),
  copy: (from, to) => host.call('fs.copy', { from, to }),
  delete: path => host.call('fs.delete', { path }),
  readText: path => host.call('fs.readText', { path }),
  writeText: (path, text) => host.call('fs.writeText', { path, text }),
  async readBytes(path) {
    const url = await host.call('fs.url', { path });
    const r = await fetch(url);
    if (!r.ok) throw new Error('read failed: ' + path);
    return new Uint8Array(await r.arrayBuffer());
  },
  async writeBytes(path, bytes) {
    const token = await host.call('fs.writeBegin', { path });
    const CH = 768 * 1024;
    for (let o = 0; o < bytes.length; o += CH) {
      const part = bytes.subarray(o, Math.min(bytes.length, o + CH));
      let bin = ''; for (let i = 0; i < part.length; i += 8192) bin += String.fromCharCode.apply(null, part.subarray(i, i + 8192));
      await host.call('fs.writeChunk', { token, b64: btoa(bin) });
    }
    await host.call('fs.writeEnd', { token });
  },
  async writeBlob(path, blob) { return host.writeBytes(path, new Uint8Array(await blob.arrayBuffer())); },
  openDialog: (title, filters, multi = false) => host.call('dialog.open', { title, filters, multi }),
  saveDialog: (title, name, filters) => host.call('dialog.save', { title, name, filters }),
  shellOpen: pathOrUrl => host.call('shell.open', /^https?:/i.test(pathOrUrl) ? { url: pathOrUrl } : { path: pathOrUrl }),
  reveal: path => host.call('shell.reveal', { path }),
  baseName, dirName,
};
