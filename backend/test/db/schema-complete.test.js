// 리포의 마이그레이션이 실제로 적용되는가 (실제 DB).
//
// 선언 여부는 test/unit/schema-source.test.js 가 소스만 보고 검사한다(DB 불필요).
// 여기서는 그 선언이 **정말 도는 SQL 인가** 를 본다 — 문법 오류나 잘못된 타입은
// 파일을 읽는 것만으로는 드러나지 않고, 새 서버를 세울 때 처음 터진다.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const backend = join(here, "..", "..");
const PRISMA = join(backend, "prisma");

// Prisma 스키마 밖에서 손으로 관리하는 테이블 (복합 PK + 잦은 UPSERT 라 raw SQL 로만 쓴다)
const MANUAL = ["migration-relay-status.sql", "migration-device-positions.sql", "migration-kakao-links.sql", "migration-actuator-status.sql"];

let pool;
let existing = new Set();

before(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  for (const f of MANUAL) {
    await pool.query(readFileSync(join(PRISMA, f), "utf8"));
  }
  const { rows } = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'"
  );
  existing = new Set(rows.map((r) => r.table_name));
});

after(async () => {
  await pool.end();
});

describe("수동 마이그레이션이 빈 DB 에서 실제로 돈다", () => {
  test("파일이 리포에 있다", () => {
    const files = readdirSync(PRISMA);
    for (const f of MANUAL) assert.ok(files.includes(f), `${f} 이 없다`);
  });

  test("prisma db push 로 만들어진 테이블이 있다", () => {
    assert.ok(existing.size > 25, `테이블 ${existing.size}개 — db push 가 안 돌았다`);
    assert.ok(existing.has("sensor_data"));
    assert.ok(existing.has("control_logs"));
    assert.ok(existing.has("system_settings"));
  });

  test("relay_status 가 만들어졌다", () => {
    assert.ok(existing.has("relay_status"));
  });

  test("device_positions 가 만들어졌다", () => {
    assert.ok(existing.has("device_positions"), "새 서버에서 개폐 장치 위치 저장이 실패한다");
  });

  test("device_positions 의 키가 하우스를 포함한다 (다중 하우스, 8/25)", async () => {
    const { rows } = await pool.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'device_positions'::regclass AND contype = 'p'`
    );
    assert.match(rows[0]?.def || "", /farm_id,\s*house_id,\s*device_id/,
      "PK 에 house_id 가 없으면 2동의 같은 장치가 1동을 덮어쓴다");
  });

  test("두 번 적용해도 안전하다 (IF NOT EXISTS)", async () => {
    for (const f of MANUAL) await pool.query(readFileSync(join(PRISMA, f), "utf8"));
  });
});
