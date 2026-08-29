# 시뮬레이션 격리 + 이미지 미결 정리 — 에디터 작업 (2026-08-29, B4·B5)

에디터 `http://192.168.0.38:1880/node-red/` (admin). 전부 끝내고 **배포 한 번**.

## 1. `센서 수집` › `③ 센서 데이터 수집` — 코드 전체 교체

노드 더블클릭 → 코드 전체 선택(Ctrl+A) → 삭제 → [sensor-collect.js](sensor-collect.js) 내용 붙여넣기 → 완료.

바뀐 동작:
- Modbus 값이 없으면 **값을 지어내지 않는다** → 서버 `SensorDataStalled` 가 울린다
- 시뮬레이션은 `/home/lhk/smartfarm/.sim-mode` 파일이 있을 때만 (ecosystem 이 `SIM_MODE=1` 주입), 그때도 `quality: simulated` 로 표시 → 서버가 지표·임계 알림에서 제외
- 1호는 실측이 있으므로 배포 후 동작 변화 없음 (로그에 `📡 1개 하우스 … 수집` 그대로)

## 2. `SQLite 초기화` › `automation_rules 테이블` — 4행

```sql
farm_id TEXT NOT NULL DEFAULT 'farm_0001',
```
→
```sql
farm_id TEXT NOT NULL DEFAULT 'farm_unknown',
```
기본값이 실제로 쓰이면(=farmId 를 안 넣은 버그) `farm_unknown` 으로 드러나게. 기존 DB 에는 영향 없음(CREATE IF NOT EXISTS).

## 3. http request 2개 — Basic 인증 해제 (credentialSecret 준비)

- `AWS IoT 제어 수신` › `http_control_alarm`
- `센서 수집` › `http_sensor_alarm`

노드 더블클릭 → **인증을 사용** 체크 해제 → 완료. (둘 다 `x-api-key` 로 인증하므로 Basic 은 쓰이지 않는데, 이 빈 자격증명이 `flows_cred.json` 에 남아 이미지 복제 시 전 농장이 같은 암호화 키를 공유하게 만든다.)

배포 후 `flows_cred.json` 이 비어야(`{}` 또는 `{"$":""}` 수준) 정상 — 그러면 `settings.js` 의 `credentialSecret` 을 농장별 값으로 바꿔도 잃을 것이 없다.

## 배포 후 확인

```bash
# 1호
grep -c "시뮬레이션 사용" /home/lhk/.pm2/logs/node-red-out.log   # 새 로그엔 없어야
cat /home/lhk/.node-red/flows_cred.json                            # 비어 있어야
# 서버
docker exec postgres17 psql -U smartfarm -d smartfarm_db -c "select metadata->>'quality', count(*) from sensor_data where timestamp>now()-interval '10 minutes' group by 1"
```
