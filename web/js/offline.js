// "오프라인에서 사용하기" dialog (app-main2.js installs showAboutOffline). Styles: .sy-off* in css/main2.css.
import { h, icon } from './util.js';
import { AlertDialog } from './ui/alert.js';

const ico = (n, s = 18, c = 'currentColor') => { try { return icon(n, s, c); } catch (e) { return h('span'); } };

export const OFFLINE_NEEDS = ['번역 (구글 번역 열기)', '사전 웹 검색', 'YouTube · 온라인 이미지', 'WebView2 런타임 최초 설치'];
export const OFFLINE_WORKS = ['PDF 열기', '필기', '검색', 'HWP 변환', 'Office 변환 (Office/LibreOffice 필요)', 'OCR (Windows OCR 언어팩 필요)', '내보내기', '인쇄', '문서함'];

export function showAboutOffline() {
  const list = (items, cls) => h('ul', { class: 'sy-offlist ' + cls }, items.map(t => h('li', null, t)));
  const view = h('div', { class: 'sy-off', dataset: { tag: 'about_offline' } },
    h('div', { class: 'sy-note' }, '회사·기관의 내부망(인터넷이 막힌 환경)에서도 대부분의 기능을 쓸 수 있습니다.'),
    h('div', { class: 'sy-offhead need' }, ico('ic_wifi_off', 18), '인터넷이 필요한 기능'), list(OFFLINE_NEEDS, 'need'),
    h('div', { class: 'sy-offhead ok' }, ico('ic_check', 18), '오프라인에서도 되는 기능'), list(OFFLINE_WORKS, 'ok'),
    h('div', { class: 'sy-note small' }, '인터넷이 필요한 기능을 오프라인에서 누르면 안내 메시지만 표시되며, 문서와 필기는 그대로 안전합니다.'));
  const b = new AlertDialog.Builder(); b.setTitle('오프라인에서 사용하기').setView(view).setNegativeButton('닫기', null);
  const d = b.show();
  const card = d.root.querySelector('.ad-card');
  if (card) { card.style.width = 'min(92vw,440px)'; card.style.maxHeight = 'calc(100vh - 40px)'; card.style.display = 'flex'; card.style.flexDirection = 'column'; const body = card.querySelector('.ad-body'); if (body) { body.style.overflow = 'auto'; body.style.flex = '1 1 auto'; body.style.minHeight = '0'; } }
  d.root.classList.add('sy-root'); return d;
}
