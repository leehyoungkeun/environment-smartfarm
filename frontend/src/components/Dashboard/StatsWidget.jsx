import React from 'react';

const StatsWidget = ({ sensors, latestData, historyData }) => {
  const calculateStats = (sensorId) => {
    if (!historyData || historyData.length === 0) return null;
    const values = historyData
      .map(d => d.data?.[sensorId])
      .filter(v => v !== undefined && v !== null);
    if (values.length === 0) return null;
    const current = latestData?.data?.[sensorId];
    const avg = (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);
    const min = Math.min(...values).toFixed(1);
    const max = Math.max(...values).toFixed(1);
    return { current, avg, min, max };
  };

  const numberSensors = sensors?.filter(s => s.type === 'number') || [];
  if (numberSensors.length === 0) return null;

  const hasData = numberSensors.some(s => calculateStats(s.sensorId));
  if (!hasData) return null;

  return (
    <div style={{background:'#fff',border:'1px solid #e2e8f0',borderRadius:16,overflow:'hidden',boxShadow:'0 1px 3px rgba(0,0,0,0.06)'}}>
      <div style={{background:'#ea580c',padding:'12px 18px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <h2 style={{fontSize:16,fontWeight:800,color:'#fff'}}>📊 24시간 통계</h2>
        <span style={{background:'rgba(255,255,255,0.2)',color:'#fff',fontSize:12,fontWeight:600,padding:'3px 10px',borderRadius:8}}>
          실시간
        </span>
      </div>

      <div style={{padding:'16px'}}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {numberSensors.map(sensor => {
            const stats = calculateStats(sensor.sensorId);
            if (!stats) {
              return (
                <div key={sensor.sensorId} style={{background:'#f8fafc',borderRadius:14,padding:16,border:'2px solid #e2e8f0'}}>
                  <div className="flex items-center gap-2 mb-2">
                    <span style={{fontSize:22}}>{sensor.icon}</span>
                    <span style={{fontSize:14,fontWeight:800,color:'#0f172a'}}>{sensor.name}</span>
                  </div>
                  <p style={{fontSize:13,color:'#94a3b8'}}>데이터 없음</p>
                </div>
              );
            }

            const isWarning = stats.current !== null && stats.current !== undefined && (
              (sensor.min !== null && stats.current < sensor.min) ||
              (sensor.max !== null && stats.current > sensor.max)
            );

            return (
              <div key={sensor.sensorId} style={{
                background: isWarning ? '#fef2f2' : '#f8fafc',
                borderRadius:14,padding:16,
                border: isWarning ? '2px solid #fecaca' : '2px solid #e2e8f0',
                transition:'all 0.2s'}}>
                <div className="flex items-center gap-2 mb-3">
                  <span style={{fontSize:22}}>{sensor.icon}</span>
                  <span style={{fontSize:14,fontWeight:800,color:'#0f172a'}}>{sensor.name}</span>
                </div>

                {/* 현재값 */}
                <div style={{marginBottom:12}}>
                  <p style={{fontSize:11,color:'#94a3b8',fontWeight:600,marginBottom:2}}>현재</p>
                  <p style={{fontSize:30,fontWeight:900,fontFamily:'monospace',color: isWarning ? '#dc2626' : '#059669',lineHeight:1}}>
                    {stats.current !== null && stats.current !== undefined
                      ? `${stats.current}`
                      : '—'}
                    <span style={{fontSize:12,color:'#94a3b8',marginLeft:4}}>{sensor.unit}</span>
                  </p>
                </div>

                {/* 통계 */}
                <div className="grid grid-cols-3 gap-2" style={{paddingTop:10,borderTop:'2px solid #e2e8f0'}}>
                  <div>
                    <p style={{fontSize:11,color:'#94a3b8',fontWeight:600}}>평균</p>
                    <p style={{fontSize:16,fontWeight:900,fontFamily:'monospace',color:'#0f172a'}}>{stats.avg}</p>
                  </div>
                  <div>
                    <p style={{fontSize:11,color:'#94a3b8',fontWeight:600}}>최저</p>
                    <p style={{fontSize:16,fontWeight:900,fontFamily:'monospace',color:'#2563eb'}}>{stats.min}</p>
                  </div>
                  <div>
                    <p style={{fontSize:11,color:'#94a3b8',fontWeight:600}}>최고</p>
                    <p style={{fontSize:16,fontWeight:900,fontFamily:'monospace',color:'#dc2626'}}>{stats.max}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default StatsWidget;
