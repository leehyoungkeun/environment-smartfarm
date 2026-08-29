// ② 규칙 평가 (fn_evaluate_rules) — rpi-files/master/flows.json 의 실제 코드를 실행한다.
//
// 이 함수는 60초마다 센서 값을 보고 사람 없이 모터를 돌린다. 근거가 된 실제 사고:
//   - 자정 넘기기 (start > end) 구간 분할 — 22:00~06:00 환기 규칙이 자정 이후 죽는 문제
//   - 수동 모드 장치를 자동화가 건드리는 문제 (autoDevices 복합키 dkey)
//   - bidir 장치가 이미 열려 있는데 또 open — 모터 stall
//   - 같은 분(minute)에 규칙이 반복 발화 (executedRules dedup)
//
// 시각은 로컬 타임존 기준으로 만든다 (new Date(y,m,d,h,mm)) — 함수가 getHours() 를
// 쓰므로, 머신 TZ 가 무엇이든 테스트가 같은 결과를 내야 한다.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makeClock, makeEnv, port } from "./harness.js";

const NODE = "fn_evaluate_rules";

/** 2026-08-29 로컬 h시 m분의 ISO — 하네스 시계 시작값 */
const at = (h, m = 0) => new Date(2026, 7, 29, h, m, 0).toISOString();
const hm = (h, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

const HOUSE = "house_0001";
const HOUSE_CONFIG = {
  houses: [
    {
      houseId: HOUSE,
      devices: [
        { deviceId: "fan1", modbus: { unitId: 2, address: 0, controlType: "single" } },
        {
          deviceId: "window1",
          modbus: { unitId: 2, address: 2, address2: 3, controlType: "bidir", openDuration: 30, closeDuration: 30 },
        },
      ],
    },
  ],
};

function rule(over = {}) {
  return {
    id: "r1",
    name: "테스트 규칙",
    house_id: HOUSE,
    condition_logic: "AND",
    group_logic: "AND",
    cooldown_seconds: 60,
    last_triggered_at: null,
    trigger_count: 0,
    conditions: JSON.stringify([{ type: "sensor", sensorId: "temperature", operator: ">", value: 30 }]),
    actions: JSON.stringify([{ deviceId: "fan1", deviceType: "relay", command: "on" }]),
    ...over,
  };
}

function envAt(h, m = 0, globals = {}) {
  const clock = makeClock(at(h, m));
  return makeEnv({
    clock,
    globals: {
      houseConfig: HOUSE_CONFIG,
      autoDevices: [`${HOUSE}:fan1`, `${HOUSE}:window1`],
      deviceStates: {},
      devicePositions: {},
      ...globals,
    },
  });
}

const msgWith = (rules, temp) => ({
  payload: rules,
  allSensorData: { [HOUSE]: { data: { temperature: temp } } },
});

describe("② 센서 조건 판정", () => {
  test("임계 초과 → 제어 메시지 발행 (port 0)", () => {
    const e = envAt(10);
    const out = e.run(NODE, msgWith([rule()], 31));
    assert.ok(Array.isArray(out), "발화했는데 출력이 없다");
    const [controls, updates, logs] = out;
    assert.equal(controls.length, 1);
    assert.equal(controls[0].control.deviceId, "fan1");
    assert.equal(controls[0].control.command, "on");
    assert.equal(controls[0].control.operator, "automation");
    assert.ok(updates.length === 1 && /UPDATE automation_rules/.test(updates[0].topic));
    assert.equal(logs.length, 1);
  });

  test("임계 미달 → 발화 없음", () => {
    const e = envAt(10);
    const out = e.run(NODE, msgWith([rule()], 29));
    assert.equal(out, null);
  });

  test("센서 값이 없으면(수집 중단) 발화하지 않는다 — 없는 값을 0 으로 보면 안 된다", () => {
    const e = envAt(10);
    const r = rule({ conditions: JSON.stringify([{ type: "sensor", sensorId: "temperature", operator: "<", value: 10 }]) });
    const out = e.run(NODE, { payload: [r], allSensorData: { [HOUSE]: { data: {} } } });
    assert.equal(out, null, "값 없음이 '< 10 참' 으로 평가돼 난방이 켜진다");
  });

  test("condition_logic=OR — 하나만 참이어도 발화", () => {
    const e = envAt(10);
    const r = rule({
      condition_logic: "OR",
      conditions: JSON.stringify([
        { type: "sensor", sensorId: "temperature", operator: ">", value: 99 },
        { type: "sensor", sensorId: "temperature", operator: ">", value: 30 },
      ]),
    });
    const out = e.run(NODE, msgWith([r], 31));
    assert.ok(Array.isArray(out) && out[0]?.length === 1);
  });

  test("AND — 하나라도 거짓이면 발화 안 함", () => {
    const e = envAt(10);
    const r = rule({
      conditions: JSON.stringify([
        { type: "sensor", sensorId: "temperature", operator: ">", value: 30 },
        { type: "sensor", sensorId: "temperature", operator: ">", value: 99 },
      ]),
    });
    assert.equal(e.run(NODE, msgWith([r], 31)), null);
  });
});

describe("② 역할 분담·중복 방지", () => {
  test("시간 전용 규칙은 ② 가 건드리지 않는다 (④ 스케줄러 담당)", () => {
    const e = envAt(14);
    const r = rule({ conditions: JSON.stringify([{ type: "time", timeMode: "specific", times: [hm(14)] }]) });
    assert.equal(e.run(NODE, msgWith([r], 31)), null, "시간 전용 규칙이 ② 에서도 발화하면 이중 실행된다");
  });

  test("같은 분에는 한 번만 발화한다 (executedRules dedup)", () => {
    const e = envAt(10);
    assert.ok(Array.isArray(e.run(NODE, msgWith([rule()], 31))));
    const again = e.run(NODE, msgWith([rule()], 31));
    assert.equal(again, null, "같은 분에 재평가돼 릴레이가 두 번 명령받는다");
  });

  test("쿨다운 안이면 발화하지 않는다 (last_triggered_at + cooldown_seconds)", () => {
    const e = envAt(10);
    const r = rule({ last_triggered_at: at(9, 59), cooldown_seconds: 300 });
    assert.equal(e.run(NODE, msgWith([r], 31)), null);
  });

  test("쿨다운이 지나면 발화한다", () => {
    const e = envAt(10);
    const r = rule({ last_triggered_at: at(9, 50), cooldown_seconds: 300 });
    assert.ok(Array.isArray(e.run(NODE, msgWith([r], 31))));
  });

  test("autoDevices 가 비면 아무것도 하지 않는다 (자동화 미적용 상태)", () => {
    const e = envAt(10, 0, { autoDevices: [] });
    assert.equal(e.run(NODE, msgWith([rule()], 31)), undefined);
  });

  test("수동 모드 장치는 스킵한다 — 복합키(houseId:deviceId) 로 판정", () => {
    // fan1 은 다른 하우스에서만 자동 — 이 하우스의 fan1 은 수동
    const e = envAt(10, 0, { autoDevices: ["house_0002:fan1"] });
    const out = e.run(NODE, msgWith([rule()], 31));
    assert.equal(out?.[0] ?? null, null, "수동 전환한 장치를 자동화가 움직였다");
    assert.ok(e.warns.some((w) => w.includes("수동 모드")));
  });
});

describe("② bidir 위치 인지", () => {
  const winRule = (cmd) =>
    rule({ actions: JSON.stringify([{ deviceId: "window1", deviceType: "window", command: cmd }]) });

  test("이미 완전 열림(pos=100)이면 open 스킵 — 모터 stall 방지", () => {
    const e = envAt(10, 0, { devicePositions: { [`${HOUSE}:window1`]: 100 } });
    const out = e.run(NODE, msgWith([winRule("open")], 31));
    assert.equal(out?.[0] ?? null, null);
    assert.ok(e.warns.some((w) => w.includes("완전 열림")));
  });

  test("중간 위치(30%)에서 close → 필요한 시간만 계산 (30초 중 9초)", () => {
    const e = envAt(10, 0, { devicePositions: { [`${HOUSE}:window1`]: 30 } });
    const out = e.run(NODE, msgWith([winRule("close")], 31));
    assert.equal(out[0][0].control.duration, 9, "전체 시간을 돌리면 한계에서 모터가 stall 한다");
  });

  test("위치 정보가 없으면 전체 시간으로 동작한다 (안전한 기본값)", () => {
    const e = envAt(10);
    const out = e.run(NODE, msgWith([winRule("open")], 31));
    assert.equal(out[0][0].control.duration, 30);
  });
});

describe("② duration 역명령 타이머", () => {
  test("duration 만료 시 반대 명령이 나간다 (on → off)", () => {
    const e = envAt(10);
    const r = rule({
      actions: JSON.stringify([{ deviceId: "fan1", deviceType: "relay", command: "on", duration: 5, durationUnit: "minutes" }]),
    });
    const out = e.run(NODE, msgWith([r], 31));
    assert.equal(out[0][0].control.duration ?? 0, 0, "single 장치의 즉시 duration 은 0 이어야 한다 (역명령은 타이머 몫)");
    assert.equal(e.clock.pending().length, 1, "역명령 타이머가 안 걸렸다 — 팬이 영원히 돈다");

    e.clock.advance(5 * 60 * 1000);
    const reversed = port(e.sent, 0);
    assert.equal(reversed.length, 1);
    assert.equal(reversed[0].control.command, "off");
    assert.equal(reversed[0].control.operator, "automation_duration");
    const sqlite = port(e.sent, 2);
    assert.ok(sqlite.some((m) => /INSERT INTO control_logs/.test(m.topic)), "역명령이 이력에 안 남는다");
  });

  test("durationUnit=hours 환산", () => {
    const e = envAt(10);
    const r = rule({
      actions: JSON.stringify([{ deviceId: "fan1", deviceType: "relay", command: "on", duration: 2, durationUnit: "hours" }]),
    });
    e.run(NODE, msgWith([r], 31));
    const t = e.clock.pending()[0];
    assert.equal(t.fireAt - e.clock.nowMs, 2 * 3600 * 1000);
  });
});

describe("② 시간+센서 복합 (자정 넘기기)", () => {
  // 22:00~02:00 30분 간격 + 온도 조건 — start > end 구간 분할이 핵심
  const nightRule = () =>
    rule({
      conditions: JSON.stringify([
        { type: "sensor", sensorId: "temperature", operator: ">", value: 30 },
        { type: "time", timeMode: "interval", startTime: "22:00", endTime: "02:00", intervalMinutes: 30 },
      ]),
    });

  test("자정 전(23:00) 발화", () => {
    const e = envAt(23);
    assert.ok(Array.isArray(e.run(NODE, msgWith([nightRule()], 31))), "자정 전 구간이 죽었다");
  });

  test("자정 후(01:00) 발화 — start > end 두 번째 구간", () => {
    const e = envAt(1);
    assert.ok(Array.isArray(e.run(NODE, msgWith([nightRule()], 31))), "자정 넘긴 구간이 죽었다 — 실제 사고 재현");
  });

  test("구간 밖(12:00)은 발화하지 않는다", () => {
    const e = envAt(12);
    assert.equal(e.run(NODE, msgWith([nightRule()], 31)), null);
  });

  test("group_logic=OR — 센서만 참이어도 발화", () => {
    const e = envAt(12); // 시간 조건 거짓
    const r = rule({
      group_logic: "OR",
      conditions: JSON.stringify([
        { type: "sensor", sensorId: "temperature", operator: ">", value: 30 },
        { type: "time", timeMode: "specific", times: ["03:00"] },
      ]),
    });
    assert.ok(Array.isArray(e.run(NODE, msgWith([r], 31))));
  });
});
