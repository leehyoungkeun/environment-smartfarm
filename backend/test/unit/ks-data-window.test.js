// KOAT 116/117 30일 데이터 창 계산 — backend/src/utils/ksDataWindow.js
// 2026-09-12 정전·09-13 농장 이동으로 30일 창이 끊겼는데 아무도 몰랐다. 그 사고를 그대로 재현한다.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { lossPct, addDays, daysBetween, kstToday, analyzeWindow, isActiveSeries } from "../../src/utils/ksDataWindow.js";

describe("isActiveSeries — 삭제한 장치는 지표에서 뺀다", () => {
  test("사고 예방: 9/4 에 지운 ks_test_sw1 은 어제 손실 100% 로 경보가 영원히 울린다", () => {
    const retired = { "2026-09-01": 1440, "2026-09-02": 1440, "2026-09-03": 1440, "2026-09-04": 872 };
    assert.equal(isActiveSeries(retired, "2026-09-14"), false);
  });
  test("오늘 또는 어제 행이 있으면 운영 중", () => {
    assert.equal(isActiveSeries({ "2026-09-14": 5 }, "2026-09-14"), true);
    assert.equal(isActiveSeries({ "2026-09-13": 755 }, "2026-09-14"), true, "이동 중 결손이 커도 기록이 있으면 경보 대상");
  });
  test("어제 0행·오늘 0행이면 운영 중이 아니다 (변이 프로브: 그제만 있음)", () => {
    assert.equal(isActiveSeries({ "2026-09-12": 1440 }, "2026-09-14"), false);
  });
});

/** start 부터 n 일 동안 같은 행 수 */
function fill(start, n, rows = 1440) {
  const out = {};
  for (let i = 0; i < n; i++) out[addDays(start, i)] = rows;
  return out;
}

describe("lossPct — L = (1 − N/1440) × 100", () => {
  test("검정 공식 그대로", () => {
    assert.equal(lossPct(1440), 0);
    assert.equal(lossPct(1404), 2.5);
    assert.equal(lossPct(815), 43.4);
    assert.equal(lossPct(0), 100);
  });
  test("1440 초과(중복 행 등)는 음수 손실이 아니라 0", () => {
    assert.equal(lossPct(1500), 0);
  });
  test("3% 경계 — 1397행은 통과, 1396행은 초과 (변이 프로브)", () => {
    assert.ok(lossPct(1397) <= 3, `1397행 = ${lossPct(1397)}%`);
    assert.ok(lossPct(1396) > 3, `1396행 = ${lossPct(1396)}%`);
  });
});

describe("날짜 계산", () => {
  test("월·연 경계", () => {
    assert.equal(addDays("2026-09-30", 1), "2026-10-01");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  });
  test("daysBetween", () => {
    assert.equal(daysBetween("2026-09-14", "2026-10-14"), 30);
    assert.equal(daysBetween("2026-10-14", "2026-09-14"), -30);
  });
  test("KST 오늘 — UTC 15시 이후는 한국 다음 날", () => {
    assert.equal(kstToday(new Date("2026-09-13T14:59:00Z")), "2026-09-13");
    assert.equal(kstToday(new Date("2026-09-13T15:00:00Z")), "2026-09-14");
  });
});

describe("analyzeWindow — 30일 창", () => {
  test("사고 재현: 9/12 정전·9/13 이동 → 창이 오늘부터 다시 시작, 입고 가능일 10/14", () => {
    const counts = {
      "2026-09-04": 443, "2026-09-05": 1350,
      ...fill("2026-09-06", 6),                   // 9/6~9/11 손실 0%
      "2026-09-12": 815, "2026-09-13": 755,       // 43.40% · 47.57%
      "2026-09-14": 609,                          // 오늘(진행 중)
    };
    const r = analyzeWindow(counts, "2026-09-14");
    assert.equal(r.yesterdayLoss, 47.57);
    assert.equal(r.windowDays, 0, "어제가 끊겼으면 연속 일수는 0");
    assert.equal(r.lastBrokenDay, "2026-09-13");
    assert.equal(r.windowStart, "2026-09-14");
    assert.equal(r.readyOn, "2026-10-14");
    assert.equal(r.ready, false);
  });

  test("끊기기 전날까지는 6일 연속이었다 — 9/12 기준으로 보면 9/6~9/11", () => {
    const counts = { "2026-09-05": 1350, ...fill("2026-09-06", 6) };
    const r = analyzeWindow(counts, "2026-09-12");
    assert.equal(r.windowDays, 6);
    assert.equal(r.lastBrokenDay, "2026-09-05", "9/5 는 6.25% 라 창 밖");
    assert.equal(r.windowStart, "2026-09-06");
    assert.equal(r.readyOn, "2026-10-06");
  });

  test("행이 아예 없는 날은 100% 손실 — 조용한 공백이 창을 끊는다", () => {
    const counts = fill("2026-08-01", 44);          // 8/1 ~ 9/13
    delete counts["2026-09-10"];
    const r = analyzeWindow(counts, "2026-09-14");
    assert.equal(r.windowDays, 3, "9/11·12·13");
    assert.equal(r.lastBrokenDay, "2026-09-10");
  });

  test("30일 넘게 깨끗하면 입고 가능", () => {
    const r = analyzeWindow(fill("2026-08-10", 35), "2026-09-14");
    assert.equal(r.windowDays, 35);
    assert.equal(r.lastBrokenDay, null, "기록 시작 전은 끊김으로 세지 않는다");
    assert.equal(r.ready, true);
  });

  test("오늘은 판정에서 뺀다 — 진행 중인 날의 적은 행 수가 창을 끊지 않는다", () => {
    const counts = { ...fill("2026-09-01", 13), "2026-09-14": 10 };
    const r = analyzeWindow(counts, "2026-09-14");
    assert.equal(r.windowDays, 13);
  });

  test("3% 경계에서 창을 끊는지 (변이 프로브)", () => {
    const base = fill("2026-09-01", 13);
    assert.equal(analyzeWindow({ ...base, "2026-09-13": 1397 }, "2026-09-14").windowDays, 13);
    assert.equal(analyzeWindow({ ...base, "2026-09-13": 1396 }, "2026-09-14").windowDays, 0);
  });

  test("기록이 없으면 판단하지 않는다", () => {
    const r = analyzeWindow({}, "2026-09-14");
    assert.equal(r.windowStart, null);
    assert.equal(r.readyOn, null);
    assert.equal(r.ready, false);
  });

  test("오늘 처음 기록이 생긴 장치 — 오늘부터 30일", () => {
    const r = analyzeWindow({ "2026-09-14": 30 }, "2026-09-14");
    assert.equal(r.windowStart, "2026-09-14");
    assert.equal(r.readyOn, "2026-10-14");
  });
});
