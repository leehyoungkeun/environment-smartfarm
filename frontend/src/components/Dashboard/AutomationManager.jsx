import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { getApiBase, getPcApiBase, getRpiApiBase, isFarmLocalMode } from '../../services/apiSwitcher';

const DEFAULT_SENSOR_OPTIONS = [
  { id: 'temp_001', name: '온도', unit: '°C', icon: '🌡️' },
  { id: 'humidity_001', name: '습도', unit: '%', icon: '💧' },
];

const DEVICE_TYPE_OPTIONS = [
  { value: 'window', label: '1창', icon: '🪟', commands: ['open', 'stop', 'close'] },
  { value: 'side_window', label: '측창', icon: '🪟', commands: ['open', 'stop', 'close'] },
  { value: 'top_window', label: '천창', icon: '🪟', commands: ['open', 'stop', 'close'] },
  { value: 'shade', label: '차광', icon: '🌑', commands: ['open', 'stop', 'close'] },
  { value: 'screen', label: '스크린', icon: '🎞️', commands: ['open', 'stop', 'close'] },
  { value: 'pump', label: '펌프', icon: '🔧', commands: ['on', 'off'] },
  { value: 'motor', label: '모터', icon: '⚙️', commands: ['on', 'off'] },
  { value: 'light', label: '조명', icon: '💡', commands: ['on', 'off'] },
  { value: 'fan', label: '순환팬', icon: '🌀', commands: ['on', 'off'] },
  { value: 'nutrient', label: '양액공급', icon: '💧', commands: ['on', 'off'] },
  { value: 'solution', label: '배양액', icon: '🧪', commands: ['on', 'off'] },
  { value: 'light_ctrl', label: '조명제어', icon: '🔆', commands: ['on', 'off'] },
  { value: 'sprayer', label: '무인방제기', icon: '🚿', commands: ['on', 'off'] },
  { value: 'heater', label: '온풍기', icon: '🔥', commands: ['on', 'off'] },
  { value: 'cooler', label: '냉방기', icon: '❄️', commands: ['on', 'off'] },
  { value: 'co2_supply', label: 'CO2공급기', icon: '💨', commands: ['on', 'off'] },
  { value: 'mist', label: '분무제어', icon: '🌫️', commands: ['on', 'off'] },
  { value: 'valve', label: '관수밸브', icon: '🚰', commands: ['open', 'stop', 'close'] },
  { value: 'etc_device', label: '기타', icon: '🔧', commands: ['on', 'off'] },
];

const OPERATOR_OPTIONS = [
  { value: '>', label: '초과 (>)' },
  { value: '>=', label: '이상 (≥)' },
  { value: '<', label: '미만 (<)' },
  { value: '<=', label: '이하 (≤)' },
];

const DAYS_OPTIONS = [
  { value: 1, label: '월' },
  { value: 2, label: '화' },
  { value: 3, label: '수' },
  { value: 4, label: '목' },
  { value: 5, label: '금' },
  { value: 6, label: '토' },
  { value: 0, label: '일' },
];

const COMMAND_LABELS = {
  open: '열기', close: '닫기', stop: '정지', on: 'ON', off: 'OFF',
};

// RPi-Primary API: 쓰기는 RPi에만 (PC 폴백 없음 → 중복 방지)
// PC 동기화는 syncRulesToPC()로 별도 처리
async function rpiApi(method, path, data) {
  const rpiUrl = getRpiApiBase() + path;
  return await axios({ method, url: rpiUrl, data, timeout: 8000 });
}

// RPi → PC 전체 규칙 동기화 (백그라운드)
// x-api-key 헤더로 인증 → JWT 없는 팜로컬 모드에서도 동작
const SYNC_API_KEY = import.meta.env.VITE_SENSOR_API_KEY;
function syncRulesToPC(farmId) {
  const rpiUrl = getRpiApiBase();
  const pcUrl = getPcApiBase();
  if (rpiUrl === pcUrl) return;

  axios.get(`${rpiUrl}/automation/${farmId}`, { timeout: 5000 })
    .then(res => {
      if (res?.data?.success && Array.isArray(res.data.data) && res.data.data.length > 0) {
        const rules = res.data.data.map(r => ({ ...r, id: r._id || r.id }));
        return axios.post(`${pcUrl}/automation/${farmId}/sync`,
          { rules },
          { timeout: 10000, headers: { 'x-api-key': SYNC_API_KEY } }
        );
      }
    })
    .catch(err => { console.warn('[RulesSync] 동기화 실패:', err.message); });
}

const TABS = [
  { id: 'sensor', label: '센서 기반', icon: '🌡️', color: 'violet', desc: '센서 값에 따른 자동 장치 제어' },
  { id: 'schedule', label: '시간대별', icon: '⏰', color: 'amber', desc: '시간/요일 기반 정기 스케줄' },
  { id: 'custom', label: '사용자 정의', icon: '⚙️', color: 'emerald', desc: '센서 + 시간 복합 조건' },
];

const TAB_COLORS = {
  violet: { bg: 'bg-violet-500', ring: 'ring-violet-500/30', text: 'text-violet-600', light: 'bg-violet-50', border: 'border-violet-200' },
  amber: { bg: 'bg-amber-500', ring: 'ring-amber-500/30', text: 'text-amber-600', light: 'bg-amber-50', border: 'border-amber-200' },
  emerald: { bg: 'bg-emerald-500', ring: 'ring-emerald-500/30', text: 'text-emerald-600', light: 'bg-emerald-50', border: 'border-emerald-200' },
};

const AutomationManager = ({ farmId }) => {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('sensor');
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const mountedRef = useRef(true);
  const reloadTimerRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    };
  }, []);

  // 데이터 로드 (PC + RPi 병렬, RPi 우선 — RPi가 권한 기준)
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const rpiUrl = getRpiApiBase();
      const pcUrl = getApiBase();
      const isDual = rpiUrl !== pcUrl;

      // PC + RPi 병렬 로드 (둘 다 동시 요청 → 지연 없음)
      const [pcRulesRes, rpiRulesRes] = await Promise.all([
        axios.get(`${pcUrl}/automation/${farmId}`, { timeout: 5000 }).catch(() => null),
        isDual ? axios.get(`${rpiUrl}/automation/${farmId}`, { timeout: 5000 }).catch(() => null) : null,
      ]);

      if (!mountedRef.current) return;

      const pcRules = pcRulesRes?.data?.success ? pcRulesRes.data.data : [];
      const rpiRules = rpiRulesRes?.data?.success ? rpiRulesRes.data.data : [];

      // RPi가 권한 기준 → RPi 데이터 있으면 우선, 없으면 PC 폴백
      const finalRules = rpiRules.length > 0 ? rpiRules : pcRules;
      setRules(finalRules.map(r => ({ ...r, _id: r._id || r.id })));

      // RPi와 PC 불일치 시 백그라운드 sync
      if (isDual && rpiRules.length > 0 && rpiRules.length !== pcRules.length) {
        syncRulesToPC(farmId);
      }

    } catch (error) {
      if (!mountedRef.current) return;
      console.error('로드 실패:', error);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [farmId]);

  useEffect(() => { loadData(); }, [loadData]);

  // 편집 중 다른 동작 차단 체크
  const isEditing = () => {
    if (showForm) {
      alert(editingRule
        ? `현재 "${editingRule.name}" 규칙을 편집중입니다. 먼저 저장하거나 취소해주세요.`
        : '현재 새 규칙을 작성중입니다. 먼저 저장하거나 취소해주세요.'
      );
      return true;
    }
    return false;
  };

  // 규칙 삭제 (RPi Primary → PC 동기화)
  const deleteRule = async (ruleId) => {
    if (isEditing()) return;
    if (!confirm('이 자동화 규칙을 삭제하시겠습니까?')) return;
    try {
      await rpiApi('delete', `/automation/${farmId}/${ruleId}`);
      setRules(prev => prev.filter(r => r._id !== ruleId));
      // 삭제 후 RPi 전체 규칙을 PC에 동기화 (PC에 남은 규칙도 정리)
      syncRulesToPC(farmId);
    } catch (error) {
      alert('삭제 실패: ' + error.message);
      loadData();
    }
  };

  // 폼 저장 완료 콜백
  const handleFormSave = (savedRule) => {
    setShowForm(false);
    setEditingRule(null);
    if (savedRule) {
      setRules(prev => {
        const exists = prev.find(r => r._id === savedRule._id);
        if (exists) {
          return prev.map(r => r._id === savedRule._id ? savedRule : r);
        }
        return [savedRule, ...prev];
      });
      const hasSensor = savedRule.conditions?.some(c => c.type === 'sensor');
      const hasTime = savedRule.conditions?.some(c => c.type === 'time');
      const targetTab = (hasSensor && hasTime) ? 'custom' : hasTime ? 'schedule' : 'sensor';
      setActiveTab(targetTab);
    }
    reloadTimerRef.current = setTimeout(() => {
      if (mountedRef.current) loadData();
    }, 800);
  };

  // 편집 시작
  const startEdit = (rule) => {
    if (isEditing()) return;
    setEditingRule(rule);
    setShowForm(true);
  };

  // 새 규칙
  const startNew = () => {
    if (isEditing()) return;
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
    <div>
      {/* 탭 네비게이션 + 새 규칙 */}
      <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-1">
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
                  : 'bg-gray-50 text-gray-500 border-transparent hover:bg-gray-100'
              }`}
            >
              <span className="text-lg">{tab.icon}</span>
              {tab.label}
              {count > 0 && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                  isActive ? `${tc.bg} text-white` : 'bg-gray-200 text-gray-500'
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
        <button onClick={startNew} className="btn-primary ml-auto flex-shrink-0">
          + 새 규칙
        </button>
      </div>

      {/* 탭 설명 */}
      <p className={`text-sm ${colors.text} mb-4 font-semibold`}>
        {currentTab?.icon} {currentTab?.desc}
      </p>

      {/* 새 규칙 폼 (상단) - 새 규칙일 때만 */}
      {showForm && !editingRule && (
        <RuleForm
          farmId={farmId}
          rule={null}
          existingRules={rules}
          defaultTab={activeTab}
          onSave={handleFormSave}
          onCancel={() => { setShowForm(false); setEditingRule(null); }}
        />
      )}

      {/* 규칙 목록 (편집 시 해당 위치에 폼 인라인 표시) */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : filteredRules.length === 0 && !(showForm && !editingRule) ? (
        <EmptyState tab={activeTab} onAdd={startNew} />
      ) : (
        <div className="space-y-3">
          {filteredRules.map(rule => {
            // 편집 중인 규칙이면 폼을 인라인으로 표시
            if (showForm && editingRule && rule._id === editingRule._id) {
              return (
                <RuleForm
                  key={`edit-${rule._id}`}
                  farmId={farmId}
                  rule={editingRule}
                  existingRules={rules}
                  defaultTab={activeTab}
                  onSave={handleFormSave}
                  onCancel={() => { setShowForm(false); setEditingRule(null); }}
                />
              );
            }
            // 일반 카드
            return activeTab === 'schedule' ? (
              <ScheduleCard
                key={rule._id}
                rule={rule}
                onEdit={() => startEdit(rule)}
                onDelete={() => deleteRule(rule._id)}
              />
            ) : (
              <RuleCard
                key={rule._id}
                rule={rule}
                tabColor={currentTab?.color || 'violet'}
                onEdit={() => startEdit(rule)}
                onDelete={() => deleteRule(rule._id)}
              />
            );
          })}
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
      <p className="text-gray-500 text-lg font-bold">{cfg.title}</p>
      <p className="text-gray-400 text-base mt-1.5">{cfg.desc}</p>
      <p className="text-gray-400 text-sm mt-2 italic">{cfg.example}</p>
      <button onClick={onAdd} className="mt-5 px-6 py-2.5 rounded-lg bg-gray-100 text-gray-600 text-base font-semibold hover:bg-gray-200 transition-all">
        + 규칙 추가
      </button>
    </div>
  );
};


/**
 * 시간대별 스케줄 카드 (타임라인 UI)
 */
const ScheduleCard = ({ rule, onEdit, onDelete }) => {
  // 시간 조건 추출
  const timeCond = rule.conditions?.find(c => c.type === 'time');
  const activeDays = timeCond?.days || [];

  // 시간 표시 문자열 생성
  const getTimeDisplay = (cond) => {
    if (!cond) return { main: '--:--', sub: '' };
    const mode = cond.timeMode || 'specific';
    if (mode === 'interval') {
      return { main: `${cond.startTime || '08:00'}`, sub: `~${cond.endTime || '18:00'} (${cond.intervalMinutes || 30}분)` };
    }
    const times = cond.times || (cond.time ? [cond.time] : ['--:--']);
    if (times.length === 1) return { main: times[0], sub: '' };
    return { main: times[0], sub: `외 ${times.length - 1}건` };
  };
  const timeDisplay = getTimeDisplay(timeCond);

  // 동작 duration 표시
  const formatDuration = (action) => {
    if (!action.duration) return '';
    const totalSec = action.duration;
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (m > 0 && s > 0) return ` ${m}분${s}초간`;
    if (m > 0) return ` ${m}분간`;
    return ` ${s}초간`;
  };

  return (
    <div className="glass-card p-4 md:p-5 transition-all">
      <div className="flex items-start gap-4">
        {/* 시간 표시 (좌측 큰 시계) */}
        <div className="flex-shrink-0 w-24 h-24 rounded-2xl bg-amber-50 border border-amber-200 flex flex-col items-center justify-center">
          <span className="text-3xl font-black text-amber-600 font-mono leading-none">{timeDisplay.main.split(':')[0]}</span>
          <span className="text-sm text-amber-500 font-bold">: {timeDisplay.main.split(':')[1]}</span>
          {timeDisplay.sub && <span className="text-[10px] text-amber-400 font-bold mt-0.5">{timeDisplay.sub}</span>}
        </div>

        {/* 내용 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-lg font-extrabold text-gray-800 truncate">{rule.name}</h3>
            {/* 모드 뱃지 */}
            {timeCond?.timeMode === 'interval' && (
              <span className="text-[10px] font-bold bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full">반복</span>
            )}
            {timeCond?.timeMode !== 'interval' && (timeCond?.times?.length || 0) > 1 && (
              <span className="text-[10px] font-bold bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full">{timeCond.times.length}회</span>
            )}
          </div>

          {/* 지정시간 여러개인 경우 시간 목록 표시 */}
          {timeCond?.timeMode !== 'interval' && (timeCond?.times?.length || 0) > 1 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {timeCond.times.map((t, i) => (
                <span key={i} className="text-xs font-bold bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded">
                  {t}
                </span>
              ))}
            </div>
          )}

          {/* 반복 모드 상세 표시 */}
          {timeCond?.timeMode === 'interval' && (
            <div className="text-xs font-semibold text-amber-500 mb-2">
              {timeCond.startTime} ~ {timeCond.endTime} / {timeCond.intervalMinutes}분 간격
            </div>
          )}

          {/* 요일 표시 */}
          <div className="flex gap-1.5 mb-2.5">
            {DAYS_OPTIONS.map(d => (
              <span
                key={d.value}
                className={`w-8 h-8 rounded text-xs font-bold flex items-center justify-center ${
                  activeDays.includes(d.value)
                    ? 'bg-amber-500 text-white'
                    : 'bg-gray-100 text-gray-500'
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
                <span key={i} className="text-base font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1 rounded-lg">
                  {dt?.icon} {action.deviceName || action.deviceId} {COMMAND_LABELS[action.command] || action.command}{formatDuration(action)}
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
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onEdit} className="p-2 rounded-lg text-gray-500 hover:text-amber-400 hover:bg-amber-500/10 text-base transition-all">✏️</button>
          <button onClick={onDelete} className="p-2 rounded-lg text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 text-base transition-all">🗑️</button>
        </div>
      </div>
    </div>
  );
};


/**
 * 규칙 카드
 */
const RuleCard = ({ rule, tabColor = 'violet', onEdit, onDelete }) => {
  const icon = tabColor === 'emerald' ? '⚙️' : '🤖';

  // 조건 그룹 분리
  const sensorConds = (rule.conditions || []).filter(c => c.type === 'sensor');
  const timeConds = (rule.conditions || []).filter(c => c.type === 'time');

  return (
    <div className="glass-card p-4 md:p-5 transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* 제목 */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">{icon}</span>
            <h3 className="text-lg font-extrabold text-gray-800 truncate">{rule.name}</h3>
          </div>

          {/* 조건 - 그룹별 분리 표시 */}
          <div className="mb-2.5">
            {/* 센서 조건 */}
            {sensorConds.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                {sensorConds.map((cond, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="text-xs font-bold text-violet-500">{cond.logic || rule.conditionLogic || 'AND'}</span>}
                    <span className="text-sm font-semibold bg-violet-50 text-violet-700 border border-violet-200 px-2.5 py-0.5 rounded-lg">
                      {cond.sensorName || cond.sensorId} {cond.operator} {cond.value}
                    </span>
                  </React.Fragment>
                ))}
              </div>
            )}
            {/* 그룹 연결 */}
            {sensorConds.length > 0 && timeConds.length > 0 && (
              <div className="my-1">
                <span className={`text-xs font-extrabold px-2.5 py-0.5 rounded-full ${
                  (rule.groupLogic || 'AND') === 'AND'
                    ? 'bg-indigo-100 text-indigo-600 border border-indigo-200'
                    : 'bg-orange-100 text-orange-600 border border-orange-200'
                }`}>{rule.groupLogic || 'AND'}</span>
              </div>
            )}
            {/* 시간 조건 */}
            {timeConds.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {timeConds.map((cond, i) => {
                  const daysStr = DAYS_OPTIONS.filter(o => cond.days?.includes(o.value)).map(o => o.label).join(',');
                  let timeStr;
                  if (cond.timeMode === 'interval') {
                    timeStr = `${cond.startTime || '08:00'}~${cond.endTime || '18:00'} ${cond.intervalMinutes || 30}분간격`;
                  } else if (cond.times && cond.times.length > 0) {
                    timeStr = cond.times.join(', ');
                  } else {
                    timeStr = cond.time || '--:--';
                  }
                  return (
                    <span key={i} className="text-sm font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-0.5 rounded-lg">
                      ⏰ {timeStr} ({daysStr})
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* 동작 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-500 font-bold mr-1">→</span>
            {rule.actions.map((action, i) => {
              const dt = DEVICE_TYPE_OPTIONS.find(d => d.value === action.deviceType);
              const durStr = (() => {
                if (!action.duration) return '';
                const m = Math.floor(action.duration / 60), s = action.duration % 60;
                if (m > 0 && s > 0) return ` ${m}분${s}초간`;
                if (m > 0) return ` ${m}분간`;
                return ` ${s}초간`;
              })();
              return (
                <span key={i} className="text-sm font-semibold bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 rounded-lg">
                  {dt?.icon} {action.deviceName || action.deviceId} {COMMAND_LABELS[action.command] || action.command}{durStr}
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
        <div className="flex items-center gap-1">
          <button onClick={onEdit} className="p-2 rounded-lg text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 text-base transition-all">✏️</button>
          <button onClick={onDelete} className="p-2 rounded-lg text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 text-base transition-all">🗑️</button>
        </div>
      </div>
    </div>
  );
};


/**
 * 규칙 생성/편집 폼
 */
const RuleForm = ({ farmId, rule, existingRules = [], defaultTab = 'sensor', onSave, onCancel }) => {
  const defaultConditions = {
    sensor: [{ type: 'sensor', sensorId: 'temp_001', sensorName: '온도', operator: '>', value: 30 }],
    schedule: [{ type: 'time', timeMode: 'specific', times: ['08:00'], days: [1, 2, 3, 4, 5] }],
    custom: [
      { type: 'sensor', sensorId: 'temp_001', sensorName: '온도', operator: '>', value: 28 },
      { type: 'time', timeMode: 'specific', times: ['08:00'], days: [1, 2, 3, 4, 5] },
    ],
  };
  const defaultNames = { sensor: '', schedule: '', custom: '' };

  const [form, setForm] = useState({
    name: rule?.name || defaultNames[defaultTab] || '',
    conditionLogic: rule?.conditionLogic || 'AND',
    groupLogic: rule?.groupLogic || 'AND',
    conditions: rule?.conditions || defaultConditions[defaultTab] || defaultConditions.sensor,
    actions: rule?.actions || [{ deviceId: 'fan1', deviceType: 'fan', deviceName: '환풍기 1', command: 'on', duration: 0 }],
    cooldownSeconds: rule?.cooldownSeconds || (defaultTab === 'schedule' ? 60 : 300),
  });
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

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
      ? { type: 'sensor', sensorId: firstSensor.id, sensorName: firstSensor.name, operator: '>', value: 30, logic: 'AND' }
      : { type: 'time', timeMode: 'specific', times: ['08:00'], days: [1, 2, 3, 4, 5] };
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
      ? { deviceId: firstDevice.deviceId, deviceType: firstDevice.type, deviceName: firstDevice.name, command: firstDevice.type === 'fan' || firstDevice.type === 'heater' ? 'on' : 'open', duration: 0 }
      : { deviceId: 'fan1', deviceType: 'fan', deviceName: '환풍기 1', command: 'on', duration: 0 };
    setForm({ ...form, actions: [...form.actions, newAction] });
  };

  const removeAction = (idx) => {
    setForm({ ...form, actions: form.actions.filter((_, i) => i !== idx) });
  };

  const handleSave = async () => {
    if (!form.name.trim()) return alert('규칙 이름을 입력하세요');
    // 동일 이름 중복 검사 (수정 시 자기 자신은 제외)
    const duplicate = existingRules.find(r =>
      r.name.trim() === form.name.trim() && r._id !== rule?._id
    );
    if (duplicate) return alert(`"${form.name}" 이름의 규칙이 이미 존재합니다.`);
    if (savingRef.current) return; // 더블클릭 방지
    savingRef.current = true;
    setSaving(true);
    try {
      // 탭 유형에 맞지 않는 조건 제거 + 시간 조건 정규화
      const cleanedForm = { ...form };
      if (defaultTab === 'sensor') {
        cleanedForm.conditions = form.conditions.filter(c => c.type === 'sensor');
      } else if (defaultTab === 'schedule') {
        cleanedForm.conditions = form.conditions.filter(c => c.type === 'time');
      }
      // 시간 조건: timeMode 누락 보정 + 레거시 time→times 변환
      cleanedForm.conditions = cleanedForm.conditions.map(c => {
        if (c.type !== 'time') return c;
        const normalized = { ...c };
        if (!normalized.timeMode) normalized.timeMode = 'specific';
        if (normalized.timeMode === 'specific' && !normalized.times?.length) {
          normalized.times = normalized.time ? [normalized.time] : ['08:00'];
        }
        delete normalized.time; // 레거시 단일 time 필드 제거
        return normalized;
      });

      let res;
      if (rule?._id) {
        res = await rpiApi('put', `/automation/${farmId}/${rule._id}`, cleanedForm);
      } else {
        res = await rpiApi('post', `/automation/${farmId}`, cleanedForm);
      }
      const savedRule = res?.data?.data;
      onSave(savedRule || null);
      // 저장 후 RPi → PC 전체 동기화
      syncRulesToPC(farmId);
    } catch (error) {
      alert('저장 실패: ' + (error.response?.data?.error || error.message));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // 장치/센서 옵션 (하우스 무관 — 일반 규칙)
  const houseDevices = [];
  const sensorOptions = DEFAULT_SENSOR_OPTIONS;

  // 탭별 섹션 표시 제어
  const showSensorSection = defaultTab !== 'schedule';
  const showTimeSection = defaultTab !== 'sensor';

  // 조건 그룹 분리 (원래 인덱스 유지)
  const sensorConds = form.conditions.map((c, i) => ({ ...c, _idx: i })).filter(c => c.type === 'sensor');
  const timeConds = form.conditions.map((c, i) => ({ ...c, _idx: i })).filter(c => c.type === 'time');
  const hasBothTypes = sensorConds.length > 0 && timeConds.length > 0;

  return (
    <div className="glass-card p-4 md:p-6 mb-5 border border-violet-200 animate-fade-in-up">
      <h2 className="text-lg font-extrabold text-violet-600 mb-5">
        {rule ? '✏️ 규칙 수정' : (
          defaultTab === 'schedule' ? '⏰ 새 시간대별 스케줄' :
          defaultTab === 'custom' ? '⚙️ 새 사용자 정의 규칙' :
          '🌡️ 새 센서 기반 규칙'
        )}
      </h2>

      {/* 기본 정보 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
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
        {defaultTab !== 'schedule' && (
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
        )}
      </div>

      {/* ━━━ 센서 조건 ━━━ */}
      {showSensorSection && <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold text-violet-600">🌡️ 센서 조건</span>
          <button onClick={() => addCondition('sensor')} className="text-xs text-violet-600 font-semibold bg-violet-50 px-2.5 py-1 rounded-lg hover:bg-violet-100 transition-all">+ 센서 추가</button>
        </div>
        <div className="border-l-4 border-violet-300 bg-violet-50/50 rounded-r-lg p-3 space-y-2">
          {sensorConds.length > 0 ? sensorConds.map((cond, i) => (
            <React.Fragment key={cond._idx}>
              {i > 0 && (
                <div className="flex items-center justify-center gap-3 py-1">
                  <div className="flex-1 border-t border-dashed border-violet-200" />
                  <div className="flex gap-0.5 bg-white rounded-full p-0.5 shadow-sm border border-gray-200">
                    {['AND', 'OR'].map(logic => (
                      <button
                        key={logic}
                        onClick={() => updateCondition(cond._idx, 'logic', logic)}
                        className={`px-3.5 py-1 rounded-full text-xs font-extrabold transition-all ${
                          (cond.logic || 'AND') === logic
                            ? (logic === 'AND' ? 'bg-violet-500 text-white shadow' : 'bg-orange-500 text-white shadow')
                            : 'text-gray-300 hover:text-gray-500'
                        }`}
                      >
                        {logic}
                      </button>
                    ))}
                  </div>
                  <div className="flex-1 border-t border-dashed border-violet-200" />
                </div>
              )}
            <div className="flex items-center gap-2 bg-white rounded-lg p-2.5 border border-violet-100">
              <span className="text-sm text-violet-600 font-bold w-8 flex-shrink-0">IF</span>
              <select
                value={cond.sensorId}
                onChange={(e) => updateCondition(cond._idx, 'sensorId', e.target.value)}
                className="input-field flex-1 text-sm"
              >
                {sensorOptions.map(s => (
                  <option key={s.id} value={s.id} className="bg-slate-800">{s.icon} {s.name}</option>
                ))}
              </select>
              <select
                value={cond.operator}
                onChange={(e) => updateCondition(cond._idx, 'operator', e.target.value)}
                className="input-field w-28 text-sm"
              >
                {OPERATOR_OPTIONS.map(o => (
                  <option key={o.value} value={o.value} className="bg-slate-800">{o.label}</option>
                ))}
              </select>
              <input
                type="number"
                value={cond.value}
                onChange={(e) => updateCondition(cond._idx, 'value', parseFloat(e.target.value))}
                className="input-field w-24 text-sm"
                step="0.1"
              />
              <button onClick={() => removeCondition(cond._idx)} className="p-1.5 text-gray-400 hover:text-rose-500 text-sm flex-shrink-0">✕</button>
            </div>
            </React.Fragment>
          )) : (
            <p className="text-sm text-violet-400 text-center py-2">센서 조건이 없습니다</p>
          )}
        </div>
      </div>}

      {/* ━━━ 그룹 연결 (AND / OR) ━━━ */}
      {showSensorSection && showTimeSection && hasBothTypes && (
        <div className="flex items-center justify-center gap-3 my-3">
          <div className="flex-1 border-t-2 border-dashed border-violet-200" />
          <div className="flex gap-0.5 bg-white rounded-full p-1 shadow-sm border-2 border-gray-200">
            {['AND', 'OR'].map(logic => (
              <button
                key={logic}
                onClick={() => setForm({ ...form, groupLogic: logic })}
                className={`px-5 py-1.5 rounded-full text-xs font-extrabold transition-all ${
                  form.groupLogic === logic
                    ? (logic === 'AND' ? 'bg-indigo-500 text-white shadow' : 'bg-orange-500 text-white shadow')
                    : 'text-gray-300 hover:text-gray-500'
                }`}
              >
                {logic}
              </button>
            ))}
          </div>
          <div className="flex-1 border-t-2 border-dashed border-amber-200" />
        </div>
      )}

      {/* ━━━ 시간 조건 ━━━ */}
      {showTimeSection && <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold text-amber-600">⏰ 시간 조건</span>
          <button onClick={() => addCondition('time')} className="text-xs text-amber-600 font-semibold bg-amber-50 px-2.5 py-1 rounded-lg hover:bg-amber-100 transition-all">+ 시간 조건 추가</button>
        </div>
        <div className="border-l-4 border-amber-300 bg-amber-50/50 rounded-r-lg p-3 space-y-3">
          {timeConds.length > 0 ? timeConds.map((cond) => {
            // 기존 호환: timeMode 없고 time만 있으면 specific으로 취급
            const timeMode = cond.timeMode || 'specific';
            const times = (cond.times && cond.times.length > 0) ? cond.times : (cond.time ? [cond.time] : ['08:00']);

            return (
              <div key={cond._idx} className="bg-white rounded-lg p-3 border border-amber-100 space-y-2.5">
                {/* 모드 선택 + 삭제 */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-amber-600 font-bold">⏰</span>
                    <select
                      value={timeMode}
                      onChange={(e) => {
                        const mode = e.target.value;
                        if (mode === 'interval') {
                          updateCondition(cond._idx, 'timeMode', 'interval');
                          // interval 필드 기본값 설정
                          const updated = [...form.conditions];
                          updated[cond._idx] = { ...updated[cond._idx], timeMode: 'interval', startTime: cond.startTime || '08:00', endTime: cond.endTime || '18:00', intervalMinutes: cond.intervalMinutes || 30 };
                          delete updated[cond._idx].time;
                          delete updated[cond._idx].times;
                          setForm({ ...form, conditions: updated });
                        } else {
                          const updated = [...form.conditions];
                          updated[cond._idx] = { ...updated[cond._idx], timeMode: 'specific', times: times };
                          delete updated[cond._idx].time;
                          delete updated[cond._idx].startTime;
                          delete updated[cond._idx].endTime;
                          delete updated[cond._idx].intervalMinutes;
                          setForm({ ...form, conditions: updated });
                        }
                      }}
                      className="input-field text-sm py-1"
                    >
                      <option value="specific">지정 시간</option>
                      <option value="interval">반복 (시작~종료, 간격)</option>
                    </select>
                  </div>
                  <button onClick={() => removeCondition(cond._idx)} className="p-1.5 text-gray-400 hover:text-rose-500 text-sm flex-shrink-0">✕</button>
                </div>

                {/* 반복 모드 UI */}
                {timeMode === 'interval' && (
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                      <span style={{fontSize:13,fontWeight:700,color:'#92400e'}}>시작</span>
                      <input type="time" value={cond.startTime || '08:00'}
                        onChange={(e) => updateCondition(cond._idx, 'startTime', e.target.value)}
                        style={{width:'7rem',fontSize:'15px',fontWeight:700,border:'none',background:'transparent',padding:0,color:'#92400e'}} />
                    </div>
                    <span style={{fontSize:16,fontWeight:800,color:'#d97706'}}>~</span>
                    <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                      <span style={{fontSize:13,fontWeight:700,color:'#92400e'}}>종료</span>
                      <input type="time" value={cond.endTime || '18:00'}
                        onChange={(e) => updateCondition(cond._idx, 'endTime', e.target.value)}
                        style={{width:'7rem',fontSize:'15px',fontWeight:700,border:'none',background:'transparent',padding:0,color:'#92400e'}} />
                    </div>
                    <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                      <span style={{fontSize:13,fontWeight:700,color:'#92400e'}}>간격</span>
                      <input type="number" min={1} max={720} value={cond.intervalMinutes || 30}
                        onChange={(e) => updateCondition(cond._idx, 'intervalMinutes', parseInt(e.target.value) || 30)}
                        style={{width:'3.5rem',fontSize:'15px',fontWeight:700,border:'none',background:'transparent',padding:0,color:'#92400e',textAlign:'center'}} />
                      <span style={{fontSize:13,fontWeight:700,color:'#92400e'}}>분</span>
                    </div>
                  </div>
                )}

                {/* 지정 시간 모드 UI - 가로 배치, 줄바꿈 */}
                {timeMode === 'specific' && (
                  <div className="flex flex-wrap items-center gap-2">
                    {times.map((t, ti) => (
                      <div key={ti} className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg pl-2 pr-1 py-1">
                        <input type="time" value={t}
                          onChange={(e) => {
                            const val = e.target.value;
                            if (times.some((existing, idx) => idx !== ti && existing === val)) return;
                            const newTimes = [...times];
                            newTimes[ti] = val;
                            updateCondition(cond._idx, 'times', newTimes);
                          }}
                          style={{width:'7rem',fontSize:'15px',fontWeight:700,border:'none',background:'transparent',padding:0,color:'#92400e'}} />
                        {times.length > 1 && (
                          <button onClick={() => {
                            const newTimes = times.filter((_, i) => i !== ti);
                            updateCondition(cond._idx, 'times', newTimes);
                          }} className="text-gray-400 hover:text-rose-500 text-base leading-none px-1">✕</button>
                        )}
                      </div>
                    ))}
                    <button onClick={() => {
                        // 중복되지 않는 새 시간 찾기
                        let newTime = '08:00';
                        for (let h = 0; h < 24; h++) {
                          for (let m = 0; m < 60; m += 30) {
                            const t = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
                            if (!times.includes(t)) { newTime = t; h = 24; break; }
                          }
                        }
                        if (times.includes(newTime)) return alert('더 이상 추가할 수 없습니다');
                        updateCondition(cond._idx, 'times', [...times, newTime]);
                      }}
                      className="text-sm text-amber-600 font-bold border-2 border-dashed border-amber-300 px-3 py-1.5 rounded-lg hover:bg-amber-100 transition-all">
                      + 추가
                    </button>
                  </div>
                )}

                {/* 요일 선택 (공통) */}
                <div className="flex gap-1 flex-wrap">
                  {DAYS_OPTIONS.map(d => (
                    <button
                      key={d.value}
                      onClick={() => {
                        const days = cond.days || [];
                        const updated = days.includes(d.value) ? days.filter(v => v !== d.value) : [...days, d.value];
                        updateCondition(cond._idx, 'days', updated);
                      }}
                      className={`w-8 h-8 rounded text-xs font-bold transition-all ${
                        (cond.days || []).includes(d.value)
                          ? 'bg-amber-500 text-white'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          }) : (
            <p className="text-sm text-amber-400 text-center py-2">시간 조건이 없습니다</p>
          )}
        </div>
      </div>}

      {/* ━━━ 실행 동작 연결 ━━━ */}
      <div className="flex items-center justify-center my-3">
        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 text-lg font-bold">↓</div>
      </div>

      {/* ━━━ 실행 동작 ━━━ */}
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold text-blue-600">🔧 실행 동작 ({form.actions.length}개)</span>
        </div>
        <div className="border-l-4 border-blue-300 bg-blue-50/50 rounded-r-lg p-3 space-y-2">
          {form.actions.map((action, idx) => {
            const dt = DEVICE_TYPE_OPTIONS.find(d => d.value === action.deviceType);
            const commands = dt?.commands || ['on', 'off'];
            const isTimed = action.duration > 0;
            const durationUnit = action.durationUnit || 'minutes';
            return (
              <div key={idx} className="bg-white rounded-xl border border-blue-100 overflow-hidden">
                {/* 1행: 장치 + 명령 + 삭제 */}
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <span style={{fontSize:13,fontWeight:800,color:'#2563eb',minWidth:40}}>
                    {idx === 0 ? 'THEN' : `+${idx + 1}`}
                  </span>
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
                    className="p-1.5 text-gray-400 hover:text-rose-500 text-sm flex-shrink-0"
                    title="동작 삭제"
                  >✕</button>
                </div>
                {/* 2행: 동작 지속시간 */}
                <div style={{display:'flex',alignItems:'center',gap:12,padding:'10px 14px',background: isTimed ? '#eff6ff' : '#f8fafc',borderTop:'1px solid #e2e8f0'}}>
                  {/* 계속 / 동작시간 세그먼트 */}
                  <div style={{display:'inline-flex',borderRadius:12,background:'#e2e8f0',padding:3,flexShrink:0}}>
                    <button type="button"
                      onClick={() => updateAction(idx, { duration: 0, durationUnit: 'minutes' })}
                      style={{
                        width:72,padding:'8px 0',fontSize:13,fontWeight:800,border:'none',cursor:'pointer',borderRadius:10,
                        background: !isTimed ? '#fff' : 'transparent',
                        color: !isTimed ? '#1e40af' : '#94a3b8',
                        boxShadow: !isTimed ? '0 1px 4px rgba(0,0,0,0.12)' : 'none',
                        transition:'all 0.2s',
                      }}
                    >계속</button>
                    <button type="button"
                      onClick={() => { if (!isTimed) updateAction(idx, { duration: 60, durationUnit: 'minutes' }); }}
                      style={{
                        width:72,padding:'8px 0',fontSize:13,fontWeight:800,border:'none',cursor:'pointer',borderRadius:10,
                        background: isTimed ? '#fff' : 'transparent',
                        color: isTimed ? '#1e40af' : '#94a3b8',
                        boxShadow: isTimed ? '0 1px 4px rgba(0,0,0,0.12)' : 'none',
                        transition:'all 0.2s',
                      }}
                    >동작시간</button>
                  </div>
                  {isTimed && (() => {
                    const totalSec = action.duration || 60;
                    const mins = Math.floor(totalSec / 60);
                    const secs = totalSec % 60;
                    const setDuration = (m, s) => {
                      const total = Math.max(1, (m || 0) * 60 + (s || 0));
                      updateAction(idx, { duration: total, durationUnit: 'minutes' });
                    };
                    return (
                      <div style={{display:'flex',alignItems:'center',gap:6,background:'#fff',borderRadius:10,padding:'4px 10px',border:'1.5px solid #bfdbfe'}}>
                        <input type="number" min={0} max={999} value={mins}
                          onChange={(e) => setDuration(parseInt(e.target.value) || 0, secs)}
                          style={{width:'3rem',fontSize:16,fontWeight:800,textAlign:'center',padding:'4px 0',border:'none',background:'transparent',color:'#1e40af',outline:'none'}}
                        />
                        <span style={{fontSize:13,fontWeight:700,color:'#64748b'}}>분</span>
                        <div style={{width:1,height:18,background:'#cbd5e1'}} />
                        <input type="number" min={0} max={59} value={secs}
                          onChange={(e) => setDuration(mins, parseInt(e.target.value) || 0)}
                          style={{width:'3rem',fontSize:16,fontWeight:800,textAlign:'center',padding:'4px 0',border:'none',background:'transparent',color:'#1e40af',outline:'none'}}
                        />
                        <span style={{fontSize:13,fontWeight:700,color:'#64748b'}}>초</span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })}
          <button
            onClick={addAction}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-lg
                       border-2 border-dashed border-blue-200 text-blue-500 text-sm font-semibold
                       hover:border-blue-300 hover:bg-white transition-all"
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
