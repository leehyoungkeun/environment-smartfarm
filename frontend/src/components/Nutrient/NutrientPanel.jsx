import { useEffect, useRef, useState } from 'react';
import NutrientRealtime from './NutrientRealtime';
import NutrientSettings from './NutrientSettings';
import * as nutrientApi from '../../services/nutrientApi';

const TABS = [
  { id: 'realtime', label: '실시간', icon: '📊', desc: '운영·제어·흐름' },
  { id: 'settings', label: '설정', icon: '🔧', desc: '시나리오·하드웨어·경보' },
];

const MODES = {
  auto:      { label: '자동운행', color: '#16a34a', bg: '#dcfce7', icon: '▶' },
  manual:    { label: '수동',     color: '#d97706', bg: '#fef3c7', icon: '✋' },
  direct:    { label: '직접 제어', color: '#7c3aed', bg: '#ede9fe', icon: '⚙' },
  paused:    { label: '일시정지', color: '#2563eb', bg: '#dbeafe', icon: '❚❚' },
  emergency: { label: '비상정지', color: '#dc2626', bg: '#fee2e2', icon: '●' },
};

// Phase 2 에서 SmartFarm 센서 API 연동 — mock
const MOCK_ENV = {
  outTemp: 20.8, outHumid: 82.5, inTemp: 22.3, inHumid: 65.0,
  rainfall: 0.0, windSpeed: 0.0, solar: 0, illuminance: 0,
};

export default function NutrientPanel({ farmId }) {
  const [activeTab, setActiveTab] = useState('realtime');
  const [mode, setMode] = useState('paused');
  const [programNum, setProgramNum] = useState(null);
  const [programName, setProgramName] = useState(null);
  const [scenarios, setScenarios] = useState([]);
  const [phaseInfo, setPhaseInfo] = useState(null);  // NutrientRealtime → push (모드바 사이클 그래픽)
  const [autoStatus, setAutoStatus] = useState(null); // NutrientRealtime → push (자동 모드 큐 진행)
  const [manualStatus, setManualStatus] = useState(null); // NutrientRealtime → push (수동 모드 작업 큐)
  const [alerts] = useState([]); // sticky 경보 배너 (Phase 3 RPi telemetry 연동 후 활성)
  const [env] = useState(MOCK_ENV);

  const refetchScenarios = () => {
    nutrientApi.listScenarios(farmId).then(setScenarios).catch(() => {});
  };
  useEffect(() => { refetchScenarios(); }, [farmId]);

  // Realtime 이 활성 program 정보를 헤더로 푸시 (state polling 결과)
  const handleProgramChange = ({ programNum: n, programName: nm }) => {
    setProgramNum(n);
    setProgramName(nm);
    refetchScenarios();
  };

  const handleScenarioSelect = async (scenarioId) => {
    if (!scenarioId) return;
    try {
      await nutrientApi.activateScenario(farmId, scenarioId);
      refetchScenarios();
      // 모드 전환은 사용자가 명시적으로 (자동 모드 자동 진입 부작용 제거)
    } catch (e) {
      alert(`시나리오 활성화 실패: ${e.response?.data?.error || e.message}`);
    }
  };

  // 초기 mode 1회 로드 (이후 외부 변경은 Realtime 의 state polling 에서 detectExternalModeChange 로 알림)
  // 이전: 별도 5초 polling → Realtime 과 동일 endpoint 중복 호출. dedup 위해 polling 제거.
  const pendingModeUntilRef = useRef(0);
  useEffect(() => {
    let cancelled = false;
    nutrientApi.getState(farmId)
      .then(s => { if (!cancelled && s?.mode) setMode(s.mode); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [farmId]);

  // mode 변경 → API 호출 (optimistic update + 실패 시 복원)
  // Realtime callback (외부 변경 감지) 도 동일 함수로 들어옴.
  // confirm 다이얼로그는 여기 단일 위치 — Panel ModeSegment 가 호출.
  const handleModeChange = async (newMode, opts = {}) => {
    if (newMode === mode) return;
    // 사용자 액션일 때만 emergency 확인 — 외부 자동 변경 (RPi GPIO 등) 은 confirm 우회
    if (!opts.external && newMode === 'emergency'
        && !window.confirm('비상정지하시겠습니까?\n모든 릴레이가 OFF 됩니다.')) return;
    const prev = mode;
    setMode(newMode);
    if (opts.external) return;  // 외부 변경 통보 — API 호출 X
    pendingModeUntilRef.current = Date.now() + 3000;
    try {
      await nutrientApi.setMode(farmId, newMode);
    } catch (e) {
      setMode(prev);
      pendingModeUntilRef.current = 0;
      alert(`모드 변경 실패: ${e.response?.data?.error || e.message}`);
    }
  };

  const tempDiff = env.outTemp - env.inTemp;
  const tempDiffWarn = Math.abs(tempDiff) > 5;
  const rainWarn = env.rainfall > 0;
  const windWarn = env.windSpeed > 5;

  return (
    <div className="max-w-7xl mx-auto px-2 md:px-6 py-4 md:py-6">
      {/* 경보 sticky 배너 */}
      {alerts.length > 0 && (
        <div style={{
          background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 10,
          padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>⚠️</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#991b1b' }}>{alerts[0].message}</span>
        </div>
      )}

      {/* 헤더 — 브랜드 + 모드 셀렉터 */}
      <div style={{
        background: 'linear-gradient(135deg, #0891b2 0%, #06b6d4 100%)',
        borderRadius: 16, padding: '10px 14px',
        marginBottom: 8,
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'nowrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 22, flexShrink: 0 }}>💧</span>
          <h2 style={{
            color: '#fff', fontSize: 17, fontWeight: 800, margin: 0,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>양액자동공급시스템</h2>
        </div>

        {/* 우상단 액션 — 설정 토글 + 비상 */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            onClick={() => setActiveTab(activeTab === 'settings' ? 'realtime' : 'settings')}
            title={activeTab === 'settings' ? '실시간으로 돌아가기' : '설정 열기'}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              padding: '6px 14px', borderRadius: 14, cursor: 'pointer',
              background: activeTab === 'settings' ? '#fff' : 'rgba(255,255,255,0.16)',
              color: activeTab === 'settings' ? '#0891b2' : '#fff',
              border: '1.5px solid rgba(255,255,255,0.4)',
              fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap',
              minWidth: 78, height: 32,
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => { if (activeTab !== 'settings') e.currentTarget.style.background = 'rgba(255,255,255,0.28)'; }}
            onMouseLeave={(e) => { if (activeTab !== 'settings') e.currentTarget.style.background = 'rgba(255,255,255,0.16)'; }}
          >
            <span style={{ fontSize: 13 }}>{activeTab === 'settings' ? '←' : '🔧'}</span>
            <span>{activeTab === 'settings' ? '실시간' : '설정'}</span>
          </button>

          <button
            onClick={() => handleModeChange('emergency')}
            title="비상정지 — 모든 양액 릴레이 OFF"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
              padding: '6px 14px', borderRadius: 14, cursor: 'pointer',
              background: mode === 'emergency' ? '#fee2e2' : '#dc2626',
              color: mode === 'emergency' ? '#dc2626' : '#fff',
              border: mode === 'emergency' ? '1.5px solid #fca5a5' : '1.5px solid #b91c1c',
              fontSize: 13, fontWeight: 800, whiteSpace: 'nowrap',
              minWidth: 78, height: 32,
              transition: 'background 0.15s',
              boxShadow: '0 1px 3px rgba(220,38,38,0.3)',
              animation: mode === 'emergency' ? 'pulse 1s infinite' : 'none',
            }}
            onMouseEnter={(e) => { if (mode !== 'emergency') e.currentTarget.style.background = '#b91c1c'; }}
            onMouseLeave={(e) => { if (mode !== 'emergency') e.currentTarget.style.background = '#dc2626'; }}
          >
            <span style={{ fontSize: 13 }}>●</span>
            <span>비상</span>
          </button>
        </div>
      </div>

      {/* 외부 환경 row — 양액 자동화의 핵심 트리거 데이터
          ⚠️ 현재 MOCK_ENV 고정값. 실 sensor API 연결은 Phase 2 작업 (todo) */}
      <div style={{
        background: '#fff', borderRadius: 12, padding: '8px 12px',
        marginBottom: 12, border: '1px solid #e2e8f0',
        display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto',
      }}>
        <EnvChip icon="🌡️" label="외부" value={env.outTemp} unit="°C" color="#dc2626" />
        <EnvChip icon="💧" label="외습" value={env.outHumid} unit="%" color="#0891b2" />
        <Divider />
        <EnvChip icon="🏠" label="내부" value={env.inTemp} unit="°C" color="#16a34a" />
        <EnvChip icon="💧" label="내습" value={env.inHumid} unit="%" color="#0891b2" />
        <Divider />
        <EnvChip icon="↕️" label="온도차" value={tempDiff.toFixed(1)} unit="°C" color={tempDiffWarn ? '#dc2626' : '#64748b'} warn={tempDiffWarn} />
        <Divider />
        <EnvChip icon="☂️" label="강우" value={env.rainfall} unit="mm" color={rainWarn ? '#dc2626' : '#64748b'} warn={rainWarn} />
        <EnvChip icon="🌬️" label="풍속" value={env.windSpeed} unit="m/s" color={windWarn ? '#dc2626' : '#64748b'} warn={windWarn} />
        <EnvChip icon="☀️" label="일사량" value={env.solar} unit="W/m²" color="#d97706" />
      </div>

      {/* 운영 모드 바 — 자동/시나리오/수동/직접/정지 (비상은 헤더로 이동) */}
      {/* 모드바 — 실시간 탭에서만. 수동 모드는 ManualPalette 의 흰 wrapper 와 시각적으로 연결 (하나의 흰 카드처럼) */}
      {activeTab === 'realtime' && (
        <div style={{
          background: '#fff',
          borderRadius: mode === 'manual' ? '12px 12px 0 0' : 12,
          padding: 8,
          marginBottom: mode === 'manual' ? 0 : 12,
          boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
          border: '1px solid #e2e8f0',
          borderBottom: mode === 'manual' ? 'none' : '1px solid #e2e8f0',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <ModeSegment mode={mode} onChange={handleModeChange}
            programNum={programNum} programName={programName}
            scenarios={scenarios} onScenarioSelect={handleScenarioSelect}
            phaseInfo={phaseInfo} autoStatus={autoStatus} manualStatus={manualStatus} />
        </div>
      )}

      {/* 컨텐츠 */}
      {activeTab === 'realtime' && <NutrientRealtime farmId={farmId} mode={mode} onModeChange={handleModeChange} onProgramChange={handleProgramChange} onPhaseChange={setPhaseInfo} onAutoStatusChange={setAutoStatus} onManualStatusChange={setManualStatus} />}
      {activeTab === 'settings' && <NutrientSettings farmId={farmId} />}

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes flow-dash { to { stroke-dashoffset: -20; } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes wave { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(-3px); } }
        @keyframes seg-stripes { from { background-position: 0 0; } to { background-position: 24px 0; } }

        /* 모바일에서 다른 모드 전환 버튼 (수동/직접/정지 등) 좌우 꽉 차게 */
        @media (max-width: 768px) {
          .nutrient-other-modes {
            width: 100% !important;
            flex-wrap: nowrap !important;
          }
          .nutrient-other-modes > button {
            flex: 1 1 0 !important;
            min-width: 0 !important;
            justify-content: center !important;
          }
        }

        /* 도싱 탱크 이름 input — 수정 가능 시각 단서 */
        .tank-label-input:hover {
          border-bottom-color: #94a3b8 !important;
          background: #f1f5f9 !important;
        }
        .tank-label-input:focus {
          border-bottom: 2px solid #0891b2 !important;
          background: #f0f9ff !important;
        }
        .tank-label-input::placeholder { color: #cbd5e1; }
      `}</style>
    </div>
  );
}

const EnvChip = ({ icon, label, value, unit, color, warn }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 8,
    background: warn ? '#fef2f2' : 'transparent',
    border: warn ? '1px solid #fca5a5' : 'none',
    flexShrink: 0,
  }}>
    <span style={{ fontSize: 15 }}>{icon}</span>
    <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{label}</span>
    <span style={{ fontSize: 15, color, fontWeight: 800 }}>{value}<span style={{ fontSize: 11, marginLeft: 2 }}>{unit}</span></span>
  </div>
);
const Divider = () => <div style={{ width: 1, height: 16, background: '#e2e8f0', flexShrink: 0 }} />;

// 짧은 라벨 — HydroControl 헤더 segmented control 폭 절약
const SHORT_LABEL = {
  auto: '자동', manual: '수동', direct: '직접', paused: '정지', emergency: '비상',
};

// 자동 모드 활성 시 시나리오 select 옆에 표시되는 사이클 진행 그래픽
// 현재 단계 SVG 아이콘 (펄스/회전/파동) + 진행 stripe + % + 남은 시간
const PHASE_COLOR = {
  dosing:     '#0891b2',  // 도싱 — 청록
  mixing:     '#d97706',  // 교반 — 주황
  stabilize:  '#16a34a',  // 안정화 — 초록
  irrigating: '#2563eb',  // 관수 — 파랑
  cleanup:    '#7c3aed',  // 정리 — 보라
};
const PhaseSvgIcon = ({ phaseKey, color, size = 14 }) => {
  const common = { display: 'inline-block', fontSize: size, color, lineHeight: 1 };
  switch (phaseKey) {
    case 'dosing':     return <span style={{ ...common, animation: 'pulse 1s ease-in-out infinite' }}>💧</span>;
    case 'mixing':     return <span style={{ ...common, animation: 'spin 1.8s linear infinite' }}>↻</span>;
    case 'stabilize':  return <span style={{ ...common, animation: 'pulse 1.6s ease-in-out infinite' }}>◎</span>;
    case 'irrigating': return <span style={{ ...common, animation: 'wave 1.4s ease-in-out infinite' }}>≈</span>;
    case 'cleanup':    return <span style={{ ...common, animation: 'pulse 1.2s ease-in-out infinite' }}>✦</span>;
    default:           return null;
  }
};
const CyclePhaseGraphic = ({ phaseInfo }) => {
  // 사이클 대기 상태 — 회색 chip
  if (!phaseInfo) {
    return (
      <div role="status" aria-label="사이클 대기 중" style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '5px 11px', borderRadius: 14,
        background: '#f1f5f9',
        border: '1.5px solid #e2e8f0',
        whiteSpace: 'nowrap',
      }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#94a3b8',
          animation: 'pulse 1.6s ease-in-out infinite', display: 'inline-block' }} />
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#64748b', letterSpacing: '0.02em' }}>사이클 대기</span>
      </div>
    );
  }
  // 진행 중 — 단계별 컬러 + 액체 흐름 stripe + 펄스 아이콘
  const c = PHASE_COLOR[phaseInfo.phaseKey] || '#64748b';
  const pct = Math.round((phaseInfo.progress || 0) * 100);
  const remainSec = Math.max(0, Math.floor(phaseInfo.remaining || 0));
  const mins = Math.floor(remainSec / 60);
  const secs = remainSec % 60;
  return (
    <div role="status" aria-label={`현재 단계 ${phaseInfo.short} ${pct}%`} style={{
      display: 'flex', alignItems: 'center', gap: 7,
      padding: '5px 11px', borderRadius: 14,
      background: c + '12',
      border: `1.5px solid ${c}55`,
      minWidth: 160, position: 'relative', overflow: 'hidden',
      whiteSpace: 'nowrap',
    }}>
      {/* 진행률 stripe 배경 — 액체 흐름 애니메이션 */}
      <div style={{
        position: 'absolute', left: 0, top: 0, bottom: 0,
        width: `${pct}%`,
        background: `repeating-linear-gradient(45deg, ${c}33 0 6px, ${c}15 6px 12px)`,
        animation: 'seg-stripes 0.8s linear infinite',
        backgroundSize: '24px 24px',
        opacity: 0.85,
        transition: 'width 0.6s linear',
      }} />
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
        <PhaseSvgIcon phaseKey={phaseInfo.phaseKey} color={c} size={15} />
        <span style={{ fontSize: 12.5, fontWeight: 800, color: c, letterSpacing: '0.02em' }}>{phaseInfo.short}</span>
        <span style={{ fontSize: 11.5, fontWeight: 800, color: c, opacity: 0.95 }}>{pct}%</span>
        {remainSec > 0 && (
          <span style={{ fontSize: 10.5, fontFamily: 'ui-monospace,SF Mono,monospace', fontWeight: 700, color: c, opacity: 0.7 }}>
            −{mins > 0 ? `${mins}:` : ''}{String(secs).padStart(2, '0')}
          </span>
        )}
      </div>
    </div>
  );
};

// 모드별 메타 — 활성 시 색깔/gradient/chip 라벨
const MODE_META = {
  auto:      { icon: '▶',  label: '자동 실행 중', color: '#16a34a', bg: 'linear-gradient(135deg, #ecfdf5 0%, #f0fdfa 100%)' },
  manual:    { icon: '✋', label: '수동 모드',    color: '#d97706', bg: 'linear-gradient(135deg, #fef3c7 0%, #fef9c3 100%)' },
  direct:    { icon: '⚙',  label: '직접 제어',    color: '#7c3aed', bg: 'linear-gradient(135deg, #ede9fe 0%, #f5f3ff 100%)' },
  paused:    { icon: '❚❚', label: '일시정지',    color: '#2563eb', bg: 'linear-gradient(135deg, #dbeafe 0%, #eff6ff 100%)' },
  emergency: { icon: '●',  label: '비상정지',    color: '#dc2626', bg: 'linear-gradient(135deg, #fee2e2 0%, #fef2f2 100%)' },
};

// 다른 모드 전환 작은 버튼
const DimModeBtn = ({ mode, onChange }) => {
  const m = MODE_META[mode];
  return (
    <button onClick={() => onChange(mode)} title={m.label}
      style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '5px 11px', borderRadius: 14,
        background: '#fff', color: '#64748b',
        border: '1.5px solid #e2e8f0',
        cursor: 'pointer', fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderColor = '#cbd5e1'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#e2e8f0'; }}
    >
      <span style={{ color: m.color }}>{m.icon}</span>
      <span>{SHORT_LABEL[mode]}</span>
    </button>
  );
};

// 통합 활성 모드 카드 — 모든 모드 공통 layout, 모드별 중앙 컨텐츠만 분기
const ActiveModeCard = ({ mode, onChange, autoStatus, manualStatus, phaseInfo, scenarios, onScenarioSelect }) => {
  const m = MODE_META[mode];
  const otherModes = Object.keys(MODE_META).filter(k => k !== mode && k !== 'emergency');

  return (
    <div style={{ flex: 1, padding: 10, borderRadius: 12, background: m.bg, border: `1.5px solid ${m.color}55` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{
          padding: '4px 11px', borderRadius: 14, background: m.color, color: '#fff',
          fontSize: 13, fontWeight: 800,
          animation: (mode === 'auto' || mode === 'emergency') ? 'pulse 2s ease-in-out infinite' : 'none',
        }}>{m.icon} {m.label}</span>

        {/* 모드별 중앙 컨텐츠 */}
        {mode === 'auto' && <AutoBody autoStatus={autoStatus} scenarios={scenarios} onScenarioSelect={onScenarioSelect} accent={m.color} />}
        {mode === 'manual' && <ManualBody manualStatus={manualStatus} scenarios={scenarios} onScenarioSelect={onScenarioSelect} accent={m.color} />}
        {mode === 'direct' && <DirectBody accent={m.color} />}
        {mode === 'paused' && <PausedBody accent={m.color} />}

        <div style={{ flex: 1 }} />

        {/* 다른 모드 전환 — 모바일에서 좌우 꽉 차게 */}
        <div className="nutrient-other-modes" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {otherModes.map(k => <DimModeBtn key={k} mode={k} onChange={onChange} />)}
        </div>
      </div>

      {/* 자동 모드 보조 — 사이클 단계 표시 (수동 모드는 ManualPalette 아래쪽이 작업 큐 담당이라 제거) */}
      {mode === 'auto' && autoStatus && !autoStatus.empty && (
        <div style={{ marginTop: 6 }}>
          {phaseInfo ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <PhaseChip phaseInfo={phaseInfo} />
              <MiniPhaseStepper phaseKey={phaseInfo.phaseKey} progress={phaseInfo.progress} />
            </div>
          ) : (
            <IdleChip text="사이클 대기 — 잠시 후 시작" />
          )}
        </div>
      )}
    </div>
  );
};

// 자동 모드 중앙 — 현재 시나리오 + 반복 + 다음
const AutoBody = ({ autoStatus, scenarios, onScenarioSelect, accent }) => {
  if (!autoStatus || autoStatus.empty) {
    return <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>
      자동 스케줄이 비었습니다 — 설정 → 🔄 자동 실행 스케줄에서 추가
    </span>;
  }
  const { currentScenario, currentProgramNum, nextScenario, nextProgramNum, repeat, repeatDone } = autoStatus;
  return (
    <>
      <select value={currentScenario?.id || ''}
        onChange={(e) => onScenarioSelect && onScenarioSelect(e.target.value)}
        title={currentScenario ? `P-${String(currentProgramNum).padStart(2,'0')} · ${currentScenario.name}` : '시나리오'}
        style={cardSelect}>
        {scenarios.map((s, i) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      <span style={{ ...cardChip, border: `1px solid ${accent}55`, color: accent }}>
        🔁 {repeatDone + 1}/{repeat}회
      </span>
      {nextScenario && (
        <span style={{ fontSize: 11.5, color: '#64748b', fontWeight: 700 }}>
          →  다음 P-{String(nextProgramNum).padStart(2,'0')} {nextScenario.name}
        </span>
      )}
    </>
  );
};

// 수동 모드 중앙 — 현재 시나리오 + 작업 큐 요약
const ManualBody = ({ manualStatus, scenarios, onScenarioSelect, accent }) => {
  const activeScenario = scenarios.find(s => s.active);
  const ms = manualStatus || { runningJob: null, queuedCount: 0, scheduledCount: 0, totalCount: 0 };
  return (
    <>
      <select value={activeScenario?.id || ''}
        onChange={(e) => onScenarioSelect && onScenarioSelect(e.target.value)}
        title="시나리오 선택 — 추가 작업의 기본 설정"
        style={cardSelect}>
        {scenarios.map((s, i) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
      {ms.runningJob ? (
        <span style={{ ...cardChip, border: `1px solid ${accent}55`, color: accent, animation: 'pulse 1.4s ease-in-out infinite' }}>
          ▶ 실행 중
        </span>
      ) : (
        <span style={{ ...cardChip, border: '1px solid #e2e8f0', color: '#64748b', background: '#fff' }}>
          작업 대기
        </span>
      )}
      <span style={{ fontSize: 11.5, color: '#64748b', fontWeight: 700 }}>
        큐 {ms.queuedCount}개 · 예약 {ms.scheduledCount}개
      </span>
    </>
  );
};

const DirectBody = ({ accent }) => (
  <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>
    개별 채널 직접 제어 — 다이어그램에서 부품 클릭
  </span>
);

const PausedBody = ({ accent }) => (
  <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>
    모든 자동화 대기 — 다른 모드 클릭 시 재개
  </span>
);

// chip / select 공통 스타일
const cardSelect = {
  padding: '4px 10px', borderRadius: 14,
  background: '#fff', color: '#0f172a',
  border: '1.5px solid #e2e8f0',
  fontSize: 13, fontWeight: 800, cursor: 'pointer',
  minWidth: 160, maxWidth: 240,
};
const cardChip = {
  padding: '3px 9px', borderRadius: 10, background: '#fff',
  fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap',
};

// 단계 chip + idle chip — 자동 모드 사이클 부속
const PhaseChip = ({ phaseInfo }) => {
  const c = PHASE_COLOR[phaseInfo.phaseKey] || '#16a34a';
  const pct = Math.round((phaseInfo.progress || 0) * 100);
  const remainSec = Math.max(0, Math.floor(phaseInfo.remaining || 0));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 10,
                  background: c + '18', border: `1.5px solid ${c}55` }}>
      <PhaseSvgIcon phaseKey={phaseInfo.phaseKey} color={c} size={14} />
      <span style={{ fontSize: 12.5, fontWeight: 800, color: c }}>{phaseInfo.short}</span>
      <span style={{ fontSize: 11.5, fontWeight: 800, color: c, opacity: 0.9 }}>{pct}%</span>
      {remainSec > 0 && (
        <span style={{ fontSize: 10.5, fontFamily: 'ui-monospace,SF Mono,monospace', fontWeight: 700, color: c, opacity: 0.7 }}>
          −{Math.floor(remainSec/60)>0?`${Math.floor(remainSec/60)}:`:''}{String(remainSec%60).padStart(2,'0')}
        </span>
      )}
    </div>
  );
};
const IdleChip = ({ text }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 10,
                background: '#f1f5f9', border: '1px solid #e2e8f0', width: 'fit-content' }}>
    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#94a3b8', animation: 'pulse 1.6s ease-in-out infinite' }} />
    <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>{text}</span>
  </div>
);

// 5단계 mini stepper — dot 5개 가로 연결
const MiniPhaseStepper = ({ phaseKey, progress }) => {
  const ORDER = ['dosing','mixing','stabilize','irrigating','cleanup'];
  const LABEL = { dosing:'도싱', mixing:'교반', stabilize:'안정', irrigating:'관수', cleanup:'정리' };
  const curIdx = ORDER.indexOf(phaseKey);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {ORDER.map((k, i) => {
        const past = curIdx > i;
        const cur = curIdx === i;
        const c = past ? '#16a34a' : cur ? (PHASE_COLOR[k] || '#16a34a') : '#cbd5e1';
        return (
          <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <span style={{
              width: cur ? 9 : 6, height: cur ? 9 : 6, borderRadius: '50%',
              background: c, transition: 'all 0.2s',
              boxShadow: cur ? `0 0 0 2px ${c}33` : 'none',
            }} title={LABEL[k]} />
            {i < 4 && <span style={{ width: 12, height: 1.5, background: past ? '#16a34a' : '#e2e8f0' }} />}
          </div>
        );
      })}
    </div>
  );
};

// ModeSegment — 모든 모드 통합 ActiveModeCard. 활성 모드 = 좌측 큰 chip, 다른 모드 = 우측 작은 버튼
const ModeSegment = ({ mode, onChange, programNum, programName, scenarios = [], onScenarioSelect, phaseInfo, autoStatus, manualStatus }) => {
  return (
    <ActiveModeCard
      mode={mode} onChange={onChange}
      autoStatus={autoStatus} manualStatus={manualStatus} phaseInfo={phaseInfo}
      scenarios={scenarios} onScenarioSelect={onScenarioSelect}
    />
  );
};

// 옛 5모드 컴팩트 모드바 (사용 안 함 — ActiveModeCard 로 대체)
const _LegacyModeBar = ({ mode, onChange, programNum, programName, scenarios = [], onScenarioSelect, phaseInfo }) => {
  const activeScenario = scenarios.find(s => s.active);
  const renderBtn = (key) => {
    const m = MODES[key];
    const active = mode === key;
    const isEmer = key === 'emergency';
    return (
      <button key={key} onClick={() => onChange(key)} title={m.label}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          padding: '6px 11px', borderRadius: 14,
          background: active ? m.bg : '#fff',
          color: active ? m.color : '#64748b',
          border: active ? `1.5px solid ${m.color}66` : '1.5px solid #e2e8f0',
          cursor: 'pointer',
          fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
          transition: 'background 0.15s, color 0.15s, border-color 0.15s',
          boxShadow: active ? `0 1px 3px ${m.color}22` : 'none',
        }}
        onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderColor = '#cbd5e1'; } }}
        onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#e2e8f0'; } }}
      >
        <span style={{
          display: 'inline-block',
          animation: isEmer && active ? 'pulse 1s infinite' : 'none',
        }}>{m.icon}</span>
        <span>{SHORT_LABEL[key]}</span>
      </button>
    );
  };

  return (
    <div role="group" aria-label="운영 모드" style={{
      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'center',
    }}>
      {renderBtn('auto')}
      <select
        value={activeScenario?.id || ''}
        onChange={(e) => onScenarioSelect && onScenarioSelect(e.target.value)}
        title={programName ? `P-${String(programNum).padStart(2, '0')} · ${programName}` : '시나리오 선택'}
        style={{
          padding: '6px 10px', borderRadius: 14,
          background: '#f1f5f9', color: '#0f172a',
          border: '1.5px solid #e2e8f0',
          fontSize: 13, fontWeight: 700, cursor: 'pointer',
          minWidth: 150, maxWidth: 220,
          opacity: scenarios.length === 0 ? 0.55 : 1,
        }}
        disabled={scenarios.length === 0}
      >
        {scenarios.length === 0 && <option value="">시나리오 없음</option>}
        {scenarios.length > 0 && !activeScenario && <option value="">시나리오 선택…</option>}
        {scenarios.map((s, i) => (
          <option key={s.id} value={s.id}>
            P-{String(i + 1).padStart(2, '0')} · {s.name}
          </option>
        ))}
      </select>
      {['manual', 'direct', 'paused'].map(renderBtn)}
    </div>
  );
};
