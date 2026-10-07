import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axiosBase from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getApiBase } from '../../services/apiSwitcher';

// ━━━ 데이터 시각화 (KOAT 검정기준 116 — 2항목 이상, **1시간 이하 단위**, 1·7·30일) ━━━
// 조회·추출 탭과 **같은 구조**로 둔다(하우스 → 기간 → 항목 카드 → 실행 → 센서별 탭).
// 다른 점은 둘뿐이다: 「집계 단위」를 1분~1시간에서 고르고, 결과가 표가 아니라 그래프다.
// 축을 센서마다 따로 둔다 — CO2(900)와 pH(6)를 한 축에 두면 둘 다 안 보인다.

const axios = axiosBase.create();
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const KS_ICON = {
  1: '🌡️', 2: '💧', 3: '🌫️', 4: '🌦️', 5: '🚰', 6: '☔', 7: '☀️', 8: '🌬️', 9: '🧭',
  10: '🔌', 11: '💨', 12: '⚡', 13: '🔆', 14: '🪴', 15: '📉', 16: '⚗️', 17: '🌱', 18: '⚖️',
};
// 조회·추출 탭과 **같은 종류**를 다룬다 (2026-10-07). 예전엔 표준 센서만 그려,
// 비표준 센서만 있는 하우스에서는 "기록된 표준 센서가 없습니다" 만 나왔다.
// 종류마다 집계가 다르다 — 관측치는 평균, 상태코드는 평균이 뜻이 없어 '그 칸의 마지막 값',
// 제어 이력은 값이 아니라 '그 칸의 건수'.
const KINDS = [
  { id: 'sensor', label: '센서 관측치', icon: '🌡️', agg: 'avg' },
  { id: 'sensorstatus', label: '표준 센서 관측치 (KS X 3267)', icon: '📐', agg: 'avg' },
  { id: 'actuator', label: '구동기 상태 1분 (표준·비표준)', icon: '📐', agg: 'last' },
  { id: 'control', label: '구동기 제어 이력', icon: '🎛️', agg: 'count' },
];
const NO_HOUSE_KINDS = ['actuator', 'sensorstatus'];
const PERIODS = [{ d: 1, label: '1일' }, { d: 7, label: '7일' }, { d: 30, label: '30일' }, { d: 0, label: '직접 입력' }];
// 116 은 "1시간 이하 단위" — 기본 1시간, 더 잘게도 고를 수 있다
const UNITS = [
  { m: 1, label: '1분' }, { m: 5, label: '5분' }, { m: 10, label: '10분' },
  { m: 15, label: '15분' }, { m: 30, label: '30분' }, { m: 60, label: '1시간' },
];
const COLORS = ['#4f46e5', '#059669', '#dc2626', '#d97706', '#0891b2', '#7c3aed'];

const toLocalInput = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function DataVisualizer({ farmId }) {
  const api = getApiBase();
  const [kind, setKind] = useState('sensor');
  const [houses, setHouses] = useState([]);
  const [houseId, setHouseId] = useState('');
  const [period, setPeriod] = useState(1);
  const [customStart, setCustomStart] = useState(() => toLocalInput(new Date(Date.now() - 86400000)));
  const [customEnd, setCustomEnd] = useState(() => toLocalInput(new Date()));
  const [unitMin, setUnitMin] = useState(60);
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(null);
  const [activeKey, setActiveKey] = useState(null);

  const range = useMemo(() => {
    if (period > 0) { const end = new Date(); return { start: new Date(end.getTime() - period * 86400000), end }; }
    return { start: new Date(customStart), end: new Date(customEnd) };
  }, [period, customStart, customEnd]);

  useEffect(() => {
    // 응답은 { success, data: [하우스...] } — data.houses 가 아니다 (조회·추출 탭과 같은 처리, 2026-10-06)
    axios.get(`${api}/config/farm/${farmId}`, { timeout: 8000 })
      .then(r => {
        const hs = r.data?.success ? (r.data.data || []) : [];
        setHouses(hs);
        setHouseId(prev => prev || hs[0]?.houseId || '');
      })
      .catch(e => setError('하우스 목록 조회 실패: ' + (e.response?.data?.error || e.message)));
  }, [api, farmId]);

  // 항목 목록 — 종류별로. 조회·추출 탭과 같은 출처를 쓴다 (2026-10-07)
  const house = houses.find(h => h.houseId === houseId);
  useEffect(() => {
    setRows([]); setElapsed(null); setError(''); setSelected([]);
    if (kind === 'sensor') {
      setItems((house?.sensors || []).map(s => ({
        id: s.sensorId, icon: s.icon || '📈', title: s.name || s.sensorId,
        sub: `${s.sensorId}${s.unit ? ' · ' + s.unit : ''}`,
      })));
      return undefined;
    }
    if (kind === 'control') {
      setItems((house?.devices || []).map(d => ({
        id: d.deviceId, icon: d.icon || '🎛️', title: d.name || d.deviceId, sub: d.deviceId,
      })));
      return undefined;
    }
    let alive = true;
    const p = { startDate: range.start.toISOString(), endDate: range.end.toISOString() };
    if (kind === 'sensorstatus') {
      axios.get(`${api}/sensor-status/${farmId}/sensors`, { params: { ...p, houseId: houseId || undefined }, timeout: 15000 })
        .then(r => { if (!alive) return; setItems((r.data?.data || [])
          .filter(x => !houseId || x.house_id === houseId)
          .map(x => ({ id: `${x.unit}:${x.idx}`, icon: KS_ICON[x.code] || '📈',
                       title: x.name || `센서 ${x.idx}`,
                       sub: `노드 ${x.unit} · ${x.idx}번 자리${x.sensor_id ? ' · ' + x.sensor_id : ''}`, rows: x.rows }))); })
        .catch(e => { if (alive) setError('표준 센서 목록 조회 실패: ' + (e.response?.data?.error || e.message)); });
    } else {
      axios.get(`${api}/actuator-status/${farmId}/devices`, { params: p, timeout: 15000 })
        .then(r => { if (!alive) return; setItems((r.data?.data || []).filter(d => !houseId || d.house_id === houseId)
          .map(d => ({ id: d.device_id, icon: d.kind === 'opener' ? '🪟' : '🔌',
                       title: d.name || d.device_id,
                       sub: `${d.source === 'vendor' ? '비표준' : '표준'} · 노드 ${d.unit} · ${d.kind === 'opener' ? '개폐기' : '스위치'} ${d.n}`, rows: d.rows }))); })
        .catch(e => { if (alive) setError('구동기 목록 조회 실패: ' + (e.response?.data?.error || e.message)); });
    }
    return () => { alive = false; };
  }, [kind, house, houseId, api, farmId, range.start.getTime(), range.end.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps

  // 116 「2항목 이상」 — 목록이 바뀌면 앞의 둘을 기본 선택
  useEffect(() => { setSelected(prev => prev.length ? prev : items.slice(0, 2).map(i => i.id)); }, [items]);

  const toggle = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const run = useCallback(async () => {
    if (selected.length === 0) { setError('항목을 하나 이상 고르세요'); return; }
    setLoading(true); setError(''); setRows([]);
    const t0 = performance.now();
    const params = { startDate: range.start.toISOString(), endDate: range.end.toISOString() };
    try {
      if (kind === 'sensor') {
        // 센서 관측치 — 한 행에 센서가 열로 들어온다. 센서별 계열로 펴서 쓴다.
        const r = await axios.get(`${api}/sensors/${farmId}/${houseId}/export`,
          { params: { ...params, format: 'json', sensorIds: selected.join(',') || undefined }, timeout: 180000 });
        const flat = [];
        for (const row of (r.data?.data || [])) {
          for (const id of selected) {
            const v = row[id];
            if (v !== undefined && v !== null && v !== '') flat.push({ key: id, timestamp: row.timestamp, value: v });
          }
        }
        setRows(flat);
      } else if (kind === 'sensorstatus') {
        const units = [...new Set(selected.map(x => x.split(':')[0]))];
        const p = { ...params, houseId: houseId || undefined };
        if (units.length === 1) { p.unit = units[0]; p.idx = selected.map(x => x.split(':')[1]).join(','); }
        const r = await axios.get(`${api}/sensor-status/${farmId}`, { params: p, timeout: 180000 });
        setRows((r.data?.data || [])
          .filter(x => !selected.length || selected.includes(`${x.unit}:${x.idx}`))
          .map(x => ({ key: `${x.unit}:${x.idx}`, timestamp: x.timestamp, value: x.value, name: x.name })));
      } else if (kind === 'actuator') {
        const r = await axios.get(`${api}/actuator-status/${farmId}`,
          { params: { ...params, houseId: houseId || undefined, deviceId: selected.join(',') || undefined }, timeout: 180000 });
        // 상태코드는 평균이 뜻이 없다 — 그 칸의 **마지막 값**을 쓰고 계단으로 그린다
        setRows((r.data?.data || []).filter(x => !selected.length || selected.includes(x.device_id))
          .map(x => ({ key: x.device_id, timestamp: x.timestamp, value: x.status, name: x.name || x.device_id })));
      } else {
        // 제어 이력 — 값이 아니라 **건수**를 센다 (그 칸에 몇 번 제어했나)
        const all = [];
        for (let pg = 1; pg <= 50; pg++) {
          const r = await axios.get(`${api}/control-logs/${farmId}`,
            { params: { ...params, houseId, deviceId: selected.length === 1 ? selected[0] : undefined, limit: 200, page: pg }, timeout: 60000 });
          const d = r.data?.data || []; all.push(...d);
          if (d.length < 200 || pg >= (r.data?.pagination?.totalPages || 1)) break;
        }
        setRows(all.filter(l => !selected.length || selected.includes(l.deviceId))
          .map(l => ({ key: l.deviceId, timestamp: l.timestamp || l.createdAt, value: 1, name: l.deviceName || l.deviceId })));
      }
      setElapsed(Math.round(performance.now() - t0));
    } catch (e) {
      setError('시각화 실패: ' + (e.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
  }, [api, farmId, houseId, range, selected, kind]);

  const aggOf = KINDS.find(k => k.id === kind)?.agg || 'avg';

  // 고른 단위(분)로 묶는다 — 집계 방식은 종류를 따른다
  const series = useMemo(() => {
    if (rows.length === 0) return [];
    const bucketMs = unitMin * 60000;
    const byKey = new Map();
    for (const r of rows) {
      const t = new Date(r.timestamp).getTime();
      const v = Number(r.value);
      if (Number.isNaN(t) || !Number.isFinite(v)) continue;
      const b = Math.floor(t / bucketMs) * bucketMs;
      if (!byKey.has(r.key)) {
        const meta = items.find(i => i.id === r.key) || {};
        byKey.set(r.key, { key: r.key, title: meta.title || r.name || r.key, sub: meta.sub || '', icon: meta.icon || '📈', buckets: new Map() });
      }
      const m = byKey.get(r.key).buckets;
      const cur = m.get(b) || { sum: 0, n: 0, min: v, max: v, last: v, lastT: t };
      cur.sum += v; cur.n += 1; cur.min = Math.min(cur.min, v); cur.max = Math.max(cur.max, v);
      if (t >= cur.lastT) { cur.last = v; cur.lastT = t; }
      m.set(b, cur);
    }
    const round2 = (x) => Math.round(x * 100) / 100;
    return [...byKey.values()].map(sObj => {
      const data = [...sObj.buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, c]) => ({
        t,
        v: aggOf === 'count' ? c.n : aggOf === 'last' ? c.last : round2(c.sum / c.n),
        min: aggOf === 'count' ? c.n : c.min,
        max: aggOf === 'count' ? c.n : c.max,
      }));
      const vals = data.map(d => d.v);
      return { ...sObj, data, stat: vals.length
        ? { min: Math.min(...data.map(d => d.min)), max: Math.max(...data.map(d => d.max)),
            avg: round2(vals.reduce((a, b) => a + b, 0) / vals.length) }
        : null };
    });
  }, [rows, unitMin, items, aggOf]);

  const active = series.find(s => s.key === activeKey) || series[0] || null;
  useEffect(() => { setActiveKey(series[0]?.key ?? null); }, [series]);

  const unitLabel = UNITS.find(u => u.m === unitMin)?.label || `${unitMin}분`;   // 임의값이면 "7분" 처럼 그대로
  const fmtTick = (t) => {
    const d = new Date(t); const p = (n) => String(n).padStart(2, '0');
    return period === 1 ? `${p(d.getHours())}:${p(d.getMinutes())}` : `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}시`;
  };

  return (
    <div className="space-y-4 animate-fade-in-up">
      <div className="card p-4 space-y-3">
        {/* 종류 — 조회·추출 탭과 같은 4가지 (2026-10-07) */}
        <div>
          <label className="text-sm font-bold text-gray-700 mb-1 block">종류</label>
          <div className="flex flex-wrap gap-1.5">
            {KINDS.map(k => (
              <button key={k.id} onClick={() => setKind(k.id)}
                className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-all
                  ${kind === k.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:bg-blue-50'}`}>
                {k.icon} {k.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            {kind === 'control' ? '집계 단위마다 제어 횟수를 셉니다 (관측치가 아닙니다).'
              : kind === 'actuator' ? '상태코드는 평균이 뜻이 없어 그 칸의 마지막 값을 씁니다.'
              : '집계 단위마다 최저·평균·최고를 구합니다.'}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-sm font-bold text-gray-700 mb-1 block">
              하우스 {NO_HOUSE_KINDS.includes(kind) && <span className="text-xs font-normal text-gray-400">· 비워 두면 전체</span>}
            </label>
            <select value={houseId} onChange={e => setHouseId(e.target.value)} className="input-field text-sm">
              {NO_HOUSE_KINDS.includes(kind) && <option value="">전체 하우스</option>}
              {houses.map(h => <option key={h.houseId} value={h.houseId}>{h.name || h.houseId}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-bold text-gray-700 mb-1 block">조회기간</label>
            <div className="flex gap-1">
              {PERIODS.map(p => (
                <button key={p.d} onClick={() => setPeriod(p.d)}
                  className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-colors ${period === p.d ? 'bg-blue-600 border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                  <span style={period === p.d ? { color: '#fff' } : undefined}>{p.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm font-bold text-gray-700 mb-1 block">
              집계 단위 <span className="text-xs font-normal text-gray-400">· 1~60분 (검정기준 1시간 이하)</span>
            </label>
            <div className="flex gap-1 mb-1">
              {UNITS.map(u => (
                <button key={u.m} onClick={() => setUnitMin(u.m)}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors ${unitMin === u.m ? 'bg-indigo-600 border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                  <span style={unitMin === u.m ? { color: '#fff' } : undefined}>{u.label}</span>
                </button>
              ))}
            </div>
            {/* 고정값 말고 1분 단위로 아무 값이나 — 116 은 "1시간 이하" 라 상한만 60분 (2026-10-06) */}
            <div className="flex items-center gap-2">
              <input type="number" min={1} max={60} step={1} value={unitMin}
                onChange={e => {
                  const v = parseInt(e.target.value, 10);
                  if (Number.isFinite(v)) setUnitMin(Math.max(1, Math.min(60, v)));
                }}
                className="input-field text-sm w-24 text-center" />
              <span className="text-xs text-gray-500">분 (1~60)</span>
              {!UNITS.some(u => u.m === unitMin) && (
                <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-2 py-0.5">
                  {unitMin}분 단위
                </span>
              )}
            </div>
          </div>
          {period === 0 && (
            <div className="flex gap-2 md:col-span-3">
              <div className="flex-1"><label className="text-xs text-gray-500 mb-1 block">시작</label>
                <input type="datetime-local" value={customStart} onChange={e => setCustomStart(e.target.value)} className="input-field text-sm" /></div>
              <div className="flex-1"><label className="text-xs text-gray-500 mb-1 block">끝</label>
                <input type="datetime-local" value={customEnd} onChange={e => setCustomEnd(e.target.value)} className="input-field text-sm" /></div>
            </div>
          )}
        </div>

        {/* 조회 항목 — 조회·추출 탭과 같은 카드 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-bold text-gray-700">
              조회 항목
              <span className="ml-2 text-xs font-normal text-gray-400">
                {selected.length > 0 ? `${selected.length}개 선택` : `전체 ${items.length}개`} · 검정기준 2항목 이상
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
            <p className="text-sm text-gray-400 py-3">
              {kind === 'sensor' ? '이 하우스에 등록된 센서가 없습니다.'
                : kind === 'control' ? '이 하우스에 등록된 제어 장치가 없습니다.'
                : kind === 'sensorstatus' ? '이 기간에 기록된 표준 센서가 없습니다.'
                : '이 기간에 기록된 구동기가 없습니다.'}
            </p>
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
                        {it.rows !== undefined && <div className="text-[11px] text-gray-400 mt-0.5">{Number(it.rows).toLocaleString()}행</div>}
                      </div>
                      {on && <span className="text-indigo-600 text-sm font-bold">✓</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
          <button onClick={run} disabled={loading || !houseId}
            className="px-5 py-2.5 rounded-xl text-sm font-bold bg-blue-600 shadow-sm hover:bg-blue-700 disabled:opacity-40">
            <span style={{ color: '#fff' }}>{loading ? '그리는 중…' : '📊 시각화'}</span>
          </button>
          <span className="text-xs text-gray-500">{unitLabel} 평균으로 그립니다</span>
          {elapsed !== null && (
            <span className="ml-auto text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
              {rows.length.toLocaleString()}행 · {(elapsed / 1000).toFixed(1)}초
            </span>
          )}
        </div>
        {error && <p className="text-xs text-rose-600 font-semibold">{error}</p>}
      </div>

      {/* 결과 — 조회·추출 탭과 같은 탭 구조 */}
      {series.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <div className="flex gap-1 overflow-x-auto px-3 pt-3 pb-0 border-b border-gray-200">
            {series.map(s => {
              const on = s.key === activeKey;
              return (
                <button key={s.key} onClick={() => setActiveKey(s.key)}
                  className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-sm font-bold border-b-2 transition-colors ${on
                    ? 'border-blue-600 text-blue-700 bg-blue-50/60'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
                  <span className="text-base">{s.icon}</span>
                  <span className="whitespace-nowrap">{s.title}</span>
                  <span className={`text-[11px] font-normal ${on ? 'text-blue-500' : 'text-gray-400'}`}>{s.data.length.toLocaleString()}</span>
                </button>
              );
            })}
          </div>

          {active && (
            <div className="p-4">
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xl">{active.icon}</span>
                  <div className="min-w-0">
                    <p className="text-base font-bold text-gray-900 truncate">{active.title}</p>
                    <p className="text-xs text-gray-500 truncate">{active.sub} · {unitLabel} 평균 {active.data.length.toLocaleString()}점</p>
                  </div>
                </div>
                {active.stat && (
                  <div className="flex gap-2 text-xs">
                    <span className="px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200">최저 <b className="text-gray-900">{active.stat.min}</b></span>
                    <span className="px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200">평균 <b className="text-gray-900">{active.stat.avg}</b></span>
                    <span className="px-2.5 py-1 rounded-lg bg-gray-50 border border-gray-200">최고 <b className="text-gray-900">{active.stat.max}</b></span>
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-gray-200 p-2" style={{ width: '100%', height: 320 }}>
                <ResponsiveContainer>
                  <LineChart data={active.data} margin={{ top: 8, right: 14, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis dataKey="t" tickFormatter={fmtTick} tick={{ fontSize: 11, fill: '#94a3b8' }} minTickGap={40} />
                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} width={56} domain={['auto', 'auto']} />
                    <Tooltip labelFormatter={(t) => new Date(t).toLocaleString('ko-KR', { hour12: false })}
                      formatter={(v, _n, p) => [`${v}  (최저 ${p.payload.min} · 최고 ${p.payload.max})`, active.title]}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                    {/* isAnimationActive=false — 키오스크 CPU·발열 (SensorChart 와 같은 규칙) */}
                    <Line type={aggOf === 'last' ? 'stepAfter' : 'monotone'} dataKey="v" name={active.title} stroke={COLORS[series.indexOf(active) % COLORS.length]}
                          strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
