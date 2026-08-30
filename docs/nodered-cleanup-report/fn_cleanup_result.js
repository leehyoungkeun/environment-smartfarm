// ============================================================
// 「정리 결과」(SQLite 초기화 탭, 노드 id: cleanup_result) 교체본 — 2026-08-30
//
// 왜: 60일 보관 삭제가 조용히 멈춰도 아무도 몰랐다(node.warn 은 로테이션되면 사라짐).
//     삭제 후 결과를 서버에 보고해, 26시간 넘게 안 오면 서버가 Discord 로 알린다(RpiCleanupStalled).
//     실패를 '값'이 아니라 '보고가 왔는가'로 감지 — RPi 가 죽으면 보고도 끊겨 그 자체가 신호다.
//
// 노드 설정: 출력 개수 1 → 2. 출력 1 = 기존 debug, 출력 2 = 신규 「보관 보고 전송」(http request).
// ============================================================
var changes = msg.payload ? (msg.payload.changes || 0) : 0;
var days = msg.retentionDays || global.get('retentionDays') || 60;

node.warn('🗑️ ' + days + '일 이상 데이터 ' + changes + '건 삭제');
node.status({ fill: 'blue', shape: 'dot', text: changes + '건 삭제 (' + days + '일 보관)' });

// ── 출력 2: 서버 보고 준비 ─────────────────────────────
// 정리 후 로컬 총 행수를 함께 보내 '증가 추세'(삭제가 안 되는 신호)를 서버가 볼 수 있게 한다.
// dbRows 는 다음 tick 에서 SELECT COUNT 로 채워도 되지만, 여기선 삭제 changes 만으로 충분.
var serverUrl = env.get('SERVER_URL') || global.get('pcServerUrl') || 'https://api.smartgreen.kr';
var farmId = env.get('FARM_ID') || global.get('farmId') || 'farm_0001';

var report = {
    method: 'POST',
    url: serverUrl + '/internal/maintenance-report',
    headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.get('SENSOR_API_KEY') || global.get('sensorApiKey') || ''
    },
    payload: {
        farmId: farmId,
        deletedRows: changes,
        retentionDays: days,
        ranAt: new Date().toISOString()
    },
    requestTimeout: 8000
};

return [msg, report];   // [출력1 기존 debug, 출력2 보고 전송]
