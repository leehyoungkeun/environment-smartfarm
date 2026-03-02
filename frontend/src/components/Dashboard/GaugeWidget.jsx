import React from 'react';
import { AnimatedNumber } from '../../hooks/useAnimatedValue.jsx';

const getGaugeColor = (percentage) => {
  if (percentage < 25) return '#3B82F6';
  if (percentage < 50) return '#10B981';
  if (percentage < 75) return '#F59E0B';
  return '#EF4444';
};

const calculatePercentage = (value, min, max) => {
  if (value === null || value === undefined || min === null || max === null) return 50;
  const range = max - min;
  const adjusted = value - min;
  return Math.max(0, Math.min(100, (adjusted / range) * 100));
};

/**
 * 개별 게이지 차트
 * - 모든 동적 SVG 속성을 CSS style로 관리 (SVG attribute 대신)
 * - CSS transition이 style 속성에만 안정적으로 적용되므로
 * - contain: layout style paint로 repaint를 이 요소 안에 격리
 */
const GaugeChart = React.memo(({ sensor, value, percentage }) => {
  const color = sensor.color || getGaugeColor(percentage);
  const rotation = (percentage / 100) * 180 - 90;
  const strokeDash = percentage * 2.51;

  return (
    <div style={{
      background: '#f8fafc',
      borderRadius: 14,
      padding: 16,
      border: '2px solid #e2e8f0',
      contain: 'layout style paint',
    }}>
      <div className="flex items-center gap-2 mb-3">
        <span style={{ fontSize: 22 }}>{sensor.icon}</span>
        <span style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>{sensor.name}</span>
      </div>

      <div className="w-full mb-2">
        <svg viewBox="0 0 200 110" className="w-full" style={{ display: 'block' }}>
          {/* 배경 호 */}
          <path
            d="M 20 90 A 80 80 0 0 1 180 90"
            fill="none"
            stroke="#e5e7eb"
            strokeWidth="10"
            strokeLinecap="round"
          />
          {/* 값 호 — stroke/strokeDasharray를 CSS style로 설정하여 transition 보장 */}
          <path
            d="M 20 90 A 80 80 0 0 1 180 90"
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            style={{
              stroke: color,
              strokeDasharray: `${strokeDash} 251`,
              transition: 'stroke-dasharray 0.8s ease-out, stroke 0.5s ease',
            }}
          />
          {/* 바늘 — CSS transform + transformOrigin (SVG transform 속성은 CSS transition 미적용) */}
          <line
            x1="100" y1="90"
            x2="100" y2="25"
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{
              stroke: color,
              transform: `rotate(${rotation}deg)`,
              transformOrigin: '100px 90px',
              transition: 'transform 0.8s ease-out, stroke 0.5s ease',
            }}
          />
          {/* 중심점 */}
          <circle cx="100" cy="90" r="5" style={{ fill: color, transition: 'fill 0.5s ease' }} />
          <circle cx="100" cy="90" r="2.5" fill="white" opacity="0.6" />
        </svg>
        <div className="text-center" style={{ marginTop: -24 }}>
          <span style={{ fontSize: 26, fontWeight: 900, fontFamily: 'monospace', color, letterSpacing: '-0.02em', transition: 'color 0.5s ease' }}>
            <AnimatedNumber value={typeof value === 'number' ? value : null} precision={sensor.precision || 1} />
          </span>
          <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 4 }}>{sensor.unit}</span>
        </div>
      </div>

      <div className="flex justify-between text-[10px] text-gray-400 px-1">
        <span>{sensor.min}{sensor.unit}</span>
        <span>{sensor.max}{sensor.unit}</span>
      </div>
    </div>
  );
}, (prev, next) =>
  prev.value === next.value &&
  prev.percentage === next.percentage &&
  prev.sensor.sensorId === next.sensor.sensorId &&
  prev.sensor.color === next.sensor.color
);

/** GaugeWidget — 센서 값이 실제로 변한 경우에만 재렌더링 */
const GaugeWidget = React.memo(({ sensors, latestData }) => {
  const numberSensors = sensors?.filter(s => s.type === 'number') || [];

  if (numberSensors.length === 0) return null;

  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
      <div style={{ background: '#0891b2', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderRadius: '16px 16px 0 0' }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: '#fff' }}>🎯 센서 게이지</h2>
        <span style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 8 }}>
          {numberSensors.length}개
        </span>
      </div>

      <div style={{ padding: '16px' }}>
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
}, (prev, next) => {
  if (prev.sensors !== next.sensors) return false;
  const pd = prev.latestData?.data || {};
  const nd = next.latestData?.data || {};
  return prev.sensors
    .filter(s => s.type === 'number')
    .every(s => pd[s.sensorId] === nd[s.sensorId]);
});

export default GaugeWidget;
