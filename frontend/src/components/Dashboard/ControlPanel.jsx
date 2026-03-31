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
    try { return JSON.parse(localStorage.getItem(statesKey)) || {}; }
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
  const [conflictWarning, setConflictWarning] = useState(null); // { conflicts: [...] }

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

    // auto 모드 장치별로 선택된 규칙 수집
    const deviceRulesMap = {}; // { deviceId: [{ rule, action, timeConds }] }
    devices.forEach(d => {
      if (getDeviceMode(d.deviceId) !== 'auto') return;
      const selectedIds = selectedRuleMap[d.deviceId] || [];
      if (selectedIds.length === 0) return;

      selectedIds.forEach(ruleId => {
        const rule = autoRules.find(r => (r._id || r.id) === ruleId);
        if (!rule) return;
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

      // 자동화 활성 중일 때 RPi에 자동 모드 장치 목록 동기화
      if (automationActive) {
        const autoDeviceIds = devices
          .filter(d => (d.deviceId === deviceId ? next : (updated[d.deviceId] || 'manual')) === 'auto')
          .map(d => d.deviceId);
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
  const [rulePickerDevice, setRulePickerDevice] = useState(null); // 규칙 선택 팝업 대상 장치

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
      // WS 연결 후 MQTT로 릴레이 조회
      setTimeout(() => wsService.requestRelayStatus(farmId), 1500);
    }

    // WS 미연결 시에만 HTTP 폴링 (로컬 모드)
    if (!token || !apiBase || mode.isFarmLocal) {
      fetchRelayStatus();
      startRelayPolling();
    }

    const unsubRelay = wsService.subscribe('relay:status', (msg) => {
      if (msg.data) {
        const coils = msg.data.coils || msg.data;
        if (typeof coils === 'object') {
          const unitId = msg.data.unitId || 1;
          relayCoilsRef.current = { ...relayCoilsRef.current, [unitId]: coils };
          setRelayOnline(true);
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

    return () => {
      stopRelayPolling();
      unsubRelay();
      unsubRelayRes();
      unsubControl();
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

  // 장치별 선택된 규칙 ID 목록 (localStorage 기반)
  const rulesKey = `deviceRules_${farmId}_${houseId}`;
  const [selectedRuleMap, setSelectedRuleMap] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(rulesKey));
      return saved || {};
    } catch { return {}; }
  });

  // houseId 변경 시 설정 재로드 (서버 상태는 위 useEffect에서 처리)
  useEffect(() => {
    try { setDeviceModes(JSON.parse(localStorage.getItem(`deviceModes_${farmId}_${houseId}`)) || {}); }
    catch { setDeviceModes({}); }
    try { setSelectedRuleMap(JSON.parse(localStorage.getItem(`deviceRules_${farmId}_${houseId}`)) || {}); }
    catch { setSelectedRuleMap({}); }
  }, [farmId, houseId]);

  const getDeviceRules = (deviceId) => {
    const selectedIds = selectedRuleMap[deviceId] || [];
    return autoRules.filter(r => selectedIds.includes(r._id));
  };

  const toggleRuleSelection = (deviceId, ruleId) => {
    setSelectedRuleMap(prev => {
      const current = prev[deviceId] || [];
      const updated = current.includes(ruleId)
        ? current.filter(id => id !== ruleId)
        : [...current, ruleId];
      const next = { ...prev, [deviceId]: updated };
      localStorage.setItem(rulesKey, JSON.stringify(next));
      return next;
    });
  };

  const removeRuleFromDevice = (deviceId, ruleId) => {
    setSelectedRuleMap(prev => {
      const current = prev[deviceId] || [];
      const next = { ...prev, [deviceId]: current.filter(id => id !== ruleId) };
      localStorage.setItem(rulesKey, JSON.stringify(next));
      return next;
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
      const typeInfo = DEVICE_TYPE_INFO[device.type] || { commands: ['on', 'off'] };
      const stopCmd = typeInfo.commands.includes('stop') ? 'stop' : 'off';
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
      if (prog && prog.actualPos !== undefined) {
        setBidirPosition(prev => ({ ...prev, [deviceId]: prog.actualPos }));
      }
      setBidirProgress(prev => ({ ...prev, [deviceId]: null }));
      setDeviceStates(prev => ({ ...prev, [deviceId]: { ...prev[deviceId], status: 'idle', lastCommand: 'stop', lastCommandTime: new Date().toISOString() } }));
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
            // bidir 장치: openDuration/closeDuration 후 자동 정지 + 진행도 표시
            if (modbusConfig?.controlType === 'bidir' && (command === 'open' || command === 'close')) {
              const fullDur = command === 'open' ? modbusConfig.openDuration : modbusConfig.closeDuration;
              if (fullDur && fullDur > 0) {
                const curPos = bidirPositionRef.current[deviceId] || 0;
                // 남은 비율만큼만 동작: 열기면 (100-curPos)%, 닫기면 curPos%
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
                  // 실제 열림 위치 계산
                  const actualPos = command === 'open'
                    ? Math.min(100, Math.round(curPos + (100 - curPos) * (elapsed / autoDur)))
                    : Math.max(0, Math.round(curPos - curPos * (elapsed / autoDur)));
                  setBidirProgress(prev => ({ ...prev, [deviceId]: { percent: progressPct, direction: command, totalSec: autoDur, remainSec: Math.max(0, Math.round(autoDur - elapsed)), startPos: curPos, actualPos } }));
                  if (progressPct >= 100) clearInterval(timerRefs.current[progressKey]);
                }, 500);
                timerRefs.current[stopTimerKey] = setTimeout(() => {
                  handleControl(deviceId, 'stop');
                  timerRefs.current[stopTimerKey] = null;
                  clearInterval(timerRefs.current[progressKey]);
                  timerRefs.current[progressKey] = null;
                  setBidirProgress(prev => ({ ...prev, [deviceId]: null }));
                  // 100% 도달: 위치 업데이트
                  setBidirPosition(prev => ({ ...prev, [deviceId]: command === 'open' ? 100 : 0 }));
                }, autoDur * 1000);
              }
            }
          } else {
            // 타임아웃: 릴레이 상태 재확인으로 실제 동작 여부 검증
            setControlStage(prev => ({ ...prev, [deviceId]: 'hw_check' }));
            try {
              await fetchRelayStatus();
              const m = targetDevice?.modbus;
              const coils = m ? relayCoilsRef.current[m.unitId || 1] : null;
              if (coils && m) {
                const finalStatus = { open: 'open', close: 'closed', stop: 'idle', on: 'on', off: 'off' };
                const expectedStatus = finalStatus[command];
                let actualStatus;
                if (m.controlType === 'bidir') {
                  actualStatus = coils[m.address] ? 'open' : coils[m.address2] ? 'closed' : 'idle';
                } else {
                  actualStatus = coils[m.address] ? 'on' : 'off';
                }
                if (actualStatus === expectedStatus) {
                  // 실제로 동작했음 — 완료 처리
                  setModbusStatus(prev => ({ ...prev, [deviceId]: 'done' }));
                  setControlStage(prev => ({ ...prev, [deviceId]: 'done' }));
                  if (timerRefs.current[deviceId]) { clearTimeout(timerRefs.current[deviceId]); timerRefs.current[deviceId] = null; }
                  setDeviceStates(prev => ({ ...prev, [deviceId]: { ...prev[deviceId], status: expectedStatus, commandLock: false, relayVerified: true } }));
                } else {
                  setModbusStatus(prev => ({ ...prev, [deviceId]: 'timeout' }));
                  setControlStage(prev => ({ ...prev, [deviceId]: 'timeout' }));
                }
              } else {
                // Eletechsup 등 FC1 불가 장치 — 타임아웃 유지
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

        // bidir 장치: openDuration/closeDuration 후 자동 정지 + 진행도 표시
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
              handleControl(deviceId, 'stop');
              timerRefs.current[stopTimerKey] = null;
              clearInterval(timerRefs.current[progressKey]);
              timerRefs.current[progressKey] = null;
              setBidirProgress(prev => ({ ...prev, [deviceId]: null }));
              setBidirPosition(prev => ({ ...prev, [deviceId]: command === 'open' ? 100 : 0 }));
            }, autoDur * 1000);
          }
        }
      } else {
        setDeviceStates(prev => ({ ...prev, [deviceId]: { ...prev[deviceId], status: 'error', errorReason: result.error || '제어 실패' } }));
        setControlStage(prev => ({ ...prev, [deviceId]: null }));
      }
      return result;
    } catch (error) {
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
      opening:    { text: '열리는 중...', color: '#047857', animate: true },
      closing:    { text: '닫히는 중...', color: '#1d4ed8', animate: true },
      stopping:   { text: '정지 중...',  color: '#b45309', animate: true },
      turning_on: { text: 'ON 전환중...', color: '#047857', animate: true },
      turning_off:{ text: 'OFF 전환중...', color: '#6b7280', animate: true },
      open:       { text: '열림', color: '#047857', animate: false },
      closed:     { text: '닫힘', color: '#6b7280', animate: false },
      on:         { text: 'ON', color: '#047857', animate: false },
      off:        { text: 'OFF', color: '#6b7280', animate: false },
      error:      { text: '오류', color: '#be123c', animate: false },
    };
    return map[status] || { text: '대기', color: '#6b7280', animate: false };
  };

  const groupedDevices = {};
  devices.forEach(d => { const type = d.type || 'window'; if (!groupedDevices[type]) groupedDevices[type] = []; groupedDevices[type].push(d); });

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
    <div className="glass-card p-4 md:p-5">
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

      {Object.entries(groupedDevices).map(([type, devicesInGroup]) => {
        const typeInfo = DEVICE_TYPE_INFO[type] || { label: type, icon: '🔧', commands: ['on', 'off'] };
        const isToggleType = !typeInfo.commands.includes('stop');
        const theme = typeTheme[type] || ['#94a3b8', '#64748b'];
        const accent = theme[0];
        const s = getAccentStyles(theme);

        return (
          <div key={type} style={{background:'#fff',borderRadius:16,marginBottom:16,overflow:'hidden',border:'1px solid #d1d5db',boxShadow:'0 4px 12px rgba(0,0,0,0.1)'}}>
            {/* 장치 유형 헤더 */}
            <div style={{background:`linear-gradient(135deg, ${theme[0]} 0%, ${theme[1]} 100%)`,padding:'14px 18px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <h3 style={{fontSize:16,fontWeight:800,color:'#fff',letterSpacing:'-0.01em'}} className="flex items-center gap-2">
                <span style={{fontSize:18}}>{typeInfo.icon}</span>
                <span>{typeInfo.label}</span>
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
                  const mode = getDeviceMode(device.deviceId);
                  const isAuto = mode === 'auto';

                  return (
                    <div key={device.deviceId}
                      style={{background: isAuto ? '#f0fdf4' : '#f8fafc',border:`2px solid ${isAuto ? '#bbf7d0' : '#e2e8f0'}`,borderRadius:14,padding:'14px 16px',transition:'all 0.2s'}}>
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
                          {/* 상태 표시 */}
                          <div style={{display:'flex',alignItems:'center',gap:6,background:statusDisplay.animate ? `${statusDisplay.color}15` : state.status === 'error' ? '#fef2f2' : '#f8fafc',padding:'4px 12px',borderRadius:8,border:`2px solid ${state.status === 'error' ? '#fecaca' : statusDisplay.animate ? statusDisplay.color : '#e2e8f0'}`}}>
                            <span style={{width:8,height:8,borderRadius:'50%',background:statusDisplay.color,display:'inline-block',boxShadow:`0 0 6px ${statusDisplay.color}`}} className={statusDisplay.animate ? 'animate-pulse' : ''} />
                            <span style={{fontSize:13,fontWeight:700,color:statusDisplay.color}}>{statusDisplay.text}</span>
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
                            onRemove={(ruleId) => removeRuleFromDevice(device.deviceId, ruleId)}
                            onOpenPicker={() => setRulePickerDevice(device.deviceId)}
                            locked={automationActive}
                            automationActive={automationActive}
                            scheduleMap={scheduleMap}
                          />
                        </div>
                      ) : isToggleType ? (
                        <div className="grid grid-cols-2 gap-3">
                          <button onClick={() => handleControlWithRetry(device.deviceId, 'on')}
                            disabled={anyModbusBusy || isProcessing || state.status === 'on'}
                            style={{...btnBase, ...(state.status === 'on' || state.status === 'turning_on' ? s.onActive : s.onInactive), ...(anyModbusBusy || isProcessing || state.status === 'on' ? {opacity:0.4,cursor:'not-allowed'} : {})}}>
                            {state.status === 'turning_on' ? '⏳ 전환중...' : state.status === 'on' ? '● ON' : '◉ ON'}
                          </button>
                          <button onClick={() => handleControlWithRetry(device.deviceId, 'off')}
                            disabled={anyModbusBusy || isProcessing || state.status === 'off' || state.status === 'idle'}
                            style={{...btnBase, ...(state.status === 'off' || state.status === 'idle' || state.status === 'turning_off' ? s.offActive : s.offInactive), ...(anyModbusBusy || isProcessing || state.status === 'off' || state.status === 'idle' ? {opacity:0.4,cursor:'not-allowed'} : {})}}>
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
                                  disabled={anyModbusBusy || isProcessing || state.status === 'open' || (prog && prog.direction === 'open')}
                                  style={{...btnBase, ...(state.status === 'open' || state.status === 'opening' || (prog && prog.direction === 'open') ? s.openActive : (anyModbusBusy || isProcessing || state.status === 'open') ? s.openDisabled : s.openInactive)}}>
                                  {openLabel}
                                </button>
                                <button onClick={() => handleControlWithRetry(device.deviceId, 'stop')}
                                  disabled={anyModbusBusy || (!prog && state.status === 'idle' && (pos === undefined || pos === null)) || state.status === 'stopping'}
                                  style={{...btnBase, ...(state.status === 'stopping' ? s.stopActive : (prog || state.status === 'opening' || state.status === 'closing') ? s.stopUrgent : (anyModbusBusy || state.status === 'idle') ? s.stopDisabled : s.stopInactive),
                                    ...(prog || (pos !== undefined && pos !== null && pos > 0 && pos < 100) ? { fontSize: 15, fontWeight: 900, color: '#1e40af', background: '#dbeafe', border: '2px solid #93c5fd' } : (pos !== undefined && pos !== null) ? { fontSize: 14, fontWeight: 700, color: '#6b7280', background: '#f3f4f6', border: '1px solid #e5e7eb' } : {})
                                  }}>
                                  {stopLabel}
                                </button>
                                <button onClick={() => handleControlWithRetry(device.deviceId, 'close')}
                                  disabled={anyModbusBusy || isProcessing || state.status === 'closed' || (prog && prog.direction === 'close')}
                                  style={{...btnBase, ...(state.status === 'closed' || state.status === 'closing' || (prog && prog.direction === 'close') ? s.closeActive : (anyModbusBusy || isProcessing || state.status === 'closed') ? s.closeDisabled : s.closeInactive)}}>
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

      {/* 자동화 규칙 선택 팝업 — 해당 장치 대상 규칙만 표시 */}
      {rulePickerDevice && (
        <RulePickerModal
          allRules={autoRules.filter(rule => {
            const actions = typeof rule.actions === 'string' ? JSON.parse(rule.actions) : (rule.actions || []);
            return actions.some(a => a.deviceId === rulePickerDevice);
          })}
          selectedIds={selectedRuleMap[rulePickerDevice] || []}
          onToggle={(ruleId) => toggleRuleSelection(rulePickerDevice, ruleId)}
          onClose={() => setRulePickerDevice(null)}
          deviceId={rulePickerDevice}
        />
      )}

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

/** 장치 자동 모드 - 선택된 규칙 목록 표시 */
const DeviceAutoRules = ({ deviceId, rules, expandedRuleId, onToggleExpand, onRemove, onOpenPicker, locked, automationActive, scheduleMap = {} }) => {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:6}}>
      {rules.length === 0 && (
        <div style={{textAlign:'center',color:'#9ca3af',fontSize:13,padding:'4px 0'}}>
          선택된 규칙이 없습니다
        </div>
      )}
      {rules.map(rule => {
        const isExpanded = expandedRuleId === rule._id;
        const sensorConds = (rule.conditions || []).filter(c => c.type === 'sensor');
        const timeConds = (rule.conditions || []).filter(c => c.type === 'time');

        return (
          <div key={rule._id} style={{borderRadius:10,border:'1.5px solid #bbf7d0',background:'#fff',overflow:'hidden'}}>
            {/* 규칙 헤더 */}
            <div
              onClick={() => onToggleExpand(rule._id)}
              style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'10px 12px',cursor:'pointer',background: isExpanded ? '#f0fdf4' : '#fff'}}
            >
              <div style={{display:'flex',alignItems:'center',gap:8,flex:1,minWidth:0}}>
                <span style={{fontSize:14}}>🤖</span>
                <span style={{fontSize:14,fontWeight:700,color:'#0f172a',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{rule.name}</span>
                <span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:12,
                  background: rule.enabled ? '#dcfce7' : '#fee2e2',
                  color: rule.enabled ? '#15803d' : '#dc2626',
                }}>{rule.enabled ? '활성' : '비활성'}</span>
                {automationActive && rule.enabled && scheduleMap[rule._id] && <NextRunCountdown nextRunAt={scheduleMap[rule._id]} />}
              </div>
              <div style={{display:'flex',alignItems:'center',gap:4,flexShrink:0}}>
                {!locked && (
                  <button onClick={(e) => { e.stopPropagation(); onRemove(rule._id); }}
                    style={{padding:'4px 6px',border:'none',background:'transparent',cursor:'pointer',fontSize:12,borderRadius:6,color:'#9ca3af'}}
                    title="해제">✕</button>
                )}
                <span style={{fontSize:12,color:'#9ca3af'}}>{isExpanded ? '▲' : '▼'}</span>
              </div>
            </div>

            {/* 규칙 상세 */}
            {isExpanded && (
              <div style={{padding:'0 12px 12px',borderTop:'1px solid #e5e7eb'}}>
                {sensorConds.length > 0 && (
                  <div style={{marginTop:8}}>
                    <div style={{fontSize:11,fontWeight:700,color:'#7c3aed',marginBottom:4}}>센서 조건</div>
                    <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                      {sensorConds.map((c, i) => (
                        <React.Fragment key={i}>
                          {i > 0 && <span style={{fontSize:11,fontWeight:800,color:'#6b7280',alignSelf:'center'}}>{c.logic || 'AND'}</span>}
                          <span style={{fontSize:12,fontWeight:600,padding:'3px 8px',borderRadius:8,background:'#f5f3ff',color:'#6d28d9',border:'1px solid #ddd6fe'}}>
                            {c.sensorName || c.sensorId} {OPERATOR_LABELS[c.operator] || c.operator} {c.value}
                          </span>
                        </React.Fragment>
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
      {!locked && (
        <button onClick={onOpenPicker}
          style={{width:'100%',padding:'8px',borderRadius:8,border:'1.5px dashed #86efac',background:'transparent',color:'#22c55e',fontSize:13,fontWeight:700,cursor:'pointer'}}>
          + 규칙 선택
        </button>
      )}
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
