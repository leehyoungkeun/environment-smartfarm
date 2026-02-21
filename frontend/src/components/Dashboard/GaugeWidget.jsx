import React from 'react';

const GaugeWidget = ({ sensors, latestData }) => {
  const calculatePercentage = (value, min, max) => {
    if (value === null || value === undefined || min === null || max === null) return 50;
    const range = max - min;
    const adjusted = value - min;
    return Math.max(0, Math.min(100, (adjusted / range) * 100));
  };

  const getGaugeColor = (percentage) => {
    if (percentage < 25) return '#3B82F6';
    if (percentage < 50) return '#10B981';
    if (percentage < 75) return '#F59E0B';
    return '#EF4444';
  };

  const GaugeChart = ({ sensor, value, percentage }) => {
    const color = sensor.color || getGaugeColor(percentage);
    const rotation = (percentage / 100) * 180 - 90;
    const strokeDash = percentage * 2.51;

    return (
      <div style={{background:'#f8fafc',borderRadius:14,padding:16,border:'2px solid #e2e8f0',transition:'all 0.2s'}}>
        <div className="flex items-center gap-2 mb-3">
          <span style={{fontSize:22}}>{sensor.icon}</span>
          <span style={{fontSize:14,fontWeight:800,color:'#0f172a'}}>{sensor.name}</span>
        </div>

        <div className="relative w-full h-28 md:h-32 mb-2">
          <svg viewBox="0 0 200 120" className="w-full h-full">
            {/* 배경 호 */}
            <path
              d="M 20 100 A 80 80 0 0 1 180 100"
              fill="none"
              stroke="#e5e7eb"
              strokeWidth="10"
              strokeLinecap="round"
            />
            {/* 값 호 */}
            <path
              d="M 20 100 A 80 80 0 0 1 180 100"
              fill="none"
              stroke={color}
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${strokeDash} 251`}
              style={{ 
                filter: `drop-shadow(0 0 4px ${color}30)`,
                transition: 'stroke-dasharray 0.8s ease-out'
              }}
            />
            {/* 바늘 */}
            <line
              x1="100" y1="100"
              x2="100" y2="35"
              stroke={color}
              strokeWidth="2.5"
              strokeLinecap="round"
              transform={`rotate(${rotation} 100 100)`}
              style={{ transition: 'transform 0.8s ease-out' }}
            />
            {/* 중심점 */}
            <circle cx="100" cy="100" r="5" fill={color} />
            <circle cx="100" cy="100" r="2.5" fill="white" opacity="0.6" />
          </svg>

          <div className="absolute bottom-0 left-0 right-0 text-center">
            <div style={{fontSize:26,fontWeight:900,fontFamily:'monospace',color,letterSpacing:'-0.02em'}}>
              {value !== null && value !== undefined
                ? `${typeof value === 'number' ? value.toFixed(sensor.precision || 1) : value}`
                : '—'}
              <span style={{fontSize:12,color:'#94a3b8',marginLeft:4}}>{sensor.unit}</span>
            </div>
          </div>
        </div>

        <div className="flex justify-between text-[10px] text-gray-400 px-1">
          <span>{sensor.min}{sensor.unit}</span>
          <span>{sensor.max}{sensor.unit}</span>
        </div>
      </div>
    );
  };

  const numberSensors = sensors?.filter(s => s.type === 'number') || [];

  if (numberSensors.length === 0) return null;

  return (
    <div style={{background:'#fff',border:'1px solid #e2e8f0',borderRadius:16,overflow:'hidden',boxShadow:'0 1px 3px rgba(0,0,0,0.06)'}}>
      <div style={{background:'#0891b2',padding:'12px 18px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <h2 style={{fontSize:16,fontWeight:800,color:'#fff'}}>🎯 센서 게이지</h2>
        <span style={{background:'rgba(255,255,255,0.2)',color:'#fff',fontSize:12,fontWeight:600,padding:'3px 10px',borderRadius:8}}>
          {numberSensors.length}개
        </span>
      </div>

      <div style={{padding:'16px'}}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {numberSensors.map(sensor => {
            const value = latestData?.data?.[sensor.sensorId];
            const percentage = calculatePercentage(value, sensor.min, sensor.max);
            return (
              <GaugeChart
                key={sensor.sensorId}
                sensor={sensor}
                value={value}
                percentage={percentage}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default GaugeWidget;
