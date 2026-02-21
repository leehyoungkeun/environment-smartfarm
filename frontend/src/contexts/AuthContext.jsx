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

        // 토큰 만료 시 자동 갱신 시도
        if (error.response?.status === 401 &&
          errorCode === 'TOKEN_EXPIRED' &&
          !originalRequest._retry) {

          originalRequest._retry = true;

          try {
            const { refreshToken } = getTokens();
            if (!refreshToken) throw new Error('No refresh token');

            const response = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
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
      // 팜로컬 모드: 자동 로그인 (JWT 서버 없음)
      if (isFarmLocalMode()) {
        const farmLocalUser = {
          id: 'farm-local',
          username: 'farmer',
          name: '농장관리자',
          role: 'admin',
          farmId: 'farm_001',
        };
        setUser(farmLocalUser);
        cacheUser(farmLocalUser);
        setOfflineMode(true);
        setLoading(false);
        return;
      }

      try {
        const setupRes = await axios.get(`${API_BASE_URL}/auth/check-setup`);
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
          headers: { Authorization: `Bearer ${accessToken}` }
        });

        if (response.data.success) {
          setUser(response.data.data);
          cacheUser(response.data.data);
          setOfflineMode(false);
        }
      } catch (error) {
        const status = error.response?.status;
        const code = error.response?.data?.code;

        // 서버가 토큰이 만료됐다고 명시한 경우만 갱신 시도
        if (status === 401 && (code === 'TOKEN_EXPIRED' || code === 'INVALID_TOKEN')) {
          try {
            const { refreshToken } = getTokens();
            if (refreshToken) {
              const refreshRes = await axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken });
              const { accessToken: newAccess, refreshToken: newRefresh } = refreshRes.data.data;
              saveTokens(newAccess, newRefresh);

              const meRes = await axios.get(`${API_BASE_URL}/auth/me`, {
                headers: { Authorization: `Bearer ${newAccess}` }
              });
              if (meRes.data.success) {
                setUser(meRes.data.data);
                cacheUser(meRes.data.data);
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
        if (!error.response) {
          const { accessToken } = getTokens();
          const cachedUser = getCachedUser();
          if (accessToken && cachedUser) {
            console.log('[Auth] 서버 연결 불가 → 오프라인 모드 (캐시된 사용자 정보 사용)');
            setUser(cachedUser);
            setOfflineMode(true);
          }
        }
      } finally {
        setLoading(false);
      }
    };

    initAuth();
  }, []);

  const login = async (username, password) => {
    const response = await axios.post(`${API_BASE_URL}/auth/login`, { username, password });
    const { user: userData, accessToken, refreshToken } = response.data.data;
    saveTokens(accessToken, refreshToken);
    cacheUser(userData);
    setUser(userData);
    setOfflineMode(false);
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
    return userData;
  };

  const logout = async () => {
    if (isFarmLocalMode()) {
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

  // 권한 체크
  const hasPermission = (action) => {
    if (!user) return false;
    const permissions = {
      admin: ['dashboard', 'control', 'history', 'settings', 'users', 'journal', 'ai'],
      worker: ['dashboard', 'control', 'history', 'journal', 'ai'],
    };
    return (permissions[user.role] || []).includes(action);
  };

  const isAdmin = user?.role === 'admin';

  return (
    <AuthContext.Provider value={{
      user, loading, needsSetup, isAdmin, offlineMode,
      login, logout, setup, hasPermission,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
