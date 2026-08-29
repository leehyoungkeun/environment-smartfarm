// 제어 실행 (execute_control) — Modbus write 를 실제로 조립하는 마지막 노드.
//
// 근거가 된 실제 사고:
//   - unitId 하드코딩 → UI↔HW 매칭 실패 시 모두 OFF stale (동적 msg 사용 원칙)
//   - FC5 혼용 → Modbus Flex Write FC15 통일 (6/3 근본 단순화에서 Eletechsup FC6 도 제거)
//   - write 직후 상태 read 가 같은 RS-485 버스에서 충돌 → _modbusLastWriteAt SW mutex (6/3 검증)
//   - 다중 하우스 복합키 (house_0001:fan1) — 하우스마다 같은 이름 장치 존재

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makeClock, makeEnv, port } from "./harness.js";

const NODE = "execute_control";
const HOUSE = "house_0001";
const KEY = (d) => `${HOUSE}:${d}`;
const SINGLE = { unitId: 2, address: 0, controlType: "single" };
const BIDIR = { unitId: 2, address: 2, address2: 3, controlType: "bidir", openDuration: 30, closeDuration: 30 };

function run(control, { globals = {}, payload = {} } = {}) {
  const e = makeEnv({ clock: makeClock(), globals: { FARM_ID: "farm_0001", ...globals } });
  const out = e.run(NODE, { control: { houseId: HOUSE, ...control }, payload, _requestId: control.requestId || null });
  return { e, out };
}

describe("Waveshare FC15 조립", () => {
  test("single on → fc15 quantity1 [true]", () => {
    const { out } = run({ deviceId: "fan1", command: "on", modbus: SINGLE });
    assert.equal(out[0].payload.fc, 15, "FC15 통일 원칙 위반");
    assert.equal(out[0].payload.quantity, 1);
    assert.equal(JSON.stringify(out[0].payload.value), "[true]");
    assert.equal(out[0].payload.unitid, 2);
  });

  test("single off → [false]", () => {
    const { out } = run({ deviceId: "fan1", command: "off", modbus: SINGLE });
    assert.equal(JSON.stringify(out[0].payload.value), "[false]");
  });

  test("bidir open → [true,false] (열림 코일만)", () => {
    const { out } = run({ deviceId: "window1", command: "open", modbus: BIDIR });
    assert.equal(out[0].payload.quantity, 2);
    assert.equal(JSON.stringify(out[0].payload.value), "[true,false]");
  });

  test("bidir close → [false,true] / stop → [false,false]", () => {
    assert.equal(JSON.stringify(run({ deviceId: "window1", command: "close", modbus: BIDIR }).out[0].payload.value), "[false,true]");
    assert.equal(JSON.stringify(run({ deviceId: "window1", command: "stop", modbus: BIDIR }).out[0].payload.value), "[false,false]");
  });

  test("★ unitId 는 modbus 설정에서 (unitId 7 → unitid 7, 하드코딩 금지)", () => {
    const { out } = run({ deviceId: "fan1", command: "on", modbus: { ...SINGLE, unitId: 7 } });
    assert.equal(out[0].payload.unitid, 7, "unitId 하드코딩 — UI↔HW 매칭 실패 시 전체 OFF stale 사고");
  });

  test("unitId 미설정 → Waveshare 기본 2 + 경고", () => {
    const { e, out } = run({ deviceId: "fan1", command: "on", modbus: { address: 0, controlType: "single" } });
    assert.equal(out[0].payload.unitid, 2);
    assert.ok(e.warns.some((w) => w.includes("unitId 미설정")));
  });

  test("modbus 설정이 어디에도 없으면 write 하지 않는다", () => {
    const { out } = run({ deviceId: "ghost1", command: "on" });
    assert.equal(out, null, "설정 없는 장치에 write — 엉뚱한 코일이 움직인다");
  });
});

describe("RS-485 write-read race 방지 (SW mutex)", () => {
  test("write 직전 _modbusLastWriteAt 갱신 (6/3 검증 패턴)", () => {
    const { e } = run({ deviceId: "fan1", command: "on", modbus: SINGLE });
    assert.ok(e.global.get("_modbusLastWriteAt"), "mutex 미갱신 — 직후 상태 read 가 write 와 충돌한다");
    assert.equal(e.global.get("_pendingModbus")?.isLastWrite, true);
  });

  test("자동 정지 write 도 mutex 를 갱신한다", () => {
    const { e } = run({ deviceId: "window1", command: "open", modbus: BIDIR, duration: 9 });
    e.global.set("_modbusLastWriteAt", 0); // 첫 write 의 기록을 지우고
    e.clock.advance(9 * 1000 + 1);
    assert.ok(e.global.get("_modbusLastWriteAt") > 0, "자동 정지 write 가 mutex 없이 나갔다");
  });
});

describe("복합키 modbus 캐시 (다중 하우스 8/25)", () => {
  test("설정이 오면 houseId:deviceId 키로 캐시한다", () => {
    const { e } = run({ deviceId: "fan1", command: "on", modbus: SINGLE });
    assert.deepEqual({ ...e.global.get(`modbus_cfg_${KEY("fan1")}`) }, SINGLE);
  });

  test("설정 없이 와도 캐시로 실행된다 (재시작 후 첫 제어)", () => {
    const { out } = run({ deviceId: "fan1", command: "on" }, { globals: { [`modbus_cfg_${KEY("fan1")}`]: SINGLE } });
    assert.equal(out[0].payload.fc, 15);
  });

  test("하우스가 다르면 다른 캐시 키 — house_0002:fan1 캐시로 house_0001 이 움직이면 안 된다", () => {
    const { out } = run({ deviceId: "fan1", command: "on" }, { globals: { ["modbus_cfg_house_0002:fan1"]: SINGLE } });
    assert.equal(out, null, "다른 하우스의 설정을 집어 왔다 — 엉뚱한 릴레이가 켜진다");
  });
});

describe("bidir 자동 정지와 위치 추적", () => {
  test("duration 지정 open → 만료 시 FC15 stop + 위치 부분 계산 (9초/30초 = 30%)", () => {
    const { e } = run({ deviceId: "window1", command: "open", modbus: BIDIR, duration: 9 });
    e.clock.advance(9 * 1000 + 1);
    const stops = port(e.sent, 0).filter((m) => Array.isArray(m.payload?.value) && m.payload.value.every((v) => v === false));
    assert.equal(stops.length, 1, "자동 정지가 안 나갔다 — 모터가 한계까지 stall");
    assert.equal(e.global.get("devicePositions")[KEY("window1")], 30, "부분 동작 위치 계산 오류");
    assert.equal(e.global.get("movements")[KEY("window1")], undefined, "movement 기록이 정리되지 않았다");
  });

  test("수동 stop 이 자동 정지 타이머를 취소한다", () => {
    const e = makeEnv({ clock: makeClock(), globals: { FARM_ID: "farm_0001" } });
    e.run(NODE, { control: { houseId: HOUSE, deviceId: "window1", command: "open", modbus: BIDIR, duration: 9 }, payload: {} });
    e.run(NODE, { control: { houseId: HOUSE, deviceId: "window1", command: "stop" }, payload: {} });
    assert.equal(e.clock.pending().filter((t) => !t.cleared).length, 0, "타이머가 남아 stop 후 또 stop 이 나간다");
  });

  test("이동 중 stop → 경과 시간으로 위치 계산 (15초/30초 = 50%)", () => {
    const e = makeEnv({ clock: makeClock(), globals: { FARM_ID: "farm_0001" } });
    e.run(NODE, { control: { houseId: HOUSE, deviceId: "window1", command: "open", modbus: BIDIR }, payload: {} });
    e.clock.advance(15 * 1000);
    e.run(NODE, { control: { houseId: HOUSE, deviceId: "window1", command: "stop" }, payload: {} });
    assert.equal(e.global.get("devicePositions")[KEY("window1")], 50, "중간 정지 위치가 틀리면 다음 제어의 남은 시간 계산이 다 틀린다");
    assert.equal(e.global.get("deviceStates")[KEY("window1")], "idle");
  });

  test("위치 보고 MQTT 는 farmId 토픽으로 (port 1)", () => {
    const { e } = run({ deviceId: "window1", command: "open", modbus: BIDIR });
    const reports = port(e.sent, 1);
    assert.ok(reports.length >= 1);
    assert.equal(reports[0].topic, "smartfarm/farm_0001/device/position");
    const p = JSON.parse(reports[0].payload);
    assert.equal(p.houseId, HOUSE, "위치 보고에 houseId 가 없으면 다중 하우스에서 분열된다");
    assert.equal(p.targetPosition, 100);
  });

  test("95% 이상은 100 으로 스냅 (한계 근사)", () => {
    const { e } = run(
      { deviceId: "window1", command: "open", modbus: BIDIR, duration: 29 },
      { globals: { devicePositions: { [KEY("window1")]: 0 } } }
    );
    e.clock.advance(29 * 1000 + 1);
    assert.equal(e.global.get("devicePositions")[KEY("window1")], 100, "97% 는 100 으로 스냅해야 다음 open 이 스킵된다");
  });
});
