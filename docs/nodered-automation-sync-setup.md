# Node-RED 변경 - 자동화 규칙 MQTT sync

## 개요
PC 서버가 규칙 변경 시 MQTT 알림 → RPi가 PC에서 규칙 pull
기존 자동화 평가 플로우(② fn_evaluate_rules)는 변경 없음

## 변경 1: MQTT-in 노드 추가

### 설정
- **노드**: mqtt-in
- **Server**: AWS IoT Core (기존 mqtt-broker 노드 재사용)
- **Topic**: `smartfarm/+/automation/sync`
- **QoS**: 1
- **Output**: auto-detect (JSON)

### 연결
MQTT-in → function 3 (규칙 로드 트리거)

## 변경 2: function 3 수정 (규칙 로드 소스 변경)

### 현재 (RPi 로컬 API에서 로드)
```
inject (60초) → http request (localhost:1880/api/automation/farm_0001)
  → function 3 (JSON 파싱 → global.set('automationRules'))
```

### 변경 후 (PC 서버에서 pull + MQTT 트리거 추가)
```
inject (60초) ─────────┐
                        ├→ http request (http://192.168.137.1:3000/api/automation/farm_0001)
MQTT-in (sync 알림) ───┘     │
                              ↓
                        function 3 (JSON 파싱 → global.set('automationRules'))
```

### http request 노드 URL 변경
- **기존**: `http://localhost:1880/api/automation/{farmId}`
- **변경**: `http://192.168.137.1:3000/api/automation/{farmId}`
- **헤더**: `x-api-key: smartfarm-sensor-key` (인증)

### function 3 코드 (변경 없음)
기존 코드 그대로 유지 — 이미 HTTP 응답 JSON을 파싱하여 global에 저장하는 로직

## 변경 3: MQTT-in → http request 트리거

MQTT sync 알림 수신 시 즉시 http request를 트리거해야 함.
방법: MQTT-in의 출력을 http request 노드의 입력에 연결
(http request 노드는 URL이 고정이므로, 어떤 msg가 들어와도 요청 실행)

## 동작 흐름

```
1. 사용자가 프론트에서 규칙 생성/수정/삭제
2. 프론트 → PC 서버 API (PostgreSQL 저장)
3. PC 서버 → AWS API Gateway → Lambda → MQTT publish
4. RPi MQTT-in 수신 → http request → PC 서버에서 규칙 GET
5. function 3 → global.set('automationRules')
6. ② fn_evaluate_rules가 다음 주기에 최신 규칙으로 평가

백업: inject 60초 간격 폴링으로 MQTT 유실 시에도 규칙 동기화
```

## 작업 순서
1. MQTT-in 노드 추가 (토픽: smartfarm/+/automation/sync)
2. http request 노드 URL 변경 (PC 서버)
3. http request 노드에 헤더 추가 (x-api-key)
4. MQTT-in 출력 → http request 입력 와이어 연결
5. Deploy & 테스트
