import { useEffect, useRef, useState } from 'react';
import NutrientRealtime from './NutrientRealtime';
import NutrientScenarios from './NutrientScenarios';
import NutrientSettings from './NutrientSettings';
import * as nutrientApi from '../../services/nutrientApi';

const TABS = [
  { id: 'realtime', label: '실시간', icon: '📊', desc: '운영·제어·흐름' },
  { id: 'scenarios', label: '시나리오', icon: '🎯', desc: '레시피 편집' },
  { id: 'settings', label: '설정', icon: '🔧', desc: '하드웨어·경보' },
];

const MODES = {
  auto:      { label: '자동운행', color: '#16a34a', bg: '#dcfce7', icon: '▶' },
  manual:    { label: '수동',     color: '#d97706', bg: '#fef3c7', icon: '✋' },
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
  const [alerts] = useState([]); // sticky 경보 배너 (Phase 3 RPi telemetry 연동 후 활성)
  const [env] = useState(MOCK_ENV);

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
  // confirm 다이얼로그는 여기 단일 위치 — Panel ModeSelector + Realtime ModeSegment 양쪽 모두 적용.
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

  const modeInfo = MODES[mode];
  const tempDiff = env.outTemp - env.inTemp;
  const tempDiffWarn = Math.abs(tempDiff) > 5;
  const rainWarn = env.rainfall > 0;
  const windWarn = env.windSpeed > 5;

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6">
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
        borderRadius: 16, padding: '14px 20px', marginBottom: 8,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
      }}>
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 24 }}>💧</span>
          <div>
            <h2 style={{ color: '#fff', fontSize: 20, fontWeight: 800, margin: 0 }}>HydroControl</h2>
            <p style={{ color: '#cffafe', fontSize: 13, margin: '2px 0 0' }}>양액 자동 공급 시스템</p>
          </div>
        </div>
        <ModeSelector mode={mode} onChange={handleModeChange} info={modeInfo} />
      </div>

      {/* 외부 환경 row — 양액 자동화의 핵심 트리거 데이터
          ⚠️ 현재 MOCK_ENV 고정값. 실 sensor API 연결은 Phase 2 작업 (todo) */}
      <div style={{
        background: '#fff', borderRadius: 12, padding: '8px 12px',
        marginBottom: 12, border: '1px solid #fbbf24',
        display: 'flex', alignItems: 'center', gap: 8, overflowX: 'auto',
        position: 'relative',
      }}>
        <span style={{
          position: 'absolute', top: -8, left: 12,
          padding: '1px 8px', borderRadius: 8,
          background: '#fef3c7', color: '#92400e',
          fontSize: 10, fontWeight: 800, letterSpacing: '0.05em',
          border: '1px solid #fbbf24',
        }}>DEMO · 실 sensor 미연결</span>
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

      {/* 탭 네비게이션 */}
      <div style={{
        background: '#fff', borderRadius: 12, padding: 4,
        marginBottom: 12, boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        display: 'flex', gap: 4, border: '1px solid #e2e8f0',
      }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: 1, padding: '10px 8px', borderRadius: 8, border: 'none',
              fontSize: 15, fontWeight: 700, cursor: 'pointer',
              background: activeTab === tab.id ? '#0891b2' : 'transparent',
              color: activeTab === tab.id ? '#fff' : '#475569',
              transition: 'all 0.2s',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            }}
          >
            <span style={{ fontSize: 18 }}>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* 컨텐츠 */}
      {activeTab === 'realtime' && <NutrientRealtime farmId={farmId} mode={mode} onModeChange={handleModeChange} />}
      {activeTab === 'scenarios' && <NutrientScenarios farmId={farmId} />}
      {activeTab === 'settings' && <NutrientSettings farmId={farmId} />}

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes flow-dash { to { stroke-dashoffset: -20; } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes wave { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(-3px); } }

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

const ModeSelector = ({ mode, onChange, info }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: info.bg, color: info.color, border: 'none',
          padding: '8px 16px', borderRadius: 24, fontSize: 15, fontWeight: 800, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 8,
          boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
        }}>
        <span style={{ animation: mode === 'emergency' ? 'pulse 1s infinite' : 'none' }}>{info.icon}</span>
        {info.label} ▾
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '110%', right: 0, zIndex: 50,
          background: '#fff', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          padding: 4, minWidth: 160,
        }}>
          {Object.entries(MODES).map(([key, m]) => (
            <button
              key={key}
              onClick={() => { onChange(key); setOpen(false); }}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 6, border: 'none',
                background: key === mode ? '#f1f5f9' : 'transparent',
                fontSize: 15, fontWeight: 700, color: m.color, cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left',
              }}>
              <span>{m.icon}</span>{m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
