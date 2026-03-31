import { useState, useEffect, useCallback, useRef } from 'react';
import { getRpiApiBase } from '../../services/apiSwitcher';

export default function CCTVPanel({ farmId }) {
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCam, setSelectedCam] = useState(null);
  const mainVideoRef = useRef(null);

  const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';
  const getToken = () => localStorage.getItem('accessToken');
  const rpiBase = getRpiApiBase();
  const isLocal = rpiBase && (rpiBase.includes('192.168.') || rpiBase.includes('localhost'));
  const go2rtcBase = isLocal
    ? rpiBase.replace(/\/api\/?$/, '').replace(/:1880$/, ':1984')
    : 'https://cctv.smartgreen.kr';

  // 로컬: WebRTC (iframe), 외부: mp4 직접 스트리밍 (video 태그)
  const getStreamUrl = (camId) => {
    if (isLocal) {
      return `${go2rtcBase}/stream.html?src=${camId}&mode=webrtc&media=video`;
    }
    return `${go2rtcBase}/api/stream.mp4?src=${camId}`;
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

  const onlineCams = cameras.filter(c => c.enabled);
  const offlineCams = cameras.filter(c => !c.enabled);

  // 카메라 1대면 자동 선택
  useEffect(() => {
    if (onlineCams.length > 0 && !selectedCam) setSelectedCam(onlineCams[0]);
  }, [cameras]);

  // 메인 비디오 재생 보장
  useEffect(() => {
    if (mainVideoRef.current) {
      mainVideoRef.current.play().catch(() => {});
    }
  }, [selectedCam]);

  const renderStream = (camId, style, isMain = false) => {
    if (isLocal) {
      // 로컬: WebRTC iframe
      return (
        <iframe
          src={getStreamUrl(camId)}
          style={{ ...style, border: 'none', display: 'block' }}
          allow="autoplay"
          sandbox="allow-scripts allow-same-origin"
        />
      );
    }
    // 외부: mp4 직접 스트리밍 (muted 확실 적용)
    return (
      <video
        ref={isMain ? mainVideoRef : null}
        src={getStreamUrl(camId)}
        style={{ ...style, display: 'block', objectFit: 'contain', background: '#000' }}
        muted
        autoPlay
        playsInline
      />
    );
  };

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
            {renderStream(selectedCam.camId, { width: '100%', height: 'min(560px, 55vh)' }, true)}
          </div>
          <div style={{
            padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: '#1f2937', flexWrap: 'wrap', gap: 8
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>{selectedCam.name}</span>
              <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: '#065f4630', color: '#34d399' }}>온라인</span>
              <span style={{ color: '#6b7280', fontSize: 12 }}>{selectedCam.location}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button onClick={() => setSelectedCam(null)}
                style={{ padding: '6px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: '#374151', color: '#d1d5db', border: 'none', cursor: 'pointer' }}>
                닫기
              </button>
              <button onClick={() => window.open(getStreamUrl(selectedCam.camId), '_blank')}
                style={{ padding: '6px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer' }}>
                전체화면
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 카메라 그리드 (2대 이상일 때만 표시) */}
      {cameras.length > 1 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.min(cameras.length, 4)}, 1fr)`,
          gap: 12, marginBottom: 16,
        }}>
          {cameras.map(cam => {
            const isSelected = selectedCam?.camId === cam.camId;
            return (
              <div key={cam.id}
                onClick={() => cam.enabled && setSelectedCam(cam)}
                style={{
                  background: '#111827', borderRadius: 12, overflow: 'hidden',
                  border: isSelected ? '2px solid #34d399' : '2px solid #1f2937',
                  cursor: cam.enabled ? 'pointer' : 'default',
                  opacity: cam.enabled ? 1 : 0.5, transition: 'all 0.2s',
                }}>
                <div style={{ position: 'relative', aspectRatio: '16/9', background: '#0f172a' }}>
                  {cam.enabled ? renderStream(cam.camId, { width: '100%', height: '100%', pointerEvents: 'none' }) : (
                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151', fontSize: 13 }}>
                      오프라인
                    </div>
                  )}
                  <div style={{
                    position: 'absolute', top: 8, left: 8,
                    padding: '3px 10px', borderRadius: 12, fontSize: 10, fontWeight: 700,
                    background: cam.enabled ? '#059669' : '#4b5563', color: '#fff',
                    display: 'flex', alignItems: 'center', gap: 4
                  }}>
                    {cam.enabled && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff' }} />}
                    {cam.enabled ? 'LIVE' : 'OFFLINE'}
                  </div>
                </div>
                <div style={{ padding: '10px 14px', background: '#1f2937', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ color: '#f3f4f6', fontSize: 13, fontWeight: 700 }}>{cam.name}</div>
                    <div style={{ color: '#6b7280', fontSize: 11 }}>{cam.location || '-'}</div>
                  </div>
                  {cam.enabled && (
                    <button onClick={(e) => { e.stopPropagation(); setSelectedCam(cam); }}
                      style={{ padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: '#374151', color: '#d1d5db', border: 'none', cursor: 'pointer' }}>
                      확대
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CCTV 현황 요약 */}
      {cameras.length > 0 && (
        <div style={{ background: '#111827', borderRadius: 16, padding: '20px 24px' }}>
          <h3 style={{ color: '#9ca3af', fontSize: 13, fontWeight: 700, margin: '0 0 16px' }}>CCTV 현황 요약</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, textAlign: 'center' }}>
            <div>
              <div style={{ color: '#60a5fa', fontSize: 28, fontWeight: 800 }}>{cameras.length}</div>
              <div style={{ color: '#6b7280', fontSize: 12 }}>전체 카메라</div>
            </div>
            <div>
              <div style={{ color: '#34d399', fontSize: 28, fontWeight: 800 }}>{onlineCams.length}</div>
              <div style={{ color: '#6b7280', fontSize: 12 }}>온라인</div>
            </div>
            <div>
              <div style={{ color: '#f87171', fontSize: 28, fontWeight: 800 }}>0</div>
              <div style={{ color: '#6b7280', fontSize: 12 }}>녹화중</div>
            </div>
            <div>
              <div style={{ color: '#6b7280', fontSize: 28, fontWeight: 800 }}>{offlineCams.length}</div>
              <div style={{ color: '#6b7280', fontSize: 12 }}>오프라인</div>
            </div>
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
