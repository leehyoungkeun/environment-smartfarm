/**
 * 시스템 설정 모델 (SQLite)
 * system_config 테이블의 단일 행을 조회하고 갱신한다.
 */
module.exports = (db) => {
  return {
    /**
     * 시스템 설정 조회
     * @returns {Object} 시스템 설정 객체
     */
    get: () => db.prepare('SELECT * FROM system_config WHERE id = 1').get(),

    /**
     * 시스템 설정 갱신
     * @param {Object} fields - 갱신할 필드와 값의 객체
     * @returns {Object} 실행 결과 (changes 포함)
     */
    update: (fields) => {
      const keys = Object.keys(fields);
      const sets = keys.map(k => `${k} = @${k}`).join(', ');
      const stmt = db.prepare(
        `UPDATE system_config SET ${sets}, updated_at = datetime('now', 'localtime') WHERE id = 1`
      );
      return stmt.run(fields);
    },
  };
};
