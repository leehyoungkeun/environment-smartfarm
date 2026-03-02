import { useState, useEffect } from 'react';
import { getSystemMode, onModeChange } from '../../services/apiSwitcher';

const SystemStatusWidget = ({ config, latestData, alerts }) => {
  const [systemMode, setSystemMode] = useState(getSystemMode());

  // apiSwitcher의 헬스체크 결과를 그대로 사용 (중복 HTTP 호출 제거)
  useEffect(() => {
    const unsubscribe = onModeChange((mode) => setSystemMode(mode));
    return unsubscribe;
  }, []);

  const serverOnline = systemMode.serverOnline;

  const getTimeSince = (timestamp) => {
    if (!timestamp) return '데이터 없음';
    const now = new Date();
    const then = new Date(timestamp);
    const diff = Math.floor((now - then) / 1000);
    if (diff < 60) return `${diff}초 전`;
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
    return `${Math.floor(diff / 86400)}일 전`;
  };

  const isSensorFresh = (timestamp) => {
    if (!timestamp) return false;
    const now = new Date();
    const then = new Date(timestamp);
    const diff = (now - then) / 1000;
    return diff < (config?.collection?.intervalSeconds || 60) * 10;
  };

  const sensorFresh = isSensorFresh(latestData?.timestamp);
  const isManualRpi = systemMode.manualOverride;
  const isFarmLocal = systemMode.isFarmLocal || systemMode.mode === 'farm-local';

  // 종합 상태: 팜로컬 → 로컬 모드 → 서버 연결 + 센서 데이터 신선도
  const sensorStatus = isFarmLocal
    ? (sensorFresh || latestData?.timestamp
      ? { value: '팜로컬 운영', color: 'text-emerald-600', dotColor: 'bg-emerald-500' }
      : { value: '팜로컬 대기', color: 'text-amber-600', dotColor: 'bg-amber-500' })
    : serverOnline === null && !isManualRpi
    ? { value: '확인 중', color: 'text-gray-400', dotColor: 'bg-gray-400' }
    : isManualRpi && sensorFresh
      ? { value: '로컬 운영', color: 'text-blue-600', dotColor: 'bg-blue-500' }
      : isManualRpi && latestData?.timestamp
        ? { value: '로컬 운영', color: 'text-blue-600', dotColor: 'bg-blue-500' }
        : isManualRpi
          ? { value: '로컬 대기', color: 'text-amber-600', dotColor: 'bg-amber-500' }
          : serverOnline && sensorFresh
            ? { value: '정상', color: 'text-emerald-600', dotColor: 'bg-emerald-500' }
            : serverOnline && !sensorFresh
              ? { value: '수집 대기', color: 'text-amber-600', dotColor: 'bg-amber-500' }
              : { value: '연결 끊김', color: 'text-rose-600', dotColor: 'bg-rose-500' };

  const activeAlerts = alerts?.filter(a => !a.acknowledged && a.alertType !== 'NORMAL') || [];
  const activeSensors = config?.sensors?.filter(s => s.enabled).length || 0;
  const totalSensors = config?.sensors?.length || 0;

  const statusItems = [
    {
      label: '센서 상태',
      value: sensorStatus.value,
      sub: latestData?.timestamp ? getTimeSince(latestData.timestamp) : '데이터 없음',
      color: sensorStatus.color,
      dotColor: sensorStatus.dotColor,
      showDot: true,
    },
    {
      label: '활성 센서',
      value: activeSensors,
      sub: `전체 ${totalSensors}개`,
      color: 'text-blue-600',
    },
    {
      label: '미확인 알림',
      value: activeAlerts.length,
      sub: activeAlerts.length > 0 ? '확인 필요' : '정상',
      color: activeAlerts.length > 0 ? 'text-rose-600' : 'text-emerald-600',
    },
    {
      label: '수집 주기',
      value: `${config?.collection?.intervalSeconds || 0}초`,
      sub: '자동 수집',
      color: 'text-violet-600',
    },
  ];

  // 센서 상태에 따른 헤더 색상 (로컬 모드 우선)
  const headerColor = isFarmLocal
    ? '#059669'   // 팜로컬: 초록
    : isManualRpi
    ? '#2563eb'   // 로컬 모드: 파란색
    : serverOnline
      ? (sensorFresh ? '#059669' : '#d97706')
      : '#ef4444';  // 연결 끊김: 빨간색

  return (
    <div style={{background:'#fff',border:'1px solid #e2e8f0',borderRadius:16,overflow:'hidden',boxShadow:'0 1px 3px rgba(0,0,0,0.06)'}}>
      <div style={{background:headerColor,padding:'12px 18px',display:'flex',alignItems:'center',justifyContent:'space-between',transition:'background 0.3s'}}>
        <h2 style={{fontSize:16,fontWeight:800,color:'#fff'}}>⚡ 시스템 상태</h2>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{width:10,height:10,borderRadius:'50%',background:'#fff',display:'inline-block',boxShadow:'0 0 8px rgba(255,255,255,0.6)'}} className={serverOnline ? 'animate-pulse' : ''} />
          <span style={{color:'#fff',fontSize:13,fontWeight:700}}>
            {sensorStatus.value}
          </span>
        </div>
      </div>

      <div style={{padding:'16px'}}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {statusItems.map((item) => (
            <div key={item.label} style={{background:'#f8fafc',borderRadius:14,padding:'14px 16px',border:'2px solid #e2e8f0',transition:'all 0.2s'}}>
              <div className="flex items-center justify-between mb-2">
                <span style={{fontSize:12,fontWeight:700,color:'#64748b'}}>{item.label}</span>
                {item.showDot && (
                  <span style={{width:10,height:10,borderRadius:'50%',display:'inline-block',boxShadow:`0 0 8px ${item.dotColor === 'bg-emerald-500' ? '#10b981' : item.dotColor === 'bg-rose-500' ? '#ef4444' : '#f59e0b'}`}} className={`${item.dotColor} ${serverOnline ? 'animate-pulse' : ''}`} />
                )}
              </div>
              <div style={{fontSize:22,fontWeight:900,fontFamily:'monospace',lineHeight:1}} className={item.color}>
                {item.value}
              </div>
              <p style={{fontSize:11,color:'#94a3b8',marginTop:4,fontWeight:500}}>{item.sub}</p>
            </div>
          ))}
        </div>

        {/* 센서별 상태 */}
        {config?.sensors && config.sensors.length > 0 && (
          <div>
            <div style={{fontSize:13,fontWeight:700,color:'#64748b',marginBottom:10,display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
              <span style={{width:4,height:14,background:headerColor,borderRadius:2,display:'inline-block'}}/>
              센서별 실시간
              {latestData?.timestamp && (
                <span style={{fontSize:13,fontWeight:700,color:'#475569',marginLeft:'auto',fontFamily:'monospace',background:'#f1f5f9',padding:'2px 8px',borderRadius:6}}>
                  {new Date(latestData.timestamp).toLocaleString('ko-KR', {year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})}
                </span>
              )}
            </div>
            <div className="space-y-2">
              {config.sensors.map(sensor => {
                const value = latestData?.data?.[sensor.sensorId];
                const hasValue = value !== null && value !== undefined;
                const isWarning = sensor.type === 'number' && hasValue && (
                  (sensor.min !== null && value < sensor.min) ||
                  (sensor.max !== null && value > sensor.max)
                );

                return (
                  <div key={sensor.sensorId}
                    style={{display:'flex',alignItems:'center',justifyContent:'space-between',
                      background: isWarning ? '#fef2f2' : '#f8fafc',
                      borderRadius:12,padding:'12px 16px',
                      border: isWarning ? '2px solid #fecaca' : '2px solid #e2e8f0',
                      transition:'all 0.2s'}}>
                    <div className="flex items-center gap-3">
                      <span style={{fontSize:22}}>{sensor.icon}</span>
                      <div>
                        <p style={{fontSize:14,fontWeight:700,color:'#0f172a'}}>{sensor.name}</p>
                        <p style={{fontSize:10,color:'#94a3b8'}}>{sensor.sensorId}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {hasValue ? (
                        <>
                          <span style={{fontSize:18,fontWeight:900,fontFamily:'monospace',color: isWarning ? '#dc2626' : '#059669'}}>
                            {typeof value === 'number' ? value.toFixed(sensor.precision || 1) : value}
                          </span>
                          <span style={{fontSize:11,color:'#94a3b8',fontWeight:600}}>{sensor.unit}</span>
                          {isWarning && (
                            <span style={{fontSize:11,background:'#dc2626',color:'#fff',padding:'2px 8px',borderRadius:6,fontWeight:700}}>
                              초과
                            </span>
                          )}
                        </>
                      ) : (
                        <span style={{fontSize:14,color:'#cbd5e1',fontWeight:600}}>—</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SystemStatusWidget;
