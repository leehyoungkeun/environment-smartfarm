// GlitchTip 통합 SDK 살아있는지 검증 — 사용법:
//   GLITCHTIP_DSN=https://...@sentry.smartgreen.kr/2 node sentry-live-test.cjs
//
// backend/rpi-server 디렉토리에서 실행해야 함 (@sentry/node 의존성 필요)
// 결과: GlitchTip 의 해당 프로젝트 Issues 에 "LIVE TEST: ..." 이슈 추가
const Sentry = require('@sentry/node');
const dsn = process.env.GLITCHTIP_DSN;
if (!dsn) {
    console.error('GLITCHTIP_DSN env 필요');
    process.exit(1);
}
Sentry.init({ dsn, environment: 'live-test' });
Sentry.captureException(new Error('LIVE TEST: SDK alive check ' + new Date().toISOString()));
Sentry.flush(3000).then(() => { console.log('SENT'); process.exit(0); }).catch(e => { console.log('ERR:', e.message); process.exit(1); });
