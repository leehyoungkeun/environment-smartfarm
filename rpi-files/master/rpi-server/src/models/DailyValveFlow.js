/**
 * 일일 밸브별 유량 모델 (SQLite)
 * daily_valve_flow 테이블에 일별 밸브 유량 데이터를 관리한다.
 */
module.exports = (db) => {
  return {
    /**
     * 특정 날짜의 밸브별 유량 전체 조회
     * @param {string} date - 조회 날짜 (YYYY-MM-DD 형식)
     * @returns {Array} 해당 날짜의 프로그램별·밸브별 유량 목록
     */
    getByDate: (date) =>
      db.prepare(
        'SELECT * FROM daily_valve_flow WHERE summary_date = ? ORDER BY program_number, valve_number'
      ).all(date),

    /**
     * 일일 밸브 유량 데이터 삽입 또는 갱신 (UPSERT)
     * @param {Object} data - 유량 데이터 {summary_date, program_number, valve_number, total_flow_liters, run_count}
     * @returns {Object} 실행 결과
     */
    upsert: (data) => {
      const stmt = db.prepare(`
        INSERT INTO daily_valve_flow (summary_date, program_number, valve_number, total_flow_liters, run_count)
        VALUES (@summary_date, @program_number, @valve_number, @total_flow_liters, @run_count)
        ON CONFLICT(summary_date, program_number, valve_number) DO UPDATE SET
          total_flow_liters = @total_flow_liters,
          run_count = @run_count
      `);
      return stmt.run(data);
    },
  };
};
