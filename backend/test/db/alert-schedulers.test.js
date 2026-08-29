// 경보 스케줄러 — 실제 DB 위에서 판정·서킷 브레이커·쿨다운의 상호작용을 검증한다.
//
// 근거가 된 실제 함정 4가지 (feedback_alert_system_traps, 2026-08-26 점검):
//   1. 서킷 브레이커 영구 래치 — 전 기간 미확인을 세면 아무도 확인 안 하는 한 감지가
//      영원히 죽는다 (AWS 3주 단절을 못 잡은 실제 원인). 24시간 창으로 고쳤다.
//   2. 농장단위 알림이 하우스 화면에 안 보여 확인 처리를 못 함 → 1번을 악화
//   3. soft-delete 된 알림이 지표·판정에 계속 잡힘
//   4. 점검중 농장: 장치 상태는 갱신하되 알림은 내지 않는다 (2026-08-29 farm_0006)
//
// 주의: checkSensorThresholds 는 모듈 상태(lastRunTime)로 재실행을 막으므로
// **한 번만 호출**하고, 시나리오를 하우스별로 나눠 한 실행에서 전부 판정시킨다.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const P = "farm_altest"; // 이 테스트 전용 접두어 — 병렬 실행되는 다른 파일과 충돌 방지
let pool;
let Alert;

const now = () => new Date();
const minAgo = (m) => new Date(Date.now() - m * 60 * 1000);
const hourAgo = (h) => new Date(Date.now() - h * 3600 * 1000);

const SENSORS_CFG = JSON.stringify([
  { sensorId: "temp_1", name: "온도", unit: "°C", type: "number", min: 5, max: 40, alertEnabled: true },
]);

async function seedFarm(id, status = "active", lastSeenAt = null) {
  await pool.query(
    `INSERT INTO farms (id, farm_id, name, status, api_key, last_seen_at, created_at, updated_at)
     VALUES ($1,$1,$1,$2,'test-key-'||$1,$3,now(),now())
     ON CONFLICT (farm_id) DO UPDATE SET status=$2, last_seen_at=$3`,
    [id, status, lastSeenAt]
  );
}

async function seedHouse(farmId, houseId) {
  await pool.query(
    `INSERT INTO house_configs (id, farm_id, house_id, house_name, sensors, enabled, created_at, updated_at)
     VALUES ($1,$2,$3,$3,$4,true,now(),now())
     ON CONFLICT (farm_id, house_id) DO UPDATE SET sensors=$4, enabled=true`,
    [`${farmId}_${houseId}`, farmId, houseId, SENSORS_CFG]
  );
}

async function seedSensorRow(farmId, houseId, temp, at = now(), quality = "good") {
  await pool.query(
    `INSERT INTO sensor_data (timestamp, farm_id, house_id, data, metadata) VALUES ($1,$2,$3,$4,$5)`,
    [at, farmId, houseId, { temp_1: temp }, { quality }]
  );
}

async function seedAlert(farmId, houseId, { type = "SENSOR_THRESHOLD", sensorId = "temp_1", at = now(), acked = false, deleted = false } = {}) {
  await pool.query(
    `INSERT INTO alerts (farm_id, house_id, sensor_id, alert_type, severity, message, metadata, acknowledged, timestamp)
     VALUES ($1,$2,$3,$4,'WARNING','seed',$5,$6,$7)`,
    [farmId, houseId, sensorId, type, deleted ? { deleted: true } : {}, acked, at]
  );
}

async function alertsOf(farmId, houseId, type = "SENSOR_THRESHOLD") {
  const { rows } = await pool.query(
    `SELECT * FROM alerts WHERE farm_id=$1 AND house_id=$2 AND alert_type=$3 AND message <> 'seed' ORDER BY timestamp`,
    [farmId, houseId, type]
  );
  return rows;
}

before(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  Alert = (await import("../../src/models/Alert.js")).default;

  // ── 임계 스케줄러 시나리오 (한 실행에서 전부 판정) ──────────────────────
  await seedFarm(`${P}_a`, "active", now());       // 신선한 접속 — 오프라인 판정 안 걸리게
  await seedFarm(`${P}_m`, "maintenance", now());
  for (const h of ["h_over", "h_ok", "h_sim", "h_stale", "h_brk", "h_rel", "h_cool", "h_del"]) {
    await seedHouse(`${P}_a`, h);
  }
  await seedHouse(`${P}_m`, "h_m");

  await seedSensorRow(`${P}_a`, "h_over", 45);                       // 초과 → 알림
  await seedSensorRow(`${P}_a`, "h_ok", 20);                         // 정상
  await seedSensorRow(`${P}_a`, "h_sim", 99, now(), "simulated");    // 시뮬레이션만 존재
  await seedSensorRow(`${P}_a`, "h_stale", 45, minAgo(20));          // 20분 전 — 낡음
  await seedSensorRow(`${P}_a`, "h_brk", 45);                        // + 미확인 3건(최근) → 브레이커
  await seedSensorRow(`${P}_a`, "h_rel", 45);                        // + 미확인 3건(25시간 전) → 해제
  await seedSensorRow(`${P}_a`, "h_cool", 45);                       // + 5분 전 알림 → 쿨다운
  await seedSensorRow(`${P}_a`, "h_del", 45);                        // + 삭제된 미확인 3건 → 래치 안 됨
  await seedSensorRow(`${P}_m`, "h_m", 45);                          // 점검중 농장

  for (let i = 0; i < 3; i++) {
    await seedAlert(`${P}_a`, "h_brk", { at: hourAgo(1 + i) });
    await seedAlert(`${P}_a`, "h_rel", { at: hourAgo(25 + i) });
    await seedAlert(`${P}_a`, "h_del", { at: hourAgo(1 + i), deleted: true });
  }
  await seedAlert(`${P}_a`, "h_cool", { at: minAgo(5), acked: true });

  const { checkSensorThresholds } = await import("../../src/schedulers/sensorThresholdAlert.js");
  await checkSensorThresholds(); // 모듈 상태(lastRunTime) 때문에 단 한 번

  // ── 오프라인 스케줄러 시나리오 ─────────────────────────────────────────
  await seedFarm(`${P}_off`, "active", minAgo(70));   // 70분 → CRITICAL
  await seedFarm(`${P}_warn`, "active", minAgo(15));  // 15분 → WARNING
  await seedFarm(`${P}_ok`, "active", minAgo(2));     // 신선
  await seedFarm(`${P}_moff`, "maintenance", minAgo(70)); // 점검중 — 장치만 갱신
  await seedFarm(`${P}_obrk`, "active", minAgo(70));  // + 미확인 FARM_OFFLINE 3건 → 브레이커
  for (let i = 0; i < 3; i++) await seedAlert(`${P}_obrk`, "FARM", { type: "FARM_OFFLINE", sensorId: null, at: hourAgo(1 + i) });
  await pool.query(
    `INSERT INTO devices (device_code, farm_id, status) VALUES ($1,$2,'online')
     ON CONFLICT (device_code) DO UPDATE SET status='online'`,
    [`DEV-${P}-moff`, `${P}_moff`]
  );

  const { checkOfflineFarms } = await import("../../src/schedulers/offlineAlert.js");
  await checkOfflineFarms();

  // ── 장비 고장 스케줄러 시나리오 ────────────────────────────────────────
  await seedFarm(`${P}_df`, "active", now());
  const insFail = `INSERT INTO control_logs (timestamp, farm_id, house_id, device_id, device_type, device_name, command, success, error, operator, is_automatic, created_at)
                   VALUES ($1,$2,'house_0001',$3,'relay',$3,'on',false,'timeout','automation',true,NOW())`;
  for (let i = 0; i < 3; i++) await pool.query(insFail, [minAgo(5 + i), `${P}_df`, "fan_bad"]);
  for (let i = 0; i < 2; i++) await pool.query(insFail, [minAgo(5 + i), `${P}_df`, "fan_meh"]);

  const { checkDeviceFailures } = await import("../../src/schedulers/deviceFailureAlert.js");
  await checkDeviceFailures();
});

after(async () => {
  await pool.query(`DELETE FROM alerts WHERE farm_id LIKE '${P}%'`).catch(() => {});
  await pool.query(`DELETE FROM sensor_data WHERE farm_id LIKE '${P}%'`).catch(() => {});
  await pool.query(`DELETE FROM control_logs WHERE farm_id LIKE '${P}%'`).catch(() => {});
  await pool.query(`DELETE FROM house_configs WHERE farm_id LIKE '${P}%'`).catch(() => {});
  await pool.query(`DELETE FROM devices WHERE device_code LIKE 'DEV-${P}%'`).catch(() => {});
  await pool.query(`DELETE FROM farms WHERE farm_id LIKE '${P}%'`).catch(() => {});
  await pool.end();
});

describe("임계 스케줄러 — 실제 DB 판정", () => {
  test("임계 초과 → 알림 생성 (방향·임계값 기록)", async () => {
    const a = await alertsOf(`${P}_a`, "h_over");
    assert.equal(a.length, 1, "45°C > 40°C 인데 알림이 없다");
    assert.equal(a[0].severity, "WARNING"); // 초과 5 < range 35 × 0.5
    assert.equal(a[0].metadata.direction, "상한");
    assert.equal(Number(a[0].threshold), 40);
  });

  test("정상 범위 → 알림 없음", async () => {
    assert.equal((await alertsOf(`${P}_a`, "h_ok")).length, 0);
  });

  test("시뮬레이션 값으로는 경보하지 않는다 (B4 — farm_0006 13만 행 사고)", async () => {
    assert.equal((await alertsOf(`${P}_a`, "h_sim")).length, 0, "시뮬레이션 99°C 에 경보가 울렸다");
  });

  test("10분 이상 낡은 데이터로는 경보하지 않는다", async () => {
    assert.equal((await alertsOf(`${P}_a`, "h_stale")).length, 0);
  });

  test("점검중 농장은 경보하지 않는다", async () => {
    assert.equal((await alertsOf(`${P}_m`, "h_m")).length, 0, "점검중 farm_0006 이 계속 울리던 그 사고");
  });

  test("서킷 브레이커: 24시간 내 미확인 3건이면 스킵 (알림 폭주 방지)", async () => {
    assert.equal((await alertsOf(`${P}_a`, "h_brk")).length, 0);
  });

  test("★ 브레이커는 스스로 풀린다 — 미확인이 오래됐으면(25시간) 다시 경보한다", async () => {
    const a = await alertsOf(`${P}_a`, "h_rel");
    assert.equal(a.length, 1,
      "전 기간 미확인을 세면 브레이커가 영구 래치된다 — AWS 3주 단절을 못 잡은 실제 원인");
  });

  test("쿨다운: 15분 내 같은 센서 알림이 있으면 스킵 (확인 여부 무관)", async () => {
    assert.equal((await alertsOf(`${P}_a`, "h_cool")).length, 0);
  });

  test("soft-delete 된 미확인은 브레이커를 잠그지 않는다", async () => {
    const a = await alertsOf(`${P}_a`, "h_del");
    assert.equal(a.length, 1, "지운 알림이 판정에 계속 잡힌다 — 함정 3");
  });
});

describe("오프라인 스케줄러 — 상태 갱신과 알림의 분리", () => {
  test("70분 미접속 활성 농장 → CRITICAL", async () => {
    const a = await alertsOf(`${P}_off`, "FARM", "FARM_OFFLINE");
    assert.equal(a.length, 1);
    assert.equal(a[0].severity, "CRITICAL");
  });

  test("15분 미접속 → WARNING", async () => {
    const a = await alertsOf(`${P}_warn`, "FARM", "FARM_OFFLINE");
    assert.equal(a.length, 1);
    assert.equal(a[0].severity, "WARNING");
  });

  test("신선한 농장 → 알림 없음", async () => {
    assert.equal((await alertsOf(`${P}_ok`, "FARM", "FARM_OFFLINE")).length, 0);
  });

  test("★ 점검중 농장: 알림은 없지만 장치 상태는 offline 으로 갱신된다", async () => {
    // 2026-08-29 farm_0006: active 만 돌면 점검중 농장 장치가 영원히 '온라인' 으로 남는다
    assert.equal((await alertsOf(`${P}_moff`, "FARM", "FARM_OFFLINE")).length, 0, "점검중 농장에 알림이 갔다");
    const { rows } = await pool.query("SELECT status FROM devices WHERE device_code=$1", [`DEV-${P}-moff`]);
    assert.equal(rows[0].status, "offline", "점검중 농장의 장치가 온라인으로 박제됐다");
  });

  test("브레이커: 미확인 FARM_OFFLINE 3건이면 스킵", async () => {
    assert.equal((await alertsOf(`${P}_obrk`, "FARM", "FARM_OFFLINE")).length, 0);
  });
});

describe("장비 고장 스케줄러", () => {
  test("30분 내 3회 실패 → DEVICE_FAILURE 알림", async () => {
    const a = await alertsOf(`${P}_df`, "house_0001", "DEVICE_FAILURE");
    assert.equal(a.length, 1, "연속 실패 장비가 조용히 넘어간다");
    assert.equal(a[0].sensor_id, "fan_bad");
    assert.equal(a[0].metadata.failCount, 3);
  });

  test("2회 실패는 임계 미달 — 알림 없음", async () => {
    const a = await alertsOf(`${P}_df`, "house_0001", "DEVICE_FAILURE");
    assert.equal(a.filter((x) => x.sensor_id === "fan_meh").length, 0);
  });
});

describe("Alert.find — 화면과 판정이 같은 것을 본다", () => {
  test("하우스 조회에 농장단위 알림(FARM/'-')이 포함된다 (함정 2 — 영구 래치의 공범)", async () => {
    await seedAlert(`${P}_off`, "-", { type: "INFRA", sensorId: null });
    const found = await Alert.find({ farmId: `${P}_off`, houseId: "house_0001" }, { limit: 50 });
    const houseIds = found.map((a) => a.houseId);
    assert.ok(houseIds.includes("FARM"), "FARM 단위 알림이 하우스 화면에서 안 보인다 — 확인 처리 불가 → 브레이커 영구 래치");
    assert.ok(houseIds.includes("-"), "Alertmanager('-') 알림이 하우스 화면에서 안 보인다");
    assert.ok(found.every((a) => a.isFarmLevel === (a.houseId === "FARM" || a.houseId === "-")));
  });

  test("soft-delete 는 기본 제외, includeDeleted 로만 조회된다", async () => {
    const def = await Alert.find({ farmId: `${P}_a`, houseId: "h_del" }, { limit: 50 });
    assert.equal(def.filter((a) => a.message === "seed").length, 0, "지운 알림이 기본 조회에 나온다");
    const all = await Alert.find({ farmId: `${P}_a`, houseId: "h_del" }, { limit: 50, includeDeleted: true });
    assert.equal(all.filter((a) => a.message === "seed").length, 3);
  });
});

describe("인라인 판정 (sensors.js — 수집 직후 즉시 경보)", () => {
  const CONFIG = {
    houseName: "인라인동",
    sensors: [{ sensorId: "temp_1", name: "온도", unit: "°C", type: "number", min: 5, max: 40 }],
  };

  test("상한 ×1.2 초과면 CRITICAL, 미만이면 WARNING", async () => {
    const { checkAndCreateAlerts } = await import("../../src/routes/sensors.js");
    await checkAndCreateAlerts(`${P}_in1`, "house_0001", { temp_1: 49 }, CONFIG); // 49 > 48
    await checkAndCreateAlerts(`${P}_in2`, "house_0001", { temp_1: 47 }, CONFIG); // 47 < 48
    const [c] = await alertsOf(`${P}_in1`, "house_0001", "HIGH");
    const [w] = await alertsOf(`${P}_in2`, "house_0001", "HIGH");
    assert.equal(c?.severity, "CRITICAL");
    assert.equal(w?.severity, "WARNING");
  });

  test("하한 ×0.8 미만이면 CRITICAL", async () => {
    const { checkAndCreateAlerts } = await import("../../src/routes/sensors.js");
    await checkAndCreateAlerts(`${P}_in3`, "house_0001", { temp_1: 3.9 }, CONFIG); // 3.9 < 4
    const [a] = await alertsOf(`${P}_in3`, "house_0001", "LOW");
    assert.equal(a?.severity, "CRITICAL");
  });

  test("10분 쿨다운 — 같은 센서·유형은 한 번만", async () => {
    const { checkAndCreateAlerts } = await import("../../src/routes/sensors.js");
    await checkAndCreateAlerts(`${P}_in4`, "house_0001", { temp_1: 45 }, CONFIG);
    await checkAndCreateAlerts(`${P}_in4`, "house_0001", { temp_1: 46 }, CONFIG);
    assert.equal((await alertsOf(`${P}_in4`, "house_0001", "HIGH")).length, 1, "매분 수집마다 알림이 쏟아진다");
  });

  test("값이 없는 센서는 침묵 — 0 으로 오판하지 않는다", async () => {
    const { checkAndCreateAlerts } = await import("../../src/routes/sensors.js");
    await checkAndCreateAlerts(`${P}_in5`, "house_0001", {}, CONFIG);
    assert.equal((await alertsOf(`${P}_in5`, "house_0001", "LOW")).length, 0);
  });
});
