import { useEffect, useState } from 'react';
import * as nutrientApi from '../../services/nutrientApi';

// 초기값 — nutrient-flow-design.md 의 6 탱크 BOM 과 일치
// Realtime 다이어그램 의 TANK_DEFAULTS 와도 동일 (id·이름 정렬)
const DEFAULT_TANKS = [
  { id: 'A',  label: '질산칼슘',     level: 80, capacity: 25, modbusReg: 0 },
  { id: 'B',  label: '다비료 NPK',   level: 75, capacity: 25, modbusReg: 1 },
  { id: 'C',  label: '미량요소',     level: 65, capacity: 25, modbusReg: 2 },
  { id: 'D',  label: '황산마그네슘', level: 50, capacity: 25, modbusReg: 3 },
  { id: 'AC', label: '산 HNO₃',      level: 90, capacity: 10, modbusReg: 4 },
  { id: 'AL', label: '알칼리 KOH',   level: 85, capacity: 10, modbusReg: 5 },
];

const DEFAULT_ALERTS = {
  ecUpper: 4.0, ecLower: 0.2, ecCritical: 0.1,
  phUpper: 8.0, phLower: 4.5, phCritical: 6.5,
  // 정밀도 (히스테리시스) — 목표값 ± 이 범위 안에선 도싱 안 함 (펌프 hunting 방지)
  ecHysteresis: 0.1, phHysteresis: 0.1,
  // 다량공급 임계값 — 목표 대비 이 차이 이상이면 빠른 보정 모드
  ecDeviation: 0.5, phDeviation: 0.5,
  // solar 모드: 현재 일사량이 이 값 미만이면 트리거 무시 (흐린 날 노이즈 방지)
  minSolarWm2: 50,
};

const DEFAULT_HW = {
  modbusUnit: 3, ecSensorAddr: 100, phSensorAddr: 101, flowSensorAddr: 102,
  pumpResponse: 50,
  dosingPulseUnit: 500,
  // 교반기 시간
  mixerOnSec: 30, mixerOffMin: 50,
  // 산/알칼리 운영 모드: 'both' | 'acid' | 'alkali'
  acidAlkaliMode: 'both',
  // 온도 보정 기준 (°C)
  rawTempTarget: 18, outsideTempTarget: 22,
  // 유량 표시 단위
  flowUnit: 'L',
  // 직접 제어 자동 OFF (초). 0 = 자동 OFF 없음 (사용자 명시 종료까지 ON 유지)
  directAutoOffSec: 0,
};

export default function NutrientSettings({ farmId }) {
  const [open, setOpen] = useState({
    tanks: true, valves: false, channels: false, alerts: false, hw: false,
    calibration: false, alertHistory: false, counters: false,
  });
  const toggle = (k) => setOpen(o => ({ ...o, [k]: !o[k] }));

  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [savingSection, setSavingSection] = useState(null);

  // 초기 config 로드
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await nutrientApi.getConfig(farmId);
        if (cancelled) return;
        setConfig({
          tanks: (cfg.tanks && cfg.tanks.length) ? cfg.tanks : DEFAULT_TANKS,
          valveCount: cfg.valveCount || 14,
          alerts: { ...DEFAULT_ALERTS, ...(cfg.alerts || {}) },
          hardware: { ...DEFAULT_HW, ...(cfg.hardware || {}) },
        });
      } catch (e) {
        if (!cancelled) setError(e.response?.data?.error || e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [farmId]);

  const saveSection = async (section, value) => {
    setConfig(prev => ({ ...prev, [section]: value }));
    setSavingSection(section);
    try {
      await nutrientApi.updateConfig(farmId, { [section]: value });
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSavingSection(null);
    }
  };

  if (loading || !config) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 15 }}>설정 불러오는 중…</div>;
  }

  return (
    <div className="space-y-2">
      {error && (
        <div style={{
          padding: '10px 14px', background: '#fee2e2', border: '1px solid #fca5a5',
          borderRadius: 10, color: '#991b1b', fontSize: 14, fontWeight: 700,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>⚠️ {error}</span>
          <button onClick={() => setError(null)} style={{
            background: 'transparent', border: 'none', color: '#991b1b', fontSize: 17, cursor: 'pointer',
          }}>✕</button>
        </div>
      )}

      {/* 1. 도싱 탱크 */}
      <Section title="💧 도싱 탱크" subtitle={`${config.tanks.length}개 사용 · 최대 10개`}
               open={open.tanks} onToggle={() => toggle('tanks')} saving={savingSection === 'tanks'}>
        <TanksEditor tanks={config.tanks} onSave={(t) => saveSection('tanks', t)} />
      </Section>

      {/* 2. 관수 밸브 */}
      <Section title="🚿 관수 밸브" subtitle={`${config.valveCount}구역 · 최대 24개`}
               open={open.valves} onToggle={() => toggle('valves')} saving={savingSection === 'valveCount'}>
        <ValvesEditor count={config.valveCount} onSave={(n) => saveSection('valveCount', n)} />
      </Section>

      <Section title="🔌 릴레이 채널 매핑" subtitle="Waveshare 32CH · 환경 0~7 + 양액 8~30"
               open={open.channels} onToggle={() => toggle('channels')} saving={savingSection === 'hardware'}>
        <RelayChannelMap
          tanks={config.tanks}
          valveCount={config.valveCount}
          hardware={config.hardware}
          onSaveHardware={(h) => saveSection('hardware', h)}
        />
      </Section>

      {/* 3. 경보 한계값 */}
      <Section title="⚠️ 경보 한계값" subtitle="EC · pH 3단계 (작동중단 / 경보 / 정상)"
               open={open.alerts} onToggle={() => toggle('alerts')} saving={savingSection === 'alerts'}>
        <AlertsEditor alerts={config.alerts} onSave={(a) => saveSection('alerts', a)} />
      </Section>

      {/* 4. 센서 보정 */}
      <Section title="🎯 센서 보정" subtitle="EC 1-포인트 (1.413 mS/cm) · pH 3-포인트 (4.01/6.86/9.18)"
               open={open.calibration} onToggle={() => toggle('calibration')}>
        <CalibrationEditor farmId={farmId} />
      </Section>

      {/* 5. 경보 이력 */}
      <Section title="📋 경보 이력" subtitle="원인 · 조치 추적"
               open={open.alertHistory} onToggle={() => toggle('alertHistory')}>
        <AlertHistory farmId={farmId} />
      </Section>

      {/* 6. 누적 카운터 */}
      <Section title="🔄 누적 카운터" subtitle="도싱·관수·펌프 누적값 · 필터 교체 · 초기화"
               open={open.counters} onToggle={() => toggle('counters')}>
        <CounterReset farmId={farmId} />
      </Section>

      {/* 7. 하드웨어·설비 */}
      <Section title="🛠️ 설비·시스템" subtitle="Modbus 매핑 · 펌프 응답"
               open={open.hw} onToggle={() => toggle('hw')} saving={savingSection === 'hardware'}>
        <HardwareEditor hardware={config.hardware} onSave={(h) => saveSection('hardware', h)} />
      </Section>
    </div>
  );
}

const Section = ({ title, subtitle, open, onToggle, saving, children }) => (
  <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
    <button onClick={onToggle} style={{
      width: '100%', padding: '12px 16px', border: 'none', cursor: 'pointer',
      background: open ? '#f8fafc' : '#fff',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'left',
    }}>
      <div>
        <div style={{ fontSize: 17, fontWeight: 800, color: '#0f172a' }}>{title}</div>
        <div style={{ fontSize: 14, color: '#64748b', marginTop: 2 }}>
          {subtitle}
          {saving && <span style={{ marginLeft: 8, fontSize: 13, color: '#0891b2', fontWeight: 700 }}>저장 중…</span>}
        </div>
      </div>
      <span style={{ fontSize: 17, color: '#94a3b8', transition: 'transform 0.2s',
                     transform: open ? 'rotate(180deg)' : '' }}>▾</span>
    </button>
    {open && (
      <div style={{ padding: '12px 8px', borderTop: '1px solid #e2e8f0' }}>{children}</div>
    )}
  </div>
);

// ─────────────────────────────────────────
// 도싱 탱크 편집
// ─────────────────────────────────────────
const TanksEditor = ({ tanks: initial, onSave }) => {
  const [tanks, setTanks] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const markDirty = () => setDirty(true);
  const updateTank = (i, updates) => { setTanks(prev => prev.map((t, idx) => idx === i ? { ...t, ...updates } : t)); markDirty(); };
  const addTank = () => {
    if (tanks.length >= 10) return alert('최대 10개');
    setTanks(prev => [...prev, { id: `T${prev.length+1}`, label: '신규', level: 100, capacity: 100, modbusReg: prev.length }]);
    markDirty();
  };
  const removeTank = (i) => { setTanks(prev => prev.filter((_, idx) => idx !== i)); markDirty(); };
  const save = async () => { await onSave(tanks); setDirty(false); };

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-3">
        {tanks.map((t, i) => (
          <div key={i} style={{ padding: 10, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'nowrap' }}>
              <span style={{
                width: 28, height: 28, borderRadius: 8, background: '#0891b2', color: '#fff',
                fontSize: 14, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>{t.id}</span>
              <input
                value={t.label}
                onChange={(e) => updateTank(i, { label: e.target.value })}
                placeholder="이름 입력"
                className="tank-label-input"
                title="클릭해서 이름 수정"
                style={{
                  fontSize: 15, fontWeight: 700, color: '#0f172a',
                  border: 'none',
                  borderBottom: '1px dashed #cbd5e1',
                  background: 'transparent',
                  outline: 'none',
                  flex: 1, minWidth: 0,
                  padding: '2px 4px',
                  cursor: 'text',
                }}
              />
              <span style={{ fontSize: 12, color: '#94a3b8', flexShrink: 0 }}>✏️</span>
              <button onClick={() => removeTank(i)} style={{
                color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer',
                fontSize: 16, padding: '2px 4px', flexShrink: 0,
              }}>✕</button>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div>
                <div style={{ color: '#64748b', marginBottom: 2 }}>잔량</div>
                <div style={{ height: 6, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${t.level}%`, height: '100%', background: t.level > 30 ? '#16a34a' : '#dc2626' }} />
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginTop: 2 }}>{t.level}%</div>
              </div>
              <div>
                <div style={{ color: '#64748b', marginBottom: 2 }}>용량</div>
                <input type="number" value={t.capacity} onChange={(e) => updateTank(i, { capacity: parseInt(e.target.value) || 0 })}
                       style={{ width: '100%', padding: '3px 6px', fontSize: 14, fontWeight: 700, border: '1px solid #cbd5e1', borderRadius: 4 }} />
                <div style={{ fontSize: 13, color: '#94a3b8', textAlign: 'right' }}>L</div>
              </div>
              <div>
                <div style={{ color: '#64748b', marginBottom: 2 }}>Modbus</div>
                <input type="number" value={t.modbusReg} onChange={(e) => updateTank(i, { modbusReg: parseInt(e.target.value) || 0 })}
                       style={{ width: '100%', padding: '3px 6px', fontSize: 14, fontWeight: 700, border: '1px solid #cbd5e1', borderRadius: 4 }} />
                <div style={{ fontSize: 13, color: '#94a3b8', textAlign: 'right' }}>주소</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <button onClick={addTank} disabled={tanks.length >= 10} style={{
        width: '100%', padding: 10, borderRadius: 8, border: '2px dashed ' + (tanks.length >= 10 ? '#cbd5e1' : '#0891b2'),
        background: '#fff', color: tanks.length >= 10 ? '#94a3b8' : '#0891b2',
        fontSize: 15, fontWeight: 700, cursor: tanks.length >= 10 ? 'not-allowed' : 'pointer',
      }}>+ 탱크 추가</button>
      <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 8, padding: 8, background: '#fef3c7', borderRadius: 6 }}>
        💡 한국형 A/B 액: 3-6개 · 단비혼합: 7-8개 · 네덜란드 풀스펙: 9-10개
      </div>
      <button onClick={save} disabled={!dirty} style={{
        marginTop: 10, width: '100%', padding: 10, borderRadius: 8, border: 'none',
        background: dirty ? '#0891b2' : '#cbd5e1', color: '#fff',
        fontSize: 15, fontWeight: 800, cursor: dirty ? 'pointer' : 'not-allowed',
      }}>{dirty ? '변경사항 저장' : '저장됨'}</button>
    </div>
  );
};

// ─────────────────────────────────────────
// 관수 밸브 편집
// ─────────────────────────────────────────
const ValvesEditor = ({ count: initial, onSave }) => {
  const [count, setCount] = useState(initial || 14);
  const dirty = count !== initial;
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <span style={{ fontSize: 15, fontWeight: 700, color: '#475569' }}>밸브 수:</span>
        <div className="flex items-center gap-1">
          <button onClick={() => setCount(c => Math.max(1, c - 1))}
                  style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 800 }}>−</button>
          <input type="number" value={count} onChange={(e) => setCount(Math.max(1, Math.min(24, parseInt(e.target.value) || 1)))}
                 style={{ width: 60, padding: '4px 8px', fontSize: 17, fontWeight: 800, textAlign: 'center',
                          border: '1px solid #cbd5e1', borderRadius: 6, color: '#0891b2' }} />
          <button onClick={() => setCount(c => Math.min(24, c + 1))}
                  style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 800 }}>+</button>
        </div>
        <span style={{ fontSize: 14, color: '#94a3b8' }}>(1~24)</span>
      </div>
      <div className="grid grid-cols-6 md:grid-cols-12 gap-2">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} style={{
            padding: '8px 4px', background: '#f0fdf4', borderRadius: 6,
            border: '1px solid #86efac', textAlign: 'center',
            fontSize: 15, fontWeight: 800, color: '#15803d',
          }}>{i + 1}</div>
        ))}
      </div>
      <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 8, padding: 8, background: '#fef3c7', borderRadius: 6 }}>
        💡 소규모 4-8 · 중규모 10-16 · 대규모 18-24 구역
      </div>
      <button onClick={() => onSave(count)} disabled={!dirty} style={{
        marginTop: 10, width: '100%', padding: 10, borderRadius: 8, border: 'none',
        background: dirty ? '#0891b2' : '#cbd5e1', color: '#fff',
        fontSize: 15, fontWeight: 800, cursor: dirty ? 'pointer' : 'not-allowed',
      }}>{dirty ? '변경사항 저장' : '저장됨'}</button>
    </div>
  );
};

// ─────────────────────────────────────────
// 경보 한계값 편집 + 시각화
// ─────────────────────────────────────────
const AlertsEditor = ({ alerts: initial, onSave }) => {
  const [a, setA] = useState(initial);
  const dirty = JSON.stringify(a) !== JSON.stringify(initial);
  const currentEC = 1.8; // mock (RPi telemetry 연동 시 state.ecCurrent)

  return (
    <div className="space-y-4">
      {/* EC 범위 시각화 */}
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
          📊 EC 범위 (현재: <strong style={{ color: '#0891b2' }}>{currentEC} mS/cm</strong>)
        </div>
        <ECRangeBar critical={a.ecCritical} lower={a.ecLower} upper={a.ecUpper} current={currentEC} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* EC */}
        <div style={{ padding: 12, background: '#f0f9ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#1e40af', marginBottom: 8 }}>EC 한계 (mS/cm)</div>
          <ThresholdRow level="🔴 경보 상한" desc="초과 시 경보 발생" value={a.ecUpper} step={0.1}
                        onChange={(v) => setA({ ...a, ecUpper: v })} color="#dc2626" />
          <ThresholdRow level="🟡 경보 하한" desc="미달 시 경보 발생" value={a.ecLower} step={0.1}
                        onChange={(v) => setA({ ...a, ecLower: v })} color="#d97706" />
          <ThresholdRow level="🛑 작동 중단" desc="미달 시 제어 정지" value={a.ecCritical} step={0.1}
                        onChange={(v) => setA({ ...a, ecCritical: v })} color="#991b1b" />
        </div>
        {/* pH */}
        <div style={{ padding: 12, background: '#faf5ff', borderRadius: 8, border: '1px solid #d8b4fe' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#7c3aed', marginBottom: 8 }}>pH 한계</div>
          <ThresholdRow level="🔴 경보 상한" desc="초과 시 경보" value={a.phUpper} step={0.1}
                        onChange={(v) => setA({ ...a, phUpper: v })} color="#dc2626" />
          <ThresholdRow level="🟡 경보 하한" desc="미달 시 경보" value={a.phLower} step={0.1}
                        onChange={(v) => setA({ ...a, phLower: v })} color="#d97706" />
          <ThresholdRow level="🛑 작동 중단" desc="미달 시 제어 정지" value={a.phCritical} step={0.1}
                        onChange={(v) => setA({ ...a, phCritical: v })} color="#991b1b" />
        </div>
      </div>

      {/* ⭐ 신규: 정밀도 (히스테리시스) + 다량공급 (편차) + 최소 일사량 */}
      <div style={{ padding: 12, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>
          ⚙️ 제어 정밀도 (운영 안정성)
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
              🎯 정밀도 (히스테리시스)
            </div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>
              목표값 ±이 범위 안에선 도싱 안 함 (펌프 hunting 방지)
            </div>
            <ThresholdRow level="EC ±" desc="mS/cm" value={a.ecHysteresis ?? 0.1} step={0.01}
                          onChange={(v) => setA({ ...a, ecHysteresis: v })} color="#0891b2" />
            <ThresholdRow level="pH ±" desc="" value={a.phHysteresis ?? 0.1} step={0.01}
                          onChange={(v) => setA({ ...a, phHysteresis: v })} color="#7c3aed" />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
              ⚡ 다량공급 (편차 임계값)
            </div>
            <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>
              목표 대비 이 차이 이상이면 빠른 보정 모드 (강한 도싱)
            </div>
            <ThresholdRow level="EC 갭" desc="mS/cm" value={a.ecDeviation ?? 0.5} step={0.1}
                          onChange={(v) => setA({ ...a, ecDeviation: v })} color="#dc2626" />
            <ThresholdRow level="pH 갭" desc="" value={a.phDeviation ?? 0.5} step={0.1}
                          onChange={(v) => setA({ ...a, phDeviation: v })} color="#dc2626" />
          </div>
        </div>

        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed #cbd5e1' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
            ☀️ 최소 일사량 (solar 트리거)
          </div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 6 }}>
            현재 일사량이 이 값 미만이면 solar 모드 트리거 무시 (흐린 날 노이즈 방지)
          </div>
          <ThresholdRow level="기준값" desc="W/m²" value={a.minSolarWm2 ?? 50} step={10}
                        onChange={(v) => setA({ ...a, minSolarWm2: v })} color="#d97706" />
        </div>
      </div>

      <button onClick={() => onSave(a)} disabled={!dirty} style={{
        marginTop: 4, width: '100%', padding: 10, borderRadius: 8, border: 'none',
        background: dirty ? '#0891b2' : '#cbd5e1', color: '#fff',
        fontSize: 15, fontWeight: 800, cursor: dirty ? 'pointer' : 'not-allowed',
      }}>{dirty ? '변경사항 저장' : '저장됨'}</button>
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
        <span style={{ position: 'absolute', left: `calc(${pct(current)}% - 14px)`, top: -16, fontSize: 13, fontWeight: 800, color: '#0891b2' }}>현재</span>
      </div>
      <div className="flex justify-between mt-1" style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>
        {[0, 1, 2, 3, 4, 5].map(v => <span key={v}>{v}</span>)}
      </div>
    </div>
  );
};

const ThresholdRow = ({ level, desc, value, step, onChange, color }) => (
  <div className="flex items-center justify-between gap-3 mb-2">
    <div>
      <div style={{ fontSize: 15, fontWeight: 800, color }}>{level}</div>
      <div style={{ fontSize: 13, color: '#64748b' }}>{desc}</div>
    </div>
    <input type="number" value={value} step={step} onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
           style={{ width: 70, padding: '4px 8px', fontSize: 16, fontWeight: 800, color,
                    border: `1px solid ${color}40`, borderRadius: 6, textAlign: 'right' }} />
  </div>
);

// ─────────────────────────────────────────
// 하드웨어 편집
// ─────────────────────────────────────────
// ─────────────────────────────────────────
// 🔌 릴레이 채널 매핑 — 32CH 통합 view
// 환경 (0~7) + 양액 도싱 (8~13) + 메인펌프 (14) + 교반기 (15)
//   + 밸브 (16~29) + 원수솔레노이드 (30) + 예비 (31)
// ─────────────────────────────────────────
const RelayChannelMap = ({ tanks, valveCount, hardware, onSaveHardware }) => {
  const [hw, setHw] = useState(hardware || {});
  useEffect(() => { setHw(hardware || {}); }, [hardware]);
  const dirty = JSON.stringify(hw) !== JSON.stringify(hardware || {});

  // 32 channels 일람 — 채널마다 무엇이 할당되어 있는지 계산
  const slots = Array.from({ length: 32 }, (_, ch) => {
    // 0~7: env
    if (ch < 8) return { ch, zone: 'env', label: '환경 출력', note: '장치 관리에서 매핑', editable: false };
    // 8~13: dosing tanks (tanks[i].modbusReg 기준)
    const tank = (tanks || []).find(t => Number(t.modbusReg) === ch);
    if (tank) return { ch, zone: 'dosing', label: tank.label || tank.name || `탱크 ${tank.id}`, note: '도싱 펌프', editable: false };
    // 14: main pump
    if (ch === (hw.mainPumpCh ?? 14)) return { ch, zone: 'main', label: '메인 송수 펌프', note: 'hardware.mainPumpCh', editable: true, field: 'mainPumpCh' };
    // 15: agitator
    if (ch === (hw.agitatorCh ?? 15)) return { ch, zone: 'agit', label: '교반기', note: 'hardware.agitatorCh', editable: true, field: 'agitatorCh' };
    // 16~29: valves
    const valves = hw.valves || [];
    const valve = valves.find(v => Number(v.ch) === ch);
    if (valve) return { ch, zone: 'valve', label: valve.name || `V${valve.id}`, note: '관수 밸브', editable: false };
    // 30: raw water
    if (ch === (hw.rawSolenoidCh ?? 30)) return { ch, zone: 'raw', label: '원수 보충 솔레노이드', note: 'hardware.rawSolenoidCh', editable: true, field: 'rawSolenoidCh' };
    // 31: spare
    return { ch, zone: 'spare', label: '예비', note: '', editable: false };
  });

  const zoneColor = {
    env: { bg: '#f1f5f9', fg: '#475569', border: '#cbd5e1' },
    dosing: { bg: '#ecfeff', fg: '#0e7490', border: '#67e8f9' },
    main: { bg: '#fef3c7', fg: '#92400e', border: '#fcd34d' },
    agit: { bg: '#fef3c7', fg: '#92400e', border: '#fcd34d' },
    valve: { bg: '#dbeafe', fg: '#1e40af', border: '#93c5fd' },
    raw: { bg: '#e0f2fe', fg: '#0369a1', border: '#7dd3fc' },
    spare: { bg: '#f8fafc', fg: '#94a3b8', border: '#e2e8f0' },
  };

  // 밸브 채널 일괄 편집
  const valves = hw.valves && hw.valves.length ? hw.valves
    : Array.from({ length: valveCount || 14 }, (_, i) => ({ id: i + 1, name: `V${i + 1}`, ch: 16 + i }));
  const setValveCh = (idx, ch) => {
    const next = [...valves];
    next[idx] = { ...next[idx], ch };
    setHw({ ...hw, valves: next });
  };

  return (
    <div className="space-y-3">
      <div style={{ fontSize: 14, color: '#64748b', padding: 10, background: '#fef3c7', borderRadius: 6 }}>
        💡 단일 32CH 릴레이로 환경(0~7) + 양액(8~30) 통합 제어. 환경 채널은 [장치 관리] 에서 매핑.
        양액 도싱(8~13) 은 [도싱 탱크] 의 modbusReg, 밸브(16~29) 는 아래에서 직접 편집.
      </div>

      {/* 32 channel grid — 모바일 정확히 8열 fit (좌우 여백 최소화) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 3 }}>
        {slots.map((s) => {
          const c = zoneColor[s.zone];
          return (
            <div key={s.ch} style={{
              padding: '5px 2px', background: c.bg, border: `1px solid ${c.border}`,
              borderRadius: 5, textAlign: 'center', minHeight: 54,
              minWidth: 0, overflow: 'hidden',
            }}>
              <div style={{ fontFamily: 'ui-monospace, SF Mono, monospace',
                            fontSize: 10, fontWeight: 700, color: c.fg, opacity: 0.7 }}>
                CH{String(s.ch).padStart(2, '0')}
              </div>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: c.fg,
                            marginTop: 2, lineHeight: 1.15, wordBreak: 'keep-all' }}>
                {s.label}
              </div>
            </div>
          );
        })}
      </div>

      {/* 편집 가능 특수 채널 */}
      <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginTop: 4 }}>⚙️ 본체·보조 채널</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumIn label="메인 송수 펌프" value={hw.mainPumpCh ?? 14}
               onChange={(v) => setHw({ ...hw, mainPumpCh: v })} />
        <NumIn label="교반기" value={hw.agitatorCh ?? 15}
               onChange={(v) => setHw({ ...hw, agitatorCh: v })} />
        <NumIn label="원수 보충 솔레노이드" value={hw.rawSolenoidCh ?? 30}
               onChange={(v) => setHw({ ...hw, rawSolenoidCh: v })} />
        <NumIn label="예비" value={hw.spareCh ?? 31}
               onChange={(v) => setHw({ ...hw, spareCh: v })} />
      </div>

      {/* 밸브 채널 일괄 편집 */}
      <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginTop: 4 }}>🚿 밸브 채널 (V1~V{valves.length})</div>
      <div className="grid grid-cols-3 md:grid-cols-7 gap-2">
        {valves.map((v, i) => (
          <div key={v.id}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 2 }}>{v.name}</div>
            <input type="number" value={v.ch ?? ''} min="0" max="31"
              onChange={(e) => setValveCh(i, parseInt(e.target.value) || 0)}
              style={{ width: '100%', padding: '4px 8px', fontSize: 14, fontWeight: 800, color: '#1e40af',
                       border: '1px solid #cbd5e1', borderRadius: 6, outline: 'none' }} />
          </div>
        ))}
      </div>

      <button onClick={() => onSaveHardware(hw)} disabled={!dirty} style={{
        width: '100%', padding: 10, borderRadius: 8, border: 'none',
        background: dirty ? '#0891b2' : '#cbd5e1', color: '#fff',
        fontSize: 15, fontWeight: 800, cursor: dirty ? 'pointer' : 'not-allowed',
      }}>{dirty ? '변경사항 저장' : '저장됨'}</button>
    </div>
  );
};

const HardwareEditor = ({ hardware: initial, onSave }) => {
  const [hw, setHw] = useState(initial);
  const dirty = JSON.stringify(hw) !== JSON.stringify(initial);
  return (
    <div className="space-y-3">
      <div style={{ fontSize: 15, color: '#64748b', padding: 8, background: '#fef3c7', borderRadius: 6 }}>
        💡 RPi Modbus RTU 통신용. 실제 양액기 하드웨어 설치 후 등록.
      </div>
      <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginTop: 4 }}>📟 Modbus 매핑</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumIn label="Modbus Unit" value={hw.modbusUnit} onChange={(v) => setHw({ ...hw, modbusUnit: v })} />
        <NumIn label="EC 센서 주소" value={hw.ecSensorAddr} onChange={(v) => setHw({ ...hw, ecSensorAddr: v })} />
        <NumIn label="pH 센서 주소" value={hw.phSensorAddr} onChange={(v) => setHw({ ...hw, phSensorAddr: v })} />
        <NumIn label="유량 센서 주소" value={hw.flowSensorAddr} onChange={(v) => setHw({ ...hw, flowSensorAddr: v })} />
        <NumIn label="펌프 응답 (ms)" value={hw.pumpResponse} onChange={(v) => setHw({ ...hw, pumpResponse: v })} />
        <NumIn label="도징 펄스 단위 (mL)" value={hw.dosingPulseUnit} onChange={(v) => setHw({ ...hw, dosingPulseUnit: v })} />
      </div>

      {/* ⭐ 신규: 교반기 시간 */}
      <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginTop: 4 }}>🌀 교반기 사이클</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <NumIn label="작동 (초)" value={hw.mixerOnSec ?? 30} onChange={(v) => setHw({ ...hw, mixerOnSec: v })} />
        <NumIn label="정지 (분)" value={hw.mixerOffMin ?? 50} onChange={(v) => setHw({ ...hw, mixerOffMin: v })} />
      </div>

      {/* ⭐ 신규: 산/알칼리 모드 + 온도 기준 + 유량 단위 */}
      <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginTop: 4 }}>⚙️ 사용 환경</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#475569', marginBottom: 4 }}>산/알칼리 운영</div>
          <select value={hw.acidAlkaliMode ?? 'both'} onChange={(e) => setHw({ ...hw, acidAlkaliMode: e.target.value })}
                  style={{ width: '100%', padding: '6px 10px', fontSize: 15, fontWeight: 700, color: '#0891b2',
                           border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', background: '#fff' }}>
            <option value="both">둘 다 사용</option>
            <option value="acid">산만</option>
            <option value="alkali">알칼리만</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#475569', marginBottom: 4 }}>유량 단위</div>
          <select value={hw.flowUnit ?? 'L'} onChange={(e) => setHw({ ...hw, flowUnit: e.target.value })}
                  style={{ width: '100%', padding: '6px 10px', fontSize: 15, fontWeight: 700, color: '#0891b2',
                           border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', background: '#fff' }}>
            <option value="mL">mL</option>
            <option value="L">L</option>
            <option value="10L">10L</option>
          </select>
        </div>
        <NumIn label="원수 온도 기준 (°C)" value={hw.rawTempTarget ?? 18} onChange={(v) => setHw({ ...hw, rawTempTarget: v })} />
        <NumIn label="외부 온도 기준 (°C)" value={hw.outsideTempTarget ?? 22} onChange={(v) => setHw({ ...hw, outsideTempTarget: v })} />
      </div>

      {/* 직접 제어 자동 OFF — 0 = 비활성 (사용자 명시 종료까지 ON) */}
      <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a', marginTop: 4 }}>⚙ 직접 제어 안전</div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#475569', marginBottom: 4 }}>자동 OFF 시간 (초)</div>
          <input type="number" min="0" step="10"
            value={hw.directAutoOffSec ?? 0}
            onChange={(e) => setHw({ ...hw, directAutoOffSec: Math.max(0, parseInt(e.target.value) || 0) })}
            style={{ width: '100%', padding: '6px 10px', fontSize: 15, fontWeight: 700, color: '#0891b2',
                     border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none', background: '#fff' }} />
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
            0 = 자동 OFF 없음 (수동 종료까지 ON 유지)
          </div>
        </div>
      </div>

      <button onClick={() => onSave(hw)} disabled={!dirty} style={{
        width: '100%', padding: 10, borderRadius: 8, border: 'none',
        background: dirty ? '#0891b2' : '#cbd5e1', color: '#fff',
        fontSize: 15, fontWeight: 800, cursor: dirty ? 'pointer' : 'not-allowed',
      }}>{dirty ? '변경사항 저장' : '저장됨'}</button>
    </div>
  );
};

const NumIn = ({ label, value, onChange }) => (
  <div>
    <div style={{ fontSize: 14, fontWeight: 700, color: '#475569', marginBottom: 4 }}>{label}</div>
    <input type="number" value={value} onChange={(e) => onChange(parseInt(e.target.value) || 0)}
           style={{ width: '100%', padding: '6px 10px', fontSize: 16, fontWeight: 800, color: '#0891b2',
                    border: '1px solid #cbd5e1', borderRadius: 8, outline: 'none' }} />
  </div>
);

// ─────────────────────────────────────────
// 센서 보정 (EC 1-pt + pH 3-pt)
// ─────────────────────────────────────────
const CalibrationEditor = ({ farmId }) => {
  const [ecHistory, setEcHistory] = useState([]);
  const [phHistory, setPhHistory] = useState([]);
  const [step, setStep] = useState(null); // null | 'ec' | 'ph-1' | 'ph-2' | 'ph-3'
  const [phMeasurements, setPhMeasurements] = useState({ '4.01': '', '6.86': '', '9.18': '' });
  const [ecMeasurement, setEcMeasurement] = useState('');

  const reload = async () => {
    try {
      const [ec, ph] = await Promise.all([
        nutrientApi.listCalibrations(farmId, 'ec'),
        nutrientApi.listCalibrations(farmId, 'ph'),
      ]);
      setEcHistory(ec || []);
      setPhHistory(ph || []);
    } catch { /* 빈 이력으로 표시 */ }
  };

  useEffect(() => { reload(); }, [farmId]);

  const latestEc = ecHistory[0];
  const latestPh = phHistory[0];

  const completeEc = async () => {
    const measured = parseFloat(ecMeasurement);
    if (isNaN(measured)) return alert('측정값을 입력하세요');
    const offset = +(measured - 1.413).toFixed(3);
    await nutrientApi.createCalibration(farmId, {
      sensorType: 'ec', standardValue: 1.413, measuredValue: measured, offset,
    });
    setEcMeasurement('');
    setStep(null);
    await reload();
  };

  const completePh = async () => {
    const points = [4.01, 6.86, 9.18].map(buffer => {
      const measured = parseFloat(phMeasurements[String(buffer)]);
      return { buffer, measured: isNaN(measured) ? buffer : measured, offset: isNaN(measured) ? 0 : +(measured - buffer).toFixed(3) };
    });
    const totalOffset = points.reduce((s, p) => s + Math.abs(p.offset), 0);
    const slope = +(100 - totalOffset * 10).toFixed(1); // 단순 근사 (실제 보정엔 별도 계산식 필요)
    await nutrientApi.createCalibration(farmId, {
      sensorType: 'ph', points, slope,
    });
    setPhMeasurements({ '4.01': '', '6.86': '', '9.18': '' });
    setStep(null);
    await reload();
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

  return (
    <div className="space-y-3">
      <div style={{ fontSize: 14, color: '#64748b', padding: 8, background: '#eff6ff', borderRadius: 6, border: '1px solid #bfdbfe' }}>
        💡 권장 주기: <strong>월 1회</strong> · 표준액에 센서 5분 침지 후 안정화되면 보정 시작
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* EC 1-포인트 보정 */}
        <div style={{ padding: 12, background: '#f0f9ff', borderRadius: 10, border: '1px solid #bfdbfe' }}>
          <div className="flex justify-between items-start mb-2">
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#1e40af' }}>EC 센서 (1-포인트)</div>
              <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>KCl 표준액 1.413 mS/cm (25°C)</div>
            </div>
            <span style={{
              padding: '2px 6px', fontSize: 13, fontWeight: 700,
              background: '#dbeafe', color: '#1e40af', borderRadius: 4,
            }}>마지막: {fmtDate(latestEc?.calibratedAt)}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-2" style={{ fontSize: 14 }}>
            <CalCell label="표준값" value={latestEc ? `${latestEc.standardValue} mS` : '—'} color="#1e40af" />
            <CalCell label="측정값" value={latestEc ? `${latestEc.measuredValue} mS` : '—'} color="#0891b2" />
            <CalCell label="오프셋"
                     value={latestEc ? `${latestEc.offset >= 0 ? '+' : ''}${latestEc.offset}` : '—'}
                     color={latestEc && Math.abs(latestEc.offset) < 0.05 ? '#16a34a' : '#d97706'} />
          </div>
          <button onClick={() => setStep('ec')} style={{
            width: '100%', padding: '8px', borderRadius: 6, border: 'none',
            background: '#1e40af', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
          }}>EC 재보정 시작</button>
        </div>

        {/* pH 3-포인트 보정 */}
        <div style={{ padding: 12, background: '#faf5ff', borderRadius: 10, border: '1px solid #d8b4fe' }}>
          <div className="flex justify-between items-start mb-2">
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#7c3aed' }}>pH 센서 (3-포인트)</div>
              <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>완충액 4.01 / 6.86 / 9.18</div>
            </div>
            <span style={{
              padding: '2px 6px', fontSize: 13, fontWeight: 700,
              background: '#ede9fe', color: '#7c3aed', borderRadius: 4,
            }}>슬로프: {latestPh ? `${latestPh.slope}%` : '—'}</span>
          </div>
          <div className="space-y-1 mb-2">
            {(latestPh?.points || [{buffer:4.01},{buffer:6.86},{buffer:9.18}]).map((p, i) => (
              <div key={i} className="flex justify-between items-center" style={{ fontSize: 14, padding: '4px 6px', background: '#fff', borderRadius: 4 }}>
                <span style={{ color: '#7c3aed', fontWeight: 700 }}>pH {p.buffer}</span>
                <span style={{ color: '#64748b' }}>측정 {p.measured ?? '—'}</span>
                <span style={{ color: p.offset != null && Math.abs(p.offset) < 0.1 ? '#16a34a' : '#d97706', fontWeight: 700 }}>
                  {p.offset != null ? `${p.offset >= 0 ? '+' : ''}${p.offset}` : '—'}
                </span>
              </div>
            ))}
          </div>
          <button onClick={() => setStep('ph-1')} style={{
            width: '100%', padding: '8px', borderRadius: 6, border: 'none',
            background: '#7c3aed', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
          }}>pH 재보정 시작</button>
        </div>
      </div>

      {/* 보정 진행 모달 (인라인) */}
      {step && (
        <div style={{ padding: 12, background: '#fef3c7', borderRadius: 8, border: '1px solid #fcd34d' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#92400e', marginBottom: 6 }}>
            🧪 {step === 'ec' ? 'EC 표준액 1.413 mS/cm' :
                step === 'ph-1' ? 'pH 4.01 완충액' :
                step === 'ph-2' ? 'pH 6.86 완충액' : 'pH 9.18 완충액'}에 센서 침지 중…
          </div>
          <div style={{ fontSize: 14, color: '#78350f', marginBottom: 8 }}>
            ① 센서를 표준액에 5분간 담그세요 · ② 안정된 측정값을 입력하세요 · ③ [확인] 으로 저장
          </div>
          <div className="flex items-center gap-2 mb-2">
            <span style={{ fontSize: 14, fontWeight: 700, color: '#78350f' }}>측정값:</span>
            <input
              type="number" step="0.01"
              value={step === 'ec' ? ecMeasurement :
                     step === 'ph-1' ? phMeasurements['4.01'] :
                     step === 'ph-2' ? phMeasurements['6.86'] : phMeasurements['9.18']}
              onChange={(e) => {
                if (step === 'ec') setEcMeasurement(e.target.value);
                else if (step === 'ph-1') setPhMeasurements(p => ({ ...p, '4.01': e.target.value }));
                else if (step === 'ph-2') setPhMeasurements(p => ({ ...p, '6.86': e.target.value }));
                else setPhMeasurements(p => ({ ...p, '9.18': e.target.value }));
              }}
              placeholder={step === 'ec' ? '1.413' : step === 'ph-1' ? '4.01' : step === 'ph-2' ? '6.86' : '9.18'}
              style={{ flex: 1, padding: '6px 10px', fontSize: 15, fontWeight: 700,
                       border: '1px solid #fcd34d', borderRadius: 6, color: '#0f172a' }} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => {
              if (step === 'ec') completeEc();
              else if (step === 'ph-1') setStep('ph-2');
              else if (step === 'ph-2') setStep('ph-3');
              else completePh();
            }} style={{
              padding: '6px 14px', background: '#16a34a', color: '#fff', border: 'none',
              borderRadius: 6, fontSize: 15, fontWeight: 700, cursor: 'pointer',
            }}>✓ {step === 'ec' || step === 'ph-3' ? '저장' : '다음'}</button>
            <button onClick={() => setStep(null)} style={{
              padding: '6px 14px', background: '#fff', color: '#64748b',
              border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 15, fontWeight: 700, cursor: 'pointer',
            }}>취소</button>
          </div>
        </div>
      )}

      {/* 이력 */}
      <div>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#475569', marginBottom: 6 }}>📜 보정 이력</div>
        <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <table style={{ width: '100%', fontSize: 14, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
                <th style={{ padding: 6, textAlign: 'left', fontWeight: 700, color: '#475569' }}>일시</th>
                <th style={{ padding: 6, textAlign: 'left', fontWeight: 700, color: '#475569' }}>센서</th>
                <th style={{ padding: 6, textAlign: 'right', fontWeight: 700, color: '#475569' }}>오프셋/슬로프</th>
                <th style={{ padding: 6, textAlign: 'right', fontWeight: 700, color: '#475569' }}>담당</th>
              </tr>
            </thead>
            <tbody>
              {ecHistory.length === 0 && phHistory.length === 0 && (
                <tr><td colSpan={4} style={{ padding: 16, textAlign: 'center', color: '#94a3b8' }}>이력 없음 — 보정을 시작하면 자동 기록됩니다</td></tr>
              )}
              {ecHistory.map((h) => (
                <tr key={h.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: 6, color: '#64748b' }}>{fmtDate(h.calibratedAt)}</td>
                  <td style={{ padding: 6, color: '#1e40af', fontWeight: 700 }}>EC</td>
                  <td style={{ padding: 6, textAlign: 'right', color: Math.abs(h.offset || 0) < 0.05 ? '#16a34a' : '#d97706', fontWeight: 700 }}>
                    {h.offset != null ? `${h.offset >= 0 ? '+' : ''}${h.offset}` : '—'}
                  </td>
                  <td style={{ padding: 6, textAlign: 'right', color: '#64748b' }}>{h.performedBy || '—'}</td>
                </tr>
              ))}
              {phHistory.map((h) => (
                <tr key={h.id} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: 6, color: '#64748b' }}>{fmtDate(h.calibratedAt)}</td>
                  <td style={{ padding: 6, color: '#7c3aed', fontWeight: 700 }}>pH</td>
                  <td style={{ padding: 6, textAlign: 'right', color: (h.slope || 0) > 95 ? '#16a34a' : '#d97706', fontWeight: 700 }}>
                    {h.slope != null ? `${h.slope}%` : '—'}
                  </td>
                  <td style={{ padding: 6, textAlign: 'right', color: '#64748b' }}>{h.performedBy || '—'}</td>
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
    <div style={{ fontSize: 13, color: '#94a3b8' }}>{label}</div>
    <div style={{ fontSize: 15, fontWeight: 800, color }}>{value}</div>
  </div>
);

// ─────────────────────────────────────────
// 경보 이력 (검색·필터·해결처리)
// ─────────────────────────────────────────
const AlertHistory = ({ farmId }) => {
  const [history, setHistory] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    try {
      const rows = await nutrientApi.listAlerts(farmId, { limit: 200 });
      setHistory(rows || []);
    } catch { /* 빈 상태 */ }
    finally { setLoading(false); }
  };
  useEffect(() => { reload(); }, [farmId]);

  const resolveOne = async (id) => {
    try {
      await nutrientApi.resolveAlert(farmId, id, '수동 해결');
      await reload();
    } catch (e) { alert(`해결 처리 실패: ${e.response?.data?.error || e.message}`); }
  };

  const filtered = history.filter(a => {
    if (filter === 'warning' && a.severity !== 'warning') return false;
    if (filter === 'critical' && a.severity !== 'critical') return false;
    if (filter === 'unresolved' && a.resolved) return false;
    if (search && !a.alertType?.includes(search) && !a.message?.includes(search) && !a.action?.includes(search)) return false;
    return true;
  });

  const fmtDate = (d) => d ? new Date(d).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

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
            fontSize: 14, fontWeight: 700, cursor: 'pointer',
          }}>{f.label} <span style={{ opacity: 0.6 }}>({f.n})</span></button>
        ))}
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="🔍 검색"
               style={{ flex: 1, minWidth: 100, padding: '4px 10px', fontSize: 14,
                        border: '1px solid #cbd5e1', borderRadius: 16, outline: 'none' }} />
      </div>

      {/* 리스트 */}
      <div style={{ maxHeight: 280, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 15, color: '#94a3b8' }}>불러오는 중…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', fontSize: 15, color: '#94a3b8' }}>
            {history.length === 0 ? '경보 이력 없음 — 양액 시스템 가동 후 자동 기록됩니다' : '조건에 맞는 경보가 없습니다'}
          </div>
        ) : filtered.map(a => (
          <div key={a.id} style={{
            padding: '10px 12px', borderBottom: '1px solid #f1f5f9',
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <span style={{
              padding: '2px 6px', borderRadius: 4, fontSize: 13, fontWeight: 800,
              background: sevBg[a.severity], color: sevColor[a.severity], flexShrink: 0,
            }}>{a.severity === 'critical' ? '🛑' : '⚠️'}</span>
            <div style={{ flex: 1 }}>
              <div className="flex justify-between items-start gap-2">
                <span style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{a.alertType}</span>
                <span style={{ fontSize: 13, color: '#94a3b8', flexShrink: 0 }}>{fmtDate(a.occurredAt)}</span>
              </div>
              <div style={{ fontSize: 14, color: '#475569', marginTop: 2 }}>{a.message}</div>
              {a.value != null && (
                <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
                  측정 <strong style={{ color: sevColor[a.severity] }}>{a.value}</strong>
                  {a.threshold != null && <> {' '}/ 한계 <strong>{a.threshold}</strong></>}
                </div>
              )}
              <div className="flex justify-between items-center" style={{ marginTop: 2 }}>
                <span style={{ fontSize: 13, color: a.resolved ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                  {a.resolved ? '✓ 해결' : '◌ 진행중'}{a.action ? ` · ${a.action}` : ''}
                </span>
                {!a.resolved && (
                  <button onClick={() => resolveOne(a.id)} style={{
                    padding: '2px 8px', fontSize: 13, fontWeight: 700,
                    background: '#16a34a', color: '#fff', border: 'none',
                    borderRadius: 4, cursor: 'pointer',
                  }}>해결 처리</button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 6, textAlign: 'right' }}>
        총 {filtered.length}건 표시 (전체 {history.length}건)
      </div>
    </div>
  );
};

// ─────────────────────────────────────────
// 카운터 초기화 (확인 절차 필수)
// ─────────────────────────────────────────
const CounterReset = ({ farmId }) => {
  const [counters, setCounters] = useState(null);
  const [confirming, setConfirming] = useState(null); // null | 'dose'|'irrigation'|'cycles'|'runtime'

  const reload = async () => {
    try {
      const c = await nutrientApi.getCounters(farmId);
      setCounters(c);
    } catch { /* 빈 상태 */ }
  };
  useEffect(() => { reload(); }, [farmId]);

  const doReset = async (target) => {
    try {
      await nutrientApi.resetCounter(farmId, target);
      setConfirming(null);
      await reload();
    } catch (e) { alert(`초기화 실패: ${e.response?.data?.error || e.message}`); }
  };

  const doFilterChange = async () => {
    if (!confirm('필터 교체 기록을 남기시겠습니까?')) return;
    try {
      await nutrientApi.recordFilterChange(farmId);
      await reload();
    } catch (e) { alert(`기록 실패: ${e.response?.data?.error || e.message}`); }
  };

  if (!counters) {
    return <div style={{ padding: 16, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>불러오는 중…</div>;
  }

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('ko-KR') : '—';

  const cards = [
    { key: 'dose',       label: '누적 도싱량', value: counters.totalDoseL.toLocaleString(),       unit: 'L',  color: '#0891b2', icon: '💧' },
    { key: 'irrigation', label: '누적 관수량', value: counters.totalIrrigationL.toLocaleString(), unit: 'L',  color: '#16a34a', icon: '🚿' },
    { key: 'cycles',     label: '누적 회수',   value: counters.totalCycles.toLocaleString(),      unit: '회', color: '#7c3aed', icon: '🔁' },
    { key: 'runtime',    label: '펌프 가동',   value: Math.floor(counters.pumpRuntimeMin / 60).toLocaleString(), unit: '시간', color: '#d97706', icon: '⚙️' },
  ];

  return (
    <div>
      <div style={{
        padding: 10, marginBottom: 10, background: '#fef2f2', borderRadius: 8,
        border: '1px solid #fca5a5', fontSize: 14, color: '#991b1b',
      }}>
        ⚠️ <strong>주의</strong> · 초기화는 되돌릴 수 없습니다. 필터 교체·정비 후에만 사용하세요.
        <div style={{ fontSize: 13, color: '#dc2626', marginTop: 4 }}>
          마지막 초기화: <strong>{fmtDate(counters.lastResetAt)}</strong> · 마지막 필터 교체: <strong>{fmtDate(counters.filterChangeAt)}</strong>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        {cards.map(c => (
          <div key={c.key} style={{
            padding: 10, background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0',
          }}>
            <div style={{ fontSize: 19 }}>{c.icon}</div>
            <div style={{ fontSize: 13, color: '#64748b', fontWeight: 700, marginTop: 2 }}>{c.label}</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: c.color, marginTop: 4 }}>
              {c.value} <span style={{ fontSize: 13, fontWeight: 600 }}>{c.unit}</span>
            </div>
            <button onClick={() => setConfirming(c.key)} style={{
              marginTop: 6, width: '100%', padding: '4px', borderRadius: 4,
              border: '1px solid #cbd5e1', background: '#fff', color: '#dc2626',
              fontSize: 13, fontWeight: 700, cursor: 'pointer',
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
          <div style={{ fontSize: 15, fontWeight: 700, color: '#9a3412' }}>🔧 필터 교체 기록</div>
          <div style={{ fontSize: 13, color: '#c2410c', marginTop: 2 }}>마지막 교체: {fmtDate(counters.filterChangeAt)} · 권장 주기 90일</div>
        </div>
        <button onClick={doFilterChange} style={{
          padding: '6px 12px', borderRadius: 6, border: 'none',
          background: '#ea580c', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
        }}>교체 완료 기록</button>
      </div>

      {/* 확인 모달 (inline) */}
      {confirming && (
        <div style={{
          marginTop: 10, padding: 12, background: '#fef2f2', borderRadius: 8,
          border: '2px solid #dc2626',
        }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#991b1b', marginBottom: 6 }}>
            🛑 정말 초기화하시겠습니까?
          </div>
          <div style={{ fontSize: 14, color: '#7f1d1d', marginBottom: 8 }}>
            <strong>{cards.find(c => c.key === confirming)?.label}</strong> 누적값이 0으로 리셋됩니다.
            <br />이 작업은 <strong>되돌릴 수 없습니다</strong>.
          </div>
          <div className="flex gap-2">
            <button onClick={() => doReset(confirming)} style={{
              padding: '6px 14px', background: '#dc2626', color: '#fff', border: 'none',
              borderRadius: 6, fontSize: 15, fontWeight: 700, cursor: 'pointer',
            }}>네, 초기화합니다</button>
            <button onClick={() => setConfirming(null)} style={{
              padding: '6px 14px', background: '#fff', color: '#64748b',
              border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 15, fontWeight: 700, cursor: 'pointer',
            }}>취소</button>
          </div>
        </div>
      )}
    </div>
  );
};
