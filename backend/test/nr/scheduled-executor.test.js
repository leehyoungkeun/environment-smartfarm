// ⑤ 스케줄 실행 핸들러 (fn_scheduled_executor) — rpi-files/master/flows.json 의 실제 코드.
//
// 실제 Modbus 코일 상태를 보고 최종 실행을 판단하는 마지막 관문. 근거가 된 실제 사고:
//   - stepped 완료 시 명시적 stop 미발사 → 측창 coil stuck → 매분 Modbus fail (6/3)
//   - unitId 하드코딩 → UI↔HW 매칭 실패 시 전체 OFF stale (동적 msg 사용 원칙)
//   - FC5 혼용 금지 → Modbus Flex Write 는 FC15 통일
//   - 하우스 무시 장치 탐색 → 다른 하우스의 같은 이름 릴레이를 잡는 문제 (8/25 복합키 전환)
//   - /internal 경로 오타(/api/internal) 로 제어 이력이 도달한 적 없던 문제

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makeClock, makeEnv, port } from "./harness.js";

const NODE = "fn_scheduled_executor";
const HOUSE = "house_0001";
const KEY = (d) => `${HOUSE}:${d}`;

const MODBUS_FAN = { unitId: 2, address: 0, controlType: "single" };
const MODBUS_WIN = { unitId: 2, address: 2, address2: 3, controlType: "bidir", openDuration: 100, closeDuration: 100 };

function baseGlobals(over = {}) {
  return {
    houseConfig: {
      houses: [
        { houseId: HOUSE, devices: [{ deviceId: "fan1", modbus: MODBUS_FAN }, { deviceId: "window1", modbus: MODBUS_WIN }] },
        // 같은 이름의 장치가 다른 하우스에 존재 — 하우스 한정 탐색 검증용
        { houseId: "house_0002", devices: [{ deviceId: "fan1", modbus: { unitId: 5, address: 7, controlType: "single" } }] },
      ],
    },
    autoDevices: [KEY("fan1"), KEY("window1")],
    devicePositions: {},
    deviceStates: {},
    farmId: "farm_0001",
    ...over,
  };
}

function makeMsg(actions, over = {}) {
  return {
    _scheduledRule: { id: "s1", name: "규칙", house_id: HOUSE, houseId: HOUSE, farmId: "farm_0001", ...over },
    _scheduledActions: actions,
    payload: over.coils !== undefined ? over.coils : [false, false, false, false, false, false, false, false],
  };
}

function run(actions, { globals = {}, ruleOver = {}, coils } = {}) {
  const e = makeEnv({ clock: makeClock(), globals: baseGlobals(globals) });
  const out = e.run(NODE, makeMsg(actions, { ...ruleOver, coils }));
  return { e, out };
}

describe("⑤ 실제 상태 기반 스킵", () => {
  test("이미 켜져 있으면(코일 참) on 스킵 + 거부도 이력에 남는다 (fix ⑧)", () => {
    const coils = [true, false, false, false, false, false, false, false];
    const { e, out } = run([{ deviceId: "fan1", command: "on" }], { coils });
    assert.equal(out[0], null, "이미 on 인데 또 명령했다");
    const httpLogs = port(e.sent, 3).filter((m) => m.url?.includes("/internal/control-log"));
    assert.equal(httpLogs.length, 1, "거부가 이력에 안 남으면 '왜 안 켜졌지' 를 추적할 수 없다");
    assert.equal(httpLogs[0].payload.success, false);
  });

  test("꺼져 있으면 on 실행 + 성공 이력", () => {
    const { e, out } = run([{ deviceId: "fan1", command: "on" }]);
    assert.equal(out[0].payload.deviceId, "fan1");
    assert.equal(out[0].payload.command, "on");
    const httpLogs = port(e.sent, 3).filter((m) => m.url?.includes("/internal/control-log"));
    assert.equal(httpLogs[0].payload.success, true);
  });

  test("이력 URL 은 /internal — /api/internal 이면 404 로 이력이 도달한 적 없던 사고", () => {
    const { e } = run([{ deviceId: "fan1", command: "on" }]);
    for (const m of port(e.sent, 3)) {
      assert.ok(!m.url.includes("/api/internal"), `이력 URL 오타: ${m.url}`);
    }
  });

  test("Modbus 읽기 실패(coils=null)여도 실행은 진행한다 — 상태 미상이 마비가 되면 안 된다", () => {
    const { out } = run([{ deviceId: "fan1", command: "on" }], { coils: null });
    assert.equal(out[0].payload.command, "on");
  });

  test("모순 rule (open + target=0) 은 실행하지 않고 이유를 남긴다 (fix ③)", () => {
    const { e, out } = run([{ deviceId: "window1", command: "open", targetPosition: 0 }]);
    assert.equal(out[0], null);
    const log = port(e.sent, 3)[0];
    assert.equal(log.payload.success, false);
    assert.match(log.payload.reason, /모순/);
  });

  test("이미 한계(pos=100)면 open 스킵", () => {
    const { out } = run([{ deviceId: "window1", command: "open" }], {
      globals: { devicePositions: { [KEY("window1")]: 100 } },
    });
    assert.equal(out[0], null);
  });
});

describe("⑤ 하우스 한정 장치 탐색 (다중 하우스 8/25)", () => {
  // ★ 실제 결함 (2026-08-29 발견): 규칙 객체는 house_id(snake) 뿐인데
  // sendControlLog/sendStepStatus 는 rule.houseId(camel) 만 읽는다.
  // 제어는 옳은 하우스로 가지만(HOUSE_ID 는 양쪽 표기 지원) **이력만 house_0001 로 오귀속**된다.
  // 2026-08-29 에디터 수정 완료 — 이 테스트가 회귀를 막는다. docs/nodered-fixes-2026-08-29-automation/ 참조.
  test("house_0002 규칙의 이력도 house_0002 로 기록된다", () => {
    const e = makeEnv({
      clock: makeClock(),
      globals: baseGlobals({ autoDevices: ["house_0002:fan1"] }),
    });
    e.run(NODE, {
      // 운영 데이터 그대로: snake_case 만 (function 3 매핑 결과)
      _scheduledRule: { id: "s2", name: "2동 규칙", house_id: "house_0002", farmId: "farm_0001" },
      _scheduledActions: [{ deviceId: "fan1", command: "on" }],
      payload: [false, false, false, false, false, false, false, false],
    });
    const log = port(e.sent, 3).find((m) => m.url?.includes("/internal/control-log"));
    assert.equal(log.payload.houseId, "house_0002", "2동 자동화 이력이 1동으로 기록된다");
  });

  test("house_0002 규칙의 fan1 은 house_0002 의 릴레이를 잡는다", () => {
    const e = makeEnv({
      clock: makeClock(),
      globals: baseGlobals({ autoDevices: ["house_0002:fan1"] }),
    });
    const out = e.run(NODE, {
      _scheduledRule: { id: "s2", name: "2동 규칙", house_id: "house_0002", houseId: "house_0002", farmId: "farm_0001" },
      _scheduledActions: [{ deviceId: "fan1", command: "on" }],
      payload: [false, false, false, false, false, false, false, false],
    });
    assert.equal(out[0].payload.modbus.unitId, 5, "다른 하우스의 fan1 릴레이를 잡았다 — 엉뚱한 모터가 돈다");
    assert.equal(out[0].payload.modbus.address, 7);
  });
});

describe("⑤ bidir 위치 기반 duration", () => {
  test("pos 30% 에서 close → closeDuration 의 30% 만 (100초 중 30초)", () => {
    const { out } = run([{ deviceId: "window1", command: "close" }], {
      globals: { devicePositions: { [KEY("window1")]: 30 } },
    });
    assert.equal(out[0].payload.duration, 30);
  });

  test("bidir 는 action.duration(역명령 타이머)을 무시한다 — stop 은 위치 로직 몫", () => {
    const { e, out } = run([{ deviceId: "window1", command: "open", duration: 10, durationUnit: "seconds" }]);
    assert.equal(out[0].payload.command, "open");
    assert.equal(e.clock.pending().length, 0, "bidir 에 역명령 타이머가 걸리면 open 하다 갑자기 close 한다");
  });

  test("single 장치 duration → 만료 시 역명령(off) 발사", () => {
    const { e } = run([{ deviceId: "fan1", command: "on", duration: 5, durationUnit: "minutes" }]);
    e.clock.advance(5 * 60 * 1000 + 1);
    const reversed = port(e.sent, 0).filter((m) => m.payload?.command === "off");
    assert.equal(reversed.length, 1, "역명령이 안 나가면 팬이 영원히 돈다");
    assert.equal(reversed[0].payload.source, "automation_duration");
  });
});

describe("⑤ stepped — 6/3 coil stuck 사고의 재현과 방어", () => {
  const stepAction = { deviceId: "window1", command: "open", actionMode: "stepped", targetPosition: 25, stepPercent: 10, stepPauseSeconds: 60 };

  test("완료(reached) 분기가 명시적 stop 을 발사한다 — FC15 + 양쪽 코일 false (fix ②)", () => {
    const { e } = run([stepAction]);
    // 1보(step) 나감 → 위치가 목표에 도달했다고 알려주고 다음 루프
    e.global.set("devicePositions", { [KEY("window1")]: 25 });
    e.clock.advance(10 * 1000 + 60 * 1000 + 1);

    const stops = port(e.sent, 0).filter((m) => m.payload?.fc !== undefined);
    assert.equal(stops.length, 1, "명시적 stop 미발사 — 측창 coil stuck → 매분 Modbus fail (6/3 사고)");
    assert.equal(stops[0].payload.fc, 15, "FC15 통일 원칙 위반 (FC5 금지)");
    assert.equal(JSON.stringify(stops[0].payload.value), "[false,false]"); // vm 경계 배열은 deepEqual 불가
    assert.equal(stops[0].payload.quantity, 2);
    assert.equal(stops[0].payload.unitid, 2, "unitId 는 modbus 설정에서 — 하드코딩 금지");
    assert.ok(e.global.get("_modbusLastWriteAt"), "SW mutex(_modbusLastWriteAt) 미갱신 — 직후 sync 가 write 와 충돌한다");
    assert.equal(e.global.get("steppedSessions")[KEY("window1")], undefined, "세션이 정리되지 않았다");
  });

  test("마지막 step 은 목표를 넘지 않는다 (fix ① — thisStepDur 동적)", () => {
    const { e } = run([stepAction]);
    const step1 = port(e.sent, 0).filter((m) => m.payload?.source === "automation_stepped");
    assert.equal(step1[0].payload.duration, 10, "1보: 10% = 100초의 10%");

    // 20% 까지 진행 → 남은 5% 만
    e.global.set("devicePositions", { [KEY("window1")]: 20 });
    e.clock.advance(10 * 1000 + 60 * 1000 + 1);
    const steps = port(e.sent, 0).filter((m) => m.payload?.source === "automation_stepped");
    assert.equal(steps.at(-1).payload.duration, 5, "마지막 step 이 목표를 지나쳐 모터가 한계까지 돈다");
  });

  test("진행 중 수동 전환 → 중단하고 세션 정리", () => {
    const { e } = run([stepAction]);
    e.global.set("autoDevices", []);
    e.global.set("devicePositions", { [KEY("window1")]: 10 });
    e.clock.advance(10 * 1000 + 60 * 1000 + 1);
    const steps = port(e.sent, 0).filter((m) => m.payload?.source === "automation_stepped");
    assert.equal(steps.length, 1, "수동 전환 후에도 stepped 가 계속 돈다");
    assert.equal(e.global.get("steppedSessions")[KEY("window1")], undefined);
  });

  test("옛 세션이 있으면 강제 stop 후 새 명령 진행 (fix ④⑦)", () => {
    const { e, out } = run([{ deviceId: "window1", command: "close" }], {
      globals: {
        steppedSessions: { [KEY("window1")]: "old_session_123" },
        devicePositions: { [KEY("window1")]: 50 },
      },
    });
    const stops = port(e.sent, 0).filter((m) => m.payload?.fc === 15 && Array.isArray(m.payload.value));
    assert.equal(stops.length, 1, "옛 세션을 멈추지 않고 새 명령을 얹으면 코일이 충돌한다");
    assert.equal(out[0].payload.command, "close", "옛 세션 정리 후 새 명령이 진행돼야 한다");
  });

  test("이미 목표 도달이면 stepped 를 시작하지 않는다", () => {
    const { e, out } = run([stepAction], { globals: { devicePositions: { [KEY("window1")]: 30 } } });
    assert.equal(out[0], null);
    assert.equal(port(e.sent, 3)[0].payload.success, false);
  });
});

describe("⑤ 마무리 동작", () => {
  test("실행 후 pending 을 비운다 (재실행 방지)", () => {
    const e = makeEnv({ clock: makeClock(), globals: baseGlobals(), flowVars: { pendingRule: { id: "x" }, pendingActions: [] } });
    e.run(NODE, makeMsg([{ deviceId: "fan1", command: "on" }]));
    assert.equal(e.flow.get("pendingRule"), undefined);
  });

  test("트리거 기록 UPDATE 가 port 1 로 나간다", () => {
    const { out } = run([{ deviceId: "fan1", command: "on" }]);
    assert.match(out[1].topic, /UPDATE automation_rules SET last_triggered_at/);
  });

  test("복수 제어는 500ms 간격으로 나간다 — RS-485 fan-out race 방지", () => {
    const g = baseGlobals();
    g.houseConfig.houses[0].devices.push({ deviceId: "fan2", modbus: { unitId: 2, address: 1, controlType: "single" } });
    g.autoDevices.push(KEY("fan2"));
    const e = makeEnv({ clock: makeClock(), globals: g });
    const out = e.run(NODE, makeMsg([{ deviceId: "fan1", command: "on" }, { deviceId: "fan2", command: "on" }]));
    assert.equal(out[0].payload.deviceId, "fan1", "첫 명령은 즉시");
    assert.equal(port(e.sent, 0).filter((m) => m.payload?.deviceId === "fan2").length, 0, "두 번째가 동시에 나가면 serial 버스가 충돌한다");
    e.clock.advance(501);
    assert.equal(port(e.sent, 0).filter((m) => m.payload?.deviceId === "fan2").length, 1);
  });
});
