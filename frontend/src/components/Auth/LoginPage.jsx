import React, { useState, useRef, useCallback } from 'react';
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';
import { useAuth } from '../../contexts/AuthContext';
import { setFarmLocalMode } from '../../services/apiSwitcher';

// 1024x600 터치 패널 기준. 손가락으로 누르는 물건이라 키 높이(52px)와 글자 크기(20px)를
// 우선했고, 눌린 것이 눈에 보이도록 아래쪽 3px 테두리를 눌리면 사라지게 해 물리 키 느낌을 준다.
const keyboardStyles = `
  .smartfarm-kb .hg-theme-default { background: #0f172a !important; padding: 8px 6px !important; }
  .smartfarm-kb .hg-button {
    height: 52px !important;
    font-size: 20px !important;
    font-weight: 600 !important;
    color: #0f172a !important;
    background: #ffffff !important;
    border: 1px solid #cbd5e1 !important;
    border-bottom: 3px solid #94a3b8 !important;
    border-radius: 8px !important;
    margin: 3px !important;
    box-shadow: none !important;
  }
  .smartfarm-kb .hg-button:active {
    background: #dbeafe !important;
    border-bottom-width: 1px !important;
    transform: translateY(2px);
  }
  .smartfarm-kb .hg-button.hg-functionBtn { background: #e2e8f0 !important; font-size: 16px !important; }
  .smartfarm-kb .hg-button[data-skbtn="{enter}"] { background: #2563eb !important; color: #ffffff !important; border-bottom-color: #1d4ed8 !important; }
  .smartfarm-kb .hg-button[data-skbtn="{bksp}"] { background: #fee2e2 !important; color: #b91c1c !important; border-bottom-color: #fca5a5 !important; }
  .smartfarm-kb .hg-button[data-skbtn="{clear}"] { background: #fef3c7 !important; color: #92400e !important; border-bottom-color: #fcd34d !important; }
  /* 시프트·캡스가 켜진 것을 색으로 알린다 — 터치에는 촉각 피드백이 없다 */
  .smartfarm-kb.kb-shift .hg-button[data-skbtn="{shift}"],
  .smartfarm-kb.kb-caps  .hg-button[data-skbtn="{lock}"] {
    background: #2563eb !important; color: #ffffff !important; border-bottom-color: #1d4ed8 !important;
  }
`;

const isTouchPanel = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  && ['80', '443', ''].includes(window.location.port);

const LoginPage = () => {
  const { login, setup, needsSetup } = useAuth();
  const [isSetupMode, setIsSetupMode] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', name: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeField, setActiveField] = useState(null);
  const [shiftOn, setShiftOn] = useState(false);   // 한 글자만 대문자 (누르면 해제)
  const [capsOn, setCapsOn] = useState(false);     // 고정 대문자
  const [showPw, setShowPw] = useState(false);     // 입력 확인용 — 패널은 눌린 글자가 안 보인다
  const [cloudUnreachable, setCloudUnreachable] = useState(false);
  const keyboardRef = useRef(null);

  // 팜로컬 전환 — 농장주가 직접 누른다 (자동 전환은 하지 않는다).
  // 팜로컬은 RPi 가 직접 응답하는 무인증 모드라 인터넷 없이도 들어갈 수 있다.
  const switchToFarmLocal = () => {
    if (window.confirm('팜로컬 모드로 전환하시겠습니까?\n\n· 농장 RPi 가 직접 응답합니다 (로그인 없이 사용)\n· 인터넷 없이도 센서 조회·제어·자동화가 됩니다\n· 영농일지·AI 등 클라우드 전용 기능은 사용 불가\n· 인터넷 복구 후 클라우드 모드로 다시 전환할 수 있습니다')) {
      setFarmLocalMode(true);
      window.location.reload();
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (needsSetup || isSetupMode) {
        if (!form.name.trim()) {
          setError('이름을 입력하세요');
          setLoading(false);
          return;
        }
        await setup(form.username, form.password, form.name);
      } else {
        await login(form.username, form.password);
      }
    } catch (err) {
      // 응답 자체가 없으면 자격증명 문제가 아니라 연결 문제다.
      // 로그인은 클라우드(api.smartgreen.kr)로만 가므로, 인터넷이 끊기면 여기서 영원히 막힌다.
      // 터치패널이 로그인 화면에 갇히던 원인 — 팜로컬 전환은 로그인 뒤 배너에만 있었다.
      const offline = !err.response;
      setCloudUnreachable(offline);
      setError(offline
        ? '클라우드 서버에 연결할 수 없습니다 — 인터넷 상태를 확인하세요'
        : (err.response?.data?.error || '로그인에 실패했습니다'));
    } finally {
      setLoading(false);
    }
  };

  // 입력 순서 — 완료(Enter) 를 누르면 다음 칸으로 넘어가고, 마지막 칸이면 그대로 제출한다.
  // 이전에는 Enter 가 키보드를 닫기만 해서, 농장주가 키보드를 닫고 버튼을 다시 찾아 눌러야 했다.
  const fieldOrder = (needsSetup || isSetupMode)
    ? ['name', 'username', 'password']
    : ['username', 'password'];

  const onKeyPress = useCallback((button) => {
    if (!activeField) return;

    if (button === '{shift}') { setShiftOn(prev => !prev); return; }
    if (button === '{lock}')  { setCapsOn(prev => !prev);  return; }

    if (button === '{enter}') {
      const idx = fieldOrder.indexOf(activeField);
      const next = fieldOrder[idx + 1];
      if (next) {
        setActiveField(next);
        keyboardRef.current?.setInput(form[next] || '');
      } else {
        setActiveField(null);
        handleSubmit({ preventDefault: () => {} });
      }
      return;
    }
    if (button === '{bksp}') {
      setForm(prev => ({ ...prev, [activeField]: prev[activeField].slice(0, -1) }));
      return;
    }
    if (button === '{clear}') {
      setForm(prev => ({ ...prev, [activeField]: '' }));
      return;
    }
    if (button === '{space}') {
      setForm(prev => ({ ...prev, [activeField]: prev[activeField] + ' ' }));
      return;
    }
    if (button === '{tab}') return;

    setForm(prev => ({ ...prev, [activeField]: prev[activeField] + button }));
    if (shiftOn) setShiftOn(false);   // 한 글자용 시프트는 쓰고 나면 풀린다
  }, [activeField, shiftOn, form, fieldOrder]);   // eslint-disable-line react-hooks/exhaustive-deps

  const handleFocus = (field) => {
    setActiveField(field);
    if (keyboardRef.current) {
      keyboardRef.current.setInput(form[field]);
    }
  };

  const showSetup = needsSetup || isSetupMode;

  return (
    <div className="h-screen bg-gradient-to-br from-blue-50 via-white to-emerald-50 flex flex-col overflow-hidden">
      {/* 로그인 폼 영역 */}
      <div className="flex-1 flex items-center justify-center px-4 overflow-auto">
        <div className="w-full max-w-sm">
          {/* 로고 - 키보드 열리면 숨김 */}
          {!activeField && (
            <div className="text-center mb-6">
              <div className="w-14 h-14 bg-gradient-to-br from-emerald-400 to-blue-500 rounded-2xl
                            flex items-center justify-center text-2xl shadow-lg shadow-emerald-500/20 mx-auto mb-3">
                <span style={{color:'#fff'}}>🌱</span>
              </div>
              <h1 className="text-xl font-bold text-gray-900">케이그린텍</h1>
              <p className="text-gray-500 text-xs mt-1">
                {showSetup ? '초기 관리자 계정 설정' : '스마트팜 모니터링 시스템'}
              </p>
            </div>
          )}

          {/* 로그인 폼 */}
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-5 shadow-xl border border-gray-100">
            {showSetup && (
              <>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-3">
                  <p className="text-blue-700 text-xs">
                    처음 사용하시는군요! 관리자 계정을 생성해주세요.
                  </p>
                </div>
                <div className="mb-2">
                  <label className="text-xs text-gray-600 font-medium mb-1 block">이름</label>
                  <input
                    type="text"
                    value={form.name}
                    {...(isTouchPanel ? { readOnly: true, onClick: () => handleFocus('name') } : { onChange: (e) => setForm(prev => ({ ...prev, name: e.target.value })) })}
                    placeholder="홍길동"
                    className={`input-field text-sm ${activeField === 'name' ? 'ring-2 ring-blue-400' : ''}`}
                    autoComplete="off"
                  />
                </div>
              </>
            )}

            <div className="mb-2">
              <label className="text-xs text-gray-600 font-medium mb-1 block">사용자 ID</label>
              <input
                type="text"
                value={form.username}
                {...(isTouchPanel ? { readOnly: true, onClick: () => handleFocus('username') } : { onChange: (e) => setForm(prev => ({ ...prev, username: e.target.value })) })}
                placeholder="admin"
                className={`input-field text-sm ${activeField === 'username' ? 'ring-2 ring-blue-400' : ''}`}
                autoComplete="off"
              />
            </div>

            <div className="mb-3">
              <label className="text-xs text-gray-600 font-medium mb-1 block">비밀번호</label>
              <input
                type="password"
                value={form.password}
                {...(isTouchPanel ? { readOnly: true, onClick: () => handleFocus('password') } : { onChange: (e) => setForm(prev => ({ ...prev, password: e.target.value })) })}
                placeholder="••••••••"
                className={`input-field text-sm ${activeField === 'password' ? 'ring-2 ring-blue-400' : ''}`}
                autoComplete="off"
              />
            </div>

            {error && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 mb-3">
                <p className="text-rose-600 text-xs">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !form.username || !form.password}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium
                       text-sm transition-all active:scale-[0.97] shadow-md shadow-blue-600/20
                       disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span style={{color:'#fff'}}>처리 중...</span>
                </span>
              ) : <span style={{color:'#fff'}}>{showSetup ? '관리자 계정 생성' : '로그인'}</span>}
            </button>

            {/* 팜로컬 전환 — 인터넷이 끊겨 로그인할 수 없을 때의 유일한 출구.
                연결 실패를 확인한 뒤에는 크게, 그 전에는 패널에서만 조용히 노출한다. */}
            {cloudUnreachable ? (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <p className="text-xs text-gray-600 mb-2">
                  인터넷 없이 농장을 조작하려면 팜로컬 모드로 전환하세요.
                </p>
                <button
                  type="button"
                  onClick={switchToFarmLocal}
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl
                             font-medium text-sm transition-all active:scale-[0.97] shadow-md shadow-amber-500/20"
                >
                  <span style={{color:'#fff'}}>팜로컬 모드로 전환 (로그인 없이)</span>
                </button>
              </div>
            ) : isTouchPanel && (
              <button
                type="button"
                onClick={switchToFarmLocal}
                className="w-full mt-3 py-2 text-xs text-gray-500 hover:text-gray-700 underline"
              >
                인터넷 없이 사용 (팜로컬 모드)
              </button>
            )}
          </form>
        </div>
      </div>

      {/* 가상 키보드 - 터치패널에서만 표시 */}
      {isTouchPanel && activeField && (
        <div
          className={`smartfarm-kb w-full border-t border-slate-700 ${shiftOn ? 'kb-shift' : ''} ${capsOn ? 'kb-caps' : ''}`}
          style={{ flexShrink: 0 }}
        >
          <style>{keyboardStyles}</style>

          {/* 입력 미리보기 — 패널은 화면이 작아 입력칸이 키보드에 가리고,
              비밀번호는 점으로만 보여 무엇을 눌렀는지 확인할 방법이 없다. */}
          <div className="bg-slate-800 px-3 py-2 flex items-center gap-3">
            <span className="text-slate-300 text-sm font-medium shrink-0">
              {{ name: '이름', username: '아이디', password: '비밀번호' }[activeField] || ''}
            </span>
            <div className="flex-1 bg-slate-900 rounded-lg px-3 py-2 min-h-[38px] flex items-center overflow-hidden">
              <span className="text-white text-lg font-mono truncate">
                {activeField === 'password' && !showPw
                  ? '•'.repeat(form.password.length)
                  : (form[activeField] || '')}
              </span>
              <span className="inline-block w-[2px] h-5 bg-blue-400 ml-0.5 animate-pulse" />
            </div>
            {activeField === 'password' && (
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="text-slate-300 text-sm bg-slate-700 rounded-lg px-3 py-2 active:bg-slate-600 shrink-0"
              >
                {showPw ? '숨기기' : '보기'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveField(null)}
              className="text-slate-300 text-sm bg-slate-700 rounded-lg px-3 py-2 active:bg-slate-600 shrink-0"
            >
              닫기
            </button>
          </div>

          <Keyboard
            keyboardRef={r => (keyboardRef.current = r)}
            onKeyPress={onKeyPress}
            layoutName={(shiftOn !== capsOn) ? 'shift' : 'default'}
            layout={{
              default: [
                '1 2 3 4 5 6 7 8 9 0 {bksp}',
                'q w e r t y u i o p {clear}',
                '{lock} a s d f g h j k l',
                '{shift} z x c v b n m . -',
                '@ _ {space} . {enter}',
              ],
              shift: [
                '! @ # $ % ^ & * ( ) {bksp}',
                'Q W E R T Y U I O P {clear}',
                '{lock} A S D F G H J K L',
                '{shift} Z X C V B N M , +',
                '@ _ {space} / {enter}',
              ],
            }}
            display={{
              '{bksp}': '⌫ 지움',
              '{clear}': '전체지움',
              '{enter}': fieldOrder[fieldOrder.length - 1] === activeField ? '로그인' : '다음',
              '{shift}': '⇧ 대문자',
              '{lock}': '⇪ 고정',
              '{space}': '스페이스',
            }}
            theme="hg-theme-default hg-layout-default"
          />
        </div>
      )}
    </div>
  );
};

export default LoginPage;
