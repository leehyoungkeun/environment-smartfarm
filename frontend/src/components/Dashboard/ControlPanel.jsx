import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { useAuth } from '../../contexts/AuthContext';
import { sendControlCommand, getControlLogs, getRelayStatus, warmupLambda, saveControlLog } from '../../services/controlApi';
import { getSystemMode, getApiBase, getRpiApiBase } from '../../services/apiSwitcher';
import wsService from '../../services/wsService';

const DEVICE_TYPE_INFO = {
  window:      { label: '1창', icon: '🪟', commands: ['open', 'stop', 'close'] },
  side_window: { label: '측창', icon: '🪟', commands: ['open', 'stop', 'close'] },
  top_window:  { label: '천창', icon: '🪟', commands: ['open', 'stop', 'close'] },
  shade:       { label: '차광', icon: '🌑', commands: ['open', 'stop', 'close'] },
  screen:      { label: '스크린', icon: '🎞️', commands: ['open', 'stop', 'close'] },
  pump:        { label: '펌프', icon: '🔧', commands: ['on', 'off'] },
  motor:       { label: '모터', icon: '⚙️', commands: ['on', 'off'] },
  light:       { label: '조명', icon: '💡', commands: ['on', 'off'] },
  fan:         { label: '순환팬', icon: '🌀', commands: ['on', 'off'] },
  nutrient:    { label: '양액공급', icon: '💧', commands: ['on', 'off'] },
  solution:    { label: '배양액', icon: '🧪', commands: ['on', 'off'] },
  light_ctrl:  { label: '조명제어', icon: '🔆', commands: ['on', 'off'] },
  sprayer:     { label: '무인방제기', icon: '🚿', commands: ['on', 'off'] },
  heater:      { label: '온풍기', icon: '🔥', commands: ['on', 'off'] },
  cooler:      { label: '냉방기', icon: '❄️', commands: ['on', 'off'] },
  co2_supply:  { label: 'CO2공급기', icon: '💨', commands: ['on', 'off'] },
  mist:        { label: '분무제어', icon: '🌫️', commands: ['on', 'off'] },
  valve:       { label: '관수밸브', icon: '🚰', commands: ['open', 'stop', 'close'] },
  etc_device:  { label: '기타', icon: '🔧', commands: ['on', 'off'] },
};

const TRANSIENT_STATUSES = new Set(['opening', 'closing', 'stopping', 'turning_on', 'turning_off']);
const STATE_EXPIRY_MS = 5 * 60 * 1000;

function sanitizeDeviceStates(states) {
  if (!states || typeof states !== 'object') return {};
  const now = Date.now();
  let changed = false;
  const out = {};
  for (const [id, st] of Object.entries(states)) {
    if (!st || typeof st !== 'object') { out[id] = st; continue; }
    if (TRANSIENT_STATUSES.has(st.status)) {
      const ts = st.lastCommandTime ? new Date(st.lastCommandTime).getTime() : 0;
      if (!ts || now - ts > STATE_EXPIRY_MS) {
        out[id] = { ...st, status: 'idle', commandLock: false };
        changed = true;
        continue;
      }
    }
    out[id] = st;
  }
  return changed ? out : states;
}

const ControlPanel = ({ farmId, houseId, houseConfig }) => {
  const { user } = useAuth();
  const devices = houseConfig?.devices || [];
  const controlHouseId = (() => {
    if (!houseId) return 'house1';
    const match = houseId.match(/house_?0*(\d+)/);
    return match ? `house${parseInt(match[1])}` : houseId;
  })();

  const statesKey = `deviceStates_${farmId}_${houseId}`;
  const [deviceStates, setDeviceStates] = useState(() => {
    try {
      const initial = sanitizeDeviceStates(JSON.parse(localStorage.getItem(statesKey)) || {});
      // ★ mount 시 만료된 schedule-off 를 deviceStates 의 'off' 로 변환
      // (web 닫힌 동안 NR 가 schedule-off OFF 발사한 device 는 frontend 도 OFF 로 인지)
      // 제어 시 frontend 가 자기 명령 기억하듯, schedule-off 도 atMs 기반 추론.
      try {
        const schedKey = `scheduleOff_${farmId}_${houseId}`;
        const sched = JSON.parse(localStorage.getItem(schedKey) || '{}');
        const now = Date.now();
        for (const [deviceId, atMs] of Object.entries(sched)) {
          if (atMs <= now) {
            initial[deviceId] = { ...(initial[deviceId] || {}), status: 'off', commandLock: false };
          }
        }
      } catch {}
      return initial;
    }
    catch { return {}; }
  });
  const [controlHistory, setControlHistory] = useState([]);
  const [loading, setLoading] = useState({});
  const [modbusStatus, setModbusStatus] = useState({}); // { [deviceId]: 'verifying' | 'done' | 'timeout' }
  const [confirmAction, setConfirmAction] = useState(null); // { title, message, onConfirm }
  const [controlStage, setControlStage] = useState({}); // { [deviceId]: 'sending' | 'executing' | 'verifying' | 'done' | 'timeout' }
  const [bidirProgress, setBidirProgress] = useState({}); // { [deviceId]: { percent: 0~100, direction: 'open'|'close' } }
  const bidirPositionKey = `bidirPosition_${farmId}_${houseId}`;
  const [bidirPosition, setBidirPosition] = useState(() => {
    try { return JSON.parse(localStorage.getItem(bidirPositionKey)) || {}; } catch { return {}; }
  }); // { [deviceId]: 0~100 (열림 %) }
  const bidirPositionRef = useRef(bidirPosition);
  bidirPositionRef.current = bidirPosition;
  const bidirProgressRef = useRef(bidirProgress);
  bidirProgressRef.current = bidirProgress;
  // devices 도 ref 로 보유 — WS subscribe handler 의 stale closure 방지
  // (useEffect deps 에 devices 미포함 → 비동기 로드된 devices 가 handler 클로저에 안 들어옴)
  const devicesRef = useRef(devices);
  devicesRef.current = devices;
  const [conflictWarning, setConflictWarning] = useState(null); // { conflicts: [...] }
  const [toast, setToast] = useState(null); // { message, kind: 'warn'|'info' }

  // ────────────────────────────────────────────────────────────────
  // 자동 OFF 예약 — { deviceId: atMs (epoch ms) }. localStorage 캐시.
  // MVP: 프론트엔드 setTimeout 기반. 브라우저 탭 닫으면 timer 손실 (추후 backend 영구화).
  // ────────────────────────────────────────────────────────────────
  const SCHEDULE_OFF_KEY = `scheduleOff_${farmId}_${houseId}`;
  const [scheduleOff, setScheduleOff] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SCHEDULE_OFF_KEY) || '{}');
      const now = Date.now();
      // 만료된 항목 제거 (페이지 다시 열었을 때 정리)
      return Object.fromEntries(Object.entries(saved).filter(([, atMs]) => atMs > now));
    } catch { return {}; }
  });
  const [pickerOpenFor, setPickerOpenFor] = useState(null); // deviceId or null
  const [tickNow, setTickNow] = useState(Date.now()); // countdown 매초 갱신

  // 1초마다 tick — countdown 표시 갱신
  useEffect(() => {
    const id = setInterval(() => setTickNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const setScheduleForDevice = useCallback((deviceId, delaySec) => {
    const atMs = Date.now() + delaySec * 1000;
    setScheduleOff(prev => {
      const next = { ...prev, [deviceId]: atMs };
      try { localStorage.setItem(SCHEDULE_OFF_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
    setPickerOpenFor(null);
  }, [SCHEDULE_OFF_KEY]);

  const cancelScheduleOff = useCallback((deviceId) => {
    setScheduleOff(prev => {
      const next = { ...prev };
      delete next[deviceId];
      try { localStorage.setItem(SCHEDULE_OFF_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [SCHEDULE_OFF_KEY]);
  const toastTimerRef = useRef(null);
  const showToast = useCallback((message, kind = 'warn') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, kind });
    toastTimerRef.current = setTimeout(() => setToast(null), 4500);
  }, []);

  const timerRefs = React.useRef({});

  // 자동화 적용/중지 상태 (서버 기반 + localStorage 캐시)
  const activeKey = `automationActive_${farmId}_${houseId}`;
  const [automationActive, setAutomationActive] = useState(() => {
    try { return localStorage.getItem(activeKey) === 'true'; }
    catch { return false; }
  });
  const [applyLoading, setApplyLoading] = useState(false);

  // 마운트 시 서버에서 실제 automationActive 상태 조회
  useEffect(() => {
    const loadActiveState = async () => {
      try {
        const pcUrl = getApiBase();
        const res = await axios.get(`${pcUrl}/automation/${farmId}/active`, {
          params: { houseId }, timeout: 5000,
        });
        if (res?.data?.success) {
          const serverActive = !!res.data.active;
          setAutomationActive(serverActive);
          localStorage.setItem(activeKey, String(serverActive));
        }
      } catch {}
    };
    loadActiveState();
  }, [farmId, houseId]);

  // 자동 모드 장치 목록을 RPi에 전달 (로컬: HTTP 직접, 클라우드: handleApply의 PUT이 MQTT로 전달)
  const syncAutoDevicesToRpi = async (rpiUrl, autoDeviceIds) => {
    // RPi 직접 접근 가능하면 device-modes 전달 (로컬 모드)
    const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    if (isLocal) {
      try {
        await axios.post(`${rpiUrl}/automation/${farmId}/device-modes`, {
          autoDevices: autoDeviceIds,
          houseId
        }, { timeout: 5000 }).catch(() => {});
      } catch {}
    }
    // 클라우드 모드: handleApply/handleStop의 PUT /active가 이미 MQTT로 autoDevices 전달
  };

  // 충돌 감지: 같은 장치에 대해 상반된 명령을 내리는 규칙이 있는지 검사
  const detectRuleConflicts = () => {
    const conflicts = [];
    const OPPOSITE = { open: 'close', close: 'open', on: 'off', off: 'on' };

    // auto 모드 장치별로 활성 규칙 수집 — action.deviceId 매칭 + rule.enabled
    const deviceRulesMap = {}; // { deviceId: [{ rule, action, timeConds }] }
    devices.forEach(d => {
      if (getDeviceMode(d.deviceId) !== 'auto') return;
      const matchedRules = autoRules.filter(r => {
        if (r.enabled === false) return false;
        const acts = typeof r.actions === 'string' ? (() => { try { return JSON.parse(r.actions); } catch { return []; } })() : (r.actions || []);
        return acts.some(a => a.deviceId === d.deviceId);
      });
      if (matchedRules.length === 0) return;

      matchedRules.forEach(rule => {
        const actions = typeof rule.actions === 'string' ? JSON.parse(rule.actions) : (rule.actions || []);
        const conditions = typeof rule.conditions === 'string' ? JSON.parse(rule.conditions) : (rule.conditions || []);
        const timeConds = conditions.filter(c => c.type === 'time');
        const sensorConds = conditions.filter(c => c.type === 'sensor');

        actions.forEach(action => {
          if (action.deviceId !== d.deviceId) return;
          if (!deviceRulesMap[d.deviceId]) deviceRulesMap[d.deviceId] = [];
          deviceRulesMap[d.deviceId].push({ rule, action, timeConds, sensorConds });
        });
      });
    });

    // 장치별로 충돌 검사
    Object.entries(deviceRulesMap).forEach(([deviceId, entries]) => {
      for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
          const a = entries[i], b = entries[j];
          const cmdA = a.action.command, cmdB = b.action.command;

          // 상반된 명령인지 확인
          if (OPPOSITE[cmdA] !== cmdB) continue;

          // 시간 조건이 둘 다 있으면 시간 겹침 확인
          if (a.timeConds.length > 0 && b.timeConds.length > 0) {
            const timesA = a.timeConds.map(t => t.time);
            const timesB = b.timeConds.map(t => t.time);
            const overlap = timesA.some(ta => timesB.includes(ta));
            // 요일 겹침도 확인
            const daysA = a.timeConds.flatMap(t => (t.days || []).map(Number));
            const daysB = b.timeConds.flatMap(t => (t.days || []).map(Number));
            const dayOverlap = daysA.length === 0 || daysB.length === 0 || daysA.some(d => daysB.includes(d));

            if (!overlap || !dayOverlap) continue; // 시간/요일 안 겹치면 충돌 아님
          }

          // 둘 다 센서 조건만 있으면 → 센서 조건이 상호 배타적인지 확인
          if (a.sensorConds.length > 0 && b.sensorConds.length > 0 && a.timeConds.length === 0 && b.timeConds.length === 0) {
            // 같은 센서에 대해 반대 방향 조건이면 상호 배타 (충돌 아님)
            // 예: temp > 30 → open, temp < 20 → close
            const sameSensorOpposite = a.sensorConds.some(sa =>
              b.sensorConds.some(sb => {
                // 같은 센서 또는 같은 센서 타입 (temp_0001 vs temp_0002 → 둘 다 temp)
                const typeA = sa.sensorId ? sa.sensorId.replace(/_\d+$/, '') : '';
                const typeB = sb.sensorId ? sb.sensorId.replace(/_\d+$/, '') : '';
                if (sa.sensorId !== sb.sensorId && typeA !== typeB) return false;
                const aIsHigh = sa.operator === '>' || sa.operator === '>=';
                const bIsLow = sb.operator === '<' || sb.operator === '<=';
                const aIsLow = sa.operator === '<' || sa.operator === '<=';
                const bIsHigh = sb.operator === '>' || sb.operator === '>=';
                // A가 높을 때 + B가 낮을 때, 또는 반대
                if ((aIsHigh && bIsLow && sa.value > sb.value) ||
                    (aIsLow && bIsHigh && sa.value < sb.value)) {
                  return true; // 상호 배타
                }
                return false;
              })
            );
            if (sameSensorOpposite) continue; // 상호 배타 → 충돌 아님
          }

          conflicts.push({
            deviceId,
            ruleA: a.rule,
            ruleB: b.rule,
            cmdA, cmdB,
            timeInfo: a.timeConds.length > 0 ? a.timeConds.map(t => t.time).join(', ') : '센서 기반',
          });
        }
      }
    });

    return conflicts;
  };

  const handleApply = async () => {
    // 충돌 검사 먼저 수행
    const conflicts = detectRuleConflicts();
    if (conflicts.length > 0) {
      setConflictWarning({ conflicts });
      return; // 충돌 있으면 적용 차단
    }

    setApplyLoading(true);
    try {
      const pcUrl = getApiBase();
      const rpiUrl = getRpiApiBase();
      const autoDeviceIds = devices
        .filter(d => getDeviceMode(d.deviceId) === 'auto')
        .map(d => d.deviceId);

      // 서버에 automationActive=true 저장 (evaluate 게이트 + RPi 동기화)
      await axios.put(`${pcUrl}/automation/${farmId}/active`, {
        houseId, active: true, autoDevices: autoDeviceIds,
      }, { timeout: 5000 });

      // RPi에도 자동 모드 장치 목록 전달
      await syncAutoDevicesToRpi(rpiUrl, autoDeviceIds);

      setAutomationActive(true);
      localStorage.setItem(activeKey, 'true');
      loadAutoRules();
    } catch (err) {
      alert('자동화 적용 실패: ' + (err?.response?.data?.error || err.message));
    } finally { setApplyLoading(false); }
  };

  const handleStop = async () => {
    setApplyLoading(true);
    try {
      const pcUrl = getApiBase();
      const rpiUrl = getRpiApiBase();

      // 서버에 automationActive=false 저장 (evaluate 게이트 차단)
      await axios.put(`${pcUrl}/automation/${farmId}/active`, {
        houseId, active: false, autoDevices: [],
      }, { timeout: 5000 });

      // RPi에도 자동 모드 장치 없음 전달
      await syncAutoDevicesToRpi(rpiUrl, []);

      setAutomationActive(false);
      localStorage.setItem(activeKey, 'false');
      loadAutoRules();
    } catch (err) {
      alert('자동화 중지 실패: ' + (err?.response?.data?.error || err.message));
    } finally { setApplyLoading(false); }
  };

  // 장치별 수동/자동 모드 (localStorage 기반)
  const modeKey = `deviceModes_${farmId}_${houseId}`;
  const [deviceModes, setDeviceModes] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(modeKey));
      return saved || {};
    } catch { return {}; }
  });

  const getDeviceMode = (deviceId) => deviceModes[deviceId] || 'manual';

  const toggleDeviceMode = (deviceId) => {
    setDeviceModes(prev => {
      const current = prev[deviceId] || 'manual';
      const next = current === 'manual' ? 'auto' : 'manual';
      const updated = { ...prev, [deviceId]: next };
      localStorage.setItem(modeKey, JSON.stringify(updated));

      // 자동화 활성 중일 때 backend·RPi 양쪽 autoDevices 갱신
      // 이전: syncAutoDevicesToRpi 만 호출 — cloud 모드에선 무동작 → backend 옛 상태로 박혀 펌프 등 자동모드 누락
      // 변경: backend PUT /active 호출하여 autoDevices 갱신 → backend MQTT 로 RPi 자동 sync
      if (automationActive) {
        const autoDeviceIds = devices
          .filter(d => (d.deviceId === deviceId ? next : (updated[d.deviceId] || 'manual')) === 'auto')
          .map(d => d.deviceId);
        const pcUrl = getApiBase();
        axios.put(`${pcUrl}/automation/${farmId}/active`, {
          houseId, active: true, autoDevices: autoDeviceIds,
        }, { timeout: 5000 }).catch(err => console.warn('[autoDevices] backend 동기화 실패:', err.message));
        // 로컬 모드: RPi 직접 POST (cloud 모드는 backend MQTT 가 처리)
        const rpiUrl = getRpiApiBase();
        syncAutoDevicesToRpi(rpiUrl, autoDeviceIds);
      }

      return updated;
    });
  };

  // 제어이력 모달
  const [historyModal, setHistoryModal] = useState(false);
  const [historyLogs, setHistoryLogs] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);

  const loadHistory = useCallback(async (page = 1) => {
    setHistoryLoading(true);
    try {
      const res = await getControlLogs(farmId, { houseId, limit: 20, page });
      if (res.success) {
        setHistoryLogs(res.data || []);
        setHistoryTotal(res.pagination?.total || 0);
        setHistoryPage(res.pagination?.page || 1);
      }
    } catch {} finally { setHistoryLoading(false); }
  }, [farmId, houseId]);

  // 자동화 규칙 로드 (RPi 우선 → PC 폴백)
  const [autoRules, setAutoRules] = useState([]);
  const [expandedRuleId, setExpandedRuleId] = useState(null);
  // rulePickerDevice 폐기 — '규칙 선택' 개념 제거 (자동화 관리 화면의 enabled 토글이 단일 진실 원천)

  const loadAutoRules = useCallback(async () => {
    try {
      const pcUrl = getApiBase();
      const rpiUrl = getRpiApiBase();
      // PC 서버 우선 (단일 진실 소스), 실패 시 RPi fallback
      const res = await axios.get(`${pcUrl}/automation/${farmId}`, { timeout: 5000 })
        .catch(() => rpiUrl !== pcUrl
          ? axios.get(`${rpiUrl}/automation/${farmId}`, { timeout: 5000 }).catch(() => null)
          : null
        );
      if (res?.data?.success && Array.isArray(res.data.data)) {
        setAutoRules(res.data.data.map(r => ({ ...r, _id: r._id || r.id })));
      }
    } catch {}
  }, [farmId]);

  useEffect(() => { loadAutoRules(); }, [loadAutoRules]);

  // 스케줄 데이터 (서버에서 계산된 정확한 다음 실행 시각)
  const [scheduleMap, setScheduleMap] = useState({}); // { ruleId: nextRunAt(ISO) }
  const loadSchedule = useCallback(async () => {
    try {
      const pcUrl = getApiBase();
      const res = await axios.get(`${pcUrl}/automation/${farmId}/schedule`, {
        params: { houseId },
        timeout: 5000,
      });
      if (res?.data?.success && Array.isArray(res.data.data)) {
        const map = {};
        for (const item of res.data.data) {
          map[item.ruleId] = item.nextRunAt;
        }
        setScheduleMap(map);
      }
    } catch {}
  }, [farmId, houseId]);

  // automationActive일 때만 스케줄 폴링 (10초 간격)
  useEffect(() => {
    if (!automationActive) { setScheduleMap({}); return; }
    loadSchedule();
    const interval = setInterval(loadSchedule, 10000);
    return () => clearInterval(interval);
  }, [automationActive, loadSchedule]);

  // deviceStates 변경 시 localStorage 저장
  useEffect(() => {
    if (Object.keys(deviceStates).length > 0) {
      try { localStorage.setItem(statesKey, JSON.stringify(deviceStates)); } catch {}
    }
  }, [deviceStates, statesKey]);

  // 만료된 transient 상태(opening/closing/turning_on/turning_off/stopping) 5분 초과 시 idle 자동 복원
  useEffect(() => {
    const tick = () => {
      setDeviceStates(prev => {
        const next = sanitizeDeviceStates(prev);
        return next === prev ? prev : next;
      });
    };
    const interval = setInterval(tick, 30 * 1000);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, []);

  // bidirPosition 변경 시 localStorage 저장
  useEffect(() => {
    if (Object.keys(bidirPosition).length > 0) {
      try { localStorage.setItem(bidirPositionKey, JSON.stringify(bidirPosition)); } catch {}
    }
  }, [bidirPosition, bidirPositionKey]);

  // 마운트 시 서버에서 장치 위치 + 활성 동작 복원
  useEffect(() => {
    const syncPositions = async () => {
      try {
        const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';
        const token = localStorage.getItem('accessToken');
        const res = await axios.get(`${API}/device-positions/${farmId}`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 3000,
        });
        if (!res.data?.success || !res.data.data) return;

        const now = Date.now();
        Object.entries(res.data.data).forEach(([devId, info]) => {
          const { startPosition, targetPosition, duration, startedAt, command, position } = info;

          if (command !== 'stop' && startedAt && duration > 0) {
            const elapsed = (now - new Date(startedAt).getTime()) / 1000;
            const remaining = duration - elapsed;

            if (remaining > 0) {
              // 아직 동작 중 → 현재 위치 계산 + 타이머 재개
              const progress = Math.min(1, elapsed / duration);
              const curPos = Math.round(startPosition + (targetPosition - startPosition) * progress);
              setBidirPosition(prev => ({ ...prev, [devId]: curPos }));

              // 진행 애니메이션 재개
              const remainSec = Math.round(remaining);
              setBidirProgress(prev => ({ ...prev, [devId]: { percent: Math.round(progress * 100), direction: command, totalSec: duration, remainSec, startPos: startPosition, actualPos: curPos } }));

              const startTime = new Date(startedAt).getTime();
              const stopTimerKey = `autoStop_${devId}`;
              const progressKey = `progress_${devId}`;

              if (timerRefs.current[progressKey]) clearInterval(timerRefs.current[progressKey]);
              timerRefs.current[progressKey] = setInterval(() => {
                const el = (Date.now() - startTime) / 1000;
                const pct = Math.min(100, Math.round((el / duration) * 100));
                const actualPos = Math.round(startPosition + (targetPosition - startPosition) * Math.min(1, el / duration));
                setBidirProgress(prev => ({ ...prev, [devId]: { percent: pct, direction: command, totalSec: duration, remainSec: Math.max(0, Math.round(duration - el)), startPos: startPosition, actualPos } }));
                setBidirPosition(prev => ({ ...prev, [devId]: actualPos }));
                if (pct >= 100) {
                  clearInterval(timerRefs.current[progressKey]);
                  timerRefs.current[progressKey] = null;
                  setBidirProgress(prev => ({ ...prev, [devId]: null }));
                  setBidirPosition(prev => ({ ...prev, [devId]: targetPosition }));
                }
              }, 500);

              // 남은 시간 후 자동 정지 (실제 stop 명령 + UI 정리)
              if (timerRefs.current[stopTimerKey]) clearTimeout(timerRefs.current[stopTimerKey]);
              timerRefs.current[stopTimerKey] = setTimeout(async () => {
                clearInterval(timerRefs.current[progressKey]);
                timerRefs.current[progressKey] = null;
                timerRefs.current[stopTimerKey] = null;
                setBidirProgress(prev => ({ ...prev, [devId]: null }));
                setBidirPosition(prev => ({ ...prev, [devId]: targetPosition }));
                // 실제 stop 명령 발송 (모터 정지)
                try {
                  const cHouseId = (() => {
                    if (!houseId) return 'house1';
                    const m = houseId.match(/house_?0*(\d+)/);
                    return m ? `house${parseInt(m[1])}` : houseId;
                  })();
                  await sendControlCommand(cHouseId, devId, 'stop', 'auto_duration');
                  // 서버에 정지 상태 저장
                  axios.post(`${API}/device-positions/${farmId}`, {
                    deviceId: devId, position: targetPosition, command: 'stop',
                    startPosition: targetPosition, targetPosition, duration: 0, startedAt: null,
                  }, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
                } catch (e) {
                  console.error('복귀 자동 정지 실패:', devId, e);
                }
              }, remaining * 1000);

            } else {
              // 이미 완료 → 최종 위치 사용
              setBidirPosition(prev => ({ ...prev, [devId]: targetPosition }));
            }
          } else {
            // 정지 상태 → 저장된 위치 사용
            setBidirPosition(prev => ({ ...prev, [devId]: position }));
          }
        });
      } catch {}
    };
    syncPositions();
  }, [farmId, houseId]);

  // 가벼운 position 동기화 polling (15초) — 자동화·외부 명령으로 backend·RPi 가 변경한 결과 frontend 반영
  // 진행 중 동작(progress timer)은 건드리지 않음 → frontend 진행률 표시 유지
  useEffect(() => {
    const lightSync = async () => {
      try {
        const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';
        const token = localStorage.getItem('accessToken');
        const res = await axios.get(`${API}/device-positions/${farmId}`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 3000,
        });
        if (!res.data?.success || !res.data.data) return;
        Object.entries(res.data.data).forEach(([devId, info]) => {
          // 진행 중인 동작은 timer 그대로 유지 (재설정 위험 회피)
          if (bidirProgressRef.current[devId]) return;
          if (timerRefs.current[`progress_${devId}`]) return;
          // 정지 상태(command='stop')만 position 동기화
          if (info.command === 'stop' && info.position !== undefined && info.position !== null) {
            setBidirPosition(prev => prev[devId] === info.position ? prev : { ...prev, [devId]: info.position });
          }
        });
      } catch {}
    };
    // WebSocket 'device-position:update' 가 즉시 sync — polling 은 fallback (60초)
    const interval = setInterval(lightSync, 60 * 1000);
    return () => clearInterval(interval);
  }, [farmId, houseId]);

  // 센서 최신값 polling — 자동화 규칙의 SensorGauge 시각화용
  const [latestSensors, setLatestSensors] = useState({}); // { sensorId: value }
  const [lastSensorTs, setLastSensorTs] = useState(null); // 마지막 센서 수집 시각 → ② 평가 ETA 계산
  useEffect(() => {
    const fetchSensors = async () => {
      try {
        const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';
        const token = localStorage.getItem('accessToken');
        const res = await axios.get(`${API}/sensors/latest/${farmId}/${houseId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          timeout: 5000,
        });
        const inner = res.data?.data || {};
        if (Array.isArray(inner)) {
          const map = {};
          inner.forEach(s => {
            const id = s.sensor_id || s.sensorId;
            if (id !== undefined) map[id] = s.value;
          });
          setLatestSensors(map);
        } else if (inner && typeof inner === 'object') {
          const sensorValues = inner.data && typeof inner.data === 'object' ? inner.data : inner;
          setLatestSensors(sensorValues);
          if (inner.timestamp) setLastSensorTs(new Date(inner.timestamp).getTime());
        }
      } catch {}
    };
    fetchSensors();
    const interval = setInterval(fetchSensors, 30 * 1000);
    return () => clearInterval(interval);
  }, [farmId, houseId]);

  // 릴레이 실제 상태 폴링
  const relayCoilsRef = React.useRef({});
  const [relayOnline, setRelayOnline] = useState(null);
  const [relayFetching, setRelayFetching] = useState(false);
  const [relayMessage, setRelayMessage] = useState(null); // { type: 'ok'|'warn'|'err', text }
  const isFetchingRef = React.useRef(false);

  const fetchRelayStatus = useCallback(async (manual = false) => {
    // WebSocket 연결 시 MQTT 경유 조회 (클라우드 모드)
    if (wsService.isConnected()) {
      if (!manual) return; // WS 모드에서는 수동 조회만 허용 (폴링에 의한 반복 방지)
      setRelayFetching(true); setRelayMessage(null);
      const sent = wsService.requestRelayStatus(farmId);
      setRelayMessage({ type: sent ? 'ok' : 'warn', text: sent ? 'MQTT 조회 요청...' : 'MQTT 미연결' });
      setTimeout(() => { setRelayFetching(false); setRelayMessage(null); }, 5000);
      isFetchingRef.current = false;
      return;
    }

    // WebSocket 미연결 시 기존 HTTP 직접 조회 (로컬 모드)
    // 중복 호출 방지 (이전 요청이 타임아웃 대기 중이면 건너뜀)
    if (isFetchingRef.current) {
      if (manual) setRelayMessage({ type: 'warn', text: '이전 조회 진행 중...' });
      return;
    }
    isFetchingRef.current = true;
    if (manual) { setRelayFetching(true); setRelayMessage(null); }

    try {
      const modbusDevices = devices.filter(d => d.modbus?.address != null);
      if (modbusDevices.length === 0) {
        if (manual) setRelayMessage({ type: 'warn', text: 'Modbus 장치 없음' });
        return;
      }

      const waveshareUnits = [...new Set(modbusDevices.filter(d => (d.modbus.moduleType || 'waveshare') === 'waveshare').map(d => d.modbus.unitId || 1))];
      const eletechsupUnits = [...new Set(modbusDevices.filter(d => d.modbus.moduleType === 'eletechsup').map(d => d.modbus.unitId || 1))];

      let anySuccess = false;
      const newCoils = { ...relayCoilsRef.current };

      // Waveshare: FC1 (Read Coils)
      for (const unitId of waveshareUnits) {
        const res = await getRelayStatus(unitId, 8);
        if (res.success && res.data?.coils) {
          newCoils[unitId] = res.data.coils;
          anySuccess = true;
        }
      }

      // Eletechsup: FC03으로 실제 응답 여부 확인 (연결 판단용)
      // register 0 값은 상태가 아닌 설정값이므로 소프트웨어 상태 추적 유지
      for (const unitId of eletechsupUnits) {
        const res = await getRelayRegStatus(unitId, 0, 1);
        if (res.success) anySuccess = true;
      }

      relayCoilsRef.current = newCoils;
      setRelayOnline(anySuccess);
      if (manual) {
        const wCount = waveshareUnits.length;
        const eCount = eletechsupUnits.length;
        setRelayMessage(anySuccess
          ? { type: 'ok', text: `조회 완료 (W:${wCount} E:${eCount})` }
          : { type: 'err', text: '릴레이 응답 없음' });
        setTimeout(() => setRelayMessage(null), 3000);
      }

      if (anySuccess) {
        setDeviceStates(prev => {
          const updated = { ...prev };
          devices.forEach(d => {
            const m = d.modbus;
            if (!m || m.address == null) return;
            // Eletechsup은 FC03 상태 읽기 불가 → 소프트웨어 상태 사용
            if (m.moduleType === 'eletechsup') {
              // 이전 FC03 폴링이 설정한 잘못된 상태 정리
              if (prev[d.deviceId]?.relayVerified) {
                updated[d.deviceId] = { ...updated[d.deviceId], status: 'idle', relayVerified: false };
              }
              return;
            }
            const uid = m.unitId || 1;
            const coils = newCoils[uid];
            if (!coils) return;

            const currentState = prev[d.deviceId]?.status;
            if (prev[d.deviceId]?.commandLock) return;
            if (['opening', 'closing', 'stopping', 'turning_on', 'turning_off'].includes(currentState)) return;
            // 진행률 카운트 중(autoStop 타이머 동작 중)에는 sync 금지 — 모멘터리 펄스 릴레이는 모터 회전 중에도 coil OFF
            // → 잘못된 측정으로 status가 'closed'/'idle'로 덮어써져서 ▼닫기 버튼이 active 되는 회귀 차단
            if (bidirProgressRef.current[d.deviceId]) return;

            if (m.controlType === 'bidir') {
              const ch1On = !!coils[m.address];
              const ch2On = !!coils[m.address2];
              const status = ch1On ? 'open' : ch2On ? 'closed' : 'idle';
              updated[d.deviceId] = { ...updated[d.deviceId], status, relayVerified: true };
            } else {
              const chOn = !!coils[m.address];
              const status = chOn ? 'on' : 'off';
              updated[d.deviceId] = { ...updated[d.deviceId], status, relayVerified: true };
            }
          });
          return updated;
        });
      }
    } catch (e) {
      if (manual) {
        setRelayMessage({ type: 'err', text: '조회 실패: ' + (e.message || '네트워크 오류') });
        setTimeout(() => setRelayMessage(null), 3000);
      }
    } finally {
      isFetchingRef.current = false;
      if (manual) setRelayFetching(false);
    }
  }, [devices]);

  const relayIntervalRef = React.useRef(null);

  const startRelayPolling = useCallback(() => {
    if (relayIntervalRef.current) return;
    // WS 연결 시 MQTT push로 상태를 받으므로 폴링 불필요
    if (wsService.isConnected()) return;
    relayIntervalRef.current = setInterval(fetchRelayStatus, 10000);
  }, [fetchRelayStatus]);

  const stopRelayPolling = useCallback(() => {
    if (relayIntervalRef.current) {
      clearInterval(relayIntervalRef.current);
      relayIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    // Lambda 콜드 스타트 방지: 페이지 진입 시 미리 워밍업
    const mode = getSystemMode();
    if (!mode.isFarmLocal && mode.serverOnline) warmupLambda();

    // WebSocket 연결 + 실시간 릴레이/제어 수신
    const token = localStorage.getItem('accessToken');
    const apiBase = getApiBase();
    if (token && apiBase) {
      wsService.connect(apiBase, token);
      // WS 연결 후 MQTT 로 릴레이 조회 — 빠르게 (1500 → 300ms)
      // 이유: schedule-off NR-side 만료 후 web 재진입 시 localStorage stale 'on' 표시 최소화
      setTimeout(() => wsService.requestRelayStatus(farmId), 300);
    }

    // WS 미연결 시에만 HTTP 폴링 (로컬 모드)
    if (!token || !apiBase || mode.isFarmLocal) {
      fetchRelayStatus();
      startRelayPolling();
    }

    // WS push 의 coils → deviceStates 매핑 (UI 즉시 sync)
    // 기존 fetchRelayStatus 내부의 동일 로직 — WS 핸들러도 같은 처리 필요
    // ★ devicesRef.current 사용 — useEffect closure 의 stale devices 회피
    const applyCoilsToDeviceStates = (coils, unitId) => {
      const currentDevices = devicesRef.current || [];
      setDeviceStates(prev => {
        const updated = { ...prev };
        currentDevices.forEach(d => {
          const m = d.modbus;
          if (!m || m.address == null) return;
          if (m.moduleType === 'eletechsup') return;  // FC03 불가
          const uid = m.unitId || 1;
          if (uid !== unitId) return;
          if (bidirProgressRef.current[d.deviceId]) return;
          const isLocked = prev[d.deviceId]?.commandLock;
          const currentState = prev[d.deviceId]?.status;
          const isBusy = ['opening', 'closing', 'stopping', 'turning_on', 'turning_off'].includes(currentState);
          // ★ commandLock / busy 중에도 expected 와 actual 매치 시 relayVerified 만은 갱신 허용
          //   status 는 그대로 (낙관 update 유지) — 사용자 빠른 토글 시에도 HW 배지 표시
          let chOn, ch2On, actualStatus, expectedStatus;
          if (m.controlType === 'bidir') {
            chOn = !!coils[m.address];
            ch2On = !!coils[m.address2];
            actualStatus = chOn ? 'open' : ch2On ? 'closed' : 'idle';
            expectedStatus = currentState;
          } else {
            chOn = !!coils[m.address];
            actualStatus = chOn ? 'on' : 'off';
            expectedStatus = currentState;
          }
          if (isLocked || isBusy) {
            // status 안 건드림, actualStatus 가 낙관 status 와 매치하면 verified 만 갱신
            if (actualStatus === expectedStatus) {
              updated[d.deviceId] = { ...updated[d.deviceId], relayVerified: true };
            }
            return;
          }
          // 자유 갱신
          updated[d.deviceId] = { ...updated[d.deviceId], status: actualStatus, relayVerified: true };
        });
        return updated;
      });
    };

    const unsubRelay = wsService.subscribe('relay:status', (msg) => {
      if (msg.data) {
        const coils = msg.data.coils || msg.data;
        if (typeof coils === 'object') {
          const unitId = msg.data.unitId || 1;
          relayCoilsRef.current = { ...relayCoilsRef.current, [unitId]: coils };
          setRelayOnline(true);
          applyCoilsToDeviceStates(coils, unitId);
        }
      }
    });

    const unsubRelayRes = wsService.subscribe('relay:response', (msg) => {
      if (msg.data) {
        const coils = msg.data.coils || msg.data;
        if (typeof coils === 'object') {
          const unitId = msg.data.unitId || 1;
          relayCoilsRef.current = { ...relayCoilsRef.current, [unitId]: coils };
          setRelayOnline(true);
          applyCoilsToDeviceStates(coils, unitId);
          setRelayMessage({ type: 'ok', text: '릴레이 조회 완료 (WS)' });
          setTimeout(() => setRelayMessage(null), 3000);
        }
      }
    });

    const unsubControl = wsService.subscribe('control:response', (msg) => {
      if (msg.data) {
        console.log('📡 제어 실행 확인 (WS):', msg.data);
      }
    });

    // 장치 위치 변경 즉시 sync (backend WebSocket push) — 자동화·외부 명령으로 변경되면 <100ms 반영
    const unsubDevicePos = wsService.subscribe('device-position:update', (msg) => {
      const d = msg?.data;
      if (!d || !d.deviceId) return;
      const devId = d.deviceId;
      // 정지 상태(command='stop')는 position 즉시 sync + 진행 중 timer 정리
      if (d.command === 'stop' && d.position !== undefined && d.position !== null) {
        if (timerRefs.current[`progress_${devId}`]) {
          clearInterval(timerRefs.current[`progress_${devId}`]);
          timerRefs.current[`progress_${devId}`] = null;
        }
        setBidirProgress(prev => prev[devId] ? { ...prev, [devId]: null } : prev);
        setBidirPosition(prev => prev[devId] === d.position ? prev : { ...prev, [devId]: d.position });
        return;
      }
      // 자동화·외부 명령으로 open/close 시작 — frontend 가 직접 시작한 게 아니면 진행률 자체 카운트
      if ((d.command === 'open' || d.command === 'close') && d.startedAt && d.duration > 0) {
        // 이미 frontend 가 시작한 progress 가 있으면 건드리지 않음 (자기 명령 echo 방지)
        if (bidirProgressRef.current[devId]) return;
        if (timerRefs.current[`progress_${devId}`]) return;
        // 서버 startedAt 시계 차이 회피 — 메시지 받은 시점을 startTime 으로 사용
        const startTime = Date.now();
        const dur = d.duration;
        const startPos = d.startPosition !== undefined ? d.startPosition : (d.command === 'open' ? 0 : 100);
        const targetPos = d.targetPosition !== undefined ? d.targetPosition : (d.command === 'open' ? 100 : 0);
        const cleanupKey = `progress_${devId}`;
        const safetyKey = `progressSafety_${devId}`;
        // 안전 timeout — duration + 3초 후 강제 cleanup (메시지 손실·정확도 오차 회피)
        if (timerRefs.current[safetyKey]) clearTimeout(timerRefs.current[safetyKey]);
        timerRefs.current[safetyKey] = setTimeout(() => {
          if (timerRefs.current[cleanupKey]) {
            clearInterval(timerRefs.current[cleanupKey]);
            timerRefs.current[cleanupKey] = null;
          }
          setBidirProgress(prev => prev[devId] ? { ...prev, [devId]: null } : prev);
          setBidirPosition(prev => ({ ...prev, [devId]: targetPos }));
          timerRefs.current[safetyKey] = null;
        }, (dur + 3) * 1000);
        timerRefs.current[cleanupKey] = setInterval(() => {
          const el = Math.max(0, (Date.now() - startTime) / 1000);
          if (el >= dur) {
            clearInterval(timerRefs.current[cleanupKey]);
            timerRefs.current[cleanupKey] = null;
            if (timerRefs.current[safetyKey]) { clearTimeout(timerRefs.current[safetyKey]); timerRefs.current[safetyKey] = null; }
            setBidirProgress(prev => ({ ...prev, [devId]: null }));
            setBidirPosition(prev => ({ ...prev, [devId]: targetPos }));
            return;
          }
          const pct = Math.min(100, Math.round((el / dur) * 100));
          const actualPos = Math.round(startPos + (targetPos - startPos) * Math.min(1, el / dur));
          setBidirProgress(prev => ({ ...prev, [devId]: { percent: pct, direction: d.command, totalSec: dur, remainSec: Math.max(0, Math.round(dur - el)), startPos, actualPos } }));
          setBidirPosition(prev => ({ ...prev, [devId]: actualPos }));
        }, 500);
      }
    });

    return () => {
      stopRelayPolling();
      unsubRelay();
      unsubRelayRes();
      unsubControl();
      unsubDevicePos();
    };
  }, [fetchRelayStatus, startRelayPolling, stopRelayPolling, farmId]);

  // unmount 시 모든 타이머 정리
  useEffect(() => {
    const refs = timerRefs.current;
    return () => {
      Object.keys(refs).forEach(key => {
        if (refs[key]) { clearTimeout(refs[key]); refs[key] = null; }
      });
    };
  }, []);

  // 자동화 규칙은 자동화 관리 화면의 활성/비활성 토글이 단일 진실 원천
  // device 카드에는 자기 deviceId 에 매칭되는 활성 규칙 자동 표시 (별도 '선택' 개념 폐기)
  // 옛 selectedRuleMap localStorage 는 무시 (마이그레이션 — 기존 데이터 자동 소멸)

  // houseId 변경 시 deviceModes 재로드
  useEffect(() => {
    try { setDeviceModes(JSON.parse(localStorage.getItem(`deviceModes_${farmId}_${houseId}`)) || {}); }
    catch { setDeviceModes({}); }
  }, [farmId, houseId]);

  const getDeviceRules = (deviceId) => {
    return autoRules.filter(r => {
      if (r.enabled === false) return false;
      let actions = r.actions;
      if (typeof actions === 'string') { try { actions = JSON.parse(actions); } catch { actions = []; } }
      actions = actions || [];
      return actions.some(a => a.deviceId === deviceId);
    });
  };

  useEffect(() => {
    const states = {};
    devices.forEach(d => { states[d.deviceId] = deviceStates[d.deviceId] || { status: 'idle', lastCommand: null }; });
    setDeviceStates(states);
  }, [houseId, devices.length]);

  const batchModeRef = useRef(false);

  // Modbus 완료 확인 폴링 (Node-RED flow context 기반)
  const waitForModbusDone = useCallback(async (requestId, maxWait = 5000) => {
    const rpiApi = getRpiApiBase();
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      try {
        const res = await axios.get(`${rpiApi}/control/status/${requestId}`, { timeout: 2000 });
        if (res.data?.done) return true;
      } catch {}
      await new Promise(r => setTimeout(r, 100)); // 100ms 간격 폴링
    }
    return false; // 타임아웃
  }, []);

  // 비상정지: 모든 장치 즉시 정지/OFF
  const handleEmergencyStop = useCallback(async () => {
    stopRelayPolling();
    // bidir 진행도 전체 초기화
    setBidirProgress({});

    for (const device of devices) {
      // device 의 실제 controlType 기준으로 비상정지 명령 결정
      // (메타 commands 만 보면 valve(single) 같은 케이스에서 stop 으로 잘못 보냄)
      const stopCmd = device.modbus?.controlType === 'bidir' ? 'stop' : 'off';
      const modbusConfig = device.modbus || null;
      try {
        const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
        if (isLocal) {
          // 로컬: RPi 직접
          const rpiApi = getRpiApiBase();
          await axios.post(`${rpiApi}/control/local`, {
            house_id: controlHouseId, device_id: device.deviceId,
            command: stopCmd, operator: '비상정지', modbus: modbusConfig,
          }, { timeout: 5000 });
        } else {
          // 클라우드: AWS Lambda 경유
          await sendControlCommand(controlHouseId, device.deviceId, stopCmd, '비상정지', {
            farmId, originalHouseId: houseId,
            deviceType: device.type, deviceName: device.name,
            operatorName: '비상정지', modbus: modbusConfig,
          });
        }
        setDeviceStates(prev => ({ ...prev, [device.deviceId]: { ...prev[device.deviceId], status: stopCmd === 'stop' ? 'idle' : 'off', commandLock: false } }));
        // 자동정지 타이머 해제
        const stopTimerKey = `autoStop_${device.deviceId}`;
        const progressKey = `progress_${device.deviceId}`;
        if (timerRefs.current[stopTimerKey]) { clearTimeout(timerRefs.current[stopTimerKey]); timerRefs.current[stopTimerKey] = null; }
        if (timerRefs.current[progressKey]) { clearInterval(timerRefs.current[progressKey]); timerRefs.current[progressKey] = null; }
      } catch {}
    }
    setTimeout(() => { if (wsService.isConnected()) wsService.requestRelayStatus(farmId); }, 2000);
  }, [devices, controlHouseId, stopRelayPolling, farmId, houseId]);

  // error 상태 리셋
  const handleErrorReset = useCallback((deviceId) => {
    setDeviceStates(prev => ({ ...prev, [deviceId]: { ...prev[deviceId], status: 'idle', commandLock: false } }));
    setModbusStatus(prev => ({ ...prev, [deviceId]: null }));
    setControlStage(prev => ({ ...prev, [deviceId]: null }));
  }, []);

  // 장치 ID → 이름 변환
  const getDeviceName = useCallback((deviceId) => {
    const device = devices.find(d => d.deviceId === deviceId);
    return device?.name || deviceId;
  }, [devices]);

  const handleControl = useCallback(async (deviceId, command) => {
    // Modbus 직렬 큐 충돌 방지: 제어 중 폴링 중지
    stopRelayPolling();

    const loadingKey = `${deviceId}_${command}`;
    if (command === 'stop') {
      if (timerRefs.current[deviceId]) { clearTimeout(timerRefs.current[deviceId]); timerRefs.current[deviceId] = null; }
      if (timerRefs.current[`autoStop_${deviceId}`]) { clearTimeout(timerRefs.current[`autoStop_${deviceId}`]); timerRefs.current[`autoStop_${deviceId}`] = null; }
      if (timerRefs.current[`progress_${deviceId}`]) { clearInterval(timerRefs.current[`progress_${deviceId}`]); timerRefs.current[`progress_${deviceId}`] = null; }
      // 정지 시 현재 열림 위치 저장
      const prog = bidirProgressRef.current[deviceId];
      const stoppedAt = (prog && prog.actualPos !== undefined) ? prog.actualPos : (bidirPositionRef.current[deviceId] ?? 0);
      if (prog && prog.actualPos !== undefined) {
        setBidirPosition(prev => ({ ...prev, [deviceId]: prog.actualPos }));
      }
      setBidirProgress(prev => ({ ...prev, [deviceId]: null }));
      setDeviceStates(prev => ({ ...prev, [deviceId]: { ...prev[deviceId], status: 'idle', lastCommand: 'stop', lastCommandTime: new Date().toISOString() } }));
      // backend device-positions 에 stop 상태 저장 → 다음 컴포넌트 mount 시 syncPositions 가 진행률 재시작 안 함
      const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';
      axios.post(`${API}/device-positions/${farmId}`, {
        deviceId, position: stoppedAt, command: 'stop',
        startPosition: stoppedAt, targetPosition: stoppedAt,
        duration: 0, startedAt: null,
      }, { headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` }, timeout: 3000 }).catch(() => {});
    }
    setLoading(prev => ({ ...prev, [loadingKey]: true }));
    setControlStage(prev => ({ ...prev, [deviceId]: 'sending' }));
    const statusMap = { open: 'opening', close: 'closing', stop: 'stopping', on: 'turning_on', off: 'turning_off' };
    if (command !== 'stop') {
      setDeviceStates(prev => ({ ...prev, [deviceId]: { ...prev[deviceId], status: statusMap[command] || 'idle', lastCommand: command, lastCommandTime: new Date().toISOString() } }));
    }
    try {
      const ROLE_LABELS = { superadmin: '최고관리자', manager: '관리직원', owner: '농장대표', worker: '작업자' };
      const rolePart = ROLE_LABELS[user?.role] || user?.role || '';
      const namePart = user?.name || user?.username || '알 수 없음';
      const operatorName = `${rolePart} ${namePart}`.trim();
      const mode = getSystemMode();
      let result;

      const targetDevice = devices.find(d => d.deviceId === deviceId);
      const modbusConfig = targetDevice?.modbus || null;

      // bidir 장치 동작 시간 누락 체크 — 진행률 % 표시 + 자동 정지가 동작하지 않으므로 사용자 안내
      if (modbusConfig?.controlType === 'bidir' && (command === 'open' || command === 'close')) {
        const fullDur = command === 'open' ? modbusConfig.openDuration : modbusConfig.closeDuration;
        if (!fullDur || fullDur <= 0) {
          const label = command === 'open' ? '전체 열림 시간' : '전체 닫힘 시간';
          showToast(`설정 → ${targetDevice?.name || deviceId} → Modbus 채널에서 "${label}(초)"을(를) 입력하세요. 진행률 %와 자동 정지가 동작하지 않습니다.`);
        }
      }

      // bidir 진행률 — 명령 송신 직전 낙관적 시작 (axios.post 응답 4-5초 대기 동안 모터는 이미 회전 중이므로 % 동기 유지)
      // 명령 fail 시 cancelBidirProgress() 호출하여 취소
      let bidirStarted = false;
      const cancelBidirProgress = () => {
        if (timerRefs.current[`progress_${deviceId}`]) { clearInterval(timerRefs.current[`progress_${deviceId}`]); timerRefs.current[`progress_${deviceId}`] = null; }
        if (timerRefs.current[`autoStop_${deviceId}`]) { clearTimeout(timerRefs.current[`autoStop_${deviceId}`]); timerRefs.current[`autoStop_${deviceId}`] = null; }
        setBidirProgress(prev => ({ ...prev, [deviceId]: null }));
      };
      if (modbusConfig?.controlType === 'bidir' && (command === 'open' || command === 'close')) {
        const fullDur = command === 'open' ? modbusConfig.openDuration : modbusConfig.closeDuration;
        if (fullDur && fullDur > 0) {
          const curPos = bidirPositionRef.current[deviceId] || 0;
          const remainRatio = command === 'open' ? (100 - curPos) / 100 : curPos / 100;
          const autoDur = Math.max(1, Math.round(fullDur * remainRatio));
          const stopTimerKey = `autoStop_${deviceId}`;
          const progressKey = `progress_${deviceId}`;
          if (timerRefs.current[stopTimerKey]) clearTimeout(timerRefs.current[stopTimerKey]);
          if (timerRefs.current[progressKey]) clearInterval(timerRefs.current[progressKey]);
          const startTime = Date.now();
          setBidirProgress(prev => ({ ...prev, [deviceId]: { percent: 0, direction: command, totalSec: autoDur, remainSec: autoDur, startPos: curPos } }));
          timerRefs.current[progressKey] = setInterval(() => {
            const elapsed = (Date.now() - startTime) / 1000;
            const progressPct = Math.min(100, Math.round((elapsed / autoDur) * 100));
            const actualPos = command === 'open'
              ? Math.min(100, Math.round(curPos + (100 - curPos) * (elapsed / autoDur)))
              : Math.max(0, Math.round(curPos - curPos * (elapsed / autoDur)));
            setBidirProgress(prev => ({ ...prev, [deviceId]: { percent: progressPct, direction: command, totalSec: autoDur, remainSec: Math.max(0, Math.round(autoDur - elapsed)), startPos: curPos, actualPos } }));
            if (progressPct >= 100) clearInterval(timerRefs.current[progressKey]);
          }, 500);
          timerRefs.current[stopTimerKey] = setTimeout(() => {
            // RPi scheduleAutoStop 이 모터 정지 + reportPosition(100/0) 자동 처리하므로
            // frontend handleControl(stop) 중복 호출 X — handleControl 안의 setBidirPosition(prog.actualPos=98)
            // 이 정확한 100/0 값을 덮어써서 화면 100→98 회귀 발생
            // → autoStop 콜백은 UI 정리 + 100/0 명시 backend POST 만
            timerRefs.current[stopTimerKey] = null;
            clearInterval(timerRefs.current[progressKey]);
            timerRefs.current[progressKey] = null;
            setBidirProgress(prev => ({ ...prev, [deviceId]: null }));
            const finalPos = command === 'open' ? 100 : 0;
            setBidirPosition(prev => ({ ...prev, [deviceId]: finalPos }));
            // backend 에 100/0 명시 POST → DB·다른 클라이언트 동기화 보장 (RPi reportPosition 과 중복이지만 같은 값)
            const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';
            axios.post(`${API}/device-positions/${farmId}`, {
              deviceId, position: finalPos, command: 'stop',
              startPosition: finalPos, targetPosition: finalPos,
              duration: 0, startedAt: null,
            }, { headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` }, timeout: 3000 }).catch(() => {});
          }, autoDur * 1000);
          bidirStarted = true;
        }
      }

      const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
      if (isLocalHost || mode.isFarmLocal || mode.mode === 'offline') {
        // RPi 로컬 접속 또는 오프라인: Node-RED 직접 제어 (AWS 우회)
        const rpiApi = getRpiApiBase();
        // bidir 장치: duration 계산 (Node-RED 자동 정지용)
        let autoDuration = 0;
        let curPos = 0;
        if (modbusConfig?.controlType === 'bidir' && (command === 'open' || command === 'close')) {
          const fullDur = command === 'open' ? modbusConfig.openDuration : modbusConfig.closeDuration;
          if (fullDur > 0) {
            curPos = bidirPositionRef.current[deviceId] || 0;
            const remainRatio = command === 'open' ? (100 - curPos) / 100 : curPos / 100;
            autoDuration = Math.max(1, Math.round(fullDur * remainRatio));
            // 서버에 동작 시작 정보 저장
            const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';
            axios.post(`${API}/device-positions/${farmId}`, {
              deviceId, position: curPos, command,
              startPosition: curPos, targetPosition: command === 'open' ? 100 : 0,
              duration: autoDuration, startedAt: new Date().toISOString(),
            }, { headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` } }).catch(() => {});
          }
        }
        const res = await axios.post(`${rpiApi}/control/local`, {
          house_id: controlHouseId,
          device_id: deviceId,
          command,
          operator: operatorName,
          modbus: modbusConfig,
          duration: autoDuration,
        }, { timeout: 10000 });
        result = { success: res.data.success, requestId: res.data.data?.request_id };
        setControlStage(prev => ({ ...prev, [deviceId]: 'executing' }));
        // 명령 응답 fail → 낙관적 시작한 진행률 취소
        if (!result.success && bidirStarted) cancelBidirProgress();
        // ★ Modbus 완료 대기 — Node-RED가 실제 쓰기 완료를 확인 + UI 표시
        if (result.success && result.requestId) {
          setModbusStatus(prev => ({ ...prev, [deviceId]: 'verifying' }));
          setControlStage(prev => ({ ...prev, [deviceId]: 'verifying' }));
          const ok = await waitForModbusDone(result.requestId);
          if (ok) {
            setModbusStatus(prev => ({ ...prev, [deviceId]: 'done' }));
            setControlStage(prev => ({ ...prev, [deviceId]: 'done' }));
            // Modbus 완료 시 즉시 최종 상태로 전환 (5초 타이머 취소)
            const finalStatus = { open: 'open', close: 'closed', stop: 'idle', on: 'on', off: 'off' };
            if (timerRefs.current[deviceId]) { clearTimeout(timerRefs.current[deviceId]); timerRefs.current[deviceId] = null; }
            setDeviceStates(prev => ({ ...prev, [deviceId]: { ...prev[deviceId], status: finalStatus[command] || 'idle', commandLock: false } }));
          } else {
            // verification 타임아웃: 릴레이 상태 재확인으로 실제 동작 여부 검증
            // ★ 명령은 이미 응답 success(릴레이 ON)였으므로 진행률은 그대로 유지
            //   autoStop 타이머가 fullDur 후 자동 정지 처리 → 작물 안전
            //   verification 실패는 헤더 배지(timeout)로만 표시
            setControlStage(prev => ({ ...prev, [deviceId]: 'hw_check' }));
            try {
              const m = targetDevice?.modbus;
              // ★ WS 모드 우회 — fetchRelayStatus 는 WS 연결 시 early return 함
              //   직접 HTTP getRelayStatus 호출하여 FC1 실제 읽기 수행
              const unitId = m?.unitId || 1;
              const res = m ? await getRelayStatus(unitId, 8) : null;
              const coils = res?.success && res?.data?.coils ? res.data.coils : null;
              if (coils && m) {
                // relayCoilsRef 도 갱신 (다른 device 의 polling 결과 캐시)
                relayCoilsRef.current = { ...relayCoilsRef.current, [unitId]: coils };
                const finalStatus = { open: 'open', close: 'closed', stop: 'idle', on: 'on', off: 'off' };
                const expectedStatus = finalStatus[command];
                let actualStatus;
                if (m.controlType === 'bidir') {
                  actualStatus = coils[m.address] ? 'open' : coils[m.address2] ? 'closed' : 'idle';
                } else {
                  actualStatus = coils[m.address] ? 'on' : 'off';
                }
                if (actualStatus === expectedStatus) {
                  setModbusStatus(prev => ({ ...prev, [deviceId]: 'done' }));
                  setControlStage(prev => ({ ...prev, [deviceId]: 'done' }));
                  if (timerRefs.current[deviceId]) { clearTimeout(timerRefs.current[deviceId]); timerRefs.current[deviceId] = null; }
                  setDeviceStates(prev => ({ ...prev, [deviceId]: { ...prev[deviceId], status: expectedStatus, commandLock: false, relayVerified: true } }));
                } else {
                  setModbusStatus(prev => ({ ...prev, [deviceId]: 'timeout' }));
                  setControlStage(prev => ({ ...prev, [deviceId]: 'timeout' }));
                }
              } else {
                setModbusStatus(prev => ({ ...prev, [deviceId]: 'timeout' }));
                setControlStage(prev => ({ ...prev, [deviceId]: 'timeout' }));
              }
            } catch {
              setModbusStatus(prev => ({ ...prev, [deviceId]: 'timeout' }));
              setControlStage(prev => ({ ...prev, [deviceId]: 'timeout' }));
            }
          }
        } else {
          setControlStage(prev => ({ ...prev, [deviceId]: result.success ? 'done' : 'timeout' }));
        }
        // 로컬 제어 이력 PC 백엔드에 저장 (비동기)
        if (result.success) {
          saveControlLog({
            farmId,
            houseId,
            controlHouseId,
            deviceId,
            deviceType: targetDevice?.type || 'unknown',
            deviceName: targetDevice?.name || deviceId,
            command,
            success: true,
            operator: 'web_dashboard',
            operatorName,
          });
        }
      } else {
        // 온라인: AWS IoT 경유 (기존)
        // bidir 장치: duration 계산 (Node-RED 자동 정지용)
        let awsDuration = 0;
        if (modbusConfig?.controlType === 'bidir' && (command === 'open' || command === 'close')) {
          const fullDur = command === 'open' ? modbusConfig.openDuration : modbusConfig.closeDuration;
          if (fullDur > 0) {
            const curPos = bidirPositionRef.current[deviceId] || 0;
            const remainRatio = command === 'open' ? (100 - curPos) / 100 : curPos / 100;
            awsDuration = Math.max(1, Math.round(fullDur * remainRatio));
            // 서버에 동작 시작 정보 저장
            const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';
            axios.post(`${API}/device-positions/${farmId}`, {
              deviceId, position: curPos, command,
              startPosition: curPos, targetPosition: command === 'open' ? 100 : 0,
              duration: awsDuration, startedAt: new Date().toISOString(),
            }, { headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` } }).catch(() => {});
          }
        }
        result = await sendControlCommand(controlHouseId, deviceId, command, 'web_dashboard', {
          farmId, originalHouseId: houseId,
          deviceType: targetDevice?.type || 'unknown',
          deviceName: targetDevice?.name || deviceId,
          operatorName,
          modbus: modbusConfig,
          duration: awsDuration,
        });
      }

      setControlHistory(prev => [{ deviceId, command, success: result.success, requestId: result.requestId, timestamp: new Date().toISOString(), error: result.error, operatorName }, ...prev.slice(0, 19)]);
      // 제어 완료 → controlStage 초기화
      setControlStage(prev => ({ ...prev, [deviceId]: null }));
      if (result.success) {
        if (timerRefs.current[deviceId]) clearTimeout(timerRefs.current[deviceId]);
        const finalStatus = { open: 'open', close: 'closed', stop: 'idle', on: 'on', off: 'off' };
        setDeviceStates(prev => ({ ...prev, [deviceId]: { ...prev[deviceId], status: finalStatus[command] || 'idle', commandLock: true } }));
        timerRefs.current[deviceId] = setTimeout(() => {
          setDeviceStates(prev => ({ ...prev, [deviceId]: { ...prev[deviceId], commandLock: false } }));
          timerRefs.current[deviceId] = null;
        }, command === 'stop' ? 500 : 5000);
        // bidir 진행률은 명령 송신 직전 낙관적 시작됨 — 그대로 유지
      } else {
        if (bidirStarted) cancelBidirProgress();
        setDeviceStates(prev => ({ ...prev, [deviceId]: { ...prev[deviceId], status: 'error', errorReason: result.error || '제어 실패' } }));
        setControlStage(prev => ({ ...prev, [deviceId]: null }));
      }
      return result;
    } catch (error) {
      if (bidirStarted) cancelBidirProgress();
      setDeviceStates(prev => ({ ...prev, [deviceId]: { ...prev[deviceId], status: 'error', errorReason: error.message || '네트워크 오류' } }));
      setControlStage(prev => ({ ...prev, [deviceId]: null }));
      return { success: false };
    } finally {
      setLoading(prev => ({ ...prev, [loadingKey]: false }));
      // 배치 모드에서는 개별 폴링 재개 건너뛰기 (handleBatchControl에서 일괄 처리)
      if (!batchModeRef.current) {
        setTimeout(() => {
          fetchRelayStatus();
          startRelayPolling();
        }, 2000);
      }
    }
  }, [controlHouseId, farmId, houseId, devices, user, stopRelayPolling, startRelayPolling, fetchRelayStatus, waitForModbusDone]);

  // 에러 시 자동 재시도 (최대 2회)
  const handleControlWithRetry = useCallback(async (deviceId, command, maxRetries = 2) => {
    let lastResult;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        setControlStage(prev => ({ ...prev, [deviceId]: `retry_${attempt}` }));
        setDeviceStates(prev => ({ ...prev, [deviceId]: { ...prev[deviceId], status: 'idle', errorReason: undefined } }));
        await new Promise(r => setTimeout(r, 500)); // 재시도 전 500ms 대기
      }
      lastResult = await handleControl(deviceId, command);
      if (lastResult?.success) return lastResult;
    }
    // 모든 재시도 실패
    setDeviceStates(prev => ({
      ...prev, [deviceId]: {
        ...prev[deviceId], status: 'error',
        errorReason: `${maxRetries + 1}회 시도 모두 실패`,
      }
    }));
    setControlStage(prev => ({ ...prev, [deviceId]: null }));
    return lastResult;
  }, [handleControl]);

  const [batchProgress, setBatchProgress] = useState(null); // { current, total, deviceName, done }

  // 전체 제어: 순차 실행 + Modbus 완료 확인 + 진행 상태 표시
  const handleBatchControl = useCallback(async (deviceList, command) => {
    batchModeRef.current = true;
    stopRelayPolling();
    const COMMAND_LABELS_BATCH = { open: '열기', close: '닫기', stop: '정지', on: 'ON', off: 'OFF' };
    for (let i = 0; i < deviceList.length; i++) {
      const dev = deviceList[i];
      const devName = dev.name || dev.deviceId;
      setBatchProgress({ current: i + 1, total: deviceList.length, deviceName: devName, command: COMMAND_LABELS_BATCH[command] || command, done: false });
      const result = await handleControlWithRetry(dev.deviceId, command);
      // ★ handleControl이 이미 개별 Modbus 완료 대기를 함 — 배치 진행 상태만 업데이트
      const reqId = result?.requestId;
      if (reqId) {
        setBatchProgress(prev => ({ ...prev, done: true, waiting: false, modbusOk: true }));
      }
    }
    setBatchProgress({ current: deviceList.length, total: deviceList.length, done: true, command: COMMAND_LABELS_BATCH[command] || command, complete: true });
    batchModeRef.current = false;
    setTimeout(() => { fetchRelayStatus(); startRelayPolling(); setBatchProgress(null); }, 3000);
  }, [handleControlWithRetry, stopRelayPolling, startRelayPolling, fetchRelayStatus, waitForModbusDone, controlHistory]);

  // 자동 OFF 예약 — 만료된 항목 자동 실행 + cleanup
  // (handleControlWithRetry 가 정의된 후 등록)
  useEffect(() => {
    if (Object.keys(scheduleOff).length === 0) return;
    const checkExpiry = () => {
      const now = Date.now();
      Object.entries(scheduleOff).forEach(([deviceId, atMs]) => {
        if (atMs <= now) {
          handleControlWithRetry(deviceId, 'off');
          cancelScheduleOff(deviceId);
        }
      });
    };
    // 즉시 1회 체크 + 다음 만료까지 setTimeout
    checkExpiry();
    const nextAtMs = Math.min(...Object.values(scheduleOff));
    const waitMs = Math.max(500, nextAtMs - Date.now());
    const id = setTimeout(checkExpiry, waitMs);
    return () => clearTimeout(id);
  }, [scheduleOff, handleControlWithRetry, cancelScheduleOff]);

  // 일괄 제어 확인 대화상자
  const confirmBatchControl = useCallback((deviceList, command) => {
    const COMMAND_LABELS = { open: '열기', close: '닫기', stop: '정지', on: 'ON', off: 'OFF' };
    const cmdLabel = COMMAND_LABELS[command] || command;
    const deviceNames = deviceList.map(d => d.name || d.deviceId).join(', ');
    setConfirmAction({
      title: `전체 ${cmdLabel} 실행`,
      message: `수동 ${deviceList.length}대(${deviceNames})에 전체 ${cmdLabel}을 실행합니다.\n계속하시겠습니까?`,
      onConfirm: () => { setConfirmAction(null); handleBatchControl(deviceList, command); },
    });
  }, [handleBatchControl]);

  // 비상정지 확인
  const confirmEmergencyStop = useCallback(() => {
    setConfirmAction({
      title: '⚠ 비상정지',
      message: `등록된 모든 장치(${devices.length}대)를 즉시 정지/OFF 합니다.\n계속하시겠습니까?`,
      danger: true,
      onConfirm: () => { setConfirmAction(null); handleEmergencyStop(); },
    });
  }, [devices, handleEmergencyStop]);

  const getStatusDisplay = (status) => {
    const map = {
      opening:    { text: '열리는 중', color: '#15803d', bg: '#dcfce7', animate: true },
      closing:    { text: '닫히는 중', color: '#1d4ed8', bg: '#dbeafe', animate: true },
      stopping:   { text: '정지 중',  color: '#b45309', bg: '#fef3c7', animate: true },
      turning_on: { text: 'ON 전환',  color: '#15803d', bg: '#dcfce7', animate: true },
      turning_off:{ text: 'OFF 전환', color: '#475569', bg: '#f1f5f9', animate: true },
      open:       { text: '열림', color: '#15803d', bg: '#dcfce7', animate: false },
      closed:     { text: '닫힘', color: '#1d4ed8', bg: '#dbeafe', animate: false },
      on:         { text: 'ON',   color: '#15803d', bg: '#dcfce7', animate: false },
      off:        { text: 'OFF',  color: '#475569', bg: '#f1f5f9', animate: false },
      error:      { text: '오류', color: '#be123c', bg: '#fee2e2', animate: false },
    };
    return map[status] || { text: '대기', color: '#d97706', bg: '#fef3c7', animate: false };
  };

  // type + controlType 합성 키로 그룹화 — 같은 type 안에 단방향·양방향 섞여도 카드 분리
  // 예: valve(single) → 관수밸브 (단방향), valve(bidir) → 관수밸브 (양방향) 각자 카드
  const groupedDevices = {};
  devices.forEach(d => {
    const type = d.type || 'window';
    const ctrl = d.modbus?.controlType || (DEVICE_TYPE_INFO[type]?.commands?.includes('stop') ? 'bidir' : 'single');
    const groupKey = `${type}__${ctrl}`;
    if (!groupedDevices[groupKey]) groupedDevices[groupKey] = [];
    groupedDevices[groupKey].push(d);
  });

  // Modbus 작업 중 모든 제어 버튼 비활성화 (RS-485 half-duplex)
  const anyModbusBusy = Object.values(modbusStatus).some(s => s === 'verifying');

  // 대시보드 통일 스타일
  const btnBase = { padding: '16px 0', borderRadius: '10px', fontSize: '16px', fontWeight: 800, transition: 'all 0.15s', cursor: 'pointer', textAlign: 'center', border: '2px solid transparent', letterSpacing: '-0.01em', minHeight: '52px' };

  // 장치 유형별 컬러 테마 [from, to] — 대시보드 팔레트 기반
  const typeTheme = {
    window:      ['#2563eb', '#60a5fa'],  // Soft Blue
    side_window: ['#059669', '#10b981'],  // Emerald
    top_window:  ['#0891b2', '#06b6d4'],  // Cyan
    shade:       ['#6d28d9', '#8b5cf6'],  // Violet
    screen:      ['#7c3aed', '#a78bfa'],  // Purple
    pump:        ['#2563eb', '#3b82f6'],  // Royal Blue
    motor:       ['#475569', '#64748b'],  // Slate
    light:       ['#d97706', '#f59e0b'],  // Amber
    fan:         ['#0891b2', '#22d3ee'],  // Teal
    nutrient:    ['#047857', '#059669'],  // Forest
    solution:    ['#065f46', '#047857'],  // Deep Green
    light_ctrl:  ['#ea580c', '#f97316'],  // Orange
    sprayer:     ['#7c3aed', '#a78bfa'],  // Lavender
    heater:      ['#ea580c', '#fb923c'],  // Warm Orange
    cooler:      ['#0284c7', '#38bdf8'],  // Sky
    co2_supply:  ['#6d28d9', '#8b5cf6'],  // Indigo
    mist:        ['#06b6d4', '#67e8f9'],  // Ice
    valve:       ['#6366f1', '#818cf8'],  // Soft Indigo
    etc_device:  ['#64748b', '#94a3b8'],  // Gray
  };

  // 대시보드 스타일 동적 버튼
  const getAccentStyles = ([from, to]) => ({
    openActive:    { background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`, color: '#fff', boxShadow: `0 4px 12px ${from}40` },
    openInactive:  { background: from, color: '#fff', boxShadow: `0 2px 8px ${from}35` },
    openDisabled:  { background: '#e5e7eb', color: '#9ca3af', cursor: 'not-allowed' },
    stopActive:    { background: 'linear-gradient(135deg, #f59e0b, #d97706)', color: '#fff', boxShadow: '0 4px 12px rgba(245,158,11,0.4)' },
    stopInactive:  { background: '#f8fafc', color: '#6b7280', borderColor: '#e2e8f0' },
    stopUrgent:    { background: '#f59e0b', color: '#fff', boxShadow: '0 4px 12px rgba(245,158,11,0.5)', fontWeight: 800 },
    stopDisabled:  { background: '#f3f4f6', color: '#d1d5db', cursor: 'not-allowed' },
    closeActive:   { background: `linear-gradient(135deg, ${to} 0%, ${from} 100%)`, color: '#fff', boxShadow: `0 4px 12px ${to}40` },
    closeInactive: { background: to, color: '#fff', boxShadow: `0 2px 8px ${to}35` },
    closeDisabled: { background: '#e5e7eb', color: '#9ca3af', cursor: 'not-allowed' },
    onActive:      { background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)`, color: '#fff', boxShadow: `0 4px 12px ${from}40` },
    onInactive:    { background: from, color: '#fff', boxShadow: `0 2px 8px ${from}35` },
    offActive:     { background: '#64748b', color: '#fff', boxShadow: '0 2px 8px rgba(100,116,139,0.35)' },
    offInactive:   { background: '#f8fafc', color: '#6b7280', borderColor: '#e2e8f0' },
  });

  if (devices.length === 0) {
    return (
      <div className="glass-card p-4 md:p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base md:text-lg font-bold flex items-center gap-2" style={{color:'#111827'}}></h2>
          <button onClick={() => { setHistoryModal(true); loadHistory(1); }}
            style={{fontSize:12,color:'#4b5563',background:'#f3f4f6',padding:'8px 14px',borderRadius:8,border:'1px solid #e5e7eb',cursor:'pointer',fontWeight:600,minHeight:36}}>
            📋 제어이력
          </button>
        </div>
        <div className="text-center py-8">
          <div className="text-3xl mb-3 opacity-30">🎛️</div>
          <p style={{color:'#6b7280',fontSize:16}}>제어 장치가 없습니다</p>
          <p style={{color:'#9ca3af',fontSize:14}}>설정 → 제어 장치에서 장치를 추가하세요</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* 자동 OFF 예약 picker modal */}
      {pickerOpenFor && (
        <ScheduleOffPicker
          deviceId={pickerOpenFor}
          deviceName={Object.values(groupedDevices).flat().find(d => d.deviceId === pickerOpenFor)?.name}
          onPick={(delaySec) => {
            // 낙관적 UI + localStorage (브라우저 백업 — 데스크탑 탭 열어둘 때만)
            setScheduleForDevice(pickerOpenFor, delaySec);
            // NR 에 schedule-off 명령 전송 (NR function 2 가 setTimeout 등록 →
            //   브라우저 닫아도 핸드폰 잠궈도 NR 가 자체적으로 OFF 실행)
            const device = Object.values(groupedDevices).flat().find(d => d.deviceId === pickerOpenFor);
            if (device) {
              sendControlCommand(controlHouseId, pickerOpenFor, 'schedule-off', 'web_dashboard', {
                farmId, originalHouseId: houseId,
                deviceType: device.type || 'unknown',
                deviceName: device.name || pickerOpenFor,
                modbus: device.modbus,
                delaySec,
              }).catch(err => console.warn('schedule-off NR 전송 실패 — localStorage 만 동작:', err));
            }
          }}
          onClose={() => setPickerOpenFor(null)}
        />
      )}

      <div className="flex gap-3 mb-4" style={{background:'#f8fafc',padding:'12px',borderRadius:16,border:'1px solid #e2e8f0'}}>
          <button onClick={confirmEmergencyStop}
            disabled={anyModbusBusy}
            className="flex-1"
            style={{
              fontSize:15,fontWeight:800,color:'#fff',
              background: anyModbusBusy ? '#fca5a5' : 'linear-gradient(135deg, #ef4444, #dc2626)',
              padding:'14px 0',borderRadius:12,
              border:'none',minHeight:52,
              cursor: anyModbusBusy ? 'not-allowed' : 'pointer',
              boxShadow:'0 4px 12px rgba(220,38,38,0.3)',
              transition:'all 0.15s',
            }}>
            ⛔ 비상정지
          </button>
          <button
            onClick={handleApply}
            disabled={applyLoading || automationActive}
            className="flex-1"
            style={{
              fontSize:15,fontWeight:800,
              color: automationActive ? '#9ca3af' : '#fff',
              background: automationActive ? '#e5e7eb' : 'linear-gradient(135deg, #3b82f6, #1d4ed8)',
              padding:'14px 0',borderRadius:12,
              border:'none',minHeight:52,
              cursor: (applyLoading || automationActive) ? 'not-allowed' : 'pointer',
              boxShadow: automationActive ? 'none' : '0 4px 12px rgba(29,78,216,0.3)',
              transition:'all 0.15s',
            }}>
            {applyLoading ? '⏳' : '▶'} 자동화
          </button>
          <button
            onClick={handleStop}
            disabled={applyLoading || !automationActive}
            className="flex-1"
            style={{
              fontSize:15,fontWeight:800,
              color: !automationActive ? '#6b7280' : '#fff',
              background: !automationActive ? '#e5e7eb' : 'linear-gradient(135deg, #f59e0b, #d97706)',
              padding:'14px 0',borderRadius:12,
              border: !automationActive ? '2px solid #d1d5db' : 'none',
              minHeight:52,
              cursor: (applyLoading || !automationActive) ? 'not-allowed' : 'pointer',
              boxShadow: !automationActive ? 'none' : '0 4px 12px rgba(217,119,6,0.3)',
              transition:'all 0.15s',
            }}>
            {applyLoading ? '⏳' : '⏸'} 수동모드
          </button>
      </div>

      {Object.entries(groupedDevices).map(([groupKey, devicesInGroup]) => {
        const [type, groupCtrl] = groupKey.split('__');
        const typeInfo = DEVICE_TYPE_INFO[type] || { label: type, icon: '🔧', commands: ['on', 'off'] };
        // 그룹의 controlType 으로 버튼 분기 결정 (메타의 commands 가 아니라 실제 device 설정)
        const isToggleType = groupCtrl === 'single';
        const theme = typeTheme[type] || ['#94a3b8', '#64748b'];
        const accent = theme[0];
        const s = getAccentStyles(theme);
        // 같은 type 에 단방향·양방향 모두 있는 경우만 라벨에 표기 (혼동 방지)
        const hasMixedCtrl = Object.keys(groupedDevices).some(k => k !== groupKey && k.startsWith(`${type}__`));
        const ctrlLabel = hasMixedCtrl ? (groupCtrl === 'single' ? ' (단방향)' : ' (양방향)') : '';

        return (
          <div key={groupKey} style={{background:'#fff',borderRadius:16,marginBottom:16,overflow:'hidden',border:'1px solid #d1d5db',boxShadow:'0 4px 12px rgba(0,0,0,0.1)'}}>
            {/* 장치 유형 헤더 */}
            <div style={{background:`linear-gradient(135deg, ${theme[0]} 0%, ${theme[1]} 100%)`,padding:'14px 18px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <h3 style={{fontSize:16,fontWeight:800,color:'#fff',letterSpacing:'-0.01em'}} className="flex items-center gap-2">
                <span style={{fontSize:18}}>{typeInfo.icon}</span>
                <span>{typeInfo.label}{ctrlLabel}</span>
              </h3>
              <span style={{background:'rgba(255,255,255,0.2)',color:'#fff',fontSize:12,fontWeight:700,padding:'2px 10px',borderRadius:8}}>
                {devicesInGroup.length}대
              </span>
            </div>

            <div style={{padding:'16px'}}>
              {/* 개별 장치 제어 (위) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {devicesInGroup.map(device => {
                  const state = deviceStates[device.deviceId] || { status: 'idle' };
                  const statusDisplay = getStatusDisplay(state.status);
                  const isProcessing = ['opening', 'closing', 'stopping', 'turning_on', 'turning_off'].includes(state.status);
                  // 자기 장치 modbus 잠금만 체크 — RS-485 시리얼 큐는 Node-RED modbus-flex-write 가 처리
                  // anyModbusBusy 는 전역 잠금이라 다른 장치 verifying 중에 깜빡임(disable→enable) 발생
                  const myModbusBusy = modbusStatus[device.deviceId] === 'verifying';
                  const mode = getDeviceMode(device.deviceId);
                  const isAuto = mode === 'auto';

                  return (
                    <div key={device.deviceId}
                      style={{padding:'4px 2px',transition:'all 0.2s'}}>
                      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
                        <span style={{fontSize:15,fontWeight:800,color:'#0f172a'}}>{device.name}</span>
                        <div className="flex items-center gap-1.5">
                          {/* 수동/자동 모드 토글 */}
                          <button
                            onClick={() => !automationActive && toggleDeviceMode(device.deviceId)}
                            disabled={automationActive}
                            style={{
                              display:'flex',alignItems:'center',gap:5,
                              padding:'8px 12px',borderRadius:8,fontSize:12,fontWeight:700,minHeight:36,
                              border:`2px solid ${isAuto ? '#bbf7d0' : '#e2e8f0'}`,
                              background: isAuto ? '#f0fdf4' : '#f8fafc',
                              color: isAuto ? '#047857' : '#6b7280',
                              cursor: automationActive ? 'not-allowed' : 'pointer',
                              transition:'all 0.15s',
                              opacity: automationActive ? 0.6 : 1,
                            }}
                          >
                            <span style={{width:16,height:16,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,
                              background: isAuto ? '#059669' : '#94a3b8',color:'#fff'
                            }}>
                              {isAuto ? 'A' : 'M'}
                            </span>
                            {isAuto ? '자동' : '수동'}
                          </button>
                          {/* 자동 OFF 예약 — 수동 모드 + 토글형 (single) + 현재 ON 상태에서만 노출 */}
                          {!isAuto && isToggleType && (state.status === 'on' || state.status === 'turning_on') && (() => {
                            const atMs = scheduleOff[device.deviceId];
                            const isScheduled = atMs && atMs > tickNow;
                            const remainSec = isScheduled ? Math.floor((atMs - tickNow) / 1000) : 0;
                            const fmtRemain = (sec) => {
                              const h = Math.floor(sec / 3600);
                              const m = Math.floor((sec % 3600) / 60);
                              const s = sec % 60;
                              return h > 0
                                ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
                                : `${m}:${String(s).padStart(2,'0')}`;
                            };
                            return isScheduled ? (
                              <button
                                onClick={() => {
                                  cancelScheduleOff(device.deviceId);
                                  // NR 측 timer 도 취소
                                  sendControlCommand(controlHouseId, device.deviceId, 'schedule-off-cancel', 'web_dashboard', {
                                    farmId, originalHouseId: houseId,
                                  }).catch(() => {});
                                }}
                                title={`예약 취소 — ${new Date(atMs).toLocaleTimeString('ko-KR', {hour12:false})} 자동 OFF`}
                                style={{
                                  display:'flex',alignItems:'center',gap:5,
                                  padding:'8px 12px',borderRadius:8,fontSize:12,fontWeight:700,minHeight:36,
                                  border:'2px solid #fde68a',background:'#fef3c7',color:'#92400e',
                                  cursor:'pointer',
                                  fontFamily:'ui-monospace, monospace',
                                }}>
                                <span>⏱</span>
                                <span style={{minWidth:48,textAlign:'center'}}>{fmtRemain(remainSec)}</span>
                                <span style={{fontSize:13,marginLeft:2}}>✕</span>
                              </button>
                            ) : (
                              <button
                                onClick={() => setPickerOpenFor(device.deviceId)}
                                title="자동 OFF 예약"
                                style={{
                                  display:'flex',alignItems:'center',gap:5,
                                  padding:'8px 12px',borderRadius:8,fontSize:12,fontWeight:700,minHeight:36,
                                  border:'2px solid #e2e8f0',background:'#f8fafc',color:'#6b7280',
                                  cursor:'pointer',
                                }}>
                                <span>📅</span>
                                예약
                              </button>
                            );
                          })()}
                          {/* 상태 표시 */}
                          <div style={{display:'flex',alignItems:'center',gap:6,
                                       background: statusDisplay.bg || '#f1f5f9',
                                       padding:'8px 12px', borderRadius:8, minHeight:36,
                                       border:`2px solid ${statusDisplay.color}33`}}>
                            <span style={{width:9,height:9,borderRadius:'50%',background:statusDisplay.color,display:'inline-block',boxShadow:`0 0 8px ${statusDisplay.color}88`}} className={statusDisplay.animate ? 'animate-pulse' : ''} />
                            <span style={{fontSize:13,fontWeight:800,color:statusDisplay.color,letterSpacing:'0.02em'}}>{statusDisplay.text}</span>
                            {state.relayVerified && (
                              <span title="Modbus FC1 실제 확인" style={{fontSize:9,fontWeight:700,color:'#047857',background:'#dcfce7',padding:'1px 4px',borderRadius:4,marginLeft:2}}>HW</span>
                            )}
                            {/* error 리셋 버튼 */}
                            {state.status === 'error' && (
                              <button onClick={() => handleErrorReset(device.deviceId)}
                                style={{fontSize:10,fontWeight:700,color:'#dc2626',background:'#fee2e2',padding:'1px 6px',borderRadius:4,border:'1px solid #fca5a5',cursor:'pointer',marginLeft:2}}
                                title={state.errorReason || '오류 발생'}>
                                리셋
                              </button>
                            )}
                          </div>
                          {/* error 원인 표시 */}
                          {state.status === 'error' && state.errorReason && (
                            <span style={{fontSize:10,color:'#dc2626',fontWeight:600}}>{state.errorReason}</span>
                          )}
                          {/* 단계별 제어 진행 상태 */}
                          {controlStage[device.deviceId] && (
                            <div style={{
                              display:'flex',alignItems:'center',gap:3,
                              padding:'3px 8px',borderRadius:6,fontSize:10,fontWeight:700,
                              background: controlStage[device.deviceId] === 'done' ? '#ecfdf5' : controlStage[device.deviceId] === 'timeout' ? '#fef3c7' : controlStage[device.deviceId]?.startsWith?.('retry') ? '#fef3c7' : '#eff6ff',
                              color: controlStage[device.deviceId] === 'done' ? '#047857' : controlStage[device.deviceId] === 'timeout' ? '#d97706' : controlStage[device.deviceId]?.startsWith?.('retry') ? '#d97706' : '#2563eb',
                              border: `1px solid ${controlStage[device.deviceId] === 'done' ? '#a7f3d0' : controlStage[device.deviceId] === 'timeout' ? '#fde68a' : controlStage[device.deviceId]?.startsWith?.('retry') ? '#fde68a' : '#bfdbfe'}`,
                              transition:'all 0.3s',
                            }}>
                              {['sending', 'executing', 'verifying', 'hw_check'].includes(controlStage[device.deviceId]) || controlStage[device.deviceId]?.startsWith?.('retry') ? <span className="animate-spin" style={{display:'inline-block',width:9,height:9,border:'2px solid #93c5fd',borderTop:'2px solid #2563eb',borderRadius:'50%'}} /> : null}
                              {controlStage[device.deviceId] === 'sending' && '전송중'}
                              {controlStage[device.deviceId] === 'executing' && '실행중'}
                              {controlStage[device.deviceId] === 'verifying' && 'Modbus 확인중'}
                              {controlStage[device.deviceId] === 'hw_check' && 'HW 상태 확인중'}
                              {controlStage[device.deviceId] === 'retry_1' && '재시도 1/2'}
                              {controlStage[device.deviceId] === 'retry_2' && '재시도 2/2'}
                              {controlStage[device.deviceId] === 'done' && '✓ 완료'}
                              {controlStage[device.deviceId] === 'timeout' && '⚠ 타임아웃'}
                            </div>
                          )}
                        </div>
                      </div>

                      {isAuto ? (
                        <div>
                          {/* bidir 장치 위치 진행 바 — 자동 모드에서도 측창 현재 상태 시각화 */}
                          {device.modbus?.controlType === 'bidir' && (() => {
                            const pos = bidirPosition[device.deviceId];
                            const prog = bidirProgress[device.deviceId];
                            // 위치 표시는 backend 의 정확한 값(bidirPosition)만 신뢰.
                            // 옛: prog?.actualPos 가 timer 계산(추정)값이라 backend stop 메시지와 충돌 → 흔들림.
                            // 진행 중 시각화는 isMoving + 색상으로만 표현.
                            const displayPos = pos !== undefined ? pos : 0;
                            const isMoving = !!prog;
                            const movingDir = prog?.direction;
                            return (
                              <div style={{padding:'8px 10px',marginBottom:8,borderRadius:8,background:'#f8fafc',border:'1px solid #e2e8f0'}}>
                                {/* 1행: 측창 절대 위치 (초록) — 항상 표시 */}
                                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                                  <span style={{fontSize:11,fontWeight:700,color:'#475569'}}>
                                    📊 측창 위치 {isMoving && <span style={{color: movingDir === 'open' ? '#15803d' : '#1d4ed8',marginLeft:4}}>({movingDir === 'open' ? '▲ 여는 중' : '▼ 닫는 중'})</span>}
                                  </span>
                                  <span style={{fontSize:13,fontWeight:800,color: displayPos >= 100 ? '#15803d' : displayPos <= 0 ? '#64748b' : '#16a34a'}}>
                                    {displayPos}%
                                  </span>
                                </div>
                                <div style={{height:10,background:'#e5e7eb',borderRadius:5,position:'relative',overflow:'hidden'}}>
                                  <div style={{
                                    height:'100%',
                                    width:`${Math.max(0,Math.min(100,displayPos))}%`,
                                    background: displayPos >= 100 ? '#16a34a' : displayPos <= 0 ? '#94a3b8' : 'linear-gradient(90deg, #86efac, #22c55e)',
                                    transition: 'width 0.5s ease',
                                  }}/>
                                </div>
                                {/* 2행: 현재 동작 진행률 (파랑) — isMoving 일 때만 */}
                                {isMoving && prog?.percent !== undefined && (
                                  <>
                                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:8,marginBottom:4}}>
                                      <span style={{fontSize:10,fontWeight:700,color:'#475569'}}>
                                        ⏱️ 현재 동작 진행 {prog.remainSec !== undefined && <span style={{color:'#1d4ed8',marginLeft:4}}>(남은 {prog.remainSec}초)</span>}
                                      </span>
                                      <span style={{fontSize:11,fontWeight:800,color:'#1d4ed8'}}>
                                        {prog.percent}%
                                      </span>
                                    </div>
                                    <div style={{height:6,background:'#e5e7eb',borderRadius:3,overflow:'hidden'}}>
                                      <div style={{
                                        height:'100%',
                                        width:`${Math.max(0,Math.min(100,prog.percent))}%`,
                                        background: 'linear-gradient(90deg, #bfdbfe, #1d4ed8)',
                                        transition: 'width 0.3s linear',
                                        animation: 'pulse 1.5s ease-in-out infinite',
                                      }}/>
                                    </div>
                                  </>
                                )}
                                <div style={{display:'flex',justifyContent:'space-between',marginTop:3,fontSize:9,color:'#94a3b8',fontWeight:600}}>
                                  <span>닫힘</span>
                                  <span>열림</span>
                                </div>
                              </div>
                            );
                          })()}
                          {!automationActive && getDeviceRules(device.deviceId).length > 0 && (
                            <div style={{
                              display:'flex',alignItems:'center',gap:6,
                              padding:'6px 12px',marginBottom:8,borderRadius:8,
                              background:'#fef3c7',border:'2px solid #fde68a',
                            }}>
                              <span style={{fontSize:13}}>⏸</span>
                              <span style={{fontSize:12,fontWeight:700,color:'#b45309'}}>자동화 중지됨 — 적용 버튼을 눌러 시작하세요</span>
                            </div>
                          )}
                          <DeviceAutoRules
                            deviceId={device.deviceId}
                            rules={getDeviceRules(device.deviceId)}
                            expandedRuleId={expandedRuleId}
                            onToggleExpand={(id) => setExpandedRuleId(prev => prev === id ? null : id)}
                            automationActive={automationActive}
                            scheduleMap={scheduleMap}
                            latestSensors={latestSensors}
                            lastSensorTs={lastSensorTs}
                            bidirPosition={bidirPosition}
                          />
                        </div>
                      ) : isToggleType ? (
                        <div className="grid grid-cols-2 gap-3">
                          <button onClick={() => handleControlWithRetry(device.deviceId, 'on')}
                            disabled={myModbusBusy || isProcessing || state.status === 'on'}
                            style={{...btnBase, ...(state.status === 'on' || state.status === 'turning_on' ? s.onActive : s.onInactive), ...(myModbusBusy || isProcessing || state.status === 'on' ? {opacity:0.4,cursor:'not-allowed'} : {})}}>
                            {state.status === 'turning_on' ? '⏳ 전환중...' : state.status === 'on' ? '● ON' : '◉ ON'}
                          </button>
                          <button onClick={() => handleControlWithRetry(device.deviceId, 'off')}
                            disabled={myModbusBusy || isProcessing || state.status === 'off' || state.status === 'idle'}
                            style={{...btnBase, ...(state.status === 'off' || state.status === 'idle' || state.status === 'turning_off' ? s.offActive : s.offInactive), ...(myModbusBusy || isProcessing || state.status === 'off' || state.status === 'idle' ? {opacity:0.4,cursor:'not-allowed'} : {})}}>
                            {state.status === 'turning_off' ? '⏳ 전환중...' : '○ OFF'}
                          </button>
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 gap-2">
                          {(() => {
                            const prog = bidirProgress[device.deviceId];
                            const pos = bidirPosition[device.deviceId]; // 현재 열림 위치 (0~100%)
                            const posLabel = (pos !== undefined && pos !== null && !prog) ? ` (${pos}%)` : '';
                            const curActualPos = prog ? (prog.actualPos ?? pos ?? 0) : (pos ?? 0);
                            const openLabel = prog && prog.direction === 'open'
                              ? `▲ ${curActualPos}% (${prog.remainSec}초)`
                              : state.status === 'opening' ? '⏳ 여는중...' : '▲ 열기';
                            const closeLabel = prog && prog.direction === 'close'
                              ? `▼ ${curActualPos}% (${prog.remainSec}초)`
                              : state.status === 'closing' ? '⏳ 닫는중...' : '▼ 닫기';
                            const stopLabel = prog
                              ? `⛔ ${curActualPos}%`
                              : (pos !== undefined && pos !== null)
                                ? `■ ${pos}%`
                                : (state.status === 'stopping' ? '⏳ 정지중...' : '■ 정지');
                            return (
                              <>
                                <button onClick={() => handleControlWithRetry(device.deviceId, 'open')}
                                  disabled={myModbusBusy || isProcessing || state.status === 'open' || !!prog}
                                  style={{...btnBase, ...(state.status === 'open' || state.status === 'opening' || (prog && prog.direction === 'open') ? s.openActive : (myModbusBusy || isProcessing || state.status === 'open' || (prog && prog.direction === 'close')) ? s.openDisabled : s.openInactive)}}>
                                  {openLabel}
                                </button>
                                <button onClick={() => handleControlWithRetry(device.deviceId, 'stop')}
                                  disabled={myModbusBusy || (!prog && state.status === 'idle' && (pos === undefined || pos === null)) || state.status === 'stopping'}
                                  style={{...btnBase, ...(state.status === 'stopping' ? s.stopActive : (prog || state.status === 'opening' || state.status === 'closing') ? s.stopUrgent : (myModbusBusy || state.status === 'idle') ? s.stopDisabled : s.stopInactive),
                                    ...(prog || (pos !== undefined && pos !== null && pos > 0 && pos < 100) ? { fontSize: 15, fontWeight: 900, color: '#1e40af', background: '#dbeafe', border: '2px solid #93c5fd' } : (pos !== undefined && pos !== null) ? { fontSize: 14, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', border: '1px solid #e5e7eb' } : {})
                                  }}>
                                  {stopLabel}
                                </button>
                                <button onClick={() => handleControlWithRetry(device.deviceId, 'close')}
                                  disabled={myModbusBusy || isProcessing || state.status === 'closed' || !!prog}
                                  style={{...btnBase, ...(state.status === 'closed' || state.status === 'closing' || (prog && prog.direction === 'close') ? s.closeActive : (myModbusBusy || isProcessing || state.status === 'closed' || (prog && prog.direction === 'open')) ? s.closeDisabled : s.closeInactive)}}>
                                  {closeLabel}
                                </button>
                              </>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* 전체 제어 (아래) - 수동 모드 장치만 대상 */}
              {devicesInGroup.length >= 2 && (() => {
                const manualDevices = devicesInGroup.filter(d => getDeviceMode(d.deviceId) !== 'auto');
                const allAuto = manualDevices.length === 0;
                return (
                <div style={{marginTop:14,paddingTop:14,borderTop:'2px solid #e2e8f0'}}>
                  <div style={{fontSize:13,fontWeight:700,color:'#374151',marginBottom:10,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                    <div className="flex items-center gap-1.5">
                      <span style={{width:4,height:14,background:accent,borderRadius:2,display:'inline-block'}}/>
                      전체제어
                    </div>
                    {manualDevices.length < devicesInGroup.length && (
                      <span style={{fontSize:11,color:'#9ca3af',fontWeight:600}}>수동 {manualDevices.length}대만 적용</span>
                    )}
                  </div>
                  {isToggleType ? (
                    <div className="flex gap-2">
                      <button onClick={() => confirmBatchControl(manualDevices, 'on')}
                        disabled={anyModbusBusy || allAuto}
                        style={{...btnBase,flex:1,background: (anyModbusBusy || allAuto) ? '#e5e7eb' : accent,color: (anyModbusBusy || allAuto) ? '#9ca3af' : '#fff',boxShadow: (anyModbusBusy || allAuto) ? 'none' : `0 2px 8px ${accent}35`, cursor: (anyModbusBusy || allAuto) ? 'not-allowed' : 'pointer'}}>
                        전체 ON
                      </button>
                      <button onClick={() => confirmBatchControl(manualDevices, 'off')}
                        disabled={anyModbusBusy || allAuto}
                        style={{...btnBase,flex:1,background: (anyModbusBusy || allAuto) ? '#e5e7eb' : '#64748b',color: (anyModbusBusy || allAuto) ? '#9ca3af' : '#fff',boxShadow: (anyModbusBusy || allAuto) ? 'none' : '0 2px 8px rgba(100,116,139,0.35)', cursor: (anyModbusBusy || allAuto) ? 'not-allowed' : 'pointer'}}>
                        전체 OFF
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => confirmBatchControl(manualDevices, 'open')}
                        disabled={anyModbusBusy || allAuto}
                        style={{...btnBase,flex:1,background: (anyModbusBusy || allAuto) ? '#e5e7eb' : accent,color: (anyModbusBusy || allAuto) ? '#9ca3af' : '#fff',boxShadow: (anyModbusBusy || allAuto) ? 'none' : `0 2px 8px ${accent}35`, cursor: (anyModbusBusy || allAuto) ? 'not-allowed' : 'pointer'}}>
                        ▲ 전체 열기
                      </button>
                      <button onClick={() => confirmBatchControl(manualDevices, 'stop')}
                        disabled={anyModbusBusy || allAuto}
                        style={{...btnBase,flex:1,background: (anyModbusBusy || allAuto) ? '#e5e7eb' : '#d97706',color: (anyModbusBusy || allAuto) ? '#9ca3af' : '#fff',boxShadow: (anyModbusBusy || allAuto) ? 'none' : '0 2px 8px rgba(217,119,6,0.35)', cursor: (anyModbusBusy || allAuto) ? 'not-allowed' : 'pointer'}}>
                        ■ 전체 정지
                      </button>
                      <button onClick={() => confirmBatchControl(manualDevices, 'close')}
                        disabled={anyModbusBusy || allAuto}
                        style={{...btnBase,flex:1,background: (anyModbusBusy || allAuto) ? '#e5e7eb' : theme[1],color: (anyModbusBusy || allAuto) ? '#9ca3af' : '#fff',boxShadow: (anyModbusBusy || allAuto) ? 'none' : `0 2px 8px ${theme[1]}35`, cursor: (anyModbusBusy || allAuto) ? 'not-allowed' : 'pointer'}}>
                        ▼ 전체 닫기
                      </button>
                    </div>
                  )}
                </div>
                );
              })()}
            </div>
          </div>
        );
      })}

      {/* 배치 제어 진행 상태 */}
      {batchProgress && (
        <div style={{ margin: '12px 0', padding: '12px 16px', background: batchProgress.complete ? '#ecfdf5' : '#eff6ff', border: `1px solid ${batchProgress.complete ? '#a7f3d0' : '#bfdbfe'}`, borderRadius: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
          {!batchProgress.complete && (
            <div style={{ width: 20, height: 20, border: '2px solid #93c5fd', borderTop: '2px solid #2563eb', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
          )}
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: batchProgress.complete ? '#047857' : '#1d4ed8' }}>
              {batchProgress.complete
                ? `전체 ${batchProgress.command} 완료 (${batchProgress.total}개)`
                : `${batchProgress.command} 진행 중... (${batchProgress.current}/${batchProgress.total})`
              }
            </div>
            {!batchProgress.complete && (
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                {batchProgress.done
                  ? `✓ Modbus 완료${batchProgress.modbusOk === false ? ' (타임아웃)' : ''} — 다음 명령 전송`
                  : batchProgress.waiting
                    ? `⏳ ${batchProgress.deviceName} Modbus 완료 대기 중...`
                    : `→ ${batchProgress.deviceName} ${batchProgress.command} 중`}
              </div>
            )}
          </div>
          <div style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%`, height: 4, background: batchProgress.complete ? '#10b981' : '#3b82f6', borderRadius: 2, minWidth: 20, maxWidth: 120, transition: 'width 0.3s' }} />
        </div>
      )}

      {/* 최근 제어 이력 */}
      {controlHistory.length > 0 && (
        <div style={{marginTop:16,paddingTop:16,borderTop:'2px solid #e5e7eb'}}>
          <h3 style={{fontSize:13,fontWeight:800,color:'#374151',letterSpacing:'-0.01em',marginBottom:8}}>최근 제어</h3>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {controlHistory.slice(0, 5).map((log, idx) => (
              <div key={idx} style={{display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:13,background:'#f9fafb',borderRadius:8,padding:'8px 12px',border:'1px solid #e5e7eb'}}>
                <div className="flex items-center gap-2">
                  <span style={{color: log.success ? '#047857' : '#be123c'}}>{log.success ? '✔' : '✗'}</span>
                  <span style={{color:'#6b7280'}}>{getDeviceName(log.deviceId)}</span>
                  <span style={{color:'#111827',fontWeight:700}}>{log.command.toUpperCase()}</span>
                  <span style={{color:'#9ca3af',borderLeft:'1px solid #e5e7eb',paddingLeft:6}}>
                    {log.operatorName || '수동'}
                  </span>
                </div>
                <span style={{color:'#9ca3af'}}>
                  {new Date(log.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 제어이력 모달 */}
      {historyModal && createPortal(
        <ControlHistoryModal
          logs={historyLogs}
          loading={historyLoading}
          total={historyTotal}
          page={historyPage}
          houseConfig={houseConfig}
          controlHouseId={controlHouseId}
          onPageChange={(p) => { setHistoryPage(p); loadHistory(p); }}
          onRefresh={() => loadHistory(historyPage)}
          onClose={() => setHistoryModal(false)}
        />,
        document.body
      )}

      {/* 규칙 선택 팝업 폐기 — 자동화 관리 화면의 활성/비활성 토글이 단일 진실 원천 */}


      {/* 확인 대화상자 */}
      {confirmAction && createPortal(
        <div style={{position:'fixed',inset:0,zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.5)',backdropFilter:'blur(4px)'}}>
          <div style={{background:'#fff',borderRadius:16,padding:'24px 28px',maxWidth:420,width:'90%',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
            <h3 style={{fontSize:18,fontWeight:800,color: confirmAction.danger ? '#dc2626' : '#111827',marginBottom:12,display:'flex',alignItems:'center',gap:8}}>
              {confirmAction.danger ? '⚠' : '🔔'} {confirmAction.title}
            </h3>
            <p style={{fontSize:14,color:'#4b5563',lineHeight:1.6,whiteSpace:'pre-line',marginBottom:20}}>
              {confirmAction.message}
            </p>
            <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
              <button onClick={() => setConfirmAction(null)}
                style={{padding:'10px 20px',borderRadius:10,fontSize:14,fontWeight:700,background:'#f3f4f6',color:'#4b5563',border:'1px solid #e5e7eb',cursor:'pointer',minWidth:80}}>
                취소
              </button>
              <button onClick={confirmAction.onConfirm}
                style={{padding:'10px 20px',borderRadius:10,fontSize:14,fontWeight:700,
                  background: confirmAction.danger ? '#dc2626' : '#1d4ed8',
                  color:'#fff',border:'none',cursor:'pointer',minWidth:80,
                  boxShadow: `0 2px 8px ${confirmAction.danger ? 'rgba(220,38,38,0.4)' : 'rgba(29,78,216,0.35)'}`,
                }}>
                {confirmAction.danger ? '비상정지 실행' : '실행'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 토스트 알림 (bidir 동작 시간 누락 등) */}
      {toast && createPortal(
        <div style={{position:'fixed',bottom:24,right:24,zIndex:10001,maxWidth:420,minWidth:280,
          background: toast.kind === 'warn' ? '#fef3c7' : '#dbeafe',
          color: toast.kind === 'warn' ? '#92400e' : '#1e3a8a',
          border: `1.5px solid ${toast.kind === 'warn' ? '#fbbf24' : '#60a5fa'}`,
          borderRadius:12,padding:'14px 16px',boxShadow:'0 10px 30px rgba(0,0,0,0.2)',
          display:'flex',alignItems:'flex-start',gap:10,fontSize:13,lineHeight:1.5,fontWeight:600,
          animation:'slideInRight 0.2s ease-out'}}>
          <span style={{fontSize:18,flexShrink:0}}>{toast.kind === 'warn' ? '⚠' : 'ℹ'}</span>
          <span style={{flex:1}}>{toast.message}</span>
          <button onClick={() => setToast(null)} style={{background:'transparent',border:'none',color:'inherit',cursor:'pointer',fontSize:16,padding:0,lineHeight:1,opacity:0.6}}>✕</button>
        </div>,
        document.body
      )}

      {/* 자동화 규칙 충돌 경고 모달 */}
      {conflictWarning && createPortal(
        <div style={{position:'fixed',inset:0,zIndex:10000,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.6)',backdropFilter:'blur(4px)'}}>
          <div style={{background:'#fff',borderRadius:16,padding:'24px 28px',maxWidth:520,width:'92%',boxShadow:'0 20px 60px rgba(0,0,0,0.3)',maxHeight:'80vh',display:'flex',flexDirection:'column'}}>
            <h3 style={{fontSize:18,fontWeight:800,color:'#dc2626',marginBottom:8,display:'flex',alignItems:'center',gap:8}}>
              ⚠ 자동화 규칙 충돌 감지
            </h3>
            <p style={{fontSize:13,color:'#4b5563',lineHeight:1.6,marginBottom:16}}>
              같은 장치에 상반된 명령을 내리는 규칙이 있습니다.<br/>
              <b>충돌을 해결할 때까지 자동화를 적용할 수 없습니다.</b><br/>
              설정에서 규칙을 수정하거나, 충돌되는 규칙의 선택을 해제하세요.
            </p>
            <div style={{flex:1,overflowY:'auto',marginBottom:16}}>
              {conflictWarning.conflicts.map((c, idx) => (
                <div key={idx} style={{
                  padding:'12px 14px',marginBottom:8,borderRadius:12,
                  background:'#fef2f2',border:'2px solid #fecaca',
                }}>
                  <div style={{fontSize:13,fontWeight:700,color:'#991b1b',marginBottom:4}}>
                    {DEVICE_TYPE_INFO[devices.find(d => d.deviceId === c.deviceId)?.type]?.icon || '🔧'} {c.deviceId}
                  </div>
                  <div style={{fontSize:12,color:'#7f1d1d',lineHeight:1.6}}>
                    <span style={{fontWeight:700}}>규칙A:</span> {c.ruleA.name} → <span style={{fontWeight:700,color:'#dc2626'}}>{c.cmdA.toUpperCase()}</span>
                    <br/>
                    <span style={{fontWeight:700}}>규칙B:</span> {c.ruleB.name} → <span style={{fontWeight:700,color:'#dc2626'}}>{c.cmdB.toUpperCase()}</span>
                    <br/>
                    <span style={{color:'#9ca3af',fontSize:11}}>트리거: {c.timeInfo}</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{display:'flex',justifyContent:'flex-end'}}>
              <button onClick={() => setConflictWarning(null)}
                style={{padding:'10px 24px',borderRadius:10,fontSize:14,fontWeight:700,
                  background:'#dc2626',color:'#fff',border:'none',cursor:'pointer',
                  boxShadow:'0 2px 8px rgba(220,38,38,0.4)'}}>
                확인
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

/** 제어이력 모달 */
const HISTORY_CMD = {
  open: { l: '열기', bg: '#dcfce7', c: '#15803d' }, close: { l: '닫기', bg: '#dbeafe', c: '#1d4ed8' },
  stop: { l: '정지', bg: '#fef3c7', c: '#b45309' }, on: { l: 'ON', bg: '#dcfce7', c: '#15803d' }, off: { l: 'OFF', bg: '#f3f4f6', c: '#4b5563' },
};
const SOURCE_MAP = {
  web_dashboard: { icon: '🌐', label: '원격제어' },
  touch_panel:   { icon: '📱', label: '터치패널' },
  local:         { icon: '📱', label: '로컬제어' },
  rpi_local:     { icon: '📱', label: '로컬제어' },
  automation:    { icon: '🤖', label: '자동제어' },
  scheduler:     { icon: '🤖', label: '스케줄러' },
};

const ControlHistoryModal = ({ logs, loading, total, page, houseConfig, controlHouseId, onPageChange, onRefresh, onClose }) => {
  const totalPages = Math.ceil(total / 20) || 1;

  const fmtDate = (iso) => {
    const d = new Date(iso);
    const Y = d.getFullYear();
    const M = String(d.getMonth() + 1).padStart(2, '0');
    const D = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return { date: `${Y}-${M}-${D}`, time: `${h}:${m}:${s}` };
  };

  const getSource = (log) => {
    if (log.isAutomatic) return SOURCE_MAP.automation;
    return SOURCE_MAP[log.operator] || { icon: '👆', label: log.operator || '수동' };
  };

  return (
    <div style={{position:'fixed',inset:0,zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.5)'}} onClick={onClose}>
      <div style={{background:'#fff',borderRadius:16,width:'96%',maxWidth:640,maxHeight:'85vh',display:'flex',flexDirection:'column',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}} onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div style={{padding:'14px 20px',borderBottom:'2px solid #e5e7eb',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div>
            <h3 style={{fontSize:16,fontWeight:800,color:'#0f172a'}}>📋 제어 이력</h3>
            <span style={{fontSize:12,color:'#6b7280'}}>{houseConfig?.houseName || controlHouseId} · 총 {total}건</span>
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <button onClick={onRefresh} style={{border:'1px solid #e5e7eb',background:'#f9fafb',borderRadius:8,padding:'4px 10px',fontSize:13,cursor:'pointer',color:'#6b7280'}}>🔄</button>
            <button onClick={onClose} style={{border:'none',background:'transparent',fontSize:20,cursor:'pointer',color:'#9ca3af',padding:'4px'}}>✕</button>
          </div>
        </div>

        {/* 이력 목록 */}
        <div style={{flex:1,overflowY:'auto',padding:'4px 0'}}>
          {loading ? (
            <div style={{textAlign:'center',padding:'40px 0',color:'#9ca3af'}}>로딩 중...</div>
          ) : logs.length === 0 ? (
            <div style={{textAlign:'center',padding:'40px 0',color:'#9ca3af',fontSize:14}}>제어 이력이 없습니다</div>
          ) : logs.map((log, idx) => {
            const cmd = HISTORY_CMD[log.command] || { l: log.command, bg: '#f3f4f6', c: '#4b5563' };
            const { date, time } = fmtDate(log.createdAt);
            const source = getSource(log);

            return (
              <div key={log._id || idx} style={{padding:'10px 16px',borderBottom:'1px solid #f3f4f6'}}>
                {/* 1행: 날짜시간 + 장치 + 명령 + 결과 */}
                <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
                  <span style={{fontSize:12,color:'#6b7280',fontFamily:'monospace',flexShrink:0}}>{date} {time}</span>
                  <span style={{fontSize:13,fontWeight:700,color:'#1f2937'}}>{log.deviceName || log.deviceId}</span>
                  <span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:6,background:cmd.bg,color:cmd.c}}>{cmd.l}</span>
                  <span style={{fontSize:12,fontWeight:600,color: log.success ? '#047857' : '#be123c'}}>{log.success ? '✓ 성공' : '✗ 실패'}</span>
                </div>
                {/* 2행: 조작자 + 제어방식 + 자동화 사유 */}
                <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                  {log.operatorName && (
                    <span style={{fontSize:11,padding:'1px 7px',borderRadius:6,background:'#eff6ff',color:'#1d4ed8',border:'1px solid #dbeafe',fontWeight:600}}>
                      👤 {log.operatorName}
                    </span>
                  )}
                  <span style={{fontSize:11,padding:'1px 7px',borderRadius:6,background: log.isAutomatic ? '#f5f3ff' : '#f0fdf4',
                    color: log.isAutomatic ? '#7c3aed' : '#15803d', border: `1px solid ${log.isAutomatic ? '#ede9fe' : '#dcfce7'}`,fontWeight:600}}>
                    {source.icon} {source.label}
                  </span>
                  {log.automationReason && (
                    <span style={{fontSize:11,padding:'1px 7px',borderRadius:6,background:'#fefce8',color:'#a16207',border:'1px solid #fef3c7'}}>
                      📌 {log.automationReason}
                    </span>
                  )}
                  {!log.success && log.error && (
                    <span style={{fontSize:11,padding:'1px 7px',borderRadius:6,background:'#fef2f2',color:'#be123c',border:'1px solid #fecaca'}}>
                      {log.error}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 페이지네이션 */}
        <div style={{padding:'10px 16px',borderTop:'2px solid #e5e7eb',display:'flex',alignItems:'center',justifyContent:'center',gap:12}}>
          <button onClick={() => onPageChange(Math.max(1, page - 1))} disabled={page <= 1}
            style={{padding:'6px 14px',borderRadius:8,border:'1px solid #e5e7eb',background:'#f9fafb',fontSize:13,cursor: page <= 1 ? 'default' : 'pointer',opacity: page <= 1 ? 0.3 : 1,color:'#4b5563'}}>← 이전</button>
          <span style={{fontSize:13,color:'#6b7280',fontWeight:600}}>{page} / {totalPages}</span>
          <button onClick={() => onPageChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages}
            style={{padding:'6px 14px',borderRadius:8,border:'1px solid #e5e7eb',background:'#f9fafb',fontSize:13,cursor: page >= totalPages ? 'default' : 'pointer',opacity: page >= totalPages ? 0.3 : 1,color:'#4b5563'}}>다음 →</button>
        </div>
      </div>
    </div>
  );
};

// ────────────────────────────────────────────────────────────────
// 자동 OFF 예약 picker — preset (5분~4시간) + 분 직접 입력
// MVP: 단순 모달. 종료 시각 지정 (e.g. 18:30) 은 추후 추가 가능.
// ────────────────────────────────────────────────────────────────
const SCHEDULE_OFF_PRESETS = [
  { label: '5분',   sec: 5 * 60 },
  { label: '15분',  sec: 15 * 60 },
  { label: '30분',  sec: 30 * 60 },
  { label: '1시간', sec: 60 * 60 },
  { label: '2시간', sec: 120 * 60 },
  { label: '4시간', sec: 240 * 60 },
];
const ScheduleOffPicker = ({ deviceId, deviceName, onPick, onClose }) => {
  const [customMin, setCustomMin] = React.useState('');
  const handleCustom = () => {
    const min = parseInt(customMin, 10);
    if (!min || min <= 0) return;
    onPick(min * 60);
  };
  return (
    <div onClick={onClose} style={{
      position:'fixed',inset:0,background:'rgba(15,23,42,0.55)',
      display:'flex',alignItems:'center',justifyContent:'center',
      zIndex:1000,padding:16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background:'#fff',borderRadius:16,maxWidth:380,width:'100%',
        padding:'18px 18px 16px',boxShadow:'0 20px 60px rgba(0,0,0,0.25)',
      }}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
          <div>
            <div style={{fontSize:16,fontWeight:800,color:'#0f172a'}}>🕒 자동 OFF 예약</div>
            <div style={{fontSize:12,color:'#64748b',marginTop:2}}>
              {deviceName || deviceId} — 선택한 시간 후 자동 종료
            </div>
          </div>
          <button onClick={onClose} style={{
            border:'none',background:'transparent',fontSize:22,color:'#94a3b8',
            cursor:'pointer',lineHeight:1,padding:4,
          }}>✕</button>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(3, 1fr)',gap:8,marginBottom:14}}>
          {SCHEDULE_OFF_PRESETS.map(p => (
            <button key={p.sec} onClick={() => onPick(p.sec)} style={{
              padding:'12px 8px',borderRadius:10,
              border:'1.5px solid #d1d5db',background:'#f8fafc',
              fontSize:14,fontWeight:700,color:'#1f2937',cursor:'pointer',
              transition:'all 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#dbeafe'; e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.color = '#1d4ed8'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#f8fafc'; e.currentTarget.style.borderColor = '#d1d5db'; e.currentTarget.style.color = '#1f2937'; }}
            >{p.label}</button>
          ))}
        </div>

        <div style={{borderTop:'1px solid #e5e7eb',paddingTop:12}}>
          <div style={{fontSize:12,color:'#6b7280',fontWeight:700,marginBottom:6}}>직접 입력 (분)</div>
          <div style={{display:'flex',gap:6}}>
            <input type="number" min="1" max="1440" value={customMin}
              onChange={(e) => setCustomMin(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCustom(); }}
              placeholder="예: 90"
              style={{
                flex:1,padding:'10px 12px',borderRadius:10,
                border:'1.5px solid #d1d5db',fontSize:14,fontWeight:600,
                outline:'none',color:'#0f172a',
              }} />
            <button onClick={handleCustom}
              disabled={!parseInt(customMin, 10) || parseInt(customMin, 10) <= 0}
              style={{
                padding:'10px 18px',borderRadius:10,border:'none',
                background:(!parseInt(customMin, 10) || parseInt(customMin, 10) <= 0) ? '#e5e7eb' : '#2563eb',
                color:(!parseInt(customMin, 10) || parseInt(customMin, 10) <= 0) ? '#9ca3af' : '#fff',
                fontSize:14,fontWeight:800,cursor:(!parseInt(customMin, 10) || parseInt(customMin, 10) <= 0) ? 'not-allowed' : 'pointer',
              }}>확인</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const OPERATOR_LABELS = { '>': '초과', '>=': '이상', '<': '미만', '<=': '이하' };
const COMMAND_LABELS = { open: '열기', close: '닫기', stop: '정지', on: 'ON', off: 'OFF' };
const DAYS_LABELS = { 1: '월', 2: '화', 3: '수', 4: '목', 5: '금', 6: '토', 0: '일' };

/** 다음 실행까지 카운트다운 (서버 스케줄 기반 — 정확한 시각) */
const NextRunCountdown = ({ nextRunAt }) => {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    if (!nextRunAt) return;
    const target = new Date(nextRunAt).getTime();

    const calcRemaining = () => {
      const diff = Math.max(0, Math.floor((target - Date.now()) / 1000));
      if (diff <= 0) { setRemaining('실행중...'); return; }
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      if (h > 0) setRemaining(`${h}시간 ${m}분 ${s}초`);
      else if (m > 0) setRemaining(`${m}분 ${s}초`);
      else setRemaining(`${s}초`);
    };

    calcRemaining();
    const timer = setInterval(calcRemaining, 1000);
    return () => clearInterval(timer);
  }, [nextRunAt]);

  if (!remaining) return null;
  return (
    <span style={{fontSize:14,fontWeight:700,padding:'3px 8px',borderRadius:8,background:'#fef3c7',color:'#b45309',border:'1px solid #fde68a',whiteSpace:'nowrap',animation:'pulse 2s ease-in-out infinite'}}>
      ⏱ {remaining}
    </span>
  );
};

/** 센서 조건 게이지 — 현재값·임계값·충족 영역 시각 표시 */
const SensorGauge = ({ condition, value }) => {
  const op = condition.operator;
  const threshold = parseFloat(condition.value);
  const cur = value !== undefined && value !== null ? parseFloat(value) : null;
  // 센서 종류에 따라 range 추정
  const sid = (condition.sensorId || '').toLowerCase();
  let range = [0, 100];
  if (sid.includes('temp')) range = [-10, 50];
  else if (sid.includes('humid')) range = [0, 100];
  else if (sid.includes('co2')) range = [0, 3000];
  else if (sid.includes('lux') || sid.includes('light')) range = [0, 100000];
  const [min, max] = range;
  const span = max - min;
  const thresholdPct = Math.max(0, Math.min(100, ((threshold - min) / span) * 100));
  const currentPct = cur !== null ? Math.max(0, Math.min(100, ((cur - min) / span) * 100)) : null;
  const isMet = cur !== null && (
    (op === '<' && cur < threshold) ||
    (op === '<=' && cur <= threshold) ||
    (op === '>' && cur > threshold) ||
    (op === '>=' && cur >= threshold) ||
    (op === '==' && Math.abs(cur - threshold) < 0.1)
  );
  const fillLeft = ['<', '<='].includes(op);
  return (
    <div style={{display:'flex',alignItems:'center',gap:6,marginTop:6}}>
      <div style={{flex:1,height:8,background:'#f3f4f6',borderRadius:4,position:'relative',minWidth:120}}>
        {/* 충족 영역 */}
        <div style={{
          position:'absolute',top:0,bottom:0,
          left: fillLeft ? 0 : `${thresholdPct}%`,
          right: fillLeft ? `${100 - thresholdPct}%` : 0,
          background: '#dcfce7', borderRadius: 4,
        }}/>
        {/* 임계 마커 */}
        <div style={{position:'absolute',left:`${thresholdPct}%`,top:-3,bottom:-3,width:2,background:'#7c3aed',transform:'translateX(-1px)'}}/>
        {/* 현재값 도트 */}
        {currentPct !== null && (
          <div style={{position:'absolute',left:`${currentPct}%`,top:-3,width:14,height:14,
            background: isMet ? '#16a34a' : '#ef4444',borderRadius:'50%',border:'2px solid #fff',
            boxShadow:'0 1px 2px rgba(0,0,0,0.3)',transform:'translateX(-7px)'}}/>
        )}
      </div>
      <span style={{fontSize:11,fontWeight:700,color:isMet ? '#16a34a' : '#7c3aed',whiteSpace:'nowrap'}}>
        {cur !== null ? cur.toFixed(1) : '--'} / {threshold}
      </span>
      <span style={{fontSize:10,fontWeight:800,padding:'2px 6px',borderRadius:6,
        background: isMet ? '#dcfce7' : '#f3f4f6',
        color: isMet ? '#15803d' : '#6b7280'}}>
        {isMet ? '✓ 충족' : '대기'}
      </span>
    </div>
  );
};

/** 자동화 발동 ETA 카운트다운 칩 (조건 충족 시 다음 평가까지 / 쿨다운 남은 시간) */
const AutomationEtaChip = ({ rule, isMet, lastSensorTs, bidirPosition = {} }) => {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!isMet) return null;
  // 측창·차광 등 bidir 액션이 이미 한계 도달이면 ② cross-check skip → ETA 의미 없음
  // 모든 bidir 액션이 already 상태면 '✓ 동작 완료' 표시
  let actions = rule.actions;
  if (typeof actions === 'string') { try { actions = JSON.parse(actions); } catch { actions = []; } }
  actions = actions || [];
  const bidirActions = actions.filter(a => a.command === 'open' || a.command === 'close');
  const allAlready = bidirActions.length > 0 && bidirActions.every(a => {
    const pos = bidirPosition[a.deviceId];
    if (pos === undefined) return false;
    return (a.command === 'open' && pos === 100) || (a.command === 'close' && pos === 0);
  });
  if (allAlready) {
    return (
      <span style={{fontSize:11,fontWeight:800,padding:'3px 8px',borderRadius:8,
        background:'#f1f5f9',color:'#64748b',border:'1px solid #cbd5e1',whiteSpace:'nowrap'}}>
        ✓ 동작 완료
      </span>
    );
  }
  const cooldownSec = rule.cooldownSeconds || rule.cooldown_seconds || 0;
  const lastTrig = rule.lastTriggeredAt || rule.last_triggered_at;
  const lastTrigTs = lastTrig ? new Date(lastTrig).getTime() : 0;
  const cooldownUntil = lastTrigTs + cooldownSec * 1000;
  const inCooldown = cooldownSec > 0 && now < cooldownUntil;
  const cooldownRemain = inCooldown ? Math.ceil((cooldownUntil - now) / 1000) : 0;
  const nextEvalAt = lastSensorTs ? lastSensorTs + 60 * 1000 : 0;
  const evalRemain = nextEvalAt > now ? Math.ceil((nextEvalAt - now) / 1000) : 0;
  const finalRemain = inCooldown ? Math.max(cooldownRemain, evalRemain) : evalRemain;
  const isCooldown = inCooldown && cooldownRemain > evalRemain;
  const fmt = (s) => {
    if (s <= 0) return '곧';
    if (s < 60) return `${s}초`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r > 0 ? `${m}분 ${r}초` : `${m}분`;
  };
  return (
    <span style={{
      fontSize:11,fontWeight:800,padding:'3px 8px',borderRadius:8,
      background: isCooldown ? '#fef3c7' : '#dcfce7',
      color: isCooldown ? '#b45309' : '#15803d',
      border: `1px solid ${isCooldown ? '#fde68a' : '#86efac'}`,
      whiteSpace:'nowrap',
      animation: finalRemain <= 5 && finalRemain > 0 ? 'pulse 1s ease-in-out infinite' : 'none',
    }}>
      {isCooldown ? `⏳ 쿨다운 ${fmt(finalRemain)}` : finalRemain > 0 ? `⏱ ${fmt(finalRemain)} 후 발동` : '🚀 곧 발동'}
    </span>
  );
};

/** 장치 자동 모드 - 적용된 활성 규칙 목록 (action.deviceId 매칭 + rule.enabled) */
const DeviceAutoRules = ({ deviceId, rules, expandedRuleId, onToggleExpand, automationActive, scheduleMap = {}, latestSensors = {}, lastSensorTs = null, bidirPosition = {} }) => {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:6}}>
      {rules.length === 0 && (
        <div style={{textAlign:'center',color:'#9ca3af',fontSize:12,padding:'8px 0',lineHeight:1.5}}>
          이 장치에 적용된 자동화 규칙이 없습니다<br/>
          <span style={{fontSize:11}}>자동화 관리 화면에서 규칙을 추가하세요</span>
        </div>
      )}
      {rules.map(rule => {
        const isExpanded = expandedRuleId === rule._id;
        const sensorConds = (rule.conditions || []).filter(c => c.type === 'sensor');
        const timeConds = (rule.conditions || []).filter(c => c.type === 'time');
        // 모든 센서 조건 충족 여부 (ETA 칩 표시 조건)
        const evalCond = (c) => {
          const cur = parseFloat(latestSensors[c.sensorId]);
          if (Number.isNaN(cur)) return false;
          const th = parseFloat(c.value);
          switch (c.operator) {
            case '<': return cur < th;
            case '<=': return cur <= th;
            case '>': return cur > th;
            case '>=': return cur >= th;
            case '==': return Math.abs(cur - th) < 0.1;
            default: return false;
          }
        };
        const allSensorMet = sensorConds.length > 0 && sensorConds.every(evalCond);

        return (
          <div key={rule._id} style={{borderRadius:10,border:'1.5px solid #bbf7d0',background:'#fff',overflow:'hidden'}}>
            {/* 규칙 헤더 */}
            <div
              onClick={() => onToggleExpand(rule._id)}
              style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 12px',cursor:'pointer',background: isExpanded ? '#f0fdf4' : '#fff'}}
            >
              <div style={{display:'flex',alignItems:'center',gap:8,flex:1,minWidth:0,flexWrap:'wrap'}}>
                <span style={{fontSize:14}}>🤖</span>
                <span style={{fontSize:14,fontWeight:700,color:'#0f172a',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{rule.name}</span>
                <span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:12,
                  background: rule.enabled ? '#dcfce7' : '#fee2e2',
                  color: rule.enabled ? '#15803d' : '#dc2626',
                }}>{rule.enabled ? '활성' : '비활성'}</span>
                {automationActive && rule.enabled && scheduleMap[rule._id] && <NextRunCountdown nextRunAt={scheduleMap[rule._id]} />}
                {automationActive && rule.enabled && sensorConds.length > 0 && (
                  <AutomationEtaChip rule={rule} isMet={allSensorMet} lastSensorTs={lastSensorTs} bidirPosition={bidirPosition} />
                )}
              </div>
              <div style={{display:'flex',alignItems:'center',gap:4,flexShrink:0}}>
                <span style={{fontSize:12,color:'#9ca3af'}}>{isExpanded ? '▲' : '▼'}</span>
              </div>
            </div>

            {/* 규칙 상세 */}
            {isExpanded && (
              <div style={{padding:'0 12px 12px',borderTop:'1px solid #e5e7eb'}}>
                {sensorConds.length > 0 && (
                  <div style={{marginTop:8}}>
                    <div style={{fontSize:11,fontWeight:700,color:'#7c3aed',marginBottom:4}}>센서 조건</div>
                    <div style={{display:'flex',flexDirection:'column',gap:6}}>
                      {sensorConds.map((c, i) => (
                        <div key={i} style={{padding:'6px 8px',borderRadius:8,background:'#f5f3ff',border:'1px solid #ddd6fe'}}>
                          <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                            {i > 0 && <span style={{fontSize:11,fontWeight:800,color:'#6b7280'}}>{c.logic || 'AND'}</span>}
                            <span style={{fontSize:12,fontWeight:700,color:'#6d28d9'}}>
                              {c.sensorName || c.sensorId} {OPERATOR_LABELS[c.operator] || c.operator} {c.value}
                            </span>
                          </div>
                          <SensorGauge condition={c} value={latestSensors[c.sensorId]} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {sensorConds.length > 0 && timeConds.length > 0 && (
                  <div style={{textAlign:'center',margin:'4px 0'}}>
                    <span style={{fontSize:11,fontWeight:800,padding:'2px 10px',borderRadius:10,
                      background: (rule.groupLogic || 'AND') === 'AND' ? '#eef2ff' : '#fff7ed',
                      color: (rule.groupLogic || 'AND') === 'AND' ? '#4f46e5' : '#ea580c'
                    }}>{rule.groupLogic || 'AND'}</span>
                  </div>
                )}
                {timeConds.length > 0 && (
                  <div style={{marginTop: sensorConds.length > 0 ? 0 : 8}}>
                    <div style={{fontSize:11,fontWeight:700,color:'#d97706',marginBottom:4}}>시간 조건</div>
                    {timeConds.map((c, i) => (
                      <div key={i} style={{marginBottom:6}}>
                        {/* 시간 뱃지 */}
                        <div style={{display:'flex',flexWrap:'wrap',gap:3,marginBottom:4}}>
                          {c.timeMode === 'interval' ? (
                            <span style={{fontSize:11,fontWeight:700,padding:'2px 7px',borderRadius:6,background:'#fffbeb',color:'#b45309',border:'1px solid #fde68a'}}>
                              ⏰ {c.startTime || '08:00'}~{c.endTime || '18:00'} / {c.intervalMinutes || 30}분 간격
                            </span>
                          ) : (c.times && c.times.length > 0) ? (
                            c.times.map((t, ti) => (
                              <span key={ti} style={{fontSize:11,fontWeight:700,padding:'2px 7px',borderRadius:6,background:'#fffbeb',color:'#b45309',border:'1px solid #fde68a'}}>
                                {t}
                              </span>
                            ))
                          ) : (
                            <span style={{fontSize:11,fontWeight:700,padding:'2px 7px',borderRadius:6,background:'#fffbeb',color:'#b45309',border:'1px solid #fde68a'}}>
                              {c.time || '--:--'}
                            </span>
                          )}
                        </div>
                        {/* 요일 뱃지 */}
                        <div style={{display:'flex',gap:3}}>
                          {[1,2,3,4,5,6,0].map(d => (
                            <span key={d} style={{
                              width:22,height:22,borderRadius:4,fontSize:10,fontWeight:700,
                              display:'flex',alignItems:'center',justifyContent:'center',
                              background: c.days?.includes(d) ? '#f59e0b' : '#f3f4f6',
                              color: c.days?.includes(d) ? '#fff' : '#9ca3af',
                            }}>
                              {DAYS_LABELS[d]}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{marginTop:8}}>
                  <div style={{fontSize:11,fontWeight:700,color:'#0369a1',marginBottom:4}}>실행 동작</div>
                  <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                    {(rule.actions || []).map((a, i) => {
                      const durStr = (() => {
                        if (!a.duration) return '';
                        const m = Math.floor(a.duration / 60), s = a.duration % 60;
                        if (m > 0 && s > 0) return ` ${m}분${s}초간`;
                        if (m > 0) return ` ${m}분간`;
                        return ` ${s}초간`;
                      })();
                      return (
                        <span key={i} style={{fontSize:12,fontWeight:600,padding:'3px 8px',borderRadius:8,background:'#f1f5f9',color:'#64748b',border:'1px solid #e2e8f0'}}>
                          {a.deviceName || a.deviceId} → {COMMAND_LABELS[a.command] || a.command}{durStr}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/** 자동화 규칙 선택 팝업 */
const RulePickerModal = ({ allRules, selectedIds, onToggle, onClose, deviceId }) => {
  const categoryMeta = {
    sensor:   { icon: '🌡️', label: '센서', bg: '#f5f3ff', color: '#7c3aed', border: '#ede9fe' },
    schedule: { icon: '⏰', label: '시간', bg: '#fffbeb', color: '#b45309', border: '#fef3c7' },
    custom:   { icon: '⚙️', label: '복합', bg: '#f0f9ff', color: '#0369a1', border: '#e0f2fe' },
  };
  const categorize = (rule) => {
    const hasSensor = rule.conditions?.some(c => c.type === 'sensor');
    const hasTime = rule.conditions?.some(c => c.type === 'time');
    if (hasSensor && hasTime) return 'custom';
    if (hasTime) return 'schedule';
    return 'sensor';
  };

  return (
    <div style={{position:'fixed',inset:0,zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.5)'}}
      onClick={onClose}>
      <div style={{background:'#fff',borderRadius:16,width:'90%',maxWidth:480,maxHeight:'70vh',display:'flex',flexDirection:'column',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}
        onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div style={{padding:'16px 20px',borderBottom:'2px solid #e5e7eb',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <h3 style={{fontSize:16,fontWeight:800,color:'#0f172a'}}>자동화 규칙 선택</h3>
          <button onClick={onClose} style={{border:'none',background:'transparent',fontSize:20,cursor:'pointer',color:'#9ca3af',padding:'4px'}}>✕</button>
        </div>

        {/* 규칙 목록 */}
        <div style={{flex:1,overflowY:'auto',padding:'12px 16px'}}>
          {allRules.length === 0 ? (
            <div style={{textAlign:'center',padding:'32px 0',color:'#9ca3af',fontSize:14}}>
              {deviceId
                ? <>이 장치({deviceId})를 대상으로 하는 규칙이 없습니다.<br/>설정에서 이 장치를 포함하는 규칙을 만들어주세요.</>
                : <>등록된 자동화 규칙이 없습니다.<br/>설정에서 먼저 규칙을 만들어주세요.</>
              }
            </div>
          ) : allRules.map(rule => {
            const isSelected = selectedIds.includes(rule._id);
            const cat = categorize(rule);
            const sensorConds = (rule.conditions || []).filter(c => c.type === 'sensor');
            const timeConds = (rule.conditions || []).filter(c => c.type === 'time');

            return (
              <div key={rule._id}
                onClick={() => onToggle(rule._id)}
                style={{
                  display:'flex',alignItems:'flex-start',gap:12,
                  padding:'12px 14px',marginBottom:8,borderRadius:12,cursor:'pointer',
                  border: isSelected ? '2px solid #22c55e' : '2px solid #e5e7eb',
                  background: isSelected ? '#f0fdf4' : '#fff',
                  transition:'all 0.15s',
                }}>
                {/* 체크박스 */}
                <div style={{
                  width:22,height:22,borderRadius:6,flexShrink:0,marginTop:1,
                  display:'flex',alignItems:'center',justifyContent:'center',
                  border: isSelected ? '2px solid #22c55e' : '2px solid #d1d5db',
                  background: isSelected ? '#22c55e' : '#fff',
                  color:'#fff',fontSize:14,fontWeight:900,
                }}>
                  {isSelected && '✓'}
                </div>
                {/* 규칙 정보 */}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:4,flexWrap:'wrap'}}>
                    <span style={{fontSize:11,fontWeight:700,padding:'1px 8px',borderRadius:10,
                      background: categoryMeta[cat].bg, color: categoryMeta[cat].color,
                      border: `1px solid ${categoryMeta[cat].border}`,
                    }}>{categoryMeta[cat].icon} {categoryMeta[cat].label}</span>
                    <span style={{fontSize:14,fontWeight:700,color:'#0f172a'}}>{rule.name}</span>
                    <span style={{fontSize:11,fontWeight:700,padding:'1px 8px',borderRadius:10,
                      background: rule.enabled ? '#dcfce7' : '#fee2e2',
                      color: rule.enabled ? '#15803d' : '#dc2626',
                    }}>{rule.enabled ? '활성' : '비활성'}</span>
                  </div>
                  {/* 조건 요약 */}
                  <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                    {sensorConds.map((c, i) => (
                      <span key={`s${i}`} style={{fontSize:11,padding:'2px 6px',borderRadius:6,background:'#f5f3ff',color:'#7c3aed',border:'1px solid #ede9fe'}}>
                        {c.sensorName || c.sensorId} {c.operator} {c.value}
                      </span>
                    ))}
                    {timeConds.map((c, i) => {
                      let tStr;
                      if (c.timeMode === 'interval') tStr = `${c.startTime}~${c.endTime} ${c.intervalMinutes}분`;
                      else if (c.timeMode === 'specific') tStr = (c.times || []).join(',');
                      else tStr = c.time || '--:--';
                      return (
                        <span key={`t${i}`} style={{fontSize:11,padding:'2px 6px',borderRadius:6,background:'#fffbeb',color:'#b45309',border:'1px solid #fef3c7'}}>
                          ⏰ {tStr}
                        </span>
                      );
                    })}
                  </div>
                  {/* 동작 요약 */}
                  <div style={{display:'flex',flexWrap:'wrap',gap:4,marginTop:4}}>
                    <span style={{fontSize:11,color:'#64748b'}}>→</span>
                    {(rule.actions || []).map((a, i) => {
                      const durStr = (() => {
                        if (!a.duration) return '';
                        const m = Math.floor(a.duration / 60), s = a.duration % 60;
                        if (m > 0 && s > 0) return ` ${m}분${s}초간`;
                        if (m > 0) return ` ${m}분간`;
                        return ` ${s}초간`;
                      })();
                      return (
                        <span key={i} style={{fontSize:11,padding:'2px 6px',borderRadius:6,background:'#eff6ff',color:'#1d4ed8',border:'1px solid #dbeafe'}}>
                          {a.deviceName || a.deviceId} {COMMAND_LABELS[a.command] || a.command}{durStr}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 푸터 */}
        <div style={{padding:'12px 16px',borderTop:'2px solid #e5e7eb',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <span style={{fontSize:13,color:'#64748b',fontWeight:600}}>
            {selectedIds.length}개 선택됨
          </span>
          <button onClick={onClose}
            style={{padding:'8px 24px',borderRadius:10,border:'none',background:'#22c55e',color:'#fff',fontSize:14,fontWeight:700,cursor:'pointer'}}>
            완료
          </button>
        </div>
      </div>
    </div>
  );
};

export default ControlPanel;
