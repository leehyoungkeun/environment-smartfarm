import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

const DEFAULT_SENSOR_OPTIONS = [
  { id: 'temp_001', name: '온도', unit: '°C', icon: '🌡️' },
  { id: 'humidity_001', name: '습도', unit: '%', icon: '💧' },
];

const DEVICE_TYPE_OPTIONS = [
  { value: 'window', label: '개폐기', icon: '🪟', commands: ['open', 'stop', 'close'] },
  { value: 'fan', label: '환풍기', icon: '🌀', commands: ['on', 'off'] },
  { value: 'heater', label: '히터', icon: '🔥', commands: ['on', 'off'] },
  { value: 'valve', label: '관수밸브', icon: '🚿', commands: ['open', 'stop', 'close'] },
];

const OPERATOR_OPTIONS = [
  { value: '>', label: '초과 (>)' },
  { value: '>=', label: '이상 (≥)' },
  { value: '<', label: '미만 (<)' },
  { value: '<=', label: '이하 (≤)' },
];

const DAYS_OPTIONS = [
  { value: 0, label: '일' },
  { value: 1, label: '월' },
  { value: 2, label: '화' },
  { value: 3, label: '수' },
  { value: 4, label: '목' },
  { value: 5, label: '금' },
  { value: 6, label: '토' },
];

const COMMAND_LABELS = {
  open: '열기', close: '닫기', stop: '정지', on: 'ON', off: 'OFF',
};

const AutomationManager = ({ farmId }) => {
  const [rules, setRules] = useState([]);
  const [houses, setHouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState(null);

  // 데이터 로드
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesRes, configRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/automation/${farmId}`),
        axios.get(`${API_BASE_URL}/config/${farmId}`),
      ]);
      if (rulesRes.data.success) setRules(rulesRes.data.data);
      if (configRes.data.success) setHouses(configRes.data.data.houses || []);
    } catch (error) {
      console.error('로드 실패:', error);
    } finally {
      setLoading(false);
    }
  }, [farmId]);

  useEffect(() => { loadData(); }, [loadData]);

  // 규칙 토글
  const toggleRule = async (ruleId) => {
    try {
      await axios.patch(`${API_BASE_URL}/automation/${farmId}/${ruleId}/toggle`);
      loadData();
    } catch (error) {
      alert('토글 실패: ' + error.message);
    }
  };

  // 규칙 삭제
  const deleteRule = async (ruleId) => {
    if (!confirm('이 자동화 규칙을 삭제하시겠습니까?')) return;
    try {
      await axios.delete(`${API_BASE_URL}/automation/${farmId}/${ruleId}`);
      loadData();
    } catch (error) {
      alert('삭제 실패: ' + error.message);
    }
  };

  // 편집 시작
  const startEdit = (rule) => {
    setEditingRule(rule);
    setShowForm(true);
  };

  // 새 규칙
  const startNew = () => {
    setEditingRule(null);
    setShowForm(true);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">자동화 규칙</h1>
          <p className="text-gray-500 text-sm md:text-base mt-0.5">센서 기반 자동 장치 제어</p>
        </div>
        <button
          onClick={startNew}
          className="btn-primary"
        >
          + 새 규칙
        </button>
      </div>

      {/* 규칙 생성/편집 폼 */}
      {showForm && (
        <RuleForm
          farmId={farmId}
          houses={houses}
          rule={editingRule}
          onSave={() => { setShowForm(false); setEditingRule(null); loadData(); }}
          onCancel={() => { setShowForm(false); setEditingRule(null); }}
        />
      )}

      {/* 규칙 목록 */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : rules.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <div className="text-4xl mb-3 opacity-20">🤖</div>
          <p className="text-gray-500 text-base">자동화 규칙이 없습니다</p>
          <p className="text-gray-600 text-sm mt-1">위 "+ 새 규칙" 버튼을 눌러 추가하세요</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map(rule => (
            <RuleCard
              key={rule._id}
              rule={rule}
              houses={houses}
              onToggle={() => toggleRule(rule._id)}
              onEdit={() => startEdit(rule)}
              onDelete={() => deleteRule(rule._id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};


/**
 * 규칙 카드
 */
const RuleCard = ({ rule, houses, onToggle, onEdit, onDelete }) => {
  const house = houses.find(h => h.houseId === rule.houseId);
  const houseName = house?.houseName || house?.name || rule.houseId;

  return (
    <div className={`glass-card p-4 md:p-5 transition-all ${!rule.enabled ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* 제목 + 하우스 */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xl">🤖</span>
            <h3 className="text-base font-bold text-white truncate">{rule.name}</h3>
            <span className="text-xs text-gray-400 bg-white/[0.06] px-2 py-0.5 rounded">
              {houseName}
            </span>
          </div>

          {/* 조건 */}
          <div className="mb-2">
            <span className="text-xs text-gray-400 font-semibold uppercase">조건 ({rule.conditionLogic})</span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {rule.conditions.map((cond, i) => (
                <span key={i} className="text-sm bg-violet-500/10 text-violet-300 border border-violet-500/20 px-2.5 py-0.5 rounded-lg">
                  {cond.type === 'sensor'
                    ? `${cond.sensorName || cond.sensorId} ${cond.operator} ${cond.value}`
                    : `⏰ ${cond.time} (${cond.days?.map(d => DAYS_OPTIONS[d]?.label).join(',')})`
                  }
                </span>
              ))}
            </div>
          </div>

          {/* 동작 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-gray-400 font-semibold uppercase mr-1">→</span>
            {rule.actions.map((action, i) => {
              const dt = DEVICE_TYPE_OPTIONS.find(d => d.value === action.deviceType);
              return (
                <span key={i} className="text-sm bg-blue-500/10 text-blue-300 border border-blue-500/20 px-2.5 py-0.5 rounded-lg">
                  {dt?.icon} {action.deviceName || action.deviceId} {COMMAND_LABELS[action.command] || action.command}
                </span>
              );
            })}
          </div>

          {/* 통계 */}
          <div className="flex items-center gap-3 mt-2.5 text-xs text-gray-500">
            <span>실행 {rule.triggerCount || 0}회</span>
            <span>쿨다운 {Math.round((rule.cooldownSeconds || 300) / 60)}분</span>
            {rule.lastTriggeredAt && (
              <span>마지막: {new Date(rule.lastTriggeredAt).toLocaleString('ko-KR', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}</span>
            )}
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="flex flex-col items-end gap-2">
          <button
            onClick={onToggle}
            className={`w-14 h-7 rounded-full transition-all relative ${
              rule.enabled ? 'bg-emerald-500' : 'bg-gray-600'
            }`}
          >
            <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-all ${
              rule.enabled ? 'left-7' : 'left-0.5'
            }`} />
          </button>
          <div className="flex gap-1">
            <button onClick={onEdit} className="p-2 rounded-lg text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 text-sm transition-all">✏️</button>
            <button onClick={onDelete} className="p-2 rounded-lg text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 text-sm transition-all">🗑️</button>
          </div>
        </div>
      </div>
    </div>
  );
};


/**
 * 규칙 생성/편집 폼
 */
const RuleForm = ({ farmId, houses, rule, onSave, onCancel }) => {
  const [form, setForm] = useState({
    name: rule?.name || '',
    houseId: rule?.houseId || (houses[0]?.houseId || ''),
    conditionLogic: rule?.conditionLogic || 'AND',
    conditions: rule?.conditions || [{ type: 'sensor', sensorId: 'temp_001', sensorName: '온도', operator: '>', value: 30 }],
    actions: rule?.actions || [{ deviceId: 'fan1', deviceType: 'fan', deviceName: '환풍기 1', command: 'on' }],
    cooldownSeconds: rule?.cooldownSeconds || 300,
    enabled: rule?.enabled !== false,
  });
  const [saving, setSaving] = useState(false);

  const updateCondition = (idx, field, value) => {
    const updated = [...form.conditions];
    updated[idx] = { ...updated[idx], [field]: value };
    // sensorId 변경 시 이름도 업데이트
    if (field === 'sensorId') {
      const sensor = sensorOptions.find(s => s.id === value);
      updated[idx].sensorName = sensor?.name || value;
    }
    setForm({ ...form, conditions: updated });
  };

  const addCondition = (type) => {
    const firstSensor = sensorOptions[0] || { id: 'temp_001', name: '온도' };
    const newCond = type === 'sensor'
      ? { type: 'sensor', sensorId: firstSensor.id, sensorName: firstSensor.name, operator: '>', value: 30 }
      : { type: 'time', time: '08:00', days: [1, 2, 3, 4, 5] };
    setForm({ ...form, conditions: [...form.conditions, newCond] });
  };

  const removeCondition = (idx) => {
    if (form.conditions.length <= 1) return;
    setForm({ ...form, conditions: form.conditions.filter((_, i) => i !== idx) });
  };

  const updateAction = (idx, updates) => {
    const updated = [...form.actions];
    updated[idx] = { ...updated[idx], ...updates };
    // deviceType 변경 시 command 기본값 설정
    if (updates.deviceType) {
      const dt = DEVICE_TYPE_OPTIONS.find(d => d.value === updates.deviceType);
      if (!updates.command) updated[idx].command = dt?.commands[0] || 'on';
      if (!updates.deviceId) {
        updated[idx].deviceId = updates.deviceType + '1';
        updated[idx].deviceName = (dt?.label || updates.deviceType) + ' 1';
      }
    }
    setForm({ ...form, actions: updated });
  };

  const addAction = () => {
    // 하우스에 장치가 있으면 첫 번째 장치를, 없으면 기본값
    const firstDevice = houseDevices[0];
    const newAction = firstDevice
      ? { deviceId: firstDevice.deviceId, deviceType: firstDevice.type, deviceName: firstDevice.name, command: firstDevice.type === 'fan' || firstDevice.type === 'heater' ? 'on' : 'open' }
      : { deviceId: 'fan1', deviceType: 'fan', deviceName: '환풍기 1', command: 'on' };
    setForm({ ...form, actions: [...form.actions, newAction] });
  };

  const removeAction = (idx) => {
    setForm({ ...form, actions: form.actions.filter((_, i) => i !== idx) });
  };

  const handleSave = async () => {
    if (!form.name.trim()) return alert('규칙 이름을 입력하세요');
    setSaving(true);
    try {
      if (rule?._id) {
        await axios.put(`${API_BASE_URL}/automation/${farmId}/${rule._id}`, form);
      } else {
        await axios.post(`${API_BASE_URL}/automation/${farmId}`, form);
      }
      onSave();
    } catch (error) {
      alert('저장 실패: ' + (error.response?.data?.error || error.message));
    } finally {
      setSaving(false);
    }
  };

  // 선택된 하우스의 장치/센서 목록
  const selectedHouse = houses.find(h => h.houseId === form.houseId);
  const houseDevices = selectedHouse?.devices || [];
  const sensorOptions = (selectedHouse?.sensors?.length > 0)
    ? selectedHouse.sensors
        .filter(s => s.enabled !== false)
        .map(s => ({ id: s.sensorId, name: s.name, unit: s.unit || '', icon: s.icon || '📊' }))
    : DEFAULT_SENSOR_OPTIONS;

  return (
    <div className="glass-card p-4 md:p-5 mb-5 border border-violet-500/20 animate-fade-in-up">
      <h2 className="text-base font-bold text-violet-300 mb-4">
        {rule ? '✏️ 규칙 수정' : '🤖 새 자동화 규칙'}
      </h2>

      {/* 기본 정보 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <div>
          <label className="text-[10px] text-gray-400 mb-1 block">규칙 이름</label>
          <input
            type="text"
            placeholder="예: 고온 환풍기 자동 가동"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="input-field text-xs"
          />
        </div>
        <div>
          <label className="text-[10px] text-gray-400 mb-1 block">대상 하우스</label>
          <select
            value={form.houseId}
            onChange={(e) => setForm({ ...form, houseId: e.target.value })}
            className="input-field text-xs"
          >
            {houses.map(h => (
              <option key={h.houseId} value={h.houseId} className="bg-slate-800">
                {h.houseName || h.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-gray-400 mb-1 block">쿨다운 (분)</label>
          <input
            type="number"
            value={Math.round(form.cooldownSeconds / 60)}
            onChange={(e) => setForm({ ...form, cooldownSeconds: parseInt(e.target.value || 5) * 60 })}
            className="input-field text-xs"
            min="1" max="1440"
          />
        </div>
      </div>

      {/* 조건 */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs font-semibold text-violet-300">조건</span>
          <div className="flex gap-1 bg-white/[0.04] rounded-md p-0.5">
            {['AND', 'OR'].map(logic => (
              <button
                key={logic}
                onClick={() => setForm({ ...form, conditionLogic: logic })}
                className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                  form.conditionLogic === logic ? 'bg-violet-500/80 text-white' : 'text-gray-500'
                }`}
              >
                {logic}
              </button>
            ))}
          </div>
          <div className="flex gap-1 ml-auto">
            <button onClick={() => addCondition('sensor')} className="text-[10px] text-violet-400 hover:text-violet-300">+ 센서 조건</button>
            <button onClick={() => addCondition('time')} className="text-[10px] text-amber-400 hover:text-amber-300 ml-2">+ 시간 조건</button>
          </div>
        </div>

        <div className="space-y-2">
          {form.conditions.map((cond, idx) => (
            <div key={idx} className="flex items-center gap-2 bg-white/[0.03] rounded-lg p-2.5">
              {cond.type === 'sensor' ? (
                <>
                  <span className="text-xs text-violet-400 font-bold w-8">IF</span>
                  <select
                    value={cond.sensorId}
                    onChange={(e) => updateCondition(idx, 'sensorId', e.target.value)}
                    className="input-field flex-1"
                  >
                    {sensorOptions.map(s => (
                      <option key={s.id} value={s.id} className="bg-slate-800">{s.icon} {s.name}</option>
                    ))}
                  </select>
                  <select
                    value={cond.operator}
                    onChange={(e) => updateCondition(idx, 'operator', e.target.value)}
                    className="input-field w-24"
                  >
                    {OPERATOR_OPTIONS.map(o => (
                      <option key={o.value} value={o.value} className="bg-slate-800">{o.label}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={cond.value}
                    onChange={(e) => updateCondition(idx, 'value', parseFloat(e.target.value))}
                    className="input-field w-20"
                    step="0.1"
                  />
                </>
              ) : (
                <>
                  <span className="text-xs text-amber-400 font-bold w-8">⏰</span>
                  <input
                    type="time"
                    value={cond.time || '08:00'}
                    onChange={(e) => updateCondition(idx, 'time', e.target.value)}
                    className="input-field w-28"
                  />
                  <div className="flex gap-0.5 flex-wrap">
                    {DAYS_OPTIONS.map(d => (
                      <button
                        key={d.value}
                        onClick={() => {
                          const days = cond.days || [];
                          const updated = days.includes(d.value) ? days.filter(v => v !== d.value) : [...days, d.value];
                          updateCondition(idx, 'days', updated);
                        }}
                        className={`w-6 h-6 rounded text-[10px] font-bold transition-all ${
                          (cond.days || []).includes(d.value)
                            ? 'bg-amber-500/80 text-white'
                            : 'bg-white/[0.06] text-gray-500'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
              <button
                onClick={() => removeCondition(idx)}
                className="p-1 text-gray-600 hover:text-rose-400 text-xs"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 동작 */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-blue-300">→ 실행 동작 ({form.actions.length}개)</span>
        </div>

        <div className="space-y-2">
          {form.actions.map((action, idx) => {
            const dt = DEVICE_TYPE_OPTIONS.find(d => d.value === action.deviceType);
            const commands = dt?.commands || ['on', 'off'];

            return (
              <div key={idx} className="flex items-center gap-2 bg-white/[0.03] rounded-lg p-2.5">
                <span className="text-xs text-blue-400 font-bold w-12 flex-shrink-0">
                  {idx === 0 ? 'THEN' : `+${idx + 1}`}
                </span>

                {/* 하우스에 등록된 장치가 있으면 드롭다운, 없으면 수동입력 */}
                {houseDevices.length > 0 ? (
                  <select
                    value={action.deviceId}
                    onChange={(e) => {
                      const dev = houseDevices.find(d => d.deviceId === e.target.value);
                      if (dev) {
                        const devDt = DEVICE_TYPE_OPTIONS.find(d => d.value === dev.type);
                        updateAction(idx, {
                          deviceId: dev.deviceId,
                          deviceType: dev.type,
                          deviceName: dev.name,
                          command: devDt?.commands[0] || 'on',
                        });
                      }
                    }}
                    className="input-field flex-1"
                  >
                    {houseDevices.map(d => (
                      <option key={d.deviceId} value={d.deviceId} className="bg-slate-800">
                        {d.icon || ''} {d.name} ({d.deviceId})
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    <select
                      value={action.deviceType}
                      onChange={(e) => updateAction(idx, { deviceType: e.target.value })}
                      className="input-field w-28"
                    >
                      {DEVICE_TYPE_OPTIONS.map(d => (
                        <option key={d.value} value={d.value} className="bg-slate-800">{d.icon} {d.label}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={action.deviceId}
                      onChange={(e) => updateAction(idx, { deviceId: e.target.value })}
                      className="input-field w-24"
                      placeholder="fan1"
                    />
                  </>
                )}

                <select
                  value={action.command}
                  onChange={(e) => updateAction(idx, { command: e.target.value })}
                  className="input-field w-20"
                >
                  {commands.map(c => (
                    <option key={c} value={c} className="bg-slate-800">{COMMAND_LABELS[c]}</option>
                  ))}
                </select>

                <button
                  onClick={() => removeAction(idx)}
                  className="p-1 text-gray-600 hover:text-rose-400 text-xs flex-shrink-0"
                  title="동작 삭제"
                >
                  ✕
                </button>
              </div>
            );
          })}

          {/* 동작 추가 버튼 */}
          <button
            onClick={addAction}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg
                       border-2 border-dashed border-blue-500/30 text-blue-400 text-xs font-medium
                       hover:border-blue-500/50 hover:bg-blue-500/5 transition-all"
          >
            + 실행 동작 추가
          </button>
        </div>
      </div>

      {/* 저장/취소 */}
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 btn-primary disabled:opacity-50"
        >
          {saving ? '저장 중...' : '저장'}
        </button>
        <button onClick={onCancel} className="btn-secondary">취소</button>
      </div>
    </div>
  );
};

export default AutomationManager;
