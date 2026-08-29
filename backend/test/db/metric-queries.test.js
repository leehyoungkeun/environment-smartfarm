// Prometheus 지표 SQL 이 실제로 도는가 (실제 DB).
//
// 2026-08-29 오전, smartfarm_sensor_last_seen_seconds 에 `JOIN farms` 를 넣으면서
// SELECT 의 farm_id 를 sd. 로 한정하지 않아 "column reference farm_id is ambiguous" 가 났다.
// collect() 의 catch 는 reset() 만 하고 조용히 넘어가므로, 지표는 에러 없이 **그냥 사라졌고**
// SensorDataStalled 는 어떤 농장에 대해서도 울릴 수 없는 상태로 15분을 갔다.
//
// 정적 검사(metric-queries.test.js, unit)는 "sd. 접두어가 붙었는가" 같은 문자열 규칙만 본다.
// 여기서는 app.js 에서 SQL 을 그대로 뽑아 **테스트 DB 에 실행**한다.
// 문법·컬럼·모호성·없는 테이블 — 실행해야만 드러나는 것들이 여기서 걸린다.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const backend = join(here, "..", "..");
const APP = readFileSync(join(backend, "src", "app.js"), "utf8");

let pool;

/** app.js 안의 `pool.query(`...`)` 중 파라미터 없는 것 = 지표 수집 쿼리 */
function extractMetricQueries() {
  // 지표 정의 단위로 잘라서 각 구간 안에서만 찾는다.
  // 하나의 정규식으로 훑으면, 쿼리가 없는 지표의 매칭이 다음 지표의 쿼리를 삼켜 버린다.
  const marks = [...APP.matchAll(/name:\s*"(smartfarm_[a-z0-9_]+)"/g)];
  const out = [];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index;
    const end = i + 1 < marks.length ? marks[i + 1].index : APP.length;
    const block = APP.slice(start, end);
    // pool.query( 와 백틱 사이에 주석 줄이 있는 경우가 있다 (smartfarm_sensor_values).
    // 줄 주석을 먼저 걷어내고 찾는다 — SQL 안의 -- 주석은 그대로 둔다.
    const stripped = block.replace(/^\s*\/\/.*$/gm, "");
    const q = stripped.match(/pool\.query\(\s*`([\s\S]*?)`\s*\)/);
    if (q) out.push({ metric: marks[i][1], sql: q[1] });
  }
  return out;
}

before(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  // Prisma 스키마 밖의 테이블은 손으로 만든 DDL 이 있어야 한다. 여기서 적용해 보는 것 자체가 검증이다.
  for (const f of readdirSync(join(backend, "prisma")).filter((x) => /^migration-(relay-status|device-positions)\.sql$/.test(x))) {
    await pool.query(readFileSync(join(backend, "prisma", f), "utf8"));
  }
});

after(async () => {
  await pool.query("DELETE FROM sensor_data WHERE farm_id LIKE 'farm_mtest%'").catch(() => {});
  await pool.query("DELETE FROM relay_status WHERE farm_id LIKE 'farm_mtest%'").catch(() => {});
  await pool.query("DELETE FROM control_logs WHERE farm_id LIKE 'farm_mtest%'").catch(() => {});
  await pool.query("DELETE FROM farms WHERE farm_id LIKE 'farm_mtest%'").catch(() => {});
  await pool.end();
});

describe("지표 SQL 이 실제 DB 에서 실행된다", () => {
  const queries = extractMetricQueries();

  test("app.js 에서 지표 쿼리를 찾았다", () => {
    assert.ok(queries.length >= 4, `지표 쿼리 ${queries.length}개 — 추출 정규식이 깨졌을 수 있다`);
  });

  for (const { metric, sql } of queries) {
    test(`${metric} — 에러 없이 실행된다`, async () => {
      // 실패하면 collect() 의 catch 가 삼켜서 지표가 조용히 사라진다 (2026-08-29 15분 정지)
      await pool.query(sql);
    });
  }
});

describe("지표 SQL 이 옳은 행만 낸다", () => {
  before(async () => {
    for (const [id, status] of [["farm_mtest_a", "active"], ["farm_mtest_m", "maintenance"]]) {
      await pool.query(
        `INSERT INTO farms (id, farm_id, name, status, api_key, created_at, updated_at)
         VALUES ($1,$1,$1,$2,'test-key-' || $1,now(),now()) ON CONFLICT (farm_id) DO UPDATE SET status = $2`,
        [id, status]
      );
    }
    const ins = `INSERT INTO sensor_data (timestamp, farm_id, house_id, data, metadata) VALUES (now(), $1, $2, $3, $4)`;
    await pool.query(ins, ["farm_mtest_a", "house_0001", { temperature: 21 }, { quality: "good" }]);
    await pool.query(ins, ["farm_mtest_a", "house_0002", { temperature: 22 }, { quality: "simulated" }]);
    await pool.query(ins, ["farm_mtest_m", "house_0001", { temperature: 23 }, { quality: "good" }]);
    await pool.query(
      `INSERT INTO relay_status (farm_id, unit_id, module_type, coils, updated_at)
       VALUES ($1,2,'waveshare',$2,now()), ($3,2,'waveshare',$2,now())
       ON CONFLICT (farm_id, unit_id) DO UPDATE SET updated_at = now()`,
      ["farm_mtest_a", JSON.stringify([false]), "farm_mtest_m"]
    );
  });

  async function rowsOf(metric) {
    const q = extractMetricQueries().find((x) => x.metric === metric);
    assert.ok(q, `${metric} 쿼리를 못 찾았다`);
    const { rows } = await pool.query(q.sql);
    return rows.filter((r) => String(r.farm_id).startsWith("farm_mtest"));
  }

  test("센서 지표: 활성 농장의 실측만 (점검중·시뮬레이션 제외)", async () => {
    const rows = await rowsOf("smartfarm_sensor_last_seen_seconds");
    const keys = rows.map((r) => `${r.farm_id}/${r.house_id}`).sort();
    assert.deepEqual(keys, ["farm_mtest_a/house_0001"],
      "점검중 농장이나 시뮬레이션 값이 지표에 섞였다 — 거짓 경보의 원인 (B4)");
  });

  test("센서 지표: 경과 초가 숫자로 나온다", async () => {
    const rows = await rowsOf("smartfarm_sensor_last_seen_seconds");
    const age = Number(rows[0].age);
    assert.ok(Number.isFinite(age) && age >= 0 && age < 120, `age=${rows[0].age} — 값이 이상하다`);
  });

  test("릴레이 지표: 점검중 농장 제외", async () => {
    const rows = await rowsOf("smartfarm_relay_status_age_seconds");
    assert.deepEqual(rows.map((r) => r.farm_id), ["farm_mtest_a"]);
  });

  // 개별 지표를 하나씩 적으면 새 지표가 추가될 때 빠진다. 조건에 해당하는 쿼리 전체를 훑는다.
  const sensorQueries = extractMetricQueries().filter((q) => /FROM sensor_data/.test(q.sql));
  for (const q of sensorQueries) {
    test(`${q.metric} — 시뮬레이션 값이 섞이지 않는다 (B4)`, async () => {
      const { rows } = await pool.query(q.sql);
      const mine = rows.filter((r) => String(r.farm_id).startsWith("farm_mtest"));
      assert.equal(
        mine.some((r) => r.house_id === "house_0002"),
        false,
        "시뮬레이션 값이 지표에 들어왔다 — 실측처럼 보이고 경보 판단을 오염시킨다 (farm_0006 사례)"
      );
    });

    test(`${q.metric} — 점검중 농장이 섞이지 않는다`, async () => {
      const { rows } = await pool.query(q.sql);
      const mine = rows.filter((r) => String(r.farm_id).startsWith("farm_mtest"));
      assert.equal(
        mine.some((r) => r.farm_id === "farm_mtest_m"),
        false,
        "점검중 농장이 지표에 남아 거짓 경보를 만든다"
      );
    });
  }

  test("sensor_data 를 읽는 지표를 실제로 찾았다", () => {
    assert.ok(sensorQueries.length >= 3, `${sensorQueries.length}개 — 추출이 깨졌다`);
  });

  test("모호한 컬럼이 있으면 여기서 걸린다 (회귀 재현)", async () => {
    // JOIN 이 있는 쿼리에서 한정 없는 farm_id 를 쓰면 Postgres 가 거부한다는 사실 자체를 못 박는다
    await assert.rejects(
      () => pool.query(`SELECT farm_id FROM sensor_data sd JOIN farms f ON f.farm_id = sd.farm_id LIMIT 1`),
      /ambiguous/i,
      "이 테스트가 실패하면 Postgres 동작이 바뀐 것 — 위 검사들의 전제가 무너진다"
    );
  });
});
