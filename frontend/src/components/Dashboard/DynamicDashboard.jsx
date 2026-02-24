import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import axios from 'axios';
import StatsWidget from './StatsWidget';
import GaugeWidget from './GaugeWidget';
import SystemStatusWidget from './SystemStatusWidget';
import TodaySummaryWidget from './TodaySummaryWidget';
import SensorChart from './SensorChart';
import { getApiBase, getSystemMode, setManualMode, onModeChange, getServerTimeoutSec, getConfigCache, setConfigCache } from '../../services/apiSwitcher';

/** 하우스 탭 가로 스크롤 (좌/우 화살표 + 균등 버튼 크기) */
const GAP = 8;
const MAX_VISIBLE = 6; // 한 화면에 보이는 최대 버튼 수

const HouseTabScroller = ({ houses, selectedHouse, onSelect, headerState, theme = 'dark' }) => {
  const isLight = theme === 'light';
  const scrollRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [btnWidth, setBtnWidth] = useState(0);

  const visibleCount = Math.min(houses.length, MAX_VISIBLE);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  // 컨테이너 크기 변화에 따라 버튼 너비 재계산
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !houses.length) return;
    const calc = () => {
      const available = el.clientWidth;
      const w = (available - (visibleCount - 1) * GAP) / visibleCount;
      setBtnWidth(Math.floor(w));
      checkScroll();
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [houses, visibleCount, checkScroll]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.addEventListener('scroll', checkScroll, { passive: true });
    return () => { if (el) el.removeEventListener('scroll', checkScroll); };
  }, [checkScroll]);

  const scroll = (dir) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * (btnWidth + GAP), behavior: 'smooth' });
  };

  const chevronBox = (visible) => ({
    width: 44, height: 44, borderRadius: 12, flexShrink: 0,
    background: isLight ? '#2563eb' : 'rgba(255,255,255,0.35)',
    backdropFilter: isLight ? 'none' : 'blur(8px)',
    border: isLight ? 'none' : '1.5px solid rgba(255,255,255,0.5)',
    color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: isLight ? '0 2px 8px rgba(37,99,235,0.35)' : '0 2px 10px rgba(0,0,0,0.3)',
    cursor: visible ? 'pointer' : 'default',
    opacity: visible ? 1 : 0.25, pointerEvents: visible ? 'auto' : 'none',
    transition: 'all 0.2s',
    marginTop: -2,
  });

  const btnBase = (isSelected) => ({
    width: btnWidth || 'auto',
    minWidth: 0,
    padding: '10px 8px',
    borderRadius: 12,
    fontSize: 14,
    fontWeight: isSelected ? 800 : 600,
    border: isSelected
      ? (isLight ? 'none' : 'none')
      : (isLight ? '1px solid #d1d5db' : '1.5px solid rgba(255,255,255,0.25)'),
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    boxShadow: isSelected
      ? (isLight ? '0 2px 8px rgba(37,99,235,0.25)' : '0 2px 10px rgba(0,0,0,0.15)')
      : (isLight ? '0 1px 2px rgba(0,0,0,0.05)' : 'none'),
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    flexShrink: 0,
    scrollSnapAlign: 'start',
    background: isSelected
      ? (isLight ? '#2563eb' : '#fff')
      : (isLight ? '#fff' : 'rgba(255,255,255,0.15)'),
    color: isSelected
      ? (isLight ? '#fff' : (headerState === 'farm-local' ? '#065f46' : headerState === 'online' || headerState === 'control' ? '#1e40af' : headerState === 'manual' ? '#b45309' : '#991b1b'))
      : (isLight ? '#4b5563' : '#fff'),
  });

  const badgeStyle = (isSelected) => ({
    background: isSelected
      ? (isLight ? 'rgba(255,255,255,0.25)' : (headerState === 'farm-local' ? '#d1fae5' : headerState === 'online' || headerState === 'control' ? '#dbeafe' : headerState === 'manual' ? '#fef3c7' : '#fee2e2'))
      : (isLight ? '#f3f4f6' : 'rgba(255,255,255,0.2)'),
    color: isSelected
      ? (isLight ? '#fff' : (headerState === 'farm-local' ? '#065f46' : headerState === 'online' || headerState === 'control' ? '#1e40af' : headerState === 'manual' ? '#b45309' : '#991b1b'))
      : (isLight ? '#6b7280' : undefined),
    fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 8, flexShrink: 0,
  });

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 16 }}>
      <div onClick={() => scroll(-1)} style={chevronBox(canScrollLeft)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </div>

      <div
        ref={scrollRef}
        style={{ flex: 1, minWidth: 0, overflowX: 'auto', scrollbarWidth: 'none', display: 'flex', gap: GAP, scrollSnapType: 'x mandatory' }}
      >
        {houses.map((house) => (
          <button key={house.houseId} onClick={() => onSelect(house.houseId)} style={btnBase(selectedHouse === house.houseId)}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{house.name}</span>
            <span style={badgeStyle(selectedHouse === house.houseId)}>{house.sensors?.length || 0}</span>
          </button>
        ))}
      </div>

      <div onClick={() => scroll(1)} style={chevronBox(canScrollRight)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>
  );
};

const DynamicDashboard = ({ farmId }) => {
  const [config, setConfig] = useState(null);
  const [selectedHouse, setSelectedHouse] = useState(null);
  const [latestData, setLatestData] = useState({});
  const [historyData, setHistoryData] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [dataVersion, setDataVersion] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [systemMode, setSystemMode] = useState(getSystemMode());
  const [showTimeoutBanner, setShowTimeoutBanner] = useState(false);
  const [downElapsed, setDownElapsed] = useState(0); // 다운 경과 시간 (초)
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const intervalRef = useRef(null);
  const bannerTimerRef = useRef(null);
  const abortRef = useRef(null); // API 요청 취소용

  // API 전환 모드 감지 + 서버 복구 시 config 재조회
  useEffect(() => {
    let prevOnline = systemMode.serverOnline;
    const unsubscribe = onModeChange((mode) => {
      console.log('[Dashboard] onModeChange:', { serverOnline: mode.serverOnline, downSince: mode.downSince, manualOverride: mode.manualOverride });
      setSystemMode(mode);
      // 서버 복구 감지 → config 재조회 + 배너 리셋
      if (mode.serverOnline && !mode.manualOverride && !prevOnline) {
        console.log('[Dashboard] 서버 복구 감지 → config 재조회');
        loadConfig();
        setBannerDismissed(false);
      }
      prevOnline = mode.serverOnline;
    });
    return unsubscribe;
  }, []);

  // 서버 다운 타임아웃 배너 타이머
  // React state에 의존하지 않고 getSystemMode()를 직접 polling하여 HMR/리스너 유실 문제 방지
  const prevModeRef = useRef(null);
  useEffect(() => {
    const tick = () => {
      const mode = getSystemMode();

      // systemMode도 함께 동기화 (리스너 유실 대비 — 헤더 색상/상태 뱃지 갱신)
      if (!prevModeRef.current ||
          prevModeRef.current.serverOnline !== mode.serverOnline ||
          prevModeRef.current.manualOverride !== mode.manualOverride ||
          prevModeRef.current.mode !== mode.mode) {
        setSystemMode(mode);
        prevModeRef.current = mode;
      }

      if (mode.downSince && !mode.serverOnline && !mode.manualOverride) {
        const elapsed = Math.floor((Date.now() - new Date(mode.downSince).getTime()) / 1000);
        setDownElapsed(elapsed);
        setShowTimeoutBanner(elapsed >= getServerTimeoutSec());
      } else {
        setShowTimeoutBanner(false);
        setDownElapsed(0);
      }
    };
    tick();
    bannerTimerRef.current = setInterval(tick, 1000);
    return () => { if (bannerTimerRef.current) clearInterval(bannerTimerRef.current); };
  }, []);

  // localStorage에서 폴링 주기 읽기 (기본 10초)
  const getPollingInterval = () => {
    try {
      const val = parseInt(localStorage.getItem('smartfarm_pollingInterval'));
      if (!isNaN(val) && val >= 3) return val * 1000;
    } catch {}
    return 10000;
  };

  // 캐시에서 config 복원 시도 (TTL 지원)
  const tryLoadFromCache = () => {
    const { data: cachedData } = getConfigCache(farmId);
    if (cachedData) {
      console.log('[Dashboard] 캐시된 설정 사용');
      setConfig(cachedData);
      if (cachedData.houses && cachedData.houses.length > 0) {
        setSelectedHouse(cachedData.houses[0].houseId);
      }
      return true;
    }
    return false;
  };

  const fetchConfigFromServer = async (showLoadingState) => {
    const API_BASE_URL = getApiBase();
    try {
      const response = await axios.get(`${API_BASE_URL}/config/${farmId}`, { timeout: 8000 });
      if (response.data.success && response.data.data) {
        const configData = response.data.data;
        setConfig(configData);
        if (configData.houses && configData.houses.length > 0) {
          setConfigCache(farmId, configData);
          setSelectedHouse(prev => prev || configData.houses[0].houseId);
        } else {
          if (!tryLoadFromCache()) {
            // 캐시도 없으면 서버 데이터 그대로 사용
          }
        }
      } else {
        console.warn('[Dashboard] API 응답 실패 → 캐시 시도');
        if (!tryLoadFromCache() && showLoadingState) {
          setLoadError('network');
        }
      }
    } catch (error) {
      console.error('설정 로드 실패:', error);
      const status = error.response?.status;
      if (status === 401) {
        if (showLoadingState) setLoadError('auth');
      } else if (status === 403) {
        if (showLoadingState) setLoadError('forbidden');
      } else {
        if (!tryLoadFromCache() && showLoadingState) {
          setLoadError('network');
        }
      }
    } finally {
      if (showLoadingState) setLoading(false);
    }
  };

  const loadConfig = async () => {
    setLoadError(null);

    // 팜로컬 모드: Node-RED Config API 사용 (클라우드 모드와 동일 방식)
    if (getSystemMode().isFarmLocal) {
      const { data: cached, fresh } = getConfigCache(farmId);
      if (cached && fresh) {
        setConfig(cached);
        if (cached.houses?.length > 0) setSelectedHouse(cached.houses[0].houseId);
        setLoading(false);
        fetchConfigFromServer(false);
        return;
      }
      if (cached) {
        setConfig(cached);
        if (cached.houses?.length > 0) setSelectedHouse(cached.houses[0].houseId);
        setLoading(false);
      }
      await fetchConfigFromServer(!cached);
      return;
    }

    // Cache-first: TTL 유효하면 캐시 즉시 사용 + 백그라운드 갱신
    const { data: cached, fresh } = getConfigCache(farmId);
    if (cached && fresh) {
      setConfig(cached);
      if (cached.houses?.length > 0) setSelectedHouse(cached.houses[0].houseId);
      setLoading(false);
      // 백그라운드에서 서버 최신 데이터 갱신 (UI 블로킹 없음)
      fetchConfigFromServer(true);
      return;
    }

    // 캐시 만료 또는 없음 → 서버에서 가져오기 (stale 캐시 폴백)
    if (cached) {
      setConfig(cached);
      if (cached.houses?.length > 0) setSelectedHouse(cached.houses[0].houseId);
      setLoading(false);
    }
    await fetchConfigFromServer(!cached);
  };

  const loadLatestData = useCallback(async () => {
    if (!selectedHouse) return;

    // 이전 요청 취소 (하우스 전환 시 레이스 컨디션 방지)
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const API_BASE_URL = getApiBase();
    const now = new Date();
    const yesterday = new Date(now.getTime() - 86400000);

    try {
      const [latestRes, historyRes, alertsRes] = await Promise.allSettled([
        axios.get(`${API_BASE_URL}/sensors/latest/${farmId}/${selectedHouse}`, { timeout: 5000, signal: controller.signal }),
        axios.get(`${API_BASE_URL}/sensors/${farmId}/${selectedHouse}/history`, {
          params: { startDate: yesterday.toISOString(), endDate: now.toISOString() },
          timeout: 5000, signal: controller.signal,
        }),
        axios.get(`${API_BASE_URL}/alerts/${farmId}?houseId=${selectedHouse}`, { timeout: 5000, signal: controller.signal }),
      ]);

      // 취소된 요청의 응답은 무시
      if (controller.signal.aborted) return;

      if (latestRes.status === 'fulfilled' && latestRes.value.data.success) {
        setLatestData(latestRes.value.data.data || {});
      }
      if (historyRes.status === 'fulfilled' && historyRes.value.data.success) {
        setHistoryData(historyRes.value.data.data || []);
      }
      if (alertsRes.status === 'fulfilled' && alertsRes.value.data.success) {
        setAlerts(alertsRes.value.data.data || []);
      }

      setLastUpdated(new Date());
      setDataVersion(prev => prev + 1);
    } catch (e) {
      if (e.name !== 'CanceledError' && e.name !== 'AbortError') {
        console.error('[Dashboard] loadLatestData error:', e.message);
      }
    }
  }, [farmId, selectedHouse]);

  // useMemo는 early return 위에 배치 (React 훅 규칙: 항상 동일 순서로 호출)
  const currentHouse = useMemo(() => config?.houses?.find(h => h.houseId === selectedHouse) || null, [config, selectedHouse]);
  const sensors = useMemo(() => currentHouse?.sensors || [], [currentHouse]);

  useEffect(() => {
    loadConfig();
  }, [farmId]);

  useEffect(() => {
    if (selectedHouse) {
      const pollingMs = getPollingInterval();
      loadLatestData();
      intervalRef.current = setInterval(loadLatestData, pollingMs);

      const handleVisibility = () => {
        if (document.hidden) {
          clearInterval(intervalRef.current);
        } else {
          const ms = getPollingInterval();
          loadLatestData();
          intervalRef.current = setInterval(loadLatestData, ms);
        }
      };
      document.addEventListener('visibilitychange', handleVisibility);

      return () => {
        clearInterval(intervalRef.current);
        document.removeEventListener('visibilitychange', handleVisibility);
        if (abortRef.current) abortRef.current.abort(); // 언마운트 시 진행중 요청 취소
      };
    }
  }, [selectedHouse, loadLatestData]);

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

  // 헤더 상태 결정
  const isFarmLocal = systemMode.isFarmLocal || systemMode.mode === 'farm-local';
  const isChecking = !isFarmLocal && !systemMode.serverOnline && !systemMode.manualOverride && !showTimeoutBanner && downElapsed > 0;
  const isDisconnected = !isFarmLocal && showTimeoutBanner && !systemMode.manualOverride;
  const headerState = isFarmLocal ? 'farm-local'
    : systemMode.manualOverride ? 'manual'
    : isDisconnected ? 'disconnected' : 'online';

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6 space-y-5">
      {/* 헤더 */}
      <div className="animate-fade-in-up" style={{
        background: headerState === 'farm-local'
          ? 'linear-gradient(135deg, #065f46 0%, #059669 100%)'
          : headerState === 'online'
            ? 'linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)'
            : headerState === 'manual'
              ? 'linear-gradient(135deg, #b45309 0%, #d97706 100%)'
              : 'linear-gradient(135deg, #991b1b 0%, #dc2626 100%)',
        borderRadius:18,padding:'20px 24px',
        boxShadow: headerState === 'farm-local'
          ? '0 4px 20px rgba(5,150,105,0.25)'
          : headerState === 'online'
            ? '0 4px 20px rgba(30,64,175,0.25)'
            : headerState === 'manual'
              ? '0 4px 20px rgba(180,83,9,0.25)'
              : '0 4px 20px rgba(153,27,27,0.25)',
        transition:'background 0.5s, box-shadow 0.5s'
      }}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div style={{display:'flex',alignItems:'center',gap:10}}>
              <h1 style={{fontSize:24,fontWeight:900,color:'#fff',letterSpacing:'-0.02em'}}>
                대시보드
              </h1>
              <span style={{
                fontSize:12,fontWeight:800,
                color:'#fff',
                background: isChecking
                  ? 'rgba(251,191,36,0.3)' : headerState === 'online'
                    ? 'rgba(74,222,128,0.25)' : headerState === 'manual'
                      ? 'rgba(255,255,255,0.2)' : 'rgba(255,100,100,0.3)',
                padding:'4px 12px',borderRadius:8,
                border:'1px solid rgba(255,255,255,0.3)',
                display:'flex',alignItems:'center',gap:6
              }}>
                <span style={{
                  width:8,height:8,borderRadius:'50%',display:'inline-block',
                  background: isChecking ? '#fbbf24' : headerState === 'online' ? '#4ade80' : headerState === 'manual' ? '#fbbf24' : '#fca5a5',
                  boxShadow: isChecking
                    ? '0 0 6px #fbbf24' : headerState === 'online'
                      ? '0 0 6px #4ade80' : headerState === 'manual'
                        ? '0 0 6px #fbbf24' : '0 0 6px #fca5a5',
                  animation: 'pulse 2s infinite'
                }}/>
                {isFarmLocal ? '팜로컬 운영' : isChecking ? `연결 확인 중 (${downElapsed}초)` : headerState === 'online' ? '서버 연결' : headerState === 'manual' ? '로컬 운영' : '연결 끊김'}
              </span>
            </div>
            <p style={{color:'rgba(255,255,255,0.7)',fontSize:13,marginTop:4}}>
              {isFarmLocal
                ? '독립 운영 모드 · 로컬 센서 데이터'
                : isChecking
                  ? '서버 연결을 확인하고 있습니다...'
                  : headerState === 'online'
                    ? '실시간 센서 모니터링'
                    : headerState === 'manual'
                      ? '로컬 데이터로 운영 중 · 서버 복구 시 자동 동기화'
                      : '서버 연결이 끊겼습니다 · 로컬 운영으로 전환하세요'}
            </p>
          </div>
          <div style={{textAlign:'right'}}>
            <div style={{display:'flex',alignItems:'center',gap:8,justifyContent:'flex-end',marginBottom:6}}>
              {!isFarmLocal && <button
                onClick={() => setManualMode(!systemMode.manualOverride)}
                style={{
                  fontSize:14,fontWeight:800,
                  color:'#fff',
                  background: systemMode.manualOverride ? 'rgba(251,191,36,0.35)' : 'rgba(255,255,255,0.15)',
                  border:'2px solid rgba(255,255,255,0.4)',
                  padding:'8px 18px',borderRadius:10,cursor:'pointer',
                  transition:'all 0.2s',
                  boxShadow:'0 2px 8px rgba(0,0,0,0.1)'
                }}
                title={systemMode.manualOverride ? '클라우드 모드로 전환' : '로컬(오프라인) 모드로 전환'}
              >
                {systemMode.manualOverride ? '🔄 클라우드 전환' : '🔧 로컬 전환'}
              </button>}
            </div>
            <div style={{color:'rgba(255,255,255,0.8)',fontSize:15,fontWeight:700}}>
              {new Date().toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric', weekday:'short' })}
            </div>
            {lastUpdated && (
              <div style={{color:'rgba(255,255,255,0.65)',fontSize:14,fontWeight:600,marginTop:3,display:'flex',alignItems:'center',gap:6,justifyContent:'flex-end'}}>
                <span style={{width:10,height:10,borderRadius:'50%',background: isChecking ? '#fbbf24' : headerState === 'online' ? '#4ade80' : headerState === 'manual' ? '#fbbf24' : '#fca5a5',display:'inline-block',animation:'pulse 2s infinite',boxShadow: isChecking ? '0 0 8px #fbbf24' : headerState === 'online' ? '0 0 8px #4ade80' : headerState === 'manual' ? '0 0 8px #fbbf24' : '0 0 8px #fca5a5',flexShrink:0}}/>
                {lastUpdated.toLocaleTimeString('ko-KR')} 업데이트
                {systemMode.manualOverride && <span style={{fontSize:12,opacity:0.8}}> (로컬)</span>}
              </div>
            )}
          </div>
        </div>

        {/* 하우스 선택 탭 - 스크롤 가능 */}
        <HouseTabScroller
          houses={config.houses}
          selectedHouse={selectedHouse}
          onSelect={setSelectedHouse}
          headerState={headerState}
        />
      </div>

      {/* 서버 연결 타임아웃 경고 배너 (팜로컬에서는 숨김) */}
      {showTimeoutBanner && !bannerDismissed && !systemMode.manualOverride && !isFarmLocal && (
        <div className="animate-fade-in-up" style={{
          background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
          borderRadius: 14,
          padding: '16px 20px',
          boxShadow: '0 4px 15px rgba(220,38,38,0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 200 }}>
            <span style={{ fontSize: 28, animation: 'pulse 1.5s infinite' }}>⚠️</span>
            <div>
              <p style={{ color: '#fff', fontWeight: 800, fontSize: 15 }}>
                서버 연결이 안됩니다
                <span style={{
                  marginLeft: 8, fontSize: 13, fontWeight: 600,
                  background: 'rgba(255,255,255,0.2)', padding: '2px 10px',
                  borderRadius: 6
                }}>
                  {downElapsed >= 3600
                    ? `${Math.floor(downElapsed / 3600)}시간 ${Math.floor((downElapsed % 3600) / 60)}분 경과`
                    : downElapsed >= 60
                      ? `${Math.floor(downElapsed / 60)}분 ${downElapsed % 60}초 경과`
                      : `${downElapsed}초 경과`}
                </span>
              </p>
              <p style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 2 }}>
                로컬운영으로 변경하세요
              </p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setManualMode(true)}
              style={{
                background: '#fff', color: '#dc2626',
                fontWeight: 800, fontSize: 13,
                padding: '8px 18px', borderRadius: 10,
                border: 'none', cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                transition: 'transform 0.15s',
              }}
              onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.95)'}
              onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
            >
              로컬 운영 전환
            </button>
            <button
              onClick={() => setBannerDismissed(true)}
              style={{
                background: 'rgba(255,255,255,0.2)',
                color: '#fff', fontWeight: 700, fontSize: 16,
                width: 32, height: 32, borderRadius: 8,
                border: '1.5px solid rgba(255,255,255,0.3)',
                cursor: 'pointer', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
              }}
              title="알림 닫기"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* 개요 뷰 */}
      {(
        <div className="space-y-5">
          <div className="animate-fade-in-up stagger-1">
            <TodaySummaryWidget farmId={farmId} houseId={selectedHouse} alerts={alerts} dataVersion={dataVersion} />
          </div>

          <div className="animate-fade-in-up stagger-2">
            <SystemStatusWidget
              config={currentHouse}
              latestData={latestData}
              alerts={alerts}
            />
          </div>

          <div className="animate-fade-in-up stagger-3">
            <SensorChart
              farmId={farmId}
              houseId={selectedHouse}
              config={currentHouse}
              dataVersion={dataVersion}
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
export { HouseTabScroller };
