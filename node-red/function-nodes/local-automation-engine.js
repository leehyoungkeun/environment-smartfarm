/**
 * Node-RED Function 노드
 * 로컬 자동화 엔진 - 오프라인 시 서버 없이 자동화 규칙 평가
 *
 * 서버의 automation.routes.js (228-278줄) 로직을 Node-RED용으로 포팅
 *
 * 플로우 구성:
 * [센서 수집 완료] → [모드 확인] → online: 서버 /evaluate
 *                                → offline: [로컬 자동화 평가] → [GPIO 제어]
 */


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Function 1: 자동화 모드 분기
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 노드 이름: "자동화 모드 분기"
 * 입력: 센서 수집 완료 msg (msg.payload.data에 센서 데이터)
 * 출력 1: 서버 /evaluate (온라인)
 * 출력 2: 로컬 자동화 평가 (오프라인)
 */

const mode = global.get('operationMode') || 'online';

if (mode === 'online') {
    // 서버에 자동화 평가 요청
    const SERVER_URL = env.get('SERVER_URL') || 'http://192.168.137.1:3000';
    const FARM_ID = env.get('FARM_ID') || 'farm_001';
    const API_KEY = env.get('SENSOR_API_KEY') || '';

    msg.url = `${SERVER_URL}/api/automation/${FARM_ID}/evaluate`;
    msg.method = 'POST';
    msg.headers = {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY
    };

    // 센서 데이터를 evaluate 형식으로 변환
    const sensorData = msg.payload.data;
    msg._originalPayload = msg.payload;
    msg.payload = {
        houseId: msg.payload.houseId,
        sensorData: sensorData
    };

    return [msg, null]; // 출력 1: HTTP Request → 서버 /evaluate
} else {
    return [null, msg]; // 출력 2: 로컬 자동화 평가
}


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Function 2: 로컬 자동화 규칙 평가
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 노드 이름: "로컬 자동화 평가"
 * 입력: 센서 데이터 msg
 * 출력: 실행할 액션 목록
 *
 * 서버의 evaluateOperator, evaluateTimeCondition, buildReasonText를 포팅
 */

const sensorData = msg.payload.data;
const houseId = msg.payload.houseId;

// SQLite 또는 global context에서 자동화 규칙 로드
const rules = global.get('automationRules') || [];

if (rules.length === 0) {
    node.warn('⚠️ 로컬 자동화 규칙 없음');
    return null;
}

// ── 헬퍼 함수 (서버 코드 포팅) ──

function evaluateOperator(sensorValue, operator, threshold) {
    if (sensorValue === null || sensorValue === undefined) return false;
    switch (operator) {
        case '>':  return sensorValue > threshold;
        case '>=': return sensorValue >= threshold;
        case '<':  return sensorValue < threshold;
        case '<=': return sensorValue <= threshold;
        case '==': return Math.abs(sensorValue - threshold) < 0.1;
        default:   return false;
    }
}

function evaluateTimeCondition(cond) {
    const now = new Date();
    const currentDay = now.getDay();

    if (cond.days && cond.days.length > 0 && !cond.days.includes(currentDay)) {
        return false;
    }

    if (cond.time) {
        const [hour, minute] = cond.time.split(':').map(Number);
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const targetMinutes = hour * 60 + minute;
        return Math.abs(nowMinutes - targetMinutes) <= 2;
    }

    return false;
}

function buildReasonText(rule, sensorData) {
    const parts = rule.conditions
        .map(cond => {
            if (cond.type === 'sensor') {
                const val = sensorData[cond.sensorId];
                return `${cond.sensorName || cond.sensorId} ${val}${cond.operator}${cond.value}`;
            }
            if (cond.type === 'time') {
                return `시간 ${cond.time}`;
            }
            return '';
        })
        .filter(Boolean);

    return `${rule.name}: ${parts.join(rule.conditionLogic === 'AND' ? ' AND ' : ' OR ')}`;
}

// ── 규칙 평가 ──

const actions = [];

for (const rule of rules) {
    // 활성화 체크
    if (!rule.enabled) continue;

    // 하우스 필터
    if (rule.houseId && rule.houseId !== houseId) continue;

    // 쿨다운 체크
    const lastTriggered = global.get(`rule_${rule.id}_lastTriggered`) || 0;
    const cooldown = (rule.cooldownSeconds || 300) * 1000;
    if (Date.now() - lastTriggered < cooldown) continue;

    // 조건 평가
    const results = rule.conditions.map(cond => {
        if (cond.type === 'sensor') {
            return evaluateOperator(sensorData[cond.sensorId], cond.operator, cond.value);
        }
        if (cond.type === 'time') {
            return evaluateTimeCondition(cond);
        }
        return false;
    });

    // AND/OR 로직
    const triggered = rule.conditionLogic === 'AND'
        ? results.every(Boolean)
        : results.some(Boolean);

    if (triggered) {
        // 쿨다운 타이머 설정
        global.set(`rule_${rule.id}_lastTriggered`, Date.now());

        const reason = buildReasonText(rule, sensorData);

        // 액션 수집
        for (const action of rule.actions) {
            actions.push({
                ruleId: rule.id,
                ruleName: rule.name,
                houseId: houseId,
                deviceId: action.deviceId,
                deviceType: action.deviceType,
                command: action.command,
                reason: reason,
                source: 'automation'
            });
        }

        node.warn(`🤖 자동화 트리거: ${rule.name} → ${rule.actions.map(a => `${a.deviceId} ${a.command}`).join(', ')}`);
    }
}

if (actions.length === 0) {
    node.status({ fill: 'grey', shape: 'dot', text: `${rules.length}개 규칙 평가 - 트리거 없음` });
    return null;
}

node.status({ fill: 'blue', shape: 'dot', text: `${actions.length}개 액션 실행` });

msg.payload = { actions };
return msg;


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Function 3: 자동화 액션 → GPIO 제어 + 로그
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 노드 이름: "자동화 액션 실행"
 * 입력: 액션 목록 msg
 * 출력 1: GPIO 제어 (Link Out → 제어 실행 플로우)
 * 출력 2: SQLite 제어 로그 저장
 */

const actionsToExecute = msg.payload.actions || [];

// GPIO 핀 매핑 (aws-iot-control-receiver.js와 동일)
const GPIO_MAP = {
    'window1': { open: 17, close: 27 },
    'window2': { open: 22, close: 23 },
    'fan1':    { on: 24, off: 24 },
    'heater1': { on: 25, off: 25 },
    'valve1':  { open: 5, close: 6 },
};

const logValues = [];
const controlMsgs = [];

for (const action of actionsToExecute) {
    const pins = GPIO_MAP[action.deviceId];

    if (pins) {
        // GPIO 제어 (시뮬레이션)
        node.warn(`🤖 자동화 제어: ${action.deviceId} ${action.command} (${action.reason})`);
    } else {
        node.warn(`⚠️ ${action.deviceId}: GPIO 매핑 없음 (시뮬레이션)`);
    }

    // 제어 로그 저장 SQL
    const ts = new Date().toISOString();
    logValues.push(`('${ts}', '${action.deviceId}', '${action.command}', 'automation', 0)`);

    // 제어 메시지 생성 (Link Out으로 기존 GPIO 제어 노드에 전달)
    controlMsgs.push({
        control: {
            houseId: action.houseId,
            deviceId: action.deviceId,
            deviceType: action.deviceType,
            command: action.command,
            operator: 'automation',
            requestId: `auto_${Date.now()}`,
            timestamp: ts
        }
    });
}

// SQLite 로그 저장
if (logValues.length > 0) {
    const logMsg = {
        topic: `INSERT INTO control_logs (timestamp, device_id, command, source, synced)
                VALUES ${logValues.join(', ')}`
    };
    // 출력 2: SQLite로
    node.send([null, logMsg]);
}

// GPIO 제어 메시지 전달
for (const ctrlMsg of controlMsgs) {
    node.send([ctrlMsg, null]); // 출력 1: GPIO 제어로
}

return null;


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Function 4: 자동화 규칙 캐시 갱신
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 노드 이름: "규칙 캐시 갱신"
 * 트리거: 온라인 모드에서 주기적으로 (10분마다)
 * 입력: Inject 또는 모드 변경 시
 * 출력 1: SQLite 저장
 *
 * 서버에서 자동화 규칙을 가져와 로컬에 캐시
 */

const mode4 = global.get('operationMode') || 'online';
if (mode4 !== 'online') {
    node.warn('📴 오프라인 모드: 규칙 캐시 갱신 건너뜀');
    return null;
}

const SERVER_URL_4 = env.get('SERVER_URL') || 'http://192.168.137.1:3000';
const FARM_ID_4 = env.get('FARM_ID') || 'farm_001';
const API_KEY_4 = env.get('SENSOR_API_KEY') || '';

msg.url = `${SERVER_URL_4}/api/automation/${FARM_ID_4}`;
msg.method = 'GET';
msg.headers = {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY_4
};

return msg;
// → HTTP Request → Function 5


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Function 5: 규칙 응답 처리 → 캐시 저장
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * 노드 이름: "규칙 캐시 저장"
 * 입력: HTTP Response (서버 자동화 규칙)
 * 출력 1: SQLite 저장
 * 출력 2: Debug
 */

if (msg.statusCode !== 200 || !msg.payload.success) {
    node.warn('⚠️ 자동화 규칙 가져오기 실패');
    return null;
}

const rulesData = msg.payload.data || [];

// global context에 저장
global.set('automationRules', rulesData);

// SQLite에도 저장 (재시작 대비)
const ts5 = new Date().toISOString();
const rulesSql = rulesData.map(rule => {
    const ruleJson = JSON.stringify(rule).replace(/'/g, "''");
    return `(${rule.id}, '${ruleJson}', '${ts5}')`;
});

if (rulesSql.length > 0) {
    msg.topic = `DELETE FROM automation_rules; INSERT INTO automation_rules (id, rule_json, updated_at) VALUES ${rulesSql.join(', ')}`;
}

node.warn(`📋 자동화 규칙 ${rulesData.length}개 캐시 완료`);
node.status({ fill: 'green', shape: 'dot', text: `${rulesData.length}개 규칙 캐시됨` });

return msg;
