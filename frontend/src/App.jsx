import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './components/Auth/LoginPage';
import DynamicDashboard from './components/Dashboard/DynamicDashboard';
import ConfigurationManager from './components/Settings/ConfigurationManager';
import ControlPanel from './components/Dashboard/ControlPanel';
import ControlHistory from './components/Dashboard/ControlHistory';
import UserManager from './components/Auth/UserManager';
import AlertPanel from './components/Dashboard/AlertPanel';
import JournalManager from './components/Journal/JournalManager';
import AIManager from './components/AI/AIManager';
import ServerStatus from './components/Dashboard/ServerStatus';
import { getApiBase } from './services/apiSwitcher';

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
        const response = await axios.get(`${API_BASE_URL}/config/${farmId}`);
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
      <div className="flex gap-2 overflow-x-auto pb-1 mb-5 -mx-4 px-4 md:mx-0 md:px-0">
        {config.houses.map(house => (
          <button
            key={house.houseId}
            onClick={() => setSelectedHouse(house)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-base font-medium
                       whitespace-nowrap transition-all active:scale-[0.97] flex-shrink-0 ${selectedHouse?.houseId === house.houseId
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 shadow-sm'
              }`}
          >
            <span>🏠</span>
            <span>{house.houseName || house.name}</span>
            <span className={`text-sm px-1.5 py-0.5 rounded-md ${selectedHouse?.houseId === house.houseId ? 'bg-white/20' : 'bg-gray-100'
              }`}>
              🪟 {house.deviceCount || 0}
            </span>
          </button>
        ))}
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
  const { user, logout, hasPermission, loading: authLoading, needsSetup } = useAuth();
  const getPageFromHash = () => {
    const hash = window.location.hash.replace('#', '');
    return hash || 'dashboard';
  };
  const [currentPage, setCurrentPageState] = useState(getPageFromHash);

  const setCurrentPage = (page) => {
    window.location.hash = page;
    setCurrentPageState(page);
  };

  useEffect(() => {
    const onHashChange = () => setCurrentPageState(getPageFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  const farmId = user?.farmId || 'farm_001';
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

  useEffect(() => {
    if (user && currentPage !== 'users') {
      const permissions = {
        admin: ['dashboard', 'control', 'history', 'settings', 'journal', 'ai', 'server'],
        worker: ['dashboard', 'control', 'history', 'journal', 'ai'],
      };
      const allowed = permissions[user.role] || ['dashboard'];
      if (!allowed.includes(currentPage)) {
        setCurrentPage('dashboard');
      }
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

  const allNavItems = [
    { id: 'dashboard', label: '대시보드', icon: '📊', permission: 'dashboard' },
    { id: 'control', label: '제어', icon: '🎛️', permission: 'control' },
    { id: 'history', label: '이력', icon: '📋', permission: 'history' },
    { id: 'journal', label: '영농일지', icon: '📝', permission: 'journal' },
    { id: 'ai', label: 'AI도우미', icon: '🤖', permission: 'ai' },
    { id: 'server', label: '서버', icon: '🖥️', permission: 'settings' },
    { id: 'settings', label: '설정', icon: '⚙️', permission: 'settings' },
  ];
  const navItems = allNavItems.filter(item => hasPermission(item.permission));

  return (
    <div className="min-h-screen bg-mesh safe-top">
      {/* PWA 설치 배너 */}
      {showInstallBanner && (
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
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-gradient-to-br from-emerald-400 to-blue-500 rounded-xl 
                            flex items-center justify-center text-lg shadow-lg shadow-emerald-500/20">
                🌱
              </div>
              <span className="text-xl font-bold text-gray-800 tracking-tight">
                SmartFarm
              </span>
            </div>

            <div className="flex items-center gap-2">
              {navItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setCurrentPage(item.id)}
                  className={`px-4 py-2 rounded-xl font-medium transition-all duration-200 ${currentPage === item.id ? 'tab-active' : 'tab-inactive'
                    }`}
                >
                  <span className="mr-1.5">{item.icon}</span>
                  {item.label}
                </button>
              ))}

              <div className="w-px h-6 bg-gray-200 mx-1" />

              <AlertPanel
                farmId={farmId}
                showPanel={showAlertPanel}
                setShowPanel={setShowAlertPanel}
              />

              {/* 사용자 메뉴 */}
              <div className="relative ml-1">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium
                           bg-gray-100 text-gray-600 hover:bg-gray-200 transition-all border border-gray-200"
                >
                  <span className="w-7 h-7 bg-gradient-to-br from-blue-400 to-violet-500 rounded-lg
                                 flex items-center justify-center text-xs text-white font-bold">
                    {user.name?.charAt(0) || '?'}
                  </span>
                  <span className="hidden lg:inline">{user.name}</span>
                </button>
                {showUserMenu && (
                  <>
                    <div className="fixed inset-0 z-[90]" onClick={() => setShowUserMenu(false)} />
                    <div className="absolute right-0 top-12 w-52 bg-white border border-gray-200 rounded-2xl p-2 z-[100] animate-fade-in-up shadow-xl">
                      <div className="px-3 py-2 border-b border-gray-100 mb-1">
                        <p className="text-sm font-semibold text-gray-800">{user.name}</p>
                        <p className="text-xs text-gray-500">{user.username} · {user.role === 'admin' ? '관리자' : '작업자'}</p>
                      </div>
                      {hasPermission('users') && (
                        <button
                          onClick={() => { setCurrentPage('users'); setShowUserMenu(false); }}
                          className="w-full text-left px-3 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-all"
                        >
                          👥 사용자 관리
                        </button>
                      )}
                      <button
                        onClick={() => { logout(); setShowUserMenu(false); }}
                        className="w-full text-left px-3 py-2 text-sm text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                      >
                        🚪 로그아웃
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* 모바일 상단 헤더 */}
      <header className="md:hidden glass-nav sticky top-0 z-50 safe-top">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-gradient-to-br from-emerald-400 to-blue-500 rounded-lg 
                          flex items-center justify-center text-base shadow-lg shadow-emerald-500/20">
              🌱
            </div>
            <span className="text-base font-bold text-gray-800 tracking-tight">SmartFarm</span>
          </div>
          <button
            onClick={() => setShowAlertPanel(!showAlertPanel)}
            className="relative p-2 rounded-xl bg-gray-100 text-gray-700 active:scale-95 transition-transform border border-gray-200"
          >
            🔔
          </button>
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <main className="relative z-10 pb-24 md:pb-8">
        {currentPage === 'dashboard' && (
          <DynamicDashboard farmId={farmId} />
        )}
        {currentPage === 'control' && hasPermission('control') && (
          <ControlPage farmId={farmId} />
        )}
{currentPage === 'history' && hasPermission('history') && (
          <ControlHistory farmId={farmId} />
        )}
        {currentPage === 'journal' && hasPermission('journal') && (
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6">
            <JournalManager farmId={farmId} />
          </div>
        )}
        {currentPage === 'ai' && hasPermission('ai') && (
          <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6">
            <AIManager farmId={farmId} />
          </div>
        )}
        {currentPage === 'server' && hasPermission('settings') && (
          <ServerStatus />
        )}
        {currentPage === 'settings' && hasPermission('settings') && (
          <ConfigurationManager farmId={farmId} />
        )}
        {currentPage === 'users' && hasPermission('users') && (
          <UserManager farmId={farmId} />
        )}
      </main>

      {/* 모바일 하단 네비게이션 */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 glass-nav z-50 safe-bottom">
        <div className="grid grid-cols-8 h-16">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setCurrentPage(item.id)}
              className={`flex flex-col items-center justify-center gap-0.5 transition-all active:scale-90 ${currentPage === item.id
                  ? 'text-blue-600'
                  : 'text-gray-400'
                }`}
            >
              <span className="text-xl">{item.icon}</span>
              <span className="text-xs font-semibold tracking-wide">{item.label}</span>
            </button>
          ))}
          <button
            onClick={() => setShowAlertPanel(true)}
            className="flex flex-col items-center justify-center gap-0.5 text-gray-400 transition-all active:scale-90"
          >
            <span className="text-xl">🔔</span>
            <span className="text-xs font-semibold tracking-wide">알림</span>
          </button>
        </div>
      </nav>

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
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
