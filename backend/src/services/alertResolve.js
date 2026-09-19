// Alertmanager 「해소」 수신 시 같은 경보의 이전 발화 알림을 닫는다 (2026-09-19).
//
// 왜: 웹훅은 해소가 오면 "[해소] …" INFO 행을 새로 넣기만 했다. 같은 경보가 발화 중
// repeat_interval 마다 쌓은 CRITICAL/WARNING 행은 미확인으로 남아, 이미 끝난 문제가
// 알림 패널에 빨갛게 남고 미확인 개수에 계속 잡혔다 (house_0002 SensorDataStalled — 18:11 해소 뒤에도 16:21·17:26 두 건).
//
// "같은 경보" = 같은 farm_id · house_id · alert_type 이고, Alertmanager 가 보낸 labels 가 완전히 같은 것.
// labels 전체를 비교해야 같은 이름의 다른 계열(KsDataWindowBroken heater1 / window1)을 잘못 닫지 않는다.
// 사람이 이미 확인한 행은 건드리지 않고, 해소 시각·주체만 metadata 에 남긴다(확인 시각은 해소 시각).

export const RESOLVE_LOOKBACK_DAYS = 30; // alerts 는 시간 파티션 — 스캔 범위를 제한한다

export const RESOLVE_SQL = `UPDATE alerts
   SET acknowledged = true,
       acknowledged_at = NOW(),
       metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('resolvedBy', 'alertmanager', 'resolvedAt', NOW())
 WHERE farm_id = $1
   AND house_id = $2
   AND alert_type = $3
   AND acknowledged IS NOT TRUE
   AND metadata->>'source' = 'alertmanager'
   AND metadata->>'status' = 'firing'
   AND metadata->'labels' = $4::jsonb
   AND timestamp > NOW() - make_interval(days => $5)`;

/**
 * @param {{query: Function}} pool
 * @param {{farmId: string, houseId: string, alertName: string, labels: object}} a
 * @returns {Promise<number>} 닫은 행 수
 */
export async function resolvePriorFiring(pool, { farmId, houseId, alertName, labels }) {
  const r = await pool.query(RESOLVE_SQL, [farmId, houseId, alertName, JSON.stringify(labels || {}), RESOLVE_LOOKBACK_DAYS]);
  return r?.rowCount || 0;
}
