import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';

// ━━━ 설정 › 네트워크 (2026-09-13) ━━━
// 농장을 옮길 때 새 WiFi 를 잡으려면 Ctrl+Alt+Del 로 키오스크를 빠져나와 키보드로 입력해야 했다.
// 터치만으로 되게 한다 — 목록에서 탭 → 화면 키보드로 비밀번호 → 연결.
//
// 경로: 같은 출처(nginx) `/api/system/wifi*` → RPi system-api(3100) → nmcli.
//   패널이 아닌 곳에서 열면 403 이 오고 그대로 안내한다.
//
// 2026-09-15 새 장소(603ho) 사고 후 재작성:
//   - 키보드에 대문자·기호가 없어 공유기 비밀번호를 칠 수 없었다 → 시프트·기호 전환.
//   - 오타를 볼 수 없었다 → 비밀번호 보기/가리기 (기본은 보이기: 현장에서 오타 확인이 더 중요).
//   - 틀린 비밀번호가 '저장됨' 으로 취급돼 두 번째에 키보드가 숨었다 → '저장됨' 은 연결에 성공한 망뿐(서버),
//     '비밀번호 새로 입력' 버튼은 늘 보이게, 실패하면 키보드를 열고 서버가 판정한 사유를 그대로 보여준다.
//   - 703HO 시험 실패 뒤 「현재 연결」 이 703HO 로 멈춰 있었다 → 서버가 장치 상태로 판정하고,
//     화면은 전환 중에는 2초, 평소에는 10초마다 다시 읽는다. 연결 세부(신호·대역·보안·주소·인터넷)를 함께 보여준다.

const SIGNAL_BARS = (s) => (s >= 75 ? '▂▄▆█' : s >= 50 ? '▂▄▆_' : s >= 25 ? '▂▄__' : '▂___');

const LAYOUT = {
  default: [
    '1 2 3 4 5 6 7 8 9 0',
    'q w e r t y u i o p',
    'a s d f g h j k l',
    '{shift} z x c v b n m {bksp}',
    '{symbols} {space} {clear} {enter}',
  ],
  shift: [
    '1 2 3 4 5 6 7 8 9 0',
    'Q W E R T Y U I O P',
    'A S D F G H J K L',
    '{shift} Z X C V B N M {bksp}',
    '{symbols} {space} {clear} {enter}',
  ],
  symbols: [
    '! @ # $ % ^ & * ( )',
    '- _ = + [ ] { } \\ |',
    '; : \' " , . / ? ~ `',
    '< > {bksp}',
    '{abc} {space} {clear} {enter}',
  ],
};

const Fact = ({ label, value, tone, mono }) => (
  <div className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2">
    <p className="text-[11px] text-gray-500">{label}</p>
    <p className={`text-sm font-bold break-all ${tone === 'ok' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-gray-800'} ${mono ? 'font-mono' : ''}`}>
      {value}
    </p>
  </div>
);

export const NetworkManager = () => {
  const [status, setStatus] = useState(null);      // { connected, link, saved, ip, checkedAt }
  const [networks, setNetworks] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [target, setTarget] = useState(null);      // 연결하려는 네트워크
  const [askPassword, setAskPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(true);
  const [layoutName, setLayoutName] = useState('default');
  const [connecting, setConnecting] = useState(false);
  const [message, setMessage] = useState(null);    // { type, text }
  const [blocked, setBlocked] = useState(false);   // 패널이 아닌 곳에서 열었을 때
  const keyboardRef = useRef(null);
  const fastUntilRef = useRef(0);                  // 이 시각까지는 2초마다 상태를 다시 읽는다
  const lastLinkRef = useRef(null);                // 연결이 바뀌면 주변 목록도 새로 읽는다

  // 서버의 saved 는 '실제로 연결에 성공한 적 있는 망' 만 담는다.
  const isKnown = (ssid) => !!(status?.saved || []).includes(ssid);

  const scan = useCallback(async () => {
    setScanning(true);
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

  const loadStatus = useCallback(async () => {
    try {
      const r = await axios.get('/api/system/wifi', { timeout: 15000 });
      setStatus(r.data);
      setBlocked(false);
      const l = r.data?.link;
      // 전환 중이면 끝날 때까지 빨리 다시 읽는다
      if (l && l.state !== 'connected') fastUntilRef.current = Math.max(fastUntilRef.current, Date.now() + 4000);
      const key = l ? l.state + ':' + (l.ssid || '') : (r.data?.connected?.ssid || '');
      if (lastLinkRef.current !== null && lastLinkRef.current !== key) scan();
      lastLinkRef.current = key;
    } catch (e) {
      if (e.response?.status === 403) setBlocked(true);
      else setMessage({ type: 'err', text: '네트워크 상태를 읽지 못했습니다: ' + (e.response?.data?.error || e.message) });
    }
  }, [scan]);

  useEffect(() => { loadStatus(); scan(); }, [loadStatus, scan]);

  // 화면이 열려 있는 동안 상태를 계속 맞춘다 — 전환 중 2초, 평소 10초
  useEffect(() => {
    let alive = true;
    let timer;
    const tick = async () => {
      await loadStatus();
      if (!alive) return;
      timer = setTimeout(tick, Date.now() < fastUntilRef.current ? 2000 : 10000);
    };
    timer = setTimeout(tick, 10000);
    return () => { alive = false; clearTimeout(timer); };
  }, [loadStatus]);

  const resetPasswordInput = () => {
    setPassword('');
    setLayoutName('default');
    keyboardRef.current?.setInput('');
  };

  // 목록에서 하나를 고른다. 실제로 연결에 성공했던 망이면 키보드를 열지 않는다.
  const pick = (n) => {
    setTarget(n);
    resetPasswordInput();
    setMessage(null);
    setAskPassword(n.secured && !isKnown(n.ssid));
  };

  const openPasswordInput = () => {
    resetPasswordInput();
    setAskPassword(true);
  };

  const connect = async () => {
    if (!target || connecting) return;
    if (askPassword && password.length < 8) {
      setMessage({ type: 'warn', text: '비밀번호는 8자 이상입니다' });
      return;
    }
    setConnecting(true);
    fastUntilRef.current = Date.now() + 45000;
    setMessage({ type: 'info', text: target.ssid + ' 에 연결을 확인하는 중입니다. 최대 30초 걸립니다.' });
    try {
      const r = await axios.post('/api/system/wifi/connect',
        { ssid: target.ssid, password: askPassword ? password : '' },
        { timeout: 60000 });
      const d = r.data || {};
      if (d.success) {
        setMessage({ type: 'ok', text: target.ssid + ' 에 연결되었습니다.' });
        setTarget(null);
        setAskPassword(false);
        resetPasswordInput();
      } else {
        // 비밀번호 문제면 키보드를 연다. 입력한 글자는 남겨 두어 한 글자만 고칠 수 있게 한다.
        if (d.needPassword) setAskPassword(true);
        const back = d.returnedTo ? ` 원래 쓰던 ${d.returnedTo} 로 되돌리는 중입니다. 위 「현재 연결」 이 곧 바뀝니다.` : '';
        setMessage({ type: 'err', text: (d.error || '연결하지 못했습니다.') + back });
      }
    } catch (e) {
      setMessage({ type: 'err', text: '연결 요청 실패: ' + (e.response?.data?.error || e.message) });
    } finally {
      setConnecting(false);
      fastUntilRef.current = Date.now() + 30000;   // 원래 망 복귀·주소 할당까지 빨리 따라간다
      loadStatus();
      scan();
    }
  };

  const onKeyPress = (button) => {
    if (button === '{shift}') { setLayoutName((l) => (l === 'shift' ? 'default' : 'shift')); return; }
    if (button === '{symbols}') { setLayoutName('symbols'); return; }
    if (button === '{abc}') { setLayoutName('default'); return; }
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
    : message?.type === 'info' ? 'bg-blue-50 border-blue-300 text-blue-800'
    : 'bg-rose-50 border-rose-300 text-rose-700';

  // 옛 서버(link 없음)와도 동작하게 한다
  const link = status?.link || (status?.connected ? { state: 'connected', ssid: status.connected.ssid, ip: status.ip } : null);
  const st = link?.state || (status ? 'disconnected' : null);
  const badge = st === 'connected' ? { t: '연결됨', c: 'bg-emerald-100 text-emerald-800 border-emerald-300' }
    : st === 'connecting' ? { t: '연결 바꾸는 중', c: 'bg-amber-100 text-amber-800 border-amber-300' }
    : { t: '연결 안 됨', c: 'bg-rose-100 text-rose-800 border-rose-300' };
  const checkedAt = status?.checkedAt ? new Date(status.checkedAt).toLocaleTimeString('ko-KR', { hour12: false }) : '-';
  const targetKnown = target ? isKnown(target.ssid) : false;

  return (
    <div className="space-y-4 animate-fade-in-up">
      {/* 현재 연결 */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-base font-bold text-gray-800">📶 현재 연결</h3>
          {status && <span className={`px-3 py-1 rounded-full border text-sm font-bold ${badge.c}`}>{badge.t}</span>}
          <span className="text-xs text-gray-400">확인 {checkedAt}</span>
          <button onClick={() => { loadStatus(); scan(); }} disabled={scanning || connecting}
            className="ml-auto btn-primary text-sm px-4 py-2">
            {scanning ? '찾는 중…' : '🔄 다시 찾기'}
          </button>
        </div>

        {st === 'connected' && (
          <div className="mt-3">
            <p className="text-xs text-gray-500">연결된 WiFi</p>
            <p className="text-2xl font-extrabold text-gray-900 break-all">{link.ssid}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3">
              <Fact label="인터넷" value={link.internet || '-'} tone={link.internetCode === 'full' ? 'ok' : link.internetCode ? 'warn' : undefined} />
              <Fact label="신호" value={link.signal != null ? `${SIGNAL_BARS(link.signal)} ${link.signal}%` : '-'} />
              <Fact label="대역 · 채널" value={link.band ? `${link.band} · ${link.channel ?? '-'}번` : '-'} />
              <Fact label="보안" value={link.security || '-'} />
              <Fact label="제어기 주소" value={link.ip || '-'} mono />
              <Fact label="공유기 주소" value={link.gateway || '-'} mono />
              <Fact label="연결 속도" value={link.rate || '-'} />
              <Fact label="장치 상태" value={link.stateText || 'connected'} mono />
            </div>
          </div>
        )}
        {st === 'connecting' && (
          <p className="mt-3 text-base font-semibold text-amber-800">
            {link?.ssid ? `${link.ssid} 쪽으로 연결을 바꾸는 중입니다.` : '연결을 바꾸는 중입니다.'} 몇 초 뒤 자동으로 갱신됩니다.
          </p>
        )}
        {st === 'disconnected' && (
          <p className="mt-3 text-base font-semibold text-rose-700">무선에 연결돼 있지 않습니다. 아래 목록에서 WiFi 를 고르세요.</p>
        )}

        <p className="text-xs text-gray-500 mt-3">
          농장을 옮겼다면 아래 목록에서 새 WiFi 를 골라 연결하세요. 연결에 성공한 적 있는 WiFi 는 비밀번호를 다시 넣지 않아도 됩니다.
        </p>
      </div>

      {message && <p className={'text-base font-semibold rounded-md p-3 border ' + msgClass}>{message.text}</p>}

      {/* 연결 패널 */}
      {target && (
        <div className="card p-4 border-2 border-blue-300">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <span className="text-base font-bold text-gray-900">{target.ssid}</span>
            {!target.secured
              ? <span className="text-xs text-gray-500">공개 네트워크</span>
              : askPassword
                ? <span className="text-xs text-gray-500">🔒 비밀번호 입력</span>
                : <span className="text-xs text-emerald-700 font-semibold">🔒 저장된 비밀번호 사용</span>}
            <button onClick={() => { setTarget(null); setAskPassword(false); resetPasswordInput(); }}
              disabled={connecting}
              className="ml-auto text-sm text-gray-500 hover:underline">취소</button>
          </div>

          {targetKnown && !askPassword && (
            <p className="text-sm text-gray-600 mb-2">
              전에 연결에 성공한 WiFi 입니다. 그대로 연결을 누르세요.
            </p>
          )}

          {askPassword && (
            <>
              <div className="flex gap-2 mb-2">
                <input type={showPw ? 'text' : 'password'} value={password} readOnly placeholder="아래 키보드로 입력하세요"
                  className="input-field text-lg flex-1 text-center tracking-wider font-mono" />
                <button onClick={() => setShowPw((v) => !v)}
                  className="px-3 rounded-lg border border-gray-300 text-sm font-semibold text-gray-600 bg-white">
                  {showPw ? '🙈 가리기' : '👁 보기'}
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-2">
                {password.length}자 · 대문자는 ⇧, 기호는 #+= 를 누르세요 · 틀린 글자는 ⌫ 로 지웁니다
              </p>
              <Keyboard
                keyboardRef={(r) => { keyboardRef.current = r; }}
                onKeyPress={onKeyPress}
                layoutName={layoutName}
                layout={LAYOUT}
                display={{
                  '{bksp}': '⌫',
                  '{space}': '공백',
                  '{clear}': '전체삭제',
                  '{enter}': '연결',
                  '{shift}': layoutName === 'shift' ? '⇧ 소문자' : '⇧ 대문자',
                  '{symbols}': '#+=',
                  '{abc}': 'ABC',
                }}
              />
            </>
          )}

          <button onClick={connect} disabled={connecting}
            className="btn-primary w-full text-base py-3 mt-3">
            {connecting ? '연결 확인 중… (최대 30초)' : '🔗 ' + target.ssid + ' 에 연결'}
          </button>

          {/* 비밀번호 새로 입력 — 늘 보이게 (2026-09-15: 작은 링크로 숨어 있어 틀린 저장값을 고칠 길이 없었다) */}
          {target.secured && !askPassword && (
            <button onClick={openPasswordInput} disabled={connecting}
              className="w-full mt-2 py-3 rounded-lg border-2 border-blue-300 text-blue-700 font-bold text-base bg-white">
              🔑 비밀번호 새로 입력
            </button>
          )}
          {target.secured && askPassword && targetKnown && (
            <button onClick={() => { setAskPassword(false); resetPasswordInput(); }} disabled={connecting}
              className="w-full mt-2 py-2 rounded-lg text-sm text-gray-600 font-semibold bg-gray-100">
              저장된 비밀번호로 연결하기
            </button>
          )}
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
            const known = isKnown(n.ssid);
            // 「연결됨」 은 검색 목록의 표시가 아니라 장치 상태 기준 — 검색 결과는 몇 초 늦을 수 있다
            const current = st === 'connected' && link?.ssid === n.ssid;
            return (
              <button key={n.ssid} onClick={() => pick(n)} disabled={connecting}
                className={`w-full flex items-center gap-3 py-3 px-1 text-left rounded ${current ? 'bg-emerald-50' : 'hover:bg-blue-50'}`}>
                <span className="font-mono text-lg text-gray-400 w-14">{SIGNAL_BARS(n.signal)}</span>
                <span className="font-bold text-gray-900 text-base flex-1 truncate">{n.ssid}</span>
                {current && <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">연결됨</span>}
                {known && !current && <span className="text-xs text-blue-700 bg-blue-100 px-2 py-0.5 rounded">저장됨</span>}
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
