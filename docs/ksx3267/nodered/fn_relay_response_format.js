// ============================================================
// "응답 포맷" (id b102f19a550233cc) — 릴레이 MQTT 상태 탭. 30초마다·제어 직후 FC1 로 읽은 릴레이 코일 → MQTT
// 2026-09-19: 읽은 코일을 global.vendorCoils 에도 보관 (비표준 구동기 1분 스냅샷)
// ============================================================
// Modbus 읽기 결과 → MQTT 응답 포맷
const farmId = global.get('houseConfig')?.farmId 
            || global.get('farmId') 
            || env.get('FARM_ID') 
            || 'farm_0001';

// buildModbusMsg 가 _module 에 박아둔 unit 정보 사용 (unit=2 Waveshare)
const mod = msg._module || {};
const unitId = mod.unitId || (msg.payload && msg.payload.unitid) || 2;
const moduleType = mod.moduleType || 'waveshare';

const coils = {};
if (msg.payload && Array.isArray(msg.payload)) {
    msg.payload.forEach((val, idx) => {
        coils[idx] = !!val;
    });
}

// 2026-09-19 표준·비표준 저장 정책 통일: 실제로 읽은 코일 상태를 보관 — 「1분 스냅샷」이 비표준 구동기 행을 만든다.
//   (FC1 로 방금 읽은 값만. 읽기 실패면 이 함수까지 오지 않으므로 t 가 멈추고, 스냅샷은 3분 넘은 값을 버린다)
const vc = global.get('vendorCoils') || {};
vc[String(unitId)] = { coils: coils, t: Date.now(), moduleType: moduleType };
global.set('vendorCoils', vc);

msg.topic = `smartfarm/${farmId}/relay/response`;
msg.payload = {
    farmId,
    unitId,
    moduleType,
    coils,
    timestamp: new Date().toISOString()
};

node.warn(`📡 릴레이 상태 MQTT 발행 (unit=${unitId}/${moduleType}): ${JSON.stringify(coils)}`);
return msg;
