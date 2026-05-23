// ============================================================
// 자동 OFF 예약 — NR function 2 (MQTT 파싱 + Modbus 매핑) 보강
//
// 위치: 양액 자동제어 또는 제어 수신 탭의 function 2 노드
// 적용 방법:
//   1. 기존 function 2 코드를 백업
//   2. 이 파일 내용을 function 2 노드에 붙여넣기 (NR 에디터)
//   3. 출력: 1개 (기존과 동일 — modbus write 로 향함)
//   4. Deploy
//
// 동작:
//   - command === 'schedule-off' (with delay_sec): setTimeout 등록 + global 저장 → 만료 시 off 실행
//   - command === 'schedule-off-cancel': clearTimeout + global 삭제
//   - 그 외 (on/off/open/close/stop): 기존 로직 그대로
//
// 영구화: global.set('scheduledOff', ...) 가 localfilesystem context 에 저장됨.
// NR 재시작 시 별도 startup 노드 (nodered-schedule-off-startup.js) 가 timer 재등록.
// ============================================================

const topicParts = msg.topic ? msg.topic.split('/') : [];
const payload = msg.payload || {};
const houseId = topicParts[1] || payload.house_id || 'unknown';
const deviceId = topicParts[2] || payload.window_id || payload.device_id || 'unknown';
const command = (payload.command || 'unknown').toLowerCase();
const operator = payload.operator || 'unknown';
const requestId = payload.request_id || '';
const timestamp = payload.timestamp || new Date().toISOString();
const delaySec = parseInt(payload.delay_sec, 10) || 0;

// ──────── 자동 OFF 예약 / 취소 분기 ────────
if (command === 'schedule-off' || command === 'schedule-off-cancel') {
    const key = `${houseId}/${deviceId}`;
    const sched = global.get('scheduledOff') || {};

    // 기존 timer 있으면 항상 clear (재예약·취소 양쪽 공통)
    if (sched[key]?.timerId) {
        clearTimeout(sched[key].timerId);
    }

    if (command === 'schedule-off-cancel') {
        delete sched[key];
        global.set('scheduledOff', sched);
        node.warn(`🚫 예약 취소: ${key} (by ${operator})`);
        node.status({ fill: 'grey', shape: 'ring', text: `예약 취소 ${key}` });
        return null;
    }

    // schedule-off
    if (delaySec <= 0 || delaySec > 86400) {  // 0 ~ 24h 제한
        node.warn(`⚠ schedule-off 무시: delay_sec=${delaySec} (범위 외)`);
        return null;
    }

    const atMs = Date.now() + delaySec * 1000;
    const offRequestId = `sched-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

    // setTimeout — 만료 시 'off' 명령으로 자기 자신에게 재전송 → 기존 Modbus 경로 타게 함
    const timerId = setTimeout(() => {
        node.warn(`⏰ 예약 만료 → OFF 실행: ${key}`);
        node.send({
            topic: `smartfarm/${houseId}/${deviceId}/control`,
            payload: {
                house_id: houseId,
                window_id: deviceId,
                command: 'off',
                operator: 'schedule_off_timer',
                request_id: offRequestId,
                timestamp: new Date().toISOString(),
                modbus: sched[key]?.modbus || payload.modbus || null,
            },
        });
        const s = global.get('scheduledOff') || {};
        delete s[key];
        global.set('scheduledOff', s);
    }, delaySec * 1000);

    sched[key] = {
        atMs,
        timerId,
        deviceId,
        houseId,
        modbus: payload.modbus || null,
        scheduledBy: operator,
        scheduledAt: timestamp,
    };
    global.set('scheduledOff', sched);

    const min = Math.round(delaySec / 60);
    node.warn(`📅 예약 등록: ${key} — ${min}분 후 OFF (${new Date(atMs).toLocaleTimeString('ko-KR', { hour12: false })})`);
    node.status({ fill: 'yellow', shape: 'dot', text: `예약 ${key} ${min}분` });
    return null;
}

// ──────── 그 외 명령 — 기존 파싱 로직 ────────
// (이 부분은 기존 function 2 의 파싱 + msg.control 첨부 + 다음 노드 forward 그대로)
// ─────────────────────────────────────────

let deviceType = 'unknown';
if (deviceId.startsWith('window')) deviceType = 'window';
else if (deviceId.startsWith('fan')) deviceType = 'fan';
else if (deviceId.startsWith('heater')) deviceType = 'heater';
else if (deviceId.startsWith('cooler') || deviceId.startsWith('aircon')) deviceType = 'aircon';
else if (deviceId.startsWith('valve')) deviceType = 'valve';
else if (deviceId.startsWith('pump')) deviceType = 'pump';
else if (deviceId.startsWith('light')) deviceType = 'light';

msg.control = {
    houseId,
    deviceId,
    deviceType,
    command,
    operator,
    requestId,
    timestamp,
    modbus: payload.modbus || null,
    duration: payload.duration || 0,
    raw: payload,
};

const cmdLabels = {
    open: '열기', close: '닫기', stop: '정지',
    on: 'ON', off: 'OFF',
};
const label = cmdLabels[command] || command;

node.status({
    fill: 'green',
    shape: 'dot',
    text: `${label} ← ${houseId}/${deviceId} (${operator})`,
});

node.warn(`📥 제어 수신: ${houseId}/${deviceId} ${command.toUpperCase()} by ${operator} [${requestId}] duration=${payload.duration || 0}`);

return msg;
