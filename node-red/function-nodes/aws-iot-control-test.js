/**
 * Node-RED Function 노드들
 * AWS IoT 제어 신호 테스트 플로우
 *
 * 플로우 구성:
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ 📌 수동 테스트                                                      │
 * │                                                                     │
 * │ [🔓 열기] ─┐                                                       │
 * │ [⛔ 정지] ─┼→ [페이로드 생성] → [AWS API Gateway] → [응답 파싱] → [Debug] │
 * │ [🔒 닫기] ─┘                                                       │
 * │                                                                     │
 * │ 📌 자동 테스트                                                      │
 * │                                                                     │
 * │ [30초 간격] → [GET /health] → [서버 시작 감지] → [페이로드 생성] → ...  │
 * │                                                                     │
 * │ 📌 연속 테스트                                                      │
 * │                                                                     │
 * │ [연속 테스트] → [시퀀스 생성] → [페이로드 생성] → ...                  │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * 임포트 방법:
 * 1. Node-RED 에디터 열기 (192.168.137.86:1880/node-red)
 * 2. 메뉴 → Import → Clipboard
 * 3. aws-iot-control-test.json 파일 내용 붙여넣기
 * 4. Deploy
 *
 * AWS 엔드포인트: https://pdwbldwmy3.execute-api.ap-northeast-2.amazonaws.com/control
 * 페이로드 형식: { house_id, window_id, command, operator, request_id, timestamp }
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Function 1: 제어 페이로드 생성
// 노드 이름: "제어 페이로드 생성"
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 제어 명령 페이로드 생성
// 프론트엔드 controlApi.js와 동일한 형식

const command = msg.command || 'open';
const deviceId = msg.deviceId || 'window1';
const houseId = msg.houseId || 'house1';
const requestId = Date.now() + '-' + Math.random().toString(36).substring(2, 10);

msg.payload = {
    house_id: houseId,
    window_id: deviceId,
    command: command.toLowerCase(),
    operator: 'nodered_test',
    request_id: requestId,
    timestamp: new Date().toISOString()
};

msg.headers = {
    'Content-Type': 'application/json'
};

const cmdLabels = { open: '열기', stop: '정지', close: '닫기', on: 'ON', off: 'OFF' };
const label = cmdLabels[command] || command;

node.status({
    fill: 'blue',
    shape: 'dot',
    text: `${label} → ${houseId}/${deviceId} (${requestId.substring(0, 8)})`
});

node.warn(`🎛️ 제어 전송: ${houseId}/${deviceId} ${command.toUpperCase()} [${requestId}]`);

return msg;


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Function 2: 응답 파싱
// 노드 이름: "응답 파싱"
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// AWS API Gateway / Lambda 응답 파싱
const statusCode = msg.statusCode;
let result;

try {
    const data = typeof msg.payload === 'string'
        ? JSON.parse(msg.payload)
        : msg.payload;

    // Lambda 응답은 body가 문자열로 올 수 있음
    result = data.body
        ? (typeof data.body === 'string' ? JSON.parse(data.body) : data.body)
        : data;
} catch (e) {
    result = msg.payload;
}

if (statusCode >= 200 && statusCode < 300) {
    node.status({ fill: 'green', shape: 'dot', text: `✅ 성공 (${statusCode})` });
    node.warn(`✅ AWS 응답 성공: ${JSON.stringify(result)}`);
    msg.payload = {
        success: true,
        statusCode: statusCode,
        result: result
    };
} else {
    node.status({ fill: 'red', shape: 'dot', text: `❌ 실패 (${statusCode})` });
    node.warn(`❌ AWS 응답 실패 (${statusCode}): ${JSON.stringify(result)}`);
    msg.payload = {
        success: false,
        statusCode: statusCode,
        error: result
    };
}

return msg;


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Function 3: 서버 시작 감지
// 노드 이름: "서버 시작 감지"
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// flow 변수로 이전 서버 상태 추적
const wasOnline = flow.get('serverWasOnline') || false;
const isOnline = msg.statusCode === 200 &&
                 msg.payload &&
                 msg.payload.success === true;

flow.set('serverWasOnline', isOnline);

if (isOnline && !wasOnline) {
    // 서버가 방금 시작됨! → 테스트 신호 전송
    node.status({
        fill: 'green',
        shape: 'dot',
        text: '🟢 서버 시작 감지! 테스트 전송...'
    });
    node.warn('🟢 서버 시작 감지 → 샘플 open 제어 신호 전송');

    // open 명령 전송
    msg.command = 'open';
    msg.deviceId = 'window1';
    msg.houseId = 'house1';
    return msg;

} else if (isOnline) {
    node.status({
        fill: 'green',
        shape: 'ring',
        text: '서버 온라인 (' + new Date().toLocaleTimeString('ko-KR') + ')'
    });
} else {
    node.status({
        fill: 'red',
        shape: 'ring',
        text: '서버 오프라인 (' + new Date().toLocaleTimeString('ko-KR') + ')'
    });
}

// 서버가 이미 온라인이거나 오프라인이면 전송하지 않음
return null;


// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Function 4: 시퀀스 생성 (open → stop → close 3초 간격)
// 노드 이름: "시퀀스 생성 (3초 간격)"
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// open → 3초 → stop → 3초 → close 순서로 전송
const commands = ['open', 'stop', 'close'];
const results = [];

for (let i = 0; i < commands.length; i++) {
    results.push({
        command: commands[i],
        deviceId: 'window1',
        houseId: 'house1',
        delay: i * 3000  // 0, 3초, 6초
    });
}

node.status({
    fill: 'blue',
    shape: 'dot',
    text: `시퀀스 시작: ${commands.join(' → ')}`
});
node.warn(`🔄 시퀀스 테스트 시작: ${commands.join(' → ')} (3초 간격)`);

// 첫 번째 즉시 전송
const firstMsg = RED.util.cloneMessage(msg);
firstMsg.command = results[0].command;
firstMsg.deviceId = results[0].deviceId;
firstMsg.houseId = results[0].houseId;

// 나머지는 setTimeout으로 전송
for (let i = 1; i < results.length; i++) {
    const r = results[i];
    setTimeout(() => {
        const delayedMsg = RED.util.cloneMessage(msg);
        delayedMsg.command = r.command;
        delayedMsg.deviceId = r.deviceId;
        delayedMsg.houseId = r.houseId;
        node.send(delayedMsg);
        node.status({
            fill: 'blue',
            shape: 'dot',
            text: `시퀀스: ${r.command} 전송`
        });
    }, r.delay);
}

return firstMsg;
