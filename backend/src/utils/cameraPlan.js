// 카메라 수정 요청이 무엇을 건드려야 하는지 판단한다 (2026-09-14)
//
// 사고 두 가지를 막는다.
//  1) 사용 여부만 바꿔도 영상 서버(go2rtc) 스트림을 DB 주소로 덮어썼다.
//     farm_0001 의 DB 주소는 옛 값(.39, 계정 afocus)이고 실제 동작 주소는 제어기 설정 파일의
//     .36(계정 afocuscam)이다. 덮어쓰면 멀쩡하던 스트림이 깨진다.
//  2) 수정 폼은 비밀번호를 가린 주소(:***@)를 그대로 돌려보낸다. 이름만 바꿔 저장해도
//     "주소가 왔다" 로 보고 같은 덮어쓰기가 일어났다.
//
// 원칙: 카메라 주소의 기준은 제어기(IP 표류를 추적하는 쪽)다. 서버는 사람이 주소를
// 새로 입력했을 때만 영상 서버를 갱신한다. 사용 여부는 제어기로 보내 점검·경보를 멈추게 한다.

const MASKED = /:\*\*\*@/;

/**
 * @param {object} body  PUT /api/cameras/:farmId/:camId 본문
 * @returns {{ addressChanged:boolean, enabledChanged:boolean, enabledInvalid:boolean,
 *            syncGo2rtc:boolean, pushToController:boolean }}
 */
export function planCameraUpdate(body) {
  const b = body || {};
  const addressChanged = typeof b.rtspUrl === "string" && b.rtspUrl.trim() !== "" && !MASKED.test(b.rtspUrl);
  const enabledInvalid = b.enabled !== undefined && typeof b.enabled !== "boolean";
  const enabledChanged = typeof b.enabled === "boolean";
  return {
    addressChanged,
    enabledChanged,
    enabledInvalid,
    syncGo2rtc: addressChanged,
    pushToController: enabledChanged,
  };
}
