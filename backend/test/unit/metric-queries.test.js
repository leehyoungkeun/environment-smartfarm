// 지표 SQL 정적 검사 — "쿼리가 실패하면 지표가 통째로 사라진다"를 막는다.
//
// 2026-08-29 사고: sensor_last_seen 지표에 `JOIN farms` 를 넣으면서 SELECT 의 farm_id 를
// 테이블로 한정하지 않아 "column reference farm_id is ambiguous" 가 났다. catch 안의
// reset() 이 전 농장 지표를 지웠고, 그 15분 동안 SensorDataStalled 는 어느 농장에도
// 울릴 수 없는 상태였다. 지표가 "틀린 값" 이 아니라 "없는 값" 이 되는 것이 이 설계의 위험이다.
//
// app.js 를 import 하면 서버·스케줄러가 뜨므로(startServer 무조건 실행), 여기서는 소스를
// 텍스트로 읽어 SQL 을 정적 검사한다. DB 도 서버도 필요 없다.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../src/app.js", import.meta.url), "utf8");

/** collect() 안의 백틱 SQL 을 모두 뽑는다 */
function extractQueries(text) {
  const out = [];
  const re = /pool\.query\(\s*`([\s\S]*?)`/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

const queries = extractQueries(src);

describe("지표 SQL — 모호한 컬럼 참조가 없다", () => {
  test("지표 쿼리를 찾았다 (파싱 자체가 깨지면 실패)", () => {
    assert.ok(queries.length >= 5, `pool.query 를 ${queries.length}개만 찾음 — 파서 확인 필요`);
  });

  // JOIN 이 있는 쿼리는 SELECT·GROUP BY 의 컬럼이 반드시 테이블로 한정돼야 한다.
  // 한정하지 않으면 Postgres 가 ambiguous 로 거절하고, 그 지표는 사라진다.
  const joined = queries.filter((q) => /\bJOIN\b/i.test(q));

  test("JOIN 이 있는 쿼리가 존재한다", () => {
    assert.ok(joined.length > 0, "JOIN 쿼리가 없다면 이 검사는 의미가 없다");
  });

  for (const [i, q] of joined.entries()) {
    const oneLine = q.replace(/\s+/g, " ").trim().slice(0, 70);

    test(`JOIN #${i + 1} SELECT 컬럼이 한정돼 있다 — ${oneLine}`, () => {
      const sel = q.match(/SELECT\s+([\s\S]*?)\s+FROM/i);
      assert.ok(sel, "SELECT ... FROM 을 찾지 못함");
      // farm_id / house_id 처럼 양쪽 테이블에 다 있는 컬럼은 접두사가 필요하다
      const risky = ["farm_id", "house_id"];
      for (const col of risky) {
        // "sd.farm_id" 처럼 접두사가 붙었거나, 아예 안 쓰였으면 OK
        const bare = new RegExp(`(^|[\\s,(])${col}\\b`, "i");
        if (bare.test(sel[1])) {
          assert.fail(`SELECT 에 한정되지 않은 ${col} — JOIN 시 ambiguous 로 지표가 사라진다:\n${q.trim()}`);
        }
      }
    });

    test(`JOIN #${i + 1} GROUP BY 컬럼이 한정돼 있다 — ${oneLine}`, () => {
      const grp = q.match(/GROUP\s+BY\s+([^`]*?)(?:ORDER|HAVING|LIMIT|$)/i);
      if (!grp) return; // GROUP BY 없으면 해당 없음
      for (const col of ["farm_id", "house_id"]) {
        const bare = new RegExp(`(^|[\\s,])${col}\\b`, "i");
        if (bare.test(grp[1])) {
          assert.fail(`GROUP BY 에 한정되지 않은 ${col}:\n${q.trim()}`);
        }
      }
    });
  }
});

describe("지표 SQL — 오늘 만든 규칙이 유지된다", () => {
  const all = queries.join("\n---\n");

  test("센서 지표는 시뮬레이션 값을 제외한다", () => {
    const sensorQ = queries.filter((q) => /FROM\s+sensor_data/i.test(q));
    assert.ok(sensorQ.length > 0, "sensor_data 쿼리를 찾지 못함");
    for (const q of sensorQ) {
      assert.match(
        q,
        /quality'\)\s*IS DISTINCT FROM\s*'simulated'/i,
        `시뮬레이션 제외가 빠진 센서 쿼리:\n${q.trim()}`
      );
    }
  });

  test("센서/릴레이 지표는 운영 중(active) 농장만 센다", () => {
    const needFilter = queries.filter((q) => /FROM\s+(sensor_data|relay_status)/i.test(q));
    for (const q of needFilter) {
      assert.match(
        q,
        /f\.status\s*=\s*'active'/i,
        `점검중 농장이 섞이는 쿼리 — 오탐의 원인:\n${q.trim()}`
      );
    }
  });

  test("지표 collect() 의 catch 는 반드시 reset() 한다", () => {
    // 지표 collect 안의 catch 에 reset() 이 없으면, DB 오류 시 마지막 정상값이 그대로 남아
    // 장애 중에도 "정상" 으로 보인다(2026-08-27 에 고친 것). 지표 정의 블록만 검사한다 —
    // ensureAdmin 의 마이그레이션 실패 무시처럼 의도된 빈 catch 는 대상이 아니다.
    const gauges = src.split("new promClient.Gauge(").slice(1);
    assert.ok(gauges.length >= 8, `Gauge 를 ${gauges.length}개만 찾음 — 파서 확인 필요`);

    const bad = [];
    for (const g of gauges) {
      const body = g.slice(0, g.indexOf("\n});") + 1);
      const nameM = body.match(/name:\s*"([a-z_]+)"/i);
      const name = nameM ? nameM[1] : "(이름 미상)";
      if (!/async collect\(\)/.test(body)) continue; // collect 없는 단순 게이지는 해당 없음
      for (const m of body.matchAll(/catch\s*(?:\([^)]*\))?\s*\{([\s\S]*?)\}/g)) {
        const inner = m[1]
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("//") && !l.startsWith("/*") && !l.startsWith("*"));
        // reset() 이거나 set(0) 이어야 한다.
        //   reset()  — 여러 농장의 값을 내는 지표: 값이 사라져야 거짓 신호가 안 남는다
        //   set(0)   — 생존 신호(db_up, mqtt_connected): 0 이라는 **양의 신호**가 있어야
        //              규칙이 발동한다. 여기서 reset 하면 지표가 없어져 알림이 못 울린다.
        const ok = inner.some((l) => /\breset\(\)/.test(l) || /\bset\(\s*0\s*\)/.test(l));
        if (!ok) bad.push(name);
      }
    }
    assert.deepEqual(bad, [], `catch 에 reset() 이 없는 지표: ${bad.join(", ")}`);
  });
});
