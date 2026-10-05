import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axiosBase from 'axios';
import * as XLSX from 'xlsx';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getApiBase } from '../../services/apiSwitcher';

// ━━━ 데이터 조회·추출 (KOAT 검정기준 116 「통합제어기」 4.가.1)라)마), 2)마)바)) ━━━
// 센서 관측치 · 구동기 제어 이력 · 표준(KS X 3267) 구동기 상태를 1분 단위 행으로 조회하고
// 조회기간(1일/7일/30일/직접) 을 정해 .csv / .txt / .xlsx 로 추출한다. 3분 이내 출력이 검정 기준이라 소요 시간을 표시한다.
// 값은 서버가 저장한 그대로 — 빈 칸은 결측(지어내지 않음).

const axios = axiosBase.create();
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const KINDS = [
  { id: 'sensor', label: '센서 관측치', icon: '🌡️' },
  { id: 'control', label: '구동기 제어 이력', icon: '🎛️' },
  { id: 'actuator', label: '구동기 상태 1분 (표준·비표준)', icon: '📐' },   // 2026-09-19 비표준 릴레이도 같은 1분 행
  { id: 'sensorstatus', label: '표준 센서 관측치·상태 (KS X 3267)', icon: '📐' },  // §5.4.4 — 상태가 무엇이든 매분 저장된 원본
];
// KS X 3267 센서 코드 → 아이콘. 심사에서 한눈에 종류를 알아보라고 (2026-10-05)
const KS_ICON = {
  1: '🌡️', 2: '💧', 3: '🌫️', 4: '🌦️', 5: '🚰', 6: '☔', 7: '☀️', 8: '🌬️', 9: '🧭',
  10: '🔌', 11: '💨', 12: '⚡', 13: '🔆', 14: '🪴', 15: '📉', 16: '⚗️', 17: '🌱', 18: '⚖️',
};
const NO_HOUSE_KINDS = ['actuator', 'sensorstatus'];  // 하우스 없이도 조회되는 종류
const PERIODS = [{ d: 1, label: '1일' }, { d: 7, label: '7일' }, { d: 30, label: '30일' }, { d: 0, label: '직접 입력' }];

const toLocalInput = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function DataExplorer({ farmId }) {
  const api = getApiBase();
  const [kind, setKind] = useState('sensor');
  const [houses, setHouses] = useState([]);
  const [houseId, setHouseId] = useState('');
  const [period, setPeriod] = useState(1);
  const [customStart, setCustomStart] = useState(toLocalInput(new Date(Date.now() - 86400000)));
  const [customEnd, setCustomEnd] = useState(toLocalInput(new Date()));
  const [items, setItems] = useState([]);        // 선택 가능한 항목 (센서/장치)
  const [selected, setSelected] = useState([]);   // 선택된 항목 id
  const [rows, setRows] = useState([]);
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState('');

  // 하우스 목록
  useEffect(() => {
    let alive = true;
    axios.get(`${api}/config/farm/${farmId}`, { timeout: 8000 })
      .then(r => { if (!alive) return; const hs = r.data?.success ? r.data.data : []; setHouses(hs); if (hs[0] && !houseId) setHouseId(hs[0].houseId); })
      .catch(() => {});
    return () => { alive = false; };
  }, [api, farmId]); // eslint-disable-line react-hooks/exhaustive-deps

  const house = useMemo(() => houses.find(h => h.houseId === houseId), [houses, houseId]);
  const range = useMemo(() => {
    if (period > 0) { const end = new Date(); return { start: new Date(end.getTime() - period * 86400000), end }; }
    return { start: new Date(customStart), end: new Date(customEnd) };
  }, [period, customStart, customEnd]);

  // 항목 목록 (종류·하우스에 따라)
  useEffect(() => {
    setSelected([]); setRows([]); setColumns([]); setElapsed(null); setError('');
    if (kind === 'sensor') {
      setItems((house?.sensors || []).map(s => ({
        id: s.sensorId, icon: s.icon || '📈', title: s.name || s.sensorId,
        sub: `${s.sensorId}${s.unit ? ' · ' + s.unit : ''}`,
      })));
    } else if (kind === 'control') {
      setItems((house?.devices || []).map(d => ({
        id: d.deviceId, icon: d.icon || '🎛️', title: d.name || d.deviceId, sub: d.deviceId,
      })));
    } else if (kind === 'sensorstatus') {
      let alive = true;
      axios.get(`${api}/sensor-status/${farmId}/sensors`, { params: { startDate: range.start.toISOString(), endDate: range.end.toISOString(), houseId: houseId || undefined }, timeout: 10000 })
        .then(r => { if (!alive) return; setItems((r.data?.data || [])
          // 하우스를 고르면 그 하우스 것만. 예전엔 `!s.house_id` 도 통과시켜, 하우스 미지정 행(옛 시험 기간)이
          // 같이 떠서 신고한 17종보다 많은 종류가 보였다 (2026-10-05)
          .filter(s => !houseId || s.house_id === houseId)
          .map(s => ({
            id: `${s.unit}:${s.idx}`, icon: KS_ICON[s.code] || '📈',
            title: s.name || `센서 ${s.idx}`,
            sub: `노드 ${s.unit} · ${s.idx}번 자리${s.sensor_id ? ' · ' + s.sensor_id : ''}`,
            rows: s.rows,
          }))); })
        .catch(e => { if (alive) setError('표준 센서 목록 조회 실패: ' + (e.response?.data?.error || e.message)); });
      return () => { alive = false; };
    } else {
      let alive = true;
      axios.get(`${api}/actuator-status/${farmId}/devices`, { params: { startDate: range.start.toISOString(), endDate: range.end.toISOString() }, timeout: 10000 })
        .then(r => { if (!alive) return; setItems((r.data?.data || []).filter(d => !houseId || d.house_id === houseId)
          .map(d => ({
            id: d.device_id, icon: d.kind === 'opener' ? '🪟' : '🔌',
            title: d.name || d.device_id,
            sub: `${d.source === 'vendor' ? '비표준' : '표준'} · 노드 ${d.unit} · ${d.kind === 'opener' ? '개폐기' : '스위치'} ${d.n}`,
            rows: d.rows,
          }))); })
        .catch(e => { if (alive) setError('표준 구동기 목록 조회 실패: ' + (e.response?.data?.error || e.message)); });
      return () => { alive = false; };
    }
  }, [kind, house, houseId, api, farmId, range.start.getTime(), range.end.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const query = useCallback(async () => {
    setLoading(true); setError(''); setRows([]);
    const t0 = performance.now();
    const params = { startDate: range.start.toISOString(), endDate: range.end.toISOString() };
    try {
      if (kind === 'sensor') {
        const r = await axios.get(`${api}/sensors/${farmId}/${houseId}/export`, { params: { ...params, format: 'json', sensorIds: selected.join(',') || undefined }, timeout: 180000 });
        setColumns(r.data.columns); setRows(r.data.data);
      } else if (kind === 'control') {
        // 이력은 페이지 API — 30일치를 전부 모은다 (최대 200×50 = 1만 건)
        const all = [];
        for (let p = 1; p <= 50; p++) {
          const r = await axios.get(`${api}/control-logs/${farmId}`, { params: { ...params, houseId, deviceId: selected.length === 1 ? selected[0] : undefined, limit: 200, page: p }, timeout: 60000 });
          const d = r.data?.data || []; all.push(...d);
          if (d.length < 200 || p >= (r.data?.pagination?.totalPages || 1)) break;
        }
        const filtered = selected.length > 1 ? all.filter(l => selected.includes(l.deviceId)) : all;
        setColumns(['timestamp', 'deviceId', 'deviceName', 'command', 'success', 'operator', 'operatorName', 'isAutomatic', 'automationReason']);
        setRows(filtered.map(l => ({ ...l, timestamp: new Date(l.timestamp || l.createdAt).toLocaleString('ko-KR', { hour12: false }), success: l.success === false ? 'N' : 'Y', isAutomatic: l.isAutomatic ? 'Y' : 'N' })));
      } else if (kind === 'sensorstatus') {
        // 선택 항목은 'unit:idx' — 한 노드(unit)만 고를 수 있을 때 idx 목록으로 좁힌다
        const units = [...new Set(selected.map(s => s.split(':')[0]))];
        const p = { ...params, houseId: houseId || undefined };
        if (units.length === 1) { p.unit = units[0]; p.idx = selected.map(s => s.split(':')[1]).join(','); }
        const r = await axios.get(`${api}/sensor-status/${farmId}`, { params: p, timeout: 180000 });
        const all = r.data?.data || [];
        const filtered = selected.length && units.length > 1 ? all.filter(x => selected.includes(`${x.unit}:${x.idx}`)) : all;
        setColumns(['timestamp', 'unit', 'idx', 'code', 'name', 'value', 'status', 'status_name', 'house_id', 'sensor_id']);
        setRows(filtered.map(x => ({ ...x, timestamp: new Date(x.timestamp).toLocaleString('ko-KR', { hour12: false }) })));
      } else {
        const r = await axios.get(`${api}/actuator-status/${farmId}`, { params: { ...params, houseId: houseId || undefined, deviceId: selected.join(',') || undefined }, timeout: 180000 });
        setColumns(['timestamp', 'house_id', 'device_id', 'unit', 'kind', 'n', 'status', 'status_name', 'remain', 'opid']);
        setRows((r.data?.data || []).map(x => ({ ...x, timestamp: new Date(x.timestamp).toLocaleString('ko-KR', { hour12: false }) })));
      }
      setElapsed(Math.round(performance.now() - t0));
    } catch (e) {
      setError('조회 실패: ' + (e.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
  }, [api, farmId, houseId, kind, range, selected]);

  const download = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const baseName = () => {
    const d = (x) => x.toISOString().slice(0, 10).replace(/-/g, '');
    return `${kind}_${farmId}_${houseId || 'all'}_${d(range.start)}-${d(range.end)}`;
  };

  // 서버 추출 (csv/txt) — 저장된 원본 그대로
  const exportServer = async (format) => {
    setExporting(format); setError('');
    const t0 = performance.now();
    try {
      const params = { startDate: range.start.toISOString(), endDate: range.end.toISOString(), format };
      let url;
      if (kind === 'sensor') { url = `${api}/sensors/${farmId}/${houseId}/export`; if (selected.length) params.sensorIds = selected.join(','); }
      else if (kind === 'control') { url = `${api}/control-logs/${farmId}/export`; params.houseId = houseId; if (selected.length === 1) params.deviceId = selected[0]; }
      else if (kind === 'sensorstatus') {
        url = `${api}/sensor-status/${farmId}/export`; if (houseId) params.houseId = houseId;
        const units = [...new Set(selected.map(s => s.split(':')[0]))];
        if (units.length === 1) { params.unit = units[0]; params.idx = selected.map(s => s.split(':')[1]).join(','); }
      }
      else { url = `${api}/actuator-status/${farmId}/export`; if (houseId) params.houseId = houseId; if (selected.length) params.deviceId = selected.join(','); }
      const r = await axios.get(url, { params, responseType: 'blob', timeout: 180000 });
      download(r.data, `${baseName()}.${format}`);
      setElapsed(Math.round(performance.now() - t0));
    } catch (e) {
      setError('추출 실패: ' + (e.response?.data?.error || e.message));
    } finally {
      setExporting('');
    }
  };

  // xlsx — 조회된 표를 그대로 (조회 먼저)
  const exportXlsx = () => {
    if (rows.length === 0) { setError('먼저 조회하세요'); return; }
    const ws = XLSX.utils.json_to_sheet(rows.map(r => Object.fromEntries(columns.map(c => [c, r[c] ?? '']))), { header: columns });
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, kind);
    XLSX.writeFile(wb, `${baseName()}.xlsx`);
  };

  // 결과를 센서·장치별로 묶는다 — 한 표에 다 쏟으면 어느 줄이 어느 센서인지 안 보인다 (2026-10-06).
  // 묶을 기준이 없으면(센서 관측치·제어 이력) 한 묶음으로 둔다.
  const [activeKey, setActiveKey] = useState(null);
  const groups = useMemo(() => {
    if (rows.length === 0) return [];
    const keyOf = (r) => {
      if (kind === 'sensorstatus') return `${r.unit}:${r.idx}`;
      if (kind === 'actuator') return r.device_id || r.deviceId || '전체';
      if (kind === 'control') return r.deviceId || '전체';
      return '전체';
    };
    const map = new Map();
    for (const r of rows) {
      const k = keyOf(r);
      if (!map.has(k)) {
        const meta = items.find(i => i.id === k) || {};
        map.set(k, {
          key: k,
          icon: meta.icon || (kind === 'sensorstatus' ? (KS_ICON[r.code] || '📈') : '🎛️'),
          title: meta.title || r.name || r.deviceName || k,
          sub: meta.sub || (kind === 'sensorstatus' ? `노드 ${r.unit} · ${r.idx}번 자리` : k),
          rows: [],
        });
      }
      map.get(k).rows.push(r);
    }
    const all = [...map.values()];
    // 위에서 고른 항목만 보여 준다 — 선택을 해제했는데 아래 탭에 남아 있으면 안 된다 (2026-10-06).
    // 아무것도 안 고르면 전체(= 조회 결과 그대로).
    return selected.length > 0 ? all.filter(g => selected.includes(g.key)) : all;
  }, [rows, kind, items, selected]);

  // 조회 결과가 바뀌면 첫 탭으로 — 없어진 탭이 선택된 채 빈 화면이 되지 않게
  const active = groups.find(g => g.key === activeKey) || groups[0] || null;
  useEffect(() => { setActiveKey(groups[0]?.key ?? null); }, [groups]);


  return (
    <div className="space-y-4 animate-fade-in-up">
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {KINDS.map(k => (
            <button key={k.id} onClick={() => setKind(k.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-bold border ${kind === k.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
              {k.icon} {k.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-sm font-bold text-gray-700 mb-1 block">하우스</label>
            <select value={houseId} onChange={e => setHouseId(e.target.value)} className="input-field text-sm">
              {NO_HOUSE_KINDS.includes(kind) && <option value="">전체</option>}
              {houses.map(h => <option key={h.houseId} value={h.houseId}>{h.name || h.houseId}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-bold text-gray-700 mb-1 block">조회기간</label>
            <div className="flex gap-1">
              {PERIODS.map(p => (
                <button key={p.d} onClick={() => setPeriod(p.d)}
                  className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-colors ${period === p.d ? 'bg-blue-600 border-blue-600 shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                  {/* 선택 상태는 위쪽 종류 탭과 같은 파랑. 검은 바탕은 글씨가 묻혔다 (2026-10-06) */}
                  <span style={period === p.d ? { color: '#fff' } : undefined}>{p.label}</span>
                </button>
              ))}
            </div>
          </div>
          {period === 0 && (
            <div className="flex gap-2">
              <div className="flex-1"><label className="text-xs text-gray-500 mb-1 block">시작</label>
                <input type="datetime-local" value={customStart} onChange={e => setCustomStart(e.target.value)} className="input-field text-sm" /></div>
              <div className="flex-1"><label className="text-xs text-gray-500 mb-1 block">끝</label>
                <input type="datetime-local" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="input-field text-sm" /></div>
            </div>
          )}
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-bold text-gray-700">
              조회 항목
              <span className="ml-2 text-xs font-normal text-gray-400">
                {selected.length > 0 ? `${selected.length}개 선택` : `전체 ${items.length}개`}
              </span>
            </label>
            {items.length > 0 && (
              <div className="flex gap-1">
                <button onClick={() => setSelected(items.map(i => i.id))}
                  className="text-xs font-semibold text-gray-600 border border-gray-200 rounded-md px-2.5 py-1 hover:bg-gray-50">전체 선택</button>
                <button onClick={() => setSelected([])}
                  className="text-xs font-semibold text-gray-600 border border-gray-200 rounded-md px-2.5 py-1 hover:bg-gray-50">선택 해제</button>
              </div>
            )}
          </div>
          {items.length === 0 ? (
            <p className="text-sm text-gray-400 py-3">이 기간에 기록된 항목이 없습니다.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
              {items.map(it => {
                const on = selected.includes(it.id);
                return (
                  <button key={it.id} onClick={() => toggle(it.id)}
                    className={`text-left rounded-xl border-2 px-3 py-2 transition-all ${on
                      ? 'border-indigo-500 bg-indigo-50 shadow-sm'
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'}`}>
                    <div className="flex items-start gap-2">
                      <span className="text-lg leading-none mt-0.5">{it.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className={`text-sm font-bold truncate ${on ? 'text-indigo-900' : 'text-gray-800'}`}>{it.title}</div>
                        <div className="text-[11px] text-gray-500 truncate">{it.sub}</div>
                        {it.rows !== undefined && (
                          <div className="text-[11px] text-gray-400 mt-0.5">{Number(it.rows).toLocaleString()}행</div>
                        )}
                      </div>
                      {on && <span className="text-indigo-600 text-sm font-bold">✓</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
          <p className="text-[11px] text-gray-400 mt-2">아무것도 고르지 않으면 전체가 조회됩니다.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
          <button onClick={query} disabled={loading || (!NO_HOUSE_KINDS.includes(kind) && !houseId)}
            className="px-5 py-2.5 rounded-xl text-sm font-bold bg-blue-600 text-white shadow-sm hover:bg-blue-700 disabled:opacity-40 disabled:shadow-none">
            {loading ? '조회 중…' : '🔍 조회'}
          </button>

          <div className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50/60 px-2.5 py-1.5">
            <span className="text-xs font-bold text-emerald-800">파일로 저장</span>
            {['csv', 'txt'].map(f => (
              <button key={f} onClick={() => exportServer(f)} disabled={!!exporting || (!NO_HOUSE_KINDS.includes(kind) && !houseId)}
                className="px-2.5 py-1 rounded-lg text-xs font-bold bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50">
                {exporting === f ? '생성 중…' : f.toUpperCase()}
              </button>
            ))}
            <button onClick={exportXlsx} disabled={rows.length === 0} title="조회한 표를 그대로 엑셀로 — 먼저 조회하세요"
              className="px-2.5 py-1 rounded-lg text-xs font-bold bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50">
              XLSX
            </button>
          </div>

          {elapsed !== null && (
            <span className={`ml-auto text-xs font-bold px-3 py-1.5 rounded-lg ${elapsed < 180000 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
              {rows.length.toLocaleString()}행 · {(elapsed / 1000).toFixed(1)}초 {elapsed < 180000 ? '· 3분 이내 ✓' : '· 3분 초과'}
            </span>
          )}
        </div>
        {error && <p className="text-xs text-rose-600 font-semibold">{error}</p>}
      </div>

      {/* 결과 — 센서(또는 장치)마다 탭. 카드를 세로로 쌓으면 17종일 때 끝없이 스크롤해야 한다 (2026-10-06) */}
      {groups.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="flex gap-1 overflow-x-auto px-3 pt-3 pb-0 border-b border-gray-200">
            {groups.map(g => {
              const on = g.key === activeKey;
              return (
                <button key={g.key} onClick={() => setActiveKey(g.key)}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-sm font-bold border-b-2 transition-colors ${on
                    ? 'border-blue-600 text-blue-700 bg-blue-50/60'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
                  <span className="text-base">{g.icon}</span>
                  <span className="whitespace-nowrap">{g.title}</span>
                  <span className={`text-[11px] font-normal ${on ? 'text-blue-500' : 'text-gray-400'}`}>
                    {g.rows.length.toLocaleString()}
                  </span>
                </button>
              );
            })}
          </div>
          {active && <ResultCard key={active.key} group={active} columns={columns} fileBase={baseName()} />}
        </div>
      )}
    </div>
  );
}

/** 센서·장치 한 종류의 결과 — 표(50행 페이지) 또는 그래프 */
const CARD_PAGE = 50;
// 열 이름 한글 표기 (추출 파일은 원래 이름 그대로 — 화면만 바꾼다)
const COL_LABEL = {
  timestamp: '시각', unit: '노드', idx: '자리', code: '코드', name: '이름', value: '값',
  status: '상태코드', status_name: '상태', house_id: '하우스', sensor_id: '센서 ID', source: '출처',
  device_id: '장치', deviceId: '장치', deviceName: '장치명', kind: '종류', n: '번호',
  opid: 'OPID', remain: '남은시간', command: '명령', success: '성공', operator: '조작자',
  operatorName: '조작자명', isAutomatic: '자동', automationReason: '자동화 사유',
};
const NUM_COLS = new Set(['value', 'unit', 'idx', 'code', 'status', 'n', 'opid', 'remain']);
const fmtCell = (c, v) => {
  if (v === null || v === undefined || v === '') return '';
  if (c === 'timestamp') {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) {
      const p = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
  }
  return String(v);
};
const CHART_MAX_POINTS = 600;
// 그릴 수 있는 숫자 열 — 센서는 값, 구동기는 값이 없고 상태코드·남은시간·OPID 가 있다 (2026-10-06).
// 구동기는 연속량이 아니라 상태가 계단처럼 바뀌므로 stepAfter 로 그린다.
const CHART_FIELDS = [
  { key: 'value', label: '값', step: false },
  { key: 'status', label: '상태코드', step: true },
  { key: 'remain', label: '남은시간', step: true },
  { key: 'opid', label: 'OPID', step: true },
];   // 30일 4만 행을 그대로 그리면 브라우저가 멈춘다 — 균등 간격으로 솎는다

const ResultCard = ({ group, columns, fileBase }) => {
  const [showChart, setShowChart] = useState(false);   // 표는 항상, 그래프는 접었다 폈다 (표가 사라지면 안 된다)
  const [page, setPage] = useState(1);
  const [chartField, setChartField] = useState(null);   // 구동기는 상태코드·남은시간·OPID 중 고른다

  const total = group.rows.length;
  const totalPages = Math.max(1, Math.ceil(total / CARD_PAGE));
  const pageRows = group.rows.slice((page - 1) * CARD_PAGE, page * CARD_PAGE);

  // 그릴 수 있는 열 — 두 점 이상 숫자가 있는 것만 (센서=값, 구동기=상태코드·남은시간·OPID)
  const fields = useMemo(() => CHART_FIELDS.filter(f =>
    group.rows.reduce((n, r) => n + (Number.isFinite(Number(r[f.key])) && r[f.key] !== null && r[f.key] !== '' ? 1 : 0), 0) > 1
  ), [group.rows]);
  const field = fields.find(f => f.key === chartField) || fields[0] || null;

  // 그래프용 — 고른 열이 숫자인 행만, 균등 간격으로 솎아서
  const chartData = useMemo(() => {
    if (!field) return [];
    const pts = group.rows
      .map(r => ({ t: r.timestamp, v: Number(r[field.key]) }))
      .filter(p => Number.isFinite(p.v));
    if (pts.length <= CHART_MAX_POINTS) return pts;
    const step = Math.ceil(pts.length / CHART_MAX_POINTS);
    return pts.filter((_, i) => i % step === 0);
  }, [group.rows, field]);

  const canChart = chartData.length > 1;

  // 이 센서만 저장 — 화면에 이미 받아 둔 행을 그대로 쓴다(서버에 다시 묻지 않는다).
  // 열 이름은 추출 파일 규약대로 원래(영문) 이름 (2026-10-06).
  const safeName = String(group.title).replace(/[\/:*?"<>|]/g, '_');
  const download = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  const saveCsv = () => {
    const esc = (v) => {
      const t = v === null || v === undefined ? '' : String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const body = [columns.join(','), ...group.rows.map(r => columns.map(c => esc(r[c])).join(','))].join('\r\n');
    download(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }), `${fileBase}_${safeName}.csv`);  // BOM — 엑셀 한글 깨짐 방지
  };
  const saveXlsx = () => {
    const ws = XLSX.utils.json_to_sheet(group.rows.map(r => Object.fromEntries(columns.map(c => [c, r[c] ?? '']))), { header: columns });
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, safeName.slice(0, 31));
    XLSX.writeFile(wb, `${fileBase}_${safeName}.xlsx`);
  };
  const fmtTime = (t) => {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? String(t) : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xl">{group.icon}</span>
          <div className="min-w-0">
            <p className="text-base font-bold text-gray-900 truncate">{group.title}</p>
            <p className="text-xs text-gray-500 truncate">{group.sub} · {total.toLocaleString()}행</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => setShowChart(v => !v)} disabled={!canChart}
            title={canChart ? '' : '숫자로 그릴 열이 없습니다'}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border disabled:opacity-40 ${showChart ? 'bg-blue-600 border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
            <span style={showChart ? { color: '#fff' } : undefined}>📈 그래프 {showChart ? '숨기기' : '보기'}</span>
          </button>
          {/* 이 센서만 저장 — 전체 저장은 위쪽 「파일로 저장」 (2026-10-06) */}
          <div className="flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50/60 px-2 py-1">
            <span className="text-[11px] font-bold text-emerald-800 whitespace-nowrap">이 센서만</span>
            <button onClick={saveCsv}
              className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-100">CSV</button>
            <button onClick={saveXlsx}
              className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-100">XLSX</button>
          </div>
        </div>
      </div>

      {/* 표는 항상 보이고, 그래프는 그 아래에 — 그래프를 켜면 자료가 사라지던 것을 고침 (2026-10-06) */}
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0">
                <tr className="bg-gray-50">
                  {columns.map(c => (
                    <th key={c}
                      className={`px-3 py-2 whitespace-nowrap font-bold text-gray-600 text-xs border-b-2 border-gray-200 ${NUM_COLS.has(c) ? 'text-right' : 'text-left'}`}>
                      {COL_LABEL[c] || c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <tr key={i} className={`border-b border-gray-100 last:border-0 hover:bg-indigo-50/40 ${i % 2 ? 'bg-gray-50/50' : 'bg-white'}`}>
                    {columns.map(c => (
                      <td key={c}
                        className={`px-3 py-1.5 whitespace-nowrap ${NUM_COLS.has(c) ? 'text-right font-mono' : 'text-left'} ${c === 'value' ? 'font-bold text-gray-900' : 'text-gray-600'}`}>
                        {fmtCell(c, r[c])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
            <span>{((page - 1) * CARD_PAGE + 1).toLocaleString()}–{Math.min(page * CARD_PAGE, total).toLocaleString()} / {total.toLocaleString()}행</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(1)} disabled={page <= 1} className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40">처음</button>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40">◀</button>
              <span className="px-2 py-1 font-semibold text-gray-700">{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40">▶</button>
              <button onClick={() => setPage(totalPages)} disabled={page >= totalPages} className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40">끝</button>
            </div>
          </div>

      {showChart && field && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          {fields.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              <span className="text-xs font-semibold text-gray-500 mr-1">그릴 항목</span>
              {fields.map(f => (
                <button key={f.key} onClick={() => setChartField(f.key)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all
                    ${field.key === f.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:bg-blue-50'}`}>
                  {f.label}
                </button>
              ))}
            </div>
          )}
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 5, right: 12, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                <XAxis dataKey="t" tickFormatter={fmtTime} tick={{ fontSize: 11, fill: '#94a3b8' }} minTickGap={40} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} width={52} domain={['auto', 'auto']} />
                <Tooltip labelFormatter={fmtTime} formatter={(v) => [v, field.label]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                {/* isAnimationActive=false — 키오스크 CPU·발열 (SensorChart 와 같은 규칙) */}
                <Line type={field.step ? 'stepAfter' : 'monotone'} dataKey="v" name={field.label} stroke="#4f46e5" strokeWidth={2}
                      dot={false} isAnimationActive={false} connectNulls />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-[11px] text-gray-400 mt-1">
              {field.label} · {chartData.length.toLocaleString()}점 표시 (전체 {total.toLocaleString()}행을 균등 간격으로 솎음)
              {field.step && ' · 상태는 바뀐 시점까지 유지되므로 계단으로 그립니다'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
