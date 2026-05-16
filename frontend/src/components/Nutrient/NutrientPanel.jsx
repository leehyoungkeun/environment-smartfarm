import { useState } from 'react';
import NutrientRealtime from './NutrientRealtime';
import NutrientScenarios from './NutrientScenarios';
import NutrientSettings from './NutrientSettings';

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

export default function NutrientPanel({ farmId }) {
  const [activeTab, setActiveTab] = useState('realtime');
  const [mode, setMode] = useState('paused'); // Phase 2 에서 API 연동
  const [alerts] = useState([]); // sticky 경보 배너 (Phase 2)

  const modeInfo = MODES[mode];

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6">
      {/* 경보 sticky 배너 */}
      {alerts.length > 0 && (
        <div style={{
          background: '#fee2e2', border: '1px solid #fca5a5', borderRadius: 10,
          padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: '#991b1b' }}>{alerts[0].message}</span>
        </div>
      )}

      {/* 헤더 — 브랜드 + 모드 셀렉터 */}
      <div style={{
        background: 'linear-gradient(135deg, #0891b2 0%, #06b6d4 100%)',
        borderRadius: 16, padding: '14px 20px', marginBottom: 12,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
      }}>
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 24 }}>💧</span>
          <div>
            <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 800, margin: 0 }}>HydroControl</h2>
            <p style={{ color: '#cffafe', fontSize: 11, margin: '2px 0 0' }}>양액 자동 공급 시스템</p>
          </div>
        </div>
        <ModeSelector mode={mode} onChange={setMode} info={modeInfo} />
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
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
              background: activeTab === tab.id ? '#0891b2' : 'transparent',
              color: activeTab === tab.id ? '#fff' : '#475569',
              transition: 'all 0.2s',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            }}
          >
            <span style={{ fontSize: 16 }}>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* 컨텐츠 */}
      {activeTab === 'realtime' && <NutrientRealtime farmId={farmId} mode={mode} onModeChange={setMode} />}
      {activeTab === 'scenarios' && <NutrientScenarios farmId={farmId} />}
      {activeTab === 'settings' && <NutrientSettings farmId={farmId} />}

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes flow-dash { to { stroke-dashoffset: -20; } }
      `}</style>
    </div>
  );
}

const ModeSelector = ({ mode, onChange, info }) => {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: info.bg, color: info.color, border: 'none',
          padding: '8px 16px', borderRadius: 24, fontSize: 13, fontWeight: 800, cursor: 'pointer',
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
                fontSize: 13, fontWeight: 700, color: m.color, cursor: 'pointer',
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
