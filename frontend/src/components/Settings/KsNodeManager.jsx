import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axiosBase from 'axios';
import { getApiBase } from '../../services/apiSwitcher';
import { describeStatus, discoveryRows, nodeSummary, nodeInfoRows, nodeReadRows, mappingIndex, mappingKey, frameRows, commChangeWarnings, deviceCodeCheck, nodeReadView, deviceKindSummary, changeStats, storageCheck } from '../../lib/ks3267';

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
  // 패널(localhost)은 같은 출처 /api/ks3267/:action (nginx → NR 프록시 → 데몬, 인터넷·JWT 불필요) — 입고 시험장에 인터넷이 없어도 탭이 뜬다 (2026-09-15).
  // 웹은 클라우드 백엔드 /config/:farmId/ks3267/:action 이 같은 NR 프록시로 되돌아온다.
  const panelHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const ks = useCallback((action, params) => (panelHost
    ? axios.get(`/api/ks3267/${action}`, { params, timeout: action === 'scan' ? 125000 : 12000 })
    : axios.get(`${api}/config/${farmId}/ks3267/${action}`, { params, timeout: 12000 })).then(r => r.data), [api, farmId, panelHost]);

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

  // ── 통신 설정·§5.4.1 연결 시험 (2026-09-15) ──
  // 이 탭은 읽기 전용이 원칙인데 통신 설정만 예외로 쓴다. 제어는 여전히 여기서 하지 않는다.
  // 패널(localhost)은 같은 출처 /api/ks3267-comm (nginx 루프백 전용, 인터넷 없어도 됨),
  // 웹은 클라우드 백엔드 /config/:farmId/ks3267-comm (변경은 농장 소유자 이상).
  const onPanel = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const commGet = useCallback((path, params) => (onPanel
    ? axios.get(`/api/ks3267-comm/${path}`, { params, timeout: 25000 })
    : axios.get(`${api}/config/${farmId}/ks3267-${path}`, { params, timeout: 25000 })).then(r => r.data), [api, farmId, onPanel]);
  const commPut = useCallback((body) => (onPanel
    ? axios.put('/api/ks3267-comm/comm', body, { timeout: 30000 })
    : axios.put(`${api}/config/${farmId}/ks3267-comm`, body, { timeout: 30000 })).then(r => r.data), [api, farmId, onPanel]);
  const [comm, setComm] = useState(null);          // { ok, current, ports, standard, allowedBauds }
  const [commForm, setCommForm] = useState(null);  // { mode, port, baud, timeout, tcp }
  const [commBusy, setCommBusy] = useState(false);
  const [commMsg, setCommMsg] = useState(null);
  const [testUnit, setTestUnit] = useState('1');
  const [connTest, setConnTest] = useState(null);  // { rows, passed, at } | { rows: [], error }
  const [testing, setTesting] = useState(false);
  const [changes, setChanges] = useState({});      // unit → 센서 변화 이력 (§5.4.3, 드라이버 /changes)
  const [storage, setStorage] = useState({});      // unit → 서버 저장 행 최근 60분 (§5.4.4, /api/sensor-status)
  const [stateAt, setStateAt] = useState(0);       // 상태를 받은 브라우저 시각(ms) — §5.1.3 표 남은시간 카운트다운 기준
  const [local, setLocal] = useState({});          // unit → 제어기 로컬 1분 스냅샷(SQLite) 최근 60분 — 인터넷 없이 §5.4.4·116 저장을 보인다

  const loadComm = useCallback(async () => {
    try {
      const d = await commGet('comm');
      setComm(d);
      if (d?.ok && d.current) {
        setCommForm((f) => f || {
          mode: d.current.mode,
          port: d.current.port || (d.ports || []).find((p) => p.role === 'standard')?.stable || '',
          baud: d.current.baud || 9600,
          timeout: d.current.timeout || 1,
          tcp: d.current.tcp || '127.0.0.1:5020',
        });
      }
    } catch (e) {
      setComm({ ok: false, error: e.response?.data?.error || e.message });
    }
  }, [commGet]);

  useEffect(() => { loadComm(); }, [loadComm]);

  const applyComm = async () => {
    if (!commForm || !comm?.current) return;
    const warns = commChangeWarnings(comm.current, commForm);
    if (warns.length && !window.confirm(warns.join('\n\n') + '\n\n계속할까요?')) return;
    setCommBusy(true);
    setCommMsg(null);
    try {
      const d = await commPut({
        mode: commForm.mode, port: commForm.port, baud: Number(commForm.baud),
        timeout: Number(commForm.timeout), tcp: commForm.tcp,
      });
      if (d?.ok) {
        setCommMsg({ type: 'ok', text: `적용했습니다. 지금 연결: ${d.current?.desc}` });
        setComm((c) => ({ ...c, current: d.current }));
        setConnTest(null);
      } else {
        setCommMsg({ type: 'err', text: d?.error || '적용하지 못했습니다' });
      }
    } catch (e) {
      const s = e.response?.status;
      setCommMsg({ type: 'err', text: s === 403 || s === 401
        ? '통신 설정을 바꿀 권한이 없습니다. 농장 소유자 이상으로 로그인하거나 제어기 패널에서 바꾸세요.'
        : '적용 실패: ' + (e.response?.data?.error || e.message) });
    } finally {
      setCommBusy(false);
    }
  };

  // 예외·타임아웃 카운터 0 으로 — 시험 당일 연결 전 타임아웃·§5.3 의도된 예외가 빨갛게 남아 시험관 질문을 부르지 않게. 프레임은 남는다.
  const resetStats = async () => {
    if (!window.confirm('예외·타임아웃·스캔 미응답 카운터를 0 으로 되돌립니다. 진단 프레임은 남습니다. 계속할까요?')) return;
    try {
      const d = (await axios.post('/api/ks3267-comm/stats-reset', {}, { timeout: 10000 })).data;   // 패널 같은 출처 전용
      if (d?.ok) setTick((x) => x + 1); else setMessage({ type: 'err', text: d?.error || '통계를 초기화하지 못했습니다' });
    } catch (e) {
      setMessage({ type: 'err', text: '통계 초기화 실패: ' + (e.response?.data?.error || e.message) });
    }
  };

  const runConnTest = async () => {
    setTesting(true);
    setConnTest(null);
    try {
      const d = await commGet('conntest', { unit: parseInt(testUnit, 10) });
      setConnTest(d?.rows ? d : { rows: [], passed: false, error: d?.error || '시험하지 못했습니다' });
    } catch (e) {
      setConnTest({ rows: [], passed: false, error: e.response?.data?.error || e.message });
    } finally {
      setTesting(false);
    }
  };
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
          setStateAt(Date.now());
          // §5.4.3 — 센서 노드마다 변화 이력. 드라이버가 폴링 해상도로 남기므로 화면 10초 주기여도 빠지지 않는다.
          const sensorUnits = Object.entries(n.nodes || {}).filter(([, nd]) => nd?.kind === 'sensor').map(([u]) => u);
          const chs = await Promise.all(sensorUnits.map((u) => commGet('changes', { unit: u, n: 80 }).catch(() => null)));
          if (!alive) return;
          setChanges(Object.fromEntries(sensorUnits.map((u, i) => [u, chs[i]?.changes || []])));
          // §5.4.4 — 서버(ks_sensor_status)에 매분 저장된 관측치·상태. 최근 60분. 서버 미배포·미인증이면 조용히 빈 값.
          const since = new Date(Date.now() - 60 * 60000).toISOString();
          const sts = await Promise.all(sensorUnits.map((u) => axios.get(`${api}/sensor-status/${farmId}`, { params: { unit: u, startDate: since }, timeout: 15000 })
            .then((r) => r.data).catch((e) => ({ error: e.response?.data?.error || e.message }))));
          if (!alive) return;
          setStorage(Object.fromEntries(sensorUnits.map((u, i) => [u, sts[i]])));
          if (onPanel) {
            const allUnits = Object.entries(n.nodes || {}).filter(([, nd]) => nd?.kind === 'sensor' || nd?.kind === 'actuator');
            const start = Math.floor(Date.now() / 1000) - 3600;
            const loc = await Promise.all(allUnits.map(([u, nd]) => commGet(nd.kind === 'sensor' ? 'local-sensor-status' : 'local-actuator-status', { unit: u, start })
              .catch((e) => ({ ok: false, error: e.response?.data?.error || e.message }))));
            if (!alive) return;
            setLocal(Object.fromEntries(allUnits.map(([u], i) => [u, loc[i]])));
          }
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
  }, [ks, commGet, api, farmId, onPanel, tick, showDiag]);

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
              <span title="폴링·명령 중 노드가 돌려준 Modbus 예외 응답 (실제 장애 지표)">예외 <b className={`${(health.stats?.exceptions ?? 0) > 0 ? 'text-rose-700' : 'text-gray-800'}`}>{health.stats?.exceptions ?? 0}</b></span>
              <span title="폴링·명령 중 응답 없음 (실제 장애 지표)">타임아웃 <b className={`${(health.stats?.timeouts ?? 0) > 0 ? 'text-rose-700' : 'text-gray-800'}`}>{health.stats?.timeouts ?? 0}</b></span>
              {health.stats?.scan_misses !== undefined && <span title="자동스캔이 두드린 빈 주소 — 장애 아님">스캔 미응답 <b className="text-gray-500">{health.stats.scan_misses}</b></span>}
              {onPanel && ((health.stats?.exceptions ?? 0) + (health.stats?.timeouts ?? 0) + (health.stats?.scan_misses ?? 0)) > 0 && (
                <button onClick={resetStats} className="text-xs text-blue-700 underline" title="카운터만 0 으로 — 진단 프레임은 남습니다">통계 초기화</button>
              )}
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

        {/* 통신 설정 — SPS-7466 §5.4.1 b) 통신 설정값 세팅 (2026-09-15) */}
        <SubBox title="통신 설정" desc="표준 노드 RS485 포트와 속도" tone="blue"
          right={comm?.current && <Pill tone={comm.current.connected ? 'on' : 'bad'}>{comm.current.connected ? '포트 열림' : '포트 닫힘'}</Pill>}>
          {!comm ? (
            <p className="text-sm text-gray-500">불러오는 중…</p>
          ) : !comm.ok ? (
            <p className="text-sm text-rose-700">{comm.error || '드라이버에서 통신 설정을 읽지 못했습니다'}</p>
          ) : commForm && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <label className="text-sm font-semibold text-gray-700">연결 방식
                  <select value={commForm.mode} onChange={e => setCommForm({ ...commForm, mode: e.target.value })}
                    className="input-field mt-1 w-full">
                    <option value="serial">RS485 (실제 노드)</option>
                    <option value="tcp">시뮬레이터 (시험장비)</option>
                  </select>
                </label>
                {commForm.mode === 'serial' ? (
                  <>
                    <label className="text-sm font-semibold text-gray-700 md:col-span-2">포트
                      <select value={commForm.port} onChange={e => setCommForm({ ...commForm, port: e.target.value })}
                        className="input-field mt-1 w-full font-mono">
                        {(comm.ports || []).length === 0 && <option value="">USB-RS485 변환기를 찾지 못했습니다</option>}
                        {(comm.ports || []).map(p => (
                          <option key={p.path} value={p.stable || p.path} disabled={!p.selectable}>{p.label}</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm font-semibold text-gray-700">통신 속도
                      <select value={commForm.baud} onChange={e => setCommForm({ ...commForm, baud: Number(e.target.value) })}
                        className="input-field mt-1 w-full">
                        {(comm.allowedBauds || [9600]).map(b => <option key={b} value={b}>{b}{b === 9600 ? ' (표준)' : ''}</option>)}
                      </select>
                    </label>
                  </>
                ) : (
                  <label className="text-sm font-semibold text-gray-700 md:col-span-3">시뮬레이터 주소
                    <input value={commForm.tcp} onChange={e => setCommForm({ ...commForm, tcp: e.target.value })}
                      className="input-field mt-1 w-full font-mono" />
                  </label>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gray-600">
                <span>데이터 형식 <b className="text-gray-800">8N1 · RTU</b> <span className="text-gray-400">표준 고정</span></span>
                <span>지금 연결 <b className="font-mono text-gray-800">{comm.current?.desc}</b></span>
                <label className="inline-flex items-center gap-1">응답 대기
                  <input type="number" min={0.2} max={5} step={0.1} value={commForm.timeout}
                    onChange={e => setCommForm({ ...commForm, timeout: e.target.value })}
                    className="input-field w-20 py-1" />초
                </label>
                {(() => {
                  // §5.4.1 c) 당일 한 번에: RS485 · 표준 포트 · 9600. 적용은 따로 눌러야 한다(경고 확인 경로 유지).
                  const std = (comm.ports || []).find(x => x.role === 'standard');
                  const isPreset = commForm.mode === 'serial' && Number(commForm.baud) === 9600 && std && commForm.port === (std.stable || std.path);
                  return (
                    <button onClick={() => setCommForm({ ...commForm, mode: 'serial', port: std.stable || std.path, baud: 9600 })}
                      disabled={!std || isPreset} className="ml-auto btn-secondary text-sm px-3 py-2"
                      title={std ? '연결 방식 RS485, 표준 노드 포트, 9600 으로 채웁니다' : '표준 노드 포트(FTDI)를 찾지 못했습니다'}>
                      {isPreset ? '✓ 시험 당일 값' : '시험 당일 값으로'}
                    </button>
                  );
                })()}
                <button onClick={applyComm} disabled={commBusy} className="btn-primary text-sm px-4 py-2">
                  {commBusy ? '적용 중…' : '적용'}
                </button>
              </div>
              {commForm.mode === 'serial' && Number(commForm.baud) !== 9600 && (
                <p className="text-sm text-amber-700 font-semibold">⚠ 9600 이 아니면 KS X 3267 표준 밖입니다.</p>
              )}
              {commMsg && (
                <p className={`text-sm font-semibold rounded-md p-2 border ${commMsg.type === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
                  {commMsg.text}
                </p>
              )}
            </div>
          )}
        </SubBox>

        {/* §5.4.1 연결 시험 a)~d) (2026-09-15) */}
        <SubBox title="§5.4.1 연결 시험" desc="a)~d) 를 한 번에 판정합니다" tone="green"
          right={connTest?.rows?.length > 0 && <Pill tone={connTest.passed ? 'on' : 'bad'}>{connTest.passed ? '통과' : '불통과'}</Pill>}>
          <div className="flex flex-wrap items-end gap-3 mb-3">
            <label className="text-sm font-semibold text-gray-700">노드 슬레이브 아이디
              <input type="number" min={1} max={247} value={testUnit} onChange={e => setTestUnit(e.target.value)}
                className="input-field mt-1 w-28 block" />
            </label>
            <button onClick={runConnTest} disabled={testing || !daemonUp} className="btn-primary text-sm px-4 py-2">
              {testing ? '시험 중…' : '▶ 연결 시험 실행'}
            </button>
          </div>
          {connTest?.error && <p className="text-sm text-rose-700">{connTest.error}</p>}
          {connTest?.rows?.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-1 pr-2">단계</th><th className="py-1 pr-2">항목</th><th className="py-1 pr-2">기대</th>
                    <th className="py-1 pr-2">실제</th><th className="py-1">판정</th>
                  </tr>
                </thead>
                <tbody>
                  {connTest.rows.map(r => (
                    <tr key={r.step} className="border-b border-gray-100 align-top">
                      <td className="py-1.5 pr-2 font-bold">{r.step})</td>
                      <td className="py-1.5 pr-2">{r.title}{r.note && <div className="text-xs text-amber-700 mt-0.5">{r.note}</div>}</td>
                      <td className="py-1.5 pr-2 text-gray-600">{r.expected}</td>
                      <td className="py-1.5 pr-2 font-mono text-gray-800 break-all">{r.actual}</td>
                      <td className="py-1.5"><Pill tone={r.ok ? 'on' : 'bad'}>{r.ok ? '일치' : '불일치'}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {connTest?.prep?.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-100">
              <p className="text-sm font-semibold text-gray-700 mb-1">당일 준비 점검 <span className="text-gray-400 font-normal">— a)~d) 판정과 별개. 시뮬레이터로 쓰는 동안에도 표준 포트가 준비됐는지 봅니다</span></p>
              <ul className="space-y-1 text-sm">
                {connTest.prep.map((r, i) => (
                  <li key={i} className="flex flex-wrap items-start gap-2">
                    <Pill tone={r.ok === null ? 'muted' : r.ok ? 'on' : 'bad'}>{r.ok === null ? '안내' : r.ok ? '준비됨' : '미비'}</Pill>
                    <span className="text-gray-800">{r.title}</span>
                    <span className="text-gray-500 break-all">{r.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SubBox>
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
          <NodeCard key={unit} unit={unit} node={nodes[unit]} st={state[unit]} mapping={mapping.map} changes={changes[unit] || []} storage={storage[unit]} stateAt={stateAt} local={local[unit]} />
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

const NodeCard = ({ unit, node, st, mapping, changes = [], storage, stateAt = 0, local }) => {
  // §5.5.2 f)·§5.5.3 f)o) — 남은 작동시간은 10초 폴링 사이에도 흘러야 '적절히 표시' 다. 받은 시각부터 지난 초를 뺀다.
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNowMs(Date.now()), 1000); return () => clearInterval(id); }, []);
  const remainNow = (remain) => (remain > 0 && stateAt > 0 ? Math.max(0, remain - Math.floor((nowMs - stateAt) / 1000)) : remain);
  const sum = nodeSummary(node);
  const rows = discoveryRows(node);
  const infoRows = nodeInfoRows(node);
  const infoFail = infoRows.filter(r => r.ok === false).length;
  // §5.1.2 e) 위치별 기대 코드 대조 — 센서 코드가 틀려도 표에 정상처럼 보이던 빈틈 (2026-09-15)
  const codeCheck = deviceCodeCheck(node);
  const codeByIndex = Object.fromEntries(codeCheck.rows.map(c => [c.index, c]));
  const kindSum = deviceKindSummary(node);  // §5.4.2 d)·§5.5.1 d) — 시험장비 설정(개수·종류)과 한눈에 대조
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

        {/* 노드 데이터 읽기 시험표 (§5.1.3 b·c) — 상태코드 숫자+의미, 관측치+단위, 읽은 시각 */}
        {(() => {
          const rd = nodeReadView(node, st);
          if (!rd) return null;
          const t = rd.readAt ? rd.readAt.toLocaleTimeString('ko-KR', { hour12: false }) : null;
          const Verdict = ({ ok }) => ok === null ? <span className="text-gray-400">미읽음</span>
            : rd.hold ? <span className="text-amber-700 font-bold">보류</span>
            : ok ? <span className="text-emerald-700 font-bold">✓ 정의된 값</span> : <span className="text-rose-600 font-bold">✗ 부적절</span>;
          return (
            <SubBox title="노드 데이터 읽기 시험표" desc="§5.1.3 b·c — 상태코드가 정의된 값인지, 관측치가 읽히는지" tone={!rd.hold && rd.fail === 0 && rd.node.ok ? 'green' : 'gray'}
              right={<>
                {t ? <span className="text-sm text-gray-500">읽은 시각 {t}</span> : <span className="text-sm text-rose-600">아직 읽지 못함</span>}
                {rd.hold
                  ? <Pill tone="warn" title="§5.1.3 은 §5.1.2 를 통과한 노드에만 판정합니다">§5.1.2 미통과 · 판정 보류</Pill>
                  : rd.node.ok !== null && (rd.fail === 0 ? <Pill tone="on">전 항목 적절</Pill> : <Pill tone="bad">부적절 {rd.fail}건</Pill>)}
                {rd.rangeWarnCount > 0 && <Pill tone="warn" title="표준이 정한 범위가 아니라 일반적인 센서 측정 범위입니다">범위 밖 의심 {rd.rangeWarnCount}건</Pill>}
              </>}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-600 text-left bg-gray-50 border-y border-gray-200">
                      <th className="py-2 px-3 w-12">#</th><th className="px-3">대상</th><th className="px-3">상태코드</th><th className="px-3">의미</th><th className="px-3">관측치 / 동작</th><th className="px-3">판정</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b-2 border-gray-300 bg-blue-50/40">
                      <td className="py-2 px-3 text-gray-500">—</td>
                      <td className="px-3 font-extrabold text-gray-900">노드 상태 <span className="text-xs text-gray-400 font-normal">(b, 레지스터 {rd.node.reg})</span></td>
                      <td className="px-3 font-mono font-bold text-gray-900 text-base">{rd.node.code === null ? '—' : rd.node.code}</td>
                      <td className="px-3"><Pill tone={rd.node.tone}>{rd.node.meaning}</Pill></td>
                      <td className="px-3 text-gray-400">—</td>
                      <td className="px-3"><Verdict ok={rd.node.ok} /></td>
                    </tr>
                    {rd.rows.map(r => (
                      <tr key={r.index} className={`border-b border-gray-100 ${r.supported ? '' : 'opacity-60'}`}>
                        <td className="py-2 px-3 text-gray-500">{r.index}</td>
                        <td className="px-3 font-bold text-gray-900">{r.name} <span className="text-xs text-gray-400 font-normal">(c)</span></td>
                        <td className="px-3 font-mono font-bold text-gray-900 text-base">{r.code === null ? '—' : r.code}</td>
                        <td className="px-3">{r.code === null ? <span className="text-gray-400">—</span> : <Pill tone={r.tone}>{r.meaning}</Pill>}</td>
                        <td className="px-3">
                          {r.kind === 'sensor'
                            ? (r.value === null ? <span className="text-gray-400">—</span> : <><span className="font-mono font-bold text-gray-900 text-base">{r.value}</span>{r.unit && <span className="ml-1 text-gray-500">{r.unit}</span>}{r.rangeWarn && <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-xs font-bold" title="표준이 정한 범위가 아니라 일반적인 센서 측정 범위입니다">범위 밖 의심 {r.rangeWarn.min}~{r.rangeWarn.max}</span>}</>)
                            : (r.code === null ? <span className="text-gray-400">—</span> : <span className="text-gray-700">{r.remain > 0 ? <><span className="font-mono font-bold text-gray-900 text-base">남은 {remainNow(r.remain)}s</span><span className="ml-1 text-xs text-gray-400" title="드라이버가 마지막으로 읽은 값 — 표시값은 읽은 시각부터 초 단위로 흐릅니다">(읽은 값 {r.remain})</span></> : '대기/완료'}{r.opid ? <span className="ml-2 text-xs text-gray-400">OPID {r.opid}</span> : null}</span>)}
                        </td>
                        <td className="px-3"><Verdict ok={r.ok} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-xs text-gray-500 mt-2">판정 "정의된 값" = 표준 표 B.x 의 상태코드(0~6·101~103·201/299·301/302/399·900~999) 이고, 센서는 관측치가 숫자로 읽힘. 값이 시험장비 설정값과 맞는지는 이 표의 관측치를 대조하세요. 「범위 밖 의심」 은 일반적인 센서 측정 범위를 벗어났다는 참고 경고이며 판정을 바꾸지 않습니다. §5.1.2 가 불일치인 노드는 판정을 보류합니다. 10초마다 갱신, 남은 작동시간은 읽은 시각부터 초 단위로 흐르고 다음 읽기에 재동기됩니다.</p>
              </div>
            </SubBox>
          );
        })()}

        {/* §5.4.3 데이터 확인 — 관측 변화 이력 (2026-09-15). 시험장비가 값·상태를 바꾸면 제어기가 읽은 변화가 순서·시각과 함께 쌓인다 */}
        {node.kind === 'sensor' && (() => {
          const cs = changeStats(changes);
          const fmt = (t) => new Date(t * 1000).toLocaleTimeString('ko-KR', { hour12: false });
          return (
            <SubBox title="§5.4.3 데이터 확인 — 관측 변화 이력" desc="시험장비에서 관측치·상태를 바꾸면 제어기가 읽은 변화가 여기 쌓입니다 (드라이버 폴링 해상도)" tone="green"
              right={<Pill tone={cs.total ? 'on' : 'muted'}>{cs.total}건</Pill>}>
              {cs.sensors.length === 0 ? (
                <p className="text-sm text-gray-500">아직 변화가 없습니다. 시험장비에서 관측치나 상태를 바꿔 보세요.</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {cs.sensors.map(x => (
                      <div key={x.index} className="rounded-md border border-gray-200 px-3 py-2 text-sm">
                        <b>#{x.index} {x.name}</b> · 값 변화 {x.valueChanges}회 · 상태 변화 {x.statusChanges}회
                        {x.statusPeriod !== null && <span className="ml-2 text-emerald-700 font-semibold" title="c) 상태가 일정 주기마다 바뀌는지 — 상태 변화 사이 간격의 평균">상태 변화 주기 ≈ {x.statusPeriod}s</span>}
                        {x.statusSeq.length > 0 && <span className="ml-2 font-mono text-gray-600">{x.statusSeq.join(' → ')}</span>}
                      </div>
                    ))}
                  </div>
                  <div className="overflow-x-auto max-h-56 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-gray-600 text-left bg-gray-50 border-y border-gray-200">
                          <th className="py-1 px-2">시각</th><th className="px-2">센서</th><th className="px-2">값</th><th className="px-2">상태</th><th className="px-2">변화</th>
                        </tr>
                      </thead>
                      <tbody>
                        {changes.slice().reverse().map((c, i) => (
                          <tr key={i} className="border-b border-gray-100">
                            <td className="py-1 px-2 font-mono">{fmt(c.t)}</td>
                            <td className="px-2">#{c.index} {c.name}</td>
                            <td className="px-2 font-mono">{c.what !== 'status' ? <>{c.prev_value} → <b>{c.value}</b></> : c.value}</td>
                            <td className="px-2 font-mono">{c.what !== 'value' ? <>{c.prev_status} → <b>{c.status}</b></> : c.status} <span className="text-gray-500 font-sans">{c.status_name}</span></td>
                            <td className="px-2">{c.what === 'both' ? '값·상태' : c.what === 'value' ? '값' : '상태'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </SubBox>
          );
        })()}

        {/* §5.4.4 데이터 저장 확인 (2026-09-15) — 서버에 1분마다 저장된 관측치·상태가 저장주기대로 있는가 */}
        {node.kind === 'sensor' && (() => {
          const rows = storage?.data || [];
          const sc = storageCheck(rows, storage?.intervalSec || 60);
          const fmt = (t) => new Date(t).toLocaleTimeString('ko-KR', { hour12: false });
          const recent = rows.slice(-12).reverse();
          return (
            <SubBox title="§5.4.4 데이터 저장 확인" desc="저장주기 1분 — 서버 ks_sensor_status 최근 60분. 상태가 점검군(101~103)이어도 관측치·상태를 그대로 저장" tone="green"
              right={<>
                {sc.total > 0 && <Pill tone={sc.ok ? 'on' : 'warn'}>{sc.ok ? '저장주기대로' : '빈틈 있음'}</Pill>}
                <Pill tone={sc.total ? 'ok' : 'muted'}>{sc.total}행</Pill>
              </>}>
              {storage?.error ? (
                <p className="text-sm text-rose-700">서버 저장 행을 읽지 못했습니다: {storage.error}</p>
              ) : sc.sensors.length === 0 ? (
                <p className="text-sm text-gray-500">서버에 최근 60분 저장 행이 없습니다(인터넷·NR 스냅샷 확인). 인터넷이 없으면 아래 「제어기 로컬 저장」 으로 확인하세요.</p>
              ) : (
                <div className="space-y-3">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-gray-600 text-left bg-gray-50 border-y border-gray-200">
                          <th className="py-1 px-2">센서</th><th className="px-2">저장 행</th><th className="px-2">기대(1분 간격)</th><th className="px-2">빈틈</th><th className="px-2">상태코드 종류</th><th className="px-2">마지막</th><th className="px-2">판정</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sc.sensors.map(x => (
                          <tr key={x.idx} className="border-b border-gray-100">
                            <td className="py-1 px-2">#{x.idx} {x.name}</td>
                            <td className="px-2 font-mono">{x.rows}</td>
                            <td className="px-2 font-mono">{x.expected}</td>
                            <td className="px-2 font-mono">{x.gaps}</td>
                            <td className="px-2 font-mono">{x.statuses.join(', ')}</td>
                            <td className="px-2 font-mono">{x.last ? `${fmt(x.last.timestamp)} · ${x.last.value ?? '—'} · ${x.last.status}` : '—'}</td>
                            <td className="px-2"><Pill tone={x.ok ? 'on' : x.rows < 2 ? 'muted' : 'warn'}>{x.ok ? '✓ 저장주기대로' : x.rows < 2 ? '행 부족' : '빈틈 ' + x.gaps}</Pill></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <details>
                    <summary className="text-sm text-gray-600 cursor-pointer">최근 저장 행 {recent.length}개 보기</summary>
                    <table className="w-full text-sm mt-2">
                      <thead><tr className="text-gray-600 text-left bg-gray-50 border-y border-gray-200"><th className="py-1 px-2">시각</th><th className="px-2">센서</th><th className="px-2">값</th><th className="px-2">상태</th></tr></thead>
                      <tbody>
                        {recent.map((r, i) => (
                          <tr key={i} className="border-b border-gray-100 font-mono">
                            <td className="py-0.5 px-2">{fmt(r.timestamp)}</td><td className="px-2">#{r.idx} {r.name}</td><td className="px-2">{r.value ?? '—'}</td><td className="px-2">{r.status} <span className="text-gray-500 font-sans">{r.status_name}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                </div>
              )}
            </SubBox>
          );
        })()}

        {/* 제어기 로컬 1분 저장 (SQLite, 60일) — 패널에서만. 인터넷 없이 §5.4.4(센서)·116(구동기) 저장을 그 자리에서 보인다 (2026-09-15) */}
        {local && (() => {
          const rows = local.data || [];
          const lc = storageCheck(rows, local.intervalSec || 60);
          const fmt = (t) => new Date(t).toLocaleTimeString('ko-KR', { hour12: false });
          const isSensor = node.kind === 'sensor';
          return (
            <SubBox title={isSensor ? '§5.4.4 제어기 로컬 저장 (SQLite)' : '116 구동기 상태 1분 저장 — 제어기 로컬 (SQLite)'}
              desc="드라이버가 매분 남기는 사본, 60일 보존 — 서버가 안 닿아도 이 자리에서 확인" tone="gray"
              right={<>
                {lc.total > 0 && <Pill tone={lc.ok ? 'on' : 'warn'}>{lc.ok ? '저장주기대로' : '빈틈 있음'}</Pill>}
                <Pill tone={lc.total ? 'ok' : 'muted'}>{lc.total}행 / 60분</Pill>
              </>}>
              {local.error || local.ok === false ? (
                <p className="text-sm text-rose-700">로컬 저장소를 읽지 못했습니다: {local.error || '드라이버 응답 없음'}</p>
              ) : lc.sensors.length === 0 ? (
                <p className="text-sm text-gray-500">아직 로컬 행이 없습니다. 드라이버가 분이 바뀔 때 첫 행을 남깁니다.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-600 text-left bg-gray-50 border-y border-gray-200">
                        <th className="py-1 px-2">{isSensor ? '센서' : '디바이스'}</th><th className="px-2">저장 행</th><th className="px-2">기대(1분)</th><th className="px-2">빈틈</th><th className="px-2">상태코드 종류</th><th className="px-2">마지막</th><th className="px-2">판정</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lc.sensors.map(x => (
                        <tr key={x.idx} className="border-b border-gray-100">
                          <td className="py-1 px-2">#{x.idx} {x.name}</td>
                          <td className="px-2 font-mono">{x.rows}</td>
                          <td className="px-2 font-mono">{x.expected}</td>
                          <td className="px-2 font-mono">{x.gaps}</td>
                          <td className="px-2 font-mono">{x.statuses.join(', ')}</td>
                          <td className="px-2 font-mono">{x.last ? `${fmt(x.last.timestamp)} · ${isSensor ? (x.last.value ?? '—') : ('남은 ' + (x.last.remain ?? 0) + 's')} · ${x.last.status}` : '—'}</td>
                          <td className="px-2"><Pill tone={x.ok ? 'on' : x.rows < 2 ? 'muted' : 'warn'}>{x.ok ? '✓ 저장주기대로' : x.rows < 2 ? '행 부족' : '빈틈 ' + x.gaps}</Pill></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SubBox>
          );
        })()}

        {/* 연결된 디바이스 (§5.1.2 d·e) */}
        <SubBox title="연결된 디바이스" desc="§5.1.2 d·e — 101번지부터 채널수만큼 읽어, 연결된 것만"
          right={<>
            {kindSum.text && <span className="text-sm text-gray-700" title="§5.4.2 d) / §5.5.1 d) — 시험장비에 설정한 개수·종류와 대조">{kindSum.text}</span>}
            {codeCheck.issues > 0 && <Pill tone="bad">코드 불일치 {codeCheck.issues}건</Pill>}
            <Pill tone={rows.length ? 'ok' : 'muted'}>{rows.length}개</Pill>
          </>}>
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
                        <td className="px-3 font-mono text-gray-700">
                          {r.code}
                          {codeByIndex[r.index]?.ok === false && (
                            <span className="ml-2 inline-block px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 text-xs font-bold font-sans">표준 기대 {codeByIndex[r.index].expected}</span>
                          )}
                        </td>
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
