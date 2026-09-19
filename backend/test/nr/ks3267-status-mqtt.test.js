// 표준 구동기 상태 → AWS IoT 실시간 보고 (2026-09-19) — 에디터 적용·마스터 동기화 완료 21:27 (ks3267.test.js same() 이 잠근다).
// 비표준 릴레이는 MQTT 로 화면에 실시간 반영되는데 표준 장치는 백엔드→Tailscale 폴링뿐이었다.
// 「표준 상태 반영」 출력 2 가 smartfarm/{farmId}/ks3267/status 로 발행 — 상태·OPID 변화 또는 60초 하트비트, 구동기만.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeClock, makeEnv } from "./harness.js";

const here = dirname(fileURLToPath(import.meta.url));
const P = join(here, "..", "..", "..", "docs", "ksx3267", "nodered", "fn_ks_status.js");
const CFG = { farmId: "farm_0001", houses: [{ houseId: "house_0003", devices: [
  { deviceId: "heater1", modbus: { protocol: "ks3267", unit: 1, kind: "switch", n: 1 } }] }] };
const act = (status, opid, remain = 0) => ({ source: "ks3267d", unit: 1, state: { kind: "actuator", t: 1789812000, devices: {
  1: { kind: "switch", n: 1, name: "스위치1", status, opid, remain }, 17: { kind: "opener", n: 1, name: "개폐기1", status: 0, opid: 0, remain: 0 } } } });

function env() {
  const clock = makeClock();
  const e = makeEnv({ clock, globals: { houseConfig: CFG, farmId: "farm_0001" } });
  return { e, clock };
}

describe("표준 상태 반영 출력 2 — AWS IoT 보고", () => {
  test("구동기 상태가 처음 오면 발행한다 — 토픽·모양은 화면 폴링(/ks3267/status)과 같다", () => {
    const { e } = env();
    const [res, mq] = e.runFile(P, { payload: act(201, 9, 20) });
    assert.equal(res.statusCode, 200);
    assert.equal(mq.topic, "smartfarm/farm_0001/ks3267/status");
    const p = JSON.parse(mq.payload);
    assert.equal(p.unit, 1); assert.equal(p.state.devices[1].status, 201); assert.equal(p.state.devices[1].remain, 20);
    assert.ok(p.now > 0);
    assert.equal(e.global.get("deviceStates")["house_0003:heater1"], "on", "기존 전역 반영은 그대로");
  });

  test("남은시간만 줄면 다시 보내지 않고, 상태·OPID 가 바뀌면 보낸다", () => {
    const { e, clock } = env();
    e.runFile(P, { payload: act(201, 9, 20) });
    clock.advance(3000);
    assert.equal(e.runFile(P, { payload: act(201, 9, 17) })[1], null, "카운트다운만으로 매 폴링 발행 — AWS 메시지 낭비");
    clock.advance(3000);
    const mq = e.runFile(P, { payload: act(0, 0, 0) })[1];
    assert.ok(mq, "READY 로 바뀌었는데 발행하지 않았다 — 화면이 자동 정지를 모른다");
    assert.equal(JSON.parse(mq.payload).state.devices[1].status, 0);
  });

  test("변화가 없어도 60초마다 한 번 (하트비트)", () => {
    const { e, clock } = env();
    e.runFile(P, { payload: act(0, 0) });
    clock.advance(59000);
    assert.equal(e.runFile(P, { payload: act(0, 0) })[1], null);
    clock.advance(2000);
    assert.ok(e.runFile(P, { payload: act(0, 0) })[1]);
  });

  test("센서 노드 상태는 발행하지 않는다 (센서는 수집 파이프라인)", () => {
    const { e } = env();
    const out = e.runFile(P, { payload: { unit: 2, state: { kind: "sensor", sensors: { 1: { value: 20, status: 0 } } } } });
    assert.equal(out[0].statusCode, 200);
    assert.equal(out[1], null);
  });

  test("잘못된 요청은 400, 발행 없음", () => {
    const { e } = env();
    const out = e.runFile(P, { payload: {} });
    assert.equal(out[0].statusCode, 400); assert.equal(out[1], null);
  });

  test("유닛마다 따로 기억한다 — 유닛 2 변화가 유닛 1 신호를 덮지 않는다", () => {
    const { e } = env();
    e.runFile(P, { payload: act(201, 9) });
    const u3 = act(201, 9); u3.unit = 3;
    assert.ok(e.runFile(P, { payload: u3 })[1], "다른 유닛의 첫 상태도 발행");
    assert.equal(e.runFile(P, { payload: act(201, 9) })[1], null);
  });
});
