# Node-RED — 공통 API 키 제거 (B2, 2026-08-29)

RPi 는 이제 `SENSOR_API_KEY` 환경변수로 **농장별 키**를 받는다 (ecosystem.config.js 가 `.sensor-api-key` 를 읽어 주입).
`env.get('SENSOR_API_KEY')` 를 쓰는 함수(센서 수집 ①②⑤, 온/오프라인 모드 결정, 데이터 동기화 배치·규칙·제어이력)는 이미 농장 키로 나간다.
아래는 **아직 공통 키 `smartfarm-sensor-key` 로 나가는 자리** — 에디터에서 고친다. 전부 끝내고 배포 한 번.

## 0. `시작 초기화` 탭 — `1-startup-sensorapikey.json` 가져오기

`global.sensorApiKey` 를 env 에서 채운다. `global.get('sensorApiKey') || '…'` 를 쓰는 함수들이 이걸로 농장 키를 받게 된다.
(가져온 뒤 배포하면 부팅 3초 후 1회 실행. 지금 당장 적용하려면 inject 버튼을 한 번 누른다.)

## 1. `자동화 평가` › `규칙 조회 URL` 3행

```js
msg.headers = { 'x-api-key': 'smartfarm-sensor-key' };
```
→
```js
msg.headers = { 'x-api-key': env.get('SENSOR_API_KEY') || global.get('sensorApiKey') || '' };
```

## 2. `자동화 평가` › `⑤ 스케줄 실행 핸들러` 90행·118행 (두 곳 같음)

```js
'x-api-key': global.get('sensorApiKey') || 'smartfarm-sensor-key'
```
→
```js
'x-api-key': env.get('SENSOR_API_KEY') || global.get('sensorApiKey') || ''
```

## 3. `데이터 동기화` › `automationActive 조회 준비` 7행

```js
msg.headers = { 'x-api-key': 'smartfarm-sensor-key' };
```
→
```js
msg.headers = { 'x-api-key': env.get('SENSOR_API_KEY') || global.get('sensorApiKey') || '' };
```

## 4. `모듈 동기화` › `백엔드 API 호출 준비` 11행, `type=house_* 만 처리` 24행

```js
const apiKey = global.get('sensorApiKey') || 'smartfarm-sensor-key';
```
→
```js
const apiKey = env.get('SENSOR_API_KEY') || global.get('sensorApiKey') || '';
```

## 5. http request 노드 2개 — 노드 설정의 헤더에 박힌 키

- `자동화 평가` 탭의 이름 없는 `http request` (⑤ 뒤가 아닌, 규칙 조회 쪽)
- `센서 수집` › `http_sensor_alarm`

노드 더블클릭 → **헤더** 섹션에 `x-api-key: smartfarm-sensor-key` 행이 있으면 **삭제**.
(함수에서 `msg.headers` 로 넘기는 값이 대신 쓰인다. `http_sensor_alarm` 앞 함수가 `msg.headers` 를 안 넣으면
그 함수에 `msg.headers = { 'x-api-key': env.get('SENSOR_API_KEY') };` 한 줄 추가.)

## 6. `양액 자동제어` (비활성) — 8곳

같은 패턴 `global.get('sensorApiKey') || 'smartfarm-sensor-key'` → `env.get('SENSOR_API_KEY') || global.get('sensorApiKey') || ''`.
탭이 비활성이라 급하지 않지만 재활성 전 필수.

## ⚠ 7. 탭 환경변수가 process.env 를 덮는다 — 반드시 삭제

`REST API (오프라인)` · `자동화 평가` · `센서 수집` · `온/오프라인 감지` · `데이터 동기화` 다섯 탭의 **탭 속성 → 환경 변수** 에
`SENSOR_API_KEY = smartfarm-sensor-key` 가 정의돼 있다. Node-RED 의 `env.get()` 은 **탭(flow) 환경변수를 process.env 보다 먼저** 보므로,
ecosystem 이 주입한 농장 키가 있어도 이 다섯 탭 안의 함수는 전부 공통 키를 받는다. (2026-08-29 실측: 서버 로그 `apiKey=smartfarm-…`)

탭 이름 더블클릭(또는 탭 우클릭 → 편집) → **환경 변수** 섹션 → `SENSOR_API_KEY` 행의 × → 완료. 다섯 탭 모두. `SERVER_URL` 은 그대로 둔다.
같은 자리의 `HOUSE_ID = house_0001` 도 다중 하우스에서 문제가 되므로 함께 지우는 것이 맞다(폴백 `|| 'house_0001'` 이 코드에 있어 동작은 유지됨).

## 검증

```bash
# RPi
python3 nr-audit.py | grep -c "smartfarm-sensor-key"     # 0 이어야 (양액 제외)
# 서버 (배포 후) — 공통 키를 아직 쓰는 농장이 경고로 찍힌다. farm_0001 이 없어야 정상.
pm2 logs smartfarm-backend --nostream --lines 2000 | grep legacy-key
```
