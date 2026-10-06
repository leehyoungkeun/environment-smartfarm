// 「모듈 정보 → global context」(modsync_handler) 교체본 — 「사용 안 함」 모듈 제외 (2026-10-06).
// 왜: 장치를 잠시 떼면 설정에 남은 모듈을 계속 찾아 「Modbus 버스 전체 실패」 경고·알림이 쌓인다.
//     삭제하면 장치 매핑까지 다시 해야 하므로, 설정은 남기고 읽기만 멈추는 토글을 둔다.
// 거르는 곳을 이 한 곳으로 한 이유: 모듈을 읽는 7군데가 모두 이 global 캐시를 본다.
// 교체본은 docs/nodered-module-enabled/fn_modsync_handler.js — 에디터 적용·마스터 동기화 후 same() 잠금 추가.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeClock, makeEnv } from "./harness.js";

const here = dirname(fileURLToPath(import.meta.url));
const FILE = join(here, "..", "..", "..", "docs", "nodered-module-enabled", "fn_modsync_handler.js");

const RELAY_ON = { id: "relay_1", name: "릴레이", unitId: 2, moduleType: "waveshare", channels: 8 };
const RELAY_OFF = { id: "relay_2", name: "뗀 릴레이", unitId: 3, moduleType: "waveshare", channels: 24, enabled: false };
const SENSOR_ON = { id: "sensor_1", name: "온습도", unitId: 1, fc: 4, address: 0, quantity: 2 };
const SENSOR_OFF = { id: "sensor_2", name: "뗀 CO2", unitId: 5, fc: 3, address: 0, quantity: 1, enabled: false };

const run = (settings, statusCode = 200, globals = {}) => {
  const e = makeEnv({ clock: makeClock(), globals });
  const out = e.runFile(FILE, { payload: { data: { settings } }, statusCode, _syncSource: "test" });
  return { e, out };
};

describe("modsync_handler 교체본 — 「사용 안 함」 모듈 제외", () => {
  test("enabled:false 는 캐시에 넣지 않는다 (읽는 7군데가 전부 이 캐시를 본다)", () => {
    const { e, out } = run({ relayModules: [RELAY_ON, RELAY_OFF], sensorModules: [SENSOR_ON, SENSOR_OFF] });
    assert.deepEqual(e.global.get("relayModules").map((m) => m.id), ["relay_1"]);
    assert.deepEqual(e.global.get("sensorModules").map((m) => m.id), ["sensor_1"]);
    assert.equal(out.payload.disabled, 2);
  });

  test("enabled 가 없으면 사용으로 본다 (기존 설정이 전부 꺼지면 안 된다)", () => {
    const { e } = run({ relayModules: [RELAY_ON], sensorModules: [SENSOR_ON] });
    assert.equal(e.global.get("relayModules").length, 1);
    assert.equal(e.global.get("sensorModules").length, 1);
  });

  test("enabled:true 도 당연히 사용", () => {
    const { e } = run({ relayModules: [{ ...RELAY_ON, enabled: true }], sensorModules: [] });
    assert.equal(e.global.get("relayModules").length, 1);
  });

  test("다시 「사용」 으로 바꾸면 다음 동기화에 되살아난다 (삭제와 다르다)", () => {
    const { e: off } = run({ relayModules: [{ ...RELAY_ON, enabled: false }], sensorModules: [] });
    assert.equal(off.global.get("relayModules").length, 0);
    const { e: on } = run({ relayModules: [RELAY_ON], sensorModules: [] });
    assert.equal(on.global.get("relayModules").length, 1);
  });

  test("전부 꺼도 빈 배열이지 오류가 아니다", () => {
    const { e, out } = run({ relayModules: [RELAY_OFF], sensorModules: [SENSOR_OFF] });
    assert.deepEqual(e.global.get("relayModules"), []);
    assert.deepEqual(e.global.get("sensorModules"), []);
    assert.equal(out.payload.disabled, 2);
  });

  test("변경 감지는 거른 뒤 개수로 — 끈 것도 '변경'으로 잡혀야 한다", () => {
    const { e } = run({ relayModules: [RELAY_ON, { ...RELAY_OFF, enabled: false }], sensorModules: [] },
      200, { relayModules: [RELAY_ON, RELAY_OFF], sensorModules: [] });
    assert.equal(e.global.get("relayModules").length, 1);
  });

  test("statusCode 200 이 아니면 캐시를 건드리지 않는다", () => {
    const { e, out } = run({ relayModules: [RELAY_ON] }, 500, { relayModules: [RELAY_ON, RELAY_OFF] });
    assert.equal(out, null);
    assert.equal(e.global.get("relayModules").length, 2, "실패 응답으로 기존 캐시를 지우면 제어가 멈춘다");
  });

  test("payload 가 문자열로 와도 파싱한다", () => {
    const e = makeEnv({ clock: makeClock(), globals: {} });
    const out = e.runFile(FILE, { payload: JSON.stringify({ data: { settings: { relayModules: [RELAY_ON, RELAY_OFF] } } }), statusCode: 200 });
    assert.equal(e.global.get("relayModules").length, 1);
    assert.equal(out.payload.disabled, 1);
  });
});

// ── 릴레이 워치독 — 이 노드만 houseConfig 의 장치에서 모듈을 뽑는다 (global 캐시를 안 본다).
// 모듈을 꺼도 장치는 남아 있어 계속 두드렸고 「Modbus 모듈 장애」 경보가 그대로 떴다 (2026-10-06 실측).
const WD = join(here, "..", "..", "..", "docs", "nodered-module-enabled", "fn_wd_request.js");

const HC = (units) => ({ houses: [{ houseId: "house_0001", devices: units.map((u, i) => ({ deviceId: "d" + i, modbus: { unitId: u, moduleType: "waveshare" } })) }] });

const runWd = (globals) => {
  const e = makeEnv({ clock: makeClock(), globals });
  const out = e.runFile(WD, {});
  return { e, out };
};

describe("wd_request 교체본 — 「사용 안 함」 unitId 는 두드리지 않는다", () => {
  test("disabledUnits 에 든 unitId 는 건너뛴다", () => {
    const { e, out } = runWd({ houseConfig: HC([2, 3]), disabledUnits: [3] });
    assert.deepEqual([...e.global.get("_watchdogModules")].map((m) => m.unitId), [2]);
    assert.equal(out.payload.unitid, 2);
  });

  test("disabledUnits 가 없으면 예전과 같다", () => {
    const { e } = runWd({ houseConfig: HC([2, 3]) });
    assert.deepEqual([...e.global.get("_watchdogModules")].map((m) => m.unitId), [2, 3]);
  });

  test("전부 꺼지면 경보도 지운다 — 안 지우면 평가가 안 돌아 옛 경보가 영원히 남는다", () => {
    const { e, out } = runWd({ houseConfig: HC([2]), disabledUnits: [2], watchdogAlert: { waveshare_2: { failCount: 8 } } });
    assert.equal(out, null);
    assert.equal(e.global.get("_watchdogModules").length, 0);
    assert.ok(!e.global.get("watchdogAlert"), "지켜볼 모듈이 없으면 경보도 없다");   // 하네스는 null 저장을 undefined 로 돌려준다
  });

  test("modsync_handler 가 넘기는 disabledUnits 와 키가 맞는다", () => {
    const e = makeEnv({ clock: makeClock(), globals: {} });
    const out = e.runFile(FILE, {
      payload: { data: { settings: { relayModules: [{ id: "r1", unitId: 2, enabled: false }], sensorModules: [{ id: "s1", unitId: 1 }] } } },
      statusCode: 200,
    });
    assert.deepEqual([...out.payload.disabledUnits], [2]);
    assert.deepEqual([...e.global.get("disabledUnits")], [2]);
  });

  test("같은 unitId 를 쓰는 다른 모듈이 켜져 있으면 끄지 않는다", () => {
    const e = makeEnv({ clock: makeClock(), globals: {} });
    e.runFile(FILE, {
      payload: { data: { settings: { relayModules: [{ id: "r1", unitId: 2, enabled: false }], sensorModules: [{ id: "s1", unitId: 2 }] } } },
      statusCode: 200,
    });
    assert.equal(e.global.get("disabledUnits").length, 0, "켜진 모듈이 쓰는 주소를 막으면 그 모듈이 죽는다");
  });
});
