// 양액 설정·시나리오·상태 fetcher — 5분 주기 inject
// 입력: timestamp (5분 inject)
// 출력: 3개 HTTP request 메시지 (config, scenarios, state)
//
// backend 에서 받아온 데이터는 응답 처리 노드에서 global 에 저장:
//   global.nutrientConfig  (탱크/밸브/경보/하드웨어)
//   global.activeScenario  (active=true 인 시나리오)
//   global.state           (mode + currentCycle 등)

// 기존 NR 패턴 — sensorApiKey + FARM_ID 환경변수 fallback
const farmId = global.get('FARM_ID') || 'farm_0001';
const apiKey = global.get('sensorApiKey') || 'smartfarm-sensor-key';

const baseUrl = `https://api.smartgreen.kr/internal/nutrient`;
const headers = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
};

const reqs = [
    { url: `${baseUrl}/config`,    method: 'GET', headers, _key: 'nutrientConfig' },
    { url: `${baseUrl}/scenarios`, method: 'GET', headers, _key: 'scenarios' },
    { url: `${baseUrl}/state`,     method: 'GET', headers, _key: 'state' },
];

node.status({ fill: 'blue', shape: 'dot', text: '⟳ 동기화 중' });

return reqs.map(r => ({ ...r }));

// ─────────────────────────────────────────
// 응답 처리 노드 (별도 function):
//   const key = msg._key;
//   const body = msg.payload;
//   if (body && body.success) {
//       if (key === 'nutrientConfig') {
//           global.set('nutrientConfig', body.data);
//       } else if (key === 'scenarios') {
//           const active = (body.data || []).find(s => s.active);
//           global.set('activeScenario', active || null);
//       } else if (key === 'state') {
//           global.set('state', body.data);
//       }
//   }
//   node.status({ fill: 'green', shape: 'dot', text: `✓ ${key}` });
//   return null;
