// frontend/src/components/Nutrient/NutrientRealtime.jsx
// 양액 실시간 운영 — NutrientPanel 1번째 탭 ("실시간")
//
// preview.html (다크 navy stage SVG) 버전 기반.
// preview-only 인 window.__mockNutrientApi / STATE_POLL_MS=2000 만 production 값으로.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as nutrientApi from '../../services/nutrientApi';


const STATE_POLL_MS  = 5000;
const ALERTS_POLL_MS = 5000;

const PHASE_PLAN = [
  { key: 'dosing',     label: '도싱',   short: '도싱',    duration: 42  },
  { key: 'mixing',     label: '교반',   short: '교반',    duration: 60  },
  { key: 'stabilize',  label: '안정화', short: '안정화', duration: 30  },
  { key: 'irrigating', label: '관수',   short: '관수',  duration: 480 },
  { key: 'cleanup',    label: '정리',   short: '정리',   duration: 20  },
];

const MODES = {
  auto:      { label: '자동', long: '자동운행', c: '#16a34a' },
  manual:    { label: '수동', long: '수동',     c: '#d97706' },
  paused:    { label: '정지', long: '일시정지', c: '#2563eb' },
  emergency: { label: '비상', long: '비상정지', c: '#dc2626' },
};

const SEV = {
  info:     { c: '#0891b2', label: '정보' },
  warning:  { c: '#d97706', label: '경고' },
  critical: { c: '#dc2626', label: '위험' },
};

const T = {
  bg:'#f7f8fa', card:'#ffffff', bd:'#e5e7eb', hair:'#eef0f3',
  fg:'#0b1220', fg2:'#475569', fg3:'#94a3b8', fg4:'#cbd5e1',
  acc:'#0891b2', acc2:'#06b6d4', accBg:'#ecfeff',
  ok:'#16a34a', warn:'#d97706', info:'#2563eb', danger:'#dc2626',
};

const MONO = `"JetBrains Mono", "SF Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace`;
const SANS = `-apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`;

const Ico = {
  Play:  ({ s = 10 }) => <svg width={s} height={s} viewBox="0 0 12 12" fill="currentColor"><path d="M3.5 2 L10 6 L3.5 10 Z"/></svg>,
  Pause: ({ s = 10 }) => <svg width={s} height={s} viewBox="0 0 12 12" fill="currentColor"><rect x="3" y="2.5" width="2" height="7" rx="0.5"/><rect x="7" y="2.5" width="2" height="7" rx="0.5"/></svg>,
  Stop:  ({ s = 10 }) => <svg width={s} height={s} viewBox="0 0 12 12" fill="currentColor"><rect x="2.5" y="2.5" width="7" height="7" rx="1"/></svg>,
  Hand:  ({ s = 10 }) => <svg width={s} height={s} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 7 V3.5 M7 7 V2.5 M9 7 V3.5 M3 7 Q3 10.5 6 10.5 Q9.5 10.5 10 8 V6.5"/></svg>,
  Bell:  ({ s = 10 }) => <svg width={s} height={s} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 1.5 V2.5 M3 5.5 Q3 3 6 3 Q9 3 9 5.5 V7.5 L10 9 H2 L3 7.5 Z M5 10 Q5 11 6 11 Q7 11 7 10"/></svg>,
};
const MODE_ICON = { auto: Ico.Play, manual: Ico.Hand, paused: Ico.Pause, emergency: Ico.Stop };

const kicker = { fontSize: 11.5, fontWeight: 700, color: T.fg3, letterSpacing: '0.14em', textTransform: 'uppercase' };

export default function NutrientRealtime({ farmId, mode, onModeChange }) {
  const [state, setState] = useState(null);
  const [config, setConfig] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [now, setNow] = useState(Date.now());

  // 다이어그램 zoom (1x ~ 3x). 모바일 default 1.5x — 글씨 보기 편함.
  const [diagramZoom, setDiagramZoom] = useState(1.5);

  // 수동 모드 — 1회 공급 작업 만들기
  const [selectedValves, setSelectedValves] = useState(new Set());
  const [manualScenarioId, setManualScenarioId] = useState(null);
  const [manualVolumeML, setManualVolumeML] = useState('');
  // sub-mode: 'queue' (큐 순차 자동 실행) | 'schedule' (시간 지정 예약)
  const [manualSubMode, setManualSubMode] = useState('queue');
  const [manualScheduleCustom, setManualScheduleCustom] = useState('');
  // 수동 작업 큐 — backend 동기화 (5초 polling)
  const [manualJobs, setManualJobs] = useState([]);
  const [queueOpen, setQueueOpen] = useState(false);

  useEffect(() => {
    let c = false;
    const tick = async () => {
      const [cfg, sc] = await Promise.all([
        nutrientApi.getConfig(farmId).catch(() => null),
        nutrientApi.listScenarios(farmId).catch(() => []),
      ]);
      if (c) return;
      setConfig(cfg || { tanks: [], valveCount: 0 });
      setScenarios(sc || []);
    };
    tick();
    // Settings 저장 즉시 반영을 위해 polling (config 자주 안 바뀜 — 10초)
    const id = setInterval(tick, 10000);
    return () => { c = true; clearInterval(id); };
  }, [farmId]);

  useEffect(() => {
    let c = false;
    const tick = async () => { try { const s = await nutrientApi.getState(farmId); if (!c) setState(s); } catch {} };
    tick();
    const id = setInterval(tick, STATE_POLL_MS);
    return () => { c = true; clearInterval(id); };
  }, [farmId]);

  // 외부 mode 변경 감지 — Panel 에 알려 헤더 ModeSelector 동기화 (API 호출 X)
  // 사용자 클릭 직후 optimistic update vs stale polling race 방지:
  // state.mode 가 DB-side 에서 실제로 바뀐 경우 (이전 polling 결과와 다름) 에만 callback.
  // 단순 "props.mode !== state.mode" 체크는 클릭 직후 polling stale 시간 동안 revert 유발.
  const lastStateModeRef = useRef(null);
  useEffect(() => {
    if (!state?.mode) return;
    if (lastStateModeRef.current === state.mode) return;  // DB-side 변경 없음
    lastStateModeRef.current = state.mode;
    if (state.mode !== mode) onModeChange?.(state.mode, { external: true });
  }, [state?.mode, mode, onModeChange]);

  useEffect(() => {
    let c = false;
    const tick = async () => { try { const a = await nutrientApi.listAlerts(farmId, { resolved: false, limit: 5 }); if (!c) setAlerts(a || []); } catch {} };
    tick();
    const id = setInterval(tick, ALERTS_POLL_MS);
    return () => { c = true; clearInterval(id); };
  }, [farmId]);

  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);

  const activeScenario = scenarios.find(s => s.active);
  const activeScenarioIdx = scenarios.findIndex(s => s.active);
  const activeProgramNum = activeScenarioIdx >= 0 ? activeScenarioIdx + 1 : null;
  const activeProgramName = activeScenario?.name || null;
  const ecTarget = activeScenario?.ecTarget ?? null;
  const phTarget = activeScenario?.phTarget ?? null;

  const phaseInfo = useMemo(() => {
    const cc = state?.currentCycle;
    if (!cc || !cc.phase || !cc.startedAt) return null;
    const elapsed = Math.max(0, Math.floor((now - new Date(cc.startedAt).getTime()) / 1000));
    const plan = PHASE_PLAN.find(p => p.key === cc.phase);
    if (!plan) return null;
    return { phaseKey: cc.phase, label: plan.label, short: plan.short, elapsed,
      duration: plan.duration, remaining: Math.max(0, plan.duration - elapsed),
      progress: Math.min(1, elapsed / plan.duration),
      valveIdx: cc.valveIdx ?? null, suppliedL: cc.suppliedL ?? 0 };
  }, [state, now]);

  // 하드웨어 BOM default (nutrient-flow-design.md) — config 가 완전히 빌 때만 사용.
  // Settings 에 저장된 값이 source of truth — 4 탱크면 4 탱크, 8 밸브면 8 밸브 그대로 표시.
  const TANK_DEFAULTS = [
    { id: 'A',  name: '질산칼슘',     short: 'A' },
    { id: 'B',  name: '다비료 NPK',   short: 'B' },
    { id: 'C',  name: '미량요소',     short: 'C' },
    { id: 'D',  name: '황산마그네슘', short: 'D' },
    { id: 'AC', name: '산 HNO₃',      short: '산' },
    { id: 'AL', name: '알칼리 KOH',   short: '알' },
  ];
  const cfgTanks = config?.tanks?.length ? config.tanks : TANK_DEFAULTS;
  const tanks = cfgTanks.map((t, i) => ({
    id: t.id ?? `T${i + 1}`,
    // backend label / 신규 디자인 name — 둘 다 수용
    name: t.name || t.label || TANK_DEFAULTS[i]?.name || `탱크 ${i + 1}`,
    level: t.level ?? null,
  }));
  const valveCount = config?.valveCount ?? 14;
  // 밸브 source: config.valves (legacy) → config.hardware.valves (32CH 통합 후 표준 위치) → default
  const cfgValves = config?.valves?.length ? config.valves
                  : config?.hardware?.valves?.length ? config.hardware.valves
                  : null;
  const valves = (cfgValves?.length ?? 0) >= valveCount
    ? cfgValves.slice(0, valveCount)
    : Array.from({ length: valveCount }, (_, i) => ({ id: i + 1, name: `V${i + 1}`, ch: 16 + i }));

  const ec = state?.ecCurrent ?? null;
  const ph = state?.phCurrent ?? null;
  const isEmergency = mode === 'emergency', isPaused = mode === 'paused', isManual = mode === 'manual';
  const dataReady = state !== null && config !== null;

  const handleMode = (newMode) => {
    if (newMode === mode) return;
    // confirm 다이얼로그는 Panel.handleModeChange 에서 단일 처리 (중복 방지)
    onModeChange?.(newMode);
  };

  // 수동 모드 벗어나면 선택·입력 reset
  useEffect(() => {
    if (mode !== 'manual') {
      setSelectedValves(new Set());
      setManualVolumeML('');
      setManualSubMode('queue');
      setManualScheduleCustom('');
    }
  }, [mode]);

  // 활성 시나리오 자동 선택 (수동 진입 시 default)
  useEffect(() => {
    if (mode === 'manual' && !manualScenarioId && scenarios.length > 0) {
      const active = scenarios.find(s => s.active) || scenarios[0];
      setManualScenarioId(active?.id || null);
    }
  }, [mode, scenarios, manualScenarioId]);

  const toggleValve = (id) => {
    setSelectedValves(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const refreshManualJobs = async () => {
    try {
      const list = await nutrientApi.listManualJobs(farmId, {
        status: ['queued', 'pending', 'running'], limit: 50,
      });
      setManualJobs(list || []);
    } catch (e) { /* 다음 polling 회복 */ }
  };

  // 5초 polling — 수동 작업 큐 동기화 (queued + pending + running)
  useEffect(() => {
    let c = false;
    const tick = async () => {
      try {
        const list = await nutrientApi.listManualJobs(farmId, {
          status: ['queued', 'pending', 'running'], limit: 50,
        });
        if (!c) setManualJobs(list || []);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { c = true; clearInterval(id); };
  }, [farmId]);

  const handleManualTrigger = async () => {
    if (selectedValves.size === 0) return;
    const scenario = scenarios.find(s => s.id === manualScenarioId);
    let scheduleAt = null;
    if (manualSubMode === 'schedule') {
      if (!manualScheduleCustom) {
        alert('시간을 지정하세요.');
        return;
      }
      scheduleAt = new Date(manualScheduleCustom).toISOString();
      const diff = new Date(scheduleAt) - Date.now();
      if (diff > 24 * 60 * 60 * 1000) {
        alert('예약은 24시간 이내만 가능합니다.');
        return;
      }
      if (diff < -60 * 1000) {
        alert('예약 시간은 미래여야 합니다.');
        return;
      }
    }
    const payload = {
      scenarioId: manualScenarioId,
      scenarioName: scenario?.name || null,
      programNum: Math.max(0, scenarios.findIndex(s => s.id === manualScenarioId)) + 1 || null,
      valves: [...selectedValves].sort((a, b) => a - b),
      volumeML: manualVolumeML ? parseInt(manualVolumeML, 10) : null,
      scheduleAt,
      subMode: manualSubMode,  // 'queue' → status='queued' (▶ 시작 대기) / 'schedule' → 'pending'
    };
    try {
      await nutrientApi.triggerManualJob(farmId, payload);
      setSelectedValves(new Set());
      setManualVolumeML('');
      if (manualSubMode === 'schedule') setManualScheduleCustom('');
      refreshManualJobs();
    } catch (e) {
      alert(`작업 등록 실패: ${e.response?.data?.error || e.message}`);
    }
  };

  const cancelManualJob = async (id) => {
    try {
      await nutrientApi.cancelManualJob(farmId, id);
      refreshManualJobs();
    } catch (e) {
      alert(`취소 실패: ${e.response?.data?.error || e.message}`);
    }
  };

  const abortRunningJob = async () => {
    if (!window.confirm('진행 중인 수동 공급을 중단할까요?\n모든 양액 릴레이가 OFF 됩니다.')) return;
    try {
      await nutrientApi.abortManualJob(farmId);
      refreshManualJobs();
    } catch (e) {
      alert(`중단 실패: ${e.response?.data?.error || e.message}`);
    }
  };

  // 큐에서 running 작업 (1개만 동시 진행 가정)
  const runningJob = manualJobs.find(j => j.status === 'running');
  // queued = ▶ 시작 대기 (큐 순차 모드로 만든 작업)
  const queuedJobs = manualJobs.filter(j => j.status === 'queued');
  // 시간 예약은 별도 (scheduleAt 있는 pending)
  const scheduledJobs = manualJobs.filter(j => j.status === 'pending' && j.scheduleAt);
  // 모달용 — queued + scheduled 둘 다 표시
  const pendingJobs = [...queuedJobs, ...scheduledJobs];

  const handleStartQueue = async () => {
    if (queuedJobs.length === 0) return;
    try {
      await nutrientApi.startManualQueue(farmId);
      refreshManualJobs();
    } catch (e) {
      alert(`시작 실패: ${e.response?.data?.error || e.message}`);
    }
  };

  const handlePauseQueue = async () => {
    try {
      await nutrientApi.pauseManualQueue(farmId);
      refreshManualJobs();
    } catch (e) {
      alert(`일시정지 실패: ${e.response?.data?.error || e.message}`);
    }
  };

  const dosingActive = phaseInfo?.phaseKey === 'dosing'    && !isPaused && !isEmergency;
  const mixingActive = phaseInfo?.phaseKey === 'mixing'    && !isPaused && !isEmergency;
  const stabilizing  = phaseInfo?.phaseKey === 'stabilize' && !isPaused && !isEmergency;
  const irrigating   = phaseInfo?.phaseKey === 'irrigating' && !isPaused && !isEmergency;
  const activeValveIdx = irrigating ? phaseInfo.valveIdx : null;
  const lowTanks = tanks.filter(t => t.level !== null && t.level < 20);

  return (
    <div style={{
      fontFamily: SANS, color: T.fg,
      position: 'relative',
      fontFeatureSettings: '"tnum", "cv11"',
    }}>
      <header style={{
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 16, paddingBottom: 14, borderBottom: `1px solid ${T.hair}`, marginBottom: 16,
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 360, flex: '1 1 360px' }}>
          <div style={{
            fontSize: 24, fontWeight: 600, color: T.fg, letterSpacing: '-0.01em',
          }}>실시간 운영</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
          <ModeSegment mode={mode} onChange={handleMode}
            programNum={activeProgramNum} programName={activeProgramName} />
        </div>
      </header>

      {!dataReady ? <LoadingPlaceholder /> : (
        <>
          {/* Manual UI — desktop + mobile 공통 노출 */}
          {mode === 'manual' && !runningJob && (
            <ManualPalette
              scenarios={scenarios}
              valves={valves}
              selectedValves={selectedValves}
              scenarioId={manualScenarioId}
              onScenarioChange={setManualScenarioId}
              volumeML={manualVolumeML}
              onVolumeChange={setManualVolumeML}
              subMode={manualSubMode}
              onSubModeChange={setManualSubMode}
              scheduleCustom={manualScheduleCustom}
              onScheduleCustomChange={setManualScheduleCustom}
              onTrigger={handleManualTrigger}
              alerts={alerts}
              tanks={tanks}
              queueCount={pendingJobs.length}
              queuedCount={queuedJobs.length}
              onOpenQueue={() => setQueueOpen(true)}
              onStartQueue={handleStartQueue}
              onPauseQueue={handlePauseQueue}
            />
          )}
          {runningJob && (
            <ManualRunningCard job={runningJob} phaseInfo={phaseInfo} onAbort={abortRunningJob} />
          )}
          {queueOpen && (
            <ManualQueueModal
              jobs={pendingJobs}
              onCancel={cancelManualJob}
              onClose={() => setQueueOpen(false)}
            />
          )}

          <div className="hidden md:grid" style={{ gridTemplateColumns: '225px 1fr 205px', gap: 14, marginTop: 0 }}>
            <LiveStatsPanel ec={ec} ph={ph} ecTarget={ecTarget} phTarget={phTarget}
              phaseInfo={phaseInfo} mode={mode}
              drain={state?.drain} env={state?.env} />
            <Schematic tanks={tanks} valves={valves} ec={ec} ph={ph} mode={mode}
              dosingActive={dosingActive} mixingActive={mixingActive}
              stabilizing={stabilizing} irrigating={irrigating}
              activeValveIdx={activeValveIdx}
              rawWaterLevel={state?.rawWater?.level}
              selectedValves={selectedValves}
              onValveClick={toggleValve} />
            <TodayPanel
              todayCycles={state?.todayCycles}
              todaySuppliedL={state?.todaySuppliedL}
              todayDrainedL={state?.todayDrainedL}
              drainFlow={state?.drain?.flowLpm}
              lastCycleEndedAt={state?.lastCycleEndedAt}
              nextTrigger={state?.nextTrigger}
              irrigating={irrigating}
              suppliedL={phaseInfo?.suppliedL}
              now={now} />
          </div>
          <div className="md:hidden">
            {/* 모바일 다이어그램 — zoom controls + 스크롤 가능 */}
            <div style={{ marginTop: 12, position: 'relative' }}>
              {/* 우상단 zoom controls (overlay) */}
              <div style={{
                position: 'absolute', top: 8, right: 8, zIndex: 10,
                display: 'flex', gap: 4, alignItems: 'center',
                background: 'rgba(10,20,38,0.85)', borderRadius: 8,
                padding: '4px 6px', border: '1px solid #1a2540',
              }}>
                <button onClick={() => setDiagramZoom(z => Math.max(1, +(z - 0.5).toFixed(1)))}
                  disabled={diagramZoom <= 1}
                  style={{
                    width: 28, height: 28, borderRadius: 6, border: 'none',
                    background: diagramZoom > 1 ? '#06b6d4' : '#334155',
                    color: '#fff', fontSize: 16, fontWeight: 800,
                    cursor: diagramZoom > 1 ? 'pointer' : 'not-allowed',
                  }}>−</button>
                <span style={{
                  minWidth: 36, textAlign: 'center', color: '#fff',
                  fontSize: 12, fontWeight: 700, fontFamily: MONO,
                }}>{diagramZoom.toFixed(1)}x</span>
                <button onClick={() => setDiagramZoom(z => Math.min(3, +(z + 0.5).toFixed(1)))}
                  disabled={diagramZoom >= 3}
                  style={{
                    width: 28, height: 28, borderRadius: 6, border: 'none',
                    background: diagramZoom < 3 ? '#06b6d4' : '#334155',
                    color: '#fff', fontSize: 16, fontWeight: 800,
                    cursor: diagramZoom < 3 ? 'pointer' : 'not-allowed',
                  }}>+</button>
              </div>
              {/* 스크롤 컨테이너 */}
              <div style={{
                overflow: 'auto', WebkitOverflowScrolling: 'touch',
                borderRadius: 14, maxHeight: '70vh',
              }}>
                <div style={{ width: 760 * diagramZoom, minWidth: 760 * diagramZoom }}>
                  <Schematic tanks={tanks} valves={valves} ec={ec} ph={ph} mode={mode}
                    dosingActive={dosingActive} mixingActive={mixingActive}
                    stabilizing={stabilizing} irrigating={irrigating}
                    activeValveIdx={activeValveIdx}
                    rawWaterLevel={state?.rawWater?.level}
                    selectedValves={selectedValves}
                    onValveClick={mode === 'manual' ? toggleValve : undefined} />
                </div>
              </div>
              <div style={{
                fontSize: 10, color: T.fg3, textAlign: 'center', marginTop: 4,
              }}>↕ ↔ 드래그·스와이프로 이동 · +/− 로 확대/축소</div>
            </div>
            <CompactStatus tanks={tanks} valves={valves} phaseInfo={phaseInfo}
              activeValveIdx={activeValveIdx} mode={mode} lowTanks={lowTanks} />
          </div>
        </>
      )}

      <PhaseTimeline phaseInfo={phaseInfo} dimmed={isManual || isPaused} />
      <Alerts alerts={alerts} />
      <Footer />

      {isPaused    && <PausedOverlay />}
      {isEmergency && <EmergencyOverlay />}

      <style>{KEYFRAMES}</style>
    </div>
  );
}

const UpdatedAt = ({ at }) => (
  <div style={{ marginTop: 8, fontSize: 13, color: T.fg3, fontFamily: MONO, letterSpacing: '0.04em',
    display: 'flex', alignItems: 'center', gap: 7 }}>
    <span style={{ width: 7, height: 7, borderRadius: 3.5, background: at ? T.ok : T.fg4,
      animation: at ? 'sd-blink 1.6s infinite' : 'none' }} />
    마지막 업데이트 {at ? new Date(at).toLocaleTimeString('ko-KR', { hour12: false }) : '— : — : —'}
  </div>
);

const StatusPill = ({ mode, phaseInfo }) => {
  // Returns a prominent status pill showing current operational state
  const modeMap = {
    auto: { c: T.ok, bg: '#dcfce7', label: '자동' },
    manual: { c: T.warn, bg: '#fef3c7', label: '수동' },
    paused: { c: T.info, bg: '#dbeafe', label: '일시정지' },
    emergency: { c: T.danger, bg: '#fee2e2', label: '비상정지' },
  };
  const m = modeMap[mode] || modeMap.auto;
  const phaseLabel = !phaseInfo ? '대기'
    : mode === 'emergency' ? '모든 릴레이 OFF'
    : mode === 'paused' ? '사이클 중단'
    : `${phaseInfo.short} 중`;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '6px 14px', borderRadius: 999,
      background: m.bg, color: m.c,
      fontSize: 14, fontWeight: 700, letterSpacing: '0.01em',
      border: `1px solid ${m.c}33`,
      boxShadow: `0 0 0 4px ${m.c}10, 0 0 18px ${m.c}33`,
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: 4, background: m.c,
        animation: mode === 'emergency' ? 'sd-blink 0.7s infinite'
          : mode === 'auto' ? 'sd-blink 1.6s infinite'
          : 'none',
      }} />
      {m.label} · {phaseLabel}
      {phaseInfo && mode !== 'emergency' && mode !== 'paused' && (
        <span style={{ fontFamily: MONO, fontWeight: 600, color: m.c, opacity: 0.75 }}>
          −{fmtMS(phaseInfo.remaining)}
        </span>
      )}
    </span>
  );
};

const AlertPill = ({ count, topSeverity }) => {
  const isCrit = topSeverity === 'critical';
  const c = isCrit ? T.danger : T.warn;
  const bg = isCrit ? '#fee2e2' : '#fef3c7';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      padding: '6px 13px', borderRadius: 999,
      background: bg, color: c,
      fontSize: 14, fontWeight: 700,
      border: `1px solid ${c}33`,
      boxShadow: `0 0 0 4px ${c}10, 0 0 18px ${c}44`,
      animation: isCrit ? 'sd-flash 1.4s infinite' : 'none',
    }}>
      <span style={{ fontSize: 11, lineHeight: 1 }}>▲</span>
      경보 {count}건
    </span>
  );
};

const PhaseInline = ({ phaseInfo, mode }) => {
  if (mode === 'emergency') return <span style={{ fontSize: 14, fontWeight: 700, color: T.danger, letterSpacing: '0.04em' }}>비상정지 · 모든 릴레이 OFF</span>;
  if (mode === 'paused')    return <span style={{ fontSize: 14, fontWeight: 700, color: T.info, letterSpacing: '0.04em' }}>일시정지</span>;
  if (!phaseInfo)           return <span style={{ fontSize: 14, fontWeight: 600, color: T.fg3, letterSpacing: '0.04em' }}>사이클 대기</span>;
  return (
    <span style={{ fontSize: 14, fontWeight: 600, color: T.fg2, letterSpacing: '0.04em',
      display: 'inline-flex', alignItems: 'center', gap: 9, fontFamily: MONO }}>
      <span style={{ color: T.acc }}>{String(PHASE_PLAN.findIndex(p => p.key === phaseInfo.phaseKey) + 1).padStart(2, '0')}</span>
      <span>{phaseInfo.short}</span>
      <span style={{ color: T.fg3 }}>·</span>
      <span>{fmtMS(phaseInfo.elapsed)} / −{fmtMS(phaseInfo.remaining)}</span>
    </span>
  );
};

const ModeSegment = ({ mode, onChange, programNum, programName }) => (
  <div role="group" aria-label="운영 모드" style={{
    display: 'inline-flex', background: T.card, borderRadius: 10,
    border: `1px solid ${T.bd}`, overflow: 'hidden',
    boxShadow: '0 1px 0 rgba(11,18,32,0.02)',
  }}>
    {Object.entries(MODES).map(([key, m], i) => {
      const active = mode === key;
      const isEmer = key === 'emergency';
      const isAuto = key === 'auto';
      const Icon = MODE_ICON[key];
      const activeBg = isEmer ? '#fef2f2' : key === 'auto' ? '#f0fdf4' : key === 'manual' ? '#fffbeb' : '#eff6ff';
      return (
        <button key={key} onClick={() => onChange(key)}
          title={isAuto && programName ? `P-${String(programNum).padStart(2, '0')} · ${programName}` : m.long}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 11px',
            background: active ? activeBg : 'transparent', color: active ? m.c : T.fg2,
            border: 'none', cursor: 'pointer',
            borderLeft: i > 0 ? `1px solid ${T.bd}` : 'none',
            fontFamily: SANS, fontSize: 13, fontWeight: 600,
            transition: 'background 0.12s, color 0.12s, box-shadow 0.12s', position: 'relative',
            boxShadow: active ? `inset 0 0 0 1px ${m.c}30, 0 0 14px ${m.c}33` : 'none',
          }}>
          {isAuto && programNum != null && (
            <span style={{
              fontFamily: MONO, fontSize: 10.5, fontWeight: 700,
              padding: '2px 6px', borderRadius: 4, letterSpacing: '0.04em',
              background: active ? m.c + '1f' : T.hair,
              color: active ? m.c : T.fg2,
            }}>P-{String(programNum).padStart(2, '0')}</span>
          )}
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 14, height: 14, color: active ? m.c : T.fg3,
            animation: active && isEmer ? 'sd-pulse 0.9s infinite' : 'none',
          }}><Icon s={12} /></span>
          <span>{m.label}</span>
          {active && <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: m.c }} />}
        </button>
      );
    })}
  </div>
);

const KpiRow = ({ ec, ph, ecTarget, phTarget, phaseInfo, activeValveIdx,
                  valveCount, tankCount, lowTankCount, alertCount }) => {
  const ecDiff = ec !== null && ecTarget !== null ? ec - ecTarget : null;
  const phDiff = ph !== null && phTarget !== null ? ph - phTarget : null;
  return (
    <section style={{
      background: T.card, border: `1px solid ${T.bd}`, borderRadius: 10,
      display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', overflow: 'hidden',
    }}>
      <KpiTile label="EC" unit="mS/cm" value={ec === null ? '—' : ec.toFixed(2)}
        target={ecTarget !== null ? `목표 ${ecTarget.toFixed(1)}` : null}
        diff={ecDiff} diffFmt={d => (d >= 0 ? '+' : '') + d.toFixed(2)} />
      <KpiTile label="pH" unit="" value={ph === null ? '—' : ph.toFixed(2)}
        target={phTarget !== null ? `목표 ${phTarget.toFixed(1)}` : null}
        diff={phDiff} diffFmt={d => (d >= 0 ? '+' : '') + d.toFixed(2)} />
      <KpiTile label="PHASE" unit="" value={phaseInfo ? phaseInfo.short : 'IDLE'}
        target={phaseInfo ? `${fmtMS(phaseInfo.elapsed)} 경과` : '사이클 없음'} small
        valueColor={phaseInfo ? T.acc : T.fg3} />
      <KpiTile label="VALVE" unit="" value={activeValveIdx ? `V${activeValveIdx}` : '— —'}
        target={activeValveIdx ? '관수 중' : `전체 ${valveCount}개`}
        valueColor={activeValveIdx ? T.ok : T.fg3} live={!!activeValveIdx} />
      <KpiTile label="TANKS" unit="" value={tankCount > 0 ? `${tankCount - lowTankCount}/${tankCount}` : '—'}
        target={lowTankCount > 0 ? `${lowTankCount}개 부족` : '정상 보유'}
        valueColor={lowTankCount > 0 ? T.danger : T.fg} />
      <KpiTile label="ALERTS" unit="" value={String(alertCount).padStart(2, '0')}
        target={alertCount > 0 ? '확인 필요' : '활성 경보 없음'}
        valueColor={alertCount > 0 ? T.warn : T.fg3} />
    </section>
  );
};

const KpiTile = ({ label, unit, value, target, diff, diffFmt, valueColor, small, live }) => {
  let diffColor = T.fg3;
  if (diff !== null && diff !== undefined) {
    diffColor = Math.abs(diff) < 0.1 ? T.ok : Math.abs(diff) < 0.5 ? T.warn : T.danger;
  }
  return (
    <div style={{ padding: '16px 18px', borderRight: `1px solid ${T.hair}`,
      display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ ...kicker, fontSize: 11 }}>{label}</div>
      <div style={{
        fontFamily: MONO, fontSize: small ? 22 : 28, fontWeight: 600,
        color: valueColor || T.fg, lineHeight: 1.05, letterSpacing: '-0.01em',
        display: 'flex', alignItems: 'baseline', gap: 6,
      }}>
        {live && <span style={{ width: 7, height: 7, borderRadius: 3.5, background: T.ok, marginRight: 2,
          animation: 'sd-blink 1.2s infinite', alignSelf: 'center' }} />}
        {value}
        {unit && <span style={{ fontSize: 13, color: T.fg3, fontWeight: 500 }}>{unit}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 3 }}>
        {diff !== null && diff !== undefined && (
          <span style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: 600, color: diffColor,
            background: diffColor + '14', borderRadius: 4, padding: '2px 7px' }}>
            {diffFmt(diff)}
          </span>
        )}
        {target && <span style={{ fontSize: 12, color: T.fg3 }}>{target}</span>}
      </div>
    </div>
  );
};

const TodayStrip = ({ todayCycles, todaySuppliedL, lastCycleEndedAt, nextTrigger, irrigating, suppliedL, now }) => {
  const sinceLast = lastCycleEndedAt
    ? Math.max(0, Math.floor((now - new Date(lastCycleEndedAt).getTime()) / 60000))
    : null;
  const lastTime = lastCycleEndedAt
    ? new Date(lastCycleEndedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—';
  const sinceLabel = sinceLast === null ? '데이터 없음'
    : sinceLast < 60 ? `${sinceLast}분 전`
    : `${Math.floor(sinceLast / 60)}시간 ${sinceLast % 60}분 전`;

  const items = [
    { label: '오늘 사이클', value: todayCycles != null ? String(todayCycles) : '—', unit: '회', sub: todayCycles ? '완료' : '대기' },
    { label: '오늘 누적 공급량', value: todaySuppliedL != null ? String(todaySuppliedL) : '—', unit: 'L',
      sub: irrigating && suppliedL ? `현재 사이클 +${suppliedL}L` : '오늘 누적' },
    { label: '마지막 관수', value: lastTime, unit: '', sub: sinceLabel, mono: true },
    { label: '다음 트리거', value: nextTrigger?.label || '—', unit: '', sub: nextTrigger?.type === 'running' ? '진행 중' : '조건 대기', wide: true },
  ];
  return (
    <section style={{
      marginTop: 10, background: T.card, border: `1px solid ${T.bd}`, borderRadius: 10,
      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1.5fr', overflow: 'hidden',
    }}>
      {items.map((it, i) => (
        <div key={i} style={{
          padding: '12px 16px', borderRight: i < items.length - 1 ? `1px solid ${T.hair}` : 'none',
          display: 'flex', flexDirection: 'column', gap: 4,
        }}>
          <div style={{ ...kicker, fontSize: 10.5 }}>{it.label}</div>
          <div style={{
            fontFamily: it.mono || /^\d/.test(it.value) ? MONO : SANS,
            fontSize: 18, fontWeight: 600, color: T.fg, lineHeight: 1.1, letterSpacing: '-0.005em',
            display: 'flex', alignItems: 'baseline', gap: 5,
          }}>
            {it.value}
            {it.unit && <span style={{ fontSize: 12, color: T.fg3, fontWeight: 500 }}>{it.unit}</span>}
          </div>
          <div style={{ fontSize: 11.5, color: T.fg3, fontFamily: it.mono ? MONO : SANS }}>{it.sub}</div>
        </div>
      ))}
    </section>
  );
};

// ─────────────────────────────────────────────────────────
// HEADER · 안전 인디케이터 (compact)
// ─────────────────────────────────────────────────────────
const SafetyDots = ({ mode, alertCount }) => {
  const items = [
    { label: '비상', active: mode === 'emergency' },
    { label: '누액', active: mode === 'emergency' },
    { label: '도어', active: false },
  ];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: SANS }}>
      {items.map((it, i) => (
        <span key={i} style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '4px 10px', borderRadius: 999,
          background: it.active ? '#fef2f2' : T.card,
          border: `1px solid ${it.active ? T.danger + '55' : T.bd}`,
          fontSize: 12, fontWeight: 600,
          color: it.active ? T.danger : T.fg2,
          animation: it.active ? 'sd-flash 1s infinite' : 'none',
        }}>
          <span style={{
            width: 7, height: 7, borderRadius: 3.5,
            background: it.active ? T.danger : T.ok,
            animation: it.active ? 'sd-blink 0.7s infinite' : 'none',
          }} />
          {it.label}
        </span>
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────────────────
// LEFT · 측정값 — 공급액 / 퇴수 / 환경 (3 sections)
// ─────────────────────────────────────────────────────────
const LiveStatsPanel = ({ ec, ph, ecTarget, phTarget, phaseInfo, mode, drain, env }) => {
  const ecDiff = ec !== null && ecTarget !== null ? ec - ecTarget : null;
  const phDiff = ph !== null && phTarget !== null ? ph - phTarget : null;
  // 퇴수는 공급액 대비 변화량을 색 인디케이터로
  const drainEcDelta = drain && ec !== null ? drain.ecCurrent - ec : null;
  const drainPhDelta = drain && ph !== null ? drain.phCurrent - ph : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <StatSection title="공급액" kicker="" accent={T.acc}>
        <StatRow label="EC" value={ec === null ? '—' : ec.toFixed(2)} unit="mS/cm"
          diff={ecDiff} diffFmt={d => (d >= 0 ? '+' : '') + d.toFixed(2)}
          target={ecTarget !== null ? `목표 ${ecTarget.toFixed(1)}` : null} big />
        <StatRow label="pH" value={ph === null ? '—' : ph.toFixed(2)} unit=""
          diff={phDiff} diffFmt={d => (d >= 0 ? '+' : '') + d.toFixed(2)}
          target={phTarget !== null ? `목표 ${phTarget.toFixed(1)}` : null} big />
      </StatSection>

      <StatSection title="퇴수" kicker="" accent="#d97706">
        <StatRow label="EC" value={drain ? drain.ecCurrent.toFixed(2) : '—'} unit="mS/cm"
          diff={drainEcDelta} diffFmt={d => (d >= 0 ? '+' : '') + d.toFixed(2)} compareLabel="공급 대비" />
        <StatRow label="pH" value={drain ? drain.phCurrent.toFixed(2) : '—'} unit=""
          diff={drainPhDelta} diffFmt={d => (d >= 0 ? '+' : '') + d.toFixed(2)} compareLabel="공급 대비" />
      </StatSection>

      <StatSection title="환경" kicker="" accent="#0d9488">
        <EnvRow label="내부" lhs={env ? `${env.inTemp.toFixed(1)}°C` : '—'}
          rhs={env ? `${env.inHumid.toFixed(0)}%` : ''} />
        <EnvRow label="외부" lhs={env ? `${env.outTemp.toFixed(1)}°C` : '—'}
          rhs={env ? `${env.outHumid.toFixed(0)}%` : ''} />
        <EnvRow label="강우" lhs={env ? `${env.rainfall.toFixed(1)} mm` : '—'}
          warn={env && env.rainfall > 0} />
        <EnvRow label="풍속" lhs={env ? `${env.windSpeed.toFixed(1)} m/s` : '—'}
          warn={env && env.windSpeed > 5} />
        <EnvRow label="일사" lhs={env ? `${env.solar} W/m²` : '—'} />
      </StatSection>
    </div>
  );
};

const StatSection = ({ title, kicker: kickerLabel, accent, children }) => (
  <div style={{
    background: T.card, border: `1px solid ${T.bd}`, borderRadius: 10,
    position: 'relative', overflow: 'hidden',
  }}>
    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: accent }} />
    <div style={{
      padding: '10px 14px 8px 14px',
      borderBottom: `1px solid ${T.hair}`,
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
    }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: T.fg }}>{title}</span>
      <span style={{ ...kicker, fontSize: 10 }}>{kickerLabel}</span>
    </div>
    <div style={{ padding: '6px 0' }}>{children}</div>
  </div>
);

const StatRow = ({ label, value, unit, diff, diffFmt, target, compareLabel, big }) => {
  let diffColor = T.fg3;
  if (diff !== null && diff !== undefined) {
    diffColor = Math.abs(diff) < 0.1 ? T.ok : Math.abs(diff) < 0.5 ? T.warn : T.danger;
  }
  return (
    <div style={{ padding: '4px 14px 6px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: T.fg3, letterSpacing: '0.08em', minWidth: 22 }}>{label}</span>
        <span style={{
          fontFamily: MONO, fontSize: big ? 22 : 18, fontWeight: 600, color: T.fg,
          letterSpacing: '-0.01em', lineHeight: 1,
        }}>{value}</span>
        {unit && <span style={{ fontSize: 11, color: T.fg3 }}>{unit}</span>}
        <span style={{ flex: 1 }} />
        {diff !== null && diff !== undefined && (
          <span style={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 600, color: diffColor,
            background: diffColor + '14', borderRadius: 4, padding: '1.5px 6px' }}>
            {diffFmt(diff)}
          </span>
        )}
      </div>
      {(target || compareLabel) && (
        <div style={{ marginTop: 2, marginLeft: 30, fontSize: 11, color: T.fg3 }}>
          {target || compareLabel}
        </div>
      )}
    </div>
  );
};

const EnvRow = ({ label, lhs, rhs, warn }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '7px 14px', fontSize: 16,
    background: warn ? '#fef2f244' : 'transparent',
  }}>
    <span style={{ fontSize: 12.5, fontWeight: 700, color: T.fg3, letterSpacing: '0.06em', minWidth: 32 }}>{label}</span>
    <span style={{ fontFamily: MONO, fontSize: 16, fontWeight: 600, color: warn ? T.danger : T.fg, letterSpacing: '-0.01em' }}>{lhs}</span>
    {rhs && (
      <>
        <span style={{ color: T.fg4 }}>·</span>
        <span style={{ fontFamily: MONO, fontSize: 16, fontWeight: 600, color: T.fg2 }}>{rhs}</span>
      </>
    )}
  </div>
);

// ─────────────────────────────────────────────────────────
// RIGHT · TODAY  (사이클 / 누적공급량 / 퇴수유량 / 마지막 / 다음 트리거)
// ─────────────────────────────────────────────────────────
const TodayPanel = ({ todayCycles, todaySuppliedL, todayDrainedL, drainFlow, lastCycleEndedAt, nextTrigger, irrigating, suppliedL, now }) => {
  const sinceLast = lastCycleEndedAt
    ? Math.max(0, Math.floor((now - new Date(lastCycleEndedAt).getTime()) / 60000))
    : null;
  const lastTime = lastCycleEndedAt
    ? new Date(lastCycleEndedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—';
  const sinceLabel = sinceLast === null ? ''
    : sinceLast < 60 ? `${sinceLast}분 전`
    : `${Math.floor(sinceLast / 60)}시간 ${sinceLast % 60}분 전`;

  // 배액률 (drain ratio) — 농장주가 보고 싶어하는 지표
  const drainRatio = todaySuppliedL && todayDrainedL != null
    ? (todayDrainedL / todaySuppliedL) * 100 : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <BigStatCard
        label="오늘 사이클"
        value={todayCycles != null ? String(todayCycles) : '—'} unit="회"
        target={todayCycles ? '완료' : '대기 중'}
        accent={T.ok} />
      <BigStatCard
        label="오늘 누적 공급량"
        value={todaySuppliedL != null ? String(todaySuppliedL) : '—'} unit="L"
        target={irrigating && suppliedL ? `현재 사이클 +${suppliedL}L` : null}
        accent="#2563eb"
        live={irrigating} />
      <BigStatCard
        label="퇴수 유량"
        value={drainFlow != null ? drainFlow.toFixed(1) : '—'} unit="L/min"
        target={drainRatio != null
          ? `오늘 ${todayDrainedL}L · 배액률 ${drainRatio.toFixed(0)}%`
          : todayDrainedL != null ? `오늘 ${todayDrainedL}L` : null}
        accent="#d97706"
        live={irrigating && drainFlow > 0} />
      <BigStatCard
        label="마지막 관수"
        value={lastTime} unit=""
        target={sinceLabel}
        accent={T.fg2} mono />
      <BigStatCard
        label="다음 트리거"
        value={nextTrigger?.label || '—'} unit=""
        target={nextTrigger?.type === 'running' ? '진행 중' : '조건 대기'}
        accent="#7c3aed" small />
    </div>
  );
};

// 공용 카드 — 라벨 / 값 / 타깃 / diff / accent 좌측 바
const BigStatCard = ({ label, value, unit, target, diff, diffFmt, valueColor, accent, live, progress, sub, mono, small }) => {
  let diffColor = T.fg3;
  if (diff !== null && diff !== undefined) {
    diffColor = Math.abs(diff) < 0.1 ? T.ok : Math.abs(diff) < 0.5 ? T.warn : T.danger;
  }
  const valueFontSize = small ? 17 : 26;
  return (
    <div style={{
      background: T.card, border: `1px solid ${T.bd}`, borderRadius: 10,
      padding: '12px 14px', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: accent }} />
      <div style={{ marginLeft: 4, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
        <div style={{ ...kicker, fontSize: 11 }}>{label}</div>
        {live && <span style={{ width: 7, height: 7, borderRadius: 3.5, background: T.ok,
          animation: 'sd-blink 1.2s infinite' }} />}
      </div>
      <div style={{
        marginTop: 5, marginLeft: 4, fontFamily: mono || /^-?\d/.test(value) ? MONO : SANS,
        fontSize: valueFontSize, fontWeight: 600, color: valueColor || T.fg, lineHeight: 1.05,
        letterSpacing: '-0.015em', display: 'flex', alignItems: 'baseline', gap: 5,
      }}>
        {value}
        {unit && <span style={{ fontSize: 12, color: T.fg3, fontWeight: 500 }}>{unit}</span>}
      </div>
      {(diff !== null && diff !== undefined) || target ? (
        <div style={{ marginTop: 6, marginLeft: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {diff !== null && diff !== undefined && (
            <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 600, color: diffColor,
              background: diffColor + '14', borderRadius: 4, padding: '2px 6px' }}>
              {diffFmt(diff)}
            </span>
          )}
          {target && <span style={{ fontSize: 12, color: T.fg3 }}>{target}</span>}
        </div>
      ) : null}
      {progress !== undefined && progress !== null && (
        <div style={{ marginTop: 8, marginLeft: 4, marginRight: 4,
          height: 3, background: T.hair, borderRadius: 1.5, overflow: 'hidden' }}>
          <div style={{ width: `${progress * 100}%`, height: '100%',
            background: T.acc, transition: 'width 0.4s' }} />
        </div>
      )}
      {sub && (
        <div style={{ marginTop: 6, marginLeft: 4, fontSize: 11.5, color: T.fg3, fontFamily: MONO }}>
          {sub}
        </div>
      )}
    </div>
  );
};

const ZoneBadge = ({ x, y, num, label, active, accent = '#67e8f9' }) => {
  const numColor = active ? accent : '#cbd5e1';
  const labelColor = active ? '#ffffff' : '#e2e8f0';
  const accentRgb = accent === '#60a5fa' ? '96,165,250'
    : accent === '#4ade80' ? '74,222,128'
    : accent === '#fb923c' ? '251,146,60'
    : '103,232,249';
  // approximate label width to make the punch-through strip wide enough
  const stripW = 30 + Math.max(label.length * 12, 60);
  return (
    <g>
      {/* opaque backdrop strip — cuts a clean gap through the zone border */}
      <rect x={x - 9} y={y - 14} width={stripW} height={18} fill="#0f1d36" />
      <rect x={x - 4} y={y - 14} width={26} height={18} rx="3"
            fill={active ? `rgba(${accentRgb},0.20)` : 'rgba(255,255,255,0.05)'}
            stroke={numColor} strokeWidth="1" />
      <text x={x + 9} y={y - 1} textAnchor="middle"
            fontSize="11" fontWeight="700" fill={numColor}
            fontFamily={MONO} letterSpacing="0.04em">{num}</text>
      <text x={x + 30} y={y - 1} fontSize="13" fontWeight="700"
            fill={labelColor} letterSpacing="2" fontFamily={SANS}>{label}</text>
      {active && (
        <circle cx={x + 9} cy={y - 18} r="2" fill={numColor}>
          <animate attributeName="opacity" values="1;0.2;1" dur="1.4s" repeatCount="indefinite" />
        </circle>
      )}
    </g>
  );
};

// ─────────────────────────────────────────
// 수동 모드 팔레트 — 1회 공급 작업 만들기 (F1 prototype)
// ─────────────────────────────────────────
const ManualPalette = ({
  scenarios, valves, selectedValves,
  scenarioId, onScenarioChange,
  volumeML, onVolumeChange,
  subMode, onSubModeChange,
  scheduleCustom, onScheduleCustomChange,
  onTrigger, alerts, tanks,
  queueCount, queuedCount, onOpenQueue,
  onStartQueue, onPauseQueue,
}) => {
  const scenario = scenarios.find(s => s.id === scenarioId);
  const count = selectedValves?.size ?? 0;
  const critical = (alerts || []).find(a => a.severity === 'critical');
  const lowTanks = (tanks || []).filter(t => t.level !== null && t.level < 20);
  const isQueue = subMode === 'queue';
  const hasSchedule = !isQueue && !!scheduleCustom;
  const canTrigger = count > 0 && !critical && (isQueue || hasSchedule);
  const valveLabel = count === 0 ? '밸브 클릭으로 선택'
    : 'V' + [...selectedValves].sort((a, b) => a - b).slice(0, 6).join(', V')
      + (count > 6 ? ` 외 ${count - 6}` : '');

  return (
    <div style={{
      marginBottom: 10, padding: '12px 14px', borderRadius: 12,
      background: '#fffbeb', border: '1.5px solid #fbbf24',
      boxShadow: '0 2px 8px rgba(217,119,6,0.08)',
    }}>
      {/* 헤더 row 1 — 제목 + segmented + 큐 pill (모바일에서 wrap) */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
        flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#92400e', letterSpacing: '0.04em' }}>
          ✋ 수동 공급
        </span>
        {/* segmented sub-mode 토글 */}
        <div style={{
          display: 'inline-flex', borderRadius: 8, overflow: 'hidden',
          border: '1px solid #fbbf24', background: '#fff',
        }}>
          {[
            { key: 'queue',    label: '🔢 큐 순차',    hint: '추가 즉시 또는 이전 작업 완료 후 자동 실행' },
            { key: 'schedule', label: '📅 시간 지정', hint: '지정한 시각에 실행 (24시간 이내)' },
          ].map((m, i) => {
            const active = subMode === m.key;
            return (
              <button key={m.key} onClick={() => onSubModeChange(m.key)}
                title={m.hint}
                style={{
                  padding: '5px 10px', border: 'none', cursor: 'pointer',
                  borderLeft: i > 0 ? '1px solid #fbbf24' : 'none',
                  background: active ? '#f59e0b' : 'transparent',
                  color: active ? '#fff' : '#92400e',
                  fontSize: 12, fontWeight: 800,
                  fontFamily: SANS, whiteSpace: 'nowrap',
                  transition: 'background 0.12s, color 0.12s',
                }}>{m.label}</button>
            );
          })}
        </div>
        <div style={{ flex: 1 }} />
        {queueCount > 0 && (
          <button onClick={onOpenQueue} style={{
            padding: '3px 10px', borderRadius: 999, border: '1px solid #fbbf24',
            background: '#fff', color: '#92400e', fontSize: 11, fontWeight: 700,
            cursor: 'pointer', fontFamily: MONO, whiteSpace: 'nowrap',
          }}>📅 예약 큐 ({queueCount})</button>
        )}
      </div>

      {/* 헤더 row 2 — 안내 텍스트 (별도 row, 좁은 화면 친화) */}
      <div style={{ fontSize: 11, color: '#a16207', marginBottom: 10, lineHeight: 1.3 }}>
        {isQueue ? '순차 큐 — 추가 후 ▶ 시작 누르면 차례대로 자동 실행'
                 : '시간 지정 — 지정한 시각에 1회 실행 (24시간 이내)'}
      </div>

      <div style={{
        display: 'grid',
        // auto-fit 으로 좁은 화면 자동 wrap (mobile 1 column → desktop 4~5 column)
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 10, alignItems: 'end',
      }}>
        {/* 프로그램 */}
        <div>
          <div style={mpLabel}>프로그램</div>
          <select value={scenarioId || ''} onChange={(e) => onScenarioChange(e.target.value || null)}
                  style={mpInput}>
            {scenarios.length === 0 && <option value="">시나리오 없음</option>}
            {scenarios.map((s, i) => (
              <option key={s.id} value={s.id}>
                P-{String(i + 1).padStart(2, '0')} {s.name}{s.active ? ' (활성)' : ''}
              </option>
            ))}
          </select>
        </div>

        {/* 공급량 */}
        <div>
          <div style={mpLabel}>공급량 (mL)</div>
          <input type="number" min="0" value={volumeML}
                 placeholder={scenario ? '시나리오 기본' : '—'}
                 onChange={(e) => onVolumeChange(e.target.value)}
                 style={mpInput} />
        </div>

        {/* 시간 지정 — schedule 모드일 때만 (chips 는 grid 아래 별도 행) */}
        {!isQueue && (
          <div>
            <div style={mpLabel}>실행 시각</div>
            <input type="datetime-local" value={scheduleCustom}
                   onChange={(e) => onScheduleCustomChange(e.target.value)}
                   style={mpInput} />
          </div>
        )}

        {/* 선택 카운트 */}
        <div style={{ minWidth: 130, padding: '0 4px' }}>
          <div style={mpLabel}>선택 ({count})</div>
          <div style={{
            fontSize: 12, fontWeight: 600, color: count > 0 ? '#0e7490' : '#94a3b8',
            fontFamily: count > 0 ? MONO : SANS, lineHeight: 1.3,
            maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{valveLabel}</div>
        </div>
      </div>

      {/* 액션 버튼 row — 모드별 1~3 버튼 한 줄 정렬 */}
      <div style={{
        display: 'flex', gap: 8, marginTop: 10, paddingTop: 8,
        borderTop: '1px dashed #fbbf24', alignItems: 'center',
        justifyContent: 'flex-end', flexWrap: 'wrap',
      }}>
        {/* 추가/등록 — 모드 공통 */}
        <button onClick={onTrigger} disabled={!canTrigger}
          title={!canTrigger
            ? (critical ? '비상정지 해제 필요'
              : count === 0 ? '밸브를 선택하세요'
              : !isQueue && !hasSchedule ? '실행 시각을 지정하세요'
              : '') : ''}
          style={{
            padding: '8px 14px', borderRadius: 8, border: 'none',
            background: canTrigger ? '#0891b2' : '#cbd5e1',
            color: '#fff', fontSize: 13, fontWeight: 800,
            cursor: canTrigger ? 'pointer' : 'not-allowed',
            whiteSpace: 'nowrap',
          }}>
          {isQueue ? '▶ 큐에 추가' : '📅 예약 등록'}
        </button>
        {/* 일시정지 + 시작 — 큐 순차 모드에서만 */}
        {isQueue && (
          <>
            <button onClick={onPauseQueue}
              disabled={!queueCount || queuedCount === queueCount}
              title={queuedCount === queueCount ? '이미 모두 정지 상태' : '대기 중인 자동 실행 정지'}
              style={{
                padding: '8px 14px', borderRadius: 8, border: '1px solid #fbbf24',
                background: '#fff', color: '#92400e', fontSize: 13, fontWeight: 800,
                cursor: (!queueCount || queuedCount === queueCount) ? 'not-allowed' : 'pointer',
                opacity: (!queueCount || queuedCount === queueCount) ? 0.45 : 1,
                whiteSpace: 'nowrap',
              }}>⏸ 일시정지</button>
            <button onClick={onStartQueue}
              disabled={queuedCount === 0}
              title={queuedCount === 0 ? '큐가 비어있습니다' : `${queuedCount} 건 순차 실행`}
              style={{
                padding: '8px 18px', borderRadius: 8, border: 'none',
                background: queuedCount > 0 ? '#16a34a' : '#cbd5e1',
                color: '#fff', fontSize: 14, fontWeight: 900,
                cursor: queuedCount > 0 ? 'pointer' : 'not-allowed',
                boxShadow: queuedCount > 0 ? '0 2px 8px rgba(22,163,74,0.30)' : 'none',
                whiteSpace: 'nowrap',
              }}>▶ 시작 ({queuedCount})</button>
          </>
        )}
      </div>

      {/* schedule 모드 — quick preset chip (grid 아래 별도 행) */}
      {!isQueue && (
        <div style={{
          display: 'flex', gap: 6, marginTop: 8, paddingLeft: 4,
          alignItems: 'center', flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: '#92400e', marginRight: 2 }}>
            빠른 설정 →
          </span>
          {[
            { label: '+5분',  min: 5 },
            { label: '+10분', min: 10 },
            { label: '+30분', min: 30 },
            { label: '+1시간', min: 60 },
          ].map(q => (
            <button key={q.min}
              onClick={() => {
                // datetime-local: YYYY-MM-DDTHH:mm (로컬 타임존)
                const d = new Date(Date.now() + q.min * 60000);
                const pad = (n) => String(n).padStart(2, '0');
                onScheduleCustomChange(
                  `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
                );
              }}
              style={{
                padding: '3px 10px', borderRadius: 6,
                border: '1px solid #fbbf24', background: '#fff',
                color: '#92400e', fontSize: 11, fontWeight: 700,
                cursor: 'pointer', fontFamily: SANS,
              }}>{q.label}</button>
          ))}
        </div>
      )}

      {/* 가드 메시지 */}
      {(critical || lowTanks.length > 0) && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#dc2626', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {critical && <span>⚠ {critical.message}</span>}
          {lowTanks.length > 0 && <span>⚠ 잔량 부족: {lowTanks.map(t => t.name).join(', ')}</span>}
        </div>
      )}
    </div>
  );
};

const mpLabel = {
  fontSize: 10.5, fontWeight: 700, color: '#92400e',
  letterSpacing: '0.06em', marginBottom: 3,
  fontFamily: SANS,
};
const mpInput = {
  width: '100%', padding: '6px 8px', fontSize: 13, fontWeight: 600,
  color: '#0b1220', border: '1px solid #fbbf24', borderRadius: 6,
  outline: 'none', background: '#fff',
  fontFamily: SANS,
};

// ─────────────────────────────────────────
// 진행 중인 수동 cycle 카드 — 팔레트 자리에 표시 (running 1개만 가정)
// ─────────────────────────────────────────
const ManualRunningCard = ({ job, phaseInfo, onAbort }) => {
  const valveLabel = 'V' + job.valves.slice(0, 6).join(', V') + (job.valves.length > 6 ? ` 외 ${job.valves.length - 6}` : '');
  const progress = phaseInfo?.progress ? Math.round(phaseInfo.progress * 100) : 0;
  return (
    <div style={{
      marginBottom: 10, padding: '12px 14px', borderRadius: 12,
      background: '#ecfeff', border: '1.5px solid #06b6d4',
      boxShadow: '0 2px 8px rgba(6,182,212,0.12)',
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
    }}>
      <div style={{
        width: 10, height: 10, borderRadius: '50%', background: '#06b6d4',
        animation: 'sd-pulse 0.9s infinite', flexShrink: 0,
      }} />
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#0e7490', letterSpacing: '0.04em' }}>
          🔵 수동 공급 진행 중
        </div>
        <div style={{ fontSize: 12, color: '#0b1220', fontWeight: 600, marginTop: 3, fontFamily: MONO }}>
          P-{String(job.programNum).padStart(2, '0')} · {job.scenarioName} · {valveLabel}
          {job.volumeML ? ` · ${job.volumeML} mL` : ''}
        </div>
        {phaseInfo && (
          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: '#475569', fontWeight: 600 }}>
              {phaseInfo.label} {progress}% · {Math.floor(phaseInfo.remaining / 60)}:{String(phaseInfo.remaining % 60).padStart(2, '0')} 남음
            </span>
            <div style={{ flex: 1, height: 4, background: '#cffafe', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${progress}%`, height: '100%', background: '#06b6d4', transition: 'width 0.3s' }} />
            </div>
          </div>
        )}
      </div>
      <button onClick={onAbort} style={{
        padding: '8px 14px', borderRadius: 8, border: '1.5px solid #dc2626',
        background: '#fff', color: '#dc2626', fontSize: 13, fontWeight: 800,
        cursor: 'pointer', whiteSpace: 'nowrap',
      }}>⏸ 중단</button>
    </div>
  );
};

// ─────────────────────────────────────────
// 예약 큐 모달 — pending 작업 시간 순 + 취소
// ─────────────────────────────────────────
const ManualQueueModal = ({ jobs, onCancel, onClose }) => {
  const sorted = [...jobs].sort((a, b) =>
    new Date(a.scheduleAt).getTime() - new Date(b.scheduleAt).getTime());
  const fmt = (iso) => {
    const d = new Date(iso);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return sameDay ? `오늘 ${hh}:${mm}` : `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`;
  };
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(11,18,32,0.50)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, padding: 0,
        width: 'min(520px, 92vw)', maxHeight: '80vh', overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(11,18,32,0.30)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid #e2e8f0',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: '#0b1220' }}>
            📅 예약된 수동 공급 ({sorted.length})
          </span>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', fontSize: 20,
            color: '#94a3b8', cursor: 'pointer', padding: 0, lineHeight: 1,
          }}>✕</button>
        </div>
        <div style={{ overflow: 'auto', padding: 8 }}>
          {sorted.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              예약된 작업 없음
            </div>
          )}
          {sorted.map(j => (
            <div key={j.id} style={{
              padding: '10px 12px', borderRadius: 8, margin: '4px 0',
              background: '#f8fafc', border: '1px solid #e2e8f0',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <span style={{
                padding: '4px 10px', borderRadius: 999, background: '#0891b2',
                color: '#fff', fontSize: 11, fontWeight: 800, fontFamily: 'ui-monospace, monospace',
                flexShrink: 0,
              }}>{fmt(j.scheduleAt)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0b1220' }}>
                  P-{String(j.programNum).padStart(2, '0')} {j.scenarioName}
                </div>
                <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'ui-monospace, monospace', marginTop: 2 }}>
                  V{j.valves.slice(0, 8).join(', V')}{j.valves.length > 8 ? ` 외 ${j.valves.length - 8}` : ''}
                  {j.volumeML ? ` · ${j.volumeML} mL` : ' · 시나리오 기본'}
                </div>
              </div>
              <button onClick={() => onCancel(j.id)} title="예약 취소" style={{
                padding: '4px 10px', borderRadius: 6, border: '1px solid #fca5a5',
                background: '#fff', color: '#dc2626', fontSize: 12, fontWeight: 700,
                cursor: 'pointer',
              }}>✕ 취소</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const Schematic = ({ tanks, valves, ec, ph, mode,
  dosingActive, mixingActive, stabilizing, irrigating, activeValveIdx, rawWaterLevel,
  selectedValves, onValveClick }) => {
  const W = 760, H = 540;
  const isEmergency = mode === 'emergency';
  const isPaused = mode === 'paused';
  const dim = isPaused || isEmergency;

  const TANK_X0 = 30, TANK_X1 = W - 30;
  const n = Math.max(tanks.length, 1);
  const tankCx = (i) => TANK_X0 + (i + 0.5) * (TANK_X1 - TANK_X0) / n;
  const tankW = 100, tankH = 96, tankY = 30;
  const pumpY = tankY + tankH + 26;
  const mixerCx = W / 2;
  const mixerW = 220, mixerH = 130;
  const mixerY = 232, mixerBot = mixerY + mixerH;
  const mainPumpY = 405;
  const manifoldY = 460;
  const valveY = 490;

  const VX0 = 50, VX1 = W - 50;
  const vN = Math.max(valves.length, 1);
  const valveCx = (i) => vN === 1 ? W / 2 : VX0 + i * (VX1 - VX0) / (vN - 1);

  // 현재 활성 상태 라벨 (헤더 인디케이터용)
  const phaseLabel = mode === 'emergency' ? '비상정지 · 모든 릴레이 OFF'
    : mode === 'paused' ? '일시정지'
    : dosingActive ? '01 · 도싱 진행 중'
    : mixingActive ? '02 · 교반 진행 중'
    : stabilizing ? '03 · 안정화 진행 중'
    : irrigating ? `04 · V${activeValveIdx} 관수 중`
    : '사이클 대기';
  const phaseColor = mode === 'emergency' ? T.danger
    : mode === 'paused' ? T.info
    : (dosingActive || mixingActive || stabilizing || irrigating) ? T.acc
    : T.fg3;
  const phaseActive = dosingActive || mixingActive || stabilizing || irrigating;

  return (
    <div style={{
      // SCADA 다크 stage 와 일치하도록 wrapper 도 navy 톤
      background: '#0a1426',
      border: '1px solid #1a2540', borderRadius: 14,
      padding: 14,
      position: 'relative', overflow: 'hidden',
      boxShadow: phaseActive
        ? `0 8px 32px rgba(8,145,178,0.24), 0 0 0 1px ${T.acc}55, 0 0 36px ${T.acc}66`
        : '0 6px 24px rgba(11,18,32,0.30), 0 1px 2px rgba(11,18,32,0.20)',
      filter: dim ? 'saturate(0.3) opacity(0.6)' : 'none',
      transition: 'box-shadow 0.3s, filter 0.25s',
    }}>
      {/* 상단 cyan accent strip */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 0, height: 3,
        background: `linear-gradient(90deg, ${T.acc} 0%, ${T.acc2} 100%)`,
      }} />
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet"
           style={{ display: 'block', borderRadius: 10 }}>
        <defs>
          {/* white-on-dark grid for SCADA stage */}
          <pattern id="sd-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="rgba(148,184,210,0.10)" strokeWidth="0.5" />
          </pattern>
          <pattern id="sd-grid-major" width="100" height="100" patternUnits="userSpaceOnUse">
            <path d="M 100 0 L 0 0 0 100" fill="none" stroke="rgba(148,184,210,0.16)" strokeWidth="0.6" />
          </pattern>
          {/* stage background gradient — top: deep navy, bottom: subtle blue */}
          <linearGradient id="sd-stage" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0f1d36" />
            <stop offset="100%" stopColor="#0a1426" />
          </linearGradient>
          {/* equipment steel gradient */}
          <linearGradient id="sd-steel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1a2540" />
            <stop offset="100%" stopColor="#101a2e" />
          </linearGradient>
          {/* cyan glow filter for active equipment */}
          <filter id="sd-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feFlood floodColor="#60a5fa" floodOpacity="0.85" />
            <feComposite in2="b" operator="in" result="g" />
            <feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="sd-glow-orange" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feFlood floodColor="#fb923c" floodOpacity="0.85" />
            <feComposite in2="b" operator="in" result="g" />
            <feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="sd-glow-green" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feFlood floodColor="#4ade80" floodOpacity="0.85" />
            <feComposite in2="b" operator="in" result="g" />
            <feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {/* arrow marker for direction triangles */}
          <marker id="sd-arrow" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={T.acc} />
          </marker>
          <marker id="sd-arrow-mute" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={T.fg4} />
          </marker>
          {/* liquid gradient */}
          <linearGradient id="sd-liq-teal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ccfbf1" />
            <stop offset="100%" stopColor="#a7f3d0" />
          </linearGradient>
          <linearGradient id="sd-liq-cyan" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#cffafe" />
            <stop offset="100%" stopColor="#a5f3fc" />
          </linearGradient>
          <linearGradient id="sd-liq-blue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#dbeafe" />
            <stop offset="100%" stopColor="#bfdbfe" />
          </linearGradient>
          <linearGradient id="sd-liq-red" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fee2e2" />
            <stop offset="100%" stopColor="#fecaca" />
          </linearGradient>
          {/* tank top cap shading */}
          <linearGradient id="sd-cap" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f8fafc" />
            <stop offset="100%" stopColor="#e2e8f0" />
          </linearGradient>
          {/* main spine pipe gradient */}
          <linearGradient id="sd-pipe-on" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f97316" />
            <stop offset="100%" stopColor="#fb923c" />
          </linearGradient>
          {/* soft drop shadow for equipment */}
          <filter id="sd-shadow" x="-10%" y="-10%" width="120%" height="130%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="1.6" />
            <feOffset dx="0" dy="1.5" result="off" />
            <feComponentTransfer><feFuncA type="linear" slope="0.18" /></feComponentTransfer>
            <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* dark SCADA stage */}
        <rect x="0" y="0" width={W} height={H} fill="url(#sd-stage)" rx="10" />
        <rect x="0" y="0" width={W} height={H} fill="url(#sd-grid)" />
        <rect x="0" y="0" width={W} height={H} fill="url(#sd-grid-major)" />

        {/* zone glow bands — brighter tints on dark stage */}
        <g>
          <rect x={12} y={tankY - 22} width={W - 24} height={tankH + 70} rx="10"
                fill="rgba(59,130,246,0.10)" stroke="rgba(96,165,250,0.75)" strokeWidth="1.2" />
          <line x1={13.5} y1={tankY - 16} x2={13.5} y2={tankY + tankH + 42}
                stroke="#60a5fa" strokeWidth="3" strokeLinecap="round" />
          <rect x={12} y={mixerY - 22} width={W - 24} height={mixerH + 56} rx="10"
                fill="rgba(34,197,94,0.10)" stroke="rgba(74,222,128,0.75)" strokeWidth="1.2" />
          <line x1={13.5} y1={mixerY - 16} x2={13.5} y2={mixerY + mixerH + 28}
                stroke="#4ade80" strokeWidth="3" strokeLinecap="round" />
          <rect x={12} y={manifoldY - 22} width={W - 24} height={H - manifoldY + 4} rx="10"
                fill="rgba(249,115,22,0.10)" stroke="rgba(251,146,60,0.75)" strokeWidth="1.2" />
          <line x1={13.5} y1={manifoldY - 16} x2={13.5} y2={H - 24}
                stroke="#fb923c" strokeWidth="3" strokeLinecap="round" />
        </g>

        {/* zone step badges + labels */}
        <g fontFamily={SANS}>
          <ZoneBadge x={TANK_X0} y={tankY - 6} num="01" label="원료 탱크" active={dosingActive} accent="#60a5fa" />
          <ZoneBadge x={mixerCx - mixerW / 2} y={mixerY - 6} num="02" label="혼합기" active={mixingActive || stabilizing} accent="#4ade80" />
          <ZoneBadge x={VX0} y={manifoldY - 6} num="03" label="관수 매니폴드" active={irrigating} accent="#fb923c" />
        </g>

        {/* 원수 RAW WATER — 탱크 + 펌프 */}
        {(() => {
          const lvl = rawWaterLevel ?? null;
          const rwx = 20, rwy = mixerY + 8, rww = 92, rwh = 116;
          const rwCx = rwx + rww / 2;
          const isLow = lvl !== null && lvl < 20;
          const hasLvl = lvl !== null;
          const fillH = hasLvl ? (lvl / 100) * (rwh - 4) : 0;
          const pumpCx = 168, pumpCy = mixerY + 66;
          const active = dosingActive && !isLow;
          return (
            <g>
              <text x={20} y={mixerY - 10} fontSize="13" fontWeight="700"
                fill="#e2e8f0" letterSpacing="2" fontFamily={SANS}>원수 라인</text>
              <g style={{ animation: isLow ? 'sd-flash 1.2s infinite' : 'none' }}>
                <rect x={rwx} y={rwy} width={rww} height={rwh} rx="3"
                  fill="url(#sd-steel)"
                  stroke={isLow ? '#f87171' : active ? '#60a5fa' : 'rgba(148,163,184,0.70)'}
                  strokeWidth={active || isLow ? 2.5 : 1.2}
                  filter={active ? "url(#sd-glow)" : undefined} />
                {hasLvl && (
                  <rect x={rwx + 2} y={rwy + rwh - fillH - 2} width={rww - 4} height={fillH}
                    fill={isLow ? 'rgba(248,113,113,0.65)' : 'rgba(56,189,248,0.60)'} />
                )}
                <text x={rwCx} y={rwy + rwh / 2 - 4} textAnchor="middle"
                  fontSize="15" fontWeight="600" fill={isLow ? '#fca5a5' : '#ffffff'} fontFamily={SANS}>원수</text>
                <text x={rwCx} y={rwy + rwh / 2 + 18} textAnchor="middle"
                  fontSize="15" fontWeight="600" fill={isLow ? '#fca5a5' : '#cbd5e1'} fontFamily={MONO}>
                  {hasLvl ? `${lvl}%` : '— %'}
                </text>
                {isLow && (
                  <text x={rwCx} y={rwy + rwh + 14} textAnchor="middle"
                    fontSize="13" fontWeight="700" fill="#fca5a5" letterSpacing="1.2" fontFamily={SANS}>부족</text>
                )}
              </g>
              <DosingPump cx={pumpCx} cy={pumpCy} active={active} />
              <text x={pumpCx} y={pumpCy + 24} textAnchor="middle" fontSize="11" fontWeight="700"
                fill="#cbd5e1" letterSpacing="1.2" fontFamily={SANS}>원수 펌프</text>
              <FlowLine x1={rwx + rww} y1={pumpCy} x2={pumpCx - 9} y2={pumpCy} active={active} />
              <FlowLine x1={pumpCx + 9} y1={pumpCy} x2={mixerCx - mixerW / 2} y2={pumpCy} active={active} />
            </g>
          );
        })()}

        {tanks.length === 0 ? (
          <g>
            <rect x={TANK_X0} y={tankY + 30} width={TANK_X1 - TANK_X0} height={26} rx="4" fill="none" stroke={T.bd} strokeDasharray="4 3" />
            <text x={(TANK_X0 + TANK_X1) / 2} y={tankY + 47} textAnchor="middle" fontSize="13" fill="#94a3b8" fontFamily={SANS}>탱크 설정 대기 — 설정 탭에서 추가하세요</text>
          </g>
        ) : tanks.map((t, i) => {
          const cx = tankCx(i), x = cx - tankW / 2;
          const hasLvl = t.level !== null && t.level !== undefined;
          const isLow = hasLvl && t.level < 20;
          const fillH = hasLvl ? (t.level / 100) * (tankH - 8) : 0;
          const active = dosingActive && !isLow;
          return (
            <g key={t.id ?? i} style={{ animation: isLow ? 'sd-flash 1.2s infinite' : 'none' }}>
              {/* tank body — steel gradient on dark stage */}
              <rect x={x} y={tankY} width={tankW} height={tankH} rx="4"
                fill="url(#sd-steel)"
                stroke={isLow ? '#f87171' : active ? '#60a5fa' : 'rgba(148,163,184,0.70)'}
                strokeWidth={active || isLow ? 2.5 : 1.2}
                filter={active ? "url(#sd-glow)" : undefined} />
              {/* liquid */}
              {hasLvl && (
                <rect x={x + 1} y={tankY + tankH - fillH - 1} width={tankW - 2} height={fillH}
                  fill={isLow ? 'rgba(248,113,113,0.65)' : active ? 'rgba(96,165,250,0.55)' : 'rgba(96,165,250,0.30)'} />
              )}
              {/* top cap rim */}
              <rect x={x} y={tankY} width={tankW} height="6" rx="4"
                    fill="rgba(148,163,184,0.20)" />
              <line x1={x} y1={tankY + 6} x2={x + tankW} y2={tankY + 6}
                    stroke="rgba(148,163,184,0.35)" strokeWidth="0.6" />
              {/* level tick marks */}
              {hasLvl && [25, 50, 75].map(p => (
                <line key={p} x1={x + tankW - 6} y1={tankY + (1 - p/100) * (tankH - 8) + 4}
                      x2={x + tankW - 2} y2={tankY + (1 - p/100) * (tankH - 8) + 4}
                      stroke="rgba(148,163,184,0.40)" strokeWidth="0.6" />
              ))}
              <text x={cx} y={tankY + tankH / 2 + 2} textAnchor="middle"
                fontSize="15" fontWeight="600" fill={isLow ? '#fca5a5' : '#ffffff'} fontFamily={SANS}>
                {truncate(t.name, 8)}
              </text>
              <text x={cx} y={tankY + tankH / 2 + 22} textAnchor="middle"
                fontSize="15" fontWeight="600" fill={isLow ? '#fca5a5' : '#cbd5e1'} fontFamily={MONO}>
                {hasLvl ? `${t.level}%` : '— %'}
              </text>
              {isLow && (
                <text x={cx} y={tankY + tankH + 14} textAnchor="middle"
                  fontSize="13" fontWeight="700" fill="#fca5a5" letterSpacing="1.2" fontFamily={SANS}>부족</text>
              )}
              <DosingPump cx={cx} cy={pumpY} active={active} />
              <FlowLine x1={cx} y1={pumpY + 8} x2={mixerCx} y2={mixerY} active={active} />
            </g>
          );
        })}

        <g>
          {/* mixer body — steel on dark */}
          <rect x={mixerCx - mixerW / 2} y={mixerY} width={mixerW} height={mixerH} rx="6"
            fill="url(#sd-steel)"
            stroke={mixingActive || stabilizing ? '#4ade80' : 'rgba(148,163,184,0.70)'}
            strokeWidth={mixingActive || stabilizing ? 2.5 : 1.2}
            filter={mixingActive || stabilizing ? "url(#sd-glow)" : undefined} />
          {/* liquid */}
          <rect x={mixerCx - mixerW / 2 + 1} y={mixerY + mixerH * 0.4}
            width={mixerW - 2} height={mixerH * 0.6 - 1} fill="rgba(74,222,128,0.35)" />
          {/* top cap */}
          <rect x={mixerCx - mixerW / 2} y={mixerY} width={mixerW} height="6" rx="6"
                fill="rgba(148,163,184,0.22)" />
          <line x1={mixerCx - mixerW / 2 + 8} y1={mixerY + 6} x2={mixerCx + mixerW / 2 - 8} y2={mixerY + 6}
                stroke="rgba(148,163,184,0.35)" strokeWidth="0.6" />
          <Agitator cx={mixerCx} cy={mixerY + 20} active={mixingActive} />
          <text x={mixerCx} y={mixerY + 48} textAnchor="middle"
            fontSize="14" fontWeight="700" fill="#ffffff" letterSpacing="1.5" fontFamily={SANS}>혼합 탱크</text>
          <line x1={mixerCx - mixerW / 2 + 12} y1={mixerY + 54} x2={mixerCx + mixerW / 2 - 12} y2={mixerY + 54}
            stroke="rgba(148,163,184,0.20)" strokeWidth="1" />
          {/* EC */}
          <text x={mixerCx - mixerW / 2 + 18} y={mixerY + 76} fontSize="13" fontWeight="700"
            fill="#86efac" letterSpacing="1.5" fontFamily={SANS}>EC</text>
          <text x={mixerCx - mixerW / 2 + 18} y={mixerY + 106} fontSize="32" fontWeight="600"
            fill="#86efac" fontFamily={MONO} letterSpacing="-0.02em"
            style={{ filter: 'drop-shadow(0 0 8px rgba(134,239,172,0.75))' }}>
            {ec !== null ? ec.toFixed(2) : '—.—'}
          </text>
          <line x1={mixerCx} y1={mixerY + 60} x2={mixerCx} y2={mixerY + 104} stroke="rgba(148,163,184,0.20)" strokeWidth="1" />
          {/* pH */}
          <text x={mixerCx + 16} y={mixerY + 76} fontSize="13" fontWeight="700"
            fill="#c4b5fd" letterSpacing="1.5" fontFamily={SANS}>pH</text>
          <text x={mixerCx + 16} y={mixerY + 106} fontSize="32" fontWeight="600"
            fill="#d8b4fe" fontFamily={MONO} letterSpacing="-0.02em"
            style={{ filter: 'drop-shadow(0 0 8px rgba(216,180,254,0.75))' }}>
            {ph !== null ? ph.toFixed(2) : '—.—'}
          </text>
          {stabilizing && (
            <text x={mixerCx} y={mixerY + mixerH + 18} textAnchor="middle"
              fontSize="13" fontWeight="700" fill="#fbbf24" letterSpacing="1.5" fontFamily={SANS}
              style={{ animation: 'sd-blink 1.4s infinite' }}>안정화 중…</text>
          )}
        </g>

        <FlowLine x1={mixerCx} y1={mixerBot} x2={mixerCx} y2={mainPumpY - 14} active={irrigating} thick />

        <MainPump cx={mixerCx} cy={mainPumpY} active={irrigating} />
        <text x={mixerCx + 28} y={mainPumpY - 5} fontSize="14" fontWeight="700"
          fill="#e2e8f0" letterSpacing="1.4" fontFamily={SANS}>메인 펌프</text>
        <text x={mixerCx + 28} y={mainPumpY + 13} fontSize="14" fontWeight="600"
          fill={irrigating ? '#86efac' : '#94a3b8'} fontFamily={MONO}
          style={{ filter: irrigating ? 'drop-shadow(0 0 5px rgba(134,239,172,0.6))' : 'none' }}>
          {irrigating ? '가동 중' : '대기'}
        </text>

        {/* main pump → manifold (with direction arrow) */}
        <line x1={mixerCx} y1={mainPumpY + 14} x2={mixerCx} y2={manifoldY - 4}
          stroke={irrigating ? T.acc : T.fg4} strokeWidth="2"
          markerEnd={irrigating ? 'url(#sd-arrow)' : 'url(#sd-arrow-mute)'} />

        {/* manifold pill (header pipe with end caps) */}
        <g>
          <rect x={VX0 - 8} y={manifoldY - 4} width={(VX1 - VX0) + 16} height={8} rx="4"
                fill={irrigating ? `url(#sd-pipe-on)` : T.fg4}
                stroke={irrigating ? T.acc : T.fg4} strokeWidth="0.5" />
          {/* small inset highlight */}
          <rect x={VX0 - 6} y={manifoldY - 3} width={(VX1 - VX0) + 12} height={1.5}
                fill="rgba(255,255,255,0.45)" />
        </g>

        {valves.length === 0 ? (
          <g>
            <rect x={VX0} y={valveY - 4} width={VX1 - VX0} height={22} rx="4" fill="none" stroke={T.bd} strokeDasharray="4 3" />
            <text x={(VX0 + VX1) / 2} y={valveY + 11} textAnchor="middle" fontSize="13" fill="#94a3b8" fontFamily={SANS}>밸브 설정 대기 — 설정 탭에서 추가하세요</text>
          </g>
        ) : valves.map((v, i) => {
          const cx = valveCx(i);
          const active = activeValveIdx === (v.id ?? i + 1);
          const isManual = mode === 'manual';
          const selected = isManual && selectedValves?.has(v.id ?? i + 1);
          const stroke = selected ? '#22d3ee' : active ? '#22d3ee' : irrigating ? '#06b6d4' : 'rgba(148,163,184,0.45)';
          return (
            <g key={v.id ?? i}
               style={isManual ? { cursor: 'pointer' } : undefined}
               onClick={isManual ? () => onValveClick?.(v.id ?? i + 1) : undefined}>
              {/* T-junction node at manifold */}
              <circle cx={cx} cy={manifoldY} r="3"
                      fill={active ? '#fb923c' : selected ? '#22d3ee' : irrigating ? '#f97316' : '#0f172a'}
                      stroke={active ? '#fb923c' : selected ? '#22d3ee' : irrigating ? '#f97316' : 'rgba(148,163,184,0.70)'} strokeWidth="1" />
              <line x1={cx} y1={manifoldY + 3} x2={cx} y2={valveY}
                stroke={stroke} strokeWidth={active || selected ? 2 : 1} />
              <rect x={cx - 18} y={valveY} width="36" height="24" rx="3"
                fill={active ? '#f97316' : selected ? 'rgba(34,211,238,0.18)' : 'url(#sd-steel)'}
                stroke={active ? '#fb923c' : selected ? '#22d3ee' : 'rgba(148,163,184,0.70)'}
                strokeWidth={active ? 2.5 : selected ? 2 : 1.2}
                filter={active ? "url(#sd-glow-orange)" : undefined} />
              <text x={cx} y={valveY + 17} textAnchor="middle" fontSize="14" fontWeight="700"
                fill={active ? '#fff' : selected ? '#22d3ee' : '#cbd5e1'} fontFamily={MONO}>
                {truncate(v.name || `V${i + 1}`, 4)}
              </text>
              {/* selected check mark — manual 모드 */}
              {selected && !active && (
                <text x={cx + 14} y={valveY - 2} textAnchor="middle" fontSize="11" fontWeight="900"
                      fill="#22d3ee" fontFamily={SANS}>●</text>
              )}
              {active && (
                <circle cx={cx} cy={valveY + 30} r="2.5" fill="#fb923c">
                  <animate attributeName="cy" values={`${valveY + 26};${valveY + 40}`} dur="0.9s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="1;0" dur="0.9s" repeatCount="indefinite" />
                </circle>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
};

const DosingPump = ({ cx, cy, active }) => (
  <g>
    <circle cx={cx} cy={cy} r="9" fill={active ? T.acc : T.card}
      stroke={active ? T.acc : T.bd} strokeWidth="1" />
    <g style={{ transformOrigin: `${cx}px ${cy}px`, animation: active ? 'sd-spin 1.4s linear infinite' : 'none' }}>
      <line x1={cx - 5} y1={cy} x2={cx + 5} y2={cy} stroke={active ? '#fff' : T.fg3} strokeWidth="1.2" strokeLinecap="round" />
      <line x1={cx} y1={cy - 5} x2={cx} y2={cy + 5} stroke={active ? '#fff' : T.fg3} strokeWidth="1.2" strokeLinecap="round" />
    </g>
  </g>
);

const Agitator = ({ cx, cy, active }) => (
  <g>
    <circle cx={cx} cy={cy} r="9" fill={active ? T.acc : T.card}
      stroke={active ? T.acc : T.bd} strokeWidth="1" />
    <g style={{ transformOrigin: `${cx}px ${cy}px`, animation: active ? 'sd-spin 0.7s linear infinite' : 'none' }}>
      <line x1={cx - 6} y1={cy} x2={cx + 6} y2={cy} stroke={active ? '#fff' : T.fg3} strokeWidth="1.4" strokeLinecap="round" />
      <line x1={cx} y1={cy - 6} x2={cx} y2={cy + 6} stroke={active ? '#fff' : T.fg3} strokeWidth="1.4" strokeLinecap="round" />
    </g>
  </g>
);

const MainPump = ({ cx, cy, active }) => (
  <g>
    <circle cx={cx} cy={cy} r="14" fill={active ? T.acc : T.card}
      stroke={active ? T.acc : T.bd} strokeWidth="1.2" />
    <g style={{ transformOrigin: `${cx}px ${cy}px`, animation: active ? 'sd-spin 1.1s linear infinite' : 'none' }}>
      <circle cx={cx} cy={cy} r="3" fill={active ? '#fff' : T.fg3} />
      <path d={`M ${cx} ${cy - 11} L ${cx - 3} ${cy - 3} L ${cx + 3} ${cy - 3} Z`} fill={active ? '#fff' : T.fg3} />
      <path d={`M ${cx} ${cy + 11} L ${cx - 3} ${cy + 3} L ${cx + 3} ${cy + 3} Z`} fill={active ? '#fff' : T.fg3} />
      <path d={`M ${cx - 11} ${cy} L ${cx - 3} ${cy - 3} L ${cx - 3} ${cy + 3} Z`} fill={active ? '#fff' : T.fg3} />
      <path d={`M ${cx + 11} ${cy} L ${cx + 3} ${cy - 3} L ${cx + 3} ${cy + 3} Z`} fill={active ? '#fff' : T.fg3} />
    </g>
  </g>
);

const FlowLine = ({ x1, y1, x2, y2, active, thick }) => {
  const cy = (y1 + y2) / 2;
  const d = `M ${x1} ${y1} C ${x1} ${cy}, ${x2} ${cy}, ${x2} ${y2}`;
  return (
    <g>
      <path d={d} fill="none" stroke={active ? T.acc : T.fg4}
        strokeWidth={thick ? 1.6 : 1}
        strokeDasharray={active ? 'none' : '3 3'} strokeLinecap="round" />
      {active && (
        <>
          <circle r={thick ? 2.4 : 2} fill={T.acc}>
            <animateMotion path={d} dur="1.4s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;1;1;0" dur="1.4s" repeatCount="indefinite" />
          </circle>
          <circle r={thick ? 2.4 : 2} fill={T.acc}>
            <animateMotion path={d} dur="1.4s" begin="0.7s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;1;1;0" dur="1.4s" begin="0.7s" repeatCount="indefinite" />
          </circle>
        </>
      )}
    </g>
  );
};

const CompactStatus = ({ tanks, valves, phaseInfo, activeValveIdx, mode, lowTanks,
  onValveClick, selectedValves }) => (
  <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
    <CompactRow label="SENSORS"    value={phaseInfo ? '실시간 수집 중' : '대기'} accent="#0d9488" />
    <CompactRow label="CONTROL"    value={phaseInfo ? `${phaseInfo.short} · −${fmtMS(phaseInfo.remaining)}` : '시나리오 대기'} accent="#d97706" />
    <CompactRow label="ACTUATORS"  value={activeValveIdx ? `V${activeValveIdx} 중` : `밸브 ${valves.length}개 대기`} accent="#2563eb" live={!!activeValveIdx} />
    <CompactRow label="SAFETY"     value={mode === 'emergency' ? '비상정지 ACTIVE' : '정상'} accent="#dc2626" alarm={mode === 'emergency'} />

    {/* manual 모드 — 밸브 클릭 grid (모바일 UI) */}
    {onValveClick && (
      <div style={{
        marginTop: 4, padding: '10px 12px', borderRadius: 10,
        background: '#fffbeb', border: '1px solid #fbbf24',
      }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: '#92400e', marginBottom: 8 }}>
          ✋ 밸브 선택 (클릭 = 선택/해제)
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))', gap: 6,
        }}>
          {valves.map((v, i) => {
            const id = v.id ?? i + 1;
            const sel = selectedValves?.has(id);
            const live = activeValveIdx === id;
            return (
              <button key={id} onClick={() => onValveClick(id)} style={{
                padding: '10px 4px', borderRadius: 6,
                border: `1.5px solid ${live ? '#f97316' : sel ? '#0891b2' : '#cbd5e1'}`,
                background: live ? '#f97316' : sel ? '#ecfeff' : '#fff',
                color: live ? '#fff' : sel ? '#0e7490' : '#475569',
                fontSize: 13, fontWeight: 800, fontFamily: MONO,
                cursor: 'pointer', textAlign: 'center',
              }}>{v.name || `V${id}`}{sel && ' ●'}</button>
            );
          })}
        </div>
      </div>
    )}

    {lowTanks.length > 0 && (
      <div style={{
        marginTop: 4, padding: '12px 14px', borderRadius: 8,
        background: '#fef2f2', border: `1px solid ${T.danger}33`,
        fontSize: 14, color: T.danger, fontFamily: MONO,
      }}>
        LOW : {lowTanks.map(t => `${t.name} ${t.level}%`).join(' · ')}
      </div>
    )}
  </div>
);

const CompactRow = ({ label, value, accent, live, alarm }) => (
  <div style={{
    background: T.card, border: `1px solid ${T.bd}`, borderRadius: 8,
    padding: '12px 14px', position: 'relative',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    animation: alarm ? 'sd-flash 1s infinite' : 'none',
  }}>
    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: accent }} />
    <span style={{ marginLeft: 8, ...kicker, fontSize: 11 }}>{label}</span>
    <span style={{ fontSize: 14, fontWeight: 600, color: alarm ? T.danger : T.fg, fontFamily: MONO }}>
      {live && <span style={{
        display: 'inline-block', width: 7, height: 7, borderRadius: 3.5, background: T.ok,
        marginRight: 7, animation: 'sd-blink 1.2s infinite',
      }} />}
      {value}
    </span>
  </div>
);

const PhaseTimeline = ({ phaseInfo, dimmed }) => {
  const cur = phaseInfo ? PHASE_PLAN.findIndex(p => p.key === phaseInfo.phaseKey) : -1;
  return (
    <section style={{
      marginTop: 16,
      background: T.card, border: `1px solid ${T.bd}`, borderRadius: 10,
      position: 'relative', overflow: 'hidden',
      opacity: dimmed ? 0.45 : 1, transition: 'opacity 0.25s',
    }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: T.acc }} />
      <div style={{
        padding: '10px 14px 8px 14px',
        borderBottom: `1px solid ${T.hair}`,
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: T.fg }}>사이클 진행</span>
        <span style={{ fontSize: 15, color: T.fg3, fontFamily: MONO }}>
          {phaseInfo ? `${String(cur + 1).padStart(2, '0')} / ${String(PHASE_PLAN.length).padStart(2, '0')} 단계` : '사이클 대기'}
        </span>
      </div>

      <div style={{ padding: '16px 18px', display: 'flex', alignItems: 'flex-start', gap: 4 }}>
        {PHASE_PLAN.map((p, i) => {
          const past = cur > i, isCur = cur === i;
          const c = isCur ? T.acc : past ? T.ok : T.fg4;
          const nodeBg = isCur ? T.accBg : past ? '#f0fdf4' : T.card;
          return (
            <React.Fragment key={p.key}>
              <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 16, border: `1.5px solid ${c}`,
                    background: nodeBg,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: MONO, fontSize: 14, fontWeight: 700, color: c, flexShrink: 0,
                    animation: isCur ? 'sd-pulse 2s infinite' : 'none',
                  }}>{past ? '✓' : String(i + 1).padStart(2, '0')}</div>
                  <div style={{ fontSize: 16, fontWeight: 700,
                    color: isCur ? T.fg : past ? T.ok : T.fg3,
                    letterSpacing: '0.04em' }}>
                    {p.short}
                  </div>
                </div>
                <div style={{ marginTop: 8, marginLeft: 44,
                  fontSize: 14,
                  color: isCur ? T.fg2 : T.fg3,
                  fontFamily: MONO }}>
                  {isCur && phaseInfo
                    ? <>{fmtMS(phaseInfo.elapsed)} · −{fmtMS(phaseInfo.remaining)}</>
                    : past ? <>완료 · {p.duration}s</> : <>대기 · {p.duration}s</>}
                </div>
                {isCur && phaseInfo && (
                  <div style={{ marginTop: 8, marginLeft: 44, marginRight: 10,
                    height: 4, background: T.hair, borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${phaseInfo.progress * 100}%`, height: '100%',
                      background: T.acc, transition: 'width 0.4s' }} />
                  </div>
                )}
              </div>
              {i < PHASE_PLAN.length - 1 && (
                <div style={{ flexShrink: 0, width: 16, height: 1.5, marginTop: 15,
                  background: cur > i ? T.ok : T.hair }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </section>
  );
};

const Alerts = ({ alerts }) => {
  if (!alerts || alerts.length === 0) return null;
  return (
    <section style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
        <Ico.Bell s={13} />
        <span style={kicker}>활성 경보 · {String(alerts.length).padStart(2, '0')}</span>
      </div>
      <div style={{ background: T.card, border: `1px solid ${T.bd}`, borderRadius: 10, overflow: 'hidden' }}>
        {alerts.map((a, i) => {
          const sev = SEV[a.severity] || SEV.warning;
          const t = a.occurredAt ? new Date(a.occurredAt).toLocaleTimeString('ko-KR', { hour12: false }) : '';
          return (
            <div key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '13px 16px',
              borderTop: i > 0 ? `1px solid ${T.hair}` : 'none',
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: 3.5, background: sev.c,
                animation: a.severity === 'critical' ? 'sd-blink 1.1s infinite' : 'none', flexShrink: 0,
              }} />
              <span style={{
                fontFamily: MONO, fontSize: 11.5, fontWeight: 700, color: sev.c,
                letterSpacing: '0.1em', width: 88,
              }}>{sev.label}</span>
              <span style={{ flex: 1, fontSize: 15, color: T.fg, fontWeight: 500 }}>{a.message}</span>
              <span style={{ fontFamily: MONO, fontSize: 12.5, color: T.fg3 }}>{t}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
};

const Footer = () => (
  <div style={{
    marginTop: 14, paddingTop: 12, borderTop: `1px solid ${T.hair}`,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  }}>
    <div style={{ fontSize: 12, color: T.fg3, fontFamily: MONO, letterSpacing: '0.06em' }}>
      엔지니어링 진단 · 별도 페이지 페이지에서 확인
    </div>
    <div style={{ display: 'flex', gap: 8 }}>
      <button disabled title="Phase 3.2 이후 활성화" style={{
        padding: '8px 14px', borderRadius: 6, border: `1px solid ${T.bd}`,
        background: T.card, color: T.fg3, fontSize: 13, fontWeight: 600,
        letterSpacing: '0.04em', cursor: 'not-allowed', fontFamily: SANS,
      }}>강제 사이클</button>
      <button disabled title="Phase 3.2 이후 활성화" style={{
        padding: '8px 14px', borderRadius: 6, border: `1px solid ${T.bd}`,
        background: T.card, color: T.fg3, fontSize: 13, fontWeight: 600,
        letterSpacing: '0.04em', cursor: 'not-allowed', fontFamily: SANS,
      }}>센서 캘리브레이션</button>
    </div>
  </div>
);

const PausedOverlay = () => (
  <div style={{
    position: 'absolute', inset: 0, pointerEvents: 'none',
    background: 'rgba(247, 248, 250, 0.55)', borderRadius: 14,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  }}>
    <div style={{
      padding: '12px 32px', borderRadius: 4, background: T.info,
      color: '#fff', fontSize: 13, fontWeight: 700, letterSpacing: '0.24em', fontFamily: SANS,
    }}>❚❚  SYSTEM PAUSED</div>
  </div>
);

const EmergencyOverlay = () => (
  <div style={{
    position: 'absolute', inset: 0, pointerEvents: 'none',
    borderRadius: 14, animation: 'sd-emergency 1.2s infinite',
  }}>
    <div style={{
      position: 'absolute', top: 14, right: 14,
      padding: '8px 14px', borderRadius: 4, background: T.danger,
      color: '#fff', fontSize: 12, fontWeight: 700, letterSpacing: '0.2em',
      fontFamily: MONO, display: 'flex', alignItems: 'center', gap: 7,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: 3.5, background: '#fff',
        animation: 'sd-blink 0.6s infinite' }} />
      EMERGENCY · ALL RELAY OFF
    </div>
  </div>
);

const LoadingPlaceholder = () => (
  <div style={{
    marginTop: 16, padding: '60px 20px', background: T.card,
    border: `1px dashed ${T.bd}`, borderRadius: 10, textAlign: 'center',
  }}>
    <div style={{ fontFamily: MONO, fontSize: 13, color: T.fg3, letterSpacing: '0.24em' }}>데이터 수신 대기</div>
    <div style={{ marginTop: 8, fontSize: 14, color: T.fg3 }}>양액 제어기 연결을 확인하는 중입니다…</div>
  </div>
);

function fmtMS(sec) {
  if (sec === null || sec === undefined || Number.isNaN(sec)) return '—:——';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function truncate(s, n) { if (!s) return ''; return s.length > n ? s.slice(0, n - 1) + '…' : s; }

const KEYFRAMES = `
@keyframes sd-blink   { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
@keyframes sd-pulse   { 0%, 100% { box-shadow: 0 0 0 0 rgba(8,145,178,0.35); } 50% { box-shadow: 0 0 0 6px rgba(8,145,178,0); } }
@keyframes sd-flash   { 0%, 100% { background-color: transparent; } 50% { background-color: rgba(220, 38, 38, 0.07); } }
@keyframes sd-spin    { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes sd-emergency { 0%, 100% { box-shadow: inset 0 0 0 1px rgba(220,38,38,0.4); } 50% { box-shadow: inset 0 0 0 3px rgba(220,38,38,0.55); } }
`;
