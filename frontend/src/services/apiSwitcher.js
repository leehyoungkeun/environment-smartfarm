/**
 * API 전환 서비스
 * PC 서버 다운 시 RPi Node-RED API로 자동 전환
 * 마지막 모드를 localStorage에 저장하여 새로고침 시 즉시 복원
 *
 * [근본 수정]
 * 1. fetch cache: 'no-store' → 브라우저 캐시 응답으로 서버 온라인 오판 방지
 * 2. window 글로벌 상태 → HMR 시 모듈 재실행해도 상태 유지
 * 3. HMR 시 이전 interval 정리 → 중복 헬스체크 방지
 * 4. Adaptive polling: 서버 다운 시 backoff (10s → 20s → 40s, 최대 60s)
 * 5. Config 캐시 TTL: 10분 유효, 만료 시 백그라운드 갱신
 *
 * 사용법:
 *   import { getApiBase, getSystemMode, setManualMode } from '../services/apiSwitcher';
 *   const API_BASE_URL = getApiBase();
 */

const PC_SERVER = import.meta.env.VITE_API_BASE_URL || 'http://192.168.137.1:3000/api';
const RPI_SERVER = import.meta.env.VITE_RPI_API_URL || 'http://192.168.137.86:1880/api';
const STORAGE_KEY = 'apiSwitcher_state';
const GLOBAL_KEY = '__smartfarmApiState';
const FARM_LOCAL_KEY = 'smartfarm_farmLocalMode';

// Adaptive polling 상수
const HEALTH_BASE_INTERVAL = 10000;    // 온라인 시 10초
const HEALTH_MAX_INTERVAL = 60000;     // 오프라인 시 최대 60초
const HEALTH_BACKOFF_MULTIPLIER = 2;

// Config 캐시 TTL (10분)
const CONFIG_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * 팜로컬 모드 확인 (RPi 단독 운영, 인터넷 없음)
 */
export function isFarmLocalMode() {
  return localStorage.getItem(FARM_LOCAL_KEY) === 'true';
}

/**
 * 팜로컬 모드 설정
 * @param {boolean} enabled
 */
export function setFarmLocalMode(enabled) {
  if (enabled) {
    localStorage.setItem(FARM_LOCAL_KEY, 'true');
    S.currentApiBase = getFarmLocalApiBase();
    S.serverOnline = false;
    S.rpiOnline = true;
    S.manualOverride = false;
    stopHealthCheck();
  } else {
    localStorage.removeItem(FARM_LOCAL_KEY);
  }
  saveState();
  notifyListeners();
}

// 팜로컬용 API base 반환 (RPi origin 또는 직접 URL)
function getFarmLocalApiBase() {
  if (window.location.port === '1880' || window.location.origin.includes(':1880')) {
    return window.location.origin + '/api';
  }
  return RPI_SERVER;
}

// localStorage에서 마지막 상태 복원
function loadSavedState() {
  if (isFarmLocalMode()) {
    return { serverOnline: false, manualOverride: false, downSince: null, currentApiBase: getFarmLocalApiBase() };
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const state = JSON.parse(saved);
      return {
        serverOnline: state.serverOnline ?? true,
        manualOverride: state.manualOverride ?? false,
        downSince: state.downSince || null,
        currentApiBase: state.manualOverride
          ? RPI_SERVER
          : (state.serverOnline ? PC_SERVER : RPI_SERVER),
      };
    }
  } catch {}
  return { serverOnline: true, manualOverride: false, downSince: null, currentApiBase: PC_SERVER };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// window 글로벌 상태 (HMR에서도 유지)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
if (!window[GLOBAL_KEY]) {
  const saved = loadSavedState();
  window[GLOBAL_KEY] = {
    currentApiBase: saved.currentApiBase,
    serverOnline: saved.serverOnline,
    rpiOnline: null,
    manualOverride: saved.manualOverride,
    lastCheck: null,
    downSince: saved.downSince ? new Date(saved.downSince) : (saved.serverOnline ? null : new Date()),
    listeners: [],
    healthInterval: HEALTH_BASE_INTERVAL, // adaptive polling 현재 간격
    consecutiveFailures: 0,
  };
}

const S = window[GLOBAL_KEY]; // 상태 참조 단축

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      serverOnline: S.serverOnline,
      manualOverride: S.manualOverride,
      downSince: S.downSince ? S.downSince.toISOString() : null,
    }));
  } catch {}
}

/**
 * 서버 타임아웃 설정값 읽기 (초)
 */
export function getServerTimeoutSec() {
  try {
    const val = parseInt(localStorage.getItem('smartfarm_serverTimeout'));
    if (!isNaN(val) && val >= 30) return val;
  } catch {}
  return 180; // 기본 3분
}

/**
 * RPi API URL 반환 (항상 RPi로 — 자동화 규칙 등 RPi-First 데이터용)
 * 팜로컬+RPi에서 접속: origin/api (same-origin)
 * 팜로컬+PC에서 접속: RPi 직접 (cross-origin, CORS 허용됨)
 * 일반 모드: RPi 직접
 */
export function getRpiApiBase() {
  if (isFarmLocalMode()) {
    // RPi에서 직접 접속 시만 origin 사용 (same-origin)
    if (window.location.port === '1880' || window.location.origin.includes(':1880')) {
      return window.location.origin + '/api';
    }
    return RPI_SERVER;
  }
  return RPI_SERVER;
}

/**
 * 현재 API 베이스 URL 반환
 */
export function getApiBase() {
  if (isFarmLocalMode()) {
    if (window.location.port === '1880' || window.location.origin.includes(':1880')) {
      return window.location.origin + '/api';
    }
    return RPI_SERVER;
  }
  return S.currentApiBase;
}

/**
 * PC 서버가 온라인인지 확인
 */
export function isServerOnline() {
  return S.serverOnline;
}

/**
 * 현재 시스템 모드 반환
 */
export function getSystemMode() {
  if (isFarmLocalMode()) {
    return {
      apiBase: getFarmLocalApiBase(),
      serverOnline: false,
      rpiOnline: true,
      manualOverride: false,
      mode: 'farm-local',
      lastCheck: new Date(),
      downSince: null,
      isUsingRpi: true,
      isFarmLocal: true,
    };
  }
  return {
    apiBase: S.currentApiBase,
    serverOnline: S.serverOnline,
    rpiOnline: S.rpiOnline,
    manualOverride: S.manualOverride,
    mode: S.manualOverride ? 'offline' : (S.serverOnline ? 'online' : 'offline'),
    lastCheck: S.lastCheck,
    downSince: S.downSince,
    isUsingRpi: S.currentApiBase === RPI_SERVER,
    isFarmLocal: false,
  };
}

/**
 * 수동 모드 전환
 * @param {boolean} manual - true: 강제 오프라인, false: 자동
 */
export async function setManualMode(manual) {
  S.manualOverride = manual;

  if (manual) {
    S.currentApiBase = RPI_SERVER;
    S.serverOnline = false;
  } else {
    // 자동 모드 복원 시 polling 간격 리셋
    S.healthInterval = HEALTH_BASE_INTERVAL;
    S.consecutiveFailures = 0;
    await checkServerHealth();
  }

  saveState();

  // RPi Node-RED에도 모드 전환 알림
  try {
    await fetch(`${RPI_SERVER.replace('/api', '')}/api/system/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manual }),
    });
  } catch (e) {
    // RPi 통신 실패해도 무시
  }

  notifyListeners();
}

/**
 * PC 서버 헬스체크 (adaptive backoff 적용)
 * cache: 'no-store' → 브라우저 캐시 방지 (근본 원인 수정)
 */
async function checkServerHealth() {
  if (S.manualOverride) {
    return;
  }

  try {
    const pcHealthUrl = PC_SERVER.replace('/api', '') + '/health';
    const response = await fetch(pcHealthUrl, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });

    if (response.ok) {
      const data = await response.json();
      if (data.success === true || data.status === 'ok') {
        if (!S.serverOnline) {
          console.log('[API Switcher] 서버 복구 감지 → PC 서버로 전환');
        }
        S.serverOnline = true;
        S.downSince = null;
        S.currentApiBase = PC_SERVER;
        // 복구 시 polling 간격 리셋
        S.consecutiveFailures = 0;
        S.healthInterval = HEALTH_BASE_INTERVAL;
      }
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    if (S.serverOnline) {
      console.log('[API Switcher] 서버 다운 감지:', error.message);
    }
    S.serverOnline = false;
    S.downSince = S.downSince || new Date();

    // Backoff: 연속 실패 시 polling 간격 증가
    S.consecutiveFailures++;
    S.healthInterval = Math.min(
      HEALTH_BASE_INTERVAL * Math.pow(HEALTH_BACKOFF_MULTIPLIER, S.consecutiveFailures),
      HEALTH_MAX_INTERVAL
    );

    S.rpiOnline = await checkRpiHealth();
    if (S.rpiOnline) {
      S.currentApiBase = RPI_SERVER;
      if (S.consecutiveFailures <= 1) {
        console.log('[API Switcher] RPi 접근 가능 → RPi API로 전환');
      }
    } else if (S.consecutiveFailures <= 1) {
      console.log('[API Switcher] RPi 접근 불가 → 연결 끊김');
    }
  }

  S.lastCheck = new Date();
  saveState();
  notifyListeners();

  // Adaptive polling: 다음 체크 스케줄 (간격이 변경됐을 수 있으므로)
  rescheduleHealthCheck();
}

/**
 * RPi Node-RED 헬스체크
 */
async function checkRpiHealth() {
  try {
    const rpiHealthUrl = RPI_SERVER.replace('/api', '') + '/api/system/mode';
    const response = await fetch(rpiHealthUrl, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 상태 변경 리스너 등록
 * @param {Function} callback - 상태 변경 시 호출
 * @returns {Function} 구독 해제 함수
 */
export function onModeChange(callback) {
  S.listeners.push(callback);
  return () => {
    S.listeners = S.listeners.filter(l => l !== callback);
  };
}

function notifyListeners() {
  const mode = getSystemMode();
  S.listeners.forEach(cb => {
    try { cb(mode); } catch (e) { console.error('[API Switcher] listener error:', e); }
  });
}

/**
 * Adaptive polling: 간격 변경 시 재스케줄
 */
function rescheduleHealthCheck() {
  if (!window.__apiSwitcherInterval) return;
  clearInterval(window.__apiSwitcherInterval);
  window.__apiSwitcherInterval = setInterval(checkServerHealth, S.healthInterval);
}

/**
 * 헬스체크 시작 (adaptive interval)
 */
export function startHealthCheck() {
  if (isFarmLocalMode()) return;
  if (window.__apiSwitcherInterval) return;

  // 즉시 1회 체크
  checkServerHealth();

  // adaptive interval
  window.__apiSwitcherInterval = setInterval(checkServerHealth, S.healthInterval);
}

/**
 * 헬스체크 중지
 */
export function stopHealthCheck() {
  if (window.__apiSwitcherInterval) {
    clearInterval(window.__apiSwitcherInterval);
    window.__apiSwitcherInterval = null;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Config 캐시 TTL 유틸
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Config 캐시 저장 (TTL 메타데이터 포함)
 * @param {string} farmId
 * @param {object} data
 */
export function setConfigCache(farmId, data) {
  try {
    localStorage.setItem(`cachedConfig_${farmId}`, JSON.stringify(data));
    localStorage.setItem(`cachedConfig_${farmId}_ts`, String(Date.now()));
  } catch {}
}

/**
 * Config 캐시 읽기 (TTL 확인)
 * @param {string} farmId
 * @returns {{ data: object|null, fresh: boolean }} data와 TTL 유효 여부
 */
export function getConfigCache(farmId) {
  try {
    const raw = localStorage.getItem(`cachedConfig_${farmId}`);
    if (!raw) return { data: null, fresh: false };
    const data = JSON.parse(raw);
    const ts = parseInt(localStorage.getItem(`cachedConfig_${farmId}_ts`)) || 0;
    const age = Date.now() - ts;
    return { data, fresh: age < CONFIG_CACHE_TTL_MS };
  } catch {
    return { data: null, fresh: false };
  }
}

// HMR 시 이전 인스턴스의 interval 정리 후 재시작
if (typeof window !== 'undefined') {
  // 이전 HMR 인스턴스 정리
  if (window.__apiSwitcherInterval) {
    clearInterval(window.__apiSwitcherInterval);
    window.__apiSwitcherInterval = null;
  }
  if (window.__apiSwitcherVisHandler) {
    document.removeEventListener('visibilitychange', window.__apiSwitcherVisHandler);
  }

  if (!isFarmLocalMode()) {
    startHealthCheck();

    // 탭 전환 시 체크 일시정지/재개
    window.__apiSwitcherVisHandler = () => {
      if (document.hidden) {
        stopHealthCheck();
      } else {
        // 탭 복귀 시 간격 리셋 (빠르게 체크)
        S.healthInterval = HEALTH_BASE_INTERVAL;
        startHealthCheck();
      }
    };
    document.addEventListener('visibilitychange', window.__apiSwitcherVisHandler);
  }
}
