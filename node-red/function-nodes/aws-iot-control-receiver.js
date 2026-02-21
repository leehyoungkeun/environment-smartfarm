/**
 * Node-RED Function 노드들
 * AWS IoT 제어 명령 수신 플로우
 *
 * 전체 제어 흐름:
 * FE(ControlPanel) → AWS API Gateway → Lambda → IoT Core MQTT
 *     → [이 플로우] → GPIO/릴레이 → 실제 장치 동작
 *
 * 플로우 구성:
 * ┌──────────────────────────────────────────────────────────────────┐
 * │                                                                  │
 * │ [MQTT In] → [명령 파싱] ─┬→ [GPIO 제어 실행] → [실행 결과 Debug] │
 * │  (구독)      (토픽분석)   ├→ [수신 로그 Debug]                    │
 * │                          └→ [응답 생성] → [MQTT Out] (응답 발행)  │
 * └──────────────────────────────────────────────────────────────────┘
 *
 * MQTT 토픽:
 * - 수신: smartfarm/house1/+/control
 * - 응답: smartfarm/{house_id}/{device_id}/response
 *
 * 임포트 후 설정:
 * 1. MQTT 브로커 노드에 AWS IoT 엔드포인트 + 인증서 설정
 * 2. GPIO_MAP을 실제 하드웨어 핀 번호로 수정
 * 3. Deploy
 */


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Function 1: 제어 명령 파싱
// 노드 이름: "제어 명령 파싱"
// 입력: MQTT in (smartfarm/house1/+/control)
// 출력: 3개 (GPIO 제어, Debug, 응답)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Function 2: 제어 실행 (GPIO/릴레이)
// 노드 이름: "제어 실행 (GPIO/릴레이)"
// 입력: 명령 파싱 출력 1
// 출력: 실행 결과 Debug
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const { deviceId: devId, deviceType: devType, command: cmd } = msg.control;

// GPIO 핀 매핑 (실제 하드웨어에 맞게 수정!)
const GPIO_MAP = {
    'window1': { open: 17, close: 27 },  // BCM GPIO 17=열기 릴레이, 27=닫기 릴레이
    'window2': { open: 22, close: 23 },
    'fan1':    { on: 24, off: 24 },       // 같은 핀 HIGH=ON, LOW=OFF
    'heater1': { on: 25, off: 25 },
    'valve1':  { open: 5, close: 6 },
};

const pins = GPIO_MAP[devId];

if (!pins) {
    node.warn(`⚠️ ${devId}: GPIO 매핑 없음 (시뮬레이션 모드)`);
    node.status({ fill: 'yellow', shape: 'ring', text: `시뮬레이션: ${devId} ${cmd}` });
    msg.control.executed = true;
    msg.control.simulated = true;
    return msg;
}

// TODO: 실제 GPIO 제어 코드 (onoff 라이브러리 또는 exec)
// const Gpio = require('onoff').Gpio;

try {
    switch (devType) {
        case 'window':
        case 'valve':
            if (cmd === 'open') {
                node.warn(`🔓 ${devId} 열기: GPIO ${pins.open} HIGH`);
            } else if (cmd === 'close') {
                node.warn(`🔒 ${devId} 닫기: GPIO ${pins.close} HIGH`);
            } else if (cmd === 'stop') {
                node.warn(`⛔ ${devId} 정지: GPIO ALL LOW`);
            }
            break;

        case 'fan':
        case 'heater':
            if (cmd === 'on') {
                node.warn(`⚡ ${devId} ON: GPIO ${pins.on} HIGH`);
            } else if (cmd === 'off') {
                node.warn(`🔌 ${devId} OFF: GPIO ${pins.off} LOW`);
            }
            break;
    }

    msg.control.executed = true;
    msg.control.simulated = false;
    node.status({ fill: 'green', shape: 'dot', text: `실행: ${devId} ${cmd}` });

} catch (error) {
    msg.control.executed = false;
    msg.control.error = error.message;
    node.status({ fill: 'red', shape: 'dot', text: `실패: ${error.message}` });
    node.error(`❌ 제어 실행 실패: ${error.message}`);
}

return msg;


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Function 3: 응답 메시지 생성
// 노드 이름: "응답 메시지 생성"
// 입력: 명령 파싱 출력 3
// 출력: MQTT out (응답 발행)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 제어 응답을 IoT Core로 전송
// 프론트엔드에서 이 토픽을 구독하면 실시간 상태 확인 가능

const { houseId: hId, deviceId: dId, command: c, requestId: rId, operator: op } = msg.control;

msg.topic = `smartfarm/${hId}/${dId}/response`;
msg.payload = {
    request_id: rId,
    house_id: hId,
    device_id: dId,
    command: c,
    status: 'received',
    operator: op,
    executed_at: new Date().toISOString(),
    device_client: 'MyFarmPi_01'
};

node.status({
    fill: 'blue',
    shape: 'dot',
    text: `응답 → ${msg.topic}`
});

return msg;
