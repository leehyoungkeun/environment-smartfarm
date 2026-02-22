import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { getApiBase } from '../../services/apiSwitcher';

const TodaySummaryWidget = ({ farmId, houseId, alerts: parentAlerts, dataVersion }) => {
  const [dataCount, setDataCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDataCount();
  }, [farmId, houseId, dataVersion]);

  const loadDataCount = async () => {
    try {
      if (dataVersion === 0) setLoading(true);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const API_BASE_URL = getApiBase();
      const countResponse = await axios.get(
        `${API_BASE_URL}/sensors/${farmId}/${houseId}/count`,
        { params: { startDate: today.toISOString(), endDate: tomorrow.toISOString() }, timeout: 5000 }
      );

      if (countResponse.data.success) {
        // PC 서버: { count: N }, RPi: { data: { count: N } } 양쪽 호환
        const count = countResponse.data.count ?? countResponse.data.data?.count ?? 0;
        setDataCount(count);
      }
    } catch (error) {
      console.error('Failed to load data count:', error);
    } finally {
      setLoading(false);
    }
  };

  // 부모에서 받은 alerts에서 오늘 것만 필터
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const todayAlerts = (parentAlerts || []).filter(alert => {
    const alertDate = new Date(alert.createdAt);
    return alertDate >= today && alertDate < tomorrow;
  });

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
      value: dataCount,
      unit: '회',
      icon: '📊',
      color: '#2563eb',
      bg: '#eff6ff',
      border: '#bfdbfe',
    },
    {
      label: '전체 알림',
      value: todayAlerts.length,
      unit: '건',
      icon: '🔔',
      color: '#7c3aed',
      bg: '#f5f3ff',
      border: '#ddd6fe',
    },
    {
      label: '심각',
      value: criticalAlerts.length,
      unit: '건',
      icon: '🚨',
      color: criticalAlerts.length > 0 ? '#dc2626' : '#9ca3af',
      bg: criticalAlerts.length > 0 ? '#fef2f2' : '#f9fafb',
      border: criticalAlerts.length > 0 ? '#fecaca' : '#e5e7eb',
    },
    {
      label: '경고',
      value: warningAlerts.length,
      unit: '건',
      icon: '⚠️',
      color: warningAlerts.length > 0 ? '#d97706' : '#9ca3af',
      bg: warningAlerts.length > 0 ? '#fffbeb' : '#f9fafb',
      border: warningAlerts.length > 0 ? '#fde68a' : '#e5e7eb',
    },
  ];

  return (
    <div style={{background:'#fff',border:'1px solid #e2e8f0',borderRadius:16,overflow:'hidden',boxShadow:'0 1px 3px rgba(0,0,0,0.06)'}}>
      {/* 컬러 헤더 */}
      <div style={{background:'#0ea5e9',padding:'12px 18px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <h2 style={{fontSize:16,fontWeight:800,color:'#fff'}}>📋 오늘의 요약</h2>
        <span style={{background:'rgba(255,255,255,0.2)',color:'#fff',fontSize:12,fontWeight:600,padding:'3px 10px',borderRadius:8}}>
          {new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
        </span>
      </div>

      <div style={{padding:'16px'}}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {stats.map((stat) => (
            <div key={stat.label}
              style={{background:stat.bg,borderRadius:14,padding:'14px 16px',border:`2px solid ${stat.border}`,transition:'all 0.2s'}}>
              <div className="flex items-center gap-2 mb-2">
                <span style={{fontSize:18}}>{stat.icon}</span>
                <span style={{fontSize:12,fontWeight:700,color:'#64748b'}}>{stat.label}</span>
              </div>
              <div className="flex items-baseline gap-1.5">
                <span style={{fontSize:28,fontWeight:900,fontFamily:'monospace',color:stat.color,lineHeight:1}}>
                  {stat.value.toLocaleString()}
                </span>
                <span style={{fontSize:12,color:'#94a3b8',fontWeight:600}}>{stat.unit}</span>
              </div>
            </div>
          ))}
        </div>

        {/* 상태 메시지 */}
        <div style={{marginTop:12,textAlign:'center',padding:'8px 0',borderRadius:10,
          background: todayAlerts.length === 0 ? '#ecfdf5' : criticalAlerts.length > 0 ? '#fef2f2' : '#fffbeb',
          border: todayAlerts.length === 0 ? '1.5px solid #a7f3d0' : criticalAlerts.length > 0 ? '1.5px solid #fecaca' : '1.5px solid #fde68a',
        }}>
          {todayAlerts.length === 0 ? (
            <p style={{color:'#059669',fontSize:13,fontWeight:700}}>✔ 오늘은 이상 없이 정상 운영 중</p>
          ) : criticalAlerts.length > 0 ? (
            <p style={{color:'#dc2626',fontSize:13,fontWeight:700}}>🚨 심각한 알림 {criticalAlerts.length}건 발생</p>
          ) : (
            <p style={{color:'#d97706',fontSize:13,fontWeight:700}}>⚠️ 경고 알림 {warningAlerts.length}건 발생</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default TodaySummaryWidget;
