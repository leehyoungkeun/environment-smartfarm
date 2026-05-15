// ================================================================
// ⑤-B 스케줄 실행 핸들러 (실제 Modbus 상태 기반 판단)
// ================================================================

var rule = flow.get('pendingRule');
var actions = flow.get('pendingActions');

if (!rule || !actions || actions.length === 0) {
    node.warn('⚠️ 스케줄 실행: pending 데이터 없음');
    return null;
}

var coils = msg.payload;
if (!Array.isArray(coils)) {
    node.warn('⚠️ Modbus 읽기 실패 — 상태 확인 없이 실행');
    coils = null;
}

var ruleId = rule._id || rule.id;
var REVERSE_CMD = { on: 'off', off: 'on' };
var pcServer = global.get('pcServerUrl') || 'https://api.smartgreen.kr';

function findModbus(deviceId) {
    var cached = global.get('modbus_cfg_' + deviceId);
    if (cached) return cached;
    var houseConfig = global.get('houseConfig') || {};
    var houses = houseConfig.houses || [];
    for (var i = 0; i < houses.length; i++) {
        var devices = houses[i].devices || [];
        for (var j = 0; j < devices.length; j++) {
            if (devices[j].deviceId === deviceId && devices[j].modbus) {
                global.set('modbus_cfg_' + deviceId, devices[j].modbus);
                return devices[j].modbus;
            }
        }
    }
    return null;
}

function getActualState(modbus) {
    if (!coils || !modbus || modbus.address == null) return null;
    var openCoil = !!coils[modbus.address];
    var closeCoil = (modbus.address2 != null) ? !!coils[modbus.address2] : false;
    if (modbus.controlType === 'bidir') {
        if (openCoil && !closeCoil) return 'open';
        if (!openCoil && closeCoil) return 'closed';
        if (!openCoil && !closeCoil) return 'idle';
        return 'unknown';
    } else {
        return openCoil ? 'on' : 'off';
    }
}

function updateDeviceState(deviceId, command) {
    var ds = global.get('deviceStates') || {};
    if (command === 'open') ds[deviceId] = 'open';
    else if (command === 'close') ds[deviceId] = 'closed';
    else if (command === 'stop') ds[deviceId] = 'idle';
    else if (command === 'on') ds[deviceId] = 'on';
    else if (command === 'off') ds[deviceId] = 'off';
    global.set('deviceStates', ds);
}

function sendControlLog(action, command) {
    var logMsg = {
        method: 'POST',
        url: pcServer + '/internal/control-log',
        headers: { 'Content-Type': 'application/json', 'x-api-key': global.get('sensorApiKey') || 'smartfarm-sensor-key' },
        payload: {
            farmId: rule.farmId || global.get('farmId') || 'farm_0001',
            houseId: rule.houseId || 'house_0001',
            deviceId: action.deviceId,
            deviceType: action.deviceType || 'relay',
            deviceName: action.deviceName || action.deviceId,
            command: command,
            ruleName: rule.name,
            ruleId: ruleId,
            reason: rule.name + ' (자동화 스케줄)'
        }
    };
    node.send([null, null, null, logMsg, null]);
}

function sendSqliteLog(deviceId, command, source) {
    var lm = RED.util.cloneMessage(msg);
    lm.topic = "INSERT INTO control_logs (timestamp, device_id, command, source, synced) VALUES ('" + new Date().toISOString() + "', '" + deviceId + "', '" + command + "', '" + source + "', 0)";
    lm.payload = [];
    node.send([null, null, null, null, lm]);
}

var controlMsgs = [];
var logParts = [];

actions.forEach(function(action) {
    var modbus = findModbus(action.deviceId);
    if (!modbus) {
        node.warn('⚠️ ' + action.deviceId + ': Modbus 설정 없음');
        return;
    }

    // ★ bidir 장치 위치 한계 cross-check
    //   autoStop 후 actualState='idle' 가 되어 기존 isAlready (actualState 비교) 가
    //   100/0 한계 도달을 못 잡는 케이스 보완.
    //   on/off 단방향 장치는 controlType !== 'bidir' 이라 영향 없음.
    if (modbus.controlType === 'bidir' && (action.command === 'open' || action.command === 'close')) {
        var posMap = global.get('devicePositions') || {};
        var curPos = posMap[action.deviceId];
        if (typeof curPos === 'number') {
            var atLimit = (action.command === 'open' && curPos >= 100) ||
                          (action.command === 'close' && curPos <= 0);
            if (atLimit) {
                node.warn('⏭️ ' + action.deviceId + ': 이미 한계 (pos=' + curPos + ', cmd=' + action.command + ') → 스킵');
                logParts.push(action.deviceId + ' (한계스킵)');
                return;
            }
        }
    }

    var actualState = getActualState(modbus);
    if (actualState) {
        node.warn('🔍 ' + action.deviceId + ' 실제 릴레이 상태: ' + actualState + ' (Modbus 코일)');
        var isAlready = (action.command === 'open' && actualState === 'open') ||
                        (action.command === 'close' && actualState === 'closed') ||
                        (action.command === 'on' && actualState === 'on') ||
                        (action.command === 'off' && actualState === 'off');
        if (isAlready) {
            node.warn('⏭️ ' + action.deviceId + ': 실제 릴레이 ' + actualState + ' → 스킵');
            return;
        }
    } else {
        node.warn('🔍 ' + action.deviceId + ' Modbus 상태 확인 불가 — 그대로 실행');
    }

    // ★ bidir actionMode 분기: 'full' (기본) | 'position' | 'stepped'
    var actionMode = action.actionMode || 'full';
    var isBidirAdvanced = modbus.controlType === 'bidir' &&
                          (action.command === 'open' || action.command === 'close') &&
                          (actionMode === 'position' || actionMode === 'stepped');

    if (isBidirAdvanced) {
        var posMap2 = global.get('devicePositions') || {};
        var curPos2 = posMap2[action.deviceId];
        if (typeof curPos2 !== 'number') curPos2 = (action.command === 'open') ? 0 : 100;
        var fullDur2 = action.command === 'open' ? (modbus.openDuration || 0) : (modbus.closeDuration || 0);

        if (fullDur2 <= 0) {
            node.warn('⚠️ ' + action.deviceId + ': openDuration/closeDuration 미설정 — full 모드로 폴백');
            // 폴백 — 아래 full 흐름으로 계속
        } else {
            var target = (typeof action.targetPosition === 'number') ? action.targetPosition :
                         (action.command === 'open' ? 100 : 0);
            var alreadyAtTarget = action.command === 'open' ? (curPos2 >= target) : (curPos2 <= target);
            if (alreadyAtTarget) {
                node.warn('⏭️ ' + action.deviceId + ': 이미 목표 도달 (cur=' + curPos2 + ', target=' + target + ') → 스킵');
                logParts.push(action.deviceId + ' (목표스킵)');
                return;
            }

            // ─── 모드 ② position: 한 번에 목표까지 ───
            if (actionMode === 'position') {
                var deltaPct = action.command === 'open' ? (target - curPos2) : (curPos2 - target);
                var posDur = Math.max(1, Math.round(fullDur2 * deltaPct / 100));
                var posMsg = RED.util.cloneMessage(msg);
                posMsg.payload = {
                    deviceId: action.deviceId,
                    command: action.command,
                    modbus: modbus,
                    duration: posDur,
                    source: 'automation_scheduler_position'
                };
                controlMsgs.push(posMsg);
                updateDeviceState(action.deviceId, action.command);
                logParts.push(action.deviceId + ' → ' + target + '% (' + posDur + '초)');
                sendControlLog(action, action.command);
                sendSqliteLog(action.deviceId, action.command, 'automation_scheduler_position');
                node.warn('🎯 position: ' + action.deviceId + ' ' + curPos2 + '% → ' + target + '% (' + posDur + '초)');
                return;
            }

            // ─── 모드 ③ stepped: 단계적 이동 (작물 보호) ───
            if (actionMode === 'stepped') {
                var stepPct = action.stepPercent || 10;
                var pauseMs = (action.stepPauseSeconds || 60) * 1000;
                var stepDur = Math.max(1, Math.round(fullDur2 * stepPct / 100));
                var direction = action.command;

                // 진행 중 세션 등록 (같은 device 의 옛 세션 자동 무효화)
                var sessions = global.get('steppedSessions') || {};
                var sessionId = action.deviceId + '_' + Date.now();
                sessions[action.deviceId] = sessionId;
                global.set('steppedSessions', sessions);

                node.warn('🌱 stepped 시작: ' + action.deviceId + ' ' + curPos2 + '% → ' + target + '% (' + stepPct + '%씩, ' + (pauseMs / 1000) + '초 정지)');
                logParts.push(action.deviceId + ' 단계적 → ' + target + '%');
                sendControlLog(action, action.command);

                (function stepLoop() {
                    // 세션 유효성
                    var curSessions = global.get('steppedSessions') || {};
                    if (curSessions[action.deviceId] !== sessionId) {
                        node.warn('⏹️ stepped 중단: ' + action.deviceId + ' (옛 세션)');
                        return;
                    }
                    // 수동 모드 전환 시 중단
                    var autoDevs = global.get('autoDevices') || [];
                    if (autoDevs.indexOf(action.deviceId) === -1) {
                        node.warn('⏹️ stepped 중단: ' + action.deviceId + ' 수동 모드');
                        delete curSessions[action.deviceId];
                        global.set('steppedSessions', curSessions);
                        return;
                    }
                    // 목표 도달 확인
                    var nowPos = (global.get('devicePositions') || {})[action.deviceId];
                    if (typeof nowPos !== 'number') nowPos = curPos2;
                    var reached = direction === 'open' ? (nowPos >= target) : (nowPos <= target);
                    if (reached) {
                        node.warn('✅ stepped 완료: ' + action.deviceId + ' → ' + nowPos + '% (목표 ' + target + '%)');
                        delete curSessions[action.deviceId];
                        global.set('steppedSessions', curSessions);
                        return;
                    }
                    // step 동작
                    var stepMsg = RED.util.cloneMessage(msg);
                    stepMsg.payload = {
                        deviceId: action.deviceId,
                        command: direction,
                        modbus: modbus,
                        duration: stepDur,
                        source: 'automation_stepped'
                    };
                    node.send([stepMsg, null, null, null, null]);
                    sendSqliteLog(action.deviceId, direction, 'automation_stepped');
                    node.warn('🪜 stepped: ' + action.deviceId + ' ' + nowPos + '% (+' + stepPct + '%, ' + stepDur + '초)');
                    // 다음 step: 동작 + pause 후
                    setTimeout(stepLoop, (stepDur * 1000) + pauseMs);
                })();

                return;
            }
        }
    }

    var controlMsg = RED.util.cloneMessage(msg);
    // bidir 장치: 현재 위치 기반 필요한 시간만 (full mode)
    var autoDur = 0;
    if (modbus.controlType === 'bidir' && (action.command === 'open' || action.command === 'close')) {
        var positions5 = global.get('devicePositions') || {};
        var curPos5 = positions5[action.deviceId];
        if (curPos5 === undefined) curPos5 = (action.command === 'open') ? 0 : 100;
        var fullDur5 = action.command === 'open' ? (modbus.openDuration || 0) : (modbus.closeDuration || 0);
        var remainRatio5 = action.command === 'open' ? (100 - curPos5) / 100 : curPos5 / 100;
        if (fullDur5 > 0 && remainRatio5 > 0) {
            autoDur = Math.max(1, Math.round(fullDur5 * remainRatio5));
        }
    }
    controlMsg.payload = {
        deviceId: action.deviceId,
        command: action.command,
        modbus: modbus,
        duration: autoDur,
        source: 'automation_scheduler'
    };
    controlMsgs.push(controlMsg);
    updateDeviceState(action.deviceId, action.command);
    logParts.push(action.deviceId + ' ' + action.command);
    sendControlLog(action, action.command);
    sendSqliteLog(action.deviceId, action.command, 'automation_scheduler');

    var duration = action.duration || 0;
    if (action.durationUnit === 'minutes') duration = duration * 60;
    else if (action.durationUnit === 'hours') duration = duration * 3600;

    // bidir 장치(측창·차광 등)는 action.duration 무시 — 한계까지 완전 close/open 필요
    // closeDuration/openDuration 까지는 control_handler 의 scheduleAutoStop 이 자동 정지
    // 부분 동작은 작물 보호에 무의미 + 매 분 발동 시 모터 부담
    if (modbus.controlType === 'bidir') {
        node.warn('⏭️ bidir duration 무시: ' + action.deviceId + ' (한계까지 자동 close/open)');
        return;
    }

    if (duration > 0) {
        var reverseCmd = (modbus.controlType === 'bidir') ? 'stop' : REVERSE_CMD[action.command];
        if (!reverseCmd) return;
        node.warn('⏱️ Duration: ' + action.deviceId + ' ' + duration + '초 후 → ' + reverseCmd);

        (function(act, rev, dur, mb) {
            setTimeout(function() {
                var reverseMsg = RED.util.cloneMessage(msg);
                reverseMsg.payload = {
                    deviceId: act.deviceId,
                    command: rev,
                    modbus: mb,
                    source: 'automation_duration'
                };
                node.warn('⏳ Duration 종료: ' + act.deviceId + ' → ' + rev);
                node.send([reverseMsg, null, null, null, null]);
                updateDeviceState(act.deviceId, rev);
                sendControlLog(act, rev);
                sendSqliteLog(act.deviceId, rev, 'automation_duration');
            }, dur * 1000);
        })(action, reverseCmd, duration, modbus);
    }
});

flow.set('pendingRule', null);
flow.set('pendingActions', null);

var now = new Date().toISOString();
var dbMsg = {
    topic: "UPDATE automation_rules SET last_triggered_at = '" + now +
           "', trigger_count = " + ((rule.triggerCount || 0) + 1) +
           " WHERE id = '" + ruleId + "'",
    payload: []
};

node.warn('🎯 스케줄 실행 완료: ' + rule.name + ' → ' + (logParts.join(', ') || '(전부 스킵)'));

if (controlMsgs.length > 0) {
    var firstMsg = controlMsgs[0];
    for (var k = 1; k < controlMsgs.length; k++) {
        (function(m, delay) {
            setTimeout(function() { node.send([m, null, null, null, null]); }, delay);
        })(controlMsgs[k], k * 500);
    }
    return [firstMsg, dbMsg, { payload: '스케줄 실행: ' + rule.name }, null, null];
}

return [null, dbMsg, { payload: '스케줄 실행(제어없음): ' + rule.name }, null, null];
