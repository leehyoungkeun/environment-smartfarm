import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { getApiBase, getRpiApiBase, isFarmLocalMode } from '../../services/apiSwitcher';

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

// 자동화 API 호출 (RPi 우선 → PC 폴백)
async function autoApi(method, path, data) {
  const rpiUrl = getRpiApiBase() + path;
  const pcUrl = getApiBase() + path;

  try {
    const res = await axios({ method, url: rpiUrl, data, timeout: 5000 });
    return res;
  } catch (rpiErr) {
    // RPi 실패 → PC 서버 폴백 (같은 URL이면 스킵)
    if (rpiUrl !== pcUrl) {
      try {
        const res = await axios({ method, url: pcUrl, data, timeout: 5000 });
        return res;
      } catch (pcErr) {
        throw pcErr;
      }
    }
    throw rpiErr;
  }
}

const TABS = [
  { id: 'sensor', label: '센서 기반', icon: '🌡️', color: 'violet', desc: '센서 값에 따른 자동 장치 제어' },
  { id: 'schedule', label: '시간대별', icon: '⏰', color: 'amber', desc: '시간/요일 기반 정기 스케줄' },
  { id: 'custom', label: '사용자 정의', icon: '⚙️', color: 'emerald', desc: '센서 + 시간 복합 조건' },
];

const TAB_COLORS = {
  violet: { bg: 'bg-violet-500', ring: 'ring-violet-500/30', text: 'text-violet-400', light: 'bg-violet-500/10', border: 'border-violet-500/20' },
  amber: { bg: 'bg-amber-500', ring: 'ring-amber-500/30', text: 'text-amber-400', light: 'bg-amber-500/10', border: 'border-amber-500/20' },
  emerald: { bg: 'bg-emerald-500', ring: 'ring-emerald-500/30', text: 'text-emerald-400', light: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
};

const AutomationManager = ({ farmId }) => {
  const [rules, setRules] = useState([]);
  const [houses, setHouses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('sensor');
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState(null);

  // 데이터 로드 (개별 실패 허용)
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // 팜로컬: config는 localStorage 캐시에서, 일반: 서버에서
      const configCacheKey = `cachedConfig_${farmId}`;
      const promises = [autoApi('get', `/automation/${farmId}`)];

      if (!isFarmLocalMode()) {
        promises.push(axios.get(`${getApiBase()}/config/${farmId}`, { timeout: 5000 }));
      }

      const results = await Promise.allSettled(promises);

      if (results[0].status === 'fulfilled' && results[0].value.data.success) {
        setRules(results[0].value.data.data);
      }

      if (!isFarmLocalMode() && results[1]?.status === 'fulfilled' && results[1].value.data.success) {
        setHouses(results[1].value.data.data.houses || []);
      } else {
        // 팜로컬 or config 실패 → localStorage 캐시에서 복원
        try {
          const cached = JSON.parse(localStorage.getItem(configCacheKey));
          if (cached?.houses) setHouses(cached.houses);
        } catch {}
      }
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
      await autoApi('patch', `/automation/${farmId}/${ruleId}/toggle`);
      loadData();
    } catch (error) {
      alert('토글 실패: ' + error.message);
    }
  };

  // 규칙 삭제
  const deleteRule = async (ruleId) => {
    if (!confirm('이 자동화 규칙을 삭제하시겠습니까?')) return;
    try {
      await autoApi('delete', `/automation/${farmId}/${ruleId}`);
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

  // 탭별 규칙 필터링
  const categorizeRule = (rule) => {
    const hasSensor = rule.conditions?.some(c => c.type === 'sensor');
    const hasTime = rule.conditions?.some(c => c.type === 'time');
    if (hasSensor && hasTime) return 'custom';
    if (hasTime && !hasSensor) return 'schedule';
    return 'sensor';
  };

  const filteredRules = rules.filter(r => categorizeRule(r) === activeTab);
  const currentTab = TABS.find(t => t.id === activeTab);
  const colors = TAB_COLORS[currentTab?.color || 'violet'];

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">자동화 규칙</h1>
          <p className="text-gray-500 text-sm md:text-base mt-0.5">장치 자동 제어 설정</p>
        </div>
        <button onClick={startNew} className="btn-primary">
          + 새 규칙
        </button>
      </div>

      {/* 탭 네비게이션 */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {TABS.map(tab => {
          const tc = TAB_COLORS[tab.color];
          const count = rules.filter(r => categorizeRule(r) === tab.id).length;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl text-base font-extrabold transition-all whitespace-nowrap border-2 ${
                isActive
                  ? `${tc.light} ${tc.text} ${tc.border} shadow-lg`
                  : 'bg-white/[0.03] text-gray-500 border-transparent hover:bg-white/[0.06]'
              }`}
            >
              <span className="text-lg">{tab.icon}</span>
              {tab.label}
              {count > 0 && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                  isActive ? `${tc.bg} text-white` : 'bg-white/[0.08] text-gray-500'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 탭 설명 */}
      <p className={`text-sm ${colors.text} mb-4 font-semibold`}>
        {currentTab?.icon} {currentTab?.desc}
      </p>

      {/* 규칙 생성/편집 폼 */}
      {showForm && (
        <RuleForm
          farmId={farmId}
          houses={houses}
          rule={editingRule}
          defaultTab={activeTab}
          onSave={(savedRule) => {
            setShowForm(false);
            setEditingRule(null);
            if (savedRule) {
              // 낙관적 업데이트: 서버 응답 데이터로 즉시 state 반영
              setRules(prev => {
                const exists = prev.find(r => r._id === savedRule._id);
                if (exists) {
                  return prev.map(r => r._id === savedRule._id ? savedRule : r);
                }
                return [savedRule, ...prev];
              });
              // 저장된 규칙의 탭으로 자동 전환
              const hasSensor = savedRule.conditions?.some(c => c.type === 'sensor');
              const hasTime = savedRule.conditions?.some(c => c.type === 'time');
              const targetTab = (hasSensor && hasTime) ? 'custom' : hasTime ? 'schedule' : 'sensor';
              setActiveTab(targetTab);
            }
            // 서버 동기화 (백그라운드)
            setTimeout(() => loadData(), 800);
          }}
          onCancel={() => { setShowForm(false); setEditingRule(null); }}
        />
      )}

      {/* 규칙 목록 */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : filteredRules.length === 0 ? (
        <EmptyState tab={activeTab} onAdd={startNew} />
      ) : (
        <div className="space-y-3">
          {activeTab === 'schedule' ? (
            filteredRules.map(rule => (
              <ScheduleCard
                key={rule._id}
                rule={rule}
                houses={houses}
                onToggle={() => toggleRule(rule._id)}
                onEdit={() => startEdit(rule)}
                onDelete={() => deleteRule(rule._id)}
              />
            ))
          ) : (
            filteredRules.map(rule => (
              <RuleCard
                key={rule._id}
                rule={rule}
                houses={houses}
                tabColor={currentTab?.color || 'violet'}
                onToggle={() => toggleRule(rule._id)}
                onEdit={() => startEdit(rule)}
                onDelete={() => deleteRule(rule._id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};


/**
 * 빈 상태 표시
 */
const EmptyState = ({ tab, onAdd }) => {
  const configs = {
    sensor: { icon: '🌡️', title: '센서 기반 규칙이 없습니다', desc: '온도, 습도 등 센서 값에 따라 장치를 자동 제어합니다', example: '예: 온도 > 30°C → 환풍기 ON' },
    schedule: { icon: '⏰', title: '시간대별 스케줄이 없습니다', desc: '매일 정해진 시간에 장치를 자동으로 작동시킵니다', example: '예: 매일 08:00 → 개폐기 열기' },
    custom: { icon: '⚙️', title: '사용자 정의 규칙이 없습니다', desc: '센서 + 시간 조건을 조합한 복합 규칙을 만듭니다', example: '예: 온도 > 28°C AND 08:00~18:00 → 환풍기 ON' },
  };
  const cfg = configs[tab] || configs.sensor;

  return (
    <div className="glass-card p-12 text-center">
      <div className="text-5xl mb-4 opacity-30">{cfg.icon}</div>
      <p className="text-gray-400 text-lg font-bold">{cfg.title}</p>
      <p className="text-gray-500 text-base mt-1.5">{cfg.desc}</p>
      <p className="text-gray-600 text-sm mt-2 italic">{cfg.example}</p>
      <button onClick={onAdd} className="mt-5 px-6 py-2.5 rounded-lg bg-white/[0.06] text-gray-400 text-base font-semibold hover:bg-white/[0.1] transition-all">
        + 규칙 추가
      </button>
    </div>
  );
};


/**
 * 시간대별 스케줄 카드 (타임라인 UI)
 */
const ScheduleCard = ({ rule, houses, onToggle, onEdit, onDelete }) => {
  const house = houses.find(h => h.houseId === rule.houseId);
  const houseName = house?.houseName || house?.name || rule.houseId;

  // 시간 조건 추출
  const timeCond = rule.conditions?.find(c => c.type === 'time');
  const timeStr = timeCond?.time || '--:--';
  const activeDays = timeCond?.days || [];

  return (
    <div className={`glass-card p-4 md:p-5 transition-all ${!rule.enabled ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-4">
        {/* 시간 표시 (좌측 큰 시계) */}
        <div className="flex-shrink-0 w-24 h-24 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex flex-col items-center justify-center">
          <span className="text-3xl font-black text-amber-400 font-mono leading-none">{timeStr.split(':')[0]}</span>
          <span className="text-sm text-amber-500/60 font-bold">: {timeStr.split(':')[1]}</span>
        </div>

        {/* 내용 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-lg font-extrabold text-white truncate">{rule.name}</h3>
            <span className="text-sm text-gray-400 bg-white/[0.06] px-2.5 py-1 rounded font-semibold">{houseName}</span>
          </div>

          {/* 요일 표시 */}
          <div className="flex gap-1.5 mb-2.5">
            {DAYS_OPTIONS.map(d => (
              <span
                key={d.value}
                className={`w-8 h-8 rounded text-xs font-bold flex items-center justify-center ${
                  activeDays.includes(d.value)
                    ? 'bg-amber-500/80 text-white'
                    : 'bg-white/[0.04] text-gray-600'
                }`}
              >
                {d.label}
              </span>
            ))}
          </div>

          {/* 실행 동작 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-500 font-bold mr-1">→</span>
            {rule.actions.map((action, i) => {
              const dt = DEVICE_TYPE_OPTIONS.find(d => d.value === action.deviceType);
              return (
                <span key={i} className="text-base font-semibold bg-amber-500/10 text-amber-300 border border-amber-500/20 px-3 py-1 rounded-lg">
                  {dt?.icon} {action.deviceName || action.deviceId} {COMMAND_LABELS[action.command] || action.command}
                </span>
              );
            })}
          </div>

          {/* 통계 */}
          <div className="flex items-center gap-4 mt-3 text-sm text-gray-500 font-medium">
            <span>실행 {rule.triggerCount || 0}회</span>
            {rule.lastTriggeredAt && (
              <span>마지막: {new Date(rule.lastTriggeredAt).toLocaleString('ko-KR', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}</span>
            )}
          </div>
        </div>

        {/* 액션 버튼 */}
        <div className="flex flex-col items-end gap-2 flex-shrink-0">
          <button
            onClick={onToggle}
            className={`w-14 h-7 rounded-full transition-all relative ${
              rule.enabled ? 'bg-amber-500' : 'bg-gray-600'
            }`}
          >
            <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-all ${
              rule.enabled ? 'left-7' : 'left-0.5'
            }`} />
          </button>
          <div className="flex gap-1">
            <button onClick={onEdit} className="p-2 rounded-lg text-gray-500 hover:text-amber-400 hover:bg-amber-500/10 text-base transition-all">✏️</button>
            <button onClick={onDelete} className="p-2 rounded-lg text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 text-base transition-all">🗑️</button>
          </div>
        </div>
      </div>
    </div>
  );
};


/**
 * 규칙 카드
 */
const RuleCard = ({ rule, houses, tabColor = 'violet', onToggle, onEdit, onDelete }) => {
  const house = houses.find(h => h.houseId === rule.houseId);
  const houseName = house?.houseName || house?.name || rule.houseId;
  const colors = TAB_COLORS[tabColor] || TAB_COLORS.violet;
  const iconMap = { sensor: '🌡️', schedule: '⏰', custom: '⚙️', violet: '🤖', emerald: '⚙️' };
  const icon = tabColor === 'emerald' ? '⚙️' : '🤖';

  return (
    <div className={`glass-card p-4 md:p-5 transition-all ${!rule.enabled ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* 제목 + 하우스 */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">{icon}</span>
            <h3 className="text-lg font-extrabold text-white truncate">{rule.name}</h3>
            <span className="text-sm text-gray-400 bg-white/[0.06] px-2.5 py-1 rounded font-semibold">
              {houseName}
            </span>
          </div>

          {/* 조건 */}
          <div className="mb-2.5">
            <span className="text-sm text-gray-400 font-bold uppercase">조건 ({rule.conditionLogic})</span>
            <div className="flex flex-wrap gap-2 mt-1.5">
              {rule.conditions.map((cond, i) => (
                <span key={i} className="text-base font-semibold bg-violet-500/10 text-violet-300 border border-violet-500/20 px-3 py-1 rounded-lg">
                  {cond.type === 'sensor'
                    ? `${cond.sensorName || cond.sensorId} ${cond.operator} ${cond.value}`
                    : `⏰ ${cond.time} (${cond.days?.map(d => DAYS_OPTIONS[d]?.label).join(',')})`
                  }
                </span>
              ))}
            </div>
          </div>

          {/* 동작 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-400 font-bold uppercase mr-1">→</span>
            {rule.actions.map((action, i) => {
              const dt = DEVICE_TYPE_OPTIONS.find(d => d.value === action.deviceType);
              return (
                <span key={i} className="text-base font-semibold bg-blue-500/10 text-blue-300 border border-blue-500/20 px-3 py-1 rounded-lg">
                  {dt?.icon} {action.deviceName || action.deviceId} {COMMAND_LABELS[action.command] || action.command}
                </span>
              );
            })}
          </div>

          {/* 통계 */}
          <div className="flex items-center gap-4 mt-3 text-sm text-gray-500 font-medium">
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
            <button onClick={onEdit} className="p-2 rounded-lg text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 text-base transition-all">✏️</button>
            <button onClick={onDelete} className="p-2 rounded-lg text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 text-base transition-all">🗑️</button>
          </div>
        </div>
      </div>
    </div>
  );
};


/**
 * 규칙 생성/편집 폼
 */
const RuleForm = ({ farmId, houses, rule, defaultTab = 'sensor', onSave, onCancel }) => {
  const defaultConditions = {
    sensor: [{ type: 'sensor', sensorId: 'temp_001', sensorName: '온도', operator: '>', value: 30 }],
    schedule: [{ type: 'time', time: '08:00', days: [1, 2, 3, 4, 5] }],
    custom: [
      { type: 'sensor', sensorId: 'temp_001', sensorName: '온도', operator: '>', value: 28 },
      { type: 'time', time: '08:00', days: [1, 2, 3, 4, 5] },
    ],
  };
  const defaultNames = { sensor: '', schedule: '', custom: '' };

  const [form, setForm] = useState({
    name: rule?.name || defaultNames[defaultTab] || '',
    houseId: rule?.houseId || (houses[0]?.houseId || ''),
    conditionLogic: rule?.conditionLogic || (defaultTab === 'custom' ? 'AND' : 'AND'),
    conditions: rule?.conditions || defaultConditions[defaultTab] || defaultConditions.sensor,
    actions: rule?.actions || [{ deviceId: 'fan1', deviceType: 'fan', deviceName: '환풍기 1', command: 'on' }],
    cooldownSeconds: rule?.cooldownSeconds || (defaultTab === 'schedule' ? 60 : 300),
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
      let res;
      if (rule?._id) {
        res = await autoApi('put', `/automation/${farmId}/${rule._id}`, form);
      } else {
        res = await autoApi('post', `/automation/${farmId}`, form);
      }
      const savedRule = res?.data?.data;
      onSave(savedRule || null);
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
    <div className="glass-card p-4 md:p-6 mb-5 border border-violet-500/20 animate-fade-in-up">
      <h2 className="text-lg font-extrabold text-violet-300 mb-5">
        {rule ? '✏️ 규칙 수정' : (
          defaultTab === 'schedule' ? '⏰ 새 시간대별 스케줄' :
          defaultTab === 'custom' ? '⚙️ 새 사용자 정의 규칙' :
          '🌡️ 새 센서 기반 규칙'
        )}
      </h2>

      {/* 기본 정보 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <div>
          <label className="text-sm text-gray-400 font-semibold mb-1.5 block">규칙 이름</label>
          <input
            type="text"
            placeholder="예: 고온 환풍기 자동 가동"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="input-field text-sm"
          />
        </div>
        <div>
          <label className="text-sm text-gray-400 font-semibold mb-1.5 block">대상 하우스</label>
          <select
            value={form.houseId}
            onChange={(e) => setForm({ ...form, houseId: e.target.value })}
            className="input-field text-sm"
          >
            {houses.map(h => (
              <option key={h.houseId} value={h.houseId} className="bg-slate-800">
                {h.houseName || h.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm text-gray-400 font-semibold mb-1.5 block">쿨다운 (분)</label>
          <input
            type="number"
            value={Math.round(form.cooldownSeconds / 60)}
            onChange={(e) => setForm({ ...form, cooldownSeconds: parseInt(e.target.value || 5) * 60 })}
            className="input-field text-sm"
            min="1" max="1440"
          />
        </div>
      </div>

      {/* 조건 */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-bold text-violet-300">조건</span>
          <div className="flex gap-1 bg-white/[0.04] rounded-md p-0.5">
            {['AND', 'OR'].map(logic => (
              <button
                key={logic}
                onClick={() => setForm({ ...form, conditionLogic: logic })}
                className={`px-3 py-1 rounded text-xs font-bold transition-all ${
                  form.conditionLogic === logic ? 'bg-violet-500/80 text-white' : 'text-gray-500'
                }`}
              >
                {logic}
              </button>
            ))}
          </div>
          <div className="flex gap-2 ml-auto">
            <button onClick={() => addCondition('sensor')} className="text-sm text-violet-400 hover:text-violet-300 font-semibold">+ 센서 조건</button>
            <button onClick={() => addCondition('time')} className="text-sm text-amber-400 hover:text-amber-300 font-semibold ml-2">+ 시간 조건</button>
          </div>
        </div>

        <div className="space-y-2">
          {form.conditions.map((cond, idx) => (
            <div key={idx} className="flex items-center gap-2 bg-white/[0.03] rounded-lg p-3">
              {cond.type === 'sensor' ? (
                <>
                  <span className="text-sm text-violet-400 font-bold w-10">IF</span>
                  <select
                    value={cond.sensorId}
                    onChange={(e) => updateCondition(idx, 'sensorId', e.target.value)}
                    className="input-field flex-1 text-sm"
                  >
                    {sensorOptions.map(s => (
                      <option key={s.id} value={s.id} className="bg-slate-800">{s.icon} {s.name}</option>
                    ))}
                  </select>
                  <select
                    value={cond.operator}
                    onChange={(e) => updateCondition(idx, 'operator', e.target.value)}
                    className="input-field w-28 text-sm"
                  >
                    {OPERATOR_OPTIONS.map(o => (
                      <option key={o.value} value={o.value} className="bg-slate-800">{o.label}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={cond.value}
                    onChange={(e) => updateCondition(idx, 'value', parseFloat(e.target.value))}
                    className="input-field w-24 text-sm"
                    step="0.1"
                  />
                </>
              ) : (
                <>
                  <span className="text-sm text-amber-400 font-bold w-10">⏰</span>
                  <input
                    type="time"
                    value={cond.time || '08:00'}
                    onChange={(e) => updateCondition(idx, 'time', e.target.value)}
                    className="input-field w-32 text-sm"
                  />
                  <div className="flex gap-1 flex-wrap">
                    {DAYS_OPTIONS.map(d => (
                      <button
                        key={d.value}
                        onClick={() => {
                          const days = cond.days || [];
                          const updated = days.includes(d.value) ? days.filter(v => v !== d.value) : [...days, d.value];
                          updateCondition(idx, 'days', updated);
                        }}
                        className={`w-8 h-8 rounded text-xs font-bold transition-all ${
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
                className="p-1.5 text-gray-600 hover:text-rose-400 text-sm"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 동작 */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-bold text-blue-300">→ 실행 동작 ({form.actions.length}개)</span>
        </div>

        <div className="space-y-2">
          {form.actions.map((action, idx) => {
            const dt = DEVICE_TYPE_OPTIONS.find(d => d.value === action.deviceType);
            const commands = dt?.commands || ['on', 'off'];

            return (
              <div key={idx} className="flex items-center gap-2 bg-white/[0.03] rounded-lg p-3">
                <span className="text-sm text-blue-400 font-bold w-14 flex-shrink-0">
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
                    className="input-field flex-1 text-sm"
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
                      className="input-field w-32 text-sm"
                    >
                      {DEVICE_TYPE_OPTIONS.map(d => (
                        <option key={d.value} value={d.value} className="bg-slate-800">{d.icon} {d.label}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={action.deviceId}
                      onChange={(e) => updateAction(idx, { deviceId: e.target.value })}
                      className="input-field w-28 text-sm"
                      placeholder="fan1"
                    />
                  </>
                )}

                <select
                  value={action.command}
                  onChange={(e) => updateAction(idx, { command: e.target.value })}
                  className="input-field w-24 text-sm"
                >
                  {commands.map(c => (
                    <option key={c} value={c} className="bg-slate-800">{COMMAND_LABELS[c]}</option>
                  ))}
                </select>

                <button
                  onClick={() => removeAction(idx)}
                  className="p-1.5 text-gray-600 hover:text-rose-400 text-sm flex-shrink-0"
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
            className="w-full flex items-center justify-center gap-1.5 py-3 rounded-lg
                       border-2 border-dashed border-blue-500/30 text-blue-400 text-sm font-semibold
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
