// ============================================================
// NR 재시작 시 자동 OFF 예약 복구 — startup 노드
//
// 적용 방법:
//   1. NR 에디터에서 inject 노드 추가:
//      - Repeat: none
//      - "Inject once after 5 seconds" 체크
//   2. function 노드 추가 (이 파일 내용)
//   3. inject → function 연결
//   4. function 의 출력 1개 → "function 2" (제어 수신) 와 같은 modbus 경로로 연결
//      또는 별도 mqtt-out 노드로 자기 자신에게 다시 publish
//
// 동작:
//   - global.scheduledOff 에 저장된 활성 예약 항목 읽음
//   - 각 항목의 atMs - now 계산
//     · > 0 : setTimeout 재등록
//     · <= 0 : 즉시 OFF 실행 (만료된 채 NR 가 꺼져 있었음)
//   - timerId 는 새 setTimeout 으로 교체 (옛 ID 는 무효)
// ============================================================

const sched = global.get('scheduledOff') || {};
const now = Date.now();
const keys = Object.keys(sched);

if (keys.length === 0) {
    node.warn('📂 복구할 자동 OFF 예약 없음');
    return null;
}

node.warn(`📂 자동 OFF 예약 ${keys.length}건 복구 시작`);

const results = [];
for (const key of keys) {
    const item = sched[key];
    const { houseId, deviceId, atMs } = item;
    const remainMs = atMs - now;

    const fireOff = () => {
        node.warn(`⏰ 예약 만료 (복구) → OFF: ${key}`);
        const reqId = `sched-recov-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
        const ts = new Date().toISOString();
        node.send({
            topic: `smartfarm/${houseId}/${deviceId}/control`,
            payload: {
                house_id: houseId,
                window_id: deviceId,
                command: 'off',
                operator: 'schedule_off_timer_recovered',
                request_id: reqId,
                timestamp: ts,
                modbus: item.modbus || null,
                duration: 0,
            },
            // downstream modbus mapper 호환 — msg.control pre-populate
            control: {
                houseId,
                deviceId,
                deviceType: item.deviceType || 'unknown',
                command: 'off',
                operator: 'schedule_off_timer_recovered',
                requestId: reqId,
                timestamp: ts,
                modbus: item.modbus || null,
                duration: 0,
                raw: {},
            },
        });
        const s = global.get('scheduledOff') || {};
        delete s[key];
        global.set('scheduledOff', s);
    };

    if (remainMs <= 0) {
        // 이미 지난 시각 — 즉시 실행
        fireOff();
        results.push(`${key} 즉시 실행`);
    } else {
        const timerId = setTimeout(fireOff, remainMs);
        item.timerId = timerId;
        const min = Math.round(remainMs / 60000);
        results.push(`${key} ${min}분 후`);
    }
}

global.set('scheduledOff', sched);
node.warn(`✅ 복구 완료: ${results.join(', ')}`);
node.status({ fill: 'green', shape: 'dot', text: `복구 ${keys.length}건` });

return null;
