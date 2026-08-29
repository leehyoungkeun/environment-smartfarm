// 라우트 통합 테스트 — 실제 HTTP 요청으로 인증·격리를 확인한다.
//
// 정적 검사(security-invariants)는 "미들웨어가 붙어 있는가" 를 본다. 여기서는
// "실제로 요청하면 막히는가" 를 본다. 미들웨어가 붙어 있어도 순서가 틀리거나
// 라우트 안에서 우회하면 정적 검사는 통과하고 실제로는 뚫린다.
//
// 2026-08-29 에 인터넷에서 토큰 없이 GET /api/relay-status/farm_0001 이 200 을 냈다(N3).
// 그때 이 테스트가 있었다면 배포 전에 401 을 기대하며 실패했을 것이다.
//
// 평소에는 DB 스텁 위에서 돈다 — 인증·격리는 DB 조회 이전 단계에서 판정되므로
// 상태 코드 검증에 문제가 없다. 테스트 전용 Postgres 가 떠 있으면 진짜 행으로 같은 검증을 한다
// (test/seed.js 가 두 경우를 흡수한다).

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import jwt from "jsonwebtoken";

let app;
let cleanup = async () => {};
before(async () => {
  // setup.js 가 SMARTFARM_NO_LISTEN 을 설정하므로 서버는 뜨지 않는다
  app = (await import("../../src/app.js")).default;
  // authenticate 는 토큰을 검증한 뒤 DB 에서 사용자를 다시 조회한다 — 그 사용자를 심는다
  const { seedUsers } = await import("../seed.js");
  cleanup = await seedUsers(
    [
      { id: "u1", username: "tester", role: "owner", farmId: "farm_0001" },
      { id: "admin1", username: "admin-test", role: "superadmin", farmId: "farm_0001" },
    ],
    [{ farmId: "farm_0001" }, { farmId: "farm_0006" }]
  );
});

after(async () => {
  await cleanup();
});

/** 실제 서명된 토큰을 만든다 — 미들웨어의 검증 경로를 그대로 지난다 */
function tokenFor({ id = "u1", role = "owner", farmId = "farm_0001" } = {}) {
  return jwt.sign({ id, userId: id, role, farmId, username: "tester" }, process.env.JWT_SECRET, {
    expiresIn: "5m",
  });
}
const auth = (t) => ["Authorization", `Bearer ${t}`];

describe("인증 없이 접근하면 막힌다", () => {
  const guarded = [
    ["GET", "/api/relay-status/farm_0001"],       // N3
    ["GET", "/api/device-positions/farm_0001"],   // N3
    ["GET", "/api/farms"],
    ["GET", "/api/alerts/farm_0001"],
    ["GET", "/api/control-logs/farm_0001"],
  ];

  for (const [method, path] of guarded) {
    test(`${method} ${path} → 401`, async () => {
      const res = await request(app)[method.toLowerCase()](path);
      assert.equal(res.status, 401, `토큰 없이 ${res.status} 응답 — 열려 있다`);
    });
  }
});

describe("남의 농장은 토큰이 있어도 막힌다", () => {
  const crossFarm = [
    ["GET", "/api/relay-status/farm_0006"],
    ["GET", "/api/device-positions/farm_0006"],
    ["GET", "/api/alerts/farm_0006"],
    ["GET", "/api/control-logs/farm_0006"],
  ];

  for (const [method, path] of crossFarm) {
    test(`farm_0001 사용자가 ${path} → 403`, async () => {
      const res = await request(app)
        [method.toLowerCase()](path)
        .set(...auth(tokenFor({ farmId: "farm_0001" })));
      assert.equal(res.status, 403, `타 농장 접근이 ${res.status} — 격리가 뚫렸다`);
      assert.equal(res.body?.code, "FARM_ACCESS_DENIED");
    });
  }

  test("자기 농장은 403 이 아니다 (격리가 과하지 않다)", async () => {
    const res = await request(app)
      .get("/api/relay-status/farm_0001")
      .set(...auth(tokenFor({ farmId: "farm_0001" })));
    assert.notEqual(res.status, 401);
    assert.notEqual(res.status, 403);
  });

  test("superadmin 은 모든 농장에 접근한다", async () => {
    const res = await request(app)
      .get("/api/relay-status/farm_0006")
      .set(...auth(tokenFor({ id: "admin1", role: "superadmin", farmId: undefined })));
    assert.notEqual(res.status, 403);
  });
});

describe("망가진 토큰은 거부한다", () => {
  test("서명이 틀린 토큰 → 401", async () => {
    const bad = jwt.sign({ id: "u1", role: "owner", farmId: "farm_0001" }, "wrong-secret");
    const res = await request(app).get("/api/farms").set(...auth(bad));
    assert.equal(res.status, 401);
  });

  test("만료된 토큰 → 401", async () => {
    const expired = jwt.sign(
      { id: "u1", role: "owner", farmId: "farm_0001" },
      process.env.JWT_SECRET,
      { expiresIn: "-1s" }
    );
    const res = await request(app).get("/api/farms").set(...auth(expired));
    assert.equal(res.status, 401);
  });

  test("Bearer 없는 문자열 → 401", async () => {
    const res = await request(app).get("/api/farms").set("Authorization", "not-a-token");
    assert.equal(res.status, 401);
  });
});

describe("/metrics 는 내부 전용", () => {
  test("Cloudflare 터널을 거친 요청은 404", async () => {
    // 터널은 소켓 주소가 127.0.0.1 로 보이므로 cf-connecting-ip 헤더로 판정한다
    const res = await request(app).get("/metrics").set("cf-connecting-ip", "203.0.113.9");
    assert.equal(res.status, 404, "터널 요청이 지표를 받아갔다");
  });

  test("로컬(supertest) 요청은 지표를 준다", async () => {
    const res = await request(app).get("/metrics");
    assert.equal(res.status, 200);
    assert.match(res.text, /smartfarm_/);
  });
});

describe("카카오 스킬 — 비밀 URL 만 통한다 (AI 비용 노출 차단)", () => {
  test("옛 무인증 경로 → 404", async () => {
    const res = await request(app).post("/api/kakao/chat").send({ userRequest: { utterance: "질문" } });
    assert.equal(res.status, 404, "무인증 경로가 열려 있다 — 누구나 우리 비용으로 AI 를 부른다");
  });

  test("틀린 시크릿 → 404 (존재를 드러내지 않는다)", async () => {
    const res = await request(app).post("/api/kakao/chat/wrong-secret").send({});
    assert.equal(res.status, 404);
  });

  test("올바른 시크릿 → 카카오 2.0 형식 응답", async () => {
    // utterance 없는 요청 — AI 호출 없이 형식만 검증한다
    const res = await request(app).post("/api/kakao/chat/test-kakao-skill-secret").send({});
    assert.equal(res.status, 200);
    assert.equal(res.body.version, "2.0");
    assert.ok(res.body.template?.outputs?.[0]?.simpleText, "오픈빌더가 못 읽는 형식이면 챗봇이 침묵한다");
  });

  test("미연동 사용자 질문 → 상태 주입 없이 테스트 응답 (LLM 미호출)", async () => {
    const res = await request(app)
      .post("/api/kakao/chat/test-kakao-skill-secret")
      .send({ userRequest: { user: { id: "stub-user" }, utterance: "안녕하세요" } });
    assert.equal(res.status, 200);
    const text = res.body?.template?.outputs?.[0]?.simpleText?.text || "";
    assert.match(text, /테스트 응답/, "TEST_MODE 가 실제 LLM 을 불렀다");
    assert.ok(!text.includes("[상태연동]"), "미연동인데 상태가 주입됐다");
  });

  test("'농장 등록' 은 LLM 없이 코드 안내로 응답한다", async () => {
    const res = await request(app)
      .post("/api/kakao/chat/test-kakao-skill-secret")
      .send({ userRequest: { user: { id: "stub-user2" }, utterance: "농장 등록" } });
    assert.match(res.body?.template?.outputs?.[0]?.simpleText?.text || "", /등록 코드/);
  });

  test("분당 10회 초과 → AI 호출 없이 안내 응답 (과금 상한)", async () => {
    let limited = false;
    for (let i = 0; i < 12; i++) {
      const res = await request(app).post("/api/kakao/chat/test-kakao-skill-secret").send({});
      if (res.body?.template?.outputs?.[0]?.simpleText?.text?.includes("요청이 많습니다")) limited = true;
    }
    assert.ok(limited, "레이트리밋이 없다 — 시크릿이 새면 과금 폭주");
  });
});

describe("공개여야 하는 것은 열려 있다", () => {
  test("GET /health → 200", async () => {
    const res = await request(app).get("/health");
    assert.ok(res.status < 500, `헬스체크가 ${res.status}`);
  });
});
