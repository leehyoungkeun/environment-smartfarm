/**
 * Config CRUD API - Node-RED 함수 노드 참조 문서
 *
 * 팜로컬 모드에서 하우스 설정 CRUD를 SQLite로 처리
 * Express 백엔드와 동일한 API 계약 유지
 *
 * 플로우 파일: flows/smartfarm-config-crud.json
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * SQLite 테이블 스키마
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * CREATE TABLE house_configs (
 *   id TEXT PRIMARY KEY,
 *   farm_id TEXT NOT NULL,
 *   house_id TEXT NOT NULL,
 *   house_name TEXT DEFAULT '',
 *   sensors TEXT DEFAULT '[]',        -- JSON: [{sensorId, name, unit, type, min, max, enabled, order, icon, color, precision}]
 *   collection TEXT DEFAULT '{}',     -- JSON: {intervalSeconds, method, retryAttempts}
 *   devices TEXT DEFAULT '[]',        -- JSON: [{deviceId, name, type, icon, enabled, order}]
 *   crops TEXT DEFAULT '[]',          -- JSON array
 *   crop_type TEXT DEFAULT '',
 *   crop_variety TEXT DEFAULT '',
 *   planting_date TEXT DEFAULT '',
 *   device_count INTEGER DEFAULT 0,
 *   enabled INTEGER DEFAULT 1,
 *   config_version INTEGER DEFAULT 1,
 *   created_at TEXT NOT NULL,
 *   updated_at TEXT NOT NULL,
 *   UNIQUE(farm_id, house_id)
 * );
 *
 * CREATE TABLE system_settings (
 *   id INTEGER PRIMARY KEY,
 *   farm_id TEXT NOT NULL UNIQUE,
 *   settings_json TEXT DEFAULT '{}',  -- JSON: {retentionDays: 60}
 *   updated_at TEXT NOT NULL
 * );
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * API 엔드포인트 (라우트 등록 순서 중요!)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 1. GET  /api/config/farm/:farmId              → 전체 하우스 목록
 * 2. GET  /api/config/system-settings/:farmId   → 시스템 설정 조회
 * 3. PUT  /api/config/system-settings/:farmId   → 시스템 설정 저장
 * 4. POST /api/config                           → 하우스 생성 (409 중복)
 * 5. PUT  /api/config/:houseId?farmId=xxx       → 하우스 수정 (upsert)
 * 6. DELETE /api/config/:houseId?farmId=xxx     → 하우스 삭제 (404 없음)
 * 7. GET  /api/config/:houseId                  → 단일 하우스 / 팜 설정 조회
 *
 * ※ 1~3번은 구체적 경로이므로 7번(:houseId 와일드카드)보다 먼저 등록해야 함
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 응답 포맷 (Express 백엔드와 동일)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 성공: { success: true, data: {...} }
 * 실패: { success: false, error: "메시지" }
 * 모든 응답에 CORS 헤더: Access-Control-Allow-Origin: *
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 글로벌 컨텍스트 동기화
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 하우스 CRUD 후 자동으로 global.set('houseConfig', config) 갱신
 * link out → link_in_config_sync → SQLite 전체 조회 → global 저장
 * 센서 수집, 자동화 엔진이 최신 설정을 즉시 사용 가능
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 시작 시 시딩 (startup-init)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * 1. house_configs 테이블 확인
 * 2. 데이터 있으면 → global.houseConfig에 로드
 * 3. 비어있으면 → config_cache에서 시딩 (INSERT OR IGNORE)
 * 4. config_cache도 비어있으면 → 설정 페이지에서 수동 추가 필요
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 함수 1: 하우스 목록 (GET /api/config/farm/:farmId)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// [쿼리]
// msg.topic = 'SELECT * FROM house_configs WHERE farm_id = $1 ORDER BY created_at ASC';
// msg.payload = [farmId];

// [응답 포맷]
// rows → map → { _id, farmId, houseId, houseName, sensors(parsed), collection(parsed),
//                 devices(parsed), crops(parsed), cropType, cropVariety, plantingDate,
//                 deviceCount, enabled(bool), configVersion, createdAt, updatedAt }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 함수 2: 시스템 설정 조회 (GET /api/config/system-settings/:farmId)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 기본값: { retentionDays: 60 }
// SQLite에 저장된 값이 있으면 병합

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 함수 3: 시스템 설정 저장 (PUT /api/config/system-settings/:farmId)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 검증: retentionDays 7~365 범위
// UPSERT: INSERT ... ON CONFLICT(farm_id) DO UPDATE SET ... = excluded.xxx
// ⚠️ node-red-node-sqlite는 $기호 총 출현 횟수로 파라미터 개수를 판단하므로
//    ON CONFLICT 절에서 $N을 재참조하면 안됨 → excluded.column_name 사용 필수
// 저장 후 global.set('retentionDays', days) 갱신

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 함수 4: 하우스 생성 (POST /api/config)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 2단계: 중복 확인 → INSERT
// 중복 시 409 반환
// 기본 collection: { intervalSeconds: 60, method: 'http', retryAttempts: 3 }
// 생성 후 global.houseConfig 동기화

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 함수 5: 하우스 수정 (PUT /api/config/:houseId?farmId=xxx)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// UPSERT: INSERT ... ON CONFLICT(farm_id, house_id) DO UPDATE SET ... = excluded.xxx
// ⚠️ ON CONFLICT 절에서 excluded.column_name 사용 (sqlite 노드 $카운트 제약)
// config_version 자동 증가 (house_configs.config_version + 1)
// 수정 후 SELECT로 최신 데이터 읽어서 응답
// global.houseConfig 동기화

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 함수 6: 하우스 삭제 (DELETE /api/config/:houseId?farmId=xxx)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 2단계: SELECT 존재 확인 → 응답 즉시 전송 + DELETE fire-and-forget
// ⚠️ sqlite 노드가 db.all() 사용하므로 DELETE 후 changes 카운트 불가
//    → SELECT 선 확인 패턴으로 404 감지
// 삭제 후 global.houseConfig 동기화 (link out)

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 함수 7: 단일 하우스 조회 (GET /api/config/:houseId)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// farmId 쿼리 파라미터 유무로 분기:
// - farmId 있으면: 단일 하우스 조회 (WHERE farm_id = $1 AND house_id = $2)
// - farmId 없으면: 팜 전체 설정 (id를 farmId로 취급, houses 배열 반환)
// SQLite에 없으면 global.get('houseConfig') 캐시 폴백
