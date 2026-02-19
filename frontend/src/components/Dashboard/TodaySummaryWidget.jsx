import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

const TodaySummaryWidget = ({ farmId, houseId }) => {
  const [todayAlerts, setTodayAlerts] = useState([]);
  const [todayData, setTodayData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTodayData();
  }, [farmId, houseId]);

  const loadTodayData = async () => {
    try {
      setLoading(true);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const alertsResponse = await axios.get(
        `${API_BASE_URL}/alerts/${farmId}?houseId=${houseId}&limit=100`
      );
      if (alertsResponse.data.success) {
        const todayOnly = alertsResponse.data.data.filter(alert => {
          const alertDate = new Date(alert.createdAt);
          return alertDate >= today && alertDate < tomorrow;
        });
        setTodayAlerts(todayOnly);
      }

      const dataResponse = await axios.get(
        `${API_BASE_URL}/sensors/${farmId}/${houseId}/history`,
        { params: { startDate: today.toISOString(), endDate: tomorrow.toISOString() } }
      );
      if (dataResponse.data.success) {
        setTodayData(dataResponse.data.data);
      }
    } catch (error) {
      console.error('Failed to load today summary:', error);
    } finally {
      setLoading(false);
    }
  };

  const criticalAlerts = todayAlerts.filter(a => a.severity === 'CRITICAL' && a.alertType !== 'NORMAL');
  const warningAlerts = todayAlerts.filter(a => a.severity === 'WARNING' && a.alertType !== 'NORMAL');

  if (loading) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-32 h-5 bg-gray-200 rounded animate-pulse" />
          <div className="w-24 h-4 bg-gray-200 rounded animate-pulse ml-auto" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const stats = [
    {
      label: '데이터 수집',
      value: todayData.length,
      unit: '회',
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-200',
      textColor: 'text-blue-600',
    },
    {
      label: '전체 알림',
      value: todayAlerts.length,
      unit: '건',
      bgColor: 'bg-violet-50',
      borderColor: 'border-violet-200',
      textColor: 'text-violet-600',
    },
    {
      label: '심각',
      value: criticalAlerts.length,
      unit: '건',
      bgColor: criticalAlerts.length > 0 ? 'bg-rose-50' : 'bg-gray-50',
      borderColor: criticalAlerts.length > 0 ? 'border-rose-200' : 'border-gray-200',
      textColor: criticalAlerts.length > 0 ? 'text-rose-600' : 'text-gray-400',
    },
    {
      label: '경고',
      value: warningAlerts.length,
      unit: '건',
      bgColor: warningAlerts.length > 0 ? 'bg-amber-50' : 'bg-gray-50',
      borderColor: warningAlerts.length > 0 ? 'border-amber-200' : 'border-gray-200',
      textColor: warningAlerts.length > 0 ? 'text-amber-600' : 'text-gray-400',
    },
  ];

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 md:p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base md:text-lg font-bold text-gray-800">오늘의 요약</h2>
        <span className="text-xs text-gray-500">
          {new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-3">
        {stats.map((stat, idx) => (
          <div
            key={stat.label}
            className={`${stat.bgColor} rounded-xl p-3 md:p-4 border ${stat.borderColor}
                       transition-all duration-200`}
          >
            <p className="text-[11px] md:text-xs text-gray-500 font-medium mb-1">{stat.label}</p>
            <div className="flex items-baseline gap-1">
              <span className={`text-xl md:text-2xl font-bold font-mono ${stat.textColor}`}>
                {stat.value}
              </span>
              <span className="text-[10px] text-gray-400">{stat.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* 상태 메시지 */}
      <div className="mt-3 text-center">
        {todayAlerts.length === 0 ? (
          <p className="text-emerald-600 text-xs font-medium">✔ 오늘은 이상 없이 정상 운영 중</p>
        ) : criticalAlerts.length > 0 ? (
          <p className="text-rose-600 text-xs font-medium">⚠ 심각한 알림 {criticalAlerts.length}건 발생</p>
        ) : (
          <p className="text-amber-600 text-xs font-medium">⚠ 경고 알림 {warningAlerts.length}건 발생</p>
        )}
      </div>
    </div>
  );
};

export default TodaySummaryWidget;
