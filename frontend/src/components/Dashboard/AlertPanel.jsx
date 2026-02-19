import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

const AlertPanel = ({ farmId, houseId, showPanel, setShowPanel, isMobile = false }) => {
  const [alerts, setAlerts] = useState([]);
  const [unacknowledgedCount, setUnacknowledgedCount] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadAlerts();
    const interval = setInterval(loadAlerts, 10000);
    return () => clearInterval(interval);
  }, [farmId, houseId]);

  const loadAlerts = async () => {
    try {
      let url = `${API_BASE_URL}/alerts/${farmId}?limit=100`;
      if (houseId) {
        url += `&houseId=${houseId}`;
      }
      
      const response = await axios.get(url);
      
      if (response.data.success) {
        setAlerts(response.data.data);
        const unack = response.data.data.filter(a => !a.acknowledged && a.alertType !== 'NORMAL');
        setUnacknowledgedCount(unack.length);
      }
    } catch (error) {
      console.error('❌ 알림 조회 실패:', error);
    }
  };

  const acknowledgeAlert = async (alertId) => {
    try {
      await axios.put(`${API_BASE_URL}/alerts/${alertId}/acknowledge`);
      loadAlerts();
    } catch (error) {
      console.error('Failed to acknowledge alert:', error);
    }
  };

  const acknowledgeAll = async () => {
    try {
      setLoading(true);
      let url = `${API_BASE_URL}/alerts/${farmId}/acknowledge-all`;
      if (houseId) {
        url += `?houseId=${houseId}`;
      }
      await axios.put(url);
      loadAlerts();
    } catch (error) {
      console.error('Failed to acknowledge all alerts:', error);
    } finally {
      setLoading(false);
    }
  };

  const deleteAlert = async (alertId, alertMessage) => {
    if (!confirm(`이 알림을 삭제하시겠습니까?\n\n"${alertMessage}"`)) {
      return;
    }

    try {
      await axios.delete(`${API_BASE_URL}/alerts/${alertId}`);
      loadAlerts();
    } catch (error) {
      console.error('Failed to delete alert:', error);
    }
  };

  const deleteAllAlerts = async () => {
    if (!confirm(`⚠️ 모든 알림을 삭제하시겠습니까?\n\n총 ${alerts.length}개의 알림이 영구적으로 삭제됩니다.`)) {
      return;
    }

    try {
      setLoading(true);
      for (const alert of alerts) {
        await axios.delete(`${API_BASE_URL}/alerts/${alert._id}`);
      }
      loadAlerts();
    } catch (error) {
      console.error('Failed to delete all alerts:', error);
    } finally {
      setLoading(false);
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'CRITICAL':
        return 'bg-red-50 border-red-300';
      case 'WARNING':
        return 'bg-amber-50 border-amber-300';
      case 'INFO':
        return 'bg-blue-50 border-blue-300';
      default:
        return 'bg-gray-50 border-gray-300';
    }
  };

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'CRITICAL':
        return '🔴';
      case 'WARNING':
        return '⚠️';
      case 'INFO':
        return 'ℹ️';
      default:
        return '•';
    }
  };

  const getAlertTypeText = (type) => {
    switch (type) {
      case 'HIGH':
        return '높음';
      case 'LOW':
        return '낮음';
      case 'OFFLINE':
        return '오프라인';
      default:
        return type;
    }
  };

  // 데스크톱 버튼만 렌더링
  if (!isMobile && !showPanel) {
    return (
      <button
        onClick={() => setShowPanel(!showPanel)}
        className={`relative px-4 py-2 rounded-lg font-medium transition-all ${
          unacknowledgedCount > 0
            ? 'bg-red-500 text-white animate-pulse'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-200'
        }`}
      >
        🔔 알림
        {unacknowledgedCount > 0 && (
          <span className="absolute -top-2 -right-2 bg-red-600 text-white text-xs rounded-full w-6 h-6 flex items-center justify-center font-bold shadow-lg">
            {unacknowledgedCount}
          </span>
        )}
      </button>
    );
  }

  if (!showPanel) return null;

  // 모바일 전체화면 패널
  if (isMobile) {
    return (
      <div className="fixed inset-0 z-50 bg-white flex flex-col">
        {/* 헤더 */}
        <div className="bg-white border-b border-gray-200 p-3 flex items-center justify-between flex-shrink-0">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <span className="text-2xl">🔔</span>
            <span>알림</span>
            <span className="text-sm text-gray-400">({alerts.length})</span>
          </h3>
          <button
            onClick={() => setShowPanel(false)}
            className="p-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg transition-all text-xl w-10 h-10 flex items-center justify-center border border-gray-200"
          >
            ✕
          </button>
        </div>

        {/* 액션 버튼 */}
        {alerts.length > 0 && (
          <div className="p-3 flex gap-2 border-b border-gray-200 flex-shrink-0">
            {unacknowledgedCount > 0 && (
              <button
                onClick={acknowledgeAll}
                disabled={loading}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-all disabled:opacity-50 font-medium text-sm"
              >
                모두 확인
              </button>
            )}
            <button
              onClick={deleteAllAlerts}
              disabled={loading}
              className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition-all disabled:opacity-50 font-medium text-sm"
            >
              전체 삭제
            </button>
          </div>
        )}

        {/* 알림 목록 */}
        <div className="flex-1 overflow-y-auto p-3">
          {alerts.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center">
              <div className="text-6xl mb-4 opacity-50">🔕</div>
              <p className="text-gray-700 font-medium text-lg mb-2">알림이 없습니다</p>
              <p className="text-sm text-gray-500 leading-relaxed">
                센서 임계값을 초과하면<br/>여기에 알림이 표시됩니다
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert) => (
                <div
                  key={alert._id}
                  className={`rounded-xl border p-3 ${
                    alert.acknowledged
                      ? 'bg-gray-50 border-gray-200 opacity-60'
                      : getSeverityColor(alert.severity)
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 text-2xl">
                      {getSeverityIcon(alert.severity)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="font-bold text-gray-800 text-base">
                          {alert.metadata?.houseName || alert.houseId}
                        </span>
                        <span className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded font-medium">
                          {getAlertTypeText(alert.alertType)}
                        </span>
                        {alert.acknowledged && (
                          <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded font-medium">
                            ✓ 확인됨
                          </span>
                        )}
                        {alert.severity === 'CRITICAL' && !alert.acknowledged && (
                          <span className="text-xs bg-red-200 text-red-700 px-2 py-1 rounded animate-pulse font-medium">
                            심각
                          </span>
                        )}
                      </div>

                      <p className="text-sm text-gray-700 leading-relaxed mb-2 break-words">
                        {alert.message}
                      </p>

                      <p className="text-xs text-gray-500 mb-3">
                        🕐 {new Date(alert.createdAt).toLocaleString('ko-KR', {
                          month: 'long',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </p>

                      <div className="flex gap-2">
                        {!alert.acknowledged && (
                          <button
                            onClick={() => acknowledgeAlert(alert._id)}
                            className="flex-1 py-2 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 text-emerald-700 rounded-lg transition-all font-medium text-sm"
                          >
                            ✓ 확인
                          </button>
                        )}
                        <button
                          onClick={() => deleteAlert(alert._id, alert.message)}
                          className="flex-1 py-2 bg-rose-100 hover:bg-rose-200 border border-rose-300 text-rose-700 rounded-lg transition-all font-medium text-sm"
                        >
                          🗑️ 삭제
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 데스크톱 드롭다운 패널
  return (
    <>
      <div 
        className="fixed inset-0 bg-black/10 backdrop-blur-[2px]"
        style={{ zIndex: 40 }}
        onClick={() => setShowPanel(false)}
      />
      
      <div 
        className="fixed bg-white border border-gray-200 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={{
          right: '16px',
          top: '72px',
          width: '450px',
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 100px)',
          zIndex: 45,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.15)'
        }}
      >
        <div className="bg-white border-b border-gray-200 p-4 flex items-center justify-between flex-shrink-0">
          <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
            <span className="text-2xl">🔔</span>
            <span>알림</span>
            <span className="text-sm text-gray-400">({alerts.length})</span>
          </h3>
          <div className="flex gap-2">
            {alerts.length > 0 && (
              <>
                {unacknowledgedCount > 0 && (
                  <button
                    onClick={acknowledgeAll}
                    disabled={loading}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-lg transition-all disabled:opacity-50 font-medium"
                  >
                    모두 확인
                  </button>
                )}
                <button
                  onClick={deleteAllAlerts}
                  disabled={loading}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs rounded-lg transition-all disabled:opacity-50 font-medium"
                >
                  전체 삭제
                </button>
              </>
            )}
            <button
              onClick={() => setShowPanel(false)}
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs rounded-lg transition-all font-medium border border-gray-200"
            >
              닫기
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          {alerts.length === 0 ? (
            <div className="p-12 text-center">
              <div className="text-7xl mb-4 opacity-50">🔕</div>
              <p className="text-gray-700 font-medium text-lg mb-2">알림이 없습니다</p>
              <p className="text-sm text-gray-500 leading-relaxed">
                센서 임계값을 초과하면<br/>여기에 알림이 표시됩니다
              </p>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {alerts.map((alert) => (
                <div
                  key={alert._id}
                  className={`rounded-xl border transition-all hover:shadow-lg hover:scale-[1.01] ${
                    alert.acknowledged
                      ? 'bg-gray-50 border-gray-200 opacity-60'
                      : getSeverityColor(alert.severity)
                  }`}
                >
                  <div className="p-4 flex items-start gap-3">
                    <div className="flex-shrink-0 text-2xl mt-1">
                      {getSeverityIcon(alert.severity)}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="font-bold text-gray-800 text-base">
                          {alert.metadata?.houseName || alert.houseId}
                        </span>
                        <span className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded-md font-medium">
                          {getAlertTypeText(alert.alertType)}
                        </span>
                        {alert.acknowledged && (
                          <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded-md font-medium">
                            ✓ 확인됨
                          </span>
                        )}
                        {alert.severity === 'CRITICAL' && !alert.acknowledged && (
                          <span className="text-xs bg-red-200 text-red-700 px-2 py-1 rounded-md animate-pulse font-medium">
                            심각
                          </span>
                        )}
                      </div>

                      <p className="text-sm text-gray-700 leading-relaxed mb-3 break-words">
                        {alert.message}
                      </p>

                      <p className="text-xs text-gray-500">
                        🕐 {new Date(alert.createdAt).toLocaleString('ko-KR', {
                          month: 'long',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </p>
                    </div>
                    
                    <div className="flex flex-col gap-2 flex-shrink-0">
                      {!alert.acknowledged && (
                        <button
                          onClick={() => acknowledgeAlert(alert._id)}
                          className="px-3 py-2 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300 text-emerald-700 text-xs rounded-lg transition-all font-medium whitespace-nowrap shadow-sm hover:shadow-md"
                        >
                          ✓ 확인
                        </button>
                      )}
                      <button
                        onClick={() => deleteAlert(alert._id, alert.message)}
                        className="px-3 py-2 bg-rose-100 hover:bg-rose-200 border border-rose-300 text-rose-700 text-xs rounded-lg transition-all font-medium whitespace-nowrap shadow-sm hover:shadow-md"
                      >
                        🗑️ 삭제
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {alerts.length > 0 && (
          <div className="bg-gray-50 border-t border-gray-200 p-3 flex-shrink-0">
            <p className="text-xs text-gray-500 text-center">
              ✓ 확인: 읽음 표시 • 🗑️ 삭제: 영구 삭제
            </p>
          </div>
        )}
      </div>
    </>
  );
};

export default AlertPanel;
