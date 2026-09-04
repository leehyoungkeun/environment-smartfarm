// ============================================================
// "데몬 프록시" (fn_ks_proxy) — GET /api/ks3267/:action 을 127.0.0.1:3002 데몬으로 넘긴다.
// (KS X 3267 표준노드 탭, P3). 설정 UI 의 탐색·상태·프레임 조회가 백엔드 → 여기 → 데몬 순으로 온다.
// httpNodeMiddleware 가 /api/* 인증(키오스크 루프백 또는 농장 키)을 이미 적용한다.
// 읽기 전용 액션만 — 제어는 정규 경로(execute_control)로만.
// ============================================================
const ALLOWED = { discover: 1, scan: 1, nodes: 1, status: 1, frames: 1, events: 1, health: 1 };
const action = String((msg.req && msg.req.params && msg.req.params.action) || '');
if (!ALLOWED[action]) {
    msg.statusCode = 400;
    msg.payload = { success: false, error: '허용되지 않는 액션: ' + action };
    return [null, msg];   // 출력 2 = 즉시 응답
}
const q = (msg.req && msg.req.query) || {};
const qs = Object.keys(q).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(q[k])).join('&');
const api = env.get('KS3267_API') || 'http://127.0.0.1:3002';
msg.url = api + '/' + action + (qs ? '?' + qs : '');
msg.method = 'GET';
msg.requestTimeout = (action === 'scan') ? 120000 : 8000;   // 스캔은 범위 probe 라 오래 걸림
msg._ksAction = action;
return [msg, null];   // 출력 1 = http request 로
