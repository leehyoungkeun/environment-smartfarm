import React, { useState, useRef, useCallback } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

const TYPE_LABELS = { daily: '일일', weekly: '주간', monthly: '월간' };
const SEVERITY_COLORS = { CRITICAL: '#EF4444', WARNING: '#F59E0B', INFO: '#6366F1' };
const SEVERITY_LABELS = { CRITICAL: '심각', WARNING: '경고', INFO: '정보' };
const WORK_TYPE_LABELS = {
  sowing: '파종', transplanting: '정식', watering: '관수', fertilizing: '시비',
  pesticide: '방제', harvesting: '수확', management: '관리', other: '기타',
};
const INPUT_TYPE_LABELS = { fertilizer: '비료', pesticide: '농약', seed: '종자', other: '기타' };
const CHART_COLORS = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

function fmt(d) {
  if (!d) return '-';
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SectionCard — 각 섹션 래퍼
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function SectionCard({ title, icon, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm mb-5">
      <div className="bg-slate-700 px-4 py-2.5 flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <h3 className="text-sm font-bold text-white">{title}</h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// StatCard — 개별 통계 카드
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function StatCard({ label, value, unit, color, bg, icon }) {
  return (
    <div style={{ background: bg, borderRadius: 12, padding: '12px 14px', border: `1px solid ${color}22` }}>
      <div className="flex items-center gap-1.5 mb-1">
        {icon && <span className="text-base">{icon}</span>}
        <span className="text-[11px] font-semibold text-gray-500">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span style={{ fontSize: 22, fontWeight: 800, color, fontFamily: 'monospace' }}>
          {typeof value === 'number' ? value.toLocaleString() : value}
        </span>
        {unit && <span className="text-xs text-gray-400">{unit}</span>}
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ReportPage
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default function ReportPage({ farmId }) {
  const today = new Date().toISOString().split('T')[0];
  const [reportType, setReportType] = useState('daily');
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedHouse, setSelectedHouse] = useState('all');
  const [houses, setHouses] = useState([]);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState('');
  const reportRef = useRef(null);

  // 하우스 목록 로드
  React.useEffect(() => {
    if (!farmId) return;
    axios.get(`${API}/config/farm/${farmId}`).then(r => {
      const list = r.data.data || r.data || [];
      setHouses(Array.isArray(list) ? list : []);
    }).catch(() => {});
  }, [farmId]);

  const generateReport = useCallback(async () => {
    if (!farmId) return;
    setLoading(true);
    setError('');
    setReport(null);
    try {
      const params = new URLSearchParams({ type: reportType, date: selectedDate, houseId: selectedHouse });
      const r = await axios.get(`${API}/reports/${farmId}?${params}`, { timeout: 30000 });
      setReport(r.data.data);
    } catch (e) {
      setError(e.response?.data?.error || e.message || '리포트 생성 실패');
    } finally {
      setLoading(false);
    }
  }, [farmId, reportType, selectedDate, selectedHouse]);

  // ── PDF 내보내기 ──
  const handlePDF = async () => {
    if (!reportRef.current) return;
    setExporting('pdf');
    try {
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'), import('html2canvas'),
      ]);
      const canvas = await html2canvas(reportRef.current, {
        scale: 2, useCORS: true, logging: false,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('l', 'mm', 'a4'); // landscape
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 10;
      const contentW = pageW - margin * 2;
      const imgW = canvas.width;
      const imgH = canvas.height;
      const ratio = contentW / imgW;
      const scaledH = imgH * ratio;
      const usableH = pageH - margin * 2;

      let yOffset = 0;
      let page = 0;
      while (yOffset < scaledH) {
        if (page > 0) pdf.addPage();
        const srcY = (yOffset / ratio);
        const sliceH = Math.min(usableH / ratio, imgH - srcY);
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = imgW;
        tempCanvas.height = sliceH;
        const ctx = tempCanvas.getContext('2d');
        ctx.drawImage(canvas, 0, srcY, imgW, sliceH, 0, 0, imgW, sliceH);
        const sliceImg = tempCanvas.toDataURL('image/png');
        pdf.addImage(sliceImg, 'PNG', margin, margin, contentW, sliceH * ratio);
        yOffset += usableH;
        page++;
      }
      pdf.save(`report_${reportType}_${selectedDate}.pdf`);
    } catch (e) {
      console.error('PDF 생성 실패:', e);
    } finally {
      setExporting('');
    }
  };

  // ── Excel 내보내기 ──
  const handleExcel = () => {
    if (!report) return;
    setExporting('excel');
    try {
      const wb = XLSX.utils.book_new();

      // Sheet 1: 센서 요약
      const sensorRows = report.sensors.houses.flatMap(h =>
        h.sensors.map(s => [h.houseName, s.name, s.avg, s.min, s.max, s.unit, s.count])
      );
      const sensorWs = XLSX.utils.aoa_to_sheet([
        ['하우스', '센서', '평균', '최저', '최고', '단위', '데이터수'],
        ...sensorRows,
      ]);
      XLSX.utils.book_append_sheet(wb, sensorWs, '센서요약');

      // Sheet 2: 알림 요약
      const alertRows = [
        ['심각도', '건수'],
        ['심각(CRITICAL)', report.alerts.bySeverity.CRITICAL || 0],
        ['경고(WARNING)', report.alerts.bySeverity.WARNING || 0],
        ['정보(INFO)', report.alerts.bySeverity.INFO || 0],
        [], ['확인', report.alerts.acknowledged], ['미확인', report.alerts.unacknowledged],
        [], ['주요 알림'],
        ...report.alerts.top5.map(a => [a.severity, a.message, a.houseId, fmt(a.timestamp)]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(alertRows), '알림요약');

      // Sheet 3: 제어 요약
      const ctrlRows = [
        ['항목', '값'],
        ['총 명령', report.controls.totalCommands],
        ['성공', report.controls.successCount],
        ['실패', report.controls.failCount],
        ['성공률(%)', report.controls.successRate],
        ['자동', report.controls.autoCount],
        ['수동', report.controls.manualCount],
        ['자동화율(%)', report.controls.autoRatio],
        [], ['장비별 명령'],
        ['장비', '명령', '건수'],
        ...report.controls.byDevice.map(d => [d.deviceType, d.command, d.count]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ctrlRows), '제어요약');

      // Sheet 4: 영농 요약
      const jRows = [
        ['항목', '값'],
        ['일지 건수', report.journal.journalCount],
        ['수확 건수', report.journal.harvestCount],
        ['총 수확량', report.journal.totalHarvest],
        ['총 수익(원)', report.journal.totalRevenue],
        ['총 투입비(원)', report.journal.totalInputCost],
        ['순이익(원)', report.journal.profit],
        [], ['작업유형별'],
        ['유형', '건수'],
        ...report.journal.workTypeStats.map(w => [WORK_TYPE_LABELS[w.workType] || w.workType, w.count]),
        [], ['투입유형별 비용'],
        ['유형', '비용(원)'],
        ...Object.entries(report.journal.inputByType).map(([k, v]) => [INPUT_TYPE_LABELS[k] || k, v]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(jRows), '영농요약');

      // Sheet 5: 접속 현황
      const connRows = [
        ['날짜', '데이터수', '하우스수'],
        ...report.connection.daily.map(d => [fmt(d.date), d.count, d.houseCount]),
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(connRows), '접속현황');

      XLSX.writeFile(wb, `report_${reportType}_${selectedDate}.xlsx`);
    } catch (e) {
      console.error('Excel 생성 실패:', e);
    } finally {
      setExporting('');
    }
  };

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Render
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  return (
    <div>
      {/* 컨트롤 바 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          {/* 기간 토글 */}
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
            {['daily', 'weekly', 'monthly'].map(t => (
              <button key={t} onClick={() => setReportType(t)}
                className={`px-4 py-2 text-sm font-semibold transition-colors ${reportType === t
                  ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          {/* 날짜 */}
          <input type="date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />

          {/* 하우스 */}
          <select value={selectedHouse} onChange={e => setSelectedHouse(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500">
            <option value="all">전체 하우스</option>
            {houses.map(h => (
              <option key={h.houseId} value={h.houseId}>{h.houseName || h.houseId}</option>
            ))}
          </select>

          {/* 생성 버튼 */}
          <button onClick={generateReport} disabled={loading}
            className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-2">
            {loading ? (
              <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> 생성 중...</>
            ) : '보고서 생성'}
          </button>

          {/* 내보내기 */}
          {report && (
            <div className="flex items-center gap-2 ml-auto">
              <button onClick={handlePDF} disabled={!!exporting}
                className="px-3 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm font-semibold hover:bg-red-100 disabled:opacity-50 transition-colors flex items-center gap-1.5">
                {exporting === 'pdf' ? <span className="w-3 h-3 border-2 border-red-400 border-t-transparent rounded-full animate-spin" /> : <span>📄</span>}
                PDF
              </button>
              <button onClick={handleExcel} disabled={!!exporting}
                className="px-3 py-2 bg-green-50 text-green-700 border border-green-200 rounded-lg text-sm font-semibold hover:bg-green-100 disabled:opacity-50 transition-colors flex items-center gap-1.5">
                {exporting === 'excel' ? <span className="w-3 h-3 border-2 border-green-400 border-t-transparent rounded-full animate-spin" /> : <span>📊</span>}
                Excel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 에러 */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-5 text-sm text-red-700">{error}</div>
      )}

      {/* 리포트 미생성 안내 */}
      {!report && !loading && !error && (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center shadow-sm">
          <div className="text-4xl mb-3 opacity-40">📊</div>
          <p className="text-gray-500 text-sm">기간과 날짜를 선택한 후 "보고서 생성" 버튼을 클릭하세요.</p>
        </div>
      )}

      {/* 리포트 콘텐츠 */}
      {report && (
        <div ref={reportRef}>
          {/* 헤더 */}
          <div className="bg-gradient-to-r from-indigo-600 to-violet-600 rounded-xl p-5 mb-5 text-white shadow-sm">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-xl font-bold">{report.meta.farmName} {TYPE_LABELS[report.meta.type]} 보고서</h2>
                <p className="text-indigo-200 text-sm mt-1">
                  {fmt(report.meta.startDate)} ~ {fmt(report.meta.endDate)}
                  {report.meta.houseId !== 'all' && ` | ${report.meta.houseId}`}
                </p>
              </div>
              <div className="text-right text-xs text-indigo-200">
                생성: {new Date(report.meta.generatedAt).toLocaleString('ko-KR')}
              </div>
            </div>
          </div>

          {/* 1. 센서 요약 */}
          <SectionCard title="센서 요약" icon="🌡️">
            {report.sensors.houses.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">센서 데이터가 없습니다.</p>
            ) : (
              report.sensors.houses.map(house => (
                <div key={house.houseId} className="mb-5 last:mb-0">
                  <h4 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-indigo-500" />
                    {house.houseName}
                  </h4>
                  {/* stat 카드 */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mb-3">
                    {house.sensors.map(s => (
                      <div key={s.sensorId} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                        <div className="text-[11px] font-semibold text-gray-500 mb-1">{s.name} {s.unit && `(${s.unit})`}</div>
                        <div className="flex items-baseline gap-2">
                          <span className="text-lg font-bold text-indigo-700">{s.avg}</span>
                          <span className="text-[10px] text-gray-400">최저 {s.min} / 최고 {s.max}</span>
                        </div>
                        <div className="text-[10px] text-gray-300 mt-0.5">{s.count.toLocaleString()}건</div>
                      </div>
                    ))}
                  </div>
                  {/* 차트 */}
                  {house.sensors.length > 0 && (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={house.sensors} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} />
                        <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="avg" name="평균" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="max" name="최고" fill="#EF4444" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="min" name="최저" fill="#10B981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  )}
                </div>
              ))
            )}
          </SectionCard>

          {/* 2. 알림 요약 */}
          <SectionCard title="알림 요약" icon="🔔">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              <StatCard label="전체" value={report.alerts.total} unit="건" color="#6366F1" bg="#EEF2FF" icon="📊" />
              <StatCard label="심각" value={report.alerts.bySeverity.CRITICAL} unit="건" color="#EF4444" bg="#FEF2F2" icon="🔴" />
              <StatCard label="경고" value={report.alerts.bySeverity.WARNING} unit="건" color="#F59E0B" bg="#FFFBEB" icon="🟡" />
              <StatCard label="미확인" value={report.alerts.unacknowledged} unit="건" color="#8B5CF6" bg="#F5F3FF" icon="⚠️" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 심각도 파이 */}
              {report.alerts.total > 0 && (
                <div>
                  <h5 className="text-xs font-semibold text-gray-500 mb-2">심각도 분포</h5>
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie
                        data={Object.entries(report.alerts.bySeverity).filter(([, v]) => v > 0).map(([k, v]) => ({ name: SEVERITY_LABELS[k], value: v }))}
                        cx="50%" cy="50%" innerRadius={40} outerRadius={70}
                        paddingAngle={3} dataKey="value"
                        label={({ name, value }) => `${name} ${value}`}
                      >
                        {Object.entries(report.alerts.bySeverity).filter(([, v]) => v > 0).map(([k]) => (
                          <Cell key={k} fill={SEVERITY_COLORS[k]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
              {/* Top 5 */}
              {report.alerts.top5.length > 0 && (
                <div>
                  <h5 className="text-xs font-semibold text-gray-500 mb-2">주요 알림 (최근 5건)</h5>
                  <div className="space-y-1.5">
                    {report.alerts.top5.map((a, i) => (
                      <div key={i} className="flex items-start gap-2 p-2 bg-gray-50 rounded-lg border border-gray-100">
                        <span className={`flex-shrink-0 w-2 h-2 mt-1.5 rounded-full ${a.severity === 'CRITICAL' ? 'bg-red-500' : a.severity === 'WARNING' ? 'bg-amber-500' : 'bg-indigo-400'}`} />
                        <div className="min-w-0">
                          <p className="text-xs text-gray-700 truncate">{a.message}</p>
                          <p className="text-[10px] text-gray-400">{a.houseId} | {new Date(a.timestamp).toLocaleString('ko-KR')}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </SectionCard>

          {/* 3. 제어 요약 */}
          <SectionCard title="제어 요약" icon="🎛️">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              <StatCard label="총 명령" value={report.controls.totalCommands} unit="회" color="#3B82F6" bg="#EFF6FF" icon="📡" />
              <StatCard label="성공률" value={report.controls.successRate} unit="%" color="#10B981" bg="#ECFDF5" icon="✅" />
              <StatCard label="자동화율" value={report.controls.autoRatio} unit="%" color="#8B5CF6" bg="#F5F3FF" icon="🤖" />
              <StatCard label="실패" value={report.controls.failCount} unit="건" color="#EF4444" bg="#FEF2F2" icon="❌" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 장비별 */}
              {report.controls.byDevice.length > 0 && (
                <div>
                  <h5 className="text-xs font-semibold text-gray-500 mb-2">장비별 명령</h5>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={report.controls.byDevice.slice(0, 10)} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="deviceType" tick={{ fill: '#64748b', fontSize: 10 }} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                      <Bar dataKey="count" name="명령수" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {/* 시간대별 */}
              {report.controls.byHour.length > 0 && (
                <div>
                  <h5 className="text-xs font-semibold text-gray-500 mb-2">시간대별 분포</h5>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={Array.from({ length: 24 }, (_, i) => {
                      const found = report.controls.byHour.find(h => h.hour === i);
                      return { hour: `${i}시`, count: found?.count || 0 };
                    })} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="hour" tick={{ fill: '#64748b', fontSize: 9 }} interval={2} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 11 }} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                      <Bar dataKey="count" name="명령수" fill="#06B6D4" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </SectionCard>

          {/* 4. 영농 요약 */}
          <SectionCard title="영농 요약" icon="🌾">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              <StatCard label="일지" value={report.journal.journalCount} unit="건" color="#3B82F6" bg="#EFF6FF" icon="📝" />
              <StatCard label="수확량" value={report.journal.totalHarvest} unit="kg" color="#10B981" bg="#ECFDF5" icon="🌽" />
              <StatCard label="수익" value={report.journal.totalRevenue} unit="원" color="#059669" bg="#ECFDF5" icon="💰" />
              <StatCard label="순이익" value={report.journal.profit} unit="원"
                color={report.journal.profit >= 0 ? '#059669' : '#EF4444'}
                bg={report.journal.profit >= 0 ? '#ECFDF5' : '#FEF2F2'} icon="📈" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
              <StatCard label="투입비" value={report.journal.totalInputCost} unit="원" color="#F59E0B" bg="#FFFBEB" icon="💸" />
              <StatCard label="수확 건수" value={report.journal.harvestCount} unit="건" color="#84CC16" bg="#F7FEE7" icon="📦" />
              <StatCard label="투입 건수" value={report.journal.inputCount} unit="건" color="#D97706" bg="#FFFBEB" icon="🧪" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 작업유형별 */}
              {report.journal.workTypeStats.length > 0 && (
                <div>
                  <h5 className="text-xs font-semibold text-gray-500 mb-2">작업유형별 건수</h5>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={report.journal.workTypeStats.map(w => ({
                      name: WORK_TYPE_LABELS[w.workType] || w.workType, count: w.count,
                    }))} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 11 }} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 11 }} allowDecimals={false} />
                      <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                      <Bar dataKey="count" name="건수" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
              {/* 투입유형별 비용 */}
              {Object.keys(report.journal.inputByType).length > 0 && (
                <div>
                  <h5 className="text-xs font-semibold text-gray-500 mb-2">투입유형별 비용</h5>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={Object.entries(report.journal.inputByType).map(([k, v]) => ({
                          name: INPUT_TYPE_LABELS[k] || k, value: v,
                        }))}
                        cx="50%" cy="50%" innerRadius={40} outerRadius={70}
                        paddingAngle={3} dataKey="value"
                        label={({ name, value }) => `${name} ${value.toLocaleString()}원`}
                      >
                        {Object.entries(report.journal.inputByType).map(([, ], i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v) => `${v.toLocaleString()}원`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </SectionCard>

          {/* 5. 접속 현황 */}
          <SectionCard title="접속 현황" icon="📡">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
              <StatCard label="총 데이터" value={report.connection.totalDataPoints} unit="건" color="#3B82F6" bg="#EFF6FF" icon="📊" />
              <StatCard label="일 평균" value={report.connection.dailyAvg} unit="건" color="#8B5CF6" bg="#F5F3FF" icon="📈" />
              <StatCard label="수집 일수" value={report.connection.days} unit="일" color="#10B981" bg="#ECFDF5" icon="📅" />
            </div>
            {report.connection.daily.length > 0 && (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={report.connection.daily.map(d => ({
                  date: fmt(d.date), count: d.count, houses: d.houseCount,
                }))} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} />
                  <YAxis yAxisId="left" tick={{ fill: '#64748b', fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: '#64748b', fontSize: 11 }} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line yAxisId="left" type="monotone" dataKey="count" name="데이터수" stroke="#3B82F6" strokeWidth={2} dot={{ r: 3 }} />
                  <Line yAxisId="right" type="monotone" dataKey="houses" name="하우스수" stroke="#10B981" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </SectionCard>
        </div>
      )}
    </div>
  );
}
