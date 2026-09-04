# NR 핸드오프 — 클라우드 설정을 SQLite 에도 미러 (키오스크 REST stale 해소)

**결함 (2026-09-04 발견)**: 클라우드 `config/update` → 「houseConfig 갱신」은 **전역만** 갱신, SQLite `house_configs` 는 안 씀.
그런데 `GET /api/config/farm/:farmId`(키오스크가 읽음)는 **SQLite 만** 읽고, 부팅 시 전역이 비면 SQLite 로 복원 →
키오스크엔 v58 옛 목록(표준 장치 `ks_test_sw1`·하우스2 `heater1`/`temp_0001` 없음), 컨텍스트 초기화 후엔 옛 설정 부활.

**해법**: 「houseConfig 갱신」에 **출력 2** 를 추가해 하우스별 UPSERT(클라우드 configVersion 그대로) + 클라우드에 없는 하우스 DELETE 를
새 sqlite 노드로 보낸다. 전역은 지금처럼 즉시 set(동작 변화 없음). 빈 응답·비200 이면 미러도 하지 않음(SQLite 전멸 방지).

## 적용 (에디터 http://192.168.0.38:1880/node-red/) — 탭 「모듈 동기화」
1. **탭 「모듈 동기화」를 먼저 열어 둔다** (가져오기는 현재 열린 탭에 들어간다 — 트랩)
2. 메뉴 ≡ → 가져오기 → `import-nodes.json` 내용 붙여넣기 → 가져오기. 「SQLite 미러 (house_configs)」 노드가 생김
   (DB 설정은 기존 `smartfarm.db` 를 그대로 참조). 「houseConfig 갱신」 아래쪽으로 옮겨 두면 보기 좋음
3. 「houseConfig 갱신」(id `hcs_handler`) 더블클릭 → **Outputs 를 1 → 2** 로 → 코드 **전체 교체**(`hcs_handler.js`) → Done
4. 「houseConfig 갱신」의 **2번(아래) 출력 포트 → 「SQLite 미러 (house_configs)」** 로 선 하나 연결
5. **Deploy**

## 확인
1. 클라우드 UI 에서 아무 하우스 설정을 한 번 저장(또는 Claude 가 config_update 유발) → NR 로그에
   `🏠 houseConfig refresh (house_changed): 4 houses … — SQLite 미러 5건`
2. RPi REST(농장 키)로 `GET http://127.0.0.1:1880/api/config/farm/farm_0001` → `configVersion` 이 클라우드와 같고
   house_0001 에 `ks_test_sw1`, house_0002 에 `heater1`/`temp_0001` 보임 (Claude 가 확인)
3. 키오스크(팜로컬) 설정 화면에 표준 장치가 보임

## 검증 코드
- `backend/test/nr/config-mirror.test.js` — 교체본을 하네스로 실행: UPSERT 파라미터·버전 미러·DELETE 바인딩·빈응답/비200 무동작(변이 프로브)
- 적용·마스터 동기화 후 `docs/nodered-config-mirror/hcs_handler.js` 를 잠금(same) 대상에 추가
