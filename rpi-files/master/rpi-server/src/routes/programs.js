/**
 * 관수 프로그램 라우트
 * 관수 프로그램 목록 조회, 개별 조회, 업데이트
 */
const router = require('express').Router();
const { IrrigationProgram, ValveConfig } = require('../models');

/**
 * GET /api/programs
 * 전체 관수 프로그램 목록 조회 (밸브 설정 포함)
 */
router.get('/', (req, res) => {
  try {
    const programs = IrrigationProgram.getAll();

    // 각 프로그램에 밸브 설정 첨부
    const programsWithValves = programs.map(program => ({
      ...program,
      valves: ValveConfig.getByProgram(program.id)
    }));

    res.json({ success: true, data: programsWithValves });
  } catch (error) {
    console.error('관수 프로그램 목록 조회 중 오류:', error);
    res.status(500).json({ success: false, message: '관수 프로그램 목록 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * GET /api/programs/:number
 * 프로그램 번호로 개별 관수 프로그램 조회 (밸브 설정 포함)
 */
router.get('/:number', (req, res) => {
  try {
    const program = IrrigationProgram.getByNumber(req.params.number);
    if (!program) {
      return res.status(404).json({ success: false, message: '해당 프로그램을 찾을 수 없습니다.' });
    }

    // 밸브 설정 첨부
    program.valves = ValveConfig.getByProgram(program.id);

    res.json({ success: true, data: program });
  } catch (error) {
    console.error('관수 프로그램 조회 중 오류:', error);
    res.status(500).json({ success: false, message: '관수 프로그램 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * PUT /api/programs/:number
 * 프로그램 번호로 관수 프로그램 업데이트 (밸브 설정 포함)
 */
router.put('/:number', (req, res) => {
  try {
    const { valves, ...programData } = req.body;
    const number = req.params.number;

    // 프로그램 데이터 업데이트
    IrrigationProgram.update(number, programData);

    // 밸브 설정이 포함된 경우 각 밸브 업데이트
    if (valves && Array.isArray(valves)) {
      const program = IrrigationProgram.getByNumber(number);
      valves.forEach(v => {
        ValveConfig.update(program.id, v.valve_number, v);
      });
    }

    // 업데이트된 프로그램 반환
    const updatedProgram = IrrigationProgram.getByNumber(number);
    updatedProgram.valves = ValveConfig.getByProgram(updatedProgram.id);

    res.json({ success: true, message: '관수 프로그램이 업데이트되었습니다.', data: updatedProgram });
  } catch (error) {
    console.error('관수 프로그램 업데이트 중 오류:', error);
    res.status(500).json({ success: false, message: '관수 프로그램 업데이트 중 오류가 발생했습니다.' });
  }
});

module.exports = router;
