// PC backend /config/farm/{farmId} 응답 → global.houseConfig 갱신 + SQLite house_configs 미러 (2026-09-04)
//
// 출력 1: (없음 — 기존과 동일, null)
// 출력 2: SQLite 「미러」 노드로 — 하우스별 UPSERT + 클라우드에 없는 하우스 DELETE
//
// 왜: 클라우드 config/update 는 여기서 전역(global.houseConfig)만 갱신하고 SQLite 는 건드리지 않았다.
//     그런데 REST GET /api/config/farm 은 SQLite 만 읽고(키오스크가 이 REST 를 읽음), 부팅 시 전역이
//     비어 있으면 SQLite 로 복원한다 → 클라우드에서 추가한 표준 장치가 키오스크에 안 보이고(v58 stale),
//     컨텍스트 초기화 후 재부팅 땐 옛 설정이 되살아난다. SQLite 를 클라우드의 내구 미러로 유지한다.
// 원칙: 전역은 지금처럼 즉시 set(동작 변화 없음). 미러는 부수 효과. 빈 응답·비200 이면 미러도 하지 않는다
//       (SQLite 전멸 방지 — automation_rules 부분목록 삭제 사고와 같은 함정).

let payload = msg.payload;
if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch (e) {
        node.error('houseConfig 응답 파싱 실패: ' + e.message);
        return null;
    }
}

if (msg.statusCode !== 200) {
    node.error('❌ houseConfig 조회 실패 status=' + msg.statusCode);
    node.status({ fill: 'red', shape: 'dot', text: 'API ' + msg.statusCode });
    return null;
}

const houses = (payload && payload.success && Array.isArray(payload.data)) ? payload.data : [];
if (houses.length === 0) {
    node.warn('houseConfig 빈 응답 — refresh 안 함 (SQLite 미러도 안 함)');
    return null;
}

const farmId = msg._farmId || 'farm_0001';
const eventType = msg._eventType || '?';

// ── 1) 전역 갱신 (기존 그대로) ──────────────────────────────────────────
const newHouseConfig = {
    farmId,
    houses: houses.map(h => ({
        id: h.houseId,
        houseId: h.houseId,
        name: h.houseName || h.name,
        houseName: h.houseName || h.name,
        enabled: h.enabled !== false,
        sensors: h.sensors || [],
        devices: h.devices || [],
        collection: h.collection || {},
        configVersion: h.configVersion || 0,
    })),
    configVersion: Math.max(0, ...houses.map(h => h.configVersion || 0)),
};

global.set('houseConfig', newHouseConfig);
global.set('houseConfigUpdatedAt', new Date().toISOString());

// 워치독 캐시 무효화 (modules 변경 시 워치독이 옛 sensor 폴링 안 하도록)
global.set('_watchdogModules', null);

// ── 2) SQLite house_configs 미러 (출력 2) ─────────────────────────────
// 스키마·컬럼 순서는 Config CRUD 「UPSERT 준비」와 동일. 차이: config_version 은 +1 이 아니라
// **클라우드 버전을 그대로** 복사(미러), created_at 은 최초 INSERT 때만.
const now = new Date().toISOString();
const UPSERT = 'INSERT INTO house_configs (id, farm_id, house_id, house_name, sensors, collection, devices, crops, crop_type, crop_variety, planting_date, device_count, enabled, config_version, created_at, updated_at) '
    + 'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) '
    + 'ON CONFLICT(farm_id, house_id) DO UPDATE SET house_name = excluded.house_name, sensors = excluded.sensors, collection = excluded.collection, '
    + 'devices = excluded.devices, crops = excluded.crops, crop_type = excluded.crop_type, crop_variety = excluded.crop_variety, planting_date = excluded.planting_date, '
    + 'device_count = excluded.device_count, enabled = excluded.enabled, config_version = excluded.config_version, updated_at = excluded.updated_at';

const mirror = houses.map((h, i) => {
    const devices = h.devices || [];
    return {
        topic: UPSERT,
        payload: [
            Date.now().toString(36) + Math.random().toString(36).substr(2, 9) + i,
            farmId,
            h.houseId,
            h.houseName || h.name || '',
            JSON.stringify(h.sensors || []),
            JSON.stringify(h.collection || {}),
            JSON.stringify(devices),
            JSON.stringify(h.crops || []),
            h.cropType || '', h.cropVariety || '', h.plantingDate || '',
            h.deviceCount !== undefined ? h.deviceCount : devices.length,
            h.enabled !== false ? 1 : 0,
            h.configVersion || 0,
            h.createdAt || now,
            now,
        ],
        _farmId: farmId, _mirror: 'upsert', _houseId: h.houseId,
    };
});

// 클라우드에 없는 하우스는 SQLite 에서 제거 (하우스 id 는 전부 바인딩 — SQL 조립 금지)
const ids = houses.map(h => h.houseId);
mirror.push({
    topic: 'DELETE FROM house_configs WHERE farm_id = $1 AND house_id NOT IN (' + ids.map((_, i) => '$' + (i + 2)).join(',') + ')',
    payload: [farmId].concat(ids),
    _farmId: farmId, _mirror: 'delete',
});

const sensorTotal = houses.reduce((sum, h) => sum + (h.sensors?.length || 0), 0);
const deviceTotal = houses.reduce((sum, h) => sum + (h.devices?.length || 0), 0);

node.status({
    fill: 'green', shape: 'dot',
    text: eventType + ' H:' + houses.length + ' S:' + sensorTotal + ' D:' + deviceTotal + ' → SQLite'
});
node.warn('🏠 houseConfig refresh (' + eventType + '): ' + houses.length + ' houses, ' + sensorTotal + ' sensors, ' + deviceTotal + ' devices — SQLite 미러 ' + mirror.length + '건');

return [null, mirror];
