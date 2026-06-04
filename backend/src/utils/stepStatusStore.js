// stepStatusStore — NR ⑤ stepped 진행 상태 실시간 메모리 store
//
// NR ⑤ 가 stepped step 발사 시점에 backend 로 POST /internal/step-status 알림.
// frontend NextRunCountdown 이 정확한 카운트다운 표시 (새로고침해도 동기화 유지).
//
// key: `${farmId}:${deviceId}` (한 device 의 stepped 동시 1개만 NR ⑤ 충돌 방어로 보장)
// value: { deviceId, command, target, stepStartedAt, stepDurSec, stepPauseSec, nextStepAt, phase, updatedAt }

const store = new Map();
const TTL_MS = 60 * 60 * 1000; // 1시간 후 자동 만료 (stuck 방어)

function makeKey(farmId, deviceId) {
  return `${farmId || "default"}:${deviceId}`;
}

export function setStepStatus(farmId, deviceId, info) {
  if (!deviceId) return;
  store.set(makeKey(farmId, deviceId), { ...info, deviceId, updatedAt: Date.now() });
}

export function clearStepStatus(farmId, deviceId) {
  if (!deviceId) return;
  store.delete(makeKey(farmId, deviceId));
}

export function getStepStatus(farmId, deviceId) {
  const v = store.get(makeKey(farmId, deviceId));
  if (!v) return null;
  if (Date.now() - v.updatedAt > TTL_MS) {
    store.delete(makeKey(farmId, deviceId));
    return null;
  }
  return v;
}

// schedule API 가 호출 — farm 의 모든 deviceId 별 stepStatus 반환
export function getStepStatusMapByFarm(farmId) {
  const result = {};
  const prefix = `${farmId || "default"}:`;
  for (const [key, value] of store.entries()) {
    if (!key.startsWith(prefix)) continue;
    if (Date.now() - value.updatedAt > TTL_MS) {
      store.delete(key);
      continue;
    }
    const deviceId = key.slice(prefix.length);
    result[deviceId] = value;
  }
  return result;
}
