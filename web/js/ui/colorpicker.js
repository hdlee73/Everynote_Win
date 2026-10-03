// Port of ColorPicker.java: a free colour chooser (hue, saturation, brightness, optional opacity) plus the wide preset
// palette used across the app. Java names kept: ColorPicker.PALETTE, ColorPicker.show(context, title, initial, alpha, onPick).
// Colours are Java ARGB ints (signed int32 numbers). Styles: css/colorpicker.css.
import { h } from '../util.js';
import { AlertDialog } from './alert.js';

/** android.graphics.Color.colorToHSV: [hue 0..360, sat 0..1, value 0..1] of an ARGB int (alpha ignored). */
function colorToHSV(color) {
  const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let hue = 0;
  if (d > 0) {
    if (max === r) hue = ((g - b) / d) % 6; else if (max === g) hue = (b - r) / d + 2; else hue = (r - g) / d + 4;
    hue *= 60; if (hue < 0) hue += 360;
  }
  return [hue, max === 0 ? 0 : d / max, max / 255];
}
/** android.graphics.Color.HSVToColor: opaque ARGB int. */
function HSVToColor(hsv) {
  const hue = ((hsv[0] % 360) + 360) % 360, s = Math.max(0, Math.min(1, hsv[1])), v = Math.max(0, Math.min(1, hsv[2]));
  const c = v * s, x = c * (1 - Math.abs((hue / 60) % 2 - 1)), m = v - c;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  const q = n => Math.round((n + m) * 255);
  return (0xFF000000 | (q(r) << 16) | (q(g) << 8) | q(b)) | 0;
}
const cssRgb = c => `rgb(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255})`;
const cssRgba = c => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${(((c >>> 24) & 255) / 255).toFixed(4)})`;

/** A horizontal gradient track with a round thumb (value 0..1). */
class Slider {
  constructor(label) {
    this.value = 0; this.change = null; this.colors = ['#000', '#fff'];
    this.thumb = h('div', { class: 'cp-thumb' });
    this.bar = h('div', { class: 'cp-bar' });
    this.el = h('div', { class: 'cp-slider', role: 'slider', tabindex: '0', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100' }, this.bar, this.thumb);
    const at = e => {
      const r = this.el.getBoundingClientRect(), pad = 14;
      this.setValue((e.clientX - r.left - pad) / Math.max(1, r.width - 2 * pad));
      if (this.change) this.change(this.value);
    };
    this.el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); try { this.el.setPointerCapture(e.pointerId); } catch (x) { /* */ } this._drag = true; this.el.focus(); at(e); });
    this.el.addEventListener('pointermove', e => { if (this._drag) at(e); });
    const end = () => { this._drag = false; };
    this.el.addEventListener('pointerup', end); this.el.addEventListener('pointercancel', end);
    this.el.addEventListener('keydown', e => {
      const step = e.shiftKey ? .1 : .01, k = e.key;
      const dv = k === 'ArrowRight' || k === 'ArrowUp' ? step : k === 'ArrowLeft' || k === 'ArrowDown' ? -step : 0;
      if (!dv) return; e.preventDefault(); this.setValue(this.value + dv); if (this.change) this.change(this.value);
    });
  }
  setColors(c) { this.colors = c; this.bar.style.background = `linear-gradient(to right, ${c.map(cssRgba).join(',')})`; }
  setValue(v) {
    this.value = Math.max(0, Math.min(1, v));
    this.thumb.style.left = `calc(14px + (100% - 28px) * ${this.value})`;
    this.el.setAttribute('aria-valuenow', String(Math.round(this.value * 100)));
  }
  setOnChange(c) { this.change = c; }
}

export class ColorPicker {
  /** 4 rows of 8: neutrals, vivid, deep, pastel. */
  static PALETTE = [
    0xFF000000, 0xFF3A3A3C, 0xFF636366, 0xFF8E8E93, 0xFFAEAEB2, 0xFFD1D1D6, 0xFFE5E5EA, 0xFFFFFFFF,
    0xFFFF3B30, 0xFFFF9500, 0xFFFFCC00, 0xFF34C759, 0xFF00C7BE, 0xFF007AFF, 0xFF5856D6, 0xFFAF52DE,
    0xFF8E1B14, 0xFFB35900, 0xFF8A6D00, 0xFF1B7F37, 0xFF00746E, 0xFF0040A8, 0xFF2E2C8A, 0xFF7B2FA3,
    0xFFFFB3AE, 0xFFFFD3A0, 0xFFFFF0A0, 0xFFB8EBC4, 0xFFA0EEE9, 0xFFA6CBFF, 0xFFC4C2FF, 0xFFE3C4F5,
  ].map(c => c | 0);

  static colorToHSV = colorToHSV;
  static HSVToColor = HSVToColor;

  /**
   * Opens the chooser. context is accepted for Java signature parity and ignored (may be null).
   * onPick(color) receives an ARGB int; with alpha=false the opacity is always 255.
   * Returns the AlertDialog.
   */
  static show(context, title, initial, alpha, onPick) {
    initial |= 0;
    const hsv = colorToHSV(initial), opacity = [alpha ? (initial >>> 24) & 255 : 255];
    const preview = h('div', { class: 'cp-preview', 'aria-label': '선택한 색 미리보기' });
    const hue = new Slider('색상'), sat = new Slider('채도'), val = new Slider('밝기'), alp = new Slider('투명도');
    const hex = h('div', { class: 'cp-hex' });
    const refresh = () => {
      const rgb = HSVToColor(hsv), full = ((opacity[0] << 24) | (rgb & 0xFFFFFF)) | 0;
      preview.style.setProperty('--cp-color', cssRgba(full));
      hue.setColors([0, 1, 2, 3, 4, 5, 6].map(i => HSVToColor([i * 60, 1, 1])));
      sat.setColors([HSVToColor([hsv[0], 0, hsv[2]]), HSVToColor([hsv[0], 1, hsv[2]])]);
      val.setColors([0xFF000000 | 0, HSVToColor([hsv[0], hsv[1], 1])]);
      alp.setColors([rgb & 0xFFFFFF, rgb | 0xFF000000]);
      hex.textContent = '#' + (rgb & 0xFFFFFF).toString(16).toUpperCase().padStart(6, '0') + (alpha ? ` · 투명도 ${Math.round(opacity[0] * 100 / 255)}%` : '');
      hex.dataset.rgb = '#' + (rgb & 0xFFFFFF).toString(16).toUpperCase().padStart(6, '0');
    };
    hue.setValue(hsv[0] / 360); sat.setValue(hsv[1]); val.setValue(hsv[2]); alp.setValue(opacity[0] / 255);
    hue.setOnChange(v => { hsv[0] = v * 359.9; refresh(); });
    sat.setOnChange(v => { hsv[1] = v; refresh(); });
    val.setOnChange(v => { hsv[2] = v; refresh(); });
    alp.setOnChange(v => { opacity[0] = Math.round(v * 255); refresh(); });
    const row = (label, s) => h('div', { class: 'cp-row' }, h('span', { class: 'cp-name' }, label), s.el);
    const box = h('div', { class: 'cp-box', dataset: { tag: 'color_picker' } }, preview, row('색상', hue), row('채도', sat), row('밝기', val), alpha ? row('투명도', alp) : null, hex);
    refresh();
    return new AlertDialog.Builder().setTitle(title).setView(box)
      .setPositiveButton('적용', () => onPick(((opacity[0] << 24) | (HSVToColor(hsv) & 0xFFFFFF)) | 0))
      .setNegativeButton('취소', null).show();
  }
}
export default ColorPicker;
