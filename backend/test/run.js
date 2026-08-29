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

if (!existsSync(unitDir)) {
  console.error("테스트 디렉터리가 없습니다: " + unitDir);
  process.exit(1);
}

const files = readdirSync(unitDir)
  .filter((f) => f.endsWith(".test.js"))
  .map((f) => relative(root, join(unitDir, f)));

if (files.length === 0) {
  console.error("테스트 파일을 찾지 못했습니다 — 게이트가 통과로 오판하지 않도록 실패로 끝냅니다.");
  process.exit(1);
}

const args = ["--test", "--import=./test/setup.js", ...process.argv.slice(2), ...files];
const r = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
process.exit(r.status ?? 1);
