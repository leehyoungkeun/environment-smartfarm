import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { getApiBase, getSystemMode, onModeChange, isFarmLocalMode } from '../../services/apiSwitcher';

const PC_API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://192.168.137.1:3000/api';
const PC_HEALTH_URL = PC_API_BASE.replace(/\/api$/, '/health');
const RPI_API_BASE = import.meta.env.VITE_RPI_API_URL || 'http://192.168.137.86:1880/api';
const RPI_HEALTH_URL = RPI_API_BASE.replace(/\/api$/, '/api/health');
const AWS_CONTROL_ENDPOINT = import.meta.env.VITE_AWS_CONTROL_ENDPOINT || '';

const ServerStatus = () => {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastChecked, setLastChecked] = useState(null);
  const [awsStatus, setAwsStatus] = useState({ checked: false, connected: false, latency: null, error: null });
  const [rpiStatus, setRpiStatus] = useState({ checked: false, connected: false, latency: null, error: null });
  const [systemMode, setSystemMode] = useState(getSystemMode());

  useEffect(() => {
    const unsubscribe = onModeChange((mode) => setSystemMode(mode));
    return unsubscribe;
  }, []);

  const checkAwsHealth = useCallback(async () => {
    if (!AWS_CONTROL_ENDPOINT) {
      setAwsStatus({ checked: true, connected: false, latency: null, error: '엔드포인트 미설정' });
      return;
    }
    const start = Date.now();
    try {
      // 빈 body POST → Lambda가 400/422 등 에러를 반환해도 "연결됨"
      await axios.post(AWS_CONTROL_ENDPOINT, {}, { timeout: 5000 });
      setAwsStatus({ checked: true, connected: true, latency: Date.now() - start, error: null });
    } catch (err) {
      const elapsed = Date.now() - start;
      if (err.response) {
        // HTTP 응답이 왔다 = AWS 엔드포인트 살아있음 (400, 403, 500 등)
        setAwsStatus({ checked: true, connected: true, latency: elapsed, error: null });
      } else {
        setAwsStatus({ checked: true, connected: false, latency: null, error: err.message });
      }
    }
  }, []);

  const farmLocal = isFarmLocalMode();

  const checkRpiHealth = useCallback(async () => {
    const healthUrl = farmLocal ? (window.location.origin + '/api/health') : RPI_HEALTH_URL;
    const start = Date.now();
    try {
      const res = await axios.get(healthUrl, { timeout: 5000 });
      const latency = Date.now() - start;
      const ok = res.data?.status === 'ok' || res.data?.success === true;
      setRpiStatus({ checked: true, connected: ok, latency, error: ok ? null : '응답 이상' });
    } catch (err) {
      setRpiStatus({ checked: true, connected: false, latency: null, error: err.message });
    }
  }, []);

  const checkHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(PC_HEALTH_URL, { timeout: 5000 });
      setHealth(res.data);
      setLastChecked(new Date());
    } catch (err) {
      setError(err.message || '서버에 연결할 수 없습니다');
      setHealth(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const checkAll = useCallback(() => {
    if (farmLocal) {
      checkRpiHealth();
      return;
    }
    checkHealth();
    checkRpiHealth();
    checkAwsHealth();
  }, [farmLocal, checkHealth, checkRpiHealth, checkAwsHealth]);

  useEffect(() => {
    checkAll();
    const interval = setInterval(() => {
      if (farmLocal) { checkRpiHealth(); }
      else { checkHealth(); checkRpiHealth(); }
    }, 15000);
    return () => clearInterval(interval);
  }, [checkAll, checkHealth, checkRpiHealth, farmLocal]);

  const formatUptime = (seconds) => {
    if (!seconds) return '-';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (d > 0) return `${d}일 ${h}시간 ${m}분`;
    if (h > 0) return `${h}시간 ${m}분 ${s}초`;
    return `${m}분 ${s}초`;
  };

  const db = health?.services?.database;
  const mem = health?.services?.memory;
  const isConnected = health?.success === true;
  const isUsingRpi = systemMode.isUsingRpi;
  const modeLabel = farmLocal ? '팜로컬 운영' : systemMode.manualOverride ? '로컬 오프라인' : (isUsingRpi ? '로컬 운영' : (isConnected ? '온라인' : '연결 끊김'));

  return (
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-gray-800 tracking-tight">서버 상태</h1>
          <p className="text-gray-500 text-xs md:text-sm mt-0.5">시스템 연결 및 운영 모드 모니터링</p>
        </div>
        <button onClick={checkAll} disabled={loading}
          className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm font-medium
                     hover:bg-gray-200 transition-all active:scale-95 border border-gray-200 disabled:opacity-50">
          {loading ? '확인 중...' : '🔄 새로고침'}
        </button>
      </div>

      {/* 시스템 운영 모드 배너 */}
      <div className={`rounded-2xl p-5 border ${
        farmLocal ? 'bg-emerald-50 border-emerald-200'
        : isUsingRpi ? 'bg-blue-50 border-blue-200'
        : isConnected ? 'bg-emerald-50 border-emerald-200'
        : 'bg-rose-50 border-rose-200'
      }`}>
        <div className="flex items-center gap-4">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl ${
            farmLocal ? 'bg-emerald-100'
            : isUsingRpi ? 'bg-blue-100' : isConnected ? 'bg-emerald-100' : 'bg-rose-100'
          }`}>
            {farmLocal ? '🌿' : isUsingRpi ? '🍓' : isConnected ? '🖥️' : '❌'}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className={`text-xl font-bold ${
                farmLocal ? 'text-emerald-700'
                : isUsingRpi ? 'text-blue-700' : isConnected ? 'text-emerald-700' : 'text-rose-700'
              }`}>
                {modeLabel}
              </h2>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                farmLocal ? 'bg-emerald-200 text-emerald-700'
                : isUsingRpi ? 'bg-blue-200 text-blue-700'
                : isConnected ? 'bg-emerald-200 text-emerald-700'
                : 'bg-rose-200 text-rose-700'
              }`}>
                {farmLocal ? '팜로컬' : isUsingRpi ? '로컬 API' : isConnected ? 'PC 서버' : 'OFFLINE'}
              </span>
            </div>
            <p className={`text-sm ${
              farmLocal ? 'text-emerald-600'
              : isUsingRpi ? 'text-blue-600' : isConnected ? 'text-emerald-600' : 'text-rose-600'
            }`}>
              {farmLocal
                ? '독립 운영 모드 · 인터넷 없이 로컬 센서 데이터 운영'
                : isUsingRpi
                ? '로컬 API로 운영 중 · 서버 복구 시 자동 전환'
                : isConnected
                  ? `PC 서버 정상 · 가동시간: ${formatUptime(health?.uptime)}`
                  : error || 'PC 서버와 로컬 모두 연결할 수 없습니다'}
            </p>
            {lastChecked && (
              <p className="text-xs text-gray-400 mt-1">
                마지막 확인: {lastChecked.toLocaleTimeString('ko-KR')}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* 서버 상태 카드 */}
      <div className={`grid grid-cols-1 ${farmLocal ? '' : 'md:grid-cols-2'} gap-4`}>
        {/* PC 서버 상태 (팜로컬에서 숨김) */}
        {!farmLocal && (
          <div className={`rounded-2xl p-5 border ${isConnected
            ? 'bg-emerald-50 border-emerald-200'
            : 'bg-rose-50 border-rose-200'}`}>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-xl">{isConnected ? '✅' : '❌'}</span>
              <div>
                <h3 className={`text-base font-bold ${isConnected ? 'text-emerald-700' : 'text-rose-700'}`}>
                  PC 서버 {isConnected ? '연결됨' : '연결 실패'}
                </h3>
                <p className={`text-xs ${isConnected ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {isConnected ? `가동 ${formatUptime(health?.uptime)}` : error || '서버 미실행'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* RPi/로컬 Node-RED 상태 */}
        <div className={`rounded-2xl p-5 border ${rpiStatus.connected
          ? (farmLocal ? 'bg-emerald-50 border-emerald-200' : 'bg-blue-50 border-blue-200')
          : 'bg-gray-50 border-gray-200'}`}>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-xl">{!rpiStatus.checked ? '⏳' : rpiStatus.connected ? (farmLocal ? '🌿' : '🍓') : '⚠️'}</span>
            <div>
              <h3 className={`text-base font-bold ${rpiStatus.connected ? (farmLocal ? 'text-emerald-700' : 'text-blue-700') : 'text-gray-500'}`}>
                {farmLocal ? '팜로컬' : '로컬'} 서버 {!rpiStatus.checked ? '확인 중' : rpiStatus.connected ? '연결됨' : '연결 실패'}
              </h3>
              <p className={`text-xs ${rpiStatus.connected ? (farmLocal ? 'text-emerald-600' : 'text-blue-600') : 'text-gray-400'}`}>
                {rpiStatus.connected
                  ? `응답 ${rpiStatus.latency}ms`
                  : rpiStatus.error || '로컬 미연결'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* AWS IoT 연결 상태 카드 (팜로컬에서 숨김) */}
      {!farmLocal && <div className={`rounded-2xl p-6 border ${awsStatus.connected
        ? 'bg-amber-50 border-amber-200'
        : 'bg-gray-50 border-gray-200'}`}>
        <div className="flex items-center gap-4">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl ${awsStatus.connected
            ? 'bg-amber-100' : 'bg-gray-100'}`}>
            {!awsStatus.checked ? '⏳' : awsStatus.connected ? '☁️' : '⚠️'}
          </div>
          <div className="flex-1">
            <h2 className={`text-xl font-bold ${awsStatus.connected ? 'text-amber-700' : 'text-gray-600'}`}>
              {!awsStatus.checked ? 'AWS 확인 중...'
                : awsStatus.connected ? 'AWS IoT 연결됨'
                : !AWS_CONTROL_ENDPOINT ? 'AWS 미설정'
                : 'AWS IoT 연결 실패'}
            </h2>
            <p className={`text-sm ${awsStatus.connected ? 'text-amber-600' : 'text-gray-500'}`}>
              {awsStatus.connected
                ? `API Gateway → Lambda → MQTT`
                : awsStatus.error || 'VITE_AWS_CONTROL_ENDPOINT를 확인하세요'}
            </p>
          </div>
          {awsStatus.connected && awsStatus.latency && (
            <div className="text-right">
              <p className="text-lg font-bold font-mono text-amber-700">{awsStatus.latency}ms</p>
              <p className="text-[10px] text-amber-500">응답시간</p>
            </div>
          )}
        </div>
      </div>}

      {/* 상세 상태 카드 (PC 서버 연결 시) */}
      {isConnected && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatusCard
            label="데이터베이스"
            value={db?.prisma === 'connected' ? '정상' : '오류'}
            sub="Prisma (PostgreSQL)"
            color={db?.prisma === 'connected' ? 'text-emerald-600' : 'text-rose-600'}
            icon="🗄️"
          />
          <StatusCard
            label="TimescaleDB"
            value={db?.pool === 'connected' ? '정상' : '오류'}
            sub={`연결 ${db?.totalPoolClients || 0} / 대기 ${db?.waitingPoolClients || 0}`}
            color={db?.pool === 'connected' ? 'text-emerald-600' : 'text-rose-600'}
            icon="📊"
          />
          <StatusCard
            label="메모리 사용"
            value={mem?.used || '-'}
            sub={`전체 ${mem?.total || '-'}`}
            color="text-blue-600"
            icon="💾"
          />
          <StatusCard
            label="가동 시간"
            value={formatUptime(health.uptime)}
            sub="서버 시작 후"
            color="text-violet-600"
            icon="⏱️"
          />
          <StatusCard
            label="AWS IoT"
            value={awsStatus.connected ? '정상' : '오류'}
            sub="MQTT 제어 채널"
            color={awsStatus.connected ? 'text-amber-600' : 'text-rose-600'}
            icon="☁️"
          />
        </div>
      )}

      {/* 연결 정보 */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5">
        <h3 className="text-base font-bold text-gray-800 mb-4">🔗 연결 정보</h3>
        <div className="space-y-3">
          <InfoRow label="현재 활성 API" value={getApiBase()} highlight />
          {!farmLocal && <InfoRow label="PC 서버" value={PC_API_BASE} />}
          {!farmLocal && <InfoRow label="로컬 서버" value={RPI_API_BASE} />}
          {!farmLocal && <InfoRow label="AWS 제어 엔드포인트" value={AWS_CONTROL_ENDPOINT || '미설정'} />}
          {farmLocal && <InfoRow label="운영 모드" value="팜로컬 (독립 운영)" />}
          {isConnected && health?.timestamp && (
            <InfoRow label="서버 시간"
              value={new Date(health.timestamp).toLocaleString('ko-KR')} />
          )}
        </div>
      </div>

      {/* 빠른 링크 */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5">
        <h3 className="text-base font-bold text-gray-800 mb-4">🚀 빠른 링크</h3>
        <div className={`grid grid-cols-1 ${farmLocal ? 'md:grid-cols-2' : 'md:grid-cols-3'} gap-3`}>
          {!farmLocal && (
            <QuickLink
              label="PC Health"
              desc="PC 서버 상태 JSON"
              url={PC_HEALTH_URL}
              icon="💚"
            />
          )}
          <QuickLink
            label={farmLocal ? '팜로컬 Health' : '로컬 Health'}
            desc={farmLocal ? '팜로컬 서버 상태' : '로컬 서버 상태'}
            url={farmLocal ? (window.location.origin + '/api/health') : RPI_HEALTH_URL}
            icon={farmLocal ? '🌿' : '🍓'}
          />
          <QuickLink
            label="Node-RED"
            desc="센서 수집 플로우 편집"
            url={farmLocal ? (window.location.origin + '/node-red') : 'http://192.168.137.86:1880/node-red'}
            icon="🔴"
          />
        </div>
      </div>

      {/* 연결 실패 시 가이드 (RPi 운영 중이거나 팜로컬이면 숨김) */}
      {!farmLocal && !isConnected && !isUsingRpi && !loading && (
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h3 className="text-base font-bold text-gray-800 mb-4">🔧 문제 해결</h3>
          <div className="space-y-3 text-sm text-gray-600">
            <div className="flex items-start gap-3 bg-gray-50 rounded-xl p-4">
              <span className="text-lg">1️⃣</span>
              <div>
                <p className="font-medium text-gray-800">백엔드 서버 실행 확인</p>
                <code className="text-xs bg-gray-200 px-2 py-0.5 rounded mt-1 inline-block">cd backend && npm run dev</code>
              </div>
            </div>
            <div className="flex items-start gap-3 bg-gray-50 rounded-xl p-4">
              <span className="text-lg">2️⃣</span>
              <div>
                <p className="font-medium text-gray-800">환경변수 확인</p>
                <code className="text-xs bg-gray-200 px-2 py-0.5 rounded mt-1 inline-block">VITE_API_BASE_URL={PC_API_BASE}</code>
              </div>
            </div>
            <div className="flex items-start gap-3 bg-gray-50 rounded-xl p-4">
              <span className="text-lg">3️⃣</span>
              <div>
                <p className="font-medium text-gray-800">PostgreSQL 실행 확인</p>
                <code className="text-xs bg-gray-200 px-2 py-0.5 rounded mt-1 inline-block">psql -U smartfarm -d smartfarm_db -c "SELECT 1"</code>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StatusCard = ({ label, value, sub, color, icon }) => (
  <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
    <div className="flex items-center justify-between mb-2">
      <span className="text-xs text-gray-500 font-medium">{label}</span>
      <span className="text-lg">{icon}</span>
    </div>
    <div className={`text-lg font-bold font-mono ${color}`}>{value}</div>
    <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>
  </div>
);

const InfoRow = ({ label, value, highlight }) => (
  <div className={`flex items-center justify-between rounded-lg px-4 py-2.5 border ${
    highlight ? 'bg-blue-50 border-blue-200' : 'bg-gray-50 border-gray-100'
  }`}>
    <span className={`text-sm ${highlight ? 'text-blue-600 font-bold' : 'text-gray-500'}`}>{label}</span>
    <code className={`text-sm font-mono ${highlight ? 'text-blue-800 font-bold' : 'text-gray-800'}`}>{value}</code>
  </div>
);

const QuickLink = ({ label, desc, url, icon }) => (
  <a href={url} target="_blank" rel="noopener noreferrer"
    className="flex items-center gap-3 bg-gray-50 rounded-xl p-4 border border-gray-200
               hover:bg-blue-50 hover:border-blue-200 transition-all group">
    <span className="text-2xl">{icon}</span>
    <div>
      <p className="text-sm font-medium text-gray-800 group-hover:text-blue-600">{label}</p>
      <p className="text-xs text-gray-400">{desc}</p>
    </div>
    <span className="ml-auto text-gray-300 group-hover:text-blue-400">→</span>
  </a>
);

export default ServerStatus;
