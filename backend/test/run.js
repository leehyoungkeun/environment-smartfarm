// 테스트 러너 — Node 버전 차이를 흡수한다.
//
// `node --test` 의 인자 처리가 버전마다 다르다:
//   Node 20 (운영 서버): 디렉터리 인자 O, glob 패턴 X
//   Node 24 (개발 PC)  : glob 패턴 O, 디렉터리 인자 X (ERR_UNSUPPORTED_DIR_IMPORT)
// 그래서 어느 쪽에도 기대지 않고, 여기서 파일 목록을 직접 만들어 넘긴다.
//
// 2026-08-29: 이 차이 때문에 서버에서 "Could not find ... *.test.js" 가 나면서도
// **exit 0** 이 떨어졌다. 배포 게이트가 "통과" 로 오판하는 상태였다 — 테스트가 있는 것보다
// 나쁜 상황이라, 아래에서 발견된 파일이 0개면 실패로 끝낸다.

import { readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const unitDir = join(here, "unit");

// --db : 테스트 전용 Postgres 를 쓰겠다는 뜻 (npm run test:db).
// 주소를 여기 한 곳에만 두어, 셸마다 다른 환경변수 문법을 피한다.
if (process.argv.includes("--db") && !process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://postgres:test@127.0.0.1:5433/smartfarm_test";
}

if (!existsSync(unitDir)) {
  console.error("테스트 디렉터리가 없습니다: " + unitDir);
  process.exit(1);
}

// 통합 테스트는 app.js 를 import 한다. 그 안에서 import 되는 모듈 일부가 타이머·핸들을
// 열어두어 테스트가 끝나도 프로세스가 안 죽는다(2026-08-29 확인). --test-force-exit 로 끝낸다.
const intDir = join(here, "integration");

const files = readdirSync(unitDir)
  .filter((f) => f.endsWith(".test.js"))
  .map((f) => relative(root, join(unitDir, f)));

if (files.length === 0) {
  console.error("테스트 파일을 찾지 못했습니다 — 게이트가 통과로 오판하지 않도록 실패로 끝냅니다.");
  process.exit(1);
}

// DB 테스트(test/db/)는 테스트 전용 Postgres 가 있을 때만 돈다.
// DATABASE_URL 이 127.0.0.1:5433 이 아니면 setup.js 가 스텁으로 바꾸므로 실행해도 의미가 없다.
const dbDir = join(here, "db");
const TEST_DB = /^postgres(ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost):5433\//.test(process.env.DATABASE_URL || "");

if (existsSync(intDir)) {
  for (const f of readdirSync(intDir).filter((x) => x.endsWith(".test.js"))) {
    files.push(relative(root, join(intDir, f)));
  }
}

if (TEST_DB && existsSync(dbDir)) {
  for (const f of readdirSync(dbDir).filter((x) => x.endsWith(".test.js"))) {
    files.push(relative(root, join(dbDir, f)));
  }
  console.log(`[run] 테스트 DB 감지 — db/ 포함 (${files.length}개 파일)`);
} else if (existsSync(dbDir)) {
  console.log("[run] 테스트 DB 없음 — db/ 건너뜀 (bash server/postgres17/test-db.sh up 으로 띄운다)");
}

const args = ["--test", "--test-force-exit", "--import=./test/setup.js", ...process.argv.slice(2).filter((a) => a !== "--db"), ...files];
const r = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
process.exit(r.status ?? 1);
