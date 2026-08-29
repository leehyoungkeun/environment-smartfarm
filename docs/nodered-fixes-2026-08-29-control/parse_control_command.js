// ============================================================
// "제어 명령 파싱" (parse_control_command) — schedule-off 통합 + farmId 분기
//
// 위치: NR 에디터 "AWS IoT 제어 수신" 탭 → "제어 명령 파싱"
// 적용:
//   1. NR 에디터 → 노드 더블클릭
//   2. 함수 코드 전체 삭제 → 이 파일 내용으로 교체
//   3. 출력: 3개 (변경 없음 — execute_control, debug_received, send_ack)
//   4. Done → Deploy
//
// ⚠️ 동시에 권장 작업:
//   - 새 5-seg mqtt-in 의 link out wire 제거 (이미 했을 수 있음)
//   - function 2 + link in/out 노드 비활성 또는 삭제 (이 파일이 schedule-off 대신 처리)
//
// 변경 (2026-08-29): houseId 정규화 추가 — 아래 참조
// 변경 (2026-05-24, 양산 직전 정리):
//   - schedule-off / schedule-off-cancel setTimeout 등록 통합 (function 2 → parse 로 이동)
//   - 4-seg / 5-seg 토픽 둘 다 처리
//   - link in/out fan-out 제거로 NR 메시지 race 완전 해결 (첫 ON 안 됨 fix)
// ============================================================

// MQTT 토픽 파싱 — 4-seg / 5-seg 둘 다 처리
const topicParts = msg.topic.split('/');
const payload = msg.payload;
let farmId, houseId, deviceId;
if (topicParts.length >= 5) {
    // smartfarm/{farmId}/{houseId}/{deviceId}/control
    farmId = topicParts[1] || null;
    houseId = topicParts[2] || 'unknown';
    deviceId = topicParts[3] || 'unknown';
} else {
    // 옛 smartfarm/{houseId}/{deviceId}/control (호환)
    houseId = topicParts[1] || 'unknown';
    deviceId = topicParts[2] || 'unknown';
    farmId = payload.farm_id || null;
}

// ============================================================
// houseId 정규화 (2026-08-29 fix)
// ============================================================
// 프론트는 레거시 'house1' 표기로 보낸다 (MQTT 토픽 + 로컬 REST 둘 다).
// 정규형 'house_0001' 로 통일해야 자동화(② ⑤)와 같은 전역 키
// (deviceStates / devicePositions / modbus_cfg_*)를 본다.
// 안 하면 수동 제어와 자동화가 같은 장치를 서로 다른 키로 관리해
// "이미 열림 스킵"·부분 duration·stepped 진행 판정이 전부 무력화된다.
{
    const hm = String(houseId).match(/^house_?0*(\d+)$/);
    if (hm) houseId = 'house_' + String(hm[1]).padStart(4, '0');
}

const command = (payload.command || 'unknown').toLowerCase();
const operator = payload.operator || 'unknown';
const requestId = payload.request_id || '';
const timestamp = payload.timestamp || new Date().toISOString();

// ============================================================
// schedule-off / schedule-off-cancel 처리 (function 2 에서 통합)
// ============================================================
if (command === 'schedule-off' || command === 'schedule-off-cancel') {
    const key = `${houseId}/${deviceId}`;
    const sched = global.get('scheduledOff') || {};

    // 기존 timer 항상 clear
    if (sched[key] && sched[key].timerId) {
        clearTimeout(sched[key].timerId);
    }

    if (command === 'schedule-off-cancel') {
        delete sched[key];
        global.set('scheduledOff', sched);
        node.warn(`🚫 예약 취소: ${key}`);
        node.status({ fill: 'grey', shape: 'ring', text: `예약 취소 ${key}` });
        return null;
    }

    // schedule-off
    const delaySec = parseInt(payload.delay_sec, 10) || 0;
    if (delaySec <= 0 || delaySec > 86400) {
        node.warn(`⚠ schedule-off 무시: delay_sec=${delaySec} (범위 외)`);
        return null;
    }

    const dkeyFn = global.get('dkey') || function (h, dv) { return (h || 'house_0001') + ':' + dv; };
    const savedModbus = payload.modbus || global.get('modbus_cfg_' + dkeyFn(houseId, deviceId));

    if (!savedModbus) {
        node.warn(`⚠ schedule-off 무시: ${deviceId} modbus 설정 없음`);
        return null;
    }

    const atMs = Date.now() + delaySec * 1000;
    const offReqId = `sched-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const baseMsg = RED.util.cloneMessage(msg);

    const timerId = setTimeout(function () {
        try {
            node.warn(`⏰ 예약 만료 → OFF: ${key}`);

            const moduleType = savedModbus.moduleType || 'waveshare';
            const unitId = savedModbus.unitId || 1;
            const address = savedModbus.address;
            const address2 = savedModbus.address2;
            const controlType = savedModbus.controlType || 'single';

            let offPayload;
            if (moduleType === 'eletechsup') {
                offPayload = { fc: 6, unitid: unitId, address: address, quantity: 1, value: 0x0200 };
            } else {
                if (controlType === 'bidir') {
                    offPayload = { fc: 15, unitid: unitId, address: address, quantity: 2, value: [false, false] };
                } else {
                    offPayload = { fc: 15, unitid: unitId, address: address, quantity: 1, value: [false] };
                }
            }

            const offMsg = {
                topic: baseMsg.topic || `smartfarm/${farmId || ''}/${houseId}/${deviceId}/control`,
                payload: offPayload,
                _isLastWrite: true,
                _requestId: offReqId,
                control: {
                    farmId,
                    houseId,
                    deviceId,
                    command: 'off',
                    operator: 'schedule_off_timer',
                    requestId: offReqId,
                    timestamp: new Date().toISOString(),
                    modbus: savedModbus,
                },
            };

            global.set('_pendingModbus', { requestId: offReqId, isLastWrite: true });
            // ★ 출력 1 (execute_control 로) 발사 — modbus-flex-write 까지 도달
            node.send([offMsg, null, null]);

            node.status({ fill: 'blue', shape: 'dot', text: `예약 OFF 실행 ${key}` });

            // deviceStates 업데이트 — 다중 하우스: houseId 포함 키
            const dkeyOff = global.get('dkey') || function (h, dv) { return (h || 'house_0001') + ':' + dv; };
            const DKOFF = dkeyOff(houseId, deviceId);
            const dStates = global.get('deviceStates') || {};
            if (controlType === 'bidir') {
                dStates[DKOFF] = 'closed';
                const dPositions = global.get('devicePositions') || {};
                dPositions[DKOFF] = 0;
                global.set('devicePositions', dPositions);
            } else {
                dStates[DKOFF] = 'off';
            }
            global.set('deviceStates', dStates);

            // cleanup
            const s = global.get('scheduledOff') || {};
            delete s[key];
            global.set('scheduledOff', s);
        } catch (e) {
            node.error(`❌ schedule-off setTimeout 콜백 에러: ${e.message}\n${e.stack}`);
        }
    }, delaySec * 1000);

    sched[key] = {
        atMs,
        timerId,
        deviceId,
        houseId,
        farmId,
        modbus: savedModbus,
        scheduledAt: new Date().toISOString(),
        scheduledBy: payload.operator || 'unknown',
    };
    global.set('scheduledOff', sched);

    const min = Math.round(delaySec / 60);
    const atStr = new Date(atMs).toLocaleTimeString('ko-KR', { hour12: false });
    node.warn(`📅 예약 등록: ${key} — ${min}분 후 OFF (${atStr})`);
    node.status({ fill: 'yellow', shape: 'dot', text: `예약 ${key} ${min}분` });
    return null;
}

// ============================================================
// 일반 제어 (on/off/open/close/stop)
// ============================================================
let deviceType = 'unknown';
if (deviceId.startsWith('window')) deviceType = 'window';
else if (deviceId.startsWith('fan')) deviceType = 'fan';
else if (deviceId.startsWith('heater')) deviceType = 'heater';
else if (deviceId.startsWith('valve')) deviceType = 'valve';

msg.control = {
    farmId,
    houseId,
    deviceId,
    deviceType,
    command,
    operator,
    requestId,
    timestamp,
    raw: payload
};

const cmdLabels = { open: '열기', close: '닫기', stop: '정지', on: 'ON', off: 'OFF' };
const label = cmdLabels[command] || command;
const fIdLabel = farmId ? `${farmId}/` : '';

node.status({
    fill: 'green',
    shape: 'dot',
    text: `${label} ← ${fIdLabel}${houseId}/${deviceId} (${operator})`
});

node.warn(`📥 제어 수신: ${fIdLabel}${houseId}/${deviceId} ${command.toUpperCase()} by ${operator} [${requestId}]`);

return msg;
