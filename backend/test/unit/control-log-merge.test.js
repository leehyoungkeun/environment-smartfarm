// 한 번의 조작이 두 줄로 남던 것 — 전송 기록과 실행 결과의 분리 (2026-10-06).
//
// 증상: house_0003 window1 을 11번 눌렀더니 control_logs 에
//   `web_dashboard / success=true` 11건 + `automation / success=false` 11건 이 남았다.
//   ① 이력 화면에는 '성공' 만 보여 실패를 못 알아챘고,
//   ② 고장 감지는 실패만 세어 「30분간 11회 제어 실패 · 심각」 을 올렸다.
//   ③ 사람이 누른 것인데 출처가 'automation' 이었다 — 라우트가 하드코딩하고 있었다.
//
// 여기서는 라우트의 분기 규칙(어떤 출처로·어느 경로로 기록하는가)을 고정한다.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

/** internal.routes.js `POST /internal/control-log` 의 판정 규칙 (같은 식) */
const decide = ({ operator, ruleId, success, reason, requestId }) => {
  const isAuto = !operator || operator === "automation" || !!ruleId;
  const who = operator && operator !== "automation" ? operator : "automation";
  return {
    operator: who,
    isAutomatic: isAuto,
    error: success === false ? (reason || "제어 실행 실패") : null,
    merge: !!requestId,          // requestId 가 있으면 전송 기록을 덮어쓴다
  };
};

describe("제어 이력 — 전송 기록과 실행 결과를 한 줄로", () => {
  test("화면에서 누른 제어는 출처가 보존된다 (automation 으로 덮지 않는다)", () => {
    const d = decide({ operator: "web_dashboard", success: false, requestId: "r1" });
    assert.equal(d.operator, "web_dashboard");
    assert.equal(d.isAutomatic, false, "사람이 누른 것을 자동화로 세면 통계가 오염된다");
  });

  test("자동화가 한 제어는 그대로 automation", () => {
    const d = decide({ ruleId: "rule-1", success: true, requestId: null });
    assert.equal(d.operator, "automation");
    assert.equal(d.isAutomatic, true);
  });

  test("출처를 안 보내면 자동화로 본다 (옛 NR 과 호환)", () => {
    const d = decide({ success: true });
    assert.equal(d.operator, "automation");
    assert.equal(d.isAutomatic, true);
  });

  test("규칙으로 실행됐으면 operator 가 사람이어도 자동으로 센다", () => {
    const d = decide({ operator: "web_dashboard", ruleId: "rule-9", success: true });
    assert.equal(d.isAutomatic, true, "규칙이 발동한 것은 자동화다");
  });

  test("requestId 가 있으면 전송 기록을 덮어쓴다 — 한 조작은 한 줄", () => {
    assert.equal(decide({ operator: "web_dashboard", success: false, requestId: "r1" }).merge, true);
  });

  test("requestId 가 없으면 새로 넣는다 (전송 기록이 없는 자동화 경로)", () => {
    assert.equal(decide({ ruleId: "rule-1", success: true }).merge, false);
  });

  test("실패는 사유를 남긴다 — 사유 없는 실패는 추적이 안 된다", () => {
    assert.equal(decide({ success: false, reason: "KS X 3267 실패: 응답 없음" }).error, "KS X 3267 실패: 응답 없음");
    assert.equal(decide({ success: false }).error, "제어 실행 실패", "비워 두지 않는다");
    assert.equal(decide({ success: true }).error, null);
  });
});

/** deviceFailureAlert.js 의 제외 규칙 (같은 정규식) */
const NOT_CONNECTED = /(응답 없음|노드 없음|미연결|not ?found|no ?node|timeout|사용 안 함|disabled)/i;
const counts = (error) => !NOT_CONNECTED.test(error || "");

describe("장비 고장 감지 — '미연결' 은 고장이 아니다", () => {
  test("노드·모듈이 없어 난 실패는 세지 않는다", () => {
    for (const e of ["KS X 3267 실패: 응답 없음", "노드 없음", "모듈 미연결", "node not found",
                     "Modbus timeout", "모듈이 사용 안 함 상태", "module disabled"]) {
      assert.equal(counts(e), false, e);
    }
  });

  test("진짜 고장은 그대로 센다", () => {
    for (const e of ["릴레이 코일 쓰기 거부", "CRC 오류", "전압 이상", "예외 0x02", ""]) {
      assert.equal(counts(e), true, e || "(사유 없음)");
    }
  });
});
