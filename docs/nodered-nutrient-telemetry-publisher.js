// 양액 telemetry publisher — EC/pH/유량 값을 backend 에 POST
// 입력: msg.payload = { ec, ph, flow, temperature, timestamp }
// 출력: HTTP request 노드로 전달
//
// backend: PUT /api/nutrient/:farmId/state/telemetry
// body: { ecCurrent, phCurrent, solarAccumulated?, currentCycle? }

const r = msg.payload;
if (!r || typeof r !== 'object') return null;

const farmConfig = global.get('farmConfig') || {};
const farmId = farmConfig.farmId || 'farm_0001';
const apiKey = farmConfig.apiKey;

if (!apiKey) {
    node.warn('farmConfig.apiKey 미설정 — backend 인증 실패 예상');
}

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
msg.url = `https://api.smartgreen.kr/api/nutrient/${farmId}/state/telemetry`;
msg.method = 'PUT';
msg.headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey || '',
};
msg.payload = body;

// 메인 펌프 상태 추적 (시뮬레이터에 피드백)
global.set('lastTelemetry', { ec: r.ec, ph: r.ph, at: Date.now() });

node.status({ fill: 'green', shape: 'dot', text: `PUT EC ${r.ec}` });

return msg;
