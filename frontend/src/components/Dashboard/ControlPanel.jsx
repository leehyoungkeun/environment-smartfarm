import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { useAuth } from '../../contexts/AuthContext';
import { sendControlCommand, getControlLogs, getRelayStatus, warmupLambda } from '../../services/controlApi';
import { getSystemMode, getApiBase, getRpiApiBase } from '../../services/apiSwitcher';

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
  const timerRefs = React.useRef({});

  // 자동화 적용/중지 상태 (localStorage 기반)
  const activeKey = `automationActive_${farmId}_${houseId}`;
  const [automationActive, setAutomationActive] = useState(() => {
    try { return localStorage.getItem(activeKey) === 'true'; }
    catch { return false; }
  });
  const [applyLoading, setApplyLoading] = useState(false);

  const handleApply = async () => {
    setApplyLoading(true);
    try {
      // auto 모드 장치에 연결된 규칙들의 enabled 상태를 활성화
      const rpiUrl = getRpiApiBase();
      const ruleIdsToEnable = new Set();
      devices.forEach(d => {
        if (getDeviceMode(d.deviceId) === 'auto') {
          (selectedRuleMap[d.deviceId] || []).forEach(id => ruleIdsToEnable.add(id));
        }
      });
      for (const ruleId of ruleIdsToEnable) {
        await axios.put(`${rpiUrl}/automation/${farmId}/${ruleId}`, { enabled: true }, { timeout: 5000 }).catch(() => {});
      }
      setAutomationActive(true);
      localStorage.setItem(activeKey, 'true');
      loadAutoRules(); // 규칙 상태 새로고침
    } catch {} finally { setApplyLoading(false); }
  };

  const handleStop = async () => {
    setApplyLoading(true);
    try {
      // auto 모드 장치에 연결된 규칙들을 비활성화 (설정은 유지)
      const rpiUrl = getRpiApiBase();
      const ruleIdsToDisable = new Set();
      devices.forEach(d => {
        if (getDeviceMode(d.deviceId) === 'auto') {
          (selectedRuleMap[d.deviceId] || []).forEach(id => ruleIdsToDisable.add(id));
        }
      });
      for (const ruleId of ruleIdsToDisable) {
        await axios.put(`${rpiUrl}/automation/${farmId}/${ruleId}`, { enabled: false }, { timeout: 5000 }).catch(() => {});
      }
      setAutomationActive(false);
      localStorage.setItem(activeKey, 'false');
      loadAutoRules(); // 규칙 상태 새로고침
    } catch {} finally { setApplyLoading(false); }
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
      const rpiUrl = getRpiApiBase();
      const pcUrl = getApiBase();
      const res = await axios.get(`${rpiUrl}/automation/${farmId}`, { timeout: 5000 })
        .catch(() => rpiUrl !== pcUrl
          ? axios.get(`${pcUrl}/automation/${farmId}`, { timeout: 5000 }).catch(() => null)
          : null
        );
      if (res?.data?.success && Array.isArray(res.data.data)) {
        setAutoRules(res.data.data.map(r => ({ ...r, _id: r._id || r.id })));
      }
    } catch {}
  }, [farmId]);

  useEffect(() => { loadAutoRules(); }, [loadAutoRules]);

  // deviceStates 변경 시 localStorage 저장
  useEffect(() => {
    if (Object.keys(deviceStates).length > 0) {
      try { localStorage.setItem(statesKey, JSON.stringify(deviceStates)); } catch {}
    }
  }, [deviceStates, statesKey]);

  // 릴레이 실제 상태 폴링
  const relayCoilsRef = React.useRef({});
  const [relayOnline, setRelayOnline] = useState(null);
  const isFetchingRef = React.useRef(false);

  const fetchRelayStatus = useCallback(async () => {
    // 중복 호출 방지 (이전 요청이 타임아웃 대기 중이면 건너뜀)
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      const modbusDevices = devices.filter(d => d.modbus?.address != null);
      if (modbusDevices.length === 0) return;

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

      // Eletechsup: FC03 register 0은 릴레이 상태가 아닌 설정값(76) 반환
      // → 소프트웨어 상태 추적 사용 (handleControl에서 제어 명령 기반으로 상태 설정)
      // Eletechsup 장치가 있으면 폴링 성공으로 표시 (오프라인 판정 방지)
      if (eletechsupUnits.length > 0) anySuccess = true;

      relayCoilsRef.current = newCoils;
      setRelayOnline(anySuccess);

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
    } finally {
      isFetchingRef.current = false;
    }
  }, [devices]);

  const relayIntervalRef = React.useRef(null);

  const startRelayPolling = useCallback(() => {
    if (relayIntervalRef.current) return;
    relayIntervalRef.current = setInterval(fetchRelayStatus, 10000);
  }, [fetchRelayStatus]);

  const stopRelayPolling = useCallback(() => {
    if (relayIntervalRef.current) {
      clearInterval(relayIntervalRef.current);
      relayIntervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    fetchRelayStatus();
    startRelayPolling();
    // Lambda 콜드 스타트 방지: 페이지 진입 시 미리 워밍업
    const mode = getSystemMode();
    if (!mode.isFarmLocal && mode.serverOnline) warmupLambda();
    return () => stopRelayPolling();
  }, [fetchRelayStatus, startRelayPolling, stopRelayPolling]);

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

  // houseId 변경 시 localStorage에서 해당 하우스 설정 재로드
  useEffect(() => {
    try { setAutomationActive(localStorage.getItem(`automationActive_${farmId}_${houseId}`) === 'true'); }
    catch { setAutomationActive(false); }
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

  const handleControl = useCallback(async (deviceId, command) => {
    // Modbus 직렬 큐 충돌 방지: 제어 중 폴링 중지
    stopRelayPolling();

    const loadingKey = `${deviceId}_${command}`;
    if (command === 'stop') {
      if (timerRefs.current[deviceId]) { clearTimeout(timerRefs.current[deviceId]); timerRefs.current[deviceId] = null; }
      setDeviceStates(prev => ({ ...prev, [deviceId]: { ...prev[deviceId], status: 'idle', lastCommand: 'stop', lastCommandTime: new Date().toISOString() } }));
    }
    setLoading(prev => ({ ...prev, [loadingKey]: true }));
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

      if (mode.isFarmLocal || mode.mode === 'offline') {
        // 오프라인: RPi Node-RED 로컬 제어 API 호출
        const rpiApi = getApiBase();
        const res = await axios.post(`${rpiApi}/control/local`, {
          house_id: controlHouseId,
          device_id: deviceId,
          command,
          operator: operatorName,
          modbus: modbusConfig,
        }, { timeout: 10000 });
        result = { success: res.data.success, requestId: res.data.data?.request_id };
      } else {
        // 온라인: AWS IoT 경유 (기존)
        result = await sendControlCommand(controlHouseId, deviceId, command, 'web_dashboard', {
          farmId, originalHouseId: houseId,
          deviceType: targetDevice?.type || 'unknown',
          deviceName: targetDevice?.name || deviceId,
          operatorName,
          modbus: modbusConfig,
        });
      }

      setControlHistory(prev => [{ deviceId, command, success: result.success, requestId: result.requestId, timestamp: new Date().toISOString(), error: result.error, operatorName }, ...prev.slice(0, 19)]);
      if (result.success) {
        if (timerRefs.current[deviceId]) clearTimeout(timerRefs.current[deviceId]);
        const finalStatus = { open: 'open', close: 'closed', stop: 'idle', on: 'on', off: 'off' };
        timerRefs.current[deviceId] = setTimeout(() => {
          setDeviceStates(prev => ({ ...prev, [deviceId]: { ...prev[deviceId], status: finalStatus[command] || 'idle' } }));
          timerRefs.current[deviceId] = null;
        }, command === 'stop' ? 500 : 3000);
      } else {
        setDeviceStates(prev => ({ ...prev, [deviceId]: { ...prev[deviceId], status: 'error' } }));
      }
    } catch (error) {
      setDeviceStates(prev => ({ ...prev, [deviceId]: { ...prev[deviceId], status: 'error' } }));
    } finally {
      setLoading(prev => ({ ...prev, [loadingKey]: false }));
      // 제어 완료 후 2초 대기 → 릴레이 상태 확인 + 폴링 재개
      setTimeout(() => {
        fetchRelayStatus();
        startRelayPolling();
      }, 2000);
    }
  }, [controlHouseId, farmId, houseId, devices, user, stopRelayPolling, startRelayPolling, fetchRelayStatus]);

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

  // 대시보드 통일 스타일
  const btnBase = { padding: '11px 0', borderRadius: '10px', fontSize: '14px', fontWeight: 700, transition: 'all 0.15s', cursor: 'pointer', textAlign: 'center', border: '2px solid transparent', letterSpacing: '-0.01em' };

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
          <h2 className="text-base md:text-lg font-bold flex items-center gap-2" style={{color:'#111827'}}>🎛️ 제어 패널</h2>
          <button onClick={() => { setHistoryModal(true); loadHistory(1); }}
            style={{fontSize:12,color:'#4b5563',background:'#f3f4f6',padding:'4px 12px',borderRadius:8,border:'1px solid #e5e7eb',cursor:'pointer',fontWeight:600}}>
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
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 style={{fontSize:18,fontWeight:800,color:'#111827',letterSpacing:'-0.01em'}} className="flex items-center gap-2">🎛️ 제어 패널</h2>
          {relayOnline !== null && (
            <span style={{
              fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:6,
              background: relayOnline ? '#dcfce7' : '#fef2f2',
              color: relayOnline ? '#047857' : '#be123c',
              border: `1px solid ${relayOnline ? '#bbf7d0' : '#fecaca'}`,
            }}>
              {relayOnline ? '릴레이 연결됨' : '릴레이 미연결'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => fetchRelayStatus()}
            style={{fontSize:12,color:'#4b5563',background:'#f3f4f6',padding:'4px 12px',borderRadius:8,border:'1px solid #e5e7eb',cursor:'pointer',fontWeight:600}}>
            🔄 릴레이 조회
          </button>
          <button onClick={() => { setHistoryModal(true); loadHistory(1); }}
            style={{fontSize:12,color:'#4b5563',background:'#f3f4f6',padding:'4px 12px',borderRadius:8,border:'1px solid #e5e7eb',cursor:'pointer',fontWeight:600}}>
            📋 제어이력
          </button>
          {/* 자동화 적용/중지 상태 표시 */}
          {automationActive && (
            <span style={{fontSize:11,fontWeight:700,padding:'3px 10px',borderRadius:8,background:'#dcfce7',color:'#047857',border:'1px solid #bbf7d0'}}>
              자동화 작동중
            </span>
          )}
          {/* 적용 버튼 */}
          <button
            onClick={handleApply}
            disabled={applyLoading}
            style={{
              padding:'6px 14px',borderRadius:10,fontSize:13,fontWeight:700,
              border:'none',cursor: applyLoading ? 'not-allowed' : 'pointer',
              background: automationActive ? '#e5e7eb' : '#1d4ed8',
              color: automationActive ? '#9ca3af' : '#fff',
              boxShadow: automationActive ? 'none' : '0 2px 8px rgba(29,78,216,0.35)',
              transition:'all 0.15s',
            }}
          >
            {applyLoading ? '⏳' : '▶'} 자동화 적용
          </button>
          {/* 중지 버튼 */}
          <button
            onClick={handleStop}
            disabled={applyLoading || !automationActive}
            style={{
              padding:'6px 14px',borderRadius:10,fontSize:13,fontWeight:700,
              border:'none',cursor: (applyLoading || !automationActive) ? 'not-allowed' : 'pointer',
              background: !automationActive ? '#f3f4f6' : '#dc2626',
              color: !automationActive ? '#d1d5db' : '#fff',
              boxShadow: !automationActive ? 'none' : '0 2px 8px rgba(220,38,38,0.35)',
              transition:'all 0.15s',
            }}
          >
            {applyLoading ? '⏳' : '⏸'} 중지
          </button>
        </div>
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
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span style={{fontSize:20}}>{device.icon || typeInfo.icon}</span>
                          <span style={{fontSize:16,fontWeight:800,color:'#0f172a'}}>{device.name}</span>
                          {device.modbus?.address != null && (
                            <span style={{fontSize:10,fontWeight:700,color:'#6b7280',background:'#f1f5f9',padding:'2px 6px',borderRadius:6}}>
                              R{device.modbus.unitId||1}:CH{device.modbus.address+1}{device.modbus.controlType==='bidir'?`+${device.modbus.address2+1}`:''}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {/* 수동/자동 모드 토글 */}
                          <button
                            onClick={() => !automationActive && toggleDeviceMode(device.deviceId)}
                            disabled={automationActive}
                            style={{
                              display:'flex',alignItems:'center',gap:5,
                              padding:'4px 10px',borderRadius:8,fontSize:12,fontWeight:700,
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
                          <div style={{display:'flex',alignItems:'center',gap:6,background:statusDisplay.animate ? `${statusDisplay.color}15` : '#f8fafc',padding:'4px 12px',borderRadius:8,border:`2px solid ${statusDisplay.animate ? statusDisplay.color : '#e2e8f0'}`}}>
                            <span style={{width:8,height:8,borderRadius:'50%',background:statusDisplay.color,display:'inline-block',boxShadow:`0 0 6px ${statusDisplay.color}`}} className={statusDisplay.animate ? 'animate-pulse' : ''} />
                            <span style={{fontSize:13,fontWeight:700,color:statusDisplay.color}}>{statusDisplay.text}</span>
                            {state.relayVerified && (
                              <span title="Modbus FC1 실제 확인" style={{fontSize:9,fontWeight:700,color:'#047857',background:'#dcfce7',padding:'1px 4px',borderRadius:4,marginLeft:2}}>HW</span>
                            )}
                          </div>
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
                          />
                        </div>
                      ) : isToggleType ? (
                        <div className="grid grid-cols-2 gap-3">
                          <button onClick={() => handleControl(device.deviceId, 'on')}
                            disabled={isProcessing || state.status === 'on'}
                            style={{...btnBase, ...(state.status === 'on' || state.status === 'turning_on' ? s.onActive : s.onInactive), ...(isProcessing || state.status === 'on' ? {opacity:0.4,cursor:'not-allowed'} : {})}}>
                            {state.status === 'turning_on' ? '⏳ 전환중...' : state.status === 'on' ? '● ON' : '◉ ON'}
                          </button>
                          <button onClick={() => handleControl(device.deviceId, 'off')}
                            disabled={isProcessing || state.status === 'off' || state.status === 'idle'}
                            style={{...btnBase, ...(state.status === 'off' || state.status === 'idle' || state.status === 'turning_off' ? s.offActive : s.offInactive), ...(isProcessing || state.status === 'off' || state.status === 'idle' ? {opacity:0.4,cursor:'not-allowed'} : {})}}>
                            {state.status === 'turning_off' ? '⏳ 전환중...' : '○ OFF'}
                          </button>
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 gap-2">
                          <button onClick={() => handleControl(device.deviceId, 'open')}
                            disabled={isProcessing || state.status === 'open'}
                            style={{...btnBase, ...(state.status === 'open' || state.status === 'opening' ? s.openActive : (isProcessing || state.status === 'open') ? s.openDisabled : s.openInactive)}}>
                            {state.status === 'opening' ? '⏳ 여는중...' : state.status === 'open' ? '● 열림' : '▲ 열기'}
                          </button>
                          <button onClick={() => handleControl(device.deviceId, 'stop')}
                            disabled={state.status === 'idle' || state.status === 'stopping'}
                            style={{...btnBase, ...(state.status === 'stopping' ? s.stopActive : (state.status === 'opening' || state.status === 'closing') ? s.stopUrgent : (state.status === 'idle') ? s.stopDisabled : s.stopInactive)}}>
                            {state.status === 'stopping' ? '⏳ 정지중...' : (state.status === 'opening' || state.status === 'closing') ? '⛔ 정지' : '■ 정지'}
                          </button>
                          <button onClick={() => handleControl(device.deviceId, 'close')}
                            disabled={isProcessing || state.status === 'closed'}
                            style={{...btnBase, ...(state.status === 'closed' || state.status === 'closing' ? s.closeActive : (isProcessing || state.status === 'closed') ? s.closeDisabled : s.closeInactive)}}>
                            {state.status === 'closing' ? '⏳ 닫는중...' : state.status === 'closed' ? '● 닫힘' : '▼ 닫기'}
                          </button>
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
                      <button onClick={() => manualDevices.forEach(d => handleControl(d.deviceId, 'on'))}
                        disabled={allAuto}
                        style={{...btnBase,flex:1,background: allAuto ? '#e5e7eb' : accent,color: allAuto ? '#9ca3af' : '#fff',boxShadow: allAuto ? 'none' : `0 2px 8px ${accent}35`, cursor: allAuto ? 'not-allowed' : 'pointer'}}>
                        전체 ON
                      </button>
                      <button onClick={() => manualDevices.forEach(d => handleControl(d.deviceId, 'off'))}
                        disabled={allAuto}
                        style={{...btnBase,flex:1,background: allAuto ? '#e5e7eb' : '#64748b',color: allAuto ? '#9ca3af' : '#fff',boxShadow: allAuto ? 'none' : '0 2px 8px rgba(100,116,139,0.35)', cursor: allAuto ? 'not-allowed' : 'pointer'}}>
                        전체 OFF
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => manualDevices.forEach(d => handleControl(d.deviceId, 'open'))}
                        disabled={allAuto}
                        style={{...btnBase,flex:1,background: allAuto ? '#e5e7eb' : accent,color: allAuto ? '#9ca3af' : '#fff',boxShadow: allAuto ? 'none' : `0 2px 8px ${accent}35`, cursor: allAuto ? 'not-allowed' : 'pointer'}}>
                        ▲ 전체 열기
                      </button>
                      <button onClick={() => manualDevices.forEach(d => handleControl(d.deviceId, 'stop'))}
                        disabled={allAuto}
                        style={{...btnBase,flex:1,background: allAuto ? '#e5e7eb' : '#d97706',color: allAuto ? '#9ca3af' : '#fff',boxShadow: allAuto ? 'none' : '0 2px 8px rgba(217,119,6,0.35)', cursor: allAuto ? 'not-allowed' : 'pointer'}}>
                        ■ 전체 정지
                      </button>
                      <button onClick={() => manualDevices.forEach(d => handleControl(d.deviceId, 'close'))}
                        disabled={allAuto}
                        style={{...btnBase,flex:1,background: allAuto ? '#e5e7eb' : theme[1],color: allAuto ? '#9ca3af' : '#fff',boxShadow: allAuto ? 'none' : `0 2px 8px ${theme[1]}35`, cursor: allAuto ? 'not-allowed' : 'pointer'}}>
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

      {/* 최근 제어 이력 */}
      {controlHistory.length > 0 && (
        <div style={{marginTop:16,paddingTop:16,borderTop:'2px solid #e5e7eb'}}>
          <h3 style={{fontSize:13,fontWeight:800,color:'#374151',letterSpacing:'-0.01em',marginBottom:8}}>최근 제어</h3>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {controlHistory.slice(0, 5).map((log, idx) => (
              <div key={idx} style={{display:'flex',alignItems:'center',justifyContent:'space-between',fontSize:13,background:'#f9fafb',borderRadius:8,padding:'8px 12px',border:'1px solid #e5e7eb'}}>
                <div className="flex items-center gap-2">
                  <span style={{color: log.success ? '#047857' : '#be123c'}}>{log.success ? '✔' : '✗'}</span>
                  <span style={{color:'#6b7280'}}>{log.deviceId}</span>
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

      {/* 자동화 규칙 선택 팝업 */}
      {rulePickerDevice && (
        <RulePickerModal
          allRules={autoRules}
          selectedIds={selectedRuleMap[rulePickerDevice] || []}
          onToggle={(ruleId) => toggleRuleSelection(rulePickerDevice, ruleId)}
          onClose={() => setRulePickerDevice(null)}
        />
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

/** 장치 자동 모드 - 선택된 규칙 목록 표시 */
const DeviceAutoRules = ({ deviceId, rules, expandedRuleId, onToggleExpand, onRemove, onOpenPicker, locked }) => {
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
                    <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
                      {timeConds.map((c, i) => {
                        const daysStr = (c.days || []).sort((a, b) => (a || 7) - (b || 7)).map(d => DAYS_LABELS[d]).join(',');
                        let timeStr;
                        if (c.timeMode === 'interval') {
                          timeStr = `${c.startTime || '08:00'}~${c.endTime || '18:00'} ${c.intervalMinutes || 30}분간격`;
                        } else if (c.timeMode === 'specific') {
                          timeStr = (c.times || []).join(', ');
                        } else {
                          timeStr = c.time || '--:--';
                        }
                        return (
                          <span key={i} style={{fontSize:12,fontWeight:600,padding:'3px 8px',borderRadius:8,background:'#fffbeb',color:'#b45309',border:'1px solid #fde68a'}}>
                            ⏰ {timeStr} ({daysStr})
                          </span>
                        );
                      })}
                    </div>
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
const RulePickerModal = ({ allRules, selectedIds, onToggle, onClose }) => {
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
              등록된 자동화 규칙이 없습니다.<br/>설정에서 먼저 규칙을 만들어주세요.
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
