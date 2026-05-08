/**
 * MQTT 토픽 정의
 * 모든 농장 통신에 사용되는 토픽 패턴
 *
 * 통신 구조:
 * - RPi ↔ AWS IoT Core ↔ 사무실 서버
 * - 외부 FE는 AWS에 직접 연결하지 않음
 */

/**
 * 농장별 MQTT 토픽 생성
 * @param {string} farmId - 농장 AWS Thing 이름 (예: 'MyFarmPi_01')
 */
const topics = (farmId) => ({
  // RPi → 사무실 서버 (RPi가 발행, 서버가 구독)
  telemetry: `farm/${farmId}/telemetry`,       // 센서 데이터 (3초 간격, 요청 시에만)
  status: `farm/${farmId}/status`,             // 장비 상태
  alarm: `farm/${farmId}/alarm`,               // 경보 발생
  commandAck: `farm/${farmId}/command/ack`,    // 명령 실행 결과
  dailySummary: `farm/${farmId}/daily-summary`, // 일일 집계 동기화

  // 사무실 서버 → RPi (서버가 발행, RPi가 구독)
  command: `farm/${farmId}/command`,           // 원격 제어 명령
  configUpdate: `farm/${farmId}/config/update`, // 설정 변경
  requestStart: `farm/${farmId}/request/start`, // 텔레메트리 발행 시작 요청
  requestStop: `farm/${farmId}/request/stop`,   // 텔레메트리 발행 중지 요청
});

/**
 * 서버가 구독할 와일드카드 토픽 패턴
 * 사무실 서버가 모든 농장의 메시지를 수신
 */
const serverSubscriptions = [
  'farm/+/telemetry',
  'farm/+/status',
  'farm/+/alarm',
  'farm/+/command/ack',
  'farm/+/daily-summary',
];

/**
 * 토픽에서 farmId 추출
 * @param {string} topic - MQTT 토픽 (예: 'farm/MyFarmPi_01/telemetry')
 * @returns {string|null} farmId 또는 null
 */
const extractFarmId = (topic) => {
  const match = topic.match(/^farm\/([^/]+)\//);
  return match ? match[1] : null;
};

module.exports = { topics, serverSubscriptions, extractFarmId };
