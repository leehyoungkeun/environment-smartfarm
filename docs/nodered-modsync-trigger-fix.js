// ================================================================
// modsync_trigger — 백엔드 system-settings GET 요청 준비 (2026-05-01 final)
// ================================================================
// "모듈 동기화" 탭 → "백엔드 API 호출 준비" 함수 노드 코드 전체 교체
//
// 캐시 무력화: _t 쿼리 파라미터 + no-cache 헤더 (Cloudflare/Node-RED HTTP 캐시 회피)
// ================================================================

const farmId = global.get('farmId') || env.get('FARM_ID') || 'farm_0001';
const pcServer = global.get('pcServerUrl') || 'https://api.smartgreen.kr';
const apiKey = global.get('sensorApiKey') || 'smartfarm-sensor-key';

const source = msg.topic === 'scheduled_sync' ? '검증' : '즉시';

msg.method = 'GET';
msg.url = pcServer + '/api/config/system-settings/' + farmId + '?_t=' + Date.now();
msg.headers = {
    'x-api-key': apiKey,
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'If-None-Match': '',
    'Accept-Encoding': 'identity',
    'Accept': 'application/json',
};
msg.payload = null;
msg._syncSource = source;

node.status({ fill: 'blue', shape: 'dot', text: source + ' 요청' });
return msg;
