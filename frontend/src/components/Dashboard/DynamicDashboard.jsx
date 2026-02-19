import React, { useState, useEffect } from 'react';
import axios from 'axios';
import StatsWidget from './StatsWidget';
import GaugeWidget from './GaugeWidget';
import SystemStatusWidget from './SystemStatusWidget';
import TodaySummaryWidget from './TodaySummaryWidget';
import SensorChart from './SensorChart';
import ControlPanel from './ControlPanel';
import AnalyticsDashboard from './AnalyticsDashboard';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

const DynamicDashboard = ({ farmId }) => {
  const [config, setConfig] = useState(null);
  const [selectedHouse, setSelectedHouse] = useState(null);
  const [latestData, setLatestData] = useState({});
  const [historyData, setHistoryData] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [viewMode, setViewMode] = useState('overview');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    loadConfig();
  }, [farmId]);

  useEffect(() => {
    if (selectedHouse) {
      loadLatestData();
      const interval = setInterval(loadLatestData, 10000);
      return () => clearInterval(interval);
    }
  }, [selectedHouse]);

  const loadConfig = async () => {
    setLoadError(null);
    try {
      const response = await axios.get(`${API_BASE_URL}/config/${farmId}`);
      if (response.data.success && response.data.data) {
        setConfig(response.data.data);
        if (response.data.data.houses && response.data.data.houses.length > 0) {
          setSelectedHouse(response.data.data.houses[0].houseId);
        }
      }
    } catch (error) {
      console.error('설정 로드 실패:', error);
      const status = error.response?.status;
      const code = error.response?.data?.code;
      if (status === 401) {
        setLoadError('auth');
      } else if (status === 403) {
        setLoadError('forbidden');
      } else {
        setLoadError('network');
      }
    } finally {
      setLoading(false);
    }
  };

  const loadLatestData = async () => {
    if (!selectedHouse) return;
    try {
      const response = await axios.get(`${API_BASE_URL}/sensors/latest/${farmId}/${selectedHouse}`);
      if (response.data.success) {
        setLatestData(response.data.data || {});
      }
    } catch (error) {
      if (error.response?.status !== 404) {
        console.error('최신 데이터 로드 실패:', error);
      }
    }

    try {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const historyRes = await axios.get(
        `${API_BASE_URL}/sensors/${farmId}/${selectedHouse}/history`,
        { params: { startDate: yesterday.toISOString(), endDate: now.toISOString() } }
      );
      if (historyRes.data.success) {
        setHistoryData(historyRes.data.data || []);
      }
    } catch (error) {
      if (error.response?.status !== 404) {
        console.error('히스토리 데이터 로드 실패:', error);
      }
    }

    try {
      const alertsRes = await axios.get(
        `${API_BASE_URL}/alerts/${farmId}?houseId=${selectedHouse}`
      );
      if (alertsRes.data.success) {
        setAlerts(alertsRes.data.data || []);
      }
    } catch (error) {
      if (error.response?.status !== 404) {
        console.error('알림 로드 실패:', error);
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
          <span className="text-gray-500 text-sm font-medium">데이터를 불러오는 중...</span>
        </div>
      </div>
    );
  }

  if (loadError) {
    const errorMessages = {
      auth: { icon: '🔒', title: '인증 오류', desc: '로그아웃 후 다시 로그인해주세요' },
      forbidden: { icon: '🚫', title: '접근 권한 없음', desc: '이 농장에 대한 접근 권한이 없습니다' },
      network: { icon: '🌐', title: '서버 연결 실패', desc: '백엔드 서버가 실행 중인지 확인하세요' },
    };
    const msg = errorMessages[loadError] || errorMessages.network;
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="text-center bg-white border border-gray-200 rounded-2xl shadow-sm p-12 max-w-sm">
          <div className="text-6xl mb-6">{msg.icon}</div>
          <h2 className="text-xl font-bold text-gray-800 mb-3">{msg.title}</h2>
          <p className="text-gray-500 text-sm leading-relaxed mb-6">{msg.desc}</p>
          <button
            onClick={() => { setLoading(true); loadConfig(); }}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium
                       hover:bg-blue-700 transition-all active:scale-95"
          >
            다시 시도
          </button>
        </div>
      </div>
    );
  }

  if (!config || !config.houses || config.houses.length === 0) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="text-center bg-white border border-gray-200 rounded-2xl shadow-sm p-12 max-w-sm">
          <div className="text-6xl mb-6">🏗️</div>
          <h2 className="text-xl font-bold text-gray-800 mb-3">하우스가 없습니다</h2>
          <p className="text-gray-500 text-sm leading-relaxed">
            설정 페이지에서 하우스를 추가하면<br/>여기에 센서 데이터가 표시됩니다
          </p>
        </div>
      </div>
    );
  }

  const currentHouse = config.houses.find(h => h.houseId === selectedHouse);
  const sensors = currentHouse?.sensors || [];

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6 space-y-5">
      {/* 헤더 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-fade-in-up">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-800 tracking-tight">
            대시보드
          </h1>
          <p className="text-gray-500 text-xs md:text-sm mt-0.5">실시간 센서 모니터링</p>
        </div>

        <div className="flex gap-1.5 p-1 bg-gray-100 rounded-xl border border-gray-200">
          <button
            onClick={() => setViewMode('overview')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              viewMode === 'overview'
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            개요
          </button>
          <button
            onClick={() => setViewMode('control')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              viewMode === 'control'
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            제어
          </button>
          <button
            onClick={() => setViewMode('analytics')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              viewMode === 'analytics'
                ? 'bg-white text-gray-800 shadow-sm'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            }`}
          >
            분석
          </button>
        </div>
      </div>

      {/* 하우스 선택 */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0 animate-fade-in-up stagger-1">
        {config.houses.map((house, idx) => (
          <button
            key={house.houseId}
            onClick={() => setSelectedHouse(house.houseId)}
            className={`flex items-center gap-2.5 px-4 md:px-5 py-2.5 rounded-xl font-medium 
                       whitespace-nowrap transition-all duration-200 text-sm flex-shrink-0
                       active:scale-[0.97] ${
              selectedHouse === house.houseId
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 shadow-sm'
            }`}
          >
            <span className="text-base">🏠</span>
            <span>{house.name}</span>
            <span className={`text-xs px-1.5 py-0.5 rounded-md ${
              selectedHouse === house.houseId 
                ? 'bg-white/20' 
                : 'bg-gray-100'
            }`}>
              {house.sensors?.length || 0}
            </span>
          </button>
        ))}
      </div>

      {/* 분석 뷰 */}
      {viewMode === 'analytics' && (
        <div className="animate-fade-in-up">
          <AnalyticsDashboard farmId={farmId} houseId={selectedHouse} />
        </div>
      )}

      {/* 제어 뷰 */}
      {viewMode === 'control' && (
        <div className="space-y-5 animate-fade-in-up">
          <ControlPanel
            farmId={farmId}
            houseId={selectedHouse}
            houseConfig={currentHouse}
          />
          <SystemStatusWidget
            config={currentHouse}
            latestData={latestData}
            alerts={alerts}
          />
        </div>
      )}

      {/* 개요 뷰 */}
      {viewMode === 'overview' && (
        <div className="space-y-5">
          <div className="animate-fade-in-up stagger-1">
            <TodaySummaryWidget farmId={farmId} houseId={selectedHouse} />
          </div>

          <div className="animate-fade-in-up stagger-2">
            <SystemStatusWidget
              config={currentHouse}
              latestData={latestData}
              alerts={alerts}
            />
          </div>

          <div className="animate-fade-in-up stagger-2">
            <ControlPanel
              farmId={farmId}
              houseId={selectedHouse}
              houseConfig={currentHouse}
            />
          </div>

          <div className="animate-fade-in-up stagger-3">
            <SensorChart
              farmId={farmId}
              houseId={selectedHouse}
              config={currentHouse}
            />
          </div>

          <div className="animate-fade-in-up stagger-4">
            <GaugeWidget
              sensors={sensors}
              latestData={latestData}
            />
          </div>

          <div className="animate-fade-in-up">
            <StatsWidget
              sensors={sensors}
              latestData={latestData}
              historyData={historyData}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default DynamicDashboard;
