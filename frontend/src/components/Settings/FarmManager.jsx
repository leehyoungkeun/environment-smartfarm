import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';
import Fuse from 'fuse.js';
import { useAuth } from '../../contexts/AuthContext';
import * as XLSX from 'xlsx';

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';
const KAKAO_KEY = import.meta.env.VITE_KAKAO_MAP_KEY || '';
const emptyManager = { name: '', phone: '', email: '' };

/* ── FarmMapView (카카오맵) ── */
function FarmMapView({ farms, onSelect }) {
  const mapRef = React.useRef(null);
  const [mapReady, setMapReady] = React.useState(false);
  const [mapError, setMapError] = React.useState('');

  React.useEffect(() => {
    if (!KAKAO_KEY) {
      setMapError('카카오맵 API Key가 설정되지 않았습니다.\n.env에 VITE_KAKAO_MAP_KEY를 추가하세요.');
      return;
    }
    // 이미 로드된 경우
    if (window.kakao?.maps?.services) {
      setMapReady(true);
      return;
    }
    // 스크립트 로드
    const script = document.createElement('script');
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${KAKAO_KEY}&libraries=services&autoload=false`;
    script.onload = () => {
      window.kakao.maps.load(() => setMapReady(true));
    };
    script.onerror = () => setMapError('카카오맵 스크립트 로드 실패');
    document.head.appendChild(script);
  }, []);

  React.useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const kakao = window.kakao;
    const container = mapRef.current;
    const map = new kakao.maps.Map(container, {
      center: new kakao.maps.LatLng(35.9078, 127.7669), // 한국 중심
      level: 12,
    });

    const geocoder = new kakao.maps.services.Geocoder();
    const bounds = new kakao.maps.LatLngBounds();
    let markerCount = 0;

    const farmsWithLocation = farms.filter(f => f.location?.trim());
    if (farmsWithLocation.length === 0) return;

    farmsWithLocation.forEach(farm => {
      geocoder.addressSearch(farm.location, (result, status) => {
        if (status === kakao.maps.services.Status.OK) {
          const position = new kakao.maps.LatLng(result[0].y, result[0].x);
          const marker = new kakao.maps.Marker({ map, position });

          const content = `<div style="padding:8px 12px;background:#fff;border-radius:8px;border:1px solid #e2e8f0;box-shadow:0 2px 8px rgba(0,0,0,0.1);min-width:120px">
            <div style="font-size:13px;font-weight:700;color:#1e293b;margin-bottom:2px">${farm.name}</div>
            <div style="font-size:11px;color:#64748b">${farm.farmId}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:2px">${farm.location?.split(' ').slice(0, 3).join(' ') || ''}</div>
          </div>`;
          const infoWindow = new kakao.maps.InfoWindow({ content });

          kakao.maps.event.addListener(marker, 'mouseover', () => infoWindow.open(map, marker));
          kakao.maps.event.addListener(marker, 'mouseout', () => infoWindow.close());
          kakao.maps.event.addListener(marker, 'click', () => onSelect?.(farm));

          bounds.extend(position);
          markerCount++;
          if (markerCount === farmsWithLocation.length || markerCount > 0) {
            map.setBounds(bounds);
          }
        }
      });
    });
  }, [mapReady, farms, onSelect]);

  if (mapError) {
    return (
      <div className="p-8 text-center">
        <div className="text-3xl mb-3 opacity-40">🗺️</div>
        <p className="text-sm text-gray-500 whitespace-pre-line">{mapError}</p>
        <div className="mt-4 bg-gray-50 rounded-lg p-4 text-left">
          <p className="text-xs text-gray-500 mb-2 font-medium">설정 방법:</p>
          <ol className="text-xs text-gray-500 space-y-1 list-decimal list-inside">
            <li><a href="https://developers.kakao.com" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Kakao Developers</a> 접속 후 앱 생성</li>
            <li>앱 설정 → 플랫폼 → Web 도메인 등록 (http://localhost:5174)</li>
            <li>앱 키 → JavaScript 키 복사</li>
            <li><code className="bg-gray-200 px-1 rounded text-[11px]">frontend/.env</code>에 <code className="bg-gray-200 px-1 rounded text-[11px]">VITE_KAKAO_MAP_KEY=키값</code> 추가</li>
          </ol>
        </div>
        {/* 주소 없는 농장도 테이블로 표시 */}
        <div className="mt-4">
          <h5 className="text-xs font-semibold text-gray-600 mb-2 text-left">농장 주소 현황</h5>
          <div className="max-h-48 overflow-auto border border-gray-200 rounded text-left">
            <table className="w-full text-xs">
              <thead><tr className="bg-gray-50"><th className="px-3 py-1.5 text-left">농장</th><th className="px-3 py-1.5 text-left">주소</th><th className="px-3 py-1.5 text-center">상태</th></tr></thead>
              <tbody>
                {farms.map(f => (
                  <tr key={f.farmId} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => onSelect?.(f)}>
                    <td className="px-3 py-1.5 font-medium">{f.name}</td>
                    <td className="px-3 py-1.5 text-gray-500">{f.location || <span className="text-gray-300">주소 없음</span>}</td>
                    <td className="px-3 py-1.5 text-center"><span className={`px-1.5 py-0.5 rounded text-[10px] ${f.location ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{f.location ? '위치있음' : '미등록'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div ref={mapRef} style={{ width: '100%', height: '500px' }} />
      <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 rounded-b-lg">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">
            주소 등록된 농장: {farms.filter(f => f.location?.trim()).length}개 / 전체 {farms.length}개
          </span>
          <span className="text-[11px] text-gray-400">마커를 클릭하면 농장 상세를 볼 수 있습니다</span>
        </div>
      </div>
    </div>
  );
}

const STATUS = {
  active: { label: '운전중', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  expired: { label: '계약만료', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
  maintenance: { label: '점검중', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  deleted: { label: '삭제됨', cls: 'bg-red-100 text-red-500 border-red-200' },
};
const ROLE_LABEL = { admin: '관리자', manager: '매니저', worker: '작업자', viewer: '뷰어' };
const FARM_TYPE_LABEL = { single_house: '단동하우스', multi_house: '연동하우스', open_field: '노지' };
const SYSTEM_TYPE_LABEL = { env_control: '환경제어', nutrient_control: '양액제어', irrigation_control: '관수제어', env_nutrient_complex: '환경양액복합', env_irrigation_complex: '환경관수복합', other: '기타' };
const PERM_LABELS = { view: '조회', control: '제어', config: '설정', report: '리포트', automation: '자동화', journal: '영농일지' };
const DEFAULT_PERMS = {
  admin: { view: true, control: true, config: true, report: true, automation: true, journal: true },
  worker: { view: true, control: true, config: false, report: true, automation: false, journal: true },
  viewer: { view: true, control: false, config: false, report: true, automation: false, journal: false },
};
const SCHEDULE_TYPE = { inspection: '정기점검', trouble: '장애처리', consulting: '고객상담', other: '기타' };
const SCHEDULE_TYPE_CLS = { inspection: 'bg-blue-100 text-blue-700', trouble: 'bg-red-100 text-red-700', consulting: 'bg-teal-100 text-teal-700', other: 'bg-gray-100 text-gray-600' };
const SCHEDULE_PRIORITY = { low: '낮음', normal: '보통', high: '높음', urgent: '긴급' };
const DOC_CATEGORY = { contract: '계약서', manual: '매뉴얼', photo: '사진', other: '기타' };
const DOC_CATEGORY_CLS = { contract: 'bg-blue-100 text-blue-700', manual: 'bg-purple-100 text-purple-700', photo: 'bg-emerald-100 text-emerald-700', other: 'bg-gray-100 text-gray-600' };
const formatFileSize = (bytes) => { if (bytes < 1024) return `${bytes}B`; if (bytes < 1048576) return `${(bytes/1024).toFixed(1)}KB`; return `${(bytes/1048576).toFixed(1)}MB`; };
const PER_PAGE_OPTIONS = [10, 20, 50, 100];

/* ── Column Customization ── */
const ALL_COLUMNS = [
  { id: 'no', label: 'No', default: true, fixed: true },
  { id: 'farmId', label: '농장ID', default: true },
  { id: 'name', label: '농장명', default: true, fixed: true },
  { id: 'manager', label: '대표자', default: true },
  { id: 'region', label: '지역', default: true },
  { id: 'farmType', label: '형태', default: false },
  { id: 'houseCount', label: '동', default: true },
  { id: 'farmArea', label: '면적', default: false },
  { id: 'systemType', label: '시스템', default: false },
  { id: 'status', label: '상태', default: true },
  { id: 'connection', label: '접속', default: true },
  { id: 'maintenance', label: '유지보수', default: true },
  { id: 'registeredAt', label: '등록일', default: true },
  { id: 'apiKey', label: 'API Key', default: false },
  { id: 'tags', label: '태그', default: false },
  { id: 'memo', label: '메모', default: false },
];
const DEFAULT_VISIBLE = ALL_COLUMNS.filter(c => c.default).map(c => c.id);

/* ───────────────────────── Component ───────────────────────── */
export default function FarmManager({ onNavigateFarm }) {
  const { selectFarm, selectedFarmId, user, roleLabel } = useAuth();
  const actionSource = `${roleLabel || ''} ${user?.name || user?.username || 'unknown'}`.trim();

  /* ── State ── */
  const [farms, setFarms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Search / Filter
  const [search, setSearch] = useState('');
  const [searchField, setSearchField] = useState('all');
  const [region, setRegion] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [connectionFilter, setConnectionFilter] = useState('');
  const [maintFilter, setMaintFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Table — sessionStorage로 페이지 복원
  const [currentPage, setCurrentPage] = useState(() => {
    const saved = sessionStorage.getItem('farmManager_page');
    return saved ? Number(saved) : 1;
  });
  const [perPage, setPerPage] = useState(() => {
    const saved = sessionStorage.getItem('farmManager_perPage');
    return saved ? Number(saved) : 20;
  });
  const [selectedIds, setSelectedIds] = useState([]);
  const [copiedKey, setCopiedKey] = useState(null);

  // Form modal
  const [showForm, setShowForm] = useState(false);
  const [editFarm, setEditFarm] = useState(null);
  const [autoId, setAutoId] = useState(true);
  const [formUsers, setFormUsers] = useState([]);
  const [mgrSearchIdx, setMgrSearchIdx] = useState(-1); // 자동완성 활성 관리자 인덱스
  const [form, setForm] = useState({
    farmId: '', name: '', location: '', managers: [{ ...emptyManager }],
    businessProjectId: '', businessType: '', totalCost: '', subsidyAmount: '', selfFunding: '',
    systemType: '', farmType: '', farmArea: '',
    registeredAt: '', maintenanceMonths: 12, maintenanceStartAt: '',
    status: 'active', memo: '', tags: [], representativeUserId: '',
  });
  // Business Projects
  const [businessProjects, setBusinessProjects] = useState([]);
  const [showNewBizForm, setShowNewBizForm] = useState(false);
  const [newBizName, setNewBizName] = useState('');

  // Detail modal
  const [detailFarm, setDetailFarm] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [farmUsers, setFarmUsers] = useState([]);
  const [farmHouses, setFarmHouses] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [assignUserId, setAssignUserId] = useState('');
  const [assignRole, setAssignRole] = useState('viewer');
  const [detailTab, setDetailTab] = useState('info');

  // API Key toggle
  const [showKeys, setShowKeys] = useState(false);

  // Excel import
  const [showImport, setShowImport] = useState(false);
  const [importData, setImportData] = useState([]);
  const [importResult, setImportResult] = useState(null);

  // Farm stats (detail)
  const [farmStats, setFarmStats] = useState(null);

  // Audit log (detail)
  const [auditLogs, setAuditLogs] = useState([]);
  const [expandedAuditId, setExpandedAuditId] = useState(null);

  // Connection history (detail)
  const [connHistory, setConnHistory] = useState(null);

  // Map view
  const [showMap, setShowMap] = useState(false);

  // Maintenance log
  const [maintLogs, setMaintLogs] = useState([]);
  const [maintSummary, setMaintSummary] = useState({ totalCost: 0, count: 0 });
  const [maintTypeFilter, setMaintTypeFilter] = useState('');
  const [showMaintForm, setShowMaintForm] = useState(false);
  const [editMaintLog, setEditMaintLog] = useState(null);
  const [maintForm, setMaintForm] = useState({ date: '', type: 'inspection', title: '', description: '', cost: '', technician: '', status: 'completed' });

  // Tags
  const [allTags, setAllTags] = useState([]);

  // House inline edit
  const [editHouseId, setEditHouseId] = useState(null);
  const [editHouseData, setEditHouseData] = useState({});

  // Farm notes
  const [farmNotes, setFarmNotes] = useState([]);
  const [newNote, setNewNote] = useState('');
  const [editNoteId, setEditNoteId] = useState(null);
  const [editNoteText, setEditNoteText] = useState('');

  // Farm alerts (detail modal)
  const [farmAlerts, setFarmAlerts] = useState([]);
  const [farmAlertFilter, setFarmAlertFilter] = useState('all'); // 'all' | 'unack' | 'acked'
  const [editResolutionId, setEditResolutionId] = useState(null);
  const [editResolutionText, setEditResolutionText] = useState('');

  // Trash (Feature: 휴지통)
  const [showTrash, setShowTrash] = useState(false);
  const [trashCount, setTrashCount] = useState(0);
  const [trashFarms, setTrashFarms] = useState([]);
  // Permissions (Feature: 권한 관리)
  const [editPermUserId, setEditPermUserId] = useState(null);
  const [editPerms, setEditPerms] = useState({});
  // Schedules (Feature: 일정)
  const [farmSchedules, setFarmSchedules] = useState([]);
  const [scheduleSummary, setScheduleSummary] = useState({ total: 0, completed: 0, upcoming: 0, overdue: 0 });
  const [scheduleFilter, setScheduleFilter] = useState('');
  const [scheduleShowCompleted, setScheduleShowCompleted] = useState(false);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [editScheduleId, setEditScheduleId] = useState(null);
  const [scheduleForm, setScheduleForm] = useState({ title: '', description: '', type: 'inspection', startDate: '', endDate: '', assignedTo: '', houseId: '', priority: 'normal' });
  const [scheduleViewMode, setScheduleViewMode] = useState('list'); // 'list' | 'calendar'
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  // Documents (Feature: 문서)
  const [farmDocuments, setFarmDocuments] = useState([]);
  const [docSummary, setDocSummary] = useState({ total: 0, totalSize: 0, byCategory: {} });
  const [docCategoryFilter, setDocCategoryFilter] = useState('');
  const [docUploading, setDocUploading] = useState(false);
  const [docCategory, setDocCategory] = useState('other');
  const [docDescription, setDocDescription] = useState('');
  // Backup (Feature: 백업/복원)
  const [restoreResult, setRestoreResult] = useState(null);
  const [restoring, setRestoring] = useState(false);
  // Schedule Summary (Feature: 일정 요약 카드)
  const [scheduleSummaryGlobal, setScheduleSummaryGlobal] = useState({ todayCount: 0, weekCount: 0, monthCount: 0, overdueCount: 0, todaySchedules: [], weekSchedules: [], monthSchedules: [], overdueSchedules: [] });
  const [showSchedulePanel, setShowSchedulePanel] = useState(false);
  const [schedulePanelTab, setSchedulePanelTab] = useState('today');

  // Column customization
  const [visibleColumns, setVisibleColumns] = useState(() => {
    try { const s = localStorage.getItem('farmManager_columns'); return s ? JSON.parse(s) : DEFAULT_VISIBLE; }
    catch { return DEFAULT_VISIBLE; }
  });
  const [showColumnSettings, setShowColumnSettings] = useState(false);
  const columnSettingsRef = React.useRef(null);

  // Pin / Favorites
  const [pinnedIds, setPinnedIds] = useState(() => {
    try { const s = localStorage.getItem('farmManager_pinned'); return s ? JSON.parse(s) : []; }
    catch { return []; }
  });

  // Keyboard navigation
  const [focusedIdx, setFocusedIdx] = useState(-1);

  // Context menu (우클릭)
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, farm }
  const ctxRef = useRef(null);

  // Alert summary cards
  const [alertSummary, setAlertSummary] = useState({ total: 0, offline: 0, sensorAlert: 0, maintenanceExpiring: 0, normal: 0, recentAlerts: 0, offlineFarmIds: [], sensorAlertFarmIds: [], maintExpiringFarmIds: [] });
  const [summaryFilter, setSummaryFilter] = useState(''); // 'offline' | 'sensorAlert' | 'maintenance' | 'normal' | ''

  // Alert feed panel
  const [showAlertFeed, setShowAlertFeed] = useState(false);
  const [alertFeedData, setAlertFeedData] = useState([]);
  const [alertFeedLoading, setAlertFeedLoading] = useState(false);
  const [alertFeedTab, setAlertFeedTab] = useState('unack'); // 'unack' | 'all'

  // Detail modal PDF ref
  const detailRef = React.useRef(null);
  const tagInputRef = React.useRef(null);

  /* ── Data Fetching ── */
  const fetchFarms = useCallback(async () => {
    try {
      const [res, tagRes, trashRes, schedRes, bizRes, alertRes] = await Promise.all([
        axios.get(`${API}/farms`),
        axios.get(`${API}/farms/tags/all`).catch(() => null),
        axios.get(`${API}/farms/trash/count`).catch(() => null),
        axios.get(`${API}/farms/schedules/summary`).catch(() => null),
        axios.get(`${API}/farms/business-projects`).catch(() => null),
        axios.get(`${API}/farms/alert-summary`).catch(() => null),
      ]);
      setFarms(res.data.data || []);
      if (tagRes) setAllTags(tagRes.data.data || []);
      if (trashRes) setTrashCount(trashRes.data.data?.count || 0);
      if (schedRes) setScheduleSummaryGlobal(schedRes.data.data || { todayCount: 0, weekCount: 0, monthCount: 0, overdueCount: 0, todaySchedules: [], weekSchedules: [], monthSchedules: [], overdueSchedules: [] });
      if (bizRes) setBusinessProjects(bizRes.data.data || []);
      if (alertRes) setAlertSummary(alertRes.data.data || alertSummary);
    } catch { setError('농장 목록 조회 실패'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchFarms(); }, [fetchFarms]);
  // 필터 변경 시 1페이지로 리셋 (초기 마운트 제외 — sessionStorage 복원값 보호)
  const filterMountRef = useRef(true);
  useEffect(() => {
    if (filterMountRef.current) { filterMountRef.current = false; return; }
    setCurrentPage(1);
  }, [search, region, statusFilter, connectionFilter, maintFilter, tagFilter, dateFrom, dateTo, summaryFilter]);

  // localStorage / sessionStorage sync
  useEffect(() => { localStorage.setItem('farmManager_columns', JSON.stringify(visibleColumns)); }, [visibleColumns]);
  useEffect(() => { localStorage.setItem('farmManager_pinned', JSON.stringify(pinnedIds)); }, [pinnedIds]);
  useEffect(() => { sessionStorage.setItem('farmManager_page', String(currentPage)); }, [currentPage]);
  useEffect(() => { sessionStorage.setItem('farmManager_perPage', String(perPage)); }, [perPage]);

  // Reset focus on page change
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

  // 에러 자동 해제 (5초)
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(''), 5000);
    return () => clearTimeout(t);
  }, [error]);

  // Alert feed auto-refresh (30s interval while panel is open)
  useEffect(() => {
    if (!showAlertFeed) return;
    const id = setInterval(() => { fetchAlertFeed(); }, 30000);
    return () => clearInterval(id);
  }, [showAlertFeed, alertFeedTab]);

  /* ── Helpers ── */
  const fmt = (d) => d ? new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '-';
  const toInput = (d) => d ? new Date(d).toISOString().split('T')[0] : '';

  const connStatus = (lastSeenAt) => {
    if (!lastSeenAt) return { label: '미접속', type: 'none', cls: 'text-gray-400' };
    const diff = Date.now() - new Date(lastSeenAt).getTime();
    if (diff < 5 * 60 * 1000) return { label: '온라인', type: 'online', cls: 'text-emerald-600' };
    if (diff < 60 * 60 * 1000) return { label: `${Math.floor(diff / 60000)}분 전`, type: 'warn', cls: 'text-amber-600' };
    const hours = Math.floor(diff / 3600000);
    if (hours < 24) return { label: `${hours}시간 전`, type: 'offline', cls: 'text-red-500' };
    const days = Math.floor(hours / 24);
    if (days < 30) return { label: `${days}일 전`, type: 'offline', cls: 'text-red-500' };
    return { label: '장기 오프라인', type: 'offline', cls: 'text-red-600 font-semibold' };
  };

  const connDot = { online: 'bg-emerald-500', warn: 'bg-amber-500', offline: 'bg-red-400 animate-pulse', none: 'bg-gray-300' };

  const maintBadge = (farm) => {
    const d = farm.maintenanceDaysLeft;
    if (d == null) return null;
    if (d <= 0) return { label: '만료', cls: 'bg-red-100 text-red-700' };
    if (d <= 30) return { label: `${d}일`, cls: 'bg-red-100 text-red-600' };
    if (d <= 90) return { label: `${d}일`, cls: 'bg-amber-100 text-amber-700' };
    return { label: `${d}일`, cls: 'bg-emerald-100 text-emerald-700' };
  };

  const getRegion = (loc) => loc ? loc.trim().split(/\s+/)[0] : '';

  const getMgrs = (farm) => {
    if (Array.isArray(farm.managers) && farm.managers.length > 0) return farm.managers;
    if (farm.ownerName) return [{ name: farm.ownerName, phone: farm.ownerPhone || '' }];
    return [];
  };

  /* ── Quick Date Setter ── */
  const setQuickDate = (type) => {
    const now = new Date();
    const to = now.toISOString().split('T')[0];
    const from = new Date(now);
    if (type === 'today') { /* noop */ }
    else if (type === '7d') from.setDate(from.getDate() - 7);
    else if (type === '1m') from.setMonth(from.getMonth() - 1);
    else if (type === '3m') from.setMonth(from.getMonth() - 3);
    else if (type === '1y') from.setFullYear(from.getFullYear() - 1);
    setDateFrom(from.toISOString().split('T')[0]);
    setDateTo(to);
  };

  /* ── Fuse.js ── */
  const FUSE_KEYS_MAP = {
    all: [
      { name: 'name', weight: 2 }, { name: 'farmId', weight: 1.5 },
      { name: 'location', weight: 1.5 }, { name: 'managers.name', weight: 1 },
      { name: 'managers.phone', weight: 0.8 }, { name: 'managers.email', weight: 0.8 },
      { name: 'ownerName', weight: 1 }, { name: 'memo', weight: 0.5 },
    ],
    name: [{ name: 'name', weight: 1 }],
    farmId: [{ name: 'farmId', weight: 1 }],
    location: [{ name: 'location', weight: 1 }],
    managers: [{ name: 'managers.name', weight: 1 }, { name: 'managers.phone', weight: 0.8 }, { name: 'managers.email', weight: 0.8 }],
  };
  const fuse = useMemo(() => new Fuse(farms, {
    keys: FUSE_KEYS_MAP[searchField] || FUSE_KEYS_MAP.all,
    threshold: searchField === 'farmId' ? 0.1 : 0.35,
    ignoreLocation: true, minMatchCharLength: 1,
  }), [farms, searchField]);

  const regions = useMemo(() =>
    [...new Set(farms.map(f => getRegion(f.location)).filter(Boolean))].sort(), [farms]);

  /* ── Filtering ── */
  const filteredFarms = useMemo(() => {
    let r;
    const q = search.trim();
    if (!q) {
      r = [...farms];
    } else if (searchField === 'farmId') {
      // farmId는 정확 매칭 우선 (포함 검색)
      const lower = q.toLowerCase();
      r = farms.filter(f => f.farmId?.toLowerCase().includes(lower));
      if (r.length === 0) r = fuse.search(q).map(x => x.item); // fallback fuzzy
    } else {
      r = fuse.search(q).map(x => x.item);
    }
    if (region) r = r.filter(f => getRegion(f.location) === region);
    if (statusFilter) r = r.filter(f => f.status === statusFilter);
    if (connectionFilter) {
      r = r.filter(f => {
        const c = connStatus(f.lastSeenAt).type;
        if (connectionFilter === 'online') return c === 'online';
        if (connectionFilter === 'offline') return c === 'offline' || c === 'none';
        return true;
      });
    }
    if (maintFilter === 'expiring') r = r.filter(f => f.maintenanceDaysLeft != null && f.maintenanceDaysLeft > 0 && f.maintenanceDaysLeft <= 90);
    else if (maintFilter === 'expired') r = r.filter(f => f.maintenanceDaysLeft != null && f.maintenanceDaysLeft <= 0);
    else if (maintFilter === 'normal') r = r.filter(f => f.maintenanceDaysLeft == null || f.maintenanceDaysLeft > 90);
    if (tagFilter) r = r.filter(f => Array.isArray(f.tags) && f.tags.includes(tagFilter));
    if (dateFrom) r = r.filter(f => f.registeredAt && new Date(f.registeredAt) >= new Date(dateFrom));
    if (dateTo) r = r.filter(f => f.registeredAt && new Date(f.registeredAt) <= new Date(dateTo + 'T23:59:59'));
    // 요약 카드 필터
    if (summaryFilter === 'offline') r = r.filter(f => alertSummary.offlineFarmIds.includes(f.farmId));
    else if (summaryFilter === 'sensorAlert') r = r.filter(f => alertSummary.sensorAlertFarmIds.includes(f.farmId));
    else if (summaryFilter === 'maintenance') r = r.filter(f => alertSummary.maintExpiringFarmIds.includes(f.farmId));
    else if (summaryFilter === 'normal') {
      const problemIds = new Set([...alertSummary.offlineFarmIds, ...alertSummary.sensorAlertFarmIds, ...alertSummary.maintExpiringFarmIds]);
      r = r.filter(f => !problemIds.has(f.farmId));
    }
    return r;
  }, [farms, search, region, statusFilter, connectionFilter, maintFilter, tagFilter, dateFrom, dateTo, fuse, summaryFilter, alertSummary]);

  /* ── Pagination ── */
  /* ── Pin Sort ── */
  const sortedFarms = useMemo(() => {
    if (pinnedIds.length === 0) return filteredFarms;
    const pinned = filteredFarms.filter(f => pinnedIds.includes(f.farmId));
    const rest = filteredFarms.filter(f => !pinnedIds.includes(f.farmId));
    return [...pinned, ...rest];
  }, [filteredFarms, pinnedIds]);

  const totalPages = Math.max(1, Math.ceil(sortedFarms.length / perPage));
  // 페이지 범위 초과 보정 (데이터 로딩 완료 후에만)
  useEffect(() => {
    if (!loading && sortedFarms.length > 0 && currentPage > totalPages) setCurrentPage(totalPages);
  }, [totalPages, currentPage, loading, sortedFarms.length]);
  const safePage = Math.min(currentPage, totalPages);
  const paginated = useMemo(() =>
    sortedFarms.slice((safePage - 1) * perPage, safePage * perPage), [sortedFarms, safePage, perPage]);

  const pageNums = useMemo(() => {
    const pages = [];
    const max = 5;
    let s = Math.max(1, currentPage - Math.floor(max / 2));
    let e = Math.min(totalPages, s + max - 1);
    if (e - s + 1 < max) s = Math.max(1, e - max + 1);
    for (let i = s; i <= e; i++) pages.push(i);
    return pages;
  }, [currentPage, totalPages]);

  // Keyboard shortcuts (J/K/Enter/Esc/P) — must be after paginated declaration
  useEffect(() => {
    const handler = (e) => {
      // Escape works everywhere
      if (e.key === 'Escape') {
        if (detailFarm) { setDetailFarm(null); return; }
        if (showForm) { setShowForm(false); return; }
        setFocusedIdx(-1);
        return;
      }
      // Other keys: skip when modal/input is active
      if (showForm || detailFarm || showColumnSettings || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIdx(prev => Math.min(prev + 1, paginated.length - 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIdx(prev => Math.max(prev - 1, prev === -1 ? -1 : 0));
      } else if (e.key === 'Enter' && focusedIdx >= 0) {
        e.preventDefault();
        openDetail(paginated[focusedIdx]);
      } else if (e.key === 'p' && focusedIdx >= 0) {
        e.preventDefault();
        togglePin(paginated[focusedIdx].farmId);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusedIdx, paginated, showForm, detailFarm, showColumnSettings]);

  // 컨텍스트 메뉴 외부 클릭/스크롤 시 닫기
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [ctxMenu]);

  const handleRowContext = (e, farm) => {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 180);
    const y = Math.min(e.clientY, window.innerHeight - 260);
    setCtxMenu({ x, y, farm });
  };

  /* ── Selection ── */
  const allSelected = paginated.length > 0 && paginated.every(f => selectedIds.includes(f.farmId));
  const toggleAll = () => {
    if (allSelected) setSelectedIds(prev => prev.filter(id => !paginated.some(f => f.farmId === id)));
    else setSelectedIds(prev => [...new Set([...prev, ...paginated.map(f => f.farmId)])]);
  };
  const toggleOne = (id) => setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  /* ── Stats ── */
  const onlineCount = farms.filter(f => connStatus(f.lastSeenAt).type === 'online').length;
  const expiringCount = farms.filter(f => f.maintenanceDaysLeft != null && f.maintenanceDaysLeft > 0 && f.maintenanceDaysLeft <= 90).length;
  const expiredCount = farms.filter(f => f.maintenanceDaysLeft != null && f.maintenanceDaysLeft <= 0).length;
  const hasFilters = search || region || statusFilter || connectionFilter || maintFilter || tagFilter || dateFrom || dateTo || summaryFilter;

  /* ── Clear All ── */
  const clearAll = () => {
    setSearch(''); setSearchField('all'); setRegion(''); setStatusFilter('');
    setConnectionFilter(''); setMaintFilter(''); setDateFrom(''); setDateTo('');
    setSummaryFilter('');
  };

  /* ── Pin / Column helpers ── */
  const togglePin = (farmId) => {
    setPinnedIds(prev => prev.includes(farmId) ? prev.filter(x => x !== farmId) : [...prev, farmId]);
  };
  const toggleColumn = (colId) => {
    const col = ALL_COLUMNS.find(c => c.id === colId);
    if (col?.fixed) return;
    setVisibleColumns(prev => prev.includes(colId) ? prev.filter(x => x !== colId) : [...prev, colId]);
  };
  const resetColumns = () => setVisibleColumns([...DEFAULT_VISIBLE]);

  /* ── Alert Feed helpers ── */
  const fetchAlertFeed = async (tab) => {
    setAlertFeedLoading(true);
    try {
      const t = tab || alertFeedTab;
      const ackParam = t === 'unack' ? '&acknowledged=false' : '';
      const r = await axios.get(`${API}/farms/alerts/recent?limit=50${ackParam}`);
      setAlertFeedData(r.data.data || []);
    } catch (err) { setError(err.response?.data?.error || '알림 피드 조회 실패'); }
    finally { setAlertFeedLoading(false); }
  };
  const acknowledgeAlert = async (alertId) => {
    try {
      await axios.put(`${API}/alerts/${alertId}/acknowledge`, { source: actionSource });
      setAlertFeedData(prev => prev.map(a =>
        a._id === alertId ? { ...a, acknowledged: true, acknowledgedAt: new Date().toISOString(), acknowledgedBy: actionSource } : a
      ));
      const r = await axios.get(`${API}/farms/alert-summary`).catch(() => null);
      if (r) setAlertSummary(r.data.data);
    } catch (err) { setError(err.response?.data?.error || '알림 확인 처리 실패'); }
  };
  const deleteAlert = async (alertId) => {
    try {
      await axios.delete(`${API}/alerts/${alertId}?source=${encodeURIComponent(actionSource)}`);
      setAlertFeedData(prev => prev.filter(a => a._id !== alertId));
      // 농장 모달의 farmAlerts에도 삭제 상태 반영
      setFarmAlerts(prev => prev.map(a =>
        a._id === alertId ? { ...a, deleted: true, deletedAt: new Date().toISOString(), deletedBy: actionSource } : a
      ));
      const r = await axios.get(`${API}/farms/alert-summary`).catch(() => null);
      if (r) setAlertSummary(r.data.data);
    } catch (err) { setError(err.response?.data?.error || '알림 삭제 실패'); }
  };
  const isCol = (id) => visibleColumns.includes(id);
  const visibleCount = visibleColumns.length + 3; // +checkbox, +pin, +actions

  /* ── Farm Alert (detail modal) helpers ── */
  const ackFarmAlert = async (alertId, resolution) => {
    try {
      await axios.put(`${API}/alerts/${alertId}/acknowledge`, { source: actionSource, ...(resolution ? { resolution } : {}) });
      setFarmAlerts(prev => prev.map(a =>
        a._id === alertId ? { ...a, acknowledged: true, acknowledgedAt: new Date().toISOString(), acknowledgedBy: actionSource, metadata: { ...a.metadata, ...(resolution ? { resolution, resolvedAt: new Date().toISOString() } : {}) } } : a
      ));
    } catch (err) { setError(err.response?.data?.error || '알림 확인 처리 실패'); }
  };
  const saveFarmAlertResolution = async (alertId) => {
    if (!editResolutionText.trim()) return;
    try {
      await axios.put(`${API}/alerts/${alertId}/resolution`, { resolution: editResolutionText.trim() });
      setFarmAlerts(prev => prev.map(a =>
        a._id === alertId ? { ...a, metadata: { ...a.metadata, resolution: editResolutionText.trim(), resolvedAt: new Date().toISOString() } } : a
      ));
      setEditResolutionId(null); setEditResolutionText('');
    } catch (err) { setError(err.response?.data?.error || '조치사항 저장 실패'); }
  };

  /* ── CRUD Handlers ── */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const clean = form.managers.filter(m => m.name || m.phone || m.email);
    // 태그 입력필드에 남아있는 텍스트 자동 추가
    let finalTags = [...(form.tags || [])];
    if (tagInputRef.current) {
      const remaining = tagInputRef.current.value.trim().replace(/,/g, '');
      if (remaining && !finalTags.includes(remaining)) {
        finalTags.push(remaining);
      }
      tagInputRef.current.value = '';
    }
    // 사업비 검증 (보조사업인 경우)
    if (form.businessType === 'subsidy') {
      const total = Number(form.totalCost) || 0;
      const subsidy = Number(form.subsidyAmount) || 0;
      const self = Number(form.selfFunding) || 0;
      if (total > 0 && subsidy + self > 0 && total !== subsidy + self) {
        return setError(`총사업비(${total.toLocaleString()}원) ≠ 보조금(${subsidy.toLocaleString()}원) + 자부담(${self.toLocaleString()}원). 금액을 확인해주세요.`);
      }
      if (subsidy > total) return setError('보조금이 총사업비를 초과할 수 없습니다.');
      if (self > total) return setError('자부담이 총사업비를 초과할 수 없습니다.');
    }
    const data = { ...form, managers: clean, tags: finalTags };
    try {
      if (editFarm) await axios.put(`${API}/farms/${editFarm.farmId}`, data);
      else await axios.post(`${API}/farms`, data);
      setShowForm(false); setEditFarm(null); fetchFarms();
    } catch (err) { setError(err.response?.data?.error || '저장 실패'); }
  };

  const openNewForm = async () => {
    setEditFarm(null); setAutoId(true);
    const today = new Date().toISOString().split('T')[0];
    const def = { farmId: '', name: '', location: '', managers: [{ ...emptyManager }], businessProjectId: '', businessType: '', totalCost: '', subsidyAmount: '', selfFunding: '', systemType: '', farmType: '', farmArea: '', registeredAt: today, maintenanceMonths: 12, maintenanceStartAt: today, status: 'active', memo: '', tags: [], representativeUserId: '' };
    try {
      const [idR, uR] = await Promise.all([axios.get(`${API}/farms/next-id`), axios.get(`${API}/auth/users`)]);
      setForm({ ...def, farmId: idR.data.data.nextId }); setFormUsers(uR.data.data || []);
    } catch { setForm(def); setAutoId(false); }
    setShowForm(true);
  };

  const handleEdit = async (farm) => {
    setEditFarm(farm);
    const mgrs = Array.isArray(farm.managers) && farm.managers.length > 0
      ? farm.managers
      : farm.ownerName ? [{ name: farm.ownerName, phone: farm.ownerPhone || '', email: '' }] : [{ ...emptyManager }];
    let users = [], repId = '';
    try {
      const [uR, dR] = await Promise.all([axios.get(`${API}/auth/users`), axios.get(`${API}/farms/${farm.farmId}`)]);
      users = uR.data.data || [];
      const admins = (dR.data.data.users || []).filter(u => ['admin', 'superadmin', 'manager'].includes(u.role));
      if (admins.length > 0) repId = admins[0].userId;
    } catch { /* ignore */ }
    setFormUsers(users);
    setForm({ farmId: farm.farmId, name: farm.name, location: farm.location || '', managers: mgrs, businessProjectId: farm.businessProjectId || '', businessType: farm.businessType || '', totalCost: farm.totalCost != null ? String(farm.totalCost) : '', subsidyAmount: farm.subsidyAmount != null ? String(farm.subsidyAmount) : '', selfFunding: farm.selfFunding != null ? String(farm.selfFunding) : '', systemType: farm.systemType || '', farmType: farm.farmType || '', farmArea: farm.farmArea || '', registeredAt: toInput(farm.registeredAt), maintenanceMonths: farm.maintenanceMonths ?? 12, maintenanceStartAt: toInput(farm.maintenanceStartAt), status: farm.status || 'active', memo: farm.memo || '', tags: Array.isArray(farm.tags) ? farm.tags : [], representativeUserId: repId });
    setShowForm(true);
  };

  const handleDelete = async (farmId) => {
    if (!confirm(`"${farmId}" 농장을 휴지통으로 이동하시겠습니까? 30일 이내 복원 가능합니다.`)) return;
    try { await axios.delete(`${API}/farms/${farmId}`); fetchFarms(); }
    catch (err) { setError(err.response?.data?.error || '삭제 실패'); }
  };

  const handleBatchDelete = async () => {
    if (!selectedIds.length) return;
    if (!confirm(`선택된 ${selectedIds.length}개 농장을 휴지통으로 이동하시겠습니까? 30일 이내 복원 가능합니다.`)) return;
    try {
      await Promise.all(selectedIds.map(id => axios.delete(`${API}/farms/${id}`)));
      setSelectedIds([]); fetchFarms();
    } catch { setError('일괄 삭제 중 오류 발생'); }
  };

  const handleBatchStatus = async (status) => {
    if (!selectedIds.length) return;
    if (!confirm(`선택된 ${selectedIds.length}개 농장을 "${STATUS[status]?.label}"(으)로 변경하시겠습니까?`)) return;
    try {
      await axios.put(`${API}/farms/batch-status`, { farmIds: selectedIds, status });
      setSelectedIds([]); fetchFarms();
    } catch { setError('일괄 상태 변경 실패'); }
  };

  const cloneFarm = async (farm) => {
    setEditFarm(null); setAutoId(true);
    const today = new Date().toISOString().split('T')[0];
    const mgrs = Array.isArray(farm.managers) && farm.managers.length > 0 ? farm.managers : [{ ...emptyManager }];
    try {
      const [idR, uR] = await Promise.all([axios.get(`${API}/farms/next-id`), axios.get(`${API}/auth/users`)]);
      setFormUsers(uR.data.data || []);
      setForm({
        farmId: idR.data.data.nextId, name: `${farm.name} (복사)`, location: farm.location || '',
        managers: mgrs, systemType: farm.systemType || '', farmType: farm.farmType || '',
        farmArea: farm.farmArea || '', registeredAt: today, maintenanceMonths: farm.maintenanceMonths ?? 12,
        maintenanceStartAt: today, status: 'active', memo: farm.memo || '', representativeUserId: '',
      });
    } catch {
      setForm({
        farmId: '', name: `${farm.name} (복사)`, location: farm.location || '',
        managers: mgrs, systemType: farm.systemType || '', farmType: farm.farmType || '',
        farmArea: farm.farmArea || '', registeredAt: today, maintenanceMonths: farm.maintenanceMonths ?? 12,
        maintenanceStartAt: today, status: 'active', memo: farm.memo || '', representativeUserId: '',
      });
      setAutoId(false);
    }
    setShowForm(true);
  };

  const handleRegenKey = async (farmId) => {
    if (!confirm('API 키를 재발급하면 기존 키로 연결된 RPi가 인증 실패합니다.\n계속하시겠습니까?')) return;
    try {
      const r = await axios.post(`${API}/farms/${farmId}/regenerate-key`);
      fetchFarms(); alert(`새 API 키:\n${r.data.data.apiKey}`);
    } catch { setError('API 키 재발급 실패'); }
  };

  const copyKey = (key, id) => { navigator.clipboard.writeText(key); setCopiedKey(id); setTimeout(() => setCopiedKey(null), 2000); };

  const enterFarm = (farm) => { selectFarm(farm.farmId, { name: farm.name, location: farm.location }); window.location.hash = 'dashboard'; };

  /* ── Manager form helpers ── */
  const updateMgr = (i, k, v) => {
    const u = [...form.managers]; u[i] = { ...u[i], [k]: v }; setForm({ ...form, managers: u });
    if (k === 'name') setMgrSearchIdx(v.length > 0 ? i : -1);
  };
  const selectMgrUser = (i, user) => {
    const u = [...form.managers];
    u[i] = { ...u[i], name: user.name, _userId: user.id, _username: user.username, _role: user.role };
    const updates = { managers: u };
    if (i === 0) updates.representativeUserId = user.id;
    setForm({ ...form, ...updates });
    setMgrSearchIdx(-1);
  };
  const getMgrSuggestions = (idx) => {
    const q = (form.managers[idx]?.name || '').toLowerCase().trim();
    if (!q || q.length < 1) return [];
    return formUsers.filter(u =>
      u.name?.toLowerCase().includes(q) || u.username?.toLowerCase().includes(q)
    ).slice(0, 8);
  };
  const addMgr = () => setForm({ ...form, managers: [...form.managers, { ...emptyManager }] });
  const rmMgr = (i) => { if (form.managers.length <= 1) return; setForm({ ...form, managers: form.managers.filter((_, j) => j !== i) }); };

  /* ── Detail Modal ── */
  const openDetail = async (farm) => {
    setDetailFarm(farm); setDetailTab('info'); setDetailLoading(true);
    setAssignUserId(''); setAssignRole('viewer');
    setMaintLogs([]); setMaintSummary({ totalCost: 0, count: 0 }); setShowMaintForm(false);
    setFarmStats(null); setAuditLogs([]); setConnHistory(null);
    setFarmNotes([]); setNewNote(''); setEditNoteId(null); setEditHouseId(null);
    setFarmAlerts([]); setFarmAlertFilter('all'); setEditResolutionId(null);
    setFarmSchedules([]); setScheduleSummary({ total: 0, completed: 0, upcoming: 0, overdue: 0 });
    setShowScheduleForm(false); setEditScheduleId(null);
    setFarmDocuments([]); setDocSummary({ total: 0, totalSize: 0, byCategory: {} });
    setRestoreResult(null); setEditPermUserId(null);
    try {
      const [dR, uR, mR, sR, aR, cR, nR, schR, docR, alertR] = await Promise.all([
        axios.get(`${API}/farms/${farm.farmId}`),
        axios.get(`${API}/auth/users`),
        axios.get(`${API}/farms/${farm.farmId}/maintenance`),
        axios.get(`${API}/farms/${farm.farmId}/stats`).catch(() => null),
        axios.get(`${API}/farms/${farm.farmId}/audit?limit=50`).catch(() => null),
        axios.get(`${API}/farms/${farm.farmId}/connection-history?days=7`).catch(() => null),
        axios.get(`${API}/farms/${farm.farmId}/notes`).catch(() => null),
        axios.get(`${API}/farms/${farm.farmId}/schedules`).catch(() => null),
        axios.get(`${API}/farms/${farm.farmId}/documents`).catch(() => null),
        axios.get(`${API}/alerts/${farm.farmId}?limit=200&includeDeleted=true`).catch(() => null),
      ]);
      setFarmHouses(dR.data.data.houses || []); setFarmUsers(dR.data.data.users || []); setAllUsers(uR.data.data || []);
      setMaintLogs(mR.data.data || []); setMaintSummary(mR.data.summary || { totalCost: 0, count: 0 });
      if (sR) setFarmStats(sR.data.data);
      if (aR) setAuditLogs(aR.data.data || []);
      if (cR) setConnHistory(cR.data.data);
      if (nR) setFarmNotes(nR.data.data || []);
      if (schR) { setFarmSchedules(schR.data.data || []); setScheduleSummary(schR.data.summary || {}); }
      if (docR) { setFarmDocuments(docR.data.data || []); setDocSummary(docR.data.summary || {}); }
      if (alertR) setFarmAlerts(alertR.data.data || []);
    } catch (err) {
      setError(err.response?.data?.error || '농장 상세정보 조회 실패');
      setFarmHouses([]); setFarmUsers([]); setAllUsers([]);
    } finally { setDetailLoading(false); }
  };

  const assignUser = async () => {
    if (!assignUserId || !detailFarm) return;
    try {
      await axios.post(`${API}/farms/${detailFarm.farmId}/users`, { userId: assignUserId, role: assignRole });
      const r = await axios.get(`${API}/farms/${detailFarm.farmId}`);
      setFarmUsers(r.data.data.users || []); setAssignUserId(''); fetchFarms();
    } catch (err) { setError(err.response?.data?.error || '사용자 할당 실패'); }
  };

  const removeUser = async (uid) => {
    if (!detailFarm) return;
    try {
      await axios.delete(`${API}/farms/${detailFarm.farmId}/users/${uid}`);
      setFarmUsers(p => p.filter(u => u.userId !== uid)); fetchFarms();
    } catch (err) { setError(err.response?.data?.error || '사용자 해제 실패'); }
  };

  /* ── Maintenance Log ── */
  const MAINT_TYPE = { inspection: '정기점검', repair: '수리', upgrade: '업그레이드', other: '기타' };
  const MAINT_STATUS = { scheduled: '예정', in_progress: '진행중', completed: '완료' };
  const MAINT_TYPE_CLS = { inspection: 'bg-blue-100 text-blue-700', repair: 'bg-rose-100 text-rose-700', upgrade: 'bg-purple-100 text-purple-700', other: 'bg-gray-100 text-gray-600' };
  const MAINT_STATUS_CLS = { scheduled: 'bg-amber-100 text-amber-700', in_progress: 'bg-cyan-100 text-cyan-700', completed: 'bg-emerald-100 text-emerald-700' };

  const fetchMaintLogs = async (farmId) => {
    try {
      const url = maintTypeFilter ? `${API}/farms/${farmId}/maintenance?type=${maintTypeFilter}` : `${API}/farms/${farmId}/maintenance`;
      const r = await axios.get(url);
      setMaintLogs(r.data.data || []);
      setMaintSummary(r.data.summary || { totalCost: 0, count: 0 });
    } catch { setMaintLogs([]); setMaintSummary({ totalCost: 0, count: 0 }); }
  };

  const openMaintForm = (log = null) => {
    if (log) {
      setEditMaintLog(log);
      setMaintForm({
        date: log.date ? new Date(log.date).toISOString().split('T')[0] : '',
        type: log.type, title: log.title, description: log.description || '',
        cost: log.cost || '', technician: log.technician || '', status: log.status,
      });
    } else {
      setEditMaintLog(null);
      setMaintForm({ date: new Date().toISOString().split('T')[0], type: 'inspection', title: '', description: '', cost: '', technician: '', status: 'completed' });
    }
    setShowMaintForm(true);
  };

  const saveMaintLog = async () => {
    if (!detailFarm || !maintForm.title || !maintForm.date) return;
    try {
      if (editMaintLog) {
        await axios.put(`${API}/farms/${detailFarm.farmId}/maintenance/${editMaintLog.id}`, maintForm);
      } else {
        await axios.post(`${API}/farms/${detailFarm.farmId}/maintenance`, maintForm);
      }
      setShowMaintForm(false);
      fetchMaintLogs(detailFarm.farmId);
    } catch (err) { setError(err.response?.data?.error || '유지보수 이력 저장 실패'); }
  };

  const deleteMaintLog = async (logId) => {
    if (!detailFarm) return;
    try {
      await axios.delete(`${API}/farms/${detailFarm.farmId}/maintenance/${logId}`);
      fetchMaintLogs(detailFarm.farmId);
    } catch (err) { setError(err.response?.data?.error || '유지보수 이력 삭제 실패'); }
  };

  /* ── House Inline Edit ── */
  const startEditHouse = (h) => {
    setEditHouseId(h.id);
    setEditHouseData({ houseName: h.houseName || '', enabled: h.enabled, cropType: h.cropType || '', cropVariety: h.cropVariety || '' });
  };

  const saveHouseEdit = async () => {
    if (!detailFarm || !editHouseId) return;
    const h = farmHouses.find(x => x.id === editHouseId);
    if (!h) return;
    try {
      await axios.put(`${API}/config/${h.houseId}?farmId=${detailFarm.farmId}`, editHouseData);
      setFarmHouses(prev => prev.map(x => x.id === editHouseId ? { ...x, ...editHouseData } : x));
      setEditHouseId(null);
    } catch (err) { setError(err.response?.data?.error || '하우스 수정 실패'); }
  };

  /* ── Farm Notes ── */
  const addNote = async () => {
    if (!detailFarm || !newNote.trim()) return;
    try {
      await axios.post(`${API}/farms/${detailFarm.farmId}/notes`, { content: newNote.trim() });
      const r = await axios.get(`${API}/farms/${detailFarm.farmId}/notes`);
      setFarmNotes(r.data.data || []);
      setNewNote('');
    } catch (err) { setError(err.response?.data?.error || '메모 추가 실패'); }
  };

  const updateNote = async (noteId) => {
    if (!detailFarm || !editNoteText.trim()) return;
    try {
      await axios.put(`${API}/farms/${detailFarm.farmId}/notes/${noteId}`, { content: editNoteText.trim() });
      setFarmNotes(prev => prev.map(n => n.id === noteId ? { ...n, content: editNoteText.trim() } : n));
      setEditNoteId(null);
    } catch (err) { setError(err.response?.data?.error || '메모 수정 실패'); }
  };

  const deleteNote = async (noteId) => {
    if (!detailFarm) return;
    try {
      await axios.delete(`${API}/farms/${detailFarm.farmId}/notes/${noteId}`);
      setFarmNotes(prev => prev.filter(n => n.id !== noteId));
    } catch (err) { setError(err.response?.data?.error || '메모 삭제 실패'); }
  };

  /* ── Excel Import ── */
  const handleImportFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = XLSX.read(ev.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws);
      const mapped = rows.map(r => ({
        farmId: r['농장ID'] || r['farmId'] || '',
        name: r['농장명'] || r['name'] || '',
        location: r['주소'] || r['location'] || '',
        ownerName: r['대표자'] || r['ownerName'] || '',
        farmType: r['형태'] || r['farmType'] || '',
        farmArea: r['면적'] || r['farmArea'] || '',
        systemType: r['시스템'] || r['systemType'] || '',
        status: r['상태'] || 'active',
        maintenanceMonths: parseInt(r['유지보수(월)'] || r['maintenanceMonths']) || 12,
        memo: r['메모'] || r['memo'] || '',
      }));
      setImportData(mapped);
      setImportResult(null);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const submitImport = async () => {
    if (!importData.length) return;
    try {
      const r = await axios.post(`${API}/farms/batch`, { farms: importData });
      setImportResult(r.data.data);
      fetchFarms();
    } catch (err) { setError(err.response?.data?.error || '일괄 등록 실패'); }
  };

  /* ── Farm Stats ── */
  const fetchFarmStats = async (farmId) => {
    try {
      const r = await axios.get(`${API}/farms/${farmId}/stats`);
      setFarmStats(r.data.data);
    } catch { setFarmStats(null); }
  };

  /* ── Audit Log ── */
  const fetchAuditLogs = async (farmId) => {
    try {
      const r = await axios.get(`${API}/farms/${farmId}/audit?limit=50`);
      setAuditLogs(r.data.data || []);
    } catch { setAuditLogs([]); }
  };

  /* ── Connection History ── */
  const fetchConnHistory = async (farmId) => {
    try {
      const r = await axios.get(`${API}/farms/${farmId}/connection-history?days=7`);
      setConnHistory(r.data.data);
    } catch { setConnHistory(null); }
  };

  const AUDIT_ACTION_LABEL = {
    create: '생성', update: '수정', delete: '삭제', soft_delete: '삭제',
    restore: '복원', batch_status: '일괄 상태변경', batch_create: '일괄 등록',
    regenerate_key: 'API키 재발급', update_role: '역할 변경', update_permissions: '권한 변경',
    backup: '백업',
  };
  const FIELD_LABEL = {
    name: '농장명', location: '주소', status: '상태', memo: '메모', tags: '태그',
    systemType: '시스템 유형', farmType: '농장 유형', farmArea: '면적(평)',
    registeredAt: '등록일', maintenanceMonths: '유지보수 기간(개월)', maintenanceStartAt: '유지보수 시작일',
    managers: '관리자', ownerName: '대표자명', ownerPhone: '대표자 연락처',
    businessProjectId: '사업', businessType: '사업 유형',
    totalCost: '총사업비', subsidyAmount: '보조금', selfFunding: '자부담',
  };
  const TARGET_TYPE_LABEL = { farm: '농장', user_farm: '사용자-농장', house: '하우스' };

  /* ── Excel Export ── */
  const exportExcel = () => {
    const headers = ['농장ID', '농장명', '주소', '형태', '면적(평)', '시스템형태', '상태', '접속', '하우스', '사용자', '대표자', '유지보수(일)', '등록일', 'API Key'];
    const rows = filteredFarms.map(f => {
      const mgrs = getMgrs(f);
      return [
        f.farmId, f.name, f.location || '',
        FARM_TYPE_LABEL[f.farmType] || '', f.farmArea || '',
        SYSTEM_TYPE_LABEL[f.systemType] || '',
        STATUS[f.status]?.label || f.status,
        connStatus(f.lastSeenAt).label, f.houseCount || 0, f.userCount || 0,
        mgrs.length > 0 ? mgrs.map(m => m.name).join('/') : '',
        f.maintenanceDaysLeft ?? '', fmt(f.registeredAt), f.apiKey,
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    // 열 너비 자동 조정
    ws['!cols'] = headers.map((h, i) => {
      const maxLen = Math.max(h.length, ...rows.map(r => String(r[i] || '').length));
      return { wch: Math.min(maxLen + 2, 40) };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '농장목록');
    XLSX.writeFile(wb, `farms_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  /* ── Farm Detail PDF Export ── */
  const exportFarmPDF = async () => {
    if (!detailRef.current || !detailFarm) return;
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'), import('html2canvas'),
      ]);

      // 스크롤 컨테이너들의 높이 제한을 임시 해제하여 전체 콘텐츠 캡처
      const target = detailRef.current;
      const modal = target.closest('.fixed');
      const modalCard = target.closest('.bg-white');

      // 원래 스타일 백업
      const saved = [];
      const expandEls = target.querySelectorAll('[class*="max-h-"], [class*="overflow"]');
      expandEls.forEach(el => {
        saved.push({ el, maxH: el.style.maxHeight, overflow: el.style.overflow });
        el.style.maxHeight = 'none';
        el.style.overflow = 'visible';
      });
      // 모달 자체의 스크롤도 해제
      const savedModal = modal ? { overflow: modal.style.overflow } : null;
      const savedCard = modalCard ? { maxH: modalCard.style.maxHeight, overflow: modalCard.style.overflow } : null;
      if (modal) { modal.style.overflow = 'visible'; }
      if (modalCard) { modalCard.style.maxHeight = 'none'; modalCard.style.overflow = 'visible'; }

      const canvas = await html2canvas(target, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        scrollY: 0,
        scrollX: 0,
        windowHeight: target.scrollHeight + 200,
      });

      // 스타일 복원
      saved.forEach(({ el, maxH, overflow }) => {
        el.style.maxHeight = maxH;
        el.style.overflow = overflow;
      });
      if (modal && savedModal) { modal.style.overflow = savedModal.overflow; }
      if (modalCard && savedCard) { modalCard.style.maxHeight = savedCard.maxH; modalCard.style.overflow = savedCard.overflow; }

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pageW = 210;
      const pageH = 297;
      const margin = 10;
      const contentW = pageW - margin * 2;
      const imgH = (canvas.height * contentW) / canvas.width;
      const maxPageH = pageH - margin * 2;

      if (imgH <= maxPageH) {
        pdf.addImage(imgData, 'PNG', margin, margin, contentW, imgH);
      } else {
        // 멀티페이지
        let y = 0;
        const sliceH = Math.floor((maxPageH * canvas.width) / contentW);
        while (y < canvas.height) {
          const sliceCanvas = document.createElement('canvas');
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = Math.min(sliceH, canvas.height - y);
          const ctx = sliceCanvas.getContext('2d');
          ctx.drawImage(canvas, 0, -y);
          const sliceImg = sliceCanvas.toDataURL('image/png');
          const sliceImgH = (sliceCanvas.height * contentW) / sliceCanvas.width;
          if (y > 0) pdf.addPage();
          pdf.addImage(sliceImg, 'PNG', margin, margin, contentW, sliceImgH);
          y += sliceH;
        }
      }
      pdf.save(`farm_${detailFarm.farmId}_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) {
      console.error('PDF 생성 실패:', err);
      setError('PDF 생성에 실패했습니다');
    }
  };

  /* ═══════════════════════ RENDER ═══════════════════════ */
  if (loading) return (
    <div className="flex justify-center items-center h-64">
      <div className="w-10 h-10 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin" />
    </div>
  );

  const thCls = 'bg-slate-50 px-4 py-3 text-sm font-medium text-gray-700 text-left whitespace-nowrap border border-gray-200 w-[120px]';
  const tdCls = 'px-4 py-2.5 border border-gray-200';
  const btnQuick = (active) => `px-3 py-1 rounded text-xs font-medium border transition-colors ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`;
  const chkCls = (active) => `px-3 py-1 rounded text-xs font-medium border cursor-pointer transition-colors ${active ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`;

  return (
    <div className="space-y-5 pb-8">

      {/* ═══ Breadcrumb ═══ */}
      <div className="text-sm text-gray-400">
        Home &gt; 설정 &gt; <span className="text-gray-700 font-medium">농장관리</span>
      </div>

      {/* ═══ Page Title ═══ */}
      <h2 className="text-2xl font-bold text-gray-800">농장관리</h2>

      {/* ═══ Stats Cards ═══ */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {[
          { label: '전체 농장', value: farms.length, unit: '개', left: 'border-l-indigo-500', border: 'border-indigo-200', text: 'text-indigo-700' },
          { label: '접속 중', value: onlineCount, unit: '개', left: 'border-l-emerald-500', border: 'border-emerald-200', text: 'text-emerald-700' },
          { label: '유지보수 만료임박', value: expiringCount, unit: '개', left: 'border-l-amber-500', border: 'border-amber-200', text: 'text-amber-700' },
          { label: '유지보수 만료', value: expiredCount, unit: '개', left: 'border-l-red-500', border: 'border-red-200', text: 'text-red-700' },
        ].map((s) => (
          <div key={s.label} className={`bg-white rounded-lg border-l-4 ${s.left} border ${s.border} px-4 py-3.5`}>
            <div className="text-xs text-gray-500 mb-1">{s.label}</div>
            <div className="flex items-end gap-1">
              <span className={`text-2xl font-bold ${s.text}`}>{s.value}</span>
              <span className="text-sm text-gray-400 mb-0.5">{s.unit}</span>
            </div>
          </div>
        ))}
        {/* 오늘 일정 카드 */}
        <div className="relative">
          <div
            onClick={() => setShowSchedulePanel(p => !p)}
            className={`bg-white rounded-lg border-l-4 border-l-sky-500 border ${showSchedulePanel ? 'border-sky-400 ring-1 ring-sky-200' : 'border-sky-200'} px-4 py-3.5 cursor-pointer hover:shadow-md transition-all`}
          >
            <div className="text-xs text-gray-500 mb-1 flex items-center justify-between">
              <span>오늘 일정</span>
              {scheduleSummaryGlobal.overdueCount > 0 && (
                <span className="bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full animate-pulse">
                  {scheduleSummaryGlobal.overdueCount} 지연
                </span>
              )}
            </div>
            <div className="flex items-end gap-1">
              <span className="text-2xl font-bold text-sky-700">{scheduleSummaryGlobal.todayCount}</span>
              <span className="text-sm text-gray-400 mb-0.5">건</span>
              <span className="text-xs text-gray-400 mb-0.5 ml-1">/ 일주일</span>
              <span className="text-sm font-semibold text-sky-500 mb-0.5">{scheduleSummaryGlobal.weekCount}</span>
              <span className="text-xs text-gray-400 mb-0.5 ml-1">/ 1개월</span>
              <span className="text-sm font-semibold text-sky-400 mb-0.5">{scheduleSummaryGlobal.monthCount}</span>
            </div>
          </div>
          {/* Schedule Detail Panel */}
          {showSchedulePanel && (
            <div className="absolute top-full right-0 mt-2 bg-white rounded-lg border border-gray-200 shadow-xl z-50" style={{ width: '420px' }}>
              {/* Panel Header */}
              <div className="bg-slate-600 px-4 py-2.5 rounded-t-lg flex items-center justify-between">
                <h4 className="text-sm font-semibold text-white">일정 현황</h4>
                <button onClick={() => setShowSchedulePanel(false)} className="text-white/70 hover:text-white text-lg leading-none">&times;</button>
              </div>
              {/* Panel Tabs */}
              <div className="flex border-b border-gray-200">
                {[
                  { key: 'today', label: `오늘 (${scheduleSummaryGlobal.todayCount})` },
                  { key: 'week', label: `일주일 (${scheduleSummaryGlobal.weekCount})` },
                  { key: 'month', label: `1개월 (${scheduleSummaryGlobal.monthCount})` },
                  { key: 'overdue', label: `지연 (${scheduleSummaryGlobal.overdueCount})` },
                ].map(t => (
                  <button key={t.key} onClick={() => setSchedulePanelTab(t.key)}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${schedulePanelTab === t.key ? 'text-sky-600 border-b-2 border-sky-500 bg-sky-50' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
                    {t.label}
                  </button>
                ))}
              </div>
              {/* Panel Content */}
              <div className="max-h-[320px] overflow-y-auto">
                {(() => {
                  const items = schedulePanelTab === 'today' ? scheduleSummaryGlobal.todaySchedules
                    : schedulePanelTab === 'week' ? scheduleSummaryGlobal.weekSchedules
                    : schedulePanelTab === 'month' ? scheduleSummaryGlobal.monthSchedules
                    : scheduleSummaryGlobal.overdueSchedules;
                  const emptyMsg = { today: '오늘 일정이 없습니다', week: '일주일 이내 일정이 없습니다', month: '1개월 이내 일정이 없습니다', overdue: '지연된 일정이 없습니다' };
                  if (!items || items.length === 0) return (
                    <div className="py-8 text-center text-sm text-gray-400">
                      {emptyMsg[schedulePanelTab]}
                    </div>
                  );
                  return items.map((sch, idx) => (
                    <div key={sch.id} className={`px-4 py-3 ${idx < items.length - 1 ? 'border-b border-gray-100' : ''} hover:bg-gray-50 transition-colors`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-1">
                            <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${SCHEDULE_TYPE_CLS[sch.type] || 'bg-gray-100 text-gray-600'}`}>
                              {SCHEDULE_TYPE[sch.type] || sch.type}
                            </span>
                            {sch.priority === 'urgent' && <span className="text-[10px] font-bold text-red-500">긴급</span>}
                            {sch.priority === 'high' && <span className="text-[10px] font-bold text-orange-500">높음</span>}
                            {sch.completed && <span className="text-[10px] text-emerald-500">완료</span>}
                          </div>
                          <div className={`text-sm font-medium ${sch.completed ? 'text-gray-400 line-through' : schedulePanelTab === 'overdue' ? 'text-red-700' : 'text-gray-800'}`}>
                            {sch.title}
                          </div>
                          <div className="text-[11px] text-gray-400 mt-0.5">
                            {sch.farmName} ({sch.farmCode}){sch.houseId ? ` · ${sch.houseId}` : ''}{sch.assignedTo ? ` · ${sch.assignedTo}` : ''}
                          </div>
                        </div>
                        <div className="text-[11px] text-gray-400 whitespace-nowrap shrink-0">
                          {new Date(sch.startDate).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                        </div>
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ Search Card ═══ */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="bg-slate-600 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-white">농장 검색</h3>
        </div>
        <table className="w-full border-collapse">
          <tbody>
            {/* Row: 검색어 */}
            <tr>
              <td className={thCls}>검색어</td>
              <td className={tdCls}>
                <div className="flex items-center gap-2">
                  <select value={searchField} onChange={e => setSearchField(e.target.value)}
                    className="px-3 py-1.5 border border-gray-300 rounded text-sm bg-white min-w-[100px]">
                    <option value="all">전체</option>
                    <option value="name">농장명</option>
                    <option value="farmId">농장ID</option>
                    <option value="location">주소</option>
                    <option value="managers">관리자</option>
                  </select>
                  <input type="text" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="검색어를 입력하세요 (오타 허용)"
                    className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30" />
                </div>
              </td>
            </tr>

            {/* Row: 지역 + 농장상태 */}
            <tr>
              <td className={thCls}>지역</td>
              <td className={`${tdCls} border-r`}>
                <select value={region} onChange={e => setRegion(e.target.value)}
                  className="px-3 py-1.5 border border-gray-300 rounded text-sm bg-white min-w-[140px]">
                  <option value="">전체 지역</option>
                  {regions.map(r => (
                    <option key={r} value={r}>{r} ({farms.filter(f => getRegion(f.location) === r).length})</option>
                  ))}
                </select>
              </td>
            </tr>
            <tr>
              <td className={thCls}>농장상태</td>
              <td className={tdCls}>
                <div className="flex items-center gap-2 flex-wrap">
                  <button onClick={() => setStatusFilter('')} className={chkCls(!statusFilter)}>전체</button>
                  {Object.entries(STATUS).map(([k, v]) => (
                    <button key={k} onClick={() => setStatusFilter(prev => prev === k ? '' : k)}
                      className={chkCls(statusFilter === k)}>
                      {v.label} ({farms.filter(f => f.status === k).length})
                    </button>
                  ))}
                </div>
              </td>
            </tr>

            {/* Row: 접속상태 + 유지보수 */}
            <tr>
              <td className={thCls}>접속상태</td>
              <td className={`${tdCls} border-r`}>
                <div className="flex items-center gap-2">
                  <button onClick={() => setConnectionFilter('')} className={chkCls(!connectionFilter)}>전체</button>
                  <button onClick={() => setConnectionFilter(p => p === 'online' ? '' : 'online')} className={chkCls(connectionFilter === 'online')}>
                    온라인 ({onlineCount})
                  </button>
                  <button onClick={() => setConnectionFilter(p => p === 'offline' ? '' : 'offline')} className={chkCls(connectionFilter === 'offline')}>
                    오프라인 ({farms.length - onlineCount})
                  </button>
                </div>
              </td>
            </tr>
            <tr>
              <td className={thCls}>유지보수</td>
              <td className={tdCls}>
                <div className="flex items-center gap-2">
                  <button onClick={() => setMaintFilter('')} className={chkCls(!maintFilter)}>전체</button>
                  <button onClick={() => setMaintFilter(p => p === 'normal' ? '' : 'normal')} className={chkCls(maintFilter === 'normal')}>정상</button>
                  <button onClick={() => setMaintFilter(p => p === 'expiring' ? '' : 'expiring')} className={chkCls(maintFilter === 'expiring')}>
                    만료임박 ({expiringCount})
                  </button>
                  <button onClick={() => setMaintFilter(p => p === 'expired' ? '' : 'expired')} className={chkCls(maintFilter === 'expired')}>
                    만료 ({expiredCount})
                  </button>
                </div>
              </td>
            </tr>

            {/* Row: 태그 */}
            {allTags.length > 0 && (
              <tr>
                <td className={thCls}>태그</td>
                <td className={tdCls}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button onClick={() => setTagFilter('')} className={chkCls(!tagFilter)}>전체</button>
                    {allTags.map(tag => (
                      <button key={tag} onClick={() => setTagFilter(p => p === tag ? '' : tag)}
                        className={chkCls(tagFilter === tag)}>
                        {tag} ({farms.filter(f => Array.isArray(f.tags) && f.tags.includes(tag)).length})
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            )}

            {/* Row: 등록기간 */}
            <tr>
              <td className={thCls}>등록기간</td>
              <td className={tdCls}>
                <div className="flex items-center gap-2 flex-wrap">
                  {[
                    { key: 'today', label: '오늘' }, { key: '7d', label: '7일' },
                    { key: '1m', label: '1개월' }, { key: '3m', label: '3개월' }, { key: '1y', label: '1년' },
                  ].map(q => (
                    <button key={q.key} onClick={() => setQuickDate(q.key)} className={btnQuick(false)}>{q.label}</button>
                  ))}
                  <span className="w-px h-5 bg-gray-200 mx-1" />
                  <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                    className="px-2 py-1 border border-gray-300 rounded text-sm" />
                  <span className="text-gray-400 text-sm">~</span>
                  <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                    className="px-2 py-1 border border-gray-300 rounded text-sm" />
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        {/* Search Button Area */}
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

      {error && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 animate-fade-in-up">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <span>{error}</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => { setError(''); fetchFarms(); }} className="text-xs text-red-500 hover:text-red-700 px-2 py-0.5 rounded hover:bg-red-100 transition-colors">재시도</button>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 p-0.5">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
      )}

      {/* ═══ Alert Summary Cards ═══ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { key: 'offline', label: '오프라인', count: alertSummary.offline, icon: '📡', bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', countCls: 'text-red-600' },
          { key: 'sensorAlert', label: '센서 이상', count: alertSummary.sensorAlert, icon: '🌡️', bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', countCls: 'text-orange-600' },
          { key: 'maintenance', label: '유지보수 임박', count: alertSummary.maintenanceExpiring, icon: '🔧', bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', countCls: 'text-amber-600' },
          { key: 'normal', label: '정상', count: alertSummary.normal, icon: '✅', bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', countCls: 'text-emerald-600' },
        ].map(card => (
          <button key={card.key}
            onClick={() => setSummaryFilter(prev => prev === card.key ? '' : card.key)}
            className={`relative flex items-center gap-3 px-4 py-3 rounded-lg border transition-all text-left ${
              summaryFilter === card.key
                ? `${card.bg} ${card.border} ring-2 ring-offset-1 ring-current ${card.text} shadow-sm`
                : `bg-white border-gray-200 hover:${card.bg} hover:${card.border}`
            }`}>
            <span className="text-xl">{card.icon}</span>
            <div className="min-w-0">
              <div className={`text-xl font-bold ${summaryFilter === card.key ? card.countCls : 'text-gray-800'}`}>{card.count}</div>
              <div className={`text-[11px] ${summaryFilter === card.key ? card.text : 'text-gray-500'}`}>{card.label}</div>
            </div>
            {summaryFilter === card.key && (
              <span className="absolute top-1 right-2 text-[9px] text-gray-400">필터 적용중</span>
            )}
          </button>
        ))}
      </div>
      {/* 알림 피드 열기 버튼 */}
      {alertSummary.recentAlerts > 0 && (
        <button onClick={() => { setShowAlertFeed(true); fetchAlertFeed(); }}
          className="w-full flex items-center justify-between px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm hover:bg-red-100 transition-colors">
          <span className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
            </span>
            <span className="text-red-700 font-medium">미확인 알림 {alertSummary.recentAlerts}건</span>
          </span>
          <span className="text-red-500 text-xs">클릭하여 확인 →</span>
        </button>
      )}

      {/* ═══ Table Card ═══ */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        {/* Table Header Bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-bold text-gray-800">농장 목록</h3>
            <span className="text-xs text-gray-400">
              {hasFilters && `검색결과 ${filteredFarms.length}건 / `}총 {farms.length}건
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setShowAlertFeed(true); fetchAlertFeed(); }}
              className="relative px-3 py-1.5 rounded text-xs font-medium border bg-white text-gray-500 border-gray-300 hover:bg-gray-50 transition-colors">
              🔔 알림
              {alertSummary.recentAlerts > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] flex items-center justify-center px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none">
                  {alertSummary.recentAlerts > 99 ? '99+' : alertSummary.recentAlerts}
                </span>
              )}
            </button>
            <button onClick={() => setShowMap(true)}
              className="px-3 py-1.5 rounded text-xs font-medium border bg-white text-gray-500 border-gray-300 hover:bg-gray-50 transition-colors">
              지도
            </button>
            <button onClick={() => {
                setShowKeys(k => !k);
                // Sync with column visibility
                if (!isCol('apiKey')) setVisibleColumns(prev => [...prev, 'apiKey']);
                else setVisibleColumns(prev => prev.filter(x => x !== 'apiKey'));
              }}
              className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${isCol('apiKey') ? 'bg-amber-50 text-amber-700 border-amber-300' : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'}`}
              title={isCol('apiKey') ? 'API Key 숨기기' : 'API Key 표시'}>
              {isCol('apiKey') ? '🔓 Key 표시중' : '🔒 Key 숨김'}
            </button>
            {trashCount > 0 && (
              <button onClick={async () => {
                const next = !showTrash;
                setShowTrash(next);
                if (next) {
                  try {
                    const r = await axios.get(`${API}/farms?onlyDeleted=true`);
                    setTrashFarms(r.data.data || []);
                  } catch (err) { setTrashFarms([]); setError(err.response?.data?.error || '휴지통 조회 실패'); }
                }
              }}
                className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${showTrash ? 'bg-red-50 text-red-700 border-red-300' : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'}`}>
                🗑️ 휴지통 ({trashCount})
              </button>
            )}
            {/* Column Settings */}
            <div className="relative" ref={columnSettingsRef}>
              <button onClick={() => setShowColumnSettings(v => !v)}
                className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${showColumnSettings ? 'bg-slate-100 text-slate-700 border-slate-400' : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'}`}
                title="컬럼 설정">
                <svg className="w-3.5 h-3.5 inline -mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                {' '}컬럼
              </button>
              {showColumnSettings && (
                <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-lg shadow-xl border border-gray-200 z-50 py-2">
                  <div className="px-3 pb-2 mb-1 border-b border-gray-100 flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-700">표시할 컬럼</span>
                    <button onClick={resetColumns} className="text-[10px] text-indigo-600 hover:underline">기본값 복원</button>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {ALL_COLUMNS.map(col => (
                      <label key={col.id}
                        className={`flex items-center gap-2 px-3 py-1 text-xs cursor-pointer hover:bg-gray-50 ${col.fixed ? 'opacity-60' : ''}`}>
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
            <select value={perPage} onChange={e => { setPerPage(Number(e.target.value)); setCurrentPage(1); }}
              className="px-2 py-1.5 border border-gray-300 rounded text-xs bg-white">
              {PER_PAGE_OPTIONS.map(n => <option key={n} value={n}>{n}개씩 보기</option>)}
            </select>
            <button onClick={openNewForm}
              className="px-4 py-1.5 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700 transition-colors">
              + 농장 등록
            </button>
          </div>
        </div>

        {/* Data Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] border-collapse" style={{tableLayout:'auto'}}>
            <thead>
              <tr className="bg-slate-50 border-b border-gray-200 whitespace-nowrap">
                <th className="w-8 px-1 py-2 border-r border-gray-200">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                </th>
                <th className="w-7 px-0 py-2 text-center text-xs text-gray-400 border-r border-gray-200" title="즐겨찾기">
                  <svg className="w-3 h-3 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>
                </th>
                {isCol('no') && <th className="w-8 px-1 py-2 text-center text-xs font-semibold text-gray-600 border-r border-gray-200">No</th>}
                {isCol('farmId') && <th className="w-16 px-1 py-2 text-center text-xs font-semibold text-gray-600 border-r border-gray-200">농장ID</th>}
                {isCol('name') && <th className="min-w-[120px] px-2 py-2 text-center text-xs font-semibold text-gray-600 border-r border-gray-200">농장명</th>}
                {isCol('manager') && <th className="px-2 py-2 text-center text-xs font-semibold text-gray-600 border-r border-gray-200">대표자</th>}
                {isCol('region') && <th className="w-24 px-1 py-2 text-center text-xs font-semibold text-gray-600 border-r border-gray-200">지역</th>}
                {isCol('farmType') && <th className="w-16 px-1 py-2 text-center text-xs font-semibold text-gray-600 border-r border-gray-200">형태</th>}
                {isCol('houseCount') && <th className="w-14 px-1 py-2 text-center text-xs font-semibold text-gray-600 border-r border-gray-200">동</th>}
                {isCol('farmArea') && <th className="w-16 px-1 py-2 text-center text-xs font-semibold text-gray-600 border-r border-gray-200">면적</th>}
                {isCol('systemType') && <th className="w-20 px-1 py-2 text-center text-xs font-semibold text-gray-600 border-r border-gray-200">시스템</th>}
                {isCol('status') && <th className="px-2 py-2 text-center text-xs font-semibold text-gray-600 border-r border-gray-200">상태</th>}
                {isCol('connection') && <th className="px-2 py-2 text-center text-xs font-semibold text-gray-600 border-r border-gray-200">접속</th>}
                {isCol('maintenance') && <th className="px-2 py-2 text-center text-xs font-semibold text-gray-600 border-r border-gray-200">유지보수</th>}
                {isCol('registeredAt') && <th className="px-2 py-2 text-center text-xs font-semibold text-gray-600 border-r border-gray-200">등록일</th>}
                {isCol('apiKey') && <th className="px-2 py-2 text-center text-xs font-semibold text-gray-600 border-r border-gray-200">API Key</th>}
                {isCol('tags') && <th className="px-2 py-2 text-center text-xs font-semibold text-gray-600 border-r border-gray-200">태그</th>}
                {isCol('memo') && <th className="px-2 py-2 text-center text-xs font-semibold text-gray-600 border-r border-gray-200">메모</th>}
              </tr>
            </thead>
            <tbody>
              {paginated.map((farm, idx) => {
                const mgrs = getMgrs(farm);
                const mb = maintBadge(farm);
                const cs = connStatus(farm.lastSeenAt);
                const no = (currentPage - 1) * perPage + idx + 1;
                const selected = selectedIds.includes(farm.farmId);
                const isActive = farm.farmId === selectedFarmId;
                const isPinned = pinnedIds.includes(farm.farmId);
                const isFocused = focusedIdx === idx;
                return (
                  <tr key={farm.farmId}
                    onMouseDown={() => setFocusedIdx(idx)}
                    onDoubleClick={() => enterFarm(farm)}
                    onContextMenu={(e) => handleRowContext(e, farm)}
                    style={{ cursor: 'pointer' }}
                    className={`border-b border-gray-100 whitespace-nowrap ${
                      isFocused ? 'bg-blue-100 border-l-2 border-l-blue-500' :
                      isActive ? 'bg-blue-50/60' :
                      isPinned ? 'bg-amber-50/40' :
                      selected ? 'bg-indigo-50/50' :
                      idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'
                    } ${!isFocused ? 'hover:bg-indigo-50/40' : ''} ${isActive && !isFocused ? 'border-l-2 border-l-blue-500' : isPinned && !isFocused ? 'border-l-2 border-l-amber-400' : ''}`}>
                    <td className="px-1 py-1.5 text-center border-r border-gray-100" onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={selected} onChange={() => toggleOne(farm.farmId)}
                        className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                    </td>
                    <td className="w-7 px-0 py-1.5 text-center border-r border-gray-100" onClick={e => e.stopPropagation()}>
                      <button onClick={() => togglePin(farm.farmId)} title={isPinned ? '고정 해제' : '상단 고정'}
                        className={`transition-colors ${isPinned ? 'text-amber-500 hover:text-amber-600' : 'text-gray-300 hover:text-amber-400'}`}>
                        <svg className="w-3.5 h-3.5 mx-auto" fill={isPinned ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>
                      </button>
                    </td>
                    {isCol('no') && <td className="px-1 py-1.5 text-center text-xs text-gray-400 border-r border-gray-100">{no}</td>}
                    {isCol('farmId') && <td className="w-16 px-1 py-1.5 border-r border-gray-100">
                      <span className="text-xs font-mono text-gray-500">{farm.farmId}</span>
                    </td>}
                    {isCol('name') && <td className="min-w-[120px] px-2 py-1.5 border-r border-gray-100 truncate">
                      <button onClick={(e) => { e.stopPropagation(); openDetail(farm); }}
                        className="text-[13px] font-medium text-indigo-700 hover:text-indigo-900 hover:underline text-left truncate">
                        {farm.name}
                      </button>
                    </td>}
                    {isCol('manager') && <td className="px-2 py-1.5 text-xs text-gray-700 border-r border-gray-100 truncate">
                      {mgrs.length > 0 ? mgrs[0].name : <span className="text-gray-300">-</span>}
                    </td>}
                    {isCol('region') && <td className="w-24 px-1 py-1.5 text-xs text-gray-600 border-r border-gray-100 truncate">
                      {farm.location ? farm.location.trim().split(/\s+/).slice(0, 2).join(' ') : '-'}
                    </td>}
                    {isCol('farmType') && <td className="w-16 px-1 py-1.5 text-xs text-gray-600 border-r border-gray-100 truncate">
                      {FARM_TYPE_LABEL[farm.farmType] || '-'}
                    </td>}
                    {isCol('houseCount') && <td className="w-14 px-1 py-1.5 text-center text-xs text-gray-600 border-r border-gray-100">
                      {farm.houseCount || 0}
                    </td>}
                    {isCol('farmArea') && <td className="w-16 px-1 py-1.5 text-xs text-gray-600 text-right border-r border-gray-100">
                      {farm.farmArea ? Number(farm.farmArea).toLocaleString() : '-'}
                    </td>}
                    {isCol('systemType') && <td className="w-20 px-1 py-1.5 text-xs text-gray-600 border-r border-gray-100 truncate">
                      {SYSTEM_TYPE_LABEL[farm.systemType] || '-'}
                    </td>}
                    {isCol('status') && <td className="px-1 py-1.5 text-center border-r border-gray-100">
                      <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium ${STATUS[farm.status]?.cls || ''}`}>
                        {STATUS[farm.status]?.label || farm.status}
                      </span>
                    </td>}
                    {isCol('connection') && <td className="px-1 py-1.5 text-center border-r border-gray-100">
                      <span className="inline-flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${connDot[cs.type]}`} />
                        <span className={`text-[11px] font-medium ${cs.cls}`}>{cs.label}</span>
                      </span>
                    </td>}
                    {isCol('maintenance') && <td className="px-1 py-1.5 text-center border-r border-gray-100">
                      {mb
                        ? <span className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-medium ${mb.cls}`}>{mb.label}</span>
                        : <span className="text-xs text-gray-300">-</span>
                      }
                    </td>}
                    {isCol('registeredAt') && <td className="px-1 py-1.5 text-center text-xs text-gray-500 border-r border-gray-100">
                      {fmt(farm.registeredAt)}
                    </td>}
                    {isCol('apiKey') && (
                      <td className="px-2 py-1.5 border-r border-gray-100">
                        <div className="flex items-center gap-1">
                          <code className="text-[10px] font-mono text-gray-500 truncate" title={farm.apiKey}>
                            {farm.apiKey}
                          </code>
                          <button onClick={() => copyKey(farm.apiKey, farm.farmId)}
                            className={`flex-shrink-0 text-[10px] transition-colors ${copiedKey === farm.farmId ? 'text-emerald-600' : 'text-gray-400 hover:text-indigo-600'}`}>
                            {copiedKey === farm.farmId ? '✓' : '📋'}
                          </button>
                        </div>
                      </td>
                    )}
                    {isCol('tags') && <td className="px-2 py-1.5 text-xs text-gray-600 border-r border-gray-100 truncate max-w-[120px]">
                      {Array.isArray(farm.tags) && farm.tags.length > 0 ? farm.tags.join(', ') : <span className="text-gray-300">-</span>}
                    </td>}
                    {isCol('memo') && <td className="px-2 py-1.5 text-xs text-gray-500 border-r border-gray-100 truncate max-w-[150px]" title={farm.memo}>
                      {farm.memo || <span className="text-gray-300">-</span>}
                    </td>}
                  </tr>
                );
              })}
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={visibleCount} className="text-center py-12 text-gray-400">
                    {hasFilters
                      ? <><span>검색 결과가 없습니다.</span><br /><button onClick={clearAll} className="text-indigo-600 hover:underline text-sm mt-1">검색 초기화</button></>
                      : '등록된 농장이 없습니다.'
                    }
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 우클릭 컨텍스트 메뉴 */}
        {ctxMenu && (
          <div ref={ctxRef}
            style={{ position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999 }}
            className="bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[160px] animate-fade-in-up">
            <div className="px-3 py-1.5 border-b border-gray-100">
              <p className="text-xs font-bold text-gray-700 truncate">{ctxMenu.farm.name}</p>
              <p className="text-[10px] text-gray-400 font-mono">{ctxMenu.farm.farmId}</p>
            </div>
            {[
              { label: '접속', icon: 'M13 10V3L4 14h7v7l9-11h-7z', color: 'text-blue-600', action: () => enterFarm(ctxMenu.farm) },
              { label: '상세보기', icon: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z', color: 'text-indigo-600', action: () => openDetail(ctxMenu.farm) },
              { label: '수정', icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z', color: 'text-blue-600', action: () => handleEdit(ctxMenu.farm) },
              { label: '복제', icon: 'M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z', color: 'text-purple-600', action: () => cloneFarm(ctxMenu.farm) },
              { label: pinnedIds.includes(ctxMenu.farm.farmId) ? '즐겨찾기 해제' : '즐겨찾기', icon: 'M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z', color: 'text-amber-500', action: () => togglePin(ctxMenu.farm.farmId) },
              { divider: true },
              { label: '삭제', icon: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16', color: 'text-red-500', action: () => handleDelete(ctxMenu.farm.farmId) },
            ].map((item, i) => item.divider ? (
              <div key={i} className="border-t border-gray-100 my-1" />
            ) : (
              <button key={i} onClick={() => { item.action(); setCtxMenu(null); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-gray-50 transition-colors ${item.color}`}>
                <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={item.icon} />
                </svg>
                <span className="text-gray-700">{item.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 0 && (
          <div className="flex items-center justify-center gap-1 py-4 border-t border-gray-200 bg-white">
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

        {/* Keyboard Shortcut Hint + Pin Count */}
        <div className="flex items-center justify-between px-4 py-1.5 bg-slate-50 border-t border-gray-100">
          <span className="text-[10px] text-gray-400">
            <kbd className="px-1 py-0.5 bg-gray-200 rounded text-[9px] font-mono">J</kbd>/<kbd className="px-1 py-0.5 bg-gray-200 rounded text-[9px] font-mono">&darr;</kbd> 아래
            &nbsp;&middot;&nbsp;
            <kbd className="px-1 py-0.5 bg-gray-200 rounded text-[9px] font-mono">K</kbd>/<kbd className="px-1 py-0.5 bg-gray-200 rounded text-[9px] font-mono">&uarr;</kbd> 위
            &nbsp;&middot;&nbsp;
            <kbd className="px-1 py-0.5 bg-gray-200 rounded text-[9px] font-mono">Enter</kbd> 상세
            &nbsp;&middot;&nbsp;
            <kbd className="px-1 py-0.5 bg-gray-200 rounded text-[9px] font-mono">P</kbd> 즐겨찾기
            &nbsp;&middot;&nbsp;
            <kbd className="px-1 py-0.5 bg-gray-200 rounded text-[9px] font-mono">Esc</kbd> 닫기
          </span>
          {pinnedIds.length > 0 && (
            <span className="text-[10px] text-amber-600">
              <svg className="w-3 h-3 inline -mt-0.5 mr-0.5" fill="currentColor" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>
              {pinnedIds.length}개 고정됨
            </span>
          )}
        </div>

        {/* Bottom Action Bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t border-gray-200">
          <div className="flex items-center gap-2 flex-wrap">
            {selectedIds.length > 0 && (
              <>
                <span className="text-xs text-gray-500">{selectedIds.length}개 선택</span>
                {Object.entries(STATUS).map(([k, v]) => (
                  <button key={k} onClick={() => handleBatchStatus(k)}
                    className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${v.cls}`}>
                    {v.label}
                  </button>
                ))}
                <button onClick={handleBatchDelete}
                  className="px-3 py-1.5 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700 transition-colors">
                  삭제
                </button>
                <span className="w-px h-5 bg-gray-300" />
              </>
            )}
            <button onClick={exportExcel}
              className="px-4 py-1.5 bg-emerald-600 text-white rounded text-xs font-medium hover:bg-emerald-700 transition-colors">
              엑셀 다운로드
            </button>
            <button onClick={() => setShowImport(true)}
              className="px-4 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 transition-colors">
              엑셀 업로드
            </button>
          </div>
          <div className="text-xs text-gray-400">
            {filteredFarms.length > 0 && `${(currentPage - 1) * perPage + 1}-${Math.min(currentPage * perPage, filteredFarms.length)} / ${filteredFarms.length}건`}
          </div>
        </div>
      </div>

      {/* ═══ Trash Table ═══ */}
      {showTrash && trashFarms.length > 0 && (
        <div className="bg-white rounded-lg border-2 border-red-300 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-red-200 bg-red-50">
            <h3 className="text-sm font-bold text-red-700">🗑️ 휴지통 ({trashFarms.length}개)</h3>
            <span className="text-xs text-red-500">삭제 후 30일이 지나면 자동 영구 삭제됩니다</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px] border-collapse">
              <thead>
                <tr className="bg-red-50/50 border-b border-red-200 whitespace-nowrap">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">농장ID</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-gray-600">농장명</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">삭제일</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">남은 일수</th>
                  <th className="px-3 py-2 text-center text-xs font-semibold text-gray-600">관리</th>
                </tr>
              </thead>
              <tbody>
                {trashFarms.map(tf => {
                  const deletedAt = tf.deletedAt ? new Date(tf.deletedAt) : null;
                  const daysElapsed = deletedAt ? Math.floor((Date.now() - deletedAt.getTime()) / 86400000) : 0;
                  const daysLeft = Math.max(0, 30 - daysElapsed);
                  return (
                    <tr key={tf.farmId} className="border-b border-red-100 hover:bg-red-50/30">
                      <td className="px-3 py-2 text-xs font-mono text-gray-500">{tf.farmId}</td>
                      <td className="px-3 py-2 text-sm text-gray-700">{tf.name}</td>
                      <td className="px-3 py-2 text-center text-xs text-gray-500">{deletedAt ? fmt(deletedAt) : '-'}</td>
                      <td className="px-3 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${daysLeft <= 7 ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                          {daysLeft}일
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button onClick={async () => {
                            try {
                              await axios.post(`${API}/farms/${tf.farmId}/restore`);
                              setTrashFarms(p => p.filter(x => x.farmId !== tf.farmId));
                              setTrashCount(p => Math.max(0, p - 1));
                              fetchFarms();
                            } catch (err) { setError(err.response?.data?.error || '복원 실패'); }
                          }}
                            className="px-2 py-1 text-xs text-emerald-600 hover:bg-emerald-50 rounded font-medium transition-colors">
                            복원
                          </button>
                          <button onClick={async () => {
                            if (!confirm(`"${tf.farmId}" 농장을 영구 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;
                            try {
                              await axios.delete(`${API}/farms/${tf.farmId}/permanent`);
                              setTrashFarms(p => p.filter(x => x.farmId !== tf.farmId));
                              setTrashCount(p => Math.max(0, p - 1));
                            } catch (err) { setError(err.response?.data?.error || '영구 삭제 실패'); }
                          }}
                            className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded font-medium transition-colors">
                            영구삭제
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ Form Modal ═══ */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 pt-[5vh] overflow-y-auto">
          <div className="bg-white rounded-lg w-full max-w-2xl shadow-xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-slate-600 rounded-t-lg">
              <h3 className="text-base font-bold text-white">{editFarm ? '농장 수정' : '새 농장 등록'}</h3>
              <button onClick={() => { setShowForm(false); setEditFarm(null); }}
                className="text-white/70 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSubmit}>
              <div className="p-6">
                <table className="w-full border-collapse">
                  <tbody>
                    {/* 농장 ID */}
                    <tr>
                      <td className="bg-slate-50 px-4 py-3 text-sm font-medium text-gray-700 border border-gray-200 w-32 align-top">
                        농장 ID <span className="text-red-500">*</span>
                      </td>
                      <td className="px-4 py-2.5 border border-gray-200">
                        <div className="flex items-center gap-2">
                          <input type="text" value={form.farmId}
                            onChange={e => setForm({ ...form, farmId: e.target.value })}
                            disabled={!!editFarm || autoId} placeholder="farm_0002" required
                            className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm disabled:bg-gray-100 disabled:text-gray-400 focus:outline-none focus:border-indigo-500" />
                          {!editFarm && (
                            <button type="button" onClick={() => setAutoId(!autoId)}
                              className="px-3 py-1.5 border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-50 whitespace-nowrap">
                              {autoId ? '직접 입력' : '자동 부여'}
                            </button>
                          )}
                        </div>
                        {!editFarm && autoId && form.farmId && (
                          <p className="text-xs text-indigo-500 mt-1">자동 부여: {form.farmId}</p>
                        )}
                      </td>
                    </tr>

                    {/* 농장 이름 */}
                    <tr>
                      <td className="bg-slate-50 px-4 py-3 text-sm font-medium text-gray-700 border border-gray-200 align-top">
                        농장 이름 <span className="text-red-500">*</span>
                      </td>
                      <td className="px-4 py-2.5 border border-gray-200">
                        <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                          placeholder="스마트팜" required
                          className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:border-indigo-500" />
                      </td>
                    </tr>

                    {/* 형태 */}
                    <tr>
                      <td className="bg-slate-50 px-4 py-3 text-sm font-medium text-gray-700 border border-gray-200">형태</td>
                      <td className="px-4 py-2.5 border border-gray-200">
                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2">
                            {[
                              { value: 'single_house', label: '단동하우스' },
                              { value: 'multi_house', label: '연동하우스' },
                              { value: 'open_field', label: '노지' },
                            ].map(opt => (
                              <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer">
                                <input type="radio" name="farmType" value={opt.value}
                                  checked={form.farmType === opt.value}
                                  onChange={e => setForm({ ...form, farmType: e.target.value })}
                                  className="w-3.5 h-3.5 text-indigo-600 border-gray-300 focus:ring-indigo-500" />
                                <span className="text-sm text-gray-700">{opt.label}</span>
                              </label>
                            ))}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <input type="number" value={form.farmArea} onChange={e => setForm({ ...form, farmArea: e.target.value })}
                              placeholder="면적" className="w-24 px-2 py-1.5 border border-gray-300 rounded text-sm text-right focus:outline-none focus:border-indigo-500" />
                            <span className="text-sm text-gray-500">평</span>
                          </div>
                        </div>
                      </td>
                    </tr>

                    {/* 주소 */}
                    <tr>
                      <td className="bg-slate-50 px-4 py-3 text-sm font-medium text-gray-700 border border-gray-200">주소</td>
                      <td className="px-4 py-2.5 border border-gray-200">
                        <input type="text" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })}
                          placeholder="전라남도 장성군 월야면 115번지"
                          className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:border-indigo-500" />
                      </td>
                    </tr>

                    {/* 관리자 */}
                    <tr>
                      <td className="bg-slate-50 px-4 py-3 text-sm font-medium text-gray-700 border border-gray-200 align-top">
                        관리자
                        <button type="button" onClick={addMgr}
                          className="block text-[10px] text-indigo-600 hover:text-indigo-800 mt-1 font-normal">+ 추가</button>
                      </td>
                      <td className="px-4 py-2.5 border border-gray-200">
                        <div className="space-y-2">
                          {form.managers.map((mgr, idx) => {
                            const suggestions = mgrSearchIdx === idx ? getMgrSuggestions(idx) : [];
                            return (
                            <div key={idx} className="flex items-start gap-2 bg-gray-50 rounded p-2.5 relative">
                              <div className="flex-1 space-y-1.5">
                                <div className="flex items-center gap-1 mb-1">
                                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${idx === 0 ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-200 text-gray-500'}`}>
                                    {idx === 0 ? '대표자' : `관리자 ${idx + 1}`}
                                  </span>
                                  {mgr._username && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                                      {mgr._username} (시스템 연결)
                                    </span>
                                  )}
                                </div>
                                <div className="grid grid-cols-3 gap-1.5">
                                  <div className="relative">
                                    <input type="text" value={mgr.name} onChange={e => updateMgr(idx, 'name', e.target.value)}
                                      onFocus={() => { if (mgr.name) setMgrSearchIdx(idx); }}
                                      onBlur={() => setTimeout(() => setMgrSearchIdx(-1), 200)}
                                      placeholder="이름 (검색)" autoComplete="off"
                                      className="w-full px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:border-indigo-500" />
                                    {suggestions.length > 0 && (
                                      <div className="absolute z-50 left-0 right-0 top-full mt-0.5 bg-white border border-gray-300 rounded shadow-lg max-h-48 overflow-y-auto">
                                        {suggestions.map(u => (
                                          <button key={u.id} type="button"
                                            onMouseDown={e => { e.preventDefault(); selectMgrUser(idx, u); }}
                                            className="w-full text-left px-2 py-1.5 hover:bg-indigo-50 text-xs border-b border-gray-100 last:border-0">
                                            <span className="font-medium text-gray-800">{u.name}</span>
                                            <span className="text-gray-400 ml-1">({u.username})</span>
                                            <span className={`ml-1 px-1 py-0.5 rounded text-[10px] ${
                                              { superadmin: 'bg-red-100 text-red-600', manager: 'bg-purple-100 text-purple-600',
                                                owner: 'bg-blue-100 text-blue-600', worker: 'bg-gray-100 text-gray-500' }[u.role] || 'bg-gray-100 text-gray-500'
                                            }`}>{{ superadmin: '최고관리자', manager: '관리직원', owner: '농장대표', worker: '작업자' }[u.role] || u.role}</span>
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                  <input type="text" value={mgr.phone} onChange={e => updateMgr(idx, 'phone', e.target.value)}
                                    placeholder="전화번호" className="px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:border-indigo-500" />
                                  <input type="email" value={mgr.email} onChange={e => updateMgr(idx, 'email', e.target.value)}
                                    placeholder="이메일" className="px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:border-indigo-500" />
                                </div>
                              </div>
                              {form.managers.length > 1 && (
                                <button type="button" onClick={() => rmMgr(idx)}
                                  className="text-gray-300 hover:text-red-500 transition-colors mt-5">
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                              )}
                            </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>

                    {/* 사업구분 */}
                    <tr>
                      <td className="bg-slate-50 px-4 py-3 text-sm font-medium text-gray-700 border border-gray-200 align-top">사업구분</td>
                      <td className="px-4 py-2.5 border border-gray-200">
                        <div className="flex items-center gap-2 mb-2">
                          <select value={form.businessProjectId} onChange={e => setForm({ ...form, businessProjectId: e.target.value })}
                            className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm bg-white focus:outline-none focus:border-indigo-500">
                            <option value="">선택 안함</option>
                            {businessProjects.map(p => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                          {!showNewBizForm && (
                            <button type="button" onClick={() => { setShowNewBizForm(true); setNewBizName(''); }}
                              className="px-3 py-1.5 text-xs font-medium text-indigo-600 border border-indigo-300 rounded hover:bg-indigo-50 whitespace-nowrap">
                              + 새 사업
                            </button>
                          )}
                        </div>
                        {showNewBizForm && (
                          <div className="flex items-center gap-2 mb-2 p-2.5 bg-indigo-50 rounded-lg border border-indigo-200">
                            <input type="text" value={newBizName} onChange={e => setNewBizName(e.target.value)}
                              placeholder="사업명 입력" className="flex-1 px-2.5 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:border-indigo-500" />
                            <button type="button" onClick={async () => {
                              if (!newBizName.trim()) return;
                              try {
                                const r = await axios.post(`${API}/farms/business-projects`, { name: newBizName.trim() });
                                const created = r.data.data;
                                setBusinessProjects(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
                                setForm({ ...form, businessProjectId: created.id });
                                setShowNewBizForm(false);
                                setNewBizName('');
                              } catch (err) { setError(err.response?.data?.error || '사업 등록 실패'); }
                            }} className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 rounded hover:bg-indigo-700 whitespace-nowrap">등록</button>
                          </div>
                        )}
                        {form.businessProjectId && (
                          <div>
                            <div className="flex items-center gap-3 mb-2">
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input type="radio" name="businessType" value="self" checked={form.businessType === 'self'} onChange={() => setForm({ ...form, businessType: 'self', totalCost: '', subsidyAmount: '', selfFunding: '' })} className="w-3.5 h-3.5 text-indigo-600" />
                                <span className="text-sm text-gray-700">자체사업</span>
                              </label>
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input type="radio" name="businessType" value="subsidy" checked={form.businessType === 'subsidy'} onChange={() => setForm({ ...form, businessType: 'subsidy' })} className="w-3.5 h-3.5 text-indigo-600" />
                                <span className="text-sm text-gray-700">보조사업</span>
                              </label>
                            </div>
                            {form.businessType === 'subsidy' && (<>
                              <div className="grid grid-cols-3 gap-2">
                                <div>
                                  <label className="text-[11px] text-gray-500 mb-0.5 block">총사업비 (원)</label>
                                  <input type="text" value={form.totalCost ? Number(form.totalCost).toLocaleString() : ''} onChange={e => setForm({ ...form, totalCost: e.target.value.replace(/[^0-9]/g, '') })}
                                    placeholder="0" className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-sm text-right focus:outline-none focus:border-indigo-500" />
                                </div>
                                <div>
                                  <label className="text-[11px] text-gray-500 mb-0.5 block">보조금 (원)</label>
                                  <input type="text" value={form.subsidyAmount ? Number(form.subsidyAmount).toLocaleString() : ''} onChange={e => setForm({ ...form, subsidyAmount: e.target.value.replace(/[^0-9]/g, '') })}
                                    placeholder="0" className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-sm text-right focus:outline-none focus:border-indigo-500" />
                                </div>
                                <div>
                                  <label className="text-[11px] text-gray-500 mb-0.5 block">자부담 (원)</label>
                                  <input type="text" value={form.selfFunding ? Number(form.selfFunding).toLocaleString() : ''} onChange={e => setForm({ ...form, selfFunding: e.target.value.replace(/[^0-9]/g, '') })}
                                    placeholder="0" className="w-full px-2.5 py-1.5 border border-gray-300 rounded text-sm text-right focus:outline-none focus:border-indigo-500" />
                                </div>
                              </div>
                              {/* 금액 검증 메시지 */}
                              {(() => {
                                const t = Number(form.totalCost) || 0;
                                const s = Number(form.subsidyAmount) || 0;
                                const f = Number(form.selfFunding) || 0;
                                if (t > 0 && s + f > 0 && t !== s + f) {
                                  const diff = t - s - f;
                                  return (
                                    <div className="mt-1.5 px-2.5 py-1.5 bg-red-50 border border-red-200 rounded text-xs text-red-600 flex items-center gap-1.5">
                                      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                      총사업비 ≠ 보조금 + 자부담 (차이: {Math.abs(diff).toLocaleString()}원 {diff > 0 ? '부족' : '초과'})
                                    </div>
                                  );
                                }
                                if (t > 0 && s + f > 0 && t === s + f) {
                                  return (
                                    <div className="mt-1.5 px-2.5 py-1.5 bg-emerald-50 border border-emerald-200 rounded text-xs text-emerald-600 flex items-center gap-1.5">
                                      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                      금액이 일치합니다
                                    </div>
                                  );
                                }
                                return null;
                              })()}
                            </>)}
                          </div>
                        )}
                      </td>
                    </tr>

                    {/* 시스템 형태 */}
                    <tr>
                      <td className="bg-slate-50 px-4 py-3 text-sm font-medium text-gray-700 border border-gray-200">시스템 형태</td>
                      <td className="px-4 py-2.5 border border-gray-200">
                        <div className="flex flex-wrap gap-3">
                          {[
                            { value: 'env_control', label: '환경제어형' },
                            { value: 'nutrient_control', label: '양액제어형' },
                            { value: 'irrigation_control', label: '관수제어형' },
                            { value: 'env_nutrient_complex', label: '환경양액복합제어형' },
                            { value: 'env_irrigation_complex', label: '환경관수복합제어형' },
                            { value: 'other', label: '기타' },
                          ].map(opt => (
                            <label key={opt.value} className="flex items-center gap-1.5 cursor-pointer">
                              <input type="radio" name="systemType" value={opt.value}
                                checked={form.systemType === opt.value}
                                onChange={e => setForm({ ...form, systemType: e.target.value })}
                                className="w-3.5 h-3.5 text-indigo-600 focus:ring-indigo-500" />
                              <span className="text-sm text-gray-700">{opt.label}</span>
                            </label>
                          ))}
                        </div>
                      </td>
                    </tr>

                    {/* 상태 */}
                    <tr>
                      <td className="bg-slate-50 px-4 py-3 text-sm font-medium text-gray-700 border border-gray-200">상태</td>
                      <td className="px-4 py-2.5 border border-gray-200">
                        <div className="flex items-center gap-3">
                          {Object.entries(STATUS).map(([k, v]) => (
                            <label key={k} className="flex items-center gap-1.5 cursor-pointer">
                              <input type="radio" name="status" value={k} checked={form.status === k}
                                onChange={e => setForm({ ...form, status: e.target.value })}
                                className="w-3.5 h-3.5 text-indigo-600 border-gray-300 focus:ring-indigo-500" />
                              <span className="text-sm text-gray-700">{v.label}</span>
                            </label>
                          ))}
                        </div>
                      </td>
                    </tr>

                    {/* 시스템 계정 연결 */}
                    <tr>
                      <td className="bg-slate-50 px-4 py-3 text-sm font-medium text-gray-700 border border-gray-200 align-top">시스템 계정</td>
                      <td className="px-4 py-2.5 border border-gray-200">
                        {form.representativeUserId ? (() => {
                          const linked = formUsers.find(u => u.id === form.representativeUserId);
                          const roleMap = { superadmin: '최고관리자', manager: '관리직원', owner: '농장대표', worker: '작업자' };
                          return linked ? (
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 border border-green-200 rounded text-sm text-green-800">
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                {linked.name} ({linked.username}) - {roleMap[linked.role] || linked.role}
                              </span>
                              <button type="button" onClick={() => setForm({ ...form, representativeUserId: '' })}
                                className="text-xs text-gray-400 hover:text-red-500">해제</button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-400">ID: {form.representativeUserId}</span>
                              <button type="button" onClick={() => setForm({ ...form, representativeUserId: '' })}
                                className="text-xs text-gray-400 hover:text-red-500">해제</button>
                            </div>
                          );
                        })() : (
                          <span className="text-xs text-gray-400">위 관리자(대표자) 이름 입력 시 시스템 사용자를 검색하여 자동 연결됩니다</span>
                        )}
                      </td>
                    </tr>

                    {/* 등록일 */}
                    <tr>
                      <td className="bg-slate-50 px-4 py-3 text-sm font-medium text-gray-700 border border-gray-200">등록일</td>
                      <td className="px-4 py-2.5 border border-gray-200">
                        <input type="date" value={form.registeredAt} onChange={e => setForm({ ...form, registeredAt: e.target.value })}
                          className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:border-indigo-500" />
                      </td>
                    </tr>

                    {/* 유지보수 */}
                    <tr>
                      <td className="bg-slate-50 px-4 py-3 text-sm font-medium text-gray-700 border border-gray-200 align-top">유지보수</td>
                      <td className="px-4 py-2.5 border border-gray-200">
                        <div className="flex items-center gap-3">
                          <div>
                            <label className="block text-[11px] text-gray-400 mb-0.5">시작일</label>
                            <input type="date" value={form.maintenanceStartAt} onChange={e => setForm({ ...form, maintenanceStartAt: e.target.value })}
                              className="px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:border-indigo-500" />
                          </div>
                          <div>
                            <label className="block text-[11px] text-gray-400 mb-0.5">기간</label>
                            <select value={form.maintenanceMonths} onChange={e => setForm({ ...form, maintenanceMonths: parseInt(e.target.value) })}
                              className="px-3 py-1.5 border border-gray-300 rounded text-sm bg-white focus:outline-none focus:border-indigo-500">
                              <option value={0}>없음</option>
                              <option value={3}>3개월</option>
                              <option value={6}>6개월</option>
                              <option value={12}>1년</option>
                              <option value={18}>1년 6개월</option>
                              <option value={24}>2년</option>
                              <option value={36}>3년</option>
                              <option value={48}>4년</option>
                              <option value={60}>5년</option>
                            </select>
                          </div>
                        </div>
                      </td>
                    </tr>

                    {/* 태그 */}
                    <tr>
                      <td className="bg-slate-50 px-4 py-3 text-sm font-medium text-gray-700 border border-gray-200 align-top">태그</td>
                      <td className="px-4 py-2.5 border border-gray-200">
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-1.5">
                            {(form.tags || []).map((tag, i) => (
                              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded text-xs font-medium">
                                {tag}
                                <button type="button" onClick={() => setForm({ ...form, tags: form.tags.filter((_, j) => j !== i) })}
                                  className="text-indigo-400 hover:text-indigo-700">&times;</button>
                              </span>
                            ))}
                          </div>
                          <input type="text" ref={tagInputRef} placeholder="태그 입력 후 Enter (예: 딸기, 수출농가)"
                            className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:border-indigo-500"
                            onKeyDown={e => {
                              if (e.key === 'Enter' || e.key === ',') {
                                e.preventDefault();
                                const val = e.target.value.trim().replace(/,/g, '');
                                if (val && !(form.tags || []).includes(val)) {
                                  setForm({ ...form, tags: [...(form.tags || []), val] });
                                }
                                e.target.value = '';
                              }
                            }} />
                          {allTags.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {allTags.filter(t => !(form.tags || []).includes(t)).slice(0, 10).map(tag => (
                                <button key={tag} type="button"
                                  onClick={() => setForm({ ...form, tags: [...(form.tags || []), tag] })}
                                  className="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[11px] hover:bg-indigo-50 hover:text-indigo-600 transition-colors">
                                  + {tag}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* 메모 */}
                    <tr>
                      <td className="bg-slate-50 px-4 py-3 text-sm font-medium text-gray-700 border border-gray-200 align-top">메모</td>
                      <td className="px-4 py-2.5 border border-gray-200">
                        <textarea value={form.memo} onChange={e => setForm({ ...form, memo: e.target.value })}
                          rows={3} placeholder="특이사항을 입력하세요"
                          className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm resize-none focus:outline-none focus:border-indigo-500" />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-center gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
                <button type="button" onClick={() => { setShowForm(false); setEditFarm(null); }}
                  className="px-6 py-2 bg-white border border-gray-300 rounded text-sm text-gray-600 hover:bg-gray-50 transition-colors">
                  취소
                </button>
                <button type="submit"
                  className="px-8 py-2 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700 transition-colors">
                  {editFarm ? '수정' : '등록'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ═══ Detail Modal ═══ */}
      {detailFarm && (() => {
        const cs = connStatus(detailFarm.lastSeenAt);
        const mb = maintBadge(detailFarm);
        const mgrs = getMgrs(detailFarm);
        return (
          <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 pt-[5vh] overflow-y-auto">
            <div className="bg-white rounded-lg w-full max-w-5xl shadow-xl">
              {/* Modal Header */}
              <div className="px-6 py-4 border-b border-gray-200 bg-slate-600 rounded-t-lg">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-white">{detailFarm.name}</h3>
                    <p className="text-sm text-white/70 mt-0.5">{detailFarm.farmId} · {detailFarm.location || '주소 없음'}</p>
                  </div>
                  <button onClick={() => setDetailFarm(null)}
                    className="text-white/70 hover:text-white transition-colors">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-gray-200 bg-white overflow-x-auto">
                {[
                  { key: 'info', label: '기본정보' },
                  { key: 'stats', label: '현황' },
                  { key: 'houses', label: `하우스 (${farmHouses.length})` },
                  { key: 'schedules', label: `일정 (${scheduleSummary.upcoming || 0})` },
                  { key: 'maintenance', label: `유지보수 (${maintLogs.length})` },
                  { key: 'documents', label: `문서 (${docSummary.total || 0})` },
                  { key: 'audit', label: '변경이력' },
                  { key: 'alerts', label: `알림내역 (${farmAlerts.length})` },
                  { key: 'notes', label: `메모 (${farmNotes.length})` },
                  { key: 'apikey', label: 'API 키' },
                ].map(tab => (
                  <button key={tab.key} onClick={() => setDetailTab(tab.key)}
                    className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${detailTab === tab.key
                      ? 'border-indigo-600 text-indigo-700'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}>
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              <div className="p-6" ref={detailRef}>

                {/* Loading Skeleton */}
                {detailLoading && (
                  <div className="space-y-4 animate-pulse">
                    <div className="grid grid-cols-2 gap-4">
                      {[...Array(6)].map((_, i) => (
                        <div key={i} className="space-y-2">
                          <div className="h-3 w-20 bg-gray-200 rounded"></div>
                          <div className="h-8 bg-gray-100 rounded"></div>
                        </div>
                      ))}
                    </div>
                    <div className="h-px bg-gray-100 my-4"></div>
                    <div className="space-y-3">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <div className="h-4 w-4 bg-gray-200 rounded"></div>
                          <div className="h-4 flex-1 bg-gray-100 rounded"></div>
                          <div className="h-4 w-24 bg-gray-100 rounded"></div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 기본정보 탭 */}
                {!detailLoading && detailTab === 'info' && (
                  <div>
                  <table className="w-full border-collapse">
                    <tbody>
                      {[
                        { label: '농장 ID', value: detailFarm.farmId },
                        { label: '농장명', value: (
                          <div className="flex items-center gap-3">
                            {onNavigateFarm ? (
                              <button
                                onClick={() => onNavigateFarm(detailFarm.farmId, { name: detailFarm.name, location: detailFarm.location })}
                                className="text-indigo-600 hover:text-indigo-800 font-semibold hover:underline transition-colors"
                                title="이 농장 대시보드로 이동"
                              >
                                {detailFarm.name} →
                              </button>
                            ) : (
                              <span>{detailFarm.name}</span>
                            )}
                            {detailFarm.farmType && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                                {FARM_TYPE_LABEL[detailFarm.farmType] || detailFarm.farmType}
                                {detailFarm.farmArea ? ` · ${detailFarm.farmArea}평` : ''}
                              </span>
                            )}
                            {!detailFarm.farmType && detailFarm.farmArea && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-gray-50 text-gray-600 border border-gray-200">
                                {detailFarm.farmArea}평
                              </span>
                            )}
                            {detailFarm.systemType && (
                              <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-violet-50 text-violet-700 border border-violet-200">
                                {SYSTEM_TYPE_LABEL[detailFarm.systemType] || detailFarm.systemType}
                              </span>
                            )}
                          </div>
                        ) },
                        { label: '주소', value: detailFarm.location || '-' },
                        { label: '상태', value: <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS[detailFarm.status]?.cls || ''}`}>{STATUS[detailFarm.status]?.label || detailFarm.status}</span> },
                        { label: '접속상태', value: <span className="inline-flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${connDot[cs.type]}`} /><span className={`text-sm ${cs.cls}`}>{cs.label}</span>{detailFarm.lastSeenAt && cs.type !== 'online' && <span className="text-xs text-gray-400 ml-1">({new Date(detailFarm.lastSeenAt).toLocaleString('ko-KR')})</span>}</span> },
                        { label: '등록일', value: fmt(detailFarm.registeredAt) },
                        { label: '유지보수', value: mb
                          ? <span className="inline-flex items-center gap-2"><span className={`px-2 py-0.5 rounded text-xs font-medium ${mb.cls}`}>{mb.label}</span><span className="text-xs text-gray-500">({detailFarm.maintenanceMonths}개월, ~{fmt(detailFarm.maintenanceExpiresAt)})</span></span>
                          : <span className="text-gray-400 text-sm">없음</span>
                        },
                        { label: '하우스', value: `${detailFarm.houseCount || 0}동` },
                        { label: '사용자', value: `${detailFarm.userCount || 0}명` },
                        { label: '대표자', value: mgrs.length > 0 ? mgrs.map((m, i) => (
                          <span key={i} className="inline-flex items-center gap-2 mr-3 text-sm">
                            <span className="font-medium text-gray-700">{m.name}</span>
                            {m.phone && <span className="text-gray-400">{m.phone}</span>}
                            {m.email && <span className="text-gray-400">{m.email}</span>}
                          </span>
                        )) : '-' },
                        { label: '사업구분', value: (() => {
                          const bp = detailFarm.businessProject;
                          const bt = detailFarm.businessType;
                          if (!bp) return '-';
                          return (
                            <div>
                              <span className="text-sm font-medium text-gray-700">{bp.name}</span>
                              {bt && (
                                <span className={`ml-2 px-2 py-0.5 rounded text-xs font-medium ${bt === 'subsidy' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                                  {bt === 'subsidy' ? '보조사업' : '자체사업'}
                                </span>
                              )}
                              {bt === 'subsidy' && (detailFarm.totalCost || detailFarm.subsidyAmount || detailFarm.selfFunding) && (
                                <div className="mt-1.5 flex gap-4 text-xs text-gray-500">
                                  {detailFarm.totalCost != null && <span>총사업비 <strong className="text-gray-700">{Number(detailFarm.totalCost).toLocaleString()}원</strong></span>}
                                  {detailFarm.subsidyAmount != null && <span>보조금 <strong className="text-blue-600">{Number(detailFarm.subsidyAmount).toLocaleString()}원</strong></span>}
                                  {detailFarm.selfFunding != null && <span>자부담 <strong className="text-amber-600">{Number(detailFarm.selfFunding).toLocaleString()}원</strong></span>}
                                </div>
                              )}
                            </div>
                          );
                        })() },
                        { label: '태그', value: Array.isArray(detailFarm.tags) && detailFarm.tags.length > 0
                          ? <div className="flex flex-wrap gap-1">{detailFarm.tags.map(t => <span key={t} className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded text-xs font-medium">{t}</span>)}</div>
                          : '-'
                        },
                        { label: '메모', value: (() => {
                          // 시스템 메모: 최근 알림 확인/조치/삭제 기록
                          const sysNotes = farmAlerts
                            .filter(a => a.acknowledged || a.metadata?.resolution || a.deleted)
                            .slice(0, 3)
                            .map(a => {
                              const who = a.acknowledgedBy || '';
                              const delWho = a.deletedBy || '';
                              return {
                                type: 'system',
                                text: a.deleted
                                  ? `[삭제${delWho ? `/${delWho}` : ''}] ${a.message}`
                                  : a.metadata?.resolution
                                    ? `[조치${who ? `/${who}` : ''}] ${a.message} → ${a.metadata.resolution}`
                                    : `[확인${who ? `/${who}` : ''}] ${a.message}`,
                                time: a.deletedAt || a.metadata?.resolvedAt || a.acknowledgedAt || a.createdAt,
                              };
                            });
                          // 사용자 메모
                          const userNotes = farmNotes.slice(0, 3).map(n => ({
                            type: 'user',
                            text: n.content,
                            time: n.createdAt,
                            author: n.author,
                          }));
                          // 합쳐서 시간순 정렬
                          const combined = [...sysNotes, ...userNotes].sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 5);

                          return (
                            <div className="space-y-2 w-full">
                              {/* 빠른 메모 입력 */}
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  value={newNote}
                                  onChange={e => setNewNote(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter' && newNote.trim()) { addNote(); } }}
                                  placeholder="메모를 입력하세요..."
                                  className="flex-1 px-3 py-1.5 border border-gray-300 rounded text-sm focus:outline-none focus:border-indigo-500"
                                />
                                <button onClick={addNote} disabled={!newNote.trim()}
                                  className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors whitespace-nowrap">
                                  추가
                                </button>
                              </div>
                              {/* 최근 메모 + 시스템 기록 */}
                              {combined.length > 0 ? (
                                <div className="space-y-1">
                                  {combined.map((item, i) => (
                                    <div key={i} className="flex items-start gap-2 text-xs">
                                      <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium mt-0.5 ${
                                        item.type === 'system' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'
                                      }`}>
                                        {item.type === 'system' ? '시스템' : item.author || '사용자'}
                                      </span>
                                      <span className="text-gray-700 flex-1 leading-relaxed">{item.text}</span>
                                      <span className="text-[10px] text-gray-400 flex-shrink-0 mt-0.5">
                                        {item.time ? new Date(item.time).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) : ''}
                                      </span>
                                    </div>
                                  ))}
                                  {(farmNotes.length > 3 || sysNotes.length > 0) && (
                                    <button onClick={() => setDetailTab('notes')}
                                      className="text-[11px] text-indigo-600 hover:underline mt-1">
                                      전체 메모 보기 →
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <p className="text-xs text-gray-400">{detailFarm.memo || '메모가 없습니다'}</p>
                              )}
                            </div>
                          );
                        })() },
                      ].map(row => (
                        <tr key={row.label}>
                          <td className="bg-slate-50 px-4 py-2.5 text-sm font-medium text-gray-700 border border-gray-200 w-32">{row.label}</td>
                          <td className="px-4 py-2.5 text-sm text-gray-700 border border-gray-200">{row.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* 백업/복원 */}
                  <div className="mt-6 border border-gray-200 rounded-lg p-4">
                    <h5 className="text-sm font-semibold text-gray-700 mb-3">백업 / 복원</h5>
                    <div className="flex items-center gap-3 flex-wrap">
                      <button onClick={async () => {
                        try {
                          const r = await axios.get(`${API}/farms/${detailFarm.farmId}/backup`, { responseType: 'blob' });
                          const url = window.URL.createObjectURL(new Blob([r.data]));
                          const a = document.createElement('a');
                          a.href = url; a.download = `farm_${detailFarm.farmId}_backup_${new Date().toISOString().split('T')[0]}.json`;
                          document.body.appendChild(a); a.click(); a.remove();
                          window.URL.revokeObjectURL(url);
                        } catch { setError('백업 다운로드 실패'); }
                      }}
                        className="px-4 py-1.5 bg-emerald-600 text-white rounded text-xs font-medium hover:bg-emerald-700 transition-colors">
                        백업 다운로드
                      </button>
                      <label className={`px-4 py-1.5 rounded text-xs font-medium cursor-pointer transition-colors ${restoring ? 'bg-gray-300 text-gray-500' : 'bg-amber-600 text-white hover:bg-amber-700'}`}>
                        {restoring ? '복원 중...' : '복원 업로드'}
                        <input type="file" accept=".json" className="hidden" disabled={restoring}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file || !detailFarm) return;
                            setRestoring(true); setRestoreResult(null);
                            try {
                              const text = await file.text();
                              const configData = JSON.parse(text);
                              const r = await axios.post(`${API}/farms/${detailFarm.farmId}/restore-config?clearExisting=true`, configData);
                              setRestoreResult({ success: true, data: r.data.data });
                              // Refresh detail
                              const dr = await axios.get(`${API}/farms/${detailFarm.farmId}`);
                              setFarmHouses(dr.data.data.houses || []);
                              setFarmUsers(dr.data.data.users || []);
                              fetchFarms();
                            } catch (err) {
                              setRestoreResult({ success: false, error: err.response?.data?.error || '복원 실패' });
                            }
                            finally { setRestoring(false); e.target.value = ''; }
                          }} />
                      </label>
                    </div>
                    {restoreResult && (
                      <div className={`mt-3 p-3 rounded-lg border text-sm ${restoreResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                        {restoreResult.success
                          ? <>복원 완료: 하우스 {restoreResult.data?.houses || 0}개, 자동화 {restoreResult.data?.automationRules || 0}개 복원됨</>
                          : <>복원 실패: {restoreResult.error}</>
                        }
                      </div>
                    )}
                    <p className="text-[11px] text-gray-400 mt-2">백업 파일(.json)을 업로드하면 기존 설정을 덮어씁니다. 주의하여 사용하세요.</p>
                  </div>
                  </div>
                )}

                {/* 현황 탭 */}
                {!detailLoading && detailTab === 'stats' && (
                  farmStats ? (
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {[
                          { label: '하우스', value: farmStats.houseCount, unit: '동', color: 'text-indigo-700', bg: 'bg-indigo-50' },
                          { label: '자동화 규칙', value: farmStats.automationCount, unit: '개', color: 'text-blue-700', bg: 'bg-blue-50' },
                          { label: '미확인 알림', value: farmStats.alerts?.unacknowledged || 0, unit: '건', color: 'text-red-700', bg: 'bg-red-50' },
                          { label: '30일 알림', value: farmStats.alerts?.total30d || 0, unit: '건', color: 'text-amber-700', bg: 'bg-amber-50' },
                        ].map(s => (
                          <div key={s.label} className={`${s.bg} rounded-lg p-3 text-center`}>
                            <div className="text-xs text-gray-500 mb-1">{s.label}</div>
                            <div className={`text-xl font-bold ${s.color}`}>{s.value}<span className="text-xs text-gray-400 ml-1">{s.unit}</span></div>
                          </div>
                        ))}
                      </div>
                      {/* 알림 분포 */}
                      {farmStats.alerts?.bySeverity && Object.keys(farmStats.alerts.bySeverity).length > 0 && (
                        <div className="border border-gray-200 rounded-lg p-4">
                          <h5 className="text-sm font-semibold text-gray-700 mb-2">30일 알림 분포</h5>
                          <div className="flex gap-3">
                            {Object.entries(farmStats.alerts.bySeverity).map(([sev, cnt]) => (
                              <div key={sev} className={`flex-1 text-center p-2 rounded ${sev === 'CRITICAL' ? 'bg-red-50' : sev === 'WARNING' ? 'bg-amber-50' : 'bg-blue-50'}`}>
                                <div className="text-lg font-bold">{cnt}</div>
                                <div className="text-xs text-gray-500">{sev === 'CRITICAL' ? '긴급' : sev === 'WARNING' ? '경고' : sev === 'INFO' ? '정보' : sev}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* 제어 이력 */}
                      <div className="border border-gray-200 rounded-lg p-4">
                        <h5 className="text-sm font-semibold text-gray-700 mb-2">최근 7일 제어</h5>
                        <div className="flex gap-4">
                          <div className="text-center">
                            <div className="text-xl font-bold text-blue-700">{farmStats.controls?.total7d || 0}</div>
                            <div className="text-xs text-gray-500">전체</div>
                          </div>
                          <div className="text-center">
                            <div className="text-xl font-bold text-emerald-700">{farmStats.controls?.success7d || 0}</div>
                            <div className="text-xs text-gray-500">성공</div>
                          </div>
                        </div>
                      </div>
                      {/* 접속 이력 (7일) */}
                      {connHistory?.daily?.length > 0 && (
                        <div className="border border-gray-200 rounded-lg p-4">
                          <h5 className="text-sm font-semibold text-gray-700 mb-3">최근 7일 접속 이력</h5>
                          <div className="flex items-end gap-2" style={{ height: 100 }}>
                            {(() => {
                              const maxCount = Math.max(...connHistory.daily.map(d => d.count), 1);
                              return connHistory.daily.map(d => {
                                const pct = d.count / maxCount;
                                const barH = Math.max(pct * 70, 3);
                                const date = new Date(d.date);
                                const dayLabel = `${date.getMonth() + 1}/${date.getDate()}`;
                                return (
                                  <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full" title={`${dayLabel}: ${d.count.toLocaleString()}건 (${d.houseCount}동)`}>
                                    <span className="text-[10px] text-gray-600 font-semibold mb-1">{d.count.toLocaleString()}</span>
                                    <div className="w-full rounded-t" style={{ height: barH, background: pct > 0.7 ? '#10B981' : pct > 0.3 ? '#3B82F6' : '#94A3B8' }} />
                                    <span className="text-[10px] text-gray-400 mt-1">{dayLabel}</span>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                          {connHistory.hourly?.length > 0 && (
                            <div className="mt-4 pt-3 border-t border-gray-100">
                              <h6 className="text-xs text-gray-500 mb-2">24시간 시간대별 분포</h6>
                              <div className="flex items-end gap-px" style={{ height: 48 }}>
                                {(() => {
                                  const maxH = Math.max(...connHistory.hourly.map(x => x.count), 1);
                                  return Array.from({ length: 24 }, (_, h) => {
                                    const item = connHistory.hourly.find(x => x.hour === h);
                                    const count = item?.count || 0;
                                    const barH = count > 0 ? Math.max((count / maxH) * 40, 3) : 0;
                                    return (
                                      <div key={h} className="flex-1 flex items-end h-full" title={`${h}시: ${count}건`}>
                                        <div className="w-full rounded-t" style={{ height: barH, background: count > 0 ? '#6366F1' : '#F1F5F9' }} />
                                      </div>
                                    );
                                  });
                                })()}
                              </div>
                              <div className="flex justify-between text-[9px] text-gray-300 mt-1">
                                <span>0시</span><span>6시</span><span>12시</span><span>18시</span><span>24시</span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {/* 최근 센서 데이터 */}
                      {farmStats.sensors?.houses?.length > 0 && (() => {
                        // houseId → houseName 매핑
                        const houseNameMap = {};
                        farmHouses.forEach(fh => { houseNameMap[fh.houseId] = fh.houseName || fh.houseId; });
                        // 센서 키 → 한글 라벨 + 단위 + 아이콘
                        const sensorLabel = (key) => {
                          const k = key.toLowerCase();
                          if (k.startsWith('temp') || k.includes('temperature')) return { label: '온도', unit: '°C', icon: '🌡️', color: 'text-red-600' };
                          if (k.startsWith('ext_humidity') || k.includes('ext_humi')) return { label: '외부습도', unit: '%', icon: '💧', color: 'text-cyan-600' };
                          if (k.startsWith('humidity') || k.includes('humi')) return { label: '습도', unit: '%', icon: '💧', color: 'text-blue-600' };
                          if (k.startsWith('co2') || k.includes('carbon')) return { label: 'CO₂', unit: 'ppm', icon: '🫧', color: 'text-gray-600' };
                          if (k.startsWith('light') || k.includes('lux') || k.includes('illumin')) return { label: '조도', unit: 'lux', icon: '☀️', color: 'text-yellow-600' };
                          if (k.startsWith('soil_temp')) return { label: '토양온도', unit: '°C', icon: '🌱', color: 'text-orange-600' };
                          if (k.startsWith('soil_moist') || k.startsWith('soil_humi')) return { label: '토양수분', unit: '%', icon: '🌱', color: 'text-emerald-600' };
                          if (k.startsWith('soil_ec') || k.includes('ec')) return { label: 'EC', unit: 'dS/m', icon: '⚡', color: 'text-purple-600' };
                          if (k.startsWith('soil_ph') || k.startsWith('ph')) return { label: 'pH', unit: '', icon: '🧪', color: 'text-indigo-600' };
                          if (k.startsWith('wind')) return { label: '풍속', unit: 'm/s', icon: '🌬️', color: 'text-teal-600' };
                          if (k.startsWith('rain')) return { label: '강수', unit: 'mm', icon: '🌧️', color: 'text-sky-600' };
                          if (k.startsWith('ext_temp')) return { label: '외부온도', unit: '°C', icon: '🌡️', color: 'text-orange-500' };
                          return { label: key, unit: '', icon: '📟', color: 'text-gray-600' };
                        };
                        return (
                          <div className="border border-gray-200 rounded-lg p-4">
                            <h5 className="text-sm font-semibold text-gray-700 mb-2">최근 센서 데이터</h5>
                            <div className="space-y-2">
                              {farmStats.sensors.houses.map(h => (
                                <div key={h.houseId} className="bg-gray-50 rounded-lg px-3 py-2.5">
                                  <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-sm font-semibold text-gray-700">{houseNameMap[h.houseId] || h.houseId}</span>
                                    <span className="text-[10px] text-gray-400">{new Date(h.lastUpdate).toLocaleString('ko-KR')}</span>
                                  </div>
                                  {h.data && typeof h.data === 'object' && (
                                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                                      {Object.entries(h.data).map(([key, val]) => {
                                        const s = sensorLabel(key);
                                        const numVal = typeof val === 'number' ? Math.round(val * 10) / 10 : val;
                                        return (
                                          <span key={key} className="text-xs flex items-center gap-1">
                                            <span className="text-[11px]">{s.icon}</span>
                                            <span className="text-gray-500">{s.label}</span>
                                            <span className={`font-semibold ${s.color}`}>{numVal}{s.unit && <span className="text-gray-400 font-normal">{s.unit}</span>}</span>
                                          </span>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-gray-400">
                      <div className="text-3xl mb-2 opacity-40">📊</div>
                      <p className="text-sm">통계 데이터를 불러오는 중...</p>
                    </div>
                  )
                )}

                {/* 하우스 탭 */}
                {!detailLoading && detailTab === 'houses' && (
                  farmHouses.length > 0 ? (
                    <table className="w-full text-sm border-collapse">
                      <thead>
                        <tr className="bg-slate-50">
                          <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600 border border-gray-200">하우스</th>
                          <th className="w-20 px-3 py-2.5 text-center text-xs font-semibold text-gray-600 border border-gray-200">상태</th>
                          <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-600 border border-gray-200">작물</th>
                          <th className="w-16 px-3 py-2.5 text-center text-xs font-semibold text-gray-600 border border-gray-200">센서</th>
                          <th className="w-16 px-3 py-2.5 text-center text-xs font-semibold text-gray-600 border border-gray-200">장비</th>
                          <th className="w-16 px-3 py-2.5 text-center text-xs font-semibold text-gray-600 border border-gray-200">관리</th>
                        </tr>
                      </thead>
                      <tbody>
                        {farmHouses.map(h => (
                          <tr key={h.id} className="hover:bg-gray-50">
                            {editHouseId === h.id ? (
                              <>
                                <td className="px-2 py-1.5 border border-gray-200">
                                  <input type="text" value={editHouseData.houseName}
                                    onChange={e => setEditHouseData({ ...editHouseData, houseName: e.target.value })}
                                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:border-indigo-500" />
                                </td>
                                <td className="px-2 py-1.5 text-center border border-gray-200">
                                  <button onClick={() => setEditHouseData({ ...editHouseData, enabled: !editHouseData.enabled })}
                                    className={`px-2 py-0.5 rounded text-[11px] font-medium ${editHouseData.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                                    {editHouseData.enabled ? '활성' : '비활성'}
                                  </button>
                                </td>
                                <td className="px-2 py-1.5 border border-gray-200">
                                  <div className="flex gap-1">
                                    <input type="text" value={editHouseData.cropType} placeholder="작물"
                                      onChange={e => setEditHouseData({ ...editHouseData, cropType: e.target.value })}
                                      className="w-1/2 px-1.5 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:border-indigo-500" />
                                    <input type="text" value={editHouseData.cropVariety} placeholder="품종"
                                      onChange={e => setEditHouseData({ ...editHouseData, cropVariety: e.target.value })}
                                      className="w-1/2 px-1.5 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:border-indigo-500" />
                                  </div>
                                </td>
                                <td className="px-2 py-1.5 text-center text-gray-600 border border-gray-200">{Array.isArray(h.sensors) ? h.sensors.length : 0}</td>
                                <td className="px-2 py-1.5 text-center text-gray-600 border border-gray-200">{Array.isArray(h.devices) ? h.devices.length : 0}</td>
                                <td className="px-1 py-1.5 text-center border border-gray-200">
                                  <div className="flex gap-0.5 justify-center">
                                    <button onClick={saveHouseEdit}
                                      className="px-1.5 py-0.5 text-[11px] text-emerald-600 hover:bg-emerald-50 rounded font-medium">저장</button>
                                    <button onClick={() => setEditHouseId(null)}
                                      className="px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-100 rounded">취소</button>
                                  </div>
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="px-4 py-2.5 font-medium text-gray-700 border border-gray-200">
                                  <div>{h.houseName || h.houseId}</div>
                                  <div className="text-[10px] text-gray-400">{h.houseId}</div>
                                </td>
                                <td className="px-3 py-2.5 text-center border border-gray-200">
                                  <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${h.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                                    {h.enabled ? '활성' : '비활성'}
                                  </span>
                                </td>
                                <td className="px-3 py-2.5 text-gray-600 border border-gray-200">
                                  {h.cropType ? <span className="text-xs">{h.cropType}{h.cropVariety ? ` (${h.cropVariety})` : ''}</span> : <span className="text-xs text-gray-300">-</span>}
                                </td>
                                <td className="px-3 py-2.5 text-center text-gray-600 border border-gray-200">{Array.isArray(h.sensors) ? h.sensors.length : 0}</td>
                                <td className="px-3 py-2.5 text-center text-gray-600 border border-gray-200">{Array.isArray(h.devices) ? h.devices.length : 0}</td>
                                <td className="px-1 py-2.5 text-center border border-gray-200">
                                  <button onClick={() => startEditHouse(h)}
                                    className="px-2 py-0.5 text-[11px] text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded font-medium transition-colors">편집</button>
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="text-center py-8 text-gray-400">등록된 하우스가 없습니다</div>
                  )
                )}

                {/* 사용자 탭 */}
                {/* 일정 탭 */}
                {!detailLoading && detailTab === 'schedules' && (
                  <div className="space-y-4">
                    {/* 요약 카드 */}
                    <div className="grid grid-cols-4 gap-3">
                      {[
                        { label: '전체', value: scheduleSummary.total || 0, color: 'text-indigo-700', bg: 'bg-indigo-50' },
                        { label: '예정', value: scheduleSummary.upcoming || 0, color: 'text-blue-700', bg: 'bg-blue-50' },
                        { label: '지연', value: scheduleSummary.overdue || 0, color: 'text-red-700', bg: 'bg-red-50' },
                        { label: '완료', value: scheduleSummary.completed || 0, color: 'text-emerald-700', bg: 'bg-emerald-50' },
                      ].map(s => (
                        <div key={s.label} className={`${s.bg} rounded-lg p-3 text-center`}>
                          <div className="text-xs text-gray-500 mb-1">{s.label}</div>
                          <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                        </div>
                      ))}
                    </div>

                    {/* 필터 바 */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <select value={scheduleFilter} onChange={e => setScheduleFilter(e.target.value)}
                          className="text-sm border border-gray-300 rounded px-2 py-1.5 bg-white">
                          <option value="">전체 유형</option>
                          {Object.entries(SCHEDULE_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                          <input type="checkbox" checked={scheduleShowCompleted} onChange={e => setScheduleShowCompleted(e.target.checked)}
                            className="w-3.5 h-3.5 rounded border-gray-300 text-indigo-600" />
                          완료 포함
                        </label>
                        {/* 뷰 모드 토글 */}
                        <div className="flex border border-gray-300 rounded overflow-hidden ml-2">
                          <button onClick={() => setScheduleViewMode('list')}
                            className={`px-2.5 py-1 text-xs font-medium ${scheduleViewMode === 'list' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                            목록
                          </button>
                          <button onClick={() => setScheduleViewMode('calendar')}
                            className={`px-2.5 py-1 text-xs font-medium ${scheduleViewMode === 'calendar' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                            달력
                          </button>
                        </div>
                      </div>
                      <button onClick={() => { setShowScheduleForm(true); setEditScheduleId(null); setScheduleForm({ title: '', description: '', type: 'inspection', startDate: new Date().toISOString().split('T')[0], endDate: '', assignedTo: '', houseId: '', priority: 'normal' }); }}
                        className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700 transition-colors">
                        + 추가
                      </button>
                    </div>

                    {/* 일정 폼 */}
                    {showScheduleForm && (
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
                        <h5 className="text-sm font-bold text-gray-800">{editScheduleId ? '일정 수정' : '일정 추가'}</h5>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="col-span-2">
                            <label className="block text-xs text-gray-600 mb-1">제목 *</label>
                            <input type="text" value={scheduleForm.title} onChange={e => setScheduleForm({ ...scheduleForm, title: e.target.value })}
                              placeholder="일정 제목" className="w-full text-sm border border-gray-300 rounded px-2.5 py-1.5" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">유형</label>
                            <select value={scheduleForm.type} onChange={e => setScheduleForm({ ...scheduleForm, type: e.target.value })}
                              className="w-full text-sm border border-gray-300 rounded px-2.5 py-1.5 bg-white">
                              {Object.entries(SCHEDULE_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">우선순위</label>
                            <select value={scheduleForm.priority} onChange={e => setScheduleForm({ ...scheduleForm, priority: e.target.value })}
                              className="w-full text-sm border border-gray-300 rounded px-2.5 py-1.5 bg-white">
                              {Object.entries(SCHEDULE_PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">시작일 *</label>
                            <input type="date" value={scheduleForm.startDate} onChange={e => setScheduleForm({ ...scheduleForm, startDate: e.target.value })}
                              className="w-full text-sm border border-gray-300 rounded px-2.5 py-1.5" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">종료일</label>
                            <input type="date" value={scheduleForm.endDate} onChange={e => setScheduleForm({ ...scheduleForm, endDate: e.target.value })}
                              className="w-full text-sm border border-gray-300 rounded px-2.5 py-1.5" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">담당자</label>
                            <input type="text" value={scheduleForm.assignedTo} onChange={e => setScheduleForm({ ...scheduleForm, assignedTo: e.target.value })}
                              placeholder="담당자명" className="w-full text-sm border border-gray-300 rounded px-2.5 py-1.5" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">하우스</label>
                            <select value={scheduleForm.houseId} onChange={e => setScheduleForm({ ...scheduleForm, houseId: e.target.value })}
                              className="w-full text-sm border border-gray-300 rounded px-2.5 py-1.5 bg-white">
                              <option value="">전체</option>
                              {farmHouses.map(h => <option key={h.houseId} value={h.houseId}>{h.houseName || h.houseId}</option>)}
                            </select>
                          </div>
                          <div className="col-span-2">
                            <label className="block text-xs text-gray-600 mb-1">설명</label>
                            <textarea value={scheduleForm.description} onChange={e => setScheduleForm({ ...scheduleForm, description: e.target.value })}
                              rows={2} placeholder="상세 내용 (선택)" className="w-full text-sm border border-gray-300 rounded px-2.5 py-1.5 resize-none" />
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end pt-1">
                          <button onClick={() => setShowScheduleForm(false)}
                            className="px-4 py-1.5 bg-white border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-50 transition-colors">
                            취소
                          </button>
                          <button onClick={async () => {
                            if (!detailFarm || !scheduleForm.title || !scheduleForm.startDate) return;
                            try {
                              if (editScheduleId) {
                                await axios.put(`${API}/farms/${detailFarm.farmId}/schedules/${editScheduleId}`, scheduleForm);
                              } else {
                                await axios.post(`${API}/farms/${detailFarm.farmId}/schedules`, scheduleForm);
                              }
                              setShowScheduleForm(false);
                              const r = await axios.get(`${API}/farms/${detailFarm.farmId}/schedules`);
                              setFarmSchedules(r.data.data || []);
                              setScheduleSummary(r.data.summary || {});
                            } catch (err) { setError(err.response?.data?.error || '일정 저장 실패'); }
                          }} disabled={!scheduleForm.title || !scheduleForm.startDate}
                            className="px-4 py-1.5 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700 disabled:bg-gray-300 transition-colors">
                            {editScheduleId ? '수정' : '저장'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 일정 뷰 */}
                    {(() => {
                      let list = farmSchedules;
                      if (scheduleFilter) list = list.filter(s => s.type === scheduleFilter);
                      if (!scheduleShowCompleted) list = list.filter(s => !s.completed);

                      if (scheduleViewMode === 'calendar') {
                        /* ── 달력 뷰 ── */
                        const { year, month } = calMonth;
                        const firstDay = new Date(year, month, 1).getDay();
                        const daysInMonth = new Date(year, month + 1, 0).getDate();
                        const today = new Date();
                        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
                        const cells = [];
                        for (let i = 0; i < firstDay; i++) cells.push(null);
                        for (let d = 1; d <= daysInMonth; d++) cells.push(d);

                        const getSchedulesForDay = (day) => {
                          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                          return list.filter(s => {
                            const start = s.startDate ? s.startDate.substring(0, 10) : '';
                            const end = s.endDate ? s.endDate.substring(0, 10) : start;
                            return dateStr >= start && dateStr <= (end || start);
                          });
                        };

                        const monthLabel = `${year}년 ${month + 1}월`;
                        const prevMonth = () => setCalMonth(p => p.month === 0 ? { year: p.year - 1, month: 11 } : { ...p, month: p.month - 1 });
                        const nextMonth = () => setCalMonth(p => p.month === 11 ? { year: p.year + 1, month: 0 } : { ...p, month: p.month + 1 });

                        return (
                          <div>
                            {/* 달력 헤더 */}
                            <div className="flex items-center justify-between mb-3">
                              <button onClick={prevMonth} className="px-2 py-1 text-gray-500 hover:bg-gray-100 rounded text-sm">&lt;</button>
                              <span className="text-sm font-bold text-gray-800">{monthLabel}</span>
                              <button onClick={nextMonth} className="px-2 py-1 text-gray-500 hover:bg-gray-100 rounded text-sm">&gt;</button>
                            </div>
                            {/* 요일 헤더 */}
                            <div className="grid grid-cols-7 text-center text-[11px] font-medium text-gray-500 mb-1">
                              {['일', '월', '화', '수', '목', '금', '토'].map(d => <div key={d} className="py-1">{d}</div>)}
                            </div>
                            {/* 달력 그리드 */}
                            <div className="grid grid-cols-7 border-t border-l border-gray-200">
                              {cells.map((day, i) => {
                                if (!day) return <div key={`e${i}`} className="border-r border-b border-gray-200 bg-gray-50/50 min-h-[72px]"></div>;
                                const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                                const daySchedules = getSchedulesForDay(day);
                                const isToday = dateStr === todayStr;
                                const isSun = i % 7 === 0;
                                const isSat = i % 7 === 6;
                                return (
                                  <div key={day} className={`border-r border-b border-gray-200 min-h-[72px] p-1 ${isToday ? 'bg-blue-50/60' : ''}`}>
                                    <div className={`text-[11px] font-medium mb-0.5 ${isToday ? 'text-blue-600 font-bold' : isSun ? 'text-red-400' : isSat ? 'text-blue-400' : 'text-gray-600'}`}>
                                      {day}
                                    </div>
                                    <div className="space-y-0.5">
                                      {daySchedules.slice(0, 3).map(s => (
                                        <div key={s.id}
                                          onClick={() => {
                                            setEditScheduleId(s.id);
                                            setScheduleForm({
                                              title: s.title, description: s.description || '', type: s.type || 'general',
                                              startDate: s.startDate ? new Date(s.startDate).toISOString().split('T')[0] : '',
                                              endDate: s.endDate ? new Date(s.endDate).toISOString().split('T')[0] : '',
                                              assignedTo: s.assignedTo || '', houseId: s.houseId || '', priority: s.priority || 'normal',
                                            });
                                            setShowScheduleForm(true);
                                          }}
                                          className={`text-[10px] px-1 py-0.5 rounded truncate cursor-pointer ${
                                            s.completed ? 'bg-gray-100 text-gray-400 line-through' :
                                            s.priority === 'urgent' ? 'bg-red-100 text-red-700' :
                                            s.priority === 'high' ? 'bg-orange-100 text-orange-700' :
                                            SCHEDULE_TYPE_CLS[s.type] || 'bg-indigo-50 text-indigo-700'
                                          }`}
                                          title={s.title}>
                                          {s.title}
                                        </div>
                                      ))}
                                      {daySchedules.length > 3 && (
                                        <div className="text-[10px] text-gray-400 px-1">+{daySchedules.length - 3}건</div>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      }

                      /* ── 목록 뷰 ── */
                      return list.length > 0 ? (
                        <div className="space-y-2">
                          {list.map(sch => {
                            const isOverdue = !sch.completed && sch.endDate && new Date(sch.endDate) < new Date();
                            return (
                              <div key={sch.id} className={`border rounded-lg p-3 hover:bg-gray-50 transition-colors ${isOverdue ? 'border-red-300 bg-red-50/30' : 'border-gray-200'}`}>
                                <div className="flex items-start justify-between">
                                  <div className="flex items-start gap-2 flex-1">
                                    <input type="checkbox" checked={!!sch.completed}
                                      onChange={async () => {
                                        try {
                                          await axios.put(`${API}/farms/${detailFarm.farmId}/schedules/${sch.id}`, { completed: !sch.completed });
                                          const r = await axios.get(`${API}/farms/${detailFarm.farmId}/schedules`);
                                          setFarmSchedules(r.data.data || []);
                                          setScheduleSummary(r.data.summary || {});
                                        } catch (err) { setError(err.response?.data?.error || '일정 상태 변경 실패'); }
                                      }}
                                      className="w-4 h-4 rounded border-gray-300 text-indigo-600 mt-0.5" />
                                    <div className="flex-1">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${SCHEDULE_TYPE_CLS[sch.type] || 'bg-gray-100 text-gray-600'}`}>
                                          {SCHEDULE_TYPE[sch.type] || sch.type}
                                        </span>
                                        {sch.priority && sch.priority !== 'normal' && (
                                          <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${sch.priority === 'urgent' ? 'bg-red-100 text-red-700' : sch.priority === 'high' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500'}`}>
                                            {SCHEDULE_PRIORITY[sch.priority]}
                                          </span>
                                        )}
                                        {isOverdue && <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-red-100 text-red-700">지연</span>}
                                        {sch.completed && <span className="px-1.5 py-0.5 rounded text-[11px] font-medium bg-emerald-100 text-emerald-700">완료</span>}
                                      </div>
                                      <p className={`text-sm font-medium ${sch.completed ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{sch.title}</p>
                                      {sch.description && <p className="text-xs text-gray-500 mt-0.5">{sch.description}</p>}
                                      <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                                        <span>{fmt(sch.startDate)}{sch.endDate ? ` ~ ${fmt(sch.endDate)}` : ''}</span>
                                        {sch.assignedTo && <span>담당: {sch.assignedTo}</span>}
                                        {sch.houseId && <span>하우스: {sch.houseId}</span>}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex gap-1 ml-2 flex-shrink-0">
                                    <button onClick={() => {
                                      setEditScheduleId(sch.id);
                                      setScheduleForm({
                                        title: sch.title, description: sch.description || '', type: sch.type || 'general',
                                        startDate: sch.startDate ? new Date(sch.startDate).toISOString().split('T')[0] : '',
                                        endDate: sch.endDate ? new Date(sch.endDate).toISOString().split('T')[0] : '',
                                        assignedTo: sch.assignedTo || '', houseId: sch.houseId || '', priority: sch.priority || 'normal',
                                      });
                                      setShowScheduleForm(true);
                                    }}
                                      className="px-2 py-1 text-xs text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors">
                                      수정
                                    </button>
                                    <button onClick={async () => {
                                      try {
                                        await axios.delete(`${API}/farms/${detailFarm.farmId}/schedules/${sch.id}`);
                                        const r = await axios.get(`${API}/farms/${detailFarm.farmId}/schedules`);
                                        setFarmSchedules(r.data.data || []);
                                        setScheduleSummary(r.data.summary || {});
                                      } catch (err) { setError(err.response?.data?.error || '일정 삭제 실패'); }
                                    }}
                                      className="px-2 py-1 text-xs text-gray-500 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors">
                                      삭제
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-center py-12 text-gray-400">
                          <div className="text-3xl mb-2 opacity-40">📅</div>
                          <p className="text-sm">등록된 일정이 없습니다</p>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* 유지보수 탭 */}
                {!detailLoading && detailTab === 'maintenance' && (
                  <div className="space-y-4">
                    {/* 상단 요약 + 버튼 */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <select value={maintTypeFilter} onChange={e => { setMaintTypeFilter(e.target.value); setTimeout(() => fetchMaintLogs(detailFarm.farmId), 0); }}
                          className="text-sm border border-gray-300 rounded px-2 py-1.5 bg-white">
                          <option value="">전체 유형</option>
                          {Object.entries(MAINT_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                        <span className="text-xs text-gray-500">{maintSummary.count}건 · 총비용 {(maintSummary.totalCost || 0).toLocaleString()}원</span>
                      </div>
                      <button onClick={() => openMaintForm()}
                        className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700 transition-colors">
                        + 이력 추가
                      </button>
                    </div>

                    {/* 추가/수정 폼 */}
                    {showMaintForm && (
                      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-3">
                        <h5 className="text-sm font-bold text-gray-800">{editMaintLog ? '이력 수정' : '이력 추가'}</h5>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">날짜 *</label>
                            <input type="date" value={maintForm.date} onChange={e => setMaintForm({ ...maintForm, date: e.target.value })}
                              className="w-full text-sm border border-gray-300 rounded px-2.5 py-1.5" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">유형 *</label>
                            <select value={maintForm.type} onChange={e => setMaintForm({ ...maintForm, type: e.target.value })}
                              className="w-full text-sm border border-gray-300 rounded px-2.5 py-1.5 bg-white">
                              {Object.entries(MAINT_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                          </div>
                          <div className="col-span-2">
                            <label className="block text-xs text-gray-600 mb-1">제목 *</label>
                            <input type="text" value={maintForm.title} onChange={e => setMaintForm({ ...maintForm, title: e.target.value })}
                              placeholder="유지보수 내용 요약" className="w-full text-sm border border-gray-300 rounded px-2.5 py-1.5" />
                          </div>
                          <div className="col-span-2">
                            <label className="block text-xs text-gray-600 mb-1">상세 내용</label>
                            <textarea value={maintForm.description} onChange={e => setMaintForm({ ...maintForm, description: e.target.value })}
                              rows={2} placeholder="상세 내용 (선택)" className="w-full text-sm border border-gray-300 rounded px-2.5 py-1.5 resize-none" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">비용 (원)</label>
                            <input type="number" value={maintForm.cost} onChange={e => setMaintForm({ ...maintForm, cost: e.target.value })}
                              placeholder="0" className="w-full text-sm border border-gray-300 rounded px-2.5 py-1.5" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">작업자</label>
                            <input type="text" value={maintForm.technician} onChange={e => setMaintForm({ ...maintForm, technician: e.target.value })}
                              placeholder="작업자명" className="w-full text-sm border border-gray-300 rounded px-2.5 py-1.5" />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">진행 상태</label>
                            <select value={maintForm.status} onChange={e => setMaintForm({ ...maintForm, status: e.target.value })}
                              className="w-full text-sm border border-gray-300 rounded px-2.5 py-1.5 bg-white">
                              {Object.entries(MAINT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end pt-1">
                          <button onClick={() => setShowMaintForm(false)}
                            className="px-4 py-1.5 bg-white border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-50 transition-colors">
                            취소
                          </button>
                          <button onClick={saveMaintLog} disabled={!maintForm.title || !maintForm.date}
                            className="px-4 py-1.5 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700 disabled:bg-gray-300 transition-colors">
                            {editMaintLog ? '수정' : '저장'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 이력 리스트 */}
                    {maintLogs.length > 0 ? (
                      <div className="space-y-2">
                        {maintLogs.map(log => (
                          <div key={log.id} className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50 transition-colors">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${MAINT_TYPE_CLS[log.type] || 'bg-gray-100 text-gray-600'}`}>
                                    {MAINT_TYPE[log.type] || log.type}
                                  </span>
                                  <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${MAINT_STATUS_CLS[log.status] || 'bg-gray-100 text-gray-600'}`}>
                                    {MAINT_STATUS[log.status] || log.status}
                                  </span>
                                  <span className="text-xs text-gray-400">{new Date(log.date).toLocaleDateString('ko-KR')}</span>
                                </div>
                                <p className="text-sm font-medium text-gray-800">{log.title}</p>
                                {log.description && <p className="text-xs text-gray-500 mt-0.5">{log.description}</p>}
                                <div className="flex items-center gap-4 mt-1.5 text-xs text-gray-500">
                                  {log.cost > 0 && <span>비용: {log.cost.toLocaleString()}원</span>}
                                  {log.technician && <span>작업자: {log.technician}</span>}
                                </div>
                              </div>
                              <div className="flex gap-1 ml-2 flex-shrink-0">
                                <button onClick={() => openMaintForm(log)}
                                  className="px-2 py-1 text-xs text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors">
                                  수정
                                </button>
                                <button onClick={() => deleteMaintLog(log.id)}
                                  className="px-2 py-1 text-xs text-gray-500 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors">
                                  삭제
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-12 text-gray-400">
                        <div className="text-3xl mb-2 opacity-40">🔧</div>
                        <p className="text-sm">유지보수 이력이 없습니다</p>
                      </div>
                    )}
                  </div>
                )}

                {/* 문서 탭 */}
                {!detailLoading && detailTab === 'documents' && (
                  <div className="space-y-4">
                    {/* 카테고리 필터 */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => setDocCategoryFilter('')}
                        className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${!docCategoryFilter ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                        전체 ({docSummary.total || 0})
                      </button>
                      {Object.entries(DOC_CATEGORY).map(([k, v]) => (
                        <button key={k} onClick={() => setDocCategoryFilter(prev => prev === k ? '' : k)}
                          className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${docCategoryFilter === k ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                          {v} ({docSummary.byCategory?.[k] || 0})
                        </button>
                      ))}
                      {docSummary.totalSize > 0 && (
                        <span className="text-xs text-gray-400 ml-2">총 {formatFileSize(docSummary.totalSize)}</span>
                      )}
                    </div>

                    {/* 파일 업로드 */}
                    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                      <h5 className="text-xs font-semibold text-gray-600 mb-2">문서 업로드</h5>
                      <div className="flex items-center gap-2">
                        <select value={docCategory} onChange={e => setDocCategory(e.target.value)}
                          className="text-sm border border-gray-300 rounded px-2 py-1.5 bg-white">
                          {Object.entries(DOC_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </select>
                        <input type="text" value={docDescription} onChange={e => setDocDescription(e.target.value)}
                          placeholder="설명 (선택)" className="flex-1 text-sm border border-gray-300 rounded px-2.5 py-1.5" />
                        <label className={`px-4 py-1.5 rounded text-xs font-medium cursor-pointer transition-colors ${docUploading ? 'bg-gray-300 text-gray-500' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
                          {docUploading ? '업로드중...' : '파일 선택'}
                          <input type="file" className="hidden" disabled={docUploading}
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file || !detailFarm) return;
                              setDocUploading(true);
                              try {
                                const fd = new FormData();
                                fd.append('file', file);
                                fd.append('category', docCategory);
                                fd.append('description', docDescription);
                                await axios.post(`${API}/farms/${detailFarm.farmId}/documents`, fd, {
                                  headers: { 'Content-Type': 'multipart/form-data' },
                                });
                                setDocDescription('');
                                const r = await axios.get(`${API}/farms/${detailFarm.farmId}/documents`);
                                setFarmDocuments(r.data.data || []);
                                setDocSummary(r.data.summary || {});
                              } catch (err) { setError(err.response?.data?.error || '문서 업로드 실패'); }
                              finally { setDocUploading(false); e.target.value = ''; }
                            }} />
                        </label>
                      </div>
                    </div>

                    {/* 문서 목록 */}
                    {(() => {
                      const list = docCategoryFilter ? farmDocuments.filter(d => d.category === docCategoryFilter) : farmDocuments;
                      const extIcon = (name) => {
                        const ext = (name || '').split('.').pop()?.toLowerCase();
                        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return '🖼️';
                        if (['pdf'].includes(ext)) return '📄';
                        if (['xlsx', 'xls', 'csv'].includes(ext)) return '📊';
                        if (['doc', 'docx'].includes(ext)) return '📝';
                        if (['zip', 'tar', 'gz'].includes(ext)) return '📦';
                        return '📎';
                      };
                      return list.length > 0 ? (
                        <div className="space-y-2">
                          {list.map(doc => (
                            <div key={doc.id} className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50 transition-colors">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                  <span className="text-xl flex-shrink-0">{extIcon(doc.originalName || doc.filename)}</span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-800 truncate">{doc.originalName || doc.filename}</p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                      <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${DOC_CATEGORY_CLS[doc.category] || 'bg-gray-100 text-gray-600'}`}>
                                        {DOC_CATEGORY[doc.category] || doc.category}
                                      </span>
                                      {doc.size && <span className="text-xs text-gray-400">{formatFileSize(doc.size)}</span>}
                                      <span className="text-xs text-gray-400">{fmt(doc.createdAt)}</span>
                                      {doc.description && <span className="text-xs text-gray-500">{doc.description}</span>}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex gap-1 ml-2 flex-shrink-0">
                                  <button onClick={async () => {
                                    try {
                                      const r = await axios.get(`${API}/farms/${detailFarm.farmId}/documents/${doc.id}/download`, { responseType: 'blob' });
                                      const url = window.URL.createObjectURL(new Blob([r.data]));
                                      const a = document.createElement('a');
                                      a.href = url; a.download = doc.originalName || doc.filename || 'download';
                                      document.body.appendChild(a); a.click(); a.remove();
                                      window.URL.revokeObjectURL(url);
                                    } catch { setError('다운로드 실패'); }
                                  }}
                                    className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded font-medium transition-colors">
                                    다운로드
                                  </button>
                                  <button onClick={async () => {
                                    if (!confirm('이 문서를 삭제하시겠습니까?')) return;
                                    try {
                                      await axios.delete(`${API}/farms/${detailFarm.farmId}/documents/${doc.id}`);
                                      const r = await axios.get(`${API}/farms/${detailFarm.farmId}/documents`);
                                      setFarmDocuments(r.data.data || []);
                                      setDocSummary(r.data.summary || {});
                                    } catch (err) { setError(err.response?.data?.error || '문서 삭제 실패'); }
                                  }}
                                    className="px-2 py-1 text-xs text-gray-500 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors">
                                    삭제
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-12 text-gray-400">
                          <div className="text-3xl mb-2 opacity-40">📁</div>
                          <p className="text-sm">등록된 문서가 없습니다</p>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* 감사 로그 탭 */}
                {!detailLoading && detailTab === 'audit' && (
                  auditLogs.length > 0 ? (
                    <div className="space-y-2 max-h-[500px] overflow-y-auto">
                      {auditLogs.map(log => {
                        const hasChanges = log.details?.changes && Object.keys(log.details.changes).length > 0;
                        const isExpanded = expandedAuditId === log.id;
                        const fmtVal = (v) => {
                          if (v === null || v === undefined) return '(없음)';
                          if (Array.isArray(v)) {
                            if (v.length === 0) return '(없음)';
                            // managers 배열인 경우 이름만 추출
                            if (v[0] && typeof v[0] === 'object' && v[0].name) return v.map(m => m.name || '').filter(Boolean).join(', ') || '(없음)';
                            return v.join(', ');
                          }
                          if (typeof v === 'object') {
                            // managers 단일 객체
                            if (v.name) return v.name;
                            return JSON.stringify(v);
                          }
                          if (typeof v === 'string' && v.match(/^\d{4}-\d{2}-\d{2}T/)) return new Date(v).toLocaleDateString('ko-KR');
                          if (v === 'active') return '활성';
                          if (v === 'inactive') return '비활성';
                          if (v === 'suspended') return '정지';
                          return String(v);
                        };
                        // 변경 필드를 한글로 요약
                        const fieldsSummary = (fields) => {
                          if (!fields || !Array.isArray(fields)) return '';
                          return fields.map(f => FIELD_LABEL[f] || f).join(', ');
                        };
                        // 액션 설명 문구 생성
                        const actionDesc = () => {
                          const target = TARGET_TYPE_LABEL[log.targetType] || log.targetType;
                          const action = AUDIT_ACTION_LABEL[log.action] || log.action;
                          if (log.action === 'create') return `${target} ${action}`;
                          if (log.action === 'update') {
                            const cnt = hasChanges ? Object.keys(log.details.changes).length : (log.details?.fields?.length || 0);
                            return `${target} ${cnt}개 항목 ${action}`;
                          }
                          if (log.action === 'soft_delete' || log.action === 'delete') return `${target} ${action}`;
                          if (log.action === 'restore') return `${target} ${action}`;
                          if (log.action === 'batch_status') return `${log.details?.count || ''}건 상태 일괄변경`;
                          if (log.action === 'batch_create') return `${log.details?.total || ''}건 일괄 등록`;
                          return `${target} ${action}`;
                        };
                        return (
                          <div key={log.id} className={`bg-gray-50 rounded-lg ${hasChanges ? 'cursor-pointer hover:bg-gray-100' : ''}`}
                            onClick={() => hasChanges && setExpandedAuditId(isExpanded ? null : log.id)}>
                            <div className="flex items-start gap-3 px-3 py-2.5">
                              <div className="flex-shrink-0 w-20 text-[11px] text-gray-400 pt-0.5">
                                {new Date(log.createdAt).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}
                                <div className="text-[10px]">{new Date(log.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</div>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    log.action === 'create' ? 'bg-emerald-100 text-emerald-700' :
                                    log.action === 'delete' || log.action === 'soft_delete' ? 'bg-red-100 text-red-700' :
                                    log.action === 'update' ? 'bg-blue-100 text-blue-700' :
                                    log.action === 'restore' ? 'bg-amber-100 text-amber-700' :
                                    log.action === 'batch_status' || log.action === 'batch_create' ? 'bg-purple-100 text-purple-700' :
                                    'bg-gray-100 text-gray-600'
                                  }`}>{AUDIT_ACTION_LABEL[log.action] || log.action}</span>
                                  <span className="text-xs text-gray-700 font-medium">{actionDesc()}</span>
                                  {log.userName && <span className="text-[11px] text-gray-400">by {log.userName}</span>}
                                </div>
                                {/* 변경된 필드 한글 요약 */}
                                {log.details?.fields && !hasChanges && (
                                  <div className="text-[11px] text-gray-400 mt-1">
                                    {fieldsSummary(log.details.fields)}
                                  </div>
                                )}
                                {hasChanges && !isExpanded && (
                                  <div className="flex items-center gap-1 mt-1">
                                    <span className="text-[11px] text-gray-400">
                                      {Object.keys(log.details.changes).map(f => FIELD_LABEL[f] || f).join(', ')}
                                    </span>
                                    <span className="text-[10px] text-indigo-500 ml-1 font-medium">
                                      클릭하여 상세보기
                                    </span>
                                  </div>
                                )}
                                {hasChanges && isExpanded && (
                                  <span className="text-[10px] text-indigo-500 mt-1 inline-block font-medium">접기</span>
                                )}
                                {/* 생성/삭제 등 changes 없는 경우 기타 정보 */}
                                {!log.details?.fields && !hasChanges && log.details && Object.keys(log.details).length > 0 && (
                                  <div className="text-[11px] text-gray-400 mt-1">
                                    {log.details.name || log.details.status || log.details.role || ''}
                                  </div>
                                )}
                              </div>
                            </div>
                            {/* 전/후 비교 테이블 */}
                            {hasChanges && isExpanded && (
                              <div className="px-3 pb-3" onClick={e => e.stopPropagation()}>
                                <table className="w-full text-xs border-collapse mt-1 rounded overflow-hidden">
                                  <thead>
                                    <tr className="bg-gray-200/70">
                                      <th className="px-3 py-1.5 text-left text-gray-600 font-semibold w-32">항목</th>
                                      <th className="px-3 py-1.5 text-left font-semibold">
                                        <span className="text-red-500">변경 전</span>
                                      </th>
                                      <th className="px-1 py-1.5 text-center text-gray-300 w-6">&rarr;</th>
                                      <th className="px-3 py-1.5 text-left font-semibold">
                                        <span className="text-emerald-600">변경 후</span>
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {Object.entries(log.details.changes).map(([field, { before, after }]) => (
                                      <tr key={field} className="border-t border-gray-200/60">
                                        <td className="px-3 py-2 font-medium text-gray-700 bg-gray-50">{FIELD_LABEL[field] || field}</td>
                                        <td className="px-3 py-2 text-red-600 bg-red-50/40">{fmtVal(before)}</td>
                                        <td className="px-1 py-2 text-center text-gray-300">&rarr;</td>
                                        <td className="px-3 py-2 text-emerald-700 bg-emerald-50/40">{fmtVal(after)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-center py-12 text-gray-400">
                      <div className="text-3xl mb-2 opacity-40">📋</div>
                      <p className="text-sm">변경 이력이 없습니다</p>
                    </div>
                  )
                )}

                {/* 알림내역 탭 */}
                {!detailLoading && detailTab === 'alerts' && (() => {
                  const activeAlerts = farmAlerts.filter(a => !a.deleted);
                  const deletedAlerts = farmAlerts.filter(a => a.deleted);
                  const filtered = farmAlertFilter === 'unack' ? activeAlerts.filter(a => !a.acknowledged)
                    : farmAlertFilter === 'acked' ? activeAlerts.filter(a => a.acknowledged)
                    : farmAlertFilter === 'deleted' ? deletedAlerts
                    : farmAlerts;
                  return (
                    <div className="space-y-3">
                      {/* 필터 바 */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {[
                          { key: 'all', label: `전체 (${farmAlerts.length})` },
                          { key: 'unack', label: `미확인 (${activeAlerts.filter(a => !a.acknowledged).length})` },
                          { key: 'acked', label: `확인됨 (${activeAlerts.filter(a => a.acknowledged).length})` },
                          { key: 'deleted', label: `삭제됨 (${deletedAlerts.length})` },
                        ].map(f => (
                          <button key={f.key} onClick={() => setFarmAlertFilter(f.key)}
                            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                              farmAlertFilter === f.key
                                ? f.key === 'deleted' ? 'bg-rose-100 text-rose-700 border border-rose-200'
                                  : 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            }`}>
                            {f.label}
                          </button>
                        ))}
                      </div>

                      {/* 범례 */}
                      <div className="flex items-center gap-4 text-[10px] text-gray-400 px-1">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500"></span> 확인됨</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-400"></span> 삭제됨</span>
                      </div>

                      {/* 알림 목록 */}
                      {filtered.length > 0 ? (
                        <div className="space-y-2 max-h-[500px] overflow-y-auto">
                          {filtered.map(alert => {
                            const isAcked = alert.acknowledged;
                            const isDel = alert.deleted;
                            const sevBorder = isDel ? 'border-l-rose-300'
                              : isAcked ? 'border-l-gray-300'
                              : alert.severity === 'CRITICAL' ? 'border-l-red-500'
                              : alert.severity === 'WARNING' ? 'border-l-orange-400' : 'border-l-blue-400';
                            const sevBadgeCls = alert.severity === 'CRITICAL' ? 'bg-red-100 text-red-700'
                              : alert.severity === 'WARNING' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700';
                            const typeLbl = alert.alertType === 'SENSOR_THRESHOLD' ? '센서임계'
                              : alert.alertType === 'FARM_OFFLINE' || alert.alertType === 'OFFLINE' ? '오프라인'
                              : alert.alertType === 'MAINTENANCE_EXPIRY' ? '유지보수' : alert.alertType;
                            const timeStr = alert.createdAt ? new Date(alert.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
                            const resolution = alert.metadata?.resolution;
                            const resolvedAt = alert.metadata?.resolvedAt ? new Date(alert.metadata.resolvedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

                            return (
                              <div key={alert._id} className={`border-l-4 ${sevBorder} rounded-r-lg border border-gray-200 ${isDel ? 'bg-rose-50/30 opacity-60' : isAcked ? 'bg-gray-50/50 opacity-70' : 'bg-white'}`}>
                                {/* 알림 헤더 */}
                                <div className="px-4 py-3">
                                  <div className="flex items-center justify-between mb-1.5">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isDel || isAcked ? 'bg-gray-100 text-gray-500' : sevBadgeCls}`}>
                                        {alert.severity}
                                      </span>
                                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{typeLbl}</span>
                                      {alert.houseId && alert.houseId !== 'FARM' && (
                                        <span className="text-[10px] text-gray-400">{alert.houseId}</span>
                                      )}
                                      {isDel && (
                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-600 font-medium">
                                          🗑 {alert.deletedBy || '삭제됨'}
                                        </span>
                                      )}
                                    </div>
                                    <span className="text-[10px] text-gray-400">{timeStr}</span>
                                  </div>
                                  <p className={`text-sm leading-snug ${isDel ? 'text-gray-400 line-through' : isAcked ? 'text-gray-500' : 'text-gray-800'}`}>{alert.message}</p>

                                  {/* 이력 타임라인 */}
                                  <div className="mt-2 space-y-1">
                                    {/* 확인 상태 */}
                                    {isAcked && (
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[11px] font-medium text-blue-600">
                                          ✓ {alert.acknowledgedBy || '확인됨'} 확인
                                        </span>
                                        {alert.acknowledgedAt && (
                                          <span className="text-[10px] text-gray-400">
                                            {new Date(alert.acknowledgedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                    {/* 삭제 시간 */}
                                    {isDel && alert.deletedAt && (
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[11px] text-rose-500 font-medium">삭제 시각</span>
                                        <span className="text-[10px] text-gray-400">
                                          {new Date(alert.deletedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                      </div>
                                    )}
                                    {/* 미확인 알림 - 버튼 */}
                                    {!isAcked && !isDel && (
                                      <button onClick={() => ackFarmAlert(alert._id)}
                                        className="px-3 py-1 rounded text-[11px] font-medium bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 transition-colors">
                                        확인 처리
                                      </button>
                                    )}
                                  </div>

                                  {/* 조치내역 버튼 (삭제되지 않은 알림만) */}
                                  {!isDel && (
                                    <div className="flex justify-end mt-1">
                                      <button
                                        onClick={() => { setEditResolutionId(editResolutionId === alert._id ? null : alert._id); setEditResolutionText(resolution || ''); }}
                                        className="text-[11px] text-indigo-600 hover:text-indigo-800 hover:underline">
                                        {resolution ? '조치내역 수정' : '조치내역 작성'}
                                      </button>
                                    </div>
                                  )}
                                </div>

                                {/* 조치내역 표시 */}
                                {resolution && editResolutionId !== alert._id && (
                                  <div className="px-4 py-2.5 bg-indigo-50/50 border-t border-gray-100">
                                    <div className="flex items-center gap-1.5 mb-1">
                                      <span className="text-[10px] font-semibold text-indigo-600">조치내역</span>
                                      {resolvedAt && <span className="text-[10px] text-gray-400">{resolvedAt}</span>}
                                    </div>
                                    <p className="text-xs text-gray-700 whitespace-pre-wrap">{resolution}</p>
                                  </div>
                                )}

                                {/* 조치내역 편집 폼 (삭제되지 않은 알림만) */}
                                {!isDel && editResolutionId === alert._id && (
                                  <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
                                    <textarea
                                      value={editResolutionText}
                                      onChange={e => setEditResolutionText(e.target.value)}
                                      rows={3}
                                      placeholder="조치 내용을 입력하세요... (예: 환기팬 가동, 현장 점검 완료)"
                                      className="w-full px-3 py-2 border border-gray-300 rounded text-sm resize-none focus:outline-none focus:border-indigo-500 mb-2"
                                    />
                                    <div className="flex justify-end gap-2">
                                      <button onClick={() => { setEditResolutionId(null); setEditResolutionText(''); }}
                                        className="px-3 py-1.5 bg-white border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-50">
                                        취소
                                      </button>
                                      <button onClick={() => saveFarmAlertResolution(alert._id)}
                                        disabled={!editResolutionText.trim()}
                                        className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors">
                                        저장
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-center py-12 text-gray-400">
                          <div className="text-3xl mb-2 opacity-40">🔔</div>
                          <p className="text-sm">{
                            farmAlertFilter === 'all' ? '알림 내역이 없습니다'
                            : farmAlertFilter === 'unack' ? '미확인 알림이 없습니다'
                            : farmAlertFilter === 'acked' ? '확인된 알림이 없습니다'
                            : '삭제된 알림이 없습니다'
                          }</p>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* 메모 탭 */}
                {!detailLoading && detailTab === 'notes' && (() => {
                  // 시스템 메모: 알림 확인/조치/삭제 기록을 메모로 변환
                  const sysEntries = farmAlerts
                    .filter(a => a.acknowledged || a.metadata?.resolution || a.deleted)
                    .map(a => {
                      const who = a.acknowledgedBy || '';
                      const delWho = a.deletedBy || '';
                      let content;
                      if (a.deleted && a.metadata?.resolution) {
                        content = `[삭제${delWho ? `/${delWho}` : ''}] ${a.message}${who ? `\n→ ${who} 확인` : ''}${a.metadata.resolution ? `\n→ 조치: ${a.metadata.resolution}` : ''}`;
                      } else if (a.deleted) {
                        content = `[삭제${delWho ? `/${delWho}` : ''}] ${a.message}${who ? ` (${who} 확인)` : ''}`;
                      } else if (a.metadata?.resolution) {
                        content = `[조치완료${who ? `/${who}` : ''}] ${a.message}\n→ ${a.metadata.resolution}`;
                      } else {
                        content = `[확인처리${who ? `/${who}` : ''}] ${a.message}`;
                      }
                      return {
                        id: `sys_${a._id}`,
                        type: 'system',
                        content,
                        author: '시스템',
                        createdAt: a.deletedAt || a.metadata?.resolvedAt || a.acknowledgedAt || a.createdAt,
                        severity: a.severity,
                      };
                    });
                  // 사용자 메모
                  const userEntries = farmNotes.map(n => ({
                    id: n.id,
                    type: 'user',
                    content: n.content,
                    author: n.author || '사용자',
                    createdAt: n.createdAt,
                  }));
                  // 합쳐서 시간순
                  const all = [...userEntries, ...sysEntries].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

                  return (
                    <div className="space-y-4">
                      {/* 새 메모 입력 */}
                      <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                        <textarea value={newNote} onChange={e => setNewNote(e.target.value)}
                          rows={2} placeholder="메모를 입력하세요..."
                          className="w-full px-3 py-2 border border-gray-300 rounded text-sm resize-none focus:outline-none focus:border-indigo-500 mb-2" />
                        <div className="flex justify-end">
                          <button onClick={addNote} disabled={!newNote.trim()}
                            className="px-4 py-1.5 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors">
                            추가
                          </button>
                        </div>
                      </div>

                      {/* 타입 범례 */}
                      <div className="flex items-center gap-3 text-[11px] text-gray-400">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-400 inline-block" /> 사용자 메모</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> 시스템 기록</span>
                      </div>

                      {/* 통합 타임라인 */}
                      {all.length > 0 ? (
                        <div className="space-y-2 max-h-[450px] overflow-y-auto">
                          {all.map(entry => (
                            <div key={entry.id} className={`rounded-lg p-3 transition-colors ${
                              entry.type === 'system'
                                ? 'bg-blue-50/60 border border-blue-100'
                                : 'bg-white border border-gray-200 hover:bg-gray-50'
                            }`}>
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    entry.type === 'system' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'
                                  }`}>
                                    {entry.type === 'system' ? '시스템' : '사용자'}
                                  </span>
                                  <span className="text-xs font-medium text-gray-700">{entry.author}</span>
                                  {entry.severity && (
                                    <span className={`px-1 py-0.5 rounded text-[9px] font-bold ${
                                      entry.severity === 'CRITICAL' ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600'
                                    }`}>{entry.severity}</span>
                                  )}
                                  <span className="text-[11px] text-gray-400">
                                    {entry.createdAt ? new Date(entry.createdAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                                  </span>
                                </div>
                                {entry.type === 'user' && (
                                  <div className="flex gap-1">
                                    <button onClick={() => { setEditNoteId(entry.id); setEditNoteText(entry.content); }}
                                      className="px-2 py-0.5 text-[11px] text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors">
                                      수정
                                    </button>
                                    <button onClick={() => deleteNote(entry.id)}
                                      className="px-2 py-0.5 text-[11px] text-gray-500 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors">
                                      삭제
                                    </button>
                                  </div>
                                )}
                              </div>
                              {editNoteId === entry.id ? (
                                <div className="space-y-2">
                                  <textarea value={editNoteText} onChange={e => setEditNoteText(e.target.value)}
                                    rows={2} className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm resize-none focus:outline-none focus:border-indigo-500" />
                                  <div className="flex gap-1.5 justify-end">
                                    <button onClick={() => setEditNoteId(null)}
                                      className="px-3 py-1 bg-white border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-50">취소</button>
                                    <button onClick={() => updateNote(entry.id)} disabled={!editNoteText.trim()}
                                      className="px-3 py-1 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700 disabled:bg-gray-300">저장</button>
                                  </div>
                                </div>
                              ) : (
                                <p className={`text-sm whitespace-pre-wrap ${entry.type === 'system' ? 'text-blue-800' : 'text-gray-700'}`}>{entry.content}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-12 text-gray-400">
                          <div className="text-3xl mb-2 opacity-40">📝</div>
                          <p className="text-sm">메모가 없습니다</p>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* API 키 탭 */}
                {!detailLoading && detailTab === 'apikey' && (
                  <div className="space-y-4">
                    <table className="w-full border-collapse">
                      <tbody>
                        <tr>
                          <td className="bg-slate-50 px-4 py-3 text-sm font-medium text-gray-700 border border-gray-200 w-32">API Key</td>
                          <td className="px-4 py-2.5 border border-gray-200">
                            <div className="flex items-center gap-2">
                              <code className="flex-1 text-xs bg-gray-50 px-3 py-2 rounded border border-gray-200 font-mono text-gray-700 break-all select-all">
                                {detailFarm.apiKey}
                              </code>
                              <button onClick={() => copyKey(detailFarm.apiKey, detailFarm.farmId)}
                                className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors whitespace-nowrap ${copiedKey === detailFarm.farmId ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}>
                                {copiedKey === detailFarm.farmId ? '복사됨' : '복사'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                      <h5 className="text-sm font-semibold text-amber-800 mb-1">API 키 재발급</h5>
                      <p className="text-xs text-amber-700 mb-3">
                        재발급하면 기존 키로 연결된 RPi가 인증 실패합니다. RPi의 환경변수(API_KEY)도 함께 업데이트해야 합니다.
                      </p>
                      <button onClick={() => handleRegenKey(detailFarm.farmId)}
                        className="px-4 py-1.5 bg-amber-600 text-white rounded text-xs font-medium hover:bg-amber-700 transition-colors">
                        키 재발급
                      </button>
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <h5 className="text-sm font-semibold text-blue-800 mb-2">RPi 설정 가이드</h5>
                      <div className="text-xs text-blue-700 font-mono bg-white rounded p-3 border border-blue-200 whitespace-pre-wrap">{`# /etc/systemd/system/nodered.service.d/platform.conf
[Service]
Environment="SERVER_URL=http://<서버IP>:3000"
Environment="FARM_ID=${detailFarm.farmId}"
Environment="API_KEY=${detailFarm.apiKey}"

# 적용
sudo systemctl daemon-reload
sudo systemctl restart nodered`}</div>
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 bg-gray-50 rounded-b-lg">
                <div className="flex gap-2">
                  <button onClick={() => handleEdit(detailFarm)}
                    className="px-4 py-1.5 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700 transition-colors">
                    수정
                  </button>
                  <button onClick={() => { handleDelete(detailFarm.farmId); setDetailFarm(null); }}
                    className="px-4 py-1.5 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700 transition-colors">
                    삭제
                  </button>
                  <button onClick={exportFarmPDF}
                    className="px-4 py-1.5 bg-slate-600 text-white rounded text-xs font-medium hover:bg-slate-700 transition-colors">
                    PDF
                  </button>
                </div>
                <button onClick={() => setDetailFarm(null)}
                  className="px-6 py-1.5 bg-white border border-gray-300 rounded text-xs text-gray-600 hover:bg-gray-50 transition-colors">
                  닫기
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══ Map Modal ═══ */}
      {showMap && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 pt-[5vh] overflow-y-auto">
          <div className="bg-white rounded-lg w-full max-w-4xl shadow-xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-slate-600 rounded-t-lg">
              <h3 className="text-base font-bold text-white">농장 지도</h3>
              <button onClick={() => setShowMap(false)}
                className="text-white/70 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <FarmMapView farms={farms} onSelect={(farm) => { setShowMap(false); openDetail(farm); }} />
          </div>
        </div>
      )}

      {/* ═══ Excel Import Modal ═══ */}
      {showImport && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 pt-[10vh] overflow-y-auto">
          <div className="bg-white rounded-lg w-full max-w-2xl shadow-xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-slate-600 rounded-t-lg">
              <h3 className="text-base font-bold text-white">엑셀 일괄 등록</h3>
              <button onClick={() => { setShowImport(false); setImportData([]); setImportResult(null); }}
                className="text-white/70 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-xs text-blue-700">
                  엑셀 파일의 열 이름: <strong>농장ID, 농장명, 주소, 대표자, 형태, 면적, 시스템, 상태, 유지보수(월), 메모</strong>
                </p>
              </div>
              <div>
                <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100" />
              </div>
              {importData.length > 0 && (
                <>
                  <div className="text-sm text-gray-600">{importData.length}개 농장 데이터 인식됨</div>
                  <div className="max-h-48 overflow-auto border border-gray-200 rounded">
                    <table className="w-full text-xs">
                      <thead><tr className="bg-gray-50">
                        <th className="px-2 py-1.5 text-left">농장ID</th><th className="px-2 py-1.5 text-left">농장명</th>
                        <th className="px-2 py-1.5 text-left">주소</th><th className="px-2 py-1.5 text-left">상태</th>
                      </tr></thead>
                      <tbody>{importData.map((f, i) => (
                        <tr key={i} className="border-t border-gray-100">
                          <td className="px-2 py-1 font-mono">{f.farmId}</td><td className="px-2 py-1">{f.name}</td>
                          <td className="px-2 py-1 text-gray-500">{f.location || '-'}</td><td className="px-2 py-1">{f.status}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  <button onClick={submitImport}
                    className="w-full py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
                    {importData.length}개 농장 일괄 등록
                  </button>
                </>
              )}
              {importResult && (
                <div className={`p-3 rounded-lg border text-sm ${importResult.failed > 0 ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
                  <p>성공: <strong>{importResult.success}</strong>건, 실패: <strong>{importResult.failed}</strong>건</p>
                  {importResult.errors?.length > 0 && (
                    <ul className="mt-2 text-xs text-red-600 list-disc list-inside">
                      {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ Alert Feed Slide Panel ═══ */}
      {showAlertFeed && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setShowAlertFeed(false)} />
          {/* Panel */}
          <div className="fixed top-0 right-0 h-full w-[420px] max-w-[90vw] bg-white shadow-2xl z-50 flex flex-col"
            style={{ animation: 'slideIn 0.25s ease-out' }}>
            {/* Header */}
            <div className="px-5 pt-4 pb-0 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🔔</span>
                  <h3 className="text-sm font-bold text-gray-800">알림 피드</h3>
                  <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-semibold">
                    {alertFeedData.length}건
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => fetchAlertFeed()} className="p-1.5 rounded hover:bg-gray-200 transition-colors" title="새로고침">
                    <svg className={`w-4 h-4 text-gray-500 ${alertFeedLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                  <button onClick={() => setShowAlertFeed(false)} className="p-1.5 rounded hover:bg-gray-200 transition-colors" title="닫기">
                    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              {/* Tabs */}
              <div className="flex gap-1">
                {[
                  { key: 'unack', label: '미확인' },
                  { key: 'all', label: '전체내역' },
                ].map(tab => (
                  <button key={tab.key}
                    onClick={() => { setAlertFeedTab(tab.key); fetchAlertFeed(tab.key); }}
                    className={`px-4 py-2 text-xs font-medium rounded-t-lg transition-colors ${
                      alertFeedTab === tab.key
                        ? 'bg-white text-gray-800 border border-b-white border-gray-200 -mb-px'
                        : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                    }`}>
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {alertFeedLoading && alertFeedData.length === 0 ? (
                <div className="flex items-center justify-center h-40">
                  <div className="animate-spin w-6 h-6 border-2 border-gray-300 border-t-indigo-600 rounded-full" />
                </div>
              ) : alertFeedData.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-40 text-gray-400">
                  <span className="text-3xl mb-2">{alertFeedTab === 'unack' ? '✅' : '📭'}</span>
                  <p className="text-sm">{alertFeedTab === 'unack' ? '미확인 알림이 없습니다' : '알림 내역이 없습니다'}</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {alertFeedData.map(alert => {
                    const isAcked = alert.acknowledged;
                    const sevCls = isAcked ? 'border-l-gray-300 bg-gray-50/50'
                      : alert.severity === 'CRITICAL' ? 'border-l-red-500 bg-red-50/50'
                      : alert.severity === 'WARNING' ? 'border-l-orange-400 bg-orange-50/30'
                      : 'border-l-blue-400 bg-blue-50/30';
                    const sevBadgeCls = alert.severity === 'CRITICAL' ? 'bg-red-100 text-red-700'
                      : alert.severity === 'WARNING' ? 'bg-orange-100 text-orange-700'
                      : 'bg-blue-100 text-blue-700';
                    const farm = farms.find(f => f.farmId === alert.farmId);
                    const farmName = farm?.name || alert.farmId;
                    const timeAgo = (() => {
                      if (!alert.createdAt) return '';
                      const diff = Date.now() - new Date(alert.createdAt).getTime();
                      if (diff < 60000) return '방금';
                      if (diff < 3600000) return `${Math.floor(diff / 60000)}분 전`;
                      if (diff < 86400000) return `${Math.floor(diff / 3600000)}시간 전`;
                      return `${Math.floor(diff / 86400000)}일 전`;
                    })();
                    const ackTime = (() => {
                      if (!alert.acknowledgedAt) return '';
                      return new Date(alert.acknowledgedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                    })();

                    return (
                      <div key={alert._id} className={`border-l-4 ${sevCls} px-4 py-3 transition-colors ${isAcked ? 'opacity-60' : 'hover:bg-gray-50/50'}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${isAcked ? 'bg-gray-100 text-gray-500' : sevBadgeCls}`}>
                                {alert.severity}
                              </span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                                {alert.alertType === 'SENSOR_THRESHOLD' ? '센서임계'
                                  : alert.alertType === 'FARM_OFFLINE' || alert.alertType === 'OFFLINE' ? '오프라인'
                                  : alert.alertType === 'MAINTENANCE_EXPIRY' ? '유지보수'
                                  : alert.alertType}
                              </span>
                              {isAcked && (
                                <span className="text-[10px] font-medium flex items-center gap-0.5 text-blue-600">
                                  ✓ {alert.acknowledgedBy || '확인됨'} 확인{ackTime ? ` (${ackTime})` : ''}
                                </span>
                              )}
                            </div>
                            <p className={`text-sm leading-snug ${isAcked ? 'text-gray-500' : 'text-gray-800'}`}>{alert.message}</p>
                            <div className="flex items-center gap-2 mt-1.5">
                              <button
                                onClick={() => { const f = farms.find(x => x.farmId === alert.farmId); if (f) { setShowAlertFeed(false); openDetail(f); } }}
                                className="text-[11px] text-indigo-600 hover:text-indigo-800 hover:underline font-medium">
                                {farmName}
                              </button>
                              {alert.houseId && alert.houseId !== 'FARM' && <span className="text-[10px] text-gray-400">{alert.houseId}</span>}
                              <span className="text-[10px] text-gray-400 ml-auto">{timeAgo}</span>
                            </div>
                          </div>
                          <div className="flex flex-col gap-1 flex-shrink-0">
                            {!isAcked && (
                              <button onClick={() => acknowledgeAlert(alert._id)}
                                className="px-2.5 py-1.5 rounded text-[11px] font-medium bg-white border border-gray-200 text-gray-600 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 transition-colors"
                                title="알림 확인 처리">
                                확인
                              </button>
                            )}
                            <button onClick={() => deleteAlert(alert._id)}
                              className="px-2.5 py-1.5 rounded text-[11px] font-medium bg-white border border-gray-200 text-gray-400 hover:bg-red-50 hover:border-red-300 hover:text-red-600 transition-colors"
                              title="알림 삭제">
                              삭제
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between text-[11px] text-gray-400">
                <span>30초마다 자동 새로고침</span>
                <span>{alertFeedData.length > 0 ? `${alertFeedData.length}건 표시` : ''}</span>
              </div>
            </div>
          </div>
        </>
      )}

    </div>
  );
}
