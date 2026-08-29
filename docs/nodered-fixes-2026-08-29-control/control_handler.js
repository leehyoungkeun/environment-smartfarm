const { house_id, device_id, command, operator, modbus, duration } = msg.payload;

// 입력 검증
if (!device_id || !command) {
    msg.payload = { success: false, error: 'device_id, command 필수' };
    msg.statusCode = 400;
    msg.headers = { 'Access-Control-Allow-Origin': '*' };
    return [msg, null, null];
}

const ALLOWED_COMMANDS = ['open', 'close', 'stop', 'on', 'off'];
if (!ALLOWED_COMMANDS.includes(command)) {
    msg.payload = { success: false, error: '허용되지 않는 명령: ' + command };
    msg.statusCode = 400;
    msg.headers = { 'Access-Control-Allow-Origin': '*' };
    return [msg, null, null];
}

if (!/^[a-zA-Z0-9_]+$/.test(device_id)) {
    msg.payload = { success: false, error: '잘못된 device_id 형식' };
    msg.statusCode = 400;
    msg.headers = { 'Access-Control-Allow-Origin': '*' };
    return [msg, null, null];
}

// houseId 정규화 (2026-08-29 fix) — 키오스크/프론트는 레거시 'house1' 로 보낸다.
// 정규형 'house_0001' 로 통일해야 AWS 경로·자동화와 같은 전역 키를 쓴다.
const hRaw = house_id || 'house_0001';
const hMatch = String(hRaw).match(/^house_?0*(\d+)$/);
const houseId = hMatch ? 'house_' + String(hMatch[1]).padStart(4, '0') : hRaw;
const ts = new Date().toISOString();
const requestId = `local_${Date.now()}`;

// GPIO 제어 메시지 생성
const controlMsg = {
    control: {
        houseId: houseId,
        deviceId: device_id,
        deviceType: device_id.replace(/[0-9]/g, ''),
        command: command,
        operator: operator || 'local_dashboard',
        requestId: requestId,
        timestamp: ts,
        modbus: modbus || null,
        duration: duration || 0
    }
};
// ★ Modbus 완료 확인용 requestId 전달
controlMsg._requestId = requestId;

// SQLite 로그 저장
var logMsg = {};
logMsg.topic = 'INSERT INTO control_logs (timestamp, device_id, command, source, synced) VALUES ($1, $2, $3, $4, 0)';
logMsg.payload = [ts, device_id, command, 'local'];

// HTTP 응답 (즉시 — 기존 방식 유지)
msg.payload = {
    success: true,
    data: {
        request_id: requestId,
        device_id: device_id,
        command: command,
        executed_at: ts,
        mode: 'local'
    }
};
msg.headers = { 'Access-Control-Allow-Origin': '*' };

node.warn(`🎮 로컬 제어: ${device_id} ${command} by ${operator || 'local'} duration=${duration || 0}`);

return [msg, controlMsg, logMsg];
