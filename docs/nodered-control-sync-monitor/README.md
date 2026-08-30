# 제어이력 동기화 감시 (로컬에만 쌓이면 유실) — 2026-08-30

## 문제
제어이력이 서버로 안 가고 로컬 SQLite 에만 쌓여도 알림이 없다.
전례: 로컬 10,106건이 전부 미전송이던 사고, 소급 중복판정 버그로 **1,474건 유실**.
이미지 재설치·SD 교체 시 로컬만 있던 이력은 사라진다.

## 해결
```
inject(5분) → [기존 동기화 체인, 미동기화 백로그 조회 → 상태 보고 → http]
   → POST /internal/control-sync-status { unsyncedCount, oldestUnsyncedSec }
   → control_sync_status 테이블
   → smartfarm_control_unsynced_oldest_seconds / _sync_last_report_timestamp
   → ControlSyncStalled(백로그 15분↑) · ControlSyncReportMissing(보고 20분↑ 끊김)
```
백로그 **나이**(가장 오래된 미전송의 나이)를 본다 — 건수보다 정확하다(제어가 없으면 건수 0 이 정상).
inject 가 죽으면 보고도 끊겨 ReportMissing 이 잡는다.

## 서버 (배포됨)
- `prisma/migration-sync-status.sql` — **운영 DB 수동 적용**
- `internal.routes.js` POST `/internal/control-sync-status`
- `app.js` gauge 2개
- `monitoring/alert_rules.yml` ControlSyncStalled·ControlSyncReportMissing

## NR 에디터 작업 (「데이터 동기화」 탭)
1. `control-sync-monitor-nodes.json` 가져오기 → 「미동기화 백로그 조회」·「동기화 상태 보고 준비」·「동기화 상태 전송」.
2. **`5분 간격 제어이력 동기화`(cl_inject_periodic)** inject 의 출력을 **「미동기화 백로그 조회」** 에도 연결
   (기존 동기화 체인은 그대로, 같은 inject 에서 브랜치 하나 더).
3. Deploy.

## 검증
- 5분 대기 후 `SELECT * FROM control_sync_status;` 갱신.
- 지금 미동기화 0건이라 oldest=0. 정상 시 규칙 inactive.

## 주의
- 적용 후 `master-flows-sync.py` 로 마스터 flows 동기화.
