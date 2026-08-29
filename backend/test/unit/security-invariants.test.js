// 보안 불변식 — "라우트를 추가할 때 사람이 기억해야 하는 것" 을 코드로 고정한다.
//
// 2026-08-29 2차 점검에서 인증 체계를 처음 찔러 세 구멍이 나왔다. 셋 다 "그 라우트에
// 미들웨어를 붙이는 걸 잊었다" 는 같은 종류였다:
//   N1 admin/admin1234 가 인터넷에서 로그인됨
//   N2 장비코드만으로 농장 키·인증서를 받아감
//   N3 relay-status·device-positions 가 토큰 없이 열림
// 라우트는 앞으로도 늘어난다. 사람의 기억 대신 이 테스트가 지킨다.
//
// app.js 를 import 하면 서버가 뜨므로 소스를 텍스트로 읽어 검사한다.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const app = read("../../src/app.js");

/** app.use("/api/xxx", ...) 마운트를 모두 뽑는다 */
function mounts(src) {
  const out = [];
  const re = /app\.use\(\s*"(\/api\/[a-z0-9-]+)"\s*,\s*([^)]*)\)/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    out.push({ path: m[1], mw: m[2].replace(/\s+/g, " ").trim() });
  }
  return out;
}

const routes = mounts(app);

// 인증 없이 열려 있어도 되는 것 — 각각 이유가 있어야 한다
const PUBLIC_OK = {
  "/api/auth": "로그인·토큰 갱신 자체",
  "/api/deploy": "x-deploy-token 을 라우트 안에서 직접 검사한다",
  "/api/kakao": "카카오 서버가 호출한다 (⚠ 서명 검증 미구현 — 별도 과제)",
  "/api/devices": "장비코드 setup 이 부트스트랩 경로 (⚠ 1회용으로만 제한됨)",
};

describe("라우트 마운트 — 인증 누락이 없다", () => {
  test("마운트를 찾았다", () => {
    assert.ok(routes.length >= 15, `app.use 마운트를 ${routes.length}개만 찾음`);
  });

  test("모든 /api 라우트는 인증을 거치거나 명시적 예외다", () => {
    const unguarded = routes.filter(
      (r) => !/authenticate|authenticateApiKey/.test(r.mw) && !(r.path in PUBLIC_OK)
    );
    assert.deepEqual(
      unguarded.map((r) => r.path),
      [],
      `인증 없이 마운트된 라우트 — 의도했다면 PUBLIC_OK 에 이유와 함께 추가할 것:\n` +
        unguarded.map((r) => `  ${r.path}  ←  ${r.mw}`).join("\n")
    );
  });

  test("농장 자원을 다루는 라우트는 테넌트 격리를 건다", () => {
    // :farmId 로 남의 농장을 지목할 수 있는 라우트들. JWT 인증만으로는 부족하다.
    const needTenant = [
      "/api/alerts",
      "/api/control-logs",
      "/api/relay-status",
      "/api/device-positions",
      "/api/journal",
      "/api/reports",
    ];
    const missing = needTenant.filter((p) => {
      const r = routes.find((x) => x.path === p);
      return r && !/enforceTenant/.test(r.mw);
    });
    assert.deepEqual(missing, [], `enforceTenant 가 빠진 라우트: ${missing.join(", ")}`);
  });
});

describe("/metrics — 내부 전용", () => {
  test("터널(cf-connecting-ip)을 거친 요청은 거부한다", () => {
    assert.match(app, /cf-connecting-ip/, "터널 판정이 사라졌다");
    assert.match(app, /viaTunnel\s*\|\|/, "viaTunnel 이 거부 조건에 없다");
  });

  test("req.ip 가 아니라 소켓 주소로 판정한다", () => {
    // trust proxy 가 켜져 있어 req.ip 는 X-Forwarded-For 를 따른다 — 위조 가능
    const block = app.slice(app.indexOf("METRICS_ALLOWED"), app.indexOf("METRICS_ALLOWED") + 1200);
    assert.match(block, /req\.socket\?\.remoteAddress/, "소켓 주소를 쓰지 않는다");
  });

  test("허용 대역은 사설망·루프백·Tailscale 뿐이다", () => {
    const list = app.slice(app.indexOf("const METRICS_ALLOWED"), app.indexOf("];", app.indexOf("const METRICS_ALLOWED")));
    for (const pat of [/\^127\\\./, /\^192\\\.168\\\./, /100\\\.\(6\[4-9\]/]) {
      assert.match(list, pat, `허용 목록에서 빠진 대역: ${pat}`);
    }
    assert.doesNotMatch(list, /\^0\\\.|\.\*/, "너무 넓은 패턴이 들어 있다");
  });
});

describe("장비 setup — 비밀은 최초 1회만", () => {
  const dev = read("../../src/routes/devices.routes.js");

  test("firstSetup 판정이 installedAt 기준이다", () => {
    assert.match(dev, /const firstSetup = !device\.installedAt/);
  });

  test("농장 API 키는 최초 설치 때만 응답한다", () => {
    assert.match(dev, /apiKey:\s*firstSetup \?\s*farm\.apiKey/);
  });

  test("인증서·개인키도 최초 설치 때만 응답한다", () => {
    assert.match(dev, /certificates:\s*\(firstSetup && device\.certPem\)/);
  });

  test("최초 setup 이 installedAt 을 찍는다 (안 찍으면 1회용이 무의미)", () => {
    assert.match(dev, /installedAt:\s*device\.installedAt \|\| new Date\(\)/);
  });
});

describe("센서 저장 — 시뮬레이션으로 경보하지 않는다", () => {
  const sensors = read("../../src/routes/sensors.js");

  test("저장 직후 인라인 경보 검사가 시뮬레이션을 건너뛴다", () => {
    // 임계 스케줄러와 별개 경로다. 2026-08-29 에 여기를 놓쳐 99.9°C 가짜 경보가 나갔다.
    assert.match(sensors, /reportedQuality !== "simulated"\s*\)?\s*[\r\n]\s*checkAndCreateAlerts/);
  });

  test("RPi 가 보고한 quality 를 그대로 기록한다", () => {
    assert.match(sensors, /reportedQuality === "simulated" \? "simulated"/);
  });
});

describe("설정 저장 — 남의 키를 지우지 않는다", () => {
  const config = read("../../src/routes/config.routes.js");

  test("중첩 settings 를 깊은 병합한다", () => {
    // jsonb || 는 얕은 병합이라, 전광판이 { settings: { display } } 만 보내면
    // 같은 객체 안의 relayModules·sensorModules 가 사라졌다 (2026-08-29 확인).
    assert.match(config, /existingNested/, "기존 값을 읽는 코드가 없다");
    assert.match(config, /\{\s*\.\.\.existingNested,\s*\.\.\.req\.body\.settings\s*\}/, "깊은 병합이 아니다");
  });

  test("서버가 RPi 를 부를 때 농장 키를 붙인다", () => {
    assert.match(config, /async function rpiHeaders/, "rpiHeaders 헬퍼가 없다");
    const calls = config.match(/await fetch\(`\$\{rpiBase\}[^`]*`,\s*\{[^}]*\}/g) || [];
    for (const c of calls) {
      assert.match(c, /rpiHeaders/, `농장 키 없이 RPi 를 부르는 곳 (401 이 난다):\n${c}`);
    }
  });
});
