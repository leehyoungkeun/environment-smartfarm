// ============================================================
// function 2 (AWS IoT 제어 테스트 탭) — 기존 Modbus 매핑 + schedule-off 분기
//
// 위치: NR 에디터 "AWS IoT 제어 테스트" 탭의 "function 2" 노드 (id: 7500bc12ea12891e)
// 적용 방법:
//   1. NR 에디터 → 탭 "AWS IoT 제어 테스트" → "function 2" 노드 더블클릭
//   2. 기존 코드 전체 백업 (메모장 등)
//   3. 이 파일 내용으로 교체
//   4. 출력: 1개 (Modbus Flex Write 로 연결)
//   5. 완료 → Deploy
//
// 신규 분기:
//   - command === 'schedule-off'         → setTimeout 등록, 만료 시 자동 OFF
//   - command === 'schedule-off-cancel'  → clearTimeout + global 삭제
//   - 그 외 (on/off/open/close/stop)     → 기존 Modbus 매핑 로직 그대로
//
// 영구화: global.scheduledOff (localfilesystem context — 디스크 저장됨)
//   - NR 재시작 시 별도 startup 노드가 재등록 (docs/nodered-schedule-off-startup.js)
// ============================================================

// retained 메시지 무시 (재연결 시 이전 명령 재실행 방지)
if (msg.retain) {
    node.warn('⏭️ retained MQTT 메시지 무시');
    return null;
}

// ★ 자동화 메시지 호환: msg.control → msg.payload 변환
if (msg.control && (!msg.payload || !msg.payload.command)) {
    msg.payload = {
        device_id: msg.control.deviceId,
        house_id: msg.control.houseId,
        command: msg.control.command,
        operator: msg.control.operator,
    };
    msg._requestId = msg.control.requestId || null;
}

// ────────────────────────────────────────────────────────────
// ★ NEW: 자동 OFF 예약 / 취소 분기 (Modbus 매핑 전에 처리)
// ────────────────────────────────────────────────────────────
const _command = (msg.payload.command || msg.command || 'stop').toLowerCase();
const _deviceId = msg.payload.window_id || msg.payload.device_id || 'unknown';
const _houseId = msg.payload.house_id || 'unknown';

if (_command === 'schedule-off' || _command === 'schedule-off-cancel') {
    const key = `${_houseId}/${_deviceId}`;
    const sched = global.get('scheduledOff') || {};

    // 기존 timer 있으면 항상 clear
    if (sched[key] && sched[key].timerId) {
        clearTimeout(sched[key].timerId);
    }

    if (_command === 'schedule-off-cancel') {
        delete sched[key];
        global.set('scheduledOff', sched);
        node.warn(`🚫 예약 취소: ${key}`);
        node.status({ fill: 'grey', shape: 'ring', text: `예약 취소 ${key}` });
        return null;
    }

    // schedule-off
    const delaySec = parseInt(msg.payload.delay_sec, 10) || 0;
    if (delaySec <= 0 || delaySec > 86400) {
        node.warn(`⚠ schedule-off 무시: delay_sec=${delaySec} (범위 외)`);
        return null;
    }

    // modbus 설정 확보 (만료 시 OFF 발사용) — payload 또는 캐시
    const savedModbus = msg.payload.modbus || global.get('modbus_cfg_' + _deviceId);
    if (!savedModbus) {
        node.warn(`⚠ schedule-off 무시: ${_deviceId} modbus 설정 없음`);
        return null;
    }

    const atMs = Date.now() + delaySec * 1000;
    const offReqId = `sched-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

    // setTimeout — 만료 시 OFF 모드버스 페이로드 직접 송출
    const timerId = setTimeout(function () {
        node.warn(`⏰ 예약 만료 → OFF: ${key}`);

        const moduleType = savedModbus.moduleType || 'waveshare';
        const unitId = savedModbus.unitId || 1;
        const address = savedModbus.address;
        const address2 = savedModbus.address2;
        const controlType = savedModbus.controlType || 'single';

        let offPayload;
        if (moduleType === 'eletechsup') {
            // FC06: bidir 양쪽 0x0200, single 0x0200
            offPayload = { fc: 6, unitid: unitId, address: address, quantity: 1, value: 0x0200 };
        } else {
            // Waveshare FC15
            if (controlType === 'bidir') {
                offPayload = { fc: 15, unitid: unitId, address: address, quantity: 2, value: [false, false] };
            } else {
                offPayload = { fc: 15, unitid: unitId, address: address, quantity: 1, value: [false] };
            }
        }

        global.set('_pendingModbus', { requestId: offReqId, isLastWrite: true });
        node.send({
            payload: offPayload,
            _isLastWrite: true,
            _requestId: offReqId,
            control: {
                houseId: _houseId,
                deviceId: _deviceId,
                command: 'off',
                operator: 'schedule_off_timer',
                requestId: offReqId,
                timestamp: new Date().toISOString(),
                modbus: savedModbus,
            },
        });
        node.status({ fill: 'blue', shape: 'dot', text: `예약 OFF 실행 ${key}` });

        // global cleanup
        const s = global.get('scheduledOff') || {};
        delete s[key];
        global.set('scheduledOff', s);
    }, delaySec * 1000);

    sched[key] = {
        atMs,
        timerId,
        deviceId: _deviceId,
        houseId: _houseId,
        modbus: savedModbus,
        scheduledAt: new Date().toISOString(),
        scheduledBy: msg.payload.operator || 'unknown',
    };
    global.set('scheduledOff', sched);

    const min = Math.round(delaySec / 60);
    const atStr = new Date(atMs).toLocaleTimeString('ko-KR', { hour12: false });
    node.warn(`📅 예약 등록: ${key} — ${min}분 후 OFF (${atStr})`);
    node.status({ fill: 'yellow', shape: 'dot', text: `예약 ${key} ${min}분` });
    return null;  // 즉시 명령은 보내지 않음
}
// ────────────────────────────────────────────────────────────

// ★ modbus 설정 캐시: 수동 제어 시 저장, 자동화 시 조회
var cacheDevId = msg.payload.device_id || msg.payload.window_id || 'unknown';
if (msg.payload.modbus) {
    global.set('modbus_cfg_' + cacheDevId, msg.payload.modbus);
} else {
    var cachedModbus = global.get('modbus_cfg_' + cacheDevId);
    if (cachedModbus) {
        msg.payload.modbus = cachedModbus;
    }
}

// MQTT 페이로드에서 modbus 설정 추출
const modbus = msg.payload.modbus || msg.modbus;
const command = msg.payload.command || msg.command || 'stop';
const deviceId = msg.payload.window_id || msg.payload.device_id || 'unknown';
const houseId = msg.payload.house_id || 'unknown';

// ★ 로컬 제어의 requestId 전달 (Modbus 완료 후 HTTP 응답용)
const reqId = msg._requestId || null;

if (!modbus || modbus.address === null || modbus.address === undefined) {
    node.warn(`[Modbus] ${deviceId}: modbus 설정 없음 — 무시`);
    node.status({ fill: 'yellow', shape: 'ring', text: `${deviceId}: modbus 미설정` });
    return null;
}

const unitId = modbus.unitId || 1;
const controlType = modbus.controlType || 'single';
const address = modbus.address;
const address2 = modbus.address2;
const moduleType = modbus.moduleType || 'waveshare';

node.warn(`[Modbus] ${moduleType} uid:${unitId} ${deviceId} ${command} (${controlType})`);

// ━━━ moduleType별 분기 ━━━

if (moduleType === 'eletechsup') {
    // ━━━ Eletechsup: FC06 (Write Single Register) ━━━

    if (controlType === 'bidir') {
        if (command === 'open') {
            var msg2 = RED.util.cloneMessage(msg);
            msg.payload = { fc: 6, unitid: unitId, address: address2, quantity: 1, value: 0x0200 };
            msg._isLastWrite = false;
            msg._requestId = reqId;
            msg2.payload = { fc: 6, unitid: unitId, address: address, quantity: 1, value: 0x0100 };
            msg2._isLastWrite = true;
            msg2._requestId = reqId;
            global.set('_pendingModbus', { requestId: msg._requestId, isLastWrite: false });
            setTimeout(function () {
                global.set('_pendingModbus', { requestId: msg2._requestId, isLastWrite: true });
                node.send(msg2);
            }, 300);
            node.status({ fill: 'green', shape: 'dot', text: `FC06 열기: uid${unitId} reg${address} ON` });
            return msg;
        } else if (command === 'close') {
            var msg2 = RED.util.cloneMessage(msg);
            msg.payload = { fc: 6, unitid: unitId, address: address, quantity: 1, value: 0x0200 };
            msg._isLastWrite = false;
            msg._requestId = reqId;
            msg2.payload = { fc: 6, unitid: unitId, address: address2, quantity: 1, value: 0x0100 };
            msg2._isLastWrite = true;
            msg2._requestId = reqId;
            global.set('_pendingModbus', { requestId: msg._requestId, isLastWrite: false });
            setTimeout(function () {
                global.set('_pendingModbus', { requestId: msg2._requestId, isLastWrite: true });
                node.send(msg2);
            }, 300);
            node.status({ fill: 'green', shape: 'dot', text: `FC06 닫기: uid${unitId} reg${address2} ON` });
            return msg;
        } else {
            var msg2 = RED.util.cloneMessage(msg);
            msg.payload = { fc: 6, unitid: unitId, address: address, quantity: 1, value: 0x0200 };
            msg._isLastWrite = false;
            msg._requestId = reqId;
            msg2.payload = { fc: 6, unitid: unitId, address: address2, quantity: 1, value: 0x0200 };
            msg2._isLastWrite = true;
            msg2._requestId = reqId;
            global.set('_pendingModbus', { requestId: msg._requestId, isLastWrite: false });
            setTimeout(function () {
                global.set('_pendingModbus', { requestId: msg2._requestId, isLastWrite: true });
                node.send(msg2);
            }, 300);
            node.status({ fill: 'grey', shape: 'dot', text: `FC06 정지: uid${unitId} ALL OFF` });
            return msg;
        }
    } else {
        const value = (command === 'on' || command === 'open') ? 0x0100 : 0x0200;
        msg.payload = { fc: 6, unitid: unitId, address: address, quantity: 1, value: value };
        msg._isLastWrite = true;
        msg._requestId = reqId;
        global.set('_pendingModbus', { requestId: reqId, isLastWrite: true });
        node.status({ fill: 'green', shape: 'dot', text: `FC06 uid${unitId} reg${address} val:0x${value.toString(16)}` });
        return msg;
    }

} else {
    // ━━━ Waveshare (기본): FC15 (Write Multiple Coils) ━━━

    if (controlType === 'bidir') {
        if (command === 'open') {
            msg.payload = { fc: 15, unitid: unitId, address: address, quantity: 2, value: [true, false] };
            node.status({ fill: 'green', shape: 'dot', text: `FC15 열기: uid${unitId} ch${address}=ON ch${address2}=OFF` });
        } else if (command === 'close') {
            msg.payload = { fc: 15, unitid: unitId, address: address, quantity: 2, value: [false, true] };
            node.status({ fill: 'green', shape: 'dot', text: `FC15 닫기: uid${unitId} ch${address}=OFF ch${address2}=ON` });
        } else {
            msg.payload = { fc: 15, unitid: unitId, address: address, quantity: 2, value: [false, false] };
            node.status({ fill: 'grey', shape: 'dot', text: `FC15 정지: uid${unitId} ALL OFF` });
        }
    } else {
        const on = (command === 'on' || command === 'open');
        msg.payload = { fc: 15, unitid: unitId, address: address, quantity: 1, value: [on] };
        node.status({ fill: 'green', shape: 'dot', text: `FC15 uid${unitId} ch${address}=${on ? 'ON' : 'OFF'}` });
    }

    msg._isLastWrite = true;
    msg._requestId = reqId;
    global.set('_pendingModbus', { requestId: reqId, isLastWrite: true });
    return msg;
}
