// Alertmanager 해소 → 같은 경보의 이전 발화 알림 닫기 — 실제 DB 에서 (2026-09-19)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { resolvePriorFiring } from "../../src/services/alertResolve.js";

let pool;
const FARM = "farm_rtest";
const L = (house, series) => ({ alertname: "KsDataWindowBroken", farm_id: FARM, house_id: house, series, severity: "warning" });

async function ins({ house = "house_0002", type = "KsDataWindowBroken", labels, status = "firing", ack = false, source = "alertmanager", ageMin = 60 }) {
  const r = await pool.query(
    `INSERT INTO alerts (farm_id, house_id, alert_type, severity, message, metadata, acknowledged, timestamp)
     VALUES ($1, $2, $3, 'WARNING', 'x', $4::jsonb, $5, NOW() - make_interval(mins => $6)) RETURNING id`,
    [FARM, house, type, JSON.stringify({ source, status, labels }), ack, ageMin]
  );
  return r.rows[0].id;
}
const ackOf = async (id) => (await pool.query("SELECT acknowledged, metadata->>'resolvedBy' AS by FROM alerts WHERE id = $1", [id])).rows[0];

before(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  await pool.query("DELETE FROM alerts WHERE farm_id = $1", [FARM]);
});
after(async () => {
  await pool.query("DELETE FROM alerts WHERE farm_id = $1", [FARM]).catch(() => {});
  await pool.end();
});

describe("해소가 오면 같은 경보의 미확인 발화만 닫힌다", () => {
  test("같은 labels 두 건은 닫히고, 다른 계열·다른 하우스·사람 확인·수동 알림·오래된 것은 그대로", async () => {
    const same1 = await ins({ labels: L("house_0002", "heater1"), ageMin: 120 });
    const same2 = await ins({ labels: L("house_0002", "heater1"), ageMin: 60 });
    const otherSeries = await ins({ labels: L("house_0002", "window1") });
    const otherHouse = await ins({ house: "house_0003", labels: L("house_0003", "heater1") });
    const humanAcked = await ins({ labels: L("house_0002", "heater1"), ack: true });
    const notAm = await ins({ labels: L("house_0002", "heater1"), source: "nodered" });
    const old = await ins({ labels: L("house_0002", "heater1"), ageMin: 60 * 24 * 40 });

    const n = await resolvePriorFiring(pool, { farmId: FARM, houseId: "house_0002", alertName: "KsDataWindowBroken", labels: L("house_0002", "heater1") });
    assert.equal(n, 2);
    assert.deepEqual(await ackOf(same1), { acknowledged: true, by: "alertmanager" });
    assert.deepEqual(await ackOf(same2), { acknowledged: true, by: "alertmanager" });
    for (const id of [otherSeries, otherHouse, notAm, old]) assert.equal((await ackOf(id)).acknowledged, false, id);
    assert.deepEqual(await ackOf(humanAcked), { acknowledged: true, by: null }, "사람이 확인한 행은 해소 표시로 덮지 않는다");
  });

  test("labels 키 순서가 달라도 같은 경보로 본다 (jsonb 비교)", async () => {
    const id = await ins({ labels: { severity: "warning", series: "x", house_id: "house_0002", farm_id: FARM, alertname: "KsDataWindowBroken" } });
    const n = await resolvePriorFiring(pool, { farmId: FARM, houseId: "house_0002", alertName: "KsDataWindowBroken",
      labels: { alertname: "KsDataWindowBroken", farm_id: FARM, house_id: "house_0002", series: "x", severity: "warning" } });
    assert.equal(n, 1);
    assert.equal((await ackOf(id)).acknowledged, true);
  });
});
