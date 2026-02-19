import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';
const HEALTH_URL = API_BASE_URL.replace(/\/api$/, '/health');

const SystemStatusWidget = ({ config, latestData, alerts }) => {
  const [serverOnline, setServerOnline] = useState(null);

  const checkServer = useCallback(async () => {
    try {
      const res = await axios.get(HEALTH_URL, { timeout: 5000 });
      setServerOnline(res.data?.success === true);
    } catch {
      setServerOnline(false);
    }
  }, []);

  useEffect(() => {
    checkServer();
    const interval = setInterval(checkServer, 30000);
    return () => clearInterval(interval);
  }, [checkServer]);

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
  // 종합 상태: 서버 연결 + 센서 데이터 신선도
  // - 서버 ON + 데이터 신선 → 정상 (green)
  // - 서버 ON + 데이터 오래됨 → 수집 대기 (amber)
  // - 서버 OFF → 오프라인 (red)
  const sensorStatus = serverOnline === null
    ? { value: '확인 중', color: 'text-gray-400', dotColor: 'bg-gray-400' }
    : !serverOnline
      ? { value: '오프라인', color: 'text-rose-600', dotColor: 'bg-rose-500' }
      : sensorFresh
        ? { value: '정상', color: 'text-emerald-600', dotColor: 'bg-emerald-500' }
        : { value: '수집 대기', color: 'text-amber-600', dotColor: 'bg-amber-500' };

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

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 md:p-5">
      <h2 className="text-base md:text-lg font-bold text-gray-800 mb-4">시스템 상태</h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 md:gap-3 mb-5">
        {statusItems.map((item) => (
          <div key={item.label} className="bg-gray-50 rounded-xl p-3 md:p-4 border border-gray-200">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] md:text-xs text-gray-500 font-medium">{item.label}</span>
              {item.showDot && (
                <span className={`w-2.5 h-2.5 rounded-full ${item.dotColor} ${serverOnline ? 'animate-pulse' : ''}`} />
              )}
            </div>
            <div className={`text-lg md:text-xl font-bold font-mono ${item.color}`}>
              {item.value}
            </div>
            <p className="text-[10px] text-gray-400 mt-0.5">{item.sub}</p>
          </div>
        ))}
      </div>

      {/* 센서별 상태 */}
      {config?.sensors && config.sensors.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2.5">센서별 상태</h3>
          <div className="space-y-1.5">
            {config.sensors.map(sensor => {
              const value = latestData?.data?.[sensor.sensorId];
              const hasValue = value !== null && value !== undefined;
              const isWarning = sensor.type === 'number' && hasValue && (
                (sensor.min !== null && value < sensor.min) ||
                (sensor.max !== null && value > sensor.max)
              );

              return (
                <div
                  key={sensor.sensorId}
                  className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2.5 
                           border border-gray-200 hover:bg-gray-100 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="text-lg">{sensor.icon}</span>
                    <div>
                      <p className="text-sm font-medium text-gray-800">{sensor.name}</p>
                      <p className="text-[10px] text-gray-400">{sensor.sensorId}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {hasValue ? (
                      <>
                        <span className={`text-sm font-mono font-bold ${
                          isWarning ? 'text-rose-600' : 'text-emerald-600'
                        }`}>
                          {typeof value === 'number' ? value.toFixed(sensor.precision || 1) : value}
                          <span className="text-[10px] text-gray-400 ml-0.5">{sensor.unit}</span>
                        </span>
                        {isWarning && (
                          <span className="text-[10px] bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded font-medium">
                            초과
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default SystemStatusWidget;
