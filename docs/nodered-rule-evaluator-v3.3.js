// houseConfig에서 장치 modbus 설정 조회
function findModbus(houseId, deviceId) {
    var config = global.get('houseConfig');
    if (!config || !config.houses) return null;
    for (var i = 0; i < config.houses.length; i++) {
        if (config.houses[i].houseId === houseId) {
            var devices = config.houses[i].devices || [];
            for (var j = 0; j < devices.length; j++) {
                if (devices[j].deviceId === deviceId) {
                    return devices[j].modbus || null;
                }
            }
        }
    }
    return null;
}

// ② 규칙 평가 (핵심 엔진 v3.3) — 장치 상태 확인 추가
var rules = msg.payload || [];
var allSensorData = msg.allSensorData || {};

if (rules.length === 0) {
    node.status({ fill: 'grey', shape: 'dot', text: '활성 규칙 없음' });
    return null;
}

var now = new Date();
var nowMinutes = now.getHours() * 60 + now.getMinutes();
var nowKey = now.getHours() + ':' + now.getMinutes();

var executedRules = context.get('executedRules') || {};
var cleaned = {};
for (var ek in executedRules) {
    if (ek.indexOf('_' + nowKey) !== -1) cleaned[ek] = true;
}

var actionsToExecute = [];
var updateMessages = [];

function evaluateTimeCondition(cond) {
    var currentDay = now.getDay();
    if (cond.days && cond.days.length > 0) {
        var numDays = cond.days.map(function(d) { return Number(d); });
        if (numDays.indexOf(currentDay) === -1) return false;
    }

    if (!cond.timeMode && cond.time) {
        if (typeof cond.time !== 'string') return false;
        var parts = cond.time.split(':');
        return nowMinutes === parseInt(parts[0]) * 60 + parseInt(parts[1]);
    }

    if (cond.timeMode === 'specific') {
        var times = cond.times || [];
        for (var i = 0; i < times.length; i++) {
            if (!times[i] || typeof times[i] !== 'string') continue;
            var p = times[i].split(':');
            if (nowMinutes === parseInt(p[0]) * 60 + parseInt(p[1])) return true;
        }
        return false;
    }

    if (cond.timeMode === 'interval') {
        var sp = (cond.startTime || '00:00').split(':');
        var ep = (cond.endTime || '23:59').split(':');
        var start = parseInt(sp[0]) * 60 + parseInt(sp[1]);
        var end = parseInt(ep[0]) * 60 + parseInt(ep[1]);
        var interval = cond.intervalMinutes || 30;
        if (start <= end) {
            if (nowMinutes < start || nowMinutes > end) return false;
            for (var t = start; t <= end; t += interval) {
                if (nowMinutes === t) return true;
            }
        } else {
            var inRange = (nowMinutes >= start) || (nowMinutes <= end);
            if (!inRange) return false;
            for (var t = start; t < 1440; t += interval) {
                if (nowMinutes === t) return true;
            }
            var lastBefore = start;
            for (var t2 = start; t2 < 1440; t2 += interval) lastBefore = t2;
            var firstAfter = (lastBefore + interval) - 1440;
            if (firstAfter < 0) firstAfter = 0;
            for (var t3 = firstAfter; t3 <= end; t3 += interval) {
                if (nowMinutes === t3) return true;
            }
        }
        return false;
    }
    return false;
}

var REVERSE_CMD = { 'on': 'off', 'off': 'on' };
var autoDevices = global.get('autoDevices') || [];
var deviceStates = global.get('deviceStates') || {};

if (autoDevices.length === 0) {
    node.warn('⏸️ 규칙 평가 대기: 자동화 적용 전 — 평가 안 함');
    return;
}

for (var ri = 0; ri < rules.length; ri++) {
    var rule = rules[ri];
    var conditions, actions;
    try { conditions = JSON.parse(rule.conditions); } catch(e) { continue; }
    try { actions = JSON.parse(rule.actions); } catch(e) { continue; }

    // ★ 시간 전용 규칙 → ④ 스케줄러 담당, ② 에서 스킵
    var sensorConds = conditions.filter(function(c) { return c.type === 'sensor'; });
    var timeConds = conditions.filter(function(c) { return c.type === 'time'; });
    if (timeConds.length > 0 && sensorConds.length === 0) {
        continue;
    }

    var minuteKey = rule.id + '_' + nowKey;
    if (cleaned[minuteKey]) continue;

    if (rule.last_triggered_at) {
        var elapsed = (now.getTime() - new Date(rule.last_triggered_at).getTime()) / 1000;
        if (elapsed < (rule.cooldown_seconds || 60)) continue;
    }

    var ruleHouseId = rule.house_id || 'house_0001';
    var houseSensor = allSensorData[ruleHouseId] || {};
    var sData = houseSensor.data || {};

    var sensorResult = true;
    var timeResult = true;

    if (sensorConds.length > 0) {
        var sensorResults = sensorConds.map(function(cond) {
            var val = sData[cond.sensorId];
            if (val === undefined || val === null) return false;
            switch (cond.operator) {
                case '>': return val > cond.value;
                case '>=': return val >= cond.value;
                case '<': return val < cond.value;
                case '<=': return val <= cond.value;
                case '==': return Math.abs(val - cond.value) < 0.1;
                default: return false;
            }
        });
        sensorResult = (rule.condition_logic === 'OR')
            ? sensorResults.some(function(r) { return r; })
            : sensorResults.every(function(r) { return r; });
    }

    if (timeConds.length > 0) {
        var timeResults = timeConds.map(function(c) { return evaluateTimeCondition(c); });
        timeResult = timeResults.some(function(r) { return r; });
    }

    var triggered = false;
    var groupLogic = rule.group_logic || 'AND';
    if (sensorConds.length > 0 && timeConds.length > 0) {
        triggered = (groupLogic === 'OR') ? (sensorResult || timeResult) : (sensorResult && timeResult);
    } else if (sensorConds.length > 0) {
        triggered = sensorResult;
    } else if (timeConds.length > 0) {
        triggered = timeResult;
    }

    if (triggered) {
        cleaned[minuteKey] = true;

        for (var ai = 0; ai < actions.length; ai++) {
            var action = actions[ai];
            if (autoDevices.indexOf(action.deviceId) === -1) {
                node.warn('⛔ ' + action.deviceId + ': 수동 모드 스킵');
                continue;
            }

            // bidir 장치만 상태 체크 (창문/밸브: 이미 열려있으면 스킵)
            var modbusCfg = findModbus(ruleHouseId, action.deviceId);
            if (modbusCfg && modbusCfg.controlType === 'bidir') {
                var currentState = deviceStates[action.deviceId];
                if (currentState) {
                    var isAlready = (action.command === 'open' && currentState === 'open') ||
                                    (action.command === 'close' && currentState === 'closed');
                    if (isAlready) {
                        node.warn('⏭️ ' + action.deviceId + ': 이미 ' + currentState + ' 상태 → 스킵');
                        continue;
                    }
                }
            }

            var rawDuration = action.duration || 0;
            var unit = action.durationUnit || 'seconds';
            var durationSec = rawDuration;
            if (unit === 'minutes') durationSec = rawDuration * 60;
            else if (unit === 'hours') durationSec = rawDuration * 3600;

            actionsToExecute.push({
                ruleId: rule.id,
                ruleName: rule.name,
                houseId: rule.house_id,
                deviceId: action.deviceId,
                deviceType: action.deviceType,
                deviceName: action.deviceName || action.deviceId,
                command: action.command,
                duration: durationSec,
                reason: rule.name
            });
        }

        var newCount = (rule.trigger_count || 0) + 1;
        updateMessages.push({
            topic: "UPDATE automation_rules SET last_triggered_at = '" + now.toISOString() + "', trigger_count = " + newCount + ", synced = 0 WHERE id = '" + rule.id + "'",
            payload: []
        });

        node.warn('🤖 자동화: ' + rule.name + ' → ' + actionsToExecute.slice(-actions.length).map(function(a) {
            return a.deviceId + ' ' + a.command + (a.duration ? ' (' + a.duration + '초)' : '');
        }).join(', '));
    }
}

context.set('executedRules', cleaned);

if (actionsToExecute.length === 0) {
    node.status({ fill: 'green', shape: 'dot', text: rules.length + '개 규칙, 실행 없음 (' + nowKey + ')' });
    if (updateMessages.length > 0) return [null, updateMessages, null];
    return null;
}

node.status({ fill: 'green', shape: 'dot', text: '실행: ' + actionsToExecute.length + '개 (' + nowKey + ')' });

var controlMessages = actionsToExecute.map(function(action) {
    var cm = RED.util.cloneMessage(msg);
    cm.control = {
        houseId: action.houseId,
        deviceId: action.deviceId,
        deviceType: action.deviceType,
        command: action.command,
        operator: 'automation',
        modbus: findModbus(action.houseId, action.deviceId),
        requestId: 'auto_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        timestamp: now.toISOString()
    };
    cm._action = action;
    return cm;
});

actionsToExecute.forEach(function(action) {
    if (action.duration > 0) {
        var modbusCfg = findModbus(action.houseId, action.deviceId);
        var reverseCmd = (modbusCfg && modbusCfg.controlType === 'bidir') ? 'stop' : REVERSE_CMD[action.command];
        if (!reverseCmd) return;

        var timerKey = 'dur_' + action.deviceId;
        var existing = context.get(timerKey);
        if (existing) {
            clearTimeout(existing);
            node.warn('🔄 타이머 교체: ' + action.deviceId);
        }

        var timer = setTimeout(function() {
            var rm = RED.util.cloneMessage(msg);
            rm.control = {
                houseId: action.houseId,
                deviceId: action.deviceId,
                deviceType: action.deviceType,
                command: reverseCmd,
                operator: 'automation_duration',
                modbus: findModbus(action.houseId, action.deviceId),
                requestId: 'auto_dur_' + Date.now(),
                timestamp: new Date().toISOString()
            };
            var logm = RED.util.cloneMessage(msg);
            logm.topic = "INSERT INTO control_logs (timestamp, device_id, command, source, synced) VALUES ('" + new Date().toISOString() + "', '" + action.deviceId + "', '" + reverseCmd + "', 'automation_duration', 0)";
            logm.payload = [];
            node.send([rm, null, logm]);
            node.warn('⏱️ Duration 종료: ' + action.deviceId + ' → ' + reverseCmd);
            context.set(timerKey, null);
        }, action.duration * 1000);

        context.set(timerKey, timer);
        node.warn('⏱️ Duration: ' + action.deviceId + ' ' + action.duration + '초 후 → ' + reverseCmd);
    }
});

var logMessages = actionsToExecute.map(function(action) {
    var lm = RED.util.cloneMessage(msg);
    lm.topic = "INSERT INTO control_logs (timestamp, device_id, command, source, synced) VALUES ('" + now.toISOString() + "', '" + action.deviceId + "', '" + action.command + "', 'automation', 0)";
    lm.payload = [];
    return lm;
});

return [
    controlMessages.length > 0 ? controlMessages : null,
    updateMessages.length > 0 ? updateMessages : null,
    logMessages.length > 0 ? logMessages : null
];
