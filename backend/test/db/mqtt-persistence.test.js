// MQTT 수신 → DB 영속화 (실제 DB) — relay_status UPSERT + device_positions 저장.
//
// 근거가 된 실제 사고:
//   - farm_0006: relay_status 행이 **하나도 없는** 상태로 3.5개월 (플래핑으로 수신 자체가 죽음).
//     행이 있어야 frontend mount 복원·감시 지표(smartfarm_relay_status_age_seconds)가 산다.
//   - NR 응답 fan-out 시절, unitId 없는 페이로드가 섞여 오던 문제 — DB 가드 검증.
//   - device_positions: houseId 정규화(normHouseId)가 빠지면 house1/house_0001 두 행으로 분열.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const FARM = "farm_mqtest";
let pool;
let mqttService;

const buf = (obj) => Buffer.from(JSON.stringify(obj));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  mqttService = (await import("../../src/services/mqttClient.js")).default;
  await pool.query(
    `INSERT INTO farms (id, farm_id, name, status, api_key, created_at, updated_at)
     VALUES ($1,$1,'MQTT 테스트','active','test-key-'||$1,now(),now()) ON CONFLICT (farm_id) DO NOTHING`,
    [FARM]
  );
});

after(async () => {
  await pool.query("DELETE FROM relay_status WHERE farm_id = $1", [FARM]).catch(() => {});
  await pool.query("DELETE FROM device_positions WHERE farm_id = $1", [FARM]).catch(() => {});
  await pool.query("DELETE FROM farms WHERE farm_id = $1", [FARM]).catch(() => {});
  await pool.end();
});

describe("relay_status UPSERT (frontend mount 복원 + 감시 지표의 원천)", () => {
  test("unitId+coils 수신 → 행 생성", async () => {
    mqttService._handleMessage(`smartfarm/${FARM}/relay/status`, buf({ unitId: 2, moduleType: "waveshare", coils: [true, false, false] }));
    await wait(150); // UPSERT 는 fire-and-forget
    const { rows } = await pool.query("SELECT * FROM relay_status WHERE farm_id = $1", [FARM]);
    assert.equal(rows.length, 1, "행이 없으면 mount 복원도 RelayStatusStale 감시도 죽는다 (farm_0006)");
    assert.equal(rows[0].unit_id, 2);
    assert.deepEqual(rows[0].coils, [true, false, false]);
  });

  test("같은 unit 재수신 → 갱신 (행 증식 없음)", async () => {
    const before_ = await pool.query("SELECT updated_at FROM relay_status WHERE farm_id = $1 AND unit_id = 2", [FARM]);
    await wait(50);
    mqttService._handleMessage(`smartfarm/${FARM}/relay/status`, buf({ unitId: 2, coils: [false, true, false] }));
    await wait(150);
    const { rows } = await pool.query("SELECT * FROM relay_status WHERE farm_id = $1 AND unit_id = 2", [FARM]);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].coils, [false, true, false]);
    assert.ok(new Date(rows[0].updated_at) > new Date(before_.rows[0].updated_at), "updated_at 이 멈추면 감시가 stale 로 오판한다");
  });

  test("unitId 없는 페이로드는 DB 에 넣지 않는다 (fan-out 오염 가드)", async () => {
    mqttService._handleMessage(`smartfarm/${FARM}/relay/status`, buf({ status: "ok", coils: [true] }));
    mqttService._handleMessage(`smartfarm/${FARM}/relay/status`, buf({ unitId: 9 })); // coils 없음
    await wait(150);
    const { rows } = await pool.query("SELECT unit_id FROM relay_status WHERE farm_id = $1", [FARM]);
    assert.deepEqual(rows.map((r) => r.unit_id), [2], "잡다한 페이로드가 relay_status 를 오염시켰다");
  });
});

describe("device_positions 저장 (자동 정지 후 위치)", () => {
  test("open 시작 신호 → started_at·duration·target 저장 (진행률 복원용)", async () => {
    mqttService._handleMessage(`smartfarm/${FARM}/device/position`, buf({
      houseId: "house_0001", deviceId: "window1", position: 0, command: "open",
      startPosition: 0, targetPosition: 100, duration: 30, startedAt: new Date().toISOString(),
    }));
    await wait(150);
    const { rows } = await pool.query("SELECT * FROM device_positions WHERE farm_id = $1", [FARM]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].command, "open");
    assert.equal(rows[0].duration, 30);
    assert.ok(rows[0].started_at, "started_at 이 없으면 새로고침 후 진행률 복원이 안 된다");
  });

  test("stop → position 만 갱신", async () => {
    mqttService._handleMessage(`smartfarm/${FARM}/device/position`, buf({
      houseId: "house_0001", deviceId: "window1", position: 40, command: "stop",
    }));
    await wait(150);
    const { rows } = await pool.query("SELECT position, command FROM device_positions WHERE farm_id = $1 AND device_id = 'window1'", [FARM]);
    assert.equal(rows.length, 1, "stop 이 새 행을 만들면 하우스별 위치가 증식한다");
    assert.equal(rows[0].position, 40);
    assert.equal(rows[0].command, "stop");
  });

  test("★ 레거시 house1 수신 → house_0001 행으로 (분열 방지)", async () => {
    mqttService._handleMessage(`smartfarm/${FARM}/device/position`, buf({
      houseId: "house1", deviceId: "window1", position: 70, command: "stop",
    }));
    await wait(150);
    const { rows } = await pool.query("SELECT house_id, position FROM device_positions WHERE farm_id = $1 AND device_id = 'window1'", [FARM]);
    assert.equal(rows.length, 1, "house1/house_0001 두 행으로 분열됐다 — 8/25 복합키 사고 재발");
    assert.equal(rows[0].house_id, "house_0001");
    assert.equal(rows[0].position, 70);
  });

  test("deviceId 나 position 이 없으면 저장하지 않는다", async () => {
    mqttService._handleMessage(`smartfarm/${FARM}/device/position`, buf({ houseId: "house_0001", position: 10 }));
    mqttService._handleMessage(`smartfarm/${FARM}/device/position`, buf({ houseId: "house_0001", deviceId: "ghost" }));
    await wait(150);
    const { rows } = await pool.query("SELECT device_id FROM device_positions WHERE farm_id = $1", [FARM]);
    assert.deepEqual(rows.map((r) => r.device_id), ["window1"]);
  });
});
