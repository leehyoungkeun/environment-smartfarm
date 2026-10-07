// ============================================================
// "표준 명령 결과" (fn_ks_result) — 데몬 응답을 상태·이력에 반영. (KS X 3267 표준노드 탭, P3)
//
// 입력: msg.payload = 데몬 /command 응답 { ok, accepted, opid, status, status_name, remain, error?, exception? }
//       msg._ksControl = 원 제어 정보
// 출력 1: 제어 이력(서버 POST /internal/control-log) — 성공/거부 모두 기록 (fix ⑧ 과 같은 원칙)
// 출력 2: (예비) 상태 발행
// ============================================================
const r = (typeof msg.payload === 'object' && msg.payload) || {};
const ctrl = msg._ksControl || {};
const m = ctrl.modbus || {};
const dkey = global.get('dkey') || function (h, dv) { return (h || 'house_0001') + ':' + dv; };
const DK = dkey(ctrl.houseId, ctrl.deviceId);

const ok = !!(r.ok && r.accepted !== false);
if (ok) {
    const states = global.get('deviceStates') || {};
    const c = String(ctrl.command || '').toLowerCase();
    if (m.kind === 'switch') states[DK] = (c === 'off' || c === 'close' || c === 'stop') ? 'off' : 'on';
    else states[DK] = c === 'open' ? 'open' : (c === 'close' ? 'closed' : 'idle');
    global.set('deviceStates', states);
    node.status({ fill: 'green', shape: 'dot', text: ctrl.deviceId + ' ' + (r.status_name || '') + (r.remain ? ' ' + r.remain + 's' : '') + ' opid ' + r.opid });
    node.warn('✅ KS3267 ' + ctrl.deviceId + ' ' + ctrl.command + ' → ' + (r.status_name || r.status) + ' (opid ' + r.opid + (r.remain ? ', 남은 ' + r.remain + 's' : '') + ')');
} else {
    node.status({ fill: 'red', shape: 'ring', text: ctrl.deviceId + ' 실패: ' + (r.error || msg.statusCode) });
    node.warn('❌ KS3267 ' + ctrl.deviceId + ' ' + ctrl.command + ' 실패: ' + (r.error || ('HTTP ' + msg.statusCode)) + (r.exception ? ' (예외 0x0' + r.exception + ')' : ''));
}

// 제어 이력 — 서버 (거부도 기록: "왜 안 됐지" 추적)
const pcServer = global.get('pcServerUrl') || 'https://api.smartgreen.kr';
const logMsg = {
    method: 'POST',
    url: pcServer + '/internal/control-log',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.get('SENSOR_API_KEY') || global.get('sensorApiKey') || '' },
    payload: {
        farmId: global.get('farmId') || env.get('FARM_ID') || 'farm_0001',
        houseId: ctrl.houseId || 'house_0001',
        deviceId: ctrl.deviceId,
        deviceType: ctrl.deviceType || (m.kind === 'opener' ? 'window' : 'relay'),
        deviceName: ctrl.deviceName || ctrl.deviceId,
        command: ctrl.command,
        success: ok,
        operator: ctrl.operator || 'unknown',
        reason: ok ? ('KS X 3267 ' + (r.status_name || '') + ' opid ' + r.opid) : ('KS X 3267 실패: ' + (r.error || msg.statusCode)),
        requestId: ctrl.requestId || null,
        metadata: { protocol: 'ks3267', unit: m.unit, kind: m.kind, n: m.n, opid: r.opid, status: r.status, remain: r.remain, exception: r.exception || null }
    }
};
return [logMsg, null];
