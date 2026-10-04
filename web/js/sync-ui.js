// Google Drive sync UI (settings dialog, auto-sync scheduler, "what needs the internet" dialog). Logic lives in sync.js.
// app-main2.js installs: showSyncSettings(), showAboutOffline(); initMain2 starts the scheduler (initSyncAuto).
import { h, icon, fmtDate } from './util.js';
import { host } from './host.js';
import { prefs } from './prefs.js';
import { AlertDialog } from './ui/alert.js';
import { toast } from './ui/toast.js';
import { DriveSync, SyncError, MESSAGES, SYNC_FOLDER } from './sync.js';

const K = { enabled: 'sync_enabled', pdfs: 'sync_pdfs', ann: 'sync_ann', assets: 'sync_assets', auto: 'sync_auto', lastMs: 'sync_last_ms', lastText: 'sync_last_text', lastErr: 'sync_last_err', log: 'sync_log' };
export const AUTO_LABELS = ['사용 안 함', '열 때·닫을 때', '10분마다'];
const INTERVAL_MS = 10 * 60 * 1000;
const ico = (n, s = 18, c = 'currentColor') => { try { return icon(n, s, c); } catch (e) { return h('span'); } };

export const OFFLINE_NEEDS = ['번역 (구글 번역 열기)', '사전 웹 검색', '구글 드라이브 동기화', 'YouTube · 온라인 이미지', 'WebView2 런타임 최초 설치'];
export const OFFLINE_WORKS = ['PDF 열기', '필기', '검색', 'HWP 변환', 'Office 변환 (Office/LibreOffice 필요)', 'OCR (Windows OCR 언어팩 필요)', '내보내기', '인쇄', '문서함'];

// ---------------------------------------------------------------- log (kept in memory, last lines persisted)
const logLines = []; const logSubs = new Set();
try { const saved = JSON.parse(prefs.getString(K.log, '[]')); if (Array.isArray(saved)) logLines.push(...saved.slice(-150)); } catch (e) { /* ignore */ }
function persistLog() { try { let s = JSON.stringify(logLines.slice(-150)); while (s.length > 14000 && logLines.length > 10) { logLines.shift(); s = JSON.stringify(logLines.slice(-150)); } prefs.putString(K.log, s); } catch (e) { /* ignore */ } }
export function addLog(text) {
  const d = new Date(), p = n => String(n).padStart(2, '0');
  const line = `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}  ${text}`;
  logLines.push(line); if (logLines.length > 300) logLines.splice(0, logLines.length - 300);
  clearTimeout(addLog._t); addLog._t = setTimeout(persistLog, 800);
  logSubs.forEach(f => { try { f(line); } catch (e) { /* ignore */ } });
}
export const getLog = () => logLines.slice();
export function clearLog() { logLines.length = 0; persistLog(); logSubs.forEach(f => { try { f(null); } catch (e) { /* ignore */ } }); }

// ---------------------------------------------------------------- controller
export class SyncController {
  constructor(app) { this.app = app; this.sync = null; this.subs = new Set(); this.progress = null; this.timer = null; this.lastRunAt = 0; this.lastSummary = null; }
  get enabled() { return prefs.getBoolean(K.enabled, false); }
  get running() { return !!this._busy; }
  options() { return { pdfs: prefs.getBoolean(K.pdfs, true), annotations: prefs.getBoolean(K.ann, true), assets: prefs.getBoolean(K.assets, true) }; }
  subscribe(f) { this.subs.add(f); return () => this.subs.delete(f); }
  emit(e) { this.subs.forEach(f => { try { f(e); } catch (x) { /* ignore */ } }); }
  async status() { try { return await host.call('google.status'); } catch (e) { return { signedIn: false, email: '', configured: false, error: e && e.message || String(e) }; } }
  cancel() { if (this.sync) this.sync.cancel(); }

  /** interactive: the user pressed the button (deletions are confirmed in a dialog); otherwise unattended (deletions are deferred). */
  async syncNow({ interactive = true } = {}) {
    if (this.running) return null;
    const lib = this.app.library;
    if (!lib || !lib.root) { const m = '문서함을 아직 불러오지 못했습니다'; this.fail(m); return null; }
    const st = await this.status();
    if (st.error) { this.fail('이 환경에서는 Google 드라이브 연동을 사용할 수 없습니다'); return null; }
    this.lastRunAt = Date.now();
    this.sync = new DriveSync({
      library: lib, account: st.email || '', options: this.options(),
      log: addLog, onProgress: p => { this.progress = p; this.emit({ type: 'progress', p }); },
      confirmDeletions: interactive ? list => confirmDeletionsDialog(list) : null,
    });
    this._busy = true; this.emit({ type: 'start' });
    try {
      const s = await this.sync.run(); this.lastSummary = s; this._busy = false;
      const text = s.cancelled ? '취소됨' : summaryText(s);
      if (!s.cancelled) { prefs.putString(K.lastMs, String(Date.now())); prefs.putString(K.lastText, text); prefs.putString(K.lastErr, ''); }
      this.emit({ type: 'done', summary: s, text });
      await this.afterSync(s, interactive);
      return s;
    } catch (e) { this._busy = false; this.fail(e && e.message || String(e), e); return null; }
  }
  fail(message, err) {
    prefs.putString(K.lastErr, message); prefs.putString(K.lastMs, String(Date.now())); prefs.putString(K.lastText, '');
    this.emit({ type: 'error', message, err });
    if (!(err && err.code === 'cancelled')) addLog('실패: ' + message);
  }
  async afterSync(s, interactive) {
    const app = this.app;
    if (s.errors && s.errors.length && interactive) toast(`동기화 완료 (오류 ${s.errors.length}건 — 로그 확인)`);
    else if (interactive && !s.cancelled) toast('동기화를 마쳤습니다');
    if (!s.cancelled && this.sync && app.documentUri && app.store) {
      const open = String(app.documentUri).toLowerCase();
      if ([...this.sync.changedLocal].some(p => String(p).toLowerCase() === open)) {
        try { await app.store.open(app.documentUri); if (app.redrawPages) app.redrawPages(); if (app.refreshStudyPanel) app.refreshStudyPanel(); toast('열려 있는 문서의 필기가 Drive 내용으로 갱신되었습니다'); } catch (e) { /* ignore */ }
      }
    }
    if (s.deferred) toast(`삭제 확인이 필요한 항목 ${s.deferred}건이 있습니다. 동기화 설정에서 '지금 동기화'를 누르세요`);
    try { if (app.library && app.refreshLibraryList) app.refreshLibraryList(); } catch (e) { /* ignore */ }
  }

  // ---- auto sync
  applyAuto() {
    clearInterval(this.timer); this.timer = null;
    if (!this.enabled || prefs.getInt(K.auto, 0) !== 2) return;
    this.timer = setInterval(() => this.auto(), INTERVAL_MS);
  }
  async auto() {
    if (!this.enabled || this.running || prefs.getInt(K.auto, 0) === 0) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const st = await this.status(); if (!st.signedIn || !st.configured) return;
    addLog('자동 동기화'); await this.syncNow({ interactive: false });
  }
  start() {
    this.applyAuto();
    setTimeout(() => { if (prefs.getInt(K.auto, 0) >= 1) this.auto(); }, 6000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && prefs.getInt(K.auto, 0) >= 1 && Date.now() - this.lastRunAt > 120000) this.auto();
    });
  }
}
export function getSyncController(app) { return app._sync || (app._sync = new SyncController(app)); }
export function initSyncAuto(app) { try { getSyncController(app).start(); } catch (e) { /* ignore */ } }

export function summaryText(s) {
  const parts = [];
  if (s.uploaded) parts.push(`올림 ${s.uploaded}`); if (s.downloaded) parts.push(`받음 ${s.downloaded}`);
  if (s.deletedLocal || s.deletedRemote) parts.push(`삭제 ${s.deletedLocal + s.deletedRemote}`); if (s.conflicts) parts.push(`충돌 ${s.conflicts}`);
  if (s.errors && s.errors.length) parts.push(`오류 ${s.errors.length}`);
  return parts.length ? parts.join(' · ') : '변경 사항 없음';
}

// ---------------------------------------------------------------- dialogs
function cardDialog({ title, view, positive = null, negative = null, width = 'min(94vw,560px)', onDismiss = null }) {
  const b = new AlertDialog.Builder(); b.setTitle(title).setView(view);
  if (positive) b.setPositiveButton(positive[0], positive[1] || null);
  if (negative) b.setNegativeButton(negative[0], negative[1] || null);
  if (onDismiss) b.setOnDismissListener(onDismiss);
  const d = b.show();
  const card = d.root.querySelector('.ad-card');
  if (card) { card.style.width = width; card.style.maxHeight = 'calc(100vh - 40px)'; card.style.display = 'flex'; card.style.flexDirection = 'column'; const body = card.querySelector('.ad-body'); if (body) { body.style.overflow = 'auto'; body.style.flex = '1 1 auto'; body.style.minHeight = '0'; } }
  d.root.classList.add('sy-root'); return d;
}

/** Deletion confirmation. Resolves to the keys the user chose to delete; [] = delete nothing (files are restored to the other side). */
export function confirmDeletionsDialog(list) {
  return new Promise(resolve => {
    const checks = new Map();
    const rows = list.map(it => {
      const cb = h('input', { type: 'checkbox', 'aria-label': it.name }); checks.set(it.key, cb);
      return h('label', { class: 'sy-delrow' }, cb, h('span', { class: 'sy-delk' }, ({ pdf: 'PDF', ann: '필기', asset: '자료' })[it.kind] || ''),
        h('span', { class: 'sy-delname' }, it.name), h('span', { class: 'sy-dels' }, it.side === 'local' ? '이 기기에서 삭제' : '드라이브에서 삭제'));
    });
    const all = h('button', { class: 'sy-btn', type: 'button', onclick: () => { const on = [...checks.values()].some(c => !c.checked); checks.forEach(c => { c.checked = on; }); } }, '모두 선택/해제');
    const view = h('div', { class: 'sy-del' },
      h('div', { class: 'sy-note' }, '아래 파일은 다른 쪽에서 삭제된 것으로 보입니다. 선택한 항목만 삭제(휴지통으로 이동)하고, 선택하지 않은 항목은 삭제하지 않고 반대쪽에 다시 복원합니다.'),
      all, h('div', { class: 'sy-dellist', dataset: { tag: 'sync_delete_list' } }, rows));
    let done = false; const finish = v => { if (!done) { done = true; resolve(v); } };
    cardDialog({ title: '삭제 반영 확인', view, positive: ['선택한 항목 삭제', () => finish([...checks].filter(([, c]) => c.checked).map(([k]) => k))], negative: ['삭제 안 함 (복원)', () => finish([])], onDismiss: () => finish([]) });
  });
}

export function showAboutOffline() {
  const list = (items, cls) => h('ul', { class: 'sy-offlist ' + cls }, items.map(t => h('li', null, t)));
  const view = h('div', { class: 'sy-off', dataset: { tag: 'about_offline' } },
    h('div', { class: 'sy-note' }, '회사·기관의 내부망(인터넷이 막힌 환경)에서도 대부분의 기능을 쓸 수 있습니다.'),
    h('div', { class: 'sy-offhead need' }, ico('ic_wifi_off', 18), '인터넷이 필요한 기능'), list(OFFLINE_NEEDS, 'need'),
    h('div', { class: 'sy-offhead ok' }, ico('ic_check', 18), '오프라인에서도 되는 기능'), list(OFFLINE_WORKS, 'ok'),
    h('div', { class: 'sy-note small' }, '인터넷이 필요한 기능을 오프라인에서 누르면 안내 메시지만 표시되며, 문서와 필기는 그대로 안전합니다.'));
  return cardDialog({ title: '오프라인에서 사용하기', view, negative: ['닫기'], width: 'min(92vw,440px)' });
}

const HOWTO = [
  ['Google Cloud 콘솔(console.cloud.google.com)에 로그인하고 새 프로젝트를 만듭니다.'],
  ['‘API 및 서비스 → 라이브러리’에서 Google Drive API를 찾아 ‘사용’을 누릅니다.'],
  ['‘OAuth 동의 화면’을 만듭니다: 사용자 유형 ‘외부’, 앱 이름 ‘Everynote’, 본인 이메일 입력. 범위(Scopes)에 ‘…/auth/drive.file’을 추가하고, ‘테스트 사용자’에 본인 Google 계정을 추가합니다.'],
  ['‘사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID’를 고르고 애플리케이션 유형을 ‘데스크톱 앱’으로 만듭니다.'],
  ['표시되는 클라이언트 ID와 클라이언트 보안 비밀번호를 아래 칸에 붙여넣고 ‘저장’한 뒤 ‘Google 로그인’을 누릅니다.'],
];

export function showSyncSettings(app) {
  const ctl = getSyncController(app);
  const el = {};
  const swRow = (label, key, def, onchange) => {
    const input = h('input', { type: 'checkbox', class: 'sy-cb' }); input.checked = prefs.getBoolean(key, def);
    input.addEventListener('change', () => { prefs.putBoolean(key, input.checked); if (onchange) onchange(input.checked); });
    return { input, row: h('label', { class: 'sy-check' }, input, h('span', null, label)) };
  };

  // --- enable
  const sw = h('button', { class: 'sy-switch', type: 'button', role: 'switch', 'aria-label': 'Google 드라이브 동기화 사용', dataset: { tag: 'sync_enable' } }, h('i'));
  const paintSwitch = () => { const on = ctl.enabled; sw.classList.toggle('on', on); sw.setAttribute('aria-checked', String(on)); el.body.classList.toggle('off', !on); };
  sw.addEventListener('click', () => { prefs.putBoolean(K.enabled, !ctl.enabled); ctl.applyAuto(); paintSwitch(); if (!ctl.enabled) ctl.cancel(); else refreshStatus(); });
  const head = h('div', { class: 'sy-head' }, h('div', { class: 'sy-headtext' }, h('div', { class: 'sy-h1' }, 'Google 드라이브 동기화'),
    h('div', { class: 'sy-note' }, `내 드라이브의 ‘${SYNC_FOLDER}’ 폴더와 문서함을 맞춥니다. 모바일(Android) 앱의 필기 내보내기 형식을 그대로 쓰며, 기본값은 꺼짐입니다. 인터넷이 필요합니다.`)), sw);

  // --- account
  el.account = h('div', { class: 'sy-account' }); el.accMsg = h('div', { class: 'sy-note' });
  el.signIn = h('button', { class: 'sy-btn primary', type: 'button', dataset: { tag: 'sync_signin' } }, 'Google 로그인');
  el.signOut = h('button', { class: 'sy-btn', type: 'button', dataset: { tag: 'sync_signout' } }, '로그아웃');
  el.cid = h('input', { class: 'sy-in', type: 'text', placeholder: '클라이언트 ID (….apps.googleusercontent.com)', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'OAuth 클라이언트 ID', dataset: { tag: 'sync_client_id' } });
  el.csec = h('input', { class: 'sy-in', type: 'password', placeholder: '클라이언트 보안 비밀번호', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'OAuth 클라이언트 보안 비밀번호', dataset: { tag: 'sync_client_secret' } });
  el.saveCfg = h('button', { class: 'sy-btn', type: 'button', dataset: { tag: 'sync_save_config' } }, '저장');
  el.cfgHint = h('div', { class: 'sy-note small' });
  const howto = h('div', { class: 'sy-howto' }, h('div', { class: 'sy-sec first' }, 'OAuth 클라이언트 만들기 (처음 한 번)'),
    h('ol', null, HOWTO.map(s => h('li', null, s[0]))),
    h('div', { class: 'sy-note small' }, '※ 앱을 ‘테스트’ 상태로 두면 로그인이 7일마다 풀릴 수 있습니다. 오래 쓰려면 동의 화면을 ‘프로덕션으로 게시’하세요(본인만 쓰는 앱은 검증 없이 가능, 경고 화면이 보입니다). 회사 Google Workspace 계정은 관리자가 외부 앱을 막았을 수 있습니다.'));
  el.cfgBox = h('details', { class: 'sy-how', dataset: { tag: 'sync_oauth' } }, h('summary', null, 'OAuth 클라이언트 설정 (클라이언트 ID · 비밀번호)'),
    howto, h('div', { class: 'sy-sec' }, '클라이언트 ID / 보안 비밀번호'), h('div', { class: 'sy-cfg' }, el.cid, el.csec, el.saveCfg), el.cfgHint);
  el.account.append(h('div', { class: 'sy-sec first' }, 'Google 계정'), h('div', { class: 'sy-accrow' }, el.accMsg, el.signIn, el.signOut), el.cfgBox);

  let cached = { signedIn: false, email: '', configured: false };
  async function refreshStatus() {
    const st = await ctl.status(); cached = st;
    if (st.error) { el.accMsg.textContent = '이 환경에서는 Google 연동을 사용할 수 없습니다.'; el.signIn.disabled = true; el.signOut.style.display = 'none'; el.cfgHint.textContent = ''; return; }
    el.accMsg.textContent = st.signedIn ? `로그인됨: ${st.email || '(이메일 없음)'}` : (st.configured ? '로그인되지 않음' : '먼저 OAuth 클라이언트를 설정하세요');
    el.accMsg.classList.toggle('ok', !!st.signedIn);
    el.cfgBox.open = !st.configured; el.signIn.style.display = st.signedIn ? 'none' : ''; el.signOut.style.display = st.signedIn ? '' : 'none'; el.signIn.disabled = !st.configured;
    el.cfgHint.textContent = st.configured ? '클라이언트가 저장되어 있습니다. 바꾸려면 새 값을 입력하고 저장하세요 (비밀번호는 다시 표시하지 않습니다).' : '';
    el.cid.placeholder = st.configured ? '(저장됨) 새 클라이언트 ID' : '클라이언트 ID (….apps.googleusercontent.com)';
    el.run.disabled = !st.signedIn || ctl.running;
  }
  const friendly = e => new DriveSync()._mapError(e).message;
  el.saveCfg.addEventListener('click', async () => {
    const clientId = el.cid.value.trim(), clientSecret = el.csec.value.trim();
    if (!clientId || !clientSecret) { toast('클라이언트 ID와 보안 비밀번호를 모두 입력하세요'); return; }
    try { await host.call('google.config', { clientId, clientSecret }); el.cid.value = ''; el.csec.value = ''; toast('OAuth 클라이언트를 저장했습니다'); addLog('OAuth 클라이언트 저장'); }
    catch (e) { toast('저장하지 못했습니다: ' + (e.message || e)); }
    refreshStatus();
  });
  el.signIn.addEventListener('click', async () => {
    el.signIn.disabled = true; el.accMsg.textContent = '브라우저에서 Google 로그인을 마치세요…';
    try { const r = await host.call('google.signIn'); addLog('로그인: ' + (r && r.email || '')); toast('로그인했습니다'); }
    catch (e) { const m = friendly(e); toast(m.length > 90 ? '로그인하지 못했습니다' : m); addLog('로그인 실패: ' + (e.message || e)); setMsg(m, true); }
    refreshStatus();
  });
  el.signOut.addEventListener('click', async () => {
    try { await host.call('google.signOut'); addLog('로그아웃'); toast('로그아웃했습니다'); } catch (e) { toast('로그아웃하지 못했습니다: ' + (e.message || e)); }
    refreshStatus();
  });

  // --- what / when
  const what = h('div', { class: 'sy-what' });
  const cbPdf = swRow('PDF 파일 (문서함 폴더 구조 그대로)', K.pdfs, true), cbAnn = swRow('필기 · 주석 (모바일 앱 형식)', K.ann, true), cbAst = swRow('이미지·녹음 등 자료 (assets 폴더)', K.assets, true);
  cbPdf.input.dataset.tag = 'sync_pdfs'; cbAnn.input.dataset.tag = 'sync_ann'; cbAst.input.dataset.tag = 'sync_assets';
  what.append(h('div', { class: 'sy-sec' }, '동기화 대상'), cbPdf.row, cbAnn.row, cbAst.row);
  const autoRow = h('div', { class: 'sy-seg', role: 'radiogroup', 'aria-label': '자동 동기화' });
  const paintAuto = () => [...autoRow.children].forEach((b, i) => { b.classList.toggle('on', i === prefs.getInt(K.auto, 0)); b.setAttribute('aria-checked', String(i === prefs.getInt(K.auto, 0))); });
  AUTO_LABELS.forEach((t, i) => autoRow.append(h('button', { class: 'sy-chip', type: 'button', role: 'radio', dataset: { tag: 'sync_auto:' + i }, onclick: () => { prefs.putInt(K.auto, i); ctl.applyAuto(); paintAuto(); } }, t)));
  const auto = h('div', null, h('div', { class: 'sy-sec' }, '자동 동기화'), autoRow, h('div', { class: 'sy-note small' }, '‘열 때·닫을 때’: 앱을 시작한 직후와 창을 내릴 때 시도합니다. 자동 동기화는 삭제를 반영하지 않고 보류합니다.'));

  // --- run
  el.run = h('button', { class: 'sy-btn primary big', type: 'button', dataset: { tag: 'sync_now' } }, ico('ic_cloud_sync', 18, '#fff'), h('span', null, '지금 동기화'));
  el.cancel = h('button', { class: 'sy-btn', type: 'button', style: { display: 'none' }, dataset: { tag: 'sync_cancel' } }, '취소');
  el.bar = h('div', { class: 'sy-bar' }, h('i')); el.barText = h('div', { class: 'sy-note small', dataset: { tag: 'sync_progress' } });
  el.last = h('div', { class: 'sy-last', dataset: { tag: 'sync_last' } });
  const setMsg = (m, err) => { el.last.textContent = m; el.last.classList.toggle('err', !!err); };
  const paintLast = () => {
    const err = prefs.getString(K.lastErr, ''), ms = +prefs.getString(K.lastMs, '0');
    if (!ms) { setMsg('아직 동기화한 적이 없습니다'); return; }
    if (err) setMsg(`마지막 시도 ${fmtDate(ms)} — 실패: ${err}`, true); else setMsg(`마지막 동기화 ${fmtDate(ms)} — ${prefs.getString(K.lastText, '')}`);
  };
  const paintRun = () => {
    const r = ctl.running; el.cancel.style.display = r ? '' : 'none'; el.run.disabled = r || !cached.signedIn; el.bar.classList.toggle('on', r);
    if (!r) { el.bar.firstChild.style.width = '0%'; }
  };
  el.run.addEventListener('click', () => {
    if (!cached.configured) { toast('먼저 OAuth 클라이언트를 설정하세요'); return; }
    if (!cached.signedIn) { toast('먼저 Google 로그인을 하세요'); return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { setMsg(MESSAGES.offline, true); toast('인터넷에 연결되어 있지 않습니다'); return; }
    ctl.syncNow({ interactive: true });
  });
  el.cancel.addEventListener('click', () => { ctl.cancel(); el.barText.textContent = '취소하는 중…'; });
  const unsub = ctl.subscribe(e => {
    if (e.type === 'start') { paintRun(); el.barText.textContent = '시작하는 중…'; setMsg('동기화 중…'); }
    else if (e.type === 'progress') {
      const p = e.p; el.barText.textContent = p.text || '';
      const pct = p.total ? Math.min(100, Math.round(p.done / p.total * 100)) : (p.phase === 'scan' ? 5 : 0); el.bar.firstChild.style.width = pct + '%';
    } else if (e.type === 'done' || e.type === 'error') { paintRun(); el.barText.textContent = e.type === 'done' ? (e.summary.cancelled ? MESSAGES.cancelled : '') : ''; paintLast(); if (e.type === 'error' && e.err && e.err.code === 'auth') refreshStatus(); }
  });

  // --- log
  el.log = h('pre', { class: 'sy-log', dataset: { tag: 'sync_log' }, tabindex: '0' });
  const paintLog = () => { el.log.textContent = getLog().join('\n') || '(기록 없음)'; el.log.scrollTop = el.log.scrollHeight; };
  const onLog = l => { if (l == null) paintLog(); else { if (el.log.textContent === '(기록 없음)') el.log.textContent = ''; el.log.append((el.log.textContent ? '\n' : '') + l); el.log.scrollTop = el.log.scrollHeight; } };
  logSubs.add(onLog);
  const logBtns = h('div', { class: 'sy-row' }, h('button', { class: 'sy-btn', type: 'button', onclick: () => { clearLog(); } }, '로그 지우기'),
    h('button', { class: 'sy-btn', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(getLog().join('\n')); toast('로그를 복사했습니다'); } catch (e) { toast('복사하지 못했습니다'); } } }, '로그 복사'));

  el.body = h('div', { class: 'sy-body' }, el.account,
    h('div', { class: 'sy-sec' }, '동기화'), h('div', { class: 'sy-row' }, el.run, el.cancel), el.bar, el.barText, el.last,
    what, auto, h('div', { class: 'sy-sec' }, '로그'), el.log, logBtns);
  const view = h('div', { class: 'sy-wrap', dataset: { tag: 'sync_settings' } }, head, el.body,
    h('div', { class: 'sy-note small foot' }, '동기화는 이 앱이 만든 파일만 건드립니다(Drive 권한 drive.file). 같은 파일을 양쪽에서 고치면 더 최근 수정본을 쓰고 다른 쪽은 ‘충돌 사본’으로 남깁니다. 삭제는 확인 후에만 반영하며 휴지통으로 보냅니다.'));
  paintSwitch(); paintAuto(); paintLast(); paintLog(); paintRun();
  const d = cardDialog({ title: '구글 드라이브 동기화', view, negative: ['닫기'], onDismiss: () => { unsub(); logSubs.delete(onLog); } });
  refreshStatus().then(paintRun);
  return d;
}
