import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { getApiBase, getRpiApiBase } from '../../services/apiSwitcher';

// 센서 키 → 한글 라벨 fallback 매핑
const SENSOR_LABELS = {
  temp: '온도', temperature: '온도', humidity: '습도', co2: 'CO2', CO2: 'CO2',
  soil_temp: '지온', soil_humidity: '지습', soil_moisture: '토양수분',
  light: '조도', lux: '조도', wind_speed: '풍속', wind_dir: '풍향',
  rain: '강우', ph: 'pH', ec: 'EC', nutri_ec: '양액EC', do: 'DO', nh3: 'NH3',
};
// config 센서 정보 우선, 없으면 접미사(_001 등) 제거 후 fallback
const sensorLabel = (key, configSensors) => {
  const cfgSensor = configSensors?.find(s => s.sensorId === key);
  if (cfgSensor?.name) return cfgSensor.name;
  if (SENSOR_LABELS[key]) return SENSOR_LABELS[key];
  const base = key.replace(/_\d+$/, '');
  return SENSOR_LABELS[base] || key;
};
const sensorUnit = (key, configSensors) => {
  const cfgSensor = configSensors?.find(s => s.sensorId === key);
  return cfgSensor?.unit || '';
};
const fmtVal = (v) => typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(1)) : v;

const TodaySummaryWidget = ({ farmId, houseId, alerts: parentAlerts, dataVersion, config }) => {
  const [dataCount, setDataCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // 데이터 수집 모달
  const [showModal, setShowModal] = useState(false);
  const [modalData, setModalData] = useState([]);
  const [modalLoading, setModalLoading] = useState(false);
  const [modalPage, setModalPage] = useState(1);
  const MODAL_PAGE_SIZE = 30;

  // 알림 상세 모달
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [alertModalData, setAlertModalData] = useState([]);
  const [alertModalTitle, setAlertModalTitle] = useState('');

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
        const count = countResponse.data.count ?? countResponse.data.data?.count ?? 0;
        setDataCount(count);
      }
    } catch (error) {
      console.error('Failed to load data count:', error);
    } finally {
      setLoading(false);
    }
  };

  // 모달 열기: 오늘 수집 데이터 로드
  const openDataModal = useCallback(async () => {
    setShowModal(true);
    setModalLoading(true);
    setModalPage(1);
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const pcUrl = getApiBase();
      const rpiUrl = getRpiApiBase();
      const params = { startDate: today.toISOString(), endDate: tomorrow.toISOString(), limit: 200 };

      // 카운트 API와 동일한 소스(PC 서버) 우선 호출 → RPi fallback
      const res = await axios.get(`${pcUrl}/sensors/${farmId}/${houseId}/history`, { params, timeout: 5000 })
        .catch(() => rpiUrl !== pcUrl
          ? axios.get(`${rpiUrl}/sensors/${farmId}/${houseId}/history`, { params, timeout: 5000 }).catch(() => null)
          : null
        );

      if (res?.data?.success && Array.isArray(res.data.data)) {
        const sorted = [...res.data.data].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        setModalData(sorted);
      } else {
        setModalData([]);
      }
    } catch {
      setModalData([]);
    } finally {
      setModalLoading(false);
    }
  }, [farmId, houseId]);

  // ESC 키로 모달 닫기
  useEffect(() => {
    if (!showModal && !showAlertModal) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { setShowModal(false); setShowAlertModal(false); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showModal, showAlertModal]);

  // 알림 모달 열기
  const openAlertModal = useCallback((title, alerts) => {
    setAlertModalTitle(title);
    setAlertModalData([...alerts].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)));
    setShowAlertModal(true);
  }, []);

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
  const houseName = config?.houseName || houseId;

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
      clickable: true,
    },
    {
      label: '전체 알림',
      value: todayAlerts.length,
      unit: '건',
      icon: '🔔',
      color: '#7c3aed',
      bg: '#f5f3ff',
      border: '#ddd6fe',
      clickable: true,
      onOpen: () => openAlertModal(`🔔 ${houseName} 전체 알림`, todayAlerts),
    },
    {
      label: '심각',
      value: criticalAlerts.length,
      unit: '건',
      icon: '🚨',
      color: criticalAlerts.length > 0 ? '#dc2626' : '#9ca3af',
      bg: criticalAlerts.length > 0 ? '#fef2f2' : '#f9fafb',
      border: criticalAlerts.length > 0 ? '#fecaca' : '#e5e7eb',
      clickable: true,
      onOpen: () => openAlertModal(`🚨 ${houseName} 심각 알림`, criticalAlerts),
    },
    {
      label: '경고',
      value: warningAlerts.length,
      unit: '건',
      icon: '⚠️',
      color: warningAlerts.length > 0 ? '#d97706' : '#9ca3af',
      bg: warningAlerts.length > 0 ? '#fffbeb' : '#f9fafb',
      border: warningAlerts.length > 0 ? '#fde68a' : '#e5e7eb',
      clickable: true,
      onOpen: () => openAlertModal(`⚠️ ${houseName} 경고 알림`, warningAlerts),
    },
  ];

  // 동적 센서 컬럼 추출 — 전체 데이터에서 모든 고유 키 수집
  const sensorKeys = (() => {
    if (modalData.length === 0) return [];
    const keySet = new Set();
    for (const row of modalData) {
      if (row.data && typeof row.data === 'object') {
        for (const k of Object.keys(row.data)) {
          const v = row.data[k];
          if (typeof v === 'number' || typeof v === 'string') keySet.add(k);
        }
      }
    }
    return [...keySet];
  })();

  return (
    <>
      <div style={{background:'#fff',border:'1px solid #e2e8f0',borderRadius:16,overflow:'hidden',boxShadow:'0 1px 3px rgba(0,0,0,0.06)'}}>
        {/* 컬러 헤더 */}
        <div style={{background:'#0ea5e9',padding:'12px 18px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <h2 style={{fontSize:16,fontWeight:800,color:'#fff'}}>
            📋 오늘의 요약
            <span style={{fontSize:12,fontWeight:600,opacity:0.85,marginLeft:8}}>
              ({config?.houseName || houseId})
            </span>
          </h2>
          <span style={{background:'rgba(255,255,255,0.2)',color:'#fff',fontSize:12,fontWeight:600,padding:'3px 10px',borderRadius:8}}>
            {new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' })}
          </span>
        </div>

        <div style={{padding:'16px'}}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {stats.map((stat) => (
              <div key={stat.label}
                onDoubleClick={stat.onOpen || (stat.clickable ? openDataModal : undefined)}
                title={stat.clickable ? '더블클릭하여 상세 보기' : undefined}
                style={{
                  background:stat.bg, borderRadius:14, padding:'14px 16px',
                  border:`2px solid ${stat.border}`, transition:'all 0.2s',
                  ...(stat.clickable ? { cursor:'pointer', userSelect:'none' } : {}),
                }}
                onMouseEnter={stat.clickable ? (e) => { e.currentTarget.style.transform='scale(1.03)'; e.currentTarget.style.boxShadow='0 4px 12px rgba(37,99,235,0.15)'; } : undefined}
                onMouseLeave={stat.clickable ? (e) => { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=''; } : undefined}
              >
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
                {stat.clickable && <div style={{fontSize:10,color:'#94a3b8',marginTop:4,textAlign:'right'}}>더블클릭 상세</div>}
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

      {/* 데이터 수집 상세 모달 */}
      {showModal && createPortal(
        <div
          onClick={() => setShowModal(false)}
          style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:10000,display:'flex',alignItems:'center',justifyContent:'center',padding:16,overflow:'hidden'}}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{background:'#fff',borderRadius:16,width:'96%',maxWidth:640,height:'80vh',display:'flex',flexDirection:'column',boxShadow:'0 20px 60px rgba(0,0,0,0.2)',overflow:'hidden'}}
          >
            {/* 헤더 */}
            <div style={{padding:'14px 20px',borderBottom:'2px solid #e5e7eb',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
              <div>
                <h3 style={{fontSize:16,fontWeight:800,color:'#0f172a'}}>📊 센서 수집 이력</h3>
                <span style={{fontSize:12,color:'#6b7280'}}>{config?.houseName || houseId} · 총 {dataCount}건</span>
              </div>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <button onClick={openDataModal} style={{border:'1px solid #e5e7eb',background:'#f9fafb',borderRadius:8,padding:'4px 10px',fontSize:13,cursor:'pointer',color:'#6b7280'}}>🔄</button>
                <button onClick={() => setShowModal(false)} style={{border:'none',background:'transparent',fontSize:20,cursor:'pointer',color:'#9ca3af',padding:'4px'}}>✕</button>
              </div>
            </div>

            {/* 본문 — 카드 리스트 (페이지네이션) */}
            <div style={{flex:1,overflowY:'auto',padding:'4px 0'}}>
              {modalLoading ? (
                <div style={{textAlign:'center',padding:'40px 0',color:'#9ca3af'}}>로딩 중...</div>
              ) : modalData.length === 0 ? (
                <div style={{textAlign:'center',padding:'40px 0',color:'#9ca3af',fontSize:14}}>수집된 데이터가 없습니다</div>
              ) : modalData.slice((modalPage - 1) * MODAL_PAGE_SIZE, modalPage * MODAL_PAGE_SIZE).map((row, idx) => {
                const globalIdx = (modalPage - 1) * MODAL_PAGE_SIZE + idx;
                const d = new Date(row.timestamp);
                const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
                const hasWarning = sensorKeys.some(k => {
                  const cfg = config?.sensors?.find(s => s.sensorId === k);
                  const v = row.data?.[k];
                  return cfg && typeof v === 'number' && ((cfg.min != null && v < cfg.min) || (cfg.max != null && v > cfg.max));
                });

                return (
                  <div key={globalIdx} style={{padding:'10px 16px',borderBottom:'1px solid #f3f4f6',background: hasWarning ? '#fef2f2' : ''}}>
                    {/* 1행: 날짜시간 + 번호 + 경고 */}
                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                      <span style={{fontSize:12,color:'#6b7280',fontFamily:'monospace'}}>{dateStr}</span>
                      <span style={{fontSize:11,color:'#9ca3af',fontWeight:600}}>#{globalIdx + 1}</span>
                      {hasWarning && <span style={{fontSize:10,fontWeight:700,padding:'1px 6px',borderRadius:4,background:'#dc2626',color:'#fff'}}>임계초과</span>}
                    </div>
                    {/* 2행: 센서값 뱃지들 */}
                    <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                      {sensorKeys.map(k => {
                        const cfg = config?.sensors?.find(s => s.sensorId === k);
                        const v = row.data?.[k];
                        const isOver = cfg && typeof v === 'number' && ((cfg.min != null && v < cfg.min) || (cfg.max != null && v > cfg.max));
                        const label = sensorLabel(k, config?.sensors);
                        const unit = sensorUnit(k, config?.sensors);
                        const icon = cfg?.icon || '';

                        return (
                          <span key={k} style={{
                            fontSize:12,fontWeight:600,padding:'3px 10px',borderRadius:8,
                            display:'inline-flex',alignItems:'center',gap:4,
                            background: isOver ? '#fef2f2' : '#f0f9ff',
                            color: isOver ? '#dc2626' : '#0369a1',
                            border: `1px solid ${isOver ? '#fecaca' : '#e0f2fe'}`,
                          }}>
                            {icon && <span style={{fontSize:13}}>{icon}</span>}
                            <span style={{color:'#6b7280',fontWeight:500}}>{label}</span>
                            <span style={{fontFamily:'monospace',fontWeight:700}}>{v != null ? fmtVal(v) : '-'}</span>
                            {unit && <span style={{fontSize:10,color:'#9ca3af'}}>{unit}</span>}
                            {isOver && <span style={{fontSize:9,fontWeight:800}}>!</span>}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 페이지네이션 */}
            {(() => {
              const totalPages = Math.ceil(modalData.length / MODAL_PAGE_SIZE) || 1;
              return (
                <div style={{padding:'10px 16px',borderTop:'2px solid #e5e7eb',display:'flex',alignItems:'center',justifyContent:'center',gap:12,flexShrink:0}}>
                  <button onClick={() => setModalPage(p => Math.max(1, p - 1))} disabled={modalPage <= 1}
                    style={{padding:'6px 14px',borderRadius:8,border:'1px solid #e5e7eb',background:'#f9fafb',fontSize:13,cursor: modalPage <= 1 ? 'default' : 'pointer',opacity: modalPage <= 1 ? 0.3 : 1,color:'#4b5563'}}>← 이전</button>
                  <span style={{fontSize:13,color:'#6b7280',fontWeight:600}}>{modalPage} / {totalPages}</span>
                  <button onClick={() => setModalPage(p => Math.min(totalPages, p + 1))} disabled={modalPage >= totalPages}
                    style={{padding:'6px 14px',borderRadius:8,border:'1px solid #e5e7eb',background:'#f9fafb',fontSize:13,cursor: modalPage >= totalPages ? 'default' : 'pointer',opacity: modalPage >= totalPages ? 0.3 : 1,color:'#4b5563'}}>다음 →</button>
                </div>
              );
            })()}
          </div>
        </div>,
        document.body
      )}

      {/* 알림 상세 모달 */}
      {showAlertModal && createPortal(
        <div
          onClick={() => setShowAlertModal(false)}
          style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.5)',zIndex:10000,display:'flex',alignItems:'center',justifyContent:'center',padding:16,overflow:'hidden'}}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{background:'#fff',borderRadius:16,width:'100%',maxWidth:900,height:'80vh',display:'flex',flexDirection:'column',boxShadow:'0 20px 60px rgba(0,0,0,0.2)',overflow:'hidden'}}
          >
            {/* 헤더 */}
            <div style={{padding:'16px 20px',borderBottom:'1px solid #e2e8f0',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
              <h3 style={{fontSize:16,fontWeight:800,color:'#0f172a'}}>
                {alertModalTitle} ({alertModalData.length}건)
              </h3>
              <button onClick={() => setShowAlertModal(false)}
                style={{background:'#f1f5f9',border:'none',borderRadius:8,width:32,height:32,fontSize:18,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:'#64748b'}}>
                ✕
              </button>
            </div>

            {/* 본문 */}
            <div style={{flex:1,overflow:'auto'}}>
              {alertModalData.length === 0 ? (
                <div style={{padding:40,textAlign:'center',color:'#94a3b8'}}>
                  <div style={{fontSize:24,marginBottom:8}}>✅</div>
                  해당 알림이 없습니다.
                </div>
              ) : (
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
                  <thead>
                    <tr style={{background:'#f8fafc',position:'sticky',top:0,zIndex:1}}>
                      <th style={thStyle}>No</th>
                      <th style={thStyle}>시간</th>
                      <th style={thStyle}>센서</th>
                      <th style={thStyle}>유형</th>
                      <th style={thStyle}>등급</th>
                      <th style={thStyle}>메시지</th>
                      <th style={{...thStyle,textAlign:'right'}}>측정값</th>
                      <th style={{...thStyle,textAlign:'right'}}>임계값</th>
                      <th style={thStyle}>확인</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alertModalData.map((alert, idx) => {
                      const isCritical = alert.severity === 'CRITICAL';
                      const isNormal = alert.alertType === 'NORMAL';
                      return (
                        <tr key={idx} style={{borderBottom:'1px solid #f1f5f9', background: isNormal ? '#f0fdf4' : isCritical ? '#fef2f2' : ''}}
                          onMouseEnter={(e) => e.currentTarget.style.background = isNormal ? '#ecfdf5' : isCritical ? '#fee2e2' : '#f8fafc'}
                          onMouseLeave={(e) => e.currentTarget.style.background = isNormal ? '#f0fdf4' : isCritical ? '#fef2f2' : ''}
                        >
                          <td style={tdStyle}>{idx + 1}</td>
                          <td style={{...tdStyle,whiteSpace:'nowrap',fontFamily:'monospace',fontSize:12}}>
                            {new Date(alert.createdAt || alert.timestamp).toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}
                          </td>
                          <td style={tdStyle}>
                            <span style={{fontWeight:600}}>{sensorLabel(alert.sensorId || '-', config?.sensors)}</span>
                            <div style={{fontSize:10,color:'#94a3b8'}}>{alert.sensorId || ''}</div>
                          </td>
                          <td style={tdStyle}>
                            <span style={{fontSize:11,padding:'2px 6px',borderRadius:4,fontWeight:600,
                              background: isNormal ? '#dcfce7' : alert.alertType === 'HIGH' ? '#fee2e2' : alert.alertType === 'LOW' ? '#dbeafe' : '#f1f5f9',
                              color: isNormal ? '#16a34a' : alert.alertType === 'HIGH' ? '#dc2626' : alert.alertType === 'LOW' ? '#2563eb' : '#475569',
                            }}>
                              {isNormal ? '정상복귀' : alert.alertType === 'HIGH' ? '상한초과' : alert.alertType === 'LOW' ? '하한미달' : alert.alertType}
                            </span>
                          </td>
                          <td style={tdStyle}>
                            <span style={{fontSize:11,padding:'2px 6px',borderRadius:4,fontWeight:700,
                              background: isCritical ? '#dc2626' : '#f59e0b', color:'#fff',
                            }}>
                              {isCritical ? '심각' : '경고'}
                            </span>
                          </td>
                          <td style={{...tdStyle,maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',fontSize:12}}>
                            {alert.message || '-'}
                          </td>
                          <td style={{...tdStyle,textAlign:'right',fontFamily:'monospace',fontWeight:700,
                            color: isNormal ? '#16a34a' : isCritical ? '#dc2626' : '#d97706'}}>
                            {alert.value != null ? fmtVal(alert.value) : '-'}
                          </td>
                          <td style={{...tdStyle,textAlign:'right',fontFamily:'monospace',color:'#64748b'}}>
                            {alert.threshold != null ? fmtVal(alert.threshold) : '-'}
                          </td>
                          <td style={tdStyle}>
                            {alert.acknowledged
                              ? <span style={{color:'#16a34a',fontWeight:600,fontSize:11}}>확인됨</span>
                              : <span style={{color:'#ef4444',fontWeight:600,fontSize:11}}>미확인</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* 푸터 */}
            {alertModalData.length > 0 && (
              <div style={{padding:'10px 20px',borderTop:'1px solid #e2e8f0',fontSize:12,color:'#94a3b8',textAlign:'center',flexShrink:0}}>
                오늘 {alertModalData.length}건 표시
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

const thStyle = { padding:'8px 12px', textAlign:'left', fontSize:12, fontWeight:700, color:'#475569', borderBottom:'2px solid #e2e8f0' };
const tdStyle = { padding:'7px 12px', color:'#334155' };

export default TodaySummaryWidget;
