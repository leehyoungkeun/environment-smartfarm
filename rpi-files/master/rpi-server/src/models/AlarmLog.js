/**
 * 알람 로그 모델 (SQLite)
 * alarm_log 테이블에 알람 발생 및 해제 이력을 관리한다.
 */
module.exports = (db) => {
  return {
    /**
     * 알람 로그 1건 삽입
     * @param {Object} data - 알람 데이터 {alarm_type, alarm_value, threshold_value, message}
     * @returns {Object} 실행 결과 (lastInsertRowid 포함)
     */
    insert: (data) => {
      const stmt = db.prepare(`
        INSERT INTO alarm_log (alarm_type, alarm_value, threshold_value, message)
        VALUES (@alarm_type, @alarm_value, @threshold_value, @message)
      `);
      return stmt.run({
        alarm_value: null,
        threshold_value: null,
        message: null,
        ...data,
      });
    },

    /**
     * 최근 알람 로그 조회
     * @param {number} [limit=50] - 최대 조회 건수
     * @returns {Array} 최근 알람 로그 목록
     */
    getRecent: (limit = 50) =>
      db.prepare(
        'SELECT * FROM alarm_log ORDER BY occurred_at DESC LIMIT ?'
      ).all(limit),

    /**
     * 미해제(활성) 알람 목록 조회
     * @returns {Array} resolved_at이 NULL인 알람 목록
     */
    getActive: () =>
      db.prepare(
        'SELECT * FROM alarm_log WHERE resolved_at IS NULL ORDER BY occurred_at DESC'
      ).all(),

    /**
     * 알람 해제 처리 (resolved_at을 현재 시각으로 설정)
     * @param {number} id - 알람 로그 ID
     * @returns {Object} 실행 결과 (changes 포함)
     */
    resolve: (id) =>
      db.prepare(
        `UPDATE alarm_log SET resolved_at = datetime('now', 'localtime') WHERE id = ?`
      ).run(id),

    /**
     * 오래된 알람 로그 삭제
     * @param {number} days - 보관 일수 (이보다 오래된 데이터 삭제)
     * @returns {number} 삭제된 행 수
     */
    deleteOlderThan: (days) => {
      const result = db.prepare(
        `DELETE FROM alarm_log WHERE occurred_at < datetime('now', 'localtime', ?)`
      ).run(`-${days} days`);
      return result.changes;
    },
  };
};
