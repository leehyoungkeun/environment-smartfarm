// 백엔드 오류를 GlitchTip(sentry.smartgreen.kr)으로 보낸다.
//
// 2026-09-23: 프로젝트 개설(5/10) 이후 백엔드 이벤트가 4개월 넘게 0건이었다. DSN·경로는
// 정상인데, 라우트가 catch 에서 곧장 res.status(500) 으로 응답해 오류가 Express 에러
// 미들웨어(=Sentry 자동 수집 지점)까지 간 적이 없었다. "센트리에 백엔드 오류가 없다" 를
// "백엔드가 멀쩡하다" 로 읽을 뻔한 상태였다.
//
// 두 층으로 막는다.
//   1) reportServerError — 각 catch 에서 진짜 Error 객체(스택 포함)를 보고
//   2) capture5xxResponses — 그 밖의 5xx 응답을 그물로 받는다 (스택은 없지만 놓치진 않는다)
// 1) 이 보고한 요청은 res.locals.sentryReported 로 표시해 2) 가 중복 보고하지 않는다.

import * as Sentry from "@sentry/node";

/** 요청에서 농장 식별자를 찾는다 (auth.middleware 의 farmIdFromRequest 와 같은 우선순위). */
function farmIdOf(req) {
  if (!req) return undefined;
  return (
    req.params?.farmId ||
    req.farmId ||
    req.user?.farmId ||
    req.body?.farmId ||
    req.query?.farmId ||
    undefined
  );
}

/** 라우트 경로 — `/api/farms/:farmId/devices` 처럼 값이 아닌 패턴으로 묶어야 이슈가 뭉친다. */
function routeOf(req) {
  if (!req) return undefined;
  const base = req.baseUrl || "";
  const path = req.route?.path || "";
  return `${base}${path}` || req.originalUrl?.split("?")[0] || undefined;
}

function scopeOf(req, status, extra) {
  return {
    tags: {
      service: "backend",
      route: routeOf(req),
      method: req?.method,
      status: String(status),
      farm_id: farmIdOf(req),
    },
    extra: {
      url: req?.originalUrl,
      query: req?.query,
      userId: req?.user?.id,
      ...extra,
    },
  };
}

/**
 * catch 블록에서 호출한다. 오류 객체를 그대로 넘겨야 스택이 남는다.
 * 보고 자체가 요청 처리를 깨뜨리면 안 되므로 어떤 경우에도 예외를 던지지 않는다.
 */
export function reportServerError(error, req, res, extra = {}) {
  try {
    if (res?.locals) res.locals.sentryReported = true;
    const err = error instanceof Error ? error : new Error(String(error?.message || error));
    Sentry.captureException(err, scopeOf(req, res?.statusCode || 500, extra));
  } catch {
    // 보고 실패는 삼킨다 — 원래 응답이 우선이다.
  }
}

/**
 * 그물: 위에서 보고되지 않은 5xx 응답을 잡는다.
 * 응답 본문의 error 메시지로 이슈 제목을 만들고, 라우트별로 묶는다(fingerprint).
 */
export function capture5xxResponses(req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => {
    res.locals.responseBody = body;
    return json(body);
  };
  res.on("finish", () => {
    try {
      if (res.statusCode < 500 || res.locals.sentryReported) return;
      const body = res.locals.responseBody;
      const message =
        (typeof body?.error === "string" && body.error) ||
        body?.message ||
        `HTTP ${res.statusCode}`;
      const err = new Error(message);
      err.name = "UnreportedServerError";  // 스택이 없는 그물 수집임을 이슈 목록에서 구분
      err.stack = `${err.name}: ${message}\n    at ${req.method} ${routeOf(req)}`;
      Sentry.captureException(err, {
        ...scopeOf(req, res.statusCode, { body }),
        fingerprint: ["{{ default }}", req.method, routeOf(req) || "unknown"],
      });
    } catch {
      // 무시 — 응답은 이미 나갔다.
    }
  });
  next();
}

export default { reportServerError, capture5xxResponses };
