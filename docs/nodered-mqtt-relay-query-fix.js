// ================================================================
// MQTT 릴레이 조회 처리 — 등록된 모듈 자동 인식 (2026-05-01)
// ================================================================
// "Modbus 릴레이 읽기 + 응답" 함수 노드의 코드 전체 교체
//
// ⚠️ 기존 코드는 unitid:1, fc:1 (Waveshare) 하드코딩 → Eletechsup 등록 시 동작 안 함
// ✅ 새 코드는 "모듈 동기화" 탭이 PC 백엔드에서 받아 global 에 캐싱한 relayModules 사용
//
// 동작:
//   1. global.relayModules (modsync_handler 가 저장) 조회
//   2. 첫 모듈을 즉시 호출 (waveshare → FC1 coils, eletechsup → FC3 register)
//   3. 모듈이 여러 개면 1초 간격으로 순차 호출 (RS-485 충돌 방지)
//
// 출력:
//   1: Modbus 호출 (modbus-flex-getter)
//   2: (사용 안 함)
// ================================================================

let relayModules = global.get('relayModules');
if (!Array.isArray(relayModules)) relayModules = [];

// fallback: houseConfig.devices 에서 unit 추출 (모듈 동기화 미가동 시)
if (relayModules.length === 0) {
    const houseConfig = global.get('houseConfig');
    if (houseConfig && Array.isArray(houseConfig.houses)) {
        const seen = {};
        for (const h of houseConfig.houses) {
            for (const d of (h.devices || [])) {
                const mb = d.modbus;
                if (!mb || !mb.unitId || seen[mb.unitId]) continue;
                seen[mb.unitId] = true;
                relayModules.push({
                    unitId: mb.unitId,
                    moduleType: mb.moduleType || 'waveshare',
                    channels: 8,
                });
            }
        }
    }
}

if (relayModules.length === 0) {
    node.status({ fill: 'grey', shape: 'dot', text: '등록 모듈 없음' });
    node.warn('relay/query: 등록된 릴레이 모듈이 없습니다');
    return null;
}

// ───────── 모듈별 Modbus 요청 생성 ─────────
function buildModbusMsg(mod) {
    const moduleType = (mod.moduleType || 'waveshare').toLowerCase();
    if (moduleType === 'eletechsup') {
        // FC3 (Read Holding Registers), 1-indexed (channel 1..N)
        return {
            payload: {
                unitid: mod.unitId,
                fc: 3,
                address: 1,
                quantity: mod.channels || 8,
            },
            topic: 'relay_query',
            _module: { unitId: mod.unitId, moduleType: 'eletechsup', channels: mod.channels || 8 },
        };
    }
    // 기본: Waveshare (FC1 Read Coils, 0-indexed)
    return {
        payload: {
            unitid: mod.unitId,
            fc: 1,
            address: 0,
            quantity: mod.channels || 8,
        },
        topic: 'relay_query',
        _module: { unitId: mod.unitId, moduleType: 'waveshare', channels: mod.channels || 8 },
    };
}

const first = buildModbusMsg(relayModules[0]);

// 나머지 모듈은 1초 간격으로 순차 발송 (RS-485 충돌 회피)
for (let i = 1; i < relayModules.length; i++) {
    (function (mod, idx) {
        setTimeout(function () {
            node.send([buildModbusMsg(mod), null]);
        }, idx * 1000);
    })(relayModules[i], i);
}

node.status({ fill: 'blue', shape: 'dot', text: relayModules.length + '개 모듈 query ' + new Date().toLocaleTimeString() });
return [first, null];
