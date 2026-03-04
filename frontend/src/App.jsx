import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './components/Auth/LoginPage';
import DynamicDashboard, { HouseTabScroller } from './components/Dashboard/DynamicDashboard';
import ConfigurationManager from './components/Settings/ConfigurationManager';
import ControlPanel from './components/Dashboard/ControlPanel';
import ControlHistory from './components/Dashboard/ControlHistory';
import UserManager from './components/Auth/UserManager';
import AlertPanel from './components/Dashboard/AlertPanel';
import JournalManager from './components/Journal/JournalManager';
import AIManager from './components/AI/AIManager';
import ServerStatus from './components/Dashboard/ServerStatus';
import FarmSelector from './components/Dashboard/FarmSelector';
import FarmManager from './components/Settings/FarmManager';
import FarmOverviewWidget from './components/Dashboard/FarmOverviewWidget';
import ReportPage from './components/Dashboard/ReportPage';
import { getApiBase, isFarmLocalMode } from './services/apiSwitcher';

/**
 * Error Boundary — 컴포넌트 렌더 에러 시 하얀 화면 방지
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: 24 }}>
          <div style={{ textAlign: 'center', maxWidth: 400 }}>
            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.5 }}>⚠️</div>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: '#1e293b', marginBottom: 8 }}>화면 표시 오류</h2>
            <p style={{ fontSize: 14, color: '#64748b', marginBottom: 20, lineHeight: 1.6 }}>
              일시적인 오류가 발생했습니다.<br />
              아래 버튼을 눌러 페이지를 새로고침 해주세요.
            </p>
            <p style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16, fontFamily: 'monospace', background: '#f1f5f9', padding: '8px 12px', borderRadius: 8, wordBreak: 'break-all' }}>
              {this.state.error?.message || '알 수 없는 오류'}
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{ padding: '12px 32px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: 'pointer' }}
            >
              새로고침
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * 제어 페이지 - config에서 하우스별 deviceCount를 로드
 */
const ControlPage = ({ farmId }) => {
  const [config, setConfig] = useState(null);
  const [selectedHouse, setSelectedHouse] = useState(null);
  const [loading, setLoading] = useState(true);

  const applyConfig = (configData) => {
    setConfig(configData);
    const housesWithDevices = configData.houses?.filter(h => h.deviceCount > 0);
    if (housesWithDevices?.length > 0) {
      setSelectedHouse(housesWithDevices[0]);
    } else if (configData.houses?.length > 0) {
      setSelectedHouse(configData.houses[0]);
    }
  };

  useEffect(() => {
    const loadConfig = async () => {
      const API_BASE_URL = getApiBase();
      try {
        const response = await axios.get(`${API_BASE_URL}/config/${farmId}`, { timeout: 8000 });
        if (response.data.success && response.data.data) {
          applyConfig(response.data.data);
        } else {
          // API 응답이 비어있으면 캐시 시도
          const cached = localStorage.getItem(`cachedConfig_${farmId}`);
          if (cached) {
            console.log('[ControlPage] API 응답 비어있음 → 캐시 사용');
            applyConfig(JSON.parse(cached));
          }
        }
      } catch (error) {
        console.error('설정 로드 실패:', error);
        // 네트워크 오류 → 캐시된 config 사용
        try {
          const cached = localStorage.getItem(`cachedConfig_${farmId}`);
          if (cached) {
            console.log('[ControlPage] 오프라인 → 캐시된 설정 사용');
            applyConfig(JSON.parse(cached));
          }
        } catch {}
      } finally {
        setLoading(false);
      }
    };
    loadConfig();
  }, [farmId]);

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">
        <div className="flex items-center justify-center py-20">
          <div className="w-10 h-10 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  if (!config || !config.houses || config.houses.length === 0) {
    return (
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">
        <div className="glass-card p-12 text-center">
          <div className="text-4xl mb-4 opacity-30">🎛️</div>
          <p className="text-gray-500 text-base">하우스가 없습니다. 설정에서 하우스를 추가하세요.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6">
      <div className="mb-5">
        <h1 className="text-2xl md:text-2xl font-bold text-gray-800 tracking-tight">개폐기 제어</h1>
        <p className="text-gray-500 text-sm md:text-base mt-0.5">시설하우스 창문 원격 제어</p>
      </div>

      {/* 하우스 선택 */}
      <div className="mb-5">
        <HouseTabScroller
          houses={config.houses.map(h => ({ ...h, name: h.houseName || h.name }))}
          selectedHouse={selectedHouse?.houseId}
          onSelect={(id) => setSelectedHouse(config.houses.find(h => h.houseId === id))}
          headerState="control"
          theme="light"
        />
      </div>

      {selectedHouse && (
        <ControlPanel
          farmId={farmId}
          houseId={selectedHouse.houseId}
          houseConfig={selectedHouse}
        />
      )}
    </div>
  );
};

function AppContent() {
  const { user, logout, hasPermission, roleLabel, loading: authLoading, needsSetup, farms, selectedFarmId, selectedFarmInfo, selectFarm, isSystemWide } = useAuth();
  const getPageFromHash = () => {
    const hash = window.location.hash.replace('#', '');
    return hash || 'dashboard';
  };
  const [currentPage, setCurrentPageState] = useState(getPageFromHash);

  const scrollPositions = useRef({});
  const setCurrentPage = (page) => {
    // 현재 페이지 스크롤 위치 저장
    scrollPositions.current[currentPage] = window.scrollY;
    window.location.hash = page;
    setCurrentPageState(page);
    // 다음 프레임에서 저장된 위치로 복원
    requestAnimationFrame(() => {
      window.scrollTo(0, scrollPositions.current[page] || 0);
    });
  };

  useEffect(() => {
    const onHashChange = () => {
      scrollPositions.current[currentPage] = window.scrollY;
      const next = getPageFromHash();
      setCurrentPageState(next);
      requestAnimationFrame(() => {
        window.scrollTo(0, scrollPositions.current[next] || 0);
      });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [currentPage]);
  const farmId = selectedFarmId || (isSystemWide ? null : user?.farmId) || import.meta.env.VITE_FARM_ID || 'farm_0001';
  const needsFarmSelect = isSystemWide && !selectedFarmId;
  const [showAlertPanel, setShowAlertPanel] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      if (!localStorage.getItem('pwa-install-dismissed')) {
        setShowInstallBanner(true);
      }
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const VALID_PAGES = ['dashboard','control','history','journal','report','ai','farms','server','settings','users'];
  useEffect(() => {
    if (!user) return;
    // 유효하지 않은 페이지 → 대시보드로 리다이렉트
    if (!VALID_PAGES.includes(currentPage)) {
      setCurrentPage('dashboard');
      return;
    }
    // 권한 없는 페이지 → 대시보드로 리다이렉트
    if (currentPage !== 'dashboard' && !hasPermission(currentPage)) {
      setCurrentPage('dashboard');
    }
  }, [user, currentPage]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-mesh flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500 text-base">로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!user || needsSetup) {
    return <LoginPage />;
  }

  const handleInstallPWA = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') setShowInstallBanner(false);
    setDeferredPrompt(null);
  };

  const dismissInstallBanner = () => {
    setShowInstallBanner(false);
    localStorage.setItem('pwa-install-dismissed', 'true');
  };

  const farmLocal = isFarmLocalMode();

  const allNavItems = farmLocal
    ? [
        { id: 'dashboard', label: '대시보드', icon: '📊', permission: 'dashboard' },
        { id: 'control', label: '제어', icon: '🎛️', permission: 'control' },
        { id: 'journal', label: '영농일지', icon: '📝', permission: 'journal' },
        { id: 'report', label: '보고서', icon: '📄', permission: 'report' },
        { id: 'ai', label: 'AI도우미', icon: '🤖', permission: 'ai' },
        { id: 'settings', label: '설정', icon: '⚙️', permission: 'settings' },
      ]
    : [
        { id: 'farms', label: '농장관리', icon: '🏭', permission: 'farms' },
        { id: 'dashboard', label: '대시보드', icon: '📊', permission: 'dashboard' },
        { id: 'control', label: '제어', icon: '🎛️', permission: 'control' },
        { id: 'journal', label: '영농일지', icon: '📝', permission: 'journal' },
        { id: 'report', label: '보고서', icon: '📄', permission: 'report' },
        { id: 'ai', label: 'AI도우미', icon: '🤖', permission: 'ai' },
        { id: 'server', label: '서버', icon: '🖥️', permission: 'server' },
        { id: 'settings', label: '설정', icon: '⚙️', permission: 'settings' },
      ];
  const navItems = allNavItems.filter(item => hasPermission(item.permission));

  // 역할별 2줄 네비 그리드 계산
  const isStaff = isSystemWide; // superadmin, manager
  const navGrid = (() => {
    if (farmLocal) return null; // farmLocal은 기존 유지
    if (isStaff) {
      // 회사직원: 5열, row1=nav앞5개, row2=나머지nav+알림+관리자
      const row1 = navItems.slice(0, 5);
      const row2 = [
        ...navItems.slice(5),
        { id: '__alert__', type: 'alert' },
        { id: '__user__', type: 'user' },
      ];
      return { row1, row2, columns: 5 };
    } else {
      // 농장사람: 4열, row1=로고+nav앞3개, row2=나머지nav+알림+관리자
      const row1 = [
        { id: '__logo__', type: 'logo' },
        ...navItems.slice(0, 3),
      ];
      const row2 = [
        ...navItems.slice(3),
        { id: '__alert__', type: 'alert' },
        { id: '__user__', type: 'user' },
      ];
      return { row1, row2, columns: 4 };
    }
  })();

  // 그리드 셀 렌더링
  const renderNavCell = (cell, isMobile = false) => {
    const btnBase = isMobile
      ? 'py-1.5 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1 whitespace-nowrap w-full'
      : 'py-2 rounded-xl text-sm font-medium transition-all duration-200 flex items-center justify-center gap-1 whitespace-nowrap w-full';

    if (cell.type === 'logo') {
      return (
        <div key="__logo__" className={`${btnBase} h-full gap-1.5`}>
          <div className={`${isMobile ? 'w-5 h-5 text-xs' : 'w-7 h-7 text-sm'} bg-gradient-to-br from-emerald-400 to-blue-500 rounded-lg flex items-center justify-center shadow-lg shadow-emerald-500/20`}>
            🌱
          </div>
          <span className={`${isMobile ? 'text-xs' : 'text-sm'} font-bold text-gray-800`}>SmartFarm</span>
        </div>
      );
    }

    if (cell.type === 'alert') {
      return (
        <div key="__alert__" className="relative h-full">
          <AlertPanel farmId={farmId} showPanel={showAlertPanel} setShowPanel={setShowAlertPanel} isMobile={isMobile} fullWidth={true} />
        </div>
      );
    }

    if (cell.type === 'user') {
      return (
        <div key="__user__" className="relative h-full">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            className={`${btnBase} h-full ${showUserMenu ? 'tab-active' : 'tab-inactive'}`}
          >
            <span className={`${isMobile ? 'w-5 h-5 text-[10px]' : 'w-6 h-6 text-xs'} bg-gradient-to-br from-blue-400 to-violet-500 rounded-lg flex items-center justify-center text-white font-bold flex-shrink-0`}>
              {user.name?.charAt(0) || '?'}
            </span>
            관리자
          </button>
          {showUserMenu && (
            <>
              <div className="fixed inset-0 z-[90]" onClick={() => setShowUserMenu(false)} />
              <div className={`absolute right-0 ${isMobile ? 'top-9 w-44' : 'top-12 w-52'} bg-white border border-gray-200 rounded-2xl p-2 z-[100] animate-fade-in-up shadow-xl`}>
                <div className="px-3 py-2 border-b border-gray-100 mb-1">
                  <p className="text-sm font-semibold text-gray-800">{user.name}</p>
                  <p className="text-xs text-gray-500">{user.username} · {roleLabel}</p>
                </div>
                {hasPermission('users') && (
                  <button onClick={() => { setCurrentPage('users'); setShowUserMenu(false); }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-all">
                    👥 사용자 관리
                  </button>
                )}
                <button onClick={() => { logout(); setShowUserMenu(false); }}
                  className="w-full text-left px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 rounded-lg transition-all">
                  🚪 로그아웃
                </button>
              </div>
            </>
          )}
        </div>
      );
    }

    // 일반 네비 버튼
    return (
      <button key={cell.id} onClick={() => setCurrentPage(cell.id)}
        className={`${btnBase} ${currentPage === cell.id ? 'tab-active' : 'tab-inactive'}`}>
        <span>{cell.icon}</span>
        {cell.label}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-mesh safe-top">
      {/* PWA 설치 배너 (팜로컬에서는 숨김) */}
      {showInstallBanner && !farmLocal && (
        <div className="fixed top-0 left-0 right-0 z-[60] bg-gradient-to-r from-blue-600 to-violet-600 px-4 py-3 animate-fade-in-up">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🌱</span>
              <div>
                <p className="text-white font-semibold text-base">SmartFarm 앱 설치</p>
                <p className="text-blue-100 text-sm">홈 화면에 추가하여 앱처럼 사용하세요</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleInstallPWA}
                className="px-4 py-1.5 bg-white text-blue-600 rounded-lg font-bold text-base
                         hover:bg-blue-50 transition-all active:scale-95"
              >
                설치
              </button>
              <button
                onClick={dismissInstallBanner}
                className="px-3 py-1.5 bg-white/20 text-white rounded-lg text-base
                         hover:bg-white/30 transition-all"
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 데스크톱 네비게이션 */}
      <nav className="hidden md:block glass-nav sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 lg:px-6 py-1.5">
          {navGrid ? (
            <>
              {/* 회사직원: 로고바 */}
              {isStaff && (
                <div className="flex items-center gap-2 pb-1.5 mb-1 border-b border-gray-100">
                  <div className="w-7 h-7 bg-gradient-to-br from-emerald-400 to-blue-500 rounded-lg flex items-center justify-center text-sm shadow-lg shadow-emerald-500/20">🌱</div>
                  <span className="text-base font-bold text-gray-800">SmartFarm</span>
                  {farms.length > 1 && (
                    <FarmSelector farms={farms} selectedFarmId={selectedFarmId} onSelect={selectFarm} />
                  )}
                </div>
              )}
              {/* 2줄 그리드 */}
              <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: `repeat(${navGrid.columns}, 1fr)` }}>
                {navGrid.row1.map(cell => renderNavCell(cell, false))}
              </div>
              <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${navGrid.columns}, 1fr)` }}>
                {navGrid.row2.map(cell => renderNavCell(cell, false))}
              </div>
            </>
          ) : (
            /* farmLocal: 간단한 1줄 */
            <div className="flex items-center justify-between h-14">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gradient-to-br from-emerald-400 to-blue-500 rounded-xl flex items-center justify-center text-base shadow-lg shadow-emerald-500/20">🌱</div>
                <span className="text-lg font-bold text-gray-800">SmartFarm<span className="text-xs text-emerald-600 font-bold ml-1.5 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">팜로컬</span></span>
              </div>
              <div className="flex items-center gap-1">
                {navItems.map(item => (
                  <button key={item.id} onClick={() => setCurrentPage(item.id)}
                    className={`py-2 px-4 rounded-xl text-sm font-medium transition-all flex items-center gap-1 ${currentPage === item.id ? 'tab-active' : 'tab-inactive'}`}>
                    <span>{item.icon}</span>{item.label}
                  </button>
                ))}
                {/* 알림 */}
                <div className="relative">
                  <AlertPanel farmId={farmId} showPanel={showAlertPanel} setShowPanel={setShowAlertPanel} isMobile={false} fullWidth={false} />
                </div>
                {/* 사용자 메뉴 */}
                <div className="relative">
                  <button onClick={() => setShowUserMenu(!showUserMenu)}
                    className={`py-2 px-4 rounded-xl text-sm font-medium transition-all flex items-center gap-1 ${showUserMenu ? 'tab-active' : 'tab-inactive'}`}>
                    <span className="w-6 h-6 text-xs bg-gradient-to-br from-blue-400 to-violet-500 rounded-lg flex items-center justify-center text-white font-bold flex-shrink-0">
                      {user.name?.charAt(0) || '?'}
                    </span>
                    관리자
                  </button>
                  {showUserMenu && (
                    <>
                      <div className="fixed inset-0 z-[90]" onClick={() => setShowUserMenu(false)} />
                      <div className="absolute right-0 top-12 w-52 bg-white border border-gray-200 rounded-2xl p-2 z-[100] animate-fade-in-up shadow-xl">
                        <div className="px-3 py-2 border-b border-gray-100 mb-1">
                          <p className="text-sm font-semibold text-gray-800">{user.name}</p>
                          <p className="text-xs text-gray-500">{user.username} · {roleLabel}</p>
                        </div>
                        <button onClick={() => { logout(); setShowUserMenu(false); }}
                          className="w-full text-left px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-all">
                          ☁️ 클라우드 전환
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* 모바일 상단 헤더 */}
      <header className="md:hidden glass-nav sticky top-0 z-50 safe-top">
        <div className="px-2 py-1.5">
          {navGrid ? (
            <>
              {/* 회사직원: 로고바 */}
              {isStaff && (
                <div className="flex items-center gap-2 pb-1 mb-1 border-b border-gray-100">
                  <div className="w-6 h-6 bg-gradient-to-br from-emerald-400 to-blue-500 rounded-md flex items-center justify-center text-xs shadow-md">🌱</div>
                  <span className="text-xs font-bold text-gray-800">SmartFarm</span>
                </div>
              )}
              {/* 2줄 그리드 */}
              <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: `repeat(${navGrid.columns}, 1fr)` }}>
                {navGrid.row1.map(cell => renderNavCell(cell, true))}
              </div>
              <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${navGrid.columns}, 1fr)` }}>
                {navGrid.row2.map(cell => renderNavCell(cell, true))}
              </div>
            </>
          ) : (
            /* farmLocal: 간단한 레이아웃 */
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-gradient-to-br from-emerald-400 to-blue-500 rounded-lg flex items-center justify-center text-sm shadow-lg shadow-emerald-500/20">🌱</div>
                <span className="text-sm font-bold text-gray-800">SmartFarm<span className="text-[10px] text-emerald-600 font-bold ml-1 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">팜로컬</span></span>
              </div>
              <div className="flex items-center gap-1">
                {navItems.map(item => (
                  <button key={item.id} onClick={() => setCurrentPage(item.id)}
                    className={`py-1.5 px-2.5 rounded-lg text-xs font-bold transition-all ${currentPage === item.id ? 'tab-active' : 'tab-inactive'}`}>
                    <span>{item.icon}</span> {item.label}
                  </button>
                ))}
                {/* 알림 */}
                <div className="relative">
                  <AlertPanel farmId={farmId} showPanel={showAlertPanel} setShowPanel={setShowAlertPanel} isMobile={true} fullWidth={false} />
                </div>
                {/* 사용자 */}
                <div className="relative">
                  <button onClick={() => setShowUserMenu(!showUserMenu)}
                    className={`py-1.5 px-2.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 ${showUserMenu ? 'tab-active' : 'tab-inactive'}`}>
                    <span className="w-5 h-5 text-[10px] bg-gradient-to-br from-blue-400 to-violet-500 rounded-lg flex items-center justify-center text-white font-bold flex-shrink-0">
                      {user.name?.charAt(0) || '?'}
                    </span>
                  </button>
                  {showUserMenu && (
                    <>
                      <div className="fixed inset-0 z-[90]" onClick={() => setShowUserMenu(false)} />
                      <div className="absolute right-0 top-9 w-44 bg-white border border-gray-200 rounded-2xl p-2 z-[100] animate-fade-in-up shadow-xl">
                        <div className="px-3 py-2 border-b border-gray-100 mb-1">
                          <p className="text-sm font-semibold text-gray-800">{user.name}</p>
                          <p className="text-xs text-gray-500">{user.username} · {roleLabel}</p>
                        </div>
                        <button onClick={() => { logout(); setShowUserMenu(false); }}
                          className="w-full text-left px-3 py-2 text-sm text-blue-600 hover:bg-blue-50 rounded-lg transition-all">
                          ☁️ 클라우드 전환
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <main className="relative z-10 pb-8">
        {/* 선택된 농장 정보 배너 */}
        {selectedFarmInfo && currentPage !== 'farms' && !(isSystemWide && !selectedFarmId) && (
          <div className="max-w-7xl mx-auto px-4 md:px-6 pt-3 md:pt-4">
            <div className="flex items-center gap-2 text-base flex-wrap">
              {isSystemWide && selectedFarmId && (
                <span className="text-xs font-mono bg-gray-100 text-gray-500 px-2 py-0.5 rounded">{selectedFarmId}</span>
              )}
              <span className="text-emerald-600 font-bold">{selectedFarmInfo.name}</span>
              {selectedFarmInfo.location && (
                <>
                  <span className="text-gray-300">|</span>
                  <span className="text-gray-500 text-sm">{selectedFarmInfo.location}</span>
                </>
              )}
            </div>
          </div>
        )}

        {currentPage === 'dashboard' && (
          needsFarmSelect ? (
            <div className="max-w-7xl mx-auto px-4 md:px-6 py-16 text-center">
              <div className="text-5xl mb-4 opacity-50">🏠</div>
              <h2 className="text-xl font-bold text-gray-700 mb-2">농장을 선택해주세요</h2>
              <p className="text-gray-500 mb-6">상단의 농장 선택 드롭다운에서 조회할 농장을 선택하거나,<br />농장관리 페이지에서 농장을 관리할 수 있습니다.</p>
              <button onClick={() => setCurrentPage('farms')}
                className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 active:scale-95 transition-all">
                농장관리로 이동
              </button>
            </div>
          ) : (
            <DynamicDashboard farmId={farmId} />
          )
        )}
        {currentPage === 'control' && hasPermission('control') && (
          <ControlPage farmId={farmId} />
        )}
        {currentPage === 'journal' && hasPermission('journal') && (
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6">
            <JournalManager farmId={farmId} />
          </div>
        )}
        {currentPage === 'report' && hasPermission('report') && (
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6">
            <ReportPage farmId={farmId} />
          </div>
        )}
        {currentPage === 'ai' && hasPermission('ai') && (
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6">
            <AIManager farmId={farmId} />
          </div>
        )}
        {/* FarmManager: display:none으로 숨김 — 언마운트 방지로 페이지/스크롤 상태 유지 */}
        {hasPermission('farms') && (
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6" style={{ display: currentPage === 'farms' ? '' : 'none' }}>
            <FarmManager onNavigateFarm={(farmId, farmInfo) => { selectFarm(farmId, farmInfo); setCurrentPage('dashboard'); }} />
          </div>
        )}
        {currentPage === 'server' && hasPermission('server') && (
          <ServerStatus />
        )}
        {currentPage === 'settings' && hasPermission('settings') && (
          <ConfigurationManager farmId={farmId} />
        )}
        {currentPage === 'users' && hasPermission('users') && (
          <UserManager farmId={farmId} />
        )}
      </main>

      {/* 모바일 하단 네비 제거 — 모든 메뉴가 상단 헤더에 통합됨 */}

      {/* 모바일 알림 패널 */}
      <div className="md:hidden">
        <AlertPanel
          farmId={farmId}
          showPanel={showAlertPanel}
          setShowPanel={setShowAlertPanel}
          isMobile={true}
        />
      </div>

      {/* 데스크톱 알림 패널 */}
      {showAlertPanel && (
        <div className="hidden md:block">
          <AlertPanel
            farmId={farmId}
            showPanel={showAlertPanel}
            setShowPanel={setShowAlertPanel}
            isMobile={false}
          />
        </div>
      )}
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
