// 설정 저장이 남의 키를 지우지 않는다 — 실제 라우트 + 실제 DB.
//
// 2026-08-29: 릴레이 모듈 등록이 "어느 날 사라지는" 원인을 추적하니, PUT system-settings 가
// `settings = system_settings.settings || $2` 로만 저장하고 있었다. jsonb `||` 는 **최상위 키만**
// 합치므로, 전광판 화면이 `{ settings: { display } }` 만 보내면 같은 객체 안의
// relayModules·sensorModules 가 통째로 사라졌다. 릴레이 모듈이 없으면 비상 전체 OFF 가 실패한다.
//
// 로직을 여기에 베껴 쓰면 라우트가 바뀌어도 테스트는 통과한다. 그래서 실제 HTTP 요청을 보낸다.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import pg from "pg";

const FARM = "farm_stest";
const KEY = `test-key-${FARM}`;
let app;
let pool;

const BASE = {
  relayModules: [{ id: "r1", name: "메인릴레이", unitId: 2, channels: 8 }],
  sensorModules: [{ id: "s1", name: "온습도", unitId: 1 }],
  display: { enabled: true, interval: 60 },
};

before(async () => {
  app = (await import("../../src/app.js")).default;
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  await pool.query(
    `INSERT INTO farms (id, farm_id, name, status, api_key, created_at, updated_at)
     VALUES ($1,$1,'병합 테스트 농장','active',$2,now(),now())
     ON CONFLICT (farm_id) DO UPDATE SET api_key = $2, status = 'active'`,
    [FARM, KEY]
  );
});

after(async () => {
  await pool.query("DELETE FROM system_settings WHERE farm_id = $1", [FARM]).catch(() => {});
  await pool.query("DELETE FROM farms WHERE farm_id = $1", [FARM]).catch(() => {});
  await pool.end();
});

beforeEach(async () => {
  // 릴레이·센서·전광판이 모두 등록된 상태에서 시작한다
  await pool.query(
    `INSERT INTO system_settings (farm_id, settings, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (farm_id) DO UPDATE SET settings = $2, updated_at = now()`,
    [FARM, JSON.stringify({ settings: BASE, rpiSync: { configVersion: 1 } })]
  );
});

/** 실제 라우트로 저장한다 (농장 API 키 인증) */
async function save(settings) {
  const res = await request(app)
    .put(`/api/config/system-settings/${FARM}`)
    .set("x-api-key", KEY)
    .send({ settings });
  assert.ok(res.status < 400, `저장이 ${res.status} — ${JSON.stringify(res.body).slice(0, 200)}`);
  return res;
}

async function read() {
  const { rows } = await pool.query("SELECT settings->'settings' AS s FROM system_settings WHERE farm_id = $1", [FARM]);
  return rows[0]?.s || {};
}

describe("PUT system-settings — 자기 키만 바꾼다", () => {
  test("전광판만 저장해도 릴레이·센서 모듈이 남는다", async () => {
    await save({ display: { enabled: false, interval: 120 } });
    const s = await read();
    assert.equal(s.relayModules?.length, 1, "릴레이 모듈이 사라졌다 — 비상 전체 OFF 가 실패한다");
    assert.equal(s.sensorModules?.length, 1, "센서 모듈이 사라졌다");
    assert.equal(s.display.enabled, false, "전광판 값은 바뀌어야 한다");
    assert.equal(s.display.interval, 120);
  });

  test("릴레이 모듈만 저장해도 전광판·센서가 남는다", async () => {
    await save({ relayModules: [{ id: "r1", unitId: 2 }, { id: "r2", unitId: 3 }] });
    const s = await read();
    assert.equal(s.relayModules.length, 2);
    assert.equal(s.sensorModules?.length, 1);
    assert.equal(s.display?.enabled, true);
  });

  test("빈 배열로 모듈 삭제가 된다", async () => {
    await save({ relayModules: [] });
    const s = await read();
    assert.deepEqual(s.relayModules, [], "빈 배열을 못 보내면 모듈 삭제가 안 된다");
    assert.equal(s.sensorModules?.length, 1, "삭제가 남의 키까지 지우면 안 된다");
  });

  test("연속 저장에도 누적된다 (화면을 옮겨 다녀도 안전)", async () => {
    await save({ display: { enabled: false } });
    await save({ sensorModules: [{ id: "s1", unitId: 1 }, { id: "s2", unitId: 3 }] });
    await save({ relayModules: [{ id: "r1", unitId: 2 }] });
    const s = await read();
    assert.equal(s.display?.enabled, false);
    assert.equal(s.sensorModules?.length, 2);
    assert.equal(s.relayModules?.length, 1);
  });

  test("settings 밖의 형제 키(rpiSync)는 건드리지 않는다", async () => {
    await save({ display: { enabled: true } });
    const { rows } = await pool.query("SELECT settings->'rpiSync' AS r FROM system_settings WHERE farm_id = $1", [FARM]);
    assert.equal(rows[0].r?.configVersion, 1, "형제 키가 사라졌다");
  });

  test("남의 농장 키로는 저장할 수 없다", async () => {
    const res = await request(app)
      .put(`/api/config/system-settings/${FARM}`)
      .set("x-api-key", "wrong-key-not-a-farm")
      .send({ settings: { relayModules: [] } });
    assert.ok(res.status === 401 || res.status === 403, `키가 틀렸는데 ${res.status}`);
    const s = await read();
    assert.equal(s.relayModules?.length, 1, "인증 실패인데 값이 바뀌었다");
  });
});

describe("전제 — jsonb || 는 얕은 병합이다", () => {
  test("얕은 병합만 하면 모듈이 사라진다 (사고 재현)", async () => {
    await pool.query(
      `UPDATE system_settings SET settings = settings || $2 WHERE farm_id = $1`,
      [FARM, JSON.stringify({ settings: { display: { enabled: false } } })]
    );
    const s = await read();
    assert.equal(s.relayModules, undefined, "이 테스트가 실패하면 Postgres 동작이 바뀐 것 — 위 검사들의 전제가 무너진다");
  });
});
