// Office / HWP -> PDF conversion (JS side). No host knowledge beyond js/host.js.
//
//   convertHwp(bytes, onStatus, cancelToken?)   -> Promise<Uint8Array>   HWP/HWPX -> PDF with the rhwptopdf WASM engine, in a Web Worker
//   convertOffice(path, kind, onStatus, cancelToken?) -> Promise<{pdf: path}>   doc/docx/ppt/pptx/xls/xlsx via host (Office COM / LibreOffice)
//   officeEngines()                             -> Promise<{word,excel,powerpoint,libreoffice}>
//   makeCancelToken()                           -> {cancelled, cancel(), onCancel(fn)}   (an AbortSignal also works as token)
//   isOfficeDocument(name) / canConvertOffice(name) / isHwp(name)
//
// Errors are Error objects with the Korean strings of the Android app. err.cancelled === true for user cancellation,
// err.noEngine === true when neither Microsoft Office nor LibreOffice is installed (err.guidance has install help).
//
// HWP engine files (produced by CI, NOT committed): web/hwp/rhwptopdf.umd.js + web/hwp/rhwptopdf.umd_bg.wasm.
import { host } from './host.js';

export const HWP_MAX_BYTES = 48 * 1024 * 1024;
export const HWP_TIMEOUT_MS = 180000;
export const OFFICE_TIMEOUT_MS = 600000;
export const OFFICE_INSTALL_GUIDANCE =
  'Microsoft Office(Word·Excel·PowerPoint) 또는 무료 LibreOffice(libreoffice.org)를 설치하면 PDF로 자동 변환할 수 있습니다. ' +
  '설치하지 않았다면 해당 앱에서 PDF로 내보낸 뒤 Everynote에서 가져오세요.';

const FONT_DIR = 'C:\\Windows\\Fonts\\';
const OFFICE_EXT = ['hwp', 'hwpx', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'];
const extOf = name => { const m = /\.([^.\\/]+)$/.exec(String(name || '')); return m ? m[1].toLowerCase() : ''; };
export const isHwp = name => ['hwp', 'hwpx'].includes(extOf(name));
export const isOfficeDocument = name => OFFICE_EXT.includes(extOf(name));
export const canConvertOffice = name => ['doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx'].includes(extOf(name));

// ---------------------------------------------------------------- cancellation
export function makeCancelToken() {
  const fns = [];
  return {
    cancelled: false,
    cancel() { if (this.cancelled) return; this.cancelled = true; fns.splice(0).forEach(f => { try { f(); } catch (e) { /* ignore */ } }); },
    onCancel(fn) { if (this.cancelled) fn(); else fns.push(fn); },
  };
}

function isCancelled(t) { return !!(t && (t.cancelled || t.isCancelled === true || t.aborted)); }

/** Calls fn once when the token gets cancelled; returns a disposer. Understands makeCancelToken(), AbortSignal and plain {cancelled} objects. */
function watchCancel(token, fn) {
  if (!token) return () => {};
  let done = false, timer = 0;
  const fire = () => { if (done) return; done = true; clearInterval(timer); fn(); };
  if (isCancelled(token)) { fire(); return () => {}; }
  if (typeof token.onCancel === 'function') token.onCancel(fire);
  else if (typeof token.addEventListener === 'function') token.addEventListener('abort', fire, { once: true });
  timer = setInterval(() => { if (isCancelled(token)) fire(); }, 250);   // fallback for plain flag objects
  return () => { done = true; clearInterval(timer); };
}

function cancelError() { const e = new Error('변환이 중단되었습니다'); e.cancelled = true; e.name = 'AbortError'; return e; }
const noop = () => {};

// ---------------------------------------------------------------- office (host)
export function officeEngines() {
  return host.call('office.engines').catch(() => ({ word: false, excel: false, powerpoint: false, libreoffice: null }));
}

export async function convertOffice(path, kind, onStatus = noop, cancelToken = null) {
  const id = 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const status = t => { try { onStatus(t); } catch (e) { /* ignore */ } };
  status('문서를 준비하고 있습니다');
  const onProgress = d => { if (d && d.id === id && d.text) status(d.text); };
  host.on('office.progress', onProgress);
  let timer = 0;
  const stop = watchCancel(cancelToken, () => { host.call('office.cancel', { id }).catch(noop); });
  try {
    if (isCancelled(cancelToken)) throw cancelError();
    const watchdog = new Promise((_, rej) => { timer = setTimeout(() => { host.call('office.cancel', { id }).catch(noop); rej(new Error('변환 시간이 초과되었습니다')); }, OFFICE_TIMEOUT_MS + 15000); });
    const r = await Promise.race([host.call('office.convert', { id, path, kind: kind || extOf(path) }), watchdog]);
    if (!r || !r.pdf) throw new Error('PDF 변환 결과가 비어 있습니다');
    return { pdf: r.pdf };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (isCancelled(cancelToken) || /중단되었습니다/.test(err.message)) { const c = cancelError(); throw c; }
    if (/설치되어 있지 않습니다/.test(err.message)) { err.noEngine = true; err.guidance = OFFICE_INSTALL_GUIDANCE; }
    if (!err.message) err.message = '알 수 없는 오류';
    throw err;
  } finally {
    clearTimeout(timer); stop(); host.off('office.progress', onProgress);
  }
}

// ---------------------------------------------------------------- HWP (WASM in a worker)
// Worker driver, appended to the engine glue (UMD attaches `RhwpToPdf` to `self`). The global name is resolved defensively.
function workerDriver() {
  self.onmessage = async ev => {
    const { wasm, fonts, input } = ev.data;
    try {
      const G = self.RhwpToPdf || self.HwpToPdf || self.wasm_bindgen;
      if (!G) throw new Error('변환 엔진을 불러오지 못했습니다');
      const init = typeof G === 'function' ? G : (G.default || G.__wbg_init);
      try { await init({ module_or_path: wasm }); } catch (first) { await init(wasm); }   // newer / older wasm-bindgen signatures
      const fn = n => G[n] || (G.default && G.default[n]) || (self.wasm_bindgen && self.wasm_bindgen[n]);
      const register = fn('registerPdfFont'), toPdf = fn('hwpToPdf');
      if (!register || !toPdf) throw new Error('변환 엔진 형식이 올바르지 않습니다');
      let loaded = 0;
      for (const f of fonts) { try { register(new Uint8Array(f)); loaded++; } catch (e) { /* skip unusable font */ } }
      if (!loaded) throw new Error('기기에서 변환용 글꼴을 읽지 못했습니다');
      self.postMessage({ status: '표·그림과 페이지를 PDF로 변환하는 중' });
      const pdf = toPdf(new Uint8Array(input));
      const out = new Uint8Array(pdf);   // own, transferable copy
      self.postMessage({ done: out }, [out.buffer]);
    } catch (e) {
      self.postMessage({ error: String((e && e.message) || e) });
    }
  };
}
const DRIVER_SRC = '(' + workerDriver.toString() + ')();';

let engineCache = null;
async function loadEngine() {
  if (engineCache) return engineCache;
  const js = new URL('../hwp/rhwptopdf.umd.js', import.meta.url).href;
  const wasm = new URL('../hwp/rhwptopdf.umd_bg.wasm', import.meta.url).href;
  const [a, b] = await Promise.all([fetch(js), fetch(wasm)]).catch(() => { throw new Error('변환 엔진 파일을 찾을 수 없습니다'); });
  if (!a.ok || !b.ok) throw new Error('변환 엔진 파일을 찾을 수 없습니다');
  engineCache = { glue: await a.text(), wasm: await b.arrayBuffer() };
  return engineCache;
}

async function readFont(name) {
  try {
    const url = await host.call('fs.url', { path: FONT_DIR + name });
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.arrayBuffer();
  } catch (e) { return null; }
}

/** Registration order matters (last registered per generic family wins): serif first, Malgun Gothic (sans) last. */
async function loadFonts() {
  const out = [];
  const bat = await readFont('batang.ttc');
  if (bat) out.push(bat);
  const bold = await readFont('malgunbd.ttf');
  const reg = await readFont('malgun.ttf');
  if (!reg || !bat) { const gul = await readFont('gulim.ttc'); if (gul) out.unshift(gul); }
  if (bold) out.push(bold);
  if (reg) out.push(reg);
  return out;
}

export async function convertHwp(bytes, onStatus = noop, cancelToken = null) {
  const status = t => { try { onStatus(t); } catch (e) { /* ignore */ } };
  status('한글 문서를 준비하고 있습니다');
  if (!bytes || !bytes.length) throw new Error('문서를 읽을 수 없습니다');
  if (bytes.length > HWP_MAX_BYTES) throw new Error('48MB 이하의 한글 문서를 선택하세요');
  if (isCancelled(cancelToken)) throw cancelError();

  let worker = null, timer = 0, stop = noop, blobUrl = null;
  const result = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('변환 시간이 초과되었습니다')), HWP_TIMEOUT_MS);
    stop = watchCancel(cancelToken, () => reject(cancelError()));
    (async () => {
      const eng = await loadEngine();
      const fonts = await loadFonts();
      if (!fonts.length) throw new Error('기기에서 변환용 글꼴을 읽지 못했습니다');
      blobUrl = URL.createObjectURL(new Blob([eng.glue, '\n;\n', DRIVER_SRC], { type: 'text/javascript' }));
      worker = new Worker(blobUrl);
      worker.onmessage = e => {
        const m = e.data || {};
        if (m.status) status(m.status);
        else if (m.error !== undefined) reject(new Error(m.error || '알 수 없는 오류'));
        else if (m.done) resolve(m.done);
      };
      worker.onerror = e => { e.preventDefault && e.preventDefault(); reject(new Error('변환 엔진이 종료되었습니다. 더 작은 문서로 시도하세요')); };
      worker.onmessageerror = () => reject(new Error('변환 엔진이 종료되었습니다. 더 작은 문서로 시도하세요'));
      const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);   // copy: keep caller's bytes intact
      worker.postMessage({ wasm: eng.wasm.slice(0), fonts, input }, [...fonts, input]);
    })().catch(reject);
  });
  try {
    const pdf = await result;
    if (pdf.length < 5 || pdf.length > 128 * 1024 * 1024) throw new Error('변환 결과가 너무 크거나 비어 있습니다');
    if (String.fromCharCode(pdf[0], pdf[1], pdf[2], pdf[3], pdf[4]) !== '%PDF-') throw new Error('변환 결과가 PDF가 아닙니다');
    return pdf;
  } finally {
    clearTimeout(timer); stop();
    if (worker) { try { worker.terminate(); } catch (e) { /* ignore */ } }
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  }
}

// ---------------------------------------------------------------- two-page spreads (Android v1.30.0 HwpConversion.looksLikeSpread / splitSpreads)
const PDFLIB_URL = '../vendor/pdflib/pdf-lib.esm.min.js';
const loadPdfLib = () => import(PDFLIB_URL);
const effectiveSize = (page) => {
  const box = page.getCropBox(), rot = ((page.getRotation().angle % 360) + 360) % 360;
  return rot % 180 === 0 ? { w: box.width, h: box.height } : { w: box.height, h: box.width };
};

/** Android v1.30.1 looksLikeSpread: true when the PDF looks like printed two-page spreads - its (up to six first) landscape pages are all very wide
 *  (width >= 1000pt and > 1.25 x height), or at least 70% of the text-bearing landscape pages (width > 1.2 x height) have their text in two halves
 *  (each >= 25% of the characters) with an empty gutter in the middle (<= 1.5% in the 45-55% band). Portrait pages are ignored. Never throws. */
export async function looksLikeSpread(pdfBytes) {
  try {
    const { PDFDocument } = await loadPdfLib();
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    const n = Math.min(6, doc.getPageCount()); if (n === 0) return false;
    let wide = 0, landscape = 0, judged = 0, gutter = 0, pdf = null;
    for (let i = 0; i < n; i++) {
      const { w, h } = effectiveSize(doc.getPage(i));
      if (w <= h * 1.2) continue;
      landscape++; if (w >= 1000 && w > h * 1.25) wide++;
      if (!pdf) { const { PdfDoc } = await import('./pdfdoc.js'); pdf = await PdfDoc.open(pdfBytes.slice()); }
      let c = null; try { c = await pdf.textColumns(i); } catch (e) { c = null; }
      if (!c || c.total < 30) continue;
      judged++;
      if (c.left * 1000 / c.total >= 250 && c.right * 1000 / c.total >= 250 && c.center * 1000 / c.total <= 15) gutter++;
    }
    if (pdf) { try { pdf.doc.destroy(); } catch (e) { /* ignore */ } }
    if (landscape === 0) return false;
    if (wide === landscape) return true;
    return judged > 0 && gutter * 10 >= judged * 7;
  } catch (e) { return false; }
}

/** True when splitSpreads would change anything: the PDF has at least one unrotated landscape page. */
export async function hasLandscapePages(pdfBytes) {
  try {
    const { PDFDocument } = await loadPdfLib();
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    return doc.getPages().some(p => { const b = p.getCropBox(); return p.getRotation().angle % 180 === 0 && b.width > b.height; });
  } catch (e) { return false; }
}

/** Cuts every unrotated landscape page in the middle into a left and a right page (same content stream, two media/crop boxes). Resolves to the new PDF bytes. */
export async function splitSpreads(pdfBytes) {
  const { PDFDocument, PDFPage } = await loadPdfLib();
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false });
  const pages = doc.getPages();
  for (const page of pages) {
    const box = page.getCropBox();
    if (page.getRotation().angle % 180 !== 0 || box.width <= box.height) continue;
    const mid = box.x + box.width / 2, index = doc.getPages().indexOf(page);
    const dup = page.node.clone(doc.context), ref = doc.context.register(dup);
    const right = PDFPage.of(dup, ref, doc);
    page.setMediaBox(box.x, box.y, mid - box.x, box.height); page.setCropBox(box.x, box.y, mid - box.x, box.height);
    right.setMediaBox(mid, box.y, box.x + box.width - mid, box.height); right.setCropBox(mid, box.y, box.x + box.width - mid, box.height);
    doc.insertPage(index + 1, right);
  }
  return await doc.save({ useObjectStreams: false });
}
