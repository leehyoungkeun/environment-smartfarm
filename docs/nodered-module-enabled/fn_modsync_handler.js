// ================================================================
// modsync_handler — 응답 파싱 → global.relayModules / sensorModules 캐싱
// 2026-10-06: 「사용 안 함」(enabled === false) 모듈은 캐시에 넣지 않는다
// ================================================================
// "모듈 동기화" 탭 → "모듈 정보 → global context" 함수 노드 코드 전체 교체
//
// 왜 여기서 거르나:
//   relayModules / sensorModules 를 읽는 곳이 7군데(릴레이 읽기·sq_dispatch·전체OFF·
//   센서읽기준비·상태발행·헬스체크·스케줄)인데, 전부 이 global 캐시를 본다.
//   한 곳에서 거르면 나머지가 자동으로 따라간다 — 군데군데 조건을 넣지 않는다.
//
// 동작:
//   1. http request 응답 (msg.payload) 파싱
//   2. settings.relayModules / sensorModules 추출
//   3. enabled === false 인 모듈 제외 후 global 컨텍스트에 캐싱
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
const allRelay = Array.isArray(settings.relayModules) ? settings.relayModules : [];
const allSensor = Array.isArray(settings.sensorModules) ? settings.sensorModules : [];

// 설정에서 「사용 안 함」 으로 둔 모듈은 읽지 않는다. 설정은 서버에 그대로 남아 있고,
// 다시 「사용」 으로 바꾸면 다음 동기화에 되살아난다 (삭제와 다르다 — 장치 매핑을 잃지 않는다).
const on = function (m) { return m && m.enabled !== false; };
const relayModules = allRelay.filter(on);
const sensorModules = allSensor.filter(on);
const offCount = (allRelay.length - relayModules.length) + (allSensor.length - sensorModules.length);

// 릴레이 워치독(wd_request)은 모듈 목록을 houseConfig 의 장치에서 뽑는다 — 이 캐시를 보지 않는다.
// 그래서 꺼둔 모듈의 unitId 를 따로 넘겨 거기서도 거르게 한다 (2026-10-06).
// 같은 unitId 를 쓰는 다른 모듈이 켜져 있으면 끄면 안 되므로, 켜진 쪽을 먼저 모은다.
const enabledUnits = {};
relayModules.concat(sensorModules).forEach(function (m) { if (m && m.unitId != null) enabledUnits[m.unitId] = true; });
const disabledUnits = [];
allRelay.concat(allSensor).forEach(function (m) {
    if (m && m.enabled === false && m.unitId != null && !enabledUnits[m.unitId] && disabledUnits.indexOf(Number(m.unitId)) < 0) {
        disabledUnits.push(Number(m.unitId));
    }
});
global.set('disabledUnits', disabledUnits);

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
    text: source + ' R:' + relayModules.length + ' S:' + sensorModules.length
        + (offCount ? ' (사용안함 ' + offCount + ')' : '') + (changed ? ' ★변경' : '')
});

if (changed) {
    node.warn('🔄 모듈 변경 감지 (' + source + '): relay=' + relayModules.length
        + ' sensor=' + sensorModules.length + (offCount ? ' · 사용 안 함 ' + offCount + '개 제외' : ''));
}

msg.payload = { relayModules, sensorModules, changed, source, disabled: offCount, disabledUnits };
return msg;
