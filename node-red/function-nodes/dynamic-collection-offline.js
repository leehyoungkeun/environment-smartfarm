/**
 * Node-RED Function 노드
 * 동적 센서 수집 - SQLite 로컬 저장 + 서버 전송 (오프라인 대응)
 *
 * 변경 사항 (기존 dynamic-collection.js 대비):
 * - 센서 수집 후 항상 SQLite에 저장 (온라인/오프라인 무관)
 * - 운영 모드에 따라 서버 전송 여부 결정
 * - 서버 전송 성공 시 synced=1 마킹
 *
 * 플로우 구성:
 * [Inject 10분] → [모드 확인] → [Fetch Config] → [Collect Sensors]
 *     → [SQLite INSERT (항상)] → [모드 확인]
 *         online → [서버 전송] → 성공 시 synced=1
 *         offline → 저장만 완료
 */


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Function 1: 설정 로드 (서버 또는 SQLite 캐시)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 노드 이름: "설정 로드"
 * 입력: Inject
 * 출력: 1 (HTTP Request로) 또는 2 (센서 수집으로 - 오프라인 시)
 */

const SERVER_URL = env.get('SERVER_URL') || 'http://192.168.137.1:3000';
const FARM_ID = env.get('FARM_ID') || 'farm_0001';
const HOUSE_ID = env.get('HOUSE_ID') || 'house_001';
const API_KEY = env.get('SENSOR_API_KEY') || '';

const operationMode = global.get('operationMode') || 'online';

if (operationMode === 'online') {
    // 온라인: 서버에서 설정 가져오기
    msg.url = `${SERVER_URL}/api/config/${HOUSE_ID}?farmId=${FARM_ID}`;
    msg.method = 'GET';
    msg.headers = {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
    };
    return [msg, null]; // 출력 1: HTTP Request로
} else {
    // 오프라인: global 캐시 → SQLite 캐시 순서로 설정 로드
    const cachedConfig = global.get('houseConfig');
    if (cachedConfig) {
        msg.config = cachedConfig;
        node.warn('📋 오프라인 모드: 캐시된 설정 사용');
        return [null, msg]; // 출력 2: 센서 수집으로 직접
    } else {
        // global에 없으면 SQLite config_cache에서 로드 시도
        // (Node-RED 재시작 직후 startup-init이 아직 완료 안 된 경우)
        node.warn('⚠️ global 캐시 없음 → SQLite config_cache 조회 시도');
        msg.topic = "SELECT config_json FROM config_cache ORDER BY version DESC LIMIT 1";
        msg._fallbackConfigLoad = true;
        return [null, msg]; // 출력 2: SQLite 쿼리로 (config_cache)
    }
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Function 2: 설정 응답 처리 + SQLite 캐시 저장
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 노드 이름: "설정 응답 처리"
 * 입력: HTTP Response
 * 출력 1: 센서 수집으로
 * 출력 2: SQLite 설정 캐시 저장으로
 */

if (msg.statusCode !== 200) {
    const cachedConfig = global.get('houseConfig');
    if (cachedConfig) {
        node.warn('⚠️ 서버 응답 실패, 캐시된 설정 사용');
        msg.config = cachedConfig;
        return [msg, null];
    } else {
        node.error('❌ 서버 응답 실패, 캐시 없음');
        return [null, null];
    }
}

const response = msg.payload;
if (!response.success) {
    node.error(`설정 오류: ${response.error}`);
    return [null, null];
}

const config = response.data;

// 설정 버전 체크
const cachedConfig = global.get('houseConfig');
const cachedVersion = cachedConfig ? cachedConfig.configVersion : 0;

if (config.configVersion > cachedVersion) {
    node.warn(`설정 업데이트: v${cachedVersion} → v${config.configVersion}`);
    global.set('houseConfig', config);

    // SQLite에도 캐시 저장 (Node-RED 재시작 대비)
    const cacheMsg = {
        topic: `INSERT OR REPLACE INTO config_cache (id, farm_id, house_id, config_json, version, updated_at)
                VALUES (1, '${config.farmId}', '${config.houseId}', '${JSON.stringify(config).replace(/'/g, "''")}', ${config.configVersion}, '${new Date().toISOString()}')`
    };
    return [msg, cacheMsg]; // 출력 1: 센서 수집, 출력 2: SQLite 저장
}

msg.config = config;
return [msg, null];


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Function 3: 동적 센서 데이터 수집
// (기존과 동일 - dynamic-collection.js Function 3 참조)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 노드 이름: "센서 수집"
 * 입력: 설정 포함 msg
 * 출력: 센서 데이터 포함 msg
 */

// (기존 코드 동일 - dynamic-collection.js의 Function 3 사용)


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Function 4: SQLite 저장 (항상 실행)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 노드 이름: "SQLite 저장 (항상)"
 * 입력: 센서 데이터 msg
 * 출력 1: 서버 전송으로 (온라인 시)
 * 출력 2: 완료 (오프라인 시)
 *
 * 핵심: 온라인/오프라인 무관하게 항상 SQLite에 저장
 */

const sensorData = msg.payload.data;
const farmId = msg.payload.farmId;
const houseId = msg.payload.houseId;
const ts = msg.payload.timestamp || new Date().toISOString();

// 센서별로 개별 INSERT
const values = [];
for (const [sensorId, value] of Object.entries(sensorData)) {
    if (value !== null && value !== undefined) {
        values.push(`('${ts}', '${farmId}', '${houseId}', '${sensorId}', ${value}, 0)`);
    }
}

if (values.length === 0) {
    node.warn('⚠️ 저장할 센서 데이터 없음');
    return [null, null];
}

// SQLite INSERT
msg.topic = `INSERT INTO sensor_data (timestamp, farm_id, house_id, sensor_id, value, synced)
VALUES ${values.join(', ')}`;

// 저장할 레코드 ID를 추적하기 위해 타임스탬프 기록
msg._insertTimestamp = ts;
msg._sensorCount = values.length;

node.warn(`💾 SQLite 저장: ${values.length}건 (${Object.keys(sensorData).join(', ')})`);

// 모드에 따라 다음 단계 결정
const mode = global.get('operationMode') || 'online';
msg._operationMode = mode;

return msg;
// → SQLite 노드로 전달 → Function 5에서 분기


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Function 5: SQLite 저장 후 분기
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 노드 이름: "모드별 분기"
 * 입력: SQLite 저장 완료 후
 * 출력 1: 서버 전송 (온라인)
 * 출력 2: 완료 Debug (오프라인)
 */

const mode5 = msg._operationMode || global.get('operationMode') || 'online';

node.status({
    fill: mode5 === 'online' ? 'green' : 'yellow',
    shape: 'dot',
    text: `${mode5} | ${msg._sensorCount}건 저장`
});

if (mode5 === 'online') {
    // 온라인: 서버 전송 진행
    const SERVER_URL_5 = env.get('SERVER_URL') || 'http://192.168.137.1:3000';
    const API_KEY_5 = env.get('SENSOR_API_KEY') || '';

    msg.url = `${SERVER_URL_5}/api/sensors/collect`;
    msg.method = 'POST';
    msg.headers = {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY_5
    };
    // payload는 이미 센서 데이터

    return [msg, null]; // 출력 1: HTTP Request로
} else {
    // 오프라인: SQLite만 저장 완료
    node.warn(`📴 오프라인 모드: SQLite만 저장 (synced=0)`);
    msg.payload = `오프라인 저장 완료: ${msg._sensorCount}건`;
    return [null, msg]; // 출력 2: Debug로
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Function 6: 서버 전송 결과 처리
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 노드 이름: "전송 결과 처리"
 * 입력: HTTP Response
 * 출력 1: synced=1 업데이트 SQL (성공 시)
 * 출력 2: Debug
 */

if (msg.statusCode === 201 || msg.statusCode === 200) {
    // 성공 → SQLite에서 synced=1로 마킹
    node.warn(`✅ 서버 전송 성공`);

    const syncMsg = {
        topic: `UPDATE sensor_data SET synced = 1 WHERE timestamp = '${msg._insertTimestamp}' AND synced = 0`
    };

    node.status({ fill: 'green', shape: 'dot', text: '서버 전송 + synced' });
    return [syncMsg, msg]; // 출력 1: SQLite UPDATE, 출력 2: Debug
} else {
    // 실패 → synced=0 유지 (나중에 동기화)
    node.warn(`⚠️ 서버 전송 실패 (${msg.statusCode}): synced=0 유지, 나중에 동기화`);
    node.status({ fill: 'yellow', shape: 'ring', text: `전송 실패 (synced=0)` });
    return [null, msg]; // Debug만
}
