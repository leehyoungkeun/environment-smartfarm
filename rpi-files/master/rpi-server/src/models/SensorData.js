/**
 * 센서 데이터 모델 (SQLite)
 * sensor_data 테이블에 시계열 센서 데이터를 삽입하고 조회한다.
 */
module.exports = (db) => {
  return {
    /**
     * 센서 데이터 1건 삽입
     * @param {Object} data - 센서 데이터 객체 {ec, ph, outdoor_temp, indoor_temp, substrate_temp, solar_radiation, supply_flow, drain_flow, co2_level}
     * @returns {Object} 실행 결과 (lastInsertRowid 포함)
     */
    insert: (data) => {
      const keys = Object.keys(data);
      const columns = keys.join(', ');
      const placeholders = keys.map(k => `@${k}`).join(', ');
      const stmt = db.prepare(
        `INSERT INTO sensor_data (${columns}) VALUES (${placeholders})`
      );
      return stmt.run(data);
    },

    /**
     * 기간별 센서 데이터 조회
     * @param {string} from - 조회 시작 시각 (datetime 문자열)
     * @param {string} to - 조회 종료 시각 (datetime 문자열)
     * @param {number} [limit=1000] - 최대 조회 건수
     * @returns {Array} 센서 데이터 목록
     */
    getRange: (from, to, limit = 1000) =>
      db.prepare(
        'SELECT * FROM sensor_data WHERE recorded_at BETWEEN ? AND ? ORDER BY recorded_at DESC LIMIT ?'
      ).all(from, to, limit),

    /**
     * 최근 센서 데이터 조회
     * @param {number} [count=1] - 조회할 건수
     * @returns {Array} 최근 센서 데이터 목록
     */
    getLatest: (count = 1) =>
      db.prepare(
        'SELECT * FROM sensor_data ORDER BY recorded_at DESC LIMIT ?'
      ).all(count),

    /**
     * 오래된 센서 데이터 삭제
     * @param {number} days - 보관 일수 (이보다 오래된 데이터 삭제)
     * @returns {number} 삭제된 행 수
     */
    deleteOlderThan: (days) => {
      const result = db.prepare(
        `DELETE FROM sensor_data WHERE recorded_at < datetime('now', 'localtime', ?)`
      ).run(`-${days} days`);
      return result.changes;
    },
  };
};
