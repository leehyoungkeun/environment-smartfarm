// 「설정한 대로 그대로」 — 시스템이 사람의 설정을 덮어쓰지 않는다 (2026-10-07).
//
// 사용자 요구: "내가 매핑한 대로 있어야 하고 CRUD 가 내가 설정한 대로 그대로 있어야 해."
//
// 덮어쓰던 곳이 둘이었다.
//   A) 백엔드 PUT system-settings — 농장 센서 모듈을 **모든 하우스**의 temp_*/humidity_* 에
//      센서 ID 이름만 보고 덮어썼다. 표준 매핑된 센서까지 덮어, house_0003 의 센서가
//      house_0001 의 XY-MD02 번지를 가리키게 됐다.
//   B) Node-RED 'stale 보정' — 센서 매핑이 등록 모듈과 다르면 말없이 모듈 값으로 되돌렸다.
//      화면에서 unit 3 으로 지정해도 다음 수집에 unit 1 로 돌아갔다.
//
// 남긴 것: **빈 매핑 채우기**(하우스가 하나인 농장만). 있는 값을 바꾸지 않으므로 규칙을 어기지 않고,
//          없애면 아직 매핑을 안 한 농장 24개 센서가 멈춘다.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, "..", "..", p), "utf8");

describe("백엔드 — 센서 매핑을 일괄로 덮어쓰지 않는다", () => {
  const src = read("src/routes/config.routes.js");

  test("sensorModules 저장이 houses.sensors 를 쓰지 않는다", () => {
    assert.ok(!/sensors: newSensors/.test(src), "하우스 센서를 통째로 갈아끼우는 코드가 남아 있다");
    assert.ok(!/const inferType = \(sensorId\)/.test(src), "센서 ID 이름으로 종류를 추측하는 코드가 남아 있다");
    assert.ok(!/modByType\[/.test(src), "모듈을 센서에 밀어 넣는 코드가 남아 있다");
  });

  test("왜 지웠는지가 코드에 남아 있다 (다시 넣지 않게)", () => {
    assert.match(src, /사람이 정한 센서 매핑을 시스템이 덮어쓰지 않는다/);
  });

  test("수집 주기 전파는 그대로 — 농장 단위 설정이라 맞다", () => {
    assert.match(src, /collectionConfig 저장 시 모든 하우스의 collection\.intervalSeconds 전파/);
  });
});

describe("Node-RED 교체본 — 있는 매핑은 건드리지 않는다", () => {
  const src = read("../docs/nodered-module-enabled/fn_modbus_sensor_prep.js");

  test("매핑이 있으면 세기만 하고 그대로 둔다", () => {
    assert.match(src, /if \(m && m\.unitId != null\) \{ driftCount\+\+; continue; \}/);
  });

  test("덮어쓰던 코드가 없다", () => {
    assert.ok(!/wasStale/.test(src), "stale 보정 흔적이 남아 있다");
    assert.ok(!/비어있거나 stale 매핑 → 자동매핑으로 덮어쓰기/.test(src));
  });

  test("빈 매핑 채우기는 하우스 1개 농장에서만 (남의 하우스 값을 읽는 사고 방지)", () => {
    assert.match(src, /allowNewAutoMap = enabledHouseCount <= 1/);
    assert.match(src, /if \(!allowNewAutoMap\) \{ autoSkipped\+\+; continue; \}/);
  });

  test("표준 센서는 벤더 매핑을 건드리지 않는다", () => {
    assert.match(src, /if \(sensor\.ks3267\) continue;/);
  });
});

describe("화면 — 매핑 없는 센서가 보인다", () => {
  test("「매핑 없음」 표시가 있다", () => {
    const src = read("../frontend/src/components/Settings/ConfigurationManager.jsx");
    assert.match(src, /⚠ 매핑 없음/);
  });
});
