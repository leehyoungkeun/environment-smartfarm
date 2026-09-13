// 제어 경로 결정 — 순수 로직 (React 무의존, backend/test/unit/control-route.test.js 로 검증)
//
// 2026-09-13 키오스크 먹통 사고의 근본 수정:
//   전에는 "화면이 localhost(키오스크)이면 모드와 무관하게 로컬 경로" 였다. 그래서 nginx→Node-RED 가
//   502 로 죽었을 때, 클라우드는 멀쩡한데도 패널에서 제어만 실패했고 이력조차 남지 않았다.
//   문서화된 설계("기본 클라우드, 끊기면 농장주가 명시적으로 팜로컬 전환")에 코드를 맞춘다.

/**
 * 로컬(RPi Node-RED) 경로로 제어할 것인가.
 *
 * 규칙
 *  1) **명시 선택일 때만** 로컬 — 팜로컬 토글(isFarmLocal) 또는 수동 오프라인(manualOverride).
 *     헬스체크 실패(serverOnline=false)만으로는 경로를 바꾸지 않는다 (자동 모드 전환 금지 원칙).
 *  2) 로컬 경로가 **실제로 존재**할 때만 — https 페이지는 Mixed Content 로 RPi 직접 호출이 막혀
 *     getRpiApiBase() 가 PC 서버를 돌려준다. 그때 로컬로 보내면 백엔드에 없는 라우트라 404.
 *
 * @param {{isFarmLocal?:boolean, manualOverride?:boolean, rpiBase?:string, pcBase?:string}} s
 * @returns {boolean} true = RPi 로컬 REST, false = 클라우드(AWS IoT)
 */
export function useLocalControl(s) {
  if (!s) return false;
  const explicit = !!(s.isFarmLocal || s.manualOverride);
  const hasRpiPath = !!s.rpiBase && !!s.pcBase && s.rpiBase !== s.pcBase;
  return explicit && hasRpiPath;
}
