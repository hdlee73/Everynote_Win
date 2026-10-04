// Printing (Everynote v3): dialog (current page / all / range, with or without annotations), renders the pages one after another at ~150 dpi
// (PdfDoc.renderPage + AnnotationPainter), builds a print-only DOM (.m2-print-root, shown by @media print in css/main2.css) and calls
// window.print() (WebView2 shows the system print dialog, "Microsoft Print to PDF" works as well). Cleans everything up afterwards.
import { h, RectF } from './util.js';
import { AlertDialog } from './ui/alert.js';
import { toast } from './ui/toast.js';
import { AnnotationPainter } from './painter.js';

export const PRINT_DPI = 150;
const MAX_SIDE = 3400;            // px of the longest side (A3 at 150 dpi is 2480)
let active = null;                // {root, urls, cleanup}

function stripPdf(name) { return String(name || 'document').replace(/\.pdf$/i, ''); }

export function cleanupPrint() { if (active) { const a = active; active = null; a.cleanup(); } }

async function toBlobUrl(canvas) {
  const blob = await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('이미지를 만들지 못했습니다')), 'image/jpeg', 0.92));
  return URL.createObjectURL(blob);
}

/** Renders `pages` (0-based indexes) into <img> blobs, one at a time so memory stays flat. Returns [{url, landscape}]. */
export async function renderPrintPages(app, pages, withAnnotations, onProgress, isCancelled) {
  const out = [];
  const store = app.store, doc = app.renderer;
  const prevDark = AnnotationPainter.dark; AnnotationPainter.dark = false;
  try {
    for (let n = 0; n < pages.length; n++) {
      if (isCancelled && isCancelled()) { for (const o of out) URL.revokeObjectURL(o.url); return null; }
      const i = pages[n];
      if (onProgress) onProgress(n, pages.length, i);
      const size = await doc.pageSize(i);
      const ratio = Math.min(PRINT_DPI / 72, MAX_SIDE / Math.max(size.w, size.h));
      const canvas = await doc.renderPage(i, ratio);
      if (withAnnotations && store) {
        try { await AnnotationPainter.preload(store, i); } catch (e) { /* missing image: skipped like in export */ }
        AnnotationPainter.all(canvas.getContext('2d'), new RectF(0, 0, canvas.width, canvas.height), store, i);
      }
      const url = await toBlobUrl(canvas);
      out.push({ url, landscape: canvas.width > canvas.height });
      canvas.width = canvas.height = 0;          // free the pixels right away
      await new Promise(r => setTimeout(r, 0)); // let the UI breathe
    }
  } finally { AnnotationPainter.dark = prevDark; }
  return out;
}

function buildPrintRoot(items) {
  const root = h('div', { class: 'm2-print-root', id: 'm2-print-root' });
  for (const it of items) root.append(h('div', { class: 'm2-print-page ' + (it.landscape ? 'land' : 'port') }, h('img', { src: it.url, alt: '' })));
  return root;
}

async function waitImages(root, ms = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if ([...root.querySelectorAll('img')].every(i => i.complete)) return; await new Promise(r => setTimeout(r, 40)); }
}

/** Shows the options dialog; resolves {pages, annotations} or null. */
function askOptions(app) {
  return new Promise(resolve => {
    const count = app.renderer.pageCount, cur = (app.currentPage | 0) + 1;
    let mode = 0;
    const radios = [];
    const mk = (i, label, extra) => {
      const input = h('input', { type: 'radio', name: 'm2-print-range', checked: i === 0, dataset: { tag: 'print_range:' + i } });
      input.addEventListener('change', () => { mode = i; });
      radios.push(input);
      return h('label', { class: 'm2-pr-row' }, input, h('span', { class: 'm2-pr-label' }, label), extra || null);
    };
    const from = h('input', { class: 'm2-pr-num', type: 'number', min: 1, max: count, value: 1, 'aria-label': '시작 페이지', dataset: { tag: 'print_from' } });
    const to = h('input', { class: 'm2-pr-num', type: 'number', min: 1, max: count, value: count, 'aria-label': '끝 페이지', dataset: { tag: 'print_to' } });
    const range = h('span', { class: 'm2-pr-range' }, from, h('span', null, '~'), to, h('span', null, '쪽'));
    for (const f of [from, to]) f.addEventListener('focus', () => { radios[2].checked = true; mode = 2; });
    const ann = h('input', { type: 'checkbox', checked: true, dataset: { tag: 'print_annotations' } });
    const view = h('div', { class: 'm2-pr', dataset: { tag: 'print_dialog' } },
      mk(0, `현재 페이지 (${cur}쪽)`), mk(1, `전체 (${count}쪽)`), mk(2, '범위', range),
      h('label', { class: 'm2-pr-row ann' }, ann, h('span', { class: 'm2-pr-label' }, '필기·주석 포함')),
      h('div', { class: 'm2-pr-note' }, '다음 화면에서 Windows 인쇄 창이 열립니다. ‘Microsoft Print to PDF’를 고르면 PDF 파일로 저장할 수 있습니다.'));
    let done = false; const finish = v => { if (!done) { done = true; resolve(v); } };
    const b = new AlertDialog.Builder(); b.setTitle('인쇄').setView(view);
    b.setPositiveButton('인쇄', null);
    b.setNegativeButton('취소', () => finish(null)); b.setOnDismissListener(() => finish(null));
    const d = b.show();
    // keep the dialog open when the range is invalid
    const pos = d.getButton(-1); const old = pos.cloneNode(true); pos.replaceWith(old); d.buttons[0] = old;
    old.addEventListener('click', () => {
      let a = 0, z = 0;
      if (mode === 0) a = z = cur; else if (mode === 1) { a = 1; z = count; } else { a = Math.round(+from.value); z = Math.round(+to.value); }
      if (!(a >= 1 && z <= count && a <= z)) { toast(`범위는 1~${count}쪽 안에서 정하세요 (예: 1 ~ ${count})`); return; }
      const pages = []; for (let i = a - 1; i < z; i++) pages.push(i);
      finish({ pages, annotations: ann.checked }); d.dismiss();
    });
  });
}

function progressOverlay(onCancel) {
  const msg = h('div', { class: 'msg' }, '인쇄할 페이지를 준비하는 중…');
  const bar = h('div', { class: 'm2-pp-bar' }, h('i'));
  const cancel = h('button', { class: 'm2-pp-cancel', type: 'button' }, '취소');
  cancel.addEventListener('click', onCancel);
  const root = h('div', { class: 'lib-prog m2-pp', role: 'alertdialog', 'aria-label': '인쇄 준비', dataset: { tag: 'print_progress' } }, h('div', { class: 'card' }, h('div', { class: 'lib-spin' }), msg, bar, cancel));
  document.body.append(root);
  return { set(text, frac) { msg.textContent = text; bar.firstChild.style.width = Math.round(frac * 100) + '%'; }, close() { root.remove(); } };
}

export async function printDocument(app) {
  if (!app.renderer || !app.store) { toast('문서를 먼저 여세요'); return; }
  cleanupPrint();
  try { if (app.commitInlineText) app.commitInlineText(); } catch (e) { /* ignore */ }
  const opt = await askOptions(app);
  if (!opt) return;
  await new Promise(r => setTimeout(r, 200)); // let the dialog fade out before the page is hidden for printing
  let cancelled = false;
  const prog = progressOverlay(() => { cancelled = true; });
  let items;
  try {
    items = await renderPrintPages(app, opt.pages, opt.annotations, (n, total, i) => prog.set(`${n + 1} / ${total}쪽 준비 중 (p.${i + 1})`, n / total), () => cancelled);
  } catch (e) { prog.close(); toast('인쇄 준비에 실패했습니다: ' + ((e && e.message) || e)); return; }
  prog.close();
  if (!items) { toast('인쇄를 취소했습니다'); return; }
  const root = buildPrintRoot(items);
  document.body.append(root);
  const oldTitle = document.title;
  try { document.title = stripPdf(app.documentTitle); } catch (e) { /* ignore */ }
  const urls = items.map(i => i.url);
  let timer = null;
  const cleanup = () => {
    clearTimeout(timer); window.removeEventListener('afterprint', onAfter);
    root.remove(); for (const u of urls) URL.revokeObjectURL(u);
    try { document.title = oldTitle; } catch (e) { /* ignore */ }
  };
  const onAfter = () => cleanupPrint();
  active = { root, urls, cleanup };
  window.addEventListener('afterprint', onAfter);
  timer = setTimeout(cleanupPrint, 15 * 60 * 1000); // afterprint never fired (some hosts): drop the DOM eventually
  await waitImages(root);
  try { window.print(); }
  catch (e) { cleanupPrint(); toast('인쇄를 시작하지 못했습니다: ' + ((e && e.message) || e)); }
}
