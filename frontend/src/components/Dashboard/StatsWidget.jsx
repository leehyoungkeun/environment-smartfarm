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
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-4 md:p-5">
      <h2 className="text-base md:text-lg font-bold text-gray-800 mb-4">24시간 통계</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {numberSensors.map(sensor => {
          const stats = calculateStats(sensor.sensorId);
          if (!stats) {
            return (
              <div key={sensor.sensorId} className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{sensor.icon}</span>
                  <span className="text-sm font-semibold text-gray-800">{sensor.name}</span>
                </div>
                <p className="text-xs text-gray-400">데이터 없음</p>
              </div>
            );
          }

          const isWarning = stats.current !== null && stats.current !== undefined && (
            (sensor.min !== null && stats.current < sensor.min) ||
            (sensor.max !== null && stats.current > sensor.max)
          );

          return (
            <div key={sensor.sensorId} className="bg-gray-50 rounded-xl p-4 border border-gray-200
                                                   hover:bg-gray-100 transition-all duration-200">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">{sensor.icon}</span>
                <span className="text-sm font-semibold text-gray-800">{sensor.name}</span>
              </div>

              {/* 현재값 */}
              <div className="mb-3">
                <p className="text-[10px] text-gray-400 mb-0.5">현재</p>
                <p className={`text-2xl font-bold font-mono ${isWarning ? 'text-rose-600' : 'text-emerald-600'}`}>
                  {stats.current !== null && stats.current !== undefined
                    ? `${stats.current}`
                    : '—'}
                  <span className="text-xs text-gray-400 ml-1">{sensor.unit}</span>
                </p>
              </div>

              {/* 통계 */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <p className="text-[10px] text-gray-400">평균</p>
                  <p className="text-sm font-mono font-semibold text-gray-700">{stats.avg}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400">최저</p>
                  <p className="text-sm font-mono font-semibold text-blue-600">{stats.min}</p>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400">최고</p>
                  <p className="text-sm font-mono font-semibold text-rose-600">{stats.max}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default StatsWidget;
