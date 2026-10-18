// Merge several documents into one, and extract some pages of a document into a new file (library PDFs; annotations travel with the pages).
import { h, baseName } from './util.js';
import { host } from './host.js';
import { AlertDialog, BUTTON_POSITIVE } from './ui/alert.js';
import { toast } from './ui/toast.js';
import { inputField, rebindButton, ProgressDialog } from './library-dialog.js';

const stripPdf = n => String(n).replace(/\.pdf$/i, '');

/** "1-3, 5, 8-" -> [0,1,2,4,7,...] (0-based, in the order typed, duplicates dropped). Throws Error with a Korean message. */
export function parsePageRanges(text, total) {
  const out = [], seen = new Set();
  const parts = String(text).split(/[,\s]+/).filter(Boolean);
  if (!parts.length) throw new Error('발췌할 페이지를 입력하세요 (예: 1-3, 5)');
  for (const part of parts) {
    const m = /^(\d*)\s*[-~]\s*(\d*)$/.exec(part) || /^(\d+)$/.exec(part);
    if (!m) throw new Error(`‘${part}’은(는) 올바른 페이지 표기가 아닙니다`);
    let a, b;
    if (m.length === 2) a = b = +m[1];
    else { a = m[1] === '' ? 1 : +m[1]; b = m[2] === '' ? total : +m[2]; }
    if (a < 1 || b < 1 || a > total || b > total) throw new Error(`페이지는 1~${total} 사이여야 합니다`);
    const step = a <= b ? 1 : -1;
    for (let p = a; step > 0 ? p <= b : p >= b; p += step) if (!seen.has(p)) { seen.add(p); out.push(p - 1); }
  }
  return out;
}

export async function pageCountOf(file) {
  const { PDFDocument } = await import('../vendor/pdflib/pdf-lib.esm.min.js');
  try { return (await PDFDocument.load(await host.readBytes(file), { updateMetadata: false })).getPageCount(); }
  catch (e) { throw new Error('PDF를 읽을 수 없습니다 (암호가 걸린 문서일 수 있습니다)'); }
}

async function run(repo, parts, title, destination, done, verb) {
  const progress = ProgressDialog.show('', verb + ' 만드는 중…');
  try {
    const r = await repo.composeDocument(parts, title, destination);
    progress.dismiss();
    toast(`새 문서 ‘${stripPdf(baseName(r.file))}’ (${r.pages}쪽)를 만들었습니다` + (r.annotations ? '' : ' · 필기는 옮기지 못했습니다'), 3500);
    if (done) done(r.file);
  } catch (e) { progress.dismiss(); toast((e && e.message) || '문서를 만들지 못했습니다', 3500); }
}

/** files: library PDFs in the order shown (the order can be changed in the dialog). */
export function mergeDialog(repo, files, destination, done) {
  if (files.length < 2) { toast('합칠 문서를 두 개 이상 선택하세요'); return; }
  const order = [...files];
  const list = h('div', { class: 'pt-list', dataset: { tag: 'merge_list' } });
  const name = inputField({ hint: '새 문서 이름', text: stripPdf(baseName(order[0])) + ' 합본', label: '새 문서 이름' });
  const redraw = () => {
    list.textContent = '';
    order.forEach((f, i) => {
      const btn = (t, label, fn, off) => { const b = h('button', { class: 'pt-btn', type: 'button', 'aria-label': label, title: label }, t); if (off) b.disabled = true; else b.addEventListener('click', fn); return b; };
      list.append(h('div', { class: 'pt-row' }, h('span', { class: 'pt-no' }, String(i + 1)), h('span', { class: 'pt-name' }, stripPdf(baseName(f))),
        btn('▲', '위로', () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; redraw(); }, i === 0),
        btn('▼', '아래로', () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; redraw(); }, i === order.length - 1)));
    });
  };
  redraw();
  const panel = h('div', { class: 'pt-panel' }, h('div', { class: 'pt-hint' }, '아래 순서대로 이어 붙입니다. 원본 문서는 그대로 남고 필기도 함께 옮겨집니다.'), list, name.view);
  const dialog = new AlertDialog.Builder().setTitle('문서 합치기').setView(panel).setPositiveButton('합치기').setNegativeButton('취소').create();
  dialog.show();
  const go = async () => {
    const title = name.input.value.trim();
    if (!title) { name.setError('이름을 입력하세요'); return; }
    try { const { NotebookFiles } = await import('./library.js'); NotebookFiles.name(title); } catch (e) { name.setError(e.message); return; }
    dialog.dismiss();
    const parts = [];
    try { for (const f of order) parts.push({ file: f, pages: Array.from({ length: await pageCountOf(f) }, (_, k) => k) }); }
    catch (e) { toast(e.message, 3500); return; }
    run(repo, parts, title, destination, done, '합본을');
  };
  rebindButton(dialog, BUTTON_POSITIVE, go);
  name.input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
}

/** Asks for page numbers and saves them as a new library document. defaultPages: text such as "3" or "2-4". */
export async function extractDialog(repo, file, destination, done, defaultPages = '') {
  let total;
  try { total = await pageCountOf(file); } catch (e) { toast(e.message, 3500); return; }
  const range = inputField({ hint: '예: 1-3, 5, 8-', text: defaultPages, label: `발췌할 페이지 (전체 ${total}쪽)` });
  const name = inputField({ hint: '새 문서 이름', text: stripPdf(baseName(file)) + ' 발췌', label: '새 문서 이름' });
  const panel = h('div', { class: 'pt-panel' }, h('div', { class: 'pt-hint' }, '선택한 페이지만 모아 새 문서로 저장합니다. 원본은 그대로 남고 필기도 함께 옮겨집니다.'), range.view, name.view);
  const dialog = new AlertDialog.Builder().setTitle('페이지 발췌').setView(panel).setPositiveButton('만들기').setNegativeButton('취소').create();
  dialog.show();
  const go = async () => {
    let pages;
    try { pages = parsePageRanges(range.input.value, total); } catch (e) { range.setError(e.message); return; }
    const title = name.input.value.trim();
    if (!title) { name.setError('이름을 입력하세요'); return; }
    try { const { NotebookFiles } = await import('./library.js'); NotebookFiles.name(title); } catch (e) { name.setError(e.message); return; }
    dialog.dismiss();
    run(repo, [{ file, pages }], title, destination, done, '발췌본을');
  };
  rebindButton(dialog, BUTTON_POSITIVE, go);
  for (const f of [range, name]) f.input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  setTimeout(() => { range.input.focus(); range.input.select(); }, 60);
}
