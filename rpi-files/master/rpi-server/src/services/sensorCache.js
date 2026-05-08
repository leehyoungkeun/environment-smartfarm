/**
 * 센서 데이터 메모리 캐시
 * 최신 센서 값을 메모리에 보관하여 빠르게 조회
 * DB 조회 없이 실시간 데이터 접근 가능
 */

// 센서 데이터 기본값
let latestData = {
  ec: 0,
  ph: 0,
  outdoor_temp: 0,
  indoor_temp: 0,
  substrate_temp: 0,
  solar_radiation: 0,
  supply_flow: 0,
  drain_flow: 0,
  co2_level: 0,
  updated_at: null,
};

/**
 * 센서 데이터 갱신
 * 전달된 필드만 업데이트하고 나머지는 기존 값 유지
 * @param {object} data - 센서 측정값 (부분 업데이트 가능)
 */
function update(data) {
  try {
    latestData = {
      ...latestData,
      ...data,
      updated_at: new Date().toISOString(),
    };
  } catch (error) {
    console.error('센서 캐시 갱신 오류:', error);
  }
}

/**
 * 최신 센서 데이터 조회
 * 복사본을 반환하여 외부에서 원본을 변경할 수 없도록 보호
 * @returns {object} 최신 센서 데이터 복사본
 */
function getLatest() {
  try {
    return { ...latestData };
  } catch (error) {
    console.error('센서 캐시 조회 오류:', error);
    return { ...latestData };
  }
}

/**
 * 캐시 초기화
 * 모든 센서 값을 기본값(0)으로 재설정
 */
function reset() {
  try {
    latestData = {
      ec: 0,
      ph: 0,
      outdoor_temp: 0,
      indoor_temp: 0,
      substrate_temp: 0,
      solar_radiation: 0,
      supply_flow: 0,
      drain_flow: 0,
      co2_level: 0,
      updated_at: null,
    };
  } catch (error) {
    console.error('센서 캐시 초기화 오류:', error);
  }
}

module.exports = { update, getLatest, reset };
