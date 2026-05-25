import { useEffect, useMemo, useState } from 'react';
import * as nutrientApi from '../../services/nutrientApi';

export default function NutrientScenarios({ farmId }) {
  const [scenarios, setScenarios] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  // 구역(밸브) 그룹 + 품목/식재수 정보 — ValvesSection 그룹별 묶음 렌더용
  const [valveConfig, setValveConfig] = useState({ valveGroups: [], valves: [] });

  // 초기 로드
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [data, cfg] = await Promise.all([
          nutrientApi.listScenarios(farmId),
          nutrientApi.getConfig(farmId).catch(() => ({})),
        ]);
        if (cancelled) return;
        setScenarios(data || []);
        setValveConfig({
          valveGroups: cfg.valveGroups || [],
          valves: cfg.valves || [],
        });
      } catch (e) {
        if (!cancelled) setError(e.response?.data?.error || e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [farmId]);

  // patch 후 로컬 state 즉시 반영 + 서버 저장 (debounce 는 향후 추가 가능)
  const updateScenario = async (id, updates) => {
    setScenarios(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    try {
      setSaving(true);
      await nutrientApi.updateScenario(farmId, id, updates);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  const addScenario = async () => {
    if (scenarios.length >= 12) return alert('시나리오는 최대 12개까지');
    try {
      setSaving(true);
      const row = await nutrientApi.createScenario(farmId, {
        name: `시나리오 ${scenarios.length + 1}`,
        enabled: true,
        ecTarget: 2.0, phTarget: 6.0,
        dosingRatio: { A: 20, B: 20, C: 20, D: 20, acid: 10, F: 10 },
        irrigationMode: 'timer',
        timerInterval: '00:30', timerStart: '08:00', timerEnd: '20:00',
        days: [1, 2, 3, 4, 5, 6, 0],
        valves: Array(14).fill({ duration: 600, volume: 150 }),
      });
      setScenarios(prev => [...prev, row]);
      setEditingId(row.id);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteScenario = async (id) => {
    if (!confirm('이 시나리오를 삭제할까요?')) return;
    try {
      setSaving(true);
      await nutrientApi.deleteScenario(farmId, id);
      setScenarios(prev => prev.filter(s => s.id !== id));
      if (editingId === id) setEditingId(null);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  const activate = async (id) => {
    try {
      setSaving(true);
      await nutrientApi.activateScenario(farmId, id);
      setScenarios(prev => prev.map(s => ({ ...s, active: s.id === id })));
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center', color: '#64748b', fontSize: 14 }}>시나리오 불러오는 중…</div>;
  }

  return (
    <div className="space-y-3">
      {/* 에러 배너 */}
      {error && (
        <div style={{
          padding: '10px 14px', background: '#fee2e2', border: '1px solid #fca5a5',
          borderRadius: 10, color: '#991b1b', fontSize: 13, fontWeight: 700,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>⚠️ {error}</span>
          <button onClick={() => setError(null)} style={{
            background: 'transparent', border: 'none', color: '#991b1b',
            fontSize: 16, cursor: 'pointer',
          }}>✕</button>
        </div>
      )}

      {/* 헤더 + 추가 버튼 */}
      <div style={{
        background: '#fff', borderRadius: 12, padding: '10px 14px', border: '1px solid #e2e8f0',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: '#475569' }}>
          시나리오 <strong style={{ color: '#0891b2' }}>{scenarios.length}</strong> / 최대 12
          {saving && <span style={{ marginLeft: 8, fontSize: 12, color: '#94a3b8' }}>저장 중…</span>}
        </span>
        <button onClick={addScenario} disabled={scenarios.length >= 12 || saving}
          style={{
            background: scenarios.length >= 12 || saving ? '#cbd5e1' : '#0891b2',
            color: '#fff', border: 'none', padding: '6px 14px', borderRadius: 8,
            fontSize: 14, fontWeight: 800,
            cursor: scenarios.length >= 12 || saving ? 'not-allowed' : 'pointer',
          }}>+ 시나리오 추가</button>
      </div>

      {/* 시나리오 카드 리스트 */}
      {scenarios.length === 0 ? (
        <div style={{
          padding: '40px 20px', textAlign: 'center', background: '#fff',
          borderRadius: 12, border: '1px dashed #cbd5e1', color: '#64748b', fontSize: 14,
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>등록된 시나리오가 없습니다</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>+ 시나리오 추가 버튼을 눌러 첫 시나리오를 만드세요</div>
        </div>
      ) : (
        <div className="space-y-2">
          {scenarios.map((s, idx) => (
            <ScenarioCard
              key={s.id} scenario={s} index={idx + 1} isEditing={editingId === s.id}
              onEdit={() => setEditingId(editingId === s.id ? null : s.id)}
              onChange={(updates) => updateScenario(s.id, updates)}
              onDelete={() => deleteScenario(s.id)}
              onActivate={() => activate(s.id)}
              valveConfig={valveConfig}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// 시나리오 카드
// ─────────────────────────────────────────
const ScenarioCard = ({ scenario, index, isEditing, onEdit, onChange, onDelete, onActivate, valveConfig }) => {
  const s = scenario;
  const modeLabel = { solar: '일사량', timer: '간격', schedule: '시각' };

  return (
    <div style={{
      background: '#fff', borderRadius: 12, border: s.active ? '2px solid #16a34a' : '1px solid #e2e8f0',
      overflow: 'hidden', transition: 'all 0.2s',
    }}>
      {/* 카드 헤더 — 한 줄 유지 (모바일 좁은 화면 대응: 작은 gap + 컴팩트 요소) */}
      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap' }}>
        <span style={{
          padding: '3px 8px', borderRadius: 10, fontSize: 12, fontWeight: 800,
          background: s.active ? '#dcfce7' : '#f1f5f9', color: s.active ? '#15803d' : '#64748b',
          flexShrink: 0,
        }}>{index}번</span>
        <input
          value={s.name}
          onChange={(e) => onChange({ name: e.target.value })}
          style={{
            flex: 1, minWidth: 0, fontSize: 16, fontWeight: 800, color: '#0f172a',
            border: 'none', background: 'transparent', outline: 'none',
          }}
        />
        <ToggleSwitch
          on={s.enabled}
          onChange={(v) => onChange({ enabled: v })}
          color="#0891b2"
        />
        {!s.active && s.enabled && (
          <button onClick={onActivate} style={{
            background: '#0891b2', color: '#fff', border: 'none', padding: '4px 8px',
            borderRadius: 6, fontSize: 12, fontWeight: 800, cursor: 'pointer', flexShrink: 0,
          }}>활성</button>
        )}
        {s.active && (
          <span style={{
            padding: '3px 8px', borderRadius: 10, fontSize: 12, fontWeight: 800,
            background: '#16a34a', color: '#fff', flexShrink: 0, whiteSpace: 'nowrap',
          }}>● 사용중</span>
        )}
        <button onClick={onEdit} style={{ ...iconBtn, width: 24, height: 24, fontSize: 14, flexShrink: 0 }}>{isEditing ? '⌃' : '⌄'}</button>
      </div>

      {/* 요약 정보 */}
      <div style={{ padding: '0 14px 12px', display: 'flex', gap: 12, fontSize: 14, color: '#64748b', flexWrap: 'wrap' }}>
        <SummaryChip icon="💧" label="EC" value={s.ecTarget} unit="mS" />
        <SummaryChip icon="🧪" label="pH" value={s.phTarget} unit="" />
        <SummaryChip icon="⏰" label="관수" value={modeLabel[s.irrigationMode]} unit="" />
        <SummaryChip icon="🚿" label="밸브" value={`${s.valves.length}개`} unit="" />
        {s.irrigationMode === 'solar' && (
          <SolarChip current={s.solarAccumulated || 0} target={s.solarThreshold || 100} />
        )}
      </div>

      {/* 인라인 편집 펼침 */}
      {isEditing && (
        <div style={{ borderTop: '1px solid #e2e8f0', padding: 14, background: '#f8fafc' }}>
          <EditForm scenario={s} onChange={onChange} onDelete={onDelete} valveConfig={valveConfig} />
        </div>
      )}
    </div>
  );
};

const iconBtn = {
  width: 28, height: 28, borderRadius: 8, border: '1px solid #e2e8f0',
  background: '#fff', cursor: 'pointer', fontSize: 16, color: '#475569', fontWeight: 800,
};

const SummaryChip = ({ icon, label, value, unit }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
    <span>{icon}</span>
    <span style={{ fontWeight: 600 }}>{label}</span>
    <strong style={{ color: '#0f172a' }}>{value}{unit && ` ${unit}`}</strong>
  </span>
);

// 일사량 적산 칩 — 누적 / 목표 진행률
const SolarChip = ({ current, target }) => {
  const pct = Math.min(100, (current / target) * 100);
  const reached = pct >= 100;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '2px 8px', borderRadius: 10,
      background: reached ? '#dcfce7' : '#fef3c7',
      border: `1px solid ${reached ? '#86efac' : '#fde68a'}`,
    }}>
      <span>☀️</span>
      <span style={{ fontWeight: 600, color: '#92400e' }}>적산</span>
      <strong style={{ color: reached ? '#15803d' : '#92400e' }}>{current}</strong>
      <span style={{ color: '#94a3b8' }}> / {target} W/m²</span>
      <span style={{
        width: 32, height: 4, background: '#fef3c7', borderRadius: 2, marginLeft: 4, overflow: 'hidden',
      }}>
        <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: reached ? '#16a34a' : '#d97706' }} />
      </span>
    </span>
  );
};

const ToggleSwitch = ({ on, onChange, color = '#0891b2' }) => (
  <button onClick={() => onChange(!on)} style={{
    width: 40, height: 22, borderRadius: 11, border: 'none', position: 'relative',
    background: on ? color : '#cbd5e1', cursor: 'pointer', transition: 'background 0.2s',
  }}>
    <span style={{
      position: 'absolute', top: 2, left: on ? 20 : 2, width: 18, height: 18,
      borderRadius: '50%', background: '#fff', transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    }} />
  </button>
);

// ─────────────────────────────────────────
// 편집 폼
// ─────────────────────────────────────────
const EditForm = ({ scenario, onChange, onDelete, valveConfig }) => {
  const [section, setSection] = useState('target');
  const SECTIONS = [
    { id: 'target', label: 'EC/pH 목표' },
    { id: 'dosing', label: '도징 비율' },
    { id: 'irrigation', label: '관수 방식' },
    { id: 'valves', label: '구역 설정' },
  ];

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {SECTIONS.map(sec => (
          <button key={sec.id} onClick={() => setSection(sec.id)} style={{
            padding: '8px 16px', borderRadius: 6, fontSize: 14, fontWeight: 700,
            background: section === sec.id ? '#0891b2' : '#fff',
            color: section === sec.id ? '#fff' : '#475569',
            border: section === sec.id ? 'none' : '1px solid #e2e8f0',
            cursor: 'pointer',
          }}>{sec.label}</button>
        ))}
      </div>

      {section === 'target' && <TargetSection s={scenario} onChange={onChange} />}
      {section === 'dosing' && <DosingSection s={scenario} onChange={onChange} />}
      {section === 'irrigation' && <IrrigationSection s={scenario} onChange={onChange} />}
      {section === 'valves' && <ValvesSection s={scenario} onChange={onChange} valveConfig={valveConfig} />}

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onDelete} style={{
          background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5',
          padding: '6px 12px', borderRadius: 8, fontSize: 13, fontWeight: 800, cursor: 'pointer',
        }}>🗑️ 삭제</button>
      </div>
    </div>
  );
};

const TargetSection = ({ s, onChange }) => (
  <div className="grid grid-cols-2 gap-3">
    <NumberInput label="EC 목표" value={s.ecTarget} unit="mS/cm" step={0.1} min={0} max={5}
                 onChange={(v) => onChange({ ecTarget: v })} color="#0891b2" />
    <NumberInput label="pH 목표" value={s.phTarget} unit="" step={0.1} min={4} max={9}
                 onChange={(v) => onChange({ phTarget: v })} color="#7c3aed" />
  </div>
);

const DosingSection = ({ s, onChange }) => {
  const setRatio = (key, val) => onChange({ dosingRatio: { ...s.dosingRatio, [key]: val } });
  const total = Object.values(s.dosingRatio).reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-2">
      <div style={{ fontSize: 13, color: '#64748b' }}>
        총 비율: <strong style={{ color: total === 100 ? '#16a34a' : '#dc2626' }}>{total}%</strong>
        {total !== 100 && <span style={{ marginLeft: 6 }}>(100% 가 되도록 조정)</span>}
      </div>
      {Object.entries(s.dosingRatio).map(([key, val]) => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 32, fontSize: 14, fontWeight: 800, color: '#475569' }}>{key}</span>
          <input type="range" min={0} max={100} value={val}
                 onChange={(e) => setRatio(key, parseInt(e.target.value))}
                 style={{ flex: 1 }} />
          <span style={{ width: 40, textAlign: 'right', fontSize: 14, fontWeight: 700, color: '#0891b2' }}>{val}%</span>
        </div>
      ))}
    </div>
  );
};

const IrrigationSection = ({ s, onChange }) => (
  <div className="space-y-3">
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 6 }}>관수 방식 (단일 선택)</div>
      <div className="grid grid-cols-3 gap-2">
        <RadioCard active={s.irrigationMode === 'solar'} onClick={() => onChange({ irrigationMode: 'solar' })}
                   icon="☀️" label="일사량 비례" desc="누적 일사량 기준" />
        <RadioCard active={s.irrigationMode === 'timer'} onClick={() => onChange({ irrigationMode: 'timer' })}
                   icon="⏱️" label="작동 간격" desc="일정 간격 자동" />
        <RadioCard active={s.irrigationMode === 'schedule'} onClick={() => onChange({ irrigationMode: 'schedule' })}
                   icon="📅" label="지정시각" desc="14슬롯 시간 지정" />
      </div>
    </div>
    {s.irrigationMode === 'solar' && (
      <NumberInput label="기준 일사량" value={s.solarThreshold || 100} unit="W/m²" step={10} min={0} max={1000}
                   onChange={(v) => onChange({ solarThreshold: v })} color="#d97706" />
    )}
    {s.irrigationMode === 'timer' && (
      <div className="grid grid-cols-3 gap-2">
        <TextInput label="간격" value={s.timerInterval} onChange={(v) => onChange({ timerInterval: v })} placeholder="00:30" />
        <TextInput label="시작" value={s.timerStart} onChange={(v) => onChange({ timerStart: v })} placeholder="07:00" />
        <TextInput label="종료" value={s.timerEnd} onChange={(v) => onChange({ timerEnd: v })} placeholder="22:00" />
      </div>
    )}
    {s.irrigationMode === 'schedule' && (
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 6 }}>관수 시각 슬롯 (최대 14)</div>
        <div className="grid grid-cols-7 gap-2">
          {Array(14).fill(0).map((_, i) => {
            const time = s.scheduleSlots?.[i] || '';
            return (
              <input key={i} value={time} placeholder="--:--"
                     onChange={(e) => {
                       const slots = [...(s.scheduleSlots || [])];
                       slots[i] = e.target.value;
                       onChange({ scheduleSlots: slots.filter(x => x) });
                     }}
                     style={{
                       padding: '4px 6px', fontSize: 13, textAlign: 'center', borderRadius: 6,
                       border: '1px solid ' + (time ? '#0891b2' : '#cbd5e1'),
                       background: time ? '#f0f9ff' : '#fff', fontWeight: 700, color: '#0f172a',
                     }} />
            );
          })}
        </div>
      </div>
    )}
    <DaysSelector days={s.days} onChange={(d) => onChange({ days: d })} />
  </div>
);

// 시나리오 — 구역 설정: 사용할 구역 선택 + 그룹별 일괄 + 카드별 시간/유량
// 공급량 등급(supplyLevel) 가중치는 NR 자동화 실행 시점에 곱하므로 여기는 기본 수치만 입력
const SUPPLY_LEVELS_LABEL = { light: '적음 ×0.7', standard: '표준 ×1.0', heavy: '많음 ×1.5' };

// 옛 valves[14] → zones 변환 (옛 호환)
const getZones = (s) => {
  if (Array.isArray(s.zones) && s.zones.length > 0) return s.zones;
  return [];
};

const ValvesSection = ({ s, onChange, valveConfig }) => {
  const { valveGroups = [], valves: cfgValves = [] } = valveConfig || {};
  const valveCount = Math.max(s.valves?.length || 14, cfgValves.length || 0);

  const zones = getZones(s);
  const zoneMap = useMemo(() => {
    const m = {};
    zones.forEach(z => { m[z.idx] = z; });
    return m;
  }, [zones]);
  const selectedIdxs = zones.map(z => z.idx).sort((a, b) => a - b);

  const writeZones = (newZones) => onChange({ zones: newZones.sort((a, b) => a.idx - b.idx) });

  const toggleZone = (idx) => {
    if (zoneMap[idx]) {
      writeZones(zones.filter(z => z.idx !== idx));
    } else {
      writeZones([...zones, { idx, duration: 600, volume: 150 }]);
    }
  };
  const toggleGroupAll = (idxs, on) => {
    if (on) {
      const existing = new Set(zones.map(z => z.idx));
      const toAdd = idxs.filter(idx => !existing.has(idx)).map(idx => ({ idx, duration: 600, volume: 150 }));
      writeZones([...zones, ...toAdd]);
    } else {
      const remove = new Set(idxs);
      writeZones(zones.filter(z => !remove.has(z.idx)));
    }
  };
  const setZone = (idx, updates) => {
    writeZones(zones.map(z => z.idx === idx ? { ...z, ...updates } : z));
  };
  const bulkApplyTo = (key, val, idxs) => {
    const set = new Set(idxs);
    writeZones(zones.map(z => set.has(z.idx) ? { ...z, [key]: val } : z));
  };

  const cfgValveOf = (idx) => cfgValves.find(cv => cv.idx === idx) || {};

  // 그룹별 멤버 idx (1-based)
  const groupBuckets = valveGroups.map(g => ({
    ...g,
    memberIdxs: cfgValves
      .filter(cv => cv.groupId === g.id)
      .map(cv => cv.idx)
      .filter(idx => idx >= 1 && idx <= valveCount)
      .sort((a, b) => a - b),
  }));
  const assigned = new Set();
  groupBuckets.forEach(g => g.memberIdxs.forEach(idx => assigned.add(idx)));
  const unassignedAll = Array.from({ length: valveCount }, (_, i) => i + 1).filter(idx => !assigned.has(idx));

  return (
    <div className="space-y-3">
      {/* 0. 사용할 구역 선택 */}
      <ZoneSelector
        groupBuckets={groupBuckets}
        unassignedAll={unassignedAll}
        cfgValveOf={cfgValveOf}
        selectedSet={new Set(selectedIdxs)}
        onToggle={toggleZone}
        onToggleGroupAll={toggleGroupAll}
      />

      {selectedIdxs.length === 0 ? (
        <div style={{ padding: 16, background: '#f1f5f9', borderRadius: 8, fontSize: 14, color: '#64748b', textAlign: 'center' }}>
          ☝️ 위에서 이 시나리오에 사용할 구역을 선택하세요
        </div>
      ) : (
        <>
          {/* 전체 일괄 (선택된 구역만) */}
          <BulkApplyPanel
            title={`📦 전체 일괄 (선택된 ${selectedIdxs.length}개 구역)`}
            bg="#fef3c7" border="#fde68a" textColor="#92400e" btnColor="#d97706"
            onApplyDuration={(v) => bulkApplyTo('duration', v, selectedIdxs)}
            onApplyVolume={(v) => bulkApplyTo('volume', v, selectedIdxs)}
          />

          {/* 그룹별 섹션 — 선택된 멤버만 */}
          {groupBuckets.map(g => {
            const selected = g.memberIdxs.filter(idx => zoneMap[idx]);
            if (selected.length === 0) return null;
            return (
              <GroupValvesPanel key={g.id} group={{ ...g, memberIdxs: selected }} zones={zones} zoneMap={zoneMap}
                                cfgValveOf={cfgValveOf}
                                onZoneChange={setZone}
                                onBulkApply={(key, val) => bulkApplyTo(key, val, selected)} />
            );
          })}

          {/* 미배정 — 선택된 것만 */}
          {(() => {
            const selectedUnassigned = unassignedAll.filter(idx => zoneMap[idx]);
            if (selectedUnassigned.length === 0) return null;
            return <UnassignedValvesPanel idxs={selectedUnassigned} zones={zones} zoneMap={zoneMap} cfgValveOf={cfgValveOf} onZoneChange={setZone} />;
          })()}
        </>
      )}

      {valveGroups.length === 0 && (
        <div style={{ padding: 10, background: '#f1f5f9', borderRadius: 8, fontSize: 13, color: '#64748b' }}>
          💡 그룹을 만들면 그룹별로 일괄 설정할 수 있습니다 — 설정 → 🗺️ 구역 설정 에서 그룹 추가
        </div>
      )}
    </div>
  );
};

// 상단 구역 선택 UI — 그룹별 체크박스 + 멤버 chip 토글
const ZoneSelector = ({ groupBuckets, unassignedAll, cfgValveOf, selectedSet, onToggle, onToggleGroupAll }) => {
  const renderGroup = (g, color, name, icon) => {
    if (g.memberIdxs.length === 0) return null;
    const allOn = g.memberIdxs.every(idx => selectedSet.has(idx));
    return (
      <div key={g.id || 'unassigned'} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '6px 0' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', minWidth: 160 }}>
          <input type="checkbox" checked={allOn} onChange={() => onToggleGroupAll(g.memberIdxs, !allOn)}
                 style={{ width: 16, height: 16, accentColor: color }} />
          <span style={{ fontSize: 13.5, fontWeight: 800, color }}>{icon} {name}</span>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>({g.memberIdxs.length})</span>
        </label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {g.memberIdxs.map(idx => {
            const on = selectedSet.has(idx);
            const cfg = cfgValveOf(idx);
            return (
              <button key={idx} onClick={() => onToggle(idx)} title={cfg.crop ? `${cfg.crop} ${cfg.plantCount || 0}주` : ''}
                      style={{
                        padding: '3px 9px', borderRadius: 10, fontSize: 12, fontWeight: 800, cursor: 'pointer',
                        background: on ? color : '#fff',
                        color: on ? '#fff' : '#94a3b8',
                        border: on ? `1.5px solid ${color}` : '1.5px solid #e2e8f0',
                      }}>
                V{idx}
              </button>
            );
          })}
        </div>
      </div>
    );
  };
  return (
    <div style={{ padding: 12, background: '#f0f9ff', border: '1.5px solid #bae6fd', borderRadius: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: '#0c4a6e', marginBottom: 8 }}>🎯 이 시나리오 대상 구역 선택</div>
      <div className="space-y-1">
        {groupBuckets.map(g => renderGroup(g, g.color, g.name, '●'))}
        {unassignedAll.length > 0 && renderGroup(
          { id: '__unassigned__', memberIdxs: unassignedAll },
          '#64748b', '미배정', '📭'
        )}
      </div>
    </div>
  );
};

// 일괄 입력 패널 — 전체용 + 그룹용 공통
const BulkApplyPanel = ({ title, bg, border, textColor, btnColor, onApplyDuration, onApplyVolume }) => {
  const [dur, setDur] = useState(600);
  const [vol, setVol] = useState(150);
  return (
    <div style={{ padding: 10, background: bg, borderRadius: 8, border: `1px solid ${border}` }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: textColor, marginBottom: 6 }}>{title}</div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex gap-2 items-center">
          <input type="number" value={dur} onChange={(e) => setDur(parseInt(e.target.value) || 0)} style={inputSm} />
          <span style={{ fontSize: 13, fontWeight: 700, color: textColor }}>초</span>
          <button onClick={() => onApplyDuration(dur)} style={miniBtn(btnColor)}>시간 적용</button>
        </div>
        <div className="flex gap-2 items-center">
          <input type="number" value={vol} onChange={(e) => setVol(parseInt(e.target.value) || 0)} style={inputSm} />
          <span style={{ fontSize: 13, fontWeight: 700, color: textColor }}>mL</span>
          <button onClick={() => onApplyVolume(vol)} style={miniBtn(btnColor)}>유량 적용</button>
        </div>
      </div>
    </div>
  );
};

// 그룹 섹션 — 그룹 헤더(이름 + 공급량 등급) + 그룹 일괄 + 멤버 카드 그리드 (선택된 zones 만)
const GroupValvesPanel = ({ group, zones, zoneMap, cfgValveOf, onZoneChange, onBulkApply }) => {
  const supplyLabel = SUPPLY_LEVELS_LABEL[group.supplyLevel] || SUPPLY_LEVELS_LABEL.standard;
  return (
    <div style={{
      padding: 10, background: '#fff',
      border: `1.5px solid ${group.color}55`, borderLeft: `4px solid ${group.color}`,
      borderRadius: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: group.color }}>{group.name}</span>
        <span style={{ padding: '2px 8px', borderRadius: 10, background: group.color + '18', color: group.color,
                       fontSize: 11.5, fontWeight: 800 }}>{supplyLabel}</span>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{group.memberIdxs.length}개 구역</span>
      </div>
      <div style={{ marginBottom: 8 }}>
        <BulkApplyPanel title="이 그룹만 일괄 적용" bg={group.color + '0d'} border={group.color + '33'}
                        textColor={group.color} btnColor={group.color}
                        onApplyDuration={(v) => onBulkApply('duration', v)}
                        onApplyVolume={(v) => onBulkApply('volume', v)} />
      </div>
      <ValveCardGrid idxs={group.memberIdxs} zoneMap={zoneMap} cfgValveOf={cfgValveOf} color={group.color} onZoneChange={onZoneChange} />
    </div>
  );
};

const UnassignedValvesPanel = ({ idxs, zoneMap, cfgValveOf, onZoneChange }) => (
  <div style={{
    padding: 10, background: '#f8fafc',
    border: '1.5px dashed #cbd5e1', borderRadius: 10,
  }}>
    <div style={{ fontSize: 14, fontWeight: 800, color: '#64748b', marginBottom: 8 }}>📭 미배정 구역 ({idxs.length}개)</div>
    <ValveCardGrid idxs={idxs} zoneMap={zoneMap} cfgValveOf={cfgValveOf} color="#64748b" onZoneChange={onZoneChange} />
  </div>
);

// 구역 카드 그리드 — 카드 안: 구역 # / 품목·식재수 / 시간 / 유량
const ValveCardGrid = ({ idxs, zoneMap, cfgValveOf, color, onZoneChange }) => {
  const fmt = (sec) => `${Math.floor(sec/60).toString().padStart(2,'0')}:${(sec%60).toString().padStart(2,'0')}`;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
      {idxs.map(idx => {
        const z = zoneMap[idx] || { duration: 600, volume: 150 };
        const cfg = cfgValveOf(idx);
        return (
          <div key={idx} style={{ padding: 8, background: '#fff', borderRadius: 8, border: `1px solid ${color}33` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 800, color }}>V{idx}</span>
              {cfg.crop && <span style={{ fontSize: 10.5, color, fontWeight: 700, opacity: 0.8 }}>{cfg.crop}{cfg.plantCount > 0 ? `·${cfg.plantCount}` : ''}</span>}
            </div>
            <input type="text" value={fmt(z.duration)} readOnly
                   title="전체/그룹 일괄 적용으로 변경"
                   style={{ width: '100%', fontSize: 13, fontWeight: 700, padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: 6, marginBottom: 4, textAlign: 'center', background: '#f8fafc' }} />
            <input type="number" value={z.volume} onChange={(e) => onZoneChange(idx, { volume: parseInt(e.target.value) || 0 })}
                   style={{ width: '100%', fontSize: 13, fontWeight: 700, padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: 6, textAlign: 'center' }} />
            <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 2, fontWeight: 600 }}>mL</div>
          </div>
        );
      })}
    </div>
  );
};

const DaysSelector = ({ days = [], onChange }) => {
  const DAYS = [{n:0,l:'일'},{n:1,l:'월'},{n:2,l:'화'},{n:3,l:'수'},{n:4,l:'목'},{n:5,l:'금'},{n:6,l:'토'}];
  const toggle = (n) => {
    const next = days.includes(n) ? days.filter(d => d !== n) : [...days, n];
    onChange(next);
  };
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 800, color: '#475569', marginBottom: 8 }}>적용 요일</div>
      <div className="flex gap-2">
        {DAYS.map(d => (
          <button key={d.n} onClick={() => toggle(d.n)} style={{
            width: 40, height: 36, borderRadius: 8, border: 'none', fontSize: 15, fontWeight: 800, cursor: 'pointer',
            background: days.includes(d.n) ? '#0891b2' : '#f1f5f9',
            color: days.includes(d.n) ? '#fff' : '#94a3b8',
          }}>{d.l}</button>
        ))}
      </div>
    </div>
  );
};

const RadioCard = ({ active, onClick, icon, label, desc }) => (
  <button onClick={onClick} style={{
    padding: 10, borderRadius: 8, border: `1.5px solid ${active ? '#0891b2' : '#e2e8f0'}`,
    background: active ? '#f0f9ff' : '#fff', cursor: 'pointer', textAlign: 'left',
    display: 'flex', flexDirection: 'column', gap: 4,
  }}>
    <span style={{ fontSize: 18 }}>{icon}</span>
    <span style={{ fontSize: 14, fontWeight: 800, color: active ? '#0891b2' : '#0f172a' }}>{label}</span>
    <span style={{ fontSize: 12, color: '#64748b' }}>{desc}</span>
  </button>
);

const NumberInput = ({ label, value, unit, onChange, step = 1, min, max, color = '#0891b2' }) => (
  <div>
    <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 4 }}>{label}</div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#fff', borderRadius: 8, padding: '4px 10px', border: `1.5px solid ${color}30` }}>
      <input type="number" value={value} onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
             step={step} min={min} max={max}
             style={{ flex: 1, fontSize: 18, fontWeight: 800, color, border: 'none', outline: 'none', background: 'transparent' }} />
      {unit && <span style={{ fontSize: 13, color: '#64748b', fontWeight: 700 }}>{unit}</span>}
    </div>
  </div>
);

const TextInput = ({ label, value, onChange, placeholder }) => (
  <div>
    <div style={{ fontSize: 13, fontWeight: 700, color: '#475569', marginBottom: 4 }}>{label}</div>
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
           style={{ width: '100%', padding: '6px 10px', fontSize: 15, fontWeight: 700, borderRadius: 8, border: '1px solid #e2e8f0', outline: 'none' }} />
  </div>
);

const inputSm = { width: 70, padding: '5px 8px', fontSize: 14, borderRadius: 6, border: '1px solid #fde68a', textAlign: 'center', fontWeight: 700 };
const miniBtn = (color) => ({ background: color, color: '#fff', border: 'none', padding: '5px 12px', borderRadius: 6, fontSize: 13, fontWeight: 800, cursor: 'pointer' });
