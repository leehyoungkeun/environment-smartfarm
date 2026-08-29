// 제어 명령 파싱 (parse_control_command) — rpi-files/master/flows.json 의 실제 코드.
//
// 웹/앱에서 누른 모든 제어가 AWS IoT → 이 노드를 지난다. 근거가 된 실제 사고:
//   - link in/out fan-out 이 serial 버스에서 race → "첫 ON 안 됨" (5/24 통합으로 해결)
//   - schedule-off 가 function 2 에 분산돼 있던 시절의 이중 처리
//   - Eletechsup 제거 후에도 FC6 잔재가 남는 문제 (Waveshare 는 FC15 통일)

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makeClock, makeEnv, port } from "./harness.js";

const NODE = "parse_control_command";
const HOUSE = "house_0001";
const MODBUS_SINGLE = { unitId: 2, address: 0, controlType: "single", moduleType: "waveshare" };
const MODBUS_BIDIR = { unitId: 2, address: 2, address2: 3, controlType: "bidir", moduleType: "waveshare" };

function env5(globals = {}) {
  return makeEnv({ clock: makeClock(), globals });
}
const topic5 = (dev) => `smartfarm/farm_0001/${HOUSE}/${dev}/control`;

describe("토픽 파싱 — 4-seg / 5-seg 호환", () => {
  test("5-seg: farmId·houseId·deviceId 를 토픽에서 뽑는다", () => {
    const e = env5();
    const out = e.run(NODE, { topic: topic5("window1"), payload: { command: "OPEN", operator: "web", request_id: "r1" } });
    assert.equal(out.control.farmId, "farm_0001");
    assert.equal(out.control.houseId, HOUSE);
    assert.equal(out.control.deviceId, "window1");
    assert.equal(out.control.command, "open", "명령은 소문자로 정규화돼야 한다");
    assert.equal(out.control.requestId, "r1");
    assert.equal(out.control.deviceType, "window");
  });

  test("옛 4-seg: farmId 는 payload.farm_id 에서", () => {
    const e = env5();
    const out = e.run(NODE, { topic: `smartfarm/${HOUSE}/fan1/control`, payload: { command: "on", farm_id: "farm_0002" } });
    assert.equal(out.control.farmId, "farm_0002");
    assert.equal(out.control.houseId, HOUSE);
    assert.equal(out.control.deviceType, "fan");
  });

  test("★ 레거시 'house1' 토픽 → 'house_0001' 정규화 (2026-08-29 fix)", () => {
    // 프론트는 제어 시 의도적으로 house_0001 → house1 변환해 보낸다.
    // 정규화가 없으면 수동 제어와 자동화가 같은 장치를 다른 전역 키로 관리한다 (평행 세계 결함).
    const e = env5();
    const out = e.run(NODE, { topic: "smartfarm/farm_0001/house1/window1/control", payload: { command: "open" } });
    assert.equal(out.control.houseId, "house_0001", "정규화 누락 — 자동화가 수동 조작을 영원히 못 본다");
  });

  test("정규형·비표준 표기는 그대로 통과한다", () => {
    const e = env5();
    assert.equal(e.run(NODE, { topic: topic5("fan1"), payload: { command: "on" } }).control.houseId, "house_0001");
    assert.equal(e.run(NODE, { topic: "smartfarm/farm_0001/greenhouse_a/fan1/control", payload: { command: "on" } }).control.houseId, "greenhouse_a");
  });

  test("deviceType 추론: heater/valve", () => {
    const e = env5();
    assert.equal(e.run(NODE, { topic: topic5("heater1"), payload: { command: "on" } }).control.deviceType, "heater");
    assert.equal(e.run(NODE, { topic: topic5("valve2"), payload: { command: "off" } }).control.deviceType, "valve");
  });
});

describe("schedule-off — 예약 OFF (외출 전 '30분 뒤 꺼줘')", () => {
  test("등록: 타이머 생성 + scheduledOff 기록, 즉시 출력은 없다", () => {
    const e = env5();
    const out = e.run(NODE, {
      topic: topic5("fan1"),
      payload: { command: "schedule-off", delay_sec: 1800, modbus: MODBUS_SINGLE, operator: "web" },
    });
    assert.equal(out, null, "예약인데 제어가 즉시 나갔다");
    assert.equal(e.clock.pending().length, 1);
    const sched = e.global.get("scheduledOff");
    assert.ok(sched[`${HOUSE}/fan1`]);
    assert.equal(sched[`${HOUSE}/fan1`].scheduledBy, "web");
  });

  test("만료: single 은 FC15 quantity 1 [false] 로 OFF", () => {
    const e = env5();
    e.run(NODE, { topic: topic5("fan1"), payload: { command: "schedule-off", delay_sec: 600, modbus: MODBUS_SINGLE } });
    e.clock.advance(600 * 1000 + 1);
    const fired = port(e.sent, 0);
    assert.equal(fired.length, 1, "예약이 만료됐는데 OFF 가 안 나갔다 — 팬이 밤새 돈다");
    assert.equal(fired[0].payload.fc, 15, "FC15 통일 원칙 (FC5 금지)");
    assert.equal(fired[0].payload.quantity, 1);
    assert.equal(JSON.stringify(fired[0].payload.value), "[false]");
    assert.equal(fired[0].control.operator, "schedule_off_timer");
    assert.equal(e.global.get("deviceStates")[`${HOUSE}:fan1`], "off");
    assert.equal(e.global.get("scheduledOff")[`${HOUSE}/fan1`], undefined, "만료 후 예약이 정리되지 않았다");
  });

  test("만료: bidir 는 양쪽 코일 [false,false] + 위치 0", () => {
    const e = env5();
    e.run(NODE, { topic: topic5("window1"), payload: { command: "schedule-off", delay_sec: 600, modbus: MODBUS_BIDIR } });
    e.clock.advance(600 * 1000 + 1);
    const fired = port(e.sent, 0);
    assert.equal(fired[0].payload.quantity, 2);
    assert.equal(JSON.stringify(fired[0].payload.value), "[false,false]");
    assert.equal(e.global.get("deviceStates")[`${HOUSE}:window1`], "closed");
    assert.equal(e.global.get("devicePositions")[`${HOUSE}:window1`], 0);
  });

  test("취소: 타이머가 제거되고 만료돼도 아무것도 안 나간다", () => {
    const e = env5();
    e.run(NODE, { topic: topic5("fan1"), payload: { command: "schedule-off", delay_sec: 600, modbus: MODBUS_SINGLE } });
    e.run(NODE, { topic: topic5("fan1"), payload: { command: "schedule-off-cancel" } });
    assert.equal(e.clock.pending().length, 0, "취소했는데 타이머가 남았다 — 자다가 꺼진다");
    e.clock.advance(601 * 1000);
    assert.equal(port(e.sent, 0).length, 0);
    assert.equal(e.global.get("scheduledOff")[`${HOUSE}/fan1`], undefined);
  });

  test("재등록은 기존 타이머를 교체한다 (이중 OFF 방지)", () => {
    const e = env5();
    e.run(NODE, { topic: topic5("fan1"), payload: { command: "schedule-off", delay_sec: 600, modbus: MODBUS_SINGLE } });
    e.run(NODE, { topic: topic5("fan1"), payload: { command: "schedule-off", delay_sec: 1200, modbus: MODBUS_SINGLE } });
    assert.equal(e.clock.pending().length, 1, "타이머가 2개 — 옛 예약이 먼저 꺼 버린다");
    e.clock.advance(601 * 1000);
    assert.equal(port(e.sent, 0).length, 0, "교체 전 타이머가 살아서 일찍 껐다");
    e.clock.advance(600 * 1000);
    assert.equal(port(e.sent, 0).length, 1);
  });

  test("delay_sec 범위 밖(0, >86400)은 무시", () => {
    const e = env5();
    for (const d of [0, -5, 86401, "abc"]) {
      e.run(NODE, { topic: topic5("fan1"), payload: { command: "schedule-off", delay_sec: d, modbus: MODBUS_SINGLE } });
    }
    assert.equal(e.clock.pending().length, 0);
  });

  test("modbus 가 payload 에 없으면 캐시에서 찾는다", () => {
    const e = env5({ [`modbus_cfg_${HOUSE}:fan1`]: MODBUS_SINGLE });
    e.run(NODE, { topic: topic5("fan1"), payload: { command: "schedule-off", delay_sec: 600 } });
    assert.equal(e.clock.pending().length, 1, "캐시된 설정으로 예약이 돼야 한다");
  });

  test("modbus 를 어디서도 못 찾으면 예약하지 않는다 (엉뚱한 코일 방지)", () => {
    const e = env5();
    const out = e.run(NODE, { topic: topic5("ghost1"), payload: { command: "schedule-off", delay_sec: 600 } });
    assert.equal(out, null);
    assert.equal(e.clock.pending().length, 0);
    assert.ok(e.warns.some((w) => w.includes("modbus 설정 없음")));
  });
});
