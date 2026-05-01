// ================================================================
// Modbus 센서 읽기 준비 — 자동 매핑 추가 버전 (2026-05-01)
// ================================================================
// "센서 수집" 탭 → "Modbus 센서 읽기 준비" 함수 노드 코드 전체 교체
//
// 변경: sensor.modbus 가 비어있을 때 global.sensorModules 의 매칭 모듈로 자동 채움
//   - sensorId prefix 로 register index 추론 (temp_* → 0, humidity_* → 1)
//   - 모듈 등록만 하면 모든 house 의 sensor 가 자동 동작 (UI 매핑 불필요)
// ================================================================

const config = msg.config || global.get('houseConfig');
if (!config) { return [null, msg]; }

// ───────── 자동 매핑: sensor.modbus 비어있으면 global.sensorModules 로 채움 ─────────
const sensorModules = global.get('sensorModules') || [];
const moduleByType = {};
for (const mod of sensorModules) {
    if (mod && mod.sensorType) moduleByType[mod.sensorType] = mod;
}

function inferType(sensorId) {
    const id = String(sensorId || '').toLowerCase();
    // XY-MD02 (humidity 먼저 변종): register 0 = 습도, register 1 = 온도
    if (id.startsWith('temp')) return { type: 'temperature_humidity', registerIndex: 1 };
    if (id.startsWith('humid')) return { type: 'temperature_humidity', registerIndex: 0 };
    if (id.startsWith('co2')) return { type: 'co2', registerIndex: 0 };
    if (id.startsWith('soil_temp')) return { type: 'soil', registerIndex: 0 };
    if (id.startsWith('soil_moist')) return { type: 'soil', registerIndex: 1 };
    if (id.startsWith('ec')) return { type: 'ec', registerIndex: 0 };
    if (id.startsWith('ph')) return { type: 'ph', registerIndex: 0 };
    return null;
}

let autoMapped = 0;
let stalefixed = 0;
for (const house of (config.houses || [])) {
    for (const sensor of (house.sensors || [])) {
        const inferred = inferType(sensor.sensorId);
        if (!inferred) continue;
        const mod = moduleByType[inferred.type];
        if (!mod) continue;
        const m = sensor.modbus;
        // 등록된 모듈과 매핑이 일치하면 그대로 사용
        const matches = m && m.unitId === mod.unitId
            && m.address === (mod.address || 0)
            && m.fc === (mod.fc || 3)
            && m.quantity === (mod.quantity || 1);
        if (matches) continue;
        // 비어있거나 stale 매핑 → 자동매핑으로 덮어쓰기
        const wasStale = m && m.unitId != null;
        sensor.modbus = {
            unitId: mod.unitId,
            fc: mod.fc || 3,
            address: mod.address || 0,
            quantity: mod.quantity || 1,
            registerIndex: inferred.registerIndex,
            divider: mod.divider || 1,
            signed: mod.signed || false,
        };
        if (wasStale) stalefixed++; else autoMapped++;
    }
}

// ───────── 모든 sensor 모음 ─────────
const houses = config.houses || (config.sensors ? [config] : []);
const allSensors = [];

for (const house of houses) {
    if (house.enabled === false) continue;
    const sensors = (house.sensors || []).filter(s => s.enabled !== false && s.modbus && s.modbus.unitId != null && s.modbus.address != null);
    for (const sensor of sensors) {
        allSensors.push({
            houseId: house.houseId || house.id,
            sensorId: sensor.sensorId,
            unitId: sensor.modbus.unitId,
            fc: sensor.modbus.fc || 3,
            address: sensor.modbus.address,
            quantity: sensor.modbus.quantity || 1,
            registerIndex: sensor.modbus.registerIndex || 0,
            divider: sensor.modbus.divider || 1,
            signed: sensor.modbus.signed || false
        });
    }
}

if (allSensors.length === 0) {
    node.status({ fill: 'grey', shape: 'ring', text: 'Modbus 센서 없음' });
    msg.modbusReadings = {};
    return [null, msg];
}

// ───────── unique read 집계 (같은 unitId/fc/address/quantity 는 1번만 read) ─────────
const uniqueReads = [];
const sensorMap = {};
for (const s of allSensors) {
    const key = s.unitId + ':' + s.fc + ':' + s.address + ':' + s.quantity;
    if (!sensorMap[key]) {
        sensorMap[key] = [];
        uniqueReads.push({
            key: key,
            unitId: s.unitId,
            fc: s.fc,
            address: s.address,
            quantity: s.quantity
        });
    }
    sensorMap[key].push(s);
}

flow.set('modbusUniqueReads', uniqueReads);
flow.set('modbusSensorMap', sensorMap);
flow.set('modbusReadIndex', 0);
flow.set('modbusReadings', {});
flow.set('modbusReadConfig', msg.config);

var first = uniqueReads[0];
msg.payload = {
    fc: first.fc,
    unitid: first.unitId,
    address: first.address,
    quantity: first.quantity
};
msg._modbusKey = first.key;

node.status({
    fill: 'blue',
    shape: 'dot',
    text: 'Modbus 1/' + uniqueReads.length
        + (autoMapped ? ' (auto+' + autoMapped + ')' : '')
        + (stalefixed ? ' (stale fix ' + stalefixed + ')' : '')
});
return [msg, null];
