// PC backend /config/farm/{farmId} 응답 → global.houseConfig 갱신
// + 옛 modbus_cfg_* 캐시 자동 정리 (근본 sync 강화, 2026-05-17)
//
// 변경 (v2):
//   - 기존 houseConfig SET 동작은 그대로 유지
//   - device 삭제·수정 시 유효 deviceId 집합 계산
//   - 모든 modbus_cfg_* 키 중 유효하지 않은 것 자동 제거
//   - 향후 frontend 에서 device 삭제 시 RPi 캐시 자동 정리

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
    node.warn('houseConfig 빈 응답 — refresh 안 함');
    return null;
}

const farmId = msg._farmId || 'farm_0001';
const eventType = msg._eventType || '?';

// houseConfig 구조 (기존 그대로)
const newHouseConfig = {
    farmId,
    houses: houses.map(h => ({
        id: h.houseId,
        houseId: h.houseId,
        name: h.houseName || h.name,
        enabled: h.enabled !== false,
        sensors: h.sensors || [],
        devices: h.devices || [],
        configVersion: h.configVersion || 0,
    })),
    configVersion: Math.max(0, ...houses.map(h => h.configVersion || 0)),
};

global.set('houseConfig', newHouseConfig);
global.set('houseConfigUpdatedAt', new Date().toISOString());

// 워치독 캐시 무효화 (modules 변경 시 워치독이 옛 sensor 폴링 안 하도록)
global.set('_watchdogModules', null);

// ⭐ 신규: 옛 modbus_cfg_* 캐시 자동 정리
// device 삭제 시 RPi 측 캐시도 함께 제거 — 근본 동기화 강화
const validDeviceIds = new Set(
    houses.flatMap(h => (h.devices || []).map(d => d.deviceId))
);

const allKeys = global.keys();
const cleanedIds = [];
allKeys.forEach(k => {
    if (k.startsWith('modbus_cfg_')) {
        const deviceId = k.substring('modbus_cfg_'.length);
        if (!validDeviceIds.has(deviceId)) {
            global.set(k, undefined);
            cleanedIds.push(deviceId);
        }
    }
});
if (cleanedIds.length > 0) {
    node.warn('🗑️ 옛 modbus_cfg 캐시 정리 (' + cleanedIds.length + '개): ' + cleanedIds.join(', '));
}

const sensorTotal = houses.reduce((sum, h) => sum + (h.sensors?.length || 0), 0);
const deviceTotal = houses.reduce((sum, h) => sum + (h.devices?.length || 0), 0);

const cleanedTag = cleanedIds.length > 0 ? ' 🗑️' + cleanedIds.length : '';
node.status({
    fill: 'green', shape: 'dot',
    text: eventType + ' H:' + houses.length + ' S:' + sensorTotal + ' D:' + deviceTotal + cleanedTag
});
node.warn('🏠 houseConfig refresh (' + eventType + '): ' + houses.length + ' houses, ' + sensorTotal + ' sensors, ' + deviceTotal + ' devices' + (cleanedIds.length > 0 ? ' (cache cleaned: ' + cleanedIds.length + ')' : ''));

return null;
