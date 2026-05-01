// ================================================================
// MQTT 릴레이 조회 처리 — 등록된 모듈 자동 인식 (2026-05-01)
// ================================================================
// "Modbus 릴레이 읽기 + 응답" 함수 노드의 코드 전체 교체
//
// ⚠️ 기존 코드는 unitid:1, fc:1 (Waveshare) 하드코딩 → Eletechsup 등록 시 동작 안 함
// ✅ 새 코드는 SQLite 의 system_settings.relayModules 를 읽어 모든 모듈 순차 query
//
// 동작:
//   1. SQLite system_settings 의 settings.relayModules 조회
//   2. 첫 모듈을 즉시 호출 (waveshare → FC1 coils, eletechsup → FC3 register)
//   3. 모듈이 여러 개면 1초 간격으로 순차 호출 (RS-485 충돌 방지)
//
// 출력:
//   1: Modbus 호출 (modbus-flex-getter)
//   2: (사용 안 함)
// ================================================================

const farmId = global.get('FARM_ID') || env.get('FARM_ID') || 'farm_0001';

// ───────── system_settings 조회 (동기 SQLite — better-sqlite3) ─────────
// ※ Node-RED settings.js 에 functionGlobalContext 로 better-sqlite3 등록 필요
//    또는 아래의 fallback 으로 global 캐시 사용
let relayModules = [];

try {
    const Database = global.get('better_sqlite3') || global.get('sqlite3');
    if (Database) {
        const db = new Database('/home/lhk/.node-red/smartfarm.db', { readonly: true });
        const row = db.prepare("SELECT settings FROM system_settings WHERE farm_id = ?").get(farmId);
        db.close();
        if (row && row.settings) {
            const s = typeof row.settings === 'string' ? JSON.parse(row.settings) : row.settings;
            relayModules = Array.isArray(s.relayModules) ? s.relayModules : [];
        }
    }
} catch (e) {
    node.warn('SQLite system_settings 조회 실패: ' + e.message);
}

// fallback: global 캐시 (별도 노드가 갱신하면)
if (relayModules.length === 0) {
    const cached = global.get('registeredRelayModules');
    if (Array.isArray(cached) && cached.length > 0) relayModules = cached;
}

// 마지막 fallback: houseConfig.devices 에서 unit 추출 (워치독 패턴)
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
