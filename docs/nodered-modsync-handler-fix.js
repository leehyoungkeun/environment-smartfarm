// ================================================================
// modsync_handler — 응답 파싱 → global.relayModules / sensorModules 캐싱 (2026-05-01 final)
// ================================================================
// "모듈 동기화" 탭 → "모듈 정보 → global context" 함수 노드 코드 전체 교체
//
// 동작:
//   1. http request 응답 (msg.payload) 파싱
//   2. settings.relayModules / sensorModules 추출
//   3. global 컨텍스트에 캐싱
//   4. 변경 감지 시 warn 출력
// ================================================================

// payload 가 string 으로 온 경우 파싱 시도 (방어적)
let payload = msg.payload;
if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); }
    catch (e) {
        node.error('payload JSON 파싱 실패: ' + e.message);
        node.status({ fill: 'red', shape: 'dot', text: 'parse 실패' });
        return null;
    }
}

if (msg.statusCode !== 200) {
    node.error('❌ Sync 실패 status=' + msg.statusCode + ' source=' + msg._syncSource);
    node.status({ fill: 'red', shape: 'dot', text: 'API ' + msg.statusCode });
    return null;
}

const data = (payload && payload.data) || {};
const settings = data.settings || {};
const relayModules = Array.isArray(settings.relayModules) ? settings.relayModules : [];
const sensorModules = Array.isArray(settings.sensorModules) ? settings.sensorModules : [];

const prevRelay = global.get('relayModules') || [];
const prevSensor = global.get('sensorModules') || [];

global.set('relayModules', relayModules);
global.set('sensorModules', sensorModules);
global.set('modulesSyncedAt', new Date().toISOString());

const changed = (prevRelay.length !== relayModules.length) || (prevSensor.length !== sensorModules.length);
const source = msg._syncSource || '?';

node.status({
    fill: 'green',
    shape: 'dot',
    text: source + ' R:' + relayModules.length + ' S:' + sensorModules.length + (changed ? ' ★변경' : '')
});

if (changed) {
    node.warn('🔄 모듈 변경 감지 (' + source + '): relay=' + relayModules.length + ' sensor=' + sensorModules.length);
}

msg.payload = { relayModules, sensorModules, changed, source };
return msg;
