/**
 * 밸브 설정 모델 (SQLite)
 * valve_config 테이블을 조회하고 갱신한다.
 */
module.exports = (db) => {
  return {
    /**
     * 특정 프로그램에 속한 모든 밸브 설정 조회
     * @param {number} programId - 프로그램 ID
     * @returns {Array} 밸브 설정 목록
     */
    getByProgram: (programId) =>
      db.prepare('SELECT * FROM valve_config WHERE program_id = ? ORDER BY valve_number').all(programId),

    /**
     * 단일 밸브 설정 갱신
     * @param {number} programId - 프로그램 ID
     * @param {number} valveNumber - 밸브 번호 (1~14)
     * @param {Object} fields - 갱신할 필드와 값의 객체
     * @returns {Object} 실행 결과 (changes 포함)
     */
    update: (programId, valveNumber, fields) => {
      const keys = Object.keys(fields);
      const sets = keys.map(k => `${k} = @${k}`).join(', ');
      const stmt = db.prepare(
        `UPDATE valve_config SET ${sets} WHERE program_id = @_program_id AND valve_number = @_valve_number`
      );
      return stmt.run({ ...fields, _program_id: programId, _valve_number: valveNumber });
    },

    /**
     * 특정 프로그램의 여러 밸브 설정을 일괄 갱신
     * @param {number} programId - 프로그램 ID
     * @param {Array} valves - 밸브 설정 배열 [{valve_number, is_active, duration_seconds, flow_target_liters}, ...]
     * @returns {void}
     */
    bulkUpdate: (programId, valves) => {
      const stmt = db.prepare(
        `UPDATE valve_config
         SET is_active = @is_active,
             duration_seconds = @duration_seconds,
             flow_target_liters = @flow_target_liters
         WHERE program_id = @_program_id AND valve_number = @valve_number`
      );
      const transaction = db.transaction((items) => {
        for (const valve of items) {
          stmt.run({
            is_active: valve.is_active ?? 0,
            duration_seconds: valve.duration_seconds ?? 300,
            flow_target_liters: valve.flow_target_liters ?? 0,
            valve_number: valve.valve_number,
            _program_id: programId,
          });
        }
      });
      transaction(valves);
    },
  };
};
