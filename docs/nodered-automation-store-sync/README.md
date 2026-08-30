# 자동화 규칙 저장소 이원화 해소 (Node-RED 에디터 작업)

작성 2026-08-30. RPi 1호(farm_0001) 점검 중 발견한 구조 결함을 고친다.

## 무엇이 문제였나

자동화 규칙이 RPi 안에서 **두 곳에 따로** 살고 서로를 몰랐다.

```
[클라우드 → RPi]
  mqtt automation/sync → http request(서버 규칙 조회) → function 3
      global.set('automationRules', …)          ← global 에만 씀
      (SQLite automation_rules 에는 안 씀)

[RPi → 클라우드]
  POST /api/automation/:farmId → INSERT INTO automation_rules → sqlite
      → link out → 'WHERE synced = 0' → 서버 전송 → synced=1
      (global.automationRules 는 안 건드림)

[읽기]
  엔진 ②/④/⑤              → global.automationRules       (클라우드에서 받은 것)
  REST GET /api/automation → SQLite automation_rules      (비어 있었음)
```

실제 확인된 상태: `global` 5개 / SQLite **0개**.

### 그래서 생기는 일

1. **팜로컬에서 자동화 화면이 비어 보인다.** 엔진은 5개를 돌리는데 화면은 0개다.
   농장주가 없는 줄 알고 다시 만들면 중복 규칙이 생긴다.
2. **팜로컬에서 만든 규칙이 즉시 돌지 않는다.** SQLite 에만 들어가고 엔진이 쓰는 global 에는
   반영되지 않아, 다음 클라우드 동기화 때까지 죽어 있다.
   **인터넷이 끊긴 동안 만든 규칙은 인터넷이 복구돼야 동작한다** — 팜로컬 모드의 취지와 정면으로 어긋난다.

## 고치는 방향

`global.automationRules` 를 **단일 진실**로 두고 SQLite 를 그 사본으로 맞춘다.
엔진이 이미 global 을 쓰고 있고, 원본은 클라우드이기 때문이다.

- **A. 클라우드 → RPi**: `function 3` 이 global 에 넣을 때 SQLite 도 통째로 덮어쓴다 → 화면이 엔진과 같은 것을 본다.
- **B. RPi → 클라우드**: 로컬 CRUD 로 SQLite 가 바뀌면 곧바로 다시 읽어 global 을 갱신하고 ④ 스케줄러를 다시 돌린다 → 오프라인에서 만든 규칙이 즉시 동작한다.

## 적용 절차

> ⚠ `flows.json` 을 scp 로 덮지 말 것. 반드시 에디터에서 한다.
> 가져오기는 **현재 열려 있는 탭**에 노드를 넣는다(JSON 의 `z` 는 무시된다).

### 1) 노드 가져오기 — 「자동화 평가」 탭을 연 상태에서

`automation-store-sync-nodes.json` 을 메뉴 → 가져오기로 붙여넣는다. 5개 노드가 들어온다.

| 노드 | 역할 |
|---|---|
| `규칙 캐시 미러 (클라우드→SQLite)` | A 의 기록 대상 |
| `← 로컬 규칙 변경` (link in) | B 의 진입점 |
| `로컬 규칙 재조회 준비` | SELECT 문 구성 |
| `규칙 재조회` (sqlite) | 다시 읽기 |
| `로컬 규칙 → 캐시 갱신` | global 갱신 후 ④ 로 전달 |

가져온 뒤 `로컬 규칙 → 캐시 갱신` 의 출력이 **`④ 시간 스케줄러`(`fn_scheduler`)** 에 연결됐는지 확인한다.
가져오기가 기존 노드와의 연결을 끊었으면 직접 이어 준다.

### 2) A — `function 3` 교체

「자동화 평가」 탭의 **`function 3`** 을 열고

1. 코드를 `fn_function3_v3.js` 내용으로 교체
2. **출력 개수를 1 → 2** 로 변경
3. 출력 1 → `④ 시간 스케줄러` (기존 연결 유지)
4. **출력 2 → `규칙 캐시 미러`** 에 연결

### 3) B — 로컬 변경 알림 연결

「REST API (오프라인)」 탭의 **`규칙 변경 → 동기화`**(link out, id `link_out_rule_changed`) 를 열고,
대상 목록에 **`← 로컬 규칙 변경`** 을 **추가로 체크**한다. 기존 대상(`← 규칙 변경 알림`)은 그대로 둔다.

`규칙 저장`(`sqlite_auto_write`)·`규칙 삭제`(`sqlite_auto_delete`) 가 모두 이 link out 으로
이어져 있으므로, 생성·수정·삭제·토글 어느 쪽이든 한 경로로 처리된다.
두 sqlite 노드의 출력이 link out 에 연결돼 있는지 확인한다.

### 4) 배포

Deploy 후 다음을 확인한다.

```bash
# 화면과 엔진이 같은 수를 보는가
curl -s http://localhost/api/automation/farm_0001 | python3 -c 'import sys,json;print(len(json.load(sys.stdin).get("data",[])),"개 (REST/SQLite)")'
ssh lhk@192.168.0.38 "python3 -c \"import json;g=json.load(open('/home/lhk/.node-red/context/global/global.json'));print(len(g.get('automationRules') or []),'개 (global/엔진)')\""
```

두 숫자가 같아야 한다. 적용 전에는 `0개` vs `5개` 였다.

### 5) 팜로컬 동작 확인

인터넷을 끊은 상태(또는 팜로컬 모드)에서 규칙을 하나 만들고,
NR 로그에 `📋 로컬 규칙 변경 반영: N개` 가 찍히는지 본다.
찍히면 그 규칙은 즉시 엔진에 올라간 것이다.

## 주의

- A 의 INSERT 는 **`synced = 1`** 로 넣는다. 클라우드에서 내려온 규칙이라 되돌려 보낼 필요가 없다.
  이 표시를 빠뜨리면 「미동기화 규칙 조회」가 같은 규칙을 서버로 되쏘아 에코가 생긴다.
- A 는 규칙이 0개일 때도 `DELETE` 를 보낸다. 서버에서 전부 지웠는데 로컬에만 남아
  화면에 유령 규칙이 보이는 상황을 막기 위해서다.
- 적용 후 `rpi-files/master/flows.json` 동기화가 필요하다
  (`rpi-files/scripts/master-flows-sync.py`). 안 하면 표준 이미지에 이 수정이 빠진다.
