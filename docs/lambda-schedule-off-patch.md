# Lambda 패치 — schedule-off 의 `delay_sec` 필드 전달

## 문제
현재 Lambda (`lambda-full-code.py`) 는 frontend 가 보낸 `delay_sec` 필드를
IoT Core 로 publish 할 때 누락 → NR function 2 가 `delaySec=0` 으로 받아
schedule-off 무시 (timer 등록 X).

## 수정 위치
`lambda_handler` 함수의 control_msg 생성 부분 (line 140-160 부근).

## 적용 방법
1. AWS Console → Lambda → 해당 함수 (제어 명령 처리)
2. 코드 편집기에서 아래 patch 적용
3. Deploy

## 변경 내용

### Before (line 140-159 부근)
```python
modbus = body.get('modbus', None)
duration = body.get('duration', 0)

# ========================================
# IoT 메시지 발행
# ========================================
topic = f"smartfarm/{house_id}/{window_id}/control"

control_msg = {
    "command": command,
    "timestamp": timestamp,
    "house_id": house_id,
    "window_id": window_id,
    "operator": operator,
    "request_id": request_id,
    "duration": duration
}

if modbus is not None:
    control_msg["modbus"] = modbus
```

### After (delay_sec 추가)
```python
modbus = body.get('modbus', None)
duration = body.get('duration', 0)
delay_sec = body.get('delay_sec', 0)  # 자동 OFF 예약 시간 (초)

# ========================================
# IoT 메시지 발행
# ========================================
topic = f"smartfarm/{house_id}/{window_id}/control"

control_msg = {
    "command": command,
    "timestamp": timestamp,
    "house_id": house_id,
    "window_id": window_id,
    "operator": operator,
    "request_id": request_id,
    "duration": duration
}

if modbus is not None:
    control_msg["modbus"] = modbus
if delay_sec and delay_sec > 0:
    control_msg["delay_sec"] = delay_sec
```

## 변경 라인 수
2줄 추가 (line 142 `delay_sec = body.get(...)` + line 160 `if delay_sec ...` 블록).

## 영향
- 기존 명령 (on/off/open/close): 변경 없음 (delay_sec 미사용)
- 새 명령 (schedule-off): delay_sec 전달 → NR function 2 가 timer 등록 가능
