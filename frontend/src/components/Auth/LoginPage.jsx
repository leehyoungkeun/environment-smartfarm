import React, { useState, useRef, useCallback } from 'react';
import Keyboard from 'react-simple-keyboard';
import 'react-simple-keyboard/build/css/index.css';
import { useAuth } from '../../contexts/AuthContext';

const keyboardStyles = `
  .hg-theme-default .hg-button {
    color: #1e293b !important;
    font-size: 16px !important;
    font-weight: 600 !important;
    height: 42px !important;
    background: #fff !important;
    border: 1px solid #d1d5db !important;
    border-radius: 6px !important;
  }
  .hg-theme-default .hg-button:active {
    background: #e2e8f0 !important;
  }
  .hg-theme-default {
    background: #f1f5f9 !important;
    padding: 4px !important;
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
  const [shiftOn, setShiftOn] = useState(false);
  const keyboardRef = useRef(null);

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
      setError(err.response?.data?.error || '로그인에 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  const onKeyPress = useCallback((button) => {
    if (!activeField) return;

    if (button === '{shift}') {
      setShiftOn(prev => !prev);
      return;
    }
    if (button === '{lock}') {
      setShiftOn(prev => !prev);
      return;
    }
    if (button === '{enter}') {
      setActiveField(null);
      return;
    }
    if (button === '{bksp}') {
      setForm(prev => ({ ...prev, [activeField]: prev[activeField].slice(0, -1) }));
      return;
    }
    if (button === '{space}') {
      setForm(prev => ({ ...prev, [activeField]: prev[activeField] + ' ' }));
      return;
    }
    if (button === '{tab}') return;

    setForm(prev => ({ ...prev, [activeField]: prev[activeField] + button }));
    if (shiftOn) {
      setShiftOn(false);
    }
  }, [activeField, shiftOn]);

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
          </form>
        </div>
      </div>

      {/* 가상 키보드 - 터치패널에서만 표시 */}
      {isTouchPanel && activeField && (
        <div className="w-full bg-gray-100 border-t border-gray-300" style={{ flexShrink: 0 }}>
          <div className="flex justify-end px-2 py-1">
            <button
              type="button"
              onClick={() => setActiveField(null)}
              className="text-xs text-gray-500 bg-gray-200 rounded px-3 py-1 active:bg-gray-300"
            >
              닫기
            </button>
          </div>
          <style>{keyboardStyles}</style>
          <Keyboard
            keyboardRef={r => (keyboardRef.current = r)}
            onKeyPress={onKeyPress}
            layoutName={shiftOn ? 'shift' : 'default'}
            layout={{
              default: [
                '1 2 3 4 5 6 7 8 9 0 {bksp}',
                'q w e r t y u i o p',
                'a s d f g h j k l',
                '{shift} z x c v b n m .',
                '{space} @ _ - {enter}',
              ],
              shift: [
                '! @ # $ % ^ & * ( ) {bksp}',
                'Q W E R T Y U I O P',
                'A S D F G H J K L',
                '{shift} Z X C V B N M .',
                '{space} @ _ - {enter}',
              ],
            }}
            display={{
              '{bksp}': '⌫',
              '{enter}': '완료',
              '{shift}': '⇧',
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
