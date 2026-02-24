import React, { useState, useEffect, lazy, Suspense } from 'react';
import axiosBase from 'axios';
import { getApiBase, isFarmLocalMode, setFarmLocalMode } from '../../services/apiSwitcher';

const AutomationManager = lazy(() => import('../Dashboard/AutomationManager'));

// 모든 요청에 자동으로 인증 토큰 추가
const axios = axiosBase.create();
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const ConfigurationManager = ({ farmId = 'farm_001' }) => {
  const [activeTab, setActiveTab] = useState('houses');
  const [selectedHouse, setSelectedHouse] = useState(null);

  // 캐시에서 즉시 로드 → API는 백그라운드 갱신
  const loadHousesFromCache = () => {
    try {
      const cached = localStorage.getItem(`cachedConfig_${farmId}`);
      if (cached) {
        const cachedData = JSON.parse(cached);
        if (cachedData.houses) return cachedData.houses;
      }
    } catch {}
    return [];
  };

  const [houses, setHouses] = useState(() => loadHousesFromCache());
  const [loading, setLoading] = useState(() => loadHousesFromCache().length === 0);

  useEffect(() => {
    loadHouses();
  }, [farmId]);

  const loadHouses = async () => {
    const hadCache = houses.length > 0;
    if (!hadCache) setLoading(true);
    try {
      const response = await axios.get(`${getApiBase()}/config/farm/${farmId}`, { timeout: 5000 });
      if (response.data.success) {
        setHouses(response.data.data);
        setSelectedHouse(prev => {
          if (!prev) return null;
          return response.data.data.find(h => h.houseId === prev.houseId) || null;
        });
      } else if (!hadCache) {
        setHouses(loadHousesFromCache());
      }
    } catch (error) {
      console.error('Failed to load houses:', error);
      if (!hadCache) setHouses(loadHousesFromCache());
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
      const response = await axios.post(`${getApiBase()}/config`, {
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
      const response = await axios.delete(`${getApiBase()}/config/${houseId}?farmId=${farmId}`);
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
    { id: 'automation', label: '자동화규칙', icon: '🤖' },
    { id: 'system', label: '시스템', icon: '⚙️' },
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
        <Suspense fallback={<div className="skeleton h-96 rounded-2xl" />}>
          <AutomationManager farmId={farmId} />
        </Suspense>
      )}

      {/* 시스템 설정 탭 */}
      {activeTab === 'system' && (
        <SystemSettings />
      )}
    </div>
  );
};

const INTERVAL_PRESETS = [
  { value: 10, label: '10초', desc: '테스트용' },
  { value: 30, label: '30초', desc: '빠른 모니터링' },
  { value: 60, label: '1분', desc: '일반 (기본)' },
  { value: 300, label: '5분', desc: '저전력' },
  { value: 600, label: '10분', desc: '장기 모니터링' },
];

const HouseDetailEditor = ({ house, onUpdate }) => {
  const [editedHouse, setEditedHouse] = useState(house);
  const [editingSensor, setEditingSensor] = useState(null);
  const [showAddSensor, setShowAddSensor] = useState(false);
  const [showNodeRedGuide, setShowNodeRedGuide] = useState(false);
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
        `${getApiBase()}/config/${house.houseId}?farmId=${house.farmId}`,
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
        `${getApiBase()}/config/${house.houseId}?farmId=${house.farmId}`,
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
        `${getApiBase()}/config/${house.houseId}?farmId=${house.farmId}`,
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
        `${getApiBase()}/config/${house.houseId}?farmId=${house.farmId}`,
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

        {/* 하우스 이름 */}
        <div className="mb-4">
          <label className="text-sm text-gray-600 font-semibold mb-1.5 block">하우스 이름</label>
          <input
            type="text"
            value={editedHouse.houseName}
            onChange={(e) => setEditedHouse({ ...editedHouse, houseName: e.target.value })}
            className="input-field"
          />
        </div>

        {/* 수집 주기 */}
        <div className="mb-4">
          <label className="text-sm text-gray-600 font-semibold mb-1.5 block">수집 주기</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {INTERVAL_PRESETS.map(preset => (
              <button
                key={preset.value}
                onClick={() => setEditedHouse({
                  ...editedHouse,
                  collection: { ...editedHouse.collection, intervalSeconds: preset.value }
                })}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
                  ${editedHouse.collection.intervalSeconds === preset.value
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                  }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number"
              value={editedHouse.collection.intervalSeconds}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val)) setEditedHouse({
                  ...editedHouse,
                  collection: { ...editedHouse.collection, intervalSeconds: Math.max(10, Math.min(3600, val)) }
                });
              }}
              className="input-field w-28"
              min="10" max="3600"
            />
            <span className="text-sm text-gray-500">초 (10~3600)</span>
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            {INTERVAL_PRESETS.find(p => p.value === editedHouse.collection.intervalSeconds)?.desc
              || `${editedHouse.collection.intervalSeconds}초 간격`}
            {' · '}하루 약 {Math.floor(86400 / (editedHouse.collection.intervalSeconds || 60)).toLocaleString()}건 수집
          </p>
        </div>

        {/* Node-RED 연동 안내 */}
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-3.5 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">🔴</span>
              <div>
                <p className="text-sm font-bold text-orange-700">Node-RED 자동 동기화</p>
                <p className="text-xs text-orange-600">
                  Node-RED가 이 설정을 자동으로 가져가 수집 주기를 맞춥니다
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowNodeRedGuide(!showNodeRedGuide)}
              className="text-xs text-orange-500 hover:text-orange-700 underline whitespace-nowrap ml-2"
            >
              {showNodeRedGuide ? '접기' : '설정 가이드'}
            </button>
          </div>

          {showNodeRedGuide && (
            <div className="mt-3 pt-3 border-t border-orange-200 space-y-2.5">
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1">Node-RED 설정 조회 API</p>
                <code className="block text-xs bg-white border border-orange-100 rounded-lg px-3 py-2 font-mono text-gray-700 break-all">
                  GET {getApiBase()}/config/node-red/{house.farmId}/{house.houseId}
                </code>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1">응답 예시</p>
                <pre className="text-[11px] bg-white border border-orange-100 rounded-lg px-3 py-2 font-mono text-gray-600 overflow-x-auto">
{JSON.stringify({
  success: true,
  data: {
    farmId: house.farmId,
    houseId: house.houseId,
    intervalSeconds: editedHouse.collection.intervalSeconds,
    sensors: (editedHouse.sensors || []).slice(0, 2).map(s => ({
      sensorId: s.sensorId, name: s.name, unit: s.unit
    }))
  }
}, null, 2)}
                </pre>
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1">Node-RED Flow 구성</p>
                <div className="text-xs text-gray-600 bg-white border border-orange-100 rounded-lg px-3 py-2 space-y-1">
                  <p><span className="font-mono bg-gray-100 px-1 rounded">Inject</span> (5분 반복) →
                     <span className="font-mono bg-gray-100 px-1 rounded">HTTP Request</span> (위 API 호출) →
                     <span className="font-mono bg-gray-100 px-1 rounded">Function</span> (아래 코드)</p>
                  <pre className="mt-1.5 text-[10px] bg-gray-50 rounded p-2 font-mono overflow-x-auto whitespace-pre">{`var data = msg.payload.data;
flow.set('intervalSeconds', data.intervalSeconds);
flow.set('sensors', data.sensors);
node.status({text: data.intervalSeconds + "초"});
return msg;`}</pre>
                  <p className="text-gray-400 mt-1">센서 수집 Inject 노드에서 <code className="bg-gray-100 px-1 rounded">flow.get('intervalSeconds')</code>를 반복 주기로 사용</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <button onClick={updateHouse} className="btn-primary w-full">💾 저장</button>
      </div>

      {/* 재배작물 */}
      <div className="glass-card p-4 md:p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-800">🌿 재배작물 ({(editedHouse.crops || []).length})</h2>
          <button
            onClick={() => {
              const crops = [...(editedHouse.crops || [])];
              crops.push({ name: '', variety: '', plantingDate: '', area: '' });
              setEditedHouse({ ...editedHouse, crops });
            }}
            className="btn-primary"
          >
            + 작물 추가
          </button>
        </div>

        {(editedHouse.crops || []).length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">등록된 재배작물이 없습니다</p>
        ) : (
          <div className="space-y-3">
            {(editedHouse.crops || []).map((crop, idx) => {
              const updateCrop = (field, value) => {
                const crops = [...editedHouse.crops];
                crops[idx] = { ...crops[idx], [field]: value };
                setEditedHouse({ ...editedHouse, crops });
              };
              const removeCrop = () => {
                if (!confirm(`"${crop.name || '작물'}"을(를) 삭제하시겠습니까?`)) return;
                const crops = editedHouse.crops.filter((_, i) => i !== idx);
                setEditedHouse({ ...editedHouse, crops });
              };
              const daysSincePlanting = crop.plantingDate
                ? Math.floor((new Date() - new Date(crop.plantingDate)) / (1000 * 60 * 60 * 24))
                : null;

              return (
                <div key={idx} className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-bold text-emerald-700">
                      {crop.name || `작물 ${idx + 1}`}
                      {crop.variety && <span className="text-emerald-500 font-normal ml-1">({crop.variety})</span>}
                    </span>
                    <button onClick={removeCrop} className="text-xs text-rose-400 hover:text-rose-600 transition-colors">삭제</button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">작물명</label>
                      <input type="text" placeholder="토마토" value={crop.name || ''}
                        onChange={(e) => updateCrop('name', e.target.value)} className="input-field text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">품종</label>
                      <input type="text" placeholder="설향" value={crop.variety || ''}
                        onChange={(e) => updateCrop('variety', e.target.value)} className="input-field text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">정식일</label>
                      <input type="date" value={crop.plantingDate || ''}
                        onChange={(e) => updateCrop('plantingDate', e.target.value)} className="input-field text-sm" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">재배면적</label>
                      <input type="text" placeholder="100평" value={crop.area || ''}
                        onChange={(e) => updateCrop('area', e.target.value)} className="input-field text-sm" />
                    </div>
                  </div>
                  {daysSincePlanting !== null && daysSincePlanting >= 0 && (
                    <p className="text-xs text-emerald-600 mt-2">정식 후 {daysSincePlanting}일 경과</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <button onClick={updateHouse} className="btn-primary w-full mt-3">💾 저장</button>
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
        `${getApiBase()}/config/${house.houseId}?farmId=${house.farmId}`,
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
        `${getApiBase()}/config/${house.houseId}?farmId=${house.farmId}`,
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

const TIMEOUT_PRESETS = [
  { value: 60, label: '1분', desc: '빠른 감지' },
  { value: 180, label: '3분', desc: '기본' },
  { value: 300, label: '5분', desc: '보통' },
  { value: 600, label: '10분', desc: '느긋한 감지' },
];

const POLLING_PRESETS = [
  { value: 5, label: '5초', desc: '실시간' },
  { value: 10, label: '10초', desc: '기본' },
  { value: 30, label: '30초', desc: '보통' },
  { value: 60, label: '1분', desc: '절약' },
];

const RETENTION_PRESETS = [
  { value: 30, label: '1개월', desc: '최소 보관' },
  { value: 60, label: '2개월', desc: '기본' },
  { value: 90, label: '3개월', desc: '권장' },
  { value: 180, label: '6개월', desc: '장기 보관' },
];

const SystemSettings = () => {
  const [farmLocal, setFarmLocal] = useState(isFarmLocalMode());

  const handleFarmLocalToggle = () => {
    const newValue = !farmLocal;
    setFarmLocalMode(newValue);
    setFarmLocal(newValue);
    setTimeout(() => window.location.reload(), 300);
  };

  const getSavedTimeout = () => {
    try {
      const val = parseInt(localStorage.getItem('smartfarm_serverTimeout'));
      if (!isNaN(val) && val >= 30) return val;
    } catch {}
    return 180;
  };

  const getSavedPolling = () => {
    try {
      const val = parseInt(localStorage.getItem('smartfarm_pollingInterval'));
      if (!isNaN(val) && val >= 3) return val;
    } catch {}
    return 10;
  };

  const [timeoutSec, setTimeoutSec] = useState(getSavedTimeout);
  const [pollingSec, setPollingSec] = useState(getSavedPolling);
  const [retentionDays, setRetentionDays] = useState(60);
  const [serverRetention, setServerRetention] = useState(60); // 서버에 저장된 값
  const [retentionLoading, setRetentionLoading] = useState(true);
  const [saved, setSaved] = useState(true);

  // 서버에서 보관 기간 설정 로드
  useEffect(() => {
    loadRetentionSetting();
  }, []);

  const loadRetentionSetting = async () => {
    try {
      setRetentionLoading(true);
      const res = await axios.get(`${getApiBase()}/config/system-settings/farm_001`, { timeout: 5000 });
      if (res.data.success) {
        const days = res.data.data.retentionDays || 60;
        setRetentionDays(days);
        setServerRetention(days);
      }
    } catch (err) {
      console.warn('시스템 설정 로드 실패 (기본값 사용):', err.message);
    } finally {
      setRetentionLoading(false);
    }
  };

  const checkSaved = (timeout, polling, retention) => {
    return timeout === getSavedTimeout() && polling === getSavedPolling() && retention === serverRetention;
  };

  const handleChange = (val) => {
    const clamped = Math.max(30, Math.min(1800, val));
    setTimeoutSec(clamped);
    setSaved(checkSaved(clamped, pollingSec, retentionDays));
  };

  const handlePollingChange = (val) => {
    const clamped = Math.max(3, Math.min(300, val));
    setPollingSec(clamped);
    setSaved(checkSaved(timeoutSec, clamped, retentionDays));
  };

  const handleRetentionChange = (val) => {
    const clamped = Math.max(7, Math.min(365, val));
    setRetentionDays(clamped);
    setSaved(checkSaved(timeoutSec, pollingSec, clamped));
  };

  const handleSave = async () => {
    // localStorage 설정 저장
    localStorage.setItem('smartfarm_serverTimeout', String(timeoutSec));
    localStorage.setItem('smartfarm_pollingInterval', String(pollingSec));

    // 서버에 보관 기간 저장
    if (retentionDays !== serverRetention) {
      try {
        const res = await axios.put(`${getApiBase()}/config/system-settings/farm_001`, {
          retentionDays,
        });
        if (res.data.success) {
          setServerRetention(retentionDays);
        }
      } catch (err) {
        alert('보관 기간 저장 실패: ' + (err.response?.data?.error || err.message));
        return;
      }
    }

    setSaved(true);
    alert('저장되었습니다!');
  };

  const formatTime = (sec) => {
    if (sec >= 60) {
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return s > 0 ? `${m}분 ${s}초` : `${m}분`;
    }
    return `${sec}초`;
  };

  const formatDays = (days) => {
    if (days >= 30) {
      const months = Math.floor(days / 30);
      const d = days % 30;
      return d > 0 ? `${months}개월 ${d}일` : `${months}개월`;
    }
    return `${days}일`;
  };

  return (
    <div className="max-w-2xl space-y-4 animate-fade-in-up">
      {/* 팜로컬 모드 */}
      <div className="glass-card p-4 md:p-5">
        <h2 className="text-lg font-bold text-gray-800 mb-2">팜로컬 모드</h2>
        <p className="text-xs text-gray-400 mb-3">
          인터넷 연결 없이 라즈베리파이 단독으로 운영할 때 활성화하세요.
          터치패널에서 직접 대시보드를 확인하고 제어할 수 있습니다.
        </p>

        <div className="flex items-center justify-between bg-gray-50 rounded-xl p-4 border border-gray-200">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🌿</span>
            <div>
              <p className="text-sm font-bold text-gray-800">팜로컬 모드</p>
              <p className="text-xs text-gray-500">
                {farmLocal ? '활성 - RPi 독립 운영 중' : '비활성 - 서버/클라우드 연동 모드'}
              </p>
            </div>
          </div>
          <button
            onClick={handleFarmLocalToggle}
            className={`relative w-14 h-7 rounded-full transition-all ${farmLocal ? 'bg-emerald-500' : 'bg-gray-300'}`}
          >
            <span className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-all ${farmLocal ? 'left-7' : 'left-0.5'}`} />
          </button>
        </div>

        {farmLocal && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 mt-3">
            <div className="flex items-start gap-2">
              <span className="text-lg mt-0.5">✅</span>
              <div>
                <p className="text-sm font-bold text-emerald-700">팜로컬 모드 활성</p>
                <p className="text-xs text-emerald-600 leading-relaxed">
                  서버 헬스체크 중지, 모든 API가 로컬로 전송됩니다.
                  대시보드, 제어, 기본 설정만 표시됩니다.
                </p>
              </div>
            </div>
          </div>
        )}

        {!farmLocal && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 mt-3">
            <div className="flex items-start gap-2">
              <span className="text-lg mt-0.5">💡</span>
              <div>
                <p className="text-sm font-bold text-amber-700">모드 전환 안내</p>
                <p className="text-xs text-amber-600 leading-relaxed">
                  전환 후 페이지가 새로고침됩니다.
                  팜로컬 모드에서는 영농일지, AI, 사용자 관리 등 서버 전용 기능을 사용할 수 없습니다.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 서버 연결 설정 (팜로컬에서는 숨김) */}
      {!farmLocal && <div className="glass-card p-4 md:p-5">
        <h2 className="text-lg font-bold text-gray-800 mb-4">서버 연결 설정</h2>

        {/* 서버 연결 타임아웃 */}
        <div className="mb-4">
          <label className="text-sm text-gray-600 font-semibold mb-1.5 block">
            서버 연결 타임아웃
          </label>
          <p className="text-xs text-gray-400 mb-3">
            서버 연결이 <span className="text-red-500 font-bold">{formatTime(timeoutSec)}</span> 이상 끊기면 대시보드에 경고 알림을 표시합니다
          </p>

          <div className="flex flex-wrap gap-2 mb-2">
            {TIMEOUT_PRESETS.map(preset => (
              <button
                key={preset.value}
                onClick={() => handleChange(preset.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
                  ${timeoutSec === preset.value
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                  }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <input
              type="number"
              value={timeoutSec}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val)) handleChange(val);
              }}
              className="input-field w-28"
              min="30" max="1800"
            />
            <span className="text-sm text-gray-500">초 (30~1800)</span>
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            {TIMEOUT_PRESETS.find(p => p.value === timeoutSec)?.desc || `${formatTime(timeoutSec)} 간격`}
            {' · '}헬스체크 주기 10초
          </p>
        </div>

        {/* 대시보드 폴링 주기 */}
        <div className="mb-4">
          <label className="text-sm text-gray-600 font-semibold mb-1.5 block">
            대시보드 데이터 갱신 주기
          </label>
          <p className="text-xs text-gray-400 mb-3">
            대시보드가 <span className="text-blue-500 font-bold">{formatTime(pollingSec)}</span>마다 서버에서 최신 센서 데이터를 가져옵니다
          </p>

          <div className="flex flex-wrap gap-2 mb-2">
            {POLLING_PRESETS.map(preset => (
              <button
                key={preset.value}
                onClick={() => handlePollingChange(preset.value)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
                  ${pollingSec === preset.value
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                  }`}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <input
              type="number"
              value={pollingSec}
              onChange={(e) => {
                const val = parseInt(e.target.value);
                if (!isNaN(val)) handlePollingChange(val);
              }}
              className="input-field w-28"
              min="3" max="300"
            />
            <span className="text-sm text-gray-500">초 (3~300)</span>
          </div>
          <p className="text-xs text-gray-400 mt-1.5">
            {POLLING_PRESETS.find(p => p.value === pollingSec)?.desc || `${formatTime(pollingSec)} 간격`}
            {' · '}짧을수록 실시간 반영, 길수록 네트워크 부하 감소
          </p>
        </div>

        {/* 안내 */}
        <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 mb-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚠️</span>
            <div>
              <p className="text-sm font-bold text-red-700">알림 동작</p>
              <p className="text-xs text-red-600">
                설정 시간이 지나면 대시보드 상단에 빨간 경고 배너가 나타나고,
                "로컬 운영 전환" 버튼으로 즉시 로컬 모드로 전환할 수 있습니다.
                서버가 복구되면 알림이 자동으로 사라집니다.
              </p>
            </div>
          </div>
        </div>
      </div>}

      {/* 로컬 데이터 보관 설정 */}
      <div className="glass-card p-4 md:p-5">
        <h2 className="text-lg font-bold text-gray-800 mb-4">로컬 데이터 보관 설정</h2>

        <div className="mb-4">
          <label className="text-sm text-gray-600 font-semibold mb-1.5 block">
            로컬 데이터 보관 기간
          </label>
          <p className="text-xs text-gray-400 mb-3">
            라즈베리파이(로컬)에 저장된 센서 데이터를{' '}
            <span className="text-emerald-600 font-bold">{formatDays(retentionDays)}</span> 동안 보관합니다.
            서버로 동기화 완료된 오래된 데이터는 자동으로 삭제됩니다.
          </p>

          {retentionLoading ? (
            <div className="text-sm text-gray-400 py-2">서버 설정 불러오는 중...</div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-2">
                {RETENTION_PRESETS.map(preset => (
                  <button
                    key={preset.value}
                    onClick={() => handleRetentionChange(preset.value)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
                      ${retentionDays === preset.value
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-emerald-300 hover:bg-emerald-50'
                      }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={retentionDays}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    if (!isNaN(val)) handleRetentionChange(val);
                  }}
                  className="input-field w-28"
                  min="7" max="365"
                />
                <span className="text-sm text-gray-500">일 (7~365)</span>
              </div>
              <p className="text-xs text-gray-400 mt-1.5">
                {RETENTION_PRESETS.find(p => p.value === retentionDays)?.desc || `${formatDays(retentionDays)} 보관`}
                {' · '}10분 간격 수집 기준 약 {(retentionDays * 144 * 0.02 / 1024).toFixed(1)}MB
              </p>
            </>
          )}
        </div>

        {/* 안내 */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5">
          <div className="flex items-center gap-2">
            <span className="text-lg">💾</span>
            <div>
              <p className="text-sm font-bold text-emerald-700">자동 적용</p>
              <p className="text-xs text-emerald-600">
                저장하면 라즈베리파이 Node-RED가 다음 정리 주기(매일 자정)에 새 보관 기간을 자동 반영합니다.
                서버 동기화가 완료된 데이터만 삭제되므로 미동기화 데이터는 안전합니다.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 저장 버튼 */}
      <button
        onClick={handleSave}
        disabled={saved}
        className={`w-full py-2.5 rounded-xl text-base font-bold transition-all active:scale-[0.97]
          ${saved
            ? 'bg-gray-100 text-gray-400 border border-gray-200 cursor-default'
            : 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 cursor-pointer'
          }`}
      >
        {saved ? '저장 완료' : '저장'}
      </button>
    </div>
  );
};

export default ConfigurationManager;
