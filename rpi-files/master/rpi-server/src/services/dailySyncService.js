/**
 * 일일 동기화 서비스
 * 매일 00:05에 전일 일일 집계를 사무실 서버로 전송
 * DailySummary 및 DailyValveFlow 데이터를 MQTT를 통해 발행
 */
const { publish, getFarmTopics, getConnectionStatus } = require('./mqttService');
const { db, DailySummary, DailyValveFlow, SensorData, AlarmLog } = require('../models');

// 데이터 보관 기간 (일)
const SENSOR_RETENTION_DAYS = 30;  // 센서 데이터: 30일
const ALARM_RETENTION_DAYS = 90;   // 알람 로그: 90일

let timeoutId = null;

/**
 * 일일 동기화 서비스 시작
 * 다음 00:05 시점에 동기화가 실행되도록 타이머 설정
 */
function startDailySync() {
  try {
    scheduleNextSync();
    console.log('일일 동기화 서비스 시작');
  } catch (error) {
    console.error('일일 동기화 서비스 시작 오류:', error);
  }
}

/**
 * 일일 동기화 서비스 중지
 * 예약된 타이머를 해제
 */
function stopDailySync() {
  try {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
      console.log('일일 동기화 서비스 중지');
    }
  } catch (error) {
    console.error('일일 동기화 서비스 중지 오류:', error);
  }
}

/**
 * 다음 00:05에 실행되도록 타이머 설정
 * 이미 오늘 00:05가 지났으면 내일로 예약
 */
function scheduleNextSync() {
  try {
    const now = new Date();
    const next = new Date(now);
    next.setHours(0, 5, 0, 0); // 00:05:00

    // 이미 오늘 00:05가 지났으면 내일로 설정
    if (next <= now) {
      next.setDate(next.getDate() + 1);
    }

    const delay = next.getTime() - now.getTime();
    console.log(`다음 일일 동기화: ${next.toLocaleString('ko-KR')} (${Math.round(delay / 60000)}분 후)`);

    timeoutId = setTimeout(async () => {
      try {
        await syncDailySummary();
      } catch (error) {
        console.error('일일 동기화 실행 오류:', error);
      }
      // 동기화 완료 후 다음 날 예약
      scheduleNextSync();
    }, delay);
  } catch (error) {
    console.error('일일 동기화 스케줄 설정 오류:', error);
  }
}

/**
 * 전일 일일 집계 동기화
 * 전일 날짜의 DailySummary와 DailyValveFlow를 조회하여 MQTT로 발행
 */
async function syncDailySummary() {
  if (!getConnectionStatus()) {
    console.warn('MQTT 미연결 — 일일 동기화 스킵');
    return;
  }

  try {
    // 전일 날짜 계산
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];

    const summaries = DailySummary.getByDate(dateStr);
    const valveFlows = DailyValveFlow.getByDate(dateStr);

    if (summaries.length === 0) {
      console.log(`일일 동기화: ${dateStr} 데이터 없음`);
      return;
    }

    const farmTopics = getFarmTopics();

    // 일일 집계 데이터를 프로그램별로 정리하여 발행
    await publish(farmTopics.dailySummary, {
      date: dateStr,
      summaries: summaries.map(s => ({
        summaryDate: s.summary_date,
        programNumber: s.program_number,
        runCount: s.run_count,
        setEc: s.set_ec,
        setPh: s.set_ph,
        avgEc: s.avg_ec,
        avgPh: s.avg_ph,
        totalSupplyLiters: s.total_supply_liters,
        totalDrainLiters: s.total_drain_liters,
        // 해당 프로그램의 밸브별 유량 데이터 포함
        valveFlows: valveFlows
          .filter(v => v.program_number === s.program_number)
          .map(v => ({
            valveNumber: v.valve_number,
            totalFlowLiters: v.total_flow_liters,
            runCount: v.run_count,
          })),
      })),
      timestamp: Date.now(),
    });

    console.log(`일일 동기화 완료: ${dateStr} (${summaries.length}개 프로그램)`);

    // 오래된 데이터 자동 정리
    cleanupOldData();
  } catch (error) {
    console.error('일일 동기화 오류:', error);
  }
}

/**
 * 오래된 데이터 자동 정리
 * sensor_data: 30일, alarm_log: 90일 초과 데이터 삭제
 */
function cleanupOldData() {
  try {
    const sensorDeleted = SensorData.deleteOlderThan(SENSOR_RETENTION_DAYS);
    const alarmDeleted = AlarmLog.deleteOlderThan(ALARM_RETENTION_DAYS);

    if (sensorDeleted > 0 || alarmDeleted > 0) {
      console.log(`데이터 정리 완료: 센서 ${sensorDeleted}건, 알람 ${alarmDeleted}건 삭제`);
      // 삭제 후 디스크 공간 회수
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.exec('VACUUM');
      console.log('SQLite VACUUM 완료');
    }
  } catch (error) {
    console.error('데이터 정리 오류:', error);
  }
}

module.exports = { startDailySync, stopDailySync };
