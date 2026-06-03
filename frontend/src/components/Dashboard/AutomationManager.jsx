import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import { getApiBase } from '../../services/apiSwitcher';

const DEFAULT_SENSOR_OPTIONS = [
  { id: 'temp_0001', name: '온도', unit: '°C', icon: '🌡️' },
  { id: 'humidity_0001', name: '습도', unit: '%', icon: '💧' },
];

const SENSOR_TYPE_ICONS = {
  temp: '🌡️', humidity: '💧', co2: '💨', light: '☀️',
  soil_temp: '🌱', soil_humidity: '🌱', wind: '🌬️', rain: '🌧️',
  ph: '🧪', ec: '⚡', do: '🫧', pressure: '🌡️',
};

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
  open: '열기', close: '닫기', stop: '정지', on: '켜짐', off: '꺼짐',
};

// PC Server API: 단일 진실 소스 (PC 서버 → MQTT 알림 → RPi pull)
async function serverApi(method, path, data) {
  const baseUrl = getApiBase() + path;
  return await axios({ method, url: baseUrl, data, timeout: 8000 });
}

const TABS = [
  { id: 'sensor', label: '센서 기반', icon: '🌡️', color: 'violet', desc: '센서 값에 따른 자동 장치 제어' },
  { id: 'schedule', label: '시간대별', icon: '⏰', color: 'amber', desc: '시간/요일 기반 정기 스케줄' },
  { id: 'custom', label: '사용자 정의', icon: '⚙️', color: 'emerald', desc: '센서 + 시간 복합 조건' },
];


// 시간/분 드롭다운 선택기
const TimeSelect = ({ value, onChange }) => {
  const [h, m] = (value || '08:00').split(':').map(Number);
  const update = (newH, newM) => {
    onChange(`${String(newH).padStart(2,'0')}:${String(newM).padStart(2,'0')}`);
  };
  return (
    <span className="inline-flex items-center bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <select value={h} onChange={e => update(+e.target.value, m)}
        className="appearance-none bg-transparent text-center font-bold text-gray-800 px-2 py-1.5 cursor-pointer hover:bg-blue-50 transition-colors outline-none"
        style={{fontSize:15}}>
        {Array.from({length:24},(_,i)=>i).map(i => <option key={i} value={i}>{String(i).padStart(2,'0')}</option>)}
      </select>
      <span className="text-gray-400 font-bold">:</span>
      <select value={m} onChange={e => update(h, +e.target.value)}
        className="appearance-none bg-transparent text-center font-bold text-gray-800 px-2 py-1.5 cursor-pointer hover:bg-blue-50 transition-colors outline-none"
        style={{fontSize:15}}>
        {[0,5,10,15,20,25,30,35,40,45,50,55].map(i => <option key={i} value={i}>{String(i).padStart(2,'0')}</option>)}
      </select>
    </span>
  );
};

const AutomationManager = ({ farmId, houses = [] }) => {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('sensor');
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [selectedHouseId, setSelectedHouseId] = useState(houses[0]?.houseId || 'house_0001');
  const mountedRef = useRef(true);
  const reloadTimerRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
    };
  }, []);

  // 데이터 로드 (PC 서버 = 단일 진실 소스)
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await serverApi('get', `/automation/${farmId}`);
      if (!mountedRef.current) return;
      const rules = res?.data?.success ? res.data.data : [];
      setRules(rules.map(r => ({ ...r, _id: r._id || r.id })));

    } catch (error) {
      if (!mountedRef.current) return;
      console.error('로드 실패:', error);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [farmId]);

  useEffect(() => { loadData(); }, [loadData]);

  // houses 로드 시 selectedHouseId 초기화
  useEffect(() => {
    if (houses.length > 0 && !houses.find(h => h.houseId === selectedHouseId)) {
      setSelectedHouseId(houses[0].houseId);
    }
  }, [houses]);

  // 선택된 하우스의 규칙만 필터링
  const houseRules = rules.filter(r => r.houseId === selectedHouseId);

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

  // 규칙 활성화/비활성화 토글
  const toggleRule = async (ruleId, currentEnabled) => {
    if (isEditing()) return;
    try {
      await serverApi('put', `/automation/${farmId}/${ruleId}`, { enabled: !currentEnabled });
      setRules(prev => prev.map(r => r._id === ruleId ? { ...r, enabled: !currentEnabled } : r));
    } catch (error) {
      alert('변경 실패: ' + error.message);
      loadData();
    }
  };

  // 규칙 삭제 (RPi Primary → PC 동기화)
  const deleteRule = async (ruleId) => {
    if (isEditing()) return;
    if (!confirm('이 자동화 규칙을 삭제하시겠습니까?')) return;
    try {
      await serverApi('delete', `/automation/${farmId}/${ruleId}`);
      setRules(prev => prev.filter(r => r._id !== ruleId));
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

  const filteredRules = houseRules.filter(r => categorizeRule(r) === activeTab);
  const currentTab = TABS.find(t => t.id === activeTab);

  return (
    <div>
      {/* 하우스 선택 */}
      {houses.length > 1 && (
        <div className="flex items-center gap-2 mb-3 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
          {houses.map(h => (
            <button
              key={h.houseId}
              onClick={() => { if (!isEditing()) setSelectedHouseId(h.houseId); }}
              className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-all border whitespace-nowrap flex-shrink-0 ${
                selectedHouseId === h.houseId
                  ? 'bg-green-600 text-white shadow-md border-green-700'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200 border-gray-300'
              }`}
            >
              {h.name || `${parseInt(h.houseId.replace(/\D/g,''))}번 하우스`}
            </button>
          ))}
        </div>
      )}

      {/* 탭 네비게이션 + 새 규칙 (모바일은 탭 옆 + 아이콘, 데스크탑은 탭 옆 텍스트) */}
      <div className="flex items-center gap-1 md:gap-2 mb-3 md:mb-4">
        <div
          className="flex items-center gap-1 md:gap-2 overflow-x-auto pb-1 flex-1 min-w-0"
          style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}
        >
          {TABS.map(tab => {
            const count = houseRules.filter(r => categorizeRule(r) === tab.id).length;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1 md:gap-1.5 px-2.5 md:px-4 py-2 md:py-2.5 rounded-lg text-xs md:text-sm font-bold transition-all border whitespace-nowrap flex-shrink-0 ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25 border-blue-700'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200 border-gray-300'
                }`}
              >
                <span className="text-sm md:text-base">{tab.icon}</span>
                {tab.label}
                {count > 0 && (
                  <span className={`text-[10px] md:text-xs px-1.5 py-0.5 rounded-full font-bold ${
                    isActive ? 'bg-white/25 text-white' : 'bg-gray-300 text-gray-600'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button
          onClick={startNew}
          className="btn-primary flex-shrink-0 flex items-center justify-center w-10 h-10 p-0 text-2xl leading-none md:w-auto md:h-auto md:px-4 md:py-2.5 md:text-sm font-extrabold"
          title="새 규칙 추가"
          aria-label="새 규칙 추가"
        >
          <span className="md:hidden">＋</span>
          <span className="hidden md:inline">+ 새 규칙</span>
        </button>
      </div>

      {/* 탭 설명 */}
      <p className="text-sm text-gray-500 mb-4 font-semibold">
        {currentTab?.icon} {currentTab?.desc}
      </p>

      {/* 새 규칙 폼 (상단) - 새 규칙일 때만 */}
      {showForm && !editingRule && (
        <RuleForm
          farmId={farmId}
          houseId={selectedHouseId}
          houses={houses}
          rule={null}
          existingRules={houseRules}
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
                  houseId={selectedHouseId}
                  houses={houses}
                  rule={editingRule}
                  existingRules={houseRules}
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
                onToggle={() => toggleRule(rule._id, rule.enabled)}
              />
            ) : (
              <RuleCard
                key={rule._id}
                rule={rule}
                tabColor={currentTab?.color || 'violet'}
                onEdit={() => startEdit(rule)}
                onDelete={() => deleteRule(rule._id)}
                onToggle={() => toggleRule(rule._id, rule.enabled)}
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
const ScheduleCard = ({ rule, onEdit, onDelete, onToggle }) => {
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
    <div className={`glass-card p-3 md:p-5 transition-all ${!rule.enabled ? 'opacity-50' : ''}`}>
      {/* 1행: 시간 뱃지 + 이름 + 토글 */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg flex-shrink-0 font-mono">
          {timeDisplay.main}
        </span>
        <h3 className="text-base font-extrabold text-gray-800 truncate flex-1">{rule.name}</h3>
        <button onClick={onToggle} className={`w-11 h-6 rounded-full transition-all flex-shrink-0 relative ${rule.enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${rule.enabled ? 'left-5' : 'left-0.5'}`} />
        </button>
        {timeCond?.timeMode === 'interval' && (
          <span className="text-[10px] font-bold bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full flex-shrink-0">반복</span>
        )}
        {timeCond?.timeMode !== 'interval' && (timeCond?.times?.length || 0) > 1 && (
          <span className="text-[10px] font-bold bg-amber-100 text-amber-600 px-2 py-0.5 rounded-full flex-shrink-0">{timeCond.times.length}회</span>
        )}
      </div>

      {/* 반복 모드 상세 */}
      {timeCond?.timeMode === 'interval' && (
        <div className="text-xs font-semibold text-amber-500 mb-2">
          {timeCond.startTime} ~ {timeCond.endTime} / {timeCond.intervalMinutes}분 간격
        </div>
      )}

      {/* 지정시간 여러개 */}
      {timeCond?.timeMode !== 'interval' && (timeCond?.times?.length || 0) > 1 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {timeCond.times.map((t, i) => (
            <span key={i} className="text-xs font-bold bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded">{t}</span>
          ))}
        </div>
      )}

      {/* 요일 */}
      <div className="flex gap-1 mb-2">
        {DAYS_OPTIONS.map(d => (
          <span key={d.value} className={`w-7 h-7 rounded text-xs font-bold flex items-center justify-center ${
            activeDays.includes(d.value) ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-400'
          }`}>{d.label}</span>
        ))}
      </div>

      {/* 실행 동작 */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <span className="text-sm text-gray-400 font-bold">→</span>
        {rule.actions.map((action, i) => {
          const dt = DEVICE_TYPE_OPTIONS.find(d => d.value === action.deviceType);
          return (
            <span key={i} className="text-sm font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-lg">
              {dt?.icon} {action.deviceName || action.deviceId} {COMMAND_LABELS[action.command] || action.command}{formatDuration(action)}
            </span>
          );
        })}
      </div>

      {/* 하단: 통계 + 수정/삭제 */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <span className="text-xs text-gray-400 font-medium">
          실행 {rule.triggerCount || 0}회
          {rule.lastTriggeredAt && ` · ${new Date(rule.lastTriggeredAt).toLocaleString('ko-KR', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}`}
        </span>
        <div className="flex gap-1.5">
          <button onClick={onEdit} className="px-3 py-1.5 rounded-lg text-xs font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-all">수정</button>
          <button onClick={onDelete} className="px-3 py-1.5 rounded-lg text-xs font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-all">삭제</button>
        </div>
      </div>
    </div>
  );
};


/**
 * 규칙 카드
 */
const RuleCard = ({ rule, tabColor = 'violet', onEdit, onDelete, onToggle }) => {
  const icon = tabColor === 'emerald' ? '⚙️' : '🤖';

  // 조건 그룹 분리
  const sensorConds = (rule.conditions || []).filter(c => c.type === 'sensor');
  const timeConds = (rule.conditions || []).filter(c => c.type === 'time');

  return (
    <div className={`glass-card p-4 md:p-5 transition-all ${!rule.enabled ? 'opacity-50' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* 제목 + 활성화 토글 */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">{icon}</span>
            <h3 className="text-lg font-extrabold text-gray-800 truncate">{rule.name}</h3>
            <button onClick={onToggle} className={`ml-auto w-11 h-6 rounded-full transition-all flex-shrink-0 relative ${rule.enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${rule.enabled ? 'left-5' : 'left-0.5'}`} />
            </button>
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
            {timeConds.length > 0 && timeConds.map((cond, i) => (
              <div key={i} className="mb-1.5">
                {/* 시간 뱃지 */}
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {cond.timeMode === 'interval' ? (
                    <span className="text-xs font-bold bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded">
                      ⏰ {cond.startTime || '08:00'}~{cond.endTime || '18:00'} / {cond.intervalMinutes || 30}분 간격
                    </span>
                  ) : (cond.times && cond.times.length > 0) ? (
                    cond.times.map((t, ti) => (
                      <span key={ti} className="text-xs font-bold bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded">
                        {t}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs font-bold bg-amber-50 text-amber-600 border border-amber-200 px-2 py-0.5 rounded">
                      {cond.time || '--:--'}
                    </span>
                  )}
                </div>
                {/* 요일 뱃지 */}
                <div className="flex gap-1">
                  {DAYS_OPTIONS.map(d => (
                    <span key={d.value} className={`w-6 h-6 rounded text-xs font-bold flex items-center justify-center ${
                      cond.days?.includes(d.value)
                        ? 'bg-amber-500 text-white'
                        : 'bg-gray-100 text-gray-400'
                    }`}>
                      {d.label}
                    </span>
                  ))}
                </div>
              </div>
            ))}
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
        <div className="flex flex-col items-center gap-1 flex-shrink-0">
          <button onClick={onEdit} className="px-3 py-1.5 rounded-lg text-sm font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition-all">수정</button>
          <button onClick={onDelete} className="px-3 py-1.5 rounded-lg text-sm font-medium text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-all">삭제</button>
        </div>
      </div>
    </div>
  );
};


/**
 * 규칙 생성/편집 폼
 */
const RuleForm = ({ farmId, houseId, houses = [], rule, existingRules = [], defaultTab = 'sensor', onSave, onCancel }) => {
  const defaultConditions = {
    sensor: [{ type: 'sensor', sensorId: 'temp_0001', sensorName: '온도', operator: '>', value: 30 }],
    schedule: [{ type: 'time', timeMode: 'specific', times: ['08:00'], days: [1, 2, 3, 4, 5] }],
    custom: [
      { type: 'sensor', sensorId: 'temp_0001', sensorName: '온도', operator: '>', value: 28 },
      { type: 'time', timeMode: 'specific', times: ['08:00'], days: [1, 2, 3, 4, 5] },
    ],
  };
  const defaultNames = { sensor: '', schedule: '', custom: '' };

  const [form, setForm] = useState({
    name: rule?.name || defaultNames[defaultTab] || '',
    conditionLogic: rule?.conditionLogic || 'AND',
    groupLogic: rule?.groupLogic || 'AND',
    conditions: rule?.conditions || defaultConditions[defaultTab] || defaultConditions.sensor,
    actions: (rule?.actions || [{ deviceId: '', deviceType: '', deviceName: '', command: 'on', duration: 0 }]).map(a => {
      // DB의 duration을 항상 초 단위로 정규화
      let dur = a.duration || 0;
      if (a.durationUnit === 'minutes') dur = dur * 60;
      else if (a.durationUnit === 'hours') dur = dur * 3600;
      return { ...a, duration: dur, durationUnit: 'seconds' };
    }),
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
    const firstSensor = sensorOptions[0] || { id: 'temp_0001', name: '온도' };
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
    // 한 규칙 = 한 deviceType 원칙 (옵션 A):
    //   - 기존 action 의 deviceType 가 있으면 같은 type 의 다른 device 만 추가 가능
    //   - 같은 type 의 다른 device 가 없으면 alert 후 차단
    const firstActionType = form.actions[0]?.deviceType;
    const candidates = firstActionType
      ? houseDevices.filter(d => d.type === firstActionType && !form.actions.some(a => a.deviceId === d.deviceId))
      : houseDevices;
    if (firstActionType && candidates.length === 0) {
      alert(`같은 종류(${firstActionType})의 다른 장치가 없습니다.\n다른 종류의 장치를 동작시키려면 별도 규칙을 만드세요.`);
      return;
    }
    const firstDevice = candidates[0];
    const newAction = firstDevice
      ? { deviceId: firstDevice.deviceId, deviceType: firstDevice.type, deviceName: firstDevice.name, command: firstDevice.type === 'fan' || firstDevice.type === 'heater' ? 'on' : 'open', duration: 0 }
      : { deviceId: '', deviceType: '', deviceName: '', command: 'on', duration: 0 };
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
    // 한 규칙 = 한 deviceType 검증 (옵션 A)
    const types = new Set(form.actions.map(a => a.deviceType).filter(Boolean));
    if (types.size > 1) {
      return alert(`한 규칙에는 같은 종류의 장치만 추가할 수 있습니다 (현재: ${[...types].join(', ')}).\n다른 종류는 별도 규칙을 만드세요.`);
    }
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

      // houseId 설정: prop으로 전달받은 선택된 하우스
      cleanedForm.houseId = houseId || rule?.houseId || 'house_0001';

      let res;
      if (rule?._id) {
        res = await serverApi('put', `/automation/${farmId}/${rule._id}`, cleanedForm);
      } else {
        // 새 규칙은 활성화 상태로 생성
        cleanedForm.enabled = true;
        res = await serverApi('post', `/automation/${farmId}`, cleanedForm);
      }
      const savedRule = res?.data?.data;
      onSave(savedRule || null);
    } catch (error) {
      alert('저장 실패: ' + (error.response?.data?.error || error.message));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // 선택된 하우스의 장치 목록
  const selectedHouse = houses.find(h => h.houseId === houseId);
  const houseDevices = (selectedHouse?.devices || []).map(d => {
    const dt = DEVICE_TYPE_OPTIONS.find(t => t.value === d.type);
    return { ...d, icon: dt?.icon || '🔧', commands: dt?.commands || ['on', 'off'] };
  });
  const sensorOptions = (() => {
    const sensors = selectedHouse?.sensors || [];
    if (sensors.length === 0) return DEFAULT_SENSOR_OPTIONS;
    return sensors.map(s => {
      const typeKey = (s.sensorId || '').split('_')[0];
      return {
        id: s.sensorId,
        name: s.name || s.sensorId,
        unit: s.unit || '',
        icon: SENSOR_TYPE_ICONS[typeKey] || '📊',
      };
    });
  })();

  // 탭별 섹션 표시 제어
  const showSensorSection = defaultTab !== 'schedule';
  const showTimeSection = defaultTab !== 'sensor';

  // 조건 그룹 분리 (원래 인덱스 유지)
  const sensorConds = form.conditions.map((c, i) => ({ ...c, _idx: i })).filter(c => c.type === 'sensor');
  const timeConds = form.conditions.map((c, i) => ({ ...c, _idx: i })).filter(c => c.type === 'time');
  const hasBothTypes = sensorConds.length > 0 && timeConds.length > 0;

  return (
    <div className="glass-card p-3 md:p-6 mb-5 border border-violet-200 animate-fade-in-up overflow-hidden">
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
            <div className="flex items-center gap-1.5 md:gap-2 bg-white rounded-lg p-2 md:p-2.5 border border-violet-100 flex-wrap">
              <span className="text-xs md:text-sm text-violet-600 font-bold w-6 md:w-8 flex-shrink-0">IF</span>
              <select
                value={cond.sensorId}
                onChange={(e) => updateCondition(cond._idx, 'sensorId', e.target.value)}
                className="input-field flex-1 min-w-0 text-xs md:text-sm"
              >
                {sensorOptions.map(s => (
                  <option key={s.id} value={s.id} className="bg-slate-800">{s.name}</option>
                ))}
              </select>
              <select
                value={cond.operator}
                onChange={(e) => updateCondition(cond._idx, 'operator', e.target.value)}
                className="input-field w-20 md:w-28 text-xs md:text-sm"
              >
                {OPERATOR_OPTIONS.map(o => (
                  <option key={o.value} value={o.value} className="bg-slate-800">{o.label}</option>
                ))}
              </select>
              <input
                type="number"
                value={cond.value}
                onChange={(e) => updateCondition(cond._idx, 'value', parseFloat(e.target.value))}
                className="input-field w-16 md:w-24 text-xs md:text-sm"
                step="0.1"
              />
              <button onClick={() => removeCondition(cond._idx)} className="p-1 text-gray-400 hover:text-rose-500 text-sm flex-shrink-0">✕</button>
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
        <div className="space-y-3">
          {timeConds.length > 0 ? timeConds.map((cond) => {
            // 기존 호환: timeMode 없고 time만 있으면 specific으로 취급
            const timeMode = cond.timeMode || 'specific';
            const times = (cond.times && cond.times.length > 0) ? cond.times : (cond.time ? [cond.time] : ['08:00']);

            return (
              <div key={cond._idx} className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm space-y-3">
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
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">시작</span>
                    <TimeSelect value={cond.startTime || '08:00'}
                      onChange={(val) => updateCondition(cond._idx, 'startTime', val)} />
                    <span className="text-gray-300 font-bold text-lg">→</span>
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">종료</span>
                    <TimeSelect value={cond.endTime || '18:00'}
                      onChange={(val) => updateCondition(cond._idx, 'endTime', val)} />
                    <span className="text-gray-300 mx-1">|</span>
                    <div className="inline-flex items-center bg-white rounded-lg border border-gray-200 shadow-sm px-2.5 py-1">
                      <span className="text-xs font-semibold text-gray-500 mr-1.5">매</span>
                      <input type="number" min={1} max={720} value={cond.intervalMinutes || 30}
                        onChange={(e) => updateCondition(cond._idx, 'intervalMinutes', parseInt(e.target.value) || 30)}
                        className="w-12 text-center font-bold text-gray-800 bg-transparent border-none outline-none"
                        style={{fontSize:15}} />
                      <span className="text-xs font-semibold text-gray-500 ml-0.5">분</span>
                    </div>
                  </div>
                )}

                {/* 지정 시간 모드 UI */}
                {timeMode === 'specific' && (
                  <div className="flex flex-wrap items-center gap-2">
                    {times.map((t, ti) => (
                      <div key={ti} className="inline-flex items-center gap-1 bg-gray-50 rounded-lg pl-1 pr-0.5 py-0.5 border border-gray-200">
                        <TimeSelect value={t}
                          onChange={(val) => {
                            if (times.some((existing, idx) => idx !== ti && existing === val)) return;
                            const newTimes = [...times];
                            newTimes[ti] = val;
                            updateCondition(cond._idx, 'times', newTimes);
                          }} />
                        {times.length > 1 && (
                          <button onClick={() => {
                            const newTimes = times.filter((_, i) => i !== ti);
                            updateCondition(cond._idx, 'times', newTimes);
                          }} className="w-6 h-6 rounded-md text-gray-300 hover:text-rose-500 hover:bg-rose-50 text-sm flex items-center justify-center transition-all">✕</button>
                        )}
                      </div>
                    ))}
                    <button onClick={() => {
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
                      className="w-8 h-8 rounded-lg text-blue-500 font-bold border-2 border-dashed border-blue-200 hover:bg-blue-50 hover:border-blue-400 transition-all flex items-center justify-center text-lg">+</button>
                  </div>
                )}

                {/* 요일 선택 (공통) */}
                <div className="flex gap-1 md:gap-1.5 flex-nowrap">
                  {DAYS_OPTIONS.map(d => (
                    <button
                      key={d.value}
                      onClick={() => {
                        const days = cond.days || [];
                        const updated = days.includes(d.value) ? days.filter(v => v !== d.value) : [...days, d.value];
                        updateCondition(cond._idx, 'days', updated);
                      }}
                      className={`flex-1 min-w-0 h-8 md:h-9 rounded-lg text-xs font-bold transition-all border ${
                        (cond.days || []).includes(d.value)
                          ? 'bg-blue-500 text-white border-blue-600 shadow-sm'
                          : 'bg-white text-gray-400 border-gray-200 hover:border-blue-300 hover:text-blue-400'
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
            // bidir 장치(측창·차광·관수밸브 등): action.duration 무의미 — 한계까지 완전 동작
            // commands 에 'open'·'close' 둘 다 있으면 bidir
            const isBidir = commands.includes('open') && commands.includes('close');
            const isTimed = !isBidir && action.duration > 0;
            const durationUnit = action.durationUnit || 'minutes';
            return (
              <div key={idx} className="bg-white rounded-xl border border-blue-100 overflow-hidden">
                {/* 1행: 장치 + 명령 + 삭제 */}
                <div className="flex items-center gap-1.5 md:gap-2 px-2 md:px-3 py-2 md:py-2.5 flex-wrap">
                  <span style={{fontSize:12,fontWeight:800,color:'#2563eb',minWidth:36}}>
                    {idx === 0 ? 'THEN' : `+${idx + 1}`}
                  </span>
                  {houseDevices.length > 0 ? (() => {
                    // 한 규칙 = 한 deviceType (옵션 A):
                    //   첫 action 이 아니면 첫 action 의 deviceType 만 선택 가능
                    const firstActionType = form.actions[0]?.deviceType;
                    const lockedType = idx > 0 ? firstActionType : null;
                    const visibleDevices = lockedType
                      ? houseDevices.filter(d => d.type === lockedType)
                      : houseDevices;
                    return (
                    <select
                      value={visibleDevices.some(d => d.deviceId === action.deviceId) ? action.deviceId : ''}
                      onChange={(e) => {
                        const dev = visibleDevices.find(d => d.deviceId === e.target.value);
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
                      className="input-field flex-1 min-w-0 text-xs md:text-sm"
                      style={!visibleDevices.some(d => d.deviceId === action.deviceId) ? {borderColor: '#f59e0b', background: '#fffbeb'} : {}}
                    >
                      {!visibleDevices.some(d => d.deviceId === action.deviceId) && (
                        <option value="" className="bg-slate-800">장치 선택</option>
                      )}
                      {visibleDevices.map(d => (
                        <option key={d.deviceId} value={d.deviceId} className="bg-slate-800">
                          {d.name}
                        </option>
                      ))}
                    </select>
                    );
                  })() : (
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
                    className="input-field w-20 md:w-24 text-xs md:text-sm flex-shrink-0 px-2"
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
                <div style={{display:'flex',alignItems:'center',gap:8,padding:'8px 10px',background: isTimed ? '#eff6ff' : '#f8fafc',borderTop:'1px solid #e2e8f0',flexWrap:'wrap'}}>
                  {isBidir ? (
                    // bidir 장치: 3가지 동작 모드 선택 (full / position / stepped)
                    (() => {
                      const mode = action.actionMode || 'full';
                      return (
                        <div style={{display:'flex',flexDirection:'column',gap:6,width:'100%'}}>
                          <select
                            value={mode}
                            onChange={(e) => {
                              const newMode = e.target.value;
                              const updates = { actionMode: newMode };
                              // 기본값 세팅
                              if (newMode === 'position' && action.targetPosition == null) updates.targetPosition = 50;
                              if (newMode === 'stepped') {
                                if (action.stepPercent == null) updates.stepPercent = 10;
                                if (action.stepPauseSeconds == null) updates.stepPauseSeconds = 60;
                                if (action.targetPosition == null) updates.targetPosition = 100;
                              }
                              updateAction(idx, updates);
                            }}
                            className="input-field text-xs md:text-sm"
                            style={{maxWidth:280}}
                          >
                            <option value="full">① 한계까지 ({action.command === 'open' ? '완전 열기' : '완전 닫기'})</option>
                            <option value="position">② 지정 위치까지 (한 번에)</option>
                            <option value="stepped">③ 단계적 이동 (작물 보호)</option>
                          </select>

                          {mode === 'position' && (
                            <div style={{display:'flex',alignItems:'center',gap:8,padding:'4px 0',flexWrap:'wrap'}}>
                              <span style={{fontSize:12,color:'#475569',fontWeight:600}}>목표 위치:</span>
                              <div style={{display:'flex',alignItems:'center',gap:4,background:'#fff',borderRadius:8,padding:'2px 8px',border:'1.5px solid #bfdbfe'}}>
                                <select value={Math.round((action.targetPosition ?? 50) / 10) * 10}
                                  onChange={(e) => updateAction(idx, { targetPosition: parseInt(e.target.value) })}
                                  style={{fontSize:14,fontWeight:800,textAlign:'center',border:'none',outline:'none',color:'#1e40af',background:'transparent',cursor:'pointer'}}>
                                  {[0,10,20,30,40,50,60,70,80,90,100].map(v => (
                                    <option key={v} value={v}>{v}</option>
                                  ))}
                                </select>
                                <span style={{fontSize:12,fontWeight:700,color:'#64748b'}}>%</span>
                              </div>
                              <span style={{fontSize:11,color:'#94a3b8'}}>현재 위치에서 한 번에 이동</span>
                            </div>
                          )}

                          {mode === 'stepped' && (
                            <div style={{display:'flex',flexDirection:'column',gap:6,padding:'6px 8px',background:'#fef9c3',borderRadius:8,border:'1px solid #fde047'}}>
                              <div style={{fontSize:11,color:'#854d0e',fontWeight:700,marginBottom:2}}>
                                🌱 작물 보호 모드 — 단계적으로 환기하여 온도 급변 방지
                              </div>
                              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                                <span style={{fontSize:12,color:'#475569',fontWeight:600,minWidth:64}}>매 단계:</span>
                                <select value={Math.round((action.stepPercent ?? 10) / 10) * 10 || 10}
                                  onChange={(e) => updateAction(idx, { stepPercent: parseInt(e.target.value) })}
                                  style={{fontSize:14,fontWeight:800,textAlign:'center',border:'1.5px solid #fde047',borderRadius:6,padding:'2px 4px',outline:'none',cursor:'pointer',background:'#fff'}}>
                                  {[10,20,30,40,50].map(v => (
                                    <option key={v} value={v}>{v}</option>
                                  ))}
                                </select>
                                <span style={{fontSize:12,color:'#64748b'}}>%</span>
                              </div>
                              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                                <span style={{fontSize:12,color:'#475569',fontWeight:600,minWidth:64}}>단계 사이:</span>
                                <input type="number" min={10} max={3600} value={action.stepPauseSeconds ?? 60}
                                  onChange={(e) => updateAction(idx, { stepPauseSeconds: Math.max(10, Math.min(3600, parseInt(e.target.value) || 10)) })}
                                  style={{width:64,fontSize:14,fontWeight:800,textAlign:'center',border:'1.5px solid #fde047',borderRadius:6,padding:'2px 4px',outline:'none'}}
                                />
                                <span style={{fontSize:12,color:'#64748b'}}>초 정지</span>
                              </div>
                              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                                <span style={{fontSize:12,color:'#475569',fontWeight:600,minWidth:64}}>최종 목표:</span>
                                <select value={Math.round((action.targetPosition ?? 100) / 10) * 10}
                                  onChange={(e) => updateAction(idx, { targetPosition: parseInt(e.target.value) })}
                                  style={{fontSize:14,fontWeight:800,textAlign:'center',border:'1.5px solid #fde047',borderRadius:6,padding:'2px 4px',outline:'none',cursor:'pointer',background:'#fff'}}>
                                  {[0,10,20,30,40,50,60,70,80,90,100].map(v => (
                                    <option key={v} value={v}>{v}</option>
                                  ))}
                                </select>
                                <span style={{fontSize:12,color:'#64748b'}}>%</span>
                              </div>
                              {(() => {
                                const step = action.stepPercent || 10;
                                const target = action.targetPosition ?? 100;
                                const pause = action.stepPauseSeconds || 60;
                                const numSteps = Math.ceil(target / step);
                                const totalSec = numSteps * pause;
                                return (
                                  <div style={{fontSize:11,color:'#a16207',fontStyle:'italic'}}>
                                    예상: {numSteps}단계 × {pause}초 = 약 {Math.floor(totalSec/60)}분 {totalSec%60}초 소요
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      );
                    })()
                  ) : (
                    /* 계속 / 동작시간 세그먼트 (single 장치만) */
                    <div style={{display:'inline-flex',borderRadius:10,background:'#e2e8f0',padding:2,flexShrink:0}}>
                      <button type="button"
                        onClick={() => updateAction(idx, { duration: 0, durationUnit: 'seconds' })}
                        style={{
                          width:56,padding:'6px 0',fontSize:12,fontWeight:800,border:'none',cursor:'pointer',borderRadius:8,
                          background: !isTimed ? '#fff' : 'transparent',
                          color: !isTimed ? '#1e40af' : '#94a3b8',
                          boxShadow: !isTimed ? '0 1px 4px rgba(0,0,0,0.12)' : 'none',
                          transition:'all 0.2s',
                        }}
                      >계속</button>
                      <button type="button"
                        onClick={() => { if (!isTimed) updateAction(idx, { duration: 60, durationUnit: 'seconds' }); }}
                        style={{
                          width:64,padding:'6px 0',fontSize:12,fontWeight:800,border:'none',cursor:'pointer',borderRadius:8,
                          background: isTimed ? '#fff' : 'transparent',
                          color: isTimed ? '#1e40af' : '#94a3b8',
                          boxShadow: isTimed ? '0 1px 4px rgba(0,0,0,0.12)' : 'none',
                          transition:'all 0.2s',
                        }}
                      >동작시간</button>
                    </div>
                  )}
                  {isTimed && (() => {
                    // duration을 항상 초 단위로 변환하여 표시
                    let totalSec = action.duration || 60;
                    if (action.durationUnit === 'minutes') totalSec = totalSec * 60;
                    else if (action.durationUnit === 'hours') totalSec = totalSec * 3600;
                    const mins = Math.floor(totalSec / 60);
                    const secs = totalSec % 60;
                    const setDuration = (m, s) => {
                      const total = Math.max(1, (m || 0) * 60 + (s || 0));
                      updateAction(idx, { duration: total, durationUnit: 'seconds' });
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
          {form.actions.length > 0 && form.actions[0]?.deviceType && (
            <div className="text-xs text-gray-500 px-1 pt-1">
              ℹ️ 같은 종류 ({form.actions[0].deviceName?.replace(/\d+$/, '') || form.actions[0].deviceType})의 다른 장치만 추가 가능합니다.
              다른 종류는 별도 규칙으로 만드세요.
            </div>
          )}
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
