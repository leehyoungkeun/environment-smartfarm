// 「houseConfig 갱신」(hcs_handler) 교체본 — 클라우드 설정을 SQLite house_configs 로 미러 (2026-09-04).
// 결함: 클라우드 config/update 가 전역만 갱신 → REST(키오스크)·부팅 복원이 읽는 SQLite 가 stale.
// 교체본은 docs/nodered-config-mirror/hcs_handler.js — 에디터 적용·마스터 동기화 후 same() 잠금 추가.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeClock, makeEnv } from "./harness.js";

const here = dirname(fileURLToPath(import.meta.url));
const FILE = join(here, "..", "..", "..", "docs", "nodered-config-mirror", "hcs_handler.js");

const CLOUD = { success: true, data: [
  { houseId: "house_0001", houseName: "1번 하우스", enabled: true, configVersion: 66, createdAt: "2026-03-01T00:00:00.000Z",
    sensors: [{ sensorId: "temp_0001" }], devices: [{ deviceId: "fan1" }, { deviceId: "ks_test_sw1", modbus: { protocol: "ks3267", unit: 1, kind: "switch", n: 1 } }], collection: { intervalSeconds: 60 } },
  { houseId: "house_0002", houseName: "2번 하우스", enabled: true, configVersion: 69,
    sensors: [{ sensorId: "temp_0001", ks3267: { unit: 2, index: 1 } }], devices: [{ deviceId: "heater1" }] },
] };
const run = (payload, statusCode = 200, globals = {}) => {
  const e = makeEnv({ clock: makeClock(), globals });
  const out = e.runFile(FILE, { payload, statusCode, _farmId: "farm_0001", _eventType: "house_changed" });
  return { e, out };
};

describe("hcs_handler 교체본 — 전역 갱신 + SQLite 미러", () => {
  test("출력 1 은 없음(기존과 동일), 출력 2 에 하우스별 UPSERT + DELETE 1건", () => {
    const { e, out } = run(CLOUD);
    assert.equal(out[0], null);
    const m = out[1]; assert.equal(m.length, 3, "UPSERT 2 + DELETE 1");
    assert.deepEqual(m.map((x) => x._mirror), ["upsert", "upsert", "delete"]);
    const hc = e.global.get("houseConfig");
    assert.equal(hc.houses.length, 2); assert.equal(hc.configVersion, 69);
    assert.equal(hc.houses[0].houseName, "1번 하우스", "부팅/REST 파생 형식(houseName)도 채운다");
  });

  test("UPSERT: 컬럼 순서·JSON 직렬화·버전은 클라우드 그대로(+1 금지)·created_at 보존", () => {
    const { out } = run(CLOUD);
    const u = out[1][1]; // house_0002
    assert.match(u.topic, /^INSERT INTO house_configs \(id, farm_id, house_id, house_name, sensors, collection, devices, crops, crop_type, crop_variety, planting_date, device_count, enabled, config_version, created_at, updated_at\)/);
    assert.match(u.topic, /ON CONFLICT\(farm_id, house_id\) DO UPDATE SET/);
    assert.match(u.topic, /config_version = excluded\.config_version/, "미러는 클라우드 버전 그대로");
    assert.ok(!/config_version = house_configs\.config_version \+ 1/.test(u.topic), "REST 경로의 +1 이 섞였다");
    assert.ok(!/created_at = excluded/.test(u.topic), "충돌 시 created_at 을 덮으면 안 된다");
    const p = u.payload; assert.equal(p.length, 16);
    assert.equal(p[1], "farm_0001"); assert.equal(p[2], "house_0002"); assert.equal(p[3], "2번 하우스");
    assert.deepEqual(JSON.parse(p[4]), [{ sensorId: "temp_0001", ks3267: { unit: 2, index: 1 } }], "표준 센서 매핑이 SQLite 에 그대로");
    assert.equal(JSON.parse(p[6])[0].deviceId, "heater1");
    assert.equal(p[11], 1, "device_count = devices.length"); assert.equal(p[12], 1, "enabled → 1");
    assert.equal(p[13], 69, "config_version = 클라우드 69");
    assert.equal(out[1][0].payload[14], "2026-03-01T00:00:00.000Z", "createdAt 있으면 그대로");
    assert.equal(u.payload[14], "2026-08-29T10:00:00.000Z", "없으면 now(고정 시계)");
  });

  test("DELETE: 클라우드 하우스 전부 바인딩(NOT IN $2..), SQL 에 id 문자열 조립 없음", () => {
    const { out } = run(CLOUD);
    const d = out[1][2];
    assert.equal(d.topic, "DELETE FROM house_configs WHERE farm_id = $1 AND house_id NOT IN ($2,$3)");
    assert.deepEqual(Array.from(d.payload), ["farm_0001", "house_0001", "house_0002"]); // vm realm 배열 → 같은 realm 으로
    assert.ok(!d.topic.includes("house_000"), "하우스 id 가 SQL 문자열에 박혔다 (인젝션 경로)");
    assert.equal(d._farmId, "farm_0001");
  });

  test("빈 응답 → 전역도 미러도 건드리지 않는다 (SQLite 전멸 방지, 변이 프로브)", () => {
    const prev = { farmId: "farm_0001", houses: [{ houseId: "house_0001" }] };
    for (const payload of [{ success: true, data: [] }, { success: false, data: [{ houseId: "x" }] }, "not json{"]) {
      const { e, out } = run(payload, 200, { houseConfig: prev });
      assert.equal(out, null, "빈/실패 응답에서 무엇을 내보냈다: " + JSON.stringify(payload));
      assert.deepEqual(e.global.get("houseConfig"), prev);
    }
  });

  test("비200 → 아무것도 안 함", () => {
    const { e, out } = run(CLOUD, 502, { houseConfig: { houses: [] } });
    assert.equal(out, null); assert.deepEqual(e.global.get("houseConfig"), { houses: [] });
  });

  test("문자열 payload(JSON) 도 파싱해 처리", () => {
    const { out } = run(JSON.stringify(CLOUD));
    assert.equal(out[1].length, 3);
  });
});

// ── 에디터 적용 후 (2026-09-04 Deploy → 마스터 동기화) — flows.json 노드로 재잠금 ──
import { readFileSync } from "node:fs";
import { functionBody, readFlows } from "./harness.js";

describe("마스터 flows.json — hcs_handler 적용 상태 잠금", () => {
  test("hcs_handler == docs/nodered-config-mirror/hcs_handler.js", () => {
    assert.equal(functionBody("hcs_handler").func.replace(/\r\n/g, "\n").trim(), readFileSync(FILE, "utf8").replace(/\r\n/g, "\n").trim());
  });
  test("출력 2 → 「SQLite 미러 (house_configs)」 sqlite 노드(smartfarm.db) 로 배선", () => {
    const flows = readFlows();
    const h = flows.find((n) => n.id === "hcs_handler");
    const m = flows.find((n) => n.id === "hcs_sqlite_mirror");
    assert.equal(h.outputs, 2, "출력이 2개여야 미러가 나간다");
    assert.ok(m && m.type === "sqlite" && m.mydb === "sqlite_db", "미러 sqlite 노드가 없거나 다른 DB 를 가리킨다");
    assert.ok(h.wires[1]?.includes("hcs_sqlite_mirror"), "2번 출력이 미러 노드로 배선되지 않았다");
    assert.equal(m.z, h.z, "같은 탭(모듈 동기화)에 있어야 한다");
  });
});
