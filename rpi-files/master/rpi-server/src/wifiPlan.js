// WiFi 연결 판단 — 순수 함수만 둔다 (2026-09-15)
//
// 사고 (farm_0001, 새 장소 603ho):
//   비밀번호를 한 번 틀리자 NetworkManager 가 그 틀린 비밀번호로 프로필을 저장했다(connection-add-activate).
//   화면은 "저장돼 있으면 비밀번호를 묻지 않는다" 규칙 때문에 두 번째 시도에서 키보드를 숨겼고,
//   고친 비밀번호는 끝까지 전달되지 않았다 — 그날 603ho 에 connection-update 0건.
//   틀린 프로필은 자동 연결이 켜진 채 남아, 실패할 때마다 무선을 2분씩(need-auth) 붙잡았다.
//   서버는 그 상태를 모르고 45초를 기다린 뒤 모호한 실패만 돌려줬다.
//
// 원칙
//   - '저장됨' 은 실제로 한 번이라도 연결에 성공한 프로필뿐이다 (connection.timestamp > 0).
//   - 실패한 새 시도가 만든 프로필은 지운다. 한 번 성공했던 프로필은 지우지 않고 원래 비밀번호로 되돌린다.
//   - 비밀번호를 새로 받으면 저장된 프로필의 비밀번호를 명시적으로 바꾼 뒤 올린다.
//   - 연결 결과는 장치 상태를 짧게 확인해 판정한다. need-auth 가 이어지면 비밀번호가 틀린 것이다.
//
// 시험: backend/test/unit/wifi-plan.test.js

'use strict';

/** NetworkManager connection.timestamp — 한 번도 활성화된 적 없으면 0 */
function isEverConnected(timestamp) {
  const n = Number(String(timestamp == null ? '' : timestamp).trim());
  return Number.isFinite(n) && n > 0;
}

/**
 * 연결 요청을 어떻게 처리할지 정한다.
 * @param {{ password?: string, profile?: { name: string, everConnected: boolean } | null }} input
 * @returns {{ action: 'up-saved'|'need-password'|'modify-then-up'|'add-connect',
 *            deleteStale: boolean, deleteOnFail: boolean, restorePskOnFail: boolean }}
 */
function planConnect(input) {
  const { password, profile } = input || {};
  const hasPw = typeof password === 'string' && password.length > 0;
  const p = profile || null;
  if (!hasPw) {
    if (p && p.everConnected) {
      return { action: 'up-saved', deleteStale: false, deleteOnFail: false, restorePskOnFail: false };
    }
    if (p) {
      // 한 번도 성공 못 한 프로필 = 틀린 비밀번호가 저장된 것일 가능성이 크다. 쓰지 않고 지운 뒤 비밀번호를 받는다.
      return { action: 'need-password', deleteStale: true, deleteOnFail: false, restorePskOnFail: false };
    }
    // 저장된 것도 비밀번호도 없음 = 공개 망 시도. 실패하면 흔적을 남기지 않는다.
    return { action: 'add-connect', deleteStale: false, deleteOnFail: true, restorePskOnFail: false };
  }
  if (p) {
    return { action: 'modify-then-up', deleteStale: false, deleteOnFail: !p.everConnected, restorePskOnFail: !!p.everConnected };
  }
  return { action: 'add-connect', deleteStale: false, deleteOnFail: true, restorePskOnFail: false };
}

/** "60 (need-auth)" → 60 */
function stateCode(text) {
  const m = String(text || '').match(/^\s*(\d+)/);
  return m ? Number(m[1]) : NaN;
}

/**
 * 연결 시도 중 장치 상태 한 번을 판정한다.
 * 시작 직후에는 NetworkManager 가 비밀번호 확인을 위해 need-auth 를 순간적으로 거친다(1ms 이내, 로그로 확인).
 * 그래서 need-auth 는 3초가 지나고 두 번 연속 보일 때만 비밀번호 틀림으로 본다.
 * @param {{ code:number, connection:string, target:string, elapsedMs:number, needAuthStreak:number, limitMs:number }} s
 * @returns {'connected'|'wrong_password'|'failed'|'timeout'|'waiting'}
 */
function classifyState(s) {
  const { code, connection, target, elapsedMs, needAuthStreak, limitMs } = s;
  if (code === 100 && connection === target) return 'connected';
  if (code === 60 && elapsedMs >= 3000 && needAuthStreak >= 2) return 'wrong_password';
  if (elapsedMs >= 3000 && (code === 120 || code === 30 || (code === 100 && connection !== target))) return 'failed';
  if (elapsedMs >= limitMs) return 'timeout';
  return 'waiting';
}

/**
 * wpa_supplicant·NetworkManager 저널로 실패 종류를 가른다 (2026-09-16).
 * 사고: 705ho 에 붙이려는데 공유기가 인증 요청에 답하지 않았다(ASSOC-REJECT status 16, "association took too long").
 *   NetworkManager 는 이때도 need-auth 로 들어가 "새 비밀번호를 달라" 고 하므로 장치 상태만 보면 비밀번호 틀림과 구분이 안 된다.
 *   화면이 "비밀번호가 맞지 않습니다" 라 해서 사용자가 맞는 비밀번호를 몇 번이나 다시 넣었다. 진짜 비밀번호 틀림은
 *   4-way 핸드셰이크에서 실패하고 wpa_supplicant 가 reason=WRONG_KEY 를 남긴다.
 * @returns {'wrong_password'|'no_response'|'not_found'|null}
 */
function diagnoseSupplicant(logText) {
  const t = String(logText || '');
  if (/reason=WRONG_KEY|4way_handshake -> disconnected|4-way handshake failed/i.test(t)) return 'wrong_password';
  if (/ssid-not-found|No network with SSID/i.test(t)) return 'not_found';
  if (/CTRL-EVENT-ASSOC-REJECT|reason=CONN_FAILED|association took too long|CTRL-EVENT-AUTH-REJECT/i.test(t)) return 'no_response';
  return null;
}

/** 사람이 읽을 실패 사유. signal 은 마지막 스캔의 신호 세기(%) — 있으면 함께 알려 준다. */
function failureMessage(outcome, nmcliText, signal) {
  if (outcome === 'wrong_password') {
    return { reason: 'wrong_password', message: '비밀번호가 맞지 않습니다. 대소문자와 기호를 확인해 다시 입력하세요.' };
  }
  if (outcome === 'no_response') {
    const sig = Number.isFinite(Number(signal)) && signal !== null ? ` (신호 ${Number(signal)}%)` : '';
    return { reason: 'no_response',
      message: `공유기가 이 제어기의 접속 요청에 답하지 않습니다${sig}. 비밀번호 문제가 아닙니다 — 제어기를 공유기 가까이로 옮기거나 공유기를 다시 켠 뒤 시도하세요.` };
  }
  const t = String(nmcliText || '');
  if (outcome === 'not_found' || /no network with ssid/i.test(t)) {
    return { reason: 'not_found', message: '이 WiFi 신호를 찾지 못했습니다. 공유기 가까이에서 다시 찾아보세요.' };
  }
  if (outcome === 'timeout') {
    return { reason: 'timeout', message: '공유기가 응답하지 않았습니다. 신호가 약하거나 비밀번호가 틀렸을 수 있습니다.' };
  }
  const first = t.split(/\r?\n/).find(Boolean);
  return { reason: 'failed', message: first ? first.replace(/^Error:\s*/, '').slice(0, 200) : '연결하지 못했습니다.' };
}

// ── 화면의 「현재 연결」 (2026-09-15) ────────────────────────────────────
// 사고: 703HO 비밀번호 시험이 실패해 끊기는 순간, 활성 연결 목록(con show --active)에 703HO 가 남아 있어
// 화면이 현재 연결을 703HO 로 표시했다. 원래 망(603ho)으로 돌아간 뒤에도 화면은 다시 읽지 않아 그대로였다.
// 그 목록에는 연결 중·끊기는 중인 연결도 들어 있다. 장치 상태(nmcli dev)가 connected 일 때만 '연결됨' 이다.

/** nmcli dev 의 STATE 문자열 → connected | connecting | disconnected */
function linkState(stateText) {
  const t = String(stateText || '').trim();
  if (/^connected/.test(t)) return 'connected';                         // 'connected (externally)' 포함
  if (/^(connecting|disconnecting|deactivating)/.test(t)) return 'connecting';
  return 'disconnected';
}

/** "2412 MHz" → 2.4GHz */
function bandOf(freqText) {
  const mhz = parseInt(String(freqText || ''), 10);
  if (!Number.isFinite(mhz)) return null;
  if (mhz < 3000) return '2.4GHz';
  if (mhz < 5925) return '5GHz';
  return '6GHz';
}

const INTERNET_LABEL = {
  full: '정상',
  limited: '제한됨 — 공유기까지만 연결',
  portal: '로그인 필요 — 공유기 인증 화면',
  none: '없음',
};

/**
 * @param {{ device?: string[], apRows?: string[][], ipText?: string, connectivity?: string }} input
 *   device: nmcli -t -f DEVICE,TYPE,STATE,CONNECTION dev 의 wlan0 행
 *   apRows: nmcli -t -f IN-USE,SSID,SIGNAL,FREQ,CHAN,RATE,SECURITY dev wifi list 의 행들
 *   ipText: nmcli -g IP4.ADDRESS,IP4.GATEWAY dev show wlan0 출력
 *   connectivity: nmcli networking connectivity 출력
 */
function describeLink(input) {
  const { device, apRows, ipText, connectivity } = input || {};
  const d = device || [];
  const state = linkState(d[2]);
  const name = d[3] ? String(d[3]) : null;
  const ap = state === 'connected' ? (apRows || []).find((r) => r[0] === '*') : null;
  const lines = String(ipText || '').split(/\r?\n/);
  const addr = (lines[0] || '').split(' | ')[0].trim();
  const [ip, prefix] = addr ? addr.split('/') : [null, null];
  const code = String(connectivity || '').trim() || 'unknown';
  const up = state === 'connected';
  return {
    state,
    stateText: d[2] ? String(d[2]) : 'unavailable',
    ssid: ap ? ap[1] : name,
    signal: ap ? Number(ap[2]) || 0 : null,
    band: ap ? bandOf(ap[3]) : null,
    channel: ap ? Number(ap[4]) || null : null,
    rate: ap ? ap[5] || null : null,
    security: ap ? (ap[6] && ap[6] !== '--' ? ap[6] : '없음') : null,
    ip: up && ip ? ip : null,
    prefix: up && prefix ? Number(prefix) : null,
    gateway: up ? ((lines[1] || '').trim() || null) : null,
    internetCode: up ? code : 'none',
    internet: up ? (INTERNET_LABEL[code] || '확인 불가') : '없음',
  };
}

module.exports = { isEverConnected, planConnect, stateCode, classifyState, diagnoseSupplicant, failureMessage, linkState, bandOf, describeLink };
