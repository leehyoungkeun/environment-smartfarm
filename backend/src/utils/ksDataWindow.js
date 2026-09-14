// KOAT 116/117 「30일 데이터」·「손실률 3% 이내」 준비 상태 계산 (2026-09-14)
//
// 사고: 2026-09-12 정전, 09-13 농장 이동으로 표준 구동기 1분 스냅샷의 하루 손실률이 43%·48% 가 됐다.
// 9/6~9/11 은 0% 였으므로 30일 창이 그 순간 끊겼는데 아무도 몰랐다. 검정은 입고 시점 기준
// 30일 이상 1분 데이터를 요구하므로, 끊긴 줄 모르고 입고일을 잡으면 그대로 부적합이다.
// 하루 단위로 손실률을 계산해 창이 며칠째인지, 언제 입고 가능한지를 지표로 낸다.
//
// 순수 함수만 둔다 — DB·시계는 호출하는 쪽이 넘긴다 (backend/test/unit/ks-data-window.test.js).

export const DAY_MINUTES = 1440;

/** 하루 손실률 L = (1 − N/1440) × 100, 소수 둘째 자리. N 이 1440 을 넘으면 0 으로 자른다 */
export function lossPct(n, expected = DAY_MINUTES) {
  const v = (1 - (Number(n) || 0) / expected) * 100;
  return Math.max(0, Math.round(v * 100) / 100);
}

/** 'YYYY-MM-DD' 에 일수를 더한다. UTC 자정 기준 달력 계산이라 시간대·서머타임과 무관하다 */
export function addDays(day, n) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 두 날짜 사이 일수 (b − a) */
export function daysBetween(a, b) {
  const t = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400000);
}

/** 한국 시각 기준 오늘 날짜 */
export function kstToday(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * 지금도 기록이 쌓이는 계열인가 — 오늘이나 어제 행이 있어야 한다.
 * 삭제한 시험 장치(예: 2026-09-04 에 지운 ks_test_sw1)는 어제 손실이 100% 로 계산돼
 * 경보가 영원히 울린다. 운영 중인 계열만 지표로 낸다.
 */
export function isActiveSeries(counts, today) {
  const c = counts || {};
  return (c[today] || 0) > 0 || (c[addDays(today, -1)] || 0) > 0;
}

/**
 * 하루별 1분 행 수로 30일 창 상태를 계산한다.
 * @param {Record<string, number>} counts  { 'YYYY-MM-DD'(KST): 행 수 }
 * @param {string} today  KST 오늘. 오늘은 아직 끝나지 않았으므로 판정에서 뺀다.
 * @returns {{ yesterdayLoss:number, windowDays:number, windowStart:string|null,
 *            lastBrokenDay:string|null, readyOn:string|null, ready:boolean }}
 *   windowDays    어제부터 거꾸로 세어 손실률이 기준 이하인 '완전한 날' 연속 일수.
 *                 기록이 시작된 뒤 행이 하나도 없는 날은 100% 손실로 본다.
 *   windowStart   창의 첫날. 어제가 끊긴 날이면 오늘.
 *   readyOn       창이 requiredDays 를 채우는 날 — 그날부터 입고 가능. 기록이 전혀 없으면 null.
 */
export function analyzeWindow(counts, today, { threshold = 3, requiredDays = 30, lookbackDays = 90 } = {}) {
  const c = counts || {};
  const past = Object.keys(c).filter((d) => d < today).sort();
  const yesterday = addDays(today, -1);
  const yesterdayLoss = lossPct(c[yesterday] || 0);
  const hasToday = (c[today] || 0) > 0;

  if (past.length === 0) {
    const start = hasToday ? today : null;
    return { yesterdayLoss, windowDays: 0, windowStart: start, lastBrokenDay: null,
             readyOn: start ? addDays(start, requiredDays) : null, ready: false };
  }

  const first = past[0];
  let windowDays = 0;
  let lastBrokenDay = null;
  for (let i = 1; i <= lookbackDays; i++) {
    const d = addDays(today, -i);
    if (d < first) break;                       // 기록 시작 전은 '끊김' 이 아니라 '없음'
    if (lossPct(c[d] || 0) <= threshold) windowDays++;
    else { lastBrokenDay = d; break; }
  }

  const windowStart = addDays(today, -windowDays);
  const readyOn = addDays(windowStart, requiredDays);
  return { yesterdayLoss, windowDays, windowStart, lastBrokenDay, readyOn, ready: readyOn <= today };
}
