// ================================================================
// Modbus 센서 읽기 준비 — **있는 매핑은 절대 바꾸지 않는다** (2026-10-07)
// ================================================================
// "센서 수집" 탭 → "Modbus 센서 읽기 준비" 함수 노드 코드 전체 교체
//
// 2026-10-07 변경 — 사용자 요구: "내가 매핑한 대로 있어야 하고 CRUD 가 설정한 대로 그대로".
//   ✗ 제거: 'stale 보정' — 센서에 이미 매핑이 있는데 등록된 모듈과 다르면 **말없이 덮어썼다.**
//           화면에서 unit 3 으로 지정해도 다음 수집 때 모듈의 unit 1 로 돌아갔다.
//           이제 다르면 그대로 두고, 세어서 로그로만 알린다 (사람이 판단한다).
//   ○ 유지: **빈 매핑 채우기** — 하우스가 하나인 농장에 한해서만. 있는 값을 바꾸지 않으므로
//           "설정한 대로" 를 어기지 않는다. 다중 하우스는 어느 하우스 것인지 알 수 없어 금지
//           (2026-09-19 house_0003 이 house_0001 의 XY-MD02 를 읽은 사고).
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
let driftCount = 0;   // 모듈과 다른 매핑 — 덮어쓰지 않고 세기만 한다
let autoSkipped = 0;
// 2026-09-19: 새 자동매핑(매핑 없는 센서에 모듈 붙이기)은 **하우스가 하나인 농장**에서만.
//   모듈엔 어느 하우스 것인지 정보가 없다 — 다중 하우스에서 붙이면 house_0003 humidity_0001 이 house_0001 의 XY-MD02 를
//   읽어 남의 하우스 값을 실측으로 저장했다. 다중 하우스는 설정 화면에서 명시적으로 매핑한다. 기존 매핑의 stale 보정은 그대로.
const enabledHouseCount = (config.houses || []).filter(h => h.enabled !== false).length;
const allowNewAutoMap = enabledHouseCount <= 1;
for (const house of (config.houses || [])) {
    for (const sensor of (house.sensors || [])) {
        // KS X 3267 표준 센서(sensor.ks3267)는 별도 드라이버(ks3267d)가 읽는다 — 벤더 자동매핑 금지.
        // (2026-09-04: 표준 temp_0001 에 XY-MD02 매핑이 붙어 ③ 이 벤더 값으로 덮어쓴 사고)
        if (sensor.ks3267) continue;
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
        // ★ 이미 매핑이 있으면 **건드리지 않는다**. 모듈과 달라도 사람이 그렇게 정한 것이다.
        //   예전에는 여기서 덮어써, 화면에서 지정한 값이 다음 수집에 원복됐다 (2026-10-07 제거).
        if (m && m.unitId != null) { driftCount++; continue; }
        if (!allowNewAutoMap) { autoSkipped++; continue; }
        sensor.modbus = {
            unitId: mod.unitId,
            fc: mod.fc || 3,
            address: mod.address || 0,
            quantity: mod.quantity || 1,
            registerIndex: inferred.registerIndex,
            divider: mod.divider || 1,
            signed: mod.signed || false,
        };
        autoMapped++;
    }
}

// ───────── 모든 sensor 모음 ─────────
const houses = config.houses || (config.sensors ? [config] : []);
const allSensors = [];

for (const house of houses) {
    if (house.enabled === false) continue;
    const sensors = (house.sensors || []).filter(s => s.enabled !== false && !s.ks3267 && s.modbus && s.modbus.unitId != null && s.modbus.address != null);
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
        + (driftCount ? ' (모듈과 다름 ' + driftCount + ' — 사람 설정 유지)' : '')
        + (autoSkipped ? ' (미매핑 ' + autoSkipped + ')' : '')
});
return [msg, null];
