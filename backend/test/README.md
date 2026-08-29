# 백엔드 테스트

```bash
cd backend
npm test          # 전체 (단위, DB 불필요, 약 3초)
npm run test:watch
```

## 무엇을 지키는가

전체 커버리지가 목표가 아니다. **실제로 일어난 사고를 다시 일으키지 않는 것**만 담았다.
새 테스트를 넣을 때도 "이 규칙이 깨지면 고객이 다치는가" 를 기준으로 고른다.

| 파일 | 지키는 것 | 실제 사고 |
|---|---|---|
| `unit/tenant-isolation.test.js` | 한 농가 사용자가 다른 농장 자원에 못 닿는다 | 2026-08-29 `relay-status`·`device-positions` 가 인증 없이 마운트돼 인터넷에서 남의 농장 릴레이 상태가 200 으로 열렸다 |
| `unit/alert-format.test.js` | Discord 알림에 오류 이름·위치·서비스·농장·링크가 담긴다 | 2026-08-26~29 변환기가 페이로드 형식을 추측해 항상 "GlitchTip alert / error / 1" 폴백만 보냈다. 도달은 되니 아무도 몰랐다 |
| `unit/metric-queries.test.js` | 지표 SQL 이 실패해 **지표가 통째로 사라지는** 일이 없다 | 2026-08-29 `JOIN farms` 를 넣으며 `SELECT farm_id` 를 한정하지 않아 ambiguous → catch 의 reset() 이 전 농장 지표를 지웠고, 15분간 `SensorDataStalled` 가 어느 농장에도 울릴 수 없었다 |
| `unit/security-invariants.test.js` | 라우트 추가 시 인증·테넌트 격리를 잊지 않는다. `/metrics` 내부 전용, setup 비밀은 1회만, 시뮬레이션으로 경보 안 함, 설정 저장이 남의 키를 안 지움 | 2026-08-29 2차 점검의 N2·N3, B3·B4, 전광판 저장이 릴레이 모듈을 지운 사고 |

## 안전 설계

- **운영 DB 에 닿을 수 없다.** `test/setup.js` 가 `DATABASE_URL` 을 검사해, 테스트 전용
  주소(`127.0.0.1:5433`)가 아니면 모듈 로더 훅으로 `src/db.js` 를 `test/db-stub.js` 로 바꾼다.
  운영 코드는 수정하지 않는다.
- **서버가 뜨지 않는다.** 지표 검사는 `app.js` 를 import 하지 않고 소스를 텍스트로 읽어
  SQL 을 정적 검사한다. (`app.js` 는 로드 시 `startServer()` 가 실행되므로)
- **비밀이 필요 없다.** `JWT_SECRET` 등은 setup 에서 더미를 넣는다. 운영 값과 무관하다.

## 테스트가 진짜 작동하는지 확인하는 법 — 변이 검사

통과만으로는 부족하다. 규칙을 일부러 깨뜨려 **실패하는지** 봐야 한다. 자동화해 두었다:

```bash
cd backend && bash test/mutation-check.sh
```

오늘 실제로 났던 결함 7가지를 하나씩 되살려 테스트가 잡는지 확인하고 원복한다.
2026-08-29 결과 — **7/7 검출**:

```
✅ N3 relay-status 인증 제거            → 2개 실패
✅ N3 테넌트 격리만 제거                 → 1개 실패
✅ B3 /metrics 터널 판정 제거            → 1개 실패
✅ 지표 SQL 컬럼 미한정 (15분 감시 정지)  → 1개 실패
✅ N2 setup 키를 항상 반환               → 1개 실패
✅ B4 시뮬레이션 경보 스킵 제거           → 1개 실패
✅ 설정 저장 얕은 병합 회귀               → 1개 실패
```

새 테스트를 넣으면 이 스크립트에도 해당 변이를 추가한다. 잡지 못하는 변이가 나오면
그 테스트는 아무것도 지키지 못하는 것이다. 코드가 바뀌어 앵커를 못 찾으면 `⚠` 로 알려준다.

## 아직 없는 것

- **통합 테스트** — 라우트를 실제로 호출하려면 `app.js` 의 `startServer()` 를 조건부로
  바꿔야 한다(`if (process.env.NODE_ENV !== "test")`). 운영 코드 수정이라 별도 판단이 필요하다.
- **DB 가 필요한 테스트** — 설정 저장의 깊은 병합, 제어 이력 복합키 등. 테스트 전용
  Postgres(`127.0.0.1:5433`) 컨테이너를 띄우고 `setup.js` 의 화이트리스트를 쓰면 된다.
- **CI 게이트** — `.github/workflows/deploy-backend.yml` 의 deploy job 앞에 test job 을 넣고
  `needs: test` 로 묶으면 테스트 실패 시 배포가 막힌다. 테스트가 안정된 뒤에 건다.
- **프론트엔드** — 4,700줄짜리 컴포넌트가 있는 상태에선 분리가 먼저다.

---

## DB 테스트 (2026-08-29 추가)

`test/db/` 는 **테스트 전용 Postgres** 가 있을 때만 돈다. 없으면 러너가 건너뛴다 —
배포 게이트는 DB 없이 돌아야 하기 때문이다 (`npm test` = 70개, `npm run test:db` = 113개).

### 왜 필요했나

단위 테스트는 전부 스텁 위에서 돌아 **SQL 이 실제로 실행되는지**를 보지 못했다.
2026-08-29 오전의 15분 감시 정지가 정확히 그 사각지대였다 — `JOIN farms` 를 넣으면서
`SELECT farm_id` 를 한정하지 않아 "column reference farm_id is ambiguous" 가 났고,
`collect()` 의 catch 가 조용히 삼켜서 **지표가 그냥 사라졌다**. 문자열 검사는 통과했다.

### 띄우는 법

```bash
# 서버(192.168.0.24)에서 — 운영 DB(5432)와 완전히 분리된 별개 컨테이너, tmpfs, 127.0.0.1 전용
bash server/postgres17/test-db.sh up      # 컨테이너 + prisma db push + 수동 마이그레이션
bash server/postgres17/test-db.sh status
bash server/postgres17/test-db.sh down

# 개발 PC 에서 — SSH 터널을 열고
ssh -N -L 5433:127.0.0.1:5433 afocus@192.168.0.24 &
cd backend && npm run test:db
```

`setup.js` 는 `DATABASE_URL` 이 `127.0.0.1:5433` 일 때만 스텁을 끄고, 그때 `DB_*` 도
같은 곳을 보게 맞춘다(raw SQL 풀이 별도 환경변수를 쓰기 때문). `REMOTE_DB_ENABLED` 도 끈다.

### 무엇을 지키는가

| 파일 | 지키는 것 | 근거가 된 사고 |
|---|---|---|
| `db/metric-queries.test.js` | app.js 의 지표 SQL 을 뽑아 **실제로 실행**. 시뮬레이션·점검중 농장 제외를 sensor_data 를 읽는 모든 지표에 대해 일괄 확인 | 8/29 15분 감시 정지, farm_0006 시뮬레이션 값 |
| `db/settings-merge.test.js` | 실제 `PUT /api/config/system-settings/:farmId` 호출 — 전광판 저장이 릴레이·센서 모듈을 지우지 않는가 | 릴레이 모듈이 '어느 날 사라진' 사고 |
| `db/control-log-backfill.test.js` | 소급 전송의 중복 판정 SQL 을 소스에서 뽑아 실행 — 소급분끼리 서로를 지우지 않는가 | 8/26 1,474건 유실 |
| `db/schema-complete.test.js` | 수동 마이그레이션이 빈 DB 에서 실제로 도는가, PK 에 house_id 가 있는가 | device_positions DDL 부재 |
| `unit/schema-source.test.js` | (DB 불필요) 코드가 쓰는 테이블이 **리포에 선언돼 있는가** | 운영 DB 만 손으로 고친 흔적 |

### 미해결로 기록된 것

`daily_summaries` — `POST /internal/daily-summary` 가 쓰는 테이블이 리포에도 운영 DB 에도 없다.
호출되면 항상 500 이고, 로그상 호출된 적이 없다(레거시 NR f7). 표를 만들지 엔드포인트를 지울지
결정이 필요하다. `unit/schema-source.test.js` 의 `KNOWN_MISSING` 에 이유와 함께 남겨 두었다.
