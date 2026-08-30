// ============================================================
// "표준 명령 조립" (fn_ks_command) — execute_control 의 3번 출력(link)으로 넘어온 제어를
// ks3267d 데몬 REST 명령으로 바꾼다. (KS X 3267 표준노드 탭, 2026-08-30 P3)
//
// 입력 msg.control = { houseId, deviceId, command, duration, modbus:{ protocol:'ks3267', unit, kind, n } }
// 우리 명령 → 표준 명령 (6.3.3 / 6.3.4, 레벨1):
//   스위치: on → ON(201) / off → OFF(0) / on + duration>0 → TIMED_ON(202, 초)
//   개폐기: open → OPEN(301) / close → CLOSE(302) / stop → STOP(0)
//           open + duration>0 → TIMED_OPEN(303) / close + duration>0 → TIMED_CLOSE(304)
// 레벨2(SET_POSITION 등)는 만들지 않는다 — 데몬도 로컬에서 거부한다 (스코프 선언 일치).
// ============================================================
const ctrl = msg.control || {};
const m = ctrl.modbus || {};
const cmd = String(ctrl.command || '').toLowerCase();
const dur = Number(ctrl.duration || 0);

if (m.protocol !== 'ks3267' || !m.unit || !m.kind || !m.n) {
    node.error('표준 명령 조립: modbus 프로필 불완전 ' + JSON.stringify(m), msg);
    return null;
}

let op = null;
if (m.kind === 'switch') {
    if (cmd === 'on' || cmd === 'open') op = dur > 0 ? 'timed_on' : 'on';
    else if (cmd === 'off' || cmd === 'close' || cmd === 'stop') op = 'off';
} else if (m.kind === 'opener') {
    if (cmd === 'open') op = dur > 0 ? 'timed_open' : 'open';
    else if (cmd === 'close') op = dur > 0 ? 'timed_close' : 'close';
    else if (cmd === 'stop') op = 'stop';
}
if (!op) {
    node.error('표준 명령 조립: ' + m.kind + ' 에 ' + cmd + ' 는 대응 명령 없음', msg);
    return null;
}

const api = env.get('KS3267_API') || 'http://127.0.0.1:3002';
msg.url = api + '/command';
msg.method = 'POST';
msg.headers = { 'Content-Type': 'application/json' };
msg.payload = { unit: Number(m.unit), kind: m.kind, n: Number(m.n), op: op, seconds: dur > 0 ? Math.round(dur) : 0 };
msg.requestTimeout = 5000;
msg._ksControl = ctrl;   // 결과 처리에서 사용

node.status({ fill: 'blue', shape: 'dot', text: ctrl.deviceId + ' → ' + op + (dur > 0 ? ' ' + Math.round(dur) + 's' : '') });
node.warn('📤 KS3267 명령: unit ' + m.unit + ' ' + m.kind + m.n + ' ' + op + (dur > 0 ? ' (' + Math.round(dur) + '초)' : '') + ' [' + ctrl.deviceId + ']');
return msg;
