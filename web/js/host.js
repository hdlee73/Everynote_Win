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
//   google.config({clientId,clientSecret}) -> status   (stored DPAPI-protected; empty values clear; secret never returned)
//   google.signIn() -> {email}      (system browser, loopback + PKCE, scopes drive.file + email; may take minutes)
//   google.signOut() -> true        google.status() -> {signedIn,email,configured}
//   google.request({method,url,headers,body,bodyBase64,uploadPath,savePath}) -> {status,headers,text|savedPath}
//        authenticated proxy (bearer added/refreshed by the host), HTTPS *.googleapis.com / accounts.google.com only;
//        uploadPath streams a disk file as the body, savePath streams a 2xx response body to disk (allow-listed paths)
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
      case 'google.status': return fakeGoogle.status();
      case 'google.config': return fakeGoogle.config(a);
      case 'google.signIn': return fakeGoogle.signIn();
      case 'google.signOut': return fakeGoogle.signOut();
      case 'google.request': return await fakeGoogle.request(this, a);
      default: throw new Error('unknown host method ' + m);
    }
  },
};


// ---------------------------------------------------------------- fake Google (browser dev/tests): sign-in + a tiny in-memory Drive v3
const fakeGoogle = {
  configured: false, signedIn: false, email: 'tester@example.com', clientId: '',
  files: new Map(),   // id -> {id,name,mimeType,parents:[],modifiedTime,appProperties,trashed,bytes:Uint8Array}
  sessions: new Map(), seq: 1, requests: [],
  status() { return { signedIn: this.signedIn, email: this.signedIn ? this.email : '', configured: this.configured }; },
  config(a) { this.clientId = (a && a.clientId) || ''; this.configured = !!this.clientId; if (!this.configured) this.signedIn = false; return this.status(); },
  signIn() { if (!this.configured) throw new Error('Google 클라이언트 ID가 설정되지 않았습니다'); this.signedIn = true; return { email: this.email }; },
  signOut() { this.signedIn = false; return true; },
  meta(f, fields) { const { bytes, ...m } = f; m.size = String(bytes ? bytes.length : 0); return m; },
  bytesOf(fk, a) {
    if (a.uploadPath) { const v = fk.files.get(fk.norm(a.uploadPath)); if (!v || v.dir) throw new Error('not found: ' + a.uploadPath); return v.bytes; }
    if (a.bodyBase64) return Uint8Array.from(atob(a.bodyBase64), c => c.charCodeAt(0));
    return new TextEncoder().encode(a.body || '');
  },
  matches(f, q) {
    if (!q) return true;
    for (const part of q.split(/\s+and\s+/i)) {
      let m;
      if ((m = part.match(/^name\s*=\s*'((?:[^'\\]|\\.)*)'$/))) { if (f.name !== m[1].replace(/\\'/g, "'")) return false; }
      else if ((m = part.match(/^name contains\s*'((?:[^'\\]|\\.)*)'$/))) { if (!f.name.includes(m[1])) return false; }
      else if ((m = part.match(/^'([^']+)'\s+in\s+parents$/))) { if (!(f.parents || []).includes(m[1])) return false; }
      else if ((m = part.match(/^mimeType\s*(!?=)\s*'([^']+)'$/))) { if ((f.mimeType === m[2]) !== (m[1] === '=')) return false; }
      else if ((m = part.match(/^trashed\s*=\s*(true|false)$/))) { if (!!f.trashed !== (m[1] === 'true')) return false; }
    }
    return true;
  },
  parseMultipart(text, ctype) {
    const b = /boundary="?([^";]+)"?/i.exec(ctype || ''); if (!b) throw new Error('multipart boundary missing');
    const parts = text.split('--' + b[1]).slice(1, -1).map(p => p.replace(/^\r?\n/, '').replace(/\r?\n$/, ''));
    const split = p => { const i = p.search(/\r?\n\r?\n/); return p.slice(i).replace(/^\r?\n\r?\n/, ''); };
    return { meta: JSON.parse(split(parts[0]) || '{}'), data: new TextEncoder().encode(split(parts[1] || '')) };
  },
  upsert(meta, bytes, id) {
    let f = id ? this.files.get(id) : null;
    if (id && !f) return null;
    if (!f) { f = { id: 'fk' + (this.seq++), name: meta.name || 'Untitled', mimeType: meta.mimeType || 'application/octet-stream', parents: meta.parents || ['root'], appProperties: {}, trashed: false }; this.files.set(f.id, f); }
    for (const k of ['name', 'mimeType', 'trashed']) if (meta[k] !== undefined) f[k] = meta[k];
    if (meta.parents) f.parents = meta.parents;
    if (meta.appProperties) f.appProperties = { ...f.appProperties, ...meta.appProperties };
    if (bytes) f.bytes = bytes;
    f.modifiedTime = meta.modifiedTime || new Date().toISOString();
    return f;
  },
  json(status, o, extra) { return { status, headers: { 'content-type': 'application/json', ...(extra || {}) }, text: JSON.stringify(o) }; },
  async request(fk, a) {
    if (!this.signedIn) throw new Error('Google에 로그인되어 있지 않습니다');
    let u; try { u = new URL(a.url); } catch (e) { throw new Error('허용되지 않는 주소입니다'); }
    if (u.protocol !== 'https:' || !(u.hostname === 'accounts.google.com' || u.hostname.endsWith('.googleapis.com'))) throw new Error('허용되지 않는 주소입니다 (HTTPS *.googleapis.com만 가능)');
    const method = (a.method || 'GET').toUpperCase(), path = u.pathname, qp = u.searchParams;
    const hdr = {}; for (const k in (a.headers || {})) hdr[k.toLowerCase()] = a.headers[k];
    this.requests.push({ method, url: a.url });
    let m;
    if (path === '/drive/v3/about') return this.json(200, { user: { emailAddress: this.email, displayName: 'Tester' } });
    if (path === '/oauth2/v3/userinfo') return this.json(200, { email: this.email });
    if (path === '/drive/v3/files' && method === 'GET') {
      const all = [...this.files.values()].filter(f => this.matches(f, qp.get('q')));
      const ps = parseInt(qp.get('pageSize') || '100', 10), off = parseInt(qp.get('pageToken') || '0', 10);
      const page = all.slice(off, off + ps); const o = { kind: 'drive#fileList', files: page.map(f => this.meta(f)) };
      if (off + ps < all.length) o.nextPageToken = String(off + ps);
      return this.json(200, o);
    }
    if (path === '/drive/v3/files' && method === 'POST') { const f = this.upsert(JSON.parse(a.body || '{}'), null); return this.json(200, this.meta(f)); }
    if (path === '/upload/drive/v3/files' && method === 'POST') return this.upload(a, qp, null, method, hdr);
    if ((m = path.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/))) return this.upload(a, qp, m[1], method, hdr);
    if (path === '/upload/session' && method === 'PUT') { const s = this.sessions.get(qp.get('id')); if (!s) return this.json(404, { error: { code: 404 } }); const f = this.upsert(s.meta, this.bytesOf(fk, a), s.fileId); return this.json(200, this.meta(f)); }
    if ((m = path.match(/^\/drive\/v3\/files\/([^/]+)$/))) {
      const f = this.files.get(decodeURIComponent(m[1]));
      if (!f) return this.json(404, { error: { code: 404, message: 'File not found: ' + m[1] } });
      if (method === 'GET') {
        if (qp.get('alt') === 'media') {
          if (a.savePath) { fk.put(a.savePath, f.bytes || new Uint8Array(0)); return { status: 200, headers: {}, savedPath: a.savePath }; }
          return { status: 200, headers: { 'content-type': f.mimeType }, text: new TextDecoder().decode(f.bytes || new Uint8Array(0)) };
        }
        return this.json(200, this.meta(f));
      }
      if (method === 'PATCH') {
        const meta = JSON.parse(a.body || '{}'); const add = qp.get('addParents'), rem = qp.get('removeParents');
        if (add || rem) { meta.parents = (f.parents || []).filter(p => p !== rem).concat(add ? [add] : []); }
        return this.json(200, this.meta(this.upsert(meta, null, f.id)));
      }
      if (method === 'DELETE') { this.files.delete(f.id); return { status: 204, headers: {}, text: '' }; }
    }
    return this.json(404, { error: { code: 404, message: 'fake drive: unsupported ' + method + ' ' + path } });
  },
  upload(a, qp, id, method, hdr) {
    const type = qp.get('uploadType'); const fk = fake;
    if (type === 'media') { const f = this.upsert({ name: 'Untitled' }, this.bytesOf(fk, a), id); if (!f) return this.json(404, { error: { code: 404 } }); return this.json(200, this.meta(f)); }
    if (type === 'multipart') {
      const { meta, data } = a.uploadPath ? (() => { throw new Error('multipart with uploadPath is not supported; use resumable'); })() : this.parseMultipart(a.body || new TextDecoder().decode(this.bytesOf(fk, a)), hdr['content-type']);
      const f = this.upsert(meta, data, id); if (!f) return this.json(404, { error: { code: 404 } }); return this.json(200, this.meta(f));
    }
    if (type === 'resumable') {
      const sid = String(this.seq++); this.sessions.set(sid, { meta: JSON.parse(a.body || '{}'), fileId: id });
      return { status: 200, headers: { location: 'https://www.googleapis.com/upload/session?id=' + sid }, text: '' };
    }
    return this.json(400, { error: { code: 400, message: 'bad uploadType' } });
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
  /** dev/test only: fake Google account + in-memory Drive (see fakeGoogle) */
  _fakeGoogle: fakeGoogle,

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
  google: {
    status: () => host.call('google.status'),
    config: (clientId, clientSecret) => host.call('google.config', { clientId, clientSecret }),
    signIn: () => host.call('google.signIn'),
    signOut: () => host.call('google.signOut'),
    /** {method,url,headers,body,bodyBase64,uploadPath,savePath} -> {status,headers,text|savedPath}; see the protocol header. */
    request: o => host.call('google.request', o),
    /** convenience: JSON request, parsed result; throws {status,message} on non-2xx */
    async json(method, url, body, headers) {
      const r = await host.call('google.request', { method, url, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json; charset=UTF-8' } : {}), ...(headers || {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      let j = null; try { j = r.text ? JSON.parse(r.text) : null; } catch (e) { /* not json */ }
      if (r.status < 200 || r.status >= 300) { const e = new Error((j && j.error && (j.error.message || j.error)) || ('HTTP ' + r.status)); e.status = r.status; throw e; }
      return j;
    },
  },
  baseName, dirName,
};
