// 로컬 제어 실행 (control_handler) — 키오스크 오프라인 제어 경로 (B1).
//
// 인터넷이 끊겨도 농장주는 키오스크로 제어할 수 있어야 한다 (사용자 요구).
// 이 노드는 POST /api/control/local 의 첫 관문 — 검증이 약하면 로컬 네트워크의
// 아무 요청이나 릴레이를 움직인다.
//
// 출력: [HTTP 응답, 제어 메시지(→ link_gpio_control), SQLite 로그]

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makeClock, makeEnv } from "./harness.js";

const NODE = "control_handler";

function run(body) {
  const e = makeEnv({ clock: makeClock() });
  const out = e.run(NODE, { payload: body });
  return { e, out };
}

describe("입력 검증 — 로컬이라도 아무 요청이나 받지 않는다", () => {
  test("device_id 없음 → 400", () => {
    const { out } = run({ command: "on" });
    assert.equal(out[0].statusCode, 400);
    assert.equal(out[1], null, "검증 실패인데 제어 메시지가 나갔다");
  });

  test("command 없음 → 400", () => {
    const { out } = run({ device_id: "fan1" });
    assert.equal(out[0].statusCode, 400);
  });

  test("허용 목록 밖 명령 거부 (reboot, schedule-off 등)", () => {
    for (const cmd of ["reboot", "schedule-off", "ON; DROP TABLE", "toggle"]) {
      const { out } = run({ device_id: "fan1", command: cmd });
      assert.equal(out[0].statusCode, 400, `'${cmd}' 가 통과했다`);
      assert.equal(out[1], null);
    }
  });

  test("device_id 형식 검증 — 영숫자·언더스코어만", () => {
    for (const id of ["fan-1", "fan 1", "fan';--", "장치1"]) {
      const { out } = run({ device_id: id, command: "on" });
      assert.equal(out[0].statusCode, 400, `'${id}' 가 통과했다`);
    }
  });
});

describe("정상 제어", () => {
  test("3갈래 출력: HTTP 200 + 제어 메시지 + SQLite 로그", () => {
    const { out } = run({ house_id: "house_0001", device_id: "fan1", command: "on", operator: "kiosk", duration: 60 });
    // HTTP 응답
    assert.equal(out[0].payload.success, true);
    assert.equal(out[0].payload.data.device_id, "fan1");
    assert.equal(out[0].payload.data.mode, "local");
    // 제어 메시지
    const c = out[1].control;
    assert.equal(c.houseId, "house_0001");
    assert.equal(c.deviceId, "fan1");
    assert.equal(c.command, "on");
    assert.equal(c.operator, "kiosk");
    assert.equal(c.duration, 60);
    assert.equal(out[1]._requestId, c.requestId, "Modbus 완료 확인용 requestId 가 전달돼야 한다");
    assert.match(c.requestId, /^local_/);
    // SQLite 로그 (parameterized — 문자열 조립 아님)
    assert.match(out[2].topic, /INSERT INTO control_logs/);
    assert.ok(Array.isArray(out[2].payload) && out[2].payload.includes("fan1"), "로그가 파라미터 바인딩이 아니다");
    assert.equal(out[2].payload[3], "local");
  });

  test("modbus 설정이 제어 메시지에 실린다 (동적 매핑)", () => {
    const mb = { unitId: 2, address: 0, controlType: "single" };
    const { out } = run({ device_id: "fan1", command: "on", modbus: mb });
    assert.deepEqual(out[1].control.modbus, mb);
  });

  test("deviceType 은 device_id 에서 숫자를 뗀 것", () => {
    const { out } = run({ device_id: "window12", command: "open" });
    assert.equal(out[1].control.deviceType, "window");
  });

  // ★ 발견 (2026-08-29): house_id 미지정 시 기본값이 레거시 'house1' 이다.
  // houseId 정규형은 'house_0001' (feedback_house_id_notation) — 'house1' 로 가면
  // execute_control 의 복합키 캐시(house_0001:fan1)와 어긋나 같은 장치가 두 키로 분열된다
  // (8/25 복합키 전환 때 실제로 겪은 그 사고 패턴). 2026-08-29 에디터 수정 완료 — 이 테스트가 회귀를 막는다.
  test("★ 레거시 'house1' 명시 전송도 'house_0001' 로 정규화 (실전 경로)", () => {
    // 키오스크/프론트는 실제로 항상 'house1' 을 보낸다 — 이것이 실전 케이스다.
    const { out } = run({ house_id: "house1", device_id: "fan1", command: "on" });
    assert.equal(out[1].control.houseId, "house_0001");
  });

  test("house_id 없으면 house_0001 로 정규화된다", () => {
    const { out } = run({ device_id: "fan1", command: "on" });
    assert.equal(out[1].control.houseId, "house_0001",
      "레거시 'house1' 기본값 — deviceStates/modbus 캐시가 house_0001 계열과 분열된다");
  });
});
