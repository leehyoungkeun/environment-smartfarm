/**
 * 관수 프로그램 모델 (SQLite)
 * irrigation_program 테이블을 조회하고 갱신한다.
 */
module.exports = (db) => {
  return {
    /**
     * 모든 관수 프로그램 조회
     * @returns {Array} 전체 프로그램 목록
     */
    getAll: () => db.prepare('SELECT * FROM irrigation_program ORDER BY program_number').all(),

    /**
     * 프로그램 번호로 단일 프로그램 조회
     * @param {number} num - 프로그램 번호 (1~6)
     * @returns {Object|undefined} 프로그램 객체 또는 undefined
     */
    getByNumber: (num) =>
      db.prepare('SELECT * FROM irrigation_program WHERE program_number = ?').get(num),

    /**
     * 프로그램 번호에 해당하는 프로그램 갱신
     * @param {number} num - 프로그램 번호 (1~6)
     * @param {Object} fields - 갱신할 필드와 값의 객체
     * @returns {Object} 실행 결과 (changes 포함)
     */
    update: (num, fields) => {
      const keys = Object.keys(fields);
      const sets = keys.map(k => `${k} = @${k}`).join(', ');
      const stmt = db.prepare(
        `UPDATE irrigation_program SET ${sets}, updated_at = datetime('now', 'localtime') WHERE program_number = @_program_number`
      );
      return stmt.run({ ...fields, _program_number: num });
    },
  };
};
