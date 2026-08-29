// 경보 판정 순수 함수 — sensorThresholdAlert.js 의 실제 판정 로직을 직접 실행한다.
//
// 근거가 된 실제 함정 (feedback_alert_system_traps, 2026-08-26 점검):
//   - 경보 임계값에 센서 측정범위를 넣으면 물리적으로 알림이 영원히 안 울린다
//     (XY-MD02 는 -40~80°C 까지 재니, max=80 이면 하우스가 타도 조용하다)
//   - criticalRatio 판정이 잘못되면 CRITICAL 이 안 뜨거나 전부 CRITICAL 이 된다
//
// 판정이 조용히 틀리는 것이 이 도메인의 최악이다 — 알림이 안 오면 아무도 모른다.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  guessSensorType,
  getThresholds,
  calcSeverity,
  DEFAULT_THRESHOLDS,
} from "../../src/schedulers/sensorThresholdAlert.js";

describe("sensorId 로 센서 타입 추론", () => {
  const cases = [
    ["temp_1", "temperature"],
    ["temperature", "temperature"],
    ["humi_2", "humidity"],
    ["humidity", "humidity"],
    ["co2_sensor", "co2"],
    ["ec_1", "ec"],
    ["ec", "ec"],
    ["ph_1", "ph"],
    ["ph", "ph"],
    ["soil_moisture", null], // 모르는 센서는 추측하지 않는다 — 엉뚱한 임계값이 더 위험
  ];
  for (const [id, expected] of cases) {
    test(`${id} → ${expected}`, () => {
      assert.equal(guessSensorType(id), expected);
    });
  }
});

describe("임계값 결정 우선순위", () => {
  test("하우스 설정의 min/max 가 최우선", () => {
    const t = getThresholds({ min: 10, max: 35 }, "temp_1");
    assert.deepEqual(t, { min: 10, max: 35 });
  });

  test("min 만 설정해도 설정을 쓴다 (기본값으로 폴백하지 않는다)", () => {
    const t = getThresholds({ min: 10 }, "temp_1");
    assert.deepEqual(t, { min: 10, max: null });
  });

  test("설정이 없으면 sensorId 추론 → 기본 임계값", () => {
    assert.deepEqual(getThresholds(undefined, "temp_1"), DEFAULT_THRESHOLDS.temperature);
  });

  test("추론도 안 되면 null — 판단 불가면 침묵이 아니라 스킵으로 명시", () => {
    assert.equal(getThresholds(undefined, "soil_moisture"), null);
  });
});

describe("기본 임계값의 물리적 타당성 (측정범위 함정)", () => {
  test("모든 기본 임계값은 min < max", () => {
    for (const [type, { min, max }] of Object.entries(DEFAULT_THRESHOLDS)) {
      assert.ok(min < max, `${type}: min=${min} >= max=${max}`);
    }
  });

  test("온도 상한이 센서 측정 한계(80°C)가 아니다 — 측정범위를 넣으면 영원히 안 울린다", () => {
    assert.ok(DEFAULT_THRESHOLDS.temperature.max < 60,
      `temperature.max=${DEFAULT_THRESHOLDS.temperature.max} — XY-MD02 는 80°C 까지 재므로 그 근처 값이면 경보가 물리적으로 불가능하다`);
  });

  test("습도 상한이 100% 가 아니다", () => {
    assert.ok(DEFAULT_THRESHOLDS.humidity.max < 100,
      "습도 max=100 이면 센서가 낼 수 없는 값이라 경보가 영원히 안 울린다");
  });
});

describe("심각도 판정 (criticalRatio)", () => {
  // 기본 온도: min 5, max 40 → range 35, ratio 0.5 → 상한 초과폭 17.5 이상이면 CRITICAL
  const { min, max } = DEFAULT_THRESHOLDS.temperature;

  test("상한 살짝 초과 → WARNING", () => {
    assert.equal(calcSeverity(41, min, max, 0.5), "WARNING");
  });

  test("상한을 range 의 50% 이상 초과 → CRITICAL (57.5°C)", () => {
    assert.equal(calcSeverity(57.5, min, max, 0.5), "CRITICAL");
    assert.equal(calcSeverity(57.4, min, max, 0.5), "WARNING", "경계 직전은 WARNING");
  });

  test("하한 미달도 같은 비율 규칙 (5 - 17.5 = -12.5)", () => {
    assert.equal(calcSeverity(4, min, max, 0.5), "WARNING");
    assert.equal(calcSeverity(-12.5, min, max, 0.5), "CRITICAL");
  });

  test("criticalRatio 를 낮추면 더 빨리 CRITICAL (농장별 설정)", () => {
    assert.equal(calcSeverity(44, min, max, 0.1), "CRITICAL"); // 초과 4 ≥ 35*0.1
    assert.equal(calcSeverity(44, min, max, 0.5), "WARNING");
  });

  test("범위 안 값은 WARNING (호출부가 초과 확인 후 부르는 전제)", () => {
    assert.equal(calcSeverity(20, min, max, 0.5), "WARNING");
  });

  test("min 만 있는 임계값은 range≤0 이라 CRITICAL 이 불가능하다 (현재 동작 고정)", () => {
    // (max ?? 0) - (min ?? 0) = -min → range<=0 → 무조건 WARNING.
    // 하한 전용 센서(최저온도 등)는 아무리 심해도 CRITICAL 이 안 된다는 뜻 —
    // 의도라기보다 한계다. 바꾸면 이 테스트를 갱신하고 심각도 정책을 명시할 것.
    assert.equal(calcSeverity(-100, 5, null, 0.5), "WARNING");
  });
});
