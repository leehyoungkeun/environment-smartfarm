// src/components/AI/AIManager.jsx
// AI 농업 도우미 - 병해충 진단, 생육 예측, 작업 추천, 농업 상담
import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3000/api";
const FarmIdCtx = createContext("farm_001");

function getToken() { return localStorage.getItem("accessToken"); }
async function api(path, options = {}) {
  const token = getToken();
  const headers = { Authorization: `Bearer ${token}`, ...options.headers };
  if (!(options.body instanceof FormData)) headers["Content-Type"] = "application/json";
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "요청 실패");
  return data;
}

// ━━━ 메인 ━━━
export default function AIManager({ farmId = "farm_001" }) {
  const [activeTab, setActiveTab] = useState("pest");
  const tabs = [
    { key: "pest", label: "병해충 진단", icon: "🔬" },
    { key: "growth", label: "생육 예측", icon: "🌱" },
    { key: "task", label: "작업 추천", icon: "📋" },
    { key: "chat", label: "AI 상담", icon: "💬" },
  ];

  return (
    <FarmIdCtx.Provider value={farmId}>
    <div className="max-w-7xl mx-auto px-4 md:px-6 py-4 md:py-6 space-y-5">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-gray-800 tracking-tight">🤖 AI 농업 도우미</h1>
        <p className="text-gray-500 text-xs md:text-sm mt-0.5">인공지능 기반 스마트팜 분석 및 상담</p>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2.5 px-4 md:px-5 py-2.5 rounded-xl font-medium
                       whitespace-nowrap transition-all duration-200 text-sm flex-shrink-0
                       active:scale-[0.97] ${activeTab === tab.key
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
              : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 shadow-sm'}`}>
            <span className="text-base">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
      {activeTab === "pest" && <PestAnalysis />}
      {activeTab === "growth" && <GrowthPrediction />}
      {activeTab === "task" && <TaskRecommendation />}
      {activeTab === "chat" && <AIChat />}
    </div>
    </FarmIdCtx.Provider>
  );
}

// ━━━ 로딩 스피너 ━━━
function AILoading({ text }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="relative w-16 h-16 mb-4">
        <div className="absolute inset-0 border-4 border-emerald-500/20 rounded-full"></div>
        <div className="absolute inset-0 border-4 border-transparent border-t-emerald-500 rounded-full animate-spin"></div>
        <span className="absolute inset-0 flex items-center justify-center text-2xl">🤖</span>
      </div>
      <p className="text-gray-400 text-sm animate-pulse">{text || "AI가 분석 중입니다..."}</p>
    </div>
  );
}

// ━━━ 신뢰도 뱃지 ━━━
function ConfidenceBadge({ level }) {
  const colors = { "높음": "bg-emerald-500/20 text-emerald-400", "중간": "bg-yellow-500/20 text-yellow-400", "낮음": "bg-red-500/20 text-red-400" };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[level] || colors["중간"]}`}>{level}</span>;
}

// ━━━ 긴급도 뱃지 ━━━
function UrgencyBadge({ level }) {
  const colors = { "긴급": "bg-red-500/20 text-red-400 ring-1 ring-red-500/30", "주의": "bg-yellow-500/20 text-yellow-400", "관찰": "bg-blue-500/20 text-blue-400" };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[level] || ""}`}>{level}</span>;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. 병해충 사진 분석
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function PestAnalysis() {
  const FARM_ID = useContext(FarmIdCtx);
  const [photo, setPhoto] = useState(null);
  const [preview, setPreview] = useState(null);
  const [cropName, setCropName] = useState("");
  const [symptoms, setSymptoms] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const fileRef = useRef();

  useEffect(() => {
    api(`/ai/${FARM_ID}/pest-analysis`).then(r => setHistory(r.data || [])).catch(() => {});
  }, []);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
    setResult(null); setError(null);
  };

  const handleAnalyze = async () => {
    if (!photo) { setError("사진을 먼저 업로드해주세요"); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      const fd = new FormData();
      fd.append("photo", photo);
      if (cropName) fd.append("cropName", cropName);
      if (symptoms) fd.append("symptoms", symptoms);
      const res = await api(`/ai/${FARM_ID}/pest-analysis`, { method: "POST", body: fd });
      setResult(res.data);
      // 이력 갱신
      api(`/ai/${FARM_ID}/pest-analysis`).then(r => setHistory(r.data || [])).catch(() => {});
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  const reset = () => { setPhoto(null); setPreview(null); setCropName(""); setSymptoms(""); setResult(null); setError(null); if (fileRef.current) fileRef.current.value = ""; };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* 업로드 영역 */}
      <div className="lg:col-span-1 space-y-4">
        <div className="glass-card p-5">
          <h3 className="text-lg font-semibold text-white mb-4">🔬 병해충 사진 분석</h3>
          {/* 사진 업로드 */}
          <div className="mb-4">
            {preview ? (
              <div className="relative">
                <img src={preview} alt="업로드 사진" className="w-full h-48 object-cover rounded-lg border border-white/10" />
                <button onClick={reset} className="absolute top-2 right-2 bg-red-500 text-white text-xs w-6 h-6 rounded-full flex items-center justify-center">×</button>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center w-full h-48 border-2 border-dashed border-white/20 rounded-lg cursor-pointer hover:border-emerald-400/50 transition-colors bg-white/[0.02]">
                <span className="text-4xl mb-2">📸</span>
                <span className="text-sm text-gray-400">사진을 업로드하세요</span>
                <span className="text-xs text-gray-600 mt-1">작물 잎, 줄기, 열매 등</span>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={handleFileChange} className="hidden" />
              </label>
            )}
          </div>
          {/* 추가 정보 */}
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-400 mb-1 block">작물명</label>
              <input type="text" value={cropName} onChange={e => setCropName(e.target.value)} placeholder="예: 토마토, 고추, 상추" className="input-field text-sm w-full" />
            </div>
            <div>
              <label className="text-xs text-gray-400 mb-1 block">증상 설명 (선택)</label>
              <textarea value={symptoms} onChange={e => setSymptoms(e.target.value)} placeholder="잎이 노랗게 변했어요..." rows={2} className="input-field text-sm w-full resize-none" />
            </div>
          </div>
          <button onClick={handleAnalyze} disabled={loading || !photo}
            className="w-full mt-4 py-3 rounded-lg font-medium text-sm bg-gradient-to-r from-red-500 to-orange-500 text-white hover:opacity-90 transition-all disabled:opacity-40">
            {loading ? "⏳ 분석 중..." : "🔍 AI 분석 시작"}
          </button>
        </div>

        {/* 분석 이력 */}
        {history.length > 0 && (
          <div className="glass-card p-4">
            <h4 className="text-xs font-medium text-gray-400 mb-3">최근 분석 이력</h4>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {history.slice(0, 10).map((h, i) => (
                <div key={i} className="flex items-center gap-2 text-xs bg-white/5 rounded-lg p-2 cursor-pointer hover:bg-white/10" onClick={() => setResult(typeof h.result === "string" ? JSON.parse(h.result) : h.result)}>
                  <span className="text-gray-500">{new Date(h.created_at).toLocaleDateString("ko-KR")}</span>
                  <span className="text-gray-300 truncate flex-1">{h.crop_name || "미지정"}</span>
                  <span className="text-emerald-400">{(typeof h.result === "string" ? JSON.parse(h.result) : h.result)?.diagnosis || ""}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 결과 영역 */}
      <div className="lg:col-span-2">
        {loading && <AILoading text="병해충을 분석하고 있습니다..." />}
        {error && <div className="glass-card p-6 text-center"><p className="text-red-400">❌ {error}</p><p className="text-xs text-gray-500 mt-2">AI 서버가 실행 중인지 확인해주세요 (Ollama 등)</p></div>}
        {result && !loading && <PestResult data={result} />}
        {!result && !loading && !error && (
          <div className="glass-card p-12 text-center">
            <span className="text-6xl block mb-4">🔬</span>
            <p className="text-gray-400">작물 사진을 업로드하면<br/>AI가 병해충을 진단합니다</p>
            <p className="text-xs text-gray-600 mt-3">사진이 선명할수록 정확도가 높아집니다</p>
          </div>
        )}
      </div>
    </div>
  );
}

function PestResult({ data }) {
  if (data.raw && !data.diagnosis) return <div className="glass-card p-5"><p className="text-sm text-gray-300 whitespace-pre-wrap">{data.raw}</p></div>;
  return (
    <div className="space-y-4">
      {/* 진단 헤더 */}
      <div className="glass-card p-5 bg-gradient-to-br from-red-500/5 to-orange-500/5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-xl font-bold text-white">{data.diagnosis || "진단 결과"}</h3>
            <div className="flex gap-2 mt-2">
              {data.confidence && <ConfidenceBadge level={data.confidence} />}
              {data.urgency && <UrgencyBadge level={data.urgency} />}
            </div>
          </div>
          <span className="text-4xl">🦠</span>
        </div>
        {data.cause && <p className="text-sm text-gray-300 mt-2">{data.cause}</p>}
      </div>

      {/* 증상 */}
      {data.symptoms?.length > 0 && (
        <div className="glass-card p-4">
          <h4 className="text-sm font-semibold text-white mb-2">🔎 증상</h4>
          <div className="flex flex-wrap gap-2">{data.symptoms.map((s, i) => <span key={i} className="px-3 py-1 rounded-full text-xs bg-orange-500/10 text-orange-400">{s}</span>)}</div>
        </div>
      )}

      {/* 방제법 */}
      {data.treatment?.length > 0 && (
        <div className="glass-card p-4">
          <h4 className="text-sm font-semibold text-white mb-3">💊 방제법</h4>
          <div className="space-y-2">{data.treatment.map((t, i) => (
            <div key={i} className="flex items-start gap-3 bg-white/5 rounded-lg p-3">
              <span className="text-emerald-400 font-bold text-sm mt-0.5">{i + 1}</span>
              <p className="text-sm text-gray-300">{t}</p>
            </div>
          ))}</div>
        </div>
      )}

      {/* 예방법 */}
      {data.prevention?.length > 0 && (
        <div className="glass-card p-4">
          <h4 className="text-sm font-semibold text-white mb-3">🛡️ 예방법</h4>
          <div className="space-y-2">{data.prevention.map((p, i) => (
            <div key={i} className="flex items-start gap-3 bg-white/5 rounded-lg p-3">
              <span className="text-blue-400">•</span>
              <p className="text-sm text-gray-300">{p}</p>
            </div>
          ))}</div>
        </div>
      )}

      {/* 추가 정보 */}
      {data.additionalInfo && (
        <div className="glass-card p-4">
          <h4 className="text-sm font-semibold text-white mb-2">📌 참고 사항</h4>
          <p className="text-sm text-gray-400">{data.additionalInfo}</p>
        </div>
      )}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. 생육 예측
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function GrowthPrediction() {
  const FARM_ID = useContext(FarmIdCtx);
  const [form, setForm] = useState({ cropName: "", plantingDate: "", growthStage: "" });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const stages = ["발아기", "생장기", "개화기", "착과기", "수확기"];

  const handlePredict = async () => {
    if (!form.cropName) { setError("작물명을 입력해주세요"); return; }
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await api(`/ai/${FARM_ID}/growth-prediction`, { method: "POST", body: JSON.stringify(form) });
      setResult(res.data);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-1">
        <div className="glass-card p-5 space-y-4">
          <h3 className="text-lg font-semibold text-white">🌱 생육 예측</h3>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">작물명 *</label>
            <input type="text" value={form.cropName} onChange={e => set("cropName", e.target.value)} placeholder="예: 토마토" className="input-field text-sm w-full" />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">정식일</label>
            <input type="date" value={form.plantingDate} onChange={e => set("plantingDate", e.target.value)} className="input-field text-sm w-full" />
          </div>
          <div>
            <label className="text-xs text-gray-400 mb-1 block">현재 생육단계</label>
            <select value={form.growthStage} onChange={e => set("growthStage", e.target.value)} className="input-field jrn-select text-sm w-full">
              <option value="">선택</option>{stages.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <button onClick={handlePredict} disabled={loading || !form.cropName}
            className="w-full py-3 rounded-lg font-medium text-sm bg-gradient-to-r from-green-500 to-emerald-500 text-white hover:opacity-90 disabled:opacity-40">
            {loading ? "⏳ 예측 중..." : "🌱 생육 예측"}
          </button>
          <p className="text-xs text-gray-600">최근 7일 센서 데이터 + 영농일지를 자동 분석합니다</p>
        </div>
      </div>
      <div className="lg:col-span-2">
        {loading && <AILoading text="센서 데이터를 분석하고 있습니다..." />}
        {error && <div className="glass-card p-6 text-center text-red-400">❌ {error}</div>}
        {result && !loading && <GrowthResult data={result} />}
        {!result && !loading && !error && (
          <div className="glass-card p-12 text-center">
            <span className="text-6xl block mb-4">🌱</span>
            <p className="text-gray-400">작물 정보를 입력하면<br/>센서 데이터 기반 생육을 예측합니다</p>
          </div>
        )}
      </div>
    </div>
  );
}

function GrowthResult({ data }) {
  if (data.raw) return <div className="glass-card p-5"><p className="text-sm text-gray-300 whitespace-pre-wrap">{data.raw}</p></div>;
  return (
    <div className="space-y-4">
      {/* 점수 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="glass-card p-4 text-center">
          <p className="text-xs text-gray-500">생육단계</p>
          <p className="text-lg font-bold text-emerald-400 mt-1">{data.currentStage || "-"}</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-xs text-gray-500">건강점수</p>
          <p className={`text-2xl font-bold mt-1 ${(data.healthScore || 0) >= 70 ? "text-emerald-400" : (data.healthScore || 0) >= 40 ? "text-yellow-400" : "text-red-400"}`}>{data.healthScore || "-"}<span className="text-sm text-gray-500">/100</span></p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-xs text-gray-500">예상 수확일</p>
          <p className="text-lg font-bold text-blue-400 mt-1">{data.estimatedHarvestDate || "-"}</p>
        </div>
        <div className="glass-card p-4 text-center">
          <p className="text-xs text-gray-500">수확까지</p>
          <p className="text-2xl font-bold text-yellow-400 mt-1">{data.daysToHarvest || "-"}<span className="text-sm text-gray-500">일</span></p>
        </div>
      </div>

      {data.riskFactors?.length > 0 && (
        <div className="glass-card p-4">
          <h4 className="text-sm font-semibold text-white mb-2">⚠️ 위험 요소</h4>
          <div className="flex flex-wrap gap-2">{data.riskFactors.map((r, i) => <span key={i} className="px-3 py-1 rounded-full text-xs bg-red-500/10 text-red-400">{r}</span>)}</div>
        </div>
      )}

      {data.recommendations?.length > 0 && (
        <div className="glass-card p-4">
          <h4 className="text-sm font-semibold text-white mb-3">💡 권장 사항</h4>
          <div className="space-y-2">{data.recommendations.map((r, i) => (
            <div key={i} className="flex items-start gap-3 bg-white/5 rounded-lg p-3">
              <span className="text-emerald-400 font-bold text-sm">{i + 1}</span>
              <p className="text-sm text-gray-300">{r}</p>
            </div>
          ))}</div>
        </div>
      )}

      {data.optimalConditions && (
        <div className="glass-card p-4">
          <h4 className="text-sm font-semibold text-white mb-2">🌡️ 적정 환경</h4>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/5 rounded-lg p-3"><p className="text-xs text-gray-500">적정 온도</p><p className="text-sm text-white mt-1">{data.optimalConditions.temperature || "-"}</p></div>
            <div className="bg-white/5 rounded-lg p-3"><p className="text-xs text-gray-500">적정 습도</p><p className="text-sm text-white mt-1">{data.optimalConditions.humidity || "-"}</p></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. AI 작업 추천
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function TaskRecommendation() {
  const FARM_ID = useContext(FarmIdCtx);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleFetch = async () => {
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await api(`/ai/${FARM_ID}/task-recommendation`);
      setResult(res.data);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  const priorityColors = { "높음": "border-l-red-500 bg-red-500/5", "중간": "border-l-yellow-500 bg-yellow-500/5", "낮음": "border-l-blue-500 bg-blue-500/5" };
  const priorityBadge = { "높음": "bg-red-500/20 text-red-400", "중간": "bg-yellow-500/20 text-yellow-400", "낮음": "bg-blue-500/20 text-blue-400" };
  const categoryIcons = { "관수": "💧", "시비": "🧪", "방제": "🛡️", "수확": "🌾", "관리": "🔧", "점검": "🔍" };

  return (
    <div className="space-y-4">
      <div className="glass-card p-5 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">📋 AI 오늘의 작업 추천</h3>
          <p className="text-xs text-gray-500 mt-1">센서 데이터, 영농일지, 투입물 기록을 종합 분석합니다</p>
        </div>
        <button onClick={handleFetch} disabled={loading}
          className="px-6 py-3 rounded-lg font-medium text-sm bg-gradient-to-r from-blue-500 to-cyan-500 text-white hover:opacity-90 disabled:opacity-40">
          {loading ? "⏳ 분석 중..." : "📋 추천 받기"}
        </button>
      </div>

      {loading && <AILoading text="오늘의 작업을 분석하고 있습니다..." />}
      {error && <div className="glass-card p-6 text-center text-red-400">❌ {error}</div>}

      {result && !loading && (
        <div className="space-y-4">
          {result.weather_summary && (
            <div className="glass-card p-4 bg-gradient-to-r from-blue-500/5 to-cyan-500/5">
              <p className="text-sm text-gray-300">🌤️ {result.weather_summary}</p>
            </div>
          )}

          {result.tasks?.length > 0 && (
            <div className="space-y-3">
              {result.tasks.map((task, i) => (
                <div key={i} className={`glass-card p-4 border-l-4 ${priorityColors[task.priority] || ""}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">{categoryIcons[task.category] || "📌"}</span>
                        <h4 className="text-sm font-semibold text-white">{task.title}</h4>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${priorityBadge[task.priority] || ""}`}>{task.priority}</span>
                      </div>
                      <p className="text-sm text-gray-300 mt-1">{task.description}</p>
                      {task.reason && <p className="text-xs text-gray-500 mt-2">💡 {task.reason}</p>}
                    </div>
                    {task.timing && <span className="text-xs text-gray-500 bg-white/5 px-2 py-1 rounded-lg shrink-0 ml-3">⏰ {task.timing}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {result.alerts?.length > 0 && (
            <div className="glass-card p-4 bg-yellow-500/5">
              <h4 className="text-sm font-semibold text-yellow-400 mb-2">⚠️ 주의사항</h4>
              {result.alerts.map((a, i) => <p key={i} className="text-sm text-gray-300">• {a}</p>)}
            </div>
          )}

          {result.weeklyOutlook && (
            <div className="glass-card p-4">
              <h4 className="text-sm font-semibold text-white mb-2">📅 이번 주 전망</h4>
              <p className="text-sm text-gray-400">{result.weeklyOutlook}</p>
            </div>
          )}
        </div>
      )}

      {!result && !loading && !error && (
        <div className="glass-card p-12 text-center">
          <span className="text-6xl block mb-4">📋</span>
          <p className="text-gray-400">"추천 받기" 버튼을 누르면<br/>AI가 오늘 해야 할 작업을 분석합니다</p>
        </div>
      )}
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. AI 농업 상담 (채팅)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function AIChat() {
  const FARM_ID = useContext(FarmIdCtx);
  const [messages, setMessages] = useState([
    { role: "ai", text: "안녕하세요! 🌱 AI 농업 상담사입니다.\n작물 재배, 병해충, 토양, 시비, 수확 등 무엇이든 질문해주세요.", time: new Date() }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const chatEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const quickQuestions = [
    "토마토 잎이 말리는 원인은?",
    "고추 탄저병 방제법",
    "이 시기에 상추 비료 추천",
    "딸기 수확 적정 시기는?",
  ];

  const sendMessage = async (text) => {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput("");
    setMessages(prev => [...prev, { role: "user", text: msg, time: new Date() }]);
    setLoading(true);

    try {
      // 최근 3개 대화를 컨텍스트로 전달
      const recentContext = messages.slice(-6).map(m => `${m.role === "user" ? "사용자" : "AI"}: ${m.text}`).join("\n");
      const res = await api(`/ai/${FARM_ID}/chat`, { method: "POST", body: JSON.stringify({ message: msg, context: recentContext }) });
      setMessages(prev => [...prev, { role: "ai", text: res.data.reply, time: new Date() }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: "ai", text: `❌ 오류: ${e.message}\n\nAI 서버가 실행 중인지 확인해주세요.`, time: new Date(), error: true }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="glass-card flex flex-col" style={{ height: "calc(100vh - 280px)", minHeight: "500px" }}>
      {/* 헤더 */}
      <div className="p-4 border-b border-white/5 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-xl">🤖</div>
        <div>
          <h3 className="text-sm font-semibold text-white">AI 농업 상담</h3>
          <p className="text-xs text-gray-500">무엇이든 질문하세요</p>
        </div>
        <div className={`ml-auto w-2 h-2 rounded-full ${loading ? "bg-yellow-400 animate-pulse" : "bg-emerald-400"}`}></div>
      </div>

      {/* 대화 영역 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${msg.role === "user"
              ? "bg-blue-600 text-white rounded-br-sm"
              : msg.error ? "bg-red-500/10 text-red-300 rounded-bl-sm" : "bg-white/5 text-gray-300 rounded-bl-sm"}`}>
              <p className="text-sm whitespace-pre-wrap">{msg.text}</p>
              <p className={`text-[10px] mt-1 ${msg.role === "user" ? "text-blue-200" : "text-gray-600"}`}>{new Date(msg.time).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white/5 rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1"><span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{animationDelay:"0ms"}}></span><span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{animationDelay:"150ms"}}></span><span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{animationDelay:"300ms"}}></span></div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* 빠른 질문 */}
      {messages.length <= 2 && (
        <div className="px-4 pb-2 flex gap-2 flex-wrap">
          {quickQuestions.map((q, i) => (
            <button key={i} onClick={() => sendMessage(q)} className="px-3 py-1.5 rounded-full text-xs bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white transition-all">{q}</button>
          ))}
        </div>
      )}

      {/* 입력 영역 */}
      <div className="p-4 border-t border-white/5">
        <div className="flex gap-2">
          <input ref={inputRef} type="text" value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="질문을 입력하세요..." className="input-field text-sm flex-1" disabled={loading} />
          <button onClick={() => sendMessage()} disabled={loading || !input.trim()}
            className="px-5 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 text-white text-sm font-medium hover:opacity-90 disabled:opacity-40">
            전송
          </button>
        </div>
      </div>
    </div>
  );
}
