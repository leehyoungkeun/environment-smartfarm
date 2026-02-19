import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

const AnalyticsDashboard = ({ farmId, houseId }) => {
  const [period, setPeriod] = useState('day');
  const [analyticsData, setAnalyticsData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [selectedSensor, setSelectedSensor] = useState('all');

  useEffect(() => { loadAnalytics(); }, [farmId, houseId, period]);

  const loadAnalytics = async () => {
    setLoading(true);
    setError(null);
    try {
      const endDate = new Date();
      const startDate = new Date();
      if (period === 'day') startDate.setHours(0,0,0,0);
      else if (period === 'week') startDate.setDate(startDate.getDate()-7);
      else startDate.setMonth(startDate.getMonth()-1);

      const response = await axios.get(`${API_BASE_URL}/sensors/data/${farmId}/${houseId}`, {
        params: { startDate: startDate.toISOString(), endDate: endDate.toISOString(), limit: 1000 }
      });
      if (response.data.success) processAnalytics(response.data.data);
    } catch (err) {
      console.error('분석 데이터 로드 실패:', err);
      const status = err.response?.status;
      if (status === 401) {
        setError('인증 토큰이 만료되었습니다. 다시 로그인해주세요.');
      } else if (status === 500) {
        setError('서버 오류가 발생했습니다. sensor_data 테이블이 생성되었는지 확인하세요.');
      } else if (!err.response) {
        setError('백엔드 서버에 연결할 수 없습니다.');
      } else {
        setError(err.response?.data?.error || err.message);
      }
    }
    finally { setLoading(false); }
  };

  const generateTestData = async () => {
    setGenerating(true);
    try {
      // 1. 하우스 설정에서 센서 목록 조회
      const configRes = await axios.get(`${API_BASE_URL}/config/${houseId}?farmId=${farmId}`);
      const sensors = configRes.data?.data?.sensors || [];

      if (sensors.length === 0) {
        alert('이 하우스에 설정된 센서가 없습니다.\n설정 페이지에서 센서를 추가해주세요.');
        return;
      }

      // 2. 24시간분 테스트 데이터 생성 (10분 간격 = 144건)
      const now = new Date();
      const dataArray = [];

      for (let i = 0; i < 144; i++) {
        const timestamp = new Date(now.getTime() - i * 10 * 60 * 1000);
        const data = {};
        const hour = timestamp.getHours() + timestamp.getMinutes() / 60;

        for (const sensor of sensors) {
          if (sensor.type !== 'number' && sensor.type !== undefined) continue;
          const min = sensor.min ?? 0;
          const max = sensor.max ?? 100;
          const range = max - min;
          const mid = (min + max) / 2;
          // 시간대별 사인파 + 노이즈로 현실적인 데이터 생성
          const sine = Math.sin((hour / 24) * Math.PI * 2) * range * 0.25;
          const noise = (Math.random() - 0.5) * range * 0.1;
          data[sensor.sensorId] = parseFloat((mid + sine + noise).toFixed(1));
        }

        dataArray.push({ timestamp: timestamp.toISOString(), data });
      }

      // 3. 배치 전송
      await axios.post(`${API_BASE_URL}/sensors/batch`, { farmId, houseId, dataArray });

      // 4. 분석 다시 로드
      await loadAnalytics();
    } catch (err) {
      console.error('테스트 데이터 생성 실패:', err);
      alert('테스트 데이터 생성 실패: ' + (err.response?.data?.error || err.message));
    } finally {
      setGenerating(false);
    }
  };

  const processAnalytics = (data) => {
    if (!data || data.length === 0) { setAnalyticsData(null); return; }
    const sensorStats = {}, hourlyData = {};
    data.forEach(record => {
      Object.entries(record.data).forEach(([sensorId, value]) => {
        if (typeof value === 'number') {
          if (!sensorStats[sensorId]) sensorStats[sensorId] = { values:[], sum:0, min:value, max:value, count:0 };
          const s = sensorStats[sensorId];
          s.values.push(value); s.sum+=value; s.min=Math.min(s.min,value); s.max=Math.max(s.max,value); s.count++;
        }
      });
      const hour = new Date(record.timestamp).getHours();
      if (!hourlyData[hour]) hourlyData[hour] = {};
      Object.entries(record.data).forEach(([sensorId, value]) => {
        if (typeof value === 'number') {
          if (!hourlyData[hour][sensorId]) hourlyData[hour][sensorId] = [];
          hourlyData[hour][sensorId].push(value);
        }
      });
    });
    Object.keys(sensorStats).forEach(id => {
      const s = sensorStats[id]; s.avg = s.sum/s.count;
      const sorted = [...s.values].sort((a,b)=>a-b); const mid = Math.floor(sorted.length/2);
      s.median = sorted.length%2===0 ? (sorted[mid-1]+sorted[mid])/2 : sorted[mid];
    });
    const hourlyAverage = Object.entries(hourlyData).map(([hour, sensors]) => {
      const avg = { hour: `${hour}시` };
      Object.entries(sensors).forEach(([id, vals]) => { avg[id] = vals.reduce((a,b)=>a+b,0)/vals.length; });
      return avg;
    }).sort((a,b)=>parseInt(a.hour)-parseInt(b.hour));
    setAnalyticsData({ stats: sensorStats, hourly: hourlyAverage, totalRecords: data.length, period });
  };

  const getSensorName = (id) => {
    const names = { temp:'온도', humidity:'습도', nh3:'암모니아', co2:'이산화탄소' };
    return names[id.split('_')[0]] || id;
  };
  const getPeriodText = () => ({ day:'오늘', week:'최근 7일', month:'최근 30일' })[period];

  const tooltipStyle = { backgroundColor:'#fff', border:'1px solid #e2e8f0', borderRadius:'8px', boxShadow:'0 4px 6px -1px rgba(0,0,0,0.1)' };

  if (loading) return <div className="flex items-center justify-center h-64"><div className="text-gray-500 text-lg">📊 데이터 분석 중...</div></div>;

  // 에러 상태
  if (error) return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center bg-white border border-rose-200 rounded-2xl shadow-sm p-8 max-w-md">
        <div className="text-4xl mb-4">⚠️</div>
        <h3 className="text-lg font-bold text-gray-800 mb-2">데이터 로드 실패</h3>
        <p className="text-sm text-gray-500 mb-4">{error}</p>
        <button onClick={loadAnalytics}
          className="px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-all active:scale-95">
          다시 시도
        </button>
      </div>
    </div>
  );

  // 빈 데이터 상태
  if (!analyticsData) return (
    <div className="space-y-4">
      {/* 기간 선택 (기간을 바꿔보도록 유도) */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          📊 데이터 분석
        </h2>
        <div className="flex gap-2">
          {['day','week','month'].map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${period===p ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {p==='day'&&'일간'}{p==='week'&&'주간'}{p==='month'&&'월간'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-center py-16">
        <div className="text-center bg-white border border-gray-200 rounded-2xl shadow-sm p-10 max-w-md">
          <div className="text-5xl mb-4 opacity-30">📊</div>
          <h3 className="text-lg font-bold text-gray-800 mb-2">
            {period === 'day' ? '오늘' : period === 'week' ? '최근 7일' : '최근 30일'} 수집된 센서 데이터가 없습니다
          </h3>
          <p className="text-sm text-gray-500 mb-2">
            센서 데이터가 수집되면 이곳에 분석 결과가 표시됩니다.
          </p>
          <div className="text-left text-xs text-gray-400 bg-gray-50 rounded-xl p-4 mb-5 space-y-1">
            <p>• Node-RED에서 <code className="bg-gray-200 px-1 rounded">POST /api/sensors/collect</code>로 데이터 전송</p>
            <p>• 또는 아래 버튼으로 테스트 데이터를 생성해보세요</p>
          </div>
          <div className="flex gap-2 justify-center">
            <button onClick={generateTestData} disabled={generating}
              className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium
                         hover:bg-blue-700 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
              {generating ? '생성 중...' : '📡 테스트 데이터 생성 (24시간)'}
            </button>
            <button onClick={loadAnalytics}
              className="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-xl text-sm font-medium
                         hover:bg-gray-200 transition-all active:scale-95">
              🔄 새로고침
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const sensors = Object.keys(analyticsData.stats);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
          📊 데이터 분석 <span className="text-sm text-gray-400">({getPeriodText()})</span>
        </h2>
        <div className="flex gap-2">
          {['day','week','month'].map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${period===p ? 'bg-blue-600 shadow-md' : 'bg-gray-100 hover:bg-gray-200'}`}
              style={period===p ? {color:'#fff'} : {color:'#4b5563'}}>
              {p==='day'&&'일간'}{p==='week'&&'주간'}{p==='month'&&'월간'}
            </button>
          ))}
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {sensors.map(id => {
          const s = analyticsData.stats[id];
          return (
            <div key={id} className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-lg transition-all shadow-sm">
              <h3 className="text-base font-bold text-gray-800 mb-4 flex items-center justify-between">
                <span>{getSensorName(id)}</span><span className="text-sm text-gray-400">{s.count}회</span>
              </h3>
              <div className="space-y-2.5">
                <div className="flex justify-between"><span className="text-gray-500 text-sm">평균</span><span className="text-gray-800 font-bold text-lg">{s.avg.toFixed(1)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 text-sm">최고</span><span className="text-rose-600 font-bold">{s.max.toFixed(1)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 text-sm">최저</span><span className="text-blue-600 font-bold">{s.min.toFixed(1)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500 text-sm">중앙값</span><span className="text-gray-600 font-medium">{s.median.toFixed(1)}</span></div>
                <div className="pt-2.5 border-t border-gray-100">
                  <div className="flex justify-between text-xs"><span className="text-gray-400">변동폭</span><span className="text-gray-500 font-medium">{(s.max-s.min).toFixed(1)}</span></div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 시간대별 추세 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h3 className="text-lg font-bold text-gray-800 mb-5">📈 시간대별 추세</h3>
        <div className="flex gap-2 mb-4 flex-wrap">
          <button onClick={() => setSelectedSensor('all')}
            className={`px-3 py-1 rounded-lg text-sm font-medium transition-all ${selectedSensor==='all' ? 'bg-blue-600 shadow-md' : 'bg-gray-100 hover:bg-gray-200'}`}
            style={selectedSensor==='all' ? {color:'#fff'} : {color:'#4b5563'}}>전체</button>
          {sensors.map(id => (
            <button key={id} onClick={() => setSelectedSensor(id)}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition-all ${selectedSensor===id ? 'bg-blue-600 shadow-md' : 'bg-gray-100 hover:bg-gray-200'}`}
              style={selectedSensor===id ? {color:'#fff'} : {color:'#4b5563'}}>{getSensorName(id)}</button>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={analyticsData.hourly}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="hour" stroke="#94a3b8" tick={{fill:'#64748b'}} />
            <YAxis stroke="#94a3b8" tick={{fill:'#64748b'}} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend />
            {selectedSensor==='all'
              ? sensors.map((id,i) => <Line key={id} type="monotone" dataKey={id} name={getSensorName(id)} stroke={['#2563eb','#dc2626','#059669','#d97706'][i%4]} strokeWidth={2} dot={{r:3}} />)
              : <Line type="monotone" dataKey={selectedSensor} name={getSensorName(selectedSensor)} stroke="#2563eb" strokeWidth={3} dot={{r:4}} />
            }
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 센서별 비교 */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h3 className="text-lg font-bold text-gray-800 mb-5">📊 센서별 비교</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={sensors.map(id => ({ name: getSensorName(id), 평균: analyticsData.stats[id].avg, 최고: analyticsData.stats[id].max, 최저: analyticsData.stats[id].min }))}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="name" stroke="#94a3b8" tick={{fill:'#64748b'}} />
            <YAxis stroke="#94a3b8" tick={{fill:'#64748b'}} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend />
            <Bar dataKey="평균" fill="#2563eb" />
            <Bar dataKey="최고" fill="#dc2626" />
            <Bar dataKey="최저" fill="#059669" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* 요약 */}
      <div className="bg-gradient-to-r from-blue-50 to-violet-50 border border-blue-100 rounded-xl p-5">
        <h3 className="text-base font-bold text-gray-800 mb-3">📋 요약</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div><div className="text-gray-500 text-sm mb-1">분석 기간</div><div className="text-gray-800 font-bold">{getPeriodText()}</div></div>
          <div><div className="text-gray-500 text-sm mb-1">데이터 수집</div><div className="text-gray-800 font-bold">{analyticsData.totalRecords}회</div></div>
          <div><div className="text-gray-500 text-sm mb-1">센서 수</div><div className="text-gray-800 font-bold">{sensors.length}개</div></div>
          <div><div className="text-gray-500 text-sm mb-1">수집 간격</div><div className="text-gray-800 font-bold">60초</div></div>
        </div>
      </div>
    </div>
  );
};

export default AnalyticsDashboard;
