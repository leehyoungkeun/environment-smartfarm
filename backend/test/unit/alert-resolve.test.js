// Alertmanager 해소 → 같은 경보의 이전 발화 알림 닫기 (2026-09-19, house_0002 SensorDataStalled 가 해소 뒤에도 빨갛게 남은 사고)
// DB 없이: SQL 에 반드시 있어야 할 조건과 파라미터 순서를 잠근다. 실제 동작은 test/db/alert-resolve.test.js.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolvePriorFiring, RESOLVE_SQL, RESOLVE_LOOKBACK_DAYS } from "../../src/services/alertResolve.js";

describe("resolvePriorFiring", () => {
  test("같은 경보만 — 농장·하우스·유형·labels 전체 일치, 미확인 발화 행만", () => {
    const q = RESOLVE_SQL.replace(/\s+/g, " ");
    for (const must of [
      "farm_id = $1", "house_id = $2", "alert_type = $3",
      "acknowledged IS NOT TRUE",
      "metadata->>'source' = 'alertmanager'",
      "metadata->>'status' = 'firing'",
      "metadata->'labels' = $4::jsonb",
      "make_interval(days => $5)",
    ]) assert.ok(q.includes(must), `조건 누락: ${must}`);
    assert.match(q, /SET acknowledged = true/);
  });

  test("파라미터 순서와 labels 직렬화, rowCount 반환", async () => {
    const calls = [];
    const pool = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 2 }; } };
    const labels = { alertname: "SensorDataStalled", farm_id: "farm_0001", house_id: "house_0002", severity: "critical" };
    const n = await resolvePriorFiring(pool, { farmId: "farm_0001", houseId: "house_0002", alertName: "SensorDataStalled", labels });
    assert.equal(n, 2);
    assert.deepEqual(calls[0].params, ["farm_0001", "house_0002", "SensorDataStalled", JSON.stringify(labels), RESOLVE_LOOKBACK_DAYS]);
  });

  test("labels 없으면 빈 객체, 결과 없으면 0", async () => {
    const pool = { query: async (_s, p) => { assert.equal(p[3], "{}"); return {}; } };
    assert.equal(await resolvePriorFiring(pool, { farmId: "f", houseId: "h", alertName: "A" }), 0);
  });

  test("웹훅이 해소일 때만 부른다", () => {
    const src = readFileSync(new URL("../../src/routes/internal.routes.js", import.meta.url), "utf8");
    const hook = src.slice(src.indexOf('router.post("/alert-webhook"'), src.indexOf('router.post("/status-update"'));
    assert.match(hook, /if \(status === "resolved"\) \{[\s\S]*?resolvePriorFiring\(pool, \{ farmId, houseId, alertName, labels \}\)/);
  });
});
