import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

const STATUS = {
  active: { label: '운전중', cls: 'bg-emerald-100 text-emerald-700' },
  expired: { label: '계약만료', cls: 'bg-gray-100 text-gray-500' },
  maintenance: { label: '점검중', cls: 'bg-amber-100 text-amber-700' },
};

const connStatus = (lastSeenAt) => {
  if (!lastSeenAt) return { label: '미접속', type: 'none', dot: 'bg-gray-300' };
  const diff = Date.now() - new Date(lastSeenAt).getTime();
  if (diff < 5 * 60 * 1000) return { label: '온라인', type: 'online', dot: 'bg-emerald-500' };
  if (diff < 60 * 60 * 1000) return { label: `${Math.floor(diff / 60000)}분 전`, type: 'warn', dot: 'bg-amber-500' };
  return { label: '오프라인', type: 'offline', dot: 'bg-gray-300' };
};

export default function FarmOverviewWidget({ onNavigate }) {
  const [farms, setFarms] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await axios.get(`${API}/farms`);
        setFarms(r.data.data || []);
      } catch { /* ignore */ }
      finally { setLoading(false); }
    };
    load();
    const timer = setInterval(load, 60000); // 1분마다 갱신
    return () => clearInterval(timer);
  }, []);

  if (loading) {
    return (
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
        <div style={{ background: '#475569', padding: '12px 18px' }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>농장 현황</h2>
        </div>
        <div className="flex justify-center py-8">
          <div className="w-8 h-8 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (farms.length === 0) return null;

  const onlineCount = farms.filter(f => connStatus(f.lastSeenAt).type === 'online').length;
  const warnCount = farms.filter(f => connStatus(f.lastSeenAt).type === 'warn').length;
  const offlineCount = farms.length - onlineCount - warnCount;
  const expiringCount = farms.filter(f => f.maintenanceDaysLeft != null && f.maintenanceDaysLeft > 0 && f.maintenanceDaysLeft <= 90).length;
  const expiredCount = farms.filter(f => f.maintenanceDaysLeft != null && f.maintenanceDaysLeft <= 0).length;

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      {/* Header */}
      <div style={{ background: '#475569', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>농장 현황</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 8 }}>
            {farms.length}개 농장
          </span>
          {onNavigate && (
            <button
              onClick={() => onNavigate('farms')}
              style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', fontSize: 11, padding: '3px 10px', borderRadius: 8, border: 'none', cursor: 'pointer' }}
            >
              관리 →
            </button>
          )}
        </div>
      </div>

      <div style={{ padding: 16 }}>
        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
          {[
            { label: '전체', value: farms.length, unit: '개', color: '#6366F1', bg: '#EEF2FF' },
            { label: '온라인', value: onlineCount, unit: '개', color: '#10B981', bg: '#ECFDF5' },
            { label: '오프라인', value: offlineCount, unit: '개', color: '#94A3B8', bg: '#F8FAFC' },
            { label: '만료임박', value: expiringCount, unit: '개', color: '#F59E0B', bg: '#FFFBEB' },
            { label: '만료', value: expiredCount, unit: '개', color: '#EF4444', bg: '#FEF2F2' },
          ].map(s => (
            <div key={s.label} style={{ background: s.bg, borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: 11, color: '#64748B', marginBottom: 2 }}>{s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: s.color }}>
                {s.value}<span style={{ fontSize: 11, color: '#94A3B8', marginLeft: 2 }}>{s.unit}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Farm List (max 5) */}
        <div style={{ borderRadius: 10, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#F8FAFC' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#64748B', borderBottom: '1px solid #e2e8f0' }}>농장</th>
                <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: '#64748B', borderBottom: '1px solid #e2e8f0', width: 70 }}>상태</th>
                <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: '#64748B', borderBottom: '1px solid #e2e8f0', width: 80 }}>접속</th>
                <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: '#64748B', borderBottom: '1px solid #e2e8f0', width: 50 }}>동수</th>
                <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: '#64748B', borderBottom: '1px solid #e2e8f0', width: 70 }}>유지보수</th>
              </tr>
            </thead>
            <tbody>
              {farms.slice(0, 8).map((farm, idx) => {
                const cs = connStatus(farm.lastSeenAt);
                const mb = farm.maintenanceDaysLeft;
                return (
                  <tr key={farm.farmId} style={{ borderBottom: idx < Math.min(farms.length, 8) - 1 ? '1px solid #f1f5f9' : 'none' }}
                    className="hover:bg-gray-50 transition-colors">
                    <td style={{ padding: '8px 12px' }}>
                      <div style={{ fontWeight: 600, color: '#1E293B' }}>{farm.name}</div>
                      <div style={{ fontSize: 11, color: '#94A3B8' }}>{farm.farmId}</div>
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium ${STATUS[farm.status]?.cls || ''}`}>
                        {STATUS[farm.status]?.label || farm.status}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                      <span className="inline-flex items-center gap-1">
                        <span className={`w-2 h-2 rounded-full ${cs.dot}`} />
                        <span style={{ fontSize: 11, fontWeight: 500, color: cs.type === 'online' ? '#10B981' : cs.type === 'warn' ? '#F59E0B' : '#94A3B8' }}>
                          {cs.label}
                        </span>
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: 12, color: '#64748B' }}>
                      {farm.houseCount || 0}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                      {mb != null ? (
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 6,
                          background: mb <= 0 ? '#FEE2E2' : mb <= 30 ? '#FEF3C7' : mb <= 90 ? '#FFFBEB' : '#ECFDF5',
                          color: mb <= 0 ? '#DC2626' : mb <= 30 ? '#D97706' : mb <= 90 ? '#CA8A04' : '#059669',
                        }}>
                          {mb <= 0 ? '만료' : `${mb}일`}
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: '#CBD5E1' }}>-</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {farms.length > 8 && (
            <div style={{ padding: '8px 12px', textAlign: 'center', background: '#F8FAFC', borderTop: '1px solid #e2e8f0' }}>
              <button
                onClick={() => onNavigate?.('farms')}
                style={{ fontSize: 12, color: '#6366F1', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer' }}
              >
                전체 {farms.length}개 농장 보기 →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
