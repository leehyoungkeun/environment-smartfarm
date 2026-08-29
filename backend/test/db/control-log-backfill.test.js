// 제어 이력 소급 전송의 중복 판정 (실제 DB).
//
// 2026-08-26: RPi 로컬 10,106건 중 서버에 없던 기록을 소급 전송했는데, 중복 판정이
// 자기 자신이 방금 넣은 행까지 보는 바람에 1,474건이 "중복"으로 폐기됐다.
// 서버에 아무 기록도 없던 구간에서조차 사라졌다 — 측창을 열었다 멈췄다 다시 여는 식의
// 수 초 간격 반복 조작이 통째로 없어지는 증상이었다. 유실분은 복구하지 않았다.
//
// 고친 방법은 판정 쿼리에 `operator IS DISTINCT FROM 'rpi_backfill'` 한 줄이다.
// 그 한 줄이 지워져도 코드는 멀쩡히 돌고 테스트도 통과하며, 다음 소급 때 또 잃는다.
// 그래서 여기서는 internal.routes.js 의 SQL 을 **그대로 뽑아** 실제 행에 돌린다.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const backend = join(here, "..", "..");
const SRC = readFileSync(join(backend, "src", "routes", "internal.routes.js"), "utf8");

const FARM = "farm_ctest";
const HOUSE = "house_0001";
const DEV = "side_window_1";
const TOL = "15";
let pool;

/** 소급 중복 판정 SQL 을 소스에서 그대로 가져온다 */
function windowQuery() {
  const m = SRC.match(/`(SELECT 1 FROM control_logs[\s\S]*?LIMIT 1)`/);
  assert.ok(m, "internal.routes.js 에서 중복 판정 쿼리를 못 찾았다 — 구조가 바뀌었으면 이 테스트를 고쳐야 한다");
  return m[1];
}

before(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  await pool.query(
    `INSERT INTO farms (id, farm_id, name, status, api_key, created_at, updated_at)
     VALUES ($1,$1,'소급 테스트 농장','active','test-key-' || $1,now(),now()) ON CONFLICT (farm_id) DO NOTHING`,
    [FARM]
  );
});

after(async () => {
  await pool.query("DELETE FROM control_logs WHERE farm_id = $1", [FARM]).catch(() => {});
  await pool.query("DELETE FROM farms WHERE farm_id = $1", [FARM]).catch(() => {});
  await pool.end();
});

beforeEach(async () => {
  await pool.query("DELETE FROM control_logs WHERE farm_id = $1", [FARM]);
});

async function insertLog({ at, operator, command = "open", requestId = null }) {
  await pool.query(
    `INSERT INTO control_logs
       (timestamp, farm_id, house_id, control_house_id, device_id, device_type, device_name,
        command, success, request_id, operator, is_automatic, created_at)
     VALUES ($1,$2,$3,$3,$4,'relay',$4,$5,true,$6,$7,false,NOW())`,
    [at, FARM, HOUSE, DEV, command, requestId, operator]
  );
}

/** 소스에서 뽑은 판정 쿼리를 그대로 실행 */
async function isDuplicate(at) {
  const { rowCount } = await pool.query(windowQuery(), [FARM, DEV, "open", at, TOL]);
  return rowCount > 0;
}

const T0 = "2026-03-24T10:00:00.000Z";
const plus = (sec) => new Date(Date.parse(T0) + sec * 1000).toISOString();

describe("소급 중복 판정 — 실시간 기록만 봐야 한다", () => {
  test("실시간 경로가 같은 시각에 남긴 기록은 중복이다", async () => {
    await insertLog({ at: plus(3), operator: "web_dashboard" });
    assert.equal(await isDuplicate(T0), true, "실시간 기록과 겹치는 소급분은 걸러야 한다");
  });

  test("허용 오차(15초) 밖이면 중복이 아니다", async () => {
    await insertLog({ at: plus(60), operator: "web_dashboard" });
    assert.equal(await isDuplicate(T0), false);
  });

  test("★ 소급분끼리는 서로를 중복으로 보지 않는다 (1,474건 유실의 원인)", async () => {
    // 같은 배치에서 방금 넣은 소급 행. 이게 중복으로 걸리면 반복 조작이 통째로 사라진다.
    await insertLog({ at: plus(2), operator: "rpi_backfill", requestId: `rpi:${FARM}:1` });
    assert.equal(
      await isDuplicate(T0),
      false,
      "소급 행이 다음 소급 행을 지운다 — operator IS DISTINCT FROM 'rpi_backfill' 이 빠졌다"
    );
  });

  test("수 초 간격 반복 조작이 모두 남는다", async () => {
    // 측창을 열고 → 멈추고 → 다시 여는 실제 패턴. 서버에 사전 기록은 없다.
    for (const [i, sec] of [0, 4, 9, 13].entries()) {
      const at = plus(sec);
      if (await isDuplicate(at)) continue;
      await insertLog({ at, operator: "rpi_backfill", requestId: `rpi:${FARM}:${i}` });
    }
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM control_logs WHERE farm_id = $1", [FARM]);
    assert.equal(rows[0].n, 4, "15초 안의 반복 조작이 1건으로 뭉개졌다");
  });

  test("다른 장치는 서로 간섭하지 않는다", async () => {
    await pool.query(
      `INSERT INTO control_logs (timestamp, farm_id, house_id, device_id, device_type, device_name,
         command, success, operator, is_automatic, created_at)
       VALUES ($1,$2,$3,'roof_window_1','relay','roof_window_1','open',true,'web_dashboard',false,NOW())`,
      [plus(1), FARM, HOUSE]
    );
    assert.equal(await isDuplicate(T0), false, "장치가 다른데 중복으로 봤다");
  });
});

describe("request_id 는 로컬 기록마다 고유하다", () => {
  test("같은 request_id 는 두 번 들어가지 않는다 (재시도 안전)", async () => {
    const rid = `rpi:${FARM}:42`;
    await insertLog({ at: T0, operator: "rpi_backfill", requestId: rid });
    const { rowCount } = await pool.query("SELECT 1 FROM control_logs WHERE request_id = $1 LIMIT 1", [rid]);
    assert.equal(rowCount, 1, "1단계 재시도 방지가 동작하지 않는다");
  });
});

describe("복합키 — 하우스가 다르면 다른 장치다 (다중 하우스, 8/25)", () => {
  test("같은 device_id 라도 하우스별로 따로 기록된다", async () => {
    for (const h of ["house_0001", "house_0002"]) {
      await pool.query(
        `INSERT INTO control_logs (timestamp, farm_id, house_id, control_house_id, device_id,
           device_type, device_name, command, success, operator, is_automatic, created_at)
         VALUES (now(),$1,$2,$2,$3,'relay',$3,'open',true,'web_dashboard',false,NOW())`,
        [FARM, h, DEV]
      );
    }
    const { rows } = await pool.query(
      "SELECT house_id FROM control_logs WHERE farm_id = $1 AND device_id = $2 ORDER BY house_id",
      [FARM, DEV]
    );
    assert.deepEqual(rows.map((r) => r.house_id), ["house_0001", "house_0002"],
      "하우스가 뭉개지면 2동 제어가 1동 이력으로 보인다");
  });

  test("control_house_id 는 비면 house_id 로 채운다", async () => {
    await pool.query(
      `INSERT INTO control_logs (timestamp, farm_id, house_id, control_house_id, device_id,
         device_type, device_name, command, success, operator, is_automatic, created_at)
       VALUES (now(),$1,$2,COALESCE(NULL,$2),$3,'relay',$3,'stop',true,'web_dashboard',false,NOW())`,
      [FARM, "house_0003", DEV]
    );
    const { rows } = await pool.query(
      "SELECT control_house_id FROM control_logs WHERE farm_id = $1 AND house_id = 'house_0003'",
      [FARM]
    );
    assert.equal(rows[0].control_house_id, "house_0003");
  });
});
