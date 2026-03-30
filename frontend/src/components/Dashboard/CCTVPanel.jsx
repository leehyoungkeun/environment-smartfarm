import React, { useState, useEffect, useCallback } from 'react';
import { getRpiApiBase } from '../../services/apiSwitcher';

export default function CCTVPanel({ farmId }) {
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCam, setSelectedCam] = useState(null);

  const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';
  const getToken = () => localStorage.getItem('accessToken');
  const rpiBase = getRpiApiBase();
  const go2rtcBase = rpiBase ? rpiBase.replace(/\/api\/?$/, '').replace(/:1880$/, ':1984') : null;

  const getStreamUrl = (camId) => go2rtcBase ? `${go2rtcBase}/stream.html?src=${camId}&mode=webrtc` : null;

  const fetchCameras = useCallback(async () => {
    try {
      const res = await fetch(`${API}/cameras/${farmId}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      const data = await res.json();
      if (data.success) setCameras(data.data);
    } catch {}
    setLoading(false);
  }, [farmId]);

  useEffect(() => { fetchCameras(); }, [fetchCameras]);

  const onlineCams = cameras.filter(c => c.enabled);
  const offlineCams = cameras.filter(c => !c.enabled);

  if (loading) return <div className="max-w-7xl mx-auto px-4 md:px-6 py-4"><div className="skeleton h-96 rounded-2xl" /></div>;

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6">
      {/* 헤더 */}
      <div className="glass-card p-4 md:p-5 mb-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <div>
            <h2 className="text-lg md:text-xl font-bold text-gray-800">CCTV 모니터링</h2>
            <p className="text-gray-500 text-xs md:text-sm mt-0.5">하우스 내 설치된 CCTV 실시간 영상을 확인합니다</p>
          </div>
          <div className="flex gap-2">
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-600 border border-emerald-200">
              {onlineCams.length}대 온라인
            </span>
            {offlineCams.length > 0 && (
              <span className="px-3 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-500 border border-gray-200">
                {offlineCams.length}대 오프라인
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 카메라 없을 때 */}
      {cameras.length === 0 && (
        <div className="glass-card p-12 text-center">
          <div className="text-5xl mb-3 opacity-40">📹</div>
          <p className="text-gray-500 font-semibold">등록된 카메라가 없습니다</p>
          <p className="text-gray-400 text-sm mt-1">설정 → 카메라 탭에서 CCTV를 등록하세요</p>
        </div>
      )}

      {/* 메인 영상 (선택된 카메라) */}
      {selectedCam && (
        <div className="glass-card mb-4 overflow-hidden" style={{ border: '2px solid #3b82f6' }}>
          <div className="relative" style={{ background: '#1a1a2e' }}>
            <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold text-white bg-red-500">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              LIVE
            </div>
            {getStreamUrl(selectedCam.camId) ? (
              <iframe
                src={getStreamUrl(selectedCam.camId)}
                className="w-full border-none"
                style={{ height: 'min(500px, 50vh)' }}
                allow="autoplay"
              />
            ) : (
              <div className="flex items-center justify-center text-gray-400" style={{ height: 400 }}>
                스트림 연결 불가
              </div>
            )}
          </div>
          <div className="p-3 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 bg-gray-50 border-t border-gray-200">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-800">📹 {selectedCam.name}</span>
              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700">온라인</span>
              <span className="text-xs text-gray-400">{selectedCam.location}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setSelectedCam(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gray-200 text-gray-600 hover:bg-gray-300 transition-colors">
                닫기
              </button>
              <button onClick={() => window.open(getStreamUrl(selectedCam.camId), '_blank')}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-500 text-white hover:bg-blue-600 transition-colors">
                전체화면
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 카메라 그리드 */}
      {cameras.length > 0 && (
        <div className={`grid gap-3 md:gap-4 mb-4 ${cameras.length <= 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
          {cameras.map(cam => {
            const isSelected = selectedCam?.camId === cam.camId;
            return (
              <div key={cam.id}
                onClick={() => cam.enabled && setSelectedCam(cam)}
                className="glass-card overflow-hidden transition-all"
                style={{
                  border: isSelected ? '2px solid #3b82f6' : '2px solid transparent',
                  cursor: cam.enabled ? 'pointer' : 'default',
                  opacity: cam.enabled ? 1 : 0.5,
                }}>
                <div className="relative" style={{ background: '#f1f5f9' }}>
                  {cam.enabled && getStreamUrl(cam.camId) ? (
                    <iframe
                      src={getStreamUrl(cam.camId)}
                      className="w-full border-none pointer-events-none"
                      style={{ height: 140 }}
                      allow="autoplay"
                    />
                  ) : (
                    <div className="flex items-center justify-center text-gray-400 text-xs" style={{ height: 140 }}>
                      {cam.enabled ? '연결 중...' : '오프라인'}
                    </div>
                  )}
                  <div className={`absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold text-white ${cam.enabled ? 'bg-emerald-500' : 'bg-gray-400'}`}>
                    {cam.enabled && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                    {cam.enabled ? 'LIVE' : 'OFFLINE'}
                  </div>
                </div>
                <div className="p-2.5 flex justify-between items-center">
                  <div>
                    <div className="text-xs font-bold text-gray-800">{cam.name}</div>
                    <div className="text-[10px] text-gray-400">{cam.location || '-'}</div>
                  </div>
                  <span className="text-gray-300 text-sm">📹</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CCTV 현황 요약 */}
      {cameras.length > 0 && (
        <div className="glass-card p-4 md:p-5">
          <h3 className="text-sm font-bold text-gray-600 mb-3">CCTV 현황 요약</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div>
              <div className="text-2xl font-extrabold text-blue-500">{cameras.length}</div>
              <div className="text-xs text-gray-500">전체 카메라</div>
            </div>
            <div>
              <div className="text-2xl font-extrabold text-emerald-500">{onlineCams.length}</div>
              <div className="text-xs text-gray-500">온라인</div>
            </div>
            <div>
              <div className="text-2xl font-extrabold text-red-400">0</div>
              <div className="text-xs text-gray-500">녹화중</div>
            </div>
            <div>
              <div className="text-2xl font-extrabold text-gray-400">{offlineCams.length}</div>
              <div className="text-xs text-gray-500">오프라인</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
