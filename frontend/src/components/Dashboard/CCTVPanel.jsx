import { useState, useEffect, useCallback } from 'react';
import { getRpiApiBase } from '../../services/apiSwitcher';

export default function CCTVPanel({ farmId }) {
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCam, setSelectedCam] = useState(null);
  const [volume, setVolume] = useState(0);
  const [isMuted, setIsMuted] = useState(true);
  const [iframeReady, setIframeReady] = useState(false);

  // 마운트 후 iframe 렌더링 지연 (sandbox 적용 보장)
  useEffect(() => {
    setIframeReady(false);
    const t = setTimeout(() => setIframeReady(true), 100);
    return () => clearTimeout(t);
  }, [selectedCam]);

  const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';
  const getToken = () => localStorage.getItem('accessToken');
  const rpiBase = getRpiApiBase();
  const isLocal = rpiBase && (rpiBase.includes('192.168.') || rpiBase.includes('localhost'));
  const go2rtcBase = isLocal
    ? rpiBase.replace(/\/api\/?$/, '').replace(/:1880$/, ':1984')
    : 'https://cctv.smartgreen.kr';

  // 로컬: WebRTC (빠름), 외부: MSE (Tunnel 호환)
  const getStreamUrl = (camId) => {
    const mode = isLocal ? 'webrtc' : 'mse';
    return `${go2rtcBase}/stream.html?src=${camId}&mode=${mode}&media=video`;
  };

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

  const toggleMute = () => {
    setIsMuted(prev => {
      const next = !prev;
      if (next) setVolume(0); else if (volume === 0) setVolume(50);
      return next;
    });
  };

  // 메인 비디오 볼륨 동기화
  useEffect(() => {
    const videos = document.querySelectorAll('video[data-main]');
    videos.forEach(v => {
      v.muted = isMuted;
      v.volume = volume / 100;
    });
  }, [volume, isMuted]);

  const onlineCams = cameras.filter(c => c.enabled);
  const offlineCams = cameras.filter(c => !c.enabled);

  // 카메라 1대면 자동 선택
  useEffect(() => {
    if (onlineCams.length > 0 && !selectedCam) setSelectedCam(onlineCams[0]);
  }, [cameras]);

  if (loading) return <div className="px-4 py-4"><div className="skeleton h-96 rounded-2xl" /></div>;

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6">
      {/* 헤더 */}
      <div style={{ background: '#111827', borderRadius: 16, padding: '16px 24px', marginBottom: 16 }}
        className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
        <div>
          <h2 style={{ color: '#fff', fontSize: 18, fontWeight: 800, margin: 0 }}>CCTV 모니터링</h2>
          <p style={{ color: '#9ca3af', fontSize: 13, margin: '4px 0 0' }}>하우스 내 설치된 CCTV 실시간 영상을 확인합니다</p>
        </div>
        <div className="flex gap-2">
          <span style={{ padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: '#065f4620', color: '#34d399', border: '1px solid #34d39940' }}>
            {onlineCams.length}대 온라인
          </span>
          {offlineCams.length > 0 && (
            <span style={{ padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, background: '#7f1d1d20', color: '#f87171', border: '1px solid #f8717140' }}>
              {offlineCams.length}대 오프라인
            </span>
          )}
        </div>
      </div>

      {/* 카메라 없을 때 */}
      {cameras.length === 0 && (
        <div style={{ background: '#111827', borderRadius: 16, padding: '60px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, opacity: 0.3, marginBottom: 12 }}>📹</div>
          <p style={{ color: '#6b7280', fontWeight: 600 }}>등록된 카메라가 없습니다</p>
          <p style={{ color: '#4b5563', fontSize: 13, marginTop: 4 }}>설정 → 카메라 탭에서 CCTV를 등록하세요</p>
        </div>
      )}

      {/* 메인 영상 (선택된 카메라) */}
      {selectedCam && (
        <div style={{ background: '#111827', borderRadius: 16, overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ position: 'relative' }}>
            <div style={{
              position: 'absolute', top: 16, left: 16, zIndex: 10,
              padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 700,
              background: '#dc2626', color: '#fff', display: 'flex', alignItems: 'center', gap: 5
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', animation: 'cctvPulse 1.5s infinite' }} />
              LIVE
            </div>
            <div style={{ position: 'relative', width: '100%', paddingTop: '56.25%', background: '#000' }}>
              {iframeReady ? (
                <iframe
                  src={getStreamUrl(selectedCam.camId)}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none', display: 'block' }}
                  allow=""
                  sandbox="allow-scripts allow-same-origin"
                />
              ) : (
                <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>연결 중...</div>
              )}
            </div>
          </div>
          <div style={{
            padding: '8px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: '#1f2937', gap: 8
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
              <span style={{ color: '#fff', fontSize: 14, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedCam.name}</span>
              <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 600, background: '#065f4630', color: '#34d399', whiteSpace: 'nowrap', flexShrink: 0 }}>온라인</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <button onClick={toggleMute}
                style={{ padding: '6px 8px', borderRadius: 8, fontSize: 14, background: '#374151', color: '#d1d5db', border: 'none', cursor: 'pointer' }}>
                {isMuted ? '🔇' : '🔊'}
              </button>
              <button onClick={() => setSelectedCam(null)}
                style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: '#374151', color: '#d1d5db', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                ✕
              </button>
              <button onClick={() => window.open(getStreamUrl(selectedCam.camId), '_blank')}
                style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                ⛶
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 카메라 그리드 + 현황 요약 통합 */}
      {cameras.length > 1 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 10, marginBottom: 12,
        }}>
          {cameras.map(cam => {
            const isSelected = selectedCam?.camId === cam.camId;
            return (
              <div key={cam.id}
                onClick={() => cam.enabled && setSelectedCam(cam)}
                style={{
                  position: 'relative', borderRadius: 12, overflow: 'hidden',
                  border: isSelected ? '2px solid #34d399' : '2px solid #1f2937',
                  cursor: cam.enabled ? 'pointer' : 'default',
                  opacity: cam.enabled ? 1 : 0.5, transition: 'all 0.2s',
                  background: '#0f172a', paddingTop: '56.25%',
                }}>
                {cam.enabled && iframeReady ? (
                  <iframe
                    src={getStreamUrl(cam.camId)}
                    style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 'none', pointerEvents: 'none', display: 'block' }}
                    allow=""
                    sandbox="allow-scripts allow-same-origin"
                  />
                ) : (
                  <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151', fontSize: 13 }}>
                    {cam.enabled ? '연결 중...' : '오프라인'}
                  </div>
                )}
                {/* LIVE 뱃지 — 영상 위 좌상단 */}
                <div style={{
                  position: 'absolute', top: 6, left: 6,
                  padding: '2px 8px', borderRadius: 10, fontSize: 9, fontWeight: 700,
                  background: cam.enabled ? '#059669' : '#4b5563', color: '#fff',
                  display: 'flex', alignItems: 'center', gap: 3
                }}>
                  {cam.enabled && <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#fff', animation: 'cctvPulse 1.5s infinite' }} />}
                  {cam.enabled ? 'LIVE' : 'OFF'}
                </div>
                {/* 카메라 이름 — 영상 위 하단 오버레이 */}
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0,
                  padding: '14px 8px 5px',
                  background: 'linear-gradient(transparent, rgba(0,0,0,0.7))',
                }}>
                  <div style={{ color: '#fff', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cam.name}</div>
                  <div style={{ color: '#9ca3af', fontSize: 9 }}>{cam.location || ''}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CCTV 현황 — 한 줄 요약 */}
      {cameras.length > 0 && (
        <div style={{ background: '#111827', borderRadius: 12, padding: '10px 16px', display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <span style={{ color: '#60a5fa', fontSize: 20, fontWeight: 800 }}>{cameras.length}</span>
            <span style={{ color: '#6b7280', fontSize: 11, marginLeft: 4 }}>전체</span>
          </div>
          <div style={{ width: 1, height: 20, background: '#374151' }} />
          <div style={{ textAlign: 'center' }}>
            <span style={{ color: '#34d399', fontSize: 20, fontWeight: 800 }}>{onlineCams.length}</span>
            <span style={{ color: '#6b7280', fontSize: 11, marginLeft: 4 }}>온라인</span>
          </div>
          <div style={{ width: 1, height: 20, background: '#374151' }} />
          <div style={{ textAlign: 'center' }}>
            <span style={{ color: '#6b7280', fontSize: 20, fontWeight: 800 }}>{offlineCams.length}</span>
            <span style={{ color: '#6b7280', fontSize: 11, marginLeft: 4 }}>오프라인</span>
          </div>
        </div>
      )}

      <style>{`
        @keyframes cctvPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
