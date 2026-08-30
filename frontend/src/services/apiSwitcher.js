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

const PC_SERVER = import.meta.env.VITE_API_BASE_URL || 'https://api.smartgreen.kr/api';
const RPI_SERVER = import.meta.env.VITE_RPI_API_URL || 'http://farm-0001:1880/api';

// 프로덕션 모드 판별: RPi 직접 접근이 불가능한 외부 네트워크 환경
// VITE_RPI_API_URL이 비어있거나, HTTPS에서 로컬 HTTP RPi 호출 시 Mixed Content 차단됨
const IS_CLOUD_MODE = !import.meta.env.VITE_RPI_API_URL || (typeof window !== 'undefined' && window.location.protocol === 'https:' && RPI_SERVER.startsWith('http://'));
const STORAGE_KEY = 'apiSwitcher_state';
const GLOBAL_KEY = '__smartfarmApiState';
const FARM_LOCAL_KEY = 'smartfarm_farmLocalMode';
// 키오스크(패널 자신, localhost)는 팜로컬 플래그를 sessionStorage 에 둔다.
//   재부팅·chromium 재시작이면 새 세션 → 항상 클라우드(로그인 화면)에서 시작한다.
//   팜로컬은 사람이 그 자리에서 켜는 것이지 기기 상태로 남는 것이 아니다 (2026-08-30 재부팅 검증에서
//   localStorage 에 남은 플래그 때문에 부팅 직후 팜로컬로 들어갔다). 웹·모바일은 기존대로 localStorage.
const IS_KIOSK_HOST = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const farmLocalStore = () => (IS_KIOSK_HOST ? window.sessionStorage : window.localStorage);
if (IS_KIOSK_HOST) { try { window.localStorage.removeItem(FARM_LOCAL_KEY); } catch {} }

// Adaptive polling 상수
const HEALTH_BASE_INTERVAL = 10000;    // 온라인 시 10초
const HEALTH_MAX_INTERVAL = 60000;     // 오프라인 시 최대 60초
const HEALTH_BACKOFF_MULTIPLIER = 2;

// Config 캐시 TTL (10분)
const CONFIG_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * 팜로컬 모드 확인 (RPi 단독 운영, 인터넷 없음)
 * 우선순위: 명시적 'true' → 명시적 'false' → 자동 감지(터치패널)
 *  · 명시적 'false' 는 자동 감지를 무력화 (LAN PC 에서 의도적 OFF, 터치패널에서 사용자 OFF 보존)
 *  · 미설정 시만 자동 감지 동작 (터치패널: localhost/127.0.0.1 + port 80/443/빈값)
 */
export function isFarmLocalMode() {
  // 트랩 21 fix (2026-05-09): 자동 감지 폐기 — 농장주가 명시적으로 전환할 때만
  // 옛 동작: localhost+80 자동 진입 → 키오스크에서 cloud 못 쓰게 막힘
  // 새 동작: localStorage 'true' 일 때만 farm-local. 기본값 cloud 모드
  return farmLocalStore().getItem(FARM_LOCAL_KEY) === 'true';
}

/**
 * 자동 감지 가능 환경인지 (UI 안내용)
 */
export function isFarmLocalAutoDetected() {
  const host = window.location.hostname;
  const port = window.location.port;
  return ['localhost', '127.0.0.1'].includes(host)
    && ['80', '443', ''].includes(port);
}

/**
 * 팜로컬 모드 설정
 * 양 분기 모두 S 상태 명시 복원 — 페이지 새로고침에 의존하지 않음
 * @param {boolean} enabled
 */
export function setFarmLocalMode(enabled) {
  if (enabled) {
    farmLocalStore().setItem(FARM_LOCAL_KEY, 'true');
    S.currentApiBase = getFarmLocalApiBase();
    S.serverOnline = false;
    S.rpiOnline = true;
    S.manualOverride = false;
    stopHealthCheck();
  } else {
    // 'false' 명시 — 자동 감지 환경(터치패널)에서도 사용자 의도 보존
    farmLocalStore().setItem(FARM_LOCAL_KEY, 'false');
    // 일반 모드로 S 상태 명시 복원 (새로고침 없이도 정합)
    S.currentApiBase = PC_SERVER;
    S.serverOnline = true; // checkServerHealth 가 즉시 갱신
    S.manualOverride = false;
    S.consecutiveFailures = 0;
    S.healthInterval = HEALTH_BASE_INTERVAL;
    S.downSince = null;
    startHealthCheck();
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
// ★ serverOnline 은 항상 null 로 시작 — 옛 stale state 무시 + 첫 health check 까지 "확인 중" 표시
//   (옛: localStorage 의 serverOnline=false 가 잠시 "연결 끊김" 표시되던 사고 차단)
function loadSavedState() {
  if (isFarmLocalMode()) {
    return { serverOnline: false, manualOverride: false, downSince: null, currentApiBase: getFarmLocalApiBase() };
  }
  let manualOverride = false;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && !IS_CLOUD_MODE) {
      const state = JSON.parse(saved);
      manualOverride = state.manualOverride ?? false;
    }
  } catch {}
  return {
    serverOnline: null,            // 첫 health check 까지 미확인 (SystemStatusWidget "확인 중")
    manualOverride,
    downSince: null,
    currentApiBase: manualOverride ? RPI_SERVER : PC_SERVER,
  };
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
    downSince: saved.downSince ? new Date(saved.downSince) : (saved.serverOnline === false ? new Date() : null),
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
  if (IS_CLOUD_MODE) {
    // 클라우드 모드: RPi 직접 접근 불가 → PC 서버 API 사용
    return PC_SERVER;
  }
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
 * PC 서버 API URL 반환 (항상 고정 — sync 전용)
 * getApiBase()와 달리 모드/상태에 무관하게 항상 PC 서버 URL 반환
 */
export function getPcApiBase() {
  return PC_SERVER;
}

/**
 * 현재 API 베이스 URL 반환
 */
export function getApiBase() {
  // 트랩 21 fix (2026-05-09): 자동 RPi fallback 제거
  // farm-local 명시적 ON 시만 RPi, 그 외엔 항상 cloud (PC_SERVER)
  // cloud 끊김 시 농장주가 배너 클릭으로 명시적 전환
  if (isFarmLocalMode()) {
    if (window.location.port === '1880' || window.location.origin.includes(':1880')) {
      return window.location.origin + '/api';
    }
    return RPI_SERVER;
  }
  return PC_SERVER;
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
    // PC_SERVER 끝의 /api 만 제거 (api.smartgreen.kr의 /api를 잘못 매칭하지 않도록)
    const pcHealthUrl = PC_SERVER.replace(/\/api$/, '') + '/health';
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

    // 트랩 21 (2026-05-09): 자동 RPi 전환 폐기 — 헤더 배너에서 농장주가 명시 전환만
    // RPi 헬스체크는 정보용으로만 유지 (UI 표시), S.currentApiBase 자동 변경 X
    S.currentApiBase = PC_SERVER;
    if (IS_CLOUD_MODE) {
      S.rpiOnline = false;
      if (S.consecutiveFailures <= 1) {
        console.log('[API Switcher] 서버 일시 장애 — 재시도 중');
      }
    } else {
      S.rpiOnline = await checkRpiHealth();
      if (S.consecutiveFailures <= 1) {
        console.log(`[API Switcher] 서버 끊김 — RPi ${S.rpiOnline ? '접근 가능 (배너에서 명시 전환 가능)' : '접근 불가'}`);
      }
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
