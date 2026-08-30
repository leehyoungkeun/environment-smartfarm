// ============================================================
// "스냅샷 전송 결과" (fn_ks_snapshot_result) — 성공하면 보낸 만큼 큐에서 지우고, 실패하면 남겨 다음 분에 재전송.
// (KS X 3267 표준노드 탭, 2026-08-30) http request 는 "2xx 아닌 응답만 Catch" 해제 상태여야 여기로 온다.
// ============================================================
const queue = flow.get('ksSnapshotQueue') || [];
const sent = Number(msg._sent) || 0;
const p = (typeof msg.payload === 'object' && msg.payload) || {};
const ok = msg.statusCode === 200 && p.success === true;

if (ok) {
    const rest = queue.slice(sent);
    flow.set('ksSnapshotQueue', rest);
    node.status({ fill: 'green', shape: 'dot', text: '저장 ' + (p.inserted ?? '?') + '/' + (p.received ?? sent) + (rest.length ? ' · 대기 ' + rest.length : '') });
} else {
    node.warn('⚠️ 구동기 스냅샷 전송 실패 (HTTP ' + msg.statusCode + '): ' + (p.error || String(msg.payload).slice(0, 120)) + ' — 큐 ' + queue.length + '행 보존, 다음 분 재전송');
    node.status({ fill: 'red', shape: 'ring', text: '전송 실패 · 큐 ' + queue.length });
}
return null;
