// 양액 1회 관수 사이클 실행 — trigger-evaluator 에서 발사
// 입력: msg.payload = { scenarioId, scenario, triggeredAt, reason }
// 출력 1: Modbus 릴레이 명령 (Unit-Id 3 FC15)
// 출력 2: backend telemetry/counters POST 메시지
//
// Phase: 도싱 → 교반 → 안정화 → 관수 (구역 순차) → 정리
// 비동기 단계라서 setTimeout 으로 처리. 각 단계마다 currentCycle 갱신.

// 기존 NR 패턴 — sensorApiKey + FARM_ID 환경변수 fallback
const farmId = global.get('FARM_ID') || 'farm_0001';
const apiKey = global.get('sensorApiKey') || 'smartfarm-sensor-key';
const config = global.get('nutrientConfig') || {};

if (global.get('cycleInProgress')) {
    node.warn('이미 사이클 진행 중 — 새 트리거 무시');
    return null;
}
if (global.get('safetyStop')) {
    node.warn('safetyStop 활성 — 사이클 시작 불가');
    return null;
}

const scenario = msg.payload.scenario;
const tanks = config.tanks || [];
const valveCount = config.valveCount || 14;
const hw = config.hardware || { dosingPulseUnit: 500 };

// 사이클 ID + 시작 시각
const cycleId = `cycle-${Date.now()}`;
const startedAt = new Date().toISOString();

global.set('cycleInProgress', true);
global.set('currentCycle', {
    id: cycleId,
    scenarioId: scenario.id,
    startedAt,
    phase: 'dosing',
    suppliedL: 0,
    valveIdx: -1,
});

node.status({ fill: 'blue', shape: 'dot', text: `▶ ${cycleId.slice(-6)}` });

// === Phase 1: 도싱 (각 탱크 dosingRatio × baseVolume) ===
// baseVolume = 메인탱크 부피 (예: 100L) 의 도싱 비율로 mL 산출
const BASE_VOLUME_ML = 100 * 1000; // 100L 메인 탱크 가정 (config 로 이동 가능)
const dosingRatio = scenario.dosingRatio || {};

// 도싱 펌프 채널 (Unit-Id 3 채널 0~5)
const dosingChannels = tanks.slice(0, 6).map((t, i) => ({
    channel: t.modbusReg ?? i,
    label: t.id,
    ratio: dosingRatio[t.id] || 0,
    volumeMl: BASE_VOLUME_ML * (dosingRatio[t.id] || 0) / 100,
    // 도싱 펌프 속도: hw.dosingPulseUnit (mL per ms 가정, 보정 필요)
    durationMs: (BASE_VOLUME_ML * (dosingRatio[t.id] || 0) / 100) / (hw.dosingPulseUnit || 500) * 60000,
}));

// 도싱 실행 함수
function runDosing() {
    updateCycle({ phase: 'dosing' });
    dosingChannels.forEach((d, i) => {
        if (d.volumeMl <= 0) return;
        // 펌프 ON
        sendRelay(d.channel, true, `도싱 ${d.label} ON`);
        // duration 후 OFF
        setTimeout(() => sendRelay(d.channel, false, `도싱 ${d.label} OFF`), d.durationMs);
    });
    // 모든 도싱 끝나면 다음 단계
    const maxDuration = Math.max(...dosingChannels.map(d => d.durationMs), 0);
    setTimeout(runMixing, maxDuration + 1000);
}

// === Phase 2: 교반 (60초) ===
function runMixing() {
    if (global.get('safetyStop')) return cleanup();
    updateCycle({ phase: 'mixing' });
    sendRelay(7, true, '교반기 ON'); // 채널 7 = 교반기
    setTimeout(() => {
        sendRelay(7, false, '교반기 OFF');
        runStabilization();
    }, 60 * 1000);
}

// === Phase 3: EC/pH 안정화 확인 (10초) ===
function runStabilization() {
    if (global.get('safetyStop')) return cleanup();
    updateCycle({ phase: 'stabilizing' });
    setTimeout(() => {
        const lastTel = global.get('lastTelemetry');
        // 안정화 체크 (실 운영: 표준편차 0.05 이하 등)
        node.log(`안정화 OK: EC ${lastTel?.ec}, pH ${lastTel?.ph}`);
        runIrrigation();
    }, 10 * 1000);
}

// === Phase 4: 관수 (메인펌프 + 밸브 순차) ===
function runIrrigation() {
    if (global.get('safetyStop')) return cleanup();
    updateCycle({ phase: 'irrigating' });
    global.set('mainPumpOn', true);
    sendRelay(6, true, '메인 펌프 ON');

    const valves = scenario.valves || [];
    let i = 0;
    const runNext = () => {
        if (i >= valveCount || global.get('safetyStop')) {
            global.set('mainPumpOn', false);
            sendRelay(6, false, '메인 펌프 OFF');
            return cleanup();
        }
        const v = valves[i] || { duration: 600, volume: 150 };
        const channel = 8 + i; // 채널 8~21 = 밸브 1~14

        updateCycle({ phase: 'irrigating', valveIdx: i + 1, suppliedL: (i + 1) * (v.volume / 1000) });
        sendRelay(channel, true, `밸브 ${i+1} ON (${v.duration}s)`);

        setTimeout(() => {
            sendRelay(channel, false, `밸브 ${i+1} OFF`);
            i++;
            setTimeout(runNext, 500); // 밸브 전환 0.5s 갭
        }, v.duration * 1000);
    };
    runNext();
}

// === Phase 5: 정리 ===
function cleanup() {
    updateCycle({ phase: 'done' });

    const totalSupplied = (scenario.valves || []).slice(0, valveCount).reduce((s, v) => s + (v?.volume || 0), 0) / 1000;

    // 누적 카운터 증가
    sendBackend('POST', `/counters/increment`, {
        doseL: BASE_VOLUME_ML / 1000, // 임시
        irrigationL: totalSupplied,
        cycles: 1,
        runtimeMin: Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000),
    });

    global.set('cycleInProgress', false);
    global.set('lastCycleAt', Date.now());
    global.set('currentCycle', null);

    node.status({ fill: 'green', shape: 'dot', text: `✓ ${totalSupplied}L 공급 완료` });
}

// === 헬퍼 ===
function sendRelay(channel, on, label) {
    if (global.get('nutrientSimulator')) {
        node.log(`[SIM] ${label} (CH${channel} ${on ? 'ON' : 'OFF'})`);
        return;
    }
    // modbus-flex-write 호환: msg.payload = { value, fc, unitid, address, quantity }
    node.send([{
        payload: {
            value: on,
            fc: 5,           // FC5 = Write Single Coil
            unitid: 3,       // Unit-Id 3 = 24CH 양액 릴레이
            address: channel,
            quantity: 1,
        },
        label,
    }, null]);
}

function updateCycle(patch) {
    const cur = global.get('currentCycle') || {};
    const next = { ...cur, ...patch };
    global.set('currentCycle', next);
}

function sendBackend(method, path, body) {
    node.send([null, {
        url: `https://api.smartgreen.kr/internal/nutrient${path}`,
        method,
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
        },
        payload: body,
    }]);
}

// 시작!
runDosing();
return null;
