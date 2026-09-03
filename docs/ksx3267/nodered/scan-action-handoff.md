# NR 핸드오프 — 자동스캔(`scan`) 액션 허용 (사용자 에디터 적용)

자동스캔 기능의 **드라이버·백엔드·프론트는 배포 완료**. NR 프록시만 `scan` 액션을 허용하면 끝단까지 연결됩니다.
NR 은 사용자가 에디터에서 직접 적용합니다.

## 적용 (한 줄 수정)
1. 에디터 열기: **http://192.168.0.38:1880/node-red/** (admin / admin1234)
2. 탭 **「KS X 3267 표준노드」** → **「데몬 프록시」**(function, id `fn_ks_proxy`) 더블클릭
3. 코드 상단 `ALLOWED` 줄을 찾아 **`scan: 1` 추가**:

   **변경 전**
   ```js
   const ALLOWED = { discover: 1, nodes: 1, status: 1, frames: 1, events: 1, health: 1 };
   ```
   **변경 후**
   ```js
   const ALLOWED = { discover: 1, scan: 1, nodes: 1, status: 1, frames: 1, events: 1, health: 1 };
   ```
   (다른 곳은 건드리지 않음 — `scan: 1` 만 추가)

4. **Deploy**

## 확인
- 설정 › 📐 표준노드 → **자동 스캔**(시작·끝·타임아웃 입력) → 📡 자동 스캔
- 또는 브라우저/터미널에서: `GET https://api.smartgreen.kr/api/config/farm_0001/ks3267/scan?from=1&to=16&timeout=300` (x-api-key)
- 응답에 `result.found` 에 노드 목록이 오면 성공. (드라이버·백엔드는 이미 동작 — `scan` 미허용 시 NR 이 "허용되지 않는 액션: scan" 반환하던 것이 사라짐)

## 적용 후 (Claude 가 할 것)
- 라이브 flows 를 pull 해 **마스터 flows 동기화**(재이미징 생존). 적용 완료되면 알려주세요.

## 참고 — 왜 NR 수정이 필요했나
NR 「데몬 프록시」가 `ALLOWED` 화이트리스트로 액션을 막습니다(보안). 백엔드도 같은 화이트리스트(`KS3267_READ_ACTIONS`)에 `scan` 을 이미 추가했고, 드라이버엔 `/scan` 엔드포인트가 배포됐습니다. NR 한 줄만 열어주면 됩니다.
