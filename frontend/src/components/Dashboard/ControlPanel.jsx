import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { sendControlCommand } from '../../services/controlApi';

const DEVICE_TYPE_INFO = {
  window: { label: '개폐기', icon: '🪟', commands: ['open', 'stop', 'close'] },
  fan:    { label: '환풍기', icon: '🌀', commands: ['on', 'off'] },
  heater: { label: '히터',   icon: '🔥', commands: ['on', 'off'] },
  valve:  { label: '관수밸브', icon: '🚿', commands: ['open', 'stop', 'close'] },
};

const ControlPanel = ({ farmId, houseId, houseConfig }) => {
  const { user } = useAuth();
  const devices = houseConfig?.devices || [];
  const controlHouseId = (() => {
    if (!houseId) return 'house1';
    const match = houseId.match(/house_?0*(\d+)/);
    return match ? `house${parseInt(match[1])}` : houseId;
  })();

  const [deviceStates, setDeviceStates] = useState({});
  const [controlHistory, setControlHistory] = useState([]);
  const [loading, setLoading] = useState({});
  const timerRefs = React.useRef({});

  useEffect(() => {
    const states = {};
    devices.forEach(d => { states[d.deviceId] = deviceStates[d.deviceId] || { status: 'idle', lastCommand: null }; });
    setDeviceStates(states);
  }, [houseId, devices.length]);

  const handleControl = useCallback(async (deviceId, command) => {
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
      const operatorName = user?.role === 'admin'
        ? '관리자'
        : `${user?.name || user?.username || '알 수 없음'}`;
      const result = await sendControlCommand(controlHouseId, deviceId, command, 'web_dashboard', {
        farmId, originalHouseId: houseId,
        deviceType: devices.find(d => d.deviceId === deviceId)?.type || 'unknown',
        deviceName: devices.find(d => d.deviceId === deviceId)?.name || deviceId,
        operatorName,
      });

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
    }
  }, [controlHouseId, farmId, houseId, devices, user]);

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

  // Button style helpers
  const openActiveStyle = { background: '#047857', color: '#fff', boxShadow: '0 2px 8px rgba(4,120,87,0.35)' };
  const openInactiveStyle = { background: '#ecfdf5', color: '#047857', border: '2px solid #a7f3d0' };
  const openDisabledStyle = { background: '#f0fdf4', color: '#a7f3d0', border: '2px solid #d1fae5', cursor: 'not-allowed' };
  
  const stopActiveStyle = { background: '#b45309', color: '#fff', boxShadow: '0 2px 8px rgba(180,83,9,0.35)' };
  const stopInactiveStyle = { background: '#fffbeb', color: '#b45309', border: '2px solid #fcd34d' };
  const stopUrgentStyle = { background: '#fef3c7', color: '#92400e', border: '3px solid #f59e0b', fontWeight: 800 };
  const stopDisabledStyle = { background: '#fefce8', color: '#d4d4d8', border: '2px solid #e5e7eb', cursor: 'not-allowed' };
  
  const closeActiveStyle = { background: '#1d4ed8', color: '#fff', boxShadow: '0 2px 8px rgba(29,78,216,0.35)' };
  const closeInactiveStyle = { background: '#eff6ff', color: '#1d4ed8', border: '2px solid #93c5fd' };
  const closeDisabledStyle = { background: '#f0f9ff', color: '#93c5fd', border: '2px solid #dbeafe', cursor: 'not-allowed' };

  const onActiveStyle = { background: '#047857', color: '#fff', boxShadow: '0 2px 8px rgba(4,120,87,0.35)' };
  const onInactiveStyle = { background: '#ecfdf5', color: '#047857', border: '2px solid #a7f3d0' };
  const offActiveStyle = { background: '#6b7280', color: '#fff', boxShadow: '0 2px 8px rgba(107,114,128,0.3)' };
  const offInactiveStyle = { background: '#f3f4f6', color: '#6b7280', border: '2px solid #d1d5db' };

  const btnBase = { padding: '12px 0', borderRadius: '10px', fontSize: '14px', fontWeight: 700, transition: 'all 0.15s', cursor: 'pointer', textAlign: 'center' };

  if (devices.length === 0) {
    return (
      <div className="glass-card p-4 md:p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base md:text-lg font-bold flex items-center gap-2" style={{color:'#111827'}}>🎛️ 제어 패널</h2>
          <span style={{fontSize:12,color:'#9ca3af',background:'#f3f4f6',padding:'3px 10px',borderRadius:6}}>{controlHouseId}</span>
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
        <h2 className="text-lg md:text-xl font-bold flex items-center gap-2" style={{color:'#111827'}}>🎛️ 제어 패널</h2>
        <span style={{fontSize:12,color:'#9ca3af',background:'#f3f4f6',padding:'3px 10px',borderRadius:6}}>{controlHouseId}</span>
      </div>

      {Object.entries(groupedDevices).map(([type, devicesInGroup]) => {
        const typeInfo = DEVICE_TYPE_INFO[type] || DEVICE_TYPE_INFO.window;
        const isToggleType = type === 'fan' || type === 'heater';

        return (
          <div key={type} className="mb-5 last:mb-0">
            <h3 style={{fontSize:14,fontWeight:700,color:'#374151',letterSpacing:'0.02em',marginBottom:10}} className="flex items-center gap-1.5">
              <span>{typeInfo.icon}</span>
              <span>{typeInfo.label}</span>
              <span style={{color:'#9ca3af',fontSize:13}}>({devicesInGroup.length})</span>
            </h3>

            {/* 장치 유형별 전체 제어 */}
            {devicesInGroup.length >= 2 && (
              <div style={{background:'#f9fafb',border:'1px solid #e5e7eb',borderRadius:10,padding:'12px 14px',marginBottom:12}}>
                <div className="flex items-center gap-2 mb-2">
                  <span style={{fontSize:13,fontWeight:700,color:'#6b7280',letterSpacing:'0.02em'}}>
                    {typeInfo.label} 전체제어
                  </span>
                </div>
                {isToggleType ? (
                  <div className="flex gap-2">
                    <button onClick={() => devicesInGroup.forEach(d => handleControl(d.deviceId, 'on'))}
                      style={{...btnBase,flex:1,background:'#047857',color:'#fff',border:'none',boxShadow:'0 2px 6px rgba(4,120,87,0.25)',fontSize:13}}>
                      {typeInfo.icon} 전체 ON
                    </button>
                    <button onClick={() => devicesInGroup.forEach(d => handleControl(d.deviceId, 'off'))}
                      style={{...btnBase,flex:1,background:'#6b7280',color:'#fff',border:'none',boxShadow:'0 2px 6px rgba(107,114,128,0.25)',fontSize:13}}>
                      {typeInfo.icon} 전체 OFF
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={() => devicesInGroup.forEach(d => handleControl(d.deviceId, 'open'))}
                      style={{...btnBase,flex:1,background:'#047857',color:'#fff',border:'none',boxShadow:'0 2px 6px rgba(4,120,87,0.25)',fontSize:13}}>
                      ▲ 전체 열기
                    </button>
                    <button onClick={() => devicesInGroup.forEach(d => handleControl(d.deviceId, 'stop'))}
                      style={{...btnBase,flex:1,background:'#b45309',color:'#fff',border:'none',boxShadow:'0 2px 6px rgba(180,83,9,0.25)',fontSize:13}}>
                      ■ 전체 정지
                    </button>
                    <button onClick={() => devicesInGroup.forEach(d => handleControl(d.deviceId, 'close'))}
                      style={{...btnBase,flex:1,background:'#1d4ed8',color:'#fff',border:'none',boxShadow:'0 2px 6px rgba(29,78,216,0.25)',fontSize:13}}>
                      ▼ 전체 닫기
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {devicesInGroup.map(device => {
                const state = deviceStates[device.deviceId] || { status: 'idle' };
                const statusDisplay = getStatusDisplay(state.status);
                const isProcessing = ['opening', 'closing', 'stopping', 'turning_on', 'turning_off'].includes(state.status);

                return (
                  <div key={device.deviceId}
                    style={{background:'#fff',border:'1px solid #d1d5db',borderRadius:12,padding:16,transition:'all 0.2s'}}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{device.icon || typeInfo.icon}</span>
                        <span style={{fontSize:16,fontWeight:700,color:'#111827'}}>{device.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span style={{width:8,height:8,borderRadius:'50%',background:statusDisplay.color,display:'inline-block',boxShadow:`0 0 6px ${statusDisplay.color}`}} className={statusDisplay.animate ? 'animate-pulse' : ''} />
                        <span style={{fontSize:14,fontWeight:600,color:statusDisplay.color}}>{statusDisplay.text}</span>
                      </div>
                    </div>

                    {isToggleType ? (
                      <div className="grid grid-cols-2 gap-2">
                        <button onClick={() => handleControl(device.deviceId, 'on')}
                          disabled={isProcessing || state.status === 'on'}
                          style={{...btnBase, ...(state.status === 'on' || state.status === 'turning_on' ? onActiveStyle : onInactiveStyle), ...(isProcessing || state.status === 'on' ? {opacity:0.6,cursor:'not-allowed'} : {})}}>
                          {state.status === 'turning_on' ? '⏳ 전환중...' : state.status === 'on' ? '● ON' : '◉ ON'}
                        </button>
                        <button onClick={() => handleControl(device.deviceId, 'off')}
                          disabled={isProcessing || state.status === 'off' || state.status === 'idle'}
                          style={{...btnBase, ...(state.status === 'off' || state.status === 'idle' || state.status === 'turning_off' ? offActiveStyle : offInactiveStyle), ...(isProcessing || state.status === 'off' || state.status === 'idle' ? {opacity:0.6,cursor:'not-allowed'} : {})}}>
                          {state.status === 'turning_off' ? '⏳ 전환중...' : '○ OFF'}
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-3 gap-2">
                        <button onClick={() => handleControl(device.deviceId, 'open')}
                          disabled={isProcessing || state.status === 'open'}
                          style={{...btnBase, ...(state.status === 'open' || state.status === 'opening' ? openActiveStyle : (isProcessing || state.status === 'open') ? openDisabledStyle : openInactiveStyle)}}>
                          {state.status === 'opening' ? '⏳ 여는중...' : state.status === 'open' ? '● 열림' : '▲ 열기'}
                        </button>
                        <button onClick={() => handleControl(device.deviceId, 'stop')}
                          disabled={state.status === 'idle' || state.status === 'stopping'}
                          style={{...btnBase, ...(state.status === 'stopping' ? stopActiveStyle : (state.status === 'opening' || state.status === 'closing') ? stopUrgentStyle : (state.status === 'idle') ? stopDisabledStyle : stopInactiveStyle)}}>
                          {state.status === 'stopping' ? '⏳ 정지중...' : (state.status === 'opening' || state.status === 'closing') ? '⛔ 정지' : '■ 정지'}
                        </button>
                        <button onClick={() => handleControl(device.deviceId, 'close')}
                          disabled={isProcessing || state.status === 'closed'}
                          style={{...btnBase, ...(state.status === 'closed' || state.status === 'closing' ? closeActiveStyle : (isProcessing || state.status === 'closed') ? closeDisabledStyle : closeInactiveStyle)}}>
                          {state.status === 'closing' ? '⏳ 닫는중...' : state.status === 'closed' ? '● 닫힘' : '▼ 닫기'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* 최근 제어 이력 */}
      {controlHistory.length > 0 && (
        <div style={{marginTop:16,paddingTop:16,borderTop:'2px solid #e5e7eb'}}>
          <h3 style={{fontSize:13,fontWeight:700,color:'#374151',letterSpacing:'0.02em',marginBottom:8}}>최근 제어</h3>
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
    </div>
  );
};

export default ControlPanel;
