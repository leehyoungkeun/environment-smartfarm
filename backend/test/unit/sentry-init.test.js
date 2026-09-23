// Sentry(GlitchTip) 가 실제로 켜지는지 — 켜졌다고 믿었지만 4개월간 꺼져 있었다.
//
// 2026-09-23 진단: 운영 pm2 의 cwd 는 리포 루트(~/smartfarm)이고 거기엔 .env 가 없다.
// `import "dotenv/config"` 는 cwd 기준이라 아무것도 못 읽었는데, DB 는 멀쩡히 돌았다 —
// @prisma/client 가 import 될 때 backend/.env 를 부수적으로 읽어 줬기 때문이다.
// 그건 instrument.js 보다 뒤라서 GLITCHTIP_DSN 이 undefined → Sentry.init 자체를 건너뛰었다.
// "컨테이너가 Up" 처럼 "설정이 있다" 가 동작 증거가 아니었던 사례.
//
// 아래는 (1) .env 로딩이 cwd 와 무관한지 (2) 그 사실이 코드·실행설정에 못박혀 있는지 본다.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadEnv, BACKEND_ENV_PATH } from "../../src/env.js";

const srcDir = fileURLToPath(new URL("../../src/", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("env 로딩은 실행 위치에 기대지 않는다", () => {
  test("loadEnv 는 지정한 파일을 그대로 읽는다", () => {
    const dir = mkdtempSync(join(tmpdir(), "sf-env-"));
    const p = join(dir, ".env");
    writeFileSync(p, "SF_TEST_ONLY_VAR=hello\n");
    loadEnv(p);
    assert.equal(process.env.SF_TEST_ONLY_VAR, "hello");
    delete process.env.SF_TEST_ONLY_VAR;
  });

  test("기본 경로는 backend/.env — cwd 가 아니라 파일 위치 기준", () => {
    assert.ok(
      BACKEND_ENV_PATH.replace(/\\/g, "/").endsWith("backend/.env"),
      `기대: backend/.env, 실제: ${BACKEND_ENV_PATH}`,
    );
  });

  test("다른 cwd 에서 env.js 를 불러도 같은 .env 를 가리킨다", () => {
    const out = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", `
        const { BACKEND_ENV_PATH } = await import(${JSON.stringify(new URL("../../src/env.js", import.meta.url).href)});
        console.log(BACKEND_ENV_PATH);
      `],
      { cwd: tmpdir(), encoding: "utf8" },
    ).trim();
    assert.equal(out, BACKEND_ENV_PATH);
  });
});

describe("초기화 순서가 코드·실행설정에 못박혀 있다", () => {
  test("instrument.js 는 cwd 기준 dotenv 를 쓰지 않는다", () => {
    const src = readFileSync(join(srcDir, "instrument.js"), "utf8");
    assert.ok(!/["']dotenv\/config["']/.test(src), 'cwd 기준 "dotenv/config" 는 운영에서 .env 를 못 읽는다');
    assert.ok(/from\s+["']\.\/env\.js["']|import\s+["']\.\/env\.js["']/.test(src));
  });

  test("app.js 도 같은 로더를 쓴다", () => {
    const src = readFileSync(join(srcDir, "app.js"), "utf8");
    assert.ok(!/["']dotenv\/config["']/.test(src));
  });

  test("instrument.js 는 DSN 이 있을 때만 init 한다 (개발 PC 에서 잡음 방지)", () => {
    const src = readFileSync(join(srcDir, "instrument.js"), "utf8");
    assert.ok(/if\s*\(\s*process\.env\.GLITCHTIP_DSN\s*\)/.test(src));
  });

  test("pm2 실행설정이 --import 로 Sentry 를 먼저 띄운다", () => {
    const src = readFileSync(join(repoRoot, "ecosystem.config.js"), "utf8");
    assert.match(
      src,
      /--import\s+\.\/backend\/src\/instrument\.js/,
      "app.js 안에서 import 하면 express 자동 계측이 붙지 않는다",
    );
  });
});
