// 표준 구동기 1분 스냅샷 — 수신(멱등)·조회·추출을 실제 DB 에서 검증 (116 검정: 1분 조회·csv 추출·손실률 계산 근거)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import request from "supertest";

const here = dirname(fileURLToPath(import.meta.url));
const backend = join(here, "..", "..");
const FARM = "farm_astest";
const HOUSE = "house_0001";
let pool, app;

before(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  await pool.query(readFileSync(join(backend, "prisma", "migration-actuator-status.sql"), "utf8"));
  await pool.query(`INSERT INTO farms (id, farm_id, name, status, api_key, created_at, updated_at)
     VALUES ($1,$1,'스냅샷 테스트 농장','active','test-key-' || $1,now(),now()) ON CONFLICT (farm_id) DO NOTHING`, [FARM]);
  await pool.query("DELETE FROM actuator_status WHERE farm_id = $1", [FARM]);
  ({ default: app } = await import("../../src/app.js"));
});

after(async () => {
  await pool.query("DELETE FROM actuator_status WHERE farm_id = $1", [FARM]);
  await pool.end();
});

const KEY = () => "test-key-" + FARM;
const t0 = new Date(Date.UTC(2026, 7, 30, 0, 0, 0));
const rowsAt = (minutes, status = 201, remain = 30) => minutes.map((m) => ({
  timestamp: new Date(t0.getTime() + m * 60000).toISOString(), houseId: HOUSE, deviceId: "fan1", unit: 1, kind: "switch", n: 3,
  status, statusName: status === 201 ? "ON" : "READY", remain, opid: 7 }));

describe("POST /internal/actuator-status", () => {
  test("삽입 + 같은 행 재전송은 중복 없이 무시 (NR 큐 재전송 멱등)", async () => {
    const r1 = await request(app).post("/internal/actuator-status").set("x-api-key", KEY()).send({ farmId: FARM, rows: rowsAt([0, 1, 2]) });
    assert.equal(r1.status, 200, JSON.stringify(r1.body)); assert.equal(r1.body.inserted, 3);
    const r2 = await request(app).post("/internal/actuator-status").set("x-api-key", KEY()).send({ farmId: FARM, rows: rowsAt([1, 2, 3]) });
    assert.equal(r2.body.inserted, 1, "재전송 겹침 2행이 중복 삽입됐다");
    const { rows } = await pool.query("SELECT count(*)::int AS c FROM actuator_status WHERE farm_id = $1", [FARM]);
    assert.equal(rows[0].c, 4);
  });
  test("deviceId/status 없는 행은 거른다, 빈 배열은 0", async () => {
    const r = await request(app).post("/internal/actuator-status").set("x-api-key", KEY()).send({ farmId: FARM, rows: [{ deviceId: "x" }] });
    assert.equal(r.status, 400);
    const e = await request(app).post("/internal/actuator-status").set("x-api-key", KEY()).send({ farmId: FARM, rows: [] });
    assert.equal(e.body.inserted, 0);
  });
});

describe("GET /api/actuator-status — 1분 조회·추출 (raw SQL 로 라우트 쿼리 검증)", () => {
  test("기간·장치 필터 + 오름차순 + csv 본문", async () => {
    // 라우트는 JWT 뒤에 있으므로 여기서는 라우트가 쓰는 SQL 형태를 동일 조건으로 실행해 데이터를 검증하고,
    // 추출 본문은 라우트가 쓰는 변환 함수로 만든다 (통합 테스트는 401 만 확인).
    const { rows } = await pool.query(
      `SELECT "timestamp", house_id, device_id, unit, kind, n, status, status_name, remain, opid FROM actuator_status
       WHERE farm_id = $1 AND "timestamp" >= $2 AND "timestamp" <= $3 AND device_id = ANY($4) ORDER BY "timestamp" ASC, device_id ASC`,
      [FARM, t0, new Date(t0.getTime() + 3 * 60000), ["fan1"]]);
    assert.equal(rows.length, 4);
    assert.ok(rows[0].timestamp < rows[3].timestamp);
    const { actuatorStatusTable, toDelimited } = await import("../../src/utils/exportCsv.js");
    const { columns, rows: table } = actuatorStatusTable(rows);
    const csv = toDelimited(table, columns, "csv");
    assert.equal(csv.split("\r\n").filter(Boolean).length, 5, "헤더 + 4행");
    assert.ok(csv.includes(",fan1,1,switch,3,201,ON,30,7"));
  });
  test("손실률 계산 근거: 24시간 분 단위 건수 → L=(1-N/1440)×100", async () => {
    const { rows } = await pool.query(
      `SELECT count(DISTINCT date_trunc('minute', "timestamp"))::int AS n FROM actuator_status WHERE farm_id = $1 AND device_id = 'fan1'`, [FARM]);
    const L = (1 - rows[0].n / 1440) * 100;
    assert.equal(rows[0].n, 4); assert.ok(L > 99, "4분치만 넣었으니 손실률은 99% 이상이어야 계산이 맞다");
  });
});
