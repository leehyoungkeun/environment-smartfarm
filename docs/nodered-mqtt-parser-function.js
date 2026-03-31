// MQTT 토픽에서 장치 ID 추출
// 토픽: smartfarm/house1/window1/control
const topicParts = msg.topic.split('/');
const houseId = topicParts[1] || 'unknown';
const deviceId = topicParts[2] || 'unknown';

// 페이로드 파싱
const payload = msg.payload;
const command = payload.command || 'unknown';
const operator = payload.operator || 'unknown';
const requestId = payload.request_id || '';
const timestamp = payload.timestamp || new Date().toISOString();

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
    modbus: payload.modbus || null,
    duration: payload.duration || 0,
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

node.warn(`📥 제어 수신: ${houseId}/${deviceId} ${command.toUpperCase()} by ${operator} [${requestId}] duration=${payload.duration || 0}`);

return msg;
