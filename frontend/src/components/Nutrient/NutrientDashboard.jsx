import { useState, useEffect } from 'react';

// mock data — Phase 2 에서 API 연동
const MOCK = {
  scenarioNo: 1,
  state: 'stopped',
  activeValve: null,
  liveSensors: { feedEC: 0, feedPH: 0, drainEC: 0, drainPH: 0 },
  pumps: { rawWater: false, irrigation: false, mixer: false, dosing: false },
  ecHistory: { target: 2, current: 0 },
  phHistory: { target: 6, current: 0 },
  todayStats: { irrigationL: 0, drainL: 0, drainRate: 0, count: 0,
                feedFlow: 0, drainFlow: 0, waterTemp: 0, do: 0 },
  pumpHours: { rawWater: 0, irrigation: 0, A: 0, B: 0, C: 0, D: 0, acid: 0, F: 0 },
};

export default function NutrientDashboard({ farmId }) {
  const [data, setData] = useState(MOCK);

  // Phase 2 에서 API + WebSocket 연동 — 지금은 mock
  useEffect(() => { setData(MOCK); }, [farmId]);

  const stateLabel = { stopped: '정지', running: '동작', paused: '일시정지', emergency: '비상정지', manual: '수동' };
  const stateColor = { stopped: '#ef4444', running: '#22c55e', paused: '#f59e0b', emergency: '#dc2626', manual: '#3b82f6' };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* 좌 — 실시간 센서 + EC/pH 추이 */}
      <div className="lg:col-span-2 space-y-4">
        <Section title="📡 실시간 센서" right={<Badge color="#0891b2">시나리오 {data.scenarioNo}번</Badge>}>
          <div className="grid grid-cols-4 gap-3">
            <SensorCircle label="급액EC" value={data.liveSensors.feedEC} unit="mS/cm" color="#0891b2" />
            <SensorCircle label="급액pH" value={data.liveSensors.feedPH} unit="pH" color="#7c3aed" />
            <SensorCircle label="배액EC" value={data.liveSensors.drainEC} unit="mS/cm" color="#06b6d4" />
            <SensorCircle label="배액pH" value={data.liveSensors.drainPH} unit="pH" color="#a855f7" />
          </div>
        </Section>

        <Section title="📈 EC / pH 추이">
          <TrendBar label="EC" target={data.ecHistory.target} current={data.ecHistory.current} unit="mS" color="#0891b2" />
          <TrendBar label="pH" target={data.phHistory.target} current={data.phHistory.current} unit="pH" color="#7c3aed" />
          <div className="flex gap-3 mt-3">
            <span style={{ padding: '4px 10px', borderRadius: 16, background: '#f1f5f9', fontSize: 12, fontWeight: 700, color: '#475569' }}>
              급-배 EC차 {(data.ecHistory.current - data.ecHistory.target).toFixed(2)}
            </span>
            <span style={{ padding: '4px 10px', borderRadius: 16, background: '#f1f5f9', fontSize: 12, fontWeight: 700, color: '#475569' }}>
              급-배 pH차 {(data.phHistory.current - data.phHistory.target).toFixed(2)}
            </span>
          </div>
        </Section>

        {/* 제어 버튼 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <ControlBtn icon="●" label="비상정지" bg="#fee2e2" color="#dc2626" border="#fca5a5" />
          <ControlBtn icon="▶" label="동작" bg="#dcfce7" color="#16a34a" border="#86efac" />
          <ControlBtn icon="✋" label="수동" bg="#fef3c7" color="#d97706" border="#fde68a" />
          <ControlBtn icon="❚❚" label="일시정지" bg="#dbeafe" color="#2563eb" border="#93c5fd" />
        </div>

        {/* 펌프별 가동시간 */}
        <Section title="⏱️ 가동시간 (오늘)">
          <div className="grid grid-cols-4 md:grid-cols-8 gap-2 text-center">
            {Object.entries(data.pumpHours).map(([key, hours]) => (
              <div key={key} style={{ padding: '8px 4px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>{labelMap[key] || key}</div>
                <div style={{ fontSize: 14, color: '#0f172a', fontWeight: 800, marginTop: 2 }}>{hours}h</div>
              </div>
            ))}
          </div>
        </Section>
      </div>

      {/* 우 — 운전 상태 + 관수 실적 */}
      <div className="space-y-4">
        <Section title="🎛️ 운전 상태">
          <div className="space-y-2">
            <StatusRow label="시나리오" value={`${data.scenarioNo}번`} />
            <StatusRow label="상태" value={
              <span style={{ padding: '2px 10px', borderRadius: 12, background: stateColor[data.state] + '20', color: stateColor[data.state], fontWeight: 800, fontSize: 12 }}>
                ● {stateLabel[data.state]}
              </span>
            } />
            <StatusRow label="밸브" value={data.activeValve ? `V${data.activeValve}` : '-'} />
            <StatusRow label="양액" value={<DotBadge on={data.pumps.dosing} />} />
            <StatusRow label="원수펌프" value={<OnOff on={data.pumps.rawWater} />} />
            <StatusRow label="관수펌프" value={<OnOff on={data.pumps.irrigation} />} />
            <StatusRow label="교반기" value={<OnOff on={data.pumps.mixer} />} />
            <StatusRow label="도징" value={<OnOff on={data.pumps.dosing} />} />
          </div>
        </Section>

        <Section title="💧 관수 실적 (오늘)">
          <div className="space-y-2">
            <StatRow label="1일 관수" value={`${data.todayStats.irrigationL} L`} />
            <StatRow label="1일 배액" value={`${data.todayStats.drainL} L`} />
            <StatRow label="배액률" value={`${data.todayStats.drainRate} %`} />
            <StatRow label="횟수" value={`${data.todayStats.count} 회`} />
            <StatRow label="급액유량" value={`${data.todayStats.feedFlow} L/h`} />
            <StatRow label="배액유량" value={`${data.todayStats.drainFlow} L/h`} />
            <StatRow label="수온" value={`${data.todayStats.waterTemp} °C`} />
            <StatRow label="DO" value={`${data.todayStats.do} mg/L`} />
          </div>
        </Section>
      </div>
    </div>
  );
}

const labelMap = { rawWater: '원수', irrigation: '관수', acid: '산' };

const Section = ({ title, right, children }) => (
  <div style={{ background: '#fff', borderRadius: 12, padding: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0' }}>
    <div className="flex items-center justify-between mb-3">
      <h3 style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', margin: 0 }}>{title}</h3>
      {right}
    </div>
    {children}
  </div>
);

const Badge = ({ color, children }) => (
  <span style={{ padding: '3px 10px', borderRadius: 12, background: color + '20', color, fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
    ● {children}
  </span>
);

const SensorCircle = ({ label, value, unit, color }) => (
  <div className="flex flex-col items-center">
    <div style={{
      width: 80, height: 80, borderRadius: '50%',
      background: `conic-gradient(${color} ${Math.min(100, value * 20)}%, #e2e8f0 0%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
    }}>
      <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>{value}</span>
        <span style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600 }}>{unit}</span>
      </div>
    </div>
    <span style={{ fontSize: 11, color: '#475569', fontWeight: 700, marginTop: 6 }}>{label}</span>
  </div>
);

const TrendBar = ({ label, target, current, unit, color }) => {
  const max = Math.max(target * 2, 1);
  const targetPct = Math.min(100, (target / max) * 100);
  const currentPct = Math.min(100, (current / max) * 100);
  return (
    <div className="mb-3 last:mb-0">
      <div className="flex justify-between mb-1">
        <span style={{ fontSize: 11, color: '#475569', fontWeight: 700 }}>{current} <span style={{ fontSize: 9, color: '#94a3b8' }}>{unit}</span></span>
        <span style={{ fontSize: 11, color: '#475569', fontWeight: 700 }}>
          설정 {target} · 배액 {current}
        </span>
      </div>
      <div style={{ height: 6, background: '#f1f5f9', borderRadius: 3, position: 'relative' }}>
        <div style={{ position: 'absolute', left: `${targetPct}%`, top: -2, width: 2, height: 10, background: '#94a3b8' }} />
        <div style={{ width: `${currentPct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.5s' }} />
      </div>
    </div>
  );
};

const ControlBtn = ({ icon, label, bg, color, border }) => (
  <button style={{
    padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${border}`,
    background: bg, color, fontSize: 13, fontWeight: 800, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    transition: 'all 0.15s',
  }} onMouseDown={e => e.currentTarget.style.transform = 'scale(0.97)'} onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}>
    <span>{icon}</span>{label}
  </button>
);

const StatusRow = ({ label, value }) => (
  <div className="flex justify-between items-center" style={{ padding: '6px 10px', background: '#f8fafc', borderRadius: 6 }}>
    <span style={{ fontSize: 12, color: '#475569', fontWeight: 600 }}>{label}</span>
    <span style={{ fontSize: 12, color: '#0f172a', fontWeight: 800 }}>{value}</span>
  </div>
);

const StatRow = ({ label, value }) => (
  <div className="flex justify-between" style={{ padding: '4px 8px', borderRadius: 6 }}>
    <span style={{ fontSize: 12, color: '#475569' }}>{label}</span>
    <span style={{ fontSize: 13, color: '#0891b2', fontWeight: 800 }}>{value}</span>
  </div>
);

const OnOff = ({ on }) => (
  <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700, background: on ? '#dcfce7' : '#f1f5f9', color: on ? '#16a34a' : '#94a3b8' }}>
    ● {on ? 'ON' : 'OFF'}
  </span>
);

const DotBadge = ({ on }) => (
  <span style={{ padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700, background: on ? '#dcfce7' : '#f1f5f9', color: on ? '#16a34a' : '#94a3b8' }}>
    ● {on ? '동작' : '정지'}
  </span>
);
