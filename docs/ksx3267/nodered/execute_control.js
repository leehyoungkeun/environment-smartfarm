// ============================================================
// "제어 실행 (릴레이)" (execute_control) — KS X 3267 분기 추가본 (2026-08-30 P3)
// 위치: NR 에디터 "AWS IoT 제어 수신" 탭 → "제어 실행 (릴레이)" 노드
// 적용: 코드 전체 교체 + **출력 개수 2 → 3** + 3번 출력을 새 link out("→ KS3267 명령")에 연결
// 변경: (1) modbus.protocol==='ks3267' 이면 3번 출력으로 (vendor 경로 무수정)
//       (2) 모든 return/node.send 를 3-슬롯으로 (1·2번 출력 동작 동일)
// ============================================================
// Modbus 릴레이 제어 — Waveshare FC15 (8CH coil) only
// 출력 1: Modbus Flex Write
// 출력 2: MQTT out (장치 위치 보고)
//
// ★ 2026-06-03 근본 단순화 + MUTEX 패치
//   - eletechsup 분기 제거 — 메모리: 2026-05-08 HW 제거됨 (MEMORY.md "Modbus 릴레이 제어")
//   - default unitId 1→2 (Waveshare default, 옛 unitId 하드코딩 사고 패턴 제거)
//   - write 발사 직전 _modbusLastWriteAt 갱신 → "제어 후 상태 발행"이 SAFE_GAP_MS(500ms)
//     후 read 발사 → RS-485 single bus 의 write-read race 차단
const ctrl = msg.control || {};
const pl = msg.payload || {};
var modbus = pl.modbus || msg.modbus || ctrl.modbus;
const command = ctrl.command || pl.command || 'stop';
const duration = ctrl.duration || pl.duration || 0;

const deviceId = ctrl.deviceId || pl.deviceId || pl.window_id || pl.device_id || 'unknown';
const reqId = msg._requestId || null;

// -- 다중 하우스: 장치 키 --------------------------------
// 장치 ID 는 하우스 안에서만 유일하므로 (house_0001/fan1, house_0002/fan1)
// 장치 단위 전역 키는 반드시 houseId 를 포함해야 한다.
const houseId = ctrl.houseId || pl.houseId || 'house_0001';
const dkey = global.get('dkey') || function (h, dv) { return (h || 'house_0001') + ':' + dv; };

node.warn('📦 수신 duration=' + duration + ' command=' + command + ' deviceId=' + deviceId);

// === 장치 상태 기록 함수 ===
function saveDeviceState(devId, cmd, cType, msgDuration) {
    var DK = dkey(houseId, devId);
    var states = global.get('deviceStates') || {};
    if (cType === 'bidir') {
        var positions = global.get('devicePositions') || {};
        var moves = global.get('movements') || {};
        if (cmd === 'open' || cmd === 'close') {
            states[DK] = cmd === 'open' ? 'open' : 'closed';
            var startPosNow = positions[DK] !== undefined ? positions[DK] : (cmd === 'open' ? 0 : 100);
            moves[DK] = { startedAt: Date.now(), startPos: startPosNow, command: cmd };
            global.set('movements', moves);
            var modbusCfgStart = global.get('modbus_cfg_' + DK);
            var fullDurStart = modbusCfgStart ? (cmd === 'open' ? modbusCfgStart.openDuration : modbusCfgStart.closeDuration) : 0;
            var actualDurStart, targetPosStart;
            if (msgDuration && msgDuration > 0 && fullDurStart > 0 && msgDuration < fullDurStart) {
                actualDurStart = msgDuration;
                var deltaPctStart = Math.round(100 * msgDuration / fullDurStart);
                targetPosStart = cmd === 'open'
                    ? Math.min(100, startPosNow + deltaPctStart)
                    : Math.max(0, startPosNow - deltaPctStart);
                if (targetPosStart >= 95) targetPosStart = 100;
                if (targetPosStart <= 5) targetPosStart = 0;
            } else {
                var remainRatioStart = cmd === 'open' ? (100 - startPosNow) / 100 : startPosNow / 100;
                actualDurStart = fullDurStart > 0 ? Math.max(1, Math.round(fullDurStart * remainRatioStart)) : 0;
                targetPosStart = cmd === 'open' ? 100 : 0;
            }
            var fidStart = global.get('FARM_ID') || env.get('FARM_ID') || 'farm_0001';
            node.send([null, {
                topic: 'smartfarm/' + fidStart + '/device/position',
                payload: JSON.stringify({
                    houseId: houseId,
                    deviceId: devId,
                    position: startPosNow,
                    command: cmd,
                    startPosition: startPosNow,
                    targetPosition: targetPosStart,
                    duration: actualDurStart,
                    startedAt: new Date().toISOString()
                })
            }, null]);
        } else if (cmd === 'stop') {
            var move = moves[DK];
            var modbusCfg = global.get('modbus_cfg_' + DK);
            var newPos = positions[DK] !== undefined ? positions[DK] : 0;
            if (move && move.startedAt && modbusCfg) {
                var elapsed = (Date.now() - move.startedAt) / 1000;
                var fullDur = move.command === 'open' ? modbusCfg.openDuration : modbusCfg.closeDuration;
                if (fullDur > 0) {
                    var deltaPctStop = Math.round(100 * Math.min(elapsed, fullDur) / fullDur);
                    if (move.command === 'open') {
                        newPos = Math.min(100, move.startPos + deltaPctStop);
                    } else {
                        newPos = Math.max(0, move.startPos - deltaPctStop);
                    }
                    if (newPos <= 5) newPos = 0;
                    if (newPos >= 95) newPos = 100;
                    positions[DK] = newPos;
                    global.set('devicePositions', positions);
                    node.warn('📍 Duration 위치 계산: ' + devId + ' ' + move.startPos + '% → ' + newPos + '% (' + elapsed.toFixed(1) + 's / ' + fullDur + 's)');
                }
            }
            if (newPos === 100) states[DK] = 'open';
            else if (newPos === 0) states[DK] = 'closed';
            else states[DK] = 'idle';
            delete moves[DK];
            global.set('movements', moves);
            var fid = global.get('FARM_ID') || env.get('FARM_ID') || 'farm_0001';
            node.send([null, {
                topic: 'smartfarm/' + fid + '/device/position',
                payload: JSON.stringify({ houseId: houseId, deviceId: devId, position: newPos, command: 'stop' })
            }, null]);
        }
    } else {
        if (cmd === 'on' || cmd === 'open') states[DK] = 'on';
        else states[DK] = 'off';
    }
    global.set('deviceStates', states);
}

// === MQTT 위치 보고 함수 ===
function reportPosition(devId, pos) {
    var farmId = global.get('FARM_ID') || env.get('FARM_ID') || 'farm_0001';
    node.send([null, {
        topic: 'smartfarm/' + farmId + '/device/position',
        payload: JSON.stringify({ houseId: houseId, deviceId: devId, position: pos, command: 'stop' })
    }, null]);
    node.warn('📍 MQTT 위치 보고: ' + farmId + '/' + houseId + '/' + devId + ' → ' + pos + '%');
}

// === duration 자동 정지 함수 (Waveshare FC15) ===
function scheduleAutoStop(devId, uId, addr, dur, cmd) {
    if (dur <= 0) return;
    var DK2 = dkey(houseId, devId);
    var timerKey = 'autoStop_' + DK2;
    var existing = global.get(timerKey);
    if (existing) clearTimeout(existing);

    var timer = setTimeout(function() {
        // Waveshare FC15 — bidir 두 coil 한 번에 OFF
        var stopMsg = RED.util.cloneMessage(msg);
        stopMsg.payload = { fc: 15, unitid: uId, address: addr, quantity: 2, value: [false, false] };
        global.set('_modbusLastWriteAt', Date.now());   // ★ MUTEX (자동정지)
        node.send([stopMsg, null, null]);
        global.set(timerKey, null);

        // 위치 갱신 — 부분 동작 vs 한계까지 구분
        var positions = global.get('devicePositions') || {};
        var moves = global.get('movements') || {};
        var move = moves[DK2];
        var modbusForCalc = global.get('modbus_cfg_' + DK2);
        var newPos;
        if (modbusForCalc && (cmd === 'open' || cmd === 'close')) {
            var fullDurCalc = cmd === 'open' ? (modbusForCalc.openDuration || 0) : (modbusForCalc.closeDuration || 0);
            if (fullDurCalc > 0 && dur > 0 && dur < fullDurCalc) {
                var startPosCalc = (move && typeof move.startPos === 'number') ? move.startPos : (cmd === 'open' ? 0 : 100);
                var deltaPctCalc = Math.round(100 * dur / fullDurCalc);
                if (cmd === 'open') newPos = Math.min(100, startPosCalc + deltaPctCalc);
                else newPos = Math.max(0, startPosCalc - deltaPctCalc);
                if (newPos >= 95) newPos = 100;
                if (newPos <= 5) newPos = 0;
            } else {
                newPos = (cmd === 'open') ? 100 : 0;
            }
        } else {
            newPos = (cmd === 'open') ? 100 : 0;
        }
        positions[DK2] = newPos;
        global.set('devicePositions', positions);
        delete moves[DK2];
        global.set('movements', moves);
        saveDeviceState(devId, 'stop', 'bidir');
        reportPosition(devId, positions[DK2]);
        node.warn('⏱️ 자동 정지: ' + DK2 + ' (' + dur + '초) → 위치: ' + positions[DK2] + '%');
        node.status({ fill: 'grey', shape: 'ring', text: '자동 정지: ' + devId + ' ' + positions[DK2] + '%' });
    }, dur * 1000);

    global.set(timerKey, timer);
    node.warn('⏱️ 자동 정지 예약: ' + devId + ' → ' + dur + '초 후');
}

// === Modbus 설정 캐시 ===
if (modbus) {
    global.set('modbus_cfg_' + dkey(houseId, deviceId), modbus);
} else {
    modbus = global.get('modbus_cfg_' + dkey(houseId, deviceId));
    if (modbus) {
        node.warn('[Modbus] ' + deviceId + ': 캐시에서 modbus 설정 로드');
    }
}

flow.set('lastControl', { deviceId: deviceId, command: command, houseId: houseId });

// ━━━ KS X 3267 표준 노드 → 별도 탭으로 (P3, 2026-08-30) ━━━
// houseConfig 의 modbus 프로필이 { protocol:'ks3267', unit, kind, n } 이면 Waveshare 경로를 타지 않고
// 3번 출력(link out → "KS X 3267 표준노드" 탭)으로 넘긴다. vendor 경로는 아래 그대로.
if (modbus && modbus.protocol === 'ks3267') {
    msg.control = Object.assign({}, ctrl, { houseId: houseId, deviceId: deviceId, command: command, duration: duration, modbus: modbus });
    node.status({ fill: 'blue', shape: 'dot', text: 'KS3267 → ' + deviceId + ' ' + command });
    return [null, null, msg];
}

if (!modbus || modbus.address === null || modbus.address === undefined) {
    node.warn('[Modbus] ' + deviceId + ': modbus 설정 없음 — 무시');
    node.status({ fill: 'yellow', shape: 'ring', text: deviceId + ': modbus 미설정' });
    return null;
}

// unitId default 2 (Waveshare) — 미설정 시 경고 후 default 적용
if (!modbus.unitId) {
    node.warn('⚠️ [Modbus] ' + deviceId + ': unitId 미설정 — Waveshare default uid:2 적용');
}
const unitId = modbus.unitId || 2;
const controlType = modbus.controlType || 'single';
const address = modbus.address;
const address2 = modbus.address2;

node.warn('[Modbus] waveshare uid:' + unitId + ' ' + deviceId + ' ' + command + ' (' + controlType + ') duration=' + duration);

// stop 명령 시 기존 자동 정지 타이머 취소
if (command === 'stop') {
    var timerKey = 'autoStop_' + dkey(houseId, deviceId);
    var existing = global.get(timerKey);
    if (existing) {
        clearTimeout(existing);
        global.set(timerKey, null);
        node.warn('⏱️ 자동 정지 취소: ' + deviceId + ' (수동 정지)');
    }
}

// Waveshare FC15 — bidir 2채널 또는 single 1채널
if (controlType === 'bidir') {
    if (command === 'open') {
        msg.payload = { fc: 15, unitid: unitId, address: address, quantity: 2, value: [true, false] };
        node.status({ fill: 'green', shape: 'dot', text: 'FC15 열기: uid' + unitId + ' ch' + address });
    } else if (command === 'close') {
        msg.payload = { fc: 15, unitid: unitId, address: address, quantity: 2, value: [false, true] };
        node.status({ fill: 'green', shape: 'dot', text: 'FC15 닫기: uid' + unitId + ' ch' + address2 });
    } else {
        msg.payload = { fc: 15, unitid: unitId, address: address, quantity: 2, value: [false, false] };
        node.status({ fill: 'grey', shape: 'dot', text: 'FC15 정지: ALL OFF' });
    }
} else {
    var on = (command === 'on' || command === 'open');
    msg.payload = { fc: 15, unitid: unitId, address: address, quantity: 1, value: [on] };
    node.status({ fill: 'green', shape: 'dot', text: 'FC15 uid' + unitId + ' ch' + address + '=' + (on ? 'ON' : 'OFF') });
}
global.set('_pendingModbus', { requestId: reqId, isLastWrite: true });
saveDeviceState(deviceId, command, controlType, duration);
if (controlType === 'bidir' && (command === 'open' || command === 'close')) {
    scheduleAutoStop(deviceId, unitId, address, duration, command);
}
global.set('_modbusLastWriteAt', Date.now());   // ★ MUTEX
return [msg, null, null];
