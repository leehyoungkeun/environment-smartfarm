// ================================================================
// 워치독 판정 — 실패 카운트 + 알림 + 복구
// ================================================================
var info = msg._watchdog;
if (!info) return null;

// stale 카운터 자가청소 — 모듈 교체(unitId 변경/제거) 시 옛 카운터 자동 정리
(function () {
    var currentModules = global.get('_watchdogModules') || [];
    var validKeys = {};
    currentModules.forEach(function (m) { validKeys[m.moduleType + '_' + m.unitId] = true; });
    var f = context.get('failures') || {};
    var a = context.get('alerts') || {};
    var n = context.get('lastNotified') || {};
    var cleaned = false;
    Object.keys(f).forEach(function (k) {
        if (!validKeys[k]) { delete f[k]; cleaned = true; }
    });
    Object.keys(a).forEach(function (k) { if (!validKeys[k]) delete a[k]; });
    Object.keys(n).forEach(function (k) { if (!validKeys[k]) delete n[k]; });
    if (cleaned) {
        context.set('failures', f);
        context.set('alerts', a);
        context.set('lastNotified', n);
        global.set('watchdogAlert', Object.keys(a).length > 0 ? a : null);
        node.warn('🧹 stale 카운터 정리됨');
    }
})();

var moduleName = info.module;
var ok = msg._watchdogOk;
var THRESHOLD = 3;

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

history.push({ module: moduleName, ok: ok, time: new Date().toISOString() });
if (history.length > 30) history = history.slice(-30);
context.set('history', history);

function updateGlobalStatus() {
    var status = {};
    modules.forEach(function(m) {
        var key = m.moduleType + '_' + m.unitId;
        status[key] = { ok: (failures[key] || 0) === 0, failCount: failures[key] || 0 };
    });
    status.lastCheck = new Date().toISOString();
    global.set('watchdogStatus', status);
}

function statusText() {
    return modules.map(function(m) {
        var key = m.moduleType + '_' + m.unitId;
        return m.moduleType.charAt(0).toUpperCase() + m.unitId + ':' + (failures[key] || 0);
    }).join(' ') + ' ' + new Date().toLocaleTimeString();
}

if (ok) {
    if ((failures[moduleName] || 0) > 0) {
        node.warn('✅ ' + moduleName + ' 복구됨 (이전 ' + failures[moduleName] + '회 실패)');
    }
    failures[moduleName] = 0;

    // 복구 시 조건 없이 global 갱신 — 노드 컨텍스트가 재시작에 사라져도 옛 경보(6/29)가 남지 않게
    delete alerts[moduleName];
    global.set('watchdogAlert', Object.keys(alerts).length > 0 ? alerts : null);

    context.set('failures', failures);
    context.set('alerts', alerts);
    updateGlobalStatus();
    node.status({ fill: 'green', shape: 'dot', text: statusText() });
    return [{ payload: '✅ ' + moduleName + ' 정상' }, null, null];
}

failures[moduleName] = (failures[moduleName] || 0) + 1;
node.warn('❌ ' + moduleName + ' 응답 없음 (' + failures[moduleName] + '회)');

context.set('failures', failures);
updateGlobalStatus();

if (failures[moduleName] < THRESHOLD) {
    node.status({ fill: 'yellow', shape: 'dot', text: statusText() });
    return [{ payload: '⚠️ ' + moduleName + ' 실패 ' + failures[moduleName] + '회' }, null, null];
}

var alertInfo = {
    module: moduleName,
    unitId: info.unitId,
    failCount: failures[moduleName],
    since: alerts[moduleName] ? alerts[moduleName].since : new Date().toISOString(),
    lastCheck: new Date().toISOString()
};
alerts[moduleName] = alertInfo;
context.set('alerts', alerts);
global.set('watchdogAlert', alerts);

node.warn('🚨 ' + moduleName + ' 장애! ' + failures[moduleName] + '회 — 복구 시도');

var recoveryMsg = null;
if (moduleConfig) {
    recoveryMsg = RED.util.cloneMessage(msg);
    recoveryMsg.payload = {
        value: moduleConfig.resetValue,
        unitid: moduleConfig.unitId,
        fc: moduleConfig.resetFc,
        address: moduleConfig.resetAddr,
        quantity: moduleConfig.resetQty
    };
}

node.status({ fill: 'red', shape: 'ring', text: '🚨 ' + statusText() });

return [
    { payload: '🚨 ' + moduleName + ' 장애 (' + failures[moduleName] + '회)' },
    recoveryMsg,
    { payload: alertInfo }
];