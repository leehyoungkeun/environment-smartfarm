// 카메라 수정 판단 — backend/src/utils/cameraPlan.js
// 2026-09-14: 사용 여부만 바꾸거나 이름만 바꿔도 영상 서버 스트림을 DB 의 옛 주소로 덮어쓰던 결함.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { planCameraUpdate } from "../../src/utils/cameraPlan.js";

describe("planCameraUpdate — 영상 서버는 주소를 새로 넣었을 때만 건드린다", () => {
  test("사고 재현: 토글로 사용 중단 → 영상 서버 덮어쓰기 없음, 제어기로만 전달", () => {
    const p = planCameraUpdate({ enabled: false });
    assert.equal(p.syncGo2rtc, false, "DB 옛 주소(.39)로 동작 중인 .36 스트림을 덮으면 카메라가 깨진다");
    assert.equal(p.pushToController, true);
  });

  test("사고 재현: 수정 폼이 가린 주소를 돌려보냄(이름만 수정) → 덮어쓰기 없음", () => {
    const p = planCameraUpdate({ name: "입구카메라", location: "1번", rtspUrl: "rtsp://afocus:***@192.168.0.39:554/stream1" });
    assert.equal(p.addressChanged, false);
    assert.equal(p.syncGo2rtc, false);
    assert.equal(p.pushToController, false, "사용 여부를 안 바꿨으면 제어기로 보낼 것도 없다");
  });

  test("사람이 새 주소를 입력하면 영상 서버를 갱신한다", () => {
    const p = planCameraUpdate({ rtspUrl: "rtsp://afocuscam:secret@192.168.0.36:554/stream1" });
    assert.equal(p.syncGo2rtc, true);
  });

  test("사용 여부는 불리언만 받는다 — 문자열 'false' 는 참으로 저장될 위험 (변이 프로브)", () => {
    assert.equal(planCameraUpdate({ enabled: "false" }).enabledInvalid, true);
    assert.equal(planCameraUpdate({ enabled: 0 }).enabledInvalid, true);
    assert.equal(planCameraUpdate({ enabled: true }).enabledInvalid, false);
  });

  test("빈 주소·빈 본문은 아무것도 건드리지 않는다", () => {
    assert.deepEqual(
      { ...planCameraUpdate({ rtspUrl: "  " }) },
      { addressChanged: false, enabledChanged: false, enabledInvalid: false, syncGo2rtc: false, pushToController: false }
    );
    assert.equal(planCameraUpdate(undefined).syncGo2rtc, false);
  });
});
