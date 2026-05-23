// ============================================================
// "제어 명령 파싱" (AWS IoT 제어 수신 탭) — schedule-off drop 추가
//
// 위치: NR 에디터 "AWS IoT 제어 수신" 탭의 "제어 명령 파싱" 노드 (id: parse_control_command)
// 적용 방법:
//   1. NR 에디터 → 탭 "AWS IoT 제어 수신" → "제어 명령 파싱" 노드 더블클릭
//   2. 기존 코드 1235 chars 백업
//   3. 이 파일 내용으로 교체
//   4. 출력: 1개 (변경 없음)
//   5. 완료 → Deploy
//
// 신규:
//   - schedule-off / schedule-off-cancel 명령 감지 시 → return null (downstream 차단)
//   - 이유: downstream "제어 실행 (릴레이)" 가 schedule-off 를 'on===false' → 즉시 OFF 로 처리하는 버그
//   - timer 등록은 'AWS IoT 제어 테스트' 탭의 function 2 가 담당 (같은 MQTT 메시지 양쪽 mqtt-in 이 수신)
// ============================================================

// MQTT 토픽에서 장치 ID 추출
// 토픽: smartfarm/house1/window1/control
const topicParts = msg.topic.split('/');
const houseId = topicParts[1] || 'unknown';
const deviceId = topicParts[2] || 'unknown';

// 페이로드 파싱
const payload = msg.payload;
const command = (payload.command || 'unknown').toLowerCase();
const operator = payload.operator || 'unknown';
const requestId = payload.request_id || '';
const timestamp = payload.timestamp || new Date().toISOString();

// ★ NEW: schedule-off / schedule-off-cancel — 여기서 drop (function 2 가 timer 등록 담당)
// downstream "제어 실행 (릴레이)" 가 schedule-off 를 default OFF 로 fallthrough 시키는 버그 회피
if (command === 'schedule-off' || command === 'schedule-off-cancel') {
    node.status({ fill: 'grey', shape: 'ring', text: `${command} drop (function 2 처리)` });
    node.warn(`⏭️ ${command} drop: ${houseId}/${deviceId} (function 2 가 처리, downstream 차단)`);
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

node.status({
    fill: 'green',
    shape: 'dot',
    text: `${label} ← ${houseId}/${deviceId} (${operator})`
});

node.warn(`📥 제어 수신: ${houseId}/${deviceId} ${command.toUpperCase()} by ${operator} [${requestId}]`);

return msg;
