import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { isServerOnline, isFarmLocalMode } from '../services/apiSwitcher';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

const AuthContext = createContext(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [farms, setFarms] = useState([]);
  const [selectedFarmId, setSelectedFarmId] = useState(
    () => localStorage.getItem('selectedFarmId') || ''
  );
  const [selectedFarmInfo, setSelectedFarmInfo] = useState(() => {
    try {
      const cached = localStorage.getItem('selectedFarmInfo');
      return cached ? JSON.parse(cached) : null;
    } catch { return null; }
  });

  const getTokens = () => ({
    accessToken: localStorage.getItem('accessToken'),
    refreshToken: localStorage.getItem('refreshToken'),
  });

  const saveTokens = (accessToken, refreshToken) => {
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('refreshToken', refreshToken);
  };

  const clearTokens = () => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  };

  const cacheUser = (userData) => {
    localStorage.setItem('cachedUser', JSON.stringify(userData));
  };

  const getCachedUser = () => {
    try {
      const cached = localStorage.getItem('cachedUser');
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    const requestInterceptor = axios.interceptors.request.use(
      (config) => {
        const { accessToken } = getTokens();
        if (accessToken && config.url?.startsWith(API_BASE_URL)) {
          config.headers.Authorization = `Bearer ${accessToken}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    const responseInterceptor = axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config;
        const errorCode = error.response?.data?.code;

        // 팜로컬 모드에서는 클라우드 401 로 세션을 건드리지 않는다.
        //
        // 팜로컬 사용자는 토큰이 아니라 합성 사용자(farmLocalUser)다. 그런데 localStorage 에
        // 만료된 옛 토큰이 남아 있으면 클라우드로 나가는 요청에 그대로 붙고, 서버가 TOKEN_EXPIRED 를
        // 주고, 갱신은 인터넷이 없어 실패하고, 아래 catch 가 setUser(null) 을 해서
        // **팜로컬로 들어가자마자 로그인 화면으로 튕긴다.** (2026-08-30 패널에서 재현)
        // 팜로컬에서 클라우드 호출이 실패하는 것은 정상이므로, 호출자에게 에러만 돌려준다.
        if (error.response?.status === 401 && isFarmLocalMode()) {
          return Promise.reject(error);
        }

        // 토큰 만료 시 자동 갱신 시도
        if (error.response?.status === 401 &&
          errorCode === 'TOKEN_EXPIRED' &&
          !originalRequest._retry) {

          originalRequest._retry = true;

          try {
            const { refreshToken } = getTokens();
            if (!refreshToken) throw new Error('No refresh token');

            const response = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken }, { timeout: 5000 });
            const { accessToken: newAccess, refreshToken: newRefresh } = response.data.data;

            saveTokens(newAccess, newRefresh);
            originalRequest.headers.Authorization = `Bearer ${newAccess}`;

            return axios(originalRequest);
          } catch (refreshError) {
            clearTokens();
            setUser(null);
            return Promise.reject(refreshError);
          }
        }

        // 유효하지 않은 토큰 시 로그아웃 (auth 관련 요청 제외)
        if (error.response?.status === 401 &&
          errorCode === 'INVALID_TOKEN' &&
          !originalRequest.url?.includes('/auth/')) {
          clearTokens();
          setUser(null);
        }

        return Promise.reject(error);
      }
    );

    return () => {
      axios.interceptors.request.eject(requestInterceptor);
      axios.interceptors.response.eject(responseInterceptor);
    };
  }, []);

  useEffect(() => {
    const initAuth = async () => {
      // 키오스크(패널, localhost)는 브라우저가 새로 뜰 때마다 로그인을 요구한다 (2026-08-30 결정).
      // 토큰은 21곳이 localStorage 에서 직접 읽으므로 저장 위치를 옮기지 않고, 새 세션(재부팅·chromium
      // 재시작)의 첫 진입에서 토큰만 지운다. 같은 세션 안의 새로고침은 sessionStorage 표식으로 구분해 유지한다.
      if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
        try {
          if (!sessionStorage.getItem('kioskSession')) {
            clearTokens();
            sessionStorage.setItem('kioskSession', '1');
          }
        } catch { /* sessionStorage 불가 환경은 무시 */ }
      }
      // 팜로컬 모드: 농장주가 명시적으로 setFarmLocalMode(true) 한 경우만
      // 트랩 21 fix (2026-05-09): 옛 자동 진입 폐기 — 키오스크도 cloud 우선 (정상 frontend)
      // cloud 끊김 시 헤더 배너에서 농장주가 직접 '팜로컬 전환' 버튼으로만 진입
      if (isFarmLocalMode()) {
        let farmId = null;
        try {
          const r = await fetch('/api/system/info', {
            cache: 'no-store',
            signal: AbortSignal.timeout(2000),
          });
          if (r.ok) {
            const d = await r.json();
            if (d?.success && d?.configured && d?.farmId) farmId = d.farmId;
          }
        } catch { /* same-origin 실패 — fallback 으로 진행 */ }

        if (!farmId) farmId = import.meta.env.VITE_FARM_ID || 'farm_0001';

        const farmLocalUser = {
          id: 'farm-local',
          username: 'farmer',
          name: '농장관리자',
          role: 'owner',
          farmId,
        };
        setUser(farmLocalUser);
        cacheUser(farmLocalUser);
        setOfflineMode(true);
        setLoading(false);
        return;
      }

      try {
        const setupRes = await axios.get(`${API_BASE_URL}/auth/check-setup`, { timeout: 5000 });
        if (setupRes.data.data.needsSetup) {
          setNeedsSetup(true);
          setLoading(false);
          return;
        }

        const { accessToken } = getTokens();
        if (!accessToken) {
          setLoading(false);
          return;
        }

        const response = await axios.get(`${API_BASE_URL}/auth/me`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          timeout: 5000,
        });

        if (response.data.success) {
          const userData = response.data.data;
          setUser(userData);
          cacheUser(userData);
          setOfflineMode(false);

          // farms 데이터가 있으면 설정 (새로고침 시 농장 정보 복원)
          if (userData.farms && userData.farms.length > 0) {
            setFarms(userData.farms);
            // 이전에 선택했던 farmId가 유효하면 유지, 아니면 첫 번째 농장
            const saved = localStorage.getItem('selectedFarmId');
            const matched = saved && userData.farms.find(f => f.farmId === saved);
            if (matched) {
              selectFarm(matched.farmId, matched);
            } else {
              selectFarm(userData.farms[0].farmId, userData.farms[0]);
            }
          }
        }
      } catch (error) {
        const status = error.response?.status;
        const code = error.response?.data?.code;

        // 서버가 토큰이 만료됐다고 명시한 경우만 갱신 시도
        if (status === 401 && (code === 'TOKEN_EXPIRED' || code === 'INVALID_TOKEN')) {
          try {
            const { refreshToken } = getTokens();
            if (refreshToken) {
              const refreshRes = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken }, { timeout: 5000 });
              const { accessToken: newAccess, refreshToken: newRefresh } = refreshRes.data.data;
              saveTokens(newAccess, newRefresh);

              const meRes = await axios.get(`${API_BASE_URL}/auth/me`, {
                headers: { Authorization: `Bearer ${newAccess}` },
                timeout: 5000,
              });
              if (meRes.data.success) {
                const ud = meRes.data.data;
                setUser(ud);
                cacheUser(ud);
                if (ud.farms && ud.farms.length > 0) {
                  setFarms(ud.farms);
                  const saved = localStorage.getItem('selectedFarmId');
                  const matched = saved && ud.farms.find(f => f.farmId === saved);
                  if (matched) selectFarm(matched.farmId, matched);
                  else selectFarm(ud.farms[0].farmId, ud.farms[0]);
                }
              }
            } else {
              clearTokens();
            }
          } catch (refreshError) {
            // 리프레시 토큰도 거부된 경우만 로그아웃
            if (refreshError.response?.status === 401 || refreshError.response?.status === 403) {
              clearTokens();
            }
            // 네트워크 오류, rate limit(429) 등은 토큰 유지 (다음 새로고침에서 재시도)
          }
        }

        // 네트워크 오류 (서버 다운) → 캐시된 사용자로 오프라인 모드
        // 트랩 21 (2026-05-09): localhost 자동 진입 폐기 — 헤더 배너에서 명시 전환만
        if (!error.response) {
          const { accessToken } = getTokens();
          const cachedUser = getCachedUser();
          if (accessToken && cachedUser) {
            console.log('[Auth] 서버 연결 불가 → 오프라인 모드 (캐시된 사용자 정보 사용)');
            setUser(cachedUser);
            setOfflineMode(true);
          }
          // 캐시 없음 + 서버 끊김: LoginPage 로 떨어짐 (배너에서 명시적 팜로컬 전환 가능)
        }
      } finally {
        setLoading(false);
      }
    };

    initAuth();
  }, []);

  const selectFarm = useCallback((farmId, farmInfo) => {
    setSelectedFarmId(farmId);
    localStorage.setItem('selectedFarmId', farmId);
    if (farmInfo) {
      const info = { name: farmInfo.name, location: farmInfo.location };
      setSelectedFarmInfo(info);
      localStorage.setItem('selectedFarmInfo', JSON.stringify(info));
    } else {
      // farms 배열에서 찾기 시도
      const found = farms.find(f => f.farmId === farmId);
      if (found) {
        const info = { name: found.name, location: found.location };
        setSelectedFarmInfo(info);
        localStorage.setItem('selectedFarmInfo', JSON.stringify(info));
      }
    }
  }, [farms]);

  const login = async (username, password) => {
    const response = await axios.post(`${API_BASE_URL}/auth/login`, { username, password });
    const { user: userData, accessToken, refreshToken } = response.data.data;
    saveTokens(accessToken, refreshToken);
    cacheUser(userData);
    setUser(userData);
    setOfflineMode(false);

    // 농장 목록 설정 (서버에서 실제 농장 정보 포함)
    const userFarms = (userData.farms && userData.farms.length > 0)
      ? userData.farms
      : [{ farmId: userData.farmId, name: userData.farmId }];
    setFarms(userFarms);

    const isSysWide = ['superadmin', 'manager'].includes(userData.role);
    if (isSysWide) {
      // superadmin/manager: 특정 농장 선택하지 않음 → 농장관리 페이지로 이동
      setSelectedFarmId(null);
      setSelectedFarmInfo(null);
      localStorage.removeItem('selectedFarmId');
      localStorage.removeItem('selectedFarmInfo');
      window.location.hash = 'farms';
    } else {
      // owner/worker: 첫 번째 농장 선택 → 대시보드로 이동
      selectFarm(userFarms[0].farmId, userFarms[0]);
      window.location.hash = 'dashboard';
    }

    return userData;
  };

  const setup = async (username, password, name) => {
    const response = await axios.post(`${API_BASE_URL}/auth/setup`, { username, password, name });
    const { user: userData, accessToken, refreshToken } = response.data.data;
    saveTokens(accessToken, refreshToken);
    cacheUser(userData);
    setUser(userData);
    setNeedsSetup(false);
    setOfflineMode(false);
    window.location.hash = 'dashboard';
    return userData;
  };

  const logout = async () => {
    if (isFarmLocalMode()) {
      const { setFarmLocalMode } = await import('../services/apiSwitcher.js');
      setFarmLocalMode(false);
      window.location.reload();
      return;
    }
    try {
      const { accessToken } = getTokens();
      if (accessToken) {
        await axios.post(`${API_BASE_URL}/auth/logout`, {}, {
          headers: { Authorization: `Bearer ${accessToken}` }
        });
      }
    } catch { } finally {
      clearTokens();
      localStorage.removeItem('cachedUser');
      setUser(null);
      setOfflineMode(false);
    }
  };

  // ── 4단계 역할 계층 ──
  const ROLE_HIERARCHY = {
    superadmin: { level: 0, canCreate: ['manager', 'owner', 'worker'], label: '최고관리자' },
    manager:    { level: 1, canCreate: ['owner', 'worker'],            label: '관리직원' },
    owner:      { level: 2, canCreate: ['worker'],                     label: '농장대표' },
    worker:     { level: 3, canCreate: [],                             label: '작업자' },
  };

  const ROLE_PERMISSIONS = {
    superadmin: ['dashboard', 'control', 'automation', 'history', 'journal', 'report', 'ai', 'settings', 'users', 'farms', 'server'],
    manager:    ['dashboard', 'control', 'automation', 'history', 'journal', 'report', 'ai', 'settings', 'users', 'farms'],
    owner:      ['dashboard', 'control', 'automation', 'history', 'journal', 'report', 'ai', 'settings', 'users'],
    worker:     ['dashboard', 'control', 'automation', 'history', 'journal', 'report', 'ai'],
  };

  const SYSTEM_WIDE_ROLES = ['superadmin', 'manager'];

  // 권한 체크
  const hasPermission = (action) => {
    if (!user) return false;
    return (ROLE_PERMISSIONS[user.role] || []).includes(action);
  };

  // 역할 계층 비교
  const canManageRole = (targetRole) => {
    if (!user) return false;
    const myLevel = ROLE_HIERARCHY[user.role]?.level;
    const tgtLevel = ROLE_HIERARCHY[targetRole]?.level;
    if (myLevel === undefined || tgtLevel === undefined) return false;
    return myLevel < tgtLevel;
  };

  const canCreateRole = (targetRole) => {
    if (!user) return false;
    return ROLE_HIERARCHY[user.role]?.canCreate?.includes(targetRole) || false;
  };

  const isSystemWide = user ? SYSTEM_WIDE_ROLES.includes(user.role) : false;
  const isAdmin = user ? (ROLE_HIERARCHY[user.role]?.level ?? 99) <= 1 : false; // superadmin/manager
  const roleLabel = user ? (ROLE_HIERARCHY[user.role]?.label || user.role) : '';

  return (
    <AuthContext.Provider value={{
      user, loading, needsSetup, isAdmin, isSystemWide, offlineMode,
      farms, selectedFarmId, selectedFarmInfo, selectFarm,
      login, logout, setup, hasPermission,
      canManageRole, canCreateRole, roleLabel,
      ROLE_HIERARCHY, ROLE_PERMISSIONS, SYSTEM_WIDE_ROLES,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
