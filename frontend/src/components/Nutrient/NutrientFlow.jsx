export default function NutrientFlow({ farmId }) {
  return (
    <div style={{ background: '#fff', borderRadius: 12, padding: 40, textAlign: 'center', border: '1px solid #e2e8f0' }}>
      <div style={{ fontSize: 48, opacity: 0.3, marginBottom: 12 }}>📋</div>
      <h3 style={{ fontSize: 16, fontWeight: 800, color: '#0f172a', margin: '0 0 6px' }}>흐름도 / 관수 이력</h3>
      <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>도싱 탱크 → 혼합 → 펌프 → 14개 밸브 흐름도</p>
      <p style={{ fontSize: 11, color: '#94a3b8', margin: '8px 0 0' }}>Phase 1.2 에서 구현 예정</p>
    </div>
  );
}
