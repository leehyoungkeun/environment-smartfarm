import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axiosBase from 'axios';
import * as XLSX from 'xlsx';
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
  { id: 'actuator', label: '표준 구동기 상태 (KS X 3267)', icon: '📐' },
];
const PERIODS = [{ d: 1, label: '1일' }, { d: 7, label: '7일' }, { d: 30, label: '30일' }, { d: 0, label: '직접 입력' }];
const PAGE = 200;

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
  const [page, setPage] = useState(1);
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
      setItems((house?.sensors || []).map(s => ({ id: s.sensorId, label: `${s.name || s.sensorId} (${s.unit || ''})` })));
    } else if (kind === 'control') {
      setItems((house?.devices || []).map(d => ({ id: d.deviceId, label: d.name || d.deviceId })));
    } else {
      let alive = true;
      axios.get(`${api}/actuator-status/${farmId}/devices`, { params: { startDate: range.start.toISOString(), endDate: range.end.toISOString() }, timeout: 10000 })
        .then(r => { if (!alive) return; setItems((r.data?.data || []).filter(d => !houseId || d.house_id === houseId)
          .map(d => ({ id: d.device_id, label: `${d.device_id} · U${d.unit} ${d.kind}${d.n} (${d.rows}행)` }))); })
        .catch(e => { if (alive) setError('표준 구동기 목록 조회 실패: ' + (e.response?.data?.error || e.message)); });
      return () => { alive = false; };
    }
  }, [kind, house, houseId, api, farmId, range.start.getTime(), range.end.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const query = useCallback(async () => {
    setLoading(true); setError(''); setRows([]); setPage(1);
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

  const pageRows = rows.slice((page - 1) * PAGE, page * PAGE);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE));

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
            <label className="text-xs text-gray-500 mb-1 block">하우스</label>
            <select value={houseId} onChange={e => setHouseId(e.target.value)} className="input-field text-sm">
              {kind === 'actuator' && <option value="">전체</option>}
              {houses.map(h => <option key={h.houseId} value={h.houseId}>{h.name || h.houseId}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">조회기간</label>
            <div className="flex gap-1">
              {PERIODS.map(p => (
                <button key={p.d} onClick={() => setPeriod(p.d)}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-bold border ${period === p.d ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200'}`}>{p.label}</button>
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
          <label className="text-xs text-gray-500 mb-1 block">항목 (선택 없음 = 전체)</label>
          <div className="flex flex-wrap gap-1.5">
            {items.length === 0 && <span className="text-xs text-gray-400">항목 없음</span>}
            {items.map(it => (
              <button key={it.id} onClick={() => toggle(it.id)}
                className={`px-2 py-1 rounded-md text-xs font-semibold border ${selected.includes(it.id) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200'}`}>{it.label}</button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button onClick={query} disabled={loading || (kind !== 'actuator' && !houseId)} className="btn-primary text-sm">{loading ? '조회 중…' : '🔍 조회 (1분 단위)'}</button>
          <span className="text-xs text-gray-400">추출:</span>
          {['csv', 'txt'].map(f => (
            <button key={f} onClick={() => exportServer(f)} disabled={!!exporting || (kind !== 'actuator' && !houseId)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50">
              {exporting === f ? '생성 중…' : `.${f}`}
            </button>
          ))}
          <button onClick={exportXlsx} disabled={rows.length === 0}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50">.xlsx (조회 결과)</button>
          {elapsed !== null && <span className="text-xs text-gray-500 ml-auto">{rows.length.toLocaleString()}행 · {(elapsed / 1000).toFixed(1)}초 {elapsed < 180000 ? '✅ 3분 이내' : '⚠ 3분 초과'}</span>}
        </div>
        {error && <p className="text-xs text-rose-600 font-semibold">{error}</p>}
      </div>

      {rows.length > 0 && (
        <div className="card p-3">
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead><tr className="text-gray-500 text-left border-b border-gray-200">{columns.map(c => <th key={c} className="py-1 pr-3 whitespace-nowrap">{c}</th>)}</tr></thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    {columns.map(c => <td key={c} className="py-0.5 pr-3 whitespace-nowrap">{r[c] === null || r[c] === undefined ? '' : String(r[c])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
            <span>{(page - 1) * PAGE + 1}–{Math.min(page * PAGE, rows.length)} / {rows.length.toLocaleString()}</span>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40">◀</button>
              <span className="px-2 py-1">{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-2 py-1 rounded border border-gray-200 disabled:opacity-40">▶</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
