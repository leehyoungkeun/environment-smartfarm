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

## 안전 설계

- **운영 DB 에 닿을 수 없다.** `test/setup.js` 가 `DATABASE_URL` 을 검사해, 테스트 전용
  주소(`127.0.0.1:5433`)가 아니면 모듈 로더 훅으로 `src/db.js` 를 `test/db-stub.js` 로 바꾼다.
  운영 코드는 수정하지 않는다.
- **서버가 뜨지 않는다.** 지표 검사는 `app.js` 를 import 하지 않고 소스를 텍스트로 읽어
  SQL 을 정적 검사한다. (`app.js` 는 로드 시 `startServer()` 가 실행되므로)
- **비밀이 필요 없다.** `JWT_SECRET` 등은 setup 에서 더미를 넣는다. 운영 값과 무관하다.

## 테스트가 진짜 작동하는지 확인하는 법

통과만으로는 부족하다. 규칙을 일부러 깨뜨려 **실패하는지** 봐야 한다:

```bash
# 예: 테넌트 격리를 깨뜨린다
#   auth.middleware.js 의 `if (req.user && req.user.farmId === paramFarmId)` 를
#   `if (req.user)` 로 바꾸면 → 2개 실패해야 정상
npm test
git checkout -- src/middleware/auth.middleware.js
```

2026-08-29 에 이 방식으로 세 테스트 모두 검증했다(격리 2개 실패, 지표 1개 실패).

## 아직 없는 것

- **통합 테스트** — 라우트를 실제로 호출하려면 `app.js` 의 `startServer()` 를 조건부로
  바꿔야 한다(`if (process.env.NODE_ENV !== "test")`). 운영 코드 수정이라 별도 판단이 필요하다.
- **DB 가 필요한 테스트** — 설정 저장의 깊은 병합, 제어 이력 복합키 등. 테스트 전용
  Postgres(`127.0.0.1:5433`) 컨테이너를 띄우고 `setup.js` 의 화이트리스트를 쓰면 된다.
- **CI 게이트** — `.github/workflows/deploy-backend.yml` 의 deploy job 앞에 test job 을 넣고
  `needs: test` 로 묶으면 테스트 실패 시 배포가 막힌다. 테스트가 안정된 뒤에 건다.
- **프론트엔드** — 4,700줄짜리 컴포넌트가 있는 상태에선 분리가 먼저다.
