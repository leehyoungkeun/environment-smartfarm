// 표준 센서 ↔ 벤더 센서 sensorId 충돌 (2026-09-04 사고) — pending 교체본 검증.
//
// 사고: house_0002 표준(ks3267) temp_0001 이 house_0001 벤더(XY-MD02) temp_0001 값으로 덮여 DB 에 저장됐다.
//   원인 ① ③ 이 ks 값을 바닥에 깔고 벤더 값을 Object.assign 으로 덮음 (키가 sensorId 만, 하우스 구분 없음)
//        ② 「Modbus 센서 읽기 준비」가 표준 센서에도 벤더 자동매핑(modbus 블록)을 붙여 벤더로 읽게 함
//        ③ fn_ks_status 가 값을 sensorId 만으로 저장 (복합키 없음)
// 검증 대상은 docs/ksx3267/nodered/*.js (에디터 적용·마스터 동기화 완료 2026-09-04 — ks3267.test.js 의 same() 이 마스터와 잠근다).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeClock, makeEnv } from "./harness.js";

const here = dirname(fileURLToPath(import.meta.url));
const P = (n) => join(here, "..", "..", "..", "docs", "ksx3267", "nodered", n);
const FRESH = Date.parse("2026-08-29T09:59:30Z"); // 시계 10:00:00 기준 30초 전 (TTL 3분 안)
const STALE = Date.parse("2026-08-29T09:50:00Z"); // 10분 전 (TTL 초과)

// 사고 당시 구성: 두 하우스가 같은 sensorId 'temp_0001' 을 쓰고, 2번은 표준 노드(U2 index1)
const CFG = { farmId: "farm_0001", houses: [
  { houseId: "house_0001", enabled: true, sensors: [
    { sensorId: "temp_0001", enabled: true, type: "number", modbus: { unitId: 1, fc: 4, address: 0, quantity: 2, registerIndex: 1, divider: 10, signed: true } },
    { sensorId: "humidity_0001", enabled: true, type: "number", modbus: { unitId: 1, fc: 4, address: 0, quantity: 2, registerIndex: 0, divider: 10 } } ] },
  { houseId: "house_0002", enabled: true, sensors: [
    // NR 자동매핑이 이미 붙여 둔 stale 벤더 블록까지 그대로 — 그래도 표준 값이어야 한다
    { sensorId: "temp_0001", enabled: true, type: "number", ks3267: { unit: 2, index: 1 },
      modbus: { unitId: 1, fc: 4, address: 0, quantity: 2, registerIndex: 1, divider: 10, signed: true } } ] },
] };
const byHouse = (out) => Object.fromEntries((out[0] || []).map((m) => [m.payload.houseId, m.payload]));

describe("③ fn_collect_sensors (pending) — 표준 센서는 표준 값만", () => {
  test("같은 sensorId 충돌: house_0002 는 28.8(표준), house_0001 은 23.1(벤더) — 사고 재현", () => {
    const e = makeEnv({ clock: makeClock(), globals: { houseConfig: CFG,
      ks3267Readings: { values: { "house_0002:temp_0001": 28.8, temp_0001: 28.8 }, t: FRESH, unit: 2 } } });
    const out = e.runFile(P("fn_collect_sensors.js"), { config: CFG, payload: [615, 231] }); // XY-MD02 raw: 습도 61.5 / 온도 23.1
    const h = byHouse(out);
    assert.equal(h.house_0002.data.temp_0001, 28.8, "표준 센서가 벤더 값으로 덮였다 (사고 재현)");
    assert.equal(h.house_0001.data.temp_0001, 23.1, "벤더 센서는 벤더 값 그대로");
    assert.equal(h.house_0001.data.humidity_0001, 61.5);
    assert.equal(h.house_0002.quality, "measured");
  });

  test("운영 경로(prep 흐름 msg.modbusReadings): 벤더 temp_0001=28.4 가 표준 temp_0001 을 덮지 않는다 — 실제 사고 형태", () => {
    // 2026-09-04 DB 에 house_0002/temp_0001 = 28.4(벤더) 로 3행 저장된 바로 그 입력
    const e = makeEnv({ clock: makeClock(), globals: { houseConfig: CFG,
      ks3267Readings: { values: { "house_0002:temp_0001": 28.8, temp_0001: 28.8 }, t: FRESH, unit: 2 } } });
    const out = e.runFile(P("fn_collect_sensors.js"), { config: CFG, payload: null, modbusReadings: { temp_0001: 28.4, humidity_0001: 60.7 } });
    const h = byHouse(out);
    assert.equal(h.house_0002.data.temp_0001, 28.8, "표준 센서가 벤더 28.4 로 덮였다 — 사고 그대로");
    assert.equal(h.house_0001.data.temp_0001, 28.4, "벤더 센서는 벤더 28.4");
    assert.equal(h.house_0001.data.humidity_0001, 60.7);
  });

  test("레거시 키(sensorId 만)로 온 표준 값도 읽는다 — 옛 fn_ks_status 와 호환", () => {
    const e = makeEnv({ clock: makeClock(), globals: { houseConfig: CFG,
      ks3267Readings: { values: { temp_0001: 28.8 }, t: FRESH, unit: 2 } } });
    const h = byHouse(e.runFile(P("fn_collect_sensors.js"), { config: CFG, payload: [615, 231] }));
    assert.equal(h.house_0002.data.temp_0001, 28.8);
    assert.equal(h.house_0001.data.temp_0001, 23.1, "레거시 키가 벤더 하우스로 새어 들어갔다");
  });

  test("복합키가 있으면 복합키가 우선 (레거시 키와 값이 달라도)", () => {
    const e = makeEnv({ clock: makeClock(), globals: { houseConfig: CFG,
      ks3267Readings: { values: { "house_0002:temp_0001": 30.1, temp_0001: 99 }, t: FRESH, unit: 2 } } });
    assert.equal(byHouse(e.runFile(P("fn_collect_sensors.js"), { config: CFG, payload: [615, 231] })).house_0002.data.temp_0001, 30.1);
  });

  test("표준 값이 없으면(데몬 중단·TTL 초과) 생략 — 벤더 값으로 대체하지 않는다 (변이 프로브)", () => {
    for (const readings of [undefined, { values: { "house_0002:temp_0001": 28.8, temp_0001: 28.8 }, t: STALE, unit: 2 }]) {
      const e = makeEnv({ clock: makeClock(), globals: { houseConfig: CFG, ...(readings ? { ks3267Readings: readings } : {}) } });
      const out = e.runFile(P("fn_collect_sensors.js"), { config: CFG, payload: [615, 231] });
      const h = byHouse(out);
      assert.equal(h.house_0002, undefined, "표준 값이 없는데 house_0002 가 벤더 23.1 로 올라갔다");
      assert.equal(h.house_0001.data.temp_0001, 23.1);
      assert.ok(e.warns.some((w) => /생략 1/.test(w)), "생략 카운트가 로그에 남아야 한다");
    }
  });

  test("표준 센서는 RS-485 자체 버스 장애 판정에서 제외", () => {
    // 벤더 2개 모두 실패 + 표준 1개 정상 → 버스 실패 카운트는 벤더 2/2 로 셈 (표준을 섞어 3/3 이나 2/3 로 만들지 않음)
    const e = makeEnv({ clock: makeClock(), globals: { houseConfig: CFG,
      ks3267Readings: { values: { "house_0002:temp_0001": 28.8 }, t: FRESH, unit: 2 } } });
    e.runFile(P("fn_collect_sensors.js"), { config: CFG, payload: null, modbusReadings: {} });
    assert.equal(e.flow.get("busFailCount"), 1, "벤더 전체 실패는 1사이클로 세야 한다");
    assert.ok(e.warns.some((w) => /버스 전체 실패/.test(w)));
  });
});

describe("fn_ks_status (pending) — 복합키 + 레거시 키 동시 기록", () => {
  test("house_0002:temp_0001 과 temp_0001 둘 다", () => {
    const e = makeEnv({ clock: makeClock(), globals: { houseConfig: CFG } });
    const out = e.runFile(P("fn_ks_status.js"), { payload: { source: "ks3267d", unit: 2,
      state: { kind: "sensor", sensors: { 1: { value: 28.8, status: 0, status_name: "READY" } } } } });
    assert.equal(out.statusCode, 200); assert.equal(out.payload.sensorsMapped, 1);
    const v = e.global.get("ks3267Readings").values;
    assert.equal(v["house_0002:temp_0001"], 28.8);
    assert.equal(v.temp_0001, 28.8);
  });
  test("상태≥100(점검 필요) 값은 어느 키로도 넣지 않는다", () => {
    const e = makeEnv({ clock: makeClock(), globals: { houseConfig: CFG } });
    e.runFile(P("fn_ks_status.js"), { payload: { unit: 2, state: { kind: "sensor", sensors: { 1: { value: 28.8, status: 102 } } } } });
    const v = e.global.get("ks3267Readings").values;
    assert.equal(v["house_0002:temp_0001"], undefined); assert.equal(v.temp_0001, undefined);
  });
});

describe("Modbus 센서 읽기 준비 (pending) — 표준 센서엔 벤더 자동매핑·읽기 금지", () => {
  const MODS = [{ sensorType: "temperature_humidity", unitId: 1, fc: 4, address: 0, quantity: 2, divider: 10, signed: true }];
  test("ks3267 센서는 modbus 블록이 붙지 않고 읽기 목록에도 없다; 벤더 센서는 그대로 자동매핑", () => {
    const cfg = JSON.parse(JSON.stringify(CFG));
    delete cfg.houses[1].sensors[0].modbus;          // DB 원본처럼 표준 센서엔 modbus 없음
    delete cfg.houses[0].sensors[0].modbus;          // 벤더 센서 하나는 비워 자동매핑 대상
    const e = makeEnv({ clock: makeClock(), globals: { houseConfig: cfg, sensorModules: MODS } });
    const out = e.runFile(P("modbus_sensor_prep.js"), { config: cfg });
    assert.equal(cfg.houses[1].sensors[0].modbus, undefined, "표준 센서에 벤더 자동매핑이 붙었다");
    assert.ok(cfg.houses[0].sensors[0].modbus && cfg.houses[0].sensors[0].modbus.unitId === 1, "벤더 센서 자동매핑은 유지돼야 한다");
    const map = e.flow.get("modbusSensorMap");
    const listed = Object.values(map).flat().map((s) => s.houseId + ":" + s.sensorId);
    assert.ok(!listed.includes("house_0002:temp_0001"), "표준 센서가 RS-485 읽기 목록에 들어갔다");
    assert.ok(listed.includes("house_0001:temp_0001") && listed.includes("house_0001:humidity_0001"));
    assert.equal(out[0].payload.unitid, 1);
  });
  test("stale 벤더 블록이 이미 붙어 있어도 표준 센서는 읽기 목록에서 빠진다", () => {
    const cfg = JSON.parse(JSON.stringify(CFG)); // house_0002 표준 센서에 stale modbus 포함
    const e = makeEnv({ clock: makeClock(), globals: { houseConfig: cfg, sensorModules: MODS } });
    e.runFile(P("modbus_sensor_prep.js"), { config: cfg });
    const listed = Object.values(e.flow.get("modbusSensorMap")).flat().map((s) => s.houseId + ":" + s.sensorId);
    assert.ok(!listed.includes("house_0002:temp_0001"));
  });
});
