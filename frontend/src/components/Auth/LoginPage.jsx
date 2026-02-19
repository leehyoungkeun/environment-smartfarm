import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';

const LoginPage = () => {
  const { login, setup, needsSetup } = useAuth();
  const [isSetupMode, setIsSetupMode] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', name: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

  const showSetup = needsSetup || isSetupMode;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-emerald-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* 로고 */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-emerald-400 to-blue-500 rounded-2xl 
                        flex items-center justify-center text-3xl shadow-lg shadow-emerald-500/20 mx-auto mb-4">
            <span style={{color:'#fff'}}>🌱</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">SmartFarm</h1>
          <p className="text-gray-500 text-sm mt-1">
            {showSetup ? '초기 관리자 계정 설정' : '스마트팜 모니터링 시스템'}
          </p>
        </div>

        {/* 로그인 폼 */}
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-6 shadow-xl border border-gray-100">
          {showSetup && (
            <>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4">
                <p className="text-blue-700 text-xs">
                  🎉 처음 사용하시는군요! 관리자 계정을 생성해주세요.
                </p>
              </div>
              <div className="mb-3">
                <label className="text-xs text-gray-600 font-medium mb-1.5 block">이름</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="홍길동"
                  className="input-field text-sm"
                  autoComplete="name"
                />
              </div>
            </>
          )}

          <div className="mb-3">
            <label className="text-xs text-gray-600 font-medium mb-1.5 block">사용자 ID</label>
            <input
              type="text"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              placeholder="admin"
              className="input-field text-sm"
              autoComplete="username"
              autoFocus
            />
          </div>

          <div className="mb-4">
            <label className="text-xs text-gray-600 font-medium mb-1.5 block">비밀번호</label>
            <input
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="••••••••"
              className="input-field text-sm"
              autoComplete={showSetup ? 'new-password' : 'current-password'}
            />
          </div>

          {error && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 mb-4">
              <p className="text-rose-600 text-xs">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !form.username || !form.password}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium 
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

        {/* 하단 안내 */}
        <p className="text-center text-gray-400 text-[10px] mt-4">
          SmartFarm Monitoring System v2.0
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
