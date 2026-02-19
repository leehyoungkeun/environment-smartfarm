import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

const SensorChart = ({ farmId, houseId, config }) => {
  const [timeRange, setTimeRange] = useState('24h');
  const [chartData, setChartData] = useState([]);
  const [selectedSensors, setSelectedSensors] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (config?.sensors?.length > 0) {
      const defaultSensors = config.sensors.filter(s => s.type === 'number').slice(0, 3).map(s => s.sensorId);
      setSelectedSensors(defaultSensors);
    }
  }, [config]);

  useEffect(() => {
    if (selectedSensors.length > 0) loadChartData();
  }, [timeRange, selectedSensors, farmId, houseId]);

  const getTimeRangeParams = () => {
    const now = new Date();
    const ranges = {
      '1h': new Date(now.getTime() - 1*60*60*1000),
      '6h': new Date(now.getTime() - 6*60*60*1000),
      '24h': new Date(now.getTime() - 24*60*60*1000),
      '7d': new Date(now.getTime() - 7*24*60*60*1000),
      '30d': new Date(now.getTime() - 30*24*60*60*1000)
    };
    return { startDate: ranges[timeRange].toISOString(), endDate: now.toISOString() };
  };

  const loadChartData = async () => {
    try {
      setLoading(true);
      const { startDate, endDate } = getTimeRangeParams();
      const response = await axios.get(`${API_BASE_URL}/sensors/${farmId}/${houseId}/history`, { params: { startDate, endDate } });
      if (response.data.success) {
        setChartData(response.data.data.map(item => {
          const point = { timestamp: new Date(item.timestamp).getTime(), time: new Date(item.timestamp).toLocaleString('ko-KR', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) };
          selectedSensors.forEach(id => { if (item.data[id] !== undefined) point[id] = item.data[id]; });
          return point;
        }));
      }
    } catch (error) { console.error('Failed to load chart data:', error); }
    finally { setLoading(false); }
  };

  const toggleSensor = (id) => setSelectedSensors(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  const getSensorInfo = (id) => config?.sensors?.find(s => s.sensorId === id) || {};

  const downloadCSV = () => {
    if (chartData.length === 0) { alert('데이터가 없습니다.'); return; }
    const headers = ['시간', ...selectedSensors.map(id => { const s = getSensorInfo(id); return `${s.name} (${s.unit})`; })];
    const rows = chartData.map(row => [row.time, ...selectedSensors.map(id => row[id] ?? '')]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob);
    link.download = `sensor_data_${new Date().toISOString()}.csv`; link.click();
  };

  if (!config) return null;
  const numberSensors = config.sensors.filter(s => s.type === 'number');

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-md">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-bold text-gray-800">📈 센서 데이터 추이</h2>
        <button onClick={downloadCSV} disabled={chartData.length === 0}
          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-sm rounded-lg transition-all shadow-sm" style={{color:'#fff'}}>
          📥 CSV 다운로드
        </button>
      </div>

      <div className="flex gap-2 mb-5 flex-wrap">
        {[{value:'1h',label:'1시간'},{value:'6h',label:'6시간'},{value:'24h',label:'24시간'},{value:'7d',label:'7일'},{value:'30d',label:'30일'}].map(r => (
          <button key={r.value} onClick={() => setTimeRange(r.value)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${timeRange === r.value ? 'bg-blue-600 shadow-md' : 'bg-gray-100 hover:bg-gray-200'}`}
            style={timeRange === r.value ? {color:'#fff'} : {color:'#4b5563'}}>
            {r.label}
          </button>
        ))}
      </div>

      <div className="mb-5">
        <h3 className="text-sm font-bold text-gray-700 mb-2">표시할 센서 선택:</h3>
        <div className="flex gap-2 flex-wrap">
          {numberSensors.map(sensor => (
            <button key={sensor.sensorId} onClick={() => toggleSensor(sensor.sensorId)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${selectedSensors.includes(sensor.sensorId) ? 'border-transparent shadow-md' : 'bg-gray-50 border-gray-200 hover:bg-gray-100'}`}
              style={selectedSensors.includes(sensor.sensorId) ? {backgroundColor: sensor.color, color:'#fff'} : {color:'#6b7280'}}>
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
      ) : (
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="time" stroke="#94a3b8" tick={{fill:'#64748b'}} angle={-45} textAnchor="end" height={80} />
            <YAxis stroke="#94a3b8" tick={{fill:'#64748b'}} />
            <Tooltip contentStyle={{backgroundColor:'#fff',border:'1px solid #e2e8f0',borderRadius:'8px',boxShadow:'0 4px 6px -1px rgba(0,0,0,0.1)',color:'#1e293b'}} labelStyle={{color:'#64748b'}} />
            <Legend wrapperStyle={{color:'#475569'}} />
            {selectedSensors.map(id => {
              const s = getSensorInfo(id);
              return <Line key={id} type="monotone" dataKey={id} name={`${s.name} (${s.unit})`} stroke={s.color || '#3B82F6'} strokeWidth={2} dot={chartData.length < 50} activeDot={{r:6}} />;
            })}
          </LineChart>
        </ResponsiveContainer>
      )}

      {chartData.length > 0 && (
        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
          {selectedSensors.map(id => {
            const s = getSensorInfo(id);
            const vals = chartData.map(d => d[id]).filter(v => v != null);
            if (!vals.length) return null;
            return (
              <div key={id} className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                <div className="flex items-center gap-2 mb-3"><span className="text-2xl">{s.icon}</span><span className="font-bold text-gray-800">{s.name}</span></div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">평균:</span><span className="font-mono font-bold text-gray-800">{(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1)} {s.unit}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">최소:</span><span className="font-mono font-bold text-blue-600">{Math.min(...vals).toFixed(1)} {s.unit}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">최대:</span><span className="font-mono font-bold text-rose-600">{Math.max(...vals).toFixed(1)} {s.unit}</span></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default SensorChart;
