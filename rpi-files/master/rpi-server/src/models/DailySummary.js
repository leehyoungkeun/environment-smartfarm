/**
 * 일일 요약 모델 (SQLite)
 * daily_summary 테이블에 일별 관수 실행 요약 데이터를 관리한다.
 */
module.exports = (db) => {
  return {
    /**
     * 특정 날짜의 일일 요약 전체 조회
     * @param {string} date - 조회 날짜 (YYYY-MM-DD 형식)
     * @returns {Array} 해당 날짜의 프로그램별 요약 목록
     */
    getByDate: (date) =>
      db.prepare(
        'SELECT * FROM daily_summary WHERE summary_date = ? ORDER BY program_number'
      ).all(date),

    /**
     * 일일 요약 데이터 삽입 또는 갱신 (UPSERT)
     * @param {Object} data - 요약 데이터 {summary_date, program_number, run_count, set_ec, set_ph, avg_ec, avg_ph, total_supply_liters, total_drain_liters}
     * @returns {Object} 실행 결과
     */
    upsert: (data) => {
      const stmt = db.prepare(`
        INSERT INTO daily_summary (summary_date, program_number, run_count, set_ec, set_ph, avg_ec, avg_ph, total_supply_liters, total_drain_liters)
        VALUES (@summary_date, @program_number, @run_count, @set_ec, @set_ph, @avg_ec, @avg_ph, @total_supply_liters, @total_drain_liters)
        ON CONFLICT(summary_date, program_number) DO UPDATE SET
          run_count = @run_count,
          set_ec = @set_ec,
          set_ph = @set_ph,
          avg_ec = @avg_ec,
          avg_ph = @avg_ph,
          total_supply_liters = @total_supply_liters,
          total_drain_liters = @total_drain_liters
      `);
      return stmt.run(data);
    },
  };
};
