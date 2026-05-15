// Modbus 릴레이 제어 (Waveshare FC15 / Eletechsup FC06)
// 출력 1: Modbus Flex Write
// 출력 2: MQTT out (장치 위치 보고)
const ctrl = msg.control || {};
const pl = msg.payload || {};
var modbus = pl.modbus || msg.modbus || ctrl.modbus;
const command = ctrl.command || pl.command || 'stop';
const duration = ctrl.duration || pl.duration || 0;

const deviceId = ctrl.deviceId || pl.deviceId || pl.window_id || pl.device_id || 'unknown';
const reqId = msg._requestId || null;

node.warn('📦 수신 duration=' + duration + ' command=' + command + ' deviceId=' + deviceId);

// === 장치 상태 기록 함수 ===
function saveDeviceState(devId, cmd, cType, msgDuration) {
    var states = global.get('deviceStates') || {};
    if (cType === 'bidir') {
        var positions = global.get('devicePositions') || {};
        var moves = global.get('movements') || {};
        if (cmd === 'open' || cmd === 'close') {
            states[devId] = cmd === 'open' ? 'open' : 'closed';
            var startPosNow = positions[devId] !== undefined ? positions[devId] : (cmd === 'open' ? 0 : 100);
            // 동작 시작 시간·시작 위치 기록 → stop 시 elapsed 기반 위치 계산
            moves[devId] = {
                startedAt: Date.now(),
                startPos: startPosNow,
                command: cmd
            };
            global.set('movements', moves);
            // backend·frontend 진행률 카운트 시작 신호 — startedAt + duration 같이 publish
            // 부분 동작 (msgDuration < fullDur) 시 실제 step target 으로 보고 → progress bar 정확
            var modbusCfgStart = global.get('modbus_cfg_' + devId);
            var fullDurStart = modbusCfgStart ? (cmd === 'open' ? modbusCfgStart.openDuration : modbusCfgStart.closeDuration) : 0;
            var actualDurStart, targetPosStart;
            if (msgDuration && msgDuration > 0 && fullDurStart > 0 && msgDuration < fullDurStart) {
                // 부분 동작 (stepped/position 모드 또는 manual short duration)
                actualDurStart = msgDuration;
                var deltaPctStart = Math.round(100 * msgDuration / fullDurStart);
                targetPosStart = cmd === 'open'
                    ? Math.min(100, startPosNow + deltaPctStart)
                    : Math.max(0, startPosNow - deltaPctStart);
                if (targetPosStart >= 95) targetPosStart = 100;
                if (targetPosStart <= 5) targetPosStart = 0;
            } else {
                // 한계까지 동작 (full mode)
                var remainRatioStart = cmd === 'open' ? (100 - startPosNow) / 100 : startPosNow / 100;
                actualDurStart = fullDurStart > 0 ? Math.max(1, Math.round(fullDurStart * remainRatioStart)) : 0;
                targetPosStart = cmd === 'open' ? 100 : 0;
            }
            var fidStart = global.get('FARM_ID') || env.get('FARM_ID') || 'farm_0001';
            node.send([null, {
                topic: 'smartfarm/' + fidStart + '/device/position',
                payload: JSON.stringify({
                    deviceId: devId,
                    position: startPosNow,
                    command: cmd,
                    startPosition: startPosNow,
                    targetPosition: targetPosStart,
                    duration: actualDurStart,
                    startedAt: new Date().toISOString()
                })
            }]);
        } else if (cmd === 'stop') {
            // 진행 중 동작 elapsed 기반으로 새 위치 계산
            var move = moves[devId];
            var modbusCfg = global.get('modbus_cfg_' + devId);
            var newPos = positions[devId] !== undefined ? positions[devId] : 0;
            if (move && move.startedAt && modbusCfg) {
                var elapsed = (Date.now() - move.startedAt) / 1000;
                var fullDur = move.command === 'open' ? modbusCfg.openDuration : modbusCfg.closeDuration;
                if (fullDur > 0) {
                    var ratio = Math.min(1, elapsed / fullDur);
                    if (move.command === 'open') {
                        newPos = Math.min(100, Math.round(move.startPos + (100 - move.startPos) * ratio));
                    } else {
                        newPos = Math.max(0, Math.round(move.startPos - move.startPos * ratio));
                    }
                    // 한계 위치 snap — 누적 동작으로 0/100 근처 도달 시 정확히 한계값
                    // 측창은 한계 스위치 또는 모터 stall 로 실제 0/100 정지함
                    if (move.command === 'close' && newPos <= 5) newPos = 0;
                    if (move.command === 'open' && newPos >= 95) newPos = 100;
                    positions[devId] = newPos;
                    global.set('devicePositions', positions);
                    node.warn('📍 Duration 위치 계산: ' + devId + ' ' + move.startPos + '% → ' + newPos + '% (' + elapsed.toFixed(1) + 's / ' + fullDur + 's)');
                }
            }
            // 위치 기반 상태
            if (newPos === 100) states[devId] = 'open';
            else if (newPos === 0) states[devId] = 'closed';
            else states[devId] = 'idle';
            // movement 정리
            delete moves[devId];
            global.set('movements', moves);
            // backend·frontend 즉시 sync
            var fid = global.get('FARM_ID') || env.get('FARM_ID') || 'farm_0001';
            node.send([null, {
                topic: 'smartfarm/' + fid + '/device/position',
                payload: JSON.stringify({ deviceId: devId, position: newPos, command: 'stop' })
            }]);
        }
    } else {
        if (cmd === 'on' || cmd === 'open') states[devId] = 'on';
        else states[devId] = 'off';
    }
    global.set('deviceStates', states);
}

// === MQTT 위치 보고 함수 ===
function reportPosition(devId, pos) {
    var farmId = global.get('FARM_ID') || env.get('FARM_ID') || 'farm_0001';
    var mqttMsg = {
        topic: 'smartfarm/' + farmId + '/device/position',
        payload: JSON.stringify({ deviceId: devId, position: pos, command: 'stop' })
    };
    node.send([null, mqttMsg]);
    node.warn('📍 MQTT 위치 보고: ' + farmId + '/' + devId + ' → ' + pos + '%');
}

// === duration 자동 정지 함수 ===
function scheduleAutoStop(devId, uId, addr, addr2, modType, dur, cmd) {
    if (dur <= 0) return;
    var timerKey = 'autoStop_' + devId;
    var existing = global.get(timerKey);
    if (existing) clearTimeout(existing);

    var timer = setTimeout(function() {
        var stopMsg = RED.util.cloneMessage(msg);
        if (modType === 'eletechsup') {
            stopMsg.payload = { fc: 6, unitid: uId, address: addr, quantity: 1, value: 0x0200 };
            node.send([stopMsg, null]);
            setTimeout(function() {
                var stopMsg2 = RED.util.cloneMessage(msg);
                stopMsg2.payload = { fc: 6, unitid: uId, address: addr2, quantity: 1, value: 0x0200 };
                node.send([stopMsg2, null]);
            }, 300);
        } else {
            stopMsg.payload = { fc: 15, unitid: uId, address: addr, quantity: 2, value: [false, false] };
            node.send([stopMsg, null]);
        }
        global.set(timerKey, null);
        // 위치 갱신 — 부분 동작 vs 한계까지 구분 (automation 의 position/stepped 모드 지원)
        var positions = global.get('devicePositions') || {};
        var moves = global.get('movements') || {};
        var move = moves[devId];
        var modbusForCalc = global.get('modbus_cfg_' + devId);
        var newPos;
        if (modbusForCalc && (cmd === 'open' || cmd === 'close')) {
            var fullDurCalc = cmd === 'open' ? (modbusForCalc.openDuration || 0) : (modbusForCalc.closeDuration || 0);
            if (fullDurCalc > 0 && dur > 0 && dur < fullDurCalc) {
                // 부분 동작 — elapsed 기반 위치 (stepped/position 모드)
                var startPosCalc = (move && typeof move.startPos === 'number') ? move.startPos : (cmd === 'open' ? 0 : 100);
                var ratioCalc = dur / fullDurCalc;
                if (cmd === 'open') newPos = Math.min(100, Math.round(startPosCalc + (100 - startPosCalc) * ratioCalc));
                else newPos = Math.max(0, Math.round(startPosCalc - startPosCalc * ratioCalc));
                if (newPos >= 95) newPos = 100;
                if (newPos <= 5) newPos = 0;
            } else {
                // 한계까지 동작 (full mode 또는 fullDur 미상)
                newPos = (cmd === 'open') ? 100 : 0;
            }
        } else {
            newPos = (cmd === 'open') ? 100 : 0;
        }
        positions[devId] = newPos;
        global.set('devicePositions', positions);
        delete moves[devId];
        global.set('movements', moves);
        // 이제 saveDeviceState 는 movements 없어 elapsed 계산 skip → newPos = positions[devId] → publish 정확
        saveDeviceState(devId, 'stop', 'bidir');
        reportPosition(devId, positions[devId]);
        node.warn('⏱️ 자동 정지: ' + devId + ' (' + dur + '초) → 위치: ' + positions[devId] + '%');
        node.status({ fill: 'grey', shape: 'ring', text: '자동 정지: ' + devId + ' ' + positions[devId] + '%' });
    }, dur * 1000);

    global.set(timerKey, timer);
    node.warn('⏱️ 자동 정지 예약: ' + devId + ' → ' + dur + '초 후');
}

// === Modbus 설정 캐시 ===
if (modbus) {
    global.set('modbus_cfg_' + deviceId, modbus);
} else {
    modbus = global.get('modbus_cfg_' + deviceId);
    if (modbus) {
        node.warn('[Modbus] ' + deviceId + ': 캐시에서 modbus 설정 로드');
    }
}

flow.set('lastControl', { deviceId: deviceId, command: command, houseId: ctrl.houseId || pl.houseId || '' });

if (!modbus || modbus.address === null || modbus.address === undefined) {
    node.warn('[Modbus] ' + deviceId + ': modbus 설정 없음 — 무시');
    node.status({ fill: 'yellow', shape: 'ring', text: deviceId + ': modbus 미설정' });
    return null;
}

const unitId = modbus.unitId || 1;
const controlType = modbus.controlType || 'single';
const address = modbus.address;
const address2 = modbus.address2;
const moduleType = modbus.moduleType || 'waveshare';

node.warn('[Modbus] ' + moduleType + ' uid:' + unitId + ' ' + deviceId + ' ' + command + ' (' + controlType + ') duration=' + duration);

// stop 명령 시 기존 자동 정지 타이머 취소
if (command === 'stop') {
    var timerKey = 'autoStop_' + deviceId;
    var existing = global.get(timerKey);
    if (existing) {
        clearTimeout(existing);
        global.set(timerKey, null);
        node.warn('⏱️ 자동 정지 취소: ' + deviceId + ' (수동 정지)');
    }
}

if (moduleType === 'eletechsup') {
    if (controlType === 'bidir') {
        if (command === 'open') {
            var msg2 = RED.util.cloneMessage(msg);
            msg.payload = { fc: 6, unitid: unitId, address: address2, quantity: 1, value: 0x0200 };
            msg2.payload = { fc: 6, unitid: unitId, address: address, quantity: 1, value: 0x0100 };
            global.set('_pendingModbus', { requestId: reqId, isLastWrite: false });
            setTimeout(function () {
                global.set('_pendingModbus', { requestId: reqId, isLastWrite: true });
                node.send([msg2, null]);
            }, 300);
            node.status({ fill: 'green', shape: 'dot', text: 'FC06 열기: uid' + unitId + ' reg' + address });
            saveDeviceState(deviceId, command, controlType, duration);
            scheduleAutoStop(deviceId, unitId, address, address2, moduleType, duration, command);
            return [msg, null];
        } else if (command === 'close') {
            var msg2 = RED.util.cloneMessage(msg);
            msg.payload = { fc: 6, unitid: unitId, address: address, quantity: 1, value: 0x0200 };
            msg2.payload = { fc: 6, unitid: unitId, address: address2, quantity: 1, value: 0x0100 };
            global.set('_pendingModbus', { requestId: reqId, isLastWrite: false });
            setTimeout(function () {
                global.set('_pendingModbus', { requestId: reqId, isLastWrite: true });
                node.send([msg2, null]);
            }, 300);
            node.status({ fill: 'green', shape: 'dot', text: 'FC06 닫기: uid' + unitId + ' reg' + address2 });
            saveDeviceState(deviceId, command, controlType, duration);
            scheduleAutoStop(deviceId, unitId, address, address2, moduleType, duration, command);
            return [msg, null];
        } else {
            var msg2 = RED.util.cloneMessage(msg);
            msg.payload = { fc: 6, unitid: unitId, address: address, quantity: 1, value: 0x0200 };
            msg2.payload = { fc: 6, unitid: unitId, address: address2, quantity: 1, value: 0x0200 };
            global.set('_pendingModbus', { requestId: reqId, isLastWrite: false });
            setTimeout(function () {
                global.set('_pendingModbus', { requestId: reqId, isLastWrite: true });
                node.send([msg2, null]);
            }, 300);
            node.status({ fill: 'grey', shape: 'dot', text: 'FC06 정지: uid' + unitId + ' ALL OFF' });
            saveDeviceState(deviceId, command, controlType, duration);
            return [msg, null];
        }
    } else {
        var value = (command === 'on' || command === 'open') ? 0x0100 : 0x0200;
        msg.payload = { fc: 6, unitid: unitId, address: address, quantity: 1, value: value };
        global.set('_pendingModbus', { requestId: reqId, isLastWrite: true });
        node.status({ fill: 'green', shape: 'dot', text: 'FC06 uid' + unitId + ' reg' + address });
        saveDeviceState(deviceId, command, controlType, duration);
        return [msg, null];
    }
} else {
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
        scheduleAutoStop(deviceId, unitId, address, address2, moduleType, duration, command);
    }
    return [msg, null];
}
