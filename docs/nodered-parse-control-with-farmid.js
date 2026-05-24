// ============================================================
// "제어 명령 파싱" (AWS IoT 제어 수신 탭) — 100농장 표준화 호환 버전
//
// 위치: NR 에디터 "AWS IoT 제어 수신" 탭의 "제어 명령 파싱" 노드 (id: parse_control_command)
// 적용:
//   1. NR 에디터 → 탭 "AWS IoT 제어 수신" → "제어 명령 파싱" 더블클릭
//   2. 기존 코드 백업 후 이 파일 내용으로 교체
//   3. 출력: 3개 (변경 없음 — execute_control, debug_received, send_ack)
//   4. Deploy
//
// 변경:
//   - 옛 4-seg 토픽 (smartfarm/{houseId}/{deviceId}/control) + 새 5-seg 토픽 (smartfarm/{farmId}/{houseId}/{deviceId}/control) 동시 처리
//   - msg.control 에 farmId 추가
//   - schedule-off / schedule-off-cancel drop 그대로 유지
// ============================================================

// MQTT 토픽에서 농장/장치 ID 추출
// 옛 (legacy): smartfarm/house1/window1/control               (4 segments)
// 새 (new):    smartfarm/farm_0001/house1/window1/control    (5 segments)
const topicParts = msg.topic.split('/');
const payload = msg.payload;
let farmId, houseId, deviceId;
if (topicParts.length >= 5) {
    // new format
    farmId = topicParts[1] || null;
    houseId = topicParts[2] || 'unknown';
    deviceId = topicParts[3] || 'unknown';
} else {
    // legacy format
    houseId = topicParts[1] || 'unknown';
    deviceId = topicParts[2] || 'unknown';
    // payload.farm_id 가 있으면 사용 (frontend → Lambda → 새 publish 호환)
    farmId = payload.farm_id || null;
}

const command = (payload.command || 'unknown').toLowerCase();
const operator = payload.operator || 'unknown';
const requestId = payload.request_id || '';
const timestamp = payload.timestamp || new Date().toISOString();

// ★ schedule-off / schedule-off-cancel — drop (function 2 가 timer 등록 담당)
if (command === 'schedule-off' || command === 'schedule-off-cancel') {
    node.status({ fill: 'grey', shape: 'ring', text: `${command} drop (function 2 처리)` });
    node.warn(`⏭️ ${command} drop: ${farmId || ''}/${houseId}/${deviceId} (function 2 가 처리, downstream 차단)`);
    return null;
}

// 장치 유형 판별
let deviceType = 'unknown';
if (deviceId.startsWith('window')) deviceType = 'window';
else if (deviceId.startsWith('fan')) deviceType = 'fan';
else if (deviceId.startsWith('heater')) deviceType = 'heater';
else if (deviceId.startsWith('valve')) deviceType = 'valve';

// 메시지에 파싱 결과 첨부
msg.control = {
    farmId,
    houseId,
    deviceId,
    deviceType,
    command,
    operator,
    requestId,
    timestamp,
    raw: payload
};

const cmdLabels = {
    open: '열기', close: '닫기', stop: '정지',
    on: 'ON', off: 'OFF'
};
const label = cmdLabels[command] || command;

const fIdLabel = farmId ? `${farmId}/` : '';
node.status({
    fill: 'green',
    shape: 'dot',
    text: `${label} ← ${fIdLabel}${houseId}/${deviceId} (${operator})`
});

node.warn(`📥 제어 수신: ${fIdLabel}${houseId}/${deviceId} ${command.toUpperCase()} by ${operator} [${requestId}]`);

return msg;
