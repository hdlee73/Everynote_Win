// Same-network device sync (user triggered). The phone runs a tiny HTTP server while its "다른 기기와 동기화" card is open;
// this side is the client. Documents are matched by the SHA-256 of the PDF bytes. Pure logic: all I/O comes through `env`.
//   env.http({url, method, headers, text, readPath, savePath}) -> {status, text}
//   env.assetPath(name) -> path ; env.hasAsset(name) -> bool
const LISTS = ['elements', 'studyEntries', 'marks', 'outlines', 'strokes', 'translations'];
export const ASSET_NAME = /^[a-f0-9-]{36}\.(png|m4a|mp4)$/;

export async function sha256Hex(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let s = ''; for (const b of d) s += b.toString(16).padStart(2, '0'); return s;
}

/** Key independent of key order and of float formatting noise (numbers rounded to 1e-4). */
function canon(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : Math.round(v * 1e4) / 1e4;
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v).sort()) o[k] = canon(v[k]); return o; }
  return v;
}
const key = v => JSON.stringify(canon(v));

/** Union of two sidecar/export JSON texts (items equal after canonicalisation appear once; marks are matched by id).
 *  Deletions are not propagated. Returns JSON text (format header of `local`). */
export function mergeSidecars(localText, remoteText) {
  const a = JSON.parse(localText), b = JSON.parse(remoteText);
  const out = { ...a };
  for (const name of LISTS) {
    const seen = new Set(), ids = new Set(), list = [];
    for (const item of [...(a[name] || []), ...(b[name] || [])]) {
      if (name === 'marks' && item && item.id) { if (ids.has(item.id)) continue; ids.add(item.id); }
      const k = key(item); if (seen.has(k)) continue; seen.add(k); list.push(item);
    }
    out[name] = list;
  }
  out.bookmarks = [...new Set([...(a.bookmarks || []), ...(b.bookmarks || [])])].sort((x, y) => x - y);
  return JSON.stringify(out, null, 2);
}

/** Asset file names referenced by sidecar JSON text (images, video thumbs, recordings, mp4 files). */
export function referencedAssets(text) {
  const s = new Set(), root = JSON.parse(text);
  for (const e of root.elements || []) {
    if (e && typeof e.asset === 'string' && ASSET_NAME.test(e.asset)) s.add(e.asset);
    if (e && e.kind === 'video' && typeof e.text === 'string' && ASSET_NAME.test(e.text)) s.add(e.text);
  }
  return s;
}

export class SyncError extends Error {}

export function parseAddress(text) {
  const m = /^\s*(?:http:\/\/)?(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{2,5}))?\s*$/.exec(text || '');
  if (!m || m[1].split('.').some(n => +n > 255)) return null;
  return { host: m[1], port: m[2] ? +m[2] : null };
}

export class SyncClient {
  constructor(env, address, code) {
    const a = parseAddress(address);
    if (!a || !a.port) throw new SyncError('주소는 192.168.0.12:43125 처럼 입력하세요');
    this.env = env; this.base = `http://${a.host}:${a.port}`; this.code = String(code || '').trim();
  }
  async req(path, opt = {}) {
    const r = await this.env.http({ url: this.base + path, headers: { 'X-Code': this.code }, ...opt });
    if (r.status === 403) throw new SyncError('코드가 맞지 않습니다');
    if (r.status === 429) throw new SyncError('코드를 너무 여러 번 틀렸습니다. 휴대폰에서 창을 다시 여세요');
    return r;
  }
  async docs() {
    const r = await this.req('/v1/docs'); if (r.status !== 200) throw new SyncError('문서 목록을 받지 못했습니다 (' + r.status + ')');
    return JSON.parse(r.text);
  }
  async getDoc(id) { const r = await this.req('/v1/doc/' + id); if (r.status === 404) return null; if (r.status !== 200) throw new SyncError('노트를 받지 못했습니다 (' + r.status + ')'); return r.text; }
  async putDoc(id, text) {
    const r = await this.req('/v1/doc/' + id, { method: 'PUT', text });
    if (r.status === 404) throw new SyncError('상대 기기에서 이 문서가 열려 있지 않습니다');
    if (r.status !== 200) throw new SyncError('노트를 보내지 못했습니다 (' + r.status + ')');
  }
  async remoteHas(name) { return (await this.req('/v1/asset/' + name, { method: 'HEAD' })).status === 200; }
  async download(name) {
    const r = await this.req('/v1/asset/' + name, { savePath: await this.env.assetPath(name) });
    if (r.status === 404) return false; if (r.status !== 200) throw new SyncError('파일을 받지 못했습니다 (' + name + ')'); return true;
  }
  async upload(name) {
    const r = await this.req('/v1/asset/' + name, { method: 'PUT', readPath: await this.env.assetPath(name) });
    if (r.status !== 200) throw new SyncError('파일을 보내지 못했습니다 (' + name + ')');
  }
}

/**
 * mode: 'merge' (union of both), 'push' (this device overwrites the other), 'pull' (the other device overwrites this one).
 * local = {json: text of this device's notes, apply(text): replaces this device's notes}.
 * Returns {mode, sent, received} (counts of files); progress(text) optional.
 */
export async function syncDocument(client, id, local, mode, progress = () => {}) {
  const remoteJson = await client.getDoc(id);
  if (remoteJson == null) throw new SyncError('상대 기기에서 이 문서가 열려 있지 않습니다');
  const localJson = local.json;
  const next = mode === 'push' ? localJson : mode === 'pull' ? remoteJson : mergeSidecars(localJson, remoteJson);
  let sent = 0, received = 0;
  if (mode !== 'push') {
    const need = [...referencedAssets(remoteJson)];
    for (let i = 0; i < need.length; i++) {
      if (await client.env.hasAsset(need[i])) continue;
      progress(`받는 중 ${i + 1}/${need.length}`);
      if (await client.download(need[i])) received++;
    }
    await local.apply(next);
  }
  if (mode !== 'pull') {
    const mine = [...referencedAssets(next)];
    for (let i = 0; i < mine.length; i++) {
      if (!(await client.env.hasAsset(mine[i])) || await client.remoteHas(mine[i])) continue;
      progress(`보내는 중 ${i + 1}/${mine.length}`);
      await client.upload(mine[i]); sent++;
    }
    progress('노트 보내는 중');
    await client.putDoc(id, next);
  }
  return { mode, sent, received };
}
