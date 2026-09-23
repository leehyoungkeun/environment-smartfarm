// backend/.env 를 실행 위치(cwd)와 무관하게 읽는다.
//
// 2026-09-23: 운영에서는 pm2 cwd 가 `~/smartfarm`(리포 루트)이고 그곳엔 .env 가 없다.
// `import "dotenv/config"` 는 cwd 기준이라 아무것도 못 읽었고, 그런데도 DB 는 돌았다 —
// @prisma/client 가 import 될 때 스키마 옆의 backend/.env 를 부수적으로 읽어 줬기 때문이다.
// 그 시점은 instrument.js(Sentry) 보다 **뒤**라, 운영 백엔드는 GLITCHTIP_DSN 을 못 본 채
// Sentry.init 을 건너뛰었다. 그래서 4개월 넘게 오류 이벤트가 0건이었다.
//
// 환경변수 로딩을 Prisma 의 부수 효과에 기대지 않도록, 파일 위치 기준으로 못박는다.

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export const BACKEND_ENV_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".env",
);

/** .env 를 읽어 process.env 에 채운다. 이미 있는 값은 덮지 않는다(dotenv 기본). */
export function loadEnv(envPath = BACKEND_ENV_PATH) {
  return dotenv.config({ path: envPath });
}

loadEnv();

export default { loadEnv, BACKEND_ENV_PATH };
