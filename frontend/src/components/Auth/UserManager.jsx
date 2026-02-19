import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuth } from '../../contexts/AuthContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

const UserManager = ({ farmId }) => {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE_URL}/auth/users`);
      if (res.data.success) setUsers(res.data.data);
    } catch (error) {
      console.error('사용자 로드 실패:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadUsers(); }, []);

  const deleteUser = async (userId, username) => {
    if (!confirm(`"${username}" 사용자를 삭제하시겠습니까?`)) return;
    try {
      await axios.delete(`${API_BASE_URL}/auth/users/${userId}`);
      loadUsers();
    } catch (error) {
      alert('삭제 실패: ' + (error.response?.data?.error || error.message));
    }
  };

  const toggleUser = async (userId) => {
    const user = users.find(u => u._id === userId);
    try {
      await axios.put(`${API_BASE_URL}/auth/users/${userId}`, { enabled: !user.enabled });
      loadUsers();
    } catch (error) {
      alert('변경 실패: ' + error.message);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-4 md:py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">사용자 관리</h1>
          <p className="text-gray-500 text-sm md:text-base mt-0.5">계정 생성 및 권한 관리</p>
        </div>
        <button onClick={() => { setEditingUser(null); setShowForm(true); }} className="btn-primary">
          + 사용자 추가
        </button>
      </div>

      {/* 사용자 추가/편집 폼 */}
      {showForm && (
        <UserForm
          user={editingUser}
          onSave={() => { setShowForm(false); setEditingUser(null); loadUsers(); }}
          onCancel={() => { setShowForm(false); setEditingUser(null); }}
        />
      )}

      {/* 사용자 목록 */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {users.map(u => (
            <div key={u._id} className={`glass-card p-4 flex items-center gap-4 ${!u.enabled ? 'opacity-50' : ''}`}>
              <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-violet-500 rounded-xl 
                            flex items-center justify-center text-base text-white font-bold flex-shrink-0">
                {u.name?.charAt(0) || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">{u.name}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                    u.role === 'admin' ? 'bg-violet-500/20 text-violet-300' : 'bg-blue-500/20 text-blue-300'
                  }`}>
                    {u.role === 'admin' ? '관리자' : '작업자'}
                  </span>
                  {u._id === currentUser._id && (
                    <span className="text-[10px] text-emerald-400">(나)</span>
                  )}
                </div>
                <p className="text-[10px] text-gray-500">
                  @{u.username} · 마지막 로그인: {u.lastLoginAt 
                    ? new Date(u.lastLoginAt).toLocaleDateString('ko-KR') 
                    : '없음'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleUser(u._id)}
                  className={`w-10 h-5 rounded-full transition-all relative ${u.enabled ? 'bg-emerald-500' : 'bg-gray-600'}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${u.enabled ? 'left-5' : 'left-0.5'}`} />
                </button>
                <button
                  onClick={() => { setEditingUser(u); setShowForm(true); }}
                  className="p-1.5 rounded-lg text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 text-xs"
                >✏️</button>
                {u._id !== currentUser._id && (
                  <button
                    onClick={() => deleteUser(u._id, u.username)}
                    className="p-1.5 rounded-lg text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 text-xs"
                  >🗑️</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const UserForm = ({ user, onSave, onCancel }) => {
  const [form, setForm] = useState({
    username: user?.username || '',
    password: '',
    name: user?.name || '',
    role: user?.role || 'worker',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    if (!form.username || !form.name) return setError('ID와 이름은 필수입니다');
    if (!user && !form.password) return setError('비밀번호는 필수입니다');

    setSaving(true);
    setError('');
    try {
      const data = { ...form };
      if (!data.password) delete data.password; // 빈 비밀번호는 보내지 않음

      if (user?._id) {
        await axios.put(`${API_BASE_URL}/auth/users/${user._id}`, data);
      } else {
        await axios.post(`${API_BASE_URL}/auth/users`, data);
      }
      onSave();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="glass-card p-5 mb-5 border border-blue-500/20 animate-fade-in-up">
      <h2 className="text-base font-bold text-blue-300 mb-4">{user ? '✏️ 사용자 수정' : '👤 새 사용자 추가'}</h2>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-[10px] text-gray-400 mb-1 block">사용자 ID</label>
          <input type="text" value={form.username} disabled={!!user}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            className="input-field text-xs disabled:opacity-50" placeholder="worker01" />
        </div>
        <div>
          <label className="text-[10px] text-gray-400 mb-1 block">{user ? '새 비밀번호 (변경 시)' : '비밀번호'}</label>
          <input type="password" value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="input-field text-xs" placeholder="••••" />
        </div>
        <div>
          <label className="text-[10px] text-gray-400 mb-1 block">이름</label>
          <input type="text" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="input-field text-xs" placeholder="홍길동" />
        </div>
        <div>
          <label className="text-[10px] text-gray-400 mb-1 block">역할</label>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="input-field text-xs">
            <option value="admin" className="bg-slate-800">관리자 (전체 기능)</option>
            <option value="worker" className="bg-slate-800">작업자 (제어만 가능)</option>
          </select>
        </div>
      </div>
      {error && <p className="text-rose-400 text-sm mb-3">{error}</p>}
      <div className="flex gap-3">
        <button onClick={handleSave} disabled={saving} className="flex-1 btn-primary disabled:opacity-50">
          {saving ? '저장 중...' : (user ? '수정' : '생성')}
        </button>
        <button onClick={onCancel} className="btn-secondary">취소</button>
      </div>
    </div>
  );
};

export default UserManager;
