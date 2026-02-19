import React, { useState, useEffect } from 'react';
import axiosBase from 'axios';
import AutomationManager from '../Dashboard/AutomationManager';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

// 모든 요청에 자동으로 인증 토큰 추가
const axios = axiosBase.create();
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const ConfigurationManager = ({ farmId = 'farm_001' }) => {
  const [activeTab, setActiveTab] = useState('houses');
  const [houses, setHouses] = useState([]);
  const [selectedHouse, setSelectedHouse] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadHouses();
  }, [farmId]);

  const loadHouses = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_BASE_URL}/config/farm/${farmId}`);
      if (response.data.success) {
        setHouses(response.data.data);
        if (selectedHouse) {
          const updatedHouse = response.data.data.find(h => h.houseId === selectedHouse.houseId);
          if (updatedHouse) setSelectedHouse(updatedHouse);
          else setSelectedHouse(null);
        }
      }
    } catch (error) {
      console.error('Failed to load houses:', error);
    } finally {
      setLoading(false);
    }
  };

  const createNewHouse = async () => {
    const existingNumbers = houses.map(h => {
      const match = h.houseId?.match(/house_(\d+)/);
      return match ? parseInt(match[1]) : 0;
    });
    const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
    const newHouseId = `house_${String(nextNumber).padStart(3, '0')}`;

    try {
      const response = await axios.post(`${API_BASE_URL}/config`, {
        farmId,
        houseId: newHouseId,
        houseName: `${nextNumber}번 하우스`,
        deviceCount: 1,
        collection: { intervalSeconds: 60, method: 'http', retryAttempts: 3 },
        sensors: [
          {
            sensorId: 'temp_001', name: '온도', unit: '°C', type: 'number',
            min: -10, max: 50, enabled: true, order: 1, icon: '🌡️', color: '#EF4444', precision: 1
          },
          {
            sensorId: 'humidity_001', name: '습도', unit: '%', type: 'number',
            min: 0, max: 100, enabled: true, order: 2, icon: '💧', color: '#3B82F6', precision: 1
          }
        ]
      });
      if (response.data.success) {
        alert('✅ 하우스가 생성되었습니다!');
        loadHouses();
      }
    } catch (error) {
      alert('❌ 하우스 생성 실패: ' + (error.response?.data?.error || error.message));
    }
  };

  const deleteHouse = async (houseId, houseName) => {
    if (!confirm(`"${houseName}"을(를) 삭제하시겠습니까?\n\n모든 센서 설정이 삭제됩니다.`)) return;
    try {
      const response = await axios.delete(`${API_BASE_URL}/config/${houseId}?farmId=${farmId}`);
      if (response.data.success) {
        alert('✅ 하우스가 삭제되었습니다!');
        if (selectedHouse?.houseId === houseId) setSelectedHouse(null);
        loadHouses();
      }
    } catch (error) {
      alert('❌ 삭제 실패: ' + (error.response?.data?.error || error.message));
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6">
        <div className="skeleton h-8 w-40 mb-6" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="skeleton h-48 rounded-2xl" />
          <div className="lg:col-span-2 skeleton h-96 rounded-2xl" />
        </div>
      </div>
    );
  }

  const tabs = [
    { id: 'houses', label: '하우스/센서', icon: '🏠' },
    { id: 'automation', label: '자동화', icon: '🤖' },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-5 animate-fade-in-up">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">설정 관리</h1>
          <p className="text-gray-500 text-sm md:text-base mt-0.5">하우스, 센서, 자동화 설정</p>
        </div>
        {activeTab === 'houses' && (
          <button onClick={createNewHouse} className="btn-success">
            + 하우스 추가
          </button>
        )}
      </div>

      {/* 탭 네비게이션 */}
      <div className="flex gap-2 mb-5 animate-fade-in-up">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-base font-bold
                       whitespace-nowrap transition-all active:scale-[0.97] ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 shadow-sm'
            }`}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* 하우스/센서 탭 */}
      {activeTab === 'houses' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* 하우스 목록 */}
          <div className="lg:col-span-1 animate-fade-in-up stagger-1">
            <div className="glass-card p-4 md:p-5">
              <h2 className="text-base font-bold text-gray-700 mb-3">하우스 목록</h2>

              {houses.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-600 text-base">하우스가 없습니다</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {houses.map(house => (
                    <div
                      key={house.houseId}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 cursor-pointer
                        ${selectedHouse?.houseId === house.houseId
                          ? 'bg-blue-50 border-2 border-blue-400 shadow-sm'
                          : 'bg-gray-50 border border-gray-200 hover:bg-gray-100 hover:border-gray-300'
                        }`}
                    >
                      <button
                        onClick={() => setSelectedHouse(house)}
                        className="flex-1 text-left"
                      >
                        <p className="text-base font-bold text-gray-800">{house.houseName}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {house.sensors.length}개 센서 · 🎛️ {house.devices?.length || 0}개 장치 · {house.collection.intervalSeconds}초
                        </p>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteHouse(house.houseId, house.houseName); }}
                        className="p-2 rounded-lg text-gray-400 hover:text-rose-500 hover:bg-rose-50
                                 transition-all text-base"
                        title="삭제"
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 하우스 상세 편집 */}
          <div className="lg:col-span-2 animate-fade-in-up stagger-2">
            {selectedHouse ? (
              <HouseDetailEditor house={selectedHouse} onUpdate={loadHouses} />
            ) : (
              <div className="glass-card p-12 text-center">
                <div className="text-4xl mb-4 opacity-30">⚙️</div>
                <p className="text-gray-500 text-base">왼쪽에서 하우스를 선택하세요</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 자동화 탭 */}
      {activeTab === 'automation' && (
        <AutomationManager farmId={farmId} />
      )}
    </div>
  );
};

const HouseDetailEditor = ({ house, onUpdate }) => {
  const [editedHouse, setEditedHouse] = useState(house);
  const [editingSensor, setEditingSensor] = useState(null);
  const [showAddSensor, setShowAddSensor] = useState(false);
  const [newSensor, setNewSensor] = useState({
    sensorId: '', name: '', unit: '', type: 'number',
    min: 0, max: 100, enabled: true, icon: '📊', color: '#3B82F6'
  });

  useEffect(() => {
    setEditedHouse(house);
    setEditingSensor(null);
    setShowAddSensor(false);
  }, [house]);

  const updateHouse = async () => {
    try {
      const response = await axios.put(
        `${API_BASE_URL}/config/${house.houseId}?farmId=${house.farmId}`,
        editedHouse
      );
      if (response.data.success) {
        alert('✅ 저장되었습니다!');
        onUpdate();
      }
    } catch (error) {
      alert('❌ 저장 실패: ' + (error.response?.data?.error || error.message));
    }
  };

  const updateSensor = async (sensorId, updates) => {
    const updatedSensors = editedHouse.sensors.map(s =>
      s.sensorId === sensorId ? { ...s, ...updates } : s
    );
    const updatedHouse = { ...editedHouse, sensors: updatedSensors };
    try {
      const response = await axios.put(
        `${API_BASE_URL}/config/${house.houseId}?farmId=${house.farmId}`,
        updatedHouse
      );
      if (response.data.success) {
        alert('✅ 센서가 수정되었습니다!');
        setEditedHouse(updatedHouse);
        setEditingSensor(null);
        onUpdate();
      }
    } catch (error) {
      alert('❌ 수정 실패: ' + (error.response?.data?.error || error.message));
    }
  };

  const addSensor = async () => {
    if (!newSensor.sensorId || !newSensor.name || !newSensor.unit) {
      alert('❌ 센서 ID, 이름, 단위를 모두 입력하세요!');
      return;
    }
    if (editedHouse.sensors.some(s => s.sensorId === newSensor.sensorId)) {
      alert('❌ 이미 존재하는 센서 ID입니다!');
      return;
    }
    const updatedHouse = {
      ...editedHouse,
      sensors: [...editedHouse.sensors, { ...newSensor, order: editedHouse.sensors.length + 1, precision: 1 }]
    };
    try {
      const response = await axios.put(
        `${API_BASE_URL}/config/${house.houseId}?farmId=${house.farmId}`,
        updatedHouse
      );
      if (response.data.success) {
        alert('✅ 센서가 추가되었습니다!');
        setEditedHouse(updatedHouse);
        setNewSensor({ sensorId: '', name: '', unit: '', type: 'number', min: 0, max: 100, enabled: true, icon: '📊', color: '#3B82F6' });
        setShowAddSensor(false);
        onUpdate();
      }
    } catch (error) {
      alert('❌ 추가 실패: ' + (error.response?.data?.error || error.message));
    }
  };

  const removeSensor = async (sensorId) => {
    if (!confirm('이 센서를 삭제하시겠습니까?')) return;
    const updatedHouse = { ...editedHouse, sensors: editedHouse.sensors.filter(s => s.sensorId !== sensorId) };
    try {
      const response = await axios.put(
        `${API_BASE_URL}/config/${house.houseId}?farmId=${house.farmId}`,
        updatedHouse
      );
      if (response.data.success) {
        alert('✅ 센서가 삭제되었습니다!');
        setEditedHouse(updatedHouse);
        onUpdate();
      }
    } catch (error) {
      alert('❌ 삭제 실패: ' + (error.response?.data?.error || error.message));
    }
  };

  return (
    <div className="space-y-4">
      {/* 기본 설정 */}
      <div className="glass-card p-4 md:p-5">
        <h2 className="text-lg font-bold text-gray-800 mb-4">기본 설정</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="text-sm text-gray-600 font-semibold mb-1.5 block">하우스 이름</label>
            <input
              type="text"
              value={editedHouse.houseName}
              onChange={(e) => setEditedHouse({ ...editedHouse, houseName: e.target.value })}
              className="input-field"
            />
          </div>
          <div>
            <label className="text-sm text-gray-600 font-semibold mb-1.5 block">수집 주기 (초)</label>
            <input
              type="number"
              value={editedHouse.collection.intervalSeconds}
              onChange={(e) => setEditedHouse({
                ...editedHouse,
                collection: { ...editedHouse.collection, intervalSeconds: parseInt(e.target.value) }
              })}
              className="input-field"
              min="10" max="3600"
            />
          </div>
        </div>
        <button onClick={updateHouse} className="btn-primary w-full">💾 저장</button>
      </div>

      {/* 센서 목록 */}
      <div className="glass-card p-4 md:p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">📡 센서 ({editedHouse.sensors.length})</h2>
          <button
            onClick={() => setShowAddSensor(!showAddSensor)}
            className={showAddSensor ? 'btn-secondary' : 'btn-primary'}
          >
            {showAddSensor ? '✕ 취소' : '+ 센서 추가'}
          </button>
        </div>

        {/* 센서 추가 폼 */}
        {showAddSensor && (
          <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4 mb-4 animate-fade-in-up">
            <h3 className="text-base font-bold text-blue-700 mb-3">새 센서 추가</h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <input type="text" placeholder="센서 ID (예: co2_001)" value={newSensor.sensorId}
                onChange={(e) => setNewSensor({ ...newSensor, sensorId: e.target.value })}
                className="input-field text-sm" />
              <input type="text" placeholder="이름 (예: CO2)" value={newSensor.name}
                onChange={(e) => setNewSensor({ ...newSensor, name: e.target.value })}
                className="input-field text-sm" />
              <input type="text" placeholder="단위 (예: ppm)" value={newSensor.unit}
                onChange={(e) => setNewSensor({ ...newSensor, unit: e.target.value })}
                className="input-field text-sm" />
              <input type="text" placeholder="아이콘 (예: 💨)" value={newSensor.icon}
                onChange={(e) => setNewSensor({ ...newSensor, icon: e.target.value })}
                className="input-field text-sm" />
              <input type="number" placeholder="최소값" value={newSensor.min}
                onChange={(e) => setNewSensor({ ...newSensor, min: parseFloat(e.target.value) })}
                className="input-field text-sm" />
              <input type="number" placeholder="최대값" value={newSensor.max}
                onChange={(e) => setNewSensor({ ...newSensor, max: parseFloat(e.target.value) })}
                className="input-field text-sm" />
            </div>
            <button onClick={addSensor} className="btn-success w-full">✅ 센서 추가</button>
          </div>
        )}

        {/* 센서 리스트 */}
        <div className="space-y-2">
          {editedHouse.sensors.map(sensor => (
            <div key={sensor.sensorId}>
              {editingSensor === sensor.sensorId ? (
                <SensorEditForm
                  sensor={sensor}
                  onSave={(updates) => updateSensor(sensor.sensorId, updates)}
                  onCancel={() => setEditingSensor(null)}
                />
              ) : (
                <div className="flex items-center gap-3 bg-gray-50 border border-gray-200
                              rounded-xl px-4 py-3 hover:bg-gray-100 transition-all">
                  <span className="text-2xl">{sensor.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-bold text-gray-800">{sensor.name}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {sensor.sensorId} · {sensor.unit} · 범위: {sensor.min}~{sensor.max}
                    </p>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={() => setEditingSensor(sensor.sensorId)}
                      className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50
                               transition-all text-base border border-transparent hover:border-blue-200"
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => removeSensor(sensor.sensorId)}
                      className="p-2 rounded-lg text-gray-400 hover:text-rose-500 hover:bg-rose-50
                               transition-all text-base border border-transparent hover:border-rose-200"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* 제어 장치 관리 */}
      <DeviceManager house={editedHouse} setEditedHouse={setEditedHouse} onUpdate={onUpdate} />
    </div>
  );
};

/**
 * 제어 장치 관리 컴포넌트
 */
const DEVICE_TYPES = [
  { value: 'window', label: '개폐기 (창문)', icon: '🪟', commands: 'open/stop/close' },
  { value: 'fan', label: '환풍기', icon: '🌀', commands: 'on/off' },
  { value: 'heater', label: '히터', icon: '🔥', commands: 'on/off' },
  { value: 'valve', label: '관수 밸브', icon: '🚿', commands: 'open/stop/close' },
];

const getDeviceIcon = (type) => {
  return DEVICE_TYPES.find(d => d.value === type)?.icon || '🔧';
};

const getDeviceLabel = (type) => {
  return DEVICE_TYPES.find(d => d.value === type)?.label || type;
};

const DeviceManager = ({ house, setEditedHouse, onUpdate }) => {
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [newDevice, setNewDevice] = useState({
    type: 'window', name: '', enabled: true
  });

  const devices = house.devices || [];

  const generateDeviceId = (type) => {
    const prefix = type === 'window' ? 'window' : type === 'fan' ? 'fan' : type === 'heater' ? 'heater' : 'valve';
    const existing = devices.filter(d => d.type === type).length;
    return `${prefix}${existing + 1}`;
  };

  const addDevice = async () => {
    const deviceId = generateDeviceId(newDevice.type);
    const name = newDevice.name || `${getDeviceLabel(newDevice.type)} ${devices.filter(d => d.type === newDevice.type).length + 1}`;
    
    const updatedDevices = [...devices, {
      deviceId,
      name,
      type: newDevice.type,
      icon: getDeviceIcon(newDevice.type),
      enabled: true,
      order: devices.length,
    }];

    const updatedHouse = { ...house, devices: updatedDevices, deviceCount: updatedDevices.length };

    try {
      const response = await axios.put(
        `${API_BASE_URL}/config/${house.houseId}?farmId=${house.farmId}`,
        updatedHouse
      );
      if (response.data.success) {
        alert('✅ 장치가 추가되었습니다!');
        setEditedHouse(updatedHouse);
        setNewDevice({ type: 'window', name: '', enabled: true });
        setShowAddDevice(false);
        onUpdate();
      }
    } catch (error) {
      alert('❌ 추가 실패: ' + (error.response?.data?.error || error.message));
    }
  };

  const removeDevice = async (deviceId) => {
    if (!confirm('이 장치를 삭제하시겠습니까?')) return;
    
    const updatedDevices = devices.filter(d => d.deviceId !== deviceId);
    const updatedHouse = { ...house, devices: updatedDevices, deviceCount: updatedDevices.length };

    try {
      const response = await axios.put(
        `${API_BASE_URL}/config/${house.houseId}?farmId=${house.farmId}`,
        updatedHouse
      );
      if (response.data.success) {
        alert('✅ 장치가 삭제되었습니다!');
        setEditedHouse(updatedHouse);
        onUpdate();
      }
    } catch (error) {
      alert('❌ 삭제 실패: ' + (error.response?.data?.error || error.message));
    }
  };

  return (
    <div className="glass-card p-4 md:p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-gray-800">
          🎛️ 제어 장치 ({devices.length})
        </h2>
        <button
          onClick={() => setShowAddDevice(!showAddDevice)}
          className={showAddDevice ? 'btn-secondary' : 'btn-primary'}
        >
          {showAddDevice ? '✕ 취소' : '+ 장치 추가'}
        </button>
      </div>

      {/* 장치 추가 폼 */}
      {showAddDevice && (
        <div className="bg-violet-50 border-2 border-violet-200 rounded-xl p-4 mb-4 animate-fade-in-up">
          <h3 className="text-base font-bold text-violet-700 mb-3">새 장치 추가</h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-sm text-gray-600 font-semibold mb-1.5 block">장치 유형</label>
              <select
                value={newDevice.type}
                onChange={(e) => setNewDevice({ ...newDevice, type: e.target.value, name: '' })}
                className="input-field text-sm"
              >
                {DEVICE_TYPES.map(dt => (
                  <option key={dt.value} value={dt.value}>
                    {dt.icon} {dt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm text-gray-600 font-semibold mb-1.5 block">장치 이름 (선택)</label>
              <input
                type="text"
                placeholder={`예: ${getDeviceLabel(newDevice.type)} 1`}
                value={newDevice.name}
                onChange={(e) => setNewDevice({ ...newDevice, name: e.target.value })}
                className="input-field text-sm"
              />
            </div>
          </div>
          <div className="text-sm text-gray-500 mb-3">
            제어 방식: <span className="text-violet-600 font-semibold">
              {DEVICE_TYPES.find(d => d.value === newDevice.type)?.commands}
            </span>
          </div>
          <button onClick={addDevice} className="btn-success w-full">✅ 장치 추가</button>
        </div>
      )}

      {/* 장치 목록 */}
      {devices.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-gray-500 text-sm">제어 장치가 없습니다. 위에서 추가하세요.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {devices.map(device => (
            <div
              key={device.deviceId}
              className="flex items-center gap-3 bg-gray-50 border border-gray-200
                        rounded-xl px-4 py-3 hover:bg-gray-100 transition-all"
            >
              <span className="text-2xl">{device.icon || getDeviceIcon(device.type)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-base font-bold text-gray-800">{device.name}</p>
                <p className="text-xs text-gray-500 truncate">
                  {device.deviceId} · {getDeviceLabel(device.type)} ·
                  {device.type === 'fan' || device.type === 'heater' ? ' ON/OFF' : ' 열기/정지/닫기'}
                </p>
              </div>
              <button
                onClick={() => removeDevice(device.deviceId)}
                className="p-2 rounded-lg text-gray-400 hover:text-rose-500 hover:bg-rose-50
                         transition-all text-base border border-transparent hover:border-rose-200"
              >
                🗑️
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const SensorEditForm = ({ sensor, onSave, onCancel }) => {
  const [editData, setEditData] = useState(sensor);

  return (
    <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4 animate-fade-in-up">
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <label className="text-sm text-gray-600 font-semibold mb-1.5 block">센서 이름</label>
          <input type="text" value={editData.name}
            onChange={(e) => setEditData({ ...editData, name: e.target.value })}
            className="input-field text-sm" />
        </div>
        <div>
          <label className="text-sm text-gray-600 font-semibold mb-1.5 block">아이콘</label>
          <input type="text" value={editData.icon}
            onChange={(e) => setEditData({ ...editData, icon: e.target.value })}
            className="input-field text-sm" />
        </div>
        <div>
          <label className="text-sm text-gray-600 font-semibold mb-1.5 block">최소값 (임계값)</label>
          <input type="number" value={editData.min}
            onChange={(e) => setEditData({ ...editData, min: parseFloat(e.target.value) })}
            className="input-field text-sm" />
        </div>
        <div>
          <label className="text-sm text-gray-600 font-semibold mb-1.5 block">최대값 (임계값)</label>
          <input type="number" value={editData.max}
            onChange={(e) => setEditData({ ...editData, max: parseFloat(e.target.value) })}
            className="input-field text-sm" />
        </div>
      </div>
      <div className="flex gap-3">
        <button onClick={() => onSave(editData)} className="flex-1 btn-success">💾 저장</button>
        <button onClick={onCancel} className="flex-1 btn-secondary">취소</button>
      </div>
    </div>
  );
};

export default ConfigurationManager;
