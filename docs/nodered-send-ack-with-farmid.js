// ============================================================
// "응답 메시지 생성" (send_ack) — 100농장 표준화 Phase B (옛 호환 제거)
//
// 위치: NR 에디터 "AWS IoT 제어 수신" 탭의 "응답 메시지 생성" 노드 (id: send_ack)
// 적용:
//   1. NR 에디터 → 탭 "AWS IoT 제어 수신" → "응답 메시지 생성" 더블클릭
//   2. 기존 코드 백업 후 이 파일 내용으로 교체
//   3. Deploy
//
// Phase B 변경:
//   - 옛 4-seg 응답 fallback 제거
//   - farmId 가 없으면 farmId='unknown' fallback (절대 발생하지 말아야 함 — 경고 로그)
//   - 새 5-seg 응답 토픽 (smartfarm/{farmId}/{houseId}/{deviceId}/response) 만 발행
// ============================================================

const { farmId, houseId, deviceId, command, requestId, operator } = msg.control;

// Phase B: farmId 필수. 없으면 경고 + fallback
const effectiveFarmId = farmId || env.get('FARM_ID') || 'unknown';
if (!farmId) {
    node.warn(`⚠ send_ack: msg.control.farmId 없음 (옛 클라이언트?) — env FARM_ID 사용: ${effectiveFarmId}`);
}

msg.topic = `smartfarm/${effectiveFarmId}/${houseId}/${deviceId}/response`;

msg.payload = {
    request_id: requestId,
    farm_id: effectiveFarmId,
    house_id: houseId,
    device_id: deviceId,
    command: command,
    status: 'received',
    operator: operator,
    executed_at: new Date().toISOString(),
    device_client: env.get('NR_MQTT_CLIENT_ID') || 'MyFarmPi_unknown',
};

node.status({
    fill: 'blue',
    shape: 'dot',
    text: `응답 → ${msg.topic}`
});

return msg;
