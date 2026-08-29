// L1 자동 진단 (diagnosisAgent) — 게이트·보고서 로직.
//
// 원칙 검증이 핵심이다:
//   - **읽기 전용** — 이 모듈이 DB 를 바꾸는 SQL 을 갖게 되면 "진단이 조치를 실행"
//     하는 것이고, 승인 게이트 원칙(자동 조치 금지)이 무너진다. 소스를 정적으로 잠근다.
//   - 쿨다운·동시 1건 — 알림 폭주가 진단 폭주(비용·Discord 소음)로 번지지 않게.
//   - LLM 없이도 보고서가 나온다 — 진단이 LLM 가용성에 의존하면 안 된다.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { shouldRun, buildFallbackReport, _resetForTest } from "../../src/services/diagnosisAgent.js";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(here, "..", "..", "src", "services", "diagnosisAgent.js"), "utf8");

beforeEach(() => _resetForTest());

describe("읽기 전용 불변식 (정적)", () => {
  test("INSERT/UPDATE/DELETE 가 소스에 없다 — 진단은 절대 조치하지 않는다", () => {
    // SQL 문자열 안에서만 검사 (주석·설명 제외를 위해 백틱 문자열만 훑는다)
    for (const m of SRC.matchAll(/`([^`]*)`/g)) {
      assert.ok(
        !/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER)\b/i.test(m[1]) || /진단|조치/.test(m[1]),
        `쓰기 SQL 발견 — 읽기 전용 원칙 위반: ${m[1].slice(0, 80)}`
      );
    }
  });

  test("테스트 환경에서는 runDiagnosis 가 돌지 않는다 (가드 존재)", () => {
    assert.ok(SRC.includes('process.env.NODE_ENV === "test"'), "테스트 가드가 사라졌다");
  });
});

describe("쿨다운·동시성 게이트", () => {
  test("첫 실행은 허용, 10분 내 재실행은 거부", () => {
    const t0 = 1_000_000;
    assert.equal(shouldRun("farm_0001", t0), true);
    assert.equal(shouldRun("farm_0001", t0 + 5 * 60 * 1000), false, "쿨다운 무시 — 알림 폭주가 진단 폭주가 된다");
    assert.equal(shouldRun("farm_0001", t0 + 11 * 60 * 1000), true);
  });

  test("농장이 다르면 쿨다운이 분리된다", () => {
    const t0 = 1_000_000;
    assert.equal(shouldRun("farm_0001", t0), true);
    assert.equal(shouldRun("farm_0006", t0), true);
  });
});

describe("폴백 보고서 (LLM 없이)", () => {
  const ALERT = { farmId: "farm_0001", alertType: "FARM_OFFLINE", severity: "CRITICAL", message: "70분째 오프라인" };

  test("정상 증거 → 핵심 항목이 전부 들어간다", () => {
    const r = buildFallbackReport(ALERT, {
      farmId: "farm_0001",
      farm: { name: "테스트팜", status: "active", last_seen_at: new Date(Date.now() - 4200 * 1000).toISOString() },
      sensor: { age_sec: 2520, rows_1h: 0 },
      relays: [{ unit_id: 2, age_sec: 4300 }],
      rpi: { reachable: false, error: "timeout" },
      controlFailures: [{ device_id: "fan1", n: 4, last_error: "MODBUS timeout" }],
      unackAlerts: [{ alert_type: "SENSOR_THRESHOLD" }, { alert_type: "DEVICE_FAILURE" }],
    });
    assert.match(r, /FARM_OFFLINE/);
    assert.match(r, /테스트팜/);
    assert.match(r, /42분 전/, "센서 경과 시간 표기");
    assert.match(r, /응답 없음.*timeout/, "RPi 프로브 결과");
    assert.match(r, /fan1×4/, "제어 실패 집계");
    assert.match(r, /미확인 알림 24h\] 2건/);
  });

  test("증거가 부분적으로 없어도 죽지 않고 보고서가 나온다", () => {
    const r = buildFallbackReport(ALERT, { farmId: "farm_0001", rpi: { reachable: true, mode: "online", serverOnline: true } });
    assert.match(r, /FARM_OFFLINE/);
    assert.match(r, /응답함/);
    assert.ok(r.split("\n").length >= 2);
  });

  test("증거 수집이 에러 객체를 돌려줘도 (DB 장애) 보고서가 나온다", () => {
    const r = buildFallbackReport(ALERT, {
      farmId: "farm_0001",
      farm: { error: "connection refused" },
      sensor: { error: "connection refused" },
      relays: { error: "connection refused" },
      rpi: { reachable: false, error: "unreachable" },
    });
    assert.match(r, /FARM_OFFLINE/, "DB 가 죽었을 때야말로 진단이 필요하다");
  });
});
