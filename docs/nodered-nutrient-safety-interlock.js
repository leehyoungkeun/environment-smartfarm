// 양액 안전 인터락 — 한계 초과 시 모드 강제 변경 + 릴레이 OFF
// 입력: msg.payload = { ec, ph, flow, ... } (telemetry 와 동일)
// 출력 1: 정상 → 다음 노드로 통과
// 출력 2: 비상 발생 → 모든 릴레이 OFF + 경보 POST
//
// 우선순위: 비상정지/누액 > EC critical > pH critical > 탱크부족 > 센서오류

const r = msg.payload;
if (!r) return null;

const farmConfig = global.get('farmConfig') || {};
const config = global.get('nutrientConfig') || {};
const alerts = config.alerts || { ecUpper: 4.0, ecCritical: 0.1, phUpper: 8.0, phCritical: 6.5 };

const triggered = []; // { type, severity, value, threshold, message, action }

// 1. 비상정지 GPIO (다른 플로우에서 set)
if (global.get('emergencyStop')) {
    triggered.push({
        type: 'emergency_stop',
        severity: 'critical',
        message: '비상정지 버튼 활성화',
        action: '전체 릴레이 OFF · 수동 복구 필요',
    });
}

// 2. 누액 GPIO
if (global.get('leakDetected')) {
    triggered.push({
        type: 'leak_detected',
        severity: 'critical',
        message: '누액 감지',
        action: '전체 릴레이 OFF',
    });
}

// 3. EC 상한 초과
if (r.ec != null && r.ec > alerts.ecUpper) {
    triggered.push({
        type: 'ec_upper',
        severity: r.ec > alerts.ecUpper * 1.2 ? 'critical' : 'warning',
        value: r.ec,
        threshold: alerts.ecUpper,
        message: `EC ${r.ec} > 상한 ${alerts.ecUpper}`,
        action: '도싱 정지 · 원수 보충 필요',
    });
}

// 4. EC critical 미달 (센서 오류·미연결)
if (r.ec != null && r.ec < alerts.ecCritical) {
    triggered.push({
        type: 'ec_critical_low',
        severity: 'critical',
        value: r.ec,
        threshold: alerts.ecCritical,
        message: `EC ${r.ec} 비정상 (센서 오류 가능)`,
        action: '제어 정지 · 센서 점검',
    });
}

// 5. pH 범위 이탈
if (r.ph != null && (r.ph > alerts.phUpper || r.ph < alerts.phLower)) {
    triggered.push({
        type: r.ph > alerts.phUpper ? 'ph_upper' : 'ph_lower',
        severity: 'warning',
        value: r.ph,
        threshold: r.ph > alerts.phUpper ? alerts.phUpper : alerts.phLower,
        message: `pH ${r.ph} 범위 이탈`,
        action: r.ph > alerts.phUpper ? '산 도싱 +' : '알칼리 도싱 +',
    });
}

// 6. 센서 통신 오류 (30초 이상 telemetry 없음)
const lastTel = global.get('lastTelemetry');
if (lastTel && (Date.now() - lastTel.at) > 30000) {
    triggered.push({
        type: 'sensor_timeout',
        severity: 'critical',
        message: '센서 통신 30초 이상 끊김',
        action: '모드 paused · 센서 점검',
    });
}

// === 우선순위 처리 ===
const criticalHit = triggered.find(t => t.severity === 'critical');

if (criticalHit) {
    // 모든 릴레이 OFF (24CH = Unit-Id 3, 채널 0~23 모두 OFF)
    global.set('safetyStop', true);
    global.set('emergencyReason', criticalHit.type);

    // modbus-flex-write 호환: FC15 = Write Multiple Coils
    const offCmd = {
        payload: {
            value: Array(24).fill(false),
            fc: 15,
            unitid: 3,
            address: 0,
            quantity: 24,
        },
        reason: criticalHit.message,
    };
    node.status({ fill: 'red', shape: 'ring', text: `🛑 ${criticalHit.type}` });

    // backend 경보 POST 메시지
    const alertMsg = {
        url: `https://api.smartgreen.kr/internal/nutrient/alerts`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': farmConfig.apiKey || '',
        },
        payload: criticalHit,
    };
    return [null, [offCmd, alertMsg]];
}

// warning 만 있으면 경보만 POST, 사이클은 계속
if (triggered.length > 0) {
    node.status({ fill: 'yellow', shape: 'dot', text: `⚠️ ${triggered[0].type}` });
    const alertMsgs = triggered.map(t => ({
        url: `https://api.smartgreen.kr/internal/nutrient/alerts`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': farmConfig.apiKey || '',
        },
        payload: t,
    }));
    return [msg, alertMsgs];
}

// 정상
global.set('safetyStop', false);
node.status({ fill: 'green', shape: 'dot', text: '✓ OK' });
return [msg, null];
