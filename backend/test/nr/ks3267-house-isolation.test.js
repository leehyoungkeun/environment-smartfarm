// 하우스 격리 — 매핑 없는 센서가 다른 하우스의 벤더 값을 실측으로 받지 않는다 (2026-09-19 사고) — 에디터 적용·마스터 동기화 완료 2026-09-19 21:06 (ks3267.test.js same() 이 마스터와 잠근다).
//
// 사고: house_0003 의 humidity_0001 (표준·벤더 어느 쪽에도 매핑 없음) 이 house_0001 XY-MD02 습도 53.7 을 실측으로 저장.
//   원인 ① 「Modbus 센서 읽기 준비」가 매핑 없는 humid*/temp* 센서를 어느 하우스든 등록된 XY-MD02 모듈에 자동매핑
//        ② 「Modbus 센서 결과 파싱」이 값을 sensorId 만으로 저장 (하우스 구분 없음)
//        ③ 「③ 센서 데이터 수집」이 sensorId 만으로 찾고, 원시 레지스터(realData) 폴백도 하우스 무관
// 검증 대상은 docs/ksx3267/nodered/*.js (적용본) — ks3267.test.js same() 이 마스터 flows.json 과 같음을 잠근다.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeClock, makeEnv } from "./harness.js";

const here = dirname(fileURLToPath(import.meta.url));
const P = (n) => join(here, "..", "..", "..", "docs", "ksx3267", "nodered", n);
const XY = { unitId: 1, fc: 4, address: 0, quantity: 2, divider: 10, signed: true };
const MODULES = [{ id: "sensor_mod_1", name: "온습도", sensorType: "temperature_humidity", unitId: 1, fc: 4, address: 0, quantity: 2, divider: 10, signed: true }];

// 사고 당시 구성: house_0001 은 XY-MD02 매핑, house_0003 은 온도=표준 U2#1, 습도=매핑 없음
const cfg = () => ({ farmId: "farm_0001", houses: [
  { houseId: "house_0001", enabled: true, sensors: [
    { sensorId: "temp_0001", enabled: true, type: "number", modbus: { ...XY, registerIndex: 1 } },
    { sensorId: "humidity_0001", enabled: true, type: "number", modbus: { ...XY, registerIndex: 0 } } ] },
  { houseId: "house_0003", enabled: true, sensors: [
    { sensorId: "temp_0001", enabled: true, type: "number", ks3267: { unit: 2, index: 1 } },
    { sensorId: "humidity_0001", enabled: true, type: "number" } ] },
] });
// vm 안에서 만든 객체는 프로토타입이 달라 deepEqual 이 실패한다 — JSON 으로 옮겨 비교
const byHouse = (out) => JSON.parse(JSON.stringify(Object.fromEntries((out[0] || []).map((m) => [m.payload.houseId, m.payload.data]))));
const KS = { ks3267Readings: { values: { "house_0003:temp_0001": 19.4 }, t: Date.parse("2026-08-29T09:59:30Z"), unit: 2 } };

describe("① Modbus 센서 읽기 준비 (적용본) — 다중 하우스는 새 자동매핑 안 함", () => {
  test("house_0003 humidity_0001 에 XY-MD02 를 붙이지 않는다 — 읽기 목록에 house_0001 두 센서만", () => {
    const c = cfg();
    const e = makeEnv({ clock: makeClock(), globals: { sensorModules: MODULES, houseConfig: c } });
    e.runFile(P("modbus_sensor_prep.js"), { config: c });
    assert.equal(c.houses[1].sensors[1].modbus, undefined, "매핑 없는 센서에 벤더 모듈이 자동으로 붙었다 (사고 원인 ①)");
    const map = e.flow.get("modbusSensorMap");
    const all = Object.values(map).flat().map((s) => s.houseId + ":" + s.sensorId).sort();
    assert.deepEqual(all, ["house_0001:humidity_0001", "house_0001:temp_0001"]);
    assert.ok(e.statuses.at(-1).text.includes("미매핑 1"));
  });

  test("하우스가 하나면 예전처럼 자동매핑한다 (레거시 단일 하우스 농장)", () => {
    const c = { farmId: "farm_x", houses: [{ houseId: "house_0001", enabled: true, sensors: [{ sensorId: "humidity_0001", enabled: true }] }] };
    const e = makeEnv({ clock: makeClock(), globals: { sensorModules: MODULES } });
    e.runFile(P("modbus_sensor_prep.js"), { config: c });
    assert.equal(c.houses[0].sensors[0].modbus.unitId, 1);
    assert.equal(c.houses[0].sensors[0].modbus.registerIndex, 0);
  });

  test("다중 하우스라도 이미 벤더에 매핑된 센서의 stale 보정은 그대로", () => {
    const c = cfg(); c.houses[0].sensors[0].modbus = { ...XY, unitId: 9, registerIndex: 1 };   // 모듈 주소가 바뀐 옛 매핑
    const e = makeEnv({ clock: makeClock(), globals: { sensorModules: MODULES } });
    e.runFile(P("modbus_sensor_prep.js"), { config: c });
    assert.equal(c.houses[0].sensors[0].modbus.unitId, 1);
  });
});

describe("② Modbus 센서 결과 파싱 (적용본) — 하우스 복합키", () => {
  test("같은 읽기를 두 하우스가 공유하면 각 하우스 키로 저장, 레거시 키도 호환으로 남긴다", () => {
    const sensors = [
      { houseId: "house_0001", sensorId: "humidity_0001", registerIndex: 0, divider: 10 },
      { houseId: "house_0004", sensorId: "hum_b", registerIndex: 0, divider: 10 } ];
    const e = makeEnv({ clock: makeClock(), flowVars: {
      modbusUniqueReads: [{ key: "1:4:0:2", unitId: 1, fc: 4, address: 0, quantity: 2 }],
      modbusSensorMap: { "1:4:0:2": sensors }, modbusReadIndex: 0, modbusReadings: {} } });
    const out = e.runFile(P("fn_modbus_parse.js"), { payload: [537, 291] });
    const r = out[1].modbusReadings;
    assert.equal(r["house_0001:humidity_0001"], 53.7);
    assert.equal(r["house_0004:hum_b"], 53.7);
    assert.equal(r.humidity_0001, 53.7);
  });
});

describe("③ 센서 데이터 수집 (적용본) — 벤더 값은 그 센서가 벤더에 매핑됐을 때만", () => {
  test("prep 흐름: house_0003 매핑 없는 습도는 생략, house_0001 은 벤더 값, house_0003 온도는 표준 값 — 사고 형태", () => {
    const c = cfg();
    const e = makeEnv({ clock: makeClock(), globals: { houseConfig: c, ...KS } });
    const out = e.runFile(P("fn_collect_sensors.js"), { config: c, payload: [537, 291],
      modbusReadings: { "house_0001:temp_0001": 29.1, "house_0001:humidity_0001": 53.7, temp_0001: 29.1, humidity_0001: 53.7 } });
    const h = byHouse(out);
    assert.deepEqual(h.house_0003, { temp_0001: 19.4 }, "house_0003 가 house_0001 의 습도를 받았다 (사고 재현)");
    assert.deepEqual(h.house_0001, { temp_0001: 29.1, humidity_0001: 53.7 });
  });

  test("원시 레지스터 폴백(prep 없음)도 매핑된 센서에만", () => {
    const c = cfg();
    const e = makeEnv({ clock: makeClock(), globals: { houseConfig: c, ...KS } });
    const h = byHouse(e.runFile(P("fn_collect_sensors.js"), { config: c, payload: [615, 231] }));
    assert.equal(h.house_0001.humidity_0001, 61.5);
    assert.equal(h.house_0003.humidity_0001, undefined);
  });

  test("prep 흐름에서 매핑된 센서 읽기가 실패하면 마지막 원시 레지스터로 메우지 않는다", () => {
    const c = cfg();
    const e = makeEnv({ clock: makeClock(), globals: { houseConfig: c, ...KS } });
    const h = byHouse(e.runFile(P("fn_collect_sensors.js"), { config: c, payload: [615, 231], modbusReadings: {} }));
    assert.equal(h.house_0001, undefined, "읽기 실패한 벤더 센서가 다른 모듈의 원시값으로 채워졌다");
  });

  test("버스 장애 판정도 같은 규칙 — 매핑된 두 센서가 다 실패하면 센다", () => {
    const c = cfg();
    const e = makeEnv({ clock: makeClock(), globals: { houseConfig: c, ...KS }, flowVars: { busFailCount: 1 } });
    const out = e.runFile(P("fn_collect_sensors.js"), { config: c, payload: null, modbusReadings: {} });
    assert.equal(e.flow.get("busFailCount"), 2);
    assert.ok(out[1], "2사이클 연속 버스 장애 알림");
  });

  test("레거시 키만 온 벤더 값도 매핑된 센서에는 쓴다 (파싱을 먼저 안 바꿨을 때 호환)", () => {
    const c = cfg();
    const e = makeEnv({ clock: makeClock(), globals: { houseConfig: c, ...KS } });
    const h = byHouse(e.runFile(P("fn_collect_sensors.js"), { config: c, payload: null, modbusReadings: { temp_0001: 29.1, humidity_0001: 53.7 } }));
    assert.equal(h.house_0001.humidity_0001, 53.7);
    assert.equal(h.house_0003.humidity_0001, undefined);
  });
});
