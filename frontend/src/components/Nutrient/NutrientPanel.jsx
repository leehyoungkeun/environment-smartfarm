import { useState } from 'react';
import NutrientDashboard from './NutrientDashboard';
import NutrientFlow from './NutrientFlow';
import NutrientControl from './NutrientControl';
import NutrientScenario from './NutrientScenario';
import NutrientSettings from './NutrientSettings';

const TABS = [
  { id: 'dashboard', label: '대시보드', icon: '📊' },
  { id: 'flow', label: '흐름/이력', icon: '📋' },
  { id: 'control', label: '양액제어', icon: '⚡' },
  { id: 'scenario', label: '운전시나리오', icon: '🎯' },
  { id: 'settings', label: '환경설정', icon: '🔧' },
];

export default function NutrientPanel({ farmId }) {
  const [activeTab, setActiveTab] = useState('dashboard');

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6">
      {/* 헤더 */}
      <div style={{
        background: 'linear-gradient(135deg, #0891b2 0%, #06b6d4 100%)',
        borderRadius: 16, padding: '14px 20px', marginBottom: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div className="flex items-center gap-3">
          <span style={{ fontSize: 24 }}>💧</span>
          <div>
            <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 800, margin: 0 }}>HydroControl</h2>
            <p style={{ color: '#cffafe', fontSize: 12, margin: '2px 0 0' }}>양액 자동 공급 시스템</p>
          </div>
        </div>
        <div style={{
          padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700,
          background: 'rgba(34, 197, 94, 0.2)', color: '#86efac',
          border: '1px solid rgba(134, 239, 172, 0.4)',
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', animation: 'pulse 1.5s infinite' }} />
          LIVE
        </div>
      </div>

      {/* 탭 네비게이션 */}
      <div style={{
        background: '#fff', borderRadius: 12, padding: 6,
        marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        display: 'flex', gap: 4, overflowX: 'auto',
      }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: '1 1 auto', minWidth: 100,
              padding: '10px 12px', borderRadius: 8, border: 'none',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
              background: activeTab === tab.id ? '#0891b2' : 'transparent',
              color: activeTab === tab.id ? '#fff' : '#475569',
              transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              whiteSpace: 'nowrap',
            }}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* 컨텐츠 */}
      {activeTab === 'dashboard' && <NutrientDashboard farmId={farmId} />}
      {activeTab === 'flow' && <NutrientFlow farmId={farmId} />}
      {activeTab === 'control' && <NutrientControl farmId={farmId} />}
      {activeTab === 'scenario' && <NutrientScenario farmId={farmId} />}
      {activeTab === 'settings' && <NutrientSettings farmId={farmId} />}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
