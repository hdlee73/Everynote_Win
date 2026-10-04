// Google Drive sync (Everynote v3). Pure logic, no UI: see sync-ui.js for the dialog and docs/api-sync.md for the layout on Drive.
//
// Talks to Drive v3 REST through the host (`google.request` adds the OAuth bearer token, refreshes it, streams big files to/from disk).
//   Drive: My Drive / "Everynote Sync" / <library tree: every PDF at its relative path>
//                                       / <name>.pdf.pdfnote.json   annotations in the Android "PDF Note annotations v2" export format
//                                       / assets/<uuid>.png|m4a|mp4   (flat, same names as <data>\assets)
//                                       / manifest.json               {key: {modifiedTime, sha1, size}} written after every run
// Three-way merge: <data>\sync\state-<account>.json remembers, per key, what this device last saw (local sha1 + remote version).
//   only local changed -> upload; only remote changed -> download; both -> last writer wins by modified time and the loser is kept as a
//   conflict copy. Deleted on one side -> proposed as a deletion on the other side; only done when `confirmDeletions` approves (trash, never erase).
import { host } from './host.js';
import { AnnotationStore } from './store.js';
import { baseName, dirName } from './util.js';

const API = 'https://www.googleapis.com/drive/v3', UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FIELDS = 'id,name,mimeType,modifiedTime,size,appProperties';
export const SYNC_FOLDER = 'Everynote Sync';
export const SIDECAR_SUFFIX = '.pdfnote.json';
export const ASSETS_FOLDER = 'assets';
export const MESSAGES = {
  offline: '인터넷에 연결할 수 없어 동기화하지 못했습니다. 네트워크(회사·학교 방화벽/프록시 포함)를 확인한 뒤 다시 시도하세요. 오프라인에서도 PDF 열기·필기·검색 등은 그대로 사용할 수 있습니다.',
  auth: 'Google 로그인이 필요하거나 만료되었습니다. 동기화 설정에서 다시 로그인하세요.',
  config: 'Google OAuth 클라이언트 ID/비밀번호가 설정되지 않았습니다. 동기화 설정에서 입력하세요.',
  cancelled: '동기화를 취소했습니다.',
  quota: 'Google 드라이브 저장 공간이 부족합니다.',
};
const MULTIPART_LIMIT = 4 * 1024 * 1024, HASH_LIMIT = 256 * 1024 * 1024;

export class SyncError extends Error {
  constructor(message, code = 'error', status = 0) { super(message); this.name = 'SyncError'; this.code = code; this.status = status; }
}

// ---------------------------------------------------------------- helpers
const enc = encodeURIComponent;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
export async function sha1Bytes(bytes) { return hex(await crypto.subtle.digest('SHA-1', bytes)); }
export const sha1Text = s => sha1Bytes(new TextEncoder().encode(s));
function b64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return btoa(bin);
}
const qEsc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const MIME = { pdf: 'application/pdf', json: 'application/json', png: 'image/png', m4a: 'audio/mp4', mp4: 'video/mp4' };
const mimeOf = name => MIME[(name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';
const stamp = (d = new Date()) => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; };
const safeSeg = s => String(s).replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || '_';
const isPdfName = n => n.toLowerCase().endsWith('.pdf');
const conflictName = (name, ts) => name.replace(/(\.[^.]*)?$/, m => ` (충돌 사본 ${ts})` + (m || ''));

/** Same label the UI shows for each op kind. */
export const KIND_LABEL = { pdf: 'PDF', ann: '필기', asset: '자료' };

export class DriveSync {
  /**
   * @param {object} o
   *  library  LibraryRepository (root, trash())          account  e-mail (state is kept per Google account)
   *  options  {pdfs, annotations, assets} booleans (default all true)
   *  log(text)  onProgress({phase,text,done,total})  confirmDeletions(list)->Promise<string[]|null>  (list items: {key,kind,side:'local'|'remote',name})
   *  retryDelay  base back-off in ms (tests)
   */
  constructor(o = {}) {
    this.library = o.library; this.account = o.account || '';
    this.options = Object.assign({ pdfs: true, annotations: true, assets: true }, o.options || {});
    this.logFn = o.log || (() => {}); this.progressFn = o.onProgress || (() => {}); this.confirmDeletions = o.confirmDeletions || null;
    this.retryDelay = o.retryDelay == null ? 700 : o.retryDelay;
    this.cancelled = false; this.running = false; this.changedLocal = new Set();
  }
  cancel() { this.cancelled = true; }
  log(t) { try { this.logFn(String(t)); } catch (e) { /* ignore */ } }
  progress(phase, text, done = 0, total = 0) { try { this.progressFn({ phase, text, done, total }); } catch (e) { /* ignore */ } }
  _check() { if (this.cancelled) throw new SyncError(MESSAGES.cancelled, 'cancelled'); }

  // ---------------------------------------------------------------- Drive REST
  _mapError(e) {
    if (e instanceof SyncError) return e;
    const m = String((e && e.message) || e || '');
    if (/401|invalid_grant|unauthor|로그인|토큰|sign.?in required|not signed/i.test(m)) return new SyncError(MESSAGES.auth, 'auth', 401);
    if ((typeof navigator !== 'undefined' && navigator.onLine === false) || /network|failed to fetch|네트워크|인터넷|연결|enotfound|econn|etimedout|timed? ?out|name.?not.?resolved|socket|proxy|offline|no such host|host.?unreach|dns|ERR_/i.test(m))
      return new SyncError(MESSAGES.offline, 'offline');
    return new SyncError('Google 요청에 실패했습니다: ' + m, 'http');
  }
  async _req(o, tries = 4) {
    let last;
    for (let a = 0; a < tries; a++) {
      this._check();
      let res;
      try { res = await host.call('google.request', o); } catch (e) { throw this._mapError(e); }
      const st = res && res.status != null ? res.status : 0;
      if (st === 0) throw new SyncError(MESSAGES.offline, 'offline');
      if (st < 400) return res;
      const text = String(res.text || '');
      if (st === 401) throw new SyncError(MESSAGES.auth, 'auth', st);
      if (st === 403 && /storageQuotaExceeded/.test(text)) throw new SyncError(MESSAGES.quota, 'quota', st);
      const retry = st === 429 || st >= 500 || (st === 403 && /rateLimit|userRateLimit|backendError/i.test(text));
      let msg = text; try { msg = JSON.parse(text).error.message || text; } catch (e) { /* plain */ }
      last = new SyncError(`Google 드라이브 오류 (${st}): ${String(msg).slice(0, 160)}`, 'http', st);
      if (!retry || a === tries - 1) throw last;
      this.log(`일시적 오류 ${st}, 다시 시도합니다 (${a + 1}/${tries - 1})`);
      await sleep(this.retryDelay * Math.pow(2, a));
    }
    throw last;
  }
  async _json(o) { const r = await this._req(o); try { return JSON.parse(r.text || '{}'); } catch (e) { throw new SyncError('Google 응답을 해석하지 못했습니다', 'http'); } }
  _hdr(res, name) { const h = (res && res.headers) || {}; const k = Object.keys(h).find(x => x.toLowerCase() === name.toLowerCase()); const v = k ? h[k] : null; return Array.isArray(v) ? v[0] : v; }

  async _listChildren(parentId) {
    const out = []; let tok = '';
    do {
      const url = `${API}/files?q=${enc(`'${qEsc(parentId)}' in parents and trashed=false`)}&fields=${enc('nextPageToken,files(' + FIELDS + ')')}&pageSize=1000&spaces=drive${tok ? '&pageToken=' + enc(tok) : ''}`;
      const j = await this._json({ method: 'GET', url });
      out.push(...(j.files || [])); tok = j.nextPageToken || '';
    } while (tok);
    return out;
  }
  async _createFolder(name, parentId) {
    const j = await this._json({ method: 'POST', url: `${API}/files?fields=id`, headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined }) });
    return j.id;
  }
  async _ensureRoot() {
    if (this.state.folderId) {
      try {
        const j = await this._json({ method: 'GET', url: `${API}/files/${enc(this.state.folderId)}?fields=id,trashed` });
        if (j.id && !j.trashed) return this.state.folderId;
      } catch (e) { if (!(e instanceof SyncError) || e.code !== 'http') throw e; }
    }
    const q = `name='${qEsc(SYNC_FOLDER)}' and 'root' in parents and mimeType='${FOLDER_MIME}' and trashed=false`;
    const j = await this._json({ method: 'GET', url: `${API}/files?q=${enc(q)}&fields=${enc('files(id,name)')}&pageSize=10` });
    let id = j.files && j.files[0] && j.files[0].id;
    if (!id) { id = await this._createFolder(SYNC_FOLDER, null); this.log(`드라이브에 '${SYNC_FOLDER}' 폴더를 만들었습니다`); }
    this.state.folderId = id; return id;
  }
  /** relDir '' | 'a/b' -> folder id (creates missing folders) */
  async _ensureFolder(relDir) {
    if (!relDir) return this.rootId;
    const hit = this.folders.get(relDir); if (hit) return hit;
    const parent = await this._ensureFolder(relDir.includes('/') ? relDir.slice(0, relDir.lastIndexOf('/')) : '');
    const id = await this._createFolder(relDir.split('/').pop(), parent);
    this.folders.set(relDir, id); return id;
  }

  /** Multipart (small) or resumable (big, streamed from disk by the host) upload. Returns the Drive file resource. */
  async _upload({ id, name, parentId, mime, modifiedTime, appProperties, bytes, text, path, size }) {
    const meta = { name, mimeType: mime, modifiedTime: new Date(modifiedTime).toISOString(), appProperties };
    if (!id) meta.parents = [parentId];
    const base = `${UPLOAD}/files${id ? '/' + enc(id) : ''}`, method = id ? 'PATCH' : 'POST';
    if (path && size > MULTIPART_LIMIT) {
      const init = await this._req({ method, url: `${base}?uploadType=resumable&fields=${enc(FIELDS)}`, headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size) }, body: JSON.stringify(meta) });
      const loc = this._hdr(init, 'location'); if (!loc) throw new SyncError('Google 업로드 세션을 만들지 못했습니다', 'http');
      let last;
      for (let a = 0; a < 3; a++) { // no partial-resume over the host protocol: a failed session is simply restarted from the beginning
        try { const r = await this._req({ method: 'PUT', url: loc, headers: { 'Content-Type': mime }, uploadPath: path }, 1); return JSON.parse(r.text || '{}'); }
        catch (e) { last = e; if (!(e instanceof SyncError) || e.code === 'auth' || e.code === 'cancelled' || e.code === 'quota' || a === 2) throw e; await sleep(this.retryDelay * (a + 1)); }
      }
      throw last;
    }
    if (path && !bytes) bytes = await host.readBytes(path);
    const boundary = 'everynote' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`, tail = `\r\n--${boundary}--`;
    const o = { method, url: `${base}?uploadType=multipart&fields=${enc(FIELDS)}`, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` } };
    if (text != null) o.body = head + text + tail;
    else o.bodyBase64 = b64(new Uint8Array(await new Blob([head, bytes, tail]).arrayBuffer()));
    const r = await this._req(o); return JSON.parse(r.text || '{}');
  }
  async _tmpPath() {
    const info = await host.info(); const dir = info.data.replace(/[\\/]+$/, '') + '\\tmp'; await host.mkdir(dir);
    return `${dir}\\sync-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}.part`;
  }
  async _downloadTo(id, dest) {
    const tmp = await this._tmpPath();
    try {
      const r = await this._req({ method: 'GET', url: `${API}/files/${enc(id)}?alt=media`, savePath: tmp });
      const saved = r.savedPath || tmp;
      await host.mkdir(dirName(dest));
      try { if (await host.exists(dest)) await host.delete(dest); } catch (e) { /* move below reports */ }
      await host.move(saved, dest);
    } catch (e) { try { await host.delete(tmp); } catch (x) { /* ignore */ } throw e; }
  }
  async _downloadText(id) { const r = await this._req({ method: 'GET', url: `${API}/files/${enc(id)}?alt=media` }); return String(r.text || ''); }

  // ---------------------------------------------------------------- state (per Google account)
  async _statePath() { const info = await host.info(); return `${info.data.replace(/[\\/]+$/, '')}\\sync\\state-${(await sha1Text(this.account.toLowerCase())).slice(0, 16)}.json`; }
  async _loadState() {
    this.statePath = await this._statePath();
    try { const s = JSON.parse(await host.readText(this.statePath)); if (s && s.base) { this.state = s; return; } } catch (e) { /* first run */ }
    this.state = { version: 1, folderId: null, base: {} };
  }
  async _saveState() { try { await host.mkdir(dirName(this.statePath)); await host.writeText(this.statePath, JSON.stringify(this.state)); } catch (e) { this.log('상태 저장 실패: ' + e.message); } }

  // ---------------------------------------------------------------- scan
  _rel(path) { return path.slice(this.root.length + 1).replace(/\\/g, '/'); }
  _local(rel) { return this.root + '\\' + rel.replace(/\//g, '\\'); }
  async _scanLocal() {
    const out = new Map(); const base = this.state.base;
    const walk = async dir => {
      let list = []; try { list = await host.list(dir); } catch (e) { return; }
      for (const f of list) {
        this._check();
        if (f.name.startsWith('.')) continue;
        const path = dir + '\\' + f.name, rel = this._rel(path);
        if (f.isDir) { if (dir === this.root && f.name.toLowerCase() === ASSETS_FOLDER) { this.log(`'${ASSETS_FOLDER}' 폴더는 동기화 예약 이름이라 건너뜁니다`); continue; } await walk(path); continue; }
        if (!isPdfName(f.name)) continue;
        out.set(rel, { kind: 'pdf', key: rel, rel, path, size: f.size || 0, mtime: f.mtime || 0 });
      }
    };
    if (this.options.pdfs || this.options.annotations) await walk(this.root);
    // sha1 of the PDFs (cached while size+mtime are unchanged)
    if (this.options.pdfs) {
      let n = 0;
      for (const it of out.values()) {
        this._check(); this.progress('scan', `파일 확인 중… ${++n}/${out.size}`, n, out.size);
        const b = base[it.key];
        if (b && b.size === it.size && b.lmtime === it.mtime && b.sha1) it.sha1 = b.sha1;
        else if (it.size > HASH_LIMIT) it.sha1 = `big:${it.size}:${it.mtime}`;
        else { try { it.sha1 = await sha1Bytes(await host.readBytes(it.path)); } catch (e) { it.sha1 = null; this.log(`읽을 수 없음: ${it.rel}`); } }
      }
      for (const [k, it] of [...out]) if (!it.sha1) out.delete(k);
    }
    if (this.options.annotations) {
      const pdfs = [...out.values()].filter(x => x.kind === 'pdf'); this.pdfPaths = new Map(pdfs.map(p => [p.rel, p]));
      if (!this.options.pdfs) for (const p of pdfs) out.delete(p.key);
      let n = 0;
      for (const p of pdfs) {
        this._check(); this.progress('scan', `필기 확인 중… ${++n}/${pdfs.length}`, n, pdfs.length);
        let mod = 0; try { mod = await AnnotationStore.modified(p.path); } catch (e) { mod = 0; }
        if (!mod) continue;
        try {
          const store = await AnnotationStore.load(p.path);
          const text = store.exportJson(p.rel, baseName(p.path)), key = p.rel + SIDECAR_SUFFIX;
          out.set(key, { kind: 'ann', key, rel: key, path: p.path, size: text.length, mtime: mod, sha1: await sha1Text(text), text });
        } catch (e) { this.log(`필기를 읽지 못해 건너뜀: ${p.rel} (${e.message})`); }
      }
    }
    if (this.options.assets) {
      const dir = (await host.info()).data.replace(/[\\/]+$/, '') + '\\assets'; this.assetDir = dir;
      let list = []; try { list = await host.list(dir); } catch (e) { list = []; }
      for (const f of list) if (!f.isDir && !f.name.startsWith('.') && !/\.(tmp|part)$/i.test(f.name)) { const key = ASSETS_FOLDER + '/' + f.name; out.set(key, { kind: 'asset', key, rel: key, path: dir + '\\' + f.name, size: f.size || 0, mtime: f.mtime || 0, sha1: null }); }
    }
    return out;
  }
  async _scanRemote(rootId) {
    const files = new Map(), folders = new Map(); let manifestFile = null;
    const kindOf = (rel, name) => rel.startsWith(ASSETS_FOLDER + '/') ? 'asset' : isPdfName(name) ? 'pdf' : name.endsWith(SIDECAR_SUFFIX) ? 'ann' : null;
    const walk = async (id, rel) => {
      this._check(); this.progress('scan', `드라이브 확인 중… ${rel || '/'}`);
      for (const f of await this._listChildren(id)) {
        const frel = rel ? rel + '/' + f.name : f.name;
        if (f.mimeType === FOLDER_MIME) { folders.set(frel, f.id); await walk(f.id, frel); continue; }
        if (!rel && f.name === 'manifest.json') { manifestFile = f; continue; }
        const kind = kindOf(frel, f.name); if (!kind) continue;
        const entry = { kind, key: frel, id: f.id, name: f.name, mtime: Date.parse(f.modifiedTime) || 0, size: +f.size || 0, sha1: (f.appProperties && f.appProperties.sha1) || null };
        const dup = files.get(frel); if (dup) { this.log(`드라이브에 같은 이름이 둘 이상 있어 최신 항목을 사용합니다: ${frel}`); if (dup.mtime >= entry.mtime) continue; }
        files.set(frel, entry);
      }
    };
    await walk(rootId, '');
    return { files, folders, manifestFile };
  }

  // ---------------------------------------------------------------- plan
  _plan(local, remote, manifest) {
    const plan = [], kinds = { pdf: this.options.pdfs, ann: this.options.annotations, asset: this.options.assets };
    const keys = new Set([...local.keys(), ...remote.files.keys(), ...Object.keys(this.state.base).filter(k => kinds[k.startsWith(ASSETS_FOLDER + '/') ? 'asset' : isPdfName(k) ? 'pdf' : 'ann'])]);
    for (const key of [...keys].sort()) {
      const L = local.get(key); let R = remote.files.get(key); const B = this.state.base[key];
      const kind = (L || R || {}).kind || (key.startsWith(ASSETS_FOLDER + '/') ? 'asset' : isPdfName(key) ? 'pdf' : 'ann');
      if (!kinds[kind]) continue;
      if (R && !R.sha1 && manifest && manifest[key] && manifest[key].modifiedTime === R.mtime) R.sha1 = manifest[key].sha1 || null;
      const rver = R ? (R.sha1 ? 'h:' + R.sha1 : 'm:' + R.mtime) : null;
      const item = { key, kind, L, R, B, rver };
      if (kind === 'asset') { // immutable, never deleted: copy whichever side is missing
        if (L && !R) plan.push({ ...item, action: 'upload' }); else if (!L && R) plan.push({ ...item, action: 'download' });
        else if (L && R && !B) plan.push({ ...item, action: 'adopt' });
        continue;
      }
      if (L && R) {
        if (R.sha1 && L.sha1 === R.sha1) { plan.push({ ...item, action: 'adopt' }); continue; }
        const lc = !B || B.sha1 !== L.sha1, rc = !B || B.rver !== rver;
        if (lc && rc) plan.push({ ...item, action: 'conflict' });
        else if (lc) plan.push({ ...item, action: 'upload' });
        else if (rc) plan.push({ ...item, action: 'download' });
      } else if (L) plan.push({ ...item, action: B ? 'delLocal' : 'upload' });
      else if (R) plan.push({ ...item, action: B ? 'delRemote' : 'download' });
      else if (B) plan.push({ ...item, action: 'forget' });
    }
    return plan;
  }

  // ---------------------------------------------------------------- operations
  _setBase(key, L, R, extra = {}) {
    this.state.base[key] = { sha1: L ? L.sha1 : null, rver: R ? (R.sha1 ? 'h:' + R.sha1 : 'm:' + R.mtime) : null, id: R ? R.id : null, size: L ? L.size : 0, lmtime: L ? L.mtime : 0, ...extra };
  }
  async _doUpload(it, remote) {
    const L = it.L, rel = it.key, dirRel = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const parentId = await this._ensureFolder(dirRel), name = rel.split('/').pop();
    if (L.kind === 'asset') L.sha1 = L.size > HASH_LIMIT ? `big:${L.size}:${L.mtime}` : await sha1Bytes(await host.readBytes(L.path));
    const props = { sha1: L.sha1 };
    const res = await this._upload({ id: it.R ? it.R.id : null, name, parentId, mime: L.kind === 'ann' ? MIME.json : mimeOf(name), modifiedTime: L.mtime || Date.now(), appProperties: props, text: L.kind === 'ann' ? L.text : null, path: L.kind === 'ann' ? null : L.path, size: L.size });
    const R = { id: res.id, sha1: (res.appProperties && res.appProperties.sha1) || L.sha1, mtime: Date.parse(res.modifiedTime) || L.mtime, size: +res.size || L.size, kind: L.kind, key: it.key };
    remote.files.set(it.key, R); this._setBase(it.key, L, R);
    return R;
  }
  async _doDownload(it, remote) {
    const R = it.R, rel = it.key;
    if (it.kind === 'ann') {
      const pdf = this.pdfPaths && this.pdfPaths.get(rel.slice(0, -SIDECAR_SUFFIX.length));
      if (!pdf) { this.log(`PDF가 없어 필기를 건너뜀: ${rel}`); return false; }
      const text = await this._downloadText(R.id);
      const store = new AnnotationStore(); await store.open(pdf.path);
      try { store.importJson(text, Number.MAX_SAFE_INTEGER); } catch (e) { throw new SyncError(`필기 파일이 올바르지 않습니다 (${rel}): ${e.message}`, 'format'); }
      await store.flush(); this.changedLocal.add(pdf.path);
      const re = await AnnotationStore.load(pdf.path), t2 = re.exportJson(pdf.rel, baseName(pdf.path));
      this._setBase(rel, { sha1: await sha1Text(t2), size: t2.length, mtime: await AnnotationStore.modified(pdf.path) }, R); return true;
    }
    const dest = it.kind === 'asset' ? this.assetDir + '\\' + rel.slice(ASSETS_FOLDER.length + 1) : this._local(rel.split('/').map(safeSeg).join('/'));
    await this._downloadTo(R.id, dest);
    let st = { size: R.size, mtime: Date.now() }; try { st = await host.stat(dest); } catch (e) { /* keep */ }
    const sha1 = it.kind === 'asset' ? R.sha1 : (R.sha1 && !R.sha1.startsWith('big:') ? R.sha1 : (st.size > HASH_LIMIT ? `big:${st.size}:${st.mtime}` : await sha1Bytes(await host.readBytes(dest))));
    this._setBase(rel, { sha1, size: st.size, mtime: st.mtime }, R); if (it.kind === 'pdf') this.changedLocal.add(dest);
    return true;
  }
  async _doConflict(it, remote, sum) {
    const L = it.L, R = it.R, ts = stamp();
    const localWins = (L.mtime || 0) >= (R.mtime || 0);
    this.log(`충돌: ${it.key} — ${localWins ? '이 기기의 변경이 더 최근이라 우선 적용' : 'Drive의 변경이 더 최근이라 우선 적용'}, 반대쪽은 사본으로 보관`);
    const dirRel = it.key.includes('/') ? it.key.slice(0, it.key.lastIndexOf('/')) : '';
    if (localWins) {
      const cname = it.kind === 'ann' ? it.key.slice(0, -SIDECAR_SUFFIX.length).split('/').pop() + `.pdfnote.conflict-${ts}.json` : conflictName(it.key.split('/').pop(), ts);
      await this._req({ method: 'POST', url: `${API}/files/${enc(R.id)}/copy?fields=id`, headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ name: cname, parents: [await this._ensureFolder(dirRel)] }) });
      await this._doUpload(it, remote);
    } else {
      if (it.kind === 'ann') {
        await this._upload({ name: it.key.slice(0, -SIDECAR_SUFFIX.length).split('/').pop() + `.pdfnote.conflict-${ts}.json`, parentId: await this._ensureFolder(dirRel), mime: MIME.json, modifiedTime: L.mtime || Date.now(), appProperties: { sha1: L.sha1 }, text: L.text });
      } else {
        const copy = L.path.replace(/(\.[^.\\]*)?$/, m => ` (충돌 사본 ${ts})` + (m || ''));
        await host.copy(L.path, copy);
        try { await AnnotationStore.cloneAnnotations(L.path, copy); } catch (e) { /* no annotations */ }
        this.changedLocal.add(copy);
      }
      await this._doDownload(it, remote);
    }
    sum.conflicts++;
  }

  async _askDeletions(plan, sum) {
    const dels = plan.filter(p => p.action === 'delLocal' || p.action === 'delRemote');
    if (!dels.length) return { approved: new Set(), restore: new Set() };
    const list = dels.map(p => ({ key: p.key, kind: p.kind, side: p.action === 'delLocal' ? 'local' : 'remote', name: p.key }));
    let ok = null;
    if (this.confirmDeletions) { try { ok = await this.confirmDeletions(list); } catch (e) { ok = null; } }
    const approved = new Set(ok || []), restore = new Set();
    const declined = dels.filter(p => !approved.has(p.key));
    if (Array.isArray(ok)) { // the user looked at the list: "keep" means put the file back on the side that lost it
      for (const p of declined) { restore.add(p.key); p.action = p.action === 'delLocal' ? 'upload' : 'download'; }
      if (declined.length) this.log(`삭제하지 않기로 한 ${declined.length}건은 반대쪽에 다시 복원합니다`);
    } else if (declined.length) { sum.deferred = declined.length; this.log(`삭제 ${declined.length}건은 확인이 필요해 보류합니다 (파일은 그대로 두고, 직접 동기화할 때 다시 묻습니다)`); }
    return { approved, restore };
  }

  // ---------------------------------------------------------------- run
  async run() {
    if (this.running) throw new SyncError('이미 동기화 중입니다', 'busy');
    this.running = true; this.cancelled = false; this.changedLocal = new Set(); this.pdfPaths = null; this.state = null;
    const sum = { uploaded: 0, downloaded: 0, deletedLocal: 0, deletedRemote: 0, conflicts: 0, deferred: 0, same: 0, errors: [], started: Date.now(), finished: 0, cancelled: false };
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new SyncError(MESSAGES.offline, 'offline');
      if (!this.library) throw new SyncError('문서함을 찾을 수 없습니다', 'error');
      this.root = String(this.library.root).replace(/[\\/]+$/, '');
      let st; try { st = await host.call('google.status'); } catch (e) { throw new SyncError('이 환경에서는 Google 드라이브 연동을 사용할 수 없습니다 (' + (e.message || e) + ')', 'config'); }
      if (!st || !st.configured) throw new SyncError(MESSAGES.config, 'config');
      if (!st.signedIn) throw new SyncError(MESSAGES.auth, 'auth');
      if (!this.account) this.account = st.email || '';
      this.progress('start', '동기화를 시작합니다'); this.log('동기화 시작 — ' + (this.account || 'Google 계정'));
      try { await AnnotationStore.flushAll(); } catch (e) { /* best effort */ }
      await this._loadState();
      this.rootId = await this._ensureRoot();
      const remote = await this._scanRemote(this.rootId); this.folders = remote.folders;
      let manifest = null;
      if (remote.manifestFile) { try { manifest = (JSON.parse(await this._downloadText(remote.manifestFile.id)) || {}).files || null; } catch (e) { this.log('manifest.json을 읽지 못했습니다 (무시)'); } }
      const local = await this._scanLocal();
      const plan = this._plan(local, remote, manifest);
      for (const p of plan) if (p.action === 'adopt') { this._setBase(p.key, p.L, p.R); sum.same++; }
      for (const p of plan) if (p.action === 'forget') delete this.state.base[p.key];
      const { approved } = await this._askDeletions(plan, sum);
      const todo = plan.filter(p => ['upload', 'download', 'conflict'].includes(p.action) || ((p.action === 'delLocal' || p.action === 'delRemote') && approved.has(p.key)));
      // PDFs before sidecars (a downloaded PDF must exist before its annotations are imported); deletions last
      const order = { pdf: 0, ann: 1, asset: 2 }, act = { upload: 0, download: 0, conflict: 0, delLocal: 1, delRemote: 1 };
      todo.sort((a, b) => act[a.action] - act[b.action] || order[a.kind] - order[b.kind]);
      this.log(`비교 완료: 올리기/받기/충돌/삭제 ${todo.length}건, 변경 없음 ${sum.same}건`);
      let done = 0;
      for (const p of todo) {
        this._check(); this.progress('sync', `${KIND_LABEL[p.kind]} ${{ upload: '올리는 중', download: '받는 중', conflict: '충돌 처리 중', delLocal: '삭제 반영 중', delRemote: '삭제 반영 중' }[p.action]}: ${p.key}`, done, todo.length);
        try {
          if (p.action === 'upload') { await this._doUpload(p, remote); sum.uploaded++; this.log(`올림: ${p.key}`); }
          else if (p.action === 'download') {
            if (p.kind === 'pdf' && p.R) { /* later annotation lookups need the path */ }
            if (await this._doDownload(p, remote)) { sum.downloaded++; this.log(`받음: ${p.key}`); if (p.kind === 'pdf' && this.pdfPaths) this.pdfPaths.set(p.key, { rel: p.key, path: this._local(p.key.split('/').map(safeSeg).join('/')) }); }
          } else if (p.action === 'conflict') await this._doConflict(p, remote, sum);
          else if (p.action === 'delLocal') {
            if (p.kind === 'pdf') { await this.library.trash(p.L.path); this.changedLocal.add(p.L.path); } else if (p.kind === 'ann') { await AnnotationStore.deleteSidecar(p.L.path); this.changedLocal.add(p.L.path); }
            delete this.state.base[p.key]; sum.deletedLocal++; this.log(`이 기기에서 삭제(휴지통): ${p.key}`);
          } else if (p.action === 'delRemote') {
            await this._req({ method: 'PATCH', url: `${API}/files/${enc(p.R.id)}?fields=id`, headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ trashed: true }) });
            remote.files.delete(p.key); delete this.state.base[p.key]; sum.deletedRemote++; this.log(`드라이브에서 삭제(휴지통): ${p.key}`);
          }
        } catch (e) {
          if (e instanceof SyncError && ['offline', 'auth', 'cancelled', 'quota'].includes(e.code)) throw e;
          sum.errors.push(`${p.key}: ${e.message || e}`); this.log(`오류 — ${p.key}: ${e.message || e}`);
        }
        done++;
        if (done % 10 === 0) await this._saveState();
      }
      this.progress('finish', '정리하는 중…', todo.length, todo.length);
      await this._writeManifest(remote);
    } catch (e) {
      const err = this._mapError(e); sum.cancelled = err.code === 'cancelled'; sum.error = err;
      this.log((sum.cancelled ? '취소됨: ' : '실패: ') + err.message);
      if (this.state) await this._saveState();
      sum.finished = Date.now(); this.running = false; this.progress('error', err.message);
      if (!sum.cancelled) throw Object.assign(err, { summary: sum });
      return sum;
    }
    sum.finished = Date.now(); this.state.lastSync = sum.finished; await this._saveState(); this.running = false;
    this.log(`동기화 끝 — 올림 ${sum.uploaded}, 받음 ${sum.downloaded}, 삭제(이 기기) ${sum.deletedLocal}, 삭제(드라이브) ${sum.deletedRemote}, 충돌 ${sum.conflicts}` + (sum.errors.length ? `, 오류 ${sum.errors.length}` : ''));
    this.progress('done', sum.errors.length ? `완료 (오류 ${sum.errors.length}건)` : '완료', 1, 1);
    return sum;
  }

  async _writeManifest(remote) {
    const files = {};
    for (const [k, R] of remote.files) files[k] = { modifiedTime: R.mtime, sha1: R.sha1 || null, size: R.size || 0 };
    const text = JSON.stringify({ format: 'Everynote sync manifest', version: 1, updated: new Date().toISOString(), files });
    try {
      const prev = remote.manifestFile;
      const res = await this._upload({ id: prev ? prev.id : null, name: 'manifest.json', parentId: this.rootId, mime: MIME.json, modifiedTime: Date.now(), appProperties: { kind: 'manifest' }, text });
      remote.manifestFile = res;
      // the manifest records the modifiedTime Drive stored, which is what the next run compares: re-read nothing, entries already carry Drive's value
    } catch (e) { if (e instanceof SyncError && ['offline', 'auth', 'cancelled'].includes(e.code)) throw e; this.log('manifest.json 저장 실패: ' + e.message); }
  }
}
