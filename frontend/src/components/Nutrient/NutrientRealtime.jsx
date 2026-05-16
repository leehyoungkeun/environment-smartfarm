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
// 동적 SVG 흐름도
// ─────────────────────────────────────────
const FlowDiagram = ({ data }) => {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 16, border: '1px solid #e2e8f0' }}>
      <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', marginBottom: 12 }}>
        🔄 시스템 흐름도
      </div>
      <svg viewBox="0 0 1000 240" width="100%" style={{ display: 'block' }}>
        {/* 도싱 탱크 6개 */}
        {data.tanks.map((t, i) => {
          const col = i % 3;
          const row = Math.floor(i / 3);
          const x = 20 + col * 80;
          const y = 30 + row * 90;
          const tankColor = t.dosing ? '#0891b2' : '#cbd5e1';
          return (
            <g key={t.id}>
              <rect x={x} y={y} width="64" height="60" rx="6" fill="#fff" stroke={tankColor} strokeWidth={t.dosing ? 2 : 1} />
              <rect x={x} y={y + 60 - (60 * t.level / 100)} width="64" height={60 * t.level / 100} rx="6" fill={tankColor + '40'} />
              <text x={x + 32} y={y + 28} textAnchor="middle" fontSize="14" fontWeight="800" fill="#0f172a">{t.id}</text>
              <text x={x + 32} y={y + 46} textAnchor="middle" fontSize="9" fill="#64748b">{t.level}%</text>
            </g>
          );
        })}
        {/* 화살표 1: 탱크 → 혼합 */}
        <line x1="265" y1="120" x2="335" y2="120" stroke="#94a3b8" strokeWidth="2"
              markerEnd="url(#arrow)" strokeDasharray={data.tanks.some(t => t.dosing) ? '5 5' : ''}
              style={data.tanks.some(t => t.dosing) ? { animation: 'flow-dash 1s linear infinite' } : {}} />
        {/* 혼합 탱크 */}
        <rect x="340" y="60" width="120" height="120" rx="8" fill="#f0fdfa" stroke="#14b8a6" strokeWidth="2" />
        <text x="400" y="85" textAnchor="middle" fontSize="11" fontWeight="700" fill="#0f766e">혼합 탱크</text>
        <text x="400" y="115" textAnchor="middle" fontSize="14" fontWeight="800" fill="#0f172a">EC {data.mixer.ec}</text>
        <text x="400" y="135" textAnchor="middle" fontSize="14" fontWeight="800" fill="#0f172a">pH {data.mixer.ph}</text>
        <text x="400" y="160" textAnchor="middle" fontSize="10" fill="#64748b">잔량 {data.mixer.level}%</text>
        {/* 화살표 2: 혼합 → 펌프 */}
        <line x1="465" y1="120" x2="535" y2="120" stroke="#94a3b8" strokeWidth="2"
              markerEnd="url(#arrow)" strokeDasharray={data.irrigationPump ? '5 5' : ''}
              style={data.irrigationPump ? { animation: 'flow-dash 1s linear infinite' } : {}} />
        {/* 펌프 2개 */}
        <PumpIcon x={540} y={70} label="원수" on={data.rawPump} />
        <PumpIcon x={540} y={140} label="관수" on={data.irrigationPump} />
        {/* 화살표 3: 펌프 → 밸브 */}
        <line x1="620" y1="120" x2="690" y2="120" stroke="#94a3b8" strokeWidth="2"
              markerEnd="url(#arrow)" strokeDasharray={data.activeValve ? '5 5' : ''}
              style={data.activeValve ? { animation: 'flow-dash 1s linear infinite' } : {}} />
        {/* 밸브 14개 그리드 */}
        <g transform="translate(700, 50)">
          {Array.from({ length: data.totalValves }).map((_, i) => {
            const col = i % 7;
            const row = Math.floor(i / 7);
            const valveNo = i + 1;
            const active = data.activeValve === valveNo;
            return (
              <g key={i}>
                <rect x={col * 38} y={row * 38} width="32" height="32" rx="4"
                      fill={active ? '#16a34a' : '#f1f5f9'} stroke={active ? '#15803d' : '#cbd5e1'} strokeWidth="1" />
                <text x={col * 38 + 16} y={row * 38 + 21} textAnchor="middle"
                      fontSize="11" fontWeight="700" fill={active ? '#fff' : '#475569'}>{valveNo}</text>
              </g>
            );
          })}
        </g>
        <defs>
          <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 10 3, 0 6" fill="#94a3b8" />
          </marker>
        </defs>
      </svg>
    </div>
  );
};

const PumpIcon = ({ x, y, label, on }) => (
  <g>
    <circle cx={x + 40} cy={y + 25} r="22" fill="#fff" stroke={on ? '#0891b2' : '#cbd5e1'} strokeWidth="2" />
    <text x={x + 40} y={y + 22} textAnchor="middle" fontSize="9" fontWeight="700" fill="#0f172a">{label}</text>
    <text x={x + 40} y={y + 36} textAnchor="middle" fontSize="9" fontWeight="800"
          fill={on ? '#0891b2' : '#94a3b8'}>{on ? 'ON' : 'OFF'}</text>
  </g>
);

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
