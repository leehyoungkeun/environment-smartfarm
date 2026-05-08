/**
 * 공유 상수 정의
 * cloud-server와 rpi-server에서 공통으로 사용
 */
module.exports = {
  // 하드웨어 설정
  VALVE_COUNT: 14,
  PROGRAM_COUNT: 6,
  TANK_COUNT: 7, // A~F + acid

  // 사용자 역할
  ROLES: {
    SUPERADMIN: 'superadmin',  // 시스템 전체 관리자
    ADMIN: 'admin',            // 조직 관리자
    OPERATOR: 'operator',      // 운영자 (제어 가능)
    VIEWER: 'viewer',          // 뷰어 (조회만)
  },

  // 농장 접근 권한
  PERMISSIONS: {
    CONTROL: 'control',  // 제어 가능
    VIEW: 'view',        // 조회만
  },

  // 경보 유형
  ALARM_TYPES: {
    EC_HIGH: 'EC_HIGH',
    EC_LOW: 'EC_LOW',
    PH_HIGH: 'PH_HIGH',
    PH_LOW: 'PH_LOW',
    TEMP_HIGH: 'TEMP_HIGH',
    TEMP_LOW: 'TEMP_LOW',
    FLOW_ERROR: 'FLOW_ERROR',
    EMERGENCY_STOP: 'EMERGENCY_STOP',
    OFFLINE: 'OFFLINE',
  },

  // 경보 유형 라벨 (한국어)
  ALARM_TYPE_LABELS: {
    EC_HIGH: 'EC 상한 초과',
    EC_LOW: 'EC 하한 미달',
    PH_HIGH: 'pH 상한 초과',
    PH_LOW: 'pH 하한 미달',
    TEMP_HIGH: '온도 상한 초과',
    TEMP_LOW: '온도 하한 미달',
    FLOW_ERROR: '유량 이상',
    EMERGENCY_STOP: '긴급 정지',
    OFFLINE: '오프라인',
  },

  // 제어 명령 출처
  COMMAND_SOURCES: {
    TOUCHPANEL: 'touchpanel',
    WEB_REMOTE: 'web_remote',
    AUTO_SCHEDULE: 'auto_schedule',
    AUTO_ALARM: 'auto_alarm',
  },

  // 운전 상태
  OPERATING_STATES: {
    RUNNING: 'RUNNING',
    STOPPED: 'STOPPED',
    EMERGENCY: 'EMERGENCY',
    PAUSED: 'PAUSED',
    IRRIGATING: 'IRRIGATING',
    MANUAL: 'MANUAL',
  },

  // 농장 상태
  FARM_STATUS: {
    ACTIVE: 'active',
    INACTIVE: 'inactive',
    MAINTENANCE: 'maintenance',
  },
};
