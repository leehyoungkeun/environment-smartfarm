// ============================================================
// "응답 메시지 생성" (send_ack) — 100농장 표준화 호환 버전
//
// 위치: NR 에디터 "AWS IoT 제어 수신" 탭의 "응답 메시지 생성" 노드 (id: send_ack)
// 적용:
//   1. NR 에디터 → 탭 "AWS IoT 제어 수신" → "응답 메시지 생성" 더블클릭
//   2. 기존 코드 백업 후 이 파일 내용으로 교체
//   3. Deploy
//
// 변경:
//   - msg.control.farmId 가 있으면 새 5-seg 응답 토픽 발행
//   - 없으면 옛 4-seg 응답 토픽 (legacy 호환)
// ============================================================

const { farmId, houseId, deviceId, command, requestId, operator } = msg.control;

// farmId 있으면 새 5-seg 토픽, 없으면 옛 4-seg 토픽
msg.topic = farmId
    ? `smartfarm/${farmId}/${houseId}/${deviceId}/response`
    : `smartfarm/${houseId}/${deviceId}/response`;

msg.payload = {
    request_id: requestId,
    farm_id: farmId,
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
