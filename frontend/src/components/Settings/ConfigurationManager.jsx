import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import axiosBase from 'axios';
import { getApiBase, getPcApiBase, getRpiApiBase, isFarmLocalMode, setFarmLocalMode } from '../../services/apiSwitcher';

const AutomationManager = lazy(() => import('../Dashboard/AutomationManager'));

// 모든 요청에 자동으로 인증 토큰 추가
const axios = axiosBase.create();
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// RPi → PC 설정 동기화 (백그라운드, fire & forget)
// x-api-key 헤더로 인증 → JWT 없는 팜로컬 모드에서도 동작
const SYNC_API_KEY = import.meta.env.VITE_SENSOR_API_KEY;
function syncConfigToPC(farmId) {
  const rpiUrl = getRpiApiBase();
  const pcUrl = getPcApiBase();
  if (rpiUrl === pcUrl) return;  // 동일 서버면 스킵

  axiosBase.get(`${rpiUrl}/config/farm/${farmId}`, { timeout: 5000 })
    .then(res => {
      if (res?.data?.success && Array.isArray(res.data.data) && res.data.data.length > 0) {
        return axiosBase.post(`${pcUrl}/config/${farmId}/sync`,
          { configs: res.data.data },
          { timeout: 10000, headers: { 'x-api-key': SYNC_API_KEY } }
        );
      }
    })
    .then(res => {
      if (res?.data?.success) {
        console.log('[ConfigSync] RPi→PC:', res.data.data);
      }
    })
    .catch(err => { console.warn('[ConfigSync] 동기화 실패:', err.message); });
}

// RPi-Primary API: 쓰기는 RPi에만 (PC 폴백 없음 → 중복 방지)
async function rpiApi(method, path, data) {
  const rpiUrl = getRpiApiBase() + path;
  return await axiosBase({ method, url: rpiUrl, data, timeout: 8000 });
}

// 통일 서브탭 바 (모든 탭에서 재사용)
export const SubTabBar = ({ tabs, activeTab, onChange, trailing }) => (
  <div className="flex flex-wrap items-center gap-1.5 md:gap-2 mb-4">
    {tabs.map(tab => (
      <button key={tab.id} onClick={() => onChange(tab.id)}
        className={`flex items-center gap-1 md:gap-1.5 px-2.5 md:px-4 py-2 md:py-2.5 rounded-lg text-xs md:text-sm font-bold transition-all ${
          activeTab === tab.id
            ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25'
            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
        }`}>
        <span>{tab.icon}</span> {tab.label}
        {tab.count != null && tab.count > 0 && (
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
            activeTab === tab.id ? 'bg-white/25 text-white' : 'bg-gray-300 text-gray-600'
          }`}>{tab.count}</span>
        )}
      </button>
    ))}
    {trailing && <div className="ml-auto">{trailing}</div>}
  </div>
);

const ConfigurationManager = ({ farmId = import.meta.env.VITE_FARM_ID || 'farm_0001' }) => {
  const [activeTab, setActiveTab] = useState(() => {
    const saved = localStorage.getItem('settings_activeTab');
    return ['houses', 'automation', 'alerts', 'system'].includes(saved) ? saved : 'houses';
  });
  const [selectedHouse, setSelectedHouse] = useState(null);
  const [housesSubTab, setHousesSubTab] = useState('list');

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
      const rpiUrl = getRpiApiBase();
      const pcUrl = getApiBase();
      const isDual = rpiUrl !== pcUrl;

      // PC + RPi 병렬 로드 (RPi가 권한 기준)
      const [pcRes, rpiRes] = await Promise.all([
        axios.get(`${pcUrl}/config/farm/${farmId}`, { timeout: 5000 }).catch(() => null),
        isDual ? axiosBase.get(`${rpiUrl}/config/farm/${farmId}`, { timeout: 5000 }).catch(() => null) : null,
      ]);

      const pcHouses = pcRes?.data?.success ? pcRes.data.data : [];
      const rpiHouses = rpiRes?.data?.success ? rpiRes.data.data : [];

      // RPi 데이터 있으면 우선 사용 (권한 기준), 없으면 PC 폴백
      const finalHouses = rpiHouses.length > 0 ? rpiHouses : pcHouses;

      if (finalHouses.length > 0) {
        setHouses(finalHouses);
        try { localStorage.setItem(`cachedConfig_${farmId}`, JSON.stringify({ houses: finalHouses })); } catch {}
        setSelectedHouse(prev => {
          if (!prev) return null;
          return finalHouses.find(h => h.houseId === prev.houseId) || null;
        });
        // RPi와 PC 불일치 시 백그라운드 sync (RPi가 PC보다 적으면 스킵 — 잘못된 삭제 방지)
        if (isDual && rpiHouses.length > 0 && rpiHouses.length > pcHouses.length) {
          syncConfigToPC(farmId);
        }
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
    // RPi 기준 최신 하우스 목록으로 다음 ID 계산 (PC↔RPi 데이터 차이로 인한 ID 충돌 방지)
    let allHouses = houses;
    try {
      const rpiRes = await axiosBase.get(`${getRpiApiBase()}/config/farm/${farmId}`, { timeout: 5000 });
      if (rpiRes.data?.success && Array.isArray(rpiRes.data.data)) allHouses = rpiRes.data.data;
    } catch {} // RPi 조회 실패 시 UI에 있는 목록 사용

    const existingNumbers = allHouses.map(h => {
      const match = h.houseId?.match(/house_(\d+)/);
      return match ? parseInt(match[1]) : 0;
    });
    const nextNumber = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
    const newHouseId = `house_${String(nextNumber).padStart(4, '0')}`;

    try {
      const response = await rpiApi('post', '/config', {
        farmId,
        houseId: newHouseId,
        houseName: `${nextNumber}번 하우스`,
        deviceCount: 1,
        collection: { intervalSeconds: 60, method: 'http', retryAttempts: 3 },
        sensors: [
          {
            sensorId: 'temp_0001', name: '온도', unit: '°C', type: 'number',
            min: -10, max: 50, enabled: true, order: 1, icon: '🌡️', color: '#EF4444', precision: 1
          },
          {
            sensorId: 'humidity_0001', name: '습도', unit: '%', type: 'number',
            min: 0, max: 100, enabled: true, order: 2, icon: '💧', color: '#3B82F6', precision: 1
          }
        ]
      });
      if (response.data.success) {
        alert('✅ 하우스가 생성되었습니다!');
        // 즉시 UI 반영 — RPi 응답 데이터로 추가 (PC sync 지연 무관)
        const created = response.data.data || response.data.config;
        if (created) {
          setHouses(prev => [...prev, created]);
        } else {
          loadHouses();
        }
        syncConfigToPC(farmId);
      }
    } catch (error) {
      alert('❌ 하우스 생성 실패: ' + (error.response?.data?.error || error.message));
    }
  };

  const [deleteConfirm, setDeleteConfirm] = useState(null);

  const deleteHouse = async (houseId) => {
    console.log('[Config] deleteHouse called:', houseId);
    try {
      const response = await rpiApi('delete', `/config/${houseId}?farmId=${farmId}`);
      console.log('[Config] deleteHouse response:', response.data);
      if (response.data.success) {
        setHouses(prev => prev.filter(h => h.houseId !== houseId));
        if (selectedHouse?.houseId === houseId) setSelectedHouse(null);
        syncConfigToPC(farmId);
      }
    } catch (error) {
      console.error('[Config] deleteHouse error:', error);
      alert('❌ 삭제 실패: ' + (error.response?.data?.error || error.message));
    } finally {
      setDeleteConfirm(null);
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
    { id: 'alerts', label: '알림설정', icon: '🔔' },
    { id: 'system', label: '시스템', icon: '⚙️' },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6">
      {/* 헤더 */}
      <div className="mb-5 animate-fade-in-up">
        <h1 className="text-2xl font-bold text-gray-800 tracking-tight">설정 관리</h1>
        <p className="text-gray-500 text-sm md:text-base mt-0.5">하우스, 센서, 자동화 설정</p>
      </div>

      {/* 탭 네비게이션 + 탭별 액션 버튼 */}
      <div className="grid grid-cols-4 gap-1.5 md:flex md:items-center md:gap-2 mb-5 animate-fade-in-up">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); localStorage.setItem('settings_activeTab', tab.id); }}
            className={`flex items-center justify-center gap-1 md:gap-2 px-2 md:px-5 py-2.5 rounded-xl text-xs md:text-base font-bold
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
        <div className="animate-fade-in-up">
          <SubTabBar
            tabs={[
              { id: 'list', label: '하우스 목록', icon: '📋' },
              { id: 'detail', label: '하우스 상세', icon: '🔧' },
            ]}
            activeTab={housesSubTab}
            onChange={setHousesSubTab}
            trailing={housesSubTab === 'list' && (
              <button onClick={createNewHouse} className="btn-success flex-shrink-0">+ 하우스 추가</button>
            )}
          />

          {housesSubTab === 'list' && (
            <div className="glass-card p-4 md:p-5">
              {houses.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-600 text-base">하우스가 없습니다</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
                        onClick={() => { setSelectedHouse(house); setHousesSubTab('detail'); }}
                        className="flex-1 text-left"
                      >
                        <p className="text-base font-bold text-gray-800">{house.houseName}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {house.sensors.length}개 센서 · {house.devices?.length || 0}개 장치
                        </p>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setDeleteConfirm(house); }}
                        className="p-2 rounded-lg text-gray-400 hover:text-rose-500 hover:bg-rose-50 transition-all text-base"
                        title="삭제"
                      >
                        🗑️
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {housesSubTab === 'detail' && (
            selectedHouse ? (
              <HouseDetailEditor house={selectedHouse} onUpdate={() => { loadHouses(); syncConfigToPC(farmId); }} />
            ) : (
              <div className="glass-card p-12 text-center">
                <div className="text-4xl mb-4 opacity-30">⚙️</div>
                <p className="text-gray-500 text-base">하우스 목록에서 하우스를 선택하세요</p>
              </div>
            )
          )}
        </div>
      )}

      {/* 자동화 탭 */}
      {activeTab === 'automation' && (
        <Suspense fallback={<div className="skeleton h-96 rounded-2xl" />}>
          <AutomationManager farmId={farmId} />
        </Suspense>
      )}

      {/* 알림설정 탭 */}
      {activeTab === 'alerts' && (
        <AlertSettingsTab farmId={farmId} houses={houses} onHousesUpdate={loadHouses} />
      )}

      {/* 시스템 설정 탭 */}
      {activeTab === 'system' && (
        <SystemSettings farmId={farmId} />
      )}

      {/* 삭제 확인 모달 */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setDeleteConfirm(null)}>
          <div className="bg-white rounded-xl p-6 max-w-sm mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-800 mb-2">하우스 삭제</h3>
            <p className="text-sm text-gray-600 mb-4">
              <span className="font-semibold text-rose-600">"{deleteConfirm.houseName}"</span>을(를) 삭제하시겠습니까?<br/>
              모든 센서 설정이 삭제됩니다.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                취소
              </button>
              <button onClick={() => deleteHouse(deleteConfirm.houseId)}
                className="px-4 py-2 text-sm text-white bg-rose-600 hover:bg-rose-700 rounded-lg transition-colors">
                삭제
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const HouseDetailEditor = ({ house, onUpdate }) => {
  const [editedHouse, setEditedHouse] = useState(house);
  const [editingSensor, setEditingSensor] = useState(null);
  const [showAddSensor, setShowAddSensor] = useState(false);
  const [saving, setSaving] = useState(false);

  // 섹션별 변경 감지
  const isBasicDirty = house.houseName !== editedHouse.houseName;
  const isCropsDirty = JSON.stringify(house.crops || []) !== JSON.stringify(editedHouse.crops || []);
  const isSensorsDirty = JSON.stringify(house.sensors) !== JSON.stringify(editedHouse.sensors);
  const isDevicesDirty = JSON.stringify(house.devices || []) !== JSON.stringify(editedHouse.devices || []);
  const SENSOR_PRESETS = [
    { id: 'temp', name: '온도', unit: '°C', icon: '🌡️', color: '#EF4444', min: -10, max: 50 },
    { id: 'humidity', name: '습도', unit: '%', icon: '💧', color: '#3B82F6', min: 0, max: 100 },
    { id: 'co2', name: 'CO2', unit: 'ppm', icon: '💨', color: '#8B5CF6', min: 0, max: 5000 },
    { id: 'vent', name: '환기', unit: '%', icon: '🌀', color: '#06B6D4', min: 0, max: 100 },
    { id: 'mist', name: '분무제어', unit: '%', icon: '🌫️', color: '#64748B', min: 0, max: 100 },
    { id: 'solar', name: '일사량', unit: 'W/m²', icon: '☀️', color: '#F59E0B', min: 0, max: 1500 },
    { id: 'lux', name: '조도', unit: 'lux', icon: '💡', color: '#EAB308', min: 0, max: 100000 },
    { id: 'ext_temp', name: '외부온도', unit: '°C', icon: '🌡️', color: '#F97316', min: -20, max: 50 },
    { id: 'ext_humidity', name: '외부습도', unit: '%', icon: '💧', color: '#0EA5E9', min: 0, max: 100 },
    { id: 'wind_dir', name: '풍향', unit: '°', icon: '🧭', color: '#14B8A6', min: 0, max: 360 },
    { id: 'wind_speed', name: '풍속', unit: 'm/s', icon: '💨', color: '#10B981', min: 0, max: 60 },
    { id: 'rain', name: '강우감지', unit: '', icon: '🌧️', color: '#6366F1', min: 0, max: 1 },
    { id: 'soil_moist', name: '토양수분', unit: '%', icon: '🌱', color: '#84CC16', min: 0, max: 100 },
    { id: 'media_moist', name: '배지수분', unit: '%', icon: '🪴', color: '#22C55E', min: 0, max: 100 },
    { id: 'soil_temp', name: '토양온도', unit: '°C', icon: '🌡️', color: '#A16207', min: -5, max: 50 },
    { id: 'soil_ec', name: '토양EC', unit: 'dS/m', icon: '⚡', color: '#D97706', min: 0, max: 10 },
    { id: 'soil_ph', name: '토양PH', unit: 'pH', icon: '🧪', color: '#7C3AED', min: 0, max: 14 },
    { id: 'nutri_ec', name: '양액EC', unit: 'dS/m', icon: '⚡', color: '#059669', min: 0, max: 10 },
    { id: 'nutri_ph', name: '양액PH', unit: 'pH', icon: '🧪', color: '#4F46E5', min: 0, max: 14 },
    { id: 'nutri_temp', name: '양액온도', unit: '°C', icon: '🌡️', color: '#0D9488', min: 0, max: 50 },
    { id: 'flow', name: '유량계', unit: 'L/min', icon: '🚰', color: '#2563EB', min: 0, max: 100 },
    { id: 'water_level', name: '수위센서', unit: 'cm', icon: '📏', color: '#1D4ED8', min: 0, max: 200 },
    { id: 'etc', name: '기타', unit: '', icon: '📊', color: '#6B7280', min: 0, max: 100 },
  ];

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
    setSaving(true);
    try {
      const response = await rpiApi('put', `/config/${house.houseId}?farmId=${house.farmId}`, editedHouse);
      if (response.data.success) {
        onUpdate();
      }
    } catch (error) {
      alert('❌ 저장 실패: ' + (error.response?.data?.error || error.message));
    } finally {
      setSaving(false);
    }
  };

  const updateSensor = (sensorId, updates) => {
    const updatedSensors = editedHouse.sensors.map(s =>
      s.sensorId === sensorId ? { ...s, ...updates } : s
    );
    setEditedHouse({ ...editedHouse, sensors: updatedSensors });
    setEditingSensor(null);
  };

  const addSensor = () => {
    if (!newSensor.sensorId || !newSensor.name || !newSensor.unit) {
      alert('❌ 센서 ID, 이름, 단위를 모두 입력하세요!');
      return;
    }
    if (editedHouse.sensors.some(s => s.sensorId === newSensor.sensorId)) {
      alert('❌ 이미 존재하는 센서 ID입니다!');
      return;
    }
    setEditedHouse({
      ...editedHouse,
      sensors: [...editedHouse.sensors, { ...newSensor, order: editedHouse.sensors.length + 1, precision: 1 }]
    });
    setNewSensor({ sensorId: '', name: '', unit: '', type: 'number', min: 0, max: 100, enabled: true, icon: '📊', color: '#3B82F6' });
    setShowAddSensor(false);
  };

  const removeSensor = (sensorId) => {
    if (!confirm('이 센서를 삭제하시겠습니까?')) return;
    setEditedHouse({
      ...editedHouse,
      sensors: editedHouse.sensors.filter(s => s.sensorId !== sensorId)
    });
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

        <button onClick={updateHouse} disabled={!isBasicDirty || saving}
          className={`w-full py-2.5 rounded-xl text-base font-bold transition-all
            ${isBasicDirty ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 active:scale-[0.97]'
              : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-default'}`}>
          {saving ? '저장 중...' : isBasicDirty ? '💾 저장' : '변경 없음'}
        </button>
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
        <button onClick={updateHouse} disabled={!isCropsDirty || saving}
          className={`w-full mt-3 py-2.5 rounded-xl text-base font-bold transition-all
            ${isCropsDirty ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 active:scale-[0.97]'
              : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-default'}`}>
          {saving ? '저장 중...' : isCropsDirty ? '💾 저장' : '변경 없음'}
        </button>
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

        {/* 센서 추가 — 프리셋 선택 */}
        {showAddSensor && (
          <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4 mb-4 animate-fade-in-up">
            <h3 className="text-base font-bold text-blue-700 mb-3">센서 선택</h3>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 mb-3">
              {SENSOR_PRESETS.map(preset => {
                // 이미 추가된 센서인지 확인 (같은 id prefix)
                const alreadyAdded = editedHouse.sensors.some(s => s.sensorId.startsWith(preset.id));
                return (
                  <button
                    key={preset.id}
                    onClick={() => {
                      if (preset.id === 'etc') {
                        // 기타: 직접 입력 모드
                        setNewSensor({ sensorId: '', name: '', unit: '', type: 'number', min: 0, max: 100, enabled: true, icon: '📊', color: '#6B7280' });
                      } else {
                        // 동일 타입 센서 번호 자동 증가
                        const existing = editedHouse.sensors.filter(s => s.sensorId.startsWith(preset.id));
                        const nextNum = existing.length > 0
                          ? Math.max(...existing.map(s => { const m = s.sensorId.match(/_(\d+)$/); return m ? parseInt(m[1]) : 1; })) + 1
                          : 1;
                        const sensorId = `${preset.id}_${String(nextNum).padStart(4, '0')}`;
                        setNewSensor({
                          sensorId, name: existing.length > 0 ? `${preset.name} ${nextNum}` : preset.name,
                          unit: preset.unit, type: 'number', min: preset.min, max: preset.max,
                          enabled: true, icon: preset.icon, color: preset.color
                        });
                      }
                    }}
                    className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border-2 transition-all text-center
                      ${newSensor.sensorId.startsWith(preset.id) && preset.id !== 'etc'
                        ? 'border-blue-500 bg-blue-100 shadow-sm'
                        : alreadyAdded
                          ? 'border-green-200 bg-green-50 opacity-70'
                          : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50'
                      }`}
                  >
                    <span className="text-lg">{preset.icon}</span>
                    <span className="text-xs font-bold text-gray-700 leading-tight">{preset.name}</span>
                    {alreadyAdded && <span className="text-[10px] text-green-600 font-bold">추가됨</span>}
                  </button>
                );
              })}
            </div>

            {/* 선택된 센서 상세 (또는 기타 직접입력) */}
            {(newSensor.sensorId || newSensor.name === '') && (
              <div className="bg-white rounded-lg p-3 border border-blue-200 space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">센서 ID</label>
                    <input type="text" value={newSensor.sensorId}
                      onChange={(e) => setNewSensor({ ...newSensor, sensorId: e.target.value })}
                      className="input-field text-sm" placeholder="예: co2_0001" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">이름</label>
                    <input type="text" value={newSensor.name}
                      onChange={(e) => setNewSensor({ ...newSensor, name: e.target.value })}
                      className="input-field text-sm" placeholder="예: CO2" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">단위</label>
                    <input type="text" value={newSensor.unit}
                      onChange={(e) => setNewSensor({ ...newSensor, unit: e.target.value })}
                      className="input-field text-sm" placeholder="예: ppm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">아이콘</label>
                    <input type="text" value={newSensor.icon}
                      onChange={(e) => setNewSensor({ ...newSensor, icon: e.target.value })}
                      className="input-field text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">최소값</label>
                    <input type="number" value={newSensor.min}
                      onChange={(e) => setNewSensor({ ...newSensor, min: parseFloat(e.target.value) })}
                      className="input-field text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 mb-1 block">최대값</label>
                    <input type="number" value={newSensor.max}
                      onChange={(e) => setNewSensor({ ...newSensor, max: parseFloat(e.target.value) })}
                      className="input-field text-sm" />
                  </div>
                </div>
                <button onClick={addSensor} className="btn-success w-full mt-2">
                  {newSensor.icon} {newSensor.name || '센서'} 추가
                </button>
              </div>
            )}
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

        {/* 센서 저장 버튼 */}
        <button onClick={updateHouse} disabled={!isSensorsDirty || saving}
          className={`w-full mt-3 py-2.5 rounded-xl text-base font-bold transition-all
            ${isSensorsDirty ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 active:scale-[0.97]'
              : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-default'}`}>
          {saving ? '저장 중...' : isSensorsDirty ? '💾 센서 저장' : '변경 없음'}
        </button>
      </div>

      {/* 제어 장치 관리 */}
      <DeviceManager house={editedHouse} setEditedHouse={setEditedHouse} onUpdate={onUpdate}
        isDirty={isDevicesDirty} saving={saving} onSave={updateHouse} />
    </div>
  );
};

/**
 * 제어 장치 관리 컴포넌트
 */
const DEVICE_TYPES = [
  { value: 'window', label: '1창', icon: '🪟', commands: 'open/stop/close', defaultControlType: 'bidir' },
  { value: 'side_window', label: '측창', icon: '🪟', commands: 'open/stop/close', defaultControlType: 'bidir' },
  { value: 'top_window', label: '천창', icon: '🪟', commands: 'open/stop/close', defaultControlType: 'bidir' },
  { value: 'shade', label: '차광', icon: '🌑', commands: 'open/stop/close', defaultControlType: 'bidir' },
  { value: 'screen', label: '스크린', icon: '🎞️', commands: 'open/stop/close', defaultControlType: 'bidir' },
  { value: 'pump', label: '펌프', icon: '🔧', commands: 'on/off', defaultControlType: 'single' },
  { value: 'motor', label: '모터', icon: '⚙️', commands: 'on/off', defaultControlType: 'single' },
  { value: 'light', label: '조명', icon: '💡', commands: 'on/off', defaultControlType: 'single' },
  { value: 'fan', label: '순환팬', icon: '🌀', commands: 'on/off', defaultControlType: 'single' },
  { value: 'nutrient', label: '양액공급', icon: '💧', commands: 'on/off', defaultControlType: 'single' },
  { value: 'solution', label: '배양액', icon: '🧪', commands: 'on/off', defaultControlType: 'single' },
  { value: 'light_ctrl', label: '조명제어', icon: '🔆', commands: 'on/off', defaultControlType: 'single' },
  { value: 'sprayer', label: '무인방제기', icon: '🚿', commands: 'on/off', defaultControlType: 'single' },
  { value: 'heater', label: '온풍기', icon: '🔥', commands: 'on/off', defaultControlType: 'single' },
  { value: 'cooler', label: '냉방기', icon: '❄️', commands: 'on/off', defaultControlType: 'single' },
  { value: 'co2_supply', label: 'CO2공급기', icon: '💨', commands: 'on/off', defaultControlType: 'single' },
  { value: 'mist', label: '분무제어', icon: '🌫️', commands: 'on/off', defaultControlType: 'single' },
  { value: 'valve', label: '관수밸브', icon: '🚰', commands: 'open/stop/close', defaultControlType: 'bidir' },
  { value: 'etc_device', label: '기타', icon: '🔧', commands: 'on/off', defaultControlType: 'single' },
];

const getDeviceIcon = (type) => {
  return DEVICE_TYPES.find(d => d.value === type)?.icon || '🔧';
};

const getDeviceLabel = (type) => {
  return DEVICE_TYPES.find(d => d.value === type)?.label || type;
};

const DeviceManager = ({ house, setEditedHouse, onUpdate, isDirty, saving, onSave }) => {
  const [showAddDevice, setShowAddDevice] = useState(false);
  const [expandedDevice, setExpandedDevice] = useState(null);
  const [newDevice, setNewDevice] = useState({
    type: 'window', name: '', enabled: true
  });

  const devices = house.devices || [];

  const generateDeviceId = (type) => {
    const existing = devices.filter(d => d.type === type);
    const nextNum = existing.length > 0
      ? Math.max(...existing.map(d => { const m = d.deviceId.match(/(\d+)$/); return m ? parseInt(m[1]) : 0; })) + 1
      : 1;
    return `${type}${nextNum}`;
  };

  // 특정 장치를 제외하고, 해당 unitId에서 사용 중인 CH 주소 목록 반환
  const getUsedChannels = (excludeDeviceId, unitId) => {
    const used = [];
    devices.forEach(d => {
      if (d.deviceId === excludeDeviceId) return;
      const m = d.modbus;
      if (!m || (m.unitId || 1) !== unitId) return;
      if (m.address !== null && m.address !== undefined) used.push(m.address);
      if (m.address2 !== null && m.address2 !== undefined) used.push(m.address2);
    });
    return used;
  };

  const updateDeviceModbus = (deviceId, modbusData) => {
    const current = devices.find(d => d.deviceId === deviceId);
    const dtInfo = DEVICE_TYPES.find(dt => dt.value === current?.type);
    const defaultModbus = { unitId: 1, controlType: dtInfo?.defaultControlType || 'single', address: null, address2: null };
    const merged = { ...defaultModbus, ...current?.modbus, ...modbusData };
    const unitId = merged.unitId || 1;
    const usedChs = getUsedChannels(deviceId, unitId);

    // CH 중복 검증
    if (modbusData.address !== undefined && modbusData.address !== null && usedChs.includes(modbusData.address)) {
      const conflictDev = devices.find(d => d.deviceId !== deviceId && d.modbus &&
        (d.modbus.unitId || 1) === unitId && (d.modbus.address === modbusData.address || d.modbus.address2 === modbusData.address));
      alert(`CH${modbusData.address}은(는) "${conflictDev?.name}"에서 사용 중입니다.`);
      return;
    }
    if (modbusData.address2 !== undefined && modbusData.address2 !== null && usedChs.includes(modbusData.address2)) {
      const conflictDev = devices.find(d => d.deviceId !== deviceId && d.modbus &&
        (d.modbus.unitId || 1) === unitId && (d.modbus.address === modbusData.address2 || d.modbus.address2 === modbusData.address2));
      alert(`CH${modbusData.address2}은(는) "${conflictDev?.name}"에서 사용 중입니다.`);
      return;
    }

    const updatedDevices = devices.map(d =>
      d.deviceId === deviceId ? { ...d, modbus: merged } : d
    );
    setEditedHouse({ ...house, devices: updatedDevices });
  };

  // Modbus 연결 테스트
  const [modbusTestResult, setModbusTestResult] = useState({}); // { [deviceId]: 'testing'|'ok'|'fail' }
  const testModbusConnection = async (deviceId) => {
    const device = devices.find(d => d.deviceId === deviceId);
    const m = device?.modbus;
    if (!m || m.address == null) return;

    setModbusTestResult(prev => ({ ...prev, [deviceId]: 'testing' }));
    try {
      const rpiBase = getRpiApiBase();
      const moduleType = m.moduleType || 'waveshare';
      const unitId = m.unitId || 1;
      let res;

      if (moduleType === 'eletechsup') {
        res = await axiosBase.get(`${rpiBase}/relay/reg-status`, {
          params: { unitId, register: 0, quantity: 1 }, timeout: 5000,
        });
      } else {
        res = await axiosBase.get(`${rpiBase}/relay/status`, {
          params: { unitId, quantity: 8 }, timeout: 5000,
        });
      }

      if (res.data?.success) {
        setModbusTestResult(prev => ({ ...prev, [deviceId]: 'ok' }));
      } else {
        setModbusTestResult(prev => ({ ...prev, [deviceId]: 'fail' }));
      }
    } catch {
      setModbusTestResult(prev => ({ ...prev, [deviceId]: 'fail' }));
    }
  };

  const addDevice = () => {
    const deviceId = generateDeviceId(newDevice.type);
    const name = newDevice.name || `${getDeviceLabel(newDevice.type)} ${devices.filter(d => d.type === newDevice.type).length + 1}`;
    const dtInfo = DEVICE_TYPES.find(d => d.value === newDevice.type);

    const updatedDevices = [...devices, {
      deviceId, name, type: newDevice.type,
      icon: getDeviceIcon(newDevice.type), enabled: true, order: devices.length,
      modbus: {
        unitId: 1,
        controlType: dtInfo?.defaultControlType || 'single',
        address: null,
        address2: null,
      },
    }];
    setEditedHouse({ ...house, devices: updatedDevices, deviceCount: updatedDevices.length });
    setNewDevice({ type: 'window', name: '', enabled: true });
    setShowAddDevice(false);
  };

  const removeDevice = (deviceId) => {
    if (!confirm('이 장치를 삭제하시겠습니까?')) return;
    const updatedDevices = devices.filter(d => d.deviceId !== deviceId);
    setEditedHouse({ ...house, devices: updatedDevices, deviceCount: updatedDevices.length });
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

      {/* 장치 추가 — 프리셋 선택 */}
      {showAddDevice && (
        <div className="bg-violet-50 border-2 border-violet-200 rounded-xl p-4 mb-4 animate-fade-in-up">
          <h3 className="text-base font-bold text-violet-700 mb-3">장치 선택</h3>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 mb-3">
            {DEVICE_TYPES.map(dt => {
              const alreadyAdded = devices.some(d => d.type === dt.value);
              const isSelected = newDevice.type === dt.value;
              return (
                <button
                  key={dt.value}
                  onClick={() => setNewDevice({ ...newDevice, type: dt.value, name: '' })}
                  className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border-2 transition-all text-center
                    ${isSelected
                      ? 'border-violet-500 bg-violet-100 shadow-sm'
                      : alreadyAdded
                        ? 'border-green-200 bg-green-50 opacity-70'
                        : 'border-gray-200 bg-white hover:border-violet-300 hover:bg-violet-50'
                    }`}
                >
                  <span className="text-lg">{dt.icon}</span>
                  <span className="text-xs font-bold text-gray-700 leading-tight">{dt.label}</span>
                  {alreadyAdded && <span className="text-[10px] text-green-600 font-bold">추가됨</span>}
                </button>
              );
            })}
          </div>

          {/* 선택된 장치 상세 */}
          <div className="bg-white rounded-lg p-3 border border-violet-200 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">장치 유형</label>
                <div className="input-field text-sm bg-gray-50 flex items-center gap-1.5">
                  {getDeviceIcon(newDevice.type)} {getDeviceLabel(newDevice.type)}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">장치 이름 (선택)</label>
                <input type="text"
                  placeholder={`예: ${getDeviceLabel(newDevice.type)} 1`}
                  value={newDevice.name}
                  onChange={(e) => setNewDevice({ ...newDevice, name: e.target.value })}
                  className="input-field text-sm" />
              </div>
            </div>
            <div className="text-sm text-gray-500">
              제어 방식: <span className="text-violet-600 font-semibold">
                {DEVICE_TYPES.find(d => d.value === newDevice.type)?.commands}
              </span>
            </div>
            <button onClick={addDevice} className="btn-success w-full">
              {getDeviceIcon(newDevice.type)} {newDevice.name || getDeviceLabel(newDevice.type)} 추가
            </button>
          </div>
        </div>
      )}

      {/* 장치 목록 */}
      {devices.length === 0 ? (
        <div className="text-center py-6">
          <p className="text-gray-500 text-sm">제어 장치가 없습니다. 위에서 추가하세요.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {devices.map(device => {
            const isExpanded = expandedDevice === device.deviceId;
            const modbus = device.modbus || {};
            const isBidir = modbus.controlType === 'bidir';
            const hasModbus = modbus.address !== null && modbus.address !== undefined && modbus.address !== '';
            return (
              <div key={device.deviceId} className="bg-gray-50 border border-gray-200 rounded-xl overflow-hidden transition-all">
                <div
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gray-100 transition-all cursor-pointer"
                  onClick={() => setExpandedDevice(isExpanded ? null : device.deviceId)}
                >
                  <span className="text-2xl">{device.icon || getDeviceIcon(device.type)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-bold text-gray-800">{device.name}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {device.deviceId} · {getDeviceLabel(device.type)} ·
                      {DEVICE_TYPES.find(d => d.value === device.type)?.commands || 'on/off'}
                      {hasModbus && (
                        <span className="ml-1 text-emerald-600 font-semibold">
                          · U{modbus.unitId || 1}:CH{modbus.address}{isBidir ? `+${modbus.address2}` : ''} ({modbus.moduleType === 'eletechsup' ? 'FC06' : 'FC15'})
                        </span>
                      )}
                    </p>
                  </div>
                  <span className={`text-gray-400 text-xs transition-transform ${isExpanded ? 'rotate-180' : ''}`}>▼</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); removeDevice(device.deviceId); }}
                    className="p-2 rounded-lg text-gray-400 hover:text-rose-500 hover:bg-rose-50
                             transition-all text-base border border-transparent hover:border-rose-200"
                  >
                    🗑️
                  </button>
                </div>

                {/* Modbus 채널 설정 패널 */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-1 border-t border-gray-200 bg-white animate-fade-in-up">
                    <p className="text-xs font-bold text-gray-600 mb-2">⚡ Modbus 릴레이 채널 설정</p>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">릴레이 모듈</label>
                        <select
                          value={modbus.moduleType || 'waveshare'}
                          onChange={(e) => updateDeviceModbus(device.deviceId, { moduleType: e.target.value })}
                          className="input-field text-sm"
                        >
                          <option value="waveshare">Waveshare (FC15)</option>
                          <option value="eletechsup">Eletechsup (FC06)</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">릴레이 ID (Unit-Id)</label>
                        <input
                          type="number" min="1" max="247"
                          placeholder="1~247"
                          value={modbus.unitId ?? 1}
                          onChange={(e) => updateDeviceModbus(device.deviceId, {
                            unitId: e.target.value === '' ? 1 : parseInt(e.target.value),
                          })}
                          className="input-field text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">제어 방식</label>
                        <select
                          value={modbus.controlType || 'single'}
                          onChange={(e) => {
                            const ct = e.target.value;
                            updateDeviceModbus(device.deviceId, {
                              controlType: ct,
                              address2: ct === 'single' ? null : modbus.address2,
                            });
                          }}
                          className="input-field text-sm"
                        >
                          <option value="single">단방향 (ON/OFF)</option>
                          <option value="bidir">양방향 (열기/닫기)</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-gray-500 mb-1 block">
                          {modbus.controlType === 'bidir' ? 'CH1 주소 (열기)' : 'CH 주소'}
                        </label>
                        <input
                          type="number"
                          min={(modbus.moduleType || 'waveshare') === 'eletechsup' ? 1 : 0}
                          max={(modbus.moduleType || 'waveshare') === 'eletechsup' ? 8 : 255}
                          placeholder={(modbus.moduleType || 'waveshare') === 'eletechsup' ? '1~8' : '0~255'}
                          value={modbus.address ?? ''}
                          onChange={(e) => updateDeviceModbus(device.deviceId, {
                            address: e.target.value === '' ? null : parseInt(e.target.value),
                          })}
                          className="input-field text-sm"
                        />
                      </div>
                      {modbus.controlType === 'bidir' && (
                        <div>
                          <label className="text-xs text-gray-500 mb-1 block">CH2 주소 (닫기)</label>
                          <input
                            type="number"
                            min={(modbus.moduleType || 'waveshare') === 'eletechsup' ? 1 : 0}
                            max={(modbus.moduleType || 'waveshare') === 'eletechsup' ? 8 : 255}
                            placeholder={(modbus.moduleType || 'waveshare') === 'eletechsup' ? '1~8' : '0~255'}
                            value={modbus.address2 ?? ''}
                            onChange={(e) => updateDeviceModbus(device.deviceId, {
                              address2: e.target.value === '' ? null : parseInt(e.target.value),
                            })}
                            className="input-field text-sm"
                          />
                        </div>
                      )}
                    </div>
                    {hasModbus && (
                      <div className="mt-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between gap-2">
                        <p className="text-xs text-emerald-700">
                          ✅ {device.name}: 릴레이#{modbus.unitId || 1} {isBidir
                            ? `CH${modbus.address}(열기) + CH${modbus.address2}(닫기)`
                            : `CH${modbus.address}(ON/OFF)`
                          } — {modbus.moduleType === 'eletechsup' ? 'FC06' : 'FC15'}
                        </p>
                        <button
                          onClick={(e) => { e.stopPropagation(); testModbusConnection(device.deviceId); }}
                          disabled={modbusTestResult[device.deviceId] === 'testing'}
                          className={`px-3 py-1 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                            modbusTestResult[device.deviceId] === 'testing' ? 'bg-gray-200 text-gray-500' :
                            modbusTestResult[device.deviceId] === 'ok' ? 'bg-emerald-500 text-white' :
                            modbusTestResult[device.deviceId] === 'fail' ? 'bg-rose-500 text-white' :
                            'bg-blue-500 text-white hover:bg-blue-600'
                          }`}
                        >
                          {modbusTestResult[device.deviceId] === 'testing' ? '테스트 중...' :
                           modbusTestResult[device.deviceId] === 'ok' ? '연결 OK' :
                           modbusTestResult[device.deviceId] === 'fail' ? '연결 실패!' :
                           '연결 테스트'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 장치 저장 버튼 */}
      <button onClick={async () => {
        // 저장 전 Modbus 연결 안 된 장치 경고
        const modbusDevices = devices.filter(d => d.modbus?.address != null);
        const untestedDevices = modbusDevices.filter(d => modbusTestResult[d.deviceId] === 'fail');
        if (untestedDevices.length > 0) {
          const names = untestedDevices.map(d => `${d.name} (U${d.modbus.unitId || 1})`).join(', ');
          const proceed = window.confirm(
            `다음 장치의 Modbus 연결이 확인되지 않았습니다:\n${names}\n\n연결 안 된 장치가 있으면 릴레이 폴링 오류가 발생합니다.\n그래도 저장하시겠습니까?`
          );
          if (!proceed) return;
        }
        onSave();
      }} disabled={!isDirty || saving}
        className={`w-full mt-3 py-2.5 rounded-xl text-base font-bold transition-all
          ${isDirty ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700 active:scale-[0.97]'
            : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-default'}`}>
        {saving ? '저장 중...' : isDirty ? '💾 장치 저장' : '변경 없음'}
      </button>
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

const INTERVAL_PRESETS = [
  { value: 10, label: '10초', desc: '테스트용' },
  { value: 30, label: '30초', desc: '빠른 모니터링' },
  { value: 60, label: '1분', desc: '일반 (기본)' },
  { value: 300, label: '5분', desc: '저전력' },
  { value: 600, label: '10분', desc: '장기 모니터링' },
];

const SystemSettings = ({ farmId }) => {
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
  const [intervalSec, setIntervalSec] = useState(60);
  const [serverInterval, setServerInterval] = useState(60); // 서버에 저장된 값
  const [intervalSyncStatus, setIntervalSyncStatus] = useState(null); // { status, appliedAt, intervalSeconds }
  const [retentionLoading, setRetentionLoading] = useState(true);
  const [saved, setSaved] = useState(true);

  // 서버에서 시스템 설정 로드 (보관 기간 + 수집 주기)
  useEffect(() => {
    loadSystemSettings();
  }, []);

  const loadSystemSettings = async () => {
    try {
      setRetentionLoading(true);
      const rpiUrl = getRpiApiBase();
      const pcUrl = getApiBase();

      let res;
      try {
        res = await axios.get(`${pcUrl}/config/system-settings/${farmId}`, { timeout: 5000 });
      } catch {
        if (rpiUrl !== pcUrl) {
          res = await axiosBase.get(`${rpiUrl}/config/system-settings/${farmId}`, { timeout: 5000 });
        } else {
          throw new Error('서버 연결 불가');
        }
      }

      if (res.data.success) {
        const data = res.data.data;
        const days = data.retentionDays || 60;
        setRetentionDays(days);
        setServerRetention(days);
        const interval = data.collectionConfig?.intervalSeconds || 60;
        setIntervalSec(interval);
        setServerInterval(interval);
        // RPi 동기화 상태
        const rpiSync = data.rpiSync;
        if (rpiSync) {
          const anyAck = rpiSync.houses?.[0];
          const appliedInterval = anyAck?.intervalSeconds;
          if (appliedInterval != null && appliedInterval === interval) {
            setIntervalSyncStatus({ status: 'applied', appliedAt: rpiSync.appliedAt, intervalSeconds: appliedInterval });
          } else {
            setIntervalSyncStatus({ status: 'pending' });
          }
        } else {
          setIntervalSyncStatus({ status: 'disconnected' });
        }
      }
    } catch (err) {
      console.warn('시스템 설정 로드 실패 (기본값 사용):', err.message);
    } finally {
      setRetentionLoading(false);
    }
  };

  const checkSaved = (timeout, polling, retention, interval) => {
    return timeout === getSavedTimeout() && polling === getSavedPolling() && retention === serverRetention && interval === serverInterval;
  };

  const handleChange = (val) => {
    const clamped = Math.max(30, Math.min(1800, val));
    setTimeoutSec(clamped);
    setSaved(checkSaved(clamped, pollingSec, retentionDays, intervalSec));
  };

  const handlePollingChange = (val) => {
    const clamped = Math.max(3, Math.min(300, val));
    setPollingSec(clamped);
    setSaved(checkSaved(timeoutSec, clamped, retentionDays, intervalSec));
  };

  const handleRetentionChange = (val) => {
    const clamped = Math.max(7, Math.min(365, val));
    setRetentionDays(clamped);
    setSaved(checkSaved(timeoutSec, pollingSec, clamped, intervalSec));
  };

  const handleIntervalChange = (val) => {
    const clamped = Math.max(10, Math.min(3600, val));
    setIntervalSec(clamped);
    setSaved(checkSaved(timeoutSec, pollingSec, retentionDays, clamped));
  };

  const handleSave = async () => {
    // localStorage 설정 저장
    localStorage.setItem('smartfarm_serverTimeout', String(timeoutSec));
    localStorage.setItem('smartfarm_pollingInterval', String(pollingSec));

    // 서버에 보관 기간 + 수집 주기 저장
    const serverPayload = {};
    if (retentionDays !== serverRetention) serverPayload.retentionDays = retentionDays;
    if (intervalSec !== serverInterval) serverPayload.collectionConfig = { intervalSeconds: intervalSec };

    if (Object.keys(serverPayload).length > 0) {
      try {
        const res = await rpiApi('put', `/config/system-settings/${farmId}`, serverPayload);
        if (res.data.success) {
          if (serverPayload.retentionDays) setServerRetention(retentionDays);
          if (serverPayload.collectionConfig) {
            setServerInterval(intervalSec);
            setIntervalSyncStatus({ status: 'pending' });
          }
        }
      } catch (err) {
        alert('설정 저장 실패: ' + (err.response?.data?.error || err.message));
        return;
      }
    }

    setSaved(true);
    alert('저장되었습니다!');
  };

  // RPi 동기화 상태 폴링 (15초, 즉시 1회 실행)
  useEffect(() => {
    if (retentionLoading) return;
    let cancelled = false;
    const apiKeyHeader = { 'x-api-key': import.meta.env.VITE_SENSOR_API_KEY || 'smartfarm-sensor-key' };
    const poll = async () => {
      try {
        const pcUrl = getApiBase();
        const rpiUrl = getRpiApiBase();
        let res;
        try {
          res = await axios.get(`${pcUrl}/config/system-settings/${farmId}`, {
            timeout: 5000, headers: apiKeyHeader,
          });
        } catch {
          if (rpiUrl !== pcUrl) {
            res = await axiosBase.get(`${rpiUrl}/config/system-settings/${farmId}`, {
              timeout: 5000, headers: apiKeyHeader,
            });
          } else throw new Error('unreachable');
        }
        if (cancelled) return;
        const data = res.data?.data;
        const rpiSync = data?.rpiSync;
        const farmInterval = data?.collectionConfig?.intervalSeconds || serverInterval;
        if (!rpiSync) { setIntervalSyncStatus({ status: 'disconnected' }); return; }
        // 모든 하우스가 동일 주기인지 확인
        const ackIntervals = (rpiSync.houses || []).map(h => h.intervalSeconds);
        const allMatch = ackIntervals.length > 0 && ackIntervals.every(v => v === farmInterval);
        if (allMatch) {
          setIntervalSyncStatus({ status: 'applied', appliedAt: rpiSync.appliedAt, intervalSeconds: farmInterval });
        } else {
          setIntervalSyncStatus({ status: 'pending' });
        }
      } catch (err) {
        console.warn('[SystemSettings] sync poll failed:', err.message);
        if (!cancelled) setIntervalSyncStatus({ status: 'disconnected' });
      }
    };
    poll(); // 즉시 1회
    const id = setInterval(poll, 15000);
    return () => { cancelled = true; clearInterval(id); };
  }, [retentionLoading, serverInterval]);

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

  const [systemSubTab, setSystemSubTab] = useState('farmlocal');

  return (
    <div className="animate-fade-in-up">
      <SubTabBar
        tabs={[
          { id: 'farmlocal', label: '팜로컬', icon: '🌿' },
          { id: 'server', label: '서버 연결', icon: '🖥️' },
          { id: 'collection', label: '수집 주기', icon: '📡' },
          { id: 'retention', label: '보관 기간', icon: '💾' },
          { id: 'sync', label: '동기화', icon: '🔄' },
        ]}
        activeTab={systemSubTab}
        onChange={setSystemSubTab}
      />

      {/* 팜로컬 모드 */}
      {systemSubTab === 'farmlocal' && <div className="max-w-2xl">
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
      </div>}

      {/* 서버 연결 설정 */}
      {systemSubTab === 'server' && !farmLocal && <div className="max-w-2xl">
      <div className="glass-card p-4 md:p-5">
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
      </div>
      </div>}

      {systemSubTab === 'server' && farmLocal && (
        <div className="max-w-2xl glass-card p-8 text-center">
          <div className="text-4xl mb-4 opacity-30">🖥️</div>
          <p className="text-gray-400 text-base">팜로컬 모드에서는 서버 연결 설정을 사용하지 않습니다</p>
        </div>
      )}

      {/* 데이터 수집 주기 (농장 전체) */}
      {systemSubTab === 'collection' && <div className="max-w-2xl">
      <div className="glass-card p-4 md:p-5">
        <h2 className="text-lg font-bold text-gray-800 mb-2">데이터 수집 주기</h2>
        <p className="text-xs text-gray-400 mb-3">
          농장 전체 하우스에 동일하게 적용됩니다.
          RPi(라즈베리파이)가 이 주기마다 모든 하우스의 센서 데이터를 수집합니다.
        </p>

        {retentionLoading ? (
          <div className="text-sm text-gray-400 py-2">서버 설정 불러오는 중...</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-2">
              {INTERVAL_PRESETS.map(preset => (
                <button
                  key={preset.value}
                  onClick={() => handleIntervalChange(preset.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
                    ${intervalSec === preset.value
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
                value={intervalSec}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  if (!isNaN(val)) handleIntervalChange(val);
                }}
                className="input-field w-28"
                min="10" max="3600"
              />
              <span className="text-sm text-gray-500">초 (10~3600)</span>
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              {INTERVAL_PRESETS.find(p => p.value === intervalSec)?.desc
                || `${intervalSec}초 간격`}
              {' · '}하루 약 {Math.floor(86400 / (intervalSec || 60)).toLocaleString()}건 수집
            </p>
          </>
        )}

        {/* RPi 동기화 상태 */}
        {intervalSyncStatus && (
          <div className={`mt-3 border rounded-xl p-3 ${
            intervalSyncStatus.status === 'applied'
              ? 'bg-green-50 border-green-200'
              : intervalSyncStatus.status === 'pending'
              ? 'bg-yellow-50 border-yellow-200'
              : 'bg-orange-50 border-orange-200'
          }`}>
            <div className="flex items-center gap-2">
              <span className="text-base">
                {intervalSyncStatus.status === 'applied' ? '🟢'
                  : intervalSyncStatus.status === 'pending' ? '🟡'
                  : '🔴'}
              </span>
              <div>
                <p className={`text-sm font-bold ${
                  intervalSyncStatus.status === 'applied' ? 'text-green-700'
                    : intervalSyncStatus.status === 'pending' ? 'text-yellow-700'
                    : 'text-orange-700'
                }`}>
                  {intervalSyncStatus.status === 'applied'
                    ? `RPi 반영됨 (${intervalSyncStatus.intervalSeconds}초 주기)`
                    : intervalSyncStatus.status === 'pending'
                    ? '대기중 — RPi가 다음 틱에 반영합니다'
                    : 'RPi 미연결'}
                </p>
                {intervalSyncStatus.status === 'applied' && intervalSyncStatus.appliedAt && (
                  <p className="text-xs text-green-600">
                    반영 시각: {new Date(intervalSyncStatus.appliedAt).toLocaleString('ko-KR')}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      </div>}

      {/* 로컬 데이터 보관 설정 */}
      {systemSubTab === 'retention' && <div className="max-w-2xl space-y-4">
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
      </div>}

      {/* 동기화 관리 */}
      {systemSubTab === 'sync' && <SyncPanel farmId={farmId} />}
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SyncPanel — 동기화 상태 및 제어
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const SyncPanel = ({ farmId }) => {
  const [syncStatus, setSyncStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [actionMsg, setActionMsg] = useState(null); // { type: 'success'|'error', text }

  const loadStatus = useCallback(async () => {
    try {
      const apiKeyHeader = { 'x-api-key': import.meta.env.VITE_SENSOR_API_KEY || 'smartfarm-sensor-key' };
      let res;
      try {
        res = await axios.get(`${getApiBase()}/config/sync-status/${farmId}`, { timeout: 5000, headers: apiKeyHeader });
      } catch {
        res = await axiosBase.get(`${getRpiApiBase()}/sync/status`, { timeout: 5000 });
      }
      if (res.data?.success) setSyncStatus(res.data.data);
    } catch (err) {
      console.warn('[SyncPanel] status load failed:', err.message);
    } finally { setLoading(false); }
  }, [farmId]);

  useEffect(() => {
    loadStatus();
    const id = setInterval(loadStatus, 15000);
    return () => clearInterval(id);
  }, [loadStatus]);

  const handleAction = async (action) => {
    if (action === 'skip' && !window.confirm('미동기화 데이터를 동기화 안함으로 처리하시겠습니까?\n해당 데이터는 서버에 전송되지 않습니다.')) return;
    setActionLoading(action);
    setActionMsg(null);
    const labels = { start: '동기화 시작', stop: '동기화 중지', skip: '동기화 안함' };
    try {
      const apiKeyHeader = { 'x-api-key': import.meta.env.VITE_SENSOR_API_KEY || 'smartfarm-sensor-key' };
      try {
        await axios.post(`${getApiBase()}/config/sync-action/${farmId}`, { action }, { timeout: 10000, headers: apiKeyHeader });
      } catch {
        const rpiUrl = getRpiApiBase();
        if (action === 'start') await axiosBase.post(`${rpiUrl}/sync/start`, {}, { timeout: 10000 });
        else if (action === 'stop') await axiosBase.post(`${rpiUrl}/sync/stop`, {}, { timeout: 10000 });
        else await axiosBase.post(`${rpiUrl}/sync/skip`, {}, { timeout: 10000 });
      }
      setActionMsg({ type: 'success', text: `${labels[action]} 명령을 전송했습니다` });
      // 빠른 폴링: 2초 간격 5회로 결과 즉시 반영
      for (let i = 1; i <= 5; i++) setTimeout(loadStatus, i * 2000);
    } catch (err) {
      setActionMsg({ type: 'error', text: `${labels[action]} 실패: ${err.message}` });
    } finally { setActionLoading(null); }
  };

  // 5초 후 메시지 자동 숨김
  useEffect(() => {
    if (!actionMsg) return;
    const t = setTimeout(() => setActionMsg(null), 5000);
    return () => clearTimeout(t);
  }, [actionMsg]);

  const formatTime = (ts) => {
    if (!ts) return '-';
    const d = new Date(ts);
    const now = new Date();
    const diff = Math.floor((now - d) / 60000);
    if (diff < 1) return '방금 전';
    if (diff < 60) return `${diff}분 전`;
    if (diff < 1440) return `${Math.floor(diff / 60)}시간 전`;
    return `${Math.floor(diff / 1440)}일 전`;
  };

  if (loading) return <div className="max-w-2xl glass-card p-6"><div className="skeleton h-32 rounded-xl" /></div>;

  const s = syncStatus || {};
  const last = s.lastSyncResult;

  return (
    <div className="max-w-2xl space-y-4 animate-fade-in-up">
      {/* 미동기화 현황 카드 */}
      <div className="glass-card p-5">
        <h2 className="text-lg font-bold text-gray-800 mb-4">데이터 동기화 현황</h2>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="text-center p-4 bg-orange-50 rounded-xl border border-orange-200">
            <p className="text-3xl font-extrabold text-orange-600">{s.unsynced != null ? s.unsynced.toLocaleString() : '-'}</p>
            <p className="text-xs text-orange-500 mt-1 font-semibold">미동기화</p>
          </div>
          <div className="text-center p-4 bg-green-50 rounded-xl border border-green-200">
            <p className="text-3xl font-extrabold text-green-600">{s.synced != null ? s.synced.toLocaleString() : '-'}</p>
            <p className="text-xs text-green-500 mt-1 font-semibold">동기화 완료</p>
          </div>
          <div className="text-center p-4 bg-gray-50 rounded-xl border border-gray-200">
            <p className="text-3xl font-extrabold text-gray-600">{s.total != null ? s.total.toLocaleString() : '-'}</p>
            <p className="text-xs text-gray-500 mt-1 font-semibold">전체</p>
          </div>
        </div>

        {s.unsynced > 0 && s.oldestUnsynced && (
          <p className="text-xs text-gray-500 mb-2">
            가장 오래된 미동기화: <span className="font-bold text-orange-600">{formatTime(s.oldestUnsynced)}</span>
            <span className="text-gray-400 ml-2">({new Date(s.oldestUnsynced).toLocaleString('ko-KR')})</span>
          </p>
        )}

        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className={`w-2 h-2 rounded-full ${s.syncPaused ? 'bg-gray-400' : 'bg-green-500 animate-pulse'}`} />
          {s.syncPaused ? '자동 동기화 중지됨' : '자동 동기화 활성 (5분 간격)'}
          <span className="mx-1">·</span>
          모드: {s.operationMode || '알 수 없음'}
        </div>
      </div>

      {/* 최근 동기화 이력 */}
      {last && (
        <div className="glass-card p-4">
          <h3 className="text-sm font-bold text-gray-700 mb-2">최근 동기화</h3>
          <div className="flex items-center gap-3">
            <span className={`text-lg ${last.success ? '' : ''}`}>{last.success ? '✅' : '❌'}</span>
            <div>
              <p className="text-sm font-semibold text-gray-800">
                {last.success ? `${last.count}건 전송 성공` : `전송 실패 (${last.error || '오류'})`}
              </p>
              <p className="text-xs text-gray-400">{last.time ? new Date(last.time).toLocaleString('ko-KR') : '-'}</p>
            </div>
          </div>
        </div>
      )}

      {/* 명령 결과 메시지 */}
      {actionMsg && (
        <div className={`px-4 py-3 rounded-xl text-sm font-semibold flex items-center gap-2 animate-fade-in-up ${
          actionMsg.type === 'success'
            ? 'bg-green-50 text-green-700 border border-green-200'
            : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          <span>{actionMsg.type === 'success' ? '✅' : '❌'}</span>
          {actionMsg.text}
        </div>
      )}

      {/* 제어 버튼 */}
      <div className="grid grid-cols-3 gap-3">
        <button
          onClick={() => handleAction('start')}
          disabled={actionLoading || (s.unsynced === 0)}
          className={`py-3 rounded-xl text-sm font-bold transition-all active:scale-[0.97] ${
            s.unsynced > 0 && !actionLoading
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700'
              : 'bg-gray-100 text-gray-400 cursor-default'
          }`}
        >
          {actionLoading === 'start' ? '시작 중...' : '🔄 동기화 시작'}
        </button>
        <button
          onClick={() => handleAction('stop')}
          disabled={actionLoading}
          className="py-3 rounded-xl text-sm font-bold bg-gray-200 text-gray-600 hover:bg-gray-300 transition-all active:scale-[0.97]"
        >
          {actionLoading === 'stop' ? '중지 중...' : '⏸️ 동기화 중지'}
        </button>
        <button
          onClick={() => handleAction('skip')}
          disabled={actionLoading || (s.unsynced === 0)}
          className={`py-3 rounded-xl text-sm font-bold transition-all active:scale-[0.97] ${
            s.unsynced > 0 && !actionLoading
              ? 'bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100'
              : 'bg-gray-100 text-gray-400 cursor-default'
          }`}
        >
          {actionLoading === 'skip' ? '처리 중...' : '⏭️ 동기화 안함'}
        </button>
      </div>

      <p className="text-xs text-gray-400 text-center">
        동기화 시작: 미전송 데이터를 서버로 즉시 전송 · 중지: 자동 동기화 일시 중지 · 동기화 안함: 미전송 데이터를 전송하지 않고 완료 처리
      </p>
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AlertSettingsTab — 알림 설정 (농장 전체 + 하우스별 센서)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const CHECK_PRESETS = [
  { value: 1, label: '1분' },
  { value: 3, label: '3분' },
  { value: 5, label: '5분' },
  { value: 10, label: '10분' },
];
const COOLDOWN_PRESETS = [
  { value: 5, label: '5분' },
  { value: 15, label: '15분' },
  { value: 30, label: '30분' },
  { value: 60, label: '1시간' },
];
const CRITICAL_PRESETS = [
  { value: 0.3, label: '30%', desc: '민감' },
  { value: 0.5, label: '50%', desc: '기본' },
  { value: 0.7, label: '70%', desc: '둔감' },
];

const AlertSettingsTab = ({ farmId, houses, onHousesUpdate }) => {
  const [alertConfig, setAlertConfig] = useState({ enabled: true, checkIntervalMinutes: 5, cooldownMinutes: 15, criticalRatio: 0.5 });
  const [serverConfig, setServerConfig] = useState(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [selectedHouseId, setSelectedHouseId] = useState(null);
  const [editedSensors, setEditedSensors] = useState([]);
  const [sensorsDirty, setSensorsDirty] = useState(false);
  const [sensorSaving, setSensorSaving] = useState(false);

  // 농장 알림 설정 로드
  useEffect(() => {
    (async () => {
      setConfigLoading(true);
      try {
        const res = await axios.get(`${getApiBase()}/config/system-settings/${farmId}`, { timeout: 5000 });
        if (res.data.success && res.data.data?.alertConfig) {
          const cfg = { enabled: true, checkIntervalMinutes: 5, cooldownMinutes: 15, criticalRatio: 0.5, ...res.data.data.alertConfig };
          setAlertConfig(cfg);
          setServerConfig(cfg);
        }
      } catch (e) { console.warn('알림 설정 로드 실패:', e.message); }
      finally { setConfigLoading(false); }
    })();
  }, [farmId]);

  const configDirty = serverConfig ? JSON.stringify(alertConfig) !== JSON.stringify(serverConfig) : false;

  const saveConfig = async () => {
    setSaving(true);
    try {
      const res = await rpiApi('put', `/config/system-settings/${farmId}`, { alertConfig });
      if (res.data.success) {
        setServerConfig({ ...alertConfig });
        alert('알림 설정이 저장되었습니다.');
      }
    } catch (e) { alert('저장 실패: ' + (e.response?.data?.error || e.message)); }
    finally { setSaving(false); }
  };

  // 하우스 선택 시 센서 로드
  useEffect(() => {
    if (!selectedHouseId) return;
    const house = houses.find(h => h.houseId === selectedHouseId);
    if (house) {
      setEditedSensors((house.sensors || []).map(s => ({ ...s, alertEnabled: s.alertEnabled !== false })));
      setSensorsDirty(false);
    }
  }, [selectedHouseId, houses]);

  const updateSensor = (sensorId, field, value) => {
    setEditedSensors(prev => prev.map(s => s.sensorId === sensorId ? { ...s, [field]: value } : s));
    setSensorsDirty(true);
  };

  const saveSensors = async () => {
    setSensorSaving(true);
    try {
      const house = houses.find(h => h.houseId === selectedHouseId);
      const res = await rpiApi('put', `/config/${selectedHouseId}?farmId=${farmId}`, { ...house, sensors: editedSensors });
      if (res.data.success) { onHousesUpdate(); setSensorsDirty(false); alert('센서 임계값이 저장되었습니다.'); }
    } catch (e) { alert('저장 실패: ' + (e.response?.data?.error || e.message)); }
    finally { setSensorSaving(false); }
  };

  const PresetButtons = ({ presets, value, onChange, activeColor = 'bg-blue-600 text-white border-blue-600' }) => (
    <div className="flex flex-wrap gap-2">
      {presets.map(p => (
        <button key={p.value} onClick={() => onChange(p.value)}
          className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all border ${
            value === p.value ? activeColor + ' shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:bg-blue-50'
          }`}>
          {p.label}{p.desc ? ` · ${p.desc}` : ''}
        </button>
      ))}
    </div>
  );

  const [alertSubTab, setAlertSubTab] = useState('farm');

  return (
    <div className="animate-fade-in-up">
      <SubTabBar
        tabs={[
          { id: 'farm', label: '농장 설정', icon: '🏭' },
          { id: 'sensors', label: '센서 임계값', icon: '📊' },
        ]}
        activeTab={alertSubTab}
        onChange={setAlertSubTab}
      />

      {alertSubTab === 'farm' && (
        <div className="max-w-2xl glass-card p-4 md:p-5">
          <h2 className="text-lg font-bold text-gray-800 mb-4">농장 알림 설정</h2>
          {configLoading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="skeleton h-12 rounded-xl" />)}</div>
          ) : (
            <>
              {/* 알림 ON/OFF */}
              <div className="flex items-center justify-between bg-gray-50 rounded-xl p-4 border border-gray-200 mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🔔</span>
                  <div>
                    <p className="text-sm font-bold text-gray-800">센서 알림</p>
                    <p className="text-xs text-gray-500">{alertConfig.enabled ? '활성 - 임계값 초과 시 알림 생성' : '비활성 - 알림 중지됨'}</p>
                  </div>
                </div>
                <button onClick={() => setAlertConfig(p => ({ ...p, enabled: !p.enabled }))}
                  className={`relative w-14 h-7 rounded-full transition-all ${alertConfig.enabled ? 'bg-blue-500' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-all ${alertConfig.enabled ? 'left-7' : 'left-0.5'}`} />
                </button>
              </div>

              {alertConfig.enabled && (
                <>
                  {/* 체크 간격 */}
                  <div className="mb-4">
                    <label className="text-sm text-gray-600 font-semibold mb-1 block">알림 체크 간격</label>
                    <p className="text-xs text-gray-400 mb-2"><span className="text-blue-600 font-bold">{alertConfig.checkIntervalMinutes}분</span>마다 센서 데이터 확인</p>
                    <PresetButtons presets={CHECK_PRESETS} value={alertConfig.checkIntervalMinutes}
                      onChange={v => setAlertConfig(p => ({ ...p, checkIntervalMinutes: v }))} />
                  </div>
                  {/* 쿨다운 */}
                  <div className="mb-4">
                    <label className="text-sm text-gray-600 font-semibold mb-1 block">중복 알림 방지 (쿨다운)</label>
                    <p className="text-xs text-gray-400 mb-2">같은 센서 <span className="text-orange-500 font-bold">{alertConfig.cooldownMinutes}분</span> 이내 중복 차단</p>
                    <PresetButtons presets={COOLDOWN_PRESETS} value={alertConfig.cooldownMinutes}
                      onChange={v => setAlertConfig(p => ({ ...p, cooldownMinutes: v }))}
                      activeColor="bg-orange-500 text-white border-orange-500" />
                  </div>
                  {/* CRITICAL 비율 */}
                  <div className="mb-4">
                    <label className="text-sm text-gray-600 font-semibold mb-1 block">심각(CRITICAL) 판정 기준</label>
                    <p className="text-xs text-gray-400 mb-2">임계범위의 <span className="text-red-500 font-bold">{Math.round(alertConfig.criticalRatio * 100)}%</span> 이상 벗어나면 심각</p>
                    <PresetButtons presets={CRITICAL_PRESETS} value={alertConfig.criticalRatio}
                      onChange={v => setAlertConfig(p => ({ ...p, criticalRatio: v }))}
                      activeColor="bg-red-500 text-white border-red-500" />
                  </div>
                  {/* 안내 */}
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">
                    <p className="text-xs text-blue-600"><span className="font-bold">💡 예시:</span> 온도 범위 5~40°C, 심각기준 {Math.round(alertConfig.criticalRatio * 100)}% → {Math.round((40 - 5) * alertConfig.criticalRatio)}°C 이상 초과 시 CRITICAL</p>
                  </div>
                </>
              )}
              <button onClick={saveConfig} disabled={!configDirty || saving}
                className={`w-full py-2.5 rounded-xl text-base font-bold transition-all active:scale-[0.97] ${
                  configDirty ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700' : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-default'
                }`}>{saving ? '저장 중...' : configDirty ? '💾 설정 저장' : '저장 완료'}</button>
            </>
          )}
        </div>
      )}

      {alertSubTab === 'sensors' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* 하우스 목록 */}
        <div className="lg:col-span-1 glass-card p-4 md:p-5">
          <h2 className="text-base font-bold text-gray-700 mb-3">하우스별 센서 임계값</h2>
          {houses.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">하우스가 없습니다</p>
          ) : (
            <div className="space-y-2">
              {houses.map(h => (
                <button key={h.houseId} onClick={() => setSelectedHouseId(h.houseId)}
                  className={`w-full text-left px-4 py-3 rounded-xl transition-all ${
                    selectedHouseId === h.houseId ? 'bg-blue-50 border-2 border-blue-400 shadow-sm' : 'bg-gray-50 border border-gray-200 hover:bg-gray-100'
                  }`}>
                  <p className="text-sm font-bold text-gray-800">{h.houseName || h.houseId}</p>
                  <p className="text-xs text-gray-500">
                    센서 {(h.sensors || []).length}개 · 알림 {(h.sensors || []).filter(s => s.alertEnabled !== false).length}개 활성
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 우측: 센서별 임계값 편집 */}
        <div className="lg:col-span-2">
        {selectedHouseId ? (
          <div className="glass-card p-4 md:p-5 animate-fade-in-up">
            <h2 className="text-lg font-bold text-gray-800 mb-4">
              {houses.find(h => h.houseId === selectedHouseId)?.houseName || selectedHouseId} — 센서 알림 설정
            </h2>
            {editedSensors.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">등록된 센서가 없습니다</p>
            ) : (
              <div className="space-y-3">
                {editedSensors.map(sensor => (
                  <div key={sensor.sensorId}
                    className={`rounded-xl border-2 p-4 transition-all ${sensor.alertEnabled ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100 opacity-50'}`}>
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{sensor.icon || '📡'}</span>
                        <div>
                          <p className="text-sm font-bold text-gray-800">{sensor.name}</p>
                          <p className="text-xs text-gray-400">{sensor.sensorId} · {sensor.unit}</p>
                        </div>
                      </div>
                      <button onClick={() => updateSensor(sensor.sensorId, 'alertEnabled', !sensor.alertEnabled)}
                        className={`relative w-12 h-6 rounded-full transition-all ${sensor.alertEnabled ? 'bg-blue-500' : 'bg-gray-300'}`}>
                        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-all ${sensor.alertEnabled ? 'left-6' : 'left-0.5'}`} />
                      </button>
                    </div>
                    {sensor.alertEnabled && (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs text-gray-500 font-semibold mb-1 block">하한 (최소값)</label>
                          <div className="flex items-center gap-2">
                            <input type="number" value={sensor.min ?? ''} step="any"
                              onChange={e => updateSensor(sensor.sensorId, 'min', e.target.value === '' ? null : parseFloat(e.target.value))}
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none" />
                            <span className="text-xs text-gray-400 whitespace-nowrap">{sensor.unit}</span>
                          </div>
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 font-semibold mb-1 block">상한 (최대값)</label>
                          <div className="flex items-center gap-2">
                            <input type="number" value={sensor.max ?? ''} step="any"
                              onChange={e => updateSensor(sensor.sensorId, 'max', e.target.value === '' ? null : parseFloat(e.target.value))}
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-400 focus:border-blue-400 outline-none" />
                            <span className="text-xs text-gray-400 whitespace-nowrap">{sensor.unit}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <button onClick={saveSensors} disabled={!sensorsDirty || sensorSaving}
              className={`w-full mt-4 py-2.5 rounded-xl text-base font-bold transition-all active:scale-[0.97] ${
                sensorsDirty ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700' : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-default'
              }`}>{sensorSaving ? '저장 중...' : sensorsDirty ? '💾 센서 임계값 저장' : '변경 없음'}</button>
          </div>
        ) : (
          <div className="glass-card p-12 text-center">
            <div className="text-4xl mb-4 opacity-30">🔔</div>
            <p className="text-gray-400 text-base">왼쪽에서 하우스를 선택하여<br/>센서별 알림 임계값을 설정하세요</p>
          </div>
        )}
      </div>
      </div>
      )}
    </div>
  );
};

export default ConfigurationManager;
