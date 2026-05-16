import { useState, useEffect } from 'react';

// Phase 2 에서 API/WebSocket 연동 — 지금은 mock
const MOCK = {
  scenarioNo: 1, scenarioName: '생장기',
  liveSensors: { feedEC: 1.8, feedPH: 5.9, drainEC: 1.7, drainPH: 6.1 },
  targets: { ec: 2.0, ph: 6.0 },
  ecHistory: [1.5, 1.7, 1.8, 1.9, 1.8, 1.7, 1.8, 1.9, 2.0, 1.9, 1.8, 1.8],
  phHistory: [5.8, 5.9, 6.0, 5.9, 5.8, 5.9, 6.0, 6.1, 6.0, 5.9, 5.9, 5.9],
  flow: {
    tanks: [
      { id: 'A', label: '질소·칼슘', level: 80, dosing: false },
      { id: 'B', label: '인·칼륨·마그', level: 75, dosing: false },
      { id: 'C', label: '미량원소', level: 65, dosing: false },
      { id: 'D', label: '보조영양', level: 50, dosing: false },
      { id: '산', label: 'pH 하강', level: 90, dosing: false },
      { id: 'F', label: '알칼리', level: 85, dosing: false },
    ],
    mixer: { ec: 1.8, ph: 5.9, level: 65 },
    rawPump: false, irrigationPump: false,
    activeValve: null,
    totalValves: 14,
  },
  todayStats: { irrigationL: 0, drainL: 0, drainRate: 0, count: 0,
                feedFlow: 0, drainFlow: 0, waterTemp: 20.5, do: 7.2 },
  pumpHours: { rawWater: 0, irrigation: 0, A: 0, B: 0, C: 0, D: 0, acid: 0, F: 0 },
};

export default function NutrientRealtime({ farmId, mode, onModeChange }) {
  const [data, setData] = useState(MOCK);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => { setData(MOCK); }, [farmId]);

  return (
    <div className="space-y-3">
      {/* 시나리오 정보 */}
      <div style={{
        background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: 10,
        padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: 13, color: '#0f766e', fontWeight: 700 }}>
          현재 시나리오: <strong>{data.scenarioNo}번 - {data.scenarioName}</strong>
        </span>
        {data.flow.activeValve && (
          <span style={{
            padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 800,
            background: '#16a34a', color: '#fff',
          }}>● V{data.flow.activeValve} 관수 중</span>
        )}
      </div>

      {/* EC + pH 큰 게이지 + sparkline */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <BigGauge
          label="EC (전기전도도)" unit="mS/cm" color="#0891b2"
          current={data.liveSensors.feedEC} target={data.targets.ec}
          history={data.ecHistory} max={4}
        />
        <BigGauge
          label="pH (산도)" unit="" color="#7c3aed"
          current={data.liveSensors.feedPH} target={data.targets.ph}
          history={data.phHistory} max={10}
        />
      </div>

      {/* 동적 SVG 흐름도 */}
      <FlowDiagram data={data.flow} />

      {/* 제어 버튼 */}
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => onModeChange('paused')} style={btnStyle('#dbeafe', '#2563eb', '#93c5fd')}>
          ❚❚ 일시정지
        </button>
        <button onClick={() => onModeChange('emergency')} style={btnStyle('#fee2e2', '#dc2626', '#fca5a5')}>
          ● 비상정지
        </button>
      </div>

      {/* 상세 정보 collapsible */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <button
          onClick={() => setDetailsOpen(o => !o)}
          style={{
            width: '100%', padding: '12px 16px', border: 'none', cursor: 'pointer',
            background: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontSize: 13, fontWeight: 700, color: '#475569',
          }}>
          <span>📋 상세 정보 (운전 상태 · 관수 실적 · 가동시간)</span>
          <span style={{ transition: 'transform 0.2s', transform: detailsOpen ? 'rotate(180deg)' : '' }}>▾</span>
        </button>
        {detailsOpen && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border-t" style={{ borderColor: '#e2e8f0' }}>
            <DetailGrid title="🎛️ 운전 상태" items={[
              { label: '원수펌프', value: <OnOff on={data.flow.rawPump} /> },
              { label: '관수펌프', value: <OnOff on={data.flow.irrigationPump} /> },
              { label: '교반기', value: <OnOff on={false} /> },
              { label: '도징', value: <OnOff on={false} /> },
            ]} />
            <DetailGrid title="💧 관수 실적 (오늘)" items={[
              { label: '1일 관수', value: `${data.todayStats.irrigationL} L` },
              { label: '1일 배액', value: `${data.todayStats.drainL} L` },
              { label: '배액률', value: `${data.todayStats.drainRate} %` },
              { label: '횟수', value: `${data.todayStats.count} 회` },
              { label: '수온', value: `${data.todayStats.waterTemp} °C` },
              { label: 'DO', value: `${data.todayStats.do} mg/L` },
            ]} />
            <DetailGrid title="⏱️ 가동시간 (오늘)" items={Object.entries(data.pumpHours).map(([k, v]) => ({
              label: labelMap[k] || k, value: `${v} h`,
            }))} />
          </div>
        )}
      </div>
    </div>
  );
}

const labelMap = { rawWater: '원수', irrigation: '관수', acid: '산' };

const btnStyle = (bg, color, border) => ({
  padding: '12px 16px', borderRadius: 10, border: `1.5px solid ${border}`,
  background: bg, color, fontSize: 14, fontWeight: 800, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
});

// ─────────────────────────────────────────
// 큰 게이지 + sparkline 컴포넌트
// ─────────────────────────────────────────
const BigGauge = ({ label, unit, color, current, target, history, max }) => {
  const pct = Math.min(100, (current / max) * 100);
  const diff = current - target;
  const diffColor = Math.abs(diff) < 0.1 ? '#16a34a' : Math.abs(diff) < 0.5 ? '#d97706' : '#dc2626';

  // sparkline path
  const W = 200, H = 40;
  const minH = Math.min(...history, target * 0.7);
  const maxH = Math.max(...history, target * 1.3);
  const range = maxH - minH || 1;
  const points = history.map((v, i) => {
    const x = (i / (history.length - 1)) * W;
    const y = H - ((v - minH) / range) * H;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  return (
    <div style={{
      background: '#fff', borderRadius: 12, padding: 16, border: '1px solid #e2e8f0',
    }}>
      <div className="flex justify-between items-center mb-2">
        <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>{label}</span>
        <span style={{ fontSize: 10, color: '#94a3b8' }}>목표 {target} {unit}</span>
      </div>
      <div className="flex items-end gap-3">
        <div style={{ fontSize: 36, fontWeight: 900, color, lineHeight: 1 }}>
          {current.toFixed(1)}
          <span style={{ fontSize: 14, color: '#64748b', fontWeight: 600, marginLeft: 4 }}>{unit}</span>
        </div>
        <div style={{
          padding: '3px 8px', borderRadius: 10, background: diffColor + '20',
          fontSize: 11, fontWeight: 800, color: diffColor, marginBottom: 4,
        }}>
          {diff >= 0 ? '+' : ''}{diff.toFixed(2)}
        </div>
      </div>
      {/* 진행 바 */}
      <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3, marginTop: 8, position: 'relative' }}>
        <div style={{ position: 'absolute', left: `${(target/max)*100}%`, top: -2, width: 2, height: 10, background: '#94a3b8' }} title="목표" />
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.5s' }} />
      </div>
      {/* sparkline */}
      <svg width="100%" height={H + 4} viewBox={`0 0 ${W} ${H + 4}`} style={{ marginTop: 8 }}>
        <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="0" y1={H - ((target - minH) / range) * H} x2={W} y2={H - ((target - minH) / range) * H}
              stroke="#94a3b8" strokeWidth="0.5" strokeDasharray="2 2" />
      </svg>
      <div style={{ fontSize: 9, color: '#94a3b8', textAlign: 'right' }}>최근 1시간</div>
    </div>
  );
};

// ─────────────────────────────────────────
// 시스템 흐름도 — 최신 스타일 (liquid + flow particles + glassmorphism)
// ─────────────────────────────────────────
const FlowDiagram = ({ data }) => {
  const anyDosing = data.tanks.some(t => t.dosing);
  return (
    <div style={{
      background: 'linear-gradient(135deg, #f0f9ff 0%, #ecfeff 50%, #f0fdfa 100%)',
      borderRadius: 16, padding: '16px 20px',
      border: '1px solid #cffafe',
      boxShadow: '0 4px 24px -8px rgba(8, 145, 178, 0.15)',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* 배경 grid pattern */}
      <svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0, opacity: 0.4, pointerEvents: 'none' }}>
        <defs>
          <pattern id="dotGrid" width="20" height="20" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="0.6" fill="#06b6d4" opacity="0.3" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dotGrid)" />
      </svg>

      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 26, height: 26, borderRadius: 8, background: 'linear-gradient(135deg, #06b6d4, #0891b2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#fff',
            boxShadow: '0 2px 8px rgba(6, 182, 212, 0.4)',
          }}>🔄</span>
          시스템 흐름도
        </div>
        <span style={{
          padding: '4px 10px', borderRadius: 10, fontSize: 10, fontWeight: 800,
          background: anyDosing || data.irrigationPump || data.rawPump ? '#dcfce7' : '#f1f5f9',
          color: anyDosing || data.irrigationPump || data.rawPump ? '#15803d' : '#94a3b8',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%',
            background: anyDosing || data.irrigationPump || data.rawPump ? '#22c55e' : '#cbd5e1',
            animation: anyDosing || data.irrigationPump || data.rawPump ? 'pulse 1.5s infinite' : 'none',
          }} />
          {anyDosing || data.irrigationPump || data.rawPump ? 'RUNNING' : 'IDLE'}
        </span>
      </div>

      {/* 그리드 레이아웃 — 데스크탑 4단, 모바일 세로 */}
      <div style={{ position: 'relative', display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) 36px minmax(0, 1.1fr) 36px minmax(0, 0.5fr) 36px minmax(0, 1.4fr)',
        alignItems: 'center', gap: 4,
      }}>
        {/* 1. 도싱 탱크 6개 */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6,
          padding: 8, background: 'rgba(255,255,255,0.6)', borderRadius: 12,
          backdropFilter: 'blur(8px)', border: '1px solid rgba(186, 230, 253, 0.5)',
        }}>
          {data.tanks.map(t => <TankCard key={t.id} tank={t} />)}
        </div>

        {/* 화살표 1: 탱크 → 혼합 */}
        <FlowArrow active={anyDosing} />

        {/* 2. 혼합 탱크 — 중앙 강조 */}
        <MixerNode mixer={data.mixer} />

        {/* 화살표 2: 혼합 → 펌프 */}
        <FlowArrow active={data.irrigationPump || data.rawPump} />

        {/* 3. 펌프 2개 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <PumpNode label="원수" on={data.rawPump} color="#3b82f6" />
          <PumpNode label="관수" on={data.irrigationPump} color="#0891b2" />
        </div>

        {/* 화살표 3: 펌프 → 밸브 */}
        <FlowArrow active={!!data.activeValve} />

        {/* 4. 밸브 그리드 */}
        <ValveGrid count={data.totalValves} active={data.activeValve} />
      </div>
    </div>
  );
};

// 도싱 탱크 카드 — liquid fill animation
const TankCard = ({ tank }) => {
  const active = tank.dosing;
  const fillH = Math.max(0, Math.min(100, tank.level));
  return (
    <div style={{
      position: 'relative', padding: 8, borderRadius: 10,
      background: active
        ? 'linear-gradient(180deg, rgba(6, 182, 212, 0.1), rgba(6, 182, 212, 0.25))'
        : 'rgba(255,255,255,0.85)',
      border: `1.5px solid ${active ? '#06b6d4' : '#e2e8f0'}`,
      boxShadow: active ? '0 0 16px rgba(6, 182, 212, 0.5), inset 0 0 8px rgba(6, 182, 212, 0.1)' : '0 1px 3px rgba(0,0,0,0.04)',
      overflow: 'hidden',
      transition: 'all 0.3s',
    }}>
      {/* 액체 fill — 곡선 wave */}
      <svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }} preserveAspectRatio="none" viewBox="0 0 100 100">
        <defs>
          <linearGradient id={`liquid-${tank.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={active ? '#22d3ee' : '#cbd5e1'} stopOpacity="0.6" />
            <stop offset="100%" stopColor={active ? '#0891b2' : '#94a3b8'} stopOpacity="0.4" />
          </linearGradient>
        </defs>
        <path
          d={`M0 ${100 - fillH} Q25 ${100 - fillH - 3} 50 ${100 - fillH} T100 ${100 - fillH} L100 100 L0 100 Z`}
          fill={`url(#liquid-${tank.id})`}
          style={{ animation: active ? 'wave 2s ease-in-out infinite' : 'none' }}
        />
      </svg>
      <div style={{ position: 'relative', textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 900, color: active ? '#0e7490' : '#0f172a', lineHeight: 1 }}>
          {tank.id}
        </div>
        <div style={{ fontSize: 10, fontWeight: 800, color: active ? '#06b6d4' : '#64748b', marginTop: 2 }}>
          {tank.level}%
        </div>
      </div>
    </div>
  );
};

// 흐름 화살표 — 점들이 흐르는 효과
const FlowArrow = ({ active }) => (
  <svg viewBox="0 0 36 8" width="36" height="20" preserveAspectRatio="none" style={{ overflow: 'visible' }}>
    <line x1="0" y1="4" x2="36" y2="4" stroke={active ? '#06b6d4' : '#cbd5e1'} strokeWidth="1.5" />
    <polygon points="30,1 36,4 30,7" fill={active ? '#06b6d4' : '#cbd5e1'} />
    {active && (
      <>
        <circle cx="0" cy="4" r="1.8" fill="#06b6d4">
          <animateMotion path="M 0 0 L 30 0" dur="1.2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;1;1;0" dur="1.2s" repeatCount="indefinite" />
        </circle>
        <circle cx="0" cy="4" r="1.8" fill="#06b6d4">
          <animateMotion path="M 0 0 L 30 0" dur="1.2s" begin="0.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;1;1;0" dur="1.2s" begin="0.4s" repeatCount="indefinite" />
        </circle>
        <circle cx="0" cy="4" r="1.8" fill="#06b6d4">
          <animateMotion path="M 0 0 L 30 0" dur="1.2s" begin="0.8s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;1;1;0" dur="1.2s" begin="0.8s" repeatCount="indefinite" />
        </circle>
      </>
    )}
  </svg>
);

// 혼합 탱크 노드 — 큰 원형 카드 + 디지털 디스플레이
const MixerNode = ({ mixer }) => (
  <div style={{
    position: 'relative', padding: '16px 14px', borderRadius: 16,
    background: 'linear-gradient(135deg, #ffffff, #f0fdfa)',
    border: '2px solid #14b8a6',
    boxShadow: '0 8px 32px -8px rgba(20, 184, 166, 0.4), inset 0 1px 0 rgba(255,255,255,0.8)',
    textAlign: 'center',
  }}>
    {/* level liquid bg */}
    <div style={{
      position: 'absolute', bottom: 0, left: 0, right: 0,
      height: `${mixer.level}%`,
      background: 'linear-gradient(180deg, rgba(20, 184, 166, 0.1), rgba(20, 184, 166, 0.2))',
      borderRadius: '0 0 14px 14px',
      transition: 'height 0.5s',
    }} />
    <div style={{ position: 'relative' }}>
      <div style={{
        fontSize: 10, fontWeight: 800, color: '#0f766e',
        background: '#ccfbf1', padding: '2px 8px', borderRadius: 8,
        display: 'inline-block', marginBottom: 8,
      }}>혼합 탱크</div>
      <div style={{ display: 'flex', justifyContent: 'space-around', gap: 8 }}>
        <div>
          <div style={{ fontSize: 9, color: '#64748b', fontWeight: 700 }}>EC</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: '#0891b2', lineHeight: 1, fontFamily: 'monospace' }}>{mixer.ec}</div>
        </div>
        <div style={{ width: 1, background: '#cbd5e1' }} />
        <div>
          <div style={{ fontSize: 9, color: '#64748b', fontWeight: 700 }}>pH</div>
          <div style={{ fontSize: 18, fontWeight: 900, color: '#7c3aed', lineHeight: 1, fontFamily: 'monospace' }}>{mixer.ph}</div>
        </div>
      </div>
      <div style={{ marginTop: 8, fontSize: 9, color: '#64748b' }}>
        <span style={{ fontWeight: 700 }}>잔량</span> {mixer.level}%
      </div>
    </div>
  </div>
);

// 펌프 노드 — 회전 모터 애니메이션
const PumpNode = ({ label, on, color }) => (
  <div style={{
    padding: '8px 4px', borderRadius: 12,
    background: on ? `linear-gradient(135deg, ${color}15, ${color}25)` : '#fff',
    border: `1.5px solid ${on ? color : '#e2e8f0'}`,
    boxShadow: on ? `0 0 20px ${color}40` : '0 1px 3px rgba(0,0,0,0.04)',
    display: 'flex', alignItems: 'center', gap: 8,
    transition: 'all 0.3s',
  }}>
    <div style={{
      width: 32, height: 32, borderRadius: '50%',
      background: on ? `linear-gradient(135deg, ${color}, ${color}cc)` : '#f1f5f9',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: on ? 'spin 1.5s linear infinite' : 'none',
      flexShrink: 0,
    }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="3" fill={on ? '#fff' : '#94a3b8'} />
        <path d="M12 2 L12 7 M12 17 L12 22 M2 12 L7 12 M17 12 L22 12" stroke={on ? '#fff' : '#94a3b8'} strokeWidth="2" strokeLinecap="round" />
      </svg>
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: '#0f172a' }}>{label}</div>
      <div style={{ fontSize: 9, fontWeight: 800, color: on ? color : '#94a3b8', marginTop: 2 }}>
        {on ? '● ON' : '○ OFF'}
      </div>
    </div>
  </div>
);

// 밸브 그리드 — 활성 valve 는 droplet animation
const ValveGrid = ({ count, active }) => {
  const cols = count <= 12 ? 7 : 8;
  return (
    <div style={{
      padding: 8, borderRadius: 12,
      background: 'rgba(255,255,255,0.6)',
      backdropFilter: 'blur(8px)',
      border: '1px solid rgba(186, 230, 253, 0.5)',
    }}>
      <div style={{
        display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 4,
      }}>
        {Array.from({ length: count }).map((_, i) => {
          const no = i + 1;
          const isActive = active === no;
          return (
            <div key={i} style={{
              position: 'relative',
              padding: '6px 0', borderRadius: 8,
              background: isActive
                ? 'linear-gradient(135deg, #22c55e, #15803d)'
                : 'rgba(255,255,255,0.85)',
              border: `1px solid ${isActive ? '#15803d' : '#e2e8f0'}`,
              boxShadow: isActive ? '0 0 16px rgba(34, 197, 94, 0.5)' : 'none',
              textAlign: 'center',
              fontSize: 11, fontWeight: 800,
              color: isActive ? '#fff' : '#475569',
              transition: 'all 0.3s',
              overflow: 'hidden',
            }}>
              {no}
              {isActive && (
                <svg width="100%" height="6" style={{ position: 'absolute', bottom: -1, left: 0 }} preserveAspectRatio="none">
                  <circle cx="50%" cy="3" r="1.5" fill="#fff">
                    <animate attributeName="cy" values="-2;8" dur="1s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="1;0" dur="1s" repeatCount="indefinite" />
                  </circle>
                </svg>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const DetailGrid = ({ title, items }) => (
  <div>
    <div style={{ fontSize: 11, fontWeight: 800, color: '#475569', marginBottom: 6 }}>{title}</div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map((it, i) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: '#f8fafc', borderRadius: 6, fontSize: 11 }}>
          <span style={{ color: '#64748b' }}>{it.label}</span>
          <span style={{ color: '#0f172a', fontWeight: 700 }}>{it.value}</span>
        </div>
      ))}
    </div>
  </div>
);

const OnOff = ({ on }) => (
  <span style={{ padding: '1px 6px', borderRadius: 8, fontSize: 9, fontWeight: 800,
    background: on ? '#dcfce7' : '#f1f5f9', color: on ? '#16a34a' : '#94a3b8' }}>
    ● {on ? 'ON' : 'OFF'}
  </span>
);
