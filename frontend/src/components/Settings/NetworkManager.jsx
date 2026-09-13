import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';

// ━━━ 설정 › 네트워크 (2026-09-13) ━━━
// 농장을 옮길 때 새 WiFi 를 잡으려면 Ctrl+Alt+Del 로 키오스크를 빠져나와 키보드로 입력해야 했다.
// 터치만으로 되게 한다 — 목록에서 탭 → 화면 키보드로 비밀번호 → 연결.
//
// 경로: 같은 출처(nginx) `/api/system/wifi*` → RPi system-api(3100) → nmcli.
//   포트(3100)를 직접 부르지 않는다 — 서비스에 루프백 가드가 있어 패널에서만 동작하고,
//   같은 출처라 CORS 도 필요 없다. 패널이 아닌 곳에서 열면 403 이 오고 그대로 안내한다.

const SIGNAL_BARS = (s) => (s >= 75 ? '▂▄▆█' : s >= 50 ? '▂▄▆_' : s >= 25 ? '▂▄__' : '▂___');

export const NetworkManager = () => {
  const [status, setStatus] = useState(null);      // { connected, saved, ip }
  const [networks, setNetworks] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [target, setTarget] = useState(null);      // 비밀번호 입력 중인 네트워크
  const [password, setPassword] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState(null);    // { type, text }
  const [blocked, setBlocked] = useState(false);   // 패널이 아닌 곳에서 열었을 때
  const keyboardRef = useRef(null);

  const loadStatus = useCallback(async () => {
    try {
      const r = await axios.get('/api/system/wifi', { timeout: 10000 });
      setStatus(r.data);
      setBlocked(false);
    } catch (e) {
      if (e.response?.status === 403) setBlocked(true);
      else setMessage({ type: 'err', text: '네트워크 상태를 읽지 못했습니다: ' + (e.response?.data?.error || e.message) });
    }
  }, []);

  const scan = useCallback(async () => {
    setScanning(true);
    setMessage(null);
    try {
      const r = await axios.get('/api/system/wifi/scan', { timeout: 30000 });
      if (r.data?.success) {
        const list = r.data.networks || [];
        setNetworks(list);
        if (!list.length) setMessage({ type: 'warn', text: '주변에 잡히는 WiFi 가 없습니다. 공유기와 가까운 곳에서 다시 찾아보세요.' });
      } else {
        setMessage({ type: 'err', text: r.data?.error || '검색 실패' });
      }
    } catch (e) {
      if (e.response?.status === 403) setBlocked(true);
      else setMessage({ type: 'err', text: '검색 실패: ' + (e.response?.data?.error || e.message) });
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => { loadStatus(); scan(); }, [loadStatus, scan]);

  const connect = async () => {
    if (!target) return;
    if (target.secured && password.length < 8) {
      setMessage({ type: 'warn', text: '비밀번호는 8자 이상입니다' });
      return;
    }
    setConnecting(true);
    setMessage(null);
    try {
      const r = await axios.post('/api/system/wifi/connect',
        { ssid: target.ssid, password: target.secured ? password : '' },
        { timeout: 60000 });
      if (r.data?.success) {
        setMessage({ type: 'ok', text: target.ssid + ' 에 연결되었습니다. 새 주소 ' + (r.data.ip || '-') });
        setTarget(null);
        setPassword('');
        await loadStatus();
        scan();
      } else {
        setMessage({ type: 'err', text: '연결하지 못했습니다 — ' + (r.data?.error || '비밀번호를 확인하세요') });
      }
    } catch (e) {
      setMessage({ type: 'err', text: '연결 요청 실패: ' + (e.response?.data?.error || e.message) });
    } finally {
      setConnecting(false);
    }
  };

  const onKeyPress = (button) => {
    if (button === '{bksp}') { setPassword((p) => p.slice(0, -1)); return; }
    if (button === '{space}') { setPassword((p) => p + ' '); return; }
    if (button === '{clear}') { setPassword(''); keyboardRef.current?.setInput(''); return; }
    if (button === '{enter}') { connect(); return; }
    setPassword((p) => p + button);
  };

  if (blocked) {
    return (
      <div className="card p-6 text-center space-y-2">
        <p className="text-lg font-bold text-gray-800">WiFi 설정은 제어기 패널에서만 가능합니다</p>
        <p className="text-sm text-gray-500">다른 기기에서 무선을 바꿔 제어기가 고립되는 것을 막기 위한 제한입니다. 농장에 설치된 터치 화면에서 열어 주세요.</p>
      </div>
    );
  }

  const msgClass = message?.type === 'ok' ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
    : message?.type === 'warn' ? 'bg-amber-50 border-amber-300 text-amber-800'
    : 'bg-rose-50 border-rose-300 text-rose-700';

  return (
    <div className="space-y-4 animate-fade-in-up">
      {/* 현재 연결 */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-base font-bold text-gray-800">📶 현재 연결</h3>
          {status?.connected
            ? (
              <span className="inline-flex items-center gap-2 text-base font-bold text-emerald-700">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />{status.connected.ssid}
              </span>
            )
            : <span className="text-base font-bold text-rose-700">연결 안 됨</span>}
          {status?.ip && <span className="text-sm text-gray-500">주소 <b className="font-mono text-gray-700">{status.ip}</b></span>}
          <button onClick={() => { loadStatus(); scan(); }} disabled={scanning}
            className="ml-auto btn-primary text-sm px-4 py-2">
            {scanning ? '찾는 중…' : '🔄 다시 찾기'}
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          농장을 옮겼다면 아래 목록에서 새 WiFi 를 골라 연결하세요. 연결에 실패해도 원래 쓰던 WiFi 로 자동 복귀합니다.
        </p>
      </div>

      {message && <p className={'text-base font-semibold rounded-md p-3 border ' + msgClass}>{message.text}</p>}

      {/* 비밀번호 입력 */}
      {target && (
        <div className="card p-4 border-2 border-blue-300">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <span className="text-base font-bold text-gray-900">{target.ssid}</span>
            {target.secured
              ? <span className="text-xs text-gray-500">🔒 비밀번호 필요</span>
              : <span className="text-xs text-gray-500">공개 네트워크</span>}
            <button onClick={() => { setTarget(null); setPassword(''); }}
              className="ml-auto text-sm text-gray-500 hover:underline">취소</button>
          </div>
          {target.secured && (
            <>
              <input type="text" value={password} readOnly placeholder="아래 키보드로 입력하세요"
                className="input-field text-lg w-full text-center tracking-widest mb-2" />
              <Keyboard
                keyboardRef={(r) => { keyboardRef.current = r; }}
                onKeyPress={onKeyPress}
                layout={{
                  default: [
                    '1 2 3 4 5 6 7 8 9 0',
                    'q w e r t y u i o p',
                    'a s d f g h j k l',
                    'z x c v b n m - _',
                    '@ . ! # $ % & * + =',
                    '{clear} {space} {bksp} {enter}',
                  ],
                }}
                display={{ '{bksp}': '⌫ 지움', '{space}': '공백', '{clear}': '전체삭제', '{enter}': '연결' }}
              />
            </>
          )}
          <button onClick={connect} disabled={connecting}
            className="btn-primary w-full text-base py-3 mt-3">
            {connecting ? '연결 중… (최대 45초)' : '🔗 ' + target.ssid + ' 에 연결'}
          </button>
        </div>
      )}

      {/* 주변 WiFi */}
      <div className="card p-4">
        <p className="text-base font-bold text-gray-800 mb-2">
          주변 WiFi {networks.length > 0 && <span className="text-sm text-gray-500 font-normal">{networks.length}개</span>}
        </p>
        {networks.length === 0 && !scanning && (
          <p className="text-sm text-gray-500">목록이 비었습니다. 「다시 찾기」를 눌러 주세요.</p>
        )}
        <div className="divide-y divide-gray-100">
          {networks.map((n) => {
            const known = status?.saved?.includes(n.ssid);
            return (
              <button key={n.ssid}
                onClick={() => { setTarget(n); setPassword(''); keyboardRef.current?.setInput(''); setMessage(null); }}
                disabled={connecting}
                className="w-full flex items-center gap-3 py-3 px-1 text-left hover:bg-blue-50 rounded">
                <span className="font-mono text-lg text-gray-400 w-14">{SIGNAL_BARS(n.signal)}</span>
                <span className="font-bold text-gray-900 text-base flex-1 truncate">{n.ssid}</span>
                {n.inUse && <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">연결됨</span>}
                {known && !n.inUse && <span className="text-xs text-blue-700 bg-blue-100 px-2 py-0.5 rounded">저장됨</span>}
                <span className="text-sm text-gray-400 w-10 text-right">{n.signal}%</span>
                <span className="text-sm w-5 text-center">{n.secured ? '🔒' : ''}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default NetworkManager;
