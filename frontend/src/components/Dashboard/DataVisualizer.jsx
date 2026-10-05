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

  // 기간 안에 기록된 표준 센서 — 조회·추출 탭의 「조회 항목」과 같은 카드
  useEffect(() => {
    if (!houseId) return undefined;
    let alive = true;
    setRows([]); setElapsed(null); setError('');
    axios.get(`${api}/sensor-status/${farmId}/sensors`, {
      params: { startDate: range.start.toISOString(), endDate: range.end.toISOString(), houseId },
      timeout: 15000,
    })
      .then(r => {
        if (!alive) return;
        const list = (r.data?.data || []).map(s => ({
          id: `${s.unit}:${s.idx}`, icon: KS_ICON[s.code] || '📈',
          title: s.name || `센서 ${s.idx}`,
          sub: `노드 ${s.unit} · ${s.idx}번 자리${s.sensor_id ? ' · ' + s.sensor_id : ''}`,
          rows: s.rows,
        }));
        setItems(list);
        setSelected(prev => {
          const keep = prev.filter(p => list.some(l => l.id === p));
          return keep.length ? keep : list.slice(0, 2).map(l => l.id);   // 116 「2항목 이상」
        });
      })
      .catch(e => { if (alive) setError('센서 목록 조회 실패: ' + (e.response?.data?.error || e.message)); });
    return () => { alive = false; };
  }, [api, farmId, houseId, range]);

  const toggle = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const run = useCallback(async () => {
    if (selected.length === 0) { setError('센서를 하나 이상 고르세요'); return; }
    setLoading(true); setError(''); setRows([]);
    const t0 = performance.now();
    try {
      const params = { startDate: range.start.toISOString(), endDate: range.end.toISOString(), houseId };
      const units = [...new Set(selected.map(s => s.split(':')[0]))];
      if (units.length === 1) { params.unit = units[0]; params.idx = selected.map(s => s.split(':')[1]).join(','); }
      const r = await axios.get(`${api}/sensor-status/${farmId}`, { params, timeout: 180000 });
      setRows(r.data?.data || []);
      setElapsed(Math.round(performance.now() - t0));
    } catch (e) {
      setError('시각화 실패: ' + (e.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
  }, [api, farmId, houseId, range, selected]);

  // 고른 단위(분)로 평균 — 센서마다 따로
  const series = useMemo(() => {
    if (rows.length === 0) return [];
    const bucketMs = unitMin * 60000;
    const byKey = new Map();
    for (const r of rows) {
      const key = `${r.unit}:${r.idx}`;
      if (selected.length && !selected.includes(key)) continue;
      const t = new Date(r.timestamp).getTime();
      const v = Number(r.value);
      if (Number.isNaN(t) || !Number.isFinite(v)) continue;
      const b = Math.floor(t / bucketMs) * bucketMs;
      if (!byKey.has(key)) {
        const meta = items.find(i => i.id === key) || {};
        byKey.set(key, { key, title: meta.title || r.name || key, sub: meta.sub || '', icon: meta.icon || '📈', buckets: new Map() });
      }
      const m = byKey.get(key).buckets;
      const cur = m.get(b) || { sum: 0, n: 0, min: v, max: v };
      cur.sum += v; cur.n += 1; cur.min = Math.min(cur.min, v); cur.max = Math.max(cur.max, v);
      m.set(b, cur);
    }
    return [...byKey.values()].map(s => {
      const data = [...s.buckets.entries()].sort((a, b) => a[0] - b[0])
        .map(([t, c]) => ({ t, v: Math.round((c.sum / c.n) * 100) / 100, min: c.min, max: c.max }));
      const vals = data.map(d => d.v);
      return { ...s, data, stat: vals.length
        ? { min: Math.min(...data.map(d => d.min)), max: Math.max(...data.map(d => d.max)),
            avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 }
        : null };
    });
  }, [rows, unitMin, selected, items]);

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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="text-sm font-bold text-gray-700 mb-1 block">하우스</label>
            <select value={houseId} onChange={e => setHouseId(e.target.value)} className="input-field text-sm">
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
            <p className="text-sm text-gray-400 py-3">이 기간에 기록된 표준 센서가 없습니다.</p>
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
                    <Line type="monotone" dataKey="v" name={active.title} stroke={COLORS[series.indexOf(active) % COLORS.length]}
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
