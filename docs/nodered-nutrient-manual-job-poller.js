// 수동 작업 polling — backend /internal/nutrient/manual-jobs/pending 응답 처리
//
// 입력: msg.payload = { success: true, data: [{...job, scenario}, ...] }
// backend 가 이미 mode != 'manual' 면 빈 배열로 응답 + scenario 객체 join 해서 전달.
// dispatch 는 cycleInProgress / safetyStop 만 검사.

if (global.get('cycleInProgress')) {
    node.status({ fill: 'blue', shape: 'dot', text: '사이클 진행 중' });
    return null;
}
if (global.get('safetyStop')) {
    node.status({ fill: 'red', shape: 'ring', text: '안전 정지' });
    return null;
}

const response = msg.payload || {};
if (!response.success || !Array.isArray(response.data)) {
    node.status({ fill: 'yellow', shape: 'ring', text: '응답 형식 오류' });
    return null;
}

const jobs = response.data;
if (jobs.length === 0) {
    const reason = response.reason || '대기 작업 없음';
    node.status({ fill: 'grey', shape: 'dot', text: reason });
    return null;
}

// 가장 오래된 due job 1개 (응답이 이미 scheduleAt 순)
const job = jobs[0];
const scenario = job.scenario;
if (!scenario) {
    node.warn(`scenario join 없음: scenarioId=${job.scenarioId}`);
    node.status({ fill: 'red', shape: 'ring', text: 'scenario 누락' });
    return null;
}

const payload = {
    scenarioId: scenario.id,
    scenario,
    triggeredAt: new Date().toISOString(),
    reason: 'manual',
    manualJobId: job.id,
    valves: Array.isArray(job.valves) ? job.valves : null,
    volumeML: job.volumeML ?? null,
};

node.status({ fill: 'green', shape: 'dot', text: `▶ ${job.id.slice(-6)} V[${(job.valves || []).join(',')}]` });
node.log(`수동 작업 발사: id=${job.id} valves=${JSON.stringify(job.valves)} volume=${job.volumeML || 'default'}`);

return { payload };
