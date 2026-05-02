// ================================================================
// 릴레이 전체 OFF — 자동매핑 버전 (2026-05-02)
// ================================================================
// "릴레이 초기화" 탭 → "릴레이 전체 OFF" 함수 노드 코드 전체 교체
//
// 변경: Waveshare/Eletechsup unit-id 하드코딩 (1, 2) → global.relayModules 동적
//   - 모듈 추가/삭제/unit-id 변경 시 별도 수정 불필요
//   - 어제 Waveshare unit-id 1→2 변경 후 OFF 명령이 unit 1 에 가던 버그 해결
// ================================================================

const relayModules = global.get('relayModules') || [];

if (!Array.isArray(relayModules) || relayModules.length === 0) {
    msg.payload = { success: false, detail: '등록된 릴레이 모듈 없음' };
    msg.statusCode = 400;
    node.send([null, msg]);
    node.warn('⚠️ 릴레이 전체 OFF: 등록된 모듈 없음');
    return null;
}

var results = [];
var commands = [];

for (const mod of relayModules) {
    const moduleType = (mod.moduleType || 'waveshare').toLowerCase();
    const channels = mod.channels || 8;

    if (moduleType === 'eletechsup') {
        // FC06 single write, 1-indexed register, value 512 = OFF (0x0200)
        for (let i = 1; i <= channels; i++) {
            commands.push({
                payload: { unitid: mod.unitId, fc: 6, address: i, value: 512, quantity: 1 },
                label: 'Eletechsup uid:' + mod.unitId + ' CH' + (i - 1),
            });
        }
    } else {
        // Waveshare FC15 multi-coil write, 0-indexed
        commands.push({
            payload: {
                unitid: mod.unitId,
                fc: 15,
                address: 0,
                quantity: channels,
                value: new Array(channels).fill(0),
            },
            label: (mod.name || 'Waveshare') + ' uid:' + mod.unitId + ' ' + channels + 'CH',
        });
    }
}

var sent = 0;
var total = commands.length;

function sendNext() {
    if (sent >= total) {
        msg.payload = {
            success: true,
            detail: total + '개 명령 전송',
            results: results,
        };
        msg.statusCode = 200;
        node.send([null, msg]);
        node.warn('🔄 릴레이 전체 OFF 완료: ' + total + '개 명령 (' + relayModules.length + ' 모듈)');
        return;
    }

    var cmd = commands[sent];
    var m = RED.util.cloneMessage(msg);
    m.payload = cmd.payload;
    results.push(cmd.label + ' → OFF');
    sent++;

    node.send([m, null]);

    if (sent < total) {
        setTimeout(sendNext, 200);
    } else {
        setTimeout(sendNext, 300);
    }
}

sendNext();
return null;
