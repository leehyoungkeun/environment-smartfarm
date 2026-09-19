// 표준·비표준 저장 정책 통일 (2026-09-19) — 1분 시계열 표는 sensor_data 와 같게 "7일 뒤 압축, 삭제 없음".
// 실제 TimescaleDB 에 migration-ks-compression.sql 을 적용하고:
//   ① actuator_status·ks_sensor_status 에 7일 압축 정책이 있고 삭제(retention) 정책은 없다
//   ② 압축된 청크에 같은 키가 다시 와도(NR 큐 재전송) 오류 없이 무시된다 — segmentby 가 PK 를 덮어야 하는 이유
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const prisma = join(here, "..", "..", "prisma");
const FARM = "farm_sptest";
let pool;

before(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  for (const f of ["migration-actuator-status.sql", "migration-ks-sensor-status.sql", "migration-ks-compression.sql"]) {
    await pool.query(readFileSync(join(prisma, f), "utf8"));
  }
  // 두 번 적용해도 된다 (운영에서 배포마다 다시 돌려도 안전)
  await pool.query(readFileSync(join(prisma, "migration-ks-compression.sql"), "utf8"));
});

after(async () => {
  for (const t of ["actuator_status", "ks_sensor_status"]) {
    await pool.query(`SELECT decompress_chunk(c, true) FROM show_chunks('${t}') c`).catch(() => {});
    await pool.query(`DELETE FROM ${t} WHERE farm_id = $1`, [FARM]).catch(() => {});
  }
  await pool.end();
});

const jobsOf = async (t) => (await pool.query(
  "SELECT proc_name, config FROM timescaledb_information.jobs WHERE hypertable_name = $1", [t])).rows;

describe("1분 시계열 표 저장 정책", () => {
  for (const t of ["actuator_status", "ks_sensor_status"]) {
    test(`${t}: 7일 압축, 삭제 정책 없음 — sensor_data 와 같다`, async () => {
      const jobs = await jobsOf(t);
      const comp = jobs.find((j) => j.proc_name === "policy_compression");
      assert.ok(comp, `${t} 에 압축 정책이 없다`);
      assert.equal(comp.config.compress_after, "7 days");
      assert.ok(!jobs.some((j) => j.proc_name === "policy_retention"), `${t} 에 삭제 정책이 있다 — 운영 기록은 지우지 않는다`);
    });
  }

  test("압축된 청크에 같은 키 재전송 → 오류 없이 무시 (actuator_status)", async () => {
    const ts = new Date(Date.now() - 20 * 86400000);
    const ins = `INSERT INTO actuator_status ("timestamp", farm_id, house_id, device_id, unit, kind, n, status, status_name, remain, opid, source)
                 VALUES ($1, $2, 'house_0001', 'cooler1', 2, 'switch', 4, 201, 'ON', 0, 0, 'vendor') ON CONFLICT DO NOTHING`;
    assert.equal((await pool.query(ins, [ts, FARM])).rowCount, 1);
    await pool.query(`SELECT compress_chunk(c, true) FROM show_chunks('actuator_status', older_than => INTERVAL '7 days') c`);
    const again = await pool.query(ins, [ts, FARM]);
    assert.equal(again.rowCount, 0, "압축 청크에서 중복이 들어갔다");
    const { rows } = await pool.query("SELECT count(*)::int c, max(source) s FROM actuator_status WHERE farm_id = $1", [FARM]);
    assert.deepEqual(rows[0], { c: 1, s: "vendor" });
  });

  test("압축된 청크에 같은 키 재전송 → 오류 없이 무시 (ks_sensor_status)", async () => {
    const ts = new Date(Date.now() - 20 * 86400000);
    const ins = `INSERT INTO ks_sensor_status ("timestamp", farm_id, unit, idx, code, name, value, status, status_name)
                 VALUES ($1, $2, 2, 4, 2, '습도1', 68.9, 0, 'READY') ON CONFLICT DO NOTHING`;
    assert.equal((await pool.query(ins, [ts, FARM])).rowCount, 1);
    await pool.query(`SELECT compress_chunk(c, true) FROM show_chunks('ks_sensor_status', older_than => INTERVAL '7 days') c`);
    assert.equal((await pool.query(ins, [ts, FARM])).rowCount, 0);
  });
});
