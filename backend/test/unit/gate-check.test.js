// 배포 게이트 실전 검증용 — 이 파일은 곧 삭제된다.
// 의도적으로 실패해서, 배포 스크립트가 pm2 reload 를 하지 않고 롤백하는지 확인한다.
import { test } from "node:test";
import assert from "node:assert/strict";

test("배포 게이트 검증 (의도적 실패)", () => {
  assert.equal("gate", "should-block-deploy", "이 실패로 배포가 중단되어야 정상");
});
