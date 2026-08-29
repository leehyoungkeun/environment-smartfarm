// ④ 시간 스케줄러 (fn_scheduler) — rpi-files/master/flows.json 의 실제 코드를 실행한다.
//
// 시간 전용 규칙의 setTimeout 예약 엔진. 근거가 된 실제 문제:
//   - 자정 넘기기 interval (start > end) 의 다음 실행 시각 계산
//   - 같은 시각 규칙 여러 개 → RS-485 충돌 (500ms stagger 로 해결)
//   - Deploy 후 타이머 소멸 → 매 폴링 재생성 + 30초 실행 dedup (v4 설계)
//   - 카운트다운 표시가 쿨다운을 무시하고 이미 지난 시각을 가리키는 문제

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makeClock, makeEnv, port } from "./harness.js";

const NODE = "fn_scheduler";
const HOUSE = "house_0001";

const at = (h, m = 0, s = 0) => new Date(2026, 7, 29, h, m, s).toISOString();
const hm = (h, m = 0) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

function rule(over = {}) {
  return {
    id: "s1",
    name: "스케줄 규칙",
    enabled: true,
    house_id: HOUSE,
    cooldown_seconds: 300,
    conditions: JSON.stringify([{ type: "time", timeMode: "specific", times: [hm(14)] }]),
    actions: JSON.stringify([{ deviceId: "fan1", deviceType: "relay", command: "on" }]),
    ...over,
  };
}

function envAt(h, m = 0, s = 0, globals = {}) {
  return makeEnv({
    clock: makeClock(at(h, m, s)),
    globals: { autoDevices: [`${HOUSE}:fan1`], farmId: "farm_0001", ...globals },
  });
}

describe("④ 다음 실행 시각 계산", () => {
  test("오늘 남은 시각으로 예약된다 (10:00 → 14:00, 4시간 뒤)", () => {
    const e = envAt(10);
    e.run(NODE, { automationRules: [rule()] });
    const sched = e.global.get("automationSchedule");
    assert.ok(sched.s1, "예약이 안 됐다");
    assert.equal(sched.s1.delayMs, 4 * 3600 * 1000);
  });

  test("이미 지난 시각은 다음 날로 넘어간다 (15:00 → 내일 14:00)", () => {
    const e = envAt(15);
    e.run(NODE, { automationRules: [rule()] });
    const sched = e.global.get("automationSchedule");
    assert.equal(sched.s1.delayMs, 23 * 3600 * 1000, "지난 시각으로 예약되면 즉시 오발화한다");
  });

  test("자정 넘기기 interval — 01:30 에 다음 슬롯(1:30 아닌 미래 슬롯) 계산", () => {
    // 22:00~02:00 / 30분 간격. 01:15 현재 → 다음은 01:30 (자정 이후 구간)
    const e = envAt(1, 15);
    const r = rule({
      conditions: JSON.stringify([
        { type: "time", timeMode: "interval", startTime: "22:00", endTime: "02:00", intervalMinutes: 30 },
      ]),
    });
    e.run(NODE, { automationRules: [r] });
    const sched = e.global.get("automationSchedule");
    assert.ok(sched.s1, "자정 넘긴 구간의 다음 슬롯을 못 찾았다 — 실제 사고 재현");
    assert.equal(sched.s1.delayMs, 15 * 60 * 1000);
  });

  test("요일 필터 — 오늘이 제외 요일이면 다음 허용 요일로", () => {
    // 내일 09:00 = 23시간 뒤 (24시간 상한 안)
    const today = new Date(2026, 7, 29).getDay();
    const tomorrow = (today + 1) % 7;
    const e = envAt(10);
    const r = rule({
      conditions: JSON.stringify([{ type: "time", timeMode: "specific", times: [hm(9)], days: [tomorrow] }]),
    });
    e.run(NODE, { automationRules: [r] });
    const sched = e.global.get("automationSchedule");
    assert.equal(sched.s1.delayMs, 23 * 3600 * 1000, "제외 요일인데 오늘 실행된다");
  });

  test("쿨다운이 다음 시각을 밀어낸다 (camelCase 경로 — 코드가 읽는 유일한 표기)", () => {
    // 13:59:20 발화, 쿨다운 600초 → 14:00 슬롯은 건너뛰고 오늘 18:00
    const e = envAt(13, 59, 30);
    const r = rule({
      lastTriggeredAt: at(13, 59, 20),
      cooldownSeconds: 600,
      conditions: JSON.stringify([{ type: "time", timeMode: "specific", times: [hm(14), hm(18)] }]),
    });
    e.run(NODE, { automationRules: [r] });
    const sched = e.global.get("automationSchedule");
    assert.ok(sched.s1, "예약 자체가 안 됐다");
    assert.equal(new Date(sched.s1.nextRunAt).getHours(), 18, "쿨다운 안의 14:00 슬롯이 예약됐다 — 즉시 오발화 + 카운트다운 오표시");
  });

  // ★ 실제 결함 (2026-08-29 발견): function 3 이 만드는 규칙 객체는 snake_case
  // (last_triggered_at) 뿐인데, ④ 는 rule.lastTriggeredAt(camel) 만 읽는다.
  // → 운영에서 예약 시점 쿨다운이 **한 번도 동작한 적이 없다**.
  // interval 규칙(30분 간격 + 쿨다운 1시간)이면 쿨다운 무시하고 매 슬롯 발화한다.
  // 2026-08-29 에디터 수정 완료 — 이 테스트가 회귀를 막는다. docs/nodered-fixes-2026-08-29-automation/ 참조.
  test("쿨다운이 snake_case(실제 데이터 표기)로도 동작한다", () => {
    const e = envAt(13, 59, 30);
    const r = rule({
      last_triggered_at: at(13, 59, 20),
      cooldown_seconds: 600,
      conditions: JSON.stringify([{ type: "time", timeMode: "specific", times: [hm(14), hm(18)] }]),
    });
    e.run(NODE, { automationRules: [r] });
    const sched = e.global.get("automationSchedule");
    assert.equal(new Date(sched.s1.nextRunAt).getHours(), 18, "snake_case 쿨다운이 무시된다 — 운영 데이터가 이 표기다");
  });

  test("24시간 넘는 예약은 만들지 않는다 (다음 폴링이 다시 계산)", () => {
    const today = new Date(2026, 7, 29).getDay();
    const dayAfter = (today + 2) % 7;
    const e = envAt(10);
    const r = rule({
      conditions: JSON.stringify([{ type: "time", timeMode: "specific", times: [hm(9)], days: [dayAfter] }]),
    });
    e.run(NODE, { automationRules: [r] });
    assert.equal(e.global.get("automationSchedule").s1, undefined);
  });

  test("enabled=false 규칙은 예약하지 않는다", () => {
    const e = envAt(10);
    e.run(NODE, { automationRules: [rule({ enabled: false })] });
    // vm 경계를 넘어온 객체라 deepEqual(strict) 는 프로토타입에서 걸린다 — 키로 비교
    assert.equal(Object.keys(e.global.get("automationSchedule")).length, 0);
  });

  test("autoDevices 가 비면 예약을 전부 비운다", () => {
    const e = envAt(10, 0, 0, { autoDevices: [], automationSchedule: { old: {} } });
    e.run(NODE, { automationRules: [rule()] });
    assert.equal(Object.keys(e.global.get("automationSchedule")).length, 0);
    assert.equal(e.clock.pending().length, 0);
  });
});

describe("④ RS-485 충돌 방지 stagger", () => {
  test("같은 시각 규칙 2개 → 두 번째는 +500ms", () => {
    const e = envAt(10);
    const r2 = rule({ id: "s2", name: "규칙2", actions: JSON.stringify([{ deviceId: "fan1", command: "off" }]) });
    e.run(NODE, { automationRules: [rule(), r2] });
    const sched = e.global.get("automationSchedule");
    const delays = [sched.s1.delayMs, sched.s2.delayMs].sort((a, b) => a - b);
    assert.equal(delays[1] - delays[0], 500, "동시 발화가 serial 버스에서 충돌한다 — fan-out race 계열");
  });
});

describe("④ 발화와 dedup", () => {
  test("시각 도래 → scheduledRule/Actions 를 port 0 으로 보낸다", () => {
    const e = envAt(13, 59);
    e.run(NODE, { automationRules: [rule()] });
    e.clock.advance(61 * 1000);
    const fired = port(e.sent, 0).filter((m) => m.topic === "scheduled_execution");
    assert.equal(fired.length, 1);
    assert.equal(fired[0].scheduledRule.id, "s1");
    assert.equal(fired[0].scheduledActions.length, 1);
  });

  test("매 폴링 타이머 재생성돼도 실행은 30초 dedup 으로 1회 (v4 설계)", () => {
    const e = envAt(13, 59);
    // Deploy 직후처럼 같은 규칙으로 두 번 폴링 → 타이머 2개
    e.run(NODE, { automationRules: [rule()] });
    e.run(NODE, { automationRules: [rule()] });
    assert.ok(e.clock.pending().length >= 2, "타이머가 매 폴링 재생성돼야 Deploy 후 복구된다");
    e.clock.advance(2 * 60 * 1000);
    const fired = port(e.sent, 0).filter((m) => m.topic === "scheduled_execution");
    assert.equal(fired.length, 1, `dedup 실패 — ${fired.length}번 실행되면 릴레이가 중복 명령을 받는다`);
  });

  test("발화 시점에 수동 모드로 바뀐 장치는 실행하지 않는다", () => {
    const e = envAt(13, 59);
    e.run(NODE, { automationRules: [rule()] });
    e.global.set("autoDevices", []); // 예약 후 사용자가 수동 전환
    e.clock.advance(61 * 1000);
    const fired = port(e.sent, 0).filter((m) => m.topic === "scheduled_execution");
    assert.equal(fired.length, 0, "수동 전환 후에도 자동화가 실행됐다 — 사용자 인지·안전 원칙 위반");
  });

  test("발화 후 다음 실행이 재예약된다 (쿨다운 이후 슬롯)", () => {
    const e = envAt(13, 59);
    const r = rule({ conditions: JSON.stringify([{ type: "time", timeMode: "specific", times: [hm(14), hm(18)] }]) });
    e.run(NODE, { automationRules: [r] });
    e.clock.advance(61 * 1000);
    const sched = e.global.get("automationSchedule");
    assert.ok(sched.s1, "재예약이 안 됐다");
    assert.equal(new Date(sched.s1.nextRunAt).getHours(), 18, "다음 슬롯(18:00)이 아니다");
  });
});
