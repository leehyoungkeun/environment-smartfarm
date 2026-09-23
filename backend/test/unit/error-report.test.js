// 백엔드 오류가 GlitchTip 까지 실제로 가는지 — 2026-09-23 이전엔 한 건도 안 갔다.
//
// 라우트가 catch 에서 곧장 res.status(500) 으로 응답해 Express 에러 미들웨어(자동 수집 지점)에
// 도달한 적이 없었고, 그래서 "센트리에 백엔드 오류 0건" 을 "백엔드 정상" 으로 읽을 뻔했다.
// 아래는 두 층(직접 보고 / 5xx 그물)이 각각 보고하고, 둘이 겹쳐 이중 보고하지 않는지 확인한다.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as Sentry from "@sentry/node";
import { reportServerError, capture5xxResponses } from "../../src/utils/errorReport.js";

// ESM 이라 Sentry.captureException 을 바꿔치기할 수 없다. 대신 테스트용 클라이언트를 띄우고
// beforeSend 에서 "전송 직전 이벤트" 를 가로챈다 (null 을 돌려주므로 밖으로 나가지 않는다).
const sent = [];
Sentry.init({
  dsn: "https://test@127.0.0.1/1",
  defaultIntegrations: false,
  beforeSend(event, hint) {
    sent.push({ event, err: hint?.originalException });
    return null;
  },
});
/** 이벤트 처리가 비동기라 잡힐 때까지 기다린다. */
async function flush() {
  await Sentry.flush(2000);
}

/** 최소한의 가짜 res — finish 이벤트와 json/locals 만 있으면 된다. */
function fakeRes(statusCode = 200) {
  const handlers = {};
  return {
    statusCode,
    locals: {},
    json(body) {
      this.body = body;
      return this;
    },
    on(ev, fn) {
      handlers[ev] = fn;
    },
    finish() {
      handlers.finish?.();
    },
  };
}

const fakeReq = (over = {}) => ({
  method: "GET",
  originalUrl: "/api/farms/farm_0001/devices?x=1",
  baseUrl: "/api/farms",
  route: { path: "/:farmId/devices" },
  params: { farmId: "farm_0001" },
  query: { x: "1" },
  ...over,
});

beforeEach(() => {
  sent.length = 0;
});

describe("reportServerError — catch 블록의 직접 보고", () => {
  test("오류 객체를 스택 그대로 보낸다", async () => {
    const err = new Error("prisma 연결 끊김");
    reportServerError(err, fakeReq(), fakeRes(500));
    await flush();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].err, err, "새 Error 로 감싸면 스택이 사라진다");
    assert.ok(sent[0].err.stack.includes("error-report.test"));
  });

  test("라우트는 값이 아니라 패턴으로 — 농장마다 이슈가 쪼개지지 않게", async () => {
    reportServerError(new Error("x"), fakeReq(), fakeRes(500));
    await flush();
    assert.equal(sent[0].event.tags.route, "/api/farms/:farmId/devices");
    assert.equal(sent[0].event.tags.farm_id, "farm_0001");
    assert.equal(sent[0].event.tags.service, "backend");
  });

  test("Error 가 아닌 값(문자열 throw)도 보고된다", async () => {
    reportServerError("그냥 문자열", fakeReq(), fakeRes(500));
    await flush();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].err.message, "그냥 문자열");
  });

  test("보고가 실패해도 예외를 밖으로 던지지 않는다 — 응답이 우선", () => {
    // res.locals 접근조차 실패하는 극단 상황
    const brokenRes = { get locals() { throw new Error("깨진 res"); }, statusCode: 500 };
    assert.doesNotThrow(() => reportServerError(new Error("x"), fakeReq(), brokenRes));
  });

  test("req 가 없어도 (스케줄러 등) 던지지 않는다", async () => {
    assert.doesNotThrow(() => reportServerError(new Error("x"), undefined, undefined));
    await flush();
    assert.equal(sent.length, 1);
  });
});

describe("capture5xxResponses — 그물", () => {
  test("보고되지 않은 500 응답을 잡는다", async () => {
    const res = fakeRes(200);
    capture5xxResponses(fakeReq(), res, () => {});
    res.statusCode = 500;
    res.json({ success: false, error: "알 수 없는 오류" });
    res.finish();
    await flush();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].err.message, "알 수 없는 오류");
    assert.equal(sent[0].err.name, "UnreportedServerError");
    assert.deepEqual(sent[0].event.fingerprint, ["{{ default }}", "GET", "/api/farms/:farmId/devices"]);
  });

  test("이미 보고된 요청은 다시 보내지 않는다 (이중 보고 금지)", async () => {
    const res = fakeRes(200);
    capture5xxResponses(fakeReq(), res, () => {});
    res.statusCode = 500;
    reportServerError(new Error("진짜 오류"), fakeReq(), res);
    res.json({ success: false, error: "진짜 오류" });
    res.finish();
    await flush();
    assert.equal(sent.length, 1, "직접 보고 1건만 남아야 한다");
    assert.equal(sent[0].err.message, "진짜 오류");
  });

  test("4xx 는 오류가 아니다 — 보내지 않는다", async () => {
    const res = fakeRes(200);
    capture5xxResponses(fakeReq(), res, () => {});
    res.statusCode = 404;
    res.json({ success: false, error: "없습니다" });
    res.finish();
    await flush();
    assert.equal(sent.length, 0);
  });

  test("정상 응답도 보내지 않는다", async () => {
    const res = fakeRes(200);
    capture5xxResponses(fakeReq(), res, () => {});
    res.json({ success: true });
    res.finish();
    await flush();
    assert.equal(sent.length, 0);
  });

  test("res.json 본문은 그대로 호출자에게 간다 (가로채도 응답은 안 바뀐다)", () => {
    const res = fakeRes(200);
    capture5xxResponses(fakeReq(), res, () => {});
    const body = { success: true, data: [1, 2] };
    res.json(body);
    assert.deepEqual(res.body, body);
  });
});

describe("라우트 전수 — 500 응답은 모두 보고된다", () => {
  test("catch 에서 응답하는 모든 500 앞에 reportServerError 가 있다", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = new URL("../../src/routes/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const missing = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".js"))) {
      const lines = readFileSync(join(dir, f), "utf8").split("\n");
      lines.forEach((l, i) => {
        if (/res\s*\.\s*status\(\s*500\s*\)/.test(l) && !/reportServerError/.test(lines[i - 1] || "")) {
          missing.push(`${f}:${i + 1}`);
        }
      });
    }
    assert.deepEqual(missing, [], `보고 없는 500 응답: ${missing.join(", ")}`);
  });
});
