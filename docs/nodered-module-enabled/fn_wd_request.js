// ================================================================
// 릴레이 워치독 — houseConfig에서 모듈 자동 감지
// 2026-10-06: 설정에서 「사용 안 함」 으로 둔 모듈(unitId)은 두드리지 않는다
// ================================================================
// 왜 여기도 고치나: 이 노드만 모듈 목록을 global.relayModules 가 아니라 houseConfig 의
// 장치에서 뽑는다. 모듈을 꺼도 장치는 남아 있어 계속 두드렸고, 「Modbus 모듈 장애」
// 경보가 그대로 떴다. 꺼둔 unitId 는 modsync_handler 가 global.disabledUnits 로 넘긴다.
// 센서 폴링 완료 5초 후 실행 → RS-485 버스 충돌 없음
// 최소 60초 간격 보장 (센서 폴링이 더 잦아도 스킵)
// ================================================================

var lastCheck = context.get('lastCheck') || 0;
if (Date.now() - lastCheck < 55000) {
    return null;
}
context.set('lastCheck', Date.now());

var houseConfig = global.get('houseConfig');
var disabledUnits = global.get('disabledUnits') || [];
var modules = [];
var seenUnits = {};

if (houseConfig && houseConfig.houses) {
    for (var i = 0; i < houseConfig.houses.length; i++) {
        var devices = houseConfig.houses[i].devices || [];
        for (var j = 0; j < devices.length; j++) {
            var mb = devices[j].modbus;
            if (!mb || !mb.unitId || seenUnits[mb.unitId]) continue;
            if (disabledUnits.indexOf(Number(mb.unitId)) >= 0) continue;   // 「사용 안 함」 모듈
            seenUnits[mb.unitId] = true;

            var mod = { unitId: mb.unitId, moduleType: mb.moduleType || 'waveshare' };

            if (mod.moduleType === 'waveshare') {
                mod.readFc = 1;  mod.readAddr = 0;
                mod.resetFc = 15; mod.resetAddr = 0; mod.resetQty = 8;
                mod.resetValue = [0,0,0,0,0,0,0,0];
            } else if (mod.moduleType === 'eletechsup') {
                mod.readFc = 3;  mod.readAddr = 1;
                mod.resetFc = 6; mod.resetAddr = 1; mod.resetQty = 1;
                mod.resetValue = 0;
            } else {
                mod.readFc = 1;  mod.readAddr = 0;
                mod.resetFc = 15; mod.resetAddr = 0; mod.resetQty = 8;
                mod.resetValue = [0,0,0,0,0,0,0,0];
            }
            modules.push(mod);
        }
    }
}

if (modules.length === 0) {
    // 지켜볼 모듈이 없으면 경보도 없어야 한다. 여기서 비우지 않으면 wd_evaluator 가
    // 호출되지 않아(응답이 없으니) 옛 경보가 영원히 남는다.
    global.set('_watchdogModules', []);
    if (global.get('watchdogAlert')) global.set('watchdogAlert', null);
    global.set('watchdogStatus', { lastCheck: new Date().toISOString() });
    node.status({fill:'grey', shape:'dot', text: disabledUnits.length ? '모듈 없음 (사용안함 ' + disabledUnits.length + ')' : '릴레이 모듈 없음'});
    return null;
}

global.set('_watchdogModules', modules);

// ★ 깨끗한 새 메시지 생성 (cloneMessage 제거)
var first = modules[0];
var msg1 = {
    payload: { unitid: first.unitId, fc: first.readFc, address: first.readAddr, quantity: 1 },
    _watchdog: { module: first.moduleType + '_' + first.unitId, unitId: first.unitId }
};

for (var k = 1; k < modules.length; k++) {
    (function(mod, idx) {
        setTimeout(function() {
            node.send({
                payload: { unitid: mod.unitId, fc: mod.readFc, address: mod.readAddr, quantity: 1 },
                _watchdog: { module: mod.moduleType + '_' + mod.unitId, unitId: mod.unitId }
            });
        }, idx * 3000);
    })(modules[k], k);
}

node.status({fill:'blue', shape:'dot', text: modules.length + '개 모듈'
    + (disabledUnits.length ? ' (사용안함 ' + disabledUnits.length + ')' : '') + ' ' + new Date().toLocaleTimeString()});
return msg1;
