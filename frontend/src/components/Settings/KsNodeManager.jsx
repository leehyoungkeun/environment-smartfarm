import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axiosBase from 'axios';
import { getApiBase } from '../../services/apiSwitcher';
import { describeStatus, discoveryRows, nodeSummary, mappingIndex, mappingKey, frameRows } from '../../lib/ks3267';

// ━━━ KS X 3267 표준노드 탭 (P4, 2026-08-30) ━━━
// 읽기 전용 진단 UI. 백엔드 /config/:farmId/ks3267/:action → RPi NR → ks3267d 데몬(127.0.0.1:3002).
// 제어는 여기서 하지 않는다 — 정규 제어 경로(제어판 → execute_control → 표준 명령 조립)만.
// 매핑(우리 장치 ↔ 표준 디바이스)은 하우스/센서 탭의 장치·센서 설정에서 "프로토콜: KS X 3267" 로 지정한다.
// 이 탭은 탐색 결과와 현재 매핑을 나란히 보여 빠진 것·중복을 드러낸다.

const axios = axiosBase.create();
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const TONE = {
  ok: 'bg-gray-100 text-gray-700', on: 'bg-emerald-100 text-emerald-800', busy: 'bg-sky-100 text-sky-800',
  warn: 'bg-amber-100 text-amber-800', bad: 'bg-rose-100 text-rose-800', muted: 'bg-gray-100 text-gray-500',
};
const Pill = ({ tone = 'muted', children, title }) => (
  <span title={title} className={`inline-block px-1.5 py-0.5 rounded text-[11px] font-bold ${TONE[tone] || TONE.muted}`}>{children}</span>
);

export const KsNodeManager = ({ farmId }) => {
  const api = getApiBase();
  const ks = useCallback((action, params) =>
    axios.get(`${api}/config/${farmId}/ks3267/${action}`, { params, timeout: 12000 }).then(r => r.data), [api, farmId]);

  const [health, setHealth] = useState(null);      // { ok, transport, nodes, stats } | { success:false, error }
  const [nodes, setNodes] = useState({});          // unit → discovery node
  const [state, setState] = useState({});          // unit → poll state
  const [houses, setHouses] = useState([]);
  const [unitInput, setUnitInput] = useState('1');
  const [discovering, setDiscovering] = useState(false);
  const [scanFrom, setScanFrom] = useState('1');
  const [scanTo, setScanTo] = useState('16');
  const [scanTimeout, setScanTimeout] = useState('300');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const [message, setMessage] = useState(null);
  const [showDiag, setShowDiag] = useState(false);
  const [frames, setFrames] = useState({ frames: [], stats: null });
  const [events, setEvents] = useState([]);
  const [tick, setTick] = useState(0);

  const daemonUp = health?.ok === true;

  // 데몬·노드·상태·하우스 설정 로드 (10초 주기 — 데몬이 살아 있을 때만 상태 갱신)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const h = await ks('health');
        if (!alive) return;
        setHealth(h);
        if (h.ok) {
          const [n, s] = await Promise.all([ks('nodes'), ks('status')]);
          if (!alive) return;
          setNodes(n.nodes || {});
          setState(s.state || {});
          if (showDiag) {
            const [f, e] = await Promise.all([ks('frames', { n: 40 }), ks('events', { n: 30 })]);
            if (!alive) return;
            setFrames({ frames: f.frames || [], stats: f.stats || null });
            setEvents(e.events || []);
          }
        }
      } catch (e) {
        if (alive) setHealth({ ok: false, error: e.response?.data?.error || e.message });
      }
    })();
    return () => { alive = false; };
  }, [ks, tick, showDiag]);

  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let alive = true;
    axios.get(`${api}/config/farm/${farmId}`, { timeout: 5000 })
      .then(r => { if (alive && r.data?.success) setHouses(r.data.data || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, [api, farmId, tick]);

  const discover = async () => {
    const unit = parseInt(unitInput, 10);
    if (!(unit >= 1 && unit <= 247)) { setMessage({ type: 'err', text: '노드 주소는 1~247' }); return; }
    setDiscovering(true); setMessage(null);
    try {
      const r = await ks('discover', { unit });
      if (r.ok && r.node) {
        setNodes(prev => ({ ...prev, [unit]: r.node }));
        setMessage({ type: r.node.supported ? 'ok' : 'warn', text: r.node.supported
          ? `U${unit} 탐색 완료 — ${nodeSummary(r.node).kind}, 디바이스 ${r.node.devices.length}개`
          : `U${unit} 응답했지만 스코프 밖: ${(r.node.notes || []).join(' / ')}` });
      } else {
        setMessage({ type: 'err', text: `U${unit}: ${r.error || '탐색 실패'}` });
      }
    } catch (e) {
      setMessage({ type: 'err', text: '탐색 요청 실패: ' + (e.response?.data?.error || e.message) });
    } finally {
      setDiscovering(false);
      setTick(x => x + 1);
    }
  };

  const scan = async () => {
    const from = parseInt(scanFrom, 10), to = parseInt(scanTo, 10), timeout = parseInt(scanTimeout, 10);
    if (!(from >= 1 && from <= 247 && to >= 1 && to <= 247)) { setMessage({ type: 'err', text: '주소는 1~247' }); return; }
    const lo = Math.min(from, to), hi = Math.max(from, to);
    setScanning(true); setMessage(null); setScanResult(null);
    try {
      const r = await ks('scan', { from: lo, to: hi, timeout });
      const res = r.result || r;
      const foundArr = res.found || [];
      setScanResult(res);
      // 드라이버가 스캔 중 등록한 노드를 한 번에 가져와 카드(디바이스표) 채우기
      try { const n = await ks('nodes'); if (n.ok && n.nodes) setNodes(prev => ({ ...prev, ...n.nodes })); } catch { /* ignore */ }
      setMessage({ type: foundArr.length ? 'ok' : 'warn',
        text: `스캔 ${res.range?.[0]}~${res.range?.[1]} (${res.count}개 주소, ${res.timeout_ms}ms) — 발견 ${foundArr.length}개` });
    } catch (e) {
      setMessage({ type: 'err', text: '스캔 요청 실패: ' + (e.response?.data?.error || e.message) });
    } finally {
      setScanning(false);
      setTick(x => x + 1);
    }
  };

  const mapping = useMemo(() => mappingIndex(houses), [houses]);
  const unitList = Object.keys(nodes).map(Number).sort((a, b) => a - b);

  return (
    <div className="space-y-4 animate-fade-in-up">
      {/* 데몬 상태 */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-base font-bold text-gray-800">📐 KS X 3267 표준 노드</h3>
          {health === null ? <Pill>확인 중…</Pill>
            : daemonUp ? <Pill tone="on">드라이버 연결됨</Pill>
            : <Pill tone="bad" title={health?.error}>드라이버 없음</Pill>}
          {daemonUp && <span className="text-xs text-gray-500">포트 {health.transport} · 노드 {health.nodes?.length || 0}개 · 예외 {health.stats?.exceptions ?? 0} · 타임아웃 {health.stats?.timeouts ?? 0}</span>}
          <button onClick={() => setTick(x => x + 1)} className="ml-auto text-xs text-blue-600 hover:underline">새로고침</button>
        </div>
        {!daemonUp && health && (
          <p className="text-xs text-gray-500 mt-2">
            {health.error || 'ks3267d 데몬 응답 없음'} — 표준 노드용 RS485 포트(<code>/dev/smartfarm-485-std</code>)에 드라이버가 떠 있어야 합니다 (RPi <code>pm2 ks3267d</code>).
            기존 릴레이·센서(Waveshare/XY-MD02)와는 별도 포트라 운영에 영향 없습니다.
          </p>
        )}
        {mapping.duplicates.length > 0 && (
          <p className="text-xs text-rose-600 font-semibold mt-2">⚠ 같은 표준 디바이스에 둘 이상 매핑됨: {mapping.duplicates.join(', ')} — 하우스/센서 탭에서 정리하세요</p>
        )}
      </div>

      {/* 탐색 */}
      <div className="card p-4">
        <p className="text-sm font-bold text-gray-700 mb-2">노드 탐색</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-gray-500">노드 주소 (1~247)</label>
          <input type="number" min={1} max={247} value={unitInput} onChange={e => setUnitInput(e.target.value)}
            className="input-field text-sm w-24" disabled={!daemonUp} />
          <button onClick={discover} disabled={!daemonUp || discovering} className="btn-primary text-sm">
            {discovering ? '탐색 중…' : '🔍 탐색'}
          </button>
          <span className="text-[11px] text-gray-400">레지스터 1~8 (인증기관·회사코드·제품·프로토콜버전·채널수·시리얼) + 디바이스 코드 101~ 읽기</span>
        </div>
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-xs font-bold text-gray-600 mb-2">자동 스캔 (범위 probe)</p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-gray-500">시작</label>
            <input type="number" min={1} max={247} value={scanFrom} onChange={e => setScanFrom(e.target.value)}
              className="input-field text-sm w-16" disabled={!daemonUp} />
            <label className="text-xs text-gray-500">끝</label>
            <input type="number" min={1} max={247} value={scanTo} onChange={e => setScanTo(e.target.value)}
              className="input-field text-sm w-16" disabled={!daemonUp} />
            <label className="text-xs text-gray-500">타임아웃(ms)</label>
            <input type="number" min={50} max={2000} step={50} value={scanTimeout} onChange={e => setScanTimeout(e.target.value)}
              className="input-field text-sm w-20" disabled={!daemonUp} />
            <button onClick={scan} disabled={!daemonUp || scanning} className="btn-primary text-sm">
              {scanning ? '스캔 중…' : '📡 자동 스캔'}
            </button>
            <span className="text-[11px] text-gray-400">범위 넓거나 타임아웃 길면 느림 — 짧게(예 1~16, 300ms) 권장</span>
          </div>
          {scanResult && (
            <p className="text-[11px] text-gray-500 mt-1">
              {scanResult.range?.[0]}~{scanResult.range?.[1]} 훑음 · 발견 {scanResult.found?.length || 0}개
              {scanResult.found?.length ? ': ' + scanResult.found.map(f => `U${f.unit}(${f.kind === 'sensor' ? '센서' : f.kind === 'actuator' ? '구동기' : '?'})`).join(', ') : ''}
            </p>
          )}
        </div>
        {message && (
          <p className={`text-xs mt-2 font-semibold ${message.type === 'ok' ? 'text-emerald-700' : message.type === 'warn' ? 'text-amber-700' : 'text-rose-600'}`}>{message.text}</p>
        )}
      </div>

      {/* 노드 카드 */}
      {unitList.length === 0 ? (
        <div className="card p-6 text-center text-sm text-gray-500">탐색된 노드가 없습니다. {daemonUp ? '위에서 노드 주소를 넣고 탐색하세요.' : ''}</div>
      ) : unitList.map(unit => (
        <NodeCard key={unit} unit={unit} node={nodes[unit]} st={state[unit]} mapping={mapping.map} />
      ))}

      {/* 진단 (읽기 전용) */}
      <div className="card p-4">
        <button onClick={() => setShowDiag(v => !v)} className="text-sm font-bold text-gray-700 flex items-center gap-2">
          <span className={`inline-block transition-transform ${showDiag ? 'rotate-90' : ''}`}>▶</span> 진단 — 프레임 · 이벤트 (읽기 전용)
        </button>
        {showDiag && (
          <div className="mt-3 space-y-3">
            {frames.stats && (
              <p className="text-xs text-gray-500">TX {frames.stats.tx} · RX {frames.stats.rx} · 예외 {frames.stats.exceptions} · 타임아웃 {frames.stats.timeouts}</p>
            )}
            <div className="overflow-x-auto">
              <table className="text-[11px] font-mono w-full">
                <thead><tr className="text-gray-500 text-left"><th className="pr-3">시각</th><th className="pr-3">방향</th><th>프레임 (hex)</th></tr></thead>
                <tbody>
                  {frameRows(frames.frames).slice().reverse().map((f, i) => (
                    <tr key={i} className={f.dir === 'TX' ? 'text-gray-800' : 'text-sky-800'}>
                      <td className="pr-3 whitespace-nowrap">{f.t ? new Date(f.t * 1000).toLocaleTimeString('ko-KR', { hour12: false }) : ''}</td>
                      <td className="pr-3">{f.dir}</td>
                      <td className="whitespace-nowrap">{f.hex}</td>
                    </tr>
                  ))}
                  {frames.frames.length === 0 && <tr><td colSpan={3} className="text-gray-400">프레임 없음</td></tr>}
                </tbody>
              </table>
            </div>
            <div>
              <p className="text-xs font-bold text-gray-600 mb-1">이벤트</p>
              <ul className="text-[11px] text-gray-700 space-y-0.5 max-h-48 overflow-y-auto">
                {events.slice().reverse().map((e, i) => (
                  <li key={i} className="font-mono">
                    {e.t ? new Date(e.t * 1000).toLocaleTimeString('ko-KR', { hour12: false }) : ''} <b>{e.ev || e.kind}</b>{' '}
                    {Object.entries(e).filter(([k]) => !['t', 'ev', 'kind'].includes(k)).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ')}
                  </li>
                ))}
                {events.length === 0 && <li className="text-gray-400">이벤트 없음</li>}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const NodeCard = ({ unit, node, st, mapping }) => {
  const sum = nodeSummary(node);
  const rows = discoveryRows(node);
  const nodeStatus = st && !st.error ? describeStatus(st.node_status) : null;
  const lastSeen = st?.t ? new Date(st.t * 1000).toLocaleTimeString('ko-KR', { hour12: false }) : null;
  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-base font-bold text-gray-800">U{unit} · {sum.kind}</span>
        {sum.supported ? <Pill tone="on">디폴트맵 · 레벨1</Pill> : <Pill tone="warn">스코프 밖</Pill>}
        {nodeStatus && <Pill tone={nodeStatus.tone} title={`노드 상태코드 ${st.node_status}`}>노드 {nodeStatus.text}</Pill>}
        {st?.error && <Pill tone="bad">{st.error === 'timeout' ? '응답 없음' : st.error}</Pill>}
        {lastSeen && <span className="text-[11px] text-gray-400">최근 {lastSeen}</span>}
        <span className="ml-auto text-[11px] text-gray-500">프로토콜 v{sum.protocolVersion} · 채널 {sum.channels} · 제품 {sum.product} · S/N {sum.serial}</span>
      </div>
      {sum.notes.length > 0 && <ul className="text-xs text-amber-700 mb-2 list-disc ml-4">{sum.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 text-left border-b border-gray-200">
                <th className="py-1 pr-2">#</th><th className="pr-2">디바이스</th><th className="pr-2">코드</th><th className="pr-2">현재</th><th className="pr-2">우리 장치</th><th>레지스터</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const key = mappingKey(unit, r.kind, r.n);
                const mapped = mapping[key] || [];
                let cur = null;
                if (st && !st.error) {
                  if (r.kind === 'sensor') {
                    const sv = st.sensors?.[r.index];
                    if (sv) cur = { text: `${sv.value}`, s: describeStatus(sv.status) };
                  } else {
                    const dv = st.devices?.[r.index];
                    if (dv) cur = { text: '', s: describeStatus(dv.status), remain: dv.remain };
                  }
                }
                return (
                  <tr key={r.index} className={`border-b border-gray-100 ${r.supported ? '' : 'opacity-60'}`}>
                    <td className="py-1 pr-2 text-gray-400">{r.index}</td>
                    <td className="pr-2 font-semibold text-gray-800">{r.name}{r.level ? <span className="ml-1 text-[10px] text-gray-400">L{r.level}</span> : null}</td>
                    <td className="pr-2 font-mono text-gray-600">{r.code}</td>
                    <td className="pr-2">
                      {!r.supported ? <Pill tone="warn" title={r.note}>미지원</Pill>
                        : cur ? <>{cur.text && <span className="font-mono mr-1">{cur.text}</span>}<Pill tone={cur.s.tone}>{cur.s.text}</Pill>{cur.remain > 0 && <span className="ml-1 text-[10px] text-gray-500">{cur.remain}s</span>}</>
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="pr-2">
                      {mapped.length === 0 ? <span className="text-gray-400">미매핑</span>
                        : mapped.map((m, i) => <span key={i} className={`mr-1 ${mapped.length > 1 ? 'text-rose-600' : 'text-blue-700'} font-semibold`}>{m.houseName || m.houseId}/{m.name}</span>)}
                    </td>
                    <td className="text-[10px] text-gray-400 font-mono whitespace-nowrap">{r.registers}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {r_unsupported(rows)}
        </div>
      )}
    </div>
  );
};

function r_unsupported(rows) {
  const notes = rows.filter(r => !r.supported && r.note);
  if (notes.length === 0) return null;
  return <ul className="text-[11px] text-amber-700 mt-2 list-disc ml-4">{notes.map(r => <li key={r.index}>#{r.index} {r.name}: {r.note}</li>)}</ul>;
}

export default KsNodeManager;
