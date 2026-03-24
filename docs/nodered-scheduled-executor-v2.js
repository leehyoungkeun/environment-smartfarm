// ================================================================
// ⑤ 스케줄 실행 핸들러 v2 (Node-RED function 노드)
// ================================================================
// 입력: msg.scheduledRule + msg.scheduledActions (④ 스케줄러에서 전달)
// 출력 1: Modbus 제어 메시지 → 제어 실행 (릴레이)
// 출력 2: DB 업데이트 메시지 → SQLite 쿼리
// 출력 3: 디버그 로그
// 출력 4: 제어 이력 → http request (PC 백엔드)
// ================================================================

var rule = msg.scheduledRule;
var actions = msg.scheduledActions;

if (!rule || !actions || actions.length === 0) {
    node.warn('⚠️ 스케줄 실행: 규칙 또는 액션 없음');
    return null;
}

var ruleId = rule._id || rule.id;
var REVERSE_CMD = { on: 'off', off: 'on' };
var deviceStates = global.get('deviceStates') || {};

// --- PC 서버 URL ---
var pcServer = global.get('pcServerUrl') || 'http://192.168.137.1:3000';

// --- Modbus 설정 찾기 ---
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

// --- 제어 이력 전송 ---
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
    node.send([null, null, null, logMsg]);
}

var controlMsgs = [];
var logParts = [];

actions.forEach(function(action) {
    var modbus = findModbus(action.deviceId);
    if (!modbus) {
        node.warn('⚠️ ' + action.deviceId + ': Modbus 설정 없음');
        return;
    }

    // bidir 장치만 상태 체크 (창문/밸브: 이미 열려있으면 스킵)
    if (modbus.controlType === 'bidir') {
        var currentState = deviceStates[action.deviceId];
        if (currentState) {
            var isAlready = (action.command === 'open' && currentState === 'open') ||
                            (action.command === 'close' && currentState === 'closed');
            if (isAlready) {
                node.warn('⏭️ ' + action.deviceId + ': 이미 ' + currentState + ' 상태 → 스킵');
                return;
            }
        }
    }

    // 제어 메시지 생성
    var controlMsg = RED.util.cloneMessage(msg);
    controlMsg.payload = {
        deviceId: action.deviceId,
        command: action.command,
        modbus: modbus,
        source: 'automation_scheduler'
    };
    controlMsgs.push(controlMsg);

    logParts.push(action.deviceId + ' ' + action.command);

    // 제어 이력 전송
    sendControlLog(action, action.command);

    // Duration 처리 (X초 후 역방향 명령)
    var duration = action.duration || 0;
    if (action.durationUnit === 'minutes') duration = duration * 60;
    else if (action.durationUnit === 'hours') duration = duration * 3600;

    if (duration > 0) {
        var modbusCfg = findModbus(action.deviceId);
        var reverseCmd = (modbusCfg && modbusCfg.controlType === 'bidir') ? 'stop' : REVERSE_CMD[action.command];
        if (!reverseCmd) return;

        node.warn('⏱️ Duration: ' + action.deviceId + ' ' + duration + '초 후 → ' + reverseCmd);

        (function(act, rev, dur) {
            setTimeout(function() {
                var reverseMsg = RED.util.cloneMessage(msg);
                reverseMsg.payload = {
                    deviceId: act.deviceId,
                    command: rev,
                    modbus: modbus,
                    source: 'automation_duration'
                };
                node.warn('⏳ Duration 종료: ' + act.deviceId + ' → ' + rev);
                node.send([reverseMsg, null, null, null]);
                // 역방향 명령 이력도 저장
                sendControlLog(act, rev);
            }, dur * 1000);
        })(action, reverseCmd, duration);
    }
});

// DB 업데이트 (lastTriggeredAt, triggerCount)
var now = new Date().toISOString();
var dbMsg = {
    topic: "UPDATE automation_rules SET last_triggered_at = '" + now +
           "', trigger_count = " + ((rule.triggerCount || 0) + 1) +
           " WHERE id = '" + ruleId + "'",
    payload: []
};

node.warn('🎯 스케줄 실행 완료: ' + rule.name + ' → ' + logParts.join(', '));

// 출력: [제어, DB업데이트, 로그, 제어이력]
if (controlMsgs.length > 0) {
    var firstMsg = controlMsgs[0];

    for (var k = 1; k < controlMsgs.length; k++) {
        (function(m, delay) {
            setTimeout(function() { node.send([m, null, null, null]); }, delay);
        })(controlMsgs[k], k * 500);
    }

    return [firstMsg, dbMsg, { payload: '스케줄 실행: ' + rule.name }, null];
}

return [null, dbMsg, { payload: '스케줄 실행(제어없음): ' + rule.name }, null];
