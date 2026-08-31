// ============================================================
// 「정리 결과」(cleanup_result) v2 — 2026-08-30
// v1 대비: 삭제 후 로컬 총 행수(db_rows)를 함께 보고한다.
//   출력 2 를 http 로 바로 보내지 않고 COUNT 쿼리로 만들어,
//   「로컬 행수」 sqlite → 「보고 조립」 fn → 「보관 보고 전송」 순으로 흘린다.
//   db_rows 가 계속 증가하면 삭제가 안 되는 신호(smartfarm_rpi_local_rows).
// 노드 설정: 출력 2 유지. 출력 2 → 「로컬 행수」(신규 sqlite).
// ============================================================
var changes = msg.payload ? (msg.payload.changes || 0) : 0;
var days = msg.retentionDays || global.get('retentionDays') || 60;

node.warn('🗑️ ' + days + '일 이상 데이터 ' + changes + '건 삭제');
node.status({ fill: 'blue', shape: 'dot', text: changes + '건 삭제 (' + days + '일 보관)' });

// 출력 2: 로컬 총 행수 조회 쿼리 + 보고에 쓸 값 보관
msg.topic = 'SELECT COUNT(*) AS n FROM sensor_data';
msg._report = {
    farmId: env.get('FARM_ID') || global.get('farmId') || 'farm_0001',
    deletedRows: changes,
    retentionDays: days,
    ranAt: new Date().toISOString()
};
return [{ payload: msg.payload }, msg];   // [출력1 기존 debug, 출력2 COUNT 쿼리]
