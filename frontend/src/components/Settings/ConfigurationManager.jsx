import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import axiosBase from 'axios';
import { getApiBase, getPcApiBase, getRpiApiBase, isFarmLocalMode, setFarmLocalMode } from '../../services/apiSwitcher';
import wsService from '../../services/wsService';

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

// PC 서버에 저장 + RPi에도 전달 (system-settings 전용)
async function saveSystemSettings(farmId, payload) {
  const pcUrl = getPcApiBase();
  const res = await axiosBase.put(`${pcUrl}/config/system-settings/${farmId}`, payload, { timeout: 8000 });
  // PC 저장 성공 시 RPi에도 전달 (백그라운드, 실패 무시)
  try { rpiApi('put', `/config/system-settings/${farmId}`, payload); } catch {}
  return res;
}

// 통일 서브탭 바 (모든 탭에서 재사용)
export const SubTabBar = ({ tabs, activeTab, onChange, trailing }) => (
  <div className="flex items-center gap-1.5 md:gap-2 mb-3 md:mb-4 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
    {tabs.map(tab => (
      <button key={tab.id} onClick={() => onChange(tab.id)}
        className={`flex items-center gap-1 md:gap-1.5 px-2.5 md:px-4 py-2 md:py-2.5 rounded-lg text-xs md:text-sm font-bold whitespace-nowrap flex-shrink-0 transition-all ${
          activeTab === tab.id
            ? 'bg-blue-600 text-white shadow-md shadow-blue-600/25'
            : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50 shadow-sm'
        }`}>
        <span>{tab.icon}</span> {tab.label}
        {tab.count != null && tab.count > 0 && (
          <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
            activeTab === tab.id ? 'bg-white/25 text-white' : 'bg-gray-300 text-gray-600'
          }`}>{tab.count}</span>
        )}
      </button>
    ))}
    {trailing && <div className="ml-auto flex-shrink-0">{trailing}</div>}
  </div>
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 카메라 관리
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const CAMERA_BRANDS = [
  { id: 'iptime', name: 'ipTIME', path: '/onvif1', port: 554 },
  { id: 'hikvision', name: '히크비전', path: '/Streaming/Channels/101', port: 554 },
  { id: 'dahua', name: '다후아', path: '/cam/realmonitor?channel=1&subtype=0', port: 554 },
  { id: 'tplink', name: 'TP-Link', path: '/stream1', port: 554 },
  { id: 'custom', name: '기타 (직접 입력)', path: '', port: 554 },
];

const buildRtspUrl = (brand, ip, user, pass, port) => {
  const b = CAMERA_BRANDS.find(x => x.id === brand);
  if (!b || !ip) return '';
  const p = port || b.port;
  const auth = user ? `${user}:${pass || ''}@` : '';
  return `rtsp://${auth}${ip}:${p}${b.path}`;
};

const CameraManager = ({ farmId }) => {
  const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';
  const getToken = () => localStorage.getItem('accessToken');
  const headers = () => ({ Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' });

  const [cameras, setCameras] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [showAdd, setShowAdd] = React.useState(false);
  const [editCam, setEditCam] = React.useState(null);
  const [form, setForm] = React.useState({ name: '', location: '', brand: 'iptime', ip: '', user: 'admin', pass: '', port: '554', rtspUrl: '' });

  const updateRtspUrl = (f) => {
    if (f.brand === 'custom') return f;
    return { ...f, rtspUrl: buildRtspUrl(f.brand, f.ip, f.user, f.pass, f.port) };
  };

  const setFormField = (field, value) => {
    const next = { ...form, [field]: value };
    setForm(updateRtspUrl(next));
  };

  const fetchCameras = React.useCallback(async () => {
    try {
      const res = await fetch(`${API}/cameras/${farmId}`, { headers: headers() });
      const data = await res.json();
      if (data.success) setCameras(data.data);
    } catch {}
    setLoading(false);
  }, [farmId]);

  React.useEffect(() => { fetchCameras(); }, [fetchCameras]);

  const handleSave = async () => {
    if (!form.name || !form.rtspUrl) return alert('카메라 이름과 RTSP URL을 입력하세요');
    try {
      const body = { name: form.name, location: form.location, rtspUrl: form.rtspUrl };
      if (editCam) {
        await fetch(`${API}/cameras/${farmId}/${editCam.camId}`, {
          method: 'PUT', headers: headers(), body: JSON.stringify(body)
        });
      } else {
        await fetch(`${API}/cameras/${farmId}`, {
          method: 'POST', headers: headers(), body: JSON.stringify(body)
        });
      }
      setShowAdd(false); setEditCam(null);
      setForm({ name: '', location: '', brand: 'iptime', ip: '', user: 'admin', pass: '', port: '554', rtspUrl: '' });
      fetchCameras();
    } catch { alert('저장 실패'); }
  };

  const handleDelete = async (cam) => {
    if (!confirm(`${cam.name} 카메라를 삭제할까요?`)) return;
    try {
      await fetch(`${API}/cameras/${farmId}/${cam.camId}`, { method: 'DELETE', headers: headers() });
      fetchCameras();
    } catch { alert('삭제 실패'); }
  };

  const startEdit = (cam) => {
    setEditCam(cam);
    setForm({ name: cam.name, location: cam.location, brand: 'custom', ip: '', user: '', pass: '', port: '554', rtspUrl: cam.rtspUrl });
    setShowAdd(true);
  };

  const resetForm = () => {
    setShowAdd(true); setEditCam(null);
    setForm({ name: '', location: '', brand: 'iptime', ip: '', user: 'admin', pass: '', port: '554', rtspUrl: '' });
  };

  if (loading) return <div className="skeleton h-48 rounded-2xl" />;

  return (
    <div className="space-y-4 animate-fade-in-up">
      <div className="glass-card p-4 flex justify-between items-center">
        <div>
          <h3 className="text-base font-bold text-gray-800">카메라 관리</h3>
          <p className="text-xs text-gray-500 mt-0.5">CCTV 카메라 RTSP 스트림 등록/관리</p>
        </div>
        <button onClick={resetForm}
          className="px-4 py-2 rounded-xl text-sm font-bold bg-blue-500 text-white hover:bg-blue-600 transition-colors">
          + 카메라 추가
        </button>
      </div>

      {showAdd && (
        <div className="glass-card p-4 border-2 border-blue-200">
          <h4 className="text-sm font-bold text-gray-700 mb-3">{editCam ? '카메라 수정' : '카메라 추가'}</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">카메라 이름 *</label>
              <input value={form.name} onChange={e => setFormField('name', e.target.value)}
                placeholder="예: 입구 카메라"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:border-blue-400 focus:outline-none" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">설치 위치</label>
              <input value={form.location} onChange={e => setFormField('location', e.target.value)}
                placeholder="예: 1번 하우스 입구"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:border-blue-400 focus:outline-none" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">카메라 브랜드</label>
              <select value={form.brand} onChange={e => setFormField('brand', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:border-blue-400 focus:outline-none bg-white">
                {CAMERA_BRANDS.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>

          {form.brand !== 'custom' ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">카메라 IP *</label>
                <input value={form.ip} onChange={e => setFormField('ip', e.target.value)}
                  placeholder="192.168.0.100"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm font-mono focus:border-blue-400 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">계정</label>
                <input value={form.user} onChange={e => setFormField('user', e.target.value)}
                  placeholder="admin"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:border-blue-400 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">비밀번호</label>
                <input type="password" value={form.pass} onChange={e => setFormField('pass', e.target.value)}
                  placeholder="********"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm focus:border-blue-400 focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">포트</label>
                <input value={form.port} onChange={e => setFormField('port', e.target.value)}
                  placeholder="554"
                  className="w-full px-3 py-2 rounded-lg border border-gray-300 text-sm font-mono focus:border-blue-400 focus:outline-none" />
              </div>
            </div>
          ) : null}

          {/* RTSP URL (자동 생성 또는 직접 입력) */}
          <div className="mb-3">
            <label className="text-xs font-semibold text-gray-500 mb-1 block">
              RTSP URL {form.brand !== 'custom' ? '(자동 생성됨, 수정 가능)' : '*'}
            </label>
            <input value={form.rtspUrl} onChange={e => setForm({ ...form, rtspUrl: e.target.value })}
              placeholder="rtsp://admin:password@192.168.0.100:554/onvif1"
              className={`w-full px-3 py-2 rounded-lg border text-sm font-mono focus:border-blue-400 focus:outline-none ${form.brand !== 'custom' ? 'border-emerald-300 bg-emerald-50' : 'border-gray-300'}`} />
          </div>

          <div className="flex gap-2 justify-end">
            <button onClick={() => { setShowAdd(false); setEditCam(null); }}
              className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200">취소</button>
            <button onClick={handleSave}
              className="px-4 py-2 rounded-lg text-sm font-bold bg-blue-500 text-white hover:bg-blue-600">
              {editCam ? '수정' : '추가'}
            </button>
          </div>
        </div>
      )}

      {cameras.length === 0 ? (
        <div className="glass-card p-8 text-center text-gray-400">
          <div className="text-4xl mb-2">📹</div>
          <p>등록된 카메라가 없습니다</p>
          <p className="text-xs mt-1">위의 "카메라 추가" 버튼으로 CCTV를 등록하세요</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {cameras.map(cam => (
            <div key={cam.id} className="glass-card p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${cam.enabled ? 'bg-emerald-50' : 'bg-gray-100'}`}>
                  📹
                </div>
                <div>
                  <div className="text-sm font-bold text-gray-800 flex items-center gap-2">
                    {cam.name}
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${cam.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                      {cam.enabled ? '활성' : '비활성'}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400">{cam.location || '-'}</div>
                  <div className="text-[10px] text-gray-300 font-mono mt-0.5 truncate max-w-[300px]">{cam.rtspUrl}</div>
                </div>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => startEdit(cam)}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200">수정</button>
                <button onClick={() => handleDelete(cam)}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-red-50 text-red-500 hover:bg-red-100">삭제</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

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
    // WebSocket 연결 (MQTT 릴레이 테스트용)
    const token = localStorage.getItem('accessToken');
    const apiBase = getApiBase();
    if (token && apiBase) {
      wsService.connect(apiBase, token);
    }
  }, [farmId]);

  const loadHouses = async () => {
    const hadCache = houses.length > 0;
    if (!hadCache) setLoading(true);
    try {
      const rpiUrl = getRpiApiBase();
      const pcUrl = getApiBase();
      const isDual = rpiUrl !== pcUrl;

      // PC 서버 우선 로드 (단일 진실 소스), RPi는 PC 접속 불가 시 폴백
      const [pcRes, rpiRes] = await Promise.all([
        axios.get(`${pcUrl}/config/farm/${farmId}`, { timeout: 5000 }).catch(() => null),
        isDual ? axiosBase.get(`${rpiUrl}/config/farm/${farmId}`, { timeout: 5000 }).catch(() => null) : null,
      ]);

      const pcHouses = pcRes?.data?.success ? pcRes.data.data : [];
      const rpiHouses = rpiRes?.data?.success ? rpiRes.data.data : [];

      // PC 서버 우선, PC 접속 불가 시 RPi 폴백
      const finalHouses = pcHouses.length > 0 ? pcHouses : rpiHouses;

      if (finalHouses.length > 0) {
        setHouses(finalHouses);
        try { localStorage.setItem(`cachedConfig_${farmId}`, JSON.stringify({ houses: finalHouses })); } catch {}
        setSelectedHouse(prev => {
          if (!prev) return null;
          return finalHouses.find(h => h.houseId === prev.houseId) || null;
        });
        // RPi와 PC 불일치 시 백그라운드 sync (RPi가 PC보다 많으면 PC에 동기화)
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
      const pcUrl = getApiBase();
      const rpiUrl = getRpiApiBase();
      const isDual = rpiUrl !== pcUrl;

      // PC 서버 삭제 (단일 진실 소스)
      const pcRes = await axios.delete(`${pcUrl}/config/${houseId}?farmId=${farmId}`, { timeout: 8000 });

      // RPi에도 삭제 시도 (실패해도 무시 — RPi에 없을 수 있음)
      if (isDual) {
        axiosBase.delete(`${rpiUrl}/config/${houseId}?farmId=${farmId}`, { timeout: 5000 }).catch(() => {});
      }

      console.log('[Config] deleteHouse response:', pcRes.data);
      if (pcRes.data.success) {
        setHouses(prev => prev.filter(h => h.houseId !== houseId));
        if (selectedHouse?.houseId === houseId) setSelectedHouse(null);
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
    { id: 'cameras', label: '카메라', icon: '📹' },
    { id: 'automation', label: '자동화규칙', icon: '🤖' },
    { id: 'alerts', label: '알림설정', icon: '🔔' },
    { id: 'system', label: '시스템', icon: '⚙️' },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6">
      {/* 헤더 */}
      <div className="hidden md:block mb-5 animate-fade-in-up">
        <h1 className="text-2xl font-bold text-gray-800 tracking-tight">설정 관리</h1>
        <p className="text-gray-500 text-base mt-0.5">하우스, 센서, 자동화 설정</p>
      </div>

      {/* 탭 네비게이션 */}
      <div className="flex gap-1.5 md:gap-2 mb-3 md:mb-5 overflow-x-auto pb-1 animate-fade-in-up" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); localStorage.setItem('settings_activeTab', tab.id); }}
            className={`flex items-center justify-center gap-1 md:gap-2 px-3 md:px-5 py-2 md:py-2.5 rounded-xl text-xs md:text-base font-bold
                       whitespace-nowrap flex-shrink-0 transition-all active:scale-[0.97] ${
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
              <HouseDetailEditor house={selectedHouse} farmId={farmId} onUpdate={() => { loadHouses(); syncConfigToPC(farmId); }} />
            ) : (
              <div className="glass-card p-12 text-center">
                <div className="text-4xl mb-4 opacity-30">⚙️</div>
                <p className="text-gray-500 text-base">하우스 목록에서 하우스를 선택하세요</p>
              </div>
            )
          )}
        </div>
      )}

      {/* 카메라 탭 */}
      {activeTab === 'cameras' && (
        <CameraManager farmId={farmId} />
      )}

      {/* 자동화 탭 */}
      {activeTab === 'automation' && (
        <Suspense fallback={<div className="skeleton h-96 rounded-2xl" />}>
          <AutomationManager farmId={farmId} houses={houses} />
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

const HouseDetailEditor = ({ house, farmId, onUpdate }) => {
  const [editedHouse, setEditedHouse] = useState(house);
  const [editingSensor, setEditingSensor] = useState(null);
  const [showAddSensor, setShowAddSensor] = useState(false);
  const [expandedSensor, setExpandedSensor] = useState(null);
  const [sensorTestResult, setSensorTestResult] = useState({}); // { [sensorId]: 'testing'|{value}|'fail' }
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

  const toggleSensorEnabled = (sensorId) => {
    const updatedSensors = editedHouse.sensors.map(s =>
      s.sensorId === sensorId ? { ...s, enabled: s.enabled === false ? true : false } : s
    );
    setEditedHouse({ ...editedHouse, sensors: updatedSensors });
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

  const updateSensorModbus = (sensorId, modbusData) => {
    const updatedSensors = editedHouse.sensors.map(s => {
      if (s.sensorId !== sensorId) return s;
      const defaultModbus = { unitId: 3, fc: 3, address: 0, quantity: 1, registerIndex: 0, divider: 10, signed: false };
      const merged = { ...defaultModbus, ...s.modbus, ...modbusData };
      return { ...s, modbus: merged };
    });
    setEditedHouse({ ...editedHouse, sensors: updatedSensors });
  };

  const removeSensorModbus = (sensorId) => {
    const updatedSensors = editedHouse.sensors.map(s =>
      s.sensorId === sensorId ? { ...s, modbus: undefined } : s
    );
    setEditedHouse({ ...editedHouse, sensors: updatedSensors });
    setSensorTestResult(prev => { const n = { ...prev }; delete n[sensorId]; return n; });
  };

  const testSensorModbus = async (sensorId) => {
    const sensor = editedHouse.sensors.find(s => s.sensorId === sensorId);
    const m = sensor?.modbus;
    if (!m) return;
    setSensorTestResult(prev => ({ ...prev, [sensorId]: 'testing' }));
    try {
      const rpiUrl = getRpiApiBase();
      // Node-RED /api/relay/reg-status: FC03 기반 범용 레지스터 읽기
      const res = await axiosBase.get(`${rpiUrl}/relay/reg-status`, {
        params: { unitId: m.unitId, register: m.address, quantity: m.quantity || 1 },
        timeout: 5000,
      });
      if (res.data?.success) {
        const raw = res.data.data?.raw;
        const regIdx = m.registerIndex || 0;
        let rawValue = Array.isArray(raw) ? (raw[regIdx] ?? raw[0]) : (res.data.data?.regValue ?? 0);
        let parsed = rawValue;
        if (m.signed && rawValue > 0x7FFF) parsed = -(0xFFFF - rawValue + 1);
        if (m.divider && m.divider !== 1) parsed = parsed / m.divider;
        parsed = Math.round(parsed * 100) / 100;
        setSensorTestResult(prev => ({ ...prev, [sensorId]: { raw: rawValue, value: parsed } }));
      } else {
        setSensorTestResult(prev => ({ ...prev, [sensorId]: 'fail' }));
      }
    } catch {
      setSensorTestResult(prev => ({ ...prev, [sensorId]: 'fail' }));
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
          {editedHouse.sensors.map(sensor => {
            const mb = sensor.modbus || {};
            const hasModbus = mb.unitId != null && mb.address != null;
            const isExpanded = expandedSensor === sensor.sensorId;
            const testRes = sensorTestResult[sensor.sensorId];

            return (
            <div key={sensor.sensorId}>
              {editingSensor === sensor.sensorId ? (
                <SensorEditForm
                  sensor={sensor}
                  onSave={(updates) => updateSensor(sensor.sensorId, updates)}
                  onCancel={() => setEditingSensor(null)}
                />
              ) : (
                <div className={`bg-gray-50 border rounded-xl transition-all
                  ${isExpanded ? 'border-blue-300 bg-blue-50/30' : 'border-gray-200 hover:bg-gray-100'}`}>
                  <div className="flex items-center gap-3 px-4 py-3 cursor-pointer"
                    onClick={() => setExpandedSensor(isExpanded ? null : sensor.sensorId)}>
                    <span className={`text-2xl ${sensor.enabled === false ? 'opacity-40 grayscale' : ''}`}>{sensor.icon}</span>
                    <div className={`flex-1 min-w-0 ${sensor.enabled === false ? 'opacity-50' : ''}`}>
                      <p className="text-base font-bold text-gray-800">
                        {sensor.name}
                        {sensor.enabled === false && <span className="ml-2 text-xs text-orange-500 font-semibold">수집 중지</span>}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {sensor.sensorId} · {sensor.unit} · 범위: {sensor.min}~{sensor.max}
                        {hasModbus && (
                          <span className="text-blue-600 font-semibold">
                            {' '}· U{mb.unitId}:R{mb.address} Q{mb.quantity || 1}[{mb.registerIndex || 0}] (FC{mb.fc || 3}) ÷{mb.divider || 1}{mb.signed ? ' ±' : ''}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => toggleSensorEnabled(sensor.sensorId)}
                        title={sensor.enabled === false ? '수집 활성화' : '수집 비활성화'}
                        className={`relative w-10 h-5 rounded-full transition-all ${sensor.enabled === false ? 'bg-gray-300' : 'bg-green-500'}`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${sensor.enabled === false ? 'left-0.5' : 'left-[22px]'}`} />
                      </button>
                      <button
                        onClick={() => setEditingSensor(sensor.sensorId)}
                        className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50
                                 transition-all text-base border border-transparent hover:border-blue-200"
                      >✏️</button>
                      <button
                        onClick={() => removeSensor(sensor.sensorId)}
                        className="p-2 rounded-lg text-gray-400 hover:text-rose-500 hover:bg-rose-50
                                 transition-all text-base border border-transparent hover:border-rose-200"
                      >🗑️</button>
                    </div>
                  </div>

                  {/* Modbus 센서 설정 패널 */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-gray-200 mt-1 pt-3 animate-fade-in-up">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-bold text-gray-600">📡 Modbus 센서 설정</p>
                        {sensor.modbus && (
                          <button onClick={() => removeSensorModbus(sensor.sensorId)}
                            className="text-[10px] text-rose-400 hover:text-rose-600">설정 해제</button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <div>
                          <label className="text-[10px] text-gray-500 mb-0.5 block">Unit-Id (슬레이브)</label>
                          <input type="number" min={1} max={247}
                            value={mb.unitId ?? ''}
                            onChange={(e) => updateSensorModbus(sensor.sensorId, {
                              unitId: e.target.value === '' ? null : parseInt(e.target.value)
                            })}
                            placeholder="예: 3"
                            className="input-field text-sm" />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 mb-0.5 block">FC (기능코드)</label>
                          <select
                            value={mb.fc ?? 3}
                            onChange={(e) => updateSensorModbus(sensor.sensorId, { fc: parseInt(e.target.value) })}
                            className="input-field text-sm">
                            <option value={3}>FC03 (Holding)</option>
                            <option value={4}>FC04 (Input)</option>
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 mb-0.5 block">레지스터 주소</label>
                          <input type="number" min={0} max={65535}
                            value={mb.address ?? ''}
                            onChange={(e) => updateSensorModbus(sensor.sensorId, {
                              address: e.target.value === '' ? null : parseInt(e.target.value)
                            })}
                            placeholder="예: 0"
                            className="input-field text-sm" />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 mb-0.5 block">읽기 수량 (quantity)</label>
                          <input type="number" min={1} max={20}
                            value={mb.quantity ?? 1}
                            onChange={(e) => updateSensorModbus(sensor.sensorId, {
                              quantity: e.target.value === '' ? 1 : parseInt(e.target.value)
                            })}
                            className="input-field text-sm" />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 mb-0.5 block">배열 인덱스 (registerIndex)</label>
                          <input type="number" min={0} max={19}
                            value={mb.registerIndex ?? 0}
                            onChange={(e) => updateSensorModbus(sensor.sensorId, {
                              registerIndex: e.target.value === '' ? 0 : parseInt(e.target.value)
                            })}
                            className="input-field text-sm" />
                        </div>
                        <div>
                          <label className="text-[10px] text-gray-500 mb-0.5 block">나누기 (divider)</label>
                          <input type="number" min={1} max={1000} step={1}
                            value={mb.divider ?? 10}
                            onChange={(e) => updateSensorModbus(sensor.sensorId, {
                              divider: e.target.value === '' ? 1 : parseInt(e.target.value)
                            })}
                            className="input-field text-sm" />
                        </div>
                        <div className="flex items-end pb-1">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={mb.signed || false}
                              onChange={(e) => updateSensorModbus(sensor.sensorId, { signed: e.target.checked })}
                              className="w-4 h-4 rounded border-gray-300 text-blue-600" />
                            <span className="text-xs text-gray-600">음수 허용 (signed)</span>
                          </label>
                        </div>
                      </div>

                      {/* 요약 + 테스트 */}
                      <div className="mt-3 flex items-center gap-2 flex-wrap">
                        {hasModbus ? (
                          <span className="text-xs text-gray-600">
                            ✅ U{mb.unitId}:FC{mb.fc || 3} R{mb.address} Q{mb.quantity || 1}[{mb.registerIndex || 0}] ÷{mb.divider || 1}{mb.signed ? ' (±)' : ''}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400">
                            Unit-Id와 레지스터 주소를 입력하세요
                          </span>
                        )}
                        {testRes && testRes !== 'testing' && testRes !== 'fail' && (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
                            {testRes.value}{sensor.unit} (raw:{testRes.raw})
                          </span>
                        )}
                        {testRes === 'fail' && (
                          <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-600 text-xs font-bold">
                            읽기 실패
                          </span>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); testSensorModbus(sensor.sensorId); }}
                          disabled={!hasModbus || testRes === 'testing'}
                          className={`ml-auto px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                            !hasModbus ? 'bg-gray-100 text-gray-300 cursor-default' :
                            testRes === 'testing' ? 'bg-gray-200 text-gray-500' :
                            'bg-blue-100 text-blue-700 hover:bg-blue-200'
                          }`}>
                          {testRes === 'testing' ? '읽는 중...' : '🔍 테스트 읽기'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            );
          })}
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
      <DeviceManager house={editedHouse} farmId={farmId} setEditedHouse={setEditedHouse} onUpdate={onUpdate}
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

const DeviceManager = ({ house, farmId, setEditedHouse, onUpdate, isDirty, saving, onSave }) => {
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

  // MQTT 경유 릴레이 테스트 (WebSocket 연결 시)
  const testRelayViaMqtt = (farmId) => {
    return new Promise((resolve) => {
      if (!wsService.isConnected()) return resolve(null);
      const timeout = setTimeout(() => { unsub(); resolve(null); }, 8000);
      const unsub = wsService.subscribe('relay:response', (msg) => {
        clearTimeout(timeout);
        unsub();
        resolve(msg.data);
      });
      wsService.requestRelayStatus(farmId);
    });
  };

  // Modbus 연결 테스트
  const [modbusTestResult, setModbusTestResult] = useState({}); // { [deviceId]: 'testing'|'ok'|'fail' }
  const testModbusConnection = async (deviceId) => {
    const device = devices.find(d => d.deviceId === deviceId);
    const m = device?.modbus;
    if (!m || m.address == null) return;

    setModbusTestResult(prev => ({ ...prev, [deviceId]: 'testing' }));
    try {
      // WebSocket 연결 시 MQTT 경유
      if (wsService.isConnected()) {
        console.log('[테스트] WebSocket 경로 → testRelayViaMqtt 호출');
        const result = await testRelayViaMqtt(farmId);
        console.log('[테스트] 결과:', result);
        if (result && result.coils) {
          setModbusTestResult(prev => ({ ...prev, [deviceId]: 'ok' }));
        } else {
          setModbusTestResult(prev => ({ ...prev, [deviceId]: result === null ? 'fail' : 'ok' }));
        }
        return;
      }
      console.warn('[테스트] WebSocket 미연결 → HTTP 경로');

      // 로컬 모드: HTTP 직접 조회
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
                      {modbus.controlType === 'bidir' && (
                        <>
                          <div>
                            <label className="text-xs text-gray-500 mb-1 block">전체 열림 시간 (초)</label>
                            <input
                              type="number"
                              min={1}
                              max={300}
                              placeholder="30"
                              value={modbus.openDuration ?? ''}
                              onChange={(e) => updateDeviceModbus(device.deviceId, {
                                openDuration: e.target.value === '' ? null : parseInt(e.target.value),
                              })}
                              className="input-field text-sm"
                            />
                          </div>
                          <div>
                            <label className="text-xs text-gray-500 mb-1 block">전체 닫힘 시간 (초)</label>
                            <input
                              type="number"
                              min={1}
                              max={300}
                              placeholder="30"
                              value={modbus.closeDuration ?? ''}
                              onChange={(e) => updateDeviceModbus(device.deviceId, {
                                closeDuration: e.target.value === '' ? null : parseInt(e.target.value),
                              })}
                              className="input-field text-sm"
                            />
                          </div>
                        </>
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
        const res = await saveSystemSettings(farmId, serverPayload);
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
        if (!rpiSync) {
          // WS 연결 시 MQTT로 RPi와 통신 가능 → 서버 설정 기준으로 표시
          if (wsService.isConnected()) {
            setIntervalSyncStatus({ status: 'applied', intervalSeconds: farmInterval, appliedAt: new Date().toISOString() });
          } else {
            setIntervalSyncStatus({ status: 'disconnected' });
          }
          return;
        }
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
          { id: 'collection', label: '수집 주기', icon: '📡' },
          { id: 'retention', label: '보관 기간', icon: '💾' },
          { id: 'sync', label: '동기화', icon: '🔄' },
          { id: 'modbus', label: 'Modbus', icon: '🔌' },
          { id: 'sysmanage', label: '시스템 관리', icon: '🛠️' },
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

      {/* Modbus */}
      {systemSubTab === 'modbus' && <ModbusPanel farmId={farmId} />}

      {/* 시스템 관리 */}
      {systemSubTab === 'sysmanage' && <SystemManagePanel farmId={farmId} />}
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// RelayModuleManager — 릴레이 모듈 CRUD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const MODULE_TYPES = [
  { value: 'waveshare', label: 'Waveshare (FC01/FC15)', channels: 8 },
  { value: 'eletechsup', label: 'Eletechsup (FC03/FC06)', channels: 8 },
];

const EMPTY_FORM = { name: '', unitId: '', moduleType: 'waveshare', channels: 8, description: '' };

const RelayModuleManager = ({ farmId }) => {
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [relayStatus, setRelayStatus] = useState({});

  const loadModules = useCallback(async () => {
    setLoading(true);
    try {
      const pcUrl = getPcApiBase();
      const rpiUrl = getRpiApiBase();
      let res;
      try { res = await axiosBase.get(`${pcUrl}/config/system-settings/${farmId}`, { timeout: 5000 }); }
      catch { res = await axiosBase.get(`${rpiUrl}/config/system-settings/${farmId}`, { timeout: 5000 }); }
      setModules(res.data?.data?.settings?.relayModules || []);
    } catch (err) { console.warn('릴레이 모듈 로드 실패:', err.message); }
    setLoading(false);
  }, [farmId]);

  useEffect(() => { loadModules(); }, [loadModules]);

  const persistModules = async (newModules) => {
    setSaving(true);
    try {
      const pcUrl = getPcApiBase();
      const rpiUrl = getRpiApiBase();
      let existing = {};
      try {
        const r = await axiosBase.get(`${pcUrl}/config/system-settings/${farmId}`, { timeout: 5000 });
        existing = r.data?.data?.settings || {};
      } catch {}
      await saveSystemSettings(farmId, { settings: { ...existing, relayModules: newModules } });
      setModules(newModules);
    } catch (err) { alert('저장 실패: ' + err.message); }
    setSaving(false);
  };

  const openAdd = () => { setForm(EMPTY_FORM); setEditingId(null); setShowForm(true); };
  const openEdit = (m) => { setForm({ name: m.name, unitId: m.unitId, moduleType: m.moduleType, channels: m.channels, description: m.description || '' }); setEditingId(m.id); setShowForm(true); };
  const cancelForm = () => { setShowForm(false); setEditingId(null); };

  const submitForm = async () => {
    if (!form.unitId || form.unitId === '') { alert('Unit-Id를 입력하세요'); return; }
    const uid = Number(form.unitId);
    if (isNaN(uid) || uid < 1 || uid > 247) { alert('Unit-Id는 1~247 사이여야 합니다'); return; }
    if (!form.name.trim()) { alert('이름을 입력하세요'); return; }
    const isDup = modules.some(m => m.unitId === uid && m.moduleType === form.moduleType && m.id !== editingId);
    if (isDup) { alert(`Unit-Id ${uid} (${form.moduleType})는 이미 등록되어 있습니다`); return; }

    let newModules;
    if (editingId) {
      newModules = modules.map(m => m.id === editingId ? { ...m, ...form, unitId: uid, channels: Number(form.channels) } : m);
    } else {
      const newId = `relay_${Date.now()}`;
      newModules = [...modules, { id: newId, ...form, unitId: uid, channels: Number(form.channels) }];
    }
    await persistModules(newModules);
    setShowForm(false); setEditingId(null);
  };

  const deleteModule = async (id) => {
    if (!window.confirm('이 릴레이 모듈을 삭제하시겠습니까?')) return;
    await persistModules(modules.filter(m => m.id !== id));
    setRelayStatus(prev => { const n = { ...prev }; delete n[id]; return n; });
    if (channelTest?.moduleId === id) setChannelTest(null);
  };

  const testModule = async (module) => {
    setRelayStatus(prev => ({ ...prev, [module.id]: { online: null, testing: true } }));

    // HTTP 직접 조회 (모듈 타입에 맞는 endpoint)
    const httpProbe = async () => {
      const rpiUrl = getRpiApiBase();
      try {
        const res = (module.moduleType === 'eletechsup')
          ? await axiosBase.get(`${rpiUrl}/relay/reg-status`, { params: { unitId: module.unitId, register: 0, quantity: 1 }, timeout: 5000 })
          : await axiosBase.get(`${rpiUrl}/relay/status`,     { params: { unitId: module.unitId, quantity: 8 },              timeout: 5000 });
        return res.data?.success === true;
      } catch { return false; }
    };

    try {
      // WebSocket 연결 시 MQTT 경유 시도, 실패하면 HTTP fallback
      if (wsService.isConnected()) {
        const result = await new Promise((resolve) => {
          const timeout = setTimeout(() => { unsub(); resolve(null); }, 5000);
          const unsub = wsService.subscribe('relay:response', (msg) => {
            clearTimeout(timeout); unsub(); resolve(msg.data);
          });
          wsService.requestRelayStatus(farmId);
        });
        // MQTT 응답에 module의 unitId가 일치하는 데이터가 있으면 OK
        // 응답 형식이 모듈마다 달라서 (coils / registers) 무조건 HTTP 검증으로 확정
        if (result && (result.coils || result.registers || result.unitId === module.unitId)) {
          setRelayStatus(prev => ({ ...prev, [module.id]: { online: true, testing: false } }));
          return;
        }
        // MQTT 응답이 없거나 매칭 안 되면 HTTP 폴백
      }

      const ok = await httpProbe();
      setRelayStatus(prev => ({ ...prev, [module.id]: { online: ok, testing: false } }));
    } catch {
      setRelayStatus(prev => ({ ...prev, [module.id]: { online: false, testing: false } }));
    }
  };

  const testAll = async () => {
    await Promise.all(modules.map(m => testModule(m)));
  };

  // 채널 순차 테스트 (ON→OFF 반복)
  const [channelTest, setChannelTest] = useState(null); // { moduleId, channel, total, running }
  const channelTestAbortRef = React.useRef(false);

  const runChannelTest = async (module) => {
    if (channelTest?.running) return;
    const st = relayStatus[module.id];
    if (!st || st.online !== true) {
      alert('릴레이가 연결되어 있지 않습니다.\n먼저 🔌 테스트로 연결을 확인하세요.');
      return;
    }
    if (!window.confirm(`${module.name} (${module.channels}ch) 전체 채널을 순차적으로 ON→OFF 테스트합니다.\n릴레이가 동작합니다. 진행하시겠습니까?`)) return;

    channelTestAbortRef.current = false;
    const rpiUrl = getRpiApiBase();
    const total = module.channels;
    setChannelTest({ moduleId: module.id, channel: -1, total, running: true, results: [] });

    const results = [];
    const sendCmd = async (ch, on) => {
      try {
        // WebSocket 연결 시 AWS IoT 경유 제어
        if (wsService.isConnected()) {
          const AWS_ENDPOINT = import.meta.env.VITE_AWS_CONTROL_ENDPOINT;
          if (!AWS_ENDPOINT) return false;
          const deviceId = `ch_test_${module.unitId}_${ch}`;
          const modbus = module.moduleType === 'eletechsup'
            ? { unitId: module.unitId, moduleType: 'eletechsup', controlType: 'single', address: ch + 1 }
            : { unitId: module.unitId, moduleType: 'waveshare', controlType: 'single', address: ch };
          const res = await axiosBase.post(AWS_ENDPOINT, {
            house_id: 'house1', window_id: deviceId,
            command: on ? 'on' : 'off',
            operator: 'channel_test',
            request_id: `chtest-${Date.now()}-${ch}`,
            modbus: modbus,
          }, { timeout: 8000 });
          const data = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
          const body = data.body ? (typeof data.body === 'string' ? JSON.parse(data.body) : data.body) : data;
          return body.success === true;
        }

        // 로컬 모드: HTTP 직접
        const rpiUrl = getRpiApiBase();
        if (module.moduleType === 'eletechsup') {
          const res = await axiosBase.post(`${rpiUrl}/relay/reg-write`, { unitId: module.unitId, register: ch + 1, value: on ? 256 : 512 }, { timeout: 5000 });
          return res.data?.success === true;
        } else {
          const res = await axiosBase.post(`${rpiUrl}/relay/coil-write`, { unitId: module.unitId, address: ch, value: on }, { timeout: 5000 });
          return res.data?.success === true;
        }
      } catch { return false; }
    };

    // 실제 채널 상태 조회 (HTTP) — modbus broken state 회복 대기를 위해 timeout 길게 + 재시도
    // Eletechsup 매핑: write register=ch+1 (1-indexed) → read 시도 register=1, raw[0..7] = CH0..CH7
    const fetchActualState = async () => {
      const rpiUrl = getRpiApiBase();
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          if (module.moduleType === 'eletechsup') {
            const res = await axiosBase.get(`${rpiUrl}/relay/reg-status`, {
              params: { unitId: module.unitId, register: 1, quantity: total },
              timeout: 10000,
            });
            const raw = res.data?.data?.raw || [];
            if (Array.isArray(raw) && raw.length >= total) {
              return Array.from({ length: total }, (_, i) => raw[i] === 1);
            }
          } else {
            const res = await axiosBase.get(`${rpiUrl}/relay/status`, {
              params: { unitId: module.unitId, quantity: total },
              timeout: 10000,
            });
            const coils = res.data?.data?.coils || {};
            return Array.from({ length: total }, (_, i) => coils[i] === true);
          }
        } catch {
          if (attempt < maxAttempts) await new Promise(r => setTimeout(r, 1500));
        }
      }
      return null;
    };

    // 명령 발송 간격 — 자동폴링/워치독 (1초 주기) 와 충돌 회피
    const cmdInterval = wsService.isConnected() ? 1500 : 200;

    // 단계: 명령 발사 → 검증 → 미달성 채널 재시도 (최대 2회)
    // 자동폴링이 끼어들어 broken state 발생 후 5초 reconnect → 일부 drop 되어도 재시도로 복구
    const runPhase = async (expected, phaseName) => {
      const sentOk = Array(total).fill(false);

      for (let attempt = 1; attempt <= 3; attempt++) {
        setChannelTest(prev => ({ ...prev, status: `${phaseName} ${attempt > 1 ? '재시도 ' + attempt : ''}` }));

        // 이번 시도에 보낼 채널: 첫 시도면 모두, 이후엔 아직 미달성한 채널
        const targetChannels = attempt === 1
          ? Array.from({ length: total }, (_, i) => i)
          : null; // 검증 후 결정

        if (attempt === 1) {
          for (const ch of targetChannels) {
            if (channelTestAbortRef.current) break;
            setChannelTest(prev => ({ ...prev, channel: ch, status: phaseName }));
            const ok = await sendCmd(ch, expected);
            if (ok) sentOk[ch] = true;
            await new Promise(r => setTimeout(r, cmdInterval));
          }
        }

        // 검증 — modbus reconnect (5초) 보장
        if (channelTestAbortRef.current) break;
        setChannelTest(prev => ({ ...prev, status: `${phaseName} 검증 중...` }));
        await new Promise(r => setTimeout(r, 5000));
        const actual = await fetchActualState();

        // 모든 채널이 기대값과 일치하면 종료
        if (actual && actual.every(v => v === expected)) {
          return actual;
        }

        // 미달성 채널 추출 + 재시도 (broken state 회복 후 재명령)
        if (attempt < 3 && actual) {
          const missing = [];
          for (let ch = 0; ch < total; ch++) {
            if (actual[ch] !== expected) missing.push(ch);
          }
          if (missing.length === 0) return actual;
          setChannelTest(prev => ({ ...prev, status: `${phaseName} 재시도 ${missing.length}개` }));
          for (const ch of missing) {
            if (channelTestAbortRef.current) break;
            setChannelTest(prev => ({ ...prev, channel: ch, status: phaseName + ' 재시도' }));
            const ok = await sendCmd(ch, expected);
            if (ok) sentOk[ch] = true;
            await new Promise(r => setTimeout(r, cmdInterval));
          }
          continue;
        }

        return actual; // 마지막 시도 결과 반환 (null 가능)
      }
      return null;
    };

    setChannelTest(prev => ({ ...prev, channel: 0, status: 'ALL ON' }));
    const onActual = await runPhase(true, 'ON');

    if (channelTestAbortRef.current) {
      setChannelTest(prev => ({ ...prev, running: false, channel: total, results: [] }));
      return;
    }

    setChannelTest(prev => ({ ...prev, channel: 0, status: 'ALL OFF' }));
    const offActual = await runPhase(false, 'OFF');

    // 옛 fallback 호환을 위한 빈 배열 (실제 사용 안 됨)
    const onSent = Array(total).fill(true);
    const offSent = Array(total).fill(true);

    // ch 별 OK/FAIL 판정 — 실제 상태가 ON 단계와 OFF 단계 모두 기대값과 일치해야 OK
    // 실제 상태 조회 실패 시 (onActual=null) 명령 전송 성공만 보고 fallback 판정 (옛 동작)
    for (let ch = 0; ch < total; ch++) {
      const onOk = onActual ? onActual[ch] === true : (onSent[ch] || false);
      const offOk = offActual ? offActual[ch] === false : (offSent[ch] || false);
      results.push({ ch, ok: onOk && offOk, onOk, offOk });
    }

    setChannelTest(prev => ({ ...prev, running: false, channel: total, results, verified: !!(onActual && offActual) }));
  };

  const stopChannelTest = () => { channelTestAbortRef.current = true; };

  if (loading) return <div className="text-center py-8 text-gray-400">로딩 중...</div>;

  return (
    <div className="space-y-4 max-w-3xl">
      {/* 헤더 */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-gray-800">⚡ 릴레이 모듈 관리</h2>
          <div className="flex gap-2">
            {modules.length > 0 && (
              <button onClick={testAll}
                style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#f0f9ff', color: '#0369a1', cursor: 'pointer' }}>
                🔌 전체 테스트
              </button>
            )}
            <button onClick={openAdd}
              style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer' }}>
              + 모듈 추가
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-400">RS-485 버스에 연결된 릴레이 모듈을 등록합니다. 장치 설정 시 여기서 등록한 모듈을 선택할 수 있습니다.</p>
      </div>

      {/* 추가/편집 폼 */}
      {showForm && (
        <div className="glass-card p-4 border-2 border-blue-200">
          <h3 className="text-sm font-bold text-gray-700 mb-3">{editingId ? '모듈 편집' : '새 모듈 추가'}</h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1">이름 *</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="예: 메인 릴레이"
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1">Unit-Id * (1~247)</label>
              <input type="number" value={form.unitId} onChange={e => setForm(f => ({ ...f, unitId: e.target.value }))}
                min={1} max={247} placeholder="예: 1"
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1">모듈 타입 *</label>
              <select value={form.moduleType} onChange={e => {
                const mt = MODULE_TYPES.find(t => t.value === e.target.value);
                setForm(f => ({ ...f, moduleType: e.target.value, channels: mt?.channels || 8 }));
              }} className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400">
                {MODULE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1">채널 수</label>
              <input type="number" value={form.channels} onChange={e => setForm(f => ({ ...f, channels: e.target.value }))}
                min={1} max={64}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-500 font-medium block mb-1">메모 (선택)</label>
              <input type="text" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="예: 1번 하우스 창문/팬 제어용"
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={cancelForm}
              style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#f9fafb', color: '#374151', cursor: 'pointer' }}>
              취소
            </button>
            <button onClick={submitForm} disabled={saving}
              style={{ fontSize: 12, fontWeight: 700, padding: '6px 14px', borderRadius: 8, border: 'none', background: saving ? '#93c5fd' : '#2563eb', color: '#fff', cursor: saving ? 'default' : 'pointer' }}>
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      )}

      {/* 모듈 목록 */}
      {modules.length === 0 && !showForm ? (
        <div className="glass-card p-8 text-center text-gray-400">
          <p className="text-3xl mb-2">⚡</p>
          <p className="text-sm">등록된 릴레이 모듈이 없습니다</p>
          <p className="text-xs mt-1">위 "+ 모듈 추가" 버튼으로 등록하세요</p>
        </div>
      ) : (
        <div className="space-y-2">
          {modules.map(m => {
            const st = relayStatus[m.id];
            return (
              <div key={m.id} className="glass-card p-4 flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-bold text-gray-800">{m.name}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-mono">Unit-Id {m.unitId}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">{m.moduleType}</span>
                    <span className="text-xs text-gray-400">{m.channels}ch</span>
                  </div>
                  {m.description && <p className="text-xs text-gray-400">{m.description}</p>}
                </div>
                {/* 연결 상태 */}
                <div className="min-w-[80px] text-center">
                  {st?.testing && <span className="text-xs text-gray-400">⏳ 테스트 중</span>}
                  {!st?.testing && st?.online === true && <span className="text-xs font-bold text-emerald-600">🟢 연결됨</span>}
                  {!st?.testing && st?.online === false && <span className="text-xs font-bold text-rose-600">🔴 미연결</span>}
                  {!st && <span className="text-xs text-gray-300">-</span>}
                </div>
                {/* 버튼 */}
                <div className="flex gap-1.5">
                  <button onClick={() => testModule(m)} disabled={st?.testing}
                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 7, border: '1px solid #e5e7eb', background: '#f0f9ff', color: '#0369a1', cursor: st?.testing ? 'default' : 'pointer' }}>
                    🔌 테스트
                  </button>
                  <button onClick={() => runChannelTest(m)} disabled={channelTest?.running}
                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 7, border: '1px solid #fde68a', background: '#fffbeb', color: '#92400e', cursor: channelTest?.running ? 'default' : 'pointer' }}>
                    ⚡ 채널테스트
                  </button>
                  <button onClick={() => openEdit(m)}
                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 7, border: '1px solid #e5e7eb', background: '#f9fafb', color: '#374151', cursor: 'pointer' }}>
                    편집
                  </button>
                  <button onClick={() => deleteModule(m.id)}
                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 7, border: '1px solid #fecaca', background: '#fff5f5', color: '#be123c', cursor: 'pointer' }}>
                    삭제
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {/* 채널 테스트 진행 표시 */}
      {channelTest && (
        <div className="glass-card p-4 border-2 border-amber-200">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-gray-700">
              ⚡ 채널 테스트 {channelTest.running ? '진행 중...' : (channelTestAbortRef.current ? '중단됨' : '완료')}
            </h3>
            {channelTest.running ? (
              <button onClick={stopChannelTest}
                style={{ fontSize: 11, padding: '4px 12px', borderRadius: 7, border: '1px solid #fecaca', background: '#fff5f5', color: '#be123c', fontWeight: 700, cursor: 'pointer' }}>
                중단
              </button>
            ) : (
              <button onClick={() => setChannelTest(null)}
                style={{ fontSize: 11, padding: '4px 12px', borderRadius: 7, border: '1px solid #e5e7eb', background: '#f9fafb', color: '#374151', cursor: 'pointer' }}>
                닫기
              </button>
            )}
          </div>
          {/* 채널 상태 표시 */}
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: channelTest.total }, (_, i) => {
              const result = channelTest.results?.find(r => r.ch === i);
              const isCurrent = channelTest.running && channelTest.channel === i;
              let bg = '#f3f4f6', color = '#9ca3af', label = `CH${i}`;
              if (isCurrent) { bg = channelTest.status === 'ON' ? '#fef3c7' : '#dbeafe'; color = '#92400e'; label = `CH${i} ${channelTest.status}`; }
              else if (result?.ok) { bg = '#d1fae5'; color = '#065f46'; label = `CH${i} OK`; }
              else if (result && !result.ok) { bg = '#fee2e2'; color = '#991b1b'; label = `CH${i} FAIL`; }
              return (
                <span key={i} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, background: bg, color, fontWeight: 600, minWidth: 60, textAlign: 'center' }}>
                  {label}
                </span>
              );
            })}
          </div>
          {/* 프로그레스 바 */}
          {channelTest.running && (
            <div style={{ marginTop: 8, height: 4, borderRadius: 2, background: '#e5e7eb' }}>
              <div style={{ height: '100%', borderRadius: 2, background: '#f59e0b', width: `${((channelTest.channel + 1) / channelTest.total) * 100}%`, transition: 'width 0.3s' }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SensorModuleManager — 센서 모듈 CRUD
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const SENSOR_MODULE_TYPES = [
  { value: 'temperature_humidity', label: '온습도 센서', registers: 2, defaultDivider: 10 },
  { value: 'co2', label: 'CO2 센서', registers: 1, defaultDivider: 1 },
  { value: 'soil_moisture', label: '토양수분 센서', registers: 1, defaultDivider: 10 },
  { value: 'light', label: '조도 센서', registers: 1, defaultDivider: 1 },
  { value: 'custom', label: '기타 (직접 설정)', registers: 1, defaultDivider: 1 },
];

const EMPTY_SENSOR_FORM = { name: '', unitId: '', sensorType: 'temperature_humidity', fc: 3, address: 0, quantity: 2, divider: 10, signed: false, description: '' };

const SensorModuleManager = ({ farmId }) => {
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_SENSOR_FORM);
  const [sensorStatus, setSensorStatus] = useState({});

  const loadModules = useCallback(async () => {
    setLoading(true);
    try {
      const pcUrl = getPcApiBase();
      const rpiUrl = getRpiApiBase();
      let res;
      try { res = await axiosBase.get(`${pcUrl}/config/system-settings/${farmId}`, { timeout: 5000 }); }
      catch { res = await axiosBase.get(`${rpiUrl}/config/system-settings/${farmId}`, { timeout: 5000 }); }
      setModules(res.data?.data?.settings?.sensorModules || []);
    } catch (err) { console.warn('센서 모듈 로드 실패:', err.message); }
    setLoading(false);
  }, [farmId]);

  useEffect(() => { loadModules(); }, [loadModules]);

  const persistModules = async (newModules) => {
    setSaving(true);
    try {
      const pcUrl = getPcApiBase();
      let existing = {};
      try {
        const r = await axiosBase.get(`${pcUrl}/config/system-settings/${farmId}`, { timeout: 5000 });
        existing = r.data?.data?.settings || {};
      } catch {}
      await saveSystemSettings(farmId, { settings: { ...existing, sensorModules: newModules } });
      setModules(newModules);
    } catch (err) { alert('저장 실패: ' + err.message); }
    setSaving(false);
  };

  const openAdd = () => { setForm(EMPTY_SENSOR_FORM); setEditingId(null); setShowForm(true); };
  const openEdit = (m) => {
    setForm({ name: m.name, unitId: m.unitId, sensorType: m.sensorType, fc: m.fc || 3, address: m.address || 0, quantity: m.quantity || 2, divider: m.divider || 10, signed: m.signed || false, description: m.description || '' });
    setEditingId(m.id); setShowForm(true);
  };
  const cancelForm = () => { setShowForm(false); setEditingId(null); };

  const submitForm = async () => {
    if (!form.unitId || form.unitId === '') { alert('Unit-Id를 입력하세요'); return; }
    const uid = Number(form.unitId);
    if (isNaN(uid) || uid < 1 || uid > 247) { alert('Unit-Id는 1~247 사이여야 합니다'); return; }
    if (!form.name.trim()) { alert('이름을 입력하세요'); return; }

    let newModules;
    if (editingId) {
      newModules = modules.map(m => m.id === editingId ? { ...m, ...form, unitId: uid, address: Number(form.address), quantity: Number(form.quantity), divider: Number(form.divider), fc: Number(form.fc) } : m);
    } else {
      const newId = `sensor_mod_${Date.now()}`;
      newModules = [...modules, { id: newId, ...form, unitId: uid, address: Number(form.address), quantity: Number(form.quantity), divider: Number(form.divider), fc: Number(form.fc) }];
    }
    await persistModules(newModules);
    setShowForm(false); setEditingId(null);
  };

  const deleteModule = async (id) => {
    if (!window.confirm('이 센서 모듈을 삭제하시겠습니까?')) return;
    await persistModules(modules.filter(m => m.id !== id));
    setSensorStatus(prev => { const n = { ...prev }; delete n[id]; return n; });
  };

  const testModule = async (module) => {
    setSensorStatus(prev => ({ ...prev, [module.id]: { testing: true } }));

    const parseRaw = (raw) => raw.map((v) => {
      let parsed = v;
      if (module.signed && v > 0x7FFF) parsed = -(0xFFFF - v + 1);
      if (module.divider && module.divider !== 1) parsed = parsed / module.divider;
      return Math.round(parsed * 100) / 100;
    });

    // WebSocket 경로 우선 (production 외부 환경에서도 동작 — Waveshare 와 동일)
    if (wsService.isConnected()) {
      const result = await new Promise((resolve) => {
        const timeout = setTimeout(() => { unsub(); resolve(null); }, 5000);
        const unsub = wsService.subscribe('sensor:status', (msg) => {
          const d = msg.data || {};
          // multi-unit 캐시 형식 (data = {unitId: {...}}) 또는 단일 응답
          const candidate = d[String(module.unitId)] || (d.unitId === module.unitId ? d : null);
          if (candidate && Array.isArray(candidate.raw)) {
            clearTimeout(timeout); unsub(); resolve(candidate);
          }
        });
        wsService.requestSensorStatus(farmId);
      });
      if (result && Array.isArray(result.raw)) {
        const values = parseRaw(result.raw);
        setSensorStatus(prev => ({ ...prev, [module.id]: { online: true, testing: false, raw: result.raw, values } }));
        return;
      }
    }

    // HTTP fallback (LAN 모드)
    try {
      const rpiUrl = getRpiApiBase();
      const res = await axiosBase.get(`${rpiUrl}/relay/reg-status`, {
        params: { unitId: module.unitId, register: module.address, quantity: module.quantity },
        timeout: 5000,
      });
      if (res.data?.success) {
        const raw = res.data.data?.raw || [];
        const values = parseRaw(raw);
        setSensorStatus(prev => ({ ...prev, [module.id]: { online: true, testing: false, raw, values } }));
      } else {
        setSensorStatus(prev => ({ ...prev, [module.id]: { online: false, testing: false } }));
      }
    } catch {
      setSensorStatus(prev => ({ ...prev, [module.id]: { online: false, testing: false } }));
    }
  };

  const testAll = async () => { await Promise.all(modules.map(m => testModule(m))); };

  if (loading) return <div className="text-center py-8 text-gray-400">로딩 중...</div>;

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-gray-800">📡 센서 모듈 관리</h2>
          <div className="flex gap-2">
            {modules.length > 0 && (
              <button onClick={testAll}
                style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#f0f9ff', color: '#0369a1', cursor: 'pointer' }}>
                🔍 전체 테스트
              </button>
            )}
            <button onClick={openAdd}
              style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 8, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer' }}>
              + 모듈 추가
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-400">RS-485 버스에 연결된 센서 모듈을 등록합니다. 테스트 읽기로 실제 센서 값을 확인할 수 있습니다.</p>
      </div>

      {showForm && (
        <div className="glass-card p-4 border-2 border-blue-200">
          <h3 className="text-sm font-bold text-gray-700 mb-3">{editingId ? '모듈 편집' : '새 모듈 추가'}</h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1">이름 *</label>
              <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="예: 1동 온습도"
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1">Unit-Id * (1~247)</label>
              <input type="number" value={form.unitId} onChange={e => setForm(f => ({ ...f, unitId: e.target.value }))}
                min={1} max={247} placeholder="예: 3"
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1">센서 타입 *</label>
              <select value={form.sensorType} onChange={e => {
                const st = SENSOR_MODULE_TYPES.find(t => t.value === e.target.value);
                setForm(f => ({ ...f, sensorType: e.target.value, quantity: st?.registers || 1, divider: st?.defaultDivider || 1 }));
              }} className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400">
                {SENSOR_MODULE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1">FC (기능코드)</label>
              <select value={form.fc} onChange={e => setForm(f => ({ ...f, fc: Number(e.target.value) }))}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400">
                <option value={3}>FC03 (Holding)</option>
                <option value={4}>FC04 (Input)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1">레지스터 주소</label>
              <input type="number" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                min={0} className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1">읽기 수량</label>
              <input type="number" value={form.quantity} onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                min={1} max={10} className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1">나누기 (divider)</label>
              <input type="number" value={form.divider} onChange={e => setForm(f => ({ ...f, divider: e.target.value }))}
                min={1} className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input type="checkbox" checked={form.signed} onChange={e => setForm(f => ({ ...f, signed: e.target.checked }))} />
                음수 허용 (signed)
              </label>
            </div>
            <div className="col-span-2">
              <label className="text-xs text-gray-500 font-medium block mb-1">메모 (선택)</label>
              <input type="text" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="예: SHT30 온습도 센서"
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-400" />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={cancelForm}
              style={{ fontSize: 12, padding: '6px 14px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#f9fafb', color: '#374151', cursor: 'pointer' }}>
              취소
            </button>
            <button onClick={submitForm} disabled={saving}
              style={{ fontSize: 12, fontWeight: 700, padding: '6px 14px', borderRadius: 8, border: 'none', background: saving ? '#93c5fd' : '#2563eb', color: '#fff', cursor: saving ? 'default' : 'pointer' }}>
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </div>
      )}

      {modules.length === 0 && !showForm ? (
        <div className="glass-card p-8 text-center text-gray-400">
          <p className="text-3xl mb-2">📡</p>
          <p className="text-sm">등록된 센서 모듈이 없습니다</p>
          <p className="text-xs mt-1">위 "+ 모듈 추가" 버튼으로 등록하세요</p>
        </div>
      ) : (
        <div className="space-y-2">
          {modules.map(m => {
            const st = sensorStatus[m.id];
            const typeLabel = SENSOR_MODULE_TYPES.find(t => t.value === m.sensorType)?.label || m.sensorType;
            return (
              <div key={m.id} className="glass-card p-4">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm font-bold text-gray-800">{m.name}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 font-mono">Unit-Id {m.unitId}</span>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-teal-100 text-teal-700">{typeLabel}</span>
                      <span className="text-xs text-gray-400">FC{m.fc || 3} R{m.address} Q{m.quantity}</span>
                    </div>
                    {m.description && <p className="text-xs text-gray-400">{m.description}</p>}
                  </div>
                  <div className="min-w-[80px] text-center">
                    {st?.testing && <span className="text-xs text-gray-400">⏳ 읽는 중</span>}
                    {!st?.testing && st?.online === true && <span className="text-xs font-bold text-emerald-600">🟢 연결됨</span>}
                    {!st?.testing && st?.online === false && <span className="text-xs font-bold text-rose-600">🔴 미연결</span>}
                    {!st && <span className="text-xs text-gray-300">-</span>}
                  </div>
                  <div className="flex gap-1.5">
                    <button onClick={() => testModule(m)} disabled={st?.testing}
                      style={{ fontSize: 11, padding: '4px 10px', borderRadius: 7, border: '1px solid #e5e7eb', background: '#f0f9ff', color: '#0369a1', cursor: st?.testing ? 'default' : 'pointer' }}>
                      🔍 테스트
                    </button>
                    <button onClick={() => openEdit(m)}
                      style={{ fontSize: 11, padding: '4px 10px', borderRadius: 7, border: '1px solid #e5e7eb', background: '#f9fafb', color: '#374151', cursor: 'pointer' }}>
                      편집
                    </button>
                    <button onClick={() => deleteModule(m.id)}
                      style={{ fontSize: 11, padding: '4px 10px', borderRadius: 7, border: '1px solid #fecaca', background: '#fff5f5', color: '#be123c', cursor: 'pointer' }}>
                      삭제
                    </button>
                  </div>
                </div>
                {/* 테스트 결과 표시 */}
                {st?.online && st.values && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {st.values.map((v, i) => (
                      <span key={i} className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold">
                        R{m.address + i}: {v} (raw:{st.raw[i]})
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ModbusPanel — 릴레이 모듈 관리 + 센서 모듈 관리 + 버스 현황 서브탭
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const ModbusPanel = ({ farmId }) => {
  const [subTab, setSubTab] = useState('modules');
  return (
    <div>
      <SubTabBar
        tabs={[
          { id: 'modules', label: '릴레이 모듈', icon: '⚡' },
          { id: 'sensors', label: '센서 모듈', icon: '📡' },
          { id: 'overview', label: '버스 현황', icon: '🔌' },
        ]}
        activeTab={subTab}
        onChange={setSubTab}
      />
      {subTab === 'modules' && <RelayModuleManager farmId={farmId} />}
      {subTab === 'sensors' && <SensorModuleManager farmId={farmId} />}
      {subTab === 'overview' && <ModbusOverviewPanel farmId={farmId} />}
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ModbusOverviewPanel — RS-485 버스 전체 현황 + 충돌 감지
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const ModbusOverviewPanel = ({ farmId }) => {
  const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';
  const [houses, setHouses] = useState([]);
  const [registeredModules, setRegisteredModules] = useState({ relayModules: [], sensorModules: [] });
  const [loading, setLoading] = useState(true);
  const [relayStatus, setRelayStatus] = useState({}); // { 'unitId_moduleType': { online: null|bool, testing: bool } }
  const [sensorBusStatus, setSensorBusStatus] = useState({}); // { 'unitId': { online: null|bool, testing: bool } }
  const [testingAll, setTestingAll] = useState(false);

  useEffect(() => {
    loadAllConfigs();
  }, []);

  const loadAllConfigs = async () => {
    setLoading(true);
    try {
      const rpiUrl = getRpiApiBase();
      const [housesRes, settingsRes] = await Promise.all([
        axiosBase.get(`${rpiUrl}/config/farm/${farmId}`, { timeout: 5000 }),
        axiosBase.get(`${API}/config/system-settings/${farmId}`, { timeout: 5000 }).catch(() => null),
      ]);
      if (housesRes.data?.success && Array.isArray(housesRes.data.data)) {
        setHouses(housesRes.data.data);
      }
      const s = settingsRes?.data?.data?.settings;
      if (s && typeof s === 'object') {
        setRegisteredModules({
          relayModules: Array.isArray(s.relayModules) ? s.relayModules : [],
          sensorModules: Array.isArray(s.sensorModules) ? s.sensorModules : [],
        });
      }
    } catch (err) {
      console.warn('Modbus 현황 로드 실패:', err.message);
    }
    setLoading(false);
  };

  const testUnit = async (unitId, moduleType) => {
    const key = `${unitId}_${moduleType}`;
    setRelayStatus(prev => ({ ...prev, [key]: { online: null, testing: true } }));

    const httpProbe = async () => {
      const rpiUrl = getRpiApiBase();
      try {
        const res = (moduleType === 'eletechsup')
          ? await axiosBase.get(`${rpiUrl}/relay/reg-status`, { params: { unitId, register: 0, quantity: 1 }, timeout: 5000 })
          : await axiosBase.get(`${rpiUrl}/relay/status`,     { params: { unitId, quantity: 8 },              timeout: 5000 });
        return res.data?.success === true;
      } catch { return false; }
    };

    try {
      if (wsService.isConnected()) {
        const result = await new Promise((resolve) => {
          const timeout = setTimeout(() => { unsub(); resolve(null); }, 5000);
          const unsub = wsService.subscribe('relay:response', (msg) => {
            clearTimeout(timeout); unsub(); resolve(msg.data);
          });
          wsService.requestRelayStatus(farmId);
        });
        if (result && (result.coils || result.registers || result.unitId === unitId)) {
          setRelayStatus(prev => ({ ...prev, [key]: { online: true, testing: false } }));
          return;
        }
      }
      const ok = await httpProbe();
      setRelayStatus(prev => ({ ...prev, [key]: { online: ok, testing: false } }));
    } catch {
      setRelayStatus(prev => ({ ...prev, [key]: { online: false, testing: false } }));
    }
  };

  const testSensorUnit = async (unitId, fc, address, quantity) => {
    const key = String(unitId);
    setSensorBusStatus(prev => ({ ...prev, [key]: { online: null, testing: true } }));

    // WebSocket 우선 (production 외부 환경에서도 동작)
    if (wsService.isConnected()) {
      const result = await new Promise((resolve) => {
        const timeout = setTimeout(() => { unsub(); resolve(null); }, 5000);
        const unsub = wsService.subscribe('sensor:status', (msg) => {
          const d = msg.data || {};
          const candidate = d[key] || (d.unitId === unitId ? d : null);
          if (candidate && Array.isArray(candidate.raw)) {
            clearTimeout(timeout); unsub(); resolve(candidate);
          }
        });
        wsService.requestSensorStatus(farmId);
      });
      if (result) {
        setSensorBusStatus(prev => ({ ...prev, [key]: { online: true, testing: false } }));
        return;
      }
    }

    // HTTP fallback (LAN 모드)
    try {
      const rpiUrl = getRpiApiBase();
      const res = await axiosBase.get(`${rpiUrl}/relay/reg-status`, { params: { unitId, register: address || 0, quantity: quantity || 1 }, timeout: 5000 });
      const ok = res.data?.success === true;
      setSensorBusStatus(prev => ({ ...prev, [key]: { online: ok, testing: false } }));
    } catch {
      setSensorBusStatus(prev => ({ ...prev, [key]: { online: false, testing: false } }));
    }
  };

  const testAllRelays = async (unitRelayInfo, sensorUnitInfo) => {
    setTestingAll(true);
    const relayTests = Object.values(unitRelayInfo).map(({ unitId, moduleType }) => testUnit(unitId, moduleType));
    const sensorTests = Object.values(sensorUnitInfo).map(({ unitId, fc, address, quantity }) => testSensorUnit(unitId, fc, address, quantity));
    await Promise.all([...relayTests, ...sensorTests]);
    setTestingAll(false);
  };

  // 센서 Modbus 목록 수집
  const sensorModbus = [];
  const deviceModbus = [];
  for (const house of houses) {
    for (const s of (house.sensors || [])) {
      if (s.modbus && s.modbus.unitId != null) {
        sensorModbus.push({ houseId: house.houseId, houseName: house.houseName, ...s, kind: 'sensor' });
      }
    }
    for (const d of (house.devices || [])) {
      if (d.modbus && (d.modbus.address != null || d.modbus.unitId != null)) {
        deviceModbus.push({ houseId: house.houseId, houseName: house.houseName, ...d, kind: 'device' });
      }
    }
  }

  // 센서 충돌 감지: 같은 unitId인데 address/quantity/registerIndex가 다른 센서 그룹
  const sensorGroups = {};
  for (const s of sensorModbus) {
    const key = s.sensorId + ':U' + s.modbus.unitId;
    if (!sensorGroups[key]) sensorGroups[key] = [];
    sensorGroups[key].push(s);
  }
  const sensorConflicts = new Set();
  for (const [, group] of Object.entries(sensorGroups)) {
    if (group.length < 2) continue;
    const base = group[0].modbus;
    for (let i = 1; i < group.length; i++) {
      const m = group[i].modbus;
      if (m.address !== base.address || m.quantity !== base.quantity || m.registerIndex !== base.registerIndex) {
        group.forEach(s => sensorConflicts.add(s.houseId + ':' + s.sensorId));
      }
    }
  }

  // 장치 채널 충돌 감지: 같은 unitId 내 address 중복
  const deviceChMap = {};
  const deviceConflicts = new Set();
  for (const d of deviceModbus) {
    const uid = d.modbus.unitId || 1;
    const channels = [d.modbus.address];
    if (d.modbus.address2 != null) channels.push(d.modbus.address2);
    for (const ch of channels) {
      const key = uid + ':' + ch;
      if (deviceChMap[key]) {
        deviceConflicts.add(d.houseId + ':' + d.deviceId);
        deviceConflicts.add(deviceChMap[key]);
      } else {
        deviceChMap[key] = d.houseId + ':' + d.deviceId;
      }
    }
  }

  // Unit-Id별 장치 요약
  const unitSummary = {};
  for (const s of sensorModbus) {
    const uid = s.modbus.unitId;
    if (!unitSummary[uid]) unitSummary[uid] = { sensors: 0, devices: 0, type: '센서' };
    unitSummary[uid].sensors++;
  }
  for (const d of deviceModbus) {
    const uid = d.modbus.unitId || 1;
    if (!unitSummary[uid]) unitSummary[uid] = { sensors: 0, devices: 0, type: '장치' };
    unitSummary[uid].devices++;
  }
  // 등록된 모듈도 unitSummary 에 추가 (device/sensor 매핑이 없어도 모듈은 표시)
  for (const m of registeredModules.relayModules) {
    const uid = m.unitId;
    if (uid != null && !unitSummary[uid]) unitSummary[uid] = { sensors: 0, devices: 0, type: '장치' };
  }
  for (const m of registeredModules.sensorModules) {
    const uid = m.unitId;
    if (uid != null && !unitSummary[uid]) unitSummary[uid] = { sensors: 0, devices: 0, type: '센서' };
  }

  // Unit-Id별 릴레이 모듈 정보 (등록된 모듈 우선, device 매핑 카운트 추가)
  const unitRelayInfo = {};
  for (const m of registeredModules.relayModules) {
    if (m.unitId == null) continue;
    const key = `${m.unitId}_${m.moduleType || 'waveshare'}`;
    unitRelayInfo[key] = {
      unitId: m.unitId,
      moduleType: m.moduleType || 'waveshare',
      moduleName: m.name,
      channels: m.channels,
      deviceCount: 0,
    };
  }
  for (const d of deviceModbus) {
    const uid = d.modbus.unitId || 1;
    const moduleType = d.modbus.moduleType || 'waveshare';
    const key = `${uid}_${moduleType}`;
    if (!unitRelayInfo[key]) unitRelayInfo[key] = { unitId: uid, moduleType, deviceCount: 0 };
    unitRelayInfo[key].deviceCount++;
  }

  // Unit-Id별 센서 모듈 정보 (등록된 모듈 우선)
  const unitSensorInfo = {};
  for (const m of registeredModules.sensorModules) {
    if (m.unitId == null) continue;
    unitSensorInfo[m.unitId] = {
      unitId: m.unitId,
      fc: m.fc || 3,
      address: m.address ?? 0,
      quantity: m.quantity || 1,
      moduleName: m.name,
      sensorCount: 0,
    };
  }
  for (const s of sensorModbus) {
    const uid = s.modbus.unitId;
    if (!unitSensorInfo[uid]) unitSensorInfo[uid] = { unitId: uid, fc: s.modbus.fc || 3, address: s.modbus.address || 0, quantity: s.modbus.quantity || 1, sensorCount: 0 };
    unitSensorInfo[uid].sensorCount++;
  }

  if (loading) {
    return <div className="text-center py-8 text-gray-400">로딩 중...</div>;
  }

  const hasConflicts = sensorConflicts.size > 0 || deviceConflicts.size > 0;

  return (
    <div className="space-y-4 max-w-4xl">
      {/* RS-485 버스 요약 */}
      <div className="glass-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-gray-800">🔌 RS-485 버스 현황</h2>
          <div className="flex items-center gap-2">
            <button onClick={loadAllConfigs} className="text-xs text-blue-500 hover:text-blue-700">🔄 새로고침</button>
            {(Object.keys(unitRelayInfo).length > 0 || Object.keys(unitSensorInfo).length > 0) && (
              <button
                onClick={() => testAllRelays(unitRelayInfo, unitSensorInfo)}
                disabled={testingAll}
                style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 7, border: '1px solid #e5e7eb', background: testingAll ? '#f3f4f6' : '#f0f9ff', color: testingAll ? '#9ca3af' : '#0369a1', cursor: testingAll ? 'default' : 'pointer' }}
              >
                {testingAll ? '⏳ 테스트 중...' : '🔌 연결 테스트'}
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          {Object.entries(unitSummary).sort((a, b) => Number(a[0]) - Number(b[0])).map(([uid, info]) => {
            // 이 unit의 릴레이 모듈 목록
            const relayEntries = Object.values(unitRelayInfo).filter(r => String(r.unitId) === String(uid));
            return (
              <div key={uid} className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-center min-w-[110px]">
                <p className="text-xs text-gray-500 mb-0.5">Unit-Id {uid}</p>
                <p className="text-sm font-bold text-gray-800 mb-1">
                  {info.sensors > 0 && <span className="text-blue-600">센서 {info.sensors}</span>}
                  {info.sensors > 0 && info.devices > 0 && ' + '}
                  {info.devices > 0 && <span className="text-purple-600">장치 {info.devices}</span>}
                </p>
                {relayEntries.map(r => {
                  const key = `${r.unitId}_${r.moduleType}`;
                  const st = relayStatus[key];
                  return (
                    <div key={key} className="flex items-center justify-center gap-1 mt-1">
                      <span className="text-[10px] text-gray-400">{r.moduleType}</span>
                      {st?.testing && <span className="text-[10px] text-gray-400">⏳</span>}
                      {!st?.testing && st?.online === true && <span className="text-[10px] font-bold text-emerald-600">🟢 연결됨</span>}
                      {!st?.testing && st?.online === false && <span className="text-[10px] font-bold text-rose-600">🔴 미연결</span>}
                      {!st?.testing && st?.online == null && (
                        <button
                          onClick={() => testUnit(r.unitId, r.moduleType)}
                          className="text-[10px] text-blue-500 hover:text-blue-700 underline"
                        >테스트</button>
                      )}
                    </div>
                  );
                })}
                {/* 센서 전용 Unit-Id: 릴레이 엔트리가 없는 경우 센서 연결 상태 표시 */}
                {relayEntries.length === 0 && unitSensorInfo[uid] && (() => {
                  const sst = sensorBusStatus[String(uid)];
                  return (
                    <div className="flex items-center justify-center gap-1 mt-1">
                      <span className="text-[10px] text-gray-400">센서</span>
                      {sst?.testing && <span className="text-[10px] text-gray-400">⏳</span>}
                      {!sst?.testing && sst?.online === true && <span className="text-[10px] font-bold text-emerald-600">🟢 연결됨</span>}
                      {!sst?.testing && sst?.online === false && <span className="text-[10px] font-bold text-rose-600">🔴 미연결</span>}
                      {!sst?.testing && sst?.online == null && (
                        <button
                          onClick={() => testSensorUnit(unitSensorInfo[uid].unitId, unitSensorInfo[uid].fc, unitSensorInfo[uid].address, unitSensorInfo[uid].quantity)}
                          className="text-[10px] text-blue-500 hover:text-blue-700 underline"
                        >테스트</button>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
        {hasConflicts && (
          <div className="mt-3 bg-rose-50 border border-rose-200 rounded-xl p-3">
            <p className="text-sm font-bold text-rose-700">⚠️ 설정 충돌 감지됨 — 아래에서 확인하세요</p>
          </div>
        )}
        {!hasConflicts && sensorModbus.length + deviceModbus.length > 0 && (
          <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
            <p className="text-sm font-bold text-emerald-700">✅ 충돌 없음</p>
          </div>
        )}
      </div>

      {/* 센서 Modbus 현황 */}
      {sensorModbus.length > 0 && (
        <div className="glass-card p-4">
          <h3 className="text-base font-bold text-gray-800 mb-3">📡 센서 Modbus 설정 ({sensorModbus.length})</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="pb-2 pr-2">하우스</th>
                  <th className="pb-2 pr-2">센서</th>
                  <th className="pb-2 pr-2">Unit-Id</th>
                  <th className="pb-2 pr-2">FC</th>
                  <th className="pb-2 pr-2">Addr</th>
                  <th className="pb-2 pr-2">Qty</th>
                  <th className="pb-2 pr-2">Index</th>
                  <th className="pb-2 pr-2">÷</th>
                  <th className="pb-2 pr-2">±</th>
                  <th className="pb-2">상태</th>
                </tr>
              </thead>
              <tbody>
                {sensorModbus.map((s, i) => {
                  const conflict = sensorConflicts.has(s.houseId + ':' + s.sensorId);
                  return (
                    <tr key={i} className={`border-b border-gray-100 ${conflict ? 'bg-rose-50' : ''}`}>
                      <td className="py-2 pr-2 font-medium">{s.houseName || s.houseId}</td>
                      <td className="py-2 pr-2">{s.icon} {s.name}</td>
                      <td className="py-2 pr-2 font-mono">{s.modbus.unitId}</td>
                      <td className="py-2 pr-2 font-mono">{s.modbus.fc || 3}</td>
                      <td className="py-2 pr-2 font-mono">{s.modbus.address}</td>
                      <td className="py-2 pr-2 font-mono">{s.modbus.quantity || 1}</td>
                      <td className="py-2 pr-2 font-mono">{s.modbus.registerIndex || 0}</td>
                      <td className="py-2 pr-2 font-mono">{s.modbus.divider || 1}</td>
                      <td className="py-2 pr-2">{s.modbus.signed ? '✓' : ''}</td>
                      <td className="py-2">
                        {conflict
                          ? <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-bold">⚠️ 불일치</span>
                          : <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold">✅</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 장치 Modbus 현황 */}
      {deviceModbus.length > 0 && (
        <div className="glass-card p-4">
          <h3 className="text-base font-bold text-gray-800 mb-3">⚡ 장치 Modbus 설정 ({deviceModbus.length})</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="pb-2 pr-2">하우스</th>
                  <th className="pb-2 pr-2">장치</th>
                  <th className="pb-2 pr-2">Unit-Id</th>
                  <th className="pb-2 pr-2">모듈</th>
                  <th className="pb-2 pr-2">제어</th>
                  <th className="pb-2 pr-2">CH1</th>
                  <th className="pb-2 pr-2">CH2</th>
                  <th className="pb-2">상태</th>
                </tr>
              </thead>
              <tbody>
                {deviceModbus.map((d, i) => {
                  const conflict = deviceConflicts.has(d.houseId + ':' + d.deviceId);
                  return (
                    <tr key={i} className={`border-b border-gray-100 ${conflict ? 'bg-rose-50' : ''}`}>
                      <td className="py-2 pr-2 font-medium">{d.houseName || d.houseId}</td>
                      <td className="py-2 pr-2">{d.icon} {d.name}</td>
                      <td className="py-2 pr-2 font-mono">{d.modbus.unitId || 1}</td>
                      <td className="py-2 pr-2 text-[10px]">{d.modbus.moduleType || 'waveshare'}</td>
                      <td className="py-2 pr-2 text-[10px]">{d.modbus.controlType || 'single'}</td>
                      <td className="py-2 pr-2 font-mono">{d.modbus.address ?? '-'}</td>
                      <td className="py-2 pr-2 font-mono">{d.modbus.address2 ?? '-'}</td>
                      <td className="py-2">
                        {conflict
                          ? <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-bold">⚠️ 중복</span>
                          : <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-bold">✅</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sensorModbus.length === 0 && deviceModbus.length === 0 && (
        <div className="glass-card p-8 text-center text-gray-400">
          <p className="text-4xl mb-2">🔌</p>
          {(registeredModules.relayModules.length > 0 || registeredModules.sensorModules.length > 0) ? (
            <>
              <p className="text-gray-700 font-medium mb-1">위에 표시된 모듈은 등록만 되어 있습니다</p>
              <p className="text-sm">하우스 설정에서 센서·장치를 추가하고 Modbus 채널을 매핑하세요</p>
            </>
          ) : (
            <p>Modbus 설정된 센서/장치가 없습니다</p>
          )}
        </div>
      )}
    </div>
  );
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SystemManagePanel — 시스템 관리 (Node-RED 재시작, 상태 확인)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const SystemManagePanel = ({ farmId }) => {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [actionMsg, setActionMsg] = useState(null);

  // 시스템 관리 API — WS 연결 시 MQTT 경유, 아니면 RPi 직접
  const sysUrl = getRpiApiBase().replace(/:\d+\/api.*$/, '') + ':3100/api';

  const loadStatus = useCallback(async () => {
    try {
      // WebSocket 연결 시 MQTT 경유로 상태 확인
      if (wsService.isConnected()) {
        // MQTT heartbeat 기반으로 RPi 온라인 판단
        setStatus({
          nodeRed: { online: true, uptime: 'MQTT 연결됨' },
          rpiExpress: { online: true, uptime: 'MQTT 연결됨' },
        });
        setLoading(false);
        return;
      }

      const res = await axiosBase.get(`${sysUrl}/system/status`, { timeout: 5000 });
      const d = res.data;
      if (d?.nodeRed || d?.rpiExpress) {
        // uptime 계산
        const fmtUptime = (ms) => {
          if (!ms) return '';
          const sec = Math.floor((Date.now() - ms) / 1000);
          if (sec < 60) return `${sec}초`;
          if (sec < 3600) return `${Math.floor(sec/60)}분`;
          return `${Math.floor(sec/3600)}시간 ${Math.floor((sec%3600)/60)}분`;
        };
        setStatus({
          nodeRed: d.nodeRed ? { online: d.nodeRed.status === 'online', uptime: fmtUptime(d.nodeRed.uptime), restarts: d.nodeRed.restarts } : null,
          rpiExpress: d.rpiExpress ? { online: d.rpiExpress.status === 'online', uptime: fmtUptime(d.rpiExpress.uptime) } : null,
        });
      }
    } catch (err) {
      setStatus(null);
      console.warn('[SystemManage] status load failed:', err.message);
    } finally { setLoading(false); }
  }, [sysUrl]);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 15000);
    return () => clearInterval(interval);
  }, [loadStatus]);

  const handleAction = async (action, label) => {
    if (!confirm(`${label} 하시겠습니까?`)) return;
    setActionLoading(action);
    setActionMsg(null);
    try {
      // WebSocket 연결 시 MQTT 경유
      if (wsService.isConnected()) {
        wsService.send({ type: 'system:command', action, farmId });
        setActionMsg({ type: 'success', text: `${label} 요청 전송됨 (MQTT)` });
        setTimeout(loadStatus, 5000);
      } else {
        const res = await axiosBase.post(`${sysUrl}/system/${action}`, {}, { timeout: 30000 });
        if (res.data?.success !== false) {
          setActionMsg({ type: 'success', text: `${label} 완료` });
          setTimeout(loadStatus, 5000);
        } else {
          setActionMsg({ type: 'error', text: res.data?.error || '실패' });
        }
      }
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message });
    } finally { setActionLoading(null); }
  };

  // 릴레이 전체 OFF — relay:query / sensor:query / system:command 와 동일 WebSocket 패턴
  // backend → MQTT relay/reset publish → RPi 가 global.relayModules 순회하며 OFF (자동매핑)
  const handleRelayReset = async () => {
    if (!confirm('모든 릴레이를 OFF 하시겠습니까?\n(동작 중인 장치가 모두 정지됩니다)')) return;
    setActionLoading('relay-reset');
    setActionMsg(null);
    try {
      if (wsService.isConnected()) {
        const sent = wsService.requestRelayReset(farmId);
        if (sent) {
          setActionMsg({ type: 'success', text: '릴레이 전체 OFF 요청 전송 (MQTT)' });
        } else {
          setActionMsg({ type: 'error', text: 'WebSocket 미연결 — 요청 실패' });
        }
      } else {
        // 오프라인 fallback: RPi 직접 (LAN 모드)
        const rpiBase = getRpiApiBase();
        const res = await axiosBase.post(`${rpiBase}/relay/reset-all`, {}, { timeout: 15000 });
        if (res.data?.success) {
          setActionMsg({ type: 'success', text: `릴레이 전체 OFF 완료 (${res.data.detail || ''})` });
        } else {
          setActionMsg({ type: 'error', text: res.data?.error || '릴레이 초기화 실패' });
        }
      }
    } catch (err) {
      setActionMsg({ type: 'error', text: err.message });
    } finally { setActionLoading(null); }
  };

  const StatusBadge = ({ online, label }) => (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold ${
      online ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
    }`}>
      <span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-rose-500'}`} />
      {label || (online ? '온라인' : '오프라인')}
    </span>
  );

  return (
    <div className="max-w-2xl space-y-4">
      {/* 시스템 상태 */}
      <div className="glass-card p-4 md:p-5">
        <h2 className="text-lg font-bold text-gray-800 mb-3">시스템 상태</h2>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-8 h-8 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
          </div>
        ) : !status ? (
          <div className="text-center py-6">
            <p className="text-gray-500 text-sm">RPi 연결 불가</p>
            <button onClick={loadStatus} className="mt-2 text-blue-600 text-sm font-medium hover:underline">재시도</button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-500 mb-1">Node-RED</p>
              <StatusBadge online={status.nodeRed?.online} />
              {status.nodeRed?.uptime && <p className="text-xs text-gray-400 mt-1">가동 {status.nodeRed.uptime}</p>}
              {status.nodeRed?.restarts > 0 && <p className="text-xs text-gray-400">재시작 {status.nodeRed.restarts}회</p>}
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-500 mb-1">RPi Express</p>
              <StatusBadge online={status.rpiExpress?.online} />
              {status.rpiExpress?.uptime && <p className="text-xs text-gray-400 mt-1">가동 {status.rpiExpress.uptime}</p>}
            </div>
          </div>
        )}
      </div>

      {/* 제어 버튼 */}
      <div className="glass-card p-4 md:p-5">
        <h2 className="text-lg font-bold text-gray-800 mb-3">서비스 제어</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-amber-50 rounded-xl border border-amber-200">
            <div>
              <p className="text-sm font-bold text-gray-800">Node-RED 재시작</p>
              <p className="text-xs text-gray-500">Modbus 통신 장애 시 사용</p>
            </div>
            <button onClick={() => handleAction('restart-nodered', 'Node-RED 재시작')}
              disabled={!!actionLoading}
              className="px-4 py-2 rounded-lg text-sm font-bold bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-all active:scale-95">
              {actionLoading === 'restart-nodered' ? '재시작 중...' : '재시작'}
            </button>
          </div>
          <div className="flex items-center justify-between p-3 bg-blue-50 rounded-xl border border-blue-200">
            <div>
              <p className="text-sm font-bold text-gray-800">RPi Express 재시작</p>
              <p className="text-xs text-gray-500">RPi API 서버 재시작</p>
            </div>
            <button onClick={() => handleAction('restart-express', 'RPi Express 재시작')}
              disabled={!!actionLoading}
              className="px-4 py-2 rounded-lg text-sm font-bold bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-all active:scale-95">
              {actionLoading === 'restart-express' ? '재시작 중...' : '재시작'}
            </button>
          </div>
          <div className="flex items-center justify-between p-3 bg-rose-50 rounded-xl border border-rose-200">
            <div>
              <p className="text-sm font-bold text-gray-800">릴레이 전체 OFF</p>
              <p className="text-xs text-gray-500">모든 릴레이 초기화 (16채널)</p>
            </div>
            <button onClick={handleRelayReset}
              disabled={!!actionLoading}
              className="px-4 py-2 rounded-lg text-sm font-bold bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-50 transition-all active:scale-95">
              {actionLoading === 'relay-reset' ? '초기화 중...' : '초기화'}
            </button>
          </div>
        </div>
        {actionMsg && (
          <div className={`mt-3 p-2.5 rounded-lg text-sm font-medium ${
            actionMsg.type === 'success' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'
          }`}>{actionMsg.text}</div>
        )}
      </div>
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

  // hybrid: WebSocket 우선 (외부 환경 동작) + LAN HTTP fallback (빠름)
  const loadStatus = useCallback(async () => {
    try {
      // 1. WebSocket 경로 (Category A: RPi query)
      if (wsService.isConnected()) {
        const result = await new Promise((resolve) => {
          const timeout = setTimeout(() => { unsub(); resolve(null); }, 5000);
          const unsub = wsService.subscribe('sync:status', (msg) => {
            clearTimeout(timeout); unsub(); resolve(msg.data);
          });
          wsService.requestSyncStatus(farmId);
        });
        if (result) {
          setSyncStatus(result);
          setLoading(false);
          return;
        }
      }

      // 2. HTTP fallback (LAN 모드 — RPi 직접 접근 가능 시 빠름)
      const rpiUrl = getRpiApiBase();
      const res = await axiosBase.get(`${rpiUrl}/sync/status`, { timeout: 5000 });
      if (res.data?.success) setSyncStatus(res.data.data);
    } catch (err) {
      console.warn('[SyncPanel] status load failed:', err.message);
    } finally { setLoading(false); }
  }, [farmId]);

  // 동기화 진행 중이면 3초, 아니면 15초 폴링
  const isRunning = syncStatus?.syncRunning;
  useEffect(() => {
    loadStatus();
    const interval = isRunning ? 3000 : 15000;
    const id = setInterval(loadStatus, interval);
    return () => clearInterval(id);
  }, [loadStatus, isRunning]);

  // hybrid: WebSocket 우선 (Category B: RPi command) + LAN HTTP fallback
  const handleAction = async (action) => {
    if (action === 'skip' && !window.confirm('미동기화 데이터를 동기화 안함으로 처리하시겠습니까?\n해당 데이터는 서버에 전송되지 않습니다.')) return;
    setActionLoading(action);
    setActionMsg(null);
    const labels = { start: '동기화 시작', stop: '동기화 중지', skip: '동기화 안함' };
    try {
      // 1. WebSocket 경로
      if (wsService.isConnected()) {
        const sent = wsService.requestSyncCommand(farmId, action);
        if (sent) {
          setActionMsg({ type: 'success', text: `${labels[action]} 요청 전송 (MQTT)` });
          setTimeout(loadStatus, 1500);
          setTimeout(loadStatus, 3000);
          return;
        }
      }
      // 2. HTTP fallback (LAN)
      const rpiUrl = getRpiApiBase();
      await axiosBase.post(`${rpiUrl}/sync/${action}`, {}, { timeout: 10000 });
      setActionMsg({ type: 'success', text: `${labels[action]} 명령 전송됨` });
      setTimeout(loadStatus, 500);
      setTimeout(loadStatus, 2000);
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

        {/* 동기화 진행 상태 */}
        {s.syncRunning && s.syncInitialCount > 0 && (
          <div className="mb-3">
            <div className="flex justify-between text-xs text-blue-600 font-semibold mb-1">
              <span>동기화 진행 중...</span>
              <span>{(s.syncedSoFar || 0).toLocaleString()} / {s.syncInitialCount.toLocaleString()}</span>
            </div>
            <div className="w-full h-2.5 bg-blue-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, ((s.syncedSoFar || 0) / s.syncInitialCount) * 100)}%` }}
              />
            </div>
            <p className="text-xs text-blue-400 mt-1">
              {Math.round(((s.syncedSoFar || 0) / s.syncInitialCount) * 100)}% 완료
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className={`w-2 h-2 rounded-full ${s.syncRunning ? 'bg-blue-500 animate-pulse' : s.syncPaused ? 'bg-gray-400' : 'bg-green-500 animate-pulse'}`} />
          {s.syncRunning ? '동기화 진행 중' : s.syncPaused ? '자동 동기화 중지됨' : '자동 동기화 활성 (5분 간격)'}
          <span className="mx-1">·</span>
          모드: {s.operationMode || '알 수 없음'}
        </div>
      </div>

      {/* 현재 세션 동기화 현황 */}
      {(s.syncRunning || s.syncedSoFar > 0 || last) && (
        <div className="glass-card p-4">
          <h3 className="text-sm font-bold text-gray-700 mb-2">동기화 현황</h3>
          {s.syncedSoFar > 0 && (
            <div className="flex items-center gap-3 mb-2">
              <span className="text-lg">📊</span>
              <div>
                <p className="text-sm font-semibold text-blue-700">
                  이번 세션: {(s.syncedSoFar || 0).toLocaleString()}건 전송 완료
                </p>
                <p className="text-xs text-gray-400">
                  남은 건수: {(s.unsynced || 0).toLocaleString()}건
                </p>
              </div>
            </div>
          )}
          {last && (
            <div className="flex items-center gap-3">
              <span className="text-lg">{last.success ? '✅' : '❌'}</span>
              <div>
                <p className="text-sm font-semibold text-gray-800">
                  {last.success ? `최근 배치: ${last.count}건 성공` : `전송 실패 (${last.error || '오류'})`}
                </p>
                <p className="text-xs text-gray-400">{last.time ? new Date(last.time).toLocaleString('ko-KR') : '-'}</p>
              </div>
            </div>
          )}
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
          disabled={actionLoading || s.unsynced === 0 || s.syncRunning}
          className={`py-3 rounded-xl text-sm font-bold transition-all active:scale-[0.97] ${
            s.unsynced > 0 && !actionLoading && !s.syncRunning
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700'
              : 'bg-gray-100 text-gray-400 cursor-default'
          }`}
        >
          {actionLoading === 'start' ? '시작 중...' : s.syncRunning ? '진행 중...' : '🔄 동기화 시작'}
        </button>
        <button
          onClick={() => handleAction('stop')}
          disabled={actionLoading || !s.syncRunning}
          className={`py-3 rounded-xl text-sm font-bold transition-all active:scale-[0.97] ${
            s.syncRunning && !actionLoading
              ? 'bg-red-500 text-white shadow-lg shadow-red-500/20 hover:bg-red-600'
              : 'bg-gray-200 text-gray-400 cursor-default'
          }`}
        >
          {actionLoading === 'stop' ? '중지 중...' : '⏸️ 동기화 중지'}
        </button>
        <button
          onClick={() => handleAction('skip')}
          disabled={actionLoading || s.unsynced === 0 || s.syncRunning}
          className={`py-3 rounded-xl text-sm font-bold transition-all active:scale-[0.97] ${
            s.unsynced > 0 && !actionLoading && !s.syncRunning
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

const OFFLINE_THRESHOLD_PRESETS = [
  { value: 5, label: '5분' },
  { value: 10, label: '10분' },
  { value: 15, label: '15분' },
  { value: 30, label: '30분' },
];
const OFFLINE_CRITICAL_PRESETS = [
  { value: 30, label: '30분' },
  { value: 60, label: '1시간' },
  { value: 120, label: '2시간' },
  { value: 180, label: '3시간' },
];
const OFFLINE_COOLDOWN_PRESETS = [
  { value: 30, label: '30분' },
  { value: 60, label: '1시간' },
  { value: 120, label: '2시간' },
  { value: 240, label: '4시간' },
];
const MAINTENANCE_DAY_OPTIONS = [
  { value: 90, label: 'D-90' },
  { value: 60, label: 'D-60' },
  { value: 30, label: 'D-30' },
  { value: 14, label: 'D-14' },
  { value: 7, label: 'D-7' },
  { value: 3, label: 'D-3' },
  { value: 0, label: 'D-Day' },
];

const AlertSettingsTab = ({ farmId, houses, onHousesUpdate }) => {
  const farmLocal = isFarmLocalMode();

  // 서버 연결 설정 (localStorage)
  const [timeoutSec, setTimeoutSec] = useState(() => {
    try { const v = parseInt(localStorage.getItem('smartfarm_serverTimeout')); return (!isNaN(v) && v >= 30) ? v : 180; } catch { return 180; }
  });
  const [pollingSec, setPollingSec] = useState(() => {
    try { const v = parseInt(localStorage.getItem('smartfarm_pollingInterval')); return (!isNaN(v) && v >= 3) ? v : 10; } catch { return 10; }
  });
  const [serverSaved, setServerSaved] = useState(true);
  const formatTimeSec = (sec) => {
    if (sec >= 3600) return `${Math.floor(sec/3600)}시간 ${Math.floor((sec%3600)/60)}분`;
    if (sec >= 60) return `${Math.floor(sec/60)}분 ${sec%60 ? sec%60+'초' : ''}`.trim();
    return `${sec}초`;
  };
  const handleTimeoutChange = (val) => { const c = Math.max(30, Math.min(1800, val)); setTimeoutSec(c); setServerSaved(false); };
  const handlePollingChange = (val) => { const c = Math.max(3, Math.min(300, val)); setPollingSec(c); setServerSaved(false); };
  const saveServerSettings = () => {
    localStorage.setItem('smartfarm_serverTimeout', String(timeoutSec));
    localStorage.setItem('smartfarm_pollingInterval', String(pollingSec));
    setServerSaved(true);
  };

  const [alertConfig, setAlertConfig] = useState({ enabled: true, checkIntervalMinutes: 5, cooldownMinutes: 15, criticalRatio: 0.5 });
  const [offlineConfig, setOfflineConfig] = useState({ enabled: true, offlineThresholdMin: 10, criticalThresholdMin: 60, cooldownMinutes: 60 });
  const [maintenanceConfig, setMaintenanceConfig] = useState({ enabled: true, alertDays: [30, 7, 0] });
  const [deviceFailureConfig, setDeviceFailureConfig] = useState({ enabled: true, observationWindowMinutes: 30, controlFailureThreshold: 3, cooldownMinutes: 60 });
  const [serverConfig, setServerConfig] = useState(null);
  const [serverOfflineConfig, setServerOfflineConfig] = useState(null);
  const [serverMaintenanceConfig, setServerMaintenanceConfig] = useState(null);
  const [serverDeviceFailureConfig, setServerDeviceFailureConfig] = useState(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [selectedHouseId, setSelectedHouseId] = useState(null);
  const [editedSensors, setEditedSensors] = useState([]);
  const [sensorsDirty, setSensorsDirty] = useState(false);
  const [sensorSaving, setSensorSaving] = useState(false);

  // 농장 알림 설정 로드 (센서 + 오프라인 + 유지보수)
  useEffect(() => {
    (async () => {
      setConfigLoading(true);
      try {
        const res = await axios.get(`${getApiBase()}/config/system-settings/${farmId}`, { timeout: 5000 });
        if (res.data.success) {
          const data = res.data.data || {};
          if (data.alertConfig) {
            const cfg = { enabled: true, checkIntervalMinutes: 5, cooldownMinutes: 15, criticalRatio: 0.5, ...data.alertConfig };
            setAlertConfig(cfg);
            setServerConfig(cfg);
          }
          if (data.offlineConfig) {
            const cfg = { enabled: true, offlineThresholdMin: 10, criticalThresholdMin: 60, cooldownMinutes: 60, ...data.offlineConfig };
            setOfflineConfig(cfg);
            setServerOfflineConfig(cfg);
          }
          if (data.maintenanceConfig) {
            const cfg = { enabled: true, alertDays: [30, 7, 0], ...data.maintenanceConfig };
            setMaintenanceConfig(cfg);
            setServerMaintenanceConfig(cfg);
          }
          if (data.deviceFailureConfig) {
            const cfg = { enabled: true, observationWindowMinutes: 30, controlFailureThreshold: 3, cooldownMinutes: 60, ...data.deviceFailureConfig };
            setDeviceFailureConfig(cfg);
            setServerDeviceFailureConfig(cfg);
          }
        }
      } catch (e) { console.warn('알림 설정 로드 실패:', e.message); }
      finally { setConfigLoading(false); }
    })();
  }, [farmId]);

  const configDirty = serverConfig ? JSON.stringify(alertConfig) !== JSON.stringify(serverConfig) : false;
  const offlineDirty = serverOfflineConfig ? JSON.stringify(offlineConfig) !== JSON.stringify(serverOfflineConfig) : true;
  const maintenanceDirty = serverMaintenanceConfig ? JSON.stringify(maintenanceConfig) !== JSON.stringify(serverMaintenanceConfig) : true;
  const deviceFailureDirty = serverDeviceFailureConfig ? JSON.stringify(deviceFailureConfig) !== JSON.stringify(serverDeviceFailureConfig) : true;

  const saveConfig = async (type) => {
    setSaving(true);
    try {
      const payload = {};
      if (type === 'alert') payload.alertConfig = alertConfig;
      else if (type === 'offline') payload.offlineConfig = offlineConfig;
      else if (type === 'maintenance') payload.maintenanceConfig = maintenanceConfig;
      else if (type === 'deviceFailure') payload.deviceFailureConfig = deviceFailureConfig;

      const res = await saveSystemSettings(farmId, payload);
      if (res.data.success) {
        if (type === 'alert') setServerConfig({ ...alertConfig });
        else if (type === 'offline') setServerOfflineConfig({ ...offlineConfig });
        else if (type === 'maintenance') setServerMaintenanceConfig({ ...maintenanceConfig });
        else if (type === 'deviceFailure') setServerDeviceFailureConfig({ ...deviceFailureConfig });
        alert('설정이 저장되었습니다.');
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
          { id: 'farm', label: '센서 알림', icon: '📊' },
          { id: 'offline', label: '오프라인 알림', icon: '📡' },
          { id: 'server', label: '서버 연결 경고', icon: '🖥️' },
          { id: 'maintenance', label: '유지보수 알림', icon: '🔧' },
          { id: 'deviceFailure', label: '장비 고장', icon: '🔴' },
          { id: 'sensors', label: '센서 임계값', icon: '🎚️' },
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
              <button onClick={() => saveConfig('alert')} disabled={!configDirty || saving}
                className={`w-full py-2.5 rounded-xl text-base font-bold transition-all active:scale-[0.97] ${
                  configDirty ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700' : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-default'
                }`}>{saving ? '저장 중...' : configDirty ? '💾 설정 저장' : '저장 완료'}</button>
            </>
          )}
        </div>
      )}

      {/* 오프라인 알림 설정 */}
      {alertSubTab === 'offline' && (
        <div className="max-w-2xl glass-card p-4 md:p-5">
          <h2 className="text-lg font-bold text-gray-800 mb-4">오프라인 감지 알림</h2>
          {configLoading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="skeleton h-12 rounded-xl" />)}</div>
          ) : (
            <>
              {/* ON/OFF */}
              <div className="flex items-center justify-between bg-gray-50 rounded-xl p-4 border border-gray-200 mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">📡</span>
                  <div>
                    <p className="text-sm font-bold text-gray-800">오프라인 알림</p>
                    <p className="text-xs text-gray-500">{offlineConfig.enabled ? '활성 - 농장 미접속 시 알림 생성' : '비활성 - 알림 중지됨'}</p>
                  </div>
                </div>
                <button onClick={() => setOfflineConfig(p => ({ ...p, enabled: !p.enabled }))}
                  className={`relative w-14 h-7 rounded-full transition-all ${offlineConfig.enabled ? 'bg-blue-500' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-all ${offlineConfig.enabled ? 'left-7' : 'left-0.5'}`} />
                </button>
              </div>

              {offlineConfig.enabled && (
                <>
                  <div className="mb-4">
                    <label className="text-sm text-gray-600 font-semibold mb-1 block">경고(WARNING) 기준</label>
                    <p className="text-xs text-gray-400 mb-2">농장이 <span className="text-amber-600 font-bold">{offlineConfig.offlineThresholdMin}분</span> 이상 미접속 시 경고</p>
                    <PresetButtons presets={OFFLINE_THRESHOLD_PRESETS} value={offlineConfig.offlineThresholdMin}
                      onChange={v => setOfflineConfig(p => ({ ...p, offlineThresholdMin: v }))}
                      activeColor="bg-amber-500 text-white border-amber-500" />
                  </div>
                  <div className="mb-4">
                    <label className="text-sm text-gray-600 font-semibold mb-1 block">심각(CRITICAL) 기준</label>
                    <p className="text-xs text-gray-400 mb-2">농장이 <span className="text-red-500 font-bold">{offlineConfig.criticalThresholdMin}분</span> 이상 미접속 시 긴급</p>
                    <PresetButtons presets={OFFLINE_CRITICAL_PRESETS} value={offlineConfig.criticalThresholdMin}
                      onChange={v => setOfflineConfig(p => ({ ...p, criticalThresholdMin: v }))}
                      activeColor="bg-red-500 text-white border-red-500" />
                  </div>
                  <div className="mb-4">
                    <label className="text-sm text-gray-600 font-semibold mb-1 block">중복 알림 방지 (쿨다운)</label>
                    <p className="text-xs text-gray-400 mb-2">같은 농장 <span className="text-orange-500 font-bold">{offlineConfig.cooldownMinutes}분</span> 이내 중복 차단</p>
                    <PresetButtons presets={OFFLINE_COOLDOWN_PRESETS} value={offlineConfig.cooldownMinutes}
                      onChange={v => setOfflineConfig(p => ({ ...p, cooldownMinutes: v }))}
                      activeColor="bg-orange-500 text-white border-orange-500" />
                  </div>
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4">
                    <p className="text-xs text-amber-700"><span className="font-bold">💡 동작:</span> RPi가 {offlineConfig.offlineThresholdMin}분간 데이터를 보내지 않으면 WARNING, {offlineConfig.criticalThresholdMin}분 이상이면 CRITICAL 알림이 생성됩니다.</p>
                  </div>
                </>
              )}
              <button onClick={() => saveConfig('offline')} disabled={!offlineDirty || saving}
                className={`w-full py-2.5 rounded-xl text-base font-bold transition-all active:scale-[0.97] ${
                  offlineDirty ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700' : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-default'
                }`}>{saving ? '저장 중...' : offlineDirty ? '💾 설정 저장' : '저장 완료'}</button>
            </>
          )}
        </div>
      )}

      {/* 서버 연결 설정 */}
      {alertSubTab === 'server' && !farmLocal && (
        <div className="max-w-2xl glass-card p-4 md:p-5">
          <h2 className="text-lg font-bold text-gray-800 mb-4">서버 연결 경고 설정</h2>

          {/* 서버 연결 타임아웃 */}
          <div className="mb-4">
            <label className="text-sm text-gray-600 font-semibold mb-1.5 block">서버 연결 타임아웃</label>
            <p className="text-xs text-gray-400 mb-3">
              서버 연결이 <span className="text-red-500 font-bold">{formatTimeSec(timeoutSec)}</span> 이상 끊기면 대시보드에 경고 알림을 표시합니다
            </p>
            <div className="flex flex-wrap gap-2 mb-2">
              {TIMEOUT_PRESETS.map(preset => (
                <button key={preset.value} onClick={() => handleTimeoutChange(preset.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                    timeoutSec === preset.value ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                  }`}>{preset.label}</button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <input type="number" value={timeoutSec} onChange={(e) => { const val = parseInt(e.target.value); if (!isNaN(val)) handleTimeoutChange(val); }}
                className="input-field w-28" min="30" max="1800" />
              <span className="text-sm text-gray-500">초 (30~1800)</span>
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              {TIMEOUT_PRESETS.find(p => p.value === timeoutSec)?.desc || `${formatTimeSec(timeoutSec)} 간격`}{' · '}헬스체크 주기 10초
            </p>
          </div>

          {/* 대시보드 폴링 주기 */}
          <div className="mb-4">
            <label className="text-sm text-gray-600 font-semibold mb-1.5 block">대시보드 데이터 갱신 주기</label>
            <p className="text-xs text-gray-400 mb-3">
              대시보드가 <span className="text-blue-500 font-bold">{formatTimeSec(pollingSec)}</span>마다 서버에서 최신 센서 데이터를 가져옵니다
            </p>
            <div className="flex flex-wrap gap-2 mb-2">
              {POLLING_PRESETS.map(preset => (
                <button key={preset.value} onClick={() => handlePollingChange(preset.value)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                    pollingSec === preset.value ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                  }`}>{preset.label}</button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <input type="number" value={pollingSec} onChange={(e) => { const val = parseInt(e.target.value); if (!isNaN(val)) handlePollingChange(val); }}
                className="input-field w-28" min="3" max="300" />
              <span className="text-sm text-gray-500">초 (3~300)</span>
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              {POLLING_PRESETS.find(p => p.value === pollingSec)?.desc || `${formatTimeSec(pollingSec)} 간격`}{' · '}짧을수록 실시간 반영, 길수록 네트워크 부하 감소
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
          <button onClick={saveServerSettings} disabled={serverSaved}
            className={`w-full py-2.5 rounded-xl text-base font-bold transition-all active:scale-[0.97] ${
              !serverSaved ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700' : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-default'
            }`}>{!serverSaved ? '💾 설정 저장' : '저장 완료'}</button>
        </div>
      )}

      {alertSubTab === 'server' && farmLocal && (
        <div className="max-w-2xl glass-card p-8 text-center">
          <div className="text-4xl mb-4 opacity-30">🖥️</div>
          <p className="text-gray-400 text-base">팜로컬 모드에서는 서버 연결 설정을 사용하지 않습니다</p>
        </div>
      )}

      {/* 유지보수 만료 알림 설정 */}
      {alertSubTab === 'maintenance' && (
        <div className="max-w-2xl glass-card p-4 md:p-5">
          <h2 className="text-lg font-bold text-gray-800 mb-4">유지보수 만료 알림</h2>
          {configLoading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="skeleton h-12 rounded-xl" />)}</div>
          ) : (
            <>
              {/* ON/OFF */}
              <div className="flex items-center justify-between bg-gray-50 rounded-xl p-4 border border-gray-200 mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🔧</span>
                  <div>
                    <p className="text-sm font-bold text-gray-800">유지보수 만료 알림</p>
                    <p className="text-xs text-gray-500">{maintenanceConfig.enabled ? '활성 - 계약 만료 전 알림 생성' : '비활성 - 알림 중지됨'}</p>
                  </div>
                </div>
                <button onClick={() => setMaintenanceConfig(p => ({ ...p, enabled: !p.enabled }))}
                  className={`relative w-14 h-7 rounded-full transition-all ${maintenanceConfig.enabled ? 'bg-blue-500' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-all ${maintenanceConfig.enabled ? 'left-7' : 'left-0.5'}`} />
                </button>
              </div>

              {maintenanceConfig.enabled && (
                <>
                  <div className="mb-4">
                    <label className="text-sm text-gray-600 font-semibold mb-1 block">알림 발송일</label>
                    <p className="text-xs text-gray-400 mb-2">유지보수 만료 전 알림을 보낼 시점을 선택하세요</p>
                    <div className="flex flex-wrap gap-2">
                      {MAINTENANCE_DAY_OPTIONS.map(opt => {
                        const isSelected = maintenanceConfig.alertDays.includes(opt.value);
                        return (
                          <button key={opt.value}
                            onClick={() => {
                              setMaintenanceConfig(p => ({
                                ...p,
                                alertDays: isSelected
                                  ? p.alertDays.filter(d => d !== opt.value)
                                  : [...p.alertDays, opt.value].sort((a, b) => b - a)
                              }));
                            }}
                            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-all border ${
                              isSelected
                                ? (opt.value === 0 ? 'bg-red-500 text-white border-red-500' : opt.value <= 7 ? 'bg-amber-500 text-white border-amber-500' : 'bg-blue-600 text-white border-blue-600') + ' shadow-sm'
                                : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:bg-blue-50'
                            }`}>
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="bg-violet-50 border border-violet-200 rounded-xl p-3 mb-4">
                    <p className="text-xs text-violet-700">
                      <span className="font-bold">💡 동작:</span> 매일 오전 9시에 유지보수 만료일 체크 →
                      {maintenanceConfig.alertDays.length > 0
                        ? ` ${maintenanceConfig.alertDays.map(d => d === 0 ? 'D-Day' : `D-${d}`).join(', ')}에 알림`
                        : ' 선택된 알림일이 없습니다'}
                    </p>
                  </div>
                </>
              )}
              <button onClick={() => saveConfig('maintenance')} disabled={!maintenanceDirty || saving}
                className={`w-full py-2.5 rounded-xl text-base font-bold transition-all active:scale-[0.97] ${
                  maintenanceDirty ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700' : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-default'
                }`}>{saving ? '저장 중...' : maintenanceDirty ? '💾 설정 저장' : '저장 완료'}</button>
            </>
          )}
        </div>
      )}

      {alertSubTab === 'deviceFailure' && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 md:p-6">
          {configLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-8 h-8 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <p className="text-base font-bold text-gray-800">장비 고장 감지</p>
                  <p className="text-xs text-gray-500">{deviceFailureConfig.enabled ? '활성 - 제어 연속 실패 시 알림 생성' : '비활성 - 알림 중지됨'}</p>
                </div>
                <button onClick={() => setDeviceFailureConfig(prev => ({ ...prev, enabled: !prev.enabled }))}
                  className={`relative w-14 h-7 rounded-full transition-all ${deviceFailureConfig.enabled ? 'bg-blue-500' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-all ${deviceFailureConfig.enabled ? 'left-7' : 'left-0.5'}`} />
                </button>
              </div>
              {deviceFailureConfig.enabled && (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-semibold text-gray-700 mb-1">관찰 시간 (분)</p>
                    <p className="text-xs text-gray-400 mb-2">최근 <span className="text-blue-600 font-bold">{deviceFailureConfig.observationWindowMinutes}분</span> 동안의 제어 실패를 분석</p>
                    <PresetButtons presets={[{ value: 15, label: '15분' }, { value: 30, label: '30분' }, { value: 60, label: '1시간' }, { value: 120, label: '2시간' }]} value={deviceFailureConfig.observationWindowMinutes}
                      onChange={(v) => setDeviceFailureConfig(prev => ({ ...prev, observationWindowMinutes: v }))} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700 mb-1">실패 횟수 기준</p>
                    <p className="text-xs text-gray-400 mb-2">같은 장비가 <span className="text-red-500 font-bold">{deviceFailureConfig.controlFailureThreshold}회</span> 이상 실패하면 알림</p>
                    <PresetButtons presets={[{ value: 2, label: '2회' }, { value: 3, label: '3회' }, { value: 5, label: '5회' }, { value: 10, label: '10회' }]} value={deviceFailureConfig.controlFailureThreshold}
                      onChange={(v) => setDeviceFailureConfig(prev => ({ ...prev, controlFailureThreshold: v }))} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700 mb-1">중복 방지 (분)</p>
                    <p className="text-xs text-gray-400 mb-2">같은 장비 <span className="text-orange-500 font-bold">{deviceFailureConfig.cooldownMinutes}분</span> 이내 중복 차단</p>
                    <PresetButtons presets={[{ value: 30, label: '30분' }, { value: 60, label: '1시간' }, { value: 120, label: '2시간' }, { value: 240, label: '4시간' }]} value={deviceFailureConfig.cooldownMinutes}
                      onChange={(v) => setDeviceFailureConfig(prev => ({ ...prev, cooldownMinutes: v }))} />
                  </div>
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                    <p className="text-xs text-red-700"><span className="font-bold">💡 동작:</span> {deviceFailureConfig.observationWindowMinutes}분 동안 같은 장비가 {deviceFailureConfig.controlFailureThreshold}회 이상 제어 실패하면 DEVICE_FAILURE 알림을 생성합니다. {deviceFailureConfig.controlFailureThreshold * 2}회 이상이면 CRITICAL로 격상됩니다.</p>
                  </div>
                </div>
              )}
              <button onClick={() => saveConfig('deviceFailure')} disabled={!deviceFailureDirty || saving}
                className={`w-full py-2.5 mt-4 rounded-xl text-base font-bold transition-all active:scale-[0.97] ${
                  deviceFailureDirty ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20 hover:bg-blue-700' : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-default'
                }`}>{saving ? '저장 중...' : deviceFailureDirty ? '💾 설정 저장' : '저장 완료'}</button>
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
