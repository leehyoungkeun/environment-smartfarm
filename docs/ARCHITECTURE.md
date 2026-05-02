# SmartFarm 통신 아키텍처

> 시스템 전체의 통신 패턴을 4개 카테고리로 분리하고, 각 동작이 어디에 속하는지 명확히 한다.
> 신규 기능 추가 시 이 문서를 따라 카테고리를 정하고, 동일 카테고리의 기존 패턴을 복사한다.

## 핵심 원칙

| 원칙 | 의미 |
|---|---|
| **RPi-Primary** | 농장 설정 (houseConfig, modules) 의 source of truth 는 RPi SQLite. PC PostgreSQL 은 mirror cache. |
| **Hybrid (LAN + 외부)** | 같은 동작이라도 LAN 환경에서는 HTTP 직접, 외부 환경에서는 WebSocket / Lambda 사용. |
| **외부 환경 우선** | 외부 (production) 에서 동작 안 하면 안 됨. LAN 은 빠른 fallback. |
| **single source per category** | 같은 동작에 두 가지 경로가 동시 사용되면 안 됨 (예: A 와 D 혼용 X). |

## 4개 카테고리

### A. RPi 양방향 (Query) — WebSocket + MQTT

> RPi 에서 실시간 상태/데이터를 가져와야 하는 경우.
> 응답 받기 위해 round-trip 필요.

```
frontend wsService.requestXxx(farmId)
   → backend WebSocket 'xxx:query' 핸들러
   → mqttService.publishXxxQuery(farmId)
   → MQTT smartfarm/{farmId}/xxx/query
   → RPi mqtt in 구독 → 처리 → MQTT publish
   → MQTT smartfarm/{farmId}/xxx/status
   → backend mqtt 구독 → _cacheXxxStatus + emit
   → backend WebSocket broadcast 'xxx:status'
   → frontend wsService.subscribe('xxx:status')
```

| 사용처 | 토픽 (in/out) | 응답 형식 |
|---|---|---|
| **relay:query** | relay/query → relay/status | { unitId, coils } |
| **sensor:query** | sensor/query → sensor/status | { unitId, fc, address, raw, divider, signed, sensorType } |
| **sync:query** | sync/query → sync/status | { unsynced, synced, total, syncRunning, operationMode, lastSyncResult } |
| **system:query** | system/query → system/status | { nodeRed, rpiExpress, smartfarmSystem } (각 status, uptime, restarts, memory, cpu) |

### B. RPi 단방향 (Command) — WebSocket + MQTT

> RPi 에 명령을 내리고 응답 받을 필요 없는 경우 (또는 응답이 별도 status 토픽으로).

```
frontend wsService.send({ type: 'xxx:command', ... })
   → backend WebSocket 'xxx:command' 핸들러
   → mqttService.publishXxxCommand(...)
   → MQTT smartfarm/{farmId}/xxx/(query|command|reset 등)
   → RPi mqtt in → 처리 (응답 없음 또는 별도 status 토픽)
```

| 사용처 | 토픽 | 처리 |
|---|---|---|
| **system:command** | system/command | RPi 가 PM2 restart 등 실행 |
| **relay:reset** | relay/reset | RPi 가 등록된 모든 relay 모듈 OFF |
| **sync:command** | sync/command | RPi 가 /api/sync/{action} HTTP 호출 (start/stop/skip) |

### C. PostgreSQL Persistent — REST API

> 농장/하우스/카메라/자동화 규칙/알림 설정 등 영구 저장 데이터.
> PC backend 의 PostgreSQL 이 source of truth (또는 RPi SQLite mirror).

```
frontend → PC backend REST API (https) → PostgreSQL
```

| 사용처 | 라우트 |
|---|---|
| 카메라 CRUD | /api/cameras/:farmId |
| 자동화 규칙 CRUD | /api/automation/* |
| 알림 설정 | /api/config/system-settings/:farmId |
| 시스템 설정 (수집 주기, 보관 기간) | /api/config/system-settings/:farmId |
| 하우스/장치 (RPi-Primary mirror) | /api/config/farm/:farmId |

### D. 개별 Device 제어 — AWS Lambda

> 단일 device 의 단방향 제어. 응답 받을 필요 없음. backend 우회 가능.

```
frontend → AWS API Gateway → Lambda → AWS IoT MQTT
   → smartfarm/{houseId}/{deviceId}/control
   → RPi mqtt in → 함수 → modbus write
```

| 사용처 | 형식 |
|---|---|
| 윈도우/팬/펌프 제어 | { house_id, window_id, command, modbus } |
| 채널테스트 sendCmd | 동일 |

## Hybrid 패턴

각 frontend 함수는 **외부 환경 우선 + LAN HTTP fallback**:

```js
async function loadStatus() {
  // 1. WebSocket 우선 (외부 환경 동작)
  if (wsService.isConnected()) {
    const result = await waitForResponse('xxx:status', () => {
      wsService.requestXxxStatus(farmId);
    });
    if (result) {
      setData(result);
      return;
    }
  }
  // 2. LAN HTTP fallback (빠름)
  const res = await axiosBase.get(`${rpiUrl}/xxx/status`, ...);
  setData(res.data);
}
```

LAN 모드 (`isFarmLocalMode() === true`) 에서는 WebSocket 미연결 일 수 있으므로 HTTP 가 주 경로.

## 새 기능 추가 가이드

1. **분류**: 단방향 명령? 양방향 query? 영구 저장? 단일 device?
2. **카테고리 선택**: A/B/C/D 중 하나
3. **기존 패턴 복사**:
   - A: `sensor:query` 패턴 (sensor → 새 이름)
   - B: `relay:reset` 패턴
   - C: `cameras` 라우트 패턴
   - D: AWS Lambda 호출 패턴
4. **두 경로 혼용 금지**: 같은 동작에 D + A 동시 사용 X

## 변경 이력

- 2026-05-02 (P1~P6): SyncPanel + ModbusOverviewPanel + SystemManagePanel hybrid 적용. backend RPi 직접 fetch 제거. 4 카테고리 정의.

## 참고

- `backend/src/services/mqttClient.js` — 모든 publish/subscribe 메서드
- `backend/src/services/wsServer.js` — WebSocket 핸들러
- `frontend/src/services/wsService.js` — frontend WebSocket 클라이언트
- `frontend/src/services/apiSwitcher.js` — LAN/외부 환경 판단 (IS_CLOUD_MODE, isFarmLocalMode)
- `docs/nodered-*.json` / `docs/nodered-*.js` — RPi Node-RED paste 용 코드
