// 표준·비표준 저장 정책 통일 (2026-09-19) — 에디터 적용·마스터 동기화 완료 21:56 (ks3267.test.js same() 이 잠근다).
// 비표준(Waveshare 릴레이) 구동기는 1분 상태 이력이 서버에도 제어기에도 없었다 (relay_status 는 지금 상태 한 줄만 덮어씀).
//   ① 「응답 포맷」(릴레이 MQTT 상태 탭)이 FC1 로 읽은 코일을 global.vendorCoils 에 보관
//   ② 「표준 구동기 1분 스냅샷」이 그 코일로 비표준 행(source=vendor)을 만들어 같은 actuator_status 로, 출력 2 로 드라이버 로컬에도

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeClock, makeEnv } from "./harness.js";

const here = dirname(fileURLToPath(import.meta.url));
const P = (n) => join(here, "..", "..", "..", "docs", "ksx3267", "nodered", n);
const J = (x) => JSON.parse(JSON.stringify(x));

const CFG = { farmId: "farm_0001", houses: [
  { houseId: "house_0001", devices: [
    { deviceId: "cooler1", name: "냉방기", modbus: { unitId: 2, moduleType: "waveshare", controlType: "single", address: 3 } },
    { deviceId: "side_window1", name: "측창1", modbus: { unitId: 2, controlType: "bidir", address: 0, address2: 1 } },
    { deviceId: "side_window2", name: "측창2", modbus: { unitId: 2, controlType: "bidir", address: 6, address2: 7 } },
    { deviceId: "valve9", name: "없는 모듈", modbus: { unitId: 5, controlType: "single", address: 0 } } ] },
  { houseId: "house_0003", devices: [
    { deviceId: "heater1", modbus: { protocol: "ks3267", unit: 1, kind: "switch", n: 1 } } ] },
] };

describe("① 응답 포맷 (적용본) — 읽은 코일을 보관", () => {
  test("unit 별로 코일·시각을 남기고 MQTT 발행은 그대로", () => {
    const e = makeEnv({ clock: makeClock(), globals: { houseConfig: CFG, farmId: "farm_0001" } });
    const out = e.runFile(P("fn_relay_response_format.js"), { _module: { unitId: 2, moduleType: "waveshare" }, payload: [0, 1, 0, 1, 0, 0, 1, 0] });
    assert.equal(out.topic, "smartfarm/farm_0001/relay/response");
    const vc = J(e.global.get("vendorCoils"));
    assert.deepEqual(vc["2"].coils, { 0: false, 1: true, 2: false, 3: true, 4: false, 5: false, 6: true, 7: false });
    assert.equal(vc["2"].t, e.clock.nowMs);
  });
});

describe("② 1분 스냅샷 (적용본) — 비표준 구동기도 같은 행", () => {
  const fresh = (e) => ({ "2": { coils: { 0: false, 1: true, 2: false, 3: true, 4: false, 5: false, 6: true, 7: false }, t: e.clock.nowMs - 20000 } });
  const ksState = (e) => ({ 1: { kind: "actuator", receivedAt: new Date(e.clock.nowMs - 5000).toISOString(),
    devices: { 1: { kind: "switch", n: 1, status: 201, status_name: "ON", remain: 12, opid: 9 } } } });

  test("코일 → 표준과 같은 상태코드, source=vendor, 표준 행과 같은 큐로", () => {
    const clock = makeClock();
    const e = makeEnv({ clock, globals: { houseConfig: CFG, farmId: "farm_0001", retentionDays: 45 } });
    e.global.set("vendorCoils", fresh(e)); e.global.set("ks3267State", ksState(e));
    const [srv, local] = e.runFile(P("fn_ks_snapshot.js"), {});
    const rows = J(srv.payload.rows);
    const by = Object.fromEntries(rows.map((r) => [r.deviceId, r]));
    assert.deepEqual([by.cooler1.status, by.cooler1.kind, by.cooler1.n, by.cooler1.source], [201, "switch", 4, "vendor"]);
    assert.equal(by.side_window1.status, 302, "닫힘 코일(1)이 켜졌으면 302");
    assert.equal(by.side_window2.status, 301, "열림 코일(6)이 켜졌으면 301");
    assert.equal(by.valve9, undefined, "읽지 못한 모듈(unit 5)의 행을 지어냈다");
    assert.equal(by.heater1.status, 201, "표준 행도 그대로");
    assert.equal(by.heater1.source, undefined, "표준 행은 출처 기본값(ks3267d)");
    assert.equal(local.url, "http://127.0.0.1:3002/local/vendor-actuator");
    assert.equal(J(local.payload).rows.length, 3);
    assert.equal(local.payload.retentionDays, 45);
  });

  test("3분 넘게 못 읽은 코일은 버린다 — 값을 지어내지 않는다", () => {
    const e = makeEnv({ clock: makeClock(), globals: { houseConfig: CFG } });
    e.global.set("vendorCoils", { "2": { coils: { 3: true }, t: e.clock.nowMs - 200000 } });
    e.global.set("ks3267State", ksState(e));
    const [srv, local] = e.runFile(P("fn_ks_snapshot.js"), {});
    assert.deepEqual(J(srv.payload.rows).map((r) => r.deviceId), ["heater1"]);
    assert.deepEqual(J(local.payload.rows), []);
  });

  test("드라이버가 없는 농장(ks3267State 비어 있음)은 출력 2 를 보내지 않는다 — 매분 연결 오류 방지", () => {
    const e = makeEnv({ clock: makeClock(), globals: { houseConfig: CFG } });
    e.global.set("vendorCoils", fresh(e));
    const [srv, local] = e.runFile(P("fn_ks_snapshot.js"), {});
    assert.equal(J(srv.payload.rows).length, 3, "비표준만 있어도 서버엔 보낸다");
    assert.equal(local, null);
  });

  test("아무것도 없으면 [null, null]", () => {
    const e = makeEnv({ clock: makeClock(), globals: { houseConfig: { houses: [] } } });
    assert.deepEqual(J(e.runFile(P("fn_ks_snapshot.js"), {})), [null, null]);
  });
});
