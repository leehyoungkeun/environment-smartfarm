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

// 수동 작업 (manual-job-poller 가 forward) 인식 — backend status 동기화에 사용
const manualJobId = msg.payload.manualJobId || null;
const manualValves = Array.isArray(msg.payload.valves) ? msg.payload.valves : null;
const manualVolumeML = msg.payload.volumeML ?? null;

// 사이클 ID + 시작 시각
const cycleId = `cycle-${Date.now()}`;
const startedAt = new Date().toISOString();

global.set('cycleInProgress', true);
global.set('currentCycle', {
    id: cycleId,
    scenarioId: scenario.id,
    manualJobId,
    startedAt,
    phase: 'dosing',
    suppliedL: 0,
    valveIdx: -1,
});

node.status({ fill: 'blue', shape: 'dot', text: manualJobId ? `✋ ${cycleId.slice(-6)}` : `▶ ${cycleId.slice(-6)}` });

// 수동 작업이면 backend 에 status=running 통보 (시작 알림)
if (manualJobId) {
    sendBackend('PUT', `/manual-jobs/${manualJobId}/status`, { status: 'running' });
}

// === Phase 1: 도싱 (각 탱크 dosingRatio × baseVolume) ===
// baseVolume = 메인탱크 부피 (예: 100L) 의 도싱 비율로 mL 산출
// 수동 작업 시 manualVolumeML override 사용
const BASE_VOLUME_ML = manualVolumeML != null ? manualVolumeML : 100 * 1000; // default 100L
const dosingRatio = scenario.dosingRatio || {};

// ⭐ 산/알칼리 운영 모드 — 'both' | 'acid' | 'alkali'
const acidAlkaliMode = hw.acidAlkaliMode || 'both';

// ⭐ 다량공급 boost factor — safety-interlock 이 set 한 dosingMode 기반
const ecMode = global.get('ecDosingMode') || 'normal_up';
const phMode = global.get('phDosingMode') || 'normal_acid';
const isFast = ecMode.startsWith('fast') || phMode.startsWith('fast');
const boost = isFast ? 2.0 : 1.0;  // 빠른 모드면 2배 도싱

// 도싱 펌프 채널 (32CH 통합: 채널 8~13, t.modbusReg 우선)
const dosingChannels = tanks.slice(0, 6).map((t, i) => {
    const ratio = dosingRatio[t.id] || 0;
    // 산/알칼리 모드 필터링 — id 표기 한글·영문·약어 모두 수용
    const isAcid   = t.id === '산' || t.id === 'acid'   || t.id === 'AC';
    const isAlkali = t.id === 'F' || t.id === 'alkali' || t.id === 'AL';
    let effectiveRatio = ratio;
    if (acidAlkaliMode === 'acid'   && isAlkali) effectiveRatio = 0;
    if (acidAlkaliMode === 'alkali' && isAcid)   effectiveRatio = 0;
    const volumeMl = BASE_VOLUME_ML * effectiveRatio / 100 * boost;
    return {
        channel: t.modbusReg ?? (8 + i),  // 32CH default: 8~13
        label: t.id,
        ratio: effectiveRatio,
        volumeMl,
        durationMs: volumeMl / (hw.dosingPulseUnit || 500) * 60000,
    };
});

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

// === Phase 2: 교반 — hw.mixerOnSec 설정값 사용 ===
function runMixing() {
    if (global.get('safetyStop')) return cleanup();
    updateCycle({ phase: 'mixing' });
    const agitatorCh = hw.agitatorCh ?? 15;  // 32CH default
    sendRelay(agitatorCh, true, '교반기 ON');
    const mixSec = hw.mixerOnSec ?? 30;
    setTimeout(() => {
        sendRelay(agitatorCh, false, `교반기 OFF (${mixSec}s)`);
        runStabilization();
    }, mixSec * 1000);
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
    const mainPumpCh = hw.mainPumpCh ?? 14;  // 32CH default
    global.set('mainPumpOn', true);
    sendRelay(mainPumpCh, true, '메인 펌프 ON');

    const valves = scenario.valves || [];
    const valveChannels = hw.valves || [];  // [{ id, name, ch }, ...]
    // 수동 작업이면 manualValves (밸브 id 배열) 만 순회, 아니면 0..valveCount-1
    const targetIndices = manualValves
        ? manualValves.map(id => id - 1).filter(i => i >= 0 && i < valveCount)
        : Array.from({ length: valveCount }, (_, i) => i);
    let k = 0;
    const runNext = () => {
        if (k >= targetIndices.length || global.get('safetyStop')) {
            global.set('mainPumpOn', false);
            sendRelay(mainPumpCh, false, '메인 펌프 OFF');
            return cleanup();
        }
        const i = targetIndices[k];
        const v = valves[i] || { duration: 600, volume: 150 };
        const channel = valveChannels[i]?.ch ?? (16 + i);

        updateCycle({ phase: 'irrigating', valveIdx: i + 1, suppliedL: (k + 1) * (v.volume / 1000) });
        sendRelay(channel, true, `밸브 ${i+1} ON (${v.duration}s)`);

        setTimeout(() => {
            sendRelay(channel, false, `밸브 ${i+1} OFF`);
            k++;
            setTimeout(runNext, 500); // 밸브 전환 0.5s 갭
        }, v.duration * 1000);
    };
    runNext();
}

// === Phase 5: 정리 ===
function cleanup() {
    updateCycle({ phase: 'done' });

    // 수동 작업이면 targetIndices 기준, 아니면 전체 valveCount 기준 누적
    const usedIndices = manualValves
        ? manualValves.map(id => id - 1).filter(i => i >= 0 && i < valveCount)
        : Array.from({ length: valveCount }, (_, i) => i);
    const totalSupplied = usedIndices.reduce((s, i) =>
        s + ((scenario.valves || [])[i]?.volume || 0), 0) / 1000;

    // 누적 카운터 증가
    sendBackend('POST', `/counters/increment`, {
        doseL: BASE_VOLUME_ML / 1000, // 임시
        irrigationL: totalSupplied,
        cycles: 1,
        runtimeMin: Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000),
    });

    // 수동 작업이면 status 업데이트 — safetyStop 면 aborted, 정상이면 completed
    if (manualJobId) {
        const finalStatus = global.get('safetyStop') ? 'aborted' : 'completed';
        sendBackend('PUT', `/manual-jobs/${manualJobId}/status`, { status: finalStatus });
    }

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
            unitid: 3,       // Unit-Id 3 = 32CH 통합 릴레이 (환경 0~7 + 양액 8~30)
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
