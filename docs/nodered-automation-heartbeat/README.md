# 자동제어 엔진 심박 감시 (엔진 정지 = 조용한 사각지대) — 2026-08-30

## 문제
`SensorDataStalled` 는 **센서가 들어오는지**만 본다. 센서는 멀쩡히 수집되는데
② 규칙 평가 루프만 죽으면 — 측창·환기 자동화가 통째로 멈춰도 알림이 없다.
데이터가 아니라 **작물 직접 피해**라 cleanup 보다 위험하다.

## 해결 (엔진이 매 분 심박 → 서버가 '안 온 것'을 감지)
```
inject(60초) → fn_load_rules(①, 매 분 첫 통과만) → [fn_evaluate_rules(②), 엔진 심박 준비]
                                                        → 엔진 심박 전송(http) → POST /internal/automation-heartbeat
   → automation_heartbeat 테이블 → smartfarm_automation_engine_last_run_timestamp
   → 규칙 AutomationEngineStalled: 3분(180s) 무심박 → Discord (critical)
```
심박을 `fn_load_rules` **출력**에 병렬로 다는 게 핵심:
- 같은 분 재실행이면 `fn_load_rules` 가 `null` 을 반환 → 심박도 안 감(정상, 매 분 1회).
- 엔진이 실제로 평가한 분에만 심박 → "루프가 돈다"의 정확한 신호.

## 서버 (배포됨)
- `prisma/migration-automation-heartbeat.sql` — **운영 DB 수동 적용**
- `internal.routes.js` POST `/internal/automation-heartbeat`
- `app.js` gauge `smartfarm_automation_engine_last_run_timestamp`
- `monitoring/alert_rules.yml` AutomationEngineStalled (180s, critical)

## NR 에디터 작업 (「자동화 평가」 탭)
1. `automation-heartbeat-nodes.json` 가져오기 → 「엔진 심박 준비」 + 「엔진 심박 전송」.
2. **`fn_load_rules`(① 활성 규칙 조회)** 노드를 열 필요 없이, 출력선만 추가:
   `fn_load_rules` 의 출력을 **「엔진 심박 준비」** 에도 연결
   (기존 `fn_evaluate_rules` 연결은 그대로 두고, 같은 출력점에서 선을 하나 더 끈다).
3. Deploy.

## 검증
- 1분 대기 후 서버 `SELECT * FROM automation_heartbeat;` 에 last_run_at 갱신.
- 지표: `curl localhost:9090/api/v1/query?query=smartfarm_automation_engine_last_run_timestamp`
- 규칙: `time()-metric` 이 60초 이내로 유지되면 정상(임계 180).

## 주의
- 매 분 1회 POST — 농장당 분당 1행 upsert, 부담 미미.
- 적용 후 `master-flows-sync.py` 로 마스터 flows 동기화.
