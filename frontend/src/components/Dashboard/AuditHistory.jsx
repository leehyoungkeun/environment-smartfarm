import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

const ACTION_INFO = {
  create:  { label: '생성', icon: '➕', color: 'text-emerald-700', bg: 'bg-emerald-100' },
  update:  { label: '수정', icon: '✏️', color: 'text-blue-700',    bg: 'bg-blue-100' },
  delete:  { label: '삭제', icon: '🗑️', color: 'text-rose-700',    bg: 'bg-rose-100' },
  restore: { label: '복원', icon: '♻️', color: 'text-violet-700',  bg: 'bg-violet-100' },
};

const TARGET_INFO = {
  farm:       { label: '농장', icon: '🏭' },
  house:      { label: '하우스', icon: '🏠' },
  device:     { label: '장치', icon: '🔧' },
  sensor:     { label: '센서', icon: '📡' },
  user:       { label: '사용자', icon: '👤' },
  automation: { label: '자동화', icon: '🤖' },
  config:     { label: '설정', icon: '⚙️' },
  alert:      { label: '알림', icon: '🔔' },
};

const AuditHistory = ({ farmId }) => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({ total: 0, page: 1, totalPages: 1 });

  const [filters, setFilters] = useState({
    action: '',
    targetType: '',
    page: 1,
    limit: 30,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.action) params.set('action', filters.action);
      if (filters.targetType) params.set('targetType', filters.targetType);
      params.set('limit', filters.limit);
      params.set('page', filters.page);

      const res = await axios.get(`${API}/audit-logs/${farmId}?${params.toString()}`);
      if (res.data.success) {
        setLogs(res.data.data);
        setPagination(res.data.pagination);
      }
    } catch (error) {
      console.error('감사 로그 로드 실패:', error);
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

  const formatDetails = (details) => {
    if (!details || typeof details !== 'object') return '-';
    const entries = Object.entries(details).slice(0, 3);
    return entries.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v).substring(0, 30) : v}`).join(', ');
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl md:text-2xl font-bold text-gray-800 tracking-tight">감사 로그</h1>
          <p className="text-gray-500 text-sm md:text-base mt-0.5">시스템 변경 이력 추적</p>
        </div>
        <button onClick={loadData}
          className="p-2.5 rounded-xl bg-gray-100 text-gray-500 hover:text-gray-800 hover:bg-gray-200 transition-all active:scale-95 border border-gray-200">
          🔄
        </button>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard label="전체" value={pagination.total} icon="📋" color="text-gray-800" />
        <StatCard label="생성" value={logs.filter(l => l.action === 'create').length} icon="➕" color="text-emerald-600" />
        <StatCard label="수정" value={logs.filter(l => l.action === 'update').length} icon="✏️" color="text-blue-600" />
        <StatCard label="삭제" value={logs.filter(l => l.action === 'delete').length} icon="🗑️" color="text-rose-600" />
      </div>

      {/* 필터 */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-3 md:p-4 mb-5">
        <div className="flex flex-wrap gap-2 items-center">
          <select value={filters.action} onChange={(e) => updateFilter('action', e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-blue-500">
            <option value="">전체 작업</option>
            {Object.entries(ACTION_INFO).map(([value, info]) => (
              <option key={value} value={value}>{info.icon} {info.label}</option>
            ))}
          </select>

          <select value={filters.targetType} onChange={(e) => updateFilter('targetType', e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-blue-500">
            <option value="">전체 대상</option>
            {Object.entries(TARGET_INFO).map(([value, info]) => (
              <option key={value} value={value}>{info.icon} {info.label}</option>
            ))}
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
        ) : logs.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3 opacity-20">📋</div>
            <p className="text-gray-500 text-base">감사 로그가 없습니다</p>
          </div>
        ) : (
          <>
            {/* 데스크톱 테이블 */}
            <div className="hidden md:block">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">시간</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">사용자</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">작업</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">대상</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">대상 ID</th>
                    <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">상세</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log, idx) => {
                    const actionInfo = ACTION_INFO[log.action] || { label: log.action, icon: '📝', color: 'text-gray-600', bg: 'bg-gray-100' };
                    const targetInfo = TARGET_INFO[log.targetType] || { label: log.targetType, icon: '📄' };
                    return (
                      <tr key={log.id || idx} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">{formatTime(log.createdAt)}</td>
                        <td className="px-4 py-3 text-sm text-gray-800 font-medium">{log.userName || log.userId || '-'}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold ${actionInfo.bg} ${actionInfo.color}`}>
                            {actionInfo.icon} {actionInfo.label}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{targetInfo.icon} {targetInfo.label}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 font-mono">{log.targetId || '-'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 max-w-xs truncate" title={JSON.stringify(log.details)}>
                          {formatDetails(log.details)}
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
                const actionInfo = ACTION_INFO[log.action] || { label: log.action, icon: '📝', color: 'text-gray-600', bg: 'bg-gray-100' };
                const targetInfo = TARGET_INFO[log.targetType] || { label: log.targetType, icon: '📄' };
                return (
                  <div key={log.id || idx} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-bold ${actionInfo.bg} ${actionInfo.color}`}>
                          {actionInfo.icon} {actionInfo.label}
                        </span>
                        <span className="text-sm text-gray-600">{targetInfo.icon} {targetInfo.label}</span>
                      </div>
                      <span className="text-xs text-gray-500">{formatTime(log.createdAt)}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                      <span>👤 {log.userName || '-'}</span>
                      {log.targetId && <span className="font-mono">{log.targetId}</span>}
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

export default AuditHistory;
