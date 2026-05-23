// ============================================================
// 자동 OFF 예약 — NR function 2 (MQTT 파싱 + Modbus 매핑) 보강
//
// 위치: 'AWS IoT 제어 수신' 또는 '제어 수신' 탭의 function 2 노드 (MQTT 파서)
// 적용 방법:
//   1. NR 에디터에서 기존 function 2 노드 더블클릭 → '함수' 탭 열기
//   2. 기존 코드 전체 백업 후 이 파일 내용으로 교체
//   3. 출력: 1개 (기존과 동일)
//   4. 우측 상단 '완료' → 'Deploy'
//
// 동작:
//   - command === 'schedule-off' (with delay_sec): setTimeout 등록 + global 저장 → 만료 시 'off' 메시지 송출
//   - command === 'schedule-off-cancel': clearTimeout + global 삭제
//   - 그 외 (on/off/open/close/stop): 기존 파싱 로직
//
// 영구화: global.set('scheduledOff', ...) 가 localfilesystem context 에 저장됨.
// NR 재시작 시 별도 startup 노드 (nodered-schedule-off-startup.js) 가 timer 재등록.
//
// 중요: setTimeout 만료 시 msg.control + msg.payload 모두 설정 (downstream modbus mapper 호환).
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

// ──────── device 유형 판별 (재사용 helper) ────────
const guessDeviceType = (id) => {
    if (id.startsWith('window')) return 'window';
    if (id.startsWith('fan')) return 'fan';
    if (id.startsWith('heater')) return 'heater';
    if (id.startsWith('cooler') || id.startsWith('aircon')) return 'aircon';
    if (id.startsWith('valve')) return 'valve';
    if (id.startsWith('pump')) return 'pump';
    if (id.startsWith('light')) return 'light';
    return 'unknown';
};

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
    const savedModbus = payload.modbus || null;

    // setTimeout — 만료 시 msg.control + msg.payload 모두 설정해 downstream 통과
    const timerId = setTimeout(() => {
        node.warn(`⏰ 예약 만료 → OFF 실행: ${key}`);
        const offTs = new Date().toISOString();
        node.send({
            topic: `smartfarm/${houseId}/${deviceId}/control`,
            payload: {
                house_id: houseId,
                window_id: deviceId,
                command: 'off',
                operator: 'schedule_off_timer',
                request_id: offRequestId,
                timestamp: offTs,
                modbus: savedModbus,
                duration: 0,
            },
            // downstream modbus mapper 가 msg.control 을 참조하므로 pre-populate 필수
            control: {
                houseId,
                deviceId,
                deviceType: guessDeviceType(deviceId),
                command: 'off',
                operator: 'schedule_off_timer',
                requestId: offRequestId,
                timestamp: offTs,
                modbus: savedModbus,
                duration: 0,
                raw: {},
            },
        });
        // global cleanup
        const s = global.get('scheduledOff') || {};
        delete s[key];
        global.set('scheduledOff', s);
    }, delaySec * 1000);

    sched[key] = {
        atMs,
        timerId,                 // Timer 객체 — 같은 세션에서만 유효 (clearTimeout 용)
        deviceId,
        houseId,
        deviceType: guessDeviceType(deviceId),
        modbus: savedModbus,
        scheduledBy: operator,
        scheduledAt: timestamp,
    };
    global.set('scheduledOff', sched);

    const min = Math.round(delaySec / 60);
    node.warn(`📅 예약 등록: ${key} — ${min}분 후 OFF (${new Date(atMs).toLocaleTimeString('ko-KR', { hour12: false })})`);
    node.status({ fill: 'yellow', shape: 'dot', text: `예약 ${key} ${min}분` });
    return null;  // off 명령은 만료 시 별도 송출, 지금은 forward 안 함
}

// ──────── 그 외 명령 — 기존 파싱 로직 ────────
const deviceType = guessDeviceType(deviceId);

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
