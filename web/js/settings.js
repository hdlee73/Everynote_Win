// 설정 화면 (Samsung Notes style: grouped cards of rows, toggles and radio choices). Every row talks to the running app (MainActivity mixins),
// the state itself stays in the same prefs the in-document menus use.
import { h, icon } from './util.js';
import { AlertDialog, BUTTON_POSITIVE } from './ui/alert.js';
import { toast } from './ui/toast.js';
import { NotebookFiles } from './library.js';
import { PaperChoiceView, defaultNoteStyle, saveDefaultNoteStyle, describeNoteStyle, rebindButton } from './library-dialog.js';

let current = null;

export class SettingsView {
  constructor(app) {
    this.app = app;
    this.body = h('div', { class: 'set-body' });
    const back = h('button', { class: 'set-back', type: 'button', 'aria-label': '설정 닫기', title: '뒤로' }, icon('ic_chevron_left', 24));
    back.addEventListener('click', () => this.dismiss());
    this.el = h('div', { class: 'set-root', role: 'dialog', 'aria-label': '설정', dataset: { tag: 'settings_root' } },
      h('div', { class: 'set-top' }, back, h('div', { class: 'set-title' }, '설정')), h('div', { class: 'set-scroll' }, this.body));
    this.render();
  }
  show() {
    if (current) return;
    current = this;
    document.body.append(this.el);
    this._key = e => { if (e.key === 'Escape' && !document.querySelector('.ad-root,.amenu')) { e.preventDefault(); this.dismiss(); } };
    window.addEventListener('keydown', this._key);
  }
  dismiss() {
    if (current !== this) return;
    current = null; window.removeEventListener('keydown', this._key); this.el.remove();
  }

  // ---- row builders
  section(title, ...rows) {
    const card = h('div', { class: 'set-card' });
    rows.forEach((r, i) => { if (i) card.append(h('div', { class: 'set-hair' })); card.append(r); });
    this.body.append(h('div', { class: 'set-sec' }, title), card);
  }
  link(title, sub, onClick, tag, value = null, valueTag = null) {
    const row = h('div', { class: 'set-row', role: 'button', tabindex: '0', dataset: { tag } }, h('div', { class: 'set-txt' }, h('div', { class: 'set-nm' }, title), sub ? h('div', { class: 'set-sub' }, sub) : null,
      value ? h('div', { class: 'set-val', dataset: { tag: valueTag } }, value) : null));
    row.addEventListener('click', onClick);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } });
    return row;
  }
  toggle(title, sub, on, onChange, tag) {
    const sw = h('div', { class: 'set-switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': title, tabindex: '0', dataset: { tag } }, h('i'));
    const row = h('div', { class: 'set-row' }, h('div', { class: 'set-txt' }, h('div', { class: 'set-nm' }, title), sub ? h('div', { class: 'set-sub' }, sub) : null), sw);
    const flip = () => { onChange(!on); this.render(); };
    row.addEventListener('click', flip);
    sw.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
    return row;
  }
  radio(label, on, onPick, tag) {
    const row = h('div', { class: 'set-row radio', role: 'radio', 'aria-checked': on ? 'true' : 'false', tabindex: '0', dataset: { tag } }, h('i', { class: 'set-dot' + (on ? ' on' : '') }), h('div', { class: 'set-nm' }, label));
    const pick = () => { onPick(); this.render(); };
    row.addEventListener('click', pick);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    return row;
  }

  render() {
    const app = this.app, prefs = app.recentPrefs, top = this.el.querySelector('.set-scroll') ? this.el.querySelector('.set-scroll').scrollTop : 0;
    this.body.textContent = '';
    const style = defaultNoteStyle(prefs);
    this.section('일반',
      this.link('기본 노트 스타일', '새 노트를 만들 때 가장 처음 선택되어 있는 양식을 정합니다.', () => this.chooseNoteStyle(), 'set_note_style', describeNoteStyle(style), 'set_note_style_value'),
      this.toggle('화면 켜 둠', '읽는 동안 화면이 꺼지지 않습니다.', prefs.getBoolean('keep_awake', false), on => {
        prefs.putBoolean('keep_awake', on); app.applyKeepAwake(); toast(on ? '읽는 동안 화면이 꺼지지 않습니다' : '화면 자동 꺼짐을 따릅니다');
      }, 'set_keep_awake'),
      this.toggle('전체 화면 메뉴 계속 표시', '전체 화면에서도 아래쪽 도구 줄을 항상 보여 줍니다.', app.dockPinned(), () => app.toggleDockPinned(), 'set_dock_pinned'));
    this.section('문서 보기',
      this.toggle('여백 자르기', '문서의 흰 여백을 잘라 화면에 꽉 채웁니다.', app.cropMargins(), on => {
        prefs.putBoolean('crop_margins', on); app.applyCrop(); toast(on ? '문서 여백을 잘라 화면에 꽉 채웁니다' : '원래 여백을 그대로 보여줍니다');
      }, 'set_crop'),
      this.toggle('검은 문서 배경', '문서 배경을 검게 표시합니다. 어두운 글씨 필기는 밝게 보입니다.', app.darkPage(), () => app.toggleDarkPage(), 'set_dark_page'));
    this.section('페이지 넘김',
      ...app.SWIPE_CHOICES.map((l, i) => this.radio(l, app.swipeMode() === i, () => app.setSwipeMode(i), 'set_swipe:' + i)));
    this.section('넘김 효과',
      ...app.ANIM_CHOICES.map((l, i) => this.radio(l, app.pageAnimStyle() === i, () => app.setPageAnim(i), 'set_anim:' + i)));
    const upd = app.callUi2('pendingUpdateVersion');
    this.section('정보',
      this.link(upd ? '앱 정보·업데이트 (새 버전 v' + upd + ')' : '앱 정보·업데이트', null, () => app.callUi2('showAbout'), 'set_about'),
      this.link('사용법', null, () => app.showHelp(), 'set_help'),
      this.link('오프라인 사용 안내', null, () => app.callUi2('showAboutOffline'), 'set_offline'));
    this.el.querySelector('.set-scroll').scrollTop = top;
  }

  /** 기본 노트 스타일: the same paper / colour / layout chooser as the new-note dialog; the result becomes the first choice there. */
  chooseNoteStyle() {
    const app = this.app, view = new PaperChoiceView(app, Object.assign(defaultNoteStyle(app.recentPrefs), { layoutChoice: true }));
    if (view.onTemplateRequest) view.onTemplateRequest(() => app.requestTemplate(view));
    const dialog = new AlertDialog.Builder().setTitle('기본 노트 스타일').setView(view.el).setPositiveButton('저장').setNegativeButton('취소').create();
    rebindButton(dialog, BUTTON_POSITIVE, () => {
      if (view.kind === NotebookFiles.CUSTOM) { toast('내 서식은 기본 스타일로 정할 수 없습니다. 새 노트를 만들 때 고르세요'); return; }
      saveDefaultNoteStyle(app.recentPrefs, view); dialog.dismiss(); this.render(); toast('새 노트의 기본 스타일을 저장했습니다');
    });
    dialog.show();
  }
}
