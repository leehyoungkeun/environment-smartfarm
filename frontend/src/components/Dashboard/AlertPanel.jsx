import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { useAuth } from '../../contexts/AuthContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

const AlertPanel = ({ farmId, houseId, showPanel, setShowPanel, isMobile = false }) => {
  const [alerts, setAlerts] = useState([]);
  const [unacknowledgedCount, setUnacknowledgedCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef(null);
  const buttonRef = useRef(null);
  const [panelPos, setPanelPos] = useState({ top: 0, right: 0 });
  const { user, roleLabel } = useAuth();
  const userName = `${roleLabel || ''} ${user?.name || user?.username || 'unknown'}`.trim();

  // 드롭다운 위치 계산
  useEffect(() => {
    if (showPanel && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPanelPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
    }
  }, [showPanel]);

  // 외부 클릭 감지 (오버레이 대신)
  useEffect(() => {
    if (!showPanel) return;
    const handleClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target) &&
          buttonRef.current && !buttonRef.current.contains(e.target)) {
        setShowPanel(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPanel, setShowPanel]);

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
      await axios.put(`${API_BASE_URL}/alerts/${alertId}/acknowledge`, { source: userName });
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
      await axios.put(url, { source: userName });
      loadAlerts();
    } catch (error) {
      console.error('Failed to acknowledge all alerts:', error);
    } finally {
      setLoading(false);
    }
  };

  const deleteAlert = async (alertId) => {
    try {
      await axios.delete(`${API_BASE_URL}/alerts/${alertId}?source=${encodeURIComponent(userName)}`);
      setAlerts(prev => prev.filter(a => a._id !== alertId));
    } catch (error) {
      console.error('Failed to delete alert:', error);
    }
  };

  const deleteAllAlerts = async () => {
    try {
      setLoading(true);
      await axios.delete(`${API_BASE_URL}/alerts/${farmId}/all?source=${encodeURIComponent(userName)}${houseId ? `&houseId=${houseId}` : ''}`);
      setAlerts([]);
      setUnacknowledgedCount(0);
    } catch (error) {
      console.error('Failed to delete all alerts:', error);
    } finally {
      setLoading(false);
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'CRITICAL':
        return 'bg-red-50 border-red-200';
      case 'WARNING':
        return 'bg-amber-50 border-amber-200';
      case 'INFO':
        return 'bg-blue-50 border-blue-200';
      default:
        return 'bg-gray-50 border-gray-200';
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

  // 모바일 전체화면 패널
  if (isMobile && showPanel) {
    return (
      <div className="fixed inset-0 z-50 bg-white flex flex-col">
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
              {alerts.map((alert) => renderAlertCard(alert, true))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // 알림 카드 렌더 함수
  function renderAlertCard(alert, mobile = false) {
    return (
      <div
        key={alert._id}
        className={`rounded-xl border transition-all ${
          alert.acknowledged
            ? 'bg-gray-50/80 border-gray-200 opacity-60'
            : getSeverityColor(alert.severity)
        }`}
      >
        <div className={`${mobile ? 'p-3' : 'p-3.5'} flex items-start gap-3`}>
          <div className="flex-shrink-0 text-lg mt-0.5">
            {getSeverityIcon(alert.severity)}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1 flex-wrap">
              <span className="font-bold text-gray-800 text-sm">
                {alert.metadata?.houseName || alert.houseId}
              </span>
              <span className="text-xs bg-gray-200/80 text-gray-600 px-1.5 py-0.5 rounded-md font-medium">
                {getAlertTypeText(alert.alertType)}
              </span>
              {alert.acknowledged && (
                <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-md font-medium">
                  ✓ 확인
                </span>
              )}
              {alert.severity === 'CRITICAL' && !alert.acknowledged && (
                <span className="text-xs bg-red-200 text-red-700 px-1.5 py-0.5 rounded-md animate-pulse font-medium">
                  심각
                </span>
              )}
            </div>

            <p className="text-sm text-gray-700 leading-relaxed mb-1.5 break-words">
              {alert.message}
            </p>

            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-400">
                {new Date(alert.createdAt).toLocaleString('ko-KR', {
                  month: 'long',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
              <div className="flex gap-1.5">
                {!alert.acknowledged && (
                  <button
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); acknowledgeAlert(alert._id); }}
                    className="px-2.5 py-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 text-xs rounded-lg transition-all font-medium"
                  >
                    ✓ 확인
                  </button>
                )}
                <button
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); deleteAlert(alert._id); }}
                  className="px-2.5 py-1 bg-gray-100 hover:bg-rose-100 text-gray-500 hover:text-rose-600 text-xs rounded-lg transition-all font-medium"
                >
                  삭제
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }


  // 데스크톱: 버튼 + 드롭다운 패널
  return (
    <div className="relative">
      {/* 알림 버튼 (항상 표시) */}
      <button
        ref={buttonRef}
        onClick={() => setShowPanel(!showPanel)}
        className={`relative py-2 rounded-xl font-medium transition-all duration-200 flex items-center justify-center gap-1 whitespace-nowrap ${
          showPanel
            ? 'tab-active'
            : unacknowledgedCount > 0
              ? 'bg-red-500 text-white shadow-lg shadow-red-500/25'
              : 'tab-inactive'
        }`}
        style={{ width: 96, paddingLeft: 4, paddingRight: 4, fontSize: 13 }}
      >
        <span>🔔</span>
        알림
        {unacknowledgedCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 bg-red-600 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold shadow-md animate-pulse">
            {unacknowledgedCount}
          </span>
        )}
      </button>

      {/* 드롭다운 패널 (fixed로 nav 스태킹 컨텍스트 탈출) */}
      {showPanel && (
          <div
            ref={panelRef}
            className="fixed bg-white rounded-2xl border border-gray-200 flex flex-col overflow-hidden animate-fade-in-up"
            style={{
              top: panelPos.top,
              right: panelPos.right,
              width: '400px',
              maxWidth: 'calc(100vw - 32px)',
              maxHeight: 'calc(100vh - 100px)',
              zIndex: 9999,
              boxShadow: '0 20px 40px -8px rgba(0,0,0,0.12), 0 8px 16px -4px rgba(0,0,0,0.08)'
            }}
          >
            {/* 헤더 */}
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-lg">🔔</span>
                <span className="text-base font-bold text-gray-800">알림</span>
                {alerts.length > 0 && (
                  <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full font-medium">{alerts.length}</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {alerts.length > 0 && (
                  <>
                    {unacknowledgedCount > 0 && (
                      <button
                        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); acknowledgeAll(); }}
                        disabled={loading}
                        className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 text-xs rounded-lg transition-all disabled:opacity-50 font-medium border border-emerald-200"
                      >
                        모두 확인
                      </button>
                    )}
                    <button
                      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); deleteAllAlerts(); }}
                      disabled={loading}
                      className="px-2.5 py-1.5 bg-gray-50 hover:bg-rose-50 text-gray-500 hover:text-rose-600 text-xs rounded-lg transition-all disabled:opacity-50 font-medium border border-gray-200 hover:border-rose-200"
                    >
                      전체 삭제
                    </button>
                  </>
                )}
                <button
                  onClick={() => setShowPanel(false)}
                  className="w-7 h-7 flex items-center justify-center bg-gray-100 hover:bg-gray-200 text-gray-400 hover:text-gray-600 rounded-lg transition-all text-sm"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* 알림 목록 */}
            <div className="overflow-y-auto flex-1">
              {alerts.length === 0 ? (
                <div className="py-16 px-8 text-center">
                  <div className="text-5xl mb-3 opacity-40">🔕</div>
                  <p className="text-gray-600 font-semibold text-base mb-1">알림이 없습니다</p>
                  <p className="text-xs text-gray-400 leading-relaxed">
                    센서 임계값을 초과하면<br/>여기에 알림이 표시됩니다
                  </p>
                </div>
              ) : (
                <div className="p-3 space-y-2">
                  {alerts.map((alert) => renderAlertCard(alert))}
                </div>
              )}
            </div>
          </div>
      )}
    </div>
  );
};

export default AlertPanel;
