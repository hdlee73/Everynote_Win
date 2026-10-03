import { h } from '../util.js';
let el, timer;
/** Android Toast.LENGTH_SHORT equivalent. */
export function toast(msg, ms = 2000) {
  if (!el) { el = h('div', { class: 'toast' }); document.body.append(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(timer); timer = setTimeout(() => el.classList.remove('show'), ms);
}
