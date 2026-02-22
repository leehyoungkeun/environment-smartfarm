import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import axios from 'axios';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { getApiBase } from '../../services/apiSwitcher';

// 컴포넌트 외부: 렌더마다 재생성 방지
const RANGE_CONFIG = {
  '1h':  { ms: 1*60*60*1000,      maxPoints: 120, tickInterval: 10*60*1000     },
  '6h':  { ms: 6*60*60*1000,      maxPoints: 120, tickInterval: 60*60*1000     },
  '24h': { ms: 24*60*60*1000,     maxPoints: 144, tickInterval: 2*60*60*1000   },
  '7d':  { ms: 7*24*60*60*1000,   maxPoints: 168, tickInterval: 24*60*60*1000  },
  '30d': { ms: 30*24*60*60*1000,  maxPoints: 180, tickInterval: 3*24*60*60*1000 },
};

const TIME_RANGES = [
  {value:'1h',label:'1시간'},{value:'6h',label:'6시간'},{value:'24h',label:'24시간'},
  {value:'7d',label:'7일'},{value:'30d',label:'30일'},
];

const SensorChart = ({ farmId, houseId, config, dataVersion }) => {
  const [timeRange, setTimeRange] = useState('24h');
  const [chartData, setChartData] = useState([]);
  const [selectedSensors, setSelectedSensors] = useState([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef(null);

  const numberSensors = useMemo(
    () => config?.sensors?.filter(s => s.type === 'number') || [],
    [config]
  );

  // 센서 정보 조회 캐시 (매번 .find 반복 방지)
  const sensorInfoMap = useMemo(() => {
    const map = {};
    if (config?.sensors) config.sensors.forEach(s => { map[s.sensorId] = s; });
    return map;
  }, [config]);

  const getSensorInfo = useCallback((id) => sensorInfoMap[id] || {}, [sensorInfoMap]);

  useEffect(() => {
    if (numberSensors.length > 0) {
      const defaultSensors = numberSensors.slice(0, 3).map(s => s.sensorId);
      setSelectedSensors(defaultSensors);
    }
  }, [numberSensors]);

  useEffect(() => {
    if (selectedSensors.length > 0) loadChartData();
  }, [timeRange, selectedSensors, farmId, houseId]);

  // dataVersion 변경 시 단기 시간대만 자동 갱신
  useEffect(() => {
    if (dataVersion > 0 && selectedSensors.length > 0 && ['1h', '6h', '24h'].includes(timeRange)) {
      loadChartData();
    }
  }, [dataVersion]);

  const getTimeRangeParams = () => {
    const now = new Date();
    const cfg = RANGE_CONFIG[timeRange];
    return {
      startDate: new Date(now.getTime() - cfg.ms).toISOString(),
      endDate: now.toISOString(),
      startMs: now.getTime() - cfg.ms,
      endMs: now.getTime(),
    };
  };

  // X축 균등 틱 생성
  const generateTicks = (startMs, endMs, interval) => {
    const ticks = [];
    // 첫 틱을 interval 단위로 올림 정렬
    const first = Math.ceil(startMs / interval) * interval;
    for (let t = first; t <= endMs; t += interval) {
      ticks.push(t);
    }
    return ticks;
  };

  // 타임스탬프 → 라벨 포맷 (날짜 변경 시 날짜 포함)
  const formatTick = (ts) => {
    const d = new Date(ts);
    const h = d.getHours();
    const m = d.getMinutes();
    const showDate = (timeRange === '7d' || timeRange === '30d') || (h === 0 && m === 0);
    if (showDate) {
      return `${d.getMonth()+1}/${d.getDate()} ${d.toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' })}`;
    }
    return d.toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' });
  };

  // 시간 기반 버킷 평균으로 균등 다운샘플링
  // 전체 시간 범위를 maxPoints개 구간으로 나누고, 각 구간의 평균값 사용
  const downsample = (data, maxPoints, sensorIds) => {
    if (data.length === 0) return data;
    if (data.length <= maxPoints) return data;

    const startTs = data[0].timestamp;
    const endTs = data[data.length - 1].timestamp;
    const totalRange = endTs - startTs;
    if (totalRange <= 0) return data;

    const bucketSize = totalRange / maxPoints;
    const buckets = [];

    for (let i = 0; i < maxPoints; i++) {
      buckets.push({ timestamp: startTs + bucketSize * (i + 0.5), counts: {}, sums: {} });
    }

    // 각 데이터 포인트를 해당 버킷에 할당
    for (const point of data) {
      const idx = Math.min(Math.floor((point.timestamp - startTs) / bucketSize), maxPoints - 1);
      const bucket = buckets[idx];
      for (const id of sensorIds) {
        if (point[id] != null) {
          bucket.sums[id] = (bucket.sums[id] || 0) + point[id];
          bucket.counts[id] = (bucket.counts[id] || 0) + 1;
        }
      }
    }

    // 데이터가 있는 버킷만 평균 계산하여 반환
    return buckets
      .filter(b => Object.keys(b.counts).length > 0)
      .map(b => {
        const point = { timestamp: Math.round(b.timestamp) };
        for (const id of sensorIds) {
          if (b.counts[id]) point[id] = Math.round((b.sums[id] / b.counts[id]) * 100) / 100;
        }
        return point;
      });
  };

  const loadChartData = async () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setLoading(true);
      const { startDate, endDate } = getTimeRangeParams();
      const cfg = RANGE_CONFIG[timeRange];
      const API_BASE_URL = getApiBase();
      const response = await axios.get(`${API_BASE_URL}/sensors/${farmId}/${houseId}/history`, {
        params: { startDate, endDate }, timeout: 10000, signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (response.data.success) {
        const raw = response.data.data.reverse().map(item => {
          const d = new Date(item.timestamp);
          const point = { timestamp: d.getTime() };
          selectedSensors.forEach(id => { if (item.data[id] !== undefined) point[id] = item.data[id]; });
          return point;
        });
        setChartData(downsample(raw, cfg.maxPoints, selectedSensors));
      }
    } catch (error) {
      if (error.name !== 'CanceledError' && error.name !== 'AbortError') {
        console.error('Failed to load chart data:', error);
      }
    } finally { setLoading(false); }
  };

  // 언마운트 시 진행중 요청 취소
  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []);

  const toggleSensor = useCallback(
    (id) => setSelectedSensors(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]),
    []
  );

  const downloadCSV = useCallback(() => {
    if (chartData.length === 0) { alert('데이터가 없습니다.'); return; }
    const headers = ['시간', ...selectedSensors.map(id => { const s = getSensorInfo(id); return `${s.name} (${s.unit})`; })];
    const rows = chartData.map(row => [row.time, ...selectedSensors.map(id => row[id] ?? '')]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
    link.download = `sensor_data_${new Date().toISOString()}.csv`; link.click();
  }, [chartData, selectedSensors, getSensorInfo]);

  if (!config) return null;

  return (
    <div style={{background:'#fff',border:'1px solid #e2e8f0',borderRadius:16,overflow:'hidden',boxShadow:'0 1px 3px rgba(0,0,0,0.06)'}}>
      <div style={{background:'#7c3aed',padding:'12px 18px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <h2 style={{fontSize:16,fontWeight:800,color:'#fff'}}>📈 센서 데이터 추이</h2>
        <button onClick={downloadCSV} disabled={chartData.length === 0}
          style={{background:'rgba(255,255,255,0.2)',color:'#fff',border:'1.5px solid rgba(255,255,255,0.3)',padding:'6px 14px',borderRadius:8,fontSize:13,fontWeight:700,cursor:'pointer',transition:'all 0.15s'}}>
          📥 CSV
        </button>
      </div>

      <div style={{padding:'16px'}}>
        <div className="flex gap-2 mb-4 flex-wrap">
          {TIME_RANGES.map(r => (
            <button key={r.value} onClick={() => setTimeRange(r.value)}
              style={timeRange === r.value
                ? {background:'#7c3aed',color:'#fff',padding:'8px 16px',borderRadius:10,fontSize:13,fontWeight:800,border:'none',cursor:'pointer',boxShadow:'0 2px 8px rgba(124,58,237,0.35)',transition:'all 0.15s'}
                : {background:'#f8fafc',color:'#64748b',padding:'8px 16px',borderRadius:10,fontSize:13,fontWeight:700,border:'2px solid #e2e8f0',cursor:'pointer',transition:'all 0.15s'}
              }>
              {r.label}
            </button>
          ))}
        </div>

        <div className="mb-4">
          <div style={{fontSize:13,fontWeight:700,color:'#64748b',marginBottom:8,display:'flex',alignItems:'center',gap:6}}>
            <span style={{width:4,height:14,background:'#7c3aed',borderRadius:2,display:'inline-block'}}/>
            센서 선택
          </div>
          <div className="flex gap-2 flex-wrap">
            {numberSensors.map(sensor => (
              <button key={sensor.sensorId} onClick={() => toggleSensor(sensor.sensorId)}
                style={selectedSensors.includes(sensor.sensorId)
                  ? {background:sensor.color,color:'#fff',padding:'8px 14px',borderRadius:10,fontSize:13,fontWeight:800,border:'none',cursor:'pointer',boxShadow:`0 2px 8px ${sensor.color}50`,transition:'all 0.15s'}
                  : {background:'#f8fafc',color:'#64748b',padding:'8px 14px',borderRadius:10,fontSize:13,fontWeight:700,border:'2px solid #e2e8f0',cursor:'pointer',transition:'all 0.15s'}
                }>
                {sensor.icon} {sensor.name}
              </button>
            ))}
          </div>
        </div>

      {loading ? (
        <div className="h-96 flex items-center justify-center text-gray-500">로딩 중...</div>
      ) : chartData.length === 0 ? (
        <div className="h-96 flex items-center justify-center">
          <div className="text-center">
            <p className="text-lg mb-2 text-gray-600">📊 데이터가 없습니다</p>
            <p className="text-sm text-gray-400">센서 데이터가 수집되면 여기에 그래프가 표시됩니다.</p>
          </div>
        </div>
      ) : (<ChartContent
          chartData={chartData}
          selectedSensors={selectedSensors}
          getSensorInfo={getSensorInfo}
          timeRange={timeRange}
          getTimeRangeParams={getTimeRangeParams}
          generateTicks={generateTicks}
          formatTick={formatTick}
        />
      )}
      </div>
    </div>
  );
};

// 차트 렌더링을 분리하여 데이터 변경 시에만 재계산
const ChartContent = React.memo(({ chartData, selectedSensors, getSensorInfo, timeRange, getTimeRangeParams, generateTicks, formatTick }) => {
  const sensorDomains = useMemo(() => {
    const domains = {};
    selectedSensors.forEach(id => {
      const vals = chartData.map(d => d[id]).filter(v => v != null);
      if (vals.length > 0) {
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        const range = max - min || 1;
        const padding = range * 0.15;
        domains[id] = [
          Math.floor((min - padding) * 10) / 10,
          Math.ceil((max + padding) * 10) / 10
        ];
      }
    });
    return domains;
  }, [chartData, selectedSensors]);

  const { startMs, endMs } = getTimeRangeParams();
  const cfg = RANGE_CONFIG[timeRange];
  const ticks = useMemo(() => generateTicks(startMs, endMs, cfg.tickInterval), [startMs, endMs, cfg.tickInterval]);
  const showDots = chartData.length < 50;

  // 통계 계산 메모이제이션
  const stats = useMemo(() => {
    return selectedSensors.map(id => {
      const s = getSensorInfo(id);
      const vals = chartData.map(d => d[id]).filter(v => v != null);
      if (!vals.length) return null;
      const sum = vals.reduce((a, b) => a + b, 0);
      return { id, s, avg: (sum / vals.length).toFixed(1), min: Math.min(...vals).toFixed(1), max: Math.max(...vals).toFixed(1) };
    }).filter(Boolean);
  }, [chartData, selectedSensors, getSensorInfo]);

  return (
    <>
      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={chartData} margin={{ left: 10, right: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="timestamp"
            type="number"
            scale="time"
            domain={[startMs, endMs]}
            ticks={ticks}
            tickFormatter={formatTick}
            stroke="#94a3b8"
            tick={{fill:'#64748b', fontSize: 11}}
            angle={-45}
            textAnchor="end"
            height={80}
          />
          {selectedSensors.map((id, idx) => {
            const s = getSensorInfo(id);
            const domain = sensorDomains[id] || ['auto', 'auto'];
            return (
              <YAxis
                key={id}
                yAxisId={id}
                domain={domain}
                orientation={idx === 0 ? 'left' : 'right'}
                stroke={s.color || '#3B82F6'}
                tick={{fill: s.color || '#3B82F6', fontSize: 11}}
                tickFormatter={v => `${v}`}
                label={idx < 2 ? {value: `${s.name} (${s.unit})`, angle: idx === 0 ? -90 : 90, position: 'insideMiddle', fill: s.color || '#3B82F6', fontSize: 11, dx: idx === 0 ? -15 : 15} : undefined}
                hide={idx >= 2}
              />
            );
          })}
          <Tooltip
            contentStyle={{backgroundColor:'#fff',border:'1px solid #e2e8f0',borderRadius:'8px',boxShadow:'0 4px 6px -1px rgba(0,0,0,0.1)',color:'#1e293b'}}
            labelStyle={{color:'#64748b'}}
            labelFormatter={(ts) => new Date(ts).toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' })}
            formatter={(value, name) => [Number(value).toFixed(1), name]}
          />
          <Legend wrapperStyle={{color:'#475569'}} />
          {selectedSensors.map(id => {
            const s = getSensorInfo(id);
            return <Line key={id} yAxisId={id} type="monotone" dataKey={id} name={`${s.name} (${s.unit})`} stroke={s.color || '#3B82F6'} strokeWidth={2} dot={showDots} activeDot={{r:6}} connectNulls />;
          })}
        </LineChart>
      </ResponsiveContainer>

      {stats.length > 0 && (
        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
          {stats.map(({ id, s, avg, min, max }) => (
            <div key={id} style={{background:'#f8fafc',borderRadius:14,padding:'14px 16px',border:'2px solid #e2e8f0'}}>
              <div className="flex items-center gap-2 mb-3">
                <span style={{fontSize:22}}>{s.icon}</span>
                <span style={{fontSize:15,fontWeight:800,color:'#0f172a'}}>{s.name}</span>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between items-center"><span style={{fontSize:13,color:'#64748b',fontWeight:600}}>평균</span><span style={{fontSize:16,fontWeight:900,fontFamily:'monospace',color:'#0f172a'}}>{avg} <span style={{fontSize:11,color:'#94a3b8'}}>{s.unit}</span></span></div>
                <div className="flex justify-between items-center"><span style={{fontSize:13,color:'#64748b',fontWeight:600}}>최소</span><span style={{fontSize:16,fontWeight:900,fontFamily:'monospace',color:'#2563eb'}}>{min} <span style={{fontSize:11,color:'#94a3b8'}}>{s.unit}</span></span></div>
                <div className="flex justify-between items-center"><span style={{fontSize:13,color:'#64748b',fontWeight:600}}>최고</span><span style={{fontSize:16,fontWeight:900,fontFamily:'monospace',color:'#dc2626'}}>{max} <span style={{fontSize:11,color:'#94a3b8'}}>{s.unit}</span></span></div>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
});

export default SensorChart;
