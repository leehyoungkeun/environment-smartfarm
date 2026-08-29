// 코드가 쓰는 테이블이 리포의 스키마에 선언돼 있는가 (DB 불필요).
//
// 2026-08-29: 운영 DB 에는 relay_status·device_positions 가 있는데 Prisma 스키마에는 없었고,
// device_positions 는 DDL 이 리포 어디에도 없었다. 새 서버에 설치하면 그 테이블이 없는 채로
// 시작해 개폐 장치 위치 저장이 통째로 실패한다. 운영 DB 를 손으로 고치고 코드에 남기지 않으면
// 재해 복구와 신규 서버가 조용히 깨진다.
//
// "DB 에 있는가" 를 보면 이미 손으로 만들어 둔 DB 에서는 늘 통과한다. 그래서 여기서는
// **리포의 선언만** 본다 — schema.prisma 의 모델/@@map 과 prisma/*.sql 의 CREATE TABLE.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const backend = join(here, "..", "..");
const SRC = join(backend, "src");
const PRISMA = join(backend, "prisma");

function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...jsFiles(p));
    else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}

/** 리포가 선언하는 테이블 — Prisma 모델 + 손으로 쓴 마이그레이션 */
function declaredTables() {
  const t = new Set();
  const schema = readFileSync(join(PRISMA, "schema.prisma"), "utf8");
  for (const m of schema.matchAll(/^model\s+(\w+)\s*\{/gm)) t.add(m[1].toLowerCase());
  for (const m of schema.matchAll(/@@map\("([^"]+)"\)/g)) t.add(m[1].toLowerCase());
  for (const f of readdirSync(PRISMA).filter((x) => x.endsWith(".sql"))) {
    const sql = readFileSync(join(PRISMA, f), "utf8");
    for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) {
      t.add(m[1].toLowerCase());
    }
    for (const m of sql.matchAll(/CREATE\s+(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/gi)) {
      t.add(m[1].toLowerCase());
    }
  }
  return t;
}

/** raw SQL 이 참조하는 테이블 */
function referencedTables() {
  const found = new Map();
  for (const f of jsFiles(SRC)) {
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/[`"']([^`"']*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^`"']*)[`"']/g)) {
      const sql = m[1].replace(/EXTRACT\s*\([^)]*\)/gi, " ");
      const re = /\b(?:FROM|JOIN|INTO|UPDATE)\s+(?:ONLY\s+)?([a-z_][a-z0-9_]*)\s*(\(?)/g;
      let t;
      while ((t = re.exec(sql))) {
        if (t[2] === "(") continue; // 함수 호출
        const name = t[1].toLowerCase();
        if (!found.has(name)) found.set(name, f.slice(backend.length + 1));
      }
    }
  }
  return found;
}

// SQL 키워드·카탈로그 등 우리 테이블이 아닌 것
const NOT_TABLES = new Set([
  "select", "lateral", "unnest", "values", "set", "only",
  "public", "information_schema", "pg_catalog", "pg_extension", "pg_stat_activity",
]);

// 리포에도 운영 DB 에도 없는 테이블 — 호출되면 반드시 실패한다. 숨기지 않고 이유와 함께 남긴다.
const KNOWN_MISSING = new Map([
  [
    "daily_summaries",
    "POST /internal/daily-summary (레거시 NR f7 일일집계). 운영 DB 에도 테이블이 없어 호출되면 항상 500. " +
      "로그상 호출된 적이 없다. 표를 만들 것인지 엔드포인트를 지울 것인지 결정 필요 (2026-08-29 발견).",
  ],
]);

describe("스키마가 단일 출처다", () => {
  test("Prisma 모델과 마이그레이션에서 테이블 선언을 읽어낸다", () => {
    const d = declaredTables();
    assert.ok(d.has("sensor_data"), "Prisma @@map 파싱 실패");
    assert.ok(d.size > 25, `선언된 테이블 ${d.size}개 — 파싱이 깨졌다`);
  });

  test("relay_status 가 리포에 선언돼 있다", () => {
    assert.ok(declaredTables().has("relay_status"), "prisma/migration-relay-status.sql 이 사라졌다");
  });

  test("device_positions 가 리포에 선언돼 있다", () => {
    assert.ok(
      declaredTables().has("device_positions"),
      "device_positions DDL 이 리포에 없다 — 새 서버에서 개폐 장치 위치 저장이 실패한다 (2026-08-29 실제 사례)"
    );
  });

  test("코드가 쓰는 테이블은 전부 리포에 선언돼 있다", () => {
    const declared = declaredTables();
    const missing = [];
    for (const [name, file] of referencedTables()) {
      if (NOT_TABLES.has(name) || declared.has(name) || KNOWN_MISSING.has(name)) continue;
      missing.push(`${name} (${file})`);
    }
    assert.deepEqual(
      missing,
      [],
      ["선언되지 않은 테이블을 코드가 쓴다 — 운영 DB 만 손으로 고친 것이다:", ...missing].join("\n  ")
    );
  });

  test("이미 아는 결손 목록이 늘지 않았다", () => {
    assert.deepEqual(
      [...KNOWN_MISSING.keys()],
      ["daily_summaries"],
      "결손 목록이 바뀌었다 — 해결했으면 지우고, 새로 생겼으면 원인을 적을 것"
    );
  });
});
