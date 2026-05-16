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

const MOCK_CALIBRATION = {
  ec: {
    lastCalibrated: '2026-05-10 09:23',
    standardValue: 1.413, // mS/cm (KCl 표준액)
    measuredValue: 1.408,
    offset: 0.005,
    nextDue: '2026-06-10',
    history: [
      { date: '2026-05-10 09:23', standard: 1.413, measured: 1.408, offset: 0.005, by: 'admin' },
      { date: '2026-04-10 10:15', standard: 1.413, measured: 1.395, offset: 0.018, by: 'admin' },
      { date: '2026-03-12 14:02', standard: 1.413, measured: 1.421, offset: -0.008, by: 'farmer' },
    ],
  },
  ph: {
    lastCalibrated: '2026-05-10 09:35',
    points: [
      { buffer: 4.01, measured: 4.05, offset: -0.04 },
      { buffer: 6.86, measured: 6.88, offset: -0.02 },
      { buffer: 9.18, measured: 9.15, offset: 0.03 },
    ],
    slope: 98.5, // %
    nextDue: '2026-06-10',
    history: [
      { date: '2026-05-10 09:35', slope: 98.5, by: 'admin' },
      { date: '2026-04-10 10:30', slope: 97.2, by: 'admin' },
      { date: '2026-03-12 14:18', slope: 96.8, by: 'farmer' },
    ],
  },
};

const MOCK_ALERT_HISTORY = [
  { id: 1, time: '2026-05-16 08:23', type: 'EC 상한 초과', value: 4.2, threshold: 4.0, severity: 'warning', resolved: true, action: '도싱 일시정지 · 재희석' },
  { id: 2, time: '2026-05-16 06:15', type: 'pH 하한 미달', value: 4.3, threshold: 4.5, severity: 'warning', resolved: true, action: '알칼리 도싱 +5%' },
  { id: 3, time: '2026-05-15 22:47', type: '탱크 A 잔량 부족', value: 12, threshold: 15, severity: 'warning', resolved: true, action: '액 보충 완료' },
  { id: 4, time: '2026-05-15 17:32', type: 'EC 센서 통신 오류', value: null, threshold: null, severity: 'critical', resolved: true, action: 'Modbus 재연결 (30초)' },
  { id: 5, time: '2026-05-15 14:08', type: '유량 이상 (목표 대비 -45%)', value: 55, threshold: 100, severity: 'warning', resolved: true, action: '필터 청소 알림' },
  { id: 6, time: '2026-05-14 11:25', type: 'pH 상한 초과', value: 8.3, threshold: 8.0, severity: 'warning', resolved: true, action: '산 도싱 +3%' },
  { id: 7, time: '2026-05-14 03:12', type: '원수 수위 부족', value: 8, threshold: 15, severity: 'critical', resolved: true, action: '관수 정지 · 수동 보충' },
  { id: 8, time: '2026-05-13 19:50', type: '교반기 응답 없음', value: null, threshold: null, severity: 'critical', resolved: true, action: '재시작 후 정상' },
];

const MOCK_COUNTERS = {
  totalDoseL: 14523.7, // 누적 도싱량 (L)
  totalIrrigationL: 285430.5, // 누적 관수량 (L)
  totalCycles: 8420, // 누적 1회 관수 횟수
  pumpRuntime: 6240, // 펌프 누적 가동 시간 (분)
  filterChangeAt: '2026-04-22',
  lastReset: '2026-01-01',
};

export default function NutrientSettings({ farmId }) {
  const [open, setOpen] = useState({
    tanks: true, valves: false, alerts: false, hw: false,
    calibration: false, alertHistory: false, counters: false,
  });
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

      {/* 4. 센서 보정 (신규) */}
      <Section title="🎯 센서 보정" subtitle="EC 1-포인트 (1.413 mS/cm) · pH 3-포인트 (4.01/6.86/9.18)"
               open={open.calibration} onToggle={() => toggle('calibration')}>
        <CalibrationEditor />
      </Section>

      {/* 5. 경보 이력 (신규) */}
      <Section title="📋 경보 이력" subtitle={`최근 ${MOCK_ALERT_HISTORY.length}건 · 원인 · 조치 추적`}
               open={open.alertHistory} onToggle={() => toggle('alertHistory')}>
        <AlertHistory />
      </Section>

      {/* 6. 카운터 초기화 (신규, 신중) */}
      <Section title="🔄 누적 카운터" subtitle="도싱·관수·펌프 누적값 · 필터 교체 · 초기화"
               open={open.counters} onToggle={() => toggle('counters')}>
        <CounterReset />
      </Section>

      {/* 7. 하드웨어·설비 */}
      <Section title="🛠️ 설비·시스템" subtitle="Modbus 매핑 · 펌프 응답"
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
        <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>{title}</div>
        <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{subtitle}</div>
      </div>
      <span style={{ fontSize: 16, color: '#94a3b8', transition: 'transform 0.2s',
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
                  fontSize: 15, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>{t.id}</span>
                <input value={t.label} onChange={(e) => updateTank(i, { label: e.target.value })}
                       style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', border: 'none', background: 'transparent', outline: 'none', flex: 1 }} />
              </div>
              <button onClick={() => removeTank(i)} style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <div style={{ color: '#64748b', marginBottom: 2 }}>잔량</div>
                <div style={{ height: 6, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${t.level}%`, height: '100%', background: t.level > 30 ? '#16a34a' : '#dc2626' }} />
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>{t.level}%</div>
              </div>
              <div>
                <div style={{ color: '#64748b', marginBottom: 2 }}>용량</div>
                <input type="number" value={t.capacity} onChange={(e) => updateTank(i, { capacity: parseInt(e.target.value) || 0 })}
                       style={{ width: '100%', padding: '3px 6px', fontSize: 13, fontWeight: 700, border: '1px solid #cbd5e1', borderRadius: 4 }} />
                <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'right' }}>L</div>
              </div>
              <div>
                <div style={{ color: '#64748b', marginBottom: 2 }}>Modbus</div>
                <input type="number" value={t.modbusReg} onChange={(e) => updateTank(i, { modbusReg: parseInt(e.target.value) || 0 })}
                       style={{ width: '100%', padding: '3px 6px', fontSize: 13, fontWeight: 700, border: '1px solid #cbd5e1', borderRadius: 4 }} />
                <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'right' }}>주소</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <button onClick={addTank} disabled={tanks.length >= 10} style={{
        width: '100%', padding: 10, borderRadius: 8, border: '2px dashed ' + (tanks.length >= 10 ? '#cbd5e1' : '#0891b2'),
        background: '#fff', color: tanks.length >= 10 ? '#94a3b8' : '#0891b2',
        fontSize: 14, fontWeight: 700, cursor: tanks.length >= 10 ? 'not-allowed' : 'pointer',
      }}>+ 탱크 추가</button>
      <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 8, padding: 8, background: '#fef3c7', borderRadius: 6 }}>
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
        <span style={{ fontSize: 14, fontWeight: 700, color: '#475569' }}>밸브 수:</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setCount(c => Math.max(1, c - 1))}
                  style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 800 }}>−</button>
          <input type="number" value={count} onChange={(e) => setCount(Math.max(1, Math.min(24, parseInt(e.target.value) || 1)))}
                 style={{ width: 60, padding: '4px 8px', fontSize: 16, fontWeight: 800, textAlign: 'center',
                          border: '1px solid #cbd5e1', borderRadius: 6, color: '#0891b2' }} />
          <button onClick={() => setCount(c => Math.min(24, c + 1))}
                  style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 800 }}>+</button>
        </div>
        <span style={{ fontSize: 13, color: '#94a3b8' }}>(1~24)</span>
      </div>
      <div className="grid grid-cols-6 md:grid-cols-12 gap-2">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} style={{
            padding: '8px 4px', background: '#f0fdf4', borderRadius: 6,
            border: '1px solid #86efac', textAlign: 'center',
            fontSize: 14, fontWeight: 800, color: '#15803d',
          }}>{i + 1}</div>
        ))}
      </div>
      <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 8, padding: 8, background: '#fef3c7', borderRadius: 6 }}>
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
        <div style={{ fontSize: 14, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
          📊 EC 범위 (현재: <strong style={{ color: '#0891b2' }}>{currentEC} mS/cm</strong>)
        </div>
        <ECRangeBar critical={a.ecCritical} lower={a.ecLower} upper={a.ecUpper} current={currentEC} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* EC */}
        <div style={{ padding: 12, background: '#f0f9ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#1e40af', marginBottom: 8 }}>EC 한계 (mS/cm)</div>
          <ThresholdRow level="🔴 경보 상한" desc="초과 시 경보 발생" value={a.ecUpper} step={0.1}
                        onChange={(v) => setA({ ...a, ecUpper: v })} color="#dc2626" />
          <ThresholdRow level="🟡 경보 하한" desc="미달 시 경보 발생" value={a.ecLower} step={0.1}
                        onChange={(v) => setA({ ...a, ecLower: v })} color="#d97706" />
          <ThresholdRow level="🛑 작동 중단" desc="미달 시 제어 정지" value={a.ecCritical} step={0.1}
                        onChange={(v) => setA({ ...a, ecCritical: v })} color="#991b1b" />
        </div>
        {/* pH */}
        <div style={{ padding: 12, background: '#faf5ff', borderRadius: 8, border: '1px solid #d8b4fe' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#7c3aed', marginBottom: 8 }}>pH 한계</div>
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
        <span style={{ position: 'absolute', left: `calc(${pct(current)}% - 14px)`, top: -16, fontSize: 11, fontWeight: 800, color: '#0891b2' }}>현재</span>
      </div>
      <div className="flex justify-between mt-1" style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>
        {[0, 1, 2, 3, 4, 5].map(v => <span key={v}>{v}</span>)}
      </div>
    </div>
  );
};

const ThresholdRow = ({ level, desc, value, step, onChange, color }) => (
  <div className="flex items-center justify-between gap-3 mb-2">
    <div>
      <div style={{ fontSize: 14, fontWeight: 800, color }}>{level}</div>
      <div style={{ fontSize: 12, color: '#64748b' }}>{desc}</div>
    </div>
    <input type="number" value={value} step={step} onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
           style={{ width: 70, padding: '4px 8px', fontSize: 15, fontWeight: 800, color,
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
      <div style={{ fontSize: 14, color: '#64748b', padding: 8, background: '#fef3c7', borderRadius: 6 }}>
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
    <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 4 }}>{label}</div>
    <input type="number" value={value} onChange={(e) => onChange(parseInt(e.target.value) || 0)}
           style={{ width: '100%', padding: '6px 10px', fontSize: 15, fontWeight: 800, color: '#0891b2',
                    border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }} />
  </div>
);

// ─────────────────────────────────────────
// 센서 보정 (EC 1-pt + pH 3-pt)
// ─────────────────────────────────────────
const CalibrationEditor = () => {
  const [cal] = useState(MOCK_CALIBRATION);
  const [step, setStep] = useState(null); // null | 'ec' | 'ph-1' | 'ph-2' | 'ph-3'

  return (
    <div className="space-y-3">
      <div style={{ fontSize: 13, color: '#64748b', padding: 8, background: '#eff6ff', borderRadius: 6, border: '1px solid #bfdbfe' }}>
        💡 권장 주기: <strong>월 1회</strong> · 표준액에 센서 5분 침지 후 안정화되면 보정 시작
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* EC 1-포인트 보정 */}
        <div style={{ padding: 12, background: '#f0f9ff', borderRadius: 10, border: '1px solid #bfdbfe' }}>
          <div className="flex justify-between items-start mb-2">
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#1e40af' }}>EC 센서 (1-포인트)</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>KCl 표준액 1.413 mS/cm (25°C)</div>
            </div>
            <span style={{
              padding: '2px 6px', fontSize: 11, fontWeight: 700,
              background: '#dbeafe', color: '#1e40af', borderRadius: 4,
            }}>마지막: {cal.ec.lastCalibrated}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-2" style={{ fontSize: 13 }}>
            <CalCell label="표준값" value={`${cal.ec.standardValue} mS`} color="#1e40af" />
            <CalCell label="측정값" value={`${cal.ec.measuredValue} mS`} color="#0891b2" />
            <CalCell label="오프셋" value={`${cal.ec.offset >= 0 ? '+' : ''}${cal.ec.offset}`} color={Math.abs(cal.ec.offset) < 0.05 ? '#16a34a' : '#d97706'} />
          </div>
          <button onClick={() => setStep('ec')} style={{
            width: '100%', padding: '8px', borderRadius: 6, border: 'none',
            background: '#1e40af', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}>EC 재보정 시작</button>
          <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'right', marginTop: 4 }}>다음 권장: {cal.ec.nextDue}</div>
        </div>

        {/* pH 3-포인트 보정 */}
        <div style={{ padding: 12, background: '#faf5ff', borderRadius: 10, border: '1px solid #d8b4fe' }}>
          <div className="flex justify-between items-start mb-2">
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#7c3aed' }}>pH 센서 (3-포인트)</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>완충액 4.01 / 6.86 / 9.18</div>
            </div>
            <span style={{
              padding: '2px 6px', fontSize: 11, fontWeight: 700,
              background: '#ede9fe', color: '#7c3aed', borderRadius: 4,
            }}>슬로프: {cal.ph.slope}%</span>
          </div>
          <div className="space-y-1 mb-2">
            {cal.ph.points.map((p, i) => (
              <div key={i} className="flex justify-between items-center" style={{ fontSize: 13, padding: '4px 6px', background: '#fff', borderRadius: 4 }}>
                <span style={{ color: '#7c3aed', fontWeight: 700 }}>pH {p.buffer}</span>
                <span style={{ color: '#64748b' }}>측정 {p.measured}</span>
                <span style={{ color: Math.abs(p.offset) < 0.1 ? '#16a34a' : '#d97706', fontWeight: 700 }}>
                  {p.offset >= 0 ? '+' : ''}{p.offset}
                </span>
              </div>
            ))}
          </div>
          <button onClick={() => setStep('ph-1')} style={{
            width: '100%', padding: '8px', borderRadius: 6, border: 'none',
            background: '#7c3aed', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}>pH 재보정 시작</button>
          <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'right', marginTop: 4 }}>다음 권장: {cal.ph.nextDue}</div>
        </div>
      </div>

      {/* 보정 진행 모달 (간단한 inline UI) */}
      {step && (
        <div style={{ padding: 12, background: '#fef3c7', borderRadius: 8, border: '1px solid #fcd34d' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#92400e', marginBottom: 6 }}>
            🧪 {step === 'ec' ? 'EC 표준액 1.413 mS/cm' :
                step === 'ph-1' ? 'pH 4.01 완충액' :
                step === 'ph-2' ? 'pH 6.86 완충액' : 'pH 9.18 완충액'}에 센서 침지 중…
          </div>
          <div style={{ fontSize: 13, color: '#78350f', marginBottom: 8 }}>
            ① 센서를 표준액에 5분간 담그세요 · ② 측정값이 안정되면 [확인]을 누르세요 · ③ 보정 완료
          </div>
          <div className="flex gap-2">
            <button onClick={() => {
              if (step === 'ph-1') setStep('ph-2');
              else if (step === 'ph-2') setStep('ph-3');
              else { alert('보정 완료'); setStep(null); }
            }} style={{
              padding: '6px 14px', background: '#16a34a', color: '#fff', border: 'none',
              borderRadius: 6, fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}>✓ 확인</button>
            <button onClick={() => setStep(null)} style={{
              padding: '6px 14px', background: '#fff', color: '#64748b',
              border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}>취소</button>
          </div>
        </div>
      )}

      {/* 이력 */}
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#475569', marginBottom: 6 }}>📜 보정 이력</div>
        <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
                <th style={{ padding: 6, textAlign: 'left', fontWeight: 700, color: '#475569' }}>일시</th>
                <th style={{ padding: 6, textAlign: 'left', fontWeight: 700, color: '#475569' }}>센서</th>
                <th style={{ padding: 6, textAlign: 'right', fontWeight: 700, color: '#475569' }}>오프셋/슬로프</th>
                <th style={{ padding: 6, textAlign: 'right', fontWeight: 700, color: '#475569' }}>담당</th>
              </tr>
            </thead>
            <tbody>
              {cal.ec.history.map((h, i) => (
                <tr key={`ec-${i}`} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: 6, color: '#64748b' }}>{h.date}</td>
                  <td style={{ padding: 6, color: '#1e40af', fontWeight: 700 }}>EC</td>
                  <td style={{ padding: 6, textAlign: 'right', color: Math.abs(h.offset) < 0.05 ? '#16a34a' : '#d97706', fontWeight: 700 }}>
                    {h.offset >= 0 ? '+' : ''}{h.offset}
                  </td>
                  <td style={{ padding: 6, textAlign: 'right', color: '#64748b' }}>{h.by}</td>
                </tr>
              ))}
              {cal.ph.history.map((h, i) => (
                <tr key={`ph-${i}`} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: 6, color: '#64748b' }}>{h.date}</td>
                  <td style={{ padding: 6, color: '#7c3aed', fontWeight: 700 }}>pH</td>
                  <td style={{ padding: 6, textAlign: 'right', color: h.slope > 95 ? '#16a34a' : '#d97706', fontWeight: 700 }}>
                    {h.slope}%
                  </td>
                  <td style={{ padding: 6, textAlign: 'right', color: '#64748b' }}>{h.by}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const CalCell = ({ label, value, color }) => (
  <div style={{ padding: '4px 6px', background: '#fff', borderRadius: 4, textAlign: 'center' }}>
    <div style={{ fontSize: 11, color: '#94a3b8' }}>{label}</div>
    <div style={{ fontSize: 14, fontWeight: 800, color }}>{value}</div>
  </div>
);

// ─────────────────────────────────────────
// 경보 이력 (검색·필터·해결처리)
// ─────────────────────────────────────────
const AlertHistory = () => {
  const [history] = useState(MOCK_ALERT_HISTORY);
  const [filter, setFilter] = useState('all'); // all | warning | critical | unresolved
  const [search, setSearch] = useState('');

  const filtered = history.filter(a => {
    if (filter === 'warning' && a.severity !== 'warning') return false;
    if (filter === 'critical' && a.severity !== 'critical') return false;
    if (filter === 'unresolved' && a.resolved) return false;
    if (search && !a.type.includes(search) && !a.action.includes(search)) return false;
    return true;
  });

  const sevColor = { warning: '#d97706', critical: '#dc2626', info: '#0891b2' };
  const sevBg = { warning: '#fef3c7', critical: '#fee2e2', info: '#dbeafe' };

  return (
    <div>
      {/* 필터 + 검색 */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {[
          { id: 'all', label: '전체', n: history.length },
          { id: 'critical', label: '🛑 심각', n: history.filter(a => a.severity === 'critical').length },
          { id: 'warning', label: '⚠️ 경보', n: history.filter(a => a.severity === 'warning').length },
          { id: 'unresolved', label: '미해결', n: history.filter(a => !a.resolved).length },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            padding: '4px 10px', borderRadius: 16, border: 'none',
            background: filter === f.id ? '#0f172a' : '#f1f5f9',
            color: filter === f.id ? '#fff' : '#475569',
            fontSize: 13, fontWeight: 700, cursor: 'pointer',
          }}>{f.label} <span style={{ opacity: 0.6 }}>({f.n})</span></button>
        ))}
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 검색"
               style={{ flex: 1, minWidth: 100, padding: '4px 10px', fontSize: 13,
                        border: '1px solid #cbd5e1', borderRadius: 16, outline: 'none' }} />
      </div>

      {/* 리스트 */}
      <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 14, color: '#94a3b8' }}>
            조건에 맞는 경보가 없습니다
          </div>
        ) : filtered.map(a => (
          <div key={a.id} style={{
            padding: '10px 12px', borderBottom: '1px solid #f1f5f9',
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <span style={{
              padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 800,
              background: sevBg[a.severity], color: sevColor[a.severity], flexShrink: 0,
            }}>{a.severity === 'critical' ? '🛑' : '⚠️'}</span>
            <div style={{ flex: 1 }}>
              <div className="flex justify-between items-start gap-2">
                <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{a.type}</span>
                <span style={{ fontSize: 12, color: '#94a3b8', flexShrink: 0 }}>{a.time}</span>
              </div>
              {a.value !== null && (
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                  측정 <strong style={{ color: sevColor[a.severity] }}>{a.value}</strong>
                  {' '}/ 한계 <strong>{a.threshold}</strong>
                </div>
              )}
              <div style={{ fontSize: 12, color: a.resolved ? '#16a34a' : '#dc2626', marginTop: 2, fontWeight: 600 }}>
                {a.resolved ? '✓ 해결' : '◌ 진행중'} · {a.action}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6, textAlign: 'right' }}>
        총 {filtered.length}건 표시 (전체 {history.length}건)
      </div>
    </div>
  );
};

// ─────────────────────────────────────────
// 카운터 초기화 (확인 절차 필수)
// ─────────────────────────────────────────
const CounterReset = () => {
  const [counters] = useState(MOCK_COUNTERS);
  const [confirming, setConfirming] = useState(null); // null | counter key

  const cards = [
    { key: 'totalDoseL', label: '누적 도싱량', value: counters.totalDoseL.toLocaleString(), unit: 'L', color: '#0891b2', icon: '💧' },
    { key: 'totalIrrigationL', label: '누적 관수량', value: counters.totalIrrigationL.toLocaleString(), unit: 'L', color: '#16a34a', icon: '🚿' },
    { key: 'totalCycles', label: '누적 회수', value: counters.totalCycles.toLocaleString(), unit: '회', color: '#7c3aed', icon: '🔁' },
    { key: 'pumpRuntime', label: '펌프 가동', value: Math.floor(counters.pumpRuntime / 60).toLocaleString(), unit: '시간', color: '#d97706', icon: '⚙️' },
  ];

  return (
    <div>
      <div style={{
        padding: 10, marginBottom: 10, background: '#fef2f2', borderRadius: 8,
        border: '1px solid #fca5a5', fontSize: 13, color: '#991b1b',
      }}>
        ⚠️ <strong>주의</strong> · 초기화는 되돌릴 수 없습니다. 필터 교체·정비 후에만 사용하세요.
        <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>
          마지막 초기화: <strong>{counters.lastReset}</strong> · 마지막 필터 교체: <strong>{counters.filterChangeAt}</strong>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        {cards.map(c => (
          <div key={c.key} style={{
            padding: 10, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0',
          }}>
            <div style={{ fontSize: 18 }}>{c.icon}</div>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 700, marginTop: 2 }}>{c.label}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: c.color, marginTop: 4 }}>
              {c.value} <span style={{ fontSize: 11, fontWeight: 600 }}>{c.unit}</span>
            </div>
            <button onClick={() => setConfirming(c.key)} style={{
              marginTop: 6, width: '100%', padding: '4px', borderRadius: 4,
              border: '1px solid #cbd5e1', background: '#fff', color: '#dc2626',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>초기화</button>
          </div>
        ))}
      </div>

      {/* 필터 교체 기록 */}
      <div style={{
        padding: 10, background: '#fff7ed', borderRadius: 8, border: '1px solid #fed7aa',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#9a3412' }}>🔧 필터 교체 기록</div>
          <div style={{ fontSize: 12, color: '#c2410c', marginTop: 2 }}>마지막 교체: {counters.filterChangeAt} · 권장 주기 90일</div>
        </div>
        <button style={{
          padding: '6px 12px', borderRadius: 6, border: 'none',
          background: '#ea580c', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
        }}>교체 완료 기록</button>
      </div>

      {/* 확인 모달 (inline) */}
      {confirming && (
        <div style={{
          marginTop: 10, padding: 12, background: '#fef2f2', borderRadius: 8,
          border: '2px solid #dc2626',
        }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#991b1b', marginBottom: 6 }}>
            🛑 정말 초기화하시겠습니까?
          </div>
          <div style={{ fontSize: 13, color: '#7f1d1d', marginBottom: 8 }}>
            <strong>{cards.find(c => c.key === confirming)?.label}</strong> 누적값이 0으로 리셋됩니다.
            <br />이 작업은 <strong>되돌릴 수 없습니다</strong>.
          </div>
          <div className="flex gap-2">
            <button onClick={() => { alert('초기화 완료 (mock)'); setConfirming(null); }} style={{
              padding: '6px 14px', background: '#dc2626', color: '#fff', border: 'none',
              borderRadius: 6, fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}>네, 초기화합니다</button>
            <button onClick={() => setConfirming(null)} style={{
              padding: '6px 14px', background: '#fff', color: '#64748b',
              border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 14, fontWeight: 700, cursor: 'pointer',
            }}>취소</button>
          </div>
        </div>
      )}
    </div>
  );
};
