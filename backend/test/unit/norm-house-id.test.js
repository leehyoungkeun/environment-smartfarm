// normHouseId — houseId 표기 정규화의 단일 출처 (device-positions.routes.js).
//
// 근거: 프론트가 MQTT 토픽·로컬 제어에 레거시 'house1' 을 쓰는 바람에 복합키 전환(8/25) 때
// 같은 장치가 두 키로 분열됐다 (feedback_house_id_notation). backend 는 이 함수로,
// NR 은 2026-08-29 에디터 수정으로 같은 규칙을 갖는다 — 규칙이 어긋나면 분열이 재발한다.
// NR 쪽 규칙은 test/nr/parse-control.test.js 가 잠근다. 여기는 backend 쪽.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normHouseId } from "../../src/routes/device-positions.routes.js";

describe("normHouseId — NR 정규화와 같은 규칙이어야 한다", () => {
  const cases = [
    ["house1", "house_0001"],        // 프론트 레거시 (실전 최다)
    ["house_1", "house_0001"],
    ["house_01", "house_0001"],
    ["house_0001", "house_0001"],    // 정규형 통과
    ["house12", "house_0012"],
    ["house_0012", "house_0012"],
    ["greenhouse_a", "greenhouse_a"], // 비표준 이름은 건드리지 않는다
    [undefined, "house_0001"],        // 하위 호환 기본값
    [null, "house_0001"],
  ];
  for (const [input, expected] of cases) {
    test(`${String(input)} → ${expected}`, () => {
      assert.equal(normHouseId(input), expected);
    });
  }

  test("숫자 뒤에 문자가 붙으면 정규화하지 않는다 (오탐 방지)", () => {
    assert.equal(normHouseId("house1a"), "house1a");
  });
});
