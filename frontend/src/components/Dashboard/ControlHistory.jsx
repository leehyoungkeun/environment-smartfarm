import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { getControlLogs, getControlStats } from '../../services/controlApi';

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

const DEVICE_TYPE_INFO = {
  window:      { label: '1창', icon: '🪟' },
  side_window: { label: '측창', icon: '🪟' },
  top_window:  { label: '천창', icon: '🪟' },
  shade:       { label: '차광', icon: '🌑' },
  screen:      { label: '스크린', icon: '🎞️' },
  pump:        { label: '펌프', icon: '🔧' },
  motor:       { label: '모터', icon: '⚙️' },
  light:       { label: '조명', icon: '💡' },
  fan:         { label: '순환팬', icon: '🌀' },
  nutrient:    { label: '양액공급', icon: '💧' },
  solution:    { label: '배양액', icon: '🧪' },
  light_ctrl:  { label: '조명제어', icon: '🔆' },
  sprayer:     { label: '무인방제기', icon: '🚿' },
  heater:      { label: '온풍기', icon: '🔥' },
  cooler:      { label: '냉방기', icon: '❄️' },
  co2_supply:  { label: 'CO2공급기', icon: '💨' },
  mist:        { label: '분무제어', icon: '🌫️' },
  valve:       { label: '관수밸브', icon: '🚰' },
  etc_device:  { label: '기타', icon: '🔧' },
  unknown:     { label: '기타', icon: '🔧' },
};

const COMMAND_INFO = {
  open:  { label: '열기',  color: 'text-emerald-700', bg: 'bg-emerald-100' },
  close: { label: '닫기',  color: 'text-blue-700',    bg: 'bg-blue-100' },
  stop:  { label: '정지',  color: 'text-amber-700',   bg: 'bg-amber-100' },
  on:    { label: 'ON',    color: 'text-emerald-700', bg: 'bg-emerald-100' },
  off:   { label: 'OFF',   color: 'text-gray-600',    bg: 'bg-gray-100' },
};

// JSON 객체 command를 사람이 읽을 수 있는 문자열로 변환
const parseCommand = (cmd) => {
  // 단순 문자열이면 COMMAND_INFO 사용
  if (typeof cmd === 'string' && COMMAND_INFO[cmd]) {
    return COMMAND_INFO[cmd];
  }

  // JSON 문자열이면 파싱 시도
  let obj = cmd;
  if (typeof cmd === 'string') {
    try { obj = JSON.parse(cmd); } catch { return { label: cmd, color: 'text-gray-600', bg: 'bg-gray-100' }; }
  }

  if (typeof obj !== 'object' || obj === null) {
    return { label: String(cmd), color: 'text-gray-600', bg: 'bg-gray-100' };
  }

  // 양액기 상태 객체 파싱
  const parts = [];
  if (obj.operating_state) {
    const stateMap = { STOPPED: '정지', RUNNING: '작동중', PAUSED: '일시정지', IDLE: '대기' };
    parts.push(stateMap[obj.operating_state] || obj.operating_state);
  }
  if (obj.active_program != null) {
    parts.push(obj.active_program ? `프로그램 ${obj.active_program}` : '프로그램 없음');
  }
  if (obj.valve_states && Array.isArray(obj.valve_states)) {
    const openCount = obj.valve_states.filter(v => v === true).length;
    parts.push(openCount > 0 ? `밸브 ${openCount}개 열림` : '밸브 전체 닫힘');
  }
  if (obj.pump_state && typeof obj.pump_state === 'object') {
    const pumps = [];
    if (obj.pump_state.raw_pump) pumps.push('원수펌프');
    if (obj.pump_state.nutrient_pump) pumps.push('양액펌프');
    if (pumps.length > 0) parts.push(`${pumps.join('+')} ON`);
  }
  if (obj.mixer_state === true) parts.push('교반기 ON');

  // 일반 on/off/open/close 필드가 있는 경우
  if (obj.command && COMMAND_INFO[obj.command]) return COMMAND_INFO[obj.command];
  if (obj.action && COMMAND_INFO[obj.action]) return COMMAND_INFO[obj.action];

  if (parts.length === 0) {
    // 키-값 요약 (최대 3개)
    const entries = Object.entries(obj).slice(0, 3);
    const summary = entries.map(([k, v]) => {
      if (typeof v === 'boolean') return `${k}: ${v ? 'ON' : 'OFF'}`;
      return `${k}: ${v}`;
    }).join(', ');
    return { label: summary || JSON.stringify(obj).substring(0, 40), color: 'text-gray-600', bg: 'bg-gray-100' };
  }

  const label = parts.join(' · ');
  const isRunning = obj.operating_state === 'RUNNING';
  return {
    label,
    color: isRunning ? 'text-emerald-700' : 'text-amber-700',
    bg: isRunning ? 'bg-emerald-100' : 'bg-amber-100',
  };
};

const formatDuration = (ms) => {
  if (!ms || ms <= 0) return null;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  if (m > 0) return `${m}분 ${s}초`;
  return `${s}초`;
};

// 로그 목록에서 같은 장치의 이전 상태로부터 경과 시간 계산
// close/off → 이전 open/on 까지의 시간 (열려있던 시간)
// open/on → 이전 close/off 까지의 시간 (닫혀있던 시간)
const computeDurations = (logs) => {
  const durations = {};
  const pairMap = { close: 'open', off: 'on', open: 'close', on: 'off' };
  for (let i = 0; i < logs.length; i++) {
    const log = logs[i];
    const target = pairMap[log.command];
    if (!target) continue;
    for (let j = i + 1; j < logs.length; j++) {
      const prev = logs[j];
      if (prev.deviceId === log.deviceId && prev.houseId === log.houseId && prev.command === target && prev.success) {
        const dur = new Date(log.createdAt) - new Date(prev.createdAt);
        if (dur > 0) durations[log._id] = dur;
        break;
      }
    }
  }
  return durations;
};

const ControlHistory = ({ farmId }) => {
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 });
  const [houseMap, setHouseMap] = useState({}); // houseId → houseName

  // 하우스명 매핑 로드
  useEffect(() => {
    if (!farmId) return;
    axios.get(`${API}/farms/${farmId}`).then(r => {
      const houses = r.data?.data?.houses || [];
      const map = {};
      houses.forEach(h => { map[h.houseId] = h.houseName || h.houseId; });
      setHouseMap(map);
    }).catch(() => {});
  }, [farmId]);

  const [filters, setFilters] = useState({
    houseId: '',
    deviceType: '',
    period: 'today',
    page: 1,
    limit: 30,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [logsRes, statsRes] = await Promise.all([
        getControlLogs(farmId, {
          houseId: filters.houseId || undefined,
          deviceType: filters.deviceType || undefined,
          limit: filters.limit,
          page: filters.page,
        }),
        getControlStats(farmId, {
          houseId: filters.houseId || undefined,
          period: filters.period,
        }),
      ]);

      if (logsRes.success) {
        setLogs(logsRes.data);
        setPagination(logsRes.pagination);
      }
      if (statsRes.success) {
        setStats(statsRes.data);
      }
    } catch (error) {
      console.error('이력 로드 실패:', error);
    } finally {
      setLoading(false);
    }
  }, [farmId, filters]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const updateFilter = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value, page: key === 'page' ? value : 1 }));
  };

  const formatTime = (isoString) => {
    const date = new Date(isoString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    if (isToday) {
      return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }
    return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) + ' ' +
           date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  };

  const summary = stats?.summary || {};
  const durations = useMemo(() => computeDurations(logs), [logs]);

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl md:text-2xl font-bold text-gray-800 tracking-tight">제어 이력</h1>
          <p className="text-gray-500 text-sm md:text-base mt-0.5">장치 제어 기록 및 통계</p>
        </div>
        <button
          onClick={loadData}
          className="p-2.5 rounded-xl bg-gray-100 text-gray-500 hover:text-gray-800 
                   hover:bg-gray-200 transition-all active:scale-95 border border-gray-200"
        >
          🔄
        </button>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <StatCard label="전체 제어" value={summary.totalCommands || 0} icon="🎛️" color="text-gray-800" />
        <StatCard label="성공" value={summary.successCount || 0} icon="✅" color="text-emerald-600" />
        <StatCard label="실패" value={summary.failCount || 0} icon="❌" color="text-rose-600" />
        <StatCard label="수동" value={summary.manualCount || 0} icon="👆" color="text-blue-600" />
        <StatCard label="자동" value={summary.autoCount || 0} icon="🤖" color="text-violet-600" />
      </div>

      {/* 필터 */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-3 md:p-4 mb-5">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
            {[
              { value: 'today', label: '오늘' },
              { value: 'week', label: '7일' },
              { value: 'month', label: '30일' },
            ].map(p => (
              <button
                key={p.value}
                onClick={() => updateFilter('period', p.value)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  filters.period === p.value
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <select
            value={filters.deviceType}
            onChange={(e) => updateFilter('deviceType', e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700
                     focus:outline-none focus:border-blue-500"
          >
            <option value="">전체 장치</option>
            {Object.entries(DEVICE_TYPE_INFO).filter(([k]) => k !== 'unknown').map(([value, info]) => (
              <option key={value} value={value}>{info.icon} {info.label}</option>
            ))}
          </select>

          <span className="text-xs text-gray-400 ml-auto">
            총 {pagination.total.toLocaleString()}건
          </span>
        </div>
      </div>

      {/* 이력 테이블 */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3 opacity-20">📋</div>
            <p className="text-gray-500 text-base">제어 이력이 없습니다</p>
            <p className="text-gray-400 text-sm mt-1">제어 탭에서 장치를 조작하면 이력이 기록됩니다</p>
          </div>
        ) : (
          <>
            {/* 데스크톱 테이블 */}
            <div className="hidden md:block">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">시간</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">하우스</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">장치</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">명령</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">소요시간</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">결과</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">조작자</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, idx) => {
                    const deviceInfo = DEVICE_TYPE_INFO[log.deviceType] || DEVICE_TYPE_INFO.unknown;
                    const cmdInfo = parseCommand(log.command);

                    return (
                      <tr
                        key={log._id || idx}
                        className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                      >
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                          {formatTime(log.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {houseMap[log.houseId] || log.houseId}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className="text-base">{deviceInfo.icon}</span>
                            <span className="text-sm text-gray-800 font-medium">{log.deviceName || log.deviceId}</span>
                            <span className="text-xs text-gray-400">({deviceInfo.label})</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 max-w-xs">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold ${cmdInfo.bg} ${cmdInfo.color}`}>
                            {cmdInfo.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {durations[log._id] ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-200">
                              ⏱️ {formatDuration(durations[log._id])}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {log.success ? (
                            <span className="text-emerald-600 text-sm font-medium">✓ 성공</span>
                          ) : (
                            <span className="text-rose-600 text-sm font-medium" title={log.error}>✗ 실패</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-gray-500">
                            {log.isAutomatic
                              ? `🤖 자동${log.automationReason ? ` (${log.automationReason})` : ''}`
                              : `👆 ${log.operatorName || '수동'}`}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 모바일 카드 리스트 */}
            <div className="md:hidden divide-y divide-gray-100">
              {logs.map((log, idx) => {
                const deviceInfo = DEVICE_TYPE_INFO[log.deviceType] || DEVICE_TYPE_INFO.unknown;
                const cmdInfo = COMMAND_INFO[log.command] || { label: log.command, color: 'text-gray-600', bg: 'bg-gray-100' };

                return (
                  <div key={log._id || idx} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{deviceInfo.icon}</span>
                        <span className="text-base font-semibold text-gray-800">{log.deviceName || log.deviceId}</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${cmdInfo.bg} ${cmdInfo.color}`}>
                          {cmdInfo.label}
                        </span>
                        {durations[log._id] && (
                          <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-violet-50 text-violet-700 border border-violet-200">
                            ⏱️{formatDuration(durations[log._id])}
                          </span>
                        )}
                      </div>
                      {log.success ? (
                        <span className="text-emerald-600 text-xs">✓ 성공</span>
                      ) : (
                        <span className="text-rose-600 text-xs">✗ 실패</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>{houseMap[log.houseId] || log.houseId}</span>
                      <span>{log.isAutomatic
                        ? `🤖 자동`
                        : `👆 ${log.operatorName || '수동'}`}</span>
                      <span className="ml-auto">{formatTime(log.createdAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 페이지네이션 */}
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 py-4 border-t border-gray-200">
                <button
                  onClick={() => updateFilter('page', Math.max(1, filters.page - 1))}
                  disabled={filters.page <= 1}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-600
                           hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-gray-200"
                >
                  ← 이전
                </button>
                <span className="text-sm text-gray-500">
                  {pagination.page} / {pagination.totalPages}
                </span>
                <button
                  onClick={() => updateFilter('page', Math.min(pagination.totalPages, filters.page + 1))}
                  disabled={filters.page >= pagination.totalPages}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-600
                           hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-gray-200"
                >
                  다음 →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

const StatCard = ({ label, value, icon, color }) => (
  <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-3 md:p-4">
    <div className="flex items-center gap-2 mb-1.5">
      <span className="text-lg">{icon}</span>
      <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">{label}</span>
    </div>
    <p className={`text-2xl md:text-3xl font-bold ${color}`}>{typeof value === 'number' ? value.toLocaleString() : value}</p>
  </div>
);

export default ControlHistory;
