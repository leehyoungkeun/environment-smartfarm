// ================================================================
// 워치독 v3 — 단계적 복구 + 백엔드 알림
// ================================================================
// wd_evaluator 노드의 "함수" 코드에 통째로 붙여넣기
//
// 출력 4개:
//   1. 디버그 로그
//   2. 복구 Modbus 명령 (modbus-flex-write)
//   3. modbus-client reconnect 명령 (modbus-server 노드에 reconnect 메시지)
//   4. HTTP 알림 (백엔드 /api/internal/farm-event POST)
//
// 단계:
//   3회 실패  → 단순 재시도 (Modbus reset 명령)
//   5회 실패  → modbus-client 재연결 명령
//  10회 실패  → 백엔드에 MODBUS_FAILURE 알림 + Node-RED 재시작 트리거
//  20회 실패  → 5분간 알림 폭주 차단 (이미 알림 보냄)
// ================================================================

var info = msg._watchdog;
if (!info) return null;

var moduleName = info.module;
var ok = msg._watchdogOk;

var THRESHOLDS = {
    retry: 3,        // 단순 복구 명령
    reconnect: 5,    // modbus-client 재연결
    restart: 10,     // 백엔드 알림 + Node-RED 재시작
};

var modules = global.get('_watchdogModules') || [];
var moduleConfig = null;
for (var i = 0; i < modules.length; i++) {
    if (modules[i].moduleType + '_' + modules[i].unitId === moduleName) {
        moduleConfig = modules[i];
        break;
    }
}

var failures = context.get('failures') || {};
var alerts = context.get('alerts') || {};
var history = context.get('history') || [];
var lastNotified = context.get('lastNotified') || {};

history.push({ module: moduleName, ok: ok, time: new Date().toISOString() });
if (history.length > 30) history = history.slice(-30);
context.set('history', history);

function updateGlobalStatus() {
    var status = {};
    modules.forEach(function (m) {
        var key = m.moduleType + '_' + m.unitId;
        status[key] = { ok: (failures[key] || 0) === 0, failCount: failures[key] || 0 };
    });
    status.lastCheck = new Date().toISOString();
    global.set('watchdogStatus', status);
}

function statusText() {
    return modules.map(function (m) {
        var key = m.moduleType + '_' + m.unitId;
        return m.moduleType.charAt(0).toUpperCase() + m.unitId + ':' + (failures[key] || 0);
    }).join(' ') + ' ' + new Date().toLocaleTimeString();
}

// ───────── 성공 ─────────
if (ok) {
    var prevFail = failures[moduleName] || 0;
    if (prevFail >= THRESHOLDS.restart) {
        // 큰 장애에서 복구됨 — 백엔드에 복구 알림
        var farmId = global.get('FARM_ID') || env.get('FARM_ID') || 'farm_0001';
        var recoverMsg = {
            method: 'POST',
            url: 'http://localhost:3000/api/internal/farm-event',
            headers: { 'Content-Type': 'application/json', 'x-api-key': global.get('SENSOR_API_KEY') || 'smartfarm-sensor-key' },
            payload: {
                farmId: farmId,
                eventType: 'MODBUS_RECOVERED',
                severity: 'INFO',
                message: moduleName + ' 통신 복구 (이전 ' + prevFail + '회 실패)',
                payload: { module: moduleName, prevFailCount: prevFail },
            },
        };
        node.warn('✅ ' + moduleName + ' 복구됨 — 백엔드 알림');
        failures[moduleName] = 0;
        delete alerts[moduleName];
        delete lastNotified[moduleName];
        context.set('failures', failures);
        context.set('alerts', alerts);
        context.set('lastNotified', lastNotified);
        global.set('watchdogAlert', Object.keys(alerts).length > 0 ? alerts : null);
        updateGlobalStatus();
        node.status({ fill: 'green', shape: 'dot', text: statusText() });
        return [{ payload: '✅ ' + moduleName + ' 정상' }, null, null, recoverMsg];
    }

    if (prevFail > 0) {
        node.warn('✅ ' + moduleName + ' 복구됨 (이전 ' + prevFail + '회 실패)');
    }
    failures[moduleName] = 0;
    if (alerts[moduleName]) {
        delete alerts[moduleName];
        global.set('watchdogAlert', Object.keys(alerts).length > 0 ? alerts : null);
    }
    delete lastNotified[moduleName];
    context.set('failures', failures);
    context.set('alerts', alerts);
    context.set('lastNotified', lastNotified);
    updateGlobalStatus();
    node.status({ fill: 'green', shape: 'dot', text: statusText() });
    return [{ payload: '✅ ' + moduleName + ' 정상' }, null, null, null];
}

// ───────── 실패 ─────────
failures[moduleName] = (failures[moduleName] || 0) + 1;
node.warn('❌ ' + moduleName + ' 응답 없음 (' + failures[moduleName] + '회)');
context.set('failures', failures);
updateGlobalStatus();

var failCount = failures[moduleName];

// 1단계: 단순 재시도 미만 — 카운트만
if (failCount < THRESHOLDS.retry) {
    node.status({ fill: 'yellow', shape: 'dot', text: statusText() });
    return [{ payload: '⚠️ ' + moduleName + ' 실패 ' + failCount + '회' }, null, null, null];
}

// 알림 정보 갱신
var alertInfo = {
    module: moduleName,
    unitId: info.unitId,
    failCount: failCount,
    since: alerts[moduleName] ? alerts[moduleName].since : new Date().toISOString(),
    lastCheck: new Date().toISOString()
};
alerts[moduleName] = alertInfo;
context.set('alerts', alerts);
global.set('watchdogAlert', alerts);

// 2단계: 단순 복구 명령 (3회)
var recoveryMsg = null;
if (failCount === THRESHOLDS.retry && moduleConfig) {
    recoveryMsg = RED.util.cloneMessage(msg);
    recoveryMsg.payload = {
        value: moduleConfig.resetValue,
        unitid: moduleConfig.unitId,
        fc: moduleConfig.resetFc,
        address: moduleConfig.resetAddr,
        quantity: moduleConfig.resetQty
    };
    node.warn('🚨 ' + moduleName + ' ' + failCount + '회 — 복구 Modbus 명령');
}

// 3단계: modbus-client 재연결 (5회)
var reconnectMsg = null;
if (failCount === THRESHOLDS.reconnect) {
    reconnectMsg = { payload: { connectorType: 'reconnect' }, topic: 'reconnect' };
    node.warn('🚨 ' + moduleName + ' ' + failCount + '회 — modbus-client 재연결');
}

// 4단계: 백엔드 알림 + Node-RED 재시작 트리거 (10회, 1회만)
var httpMsg = null;
if (failCount >= THRESHOLDS.restart && !lastNotified[moduleName]) {
    var farmId2 = global.get('FARM_ID') || env.get('FARM_ID') || 'farm_0001';
    httpMsg = {
        method: 'POST',
        url: 'http://localhost:3000/api/internal/farm-event',
        headers: { 'Content-Type': 'application/json', 'x-api-key': global.get('SENSOR_API_KEY') || 'smartfarm-sensor-key' },
        payload: {
            farmId: farmId2,
            eventType: 'MODBUS_FAILURE',
            severity: 'CRITICAL',
            message: moduleName + ' 통신 장애 ' + failCount + '회 — 자동 복구 실패',
            payload: { module: moduleName, failCount: failCount, since: alertInfo.since },
            cooldownMinutes: 30,
        },
    };
    lastNotified[moduleName] = Date.now();
    context.set('lastNotified', lastNotified);

    // Node-RED 재시작 — restart hook 호출 (실패해도 다음 단계 영향 없음)
    setTimeout(function () {
        try {
            require('child_process').exec(
                '/usr/local/bin/smartfarm-restart-nodered.sh modbus_failure_' + moduleName,
                function () { /* 무시 */ }
            );
        } catch (e) { /* 무시 */ }
    }, 2000);

    node.warn('🚨 ' + moduleName + ' ' + failCount + '회 — 백엔드 알림 + Node-RED 재시작 예약');
}

node.status({ fill: 'red', shape: 'ring', text: '🚨 ' + statusText() });

return [
    { payload: '🚨 ' + moduleName + ' 장애 (' + failCount + '회)' },
    recoveryMsg,
    reconnectMsg,
    httpMsg
];
