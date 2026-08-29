// 제어이력 동기화 — RPi 쪽 (cl_check → cl_prepare → HTTP → cl_result → cl_next 루프).
//
// 근거가 된 실제 사고 (2026-08-26):
//   - 로컬 10,106건 전부 미전송 — 전송 갈래가 아예 구현된 적이 없어 synced 가 100% 0.
//   - 서버 쪽 소급 중복판정 버그로 1,474건 유실 (그쪽은 db/control-log-backfill 이 잠금).
// 이 파일은 RPi 쪽을 잠근다: 실패 시 마킹하지 않아야 재시도로 보존되고,
// 성공 시에만 synced=1 마킹이 나가야 유실이 없다.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makeClock, makeEnv, port } from "./harness.js";

const TAB_ENV = { SERVER_URL: "https://api.smartgreen.kr", SENSOR_API_KEY: "test-key", FARM_ID: "farm_0001" };

function mkEnv(flowVars = {}, globals = {}) {
  return makeEnv({ clock: makeClock(), flowVars, globals, tabEnv: TAB_ENV });
}

const ROWS = [
  { id: 1, timestamp: "2026-08-29T10:00:00Z", device_id: "fan1", command: "on", source: "local" },
  { id: 2, timestamp: "2026-08-29T10:00:05Z", device_id: "fan1", command: "off", source: "automation" },
];

describe("cl_check — 자동으로 켜지지 않는다 (사용자 원칙: 자동 모드 전환 금지)", () => {
  test("paused 미설정(기본)이면 흐르지 않는다", () => {
    const e = mkEnv();
    assert.equal(e.run("cl_check", { payload: "tick" }), null, "기본값이 '실행' 이면 재부팅 후 몰래 켜진다");
  });

  test("오프라인이면 흐르지 않는다", () => {
    const e = mkEnv({ ctrlSyncPaused: false }, { operationMode: "offline" });
    assert.equal(e.run("cl_check", {}), null);
  });

  test("시작 후에는 미동기화 조회 SQL 이 나간다 (LIMIT ≤ 서버 상한 500)", () => {
    const e = mkEnv({ ctrlSyncPaused: false });
    const out = e.run("cl_check", {});
    assert.match(out.topic, /synced IS NULL OR synced = 0/);
    const limit = Number(out.topic.match(/LIMIT (\d+)/)?.[1]);
    assert.ok(limit > 0 && limit <= 500, `LIMIT ${limit} — 서버 배치 상한(500)을 넘으면 413 으로 전부 실패한다`);
    assert.match(out.topic, /ORDER BY timestamp ASC/, "오래된 것부터 보내야 중간 중단 시 이력 순서가 보존된다");
  });
});

describe("cl_prepare — 배치 조립", () => {
  test("남은 행이 없으면 루프를 끝낸다 (running=false)", () => {
    const e = mkEnv({ ctrlSyncRunning: true });
    assert.equal(e.run("cl_prepare", { payload: [] }), null);
    assert.equal(e.flow.get("ctrlSyncRunning"), false);
  });

  test("URL 은 /internal — /api/internal 이면 도달한 적 없던 그 사고", () => {
    const e = mkEnv();
    const out = e.run("cl_prepare", { payload: ROWS });
    assert.equal(out.url, "https://api.smartgreen.kr/internal/control-log/batch");
    assert.ok(!out.url.includes("/api/internal"));
    assert.equal(out.method, "POST");
    assert.equal(out.headers["x-api-key"], "test-key");
  });

  test("로컬 행 → 서버 계약 형식 (localId/timestamp/deviceId/command/source)", () => {
    const e = mkEnv();
    const out = e.run("cl_prepare", { payload: ROWS });
    assert.equal(out.payload.farmId, "farm_0001");
    // vm 경계 객체는 deepEqual(strict) 프로토타입 검사에 걸린다 — JSON 비교
    assert.equal(
      JSON.stringify(out.payload.logs[0]),
      JSON.stringify({ localId: 1, timestamp: "2026-08-29T10:00:00Z", deviceId: "fan1", command: "on", source: "local" })
    );
    assert.deepEqual(out._ctrlIds, [1, 2], "_ctrlIds 가 없으면 응답 후 어떤 행을 마킹할지 모른다");
    assert.equal(out._ctrlCount, 2);
  });
});

describe("cl_result — 성공에만 마킹한다 (유실 방지의 핵심)", () => {
  test("200 → synced=1 UPDATE (파라미터 바인딩) + 누적 기록", () => {
    const e = mkEnv({ ctrlSyncedSoFar: 10 });
    const out = e.run("cl_result", { statusCode: 200, payload: { inserted: 1, skipped: 1 }, _ctrlIds: [1, 2], _ctrlCount: 2 });
    assert.match(out[0].topic, /UPDATE control_logs SET synced = 1 WHERE id IN \(\$1,\$2\)/);
    assert.deepEqual(out[0].payload, [1, 2]);
    assert.equal(e.flow.get("ctrlSyncedSoFar"), 12);
    assert.equal(e.global.get("lastCtrlSyncResult").success, true);
  });

  test("★ 실패(500)면 마킹하지 않는다 — 다음 주기에 그대로 재시도", () => {
    const e = mkEnv({ ctrlSyncRunning: true });
    const out = e.run("cl_result", { statusCode: 500, _ctrlIds: [1, 2], _ctrlCount: 2 });
    assert.equal(out[0], null, "실패했는데 synced=1 마킹 — 서버에 없는 행이 영원히 '보냄' 처리된다 (유실)");
    assert.equal(e.flow.get("ctrlSyncRunning"), false);
    assert.equal(e.global.get("lastCtrlSyncResult").success, false);
  });

  test("id 는 양의 정수만 통과한다 (SQL 조립 가드)", () => {
    const e = mkEnv();
    const out = e.run("cl_result", {
      statusCode: 200, payload: {},
      _ctrlIds: [1, "2; DROP TABLE control_logs", -3, 4.5, 7],
      _ctrlCount: 5,
    });
    assert.match(out[0].topic, /IN \(\$1,\$2\)$/);
    assert.deepEqual(out[0].payload, [1, 7], "비정수 id 가 SQL 에 섞였다");
  });

  test("ids 가 비면 아무것도 하지 않는다", () => {
    const e = mkEnv();
    const out = e.run("cl_result", { statusCode: 200, payload: {}, _ctrlIds: [] });
    assert.equal(out[0], null);
  });
});

describe("루프 제어", () => {
  test("cl_next: 500ms 텀 후 다음 배치 (SD 카드·서버 배려)", () => {
    const e = mkEnv({ ctrlSyncPaused: false });
    assert.equal(e.run("cl_next", {}), null);
    assert.equal(e.clock.pending().length, 1);
    e.clock.advance(501);
    assert.equal(port(e.sent, 0).length, 1, "다음 배치 트리거가 안 나가면 첫 200건만 보내고 멈춘다");
  });

  test("cl_next: 중지됐으면 루프를 끊는다", () => {
    const e = mkEnv({ ctrlSyncPaused: true, ctrlSyncRunning: true });
    e.run("cl_next", {});
    e.clock.advance(1000);
    assert.equal(port(e.sent, 0).length, 0, "중지했는데 루프가 계속 돈다");
    assert.equal(e.flow.get("ctrlSyncRunning"), false);
  });

  test("cl_start: 상태 리셋 + 즉시 응답 + 루프 착수", () => {
    const e = mkEnv({ ctrlSyncPaused: true }, { ctrlTotalUnsynced: 42 });
    const out = e.run("cl_start", { payload: {} });
    assert.equal(e.flow.get("ctrlSyncPaused"), false);
    assert.equal(e.flow.get("ctrlSyncRunning"), true);
    assert.equal(e.flow.get("ctrlSyncedSoFar"), 0);
    assert.equal(out[0].payload.success, true);
    assert.equal(port(e.sent, 1).length, 1, "시작 신호가 안 나가면 버튼을 눌러도 아무 일 없다");
  });

  test("cl_stop → cl_check 가 즉시 멈춘다 (연쇄)", () => {
    const e = mkEnv({ ctrlSyncPaused: false });
    e.run("cl_stop", { payload: {} });
    assert.equal(e.run("cl_check", {}), null);
  });

  test("cl_catch_fn: 예외에도 마킹 없음 — 데이터 보존 + 실패 기록", () => {
    const e = mkEnv({ ctrlSyncRunning: true });
    assert.equal(e.run("cl_catch_fn", { error: { message: "ECONNREFUSED" } }), null);
    assert.equal(e.flow.get("ctrlSyncRunning"), false);
    assert.equal(e.global.get("lastCtrlSyncResult").success, false);
    assert.equal(e.global.get("lastCtrlSyncResult").error, "ECONNREFUSED");
  });
});

describe("전체 루프 시나리오 (두 배치 → 완료)", () => {
  test("check→prepare→200→next→check→prepare(빈)→종료", () => {
    const e = mkEnv({ ctrlSyncPaused: false, ctrlSyncRunning: true, ctrlSyncedSoFar: 0 });

    // 1주기: 조회 → 2건 배치 → 성공 → 마킹
    assert.ok(e.run("cl_check", {}).topic.includes("SELECT"));
    const req = e.run("cl_prepare", { payload: ROWS });
    const res = e.run("cl_result", { statusCode: 200, payload: { inserted: 2 }, _ctrlIds: req._ctrlIds, _ctrlCount: req._ctrlCount });
    assert.match(res[0].topic, /synced = 1/);

    // 다음 배치 트리거
    e.run("cl_next", {});
    e.clock.advance(501);
    assert.equal(port(e.sent, 0).length, 1);

    // 2주기: 남은 것 없음 → 종료
    assert.ok(e.run("cl_check", {}).topic.includes("SELECT"), "루프 중에는 계속 조회돼야 한다");
    assert.equal(e.run("cl_prepare", { payload: [] }), null);
    assert.equal(e.flow.get("ctrlSyncRunning"), false, "빈 배치에서 running 이 안 꺼지면 UI 가 영원히 '동기화 중'");
    assert.equal(e.flow.get("ctrlSyncedSoFar"), 2);
  });
});
