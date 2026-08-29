// 테스트 안전장치 — 운영 DB 에 절대 닿지 않게 한다.
//
// 2026-08-29: 첫 테스트를 돌렸더니 prisma 가 .env 의 DATABASE_URL 로 접속을 시도했다.
// 마침 그 값이 이사 전 옛 주소(192.168.219.114)라 실패했을 뿐, 주소가 맞았다면
// 테스트가 운영 DB 를 조회했을 것이다. 우연에 기대지 않도록 여기서 막는다.
//
// 방법: 운영 코드는 한 줄도 고치지 않고, Node 의 모듈 로더 훅으로 테스트 프로세스 안에서만
// `../db.js` 를 가짜 구현으로 바꾼다. 단위 테스트(test/unit/)는 DB 결과가 필요 없고,
// prisma 조회는 어차피 실패 시 폴백하도록 코드에 작성돼 있다.
//
// 통합 테스트를 붙일 때는 DATABASE_URL 이 테스트 전용(127.0.0.1:5433)일 때만
// 진짜 db.js 를 쓰도록 아래 USE_REAL_DB 조건을 넓힌다.

import { register } from "node:module";
import { pathToFileURL } from "node:url";

process.env.NODE_ENV = "test";

// app.js 를 import 해도 서버·MQTT·스케줄러가 뜨지 않게 한다 (통합 테스트용).
// NODE_ENV 가 아니라 전용 변수 — 운영에서 실수로 발동할 수 없다.
process.env.SMARTFARM_NO_LISTEN = "1";

// 인증 미들웨어는 로드 시점에 필수 환경변수를 검증하고 없으면 process.exit(1) 한다.
// 테스트에서는 실제 비밀이 필요 없으므로 더미를 넣는다 (운영 값과 무관·무해).
process.env.JWT_SECRET ||= "test-only-secret-not-used-anywhere-else-0123456789";
process.env.JWT_REFRESH_SECRET ||= "test-only-refresh-secret-not-used-elsewhere-9876543210";

const url = process.env.DATABASE_URL || "";
const TEST_DB = /^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost):5433\//.test(url);

if (!TEST_DB) {
  // 운영·개발 DB 주소이거나 미설정 → db.js 를 스텁으로 대체
  process.env.DATABASE_URL = "postgresql://stub:stub@127.0.0.1:1/none";
  register("./db-stub-hook.js", pathToFileURL(import.meta.filename));
}
