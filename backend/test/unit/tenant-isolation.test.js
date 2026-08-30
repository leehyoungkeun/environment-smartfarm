// 테넌트 격리 — 한 농가 사용자가 다른 농장 자원을 못 보게 하는 방어선.
//
// 2026-08-29 에 relay-status·device-positions 라우트가 이 미들웨어 없이 마운트돼 있어
// 인터넷에서 토큰조차 없이 남의 농장 릴레이 상태가 열렸다(N3). 라우트를 추가할 때마다
// 사람이 기억해야 하는 구조라, 규칙 자체를 여기 고정해 둔다.
//
// DB·서버 불필요 — prisma 는 실패하면 폴백하도록 만들어져 있어 그대로 호출된다.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { enforceTenant } from "../../src/middleware/auth.middleware.js";

/** 미들웨어를 호출하고 {passed, status, body} 로 결과를 돌려준다 */
async function run({ user, params = {}, isDevice = false, farmId, isInternal = false }) {
  let passed = false;
  let status = null;
  let body = null;
  const req = { user, params, isDevice, farmId, isInternal };
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json(payload) {
      body = payload;
      return this;
    },
  };
  await enforceTenant(req, res, () => {
    passed = true;
  });
  return { passed, status, body };
}

const owner = (farmId) => ({ id: "u1", role: "owner", farmId });
const worker = (farmId) => ({ id: "u2", role: "worker", farmId });

describe("enforceTenant — 농장 간 격리", () => {
  test("자기 농장은 통과한다", async () => {
    const r = await run({ user: owner("farm_0001"), params: { farmId: "farm_0001" } });
    assert.equal(r.passed, true);
  });

  test("다른 농장은 403 으로 막는다", async () => {
    const r = await run({ user: owner("farm_0001"), params: { farmId: "farm_0006" } });
    assert.equal(r.passed, false, "다른 농장 접근이 통과되면 안 된다");
    assert.equal(r.status, 403);
    assert.equal(r.body.code, "FARM_ACCESS_DENIED");
  });

  test("작업자도 다른 농장은 막힌다 (역할과 무관)", async () => {
    const r = await run({ user: worker("farm_0001"), params: { farmId: "farm_0002" } });
    assert.equal(r.passed, false);
    assert.equal(r.status, 403);
  });

  test("로그인하지 않은 요청은 farmId 가 있으면 막힌다", async () => {
    const r = await run({ user: undefined, params: { farmId: "farm_0001" } });
    assert.equal(r.passed, false, "익명 요청이 농장 자원에 닿으면 안 된다");
    assert.equal(r.status, 403);
  });
});

describe("enforceTenant — 통과해야 하는 경우", () => {
  test("superadmin 은 모든 농장에 접근한다", async () => {
    const r = await run({ user: { id: "a", role: "superadmin" }, params: { farmId: "farm_0006" } });
    assert.equal(r.passed, true);
  });

  test("manager 도 모든 농장에 접근한다", async () => {
    const r = await run({ user: { id: "m", role: "manager" }, params: { farmId: "farm_0006" } });
    assert.equal(r.passed, true);
  });

  test("장치(농장 키) 요청은 자기 농장이면 통과한다", async () => {
    const r = await run({ isDevice: true, farmId: "farm_0006", params: { farmId: "farm_0006" } });
    assert.equal(r.passed, true);
  });

  test("장치(농장 키)로 다른 농장을 요청하면 403 — 2026-08-30 G3 (farm_0001 키로 farm_0006 136,183행 열람)", async () => {
    const r = await run({ isDevice: true, farmId: "farm_0001", params: { farmId: "farm_0006" } });
    assert.equal(r.passed, false);
    assert.equal(r.status, 403);
  });

  test("내부 키(Alertmanager 등)는 농장 제한이 없다", async () => {
    const r = await run({ isDevice: true, isInternal: true, farmId: "farm_0001", params: { farmId: "farm_0006" } });
    assert.equal(r.passed, true);
  });

  test("농장에 묶이지 않은 장치 요청(farmId 미결정)은 통과한다", async () => {
    const r = await run({ isDevice: true, params: { farmId: "farm_0006" } });
    assert.equal(r.passed, true);
  });

  test("farmId 파라미터가 없는 라우트는 통과한다", async () => {
    const r = await run({ user: owner("farm_0001"), params: {} });
    assert.equal(r.passed, true);
  });
});
