# NR 자동화 엔진 수정 2건 (2026-08-29, 테스트 작성 중 발견)

> ✅ **2026-08-29 에디터 적용 + Deploy + 마스터 동기화 + 테스트 검증 완료.**
> 이 문서는 무엇을 왜 고쳤는지의 기록이다. 회귀는 backend/test/nr/ 의 테스트 2건이 막는다.

자동화 엔진 테스트(backend/test/nr/)를 만들면서 규칙 데이터의 실제 표기를 추적하다 발견.
근거: `function 3` (규칙 캐시, id `29efa2673f7cea1c`) 이 백엔드 API 응답을 **snake_case 로 변환**해
저장한다 — `house_id`, `last_triggered_at`, `cooldown_seconds`. camelCase 키는 규칙 객체에 없다.

수정은 **NR 에디터에서만** (flows.json 직접 수정 금지). 에디터 주소: `http://192.168.0.38:1880/node-red/`
수정 후 Deploy → `rpi-files/scripts/master-flows-sync.py` 로 마스터 갱신 → 테스트의 todo 2건이 통과로 바뀐다.

---

## 수정 1 — ⑤ 스케줄 실행 핸들러: 이력이 항상 house_0001 로 기록

**탭**: 자동화 엔진 / **노드**: `⑤ 스케줄 실행 핸들러` (id `fn_scheduled_executor`)

증상: 제어는 옳은 하우스로 가지만(`HOUSE_ID` 는 양쪽 표기 지원), **이력·step 상태 전송만**
camel 표기를 읽어 2동 자동화가 1동 이력으로 남는다. 두 곳을 고친다.

### 1-a. `sendControlLog` 함수 안 (약 95행 부근)

바꾸기 전:
```js
            houseId: rule.houseId || 'house_0001',
```
바꾼 후:
```js
            houseId: rule.house_id || rule.houseId || 'house_0001',
```

### 1-b. `sendStepStatus` 함수 안 (약 120행 부근)

바꾸기 전:
```js
            houseId: rule.houseId || 'house_0001',
```
바꾼 후:
```js
            houseId: rule.house_id || rule.houseId || 'house_0001',
```

> 같은 노드에 `houseId: rule.houseId || 'house_0001'` 이 **정확히 2번** 나온다 (Ctrl+F 로 확인).
> 둘 다 고칠 것. `HOUSE_ID` 선언부(`rule.house_id || rule.houseId || 'house_0001'`)는 이미 옳다 — 건드리지 말 것.

---

## 수정 2 — ④ 시간 스케줄러: 예약 시점 쿨다운이 한 번도 동작한 적 없음

**탭**: 자동화 엔진 / **노드**: `④ 시간 스케줄러` (id `fn_scheduler`)

증상: `rule.lastTriggeredAt`(camel) 만 읽는데 규칙엔 `last_triggered_at`(snake) 뿐 → 항상 undefined.
specific 시각 규칙은 30초 dedup 이 가려주지만, **interval 규칙**(예: 30분 간격 + 쿨다운 1시간)은
쿨다운이 무시되고 매 슬롯 발화한다.

### 위치: "쿨다운 체크" 주석 아래 (약 125행 부근)

바꾸기 전:
```js
    // 쿨다운 체크
    var fromDate = new Date();
    if (rule.lastTriggeredAt) {
        var cooldownEnd = new Date(new Date(rule.lastTriggeredAt).getTime() + cooldownSec * 1000);
```
바꾼 후:
```js
    // 쿨다운 체크 — 규칙 객체는 snake_case (function 3 매핑) 라 양쪽 표기를 읽는다 (2026-08-29 fix)
    var fromDate = new Date();
    var lastTrig = rule.last_triggered_at || rule.lastTriggeredAt;
    if (lastTrig) {
        var cooldownEnd = new Date(new Date(lastTrig).getTime() + cooldownSec * 1000);
```

> 바로 위의 `cooldownSec` 선언(`rule.cooldownSeconds || rule.cooldown_seconds || 300`)은
> 이미 양쪽을 읽는다 — 건드리지 말 것.

---

## 검증

1. 에디터 Deploy 후 RPi 에서: `python3 rpi-files/scripts/master-flows-sync.py` (마스터 갱신 → PC 로 pull)
2. PC 에서: `cd backend && npm test`
   - 지금: `todo 2` (실패해도 suite 는 green)
   - 수정 후: todo 2건이 **통과** 로 바뀐다 → 테스트에서 `{ todo: ... }` 옵션을 지워 정식 승격
3. 실동작 확인: 2동 규칙 발화 후 웹 제어 이력에서 하우스가 `house_0002` 로 찍히는지 확인
