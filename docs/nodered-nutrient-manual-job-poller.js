// 수동 작업 polling — backend /internal/nutrient/manual-jobs/pending 응답 처리
// flow 구조 (NR 에디터에서 구성):
//   [inject 60s] → [http request: GET https://api.smartgreen.kr/internal/nutrient/manual-jobs/pending
//                   headers: { 'x-api-key': $sensorApiKey }]
//                → [이 function] → [cycle-runner 입력]
//
// 입력: msg.payload = { success: true, data: [job, ...] } (backend 응답)
// 각 job 을 cycle-runner 가 받는 msg.payload 형식으로 변환해서 1개씩 send.
// cycleInProgress / safetyStop / mode != 'manual' 이면 skip.

const apiKey = global.get('sensorApiKey') || 'smartfarm-sensor-key';
const lastState = global.get('lastState') || {};
const mode = lastState.mode || 'paused';

// 수동 모드가 아닐 때 manual job 발사 X (사용자가 모드 잠갔다는 의미)
if (mode !== 'manual') {
    node.status({ fill: 'grey', shape: 'ring', text: `mode=${mode}` });
    return null;
}

// 사이클 진행 중이면 다음 polling 까지 대기 (graceful — 1 cycle 1 job)
if (global.get('cycleInProgress')) {
    node.status({ fill: 'blue', shape: 'dot', text: '사이클 진행 중 — 다음 polling 대기' });
    return null;
}

// 안전 인터락 활성 — 수동 작업도 거부
if (global.get('safetyStop')) {
    node.status({ fill: 'red', shape: 'ring', text: '안전 정지 — 수동 작업 거부' });
    return null;
}

// backend 응답 검증
const response = msg.payload || {};
if (!response.success || !Array.isArray(response.data)) {
    node.status({ fill: 'yellow', shape: 'ring', text: '응답 형식 오류' });
    return null;
}

const jobs = response.data;
if (jobs.length === 0) {
    node.status({ fill: 'grey', shape: 'dot', text: '대기 작업 없음' });
    return null;
}

// 가장 오래된 pending due job 1개만 실행 (poll 응답이 이미 scheduleAt 순 정렬)
const job = jobs[0];

// 시나리오 fetch — global 에 캐시된 scenarios 사용 (config-fetcher 가 채워둠)
const scenarios = global.get('scenarios') || [];
const scenario = scenarios.find(s => s.id === job.scenarioId);
if (!scenario) {
    node.warn(`scenario 없음: ${job.scenarioId} — job ${job.id} skip`);
    node.status({ fill: 'red', shape: 'ring', text: 'scenario 없음' });
    return null;
}

// cycle-runner 입력 형식 — 자동 trigger 와 동일하게 + manual flag
const payload = {
    scenarioId: scenario.id,
    scenario,
    triggeredAt: new Date().toISOString(),
    reason: 'manual',
    manualJobId: job.id,
    valves: Array.isArray(job.valves) ? job.valves : null,
    volumeML: job.volumeML ?? null,
};

node.status({ fill: 'green', shape: 'dot', text: `▶ ${job.id.slice(-6)} (V${(job.valves || []).join(',')})` });
node.log(`수동 작업 발사: id=${job.id} valves=${JSON.stringify(job.valves)} volume=${job.volumeML || 'default'}`);

return { payload };
