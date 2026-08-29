// 카카오 농장 연동 (2단계+3단계) — 실제 라우트 + 실제 DB.
//
// 고객 농장 데이터가 봇 프롬프트에 들어가는 기능이라, 연동(신원 확인)이 뚫리면
// 남의 농장 상태가 새는 것이다. 등록 코드 검증·무차별 대입 방어·접수(3단계)를
// 실제 HTTP 흐름으로 잠근다. LLM 은 TEST_MODE 가 차단 — 분기·형식만 본다.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import pg from "pg";

const FARM = "farm_kktest";
const SECRET = "test-kakao-skill-secret"; // setup.js 가 고정
const PATH = `/api/kakao/chat/${SECRET}`;
let app;
let pool;
let CODE;
let resetKakao;
let resetRate;

beforeEach(() => resetKakao?.()); // 자기 레이트리밋(분당 10회/IP)에 안 걸리게

const body = (uid, utter) => ({ userRequest: { user: { id: uid }, utterance: utter } });
const say = (uid, utter) => request(app).post(PATH).send(body(uid, utter));
const textOf = (res) => res.body?.template?.outputs?.[0]?.simpleText?.text || "";

before(async () => {
  app = (await import("../../src/app.js")).default;
  const kk = await import("../../src/routes/kakao.routes.js");
  resetKakao = kk._resetKakaoStateForTest;
  resetRate = kk._resetKakaoRateForTest;
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  await pool.query(
    `INSERT INTO farms (id, farm_id, name, status, api_key, kakao_link_code, created_at, updated_at)
     VALUES ($1,$1,'연동테스트팜','active','test-key-'||$1,'KK'||substr(md5($1),1,4),now(),now())
     ON CONFLICT (farm_id) DO UPDATE SET status='active'`,
    [FARM]
  );
  const { rows } = await pool.query("SELECT kakao_link_code FROM farms WHERE farm_id = $1", [FARM]);
  CODE = rows[0].kakao_link_code;
});

after(async () => {
  await pool.query("DELETE FROM kakao_links WHERE farm_id = $1", [FARM]).catch(() => {});
  await pool.query("DELETE FROM alerts WHERE farm_id = $1", [FARM]).catch(() => {});
  await pool.query("DELETE FROM farms WHERE farm_id = $1", [FARM]).catch(() => {});
  await pool.end();
});

describe("농장 등록 흐름", () => {
  // beforeEach 가 대화 상태를 지우므로 각 테스트는 자기완결로 등록부터 한다

  test("'농장 등록' → 코드 입력 안내", async () => {
    const res = await say("kk-u1", "농장 등록");
    assert.match(textOf(res), /등록 코드/);
  });

  test("올바른 코드(소문자 허용) → 연동 완료 + DB 행 생성", async () => {
    await say("kk-u2", "농장 등록");
    const res = await say("kk-u2", CODE.toLowerCase());
    assert.match(textOf(res), /연동되었습니다/);
    const { rows } = await pool.query("SELECT farm_id FROM kakao_links WHERE kakao_user_id = 'kk-u2'");
    assert.equal(rows[0]?.farm_id, FARM);
  });

  test("연동된 사용자의 일반 질문 → 상태 스냅샷이 주입된다", async () => {
    await say("kk-u3", "농장 등록");
    await say("kk-u3", CODE);
    const res = await say("kk-u3", "지금 상태 어때?");
    assert.match(textOf(res), /\[상태연동\]/, "연동됐는데 농장 상태가 프롬프트에 안 붙는다 — 일반 챗봇과 다를 게 없다");
  });

  test("'농장 해제' → 행 삭제, 스냅샷도 사라진다", async () => {
    await say("kk-u4", "농장 등록");
    await say("kk-u4", CODE);
    await say("kk-u4", "농장 해제");
    const { rows } = await pool.query("SELECT 1 FROM kakao_links WHERE kakao_user_id = 'kk-u4'");
    assert.equal(rows.length, 0);
    const res = await say("kk-u4", "지금 상태 어때?");
    assert.ok(!textOf(res).includes("[상태연동]"), "해제했는데 남의 농장 상태가 계속 주입된다");
  });
});

describe("등록 코드 방어", () => {
  test("틀린 코드 → 거절, 연동 없음", async () => {
    const UID = "kk-user-wrong";
    await say(UID, "농장 등록");
    const res = await say(UID, "ZZZZZZ");
    assert.match(textOf(res), /올바르지 않습니다/);
    const { rows } = await pool.query("SELECT 1 FROM kakao_links WHERE kakao_user_id = $1", [UID]);
    assert.equal(rows.length, 0);
  });

  test("★ 5회 초과 시도 → 잠금 (무차별 대입 차단)", async () => {
    const UID = "kk-user-brute";
    let locked = false;
    for (let i = 0; i < 7; i++) {
      resetRate(); // 브루트 시나리오 자체가 분당 10회 리밋에 걸리지 않게 — 코드 카운터는 유지
      await say(UID, "농장 등록");
      const res = await say(UID, `WRON${i}`);
      if (/초과했습니다/.test(textOf(res))) { locked = true; break; }
    }
    assert.ok(locked, "무한 시도 가능 — 6자리 코드는 결국 뚫린다 (남의 농장 상태 유출)");
  });

  test("중지된 농장 코드로는 연동되지 않는다", async () => {
    await pool.query("UPDATE farms SET status='suspended' WHERE farm_id=$1", [FARM]);
    const UID = "kk-user-susp";
    await say(UID, "농장 등록");
    const res = await say(UID, CODE);
    assert.match(textOf(res), /올바르지 않습니다/);
    await pool.query("UPDATE farms SET status='active' WHERE farm_id=$1", [FARM]);
  });
});

describe("장애 접수 (3단계)", () => {
  const UID = "kk-user-report";

  test("미연동 사용자의 '접수' → 등록 안내", async () => {
    const res = await say(UID, "접수");
    assert.match(textOf(res), /농장 등록/);
  });

  test("연동 후 '접수' → 증상 입력 → CUSTOMER_REPORT 알림 생성 (Discord 경로行)", async () => {
    await say(UID, "농장 등록");
    await say(UID, CODE);
    resetRate();
    const r1 = await say(UID, "접수");
    assert.match(textOf(r1), /증상을 한 줄로/);
    const r2 = await say(UID, "측창이 안 열려요");
    assert.match(textOf(r2), /접수되었습니다/);
    const { rows } = await pool.query(
      "SELECT alert_type, severity, message FROM alerts WHERE farm_id = $1 AND alert_type = 'CUSTOMER_REPORT'",
      [FARM]
    );
    assert.equal(rows.length, 1, "접수가 알림으로 안 남으면 관리자에게 전달되지 않는다");
    assert.equal(rows[0].severity, "WARNING");
    assert.match(rows[0].message, /측창이 안 열려요/);
  });
});
