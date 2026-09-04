// KS X 3267 표준노드 통합 (P3) — 에디터 적용 **전** 교체본·신규 함수를 파일에서 실행해 검증한다.
//
// docs/ksx3267/nodered/*.js 가 검증 대상. 에디터에 적용 → Deploy → 마스터 동기화 후에는
// 같은 검증을 flows.json 의 노드 id 로 다시 잠근다 (nr/execute-control 등).
//
// 근거 원칙: vendor(Waveshare) 경로 무수정, 레벨2 미생성, 값 지어내기 금지(TTL), 정규키(house_0001:*).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeClock, makeEnv, port } from "./harness.js";

const here = dirname(fileURLToPath(import.meta.url));
const D = join(here, "..", "..", "..", "docs", "ksx3267", "nodered");
const F = (n) => join(D, n);
const HOUSE = "house_0001";
const KS_FAN = { protocol: "ks3267", unit: 1, kind: "switch", n: 3 };
const KS_WIN = { protocol: "ks3267", unit: 1, kind: "opener", n: 2 };
const WAVESHARE = { unitId: 2, address: 0, controlType: "single" };

describe("execute_control 교체본 — 분기와 vendor 무수정", () => {
  test("ks3267 프로필 → 3번 출력으로만 (Modbus write 없음)", () => {
    const e = makeEnv({ clock: makeClock(), globals: { FARM_ID: "farm_0001" } });
    const out = e.runFile(F("execute_control.js"), { control: { houseId: HOUSE, deviceId: "fan1", command: "on", modbus: KS_FAN, duration: 30 }, payload: {} });
    assert.equal(out.length, 3, "출력이 3개여야 한다");
    assert.equal(out[0], null, "표준 노드에 Waveshare FC15 가 나갔다");
    assert.equal(out[2].control.modbus.protocol, "ks3267");
    assert.equal(out[2].control.duration, 30);
    assert.equal(e.global.get("_modbusLastWriteAt"), undefined, "표준 경로가 vendor mutex 를 건드렸다");
  });

  test("vendor 프로필은 그대로 FC15 (1번 출력) + 3-슬롯", () => {
    const e = makeEnv({ clock: makeClock(), globals: { FARM_ID: "farm_0001" } });
    const out = e.runFile(F("execute_control.js"), { control: { houseId: HOUSE, deviceId: "fan1", command: "on", modbus: WAVESHARE }, payload: {} });
    assert.equal(out.length, 3);
    assert.equal(out[0].payload.fc, 15); assert.equal(JSON.stringify(out[0].payload.value), "[true]");
    assert.equal(out[2], null);
  });

  test("bidir 위치 보고(2번 출력)와 자동정지 send 도 3-슬롯", () => {
    const e = makeEnv({ clock: makeClock(), globals: { FARM_ID: "farm_0001" } });
    e.runFile(F("execute_control.js"), { control: { houseId: HOUSE, deviceId: "window1", command: "open", duration: 9,
      modbus: { unitId: 2, address: 2, address2: 3, controlType: "bidir", openDuration: 30, closeDuration: 30 } }, payload: {} });
    const rep = port(e.sent, 1); assert.ok(rep.length >= 1 && rep[0].topic.endsWith("/device/position"));
    assert.ok(e.sent.every((s) => !Array.isArray(s) || s.length === 3), "2-슬롯 send 가 남아 있다 — 3번 출력 추가와 불일치");
    e.clock.advance(9001);
    const stops = port(e.sent, 0).filter((m) => m.payload?.fc === 15); assert.equal(stops.length, 1, "자동 정지 write");
  });
});

describe("fn_ks_command — 우리 명령 → 표준 명령 매핑 (레벨1)", () => {
  const cases = [
    [KS_FAN, "on", 0, "on", 0], [KS_FAN, "off", 0, "off", 0], [KS_FAN, "on", 45, "timed_on", 45], [KS_FAN, "stop", 0, "off", 0],
    [KS_WIN, "open", 0, "open", 0], [KS_WIN, "close", 0, "close", 0], [KS_WIN, "stop", 0, "stop", 0],
    [KS_WIN, "open", 9, "timed_open", 9], [KS_WIN, "close", 12.4, "timed_close", 12],
  ];
  for (const [mb, cmd, dur, op, sec] of cases) {
    test(`${mb.kind} ${cmd}${dur ? "+" + dur + "s" : ""} → ${op}`, () => {
      const e = makeEnv({ clock: makeClock(), tabEnv: {} });
      const out = e.runFile(F("fn_ks_command.js"), { control: { houseId: HOUSE, deviceId: "d", command: cmd, duration: dur, modbus: mb } });
      assert.equal(out.url, "http://127.0.0.1:3002/command"); assert.equal(out.method, "POST");
      assert.equal(out.payload.op, op); assert.equal(out.payload.seconds, sec);
      assert.equal(out.payload.unit, 1); assert.equal(out.payload.n, mb.n);
    });
  }
  test("레벨2 는 절대 만들지 않는다 (set_position 없음)", () => {
    const e = makeEnv({ clock: makeClock() });
    const out = e.runFile(F("fn_ks_command.js"), { control: { deviceId: "w", command: "set_position", modbus: KS_WIN } });
    assert.equal(out, null); assert.ok(e.warns.some((w) => w.includes("대응 명령 없음")));
  });
  test("프로필 불완전 → 버스로 안 나감", () => {
    const e = makeEnv({ clock: makeClock() });
    assert.equal(e.runFile(F("fn_ks_command.js"), { control: { deviceId: "w", command: "open", modbus: { protocol: "ks3267" } } }), null);
  });
  test("KS3267_API 환경변수로 데몬 주소 교체", () => {
    const e = makeEnv({ clock: makeClock(), tabEnv: { KS3267_API: "http://127.0.0.1:3102" } });
    assert.equal(e.runFile(F("fn_ks_command.js"), { control: { deviceId: "d", command: "on", modbus: KS_FAN } }).url, "http://127.0.0.1:3102/command");
  });
});

describe("fn_ks_status — 데몬 상태 → 전역 반영", () => {
  const CFG = { houses: [{ houseId: HOUSE,
    sensors: [{ sensorId: "temp_std", ks3267: { unit: 2, index: 1 } }, { sensorId: "humi_std", ks3267: { unit: 2, index: 4 } }, { sensorId: "co2_std", ks3267: { unit: 2, index: 13 } }],
    devices: [{ deviceId: "fan1", modbus: KS_FAN }, { deviceId: "window1", modbus: KS_WIN }] }] };

  test("센서 값이 sensorId 로 ks3267Readings 에 들어간다 (상태≥100 은 제외)", () => {
    const e = makeEnv({ clock: makeClock(), globals: { houseConfig: CFG } });
    const out = e.runFile(F("fn_ks_status.js"), { payload: { unit: 2, state: { kind: "sensor", sensors: {
      1: { value: 28.8, status: 0 }, 4: { value: 61.5, status: 0 }, 13: { value: 812, status: 103, status_name: "NEED_CHECK" } } } } });
    assert.equal(out.statusCode, 200); assert.equal(out.payload.sensorsMapped, 2);
    const r = e.global.get("ks3267Readings");
    assert.equal(r.values.temp_std, 28.8); assert.equal(r.values.humi_std, 61.5);
    assert.equal(r.values.co2_std, undefined, "점검 필요(103) 센서 값이 실측처럼 들어갔다");
    assert.equal(r.t, e.clock.nowMs);
  });

  test("구동기 상태 → deviceStates 정규키", () => {
    const e = makeEnv({ clock: makeClock(), globals: { houseConfig: CFG } });
    e.runFile(F("fn_ks_status.js"), { payload: { unit: 1, state: { kind: "actuator", devices: {
      3: { kind: "switch", n: 3, status: 201 }, 18: { kind: "opener", n: 2, status: 301 } } } } });
    const s = e.global.get("deviceStates");
    assert.equal(s[`${HOUSE}:fan1`], "on"); assert.equal(s[`${HOUSE}:window1`], "open");
    assert.ok(e.global.get("ks3267State")[1].devices, "원본 상태 보관");
  });

  test("unit/state 없으면 400", () => {
    const e = makeEnv({ clock: makeClock(), globals: { houseConfig: CFG } });
    assert.equal(e.runFile(F("fn_ks_status.js"), { payload: {} }).statusCode, 400);
  });
});

describe("fn_ks_result — 결과 반영 + 이력 (거부도 기록)", () => {
  test("성공 → deviceStates + control-log success:true", () => {
    const e = makeEnv({ clock: makeClock(), globals: { farmId: "farm_0001" } });
    const out = e.runFile(F("fn_ks_result.js"), { payload: { ok: true, accepted: true, opid: 7, status: 201, status_name: "ON", remain: 30 },
      _ksControl: { houseId: HOUSE, deviceId: "fan1", command: "on", operator: "web", modbus: KS_FAN } });
    assert.equal(e.global.get("deviceStates")[`${HOUSE}:fan1`], "on");
    assert.match(out[0].url, /\/internal\/control-log$/); assert.ok(!out[0].url.includes("/api/internal"));
    assert.equal(out[0].payload.success, true); assert.equal(out[0].payload.metadata.opid, 7);
  });
  test("실패 → 상태 불변 + success:false 이력", () => {
    const e = makeEnv({ clock: makeClock(), globals: { deviceStates: { [`${HOUSE}:fan1`]: "off" } } });
    const out = e.runFile(F("fn_ks_result.js"), { payload: { ok: false, error: "timeout" }, statusCode: 200,
      _ksControl: { houseId: HOUSE, deviceId: "fan1", command: "on", modbus: KS_FAN } });
    assert.equal(e.global.get("deviceStates")[`${HOUSE}:fan1`], "off");
    assert.equal(out[0].payload.success, false); assert.match(out[0].payload.reason, /timeout/);
  });
});

describe("fn_ks_proxy — 읽기 전용 프록시", () => {
  test("허용 액션 → 데몬 URL + 쿼리", () => {
    const e = makeEnv({ clock: makeClock() });
    const out = e.runFile(F("fn_ks_proxy.js"), { req: { params: { action: "discover" }, query: { unit: "3" } } });
    assert.equal(out[0].url, "http://127.0.0.1:3002/discover?unit=3"); assert.equal(out[1], null);
  });
  test("허용 외 액션(command 등) → 400 즉시 응답, 데몬 호출 없음", () => {
    const e = makeEnv({ clock: makeClock() });
    const out = e.runFile(F("fn_ks_proxy.js"), { req: { params: { action: "command" }, query: {} } });
    assert.equal(out[0], null); assert.equal(out[1].statusCode, 400);
  });
});

describe("③ 센서 수집 교체본 — 표준 센서 합류 (TTL 3분)", () => {
  const CFG = { farmId: "farm_0001", houses: [{ houseId: HOUSE, enabled: true, sensors: [
    { sensorId: "temp_0001", enabled: true, type: "number" }, { sensorId: "temp_std", enabled: true, type: "number", ks3267: { unit: 2, index: 1 } }] }] };
  test("신선한 표준 값은 실측처럼 수집된다", () => {
    const e = makeEnv({ clock: makeClock(), globals: { houseConfig: CFG, ks3267Readings: { values: { temp_std: 28.8 }, t: Date.parse("2026-08-29T09:59:00Z") } } });
    const out = e.runFile(F("fn_collect_sensors.js"), { config: CFG, payload: [615, 231] }); // XY-MD02: 습도 61.5, 온도 23.1
    const p = out[0][0].payload;
    assert.equal(p.data.temp_std, 28.8); assert.equal(p.data.temp_0001, 23.1); assert.equal(p.quality, "measured");
  });
  test("3분 넘은 표준 값은 버린다 — 값을 지어내지 않는다", () => {
    const e = makeEnv({ clock: makeClock(), globals: { houseConfig: CFG, ks3267Readings: { values: { temp_std: 28.8 }, t: Date.parse("2026-08-29T09:50:00Z") } } });
    const out = e.runFile(F("fn_collect_sensors.js"), { config: CFG, payload: [615, 231] });
    assert.equal(out[0][0].payload.data.temp_std, undefined, "데몬이 죽었는데 낡은 값이 실측처럼 올라간다");
  });
});

// ── 에디터 적용 후 (2026-08-30 Deploy → 마스터 동기화) — flows.json 노드 id 로 재잠금 ──
import { readFileSync } from "node:fs";
import { functionBody, readFlows } from "./harness.js";

describe("마스터 flows.json — 적용된 노드가 문서 교체본과 일치", () => {
  const same = (id, file) => test(`${id} == ${file}`, () => {
    assert.equal(functionBody(id).func.replace(/\r\n/g, "\n").trim(), readFileSync(F(file), "utf8").replace(/\r\n/g, "\n").trim());
  });
  same("execute_control", "execute_control.js");
  same("fn_collect_sensors", "fn_collect_sensors.js");
  same("modbus_sensor_prep", "modbus_sensor_prep.js");   // 2026-09-04 표준 센서 자동매핑 차단 (센서 충돌 사고)
  same("ks_fn_command", "fn_ks_command.js");
  same("ks_fn_status", "fn_ks_status.js");
  same("ks_fn_result", "fn_ks_result.js");
  same("ks_fn_proxy", "fn_ks_proxy.js");
  same("ks_fn_snapshot", "fn_ks_snapshot.js");
  same("ks_fn_snapshot_result", "fn_ks_snapshot_result.js");

  test("execute_control 출력 3 + 3번 → link out → ks_link_in_cmd", () => {
    const flows = readFlows();
    const ec = flows.find((n) => n.id === "execute_control");
    assert.equal(ec.outputs, 3);
    assert.equal(ec.wires.length, 3);
    const lo = flows.find((n) => n.id === ec.wires[2][0]);
    assert.equal(lo?.type, "link out"); assert.deepEqual(lo.links, ["ks_link_in_cmd"]);
    assert.ok(ec.wires[0].length && ec.wires[1].length, "vendor 1·2번 배선이 사라졌다");
  });

  test("http request 3개 — senderr 해제 (켜면 데몬 부재 시 응답이 매달린다)", () => {
    for (const id of ["ks_http_proxy_req", "ks_http_command", "ks_http_log", "ks_http_snapshot"]) {
      const n = readFlows().find((x) => x.id === id);
      assert.ok(n, id); assert.equal(n.senderr, false, id + " senderr 가 켜져 있다");
    }
  });

  test("스냅샷 inject 는 60초 반복, 배선 4단", () => {
    const flows = readFlows();
    const inj = flows.find((n) => n.id === "ks_inject_snapshot");
    assert.equal(String(inj?.repeat), "60"); assert.deepEqual(inj.wires, [["ks_fn_snapshot"]]);
    assert.deepEqual(flows.find((n) => n.id === "ks_fn_snapshot").wires, [["ks_http_snapshot"]]);
    assert.deepEqual(flows.find((n) => n.id === "ks_http_snapshot").wires, [["ks_fn_snapshot_result"]]);
  });

  test("노드 id 로 실행: ks3267 프로필 → 3번 출력", () => {
    const e = makeEnv({ clock: makeClock(), globals: { FARM_ID: "farm_0001" } });
    const out = e.run("execute_control", { control: { houseId: HOUSE, deviceId: "fan1", command: "on", modbus: KS_FAN }, payload: {} });
    assert.equal(out[0], null); assert.equal(out[2].control.modbus.protocol, "ks3267");
  });
});

// ── 표준 구동기 1분 스냅샷 (116 검정) — fn_ks_snapshot / fn_ks_snapshot_result ──
describe("fn_ks_snapshot — 1분 스냅샷 + 실패 큐", () => {
  const CFG = { houses: [{ houseId: HOUSE, devices: [{ deviceId: "fan1", modbus: KS_FAN }, { deviceId: "window1", modbus: KS_WIN }, { deviceId: "relay9", modbus: WAVESHARE }] }] };
  const fresh = (clock) => ({ 1: { kind: "actuator", receivedAt: new Date(clock.nowMs - 20000).toISOString(),
    devices: { 3: { kind: "switch", n: 3, status: 201, status_name: "ON", remain: 25, opid: 7 }, 18: { kind: "opener", n: 2, status: 0, status_name: "READY", remain: 0, opid: 0 } } } });

  test("표준 장치만 분 단위 행으로, vendor 장치는 제외, 서버 POST 준비", () => {
    const clock = makeClock("2026-08-30T09:00:42.000Z");
    const e = makeEnv({ clock, globals: { houseConfig: CFG, ks3267State: fresh(clock), farmId: "farm_0001" }, tabEnv: { SENSOR_API_KEY: "k" } });
    const out = e.runFile(F("fn_ks_snapshot.js"), {});
    assert.equal(out.method, "POST"); assert.match(out.url, /\/internal\/actuator-status$/); assert.equal(out.headers["x-api-key"], "k");
    assert.equal(out.payload.rows.length, 2, "표준 장치 2개만");
    assert.equal(out.payload.rows[0].timestamp, "2026-08-30T09:00:00.000Z", "분 단위로 내림");
    assert.equal(out.payload.rows[0].status, 201); assert.equal(out.payload.rows[0].remain, 25); assert.equal(out._sent, 2);
    assert.equal(e.flow.get("ksSnapshotQueue").length, 2);
  });
  test("3분 넘게 갱신 없는 노드는 행을 만들지 않는다 (값을 지어내지 않음 → 손실로 드러남)", () => {
    const clock = makeClock();
    const stale = fresh(clock); stale[1].receivedAt = new Date(clock.nowMs - 200000).toISOString();
    const e = makeEnv({ clock, globals: { houseConfig: CFG, ks3267State: stale } });
    assert.equal(e.runFile(F("fn_ks_snapshot.js"), {}), null);
  });
  test("전송 실패분은 큐에 남아 다음 분에 함께 간다, 성공하면 보낸 만큼 비운다", () => {
    const clock = makeClock();
    const e = makeEnv({ clock, globals: { houseConfig: CFG, ks3267State: fresh(clock) } });
    const m1 = e.runFile(F("fn_ks_snapshot.js"), {});
    e.runFile(F("fn_ks_snapshot_result.js"), { ...m1, statusCode: 502, payload: "Bad Gateway" });
    assert.equal(e.flow.get("ksSnapshotQueue").length, 2, "실패했는데 큐가 비었다");
    clock.advance(60000);
    const st = e.global.get("ks3267State"); st[1].receivedAt = new Date(clock.nowMs).toISOString(); e.global.set("ks3267State", st);
    const m2 = e.runFile(F("fn_ks_snapshot.js"), {});
    assert.equal(m2.payload.rows.length, 4, "실패분 2 + 이번 분 2");
    e.runFile(F("fn_ks_snapshot_result.js"), { ...m2, statusCode: 200, payload: { success: true, inserted: 4, received: 4 } });
    assert.equal(e.flow.get("ksSnapshotQueue").length, 0);
  });
});
