# RPi 로컬 정리 보고·감시 (조용한 멈춤 감지) — 2026-08-30

## 문제
매일 03:00 NR 이 로컬 SQLite 의 60일 초과 데이터를 지운다(`DELETE … WHERE synced>=1 AND timestamp < now-60d`).
이 작업이 멈춰도 아무도 몰랐다 — 결과가 `node.warn` 뿐이라 로그 로테이션에 사라지고, 실패해도 알림이 없었다.
SQLite 가 조용히 무한정 커지다 디스크가 찰 때야 발견된다.

## 해결 (RPi 가 보고 → 서버가 '안 온 것'을 감지)
```
NR 삭제 → 「정리 결과」가 서버에 POST /internal/maintenance-report
         → maintenance_report 테이블(farm_id PK, last_run_at, deleted_rows, ...)
         → Prometheus smartfarm_rpi_cleanup_last_run_timestamp
         → 규칙 RpiCleanupStalled: 26시간(93600s) 무보고 → Discord
```
RPi 가 죽으면 보고도 끊겨 그 자체가 신호다(값이 아니라 '왔는가'로 감지).

## 서버 (배포됨/배포 예정)
- `backend/prisma/migration-maintenance-report.sql` — **운영 DB 수동 적용 필요**
- `internal.routes.js` POST `/internal/maintenance-report` (authenticateApiKey → req.farmId, 농장 격리)
- `app.js` gauge 2개: `smartfarm_rpi_cleanup_last_run_timestamp`, `smartfarm_rpi_local_rows`
- `monitoring/alert_rules.yml` RpiCleanupStalled — 서버 `/etc/prometheus/alert_rules.yml` 반영 + `promtool check` + reload

## NR 에디터 작업 (「SQLite 초기화」 탭)
1. `cleanup-report-nodes.json` 가져오기 → 「보관 보고 전송」(http request) + 「보고 결과」 노드.
2. **`정리 결과`(cleanup_result) 함수** 를 `fn_cleanup_result.js` 로 교체, **출력 1 → 2**.
   - 출력 1 → 기존 `debug_cleanup` (유지)
   - 출력 2 → `보관 보고 전송`
3. Deploy.

## 검증
- 수동: 「수동 정리」 inject 를 눌러 → 서버 `pm2 logs | grep 유지보수 보고` 에 `deleted= dbRows=` 확인,
  `SELECT * FROM maintenance_report;` 에 last_run_at 갱신.
- 지표: `curl -s localhost:9090/api/v1/query?query=smartfarm_rpi_cleanup_last_run_timestamp`
- 규칙: `promtool check rules /etc/prometheus/alert_rules.yml`

## 함정
- http request 노드 `senderr:false` — 서버 다운 시 오류를 Catch 로 안 보내고 「보고 결과」에서 처리(체인 안 매달림).
- 적용 후 `rpi-files/scripts/master-flows-sync.py` 로 마스터 flows 동기화(표준 이미지 반영).
