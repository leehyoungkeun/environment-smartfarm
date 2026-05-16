// 양액 telemetry publisher — EC/pH/유량 값을 backend 에 POST
// 입력: msg.payload = { ec, ph, flow, temperature, timestamp }
// 출력: HTTP request 노드로 전달
//
// backend: PUT /internal/nutrient/state/telemetry (farmId 는 x-api-key 로 식별)
// body: { ecCurrent, phCurrent, solarAccumulated?, currentCycle? }

const r = msg.payload;
if (!r || typeof r !== 'object') return null;

// 기존 NR 패턴 — sensorApiKey + FARM_ID 환경변수 fallback
const farmId = global.get('FARM_ID') || 'farm_0001';
const apiKey = global.get('sensorApiKey') || 'smartfarm-sensor-key';

// 일사량 적산 (solar 기반 시나리오용) — 별도 inject 또는 weather 노드에서 set
const solarAccumulated = global.get('solarAccumulated') || 0;

// 현재 사이클 (cycle-runner 가 set 한 값)
const currentCycle = global.get('currentCycle') || null;

// telemetry 페이로드
const body = {
    ecCurrent: r.ec,
    phCurrent: r.ph,
    solarAccumulated,
};
if (currentCycle) body.currentCycle = currentCycle;

// HTTP request 노드용 msg 구성
msg.url = `https://api.smartgreen.kr/internal/nutrient/state/telemetry`;
msg.method = 'PUT';
msg.headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
};
msg.payload = body;

// 메인 펌프 상태 추적 (시뮬레이터에 피드백)
global.set('lastTelemetry', { ec: r.ec, ph: r.ph, at: Date.now() });

node.status({ fill: 'green', shape: 'dot', text: `PUT EC ${r.ec}` });

return msg;
