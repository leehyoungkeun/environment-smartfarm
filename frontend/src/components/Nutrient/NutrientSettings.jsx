import { useState } from 'react';

const MOCK_TANKS = [
  { id: 'A', label: '질소·칼슘', level: 80, capacity: 200, modbusReg: 0 },
  { id: 'B', label: '인·칼륨·마그', level: 75, capacity: 200, modbusReg: 1 },
  { id: 'C', label: '미량원소', level: 65, capacity: 100, modbusReg: 2 },
  { id: 'D', label: '보조영양', level: 50, capacity: 100, modbusReg: 3 },
  { id: '산', label: 'pH 하강', level: 90, capacity: 50, modbusReg: 4 },
  { id: 'F', label: '알칼리 (pH 상승)', level: 85, capacity: 50, modbusReg: 5 },
];

const MOCK_ALERTS = {
  ecUpper: 4.0, ecLower: 0.2, ecCritical: 0.1,
  phUpper: 8.0, phLower: 4.5, phCritical: 6.5,
};

const MOCK_HW = {
  modbusUnit: 3, ecSensorAddr: 100, phSensorAddr: 101, flowSensorAddr: 102,
  pumpResponse: 50, // ms
  dosingPulseUnit: 500, // mL/pulse 등
};

export default function NutrientSettings({ farmId }) {
  const [open, setOpen] = useState({ tanks: true, valves: false, alerts: false, hw: false });
  const toggle = (k) => setOpen(o => ({ ...o, [k]: !o[k] }));

  return (
    <div className="space-y-2">
      {/* 1. 도싱 탱크 */}
      <Section title="💧 도싱 탱크" subtitle={`${MOCK_TANKS.length}개 사용 · 최대 10개`}
               open={open.tanks} onToggle={() => toggle('tanks')}>
        <TanksEditor />
      </Section>

      {/* 2. 관수 밸브 */}
      <Section title="🚿 관수 밸브" subtitle="14구역 · 최대 24개"
               open={open.valves} onToggle={() => toggle('valves')}>
        <ValvesEditor />
      </Section>

      {/* 3. 경보 한계값 */}
      <Section title="⚠️ 경보 한계값" subtitle="EC · pH 3단계 (작동중단 / 경보 / 정상)"
               open={open.alerts} onToggle={() => toggle('alerts')}>
        <AlertsEditor />
      </Section>

      {/* 4. 하드웨어·설비 */}
      <Section title="🛠️ 설비·시스템" subtitle="Modbus 매핑 · 펌프 응답 · 센서 보정"
               open={open.hw} onToggle={() => toggle('hw')}>
        <HardwareEditor />
      </Section>
    </div>
  );
}

const Section = ({ title, subtitle, open, onToggle, children }) => (
  <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
    <button onClick={onToggle} style={{
      width: '100%', padding: '12px 16px', border: 'none', cursor: 'pointer',
      background: open ? '#f8fafc' : '#fff',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left',
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>{title}</div>
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{subtitle}</div>
      </div>
      <span style={{ fontSize: 14, color: '#94a3b8', transition: 'transform 0.2s',
                     transform: open ? 'rotate(180deg)' : '' }}>▾</span>
    </button>
    {open && (
      <div style={{ padding: 16, borderTop: '1px solid #e2e8f0' }}>{children}</div>
    )}
  </div>
);

// ─────────────────────────────────────────
// 도싱 탱크 편집
// ─────────────────────────────────────────
const TanksEditor = () => {
  const [tanks, setTanks] = useState(MOCK_TANKS);
  const updateTank = (i, updates) => setTanks(prev => prev.map((t, idx) => idx === i ? { ...t, ...updates } : t));
  const addTank = () => {
    if (tanks.length >= 10) return alert('최대 10개');
    setTanks(prev => [...prev, { id: `T${prev.length+1}`, label: '신규', level: 100, capacity: 100, modbusReg: prev.length }]);
  };
  const removeTank = (i) => setTanks(prev => prev.filter((_, idx) => idx !== i));

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
        {tanks.map((t, i) => (
          <div key={i} style={{ padding: 10, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
            <div className="flex justify-between items-start mb-2">
              <div className="flex items-center gap-2">
                <span style={{
                  width: 32, height: 32, borderRadius: 8, background: '#0891b2', color: '#fff',
                  fontSize: 13, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{t.id}</span>
                <input value={t.label} onChange={(e) => updateTank(i, { label: e.target.value })}
                       style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', border: 'none', background: 'transparent', outline: 'none', flex: 1 }} />
              </div>
              <button onClick={() => removeTank(i)} style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <div style={{ color: '#64748b', marginBottom: 2 }}>잔량</div>
                <div style={{ height: 6, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${t.level}%`, height: '100%', background: t.level > 30 ? '#16a34a' : '#dc2626' }} />
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>{t.level}%</div>
              </div>
              <div>
                <div style={{ color: '#64748b', marginBottom: 2 }}>용량</div>
                <input type="number" value={t.capacity} onChange={(e) => updateTank(i, { capacity: parseInt(e.target.value) || 0 })}
                       style={{ width: '100%', padding: '3px 6px', fontSize: 11, fontWeight: 700, border: '1px solid #cbd5e1', borderRadius: 4 }} />
                <div style={{ fontSize: 9, color: '#94a3b8', textAlign: 'right' }}>L</div>
              </div>
              <div>
                <div style={{ color: '#64748b', marginBottom: 2 }}>Modbus</div>
                <input type="number" value={t.modbusReg} onChange={(e) => updateTank(i, { modbusReg: parseInt(e.target.value) || 0 })}
                       style={{ width: '100%', padding: '3px 6px', fontSize: 11, fontWeight: 700, border: '1px solid #cbd5e1', borderRadius: 4 }} />
                <div style={{ fontSize: 9, color: '#94a3b8', textAlign: 'right' }}>주소</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <button onClick={addTank} disabled={tanks.length >= 10} style={{
        width: '100%', padding: 10, borderRadius: 8, border: '2px dashed ' + (tanks.length >= 10 ? '#cbd5e1' : '#0891b2'),
        background: '#fff', color: tanks.length >= 10 ? '#94a3b8' : '#0891b2',
        fontSize: 12, fontWeight: 700, cursor: tanks.length >= 10 ? 'not-allowed' : 'pointer',
      }}>+ 탱크 추가</button>
      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8, padding: 8, background: '#fef3c7', borderRadius: 6 }}>
        💡 한국형 A/B 액: 3-6개 · 단비혼합: 7-8개 · 네덜란드 풀스펙: 9-10개
      </div>
    </div>
  );
};

// ─────────────────────────────────────────
// 관수 밸브 편집
// ─────────────────────────────────────────
const ValvesEditor = () => {
  const [count, setCount] = useState(14);
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <span style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>밸브 수:</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setCount(c => Math.max(1, c - 1))}
                  style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 800 }}>−</button>
          <input type="number" value={count} onChange={(e) => setCount(Math.max(1, Math.min(24, parseInt(e.target.value) || 1)))}
                 style={{ width: 60, padding: '4px 8px', fontSize: 14, fontWeight: 800, textAlign: 'center',
                          border: '1px solid #cbd5e1', borderRadius: 6, color: '#0891b2' }} />
          <button onClick={() => setCount(c => Math.min(24, c + 1))}
                  style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 800 }}>+</button>
        </div>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>(1~24)</span>
      </div>
      <div className="grid grid-cols-6 md:grid-cols-12 gap-2">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} style={{
            padding: '8px 4px', background: '#f0fdf4', borderRadius: 6,
            border: '1px solid #86efac', textAlign: 'center',
            fontSize: 12, fontWeight: 800, color: '#15803d',
          }}>{i + 1}</div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8, padding: 8, background: '#fef3c7', borderRadius: 6 }}>
        💡 소규모 4-8 · 중규모 10-16 · 대규모 18-24 구역
      </div>
    </div>
  );
};

// ─────────────────────────────────────────
// 경보 한계값 편집 + 시각화
// ─────────────────────────────────────────
const AlertsEditor = () => {
  const [a, setA] = useState(MOCK_ALERTS);
  const currentEC = 1.8; // mock

  return (
    <div className="space-y-4">
      {/* EC 범위 시각화 */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
          📊 EC 범위 (현재: <strong style={{ color: '#0891b2' }}>{currentEC} mS/cm</strong>)
        </div>
        <ECRangeBar critical={a.ecCritical} lower={a.ecLower} upper={a.ecUpper} current={currentEC} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* EC */}
        <div style={{ padding: 12, background: '#f0f9ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#1e40af', marginBottom: 8 }}>EC 한계 (mS/cm)</div>
          <ThresholdRow level="🔴 경보 상한" desc="초과 시 경보 발생" value={a.ecUpper} step={0.1}
                        onChange={(v) => setA({ ...a, ecUpper: v })} color="#dc2626" />
          <ThresholdRow level="🟡 경보 하한" desc="미달 시 경보 발생" value={a.ecLower} step={0.1}
                        onChange={(v) => setA({ ...a, ecLower: v })} color="#d97706" />
          <ThresholdRow level="🛑 작동 중단" desc="미달 시 제어 정지" value={a.ecCritical} step={0.1}
                        onChange={(v) => setA({ ...a, ecCritical: v })} color="#991b1b" />
        </div>
        {/* pH */}
        <div style={{ padding: 12, background: '#faf5ff', borderRadius: 8, border: '1px solid #d8b4fe' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#7c3aed', marginBottom: 8 }}>pH 한계</div>
          <ThresholdRow level="🔴 경보 상한" desc="초과 시 경보" value={a.phUpper} step={0.1}
                        onChange={(v) => setA({ ...a, phUpper: v })} color="#dc2626" />
          <ThresholdRow level="🟡 경보 하한" desc="미달 시 경보" value={a.phLower} step={0.1}
                        onChange={(v) => setA({ ...a, phLower: v })} color="#d97706" />
          <ThresholdRow level="🛑 작동 중단" desc="미달 시 제어 정지" value={a.phCritical} step={0.1}
                        onChange={(v) => setA({ ...a, phCritical: v })} color="#991b1b" />
        </div>
      </div>
    </div>
  );
};

const ECRangeBar = ({ critical, lower, upper, current }) => {
  const MAX = 5;
  const pct = (v) => Math.min(100, (v / MAX) * 100);
  return (
    <div>
      <div style={{ position: 'relative', height: 28, background: '#f1f5f9', borderRadius: 6, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, width: `${pct(critical)}%`, height: '100%', background: '#fecaca' }} />
        <div style={{ position: 'absolute', left: `${pct(critical)}%`, width: `${pct(lower) - pct(critical)}%`, height: '100%', background: '#fde68a' }} />
        <div style={{ position: 'absolute', left: `${pct(lower)}%`, width: `${pct(upper) - pct(lower)}%`, height: '100%', background: '#bbf7d0' }} />
        <div style={{ position: 'absolute', left: `${pct(upper)}%`, width: `${100 - pct(upper)}%`, height: '100%', background: '#fde68a' }} />
        {/* 현재값 marker */}
        <div style={{ position: 'absolute', left: `${pct(current)}%`, top: 0, width: 3, height: '100%', background: '#0891b2' }} />
        <span style={{ position: 'absolute', left: `calc(${pct(current)}% - 14px)`, top: -16, fontSize: 9, fontWeight: 800, color: '#0891b2' }}>현재</span>
      </div>
      <div className="flex justify-between mt-1" style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600 }}>
        {[0, 1, 2, 3, 4, 5].map(v => <span key={v}>{v}</span>)}
      </div>
    </div>
  );
};

const ThresholdRow = ({ level, desc, value, step, onChange, color }) => (
  <div className="flex items-center justify-between gap-3 mb-2">
    <div>
      <div style={{ fontSize: 12, fontWeight: 800, color }}>{level}</div>
      <div style={{ fontSize: 10, color: '#64748b' }}>{desc}</div>
    </div>
    <input type="number" value={value} step={step} onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
           style={{ width: 70, padding: '4px 8px', fontSize: 13, fontWeight: 800, color,
                    border: `1px solid ${color}40`, borderRadius: 6, textAlign: 'right' }} />
  </div>
);

// ─────────────────────────────────────────
// 하드웨어 편집
// ─────────────────────────────────────────
const HardwareEditor = () => {
  const [hw, setHw] = useState(MOCK_HW);
  return (
    <div className="space-y-3">
      <div style={{ fontSize: 12, color: '#64748b', padding: 8, background: '#fef3c7', borderRadius: 6 }}>
        💡 RPi Modbus RTU 통신용. 실제 양액기 하드웨어 설치 후 등록.
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumIn label="Modbus Unit" value={hw.modbusUnit} onChange={(v) => setHw({ ...hw, modbusUnit: v })} />
        <NumIn label="EC 센서 주소" value={hw.ecSensorAddr} onChange={(v) => setHw({ ...hw, ecSensorAddr: v })} />
        <NumIn label="pH 센서 주소" value={hw.phSensorAddr} onChange={(v) => setHw({ ...hw, phSensorAddr: v })} />
        <NumIn label="유량 센서 주소" value={hw.flowSensorAddr} onChange={(v) => setHw({ ...hw, flowSensorAddr: v })} />
        <NumIn label="펌프 응답 (ms)" value={hw.pumpResponse} onChange={(v) => setHw({ ...hw, pumpResponse: v })} />
        <NumIn label="도징 펄스 단위 (mL)" value={hw.dosingPulseUnit} onChange={(v) => setHw({ ...hw, dosingPulseUnit: v })} />
      </div>
    </div>
  );
};

const NumIn = ({ label, value, onChange }) => (
  <div>
    <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 4 }}>{label}</div>
    <input type="number" value={value} onChange={(e) => onChange(parseInt(e.target.value) || 0)}
           style={{ width: '100%', padding: '6px 10px', fontSize: 13, fontWeight: 800, color: '#0891b2',
                    border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }} />
  </div>
);
