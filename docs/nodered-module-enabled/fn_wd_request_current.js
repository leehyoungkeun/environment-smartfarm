// ================================================================
// 릴레이 워치독 — houseConfig에서 모듈 자동 감지
// ================================================================
// 센서 폴링 완료 5초 후 실행 → RS-485 버스 충돌 없음
// 최소 60초 간격 보장 (센서 폴링이 더 잦아도 스킵)
// ================================================================

var lastCheck = context.get('lastCheck') || 0;
if (Date.now() - lastCheck < 55000) {
    return null;
}
context.set('lastCheck', Date.now());

var houseConfig = global.get('houseConfig');
var modules = [];
var seenUnits = {};

if (houseConfig && houseConfig.houses) {
    for (var i = 0; i < houseConfig.houses.length; i++) {
        var devices = houseConfig.houses[i].devices || [];
        for (var j = 0; j < devices.length; j++) {
            var mb = devices[j].modbus;
            if (!mb || !mb.unitId || seenUnits[mb.unitId]) continue;
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
    node.status({fill:'grey', shape:'dot', text:'릴레이 모듈 없음'});
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

node.status({fill:'blue', shape:'dot', text: modules.length + '개 모듈 ' + new Date().toLocaleTimeString()});
return msg1;
