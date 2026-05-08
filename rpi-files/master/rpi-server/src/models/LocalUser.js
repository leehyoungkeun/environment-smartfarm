/**
 * 로컬 사용자 모델 (SQLite)
 * local_users 테이블에서 인증용 사용자 정보를 조회하고 갱신한다.
 */
module.exports = (db) => {
  return {
    /**
     * 사용자명으로 사용자 조회
     * @param {string} username - 사용자명
     * @returns {Object|undefined} 사용자 객체 또는 undefined
     */
    findByUsername: (username) =>
      db.prepare('SELECT * FROM local_users WHERE username = ?').get(username),

    /**
     * 사용자 비밀번호 갱신
     * @param {string} username - 사용자명
     * @param {string} hash - bcrypt 해시된 새 비밀번호
     * @returns {Object} 실행 결과 (changes 포함)
     */
    updatePassword: (username, hash) =>
      db.prepare('UPDATE local_users SET password_hash = ? WHERE username = ?').run(hash, username),
  };
};
