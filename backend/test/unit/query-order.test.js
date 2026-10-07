// 조회 정렬 — 최신이 위, 그리고 **잘릴 때 최신이 남아야 한다** (2026-10-07).
//
// 결함: `ORDER BY timestamp ASC LIMIT n` 이었다. 30일 조회가 한도(5만·20만)를 넘으면
//   **가장 오래된 n 건만 주고 최신을 통째로 버렸다.** 화면에서 뒤집어도 최신이 아니다.
//   같은 함정이 전에도 있었다 — 키오스크 그래프의 로컬 NR history 가 ASC LIMIT 이라
//   "오래된 것만" 보였다 (2026-08-31).
//
// 규칙
//   · DB 조회는 DESC + LIMIT   → 잘리면 오래된 쪽이 잘린다
//   · 화면(JSON)은 그대로       → 최신이 위
//   · 파일(CSV·TXT)은 뒤집는다  → 시계열 자료는 시간순이 관례
//   · 그래프는 시간순으로 정렬   → 안 그러면 가로축이 거꾸로 간다

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, "..", "..", p), "utf8");

describe("조회 SQL — 최신부터 가져온다", () => {
  test("센서 원시 추출은 DESC", () => {
    const src = read("src/routes/sensors.js");
    assert.match(src, /ORDER BY "timestamp" DESC LIMIT \$5/, "ASC LIMIT 이면 최신이 잘린다");
    assert.ok(!/ORDER BY "timestamp" ASC LIMIT/.test(src), "ASC LIMIT 이 남아 있다");
  });

  test("표준 센서 1분 행도 DESC", () => {
    const src = read("src/routes/sensor-status.routes.js");
    assert.match(src, /ORDER BY "timestamp" DESC, unit ASC, idx ASC LIMIT/);
  });

  test("파일 추출은 시간순으로 되돌린다 — 시계열을 거꾸로 주지 않는다", () => {
    assert.match(read("src/routes/sensors.js"), /table\.reverse\(\)/);
    assert.match(read("src/routes/sensor-status.routes.js"), /rows\.reverse\(\)/);
  });

  test("화면 응답은 최신이 위라고 밝힌다 (order: desc)", () => {
    assert.match(read("src/routes/sensors.js"), /order: "desc"/);
    assert.match(read("src/routes/sensor-status.routes.js"), /order: "desc"/);
  });
});

describe("화면 그래프 — 표는 최신순이어도 가로축은 시간순", () => {
  test("DataExplorer 가 그래프 점을 시간순으로 정렬한다", () => {
    const src = read("../frontend/src/components/Dashboard/DataExplorer.jsx");
    assert.match(src, /\.sort\(\(a, b\) => new Date\(a\.t\) - new Date\(b\.t\)\)/);
  });
});
