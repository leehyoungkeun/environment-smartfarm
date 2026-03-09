import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

const SEVERITY_INFO = {
  CRITICAL: { label: '심각', icon: '🔴', color: 'text-rose-700', bg: 'bg-rose-100' },
  WARNING:  { label: '경고', icon: '🟡', color: 'text-amber-700', bg: 'bg-amber-100' },
  INFO:     { label: '정보', icon: '🔵', color: 'text-blue-700',  bg: 'bg-blue-100' },
};

const ALERT_TYPE_INFO = {
  HIGH:                 { label: '상한 초과', icon: '📈' },
  LOW:                  { label: '하한 미달', icon: '📉' },
  SENSOR_THRESHOLD:     { label: '센서 임계값', icon: '🌡️' },
  FARM_OFFLINE:         { label: '농장 오프라인', icon: '📡' },
  MAINTENANCE_EXPIRY:   { label: '유지보수 만료', icon: '🔧' },
  SENSOR_COMM_FAILURE:  { label: '센서 통신 두절', icon: '📡' },
  SENSOR_COMM_RECOVERY: { label: '센서 통신 복구', icon: '✅' },
  CONTROL_FAILURE:      { label: '제어 실패', icon: '⚡' },
  DEVICE_FAILURE:       { label: '장비 고장', icon: '🔴' },
  MODBUS_BUS_FAILURE:   { label: '통신 버스 장애', icon: '🔌' },
};

const AlertHistory = ({ farmId }) => {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 });
  const [houseMap, setHouseMap] = useState({});

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
    severity: '',
    acknowledged: '',
    houseId: '',
    page: 1,
    limit: 30,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.severity) params.set('severity', filters.severity);
      if (filters.acknowledged) params.set('acknowledged', filters.acknowledged);
      if (filters.houseId) params.set('houseId', filters.houseId);
      params.set('limit', filters.limit);
      params.set('page', filters.page);
      params.set('includeDeleted', 'true');

      const res = await axios.get(`${API}/alerts/${farmId}?${params.toString()}`);
      if (res.data.success) {
        setAlerts(res.data.data);
        setPagination(res.data.pagination);
      }
    } catch (error) {
      console.error('알림 이력 로드 실패:', error);
    } finally {
      setLoading(false);
    }
  }, [farmId, filters]);

  useEffect(() => { loadData(); }, [loadData]);

  const updateFilter = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value, page: key === 'page' ? value : 1 }));
  };

  const formatTime = (isoString) => {
    if (!isoString) return '-';
    const date = new Date(isoString);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const time = date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `${y}-${m}-${d} ${time}`;
  };

  // 통계 계산
  const stats = {
    total: pagination.total,
    critical: alerts.filter(a => a.severity === 'CRITICAL').length,
    warning: alerts.filter(a => a.severity === 'WARNING').length,
    acknowledged: alerts.filter(a => a.acknowledged).length,
    unacknowledged: alerts.filter(a => !a.acknowledged).length,
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl md:text-2xl font-bold text-gray-800 tracking-tight">알림 이력</h1>
          <p className="text-gray-500 text-sm md:text-base mt-0.5">센서 임계값 초과 알림 기록</p>
        </div>
        <button onClick={loadData}
          className="p-2.5 rounded-xl bg-gray-100 text-gray-500 hover:text-gray-800 hover:bg-gray-200 transition-all active:scale-95 border border-gray-200">
          🔄
        </button>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <StatCard label="전체" value={stats.total} icon="🔔" color="text-gray-800" />
        <StatCard label="심각" value={stats.critical} icon="🔴" color="text-rose-600" />
        <StatCard label="경고" value={stats.warning} icon="🟡" color="text-amber-600" />
        <StatCard label="확인됨" value={stats.acknowledged} icon="✅" color="text-emerald-600" />
        <StatCard label="미확인" value={stats.unacknowledged} icon="⏳" color="text-orange-600" />
      </div>

      {/* 필터 */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-3 md:p-4 mb-5">
        <div className="flex flex-wrap gap-2 items-center">
          <select value={filters.severity} onChange={(e) => updateFilter('severity', e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-blue-500">
            <option value="">전체 심각도</option>
            <option value="CRITICAL">🔴 심각</option>
            <option value="WARNING">🟡 경고</option>
          </select>

          <select value={filters.acknowledged} onChange={(e) => updateFilter('acknowledged', e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-blue-500">
            <option value="">전체 상태</option>
            <option value="false">미확인</option>
            <option value="true">확인됨</option>
          </select>

          <span className="text-xs text-gray-400 ml-auto">
            총 {pagination.total.toLocaleString()}건
          </span>
        </div>
      </div>

      {/* 이력 */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3 opacity-20">🔔</div>
            <p className="text-gray-500 text-base">알림 이력이 없습니다</p>
          </div>
        ) : (
          <>
            {/* 데스크톱 테이블 */}
            <div className="hidden md:block">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">시간</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">심각도</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">하우스</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">센서</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">유형</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">내용</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">확인</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">상태</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((alert, idx) => {
                    const sevInfo = SEVERITY_INFO[alert.severity] || SEVERITY_INFO.WARNING;
                    const typeInfo = ALERT_TYPE_INFO[alert.alertType] || { label: alert.alertType, icon: '⚠️' };
                    return (
                      <tr key={alert._id || idx} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{formatTime(alert.timestamp || alert.createdAt)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold ${sevInfo.bg} ${sevInfo.color}`}>
                            {sevInfo.icon} {sevInfo.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700">{houseMap[alert.houseId] || alert.houseId}</td>
                        <td className="px-4 py-3 text-sm text-gray-800 font-medium">{alert.sensorId}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">{typeInfo.icon} {typeInfo.label}</td>
                        <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate" title={alert.message}>{alert.message}</td>
                        <td className="px-4 py-3">
                          {alert.acknowledged ? (
                            <div>
                              <span className="text-emerald-600 text-xs font-medium">✓ 확인</span>
                              {alert.acknowledgedBy && (
                                <p className="text-xs text-gray-500 mt-0.5">👤 {alert.acknowledgedBy}</p>
                              )}
                              {alert.acknowledgedAt && (
                                <p className="text-xs text-gray-400 mt-0.5">{formatTime(alert.acknowledgedAt)}</p>
                              )}
                            </div>
                          ) : (
                            <span className="text-orange-500 text-xs font-medium">⏳ 미확인</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {alert.deleted ? (
                            <div>
                              <span className="text-rose-500 text-xs font-medium">삭제됨</span>
                              {alert.deletedBy && <p className="text-xs text-gray-500 mt-0.5">👤 {alert.deletedBy}</p>}
                              {alert.deletedAt && <p className="text-xs text-gray-400 mt-0.5">{formatTime(alert.deletedAt)}</p>}
                            </div>
                          ) : (
                            <span className="text-emerald-500 text-xs font-medium">활성</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 모바일 카드 리스트 */}
            <div className="md:hidden divide-y divide-gray-100">
              {alerts.map((alert, idx) => {
                const sevInfo = SEVERITY_INFO[alert.severity] || SEVERITY_INFO.WARNING;
                return (
                  <div key={alert._id || idx} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${sevInfo.bg} ${sevInfo.color}`}>
                          {sevInfo.icon} {sevInfo.label}
                        </span>
                        <span className="text-sm font-semibold text-gray-800">{alert.sensorId}</span>
                      </div>
                      {alert.acknowledged ? (
                        <span className="text-emerald-600 text-xs">✓ {alert.acknowledgedBy || ''}</span>
                      ) : (
                        <span className="text-orange-500 text-xs">⏳</span>
                      )}
                    </div>
                    {alert.deleted && (
                      <span className="text-rose-400 text-xs ml-1">삭제됨{alert.deletedBy ? ` (${alert.deletedBy})` : ''}</span>
                    )}
                    <p className="text-sm text-gray-600 mb-1 truncate">{alert.message}</p>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>{houseMap[alert.houseId] || alert.houseId}</span>
                      {alert.acknowledged && alert.acknowledgedAt && (
                        <span className="text-gray-400">확인: {formatTime(alert.acknowledgedAt)}</span>
                      )}
                      <span className="ml-auto">{formatTime(alert.timestamp || alert.createdAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 페이지네이션 */}
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 py-4 border-t border-gray-200">
                <button onClick={() => updateFilter('page', Math.max(1, filters.page - 1))} disabled={filters.page <= 1}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-gray-200">
                  ← 이전
                </button>
                <span className="text-sm text-gray-500">{pagination.page} / {pagination.totalPages}</span>
                <button onClick={() => updateFilter('page', Math.min(pagination.totalPages, filters.page + 1))} disabled={filters.page >= pagination.totalPages}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all border border-gray-200">
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

export default AlertHistory;
