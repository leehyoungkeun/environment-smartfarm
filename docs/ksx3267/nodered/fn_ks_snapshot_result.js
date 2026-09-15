// ============================================================
// "스냅샷 전송 결과" (fn_ks_snapshot_result) — 성공하면 보낸 만큼 큐에서 지우고, 실패하면 남겨 다음 분에 재전송.
// (KS X 3267 표준노드 탭, 2026-08-30) http request 는 "2xx 아닌 응답만 Catch" 해제 상태여야 여기로 온다.
// ============================================================
const queue = flow.get('ksSnapshotQueue') || [];
const squeue = flow.get('ksSensorSnapshotQueue') || [];          // 표준 센서 1분 스냅샷 큐 (§5.4.4, 2026-09-15)
const sent = Number(msg._sent) || 0;
const sentSensors = Number(msg._sentSensors) || 0;
const p = (typeof msg.payload === 'object' && msg.payload) || {};
const ok = msg.statusCode === 200 && p.success === true;

if (ok) {
    const rest = queue.slice(sent);
    flow.set('ksSnapshotQueue', rest);
    // 옛 서버(sensorInserted 없음)는 센서 행을 무시하고 200 을 준다 → 센서 큐는 비우지 않고 서버 배포 뒤 재전송한다(멱등)
    const srest = (p.sensorInserted !== undefined) ? squeue.slice(sentSensors) : squeue;
    flow.set('ksSensorSnapshotQueue', srest);
    node.status({
        fill: 'green', shape: 'dot', text: '저장 장치 ' + (p.inserted ?? '?') + '/' + (p.received ?? sent) + ' · 센서 ' + (p.sensorInserted ?? '미지원') + '/' + (p.sensorReceived ?? sentSensors)
            + ((rest.length || srest.length) ? ' · 대기 ' + rest.length + '/' + srest.length : '')
    });
} else {
    node.warn('⚠️ 표준 스냅샷 전송 실패 (HTTP ' + msg.statusCode + '): ' + (p.error || String(msg.payload).slice(0, 120)) + ' — 큐 장치 ' + queue.length + '·센서 ' + squeue.length + '행 보존, 다음 분 재전송');
    node.status({ fill: 'red', shape: 'ring', text: '전송 실패 · 큐 ' + queue.length + '/' + squeue.length });
}
return null;
