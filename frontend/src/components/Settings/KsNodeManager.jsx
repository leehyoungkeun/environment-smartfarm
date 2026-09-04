import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axiosBase from 'axios';
import { getApiBase } from '../../services/apiSwitcher';
import { describeStatus, discoveryRows, nodeSummary, nodeInfoRows, mappingIndex, mappingKey, frameRows } from '../../lib/ks3267';

// ━━━ KS X 3267 표준노드 탭 (P4, 2026-08-30 / UI 재구성 2026-09-04) ━━━
// 읽기 전용 진단 UI. 백엔드 /config/:farmId/ks3267/:action → RPi NR → ks3267d 데몬(127.0.0.1:3002).
// 제어는 여기서 하지 않는다 — 정규 제어 경로(제어판 → execute_control → 표준 명령 조립)만.
// 매핑(우리 장치 ↔ 표준 디바이스)은 하우스/센서 탭의 장치·센서 설정에서 "프로토콜: KS X 3267" 로 지정한다.
// 화면은 실제 절차 순서대로 ① 연결 → ② 노드 찾기 → ③ 찾은 노드(§5.1.2 시험표) → ④ 진단 의 4구획.

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
  <span title={title} className={`inline-block px-2 py-0.5 rounded-md text-xs font-bold ${TONE[tone] || TONE.muted}`}>{children}</span>
);

/** 번호 매긴 큰 구획 — 파란 번호 배지 + 제목 + 설명, 아래 본문 */
const Section = ({ n, title, desc, right, children }) => (
  <section className="card p-0 overflow-hidden border-2 border-gray-200">
    <div className="flex flex-wrap items-center gap-3 px-5 py-3 bg-gray-50 border-b-2 border-gray-200">
      <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-600 text-white text-base font-extrabold shrink-0">{n}</span>
      <div className="min-w-0">
        <h3 className="text-lg font-bold text-gray-900 leading-tight">{title}</h3>
        {desc && <p className="text-sm text-gray-500 mt-0.5">{desc}</p>}
      </div>
      {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
    </div>
    <div className="p-5 space-y-4">{children}</div>
  </section>
);

/** 구획 안의 작은 상자 — 제목 줄 + 본문, 구획 안에서 하위 단계를 나눈다 */
const SubBox = ({ title, desc, right, children, tone = 'gray' }) => {
  const border = { gray: 'border-gray-200', blue: 'border-blue-200', green: 'border-emerald-200' }[tone] || 'border-gray-200';
  const head = { gray: 'bg-white', blue: 'bg-blue-50', green: 'bg-emerald-50' }[tone] || 'bg-white';
  return (
    <div className={`rounded-lg border ${border} overflow-hidden`}>
      <div className={`flex flex-wrap items-center gap-2 px-4 py-2 ${head} border-b ${border}`}>
        <p className="text-base font-bold text-gray-800">{title}</p>
        {desc && <span className="text-sm text-gray-500">{desc}</span>}
        {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
};

const kindLabel = (k) => (k === 'sensor' ? '센서 노드' : k === 'actuator' ? '구동기 노드' : k === 'integrated' ? '복합 노드' : (k || '알 수 없음'));

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
    if (!(unit >= 1 && unit <= 247)) { setMessage({ type: 'err', text: '노드 주소는 1~247 사이여야 합니다' }); return; }
    setDiscovering(true); setMessage(null);
    try {
      const r = await ks('discover', { unit });
      if (r.ok && r.node) {
        setNodes(prev => ({ ...prev, [unit]: r.node }));
        setMessage({ type: r.node.supported ? 'ok' : 'warn', text: r.node.supported
          ? `주소 ${unit} 탐색 완료 — ${nodeSummary(r.node).kind}, 연결된 디바이스 ${r.node.devices.length}개. 아래 ③ 에서 확인하세요.`
          : `주소 ${unit} 이(가) 응답했지만 스코프 밖입니다: ${(r.node.notes || []).join(' / ')}` });
      } else {
        setMessage({ type: 'err', text: `주소 ${unit}: ${r.error || '탐색 실패'}` });
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
    if (!(from >= 1 && from <= 247 && to >= 1 && to <= 247)) { setMessage({ type: 'err', text: '주소는 1~247 사이여야 합니다' }); return; }
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
        text: foundArr.length
          ? `스캔 완료 — 주소 ${res.range?.[0]}~${res.range?.[1]} 중 ${foundArr.length}개 노드 발견. 아래 ③ 에서 상세를 확인하세요.`
          : `스캔 완료 — 주소 ${res.range?.[0]}~${res.range?.[1]} 에서 응답한 노드가 없습니다.` });
    } catch (e) {
      setMessage({ type: 'err', text: '스캔 요청 실패: ' + (e.response?.data?.error || e.message) });
    } finally {
      setScanning(false);
      setTick(x => x + 1);
    }
  };

  const mapping = useMemo(() => mappingIndex(houses), [houses]);
  const unitList = Object.keys(nodes).map(Number).sort((a, b) => a - b);

  const msgClass = message?.type === 'ok' ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
    : message?.type === 'warn' ? 'bg-amber-50 border-amber-300 text-amber-800'
    : 'bg-rose-50 border-rose-300 text-rose-700';

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="px-1">
        <h2 className="text-2xl font-extrabold text-gray-900">📐 KS X 3267 표준 노드</h2>
        <p className="text-sm text-gray-500 mt-1">표준 규격(KS X 3267) 센서·구동기 노드를 찾고, 노드 정보가 표준과 맞는지 확인하는 화면입니다. 이 화면에서는 제어하지 않습니다.</p>
      </div>

      {/* ① 드라이버 연결 */}
      <Section n="1" title="드라이버 연결 상태" desc="표준 노드용 RS485 포트에 드라이버가 떠 있어야 다음 단계가 됩니다"
        right={<button onClick={() => setTick(x => x + 1)} className="text-sm font-semibold text-blue-600 hover:underline">새로고침</button>}>
        <div className="flex flex-wrap items-center gap-3">
          {health === null
            ? <span className="text-base text-gray-500">확인 중…</span>
            : daemonUp
              ? <span className="inline-flex items-center gap-2 text-base font-bold text-emerald-700"><span className="w-3 h-3 rounded-full bg-emerald-500" />연결됨</span>
              : <span className="inline-flex items-center gap-2 text-base font-bold text-rose-700"><span className="w-3 h-3 rounded-full bg-rose-500" />드라이버 없음</span>}
          {daemonUp && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-600">
              <span>포트 <b className="font-mono text-gray-800">{health.transport}</b></span>
              <span>등록 노드 <b className="text-gray-800">{health.nodes?.length || 0}개</b></span>
              <span>예외 <b className="text-gray-800">{health.stats?.exceptions ?? 0}</b></span>
              <span>타임아웃 <b className="text-gray-800">{health.stats?.timeouts ?? 0}</b></span>
            </div>
          )}
        </div>
        {!daemonUp && health && (
          <p className="text-sm text-gray-600 bg-gray-50 rounded-md p-3 border border-gray-200">
            {health.error || 'ks3267d 데몬 응답 없음'} — 표준 노드용 RS485 포트 <code className="text-xs">/dev/smartfarm-485-std</code> 에 드라이버(RPi <code className="text-xs">pm2 ks3267d</code>)가 떠 있어야 합니다.
            기존 릴레이·센서와는 별도 포트라 운영에는 영향 없습니다.
          </p>
        )}
        {mapping.duplicates.length > 0 && (
          <p className="text-sm text-rose-700 font-semibold bg-rose-50 rounded-md p-3 border border-rose-200">⚠ 같은 표준 디바이스에 둘 이상 매핑됨: {mapping.duplicates.join(', ')} — 하우스/센서 탭에서 정리하세요</p>
        )}
      </Section>

      {/* ② 노드 찾기 */}
      <Section n="2" title="노드 찾기" desc="주소를 알면 A, 모르면 B">
        <SubBox title="A. 주소 하나 탐색" desc="노드 주소를 알고 있을 때" tone="blue">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-semibold text-gray-700">노드 주소</label>
            <input type="number" min={1} max={247} value={unitInput} onChange={e => setUnitInput(e.target.value)}
              className="input-field text-base w-28 text-center" disabled={!daemonUp} />
            <span className="text-sm text-gray-400">(1~247)</span>
            <button onClick={discover} disabled={!daemonUp || discovering} className="btn-primary text-base px-5 py-2">
              {discovering ? '탐색 중…' : '🔍 탐색'}
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-2">노드정보 레지스터 1~8 과 디바이스 코드(101번지부터)를 읽어 옵니다.</p>
        </SubBox>

        <SubBox title="B. 범위 자동 스캔" desc="노드 주소를 모를 때 — 범위를 훑어 응답하는 노드를 찾습니다" tone="blue">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-semibold text-gray-700">시작</label>
            <input type="number" min={1} max={247} value={scanFrom} onChange={e => setScanFrom(e.target.value)}
              className="input-field text-base w-24 text-center" disabled={!daemonUp} />
            <label className="text-sm font-semibold text-gray-700">끝</label>
            <input type="number" min={1} max={247} value={scanTo} onChange={e => setScanTo(e.target.value)}
              className="input-field text-base w-24 text-center" disabled={!daemonUp} />
            <label className="text-sm font-semibold text-gray-700">타임아웃</label>
            <div className="flex items-center gap-1">
              <input type="number" min={50} max={2000} step={50} value={scanTimeout} onChange={e => setScanTimeout(e.target.value)}
                className="input-field text-base w-24 text-center" disabled={!daemonUp} />
              <span className="text-sm text-gray-500">ms</span>
            </div>
            <button onClick={scan} disabled={!daemonUp || scanning} className="btn-primary text-base px-5 py-2">
              {scanning ? '스캔 중…' : '📡 자동 스캔'}
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-2">범위가 넓거나 타임아웃이 길면 오래 걸립니다 — 보통 <b>1~16, 300ms</b> 로 충분합니다.</p>

          {scanResult && (
            <div className="mt-4 pt-4 border-t border-gray-200">
              <p className="text-base font-bold text-gray-800 mb-2">
                스캔 결과 — 주소 {scanResult.range?.[0]}~{scanResult.range?.[1]} ({scanResult.count}개, {scanResult.timeout_ms}ms) ·{' '}
                <span className={scanResult.found?.length ? 'text-emerald-700' : 'text-amber-700'}>발견 {scanResult.found?.length || 0}개</span>
              </p>
              {scanResult.found?.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-600 text-left bg-gray-50 border-y border-gray-200">
                        <th className="py-2 px-3">주소</th><th className="px-3">종류</th><th className="px-3">채널수</th><th className="px-3">연결 디바이스</th><th className="px-3">스코프</th><th className="px-3">제품형식</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scanResult.found.map(f => (
                        <tr key={f.unit} className="border-b border-gray-100">
                          <td className="py-2 px-3 font-extrabold text-gray-900 text-base">{f.unit}</td>
                          <td className="px-3 font-semibold">{kindLabel(f.kind)}</td>
                          <td className="px-3 text-gray-700">{f.channels ?? '—'}</td>
                          <td className="px-3 text-gray-700">{f.devices ?? '—'}개</td>
                          <td className="px-3">{f.supported
                            ? <Pill tone="on">디폴트맵 · 레벨1</Pill>
                            : <Pill tone="warn" title={(f.notes || []).join(' / ')}>스코프 밖</Pill>}</td>
                          <td className="px-3 text-gray-500 font-mono">{f.product_type ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-amber-700 bg-amber-50 rounded-md p-3 border border-amber-200">응답한 노드가 없습니다 — 배선 · 종단저항 · 노드 주소 · 전원을 확인하세요. (같은 주소 노드가 2개면 충돌로 잡히지 않습니다)</p>
              )}
            </div>
          )}
        </SubBox>

        {message && (
          <p className={`text-base font-semibold rounded-md p-3 border ${msgClass}`}>{message.text}</p>
        )}
      </Section>

      {/* ③ 찾은 노드 */}
      <Section n="3" title="찾은 노드" desc="노드마다 표준 시험표(§5.1.2)와 연결된 디바이스를 보여줍니다"
        right={<Pill tone={unitList.length ? 'on' : 'muted'}>{unitList.length}개</Pill>}>
        {unitList.length === 0 ? (
          <div className="text-center py-8 text-base text-gray-500">
            아직 찾은 노드가 없습니다.{daemonUp ? ' 위 ② 에서 탐색하거나 스캔하세요.' : ' 먼저 ① 드라이버가 연결되어야 합니다.'}
          </div>
        ) : unitList.map(unit => (
          <NodeCard key={unit} unit={unit} node={nodes[unit]} st={state[unit]} mapping={mapping.map} />
        ))}
      </Section>

      {/* ④ 진단 */}
      <Section n="4" title="진단 (고급)" desc="실제 오간 통신 프레임과 이벤트 — 시험 증적 · 문제 추적용"
        right={<button onClick={() => setShowDiag(v => !v)} className="text-sm font-semibold text-blue-600 hover:underline">{showDiag ? '닫기' : '열기'}</button>}>
        {!showDiag ? (
          <p className="text-sm text-gray-500">평소엔 닫아 두세요. 열면 10초마다 최근 프레임·이벤트를 가져옵니다.</p>
        ) : (
          <div className="space-y-4">
            {frames.stats && (
              <p className="text-sm text-gray-600">TX <b>{frames.stats.tx}</b> · RX <b>{frames.stats.rx}</b> · 예외 <b>{frames.stats.exceptions}</b> · 타임아웃 <b>{frames.stats.timeouts}</b></p>
            )}
            <SubBox title="통신 프레임" desc="최근 40개 · hex">
              <div className="overflow-x-auto">
                <table className="text-sm font-mono w-full">
                  <thead><tr className="text-gray-500 text-left border-b border-gray-200"><th className="py-1 pr-4">시각</th><th className="pr-4">방향</th><th>프레임</th></tr></thead>
                  <tbody>
                    {frameRows(frames.frames).slice().reverse().map((f, i) => (
                      <tr key={i} className={f.dir === 'TX' ? 'text-gray-800' : 'text-sky-800'}>
                        <td className="pr-4 whitespace-nowrap">{f.t ? new Date(f.t * 1000).toLocaleTimeString('ko-KR', { hour12: false }) : ''}</td>
                        <td className="pr-4 font-bold">{f.dir}</td>
                        <td className="whitespace-nowrap">{f.hex}</td>
                      </tr>
                    ))}
                    {frames.frames.length === 0 && <tr><td colSpan={3} className="text-gray-400 py-2">프레임 없음</td></tr>}
                  </tbody>
                </table>
              </div>
            </SubBox>
            <SubBox title="이벤트" desc="최근 30개">
              <ul className="text-sm text-gray-700 space-y-1 max-h-60 overflow-y-auto">
                {events.slice().reverse().map((e, i) => (
                  <li key={i} className="font-mono">
                    {e.t ? new Date(e.t * 1000).toLocaleTimeString('ko-KR', { hour12: false }) : ''} <b>{e.ev || e.kind}</b>{' '}
                    {Object.entries(e).filter(([k]) => !['t', 'ev', 'kind'].includes(k)).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ')}
                  </li>
                ))}
                {events.length === 0 && <li className="text-gray-400">이벤트 없음</li>}
              </ul>
            </SubBox>
          </div>
        )}
      </Section>
    </div>
  );
};

const NodeCard = ({ unit, node, st, mapping }) => {
  const sum = nodeSummary(node);
  const rows = discoveryRows(node);
  const infoRows = nodeInfoRows(node);
  const infoFail = infoRows.filter(r => r.ok === false).length;
  const nodeStatus = st && !st.error ? describeStatus(st.node_status) : null;
  const lastSeen = st?.t ? new Date(st.t * 1000).toLocaleTimeString('ko-KR', { hour12: false }) : null;
  return (
    <div className="rounded-xl border-2 border-gray-300 overflow-hidden">
      {/* 노드 머리 */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-gray-100 border-b-2 border-gray-300">
        <span className="text-xl font-extrabold text-gray-900">주소 {unit}</span>
        <span className="text-lg font-bold text-gray-700">{sum.kind}</span>
        {sum.supported ? <Pill tone="on">디폴트맵 · 레벨1</Pill> : <Pill tone="warn">스코프 밖</Pill>}
        {nodeStatus && <Pill tone={nodeStatus.tone} title={`노드 상태코드 ${st.node_status}`}>노드 {nodeStatus.text}</Pill>}
        {st?.error && <Pill tone="bad">{st.error === 'timeout' ? '응답 없음' : st.error}</Pill>}
        {lastSeen && <span className="ml-auto text-sm text-gray-500">최근 응답 {lastSeen}</span>}
      </div>

      <div className="p-4 space-y-4">
        {sum.notes.length > 0 && (
          <ul className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3 list-disc ml-0 pl-7">
            {sum.notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        )}

        {/* 노드정보 1~8 시험표 (§5.1.2 c) */}
        {infoRows.length > 0 && (
          <SubBox title="노드 기본정보 시험표" desc="§5.1.2 c — 읽은 값이 표준 기대값과 같은지" tone={infoFail === 0 ? 'green' : 'gray'}
            right={infoFail === 0 ? <Pill tone="on">전 항목 일치</Pill> : <Pill tone="bad">불일치 {infoFail}건</Pill>}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-600 text-left bg-gray-50 border-y border-gray-200">
                    <th className="py-2 px-3 w-16">레지스터</th><th className="px-3">항목</th><th className="px-3">읽은 값</th><th className="px-3">기대값</th><th className="px-3">판정</th>
                  </tr>
                </thead>
                <tbody>
                  {infoRows.map(r => (
                    <tr key={r.reg} className="border-b border-gray-100">
                      <td className="py-2 px-3 text-gray-500 font-mono">{r.reg}</td>
                      <td className="px-3 font-semibold text-gray-800">{r.label}</td>
                      <td className="px-3 font-mono font-bold text-gray-900 text-base">{r.read}</td>
                      <td className="px-3 font-mono text-gray-600">{r.expect}</td>
                      <td className="px-3">{r.ok === null ? <span className="text-gray-400">참고</span>
                        : r.ok ? <span className="text-emerald-700 font-bold">✓ 일치</span>
                        : <span className="text-rose-600 font-bold">✗ 불일치</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SubBox>
        )}

        {/* 연결된 디바이스 (§5.1.2 d·e) */}
        <SubBox title="연결된 디바이스" desc="§5.1.2 d·e — 101번지부터 채널수만큼 읽어, 연결된 것만"
          right={<Pill tone={rows.length ? 'ok' : 'muted'}>{rows.length}개</Pill>}>
          {rows.length === 0 ? (
            <p className="text-sm text-gray-500">연결된 디바이스가 없습니다 (디바이스 코드가 모두 0).</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-600 text-left bg-gray-50 border-y border-gray-200">
                    <th className="py-2 px-3 w-12">#</th><th className="px-3">디바이스</th><th className="px-3">코드</th><th className="px-3">현재 상태</th><th className="px-3">우리 장치와 매핑</th><th className="px-3">레지스터</th>
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
                        <td className="py-2 px-3 text-gray-500">{r.index}</td>
                        <td className="px-3 font-bold text-gray-900">{r.name}{r.level ? <span className="ml-1 text-xs text-gray-400 font-normal">L{r.level}</span> : null}</td>
                        <td className="px-3 font-mono text-gray-700">{r.code}</td>
                        <td className="px-3">
                          {!r.supported ? <Pill tone="warn" title={r.note}>미지원</Pill>
                            : cur ? <>{cur.text && <span className="font-mono font-bold text-gray-900 mr-2">{cur.text}</span>}<Pill tone={cur.s.tone}>{cur.s.text}</Pill>{cur.remain > 0 && <span className="ml-1 text-xs text-gray-500">{cur.remain}s</span>}</>
                            : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-3">
                          {mapped.length === 0 ? <span className="text-gray-400">미매핑</span>
                            : mapped.map((m, i) => <span key={i} className={`mr-2 ${mapped.length > 1 ? 'text-rose-600' : 'text-blue-700'} font-semibold`}>{m.houseName || m.houseId} / {m.name}</span>)}
                        </td>
                        <td className="px-3 text-xs text-gray-400 font-mono whitespace-nowrap">{r.registers}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {r_unsupported(rows)}
            </div>
          )}
        </SubBox>
      </div>
    </div>
  );
};

function r_unsupported(rows) {
  const notes = rows.filter(r => !r.supported && r.note);
  if (notes.length === 0) return null;
  return <ul className="text-sm text-amber-800 mt-3 list-disc pl-7">{notes.map(r => <li key={r.index}>#{r.index} {r.name}: {r.note}</li>)}</ul>;
}

export default KsNodeManager;
