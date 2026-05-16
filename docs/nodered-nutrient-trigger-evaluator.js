// 양액 시나리오 트리거 평가 — 1분 주기 inject
// 입력: timestamp
// 출력 1: 트리거 발생 → cycle-runner 로 시나리오 전달
// 출력 2: 트리거 없음 (null)
//
// backend 에서 active 시나리오 + state 가져와 평가
// irrigationMode 별 판단:
//   solar    → solarAccumulated >= solarThreshold
//   timer    → 마지막 사이클로부터 timerInterval 경과
//   schedule → 현재 시각이 scheduleSlots 중 하나와 매칭 (HH:MM, ±1분)

const farmConfig = global.get('farmConfig') || {};
const farmId = farmConfig.farmId || 'farm_0001';

// 안전 정지 상태면 트리거 안 함
if (global.get('safetyStop')) {
    node.status({ fill: 'red', shape: 'ring', text: '🛑 safetyStop' });
    return [null, null];
}

// 진행 중 사이클 있으면 새로 트리거 안 함
if (global.get('cycleInProgress')) {
    node.status({ fill: 'blue', shape: 'dot', text: '⏳ 사이클 진행 중' });
    return [null, null];
}

// 백엔드에서 받아온 시나리오·상태는 별도 inject 가 5분마다 fetch 해서 global 에 저장
//   global.activeScenario  = { id, irrigationMode, ecTarget, ..., valves, days }
//   global.state           = { mode, solarAccumulated, ... }
//   global.lastCycleAt     = timestamp (사이클 완료 시 set)

const scenario = global.get('activeScenario');
const state = global.get('state') || {};

if (!scenario) {
    node.status({ fill: 'grey', shape: 'ring', text: 'active 시나리오 없음' });
    return [null, null];
}

// 모드 체크 — auto 일 때만 자동 트리거
if (state.mode !== 'auto') {
    node.status({ fill: 'grey', shape: 'ring', text: `mode=${state.mode}` });
    return [null, null];
}

// 요일 체크
const now = new Date();
const dayOfWeek = now.getDay(); // 0=일, 6=토
if (Array.isArray(scenario.days) && scenario.days.length > 0 && !scenario.days.includes(dayOfWeek)) {
    node.status({ fill: 'grey', shape: 'ring', text: '오늘 요일 X' });
    return [null, null];
}

// 시간 범위 체크 (timer/schedule 모드만)
const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
const inTimeRange = (start, end) => {
    if (!start || !end) return true;
    if (start <= end) return hhmm >= start && hhmm <= end;
    return hhmm >= start || hhmm <= end; // 자정 넘기기
};

let shouldTrigger = false;
let reason = '';

if (scenario.irrigationMode === 'solar') {
    // 일사량 적산 도달 시
    if ((state.solarAccumulated || 0) >= (scenario.solarThreshold || 100)) {
        shouldTrigger = true;
        reason = `solar ${state.solarAccumulated}/${scenario.solarThreshold} W/m²`;
        // 트리거 후 적산 리셋
        global.set('solarAccumulated', 0);
    }
} else if (scenario.irrigationMode === 'timer') {
    if (!inTimeRange(scenario.timerStart, scenario.timerEnd)) {
        node.status({ fill: 'grey', shape: 'ring', text: '시간 범위 밖' });
        return [null, null];
    }
    // 마지막 사이클 + interval 경과?
    const lastAt = global.get('lastCycleAt') || 0;
    const intervalMin = parseTimeToMinutes(scenario.timerInterval || '00:30');
    if (Date.now() - lastAt >= intervalMin * 60 * 1000) {
        shouldTrigger = true;
        reason = `timer 경과 ${intervalMin}분`;
    }
} else if (scenario.irrigationMode === 'schedule') {
    if (Array.isArray(scenario.scheduleSlots) && scenario.scheduleSlots.includes(hhmm)) {
        // 같은 슬롯 중복 방지 — 1분 윈도우 안에 한 번만
        const lastSlot = global.get('lastTriggeredSlot');
        if (lastSlot !== `${now.toDateString()}@${hhmm}`) {
            shouldTrigger = true;
            reason = `schedule ${hhmm}`;
            global.set('lastTriggeredSlot', `${now.toDateString()}@${hhmm}`);
        }
    }
}

if (shouldTrigger) {
    node.status({ fill: 'green', shape: 'dot', text: `▶ ${reason}` });
    return [{
        payload: {
            scenarioId: scenario.id,
            scenario,
            triggeredAt: now.toISOString(),
            reason,
        },
    }, null];
}

node.status({ fill: 'grey', shape: 'dot', text: '대기' });
return [null, null];

// HH:MM → 분 단위 변환
function parseTimeToMinutes(t) {
    if (!t) return 30;
    const [h, m] = t.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}
