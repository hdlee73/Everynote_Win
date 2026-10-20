// 표지 만들기: a cover page (template + accent colour + title) drawn on a canvas and inserted as page 1 of a library document.
// Shown from 페이지 관리 > 표지 만들기; a document that already has a cover (flag "EverynoteCover" in the PDF info) gets it replaced.
import { h } from './util.js';
import { AlertDialog, BUTTON_POSITIVE } from './ui/alert.js';
import { toast } from './ui/toast.js';
import { rebindButton } from './library-dialog.js';

export const COVER_TEMPLATES = ['클래식', '파스텔', '풀컬러', '줄노트', '미니멀', '도트', '다크', '다이어리'];
export const COVER_COLORS = [['블루', '#3478F6'], ['오렌지', '#F2994A'], ['그린', '#2FA866'], ['퍼플', '#8F66F0'], ['로즈', '#E8588A'], ['그레이', '#5F6B7A']];
const FONT = '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR","Segoe UI",sans-serif';

const mix = (hex, t, base = 255) => {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = v => Math.round(v + (base - v) * t);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
};

/** Wraps [text] into at most [maxLines] lines no wider than [width] at the font size set on ctx; shrinks the size while it does not fit. */
function layoutText(ctx, text, width, size, weight, maxLines, minSize) {
  for (let s = size; s >= minSize; s -= 2) {
    ctx.font = `${weight} ${s}px ${FONT}`;
    const lines = []; let line = '';
    for (const para of String(text).split('\n')) {
      line = '';
      for (const ch of para) {
        if (ctx.measureText(line + ch).width > width && line) { lines.push(line); line = ch; } else line += ch;
      }
      lines.push(line);
    }
    if (lines.length <= maxLines) return { size: s, lines };
  }
  ctx.font = `${weight} ${minSize}px ${FONT}`;
  return { size: minSize, lines: [String(text).slice(0, 60)] };
}

function drawLines(ctx, text, x, y, width, size, weight, color, align, maxLines = 4, minSize = 36) {
  if (!text) return 0;
  const { size: s, lines } = layoutText(ctx, text, width, size, weight, maxLines, minSize);
  ctx.font = `${weight} ${s}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  const lh = Math.round(s * 1.3);
  lines.forEach((l, i) => ctx.fillText(l, x, y + s + i * lh));
  return lines.length * lh;
}

/** Paints cover [spec] = { tpl, color, title, subtitle, name } into a canvas context of size W x H. */
export function drawCover(ctx, W, H, spec) {
  const tpl = Math.max(0, Math.min(COVER_TEMPLATES.length - 1, spec.tpl | 0));
  const accent = (COVER_COLORS[spec.color | 0] || COVER_COLORS[0])[1];
  const title = (spec.title || '').trim() || '제목', sub = (spec.subtitle || '').trim(), name = (spec.name || '').trim();
  const u = W / 1000;   // layout unit
  ctx.save(); ctx.clearRect(0, 0, W, H);
  const fill = (c, x, y, w, hh) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, hh); };
  const meta = (x, y, color, align, size = 38 * u) => {
    let yy = y;
    if (sub) yy += drawLines(ctx, sub, x, yy, W * .6, size, 400, color, align, 2, 24 * u) + 12 * u;
    if (name) drawLines(ctx, name, x, yy, W * .6, size * .9, 400, color, align, 1, 22 * u);
  };
  switch (tpl) {
    case 0: {   // 클래식: warm paper with a double border
      fill('#FBF7EE', 0, 0, W, H);
      ctx.strokeStyle = accent; ctx.lineWidth = 6 * u; ctx.strokeRect(60 * u, 60 * u, W - 120 * u, H - 120 * u);
      ctx.lineWidth = 2 * u; ctx.strokeRect(84 * u, 84 * u, W - 168 * u, H - 168 * u);
      const hh = drawLines(ctx, title, W / 2, H * .36, W * .62, 96 * u, 700, '#222', 'center', 4, 48 * u);
      fill(accent, W / 2 - 60 * u, H * .36 + hh + 30 * u, 120 * u, 4 * u);
      meta(W / 2, H * .36 + hh + 70 * u, '#555', 'center');
      break;
    }
    case 1: {   // 파스텔: coloured block on top
      fill('#FFFFFF', 0, 0, W, H); fill(mix(accent, .72), 0, 0, W, H * .46);
      ctx.fillStyle = mix(accent, .5); ctx.beginPath(); ctx.arc(W * .85, H * .08, 150 * u, 0, 7); ctx.fill();
      ctx.fillStyle = mix(accent, .6); ctx.beginPath(); ctx.arc(W * .12, H * .42, 90 * u, 0, 7); ctx.fill();
      drawLines(ctx, title, 90 * u, H * .24, W - 180 * u, 92 * u, 700, '#2B2B30', 'left', 3, 48 * u);
      meta(90 * u, H * .52, '#55555C', 'left');
      break;
    }
    case 2: {   // 풀컬러: full accent colour, big title at the lower left
      fill(accent, 0, 0, W, H);
      ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.arc(W * .8, H * .2, 330 * u, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.10)'; ctx.beginPath(); ctx.arc(W * .95, H * .45, 180 * u, 0, 7); ctx.fill();
      const lines = layoutText(ctx, title, W - 180 * u, 120 * u, 800, 4, 56 * u), lh = Math.round(lines.size * 1.25);
      const top = H * .66 - lines.lines.length * lh;
      ctx.font = `800 ${lines.size}px ${FONT}`; ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      lines.lines.forEach((l, i) => ctx.fillText(l, 90 * u, top + (i + 1) * lh));
      meta(90 * u, H * .70, 'rgba(255,255,255,.88)', 'left');
      break;
    }
    case 3: {   // 줄노트: ruled paper with a label
      fill('#FFFFFF', 0, 0, W, H);
      ctx.strokeStyle = '#D8DDE6'; ctx.lineWidth = 2 * u;
      for (let y = 140 * u; y < H - 60 * u; y += 56 * u) { ctx.beginPath(); ctx.moveTo(60 * u, y); ctx.lineTo(W - 60 * u, y); ctx.stroke(); }
      fill(mix(accent, .85), 120 * u, H * .24, W - 240 * u, 330 * u);
      ctx.strokeStyle = accent; ctx.lineWidth = 5 * u; ctx.strokeRect(120 * u, H * .24, W - 240 * u, 330 * u);
      drawLines(ctx, title, W / 2, H * .24 + 70 * u, W - 340 * u, 80 * u, 700, '#222', 'center', 2, 40 * u);
      meta(W / 2, H * .24 + 230 * u, '#555', 'center', 32 * u);
      fill(accent, 60 * u, 0, 8 * u, H);
      break;
    }
    case 4: {   // 미니멀: left bar
      fill('#FFFFFF', 0, 0, W, H); fill(accent, 0, 0, 70 * u, H);
      const hh = drawLines(ctx, title, 170 * u, H * .3, W - 280 * u, 84 * u, 700, '#1C1C1E', 'left', 4, 44 * u);
      fill('#1C1C1E', 170 * u, H * .3 + hh + 26 * u, 90 * u, 4 * u);
      meta(170 * u, H * .3 + hh + 70 * u, '#6B6B72', 'left');
      break;
    }
    case 5: {   // 도트: dot grid
      fill(mix(accent, .93), 0, 0, W, H);
      ctx.fillStyle = mix(accent, .55);
      for (let y = 60 * u; y < H; y += 46 * u) for (let x = 60 * u; x < W; x += 46 * u) { ctx.beginPath(); ctx.arc(x, y, 3.2 * u, 0, 7); ctx.fill(); }
      fill('#FFFFFF', 110 * u, H * .3, W - 220 * u, 360 * u);
      ctx.strokeStyle = accent; ctx.lineWidth = 4 * u; ctx.strokeRect(110 * u, H * .3, W - 220 * u, 360 * u);
      drawLines(ctx, title, W / 2, H * .3 + 80 * u, W - 320 * u, 80 * u, 700, '#222', 'center', 2, 40 * u);
      meta(W / 2, H * .3 + 240 * u, '#555', 'center', 32 * u);
      break;
    }
    case 6: {   // 다크
      fill('#17181C', 0, 0, W, H);
      const g = ctx.createLinearGradient(0, H * .7, 0, H); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, mix(accent, .0) .replace('rgb', 'rgba').replace(')', ',.55)'));
      ctx.fillStyle = g; ctx.fillRect(0, H * .7, W, H * .3);
      fill(accent, 90 * u, H * .27, 110 * u, 8 * u);
      const hh = drawLines(ctx, title, 90 * u, H * .3, W - 180 * u, 92 * u, 700, '#F4F4F6', 'left', 4, 46 * u);
      meta(90 * u, H * .3 + hh + 40 * u, 'rgba(244,244,246,.7)', 'left');
      break;
    }
    default: {   // 다이어리: leather look with stitching and a label plate
      fill(mix(accent, .0, 0), 0, 0, W, H);
      const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, 'rgba(255,255,255,.14)'); g.addColorStop(1, 'rgba(0,0,0,.28)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      fill('rgba(0,0,0,.22)', 0, 0, 90 * u, H);
      ctx.setLineDash([16 * u, 12 * u]); ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 3 * u;
      ctx.strokeRect(150 * u, 60 * u, W - 210 * u, H - 120 * u); ctx.setLineDash([]);
      fill('#F6EFD9', 290 * u, H * .3, W - 450 * u, 330 * u);
      ctx.strokeStyle = '#8A7A52'; ctx.lineWidth = 3 * u; ctx.strokeRect(304 * u, H * .3 + 14 * u, W - 478 * u, 302 * u);
      drawLines(ctx, title, 290 * u + (W - 450 * u) / 2, H * .3 + 80 * u, W - 560 * u, 70 * u, 700, '#3A3220', 'center', 2, 34 * u);
      meta(290 * u + (W - 450 * u) / 2, H * .3 + 220 * u, '#5E5236', 'center', 28 * u);
    }
  }
  ctx.restore();
}

export const COVER_W = 1240, COVER_H = 1754;
/** JPEG bytes of a cover for a page of the given aspect (width / height) */
export async function coverPng(spec, aspect = COVER_W / COVER_H) {
  const W = COVER_W, H = Math.round(COVER_W / (aspect > 0 ? aspect : COVER_W / COVER_H));
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  drawCover(canvas.getContext('2d'), W, H, spec);
  const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', .92));
  return new Uint8Array(await blob.arrayBuffer());
}

/** The dialog: title / subtitle / name fields, 8 templates x 6 colours with a live preview. onDone(spec) when 만들기 is pressed. */
export function showCoverDialog(initial, hasCover, onDone) {
  const spec = Object.assign({ tpl: 0, color: 0, title: '', subtitle: '', name: '' }, initial);
  const preview = document.createElement('canvas'); preview.width = 248; preview.height = 351; preview.className = 'cover-preview'; preview.dataset.tag = 'cover_preview';
  Object.assign(preview.style, { width: '124px', height: '176px', borderRadius: '6px', boxShadow: '0 1px 6px rgba(0,0,0,.25)', flex: 'none' });
  const redraw = () => {
    const c = preview.getContext('2d'); c.save(); c.scale(preview.width / COVER_W, preview.width / COVER_W);
    drawCover(c, COVER_W, COVER_H, spec); c.restore();
  };
  const field = (label, key, placeholder) => {
    const input = h('input', { type: 'text', value: spec[key], placeholder, maxlength: '80', dataset: { tag: 'cover_' + key }, style: { width: '100%', boxSizing: 'border-box', height: '34px', border: '1px solid #D1D1D6', borderRadius: '8px', padding: '0 10px', fontSize: '14px' } });
    input.addEventListener('input', () => { spec[key] = input.value; redraw(); });
    return h('label', { style: { display: 'block', marginBottom: '8px', fontSize: '12px', color: '#6B6B72' } }, label, input);
  };
  const tplRow = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px', margin: '4px 0 8px' } });
  const colorRow = h('div', { style: { display: 'flex', gap: '8px', margin: '4px 0' } });
  const paintChips = () => {
    tplRow.replaceChildren(...COVER_TEMPLATES.map((n, i) => {
      const b = h('div', { role: 'button', dataset: { tag: 'cover_tpl_' + i }, 'aria-label': '표지 ' + n, style: { padding: '5px 10px', borderRadius: '14px', fontSize: '13px', cursor: 'pointer', border: '1px solid ' + (spec.tpl === i ? '#007AFF' : '#D1D1D6'), background: spec.tpl === i ? '#E5F0FF' : '#fff', color: spec.tpl === i ? '#007AFF' : '#1C1C1E' } }, n);
      b.addEventListener('click', () => { spec.tpl = i; paintChips(); redraw(); }); return b;
    }));
    colorRow.replaceChildren(...COVER_COLORS.map(([n, c], i) => {
      const b = h('div', { role: 'button', title: n, dataset: { tag: 'cover_color_' + i }, 'aria-label': '색 ' + n, style: { width: '26px', height: '26px', borderRadius: '13px', background: c, cursor: 'pointer', boxSizing: 'border-box', border: spec.color === i ? '3px solid #fff' : '3px solid transparent', boxShadow: spec.color === i ? '0 0 0 2px ' + c : 'none' } });
      b.addEventListener('click', () => { spec.color = i; paintChips(); redraw(); }); return b;
    }));
  };
  paintChips(); redraw();
  const form = h('div', { style: { flex: '1', minWidth: '0' } }, field('제목', 'title', '문서 제목'), field('부제목 (선택)', 'subtitle', '과목 · 기간 등'), field('이름 (선택)', 'name', '이름'),
    h('div', { style: { fontSize: '12px', color: '#6B6B72' } }, '모양'), tplRow, h('div', { style: { fontSize: '12px', color: '#6B6B72' } }, '색'), colorRow);
  const view = h('div', { style: { display: 'flex', gap: '14px', padding: '4px 20px 6px', minWidth: '520px' } }, preview, form);
  const dialog = new AlertDialog.Builder().setTitle(hasCover ? '표지 바꾸기' : '표지 만들기').setView(view).setPositiveButton(hasCover ? '바꾸기' : '만들기').setNegativeButton('취소').create();
  dialog.show();
  rebindButton(dialog, BUTTON_POSITIVE, () => { if (!spec.title.trim()) { toast('표지에 넣을 제목을 입력하세요'); return; } dialog.dismiss(); onDone({ ...spec }); });
  return dialog;
}
