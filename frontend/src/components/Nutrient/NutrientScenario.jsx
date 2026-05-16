export default function NutrientScenario({ farmId }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 40, textAlign: 'center', border: '1px solid #e2e8f0' }}>
      <div style={{ fontSize: 48, opacity: 0.3, marginBottom: 12 }}>🎯</div>
      <h3 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', margin: '0 0 6px' }}>운전 시나리오</h3>
      <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>관수 방식 (일사량 비례 · 타이머 · 지정시각) · 밸브별 시간/유량 · EC/pH 도징비율</p>
      <p style={{ fontSize: 11, color: '#94a3b8', margin: '8px 0 0' }}>Phase 1.2 에서 구현 예정</p>
    </div>
  );
}
