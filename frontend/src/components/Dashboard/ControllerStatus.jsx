import React, { useState, useEffect, useCallback } from 'react';
import axiosBase from 'axios';
import { getApiBase } from '../../services/apiSwitcher';

// ━━━ 제어기 상태 (2026-10-07) ━━━
// 「서버」 화면에서 제어기(RPi) 안에서 도는 것들을 본다: pm2 앱 · 자가복구 유닛 · 자가점검 · USB-485 포트 · 온도/메모리/디스크.
// 10/07 아침 — 프로세스 8개가 멀쩡히 돌고 수집도 되는데 pm2-lhk 유닛은 영영 「기동 중」이었다. 겉으로는 정상이라
// 점검 스크립트 한 줄로만 드러났다. 그 점검을 화면에 올린다.
// 패널(localhost)은 같은 출처 /api/controller/status (nginx 루프백 전용, 인터넷·JWT 불필요),
// 웹은 클라우드 백엔드 /config/:farmId/controller-status → Tailscale → rpi-server.

const axios = axiosBase.create();
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 이름만 보고는 뭔지 모르는 것들 — 사람이 읽는 설명
const PM2_ROLE = {
  'node-red': '센서 수집 · 릴레이 제어 · 자동화 · 클라우드 MQTT',
  'smartfarm-rpi': '로컬 API (키오스크 · 설정 · 제어 이력 동기화)',
  'smartfarm-system': '시스템 API (WiFi 전환 · 재부팅)',
  'ks3267d': 'KS X 3267 표준노드 드라이버',
  'ks3267-sim': '표준노드 시뮬레이터 (검정용 — 검정 뒤 제거)',
  'go2rtc': 'CCTV 스트림',
  'd16-display': 'LED 전광판',
  'pm2-logrotate': 'pm2 로그 회전',
};
const UNIT_LABEL = {
  'pm2-lhk.service': 'pm2 (앱 8개 되살리기)',
  'smartfarm-pm2-guard.timer': 'pm2 가드 (60초 감시)',
  'smartfarm-nr-patches.service': 'Node-RED 패치',
  'smartfarm-pm2-start.service': 'pm2 start all (트랩 7)',
  'smartfarm-firewall.service': '방화벽',
  'nginx.service': 'nginx (키오스크 · API 프록시)',
  'mosquitto.service': '로컬 MQTT',
  'tailscaled.service': 'Tailscale (원격 관리)',
  'cloudflared.service': 'CCTV 터널',
  'promtail.service': '로그 전송 (Loki)',
  'NetworkManager.service': '네트워크 (WiFi)',
  'lightdm.service': '키오스크 화면',
  'ssh.service': 'SSH',
};

const fmtAgo = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) return '-';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}시간 ${m % 60}분`;
  return `${Math.floor(h / 24)}일 ${h % 24}시간`;
};
const fmtBytes = (b) => (Number.isFinite(b) ? (b >= 1 << 30 ? `${(b / (1 << 30)).toFixed(1)} GB` : `${Math.round(b / (1 << 20))} MB`) : '-');

const Pill = ({ tone, children, title }) => {
  const cls = {
    ok: 'bg-emerald-100 text-emerald-800', warn: 'bg-amber-100 text-amber-800', bad: 'bg-rose-100 text-rose-800',
    muted: 'bg-gray-100 text-gray-500', info: 'bg-sky-100 text-sky-800',
  }[tone] || 'bg-gray-100 text-gray-500';
  return <span title={title} className={`inline-block px-2 py-0.5 rounded-md text-xs font-bold ${cls}`}>{children}</span>;
};

const unitTone = (u) => (u.active === 'active' ? 'ok' : u.active === 'activating' ? 'warn' : u.active === 'failed' ? 'bad' : 'muted');
const unitWord = (u) => (u.active === 'active' ? (u.sub === 'exited' ? '완료' : u.sub === 'waiting' ? '대기' : '동작') : u.active === 'activating' ? '기동 중' : u.active === 'failed' ? '실패' : '꺼짐');

const ControllerStatus = ({ farmId }) => {
  const api = getApiBase();
  const onPanel = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fetchedAt, setFetchedAt] = useState(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = onPanel
        ? await axios.get('/api/controller/status', { timeout: 30000 })
        : await axios.get(`${api}/config/${farmId}/controller-status`, { timeout: 30000 });
      if (r.data?.ok) { setData(r.data); setError(null); }
      else { setError(r.data?.error || '제어기가 응답하지 않습니다'); }
      setFetchedAt(new Date());
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setFetchedAt(new Date());
    } finally { setLoading(false); }
  }, [api, farmId, onPanel]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const c = data?.controller;
  const check = data?.check;
  const pm2 = data?.pm2 || [];
  const online = pm2.filter((p) => p.status === 'online').length;
  const fails = check?.items?.filter((i) => !i.ok) || [];
  const stuck = (data?.units || []).filter((u) => u.active === 'activating' || u.active === 'failed');
  const headTone = !data ? 'gray' : (fails.length || stuck.length || online < pm2.length) ? 'amber' : 'emerald';

  return (
    <div className={`rounded-2xl border overflow-hidden ${
      headTone === 'emerald' ? 'bg-emerald-50 border-emerald-200' : headTone === 'amber' ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
      {/* 머리 — 제어기 한 줄 요약 */}
      <div className="flex flex-wrap items-center gap-4 p-5">
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl ${
          headTone === 'emerald' ? 'bg-emerald-100' : headTone === 'amber' ? 'bg-amber-100' : 'bg-gray-100'}`}>
          {!data && !error ? '⏳' : error ? '❌' : headTone === 'amber' ? '⚠️' : '🧰'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className={`text-xl font-bold ${headTone === 'emerald' ? 'text-emerald-700' : headTone === 'amber' ? 'text-amber-700' : 'text-gray-600'}`}>
              제어기 {error ? '연결 실패' : !data ? '확인 중' : headTone === 'amber' ? '점검 필요' : '정상'}
            </h2>
            {c && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/70 text-gray-600 border border-gray-200">{c.farmId || farmId} · {c.hostname}</span>}
          </div>
          <p className={`text-sm ${error ? 'text-rose-600' : 'text-gray-600'}`}>
            {error ? error
              : !c ? '제어기 상태를 읽는 중'
              : <>부팅 {fmtAgo(c.uptimeSec * 1000)} 전 · 앱 {online}/{pm2.length} 동작 · 자가점검 {check ? `${check.pass}/${check.pass + check.fail} 통과` : '-'}
                {check?.lastSensorAgeSec != null && <> · 마지막 센서 값 {check.lastSensorAgeSec}초 전</>}</>}
          </p>
          {fetchedAt && <p className="text-xs text-gray-400 mt-1">마지막 확인: {fetchedAt.toLocaleTimeString('ko-KR')}{c?.at ? ` · 제어기 시각 ${new Date(data.at).toLocaleTimeString('ko-KR')}` : ''}</p>}
        </div>
        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 bg-white text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-100 border border-gray-200 disabled:opacity-50">
          {loading ? '확인 중...' : '🔄 다시 읽기'}
        </button>
      </div>

      {c && (
        <div className="bg-white border-t border-gray-200 p-5 space-y-5">
          {/* 하드웨어 한 줄 */}
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <Stat label="온도" value={c.tempC != null ? `${c.tempC}°C` : '-'} tone={c.tempC >= 75 ? 'bad' : c.tempC >= 65 ? 'warn' : 'ok'}
              sub={c.throttled?.now?.length ? `지금: ${c.throttled.now.join(', ')}` : c.throttled?.past?.length ? `부팅 뒤 있었음: ${c.throttled.past.join(', ')}` : '스로틀 없음'} />
            <Stat label="부하 (1·5·15분)" value={c.load?.join(' · ') || '-'} tone={c.load?.[0] > c.cpus ? 'warn' : 'ok'} sub={`${c.cpus} 코어`} />
            <Stat label="메모리 여유" value={fmtBytes(c.mem?.available)} tone={c.mem?.available < 300 * (1 << 20) ? 'warn' : 'ok'} sub={`전체 ${fmtBytes(c.mem?.total)}`} />
            <Stat label="SD 카드 여유" value={fmtBytes(c.disk?.avail)} tone={c.disk && c.disk.avail / c.disk.size < 0.1 ? 'bad' : 'ok'} sub={c.disk ? `${Math.round(c.disk.used / c.disk.size * 100)}% 사용` : '-'} />
            <Stat label="USB-485" value={data.ports?.vendor ? data.ports.vendor : '없음'} tone={data.ports?.vendor ? 'ok' : 'bad'} sub={`표준노드: ${data.ports?.standard || '없음'}`} />
            <Stat label="주소" value={c.ipv4 || '-'} tone="info" sub={c.tailscaleIp ? `Tailscale ${c.tailscaleIp}` : 'Tailscale 없음'} />
          </div>

          {/* pm2 앱 */}
          <div>
            <h4 className="text-sm font-bold text-gray-800 mb-2">pm2 앱 {online}/{pm2.length} 동작</h4>
            <div className="overflow-x-auto rounded-xl border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr><th className="text-left px-3 py-2">이름</th><th className="text-left px-3 py-2">하는 일</th><th className="px-3 py-2">상태</th><th className="px-3 py-2">가동</th><th className="px-3 py-2">재시작</th><th className="px-3 py-2">CPU</th><th className="px-3 py-2">메모리</th></tr>
                </thead>
                <tbody>
                  {pm2.map((p) => (
                    <tr key={p.name} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-mono font-bold text-gray-800">{p.name}</td>
                      <td className="px-3 py-2 text-gray-600">{PM2_ROLE[p.name] || p.script}</td>
                      <td className="px-3 py-2 text-center"><Pill tone={p.status === 'online' ? 'ok' : p.status === 'stopped' ? 'muted' : 'bad'}>{p.status === 'online' ? '동작' : p.status === 'stopped' ? '정지' : p.status}</Pill></td>
                      <td className="px-3 py-2 text-center font-mono text-gray-700">{p.upSince ? fmtAgo(Date.now() - p.upSince) : '-'}</td>
                      <td className={`px-3 py-2 text-center font-mono ${p.restarts > 5 ? 'text-amber-700 font-bold' : 'text-gray-700'}`}>{p.restarts}</td>
                      <td className="px-3 py-2 text-center font-mono text-gray-700">{p.cpu != null ? `${p.cpu}%` : '-'}</td>
                      <td className="px-3 py-2 text-center font-mono text-gray-700">{fmtBytes(p.memory)}</td>
                    </tr>
                  ))}
                  {pm2.length === 0 && <tr><td colSpan={7} className="px-3 py-3 text-center text-gray-400">pm2 목록을 읽지 못했습니다</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* systemd 유닛 */}
          <div>
            <h4 className="text-sm font-bold text-gray-800 mb-2">자가복구 · 바탕 서비스</h4>
            <div className="flex flex-wrap gap-2">
              {(data.units || []).map((u) => (
                <span key={u.id} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs"
                  title={`${u.id} · ${u.active}/${u.sub} · ${u.enabled}${u.since ? ` · ${u.since}` : ''}${u.restarts ? ` · 재시작 ${u.restarts}` : ''}`}>
                  <span className="text-gray-700">{UNIT_LABEL[u.id] || u.id}</span>
                  <Pill tone={unitTone(u)}>{unitWord(u)}</Pill>
                  {u.enabled !== 'enabled' && u.enabled !== 'static' && <Pill tone="warn">부팅 자동시작 아님</Pill>}
                </span>
              ))}
            </div>
            {stuck.length > 0 && (
              <p className="text-xs text-amber-700 mt-2">
                ⚠ {stuck.map((u) => UNIT_LABEL[u.id] || u.id).join(', ')} — 「기동 중」이 몇 분 넘게 이어지면 유닛이 굳은 것입니다. 60초 가드가 되살리지 못하면 제어기를 다시 켜십시오.
              </p>
            )}
          </div>

          {/* 자가점검 */}
          {check && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h4 className="text-sm font-bold text-gray-800">자가점검</h4>
                <Pill tone={check.fail ? 'bad' : 'ok'}>통과 {check.pass} · 실패 {check.fail}</Pill>
                <button onClick={() => setShowAll((v) => !v)} className="text-xs text-blue-600 hover:underline ml-auto">{showAll ? '실패만' : '전체 보기'}</button>
              </div>
              <ul className="space-y-1">
                {(showAll ? check.items : fails).map((it, i) => (
                  <li key={i} className={`text-sm flex items-start gap-2 ${it.ok ? 'text-gray-600' : 'text-rose-700 font-medium'}`}>
                    <span>{it.ok ? '✅' : '❌'}</span><span>{it.label}<span className="text-xs text-gray-400 ml-2">{it.section}</span></span>
                  </li>
                ))}
                {!showAll && fails.length === 0 && <li className="text-sm text-emerald-700">모든 항목 통과 — pm2 되살리기 · 가드 · USB 복구 · 헬스체크 · 수집까지 전부 켜져 있습니다.</li>}
              </ul>
            </div>
          )}

          {/* 최근 자가복구 활동 */}
          {data.recent && (
            <div>
              <h4 className="text-sm font-bold text-gray-800 mb-2">최근 활동 (제어기 로그 마지막 줄)</h4>
              <div className="space-y-1 font-mono text-xs text-gray-600">
                {[['Modbus 헬스체크', data.recent.healthcheck], ['pm2 가드', data.recent.guard], ['USB-485', data.recent.usb]].map(([k, v]) => (
                  <div key={k} className="flex gap-2"><span className="w-28 shrink-0 text-gray-400">{k}</span><span className="break-all">{v || '(기록 없음)'}</span></div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const Stat = ({ label, value, sub, tone }) => {
  const color = { ok: 'text-emerald-700', warn: 'text-amber-700', bad: 'text-rose-700', info: 'text-sky-700' }[tone] || 'text-gray-700';
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
      <p className="text-[11px] text-gray-500 font-medium">{label}</p>
      <p className={`text-base font-bold font-mono ${color}`}>{value}</p>
      <p className="text-[10px] text-gray-400 mt-0.5 truncate" title={sub}>{sub}</p>
    </div>
  );
};

export default ControllerStatus;
