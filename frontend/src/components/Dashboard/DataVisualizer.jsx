import React, { useState, useEffect, useMemo, useCallback } from 'react';
import axiosBase from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { getApiBase } from '../../services/apiSwitcher';

// ━━━ 데이터 시각화 (KOAT 검정기준 116 「통합제어기」 — 2항목 이상, **1시간 이하 단위**, 1·7·30일) ━━━
// 조회·추출 탭이 1분 행을 보여 준다면 여기는 그림이다. 집계 단위를 1분~1시간에서 고르게 해
// "1시간 이하 단위" 를 화면에서 바로 증명한다. 센서마다 한 칸씩 그려 축이 섞이지 않게 한다
// (CO2 900 과 pH 6 을 한 축에 두면 둘 다 안 보인다).

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
const PERIODS = [{ d: 1, label: '1일' }, { d: 7, label: '7일' }, { d: 30, label: '30일' }];
// 116 은 "1시간 이하 단위" — 기본 1시간, 더 잘게도 고를 수 있다
const UNITS = [
  { m: 1, label: '1분' }, { m: 5, label: '5분' }, { m: 10, label: '10분' },
  { m: 30, label: '30분' }, { m: 60, label: '1시간' },
];
const COLORS = ['#4f46e5', '#059669', '#dc2626', '#d97706', '#0891b2', '#7c3aed'];

export default function DataVisualizer({ farmId }) {
  const api = getApiBase();
  const [houses, setHouses] = useState([]);
  const [houseId, setHouseId] = useState('');
  const [period, setPeriod] = useState(1);
  const [unitMin, setUnitMin] = useState(60);
  const [sensors, setSensors] = useState([]);     // [{id, idx, unit, title, icon}]
  const [selected, setSelected] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [elapsed, setElapsed] = useState(null);

  const range = useMemo(() => {
    const end = new Date();
    return { start: new Date(end.getTime() - period * 86400000), end };
  }, [period]);

  useEffect(() => {
    axios.get(`${api}/config/farm/${farmId}`, { timeout: 8000 })
      .then(r => {
        const hs = r.data?.data?.houses || [];
        setHouses(hs);
        setHouseId(prev => prev || hs[0]?.houseId || '');
      })
      .catch(() => {});
  }, [api, farmId]);

  // 기간 안에 기록된 표준 센서 목록
  useEffect(() => {
    if (!houseId) return undefined;
    let alive = true;
    axios.get(`${api}/sensor-status/${farmId}/sensors`, {
      params: { startDate: range.start.toISOString(), endDate: range.end.toISOString(), houseId },
      timeout: 15000,
    })
      .then(r => {
        if (!alive) return;
        const list = (r.data?.data || []).map(s => ({
          id: `${s.unit}:${s.idx}`, unit: s.unit, idx: s.idx,
          title: s.name || `센서 ${s.idx}`, icon: KS_ICON[s.code] || '📈',
        }));
        setSensors(list);
        setSelected(prev => {
          const keep = prev.filter(p => list.some(l => l.id === p));
          return keep.length ? keep : list.slice(0, 2).map(l => l.id);   // 116: 2항목 이상
        });
      })
      .catch(e => { if (alive) setError('센서 목록 조회 실패: ' + (e.response?.data?.error || e.message)); });
    return () => { alive = false; };
  }, [api, farmId, houseId, range]);

  const draw = useCallback(async () => {
    if (selected.length === 0) { setError('센서를 하나 이상 고르세요'); return; }
    setLoading(true); setError(''); setRows([]);
    const t0 = performance.now();
    try {
      const units = [...new Set(selected.map(s => s.split(':')[0]))];
      const params = { startDate: range.start.toISOString(), endDate: range.end.toISOString(), houseId };
      if (units.length === 1) { params.unit = units[0]; params.idx = selected.map(s => s.split(':')[1]).join(','); }
      const r = await axios.get(`${api}/sensor-status/${farmId}`, { params, timeout: 180000 });
      setRows(r.data?.data || []);
      setElapsed(Math.round(performance.now() - t0));
    } catch (e) {
      setError('조회 실패: ' + (e.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
  }, [api, farmId, houseId, range, selected]);

  // 센서별로 집계 — 고른 단위(분)로 평균. 한 축에 섞지 않고 칸을 나눈다.
  const series = useMemo(() => {
    if (rows.length === 0) return [];
    const bucketMs = unitMin * 60000;
    const byKey = new Map();
    for (const r of rows) {
      const key = `${r.unit}:${r.idx}`;
      if (selected.length && !selected.includes(key)) continue;
      const t = new Date(r.timestamp).getTime();
      if (Number.isNaN(t)) continue;
      const v = Number(r.value);
      if (!Number.isFinite(v)) continue;
      const b = Math.floor(t / bucketMs) * bucketMs;
      if (!byKey.has(key)) byKey.set(key, { key, title: r.name || key, icon: KS_ICON[r.code] || '📈', buckets: new Map() });
      const m = byKey.get(key).buckets;
      const cur = m.get(b) || { sum: 0, n: 0, min: v, max: v };
      cur.sum += v; cur.n += 1; cur.min = Math.min(cur.min, v); cur.max = Math.max(cur.max, v);
      m.set(b, cur);
    }
    return [...byKey.values()].map(s => ({
      ...s,
      data: [...s.buckets.entries()].sort((a, b) => a[0] - b[0])
        .map(([t, c]) => ({ t, v: Math.round((c.sum / c.n) * 100) / 100, min: c.min, max: c.max })),
    }));
  }, [rows, unitMin, selected]);

  const fmtTime = (t) => {
    const d = new Date(t); const p = (n) => String(n).padStart(2, '0');
    return period === 1 ? `${p(d.getHours())}:${p(d.getMinutes())}` : `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}시`;
  };
  const toggle = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

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
              표시 단위 <span className="text-xs font-normal text-gray-400">· 검정기준 1시간 이하</span>
            </label>
            <div className="flex gap-1">
              {UNITS.map(u => (
                <button key={u.m} onClick={() => setUnitMin(u.m)}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors ${unitMin === u.m ? 'bg-indigo-600 border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                  <span style={unitMin === u.m ? { color: '#fff' } : undefined}>{u.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-bold text-gray-700">
              센서 <span className="ml-2 text-xs font-normal text-gray-400">{selected.length}개 선택 · 2개 이상 권장</span>
            </label>
            {sensors.length > 0 && (
              <div className="flex gap-1">
                <button onClick={() => setSelected(sensors.map(s => s.id))}
                  className="text-xs font-semibold text-gray-600 border border-gray-200 rounded-md px-2.5 py-1 hover:bg-gray-50">전체 선택</button>
                <button onClick={() => setSelected([])}
                  className="text-xs font-semibold text-gray-600 border border-gray-200 rounded-md px-2.5 py-1 hover:bg-gray-50">선택 해제</button>
              </div>
            )}
          </div>
          {sensors.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">이 기간에 기록된 표준 센서가 없습니다.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {sensors.map(s => {
                const on = selected.includes(s.id);
                return (
                  <button key={s.id} onClick={() => toggle(s.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold border-2 transition-all ${on
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-900'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}>
                    <span>{s.icon}</span>{s.title}{on && <span className="text-indigo-600">✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-100">
          <button onClick={draw} disabled={loading || !houseId}
            className="px-5 py-2.5 rounded-xl text-sm font-bold bg-blue-600 shadow-sm hover:bg-blue-700 disabled:opacity-40">
            <span style={{ color: '#fff' }}>{loading ? '그리는 중…' : '📊 그래프 그리기'}</span>
          </button>
          {elapsed !== null && (
            <span className="ml-auto text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
              {rows.length.toLocaleString()}행 · {(elapsed / 1000).toFixed(1)}초
            </span>
          )}
        </div>
        {error && <p className="text-xs text-rose-600 font-semibold">{error}</p>}
      </div>

      {series.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {series.map((s, i) => (
            <div key={s.key} className="card p-4">
              <div className="flex items-baseline justify-between mb-2">
                <p className="text-base font-bold text-gray-900">{s.icon} {s.title}</p>
                <p className="text-xs text-gray-500">
                  {UNITS.find(u => u.m === unitMin)?.label} 평균 · {s.data.length.toLocaleString()}점
                </p>
              </div>
              <div style={{ width: '100%', height: 220 }}>
                <ResponsiveContainer>
                  <LineChart data={s.data} margin={{ top: 5, right: 12, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis dataKey="t" tickFormatter={fmtTime} tick={{ fontSize: 11, fill: '#94a3b8' }} minTickGap={40} />
                    <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} width={52} domain={['auto', 'auto']} />
                    <Tooltip labelFormatter={(t) => new Date(t).toLocaleString('ko-KR', { hour12: false })}
                      formatter={(v, _n, p) => [`${v}  (최저 ${p.payload.min} · 최고 ${p.payload.max})`, s.title]}
                      contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                    {/* isAnimationActive=false — 키오스크 CPU·발열 (SensorChart 와 같은 규칙) */}
                    <Line type="monotone" dataKey="v" name={s.title} stroke={COLORS[i % COLORS.length]}
                          strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
