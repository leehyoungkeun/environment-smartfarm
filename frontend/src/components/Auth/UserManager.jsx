import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import axios from 'axios';
import Fuse from 'fuse.js';
import { useAuth } from '../../contexts/AuthContext';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

/* ─── 역할별 색상 (카드뷰) ─── */
const ROLE_STYLES = {
  superadmin: { bg: 'bg-violet-100', text: 'text-violet-700', dot: 'bg-violet-500', border: 'border-violet-200' },
  manager:    { bg: 'bg-blue-100',   text: 'text-blue-700',   dot: 'bg-blue-500',   border: 'border-blue-200' },
  owner:      { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500', border: 'border-emerald-200' },
  worker:     { bg: 'bg-gray-100',   text: 'text-gray-600',   dot: 'bg-gray-400',   border: 'border-gray-200' },
};

/* ─── 역할별 색상 (테이블뷰 light theme) ─── */
const ROLE_LIGHT = {
  superadmin: { bg: 'bg-violet-100', text: 'text-violet-700', card: 'bg-violet-50', cardBorder: 'border-violet-200', cardText: 'text-violet-700', cardCount: 'text-violet-600' },
  manager:    { bg: 'bg-blue-100',   text: 'text-blue-700',   card: 'bg-blue-50',   cardBorder: 'border-blue-200',   cardText: 'text-blue-700',   cardCount: 'text-blue-600' },
  owner:      { bg: 'bg-emerald-100', text: 'text-emerald-700', card: 'bg-emerald-50', cardBorder: 'border-emerald-200', cardText: 'text-emerald-700', cardCount: 'text-emerald-600' },
  worker:     { bg: 'bg-gray-100',   text: 'text-gray-700',   card: 'bg-gray-50',   cardBorder: 'border-gray-200',   cardText: 'text-gray-700',   cardCount: 'text-gray-600' },
};

const ROLE_ICONS = { superadmin: '👑', manager: '💼', owner: '🏠', worker: '👷' };

/* ─── 테이블 컬럼 정의 ─── */
const ALL_COLUMNS = [
  { id: 'no',        label: 'No',        default: true, fixed: true },
  { id: 'username',  label: '아이디',     default: true, fixed: true },
  { id: 'name',      label: '이름',       default: true },
  { id: 'role',      label: '역할',       default: true },
  { id: 'farmId',    label: '소속농장',    default: true },
  { id: 'enabled',   label: '상태',       default: true },
  { id: 'lastLogin', label: '마지막로그인', default: true },
  { id: 'createdAt', label: '등록일',     default: true },
];
const DEFAULT_VISIBLE = ALL_COLUMNS.filter(c => c.default).map(c => c.id);

/* ─── Fuse.js 검색 키 매핑 ─── */
const FUSE_KEYS_MAP = {
  all:      [{ name: 'name', weight: 2 }, { name: 'username', weight: 1.5 }, { name: 'farmId', weight: 1 }],
  name:     [{ name: 'name', weight: 1 }],
  username: [{ name: 'username', weight: 1 }],
  farmId:   [{ name: 'farmId', weight: 1 }],
};

/* ─── CSS 헬퍼 (FarmManager 패턴) ─── */
const thCls = 'bg-slate-50 px-4 py-3 text-sm font-medium text-gray-700 text-left whitespace-nowrap border border-gray-200 w-[120px]';
const tdCls = 'px-4 py-2.5 border border-gray-200';
const chkCls = (active) => `px-3 py-1 rounded text-xs font-medium border cursor-pointer transition-colors ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`;

/* ═══════════════════════════════ Component ═══════════════════════════════ */
const UserManager = ({ farmId }) => {
  const { user: currentUser, canCreateRole, canManageRole, ROLE_HIERARCHY, isSystemWide } = useAuth();

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  // Search / Filter (테이블뷰)
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState('all');
  const [roleFilter, setRoleFilter] = useState('');
  const [enabledFilter, setEnabledFilter] = useState('');
  const [farmFilter, setFarmFilter] = useState('');
  const [summaryFilter, setSummaryFilter] = useState('');

  // Table / Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [selectedIds, setSelectedIds] = useState([]);
  const [focusedIdx, setFocusedIdx] = useState(-1);

  // Column settings
  const [visibleColumns, setVisibleColumns] = useState(() => {
    try { const s = localStorage.getItem('userManager_columns'); return s ? JSON.parse(s) : DEFAULT_VISIBLE; }
    catch { return DEFAULT_VISIBLE; }
  });
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const columnSettingsRef = useRef(null);

  // Form modal
  const [showForm, setShowForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);

  // Batch role change
  const [batchRole, setBatchRole] = useState('');

  /* ── Data loading ── */
  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE_URL}/auth/users`);
      if (res.data.success) setUsers(res.data.data);
    } catch (error) {
      console.error('사용자 로드 실패:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  /* ── Effects ── */
  useEffect(() => { setCurrentPage(1); }, [search, searchField, roleFilter, enabledFilter, farmFilter, summaryFilter]);
  useEffect(() => { localStorage.setItem('userManager_columns', JSON.stringify(visibleColumns)); }, [visibleColumns]);
  useEffect(() => { setFocusedIdx(-1); }, [currentPage]);

  // Column settings click-outside
  useEffect(() => {
    if (!showColumnSettings) return;
    const handler = (e) => {
      if (columnSettingsRef.current && !columnSettingsRef.current.contains(e.target)) setShowColumnSettings(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showColumnSettings]);

  /* ── Helpers ── */
  const creatableRoles = Object.keys(ROLE_HIERARCHY || {}).filter(r => canCreateRole(r));
  const getRoleLabel = (role) => ROLE_HIERARCHY?.[role]?.label || role;
  const getRoleStyle = (role) => ROLE_STYLES[role] || ROLE_STYLES.worker;
  const fmt = (d) => d ? new Date(d).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : '-';
  const fmtFull = (d) => d ? new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '-';
  const isCol = (id) => visibleColumns.includes(id);
  const toggleColumn = (colId) => {
    const col = ALL_COLUMNS.find(c => c.id === colId);
    if (col?.fixed) return;
    setVisibleColumns(prev => prev.includes(colId) ? prev.filter(x => x !== colId) : [...prev, colId]);
  };
  const resetColumns = () => setVisibleColumns(DEFAULT_VISIBLE);

  /* ── Fuse.js ── */
  const fuse = useMemo(() => new Fuse(users, {
    keys: FUSE_KEYS_MAP[searchField] || FUSE_KEYS_MAP.all,
    threshold: searchField === 'username' ? 0.1 : 0.35,
    ignoreLocation: true, minMatchCharLength: 1,
  }), [users, searchField]);

  /* ── Computed ── */
  const farmIds = useMemo(() =>
    [...new Set(users.map(u => u.farmId).filter(Boolean))].sort(), [users]);

  const roleCounts = useMemo(() => {
    const c = { superadmin: 0, manager: 0, owner: 0, worker: 0 };
    users.forEach(u => { if (c[u.role] !== undefined) c[u.role]++; });
    return c;
  }, [users]);

  const filteredUsers = useMemo(() => {
    let r;
    const q = search.trim();
    if (!q) {
      r = [...users];
    } else if (searchField === 'username') {
      const lower = q.toLowerCase();
      r = users.filter(u => u.username?.toLowerCase().includes(lower));
      if (r.length === 0) r = fuse.search(q).map(x => x.item);
    } else if (searchField === 'farmId') {
      const lower = q.toLowerCase();
      r = users.filter(u => u.farmId?.toLowerCase().includes(lower));
      if (r.length === 0) r = fuse.search(q).map(x => x.item);
    } else {
      r = fuse.search(q).map(x => x.item);
    }
    if (roleFilter) r = r.filter(u => u.role === roleFilter);
    if (summaryFilter) r = r.filter(u => u.role === summaryFilter);
    if (enabledFilter === 'enabled') r = r.filter(u => u.enabled);
    if (enabledFilter === 'disabled') r = r.filter(u => !u.enabled);
    if (farmFilter) r = r.filter(u => u.farmId === farmFilter);
    return r;
  }, [users, search, searchField, roleFilter, enabledFilter, farmFilter, summaryFilter, fuse]);

  const totalPages = Math.ceil(filteredUsers.length / perPage);
  const paginated = useMemo(() =>
    filteredUsers.slice((currentPage - 1) * perPage, currentPage * perPage),
    [filteredUsers, currentPage, perPage]);

  const pageNums = useMemo(() => {
    const pages = [];
    const max = 5;
    let s = Math.max(1, currentPage - Math.floor(max / 2));
    let e = Math.min(totalPages, s + max - 1);
    if (e - s + 1 < max) s = Math.max(1, e - max + 1);
    for (let i = s; i <= e; i++) pages.push(i);
    return pages;
  }, [currentPage, totalPages]);

  const hasFilters = search || roleFilter || enabledFilter || farmFilter || summaryFilter;

  /* ── Selection ── */
  const allSelected = paginated.length > 0 && paginated.every(u => selectedIds.includes(u._id));
  const toggleAll = () => {
    if (allSelected) setSelectedIds(prev => prev.filter(id => !paginated.some(u => u._id === id)));
    else setSelectedIds(prev => [...new Set([...prev, ...paginated.map(u => u._id)])]);
  };
  const toggleOne = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  /* ── Actions ── */
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
      alert('변경 실패: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleBatchAction = async (action, value) => {
    if (selectedIds.length === 0) return;
    const actionLabel = action === 'changeRole' ? `역할을 "${getRoleLabel(value)}"(으)로 변경` :
                        action === 'enable' ? '활성화' : action === 'disable' ? '비활성화' : '삭제';
    if (!confirm(`선택한 ${selectedIds.length}명을 ${actionLabel}하시겠습니까?`)) return;

    try {
      if (action === 'delete') {
        const res = await axios.delete(`${API_BASE_URL}/auth/users/batch`, { data: { userIds: selectedIds } });
        alert(`${res.data.data.deleted}명 삭제, ${res.data.data.skipped}명 건너뜀`);
      } else {
        const body = { userIds: selectedIds, action };
        if (action === 'changeRole') body.role = value;
        const res = await axios.put(`${API_BASE_URL}/auth/users/batch`, body);
        alert(`${res.data.data.updated}명 처리, ${res.data.data.skipped}명 건너뜀`);
      }
      setSelectedIds([]);
      loadUsers();
    } catch (error) {
      alert('일괄 작업 실패: ' + (error.response?.data?.error || error.message));
    }
  };

  const clearAll = () => {
    setSearch(''); setSearchField('all'); setRoleFilter(''); setEnabledFilter('');
    setFarmFilter(''); setSummaryFilter(''); setCurrentPage(1);
  };

  /* ── Keyboard ── */
  useEffect(() => {
    if (!isSystemWide) return;
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'j' || e.key === 'J') { e.preventDefault(); setFocusedIdx(prev => Math.min(paginated.length - 1, prev + 1)); }
      else if (e.key === 'k' || e.key === 'K') { e.preventDefault(); setFocusedIdx(prev => Math.max(0, prev - 1)); }
      else if (e.key === 'Enter' && focusedIdx >= 0 && focusedIdx < paginated.length) {
        e.preventDefault();
        setEditingUser(paginated[focusedIdx]);
        setShowForm(true);
      }
      else if (e.key === 'Escape') { setShowForm(false); setEditingUser(null); setFocusedIdx(-1); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isSystemWide, focusedIdx, paginated]);

  /* ═══════════════════ RENDER: System-Wide Table View ═══════════════════ */
  if (isSystemWide) {
    return (
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-4 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-800 tracking-tight">사용자 관리</h1>
            <p className="text-gray-500 text-sm mt-0.5">계정 생성 및 권한 관리 · 총 {users.length}명</p>
          </div>
          {creatableRoles.length > 0 && (
            <button onClick={() => { setEditingUser(null); setShowForm(true); }}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 active:scale-95 transition-all">
              + 사용자 추가
            </button>
          )}
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(ROLE_HIERARCHY || {}).map(([role, info]) => {
            const rl = ROLE_LIGHT[role] || ROLE_LIGHT.worker;
            const active = summaryFilter === role;
            return (
              <button key={role}
                onClick={() => setSummaryFilter(prev => prev === role ? '' : role)}
                className={`relative flex items-center gap-3 px-4 py-3 rounded-lg border transition-all text-left ${
                  active ? `${rl.card} ${rl.cardBorder} ring-2 ring-offset-1 ring-current ${rl.cardText} shadow-sm`
                         : 'bg-white border-gray-200 hover:shadow-sm'
                }`}>
                <span className="text-xl">{ROLE_ICONS[role]}</span>
                <div className="min-w-0">
                  <div className={`text-xl font-bold ${active ? rl.cardCount : 'text-gray-800'}`}>{roleCounts[role] || 0}</div>
                  <div className={`text-[11px] ${active ? rl.cardText : 'text-gray-500'}`}>{info.label}</div>
                </div>
                {active && <span className="absolute top-1 right-2 text-[9px] text-gray-400">필터 적용중</span>}
              </button>
            );
          })}
        </div>

        {/* Search Panel */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="bg-slate-600 px-4 py-2.5">
            <h3 className="text-sm font-semibold text-white">사용자 검색</h3>
          </div>
          <table className="w-full border-collapse">
            <tbody>
              <tr>
                <td className={thCls}>검색어</td>
                <td className={tdCls}>
                  <div className="flex items-center gap-2">
                    <select value={searchField} onChange={e => setSearchField(e.target.value)}
                      className="px-3 py-1.5 border border-gray-300 rounded text-sm bg-white min-w-[100px]">
                      <option value="all">전체</option>
                      <option value="name">이름</option>
                      <option value="username">아이디</option>
                      <option value="farmId">소속농장</option>
                    </select>
                    <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                      placeholder="검색어를 입력하세요"
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30" />
                  </div>
                </td>
              </tr>
              <tr>
                <td className={thCls}>역할</td>
                <td className={tdCls}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => setRoleFilter('')} className={chkCls(!roleFilter)}>전체</button>
                    {Object.entries(ROLE_HIERARCHY || {}).map(([role, info]) => (
                      <button key={role} onClick={() => setRoleFilter(prev => prev === role ? '' : role)}
                        className={chkCls(roleFilter === role)}>
                        {info.label} ({roleCounts[role] || 0})
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
              <tr>
                <td className={thCls}>상태</td>
                <td className={tdCls}>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setEnabledFilter('')} className={chkCls(!enabledFilter)}>전체</button>
                    <button onClick={() => setEnabledFilter(prev => prev === 'enabled' ? '' : 'enabled')}
                      className={chkCls(enabledFilter === 'enabled')}>
                      활성 ({users.filter(u => u.enabled).length})
                    </button>
                    <button onClick={() => setEnabledFilter(prev => prev === 'disabled' ? '' : 'disabled')}
                      className={chkCls(enabledFilter === 'disabled')}>
                      비활성 ({users.filter(u => !u.enabled).length})
                    </button>
                  </div>
                </td>
              </tr>
              <tr>
                <td className={thCls}>소속농장</td>
                <td className={tdCls}>
                  <select value={farmFilter} onChange={e => setFarmFilter(e.target.value)}
                    className="px-3 py-1.5 border border-gray-300 rounded text-sm bg-white min-w-[160px]">
                    <option value="">전체 농장</option>
                    {farmIds.map(fid => (
                      <option key={fid} value={fid}>{fid} ({users.filter(u => u.farmId === fid).length})</option>
                    ))}
                  </select>
                </td>
              </tr>
            </tbody>
          </table>
          <div className="flex items-center justify-center gap-3 py-3 bg-gray-50 border-t border-gray-200">
            <button onClick={clearAll}
              className="w-24 py-2 bg-white border border-gray-300 rounded text-sm text-gray-600 hover:bg-gray-100 active:scale-95 active:bg-gray-200 transition-all">
              초기화
            </button>
            <button onClick={() => setCurrentPage(1)}
              className="w-24 py-2 bg-white border border-gray-300 rounded text-sm text-gray-600 hover:bg-gray-100 active:scale-95 active:bg-gray-200 transition-all">
              검색
            </button>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          {/* Table Header Bar */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-white">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-700">사용자 목록</h3>
              <span className="text-xs text-gray-400">
                {hasFilters && `검색결과 ${filteredUsers.length}건 / `}총 {users.length}명
              </span>
            </div>
            <div className="flex items-center gap-2">
              {/* Column settings */}
              <div className="relative" ref={columnSettingsRef}>
                <button onClick={() => setShowColumnSettings(v => !v)}
                  className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${showColumnSettings ? 'bg-slate-100 text-slate-700 border-slate-400' : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'}`}>
                  ⚙ 컬럼
                </button>
                {showColumnSettings && (
                  <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-lg shadow-xl border border-gray-200 z-50 py-2">
                    <div className="px-3 pb-2 mb-1 border-b border-gray-100 flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-700">표시할 컬럼</span>
                      <button onClick={resetColumns} className="text-[10px] text-indigo-600 hover:underline">기본값</button>
                    </div>
                    <div className="max-h-64 overflow-y-auto">
                      {ALL_COLUMNS.map(col => (
                        <label key={col.id} className={`flex items-center gap-2 px-3 py-1 text-xs cursor-pointer hover:bg-gray-50 ${col.fixed ? 'opacity-60' : ''}`}>
                          <input type="checkbox" checked={visibleColumns.includes(col.id)} disabled={col.fixed}
                            onChange={() => toggleColumn(col.id)}
                            className="w-3 h-3 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                          <span className="text-gray-700">{col.label}</span>
                          {col.fixed && <span className="text-[9px] text-gray-400 ml-auto">필수</span>}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {/* Per page */}
              <select value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setCurrentPage(1); }}
                className="px-2 py-1.5 border border-gray-300 rounded text-xs bg-white">
                {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}개씩 보기</option>)}
              </select>
            </div>
          </div>

          {/* Data Table */}
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
            </div>
          ) : paginated.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">
              {hasFilters ? (
                <><span>검색 결과가 없습니다.</span><br />
                  <button onClick={clearAll} className="text-indigo-600 hover:underline text-sm mt-1">검색 초기화</button></>
              ) : '등록된 사용자가 없습니다.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-gray-200 whitespace-nowrap">
                    <th className="w-8 px-2 py-2 border-r border-gray-200">
                      <input type="checkbox" checked={allSelected} onChange={toggleAll}
                        className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                    </th>
                    {isCol('no') && <th className="w-10 px-2 py-2 text-center text-xs font-semibold text-gray-600 border-r border-gray-200">No</th>}
                    {isCol('username') && <th className="min-w-[100px] px-2 py-2 text-left text-xs font-semibold text-gray-600 border-r border-gray-200">아이디</th>}
                    {isCol('name') && <th className="min-w-[80px] px-2 py-2 text-left text-xs font-semibold text-gray-600 border-r border-gray-200">이름</th>}
                    {isCol('role') && <th className="w-20 px-2 py-2 text-center text-xs font-semibold text-gray-600 border-r border-gray-200">역할</th>}
                    {isCol('farmId') && <th className="min-w-[90px] px-2 py-2 text-left text-xs font-semibold text-gray-600 border-r border-gray-200">소속농장</th>}
                    {isCol('enabled') && <th className="w-16 px-2 py-2 text-center text-xs font-semibold text-gray-600 border-r border-gray-200">상태</th>}
                    {isCol('lastLogin') && <th className="w-24 px-2 py-2 text-center text-xs font-semibold text-gray-600 border-r border-gray-200">마지막로그인</th>}
                    {isCol('createdAt') && <th className="w-24 px-2 py-2 text-center text-xs font-semibold text-gray-600 border-r border-gray-200">등록일</th>}
                    <th className="w-24 px-2 py-2 text-center text-xs font-semibold text-gray-600">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((u, idx) => {
                    const isSelf = u._id === currentUser?._id;
                    const canManage = !isSelf && canManageRole(u.role);
                    const isFocused = focusedIdx === idx;
                    const selected = selectedIds.includes(u._id);
                    const rl = ROLE_LIGHT[u.role] || ROLE_LIGHT.worker;

                    return (
                      <tr key={u._id}
                        className={`border-b border-gray-100 transition-colors whitespace-nowrap ${
                          isFocused ? 'ring-2 ring-inset ring-indigo-400 bg-indigo-50/50' :
                          selected ? 'bg-indigo-50/50' :
                          !u.enabled ? 'bg-gray-50/50 opacity-60' :
                          idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'
                        } hover:bg-indigo-50/40`}>
                        <td className="px-2 py-1.5 text-center border-r border-gray-100">
                          <input type="checkbox" checked={selected} onChange={() => toggleOne(u._id)}
                            className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                        </td>
                        {isCol('no') && <td className="px-2 py-1.5 text-center text-[11px] text-gray-400 border-r border-gray-100">{(currentPage - 1) * perPage + idx + 1}</td>}
                        {isCol('username') && <td className="px-2 py-1.5 border-r border-gray-100">
                          <span className="text-[11px] font-mono text-gray-500">@{u.username}</span>
                        </td>}
                        {isCol('name') && <td className="px-2 py-1.5 border-r border-gray-100">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[13px] font-medium text-gray-800">{u.name}</span>
                            {isSelf && <span className="text-[9px] text-emerald-500 font-medium">(나)</span>}
                          </div>
                        </td>}
                        {isCol('role') && <td className="px-2 py-1.5 text-center border-r border-gray-100">
                          <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-medium ${rl.bg} ${rl.text}`}>
                            {getRoleLabel(u.role)}
                          </span>
                        </td>}
                        {isCol('farmId') && <td className="px-2 py-1.5 border-r border-gray-100">
                          <span className="text-[11px] font-mono text-gray-500">{u.farmId || '-'}</span>
                        </td>}
                        {isCol('enabled') && <td className="px-2 py-1.5 text-center border-r border-gray-100">
                          {canManage ? (
                            <button onClick={() => toggleUser(u._id)}
                              className={`w-9 h-[18px] rounded-full transition-all relative inline-block ${u.enabled ? 'bg-emerald-500' : 'bg-gray-300'}`}>
                              <div className={`absolute top-[2px] w-[14px] h-[14px] bg-white rounded-full shadow transition-all ${u.enabled ? 'left-[18px]' : 'left-[2px]'}`} />
                            </button>
                          ) : (
                            <span className={`text-[10px] font-medium ${u.enabled ? 'text-emerald-600' : 'text-gray-400'}`}>
                              {u.enabled ? '활성' : '비활성'}
                            </span>
                          )}
                        </td>}
                        {isCol('lastLogin') && <td className="px-2 py-1.5 text-center text-[11px] text-gray-400 border-r border-gray-100">
                          {u.lastLoginAt ? fmt(u.lastLoginAt) : <span className="text-gray-300">없음</span>}
                        </td>}
                        {isCol('createdAt') && <td className="px-2 py-1.5 text-center text-[11px] text-gray-400 border-r border-gray-100">
                          {fmtFull(u.createdAt)}
                        </td>}
                        <td className="px-2 py-1.5 text-center">
                          <div className="flex items-center justify-center gap-0.5">
                            {(canManage || isSelf) && (
                              <button onClick={() => { setEditingUser(u); setShowForm(true); }} title="수정"
                                className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                              </button>
                            )}
                            {canManage && (
                              <button onClick={() => deleteUser(u._id, u.username)} title="삭제"
                                className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1 py-3 border-t border-gray-200 bg-white">
              <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1}
                className="px-2 py-1 text-xs text-gray-500 hover:text-indigo-600 disabled:text-gray-300 disabled:cursor-not-allowed">&laquo;</button>
              <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1}
                className="px-2 py-1 text-xs text-gray-500 hover:text-indigo-600 disabled:text-gray-300 disabled:cursor-not-allowed">&lsaquo;</button>
              {pageNums.map(p => (
                <button key={p} onClick={() => setCurrentPage(p)}
                  className={`min-w-[28px] h-7 rounded text-xs font-medium transition-colors ${p === currentPage ? 'bg-indigo-600 text-white' : 'text-gray-600 hover:bg-indigo-50 hover:text-indigo-600'}`}>
                  {p}
                </button>
              ))}
              <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}
                className="px-2 py-1 text-xs text-gray-500 hover:text-indigo-600 disabled:text-gray-300 disabled:cursor-not-allowed">&rsaquo;</button>
              <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}
                className="px-2 py-1 text-xs text-gray-500 hover:text-indigo-600 disabled:text-gray-300 disabled:cursor-not-allowed">&raquo;</button>
            </div>
          )}

          {/* Keyboard hints */}
          <div className="px-4 py-1.5 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-400 flex gap-4">
            <span>J/K 이동</span><span>Enter 편집</span><span>Esc 닫기</span>
          </div>

          {/* Batch Actions / Info Bar */}
          <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t border-gray-200">
            <div className="flex items-center gap-2 flex-wrap">
              {selectedIds.length > 0 && (
                <>
                  <span className="text-xs text-gray-500 font-medium">{selectedIds.length}명 선택</span>
                  <span className="w-px h-5 bg-gray-300" />
                  <div className="flex items-center gap-1">
                    <select value={batchRole} onChange={e => setBatchRole(e.target.value)}
                      className="px-2 py-1 border border-gray-300 rounded text-xs bg-white">
                      <option value="">역할 선택...</option>
                      {creatableRoles.map(r => <option key={r} value={r}>{getRoleLabel(r)}</option>)}
                    </select>
                    <button onClick={() => batchRole && handleBatchAction('changeRole', batchRole)}
                      disabled={!batchRole}
                      className="px-2 py-1 bg-violet-600 text-white rounded text-xs font-medium hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                      변경
                    </button>
                  </div>
                  <span className="w-px h-5 bg-gray-300" />
                  <button onClick={() => handleBatchAction('enable')}
                    className="px-3 py-1 bg-emerald-600 text-white rounded text-xs font-medium hover:bg-emerald-700 transition-colors">
                    활성화
                  </button>
                  <button onClick={() => handleBatchAction('disable')}
                    className="px-3 py-1 bg-gray-500 text-white rounded text-xs font-medium hover:bg-gray-600 transition-colors">
                    비활성화
                  </button>
                  <button onClick={() => handleBatchAction('delete')}
                    className="px-3 py-1 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700 transition-colors">
                    삭제
                  </button>
                </>
              )}
            </div>
            <div className="text-xs text-gray-400">
              {filteredUsers.length > 0 && `${(currentPage - 1) * perPage + 1}-${Math.min(currentPage * perPage, filteredUsers.length)} / ${filteredUsers.length}명`}
            </div>
          </div>
        </div>

        {/* UserForm Modal */}
        {showForm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget) { setShowForm(false); setEditingUser(null); } }}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 p-6">
              <UserFormLight
                user={editingUser}
                creatableRoles={creatableRoles}
                roleHierarchy={ROLE_HIERARCHY}
                isSystemWide={isSystemWide}
                currentFarmId={currentUser?.farmId}
                farmIds={farmIds}
                existingUsernames={users.map(u => u.username)}
                onSave={() => { setShowForm(false); setEditingUser(null); loadUsers(); }}
                onCancel={() => { setShowForm(false); setEditingUser(null); }}
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ═══════════════════ RENDER: Card View (owner/worker) ═══════════════════ */
  return (
    <div className="max-w-4xl mx-auto px-4 md:px-6 py-4 md:py-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-800 tracking-tight">사용자 관리</h1>
          <p className="text-gray-500 text-sm md:text-base mt-0.5">계정 생성 및 권한 관리</p>
        </div>
        {creatableRoles.length > 0 && (
          <button onClick={() => { setEditingUser(null); setShowForm(true); }} className="btn-primary">
            + 사용자 추가
          </button>
        )}
      </div>

      {/* 역할 범례 */}
      <div className="glass-card p-3 mb-4 flex flex-wrap gap-3">
        {Object.entries(ROLE_HIERARCHY || {}).map(([role, info]) => {
          const style = getRoleStyle(role);
          return (
            <div key={role} className="flex items-center gap-1.5 text-xs">
              <span className={`w-2 h-2 rounded-full ${style.dot}`} />
              <span className="text-gray-500">{info.label}</span>
            </div>
          );
        })}
      </div>

      {/* 사용자 추가/편집 폼 */}
      {showForm && (
        <UserForm
          user={editingUser}
          creatableRoles={creatableRoles}
          roleHierarchy={ROLE_HIERARCHY}
          isSystemWide={isSystemWide}
          currentFarmId={currentUser?.farmId}
          existingUsernames={users.map(u => u.username)}
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
          {users.map(u => {
            const style = getRoleStyle(u.role);
            const isSelf = u._id === currentUser?._id;
            const canManage = !isSelf && canManageRole(u.role);

            return (
              <div key={u._id} className={`glass-card p-4 flex items-center gap-4 ${!u.enabled ? 'opacity-50' : ''}`}>
                <div className={`w-10 h-10 bg-gradient-to-br rounded-xl
                              flex items-center justify-center text-base text-white font-bold flex-shrink-0 ${
                                u.role === 'superadmin' ? 'from-violet-400 to-purple-600' :
                                u.role === 'manager' ? 'from-blue-400 to-indigo-600' :
                                u.role === 'owner' ? 'from-emerald-400 to-teal-600' :
                                'from-gray-400 to-slate-600'
                              }`}>
                  {u.name?.charAt(0) || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-800">{u.name}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${style.bg} ${style.text}`}>
                      {getRoleLabel(u.role)}
                    </span>
                    {isSelf && <span className="text-[10px] text-emerald-600">(나)</span>}
                  </div>
                  <p className="text-[10px] text-gray-500">
                    @{u.username} · {u.farmId || ''} · 마지막 로그인: {u.lastLoginAt
                      ? new Date(u.lastLoginAt).toLocaleDateString('ko-KR')
                      : '없음'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {canManage && (
                    <button onClick={() => toggleUser(u._id)}
                      className={`w-10 h-5 rounded-full transition-all relative ${u.enabled ? 'bg-emerald-500' : 'bg-gray-600'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${u.enabled ? 'left-5' : 'left-0.5'}`} />
                    </button>
                  )}
                  {(canManage || isSelf) && (
                    <button onClick={() => { setEditingUser(u); setShowForm(true); }}
                      className="p-1.5 rounded-lg text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 text-xs">✏️</button>
                  )}
                  {canManage && (
                    <button onClick={() => deleteUser(u._id, u.username)}
                      className="p-1.5 rounded-lg text-gray-500 hover:text-rose-400 hover:bg-rose-500/10 text-xs">🗑️</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ─── UserForm (카드뷰 - owner/worker 전용) ─── */
const UserForm = ({ user, creatableRoles, roleHierarchy, isSystemWide, currentFarmId, existingUsernames = [], onSave, onCancel }) => {
  const [form, setForm] = useState({
    username: user?.username || '',
    password: '',
    name: user?.name || '',
    role: user?.role || creatableRoles[creatableRoles.length - 1] || 'worker',
    farmId: user?.farmId || currentFarmId || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 아이디 중복 확인
  const usernameStatus = useMemo(() => {
    if (user) return null;
    const val = form.username.trim();
    if (!val) return null;
    if (val.length < 3) return { ok: false, msg: '3자 이상 입력' };
    if (existingUsernames.includes(val)) return { ok: false, msg: '이미 사용 중' };
    return { ok: true, msg: '사용 가능' };
  }, [form.username, existingUsernames, user]);

  const handleSave = async () => {
    if (!form.username || !form.name) return setError('ID와 이름은 필수입니다');
    if (!user && !form.password) return setError('비밀번호는 필수입니다');
    if (!user && usernameStatus && !usernameStatus.ok) return setError('사용할 수 없는 아이디입니다');
    setSaving(true); setError('');
    try {
      const data = { ...form };
      if (!data.password) delete data.password;
      if (user?._id) await axios.put(`${API_BASE_URL}/auth/users/${user._id}`, data);
      else await axios.post(`${API_BASE_URL}/auth/users`, data);
      onSave();
    } catch (err) { setError(err.response?.data?.error || err.message); }
    finally { setSaving(false); }
  };

  const getRoleLabel = (role) => roleHierarchy?.[role]?.label || role;

  return (
    <div className="glass-card p-5 mb-5 border border-indigo-200 animate-fade-in-up">
      <h2 className="text-base font-bold text-indigo-700 mb-4">{user ? '사용자 수정' : '새 사용자 추가'}</h2>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="text-[10px] text-gray-600 mb-1 block font-medium">사용자 ID</label>
          <div className="relative">
            <input type="text" value={form.username} disabled={!!user}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              className={`input-field text-xs disabled:opacity-50 pr-7 ${usernameStatus ? (usernameStatus.ok ? 'ring-1 ring-green-400 border-green-400' : 'ring-1 ring-red-400 border-red-400') : ''}`} placeholder="worker01" />
            {usernameStatus && (
              <span className={`absolute right-2 top-1/2 -translate-y-1/2 ${usernameStatus.ok ? 'text-green-600' : 'text-red-500'}`}>
                {usernameStatus.ok
                  ? <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                  : <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>}
              </span>
            )}
          </div>
          {usernameStatus && (
            <p className={`text-[10px] mt-0.5 ${usernameStatus.ok ? 'text-green-600' : 'text-red-500'}`}>{usernameStatus.msg}</p>
          )}
        </div>
        <div>
          <label className="text-[10px] text-gray-600 mb-1 block font-medium">{user ? '새 비밀번호 (변경 시)' : '비밀번호'}</label>
          <input type="password" value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            className="input-field text-xs" placeholder="••••" />
        </div>
        <div>
          <label className="text-[10px] text-gray-600 mb-1 block font-medium">이름</label>
          <input type="text" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="input-field text-xs" placeholder="홍길동" />
        </div>
        <div>
          <label className="text-[10px] text-gray-600 mb-1 block font-medium">역할</label>
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="input-field text-xs">
            {creatableRoles.map(role => (
              <option key={role} value={role}>{getRoleLabel(role)}</option>
            ))}
          </select>
        </div>
        {isSystemWide && (
          <div className="col-span-2">
            <label className="text-[10px] text-gray-600 mb-1 block font-medium">소속 농장 ID</label>
            <input type="text" value={form.farmId}
              onChange={(e) => setForm({ ...form, farmId: e.target.value })}
              className="input-field text-xs" placeholder="farm_0001" />
          </div>
        )}
      </div>
      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
      <div className="flex gap-3">
        <button onClick={handleSave} disabled={saving} className="flex-1 btn-primary disabled:opacity-50">
          {saving ? '저장 중...' : (user ? '수정' : '생성')}
        </button>
        <button onClick={onCancel} className="btn-secondary">취소</button>
      </div>
    </div>
  );
};

/* ─── UserFormLight (테이블뷰 light theme 모달) ─── */
const UserFormLight = ({ user, creatableRoles, roleHierarchy, isSystemWide, currentFarmId, farmIds = [], existingUsernames = [], onSave, onCancel }) => {
  const [form, setForm] = useState({
    username: user?.username || '',
    password: '',
    name: user?.name || '',
    role: user?.role || creatableRoles[creatableRoles.length - 1] || 'worker',
    farmId: user?.farmId || currentFarmId || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // 아이디 중복 확인
  const usernameStatus = useMemo(() => {
    if (user) return null; // 수정 모드에서는 체크 불필요
    const val = form.username.trim();
    if (!val) return null;
    if (val.length < 3) return { ok: false, msg: '3자 이상 입력' };
    if (existingUsernames.includes(val)) return { ok: false, msg: '이미 사용 중' };
    return { ok: true, msg: '사용 가능' };
  }, [form.username, existingUsernames, user]);

  // 농장 검색 상태
  const [farms, setFarms] = useState([]);
  const [farmSearch, setFarmSearch] = useState(user?.farmId || currentFarmId || '');
  const [selectedFarm, setSelectedFarm] = useState(null);
  const [showFarmDropdown, setShowFarmDropdown] = useState(false);
  const farmSearchRef = React.useRef(null);

  // 농장 목록 로드
  React.useEffect(() => {
    if (!isSystemWide) return;
    const loadFarms = async () => {
      try {
        const res = await axios.get(`${API_BASE_URL}/farms?limit=200`);
        if (res.data.success) setFarms(res.data.data || []);
      } catch { /* ignore */ }
    };
    loadFarms();
  }, [isSystemWide]);

  // 편집 시 기존 농장 자동 선택
  React.useEffect(() => {
    if (form.farmId && farms.length > 0 && !selectedFarm) {
      const f = farms.find(f => f.farmId === form.farmId);
      if (f) { setSelectedFarm(f); setFarmSearch(f.farmId); }
    }
  }, [farms, form.farmId, selectedFarm]);

  // 농장 검색 필터
  const filteredFarms = React.useMemo(() => {
    const q = farmSearch.trim().toLowerCase();
    if (!q) return farms.slice(0, 10);
    return farms.filter(f =>
      f.farmId?.toLowerCase().includes(q) ||
      f.name?.toLowerCase().includes(q) ||
      f.ownerName?.toLowerCase().includes(q)
    ).slice(0, 10);
  }, [farms, farmSearch]);

  // 농장 선택
  const selectFarm = (farm) => {
    setSelectedFarm(farm);
    setFarmSearch(farm.farmId);
    setForm(prev => ({ ...prev, farmId: farm.farmId }));
    setShowFarmDropdown(false);
  };

  // 농장 선택 해제
  const clearFarm = () => {
    setSelectedFarm(null);
    setFarmSearch('');
    setForm(prev => ({ ...prev, farmId: '' }));
  };

  const handleSave = async () => {
    if (!form.username || !form.name) return setError('ID와 이름은 필수입니다');
    if (!user && !form.password) return setError('비밀번호는 필수입니다');
    if (!user && usernameStatus && !usernameStatus.ok) return setError('사용할 수 없는 아이디입니다');
    if (isSystemWide && !form.farmId) return setError('소속 농장을 선택해주세요');
    setSaving(true); setError('');
    try {
      const data = { ...form };
      if (!data.password) delete data.password;
      if (user?._id) await axios.put(`${API_BASE_URL}/auth/users/${user._id}`, data);
      else await axios.post(`${API_BASE_URL}/auth/users`, data);
      onSave();
    } catch (err) { setError(err.response?.data?.error || err.message); }
    finally { setSaving(false); }
  };

  const getRoleLabel = (role) => roleHierarchy?.[role]?.label || role;
  const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 disabled:bg-gray-100 disabled:text-gray-500";

  return (
    <>
      <h2 className="text-lg font-bold text-gray-800 mb-5">{user ? '사용자 수정' : '새 사용자 추가'}</h2>

      {/* ① 소속 농장 선택 (시스템 전역 역할만) */}
      {isSystemWide && (
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center justify-center w-5 h-5 bg-indigo-600 text-white text-[10px] font-bold rounded-full">1</span>
            <label className="text-sm text-gray-700 font-semibold">소속 농장 선택</label>
          </div>

          {!selectedFarm ? (
            <div className="relative" ref={farmSearchRef}>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input type="text" value={farmSearch}
                  onChange={(e) => { setFarmSearch(e.target.value); setShowFarmDropdown(true); }}
                  onFocus={() => setShowFarmDropdown(true)}
                  onBlur={() => setTimeout(() => setShowFarmDropdown(false), 200)}
                  placeholder="농장 ID, 농장명 또는 대표자명으로 검색..."
                  className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30" />
              </div>
              {showFarmDropdown && filteredFarms.length > 0 && (
                <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                  {filteredFarms.map(f => (
                    <button key={f.farmId} type="button"
                      onMouseDown={(e) => { e.preventDefault(); selectFarm(f); }}
                      className="w-full text-left px-3 py-2.5 hover:bg-indigo-50 border-b border-gray-100 last:border-0 transition-colors">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-sm font-medium text-gray-800">{f.name}</span>
                          <span className="text-xs text-gray-400 ml-2">{f.farmId}</span>
                        </div>
                        {f.status === 'active' ?
                          <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-600 rounded">운영중</span> :
                          <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">{f.status}</span>}
                      </div>
                      <div className="text-[11px] text-gray-500 mt-0.5">
                        {f.ownerName && <span>대표: {f.ownerName}</span>}
                        {f.location && <span className="ml-2">{f.location}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {showFarmDropdown && farmSearch.trim() && filteredFarms.length === 0 && (
                <div className="absolute z-50 left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-4 text-center text-sm text-gray-400">
                  검색 결과가 없습니다
                </div>
              )}
            </div>
          ) : (
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-gray-800">{selectedFarm.name}</span>
                    <span className="text-xs text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded font-mono">{selectedFarm.farmId}</span>
                  </div>
                  {selectedFarm.ownerName && (
                    <div className="flex items-center gap-1 text-sm text-gray-600">
                      <svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                      <span>대표: <strong>{selectedFarm.ownerName}</strong></span>
                      {selectedFarm.ownerPhone && <span className="text-gray-400 ml-1">({selectedFarm.ownerPhone})</span>}
                    </div>
                  )}
                  {selectedFarm.location && (
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      {selectedFarm.location}
                    </div>
                  )}
                  {selectedFarm.managers?.length > 0 && selectedFarm.managers[0]?.name && (
                    <div className="text-xs text-gray-500">
                      관리자: {selectedFarm.managers.map(m => m.name).filter(Boolean).join(', ')}
                    </div>
                  )}
                </div>
                <button type="button" onClick={clearFarm}
                  className="text-xs text-gray-400 hover:text-red-500 px-2 py-1 rounded hover:bg-red-50 transition-colors">
                  변경
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ② 사용자 정보 */}
      <div className="mb-4">
        {isSystemWide && (
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center justify-center w-5 h-5 bg-indigo-600 text-white text-[10px] font-bold rounded-full">2</span>
            <label className="text-sm text-gray-700 font-semibold">사용자 정보</label>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-600 mb-1 block font-medium">사용자 ID</label>
            <div className="relative">
              <input type="text" value={form.username} disabled={!!user}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                className={`${inputCls} pr-8 ${usernameStatus ? (usernameStatus.ok ? 'ring-1 ring-green-400 border-green-400' : 'ring-1 ring-red-400 border-red-400') : ''}`} placeholder="worker01" />
              {usernameStatus && (
                <span className={`absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium ${usernameStatus.ok ? 'text-green-600' : 'text-red-500'}`}>
                  {usernameStatus.ok
                    ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                    : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>}
                </span>
              )}
            </div>
            {usernameStatus && (
              <p className={`text-[10px] mt-0.5 ${usernameStatus.ok ? 'text-green-600' : 'text-red-500'}`}>{usernameStatus.msg}</p>
            )}
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1 block font-medium">{user ? '새 비밀번호' : '비밀번호'}</label>
            <input type="password" value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className={inputCls} placeholder="••••" />
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1 block font-medium">이름</label>
            <input type="text" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputCls} placeholder="홍길동" />
          </div>
          <div>
            <label className="text-xs text-gray-600 mb-1 block font-medium">역할</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={inputCls}>
              {creatableRoles.map(role => (
                <option key={role} value={role}>{getRoleLabel(role)}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
      <div className="flex gap-3 pt-2">
        <button onClick={handleSave} disabled={saving || (isSystemWide && !form.farmId)}
          className="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 active:scale-95 disabled:opacity-50 transition-all">
          {saving ? '저장 중...' : (user ? '수정' : '생성')}
        </button>
        <button onClick={onCancel}
          className="px-4 py-2.5 bg-white border border-gray-300 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-50 active:scale-95 transition-all">
          취소
        </button>
      </div>
    </>
  );
};

export default UserManager;
