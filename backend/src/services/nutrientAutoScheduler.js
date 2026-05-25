// nutrientAutoScheduler — 자동 모드 큐 순차 실행 watcher
//
// 동작:
//   - 1분마다 모든 농장의 nutrientState 점검
//   - mode === 'auto' 인 농장에서 currentCycle 종료 감지:
//       * currentCycle.phase === 'done' 또는
//       * currentCycle === null/{} 그리고 autoQueue.startedAt 으로부터 충분 시간 경과
//   - 다음 항목 진행: repeat 남으면 같은 시나리오 다시, 0 이면 다음 enabled item
//   - 마지막 + !loop → mode='paused' 자동 전환
//
// 한계 (양산 전 보강):
//   - NR 양액 자동화의 cycle 'done' 보고 형식 미확정 → 보수적 시간 기반 추정
//   - 정확한 trigger 는 NR 측 cycle-complete telemetry endpoint 추가 필요

import { pool } from "../db.js";
import logger from "../utils/logger.js";

const TICK_INTERVAL_MS = 60 * 1000;   // 1분
const ESTIMATED_CYCLE_SEC = 632;       // PHASE_PLAN 합 (42+60+30+480+20) + 여유
const CYCLE_GRACE_SEC = 60;            // cleanup 끝난 후 NR 보고 지연 대비

let timer = null;

async function tickFarm(farmId) {
  try {
    const stRows = await pool.query(
      `SELECT mode, current_cycle, auto_queue, active_scenario_id FROM nutrient_states WHERE farm_id = $1`,
      [farmId],
    );
    if (stRows.rows.length === 0) return;
    const st = stRows.rows[0];
    if (st.mode !== 'auto') return;

    const cfgRows = await pool.query(`SELECT auto_schedule FROM nutrient_configs WHERE farm_id = $1`, [farmId]);
    const sched = cfgRows.rows[0]?.auto_schedule || { items: [], loop: true };
    if (!Array.isArray(sched.items) || sched.items.length === 0) return;

    const aq = st.auto_queue || {};
    if (aq.itemIdx == null || !aq.startedAt) return;

    // cycle done 추정 — startedAt 으로부터 ESTIMATED_CYCLE_SEC + GRACE 이상 경과
    const started = new Date(aq.startedAt).getTime();
    const elapsedSec = (Date.now() - started) / 1000;
    if (elapsedSec < ESTIMATED_CYCLE_SEC + CYCLE_GRACE_SEC) return;

    // 또는 NR 이 cycle 완료 보고 (phase === 'done' 또는 currentCycle === null)
    const cc = st.current_cycle || {};
    const phaseDone = cc.phase === 'done' || cc.phase == null;
    if (!phaseDone && elapsedSec < ESTIMATED_CYCLE_SEC * 2) return; // 안전 — 2배 지나도 강제 진행

    await advanceQueue(farmId, sched, aq);
  } catch (e) {
    logger.warn(`nutrientAutoScheduler tick(${farmId}) 실패: ${e.message}`);
  }
}

async function advanceQueue(farmId, sched, aq) {
  const curItem = sched.items[aq.itemIdx];
  let nextIdx = aq.itemIdx;
  let nextRepeatDone = (aq.repeatDone || 0) + 1;

  // 현재 item 의 repeat 다 채웠으면 다음 enabled item
  if (!curItem || !curItem.enabled || nextRepeatDone >= (curItem.repeat || 1)) {
    nextIdx = findNextEnabledIdx(sched.items, aq.itemIdx);
    nextRepeatDone = 0;
    // 마지막 도달 + !loop → mode='paused'
    if (nextIdx == null) {
      if (sched.loop) {
        nextIdx = findNextEnabledIdx(sched.items, -1);
        if (nextIdx == null) return; // enabled 없음
      } else {
        await pool.query(
          `UPDATE nutrient_states SET mode = 'paused', auto_queue = '{}'::jsonb, updated_at = NOW() WHERE farm_id = $1`,
          [farmId],
        );
        logger.info(`🔄 ${farmId} 큐 완료 (loop=false) → paused 전환`);
        return;
      }
    }
  }

  const nextItem = sched.items[nextIdx];
  if (!nextItem?.scenarioId) return;

  // 시나리오 active 전환
  await pool.query(`UPDATE nutrient_scenarios SET active = false WHERE farm_id = $1 AND active = true`, [farmId]);
  await pool.query(`UPDATE nutrient_scenarios SET active = true WHERE id = $1`, [nextItem.scenarioId]);
  await pool.query(
    `UPDATE nutrient_states SET active_scenario_id = $2, auto_queue = $3::jsonb, updated_at = NOW() WHERE farm_id = $1`,
    [farmId, nextItem.scenarioId, JSON.stringify({ itemIdx: nextIdx, repeatDone: nextRepeatDone, startedAt: new Date().toISOString() })],
  );
  logger.info(`🔄 ${farmId} 큐 진행: item[${nextIdx}] scenario=${nextItem.scenarioId} (repeatDone=${nextRepeatDone}/${nextItem.repeat})`);
}

function findNextEnabledIdx(items, fromIdx) {
  for (let i = fromIdx + 1; i < items.length; i++) {
    if (items[i].enabled) return i;
  }
  return null;
}

export function start() {
  if (timer) return;
  timer = setInterval(async () => {
    try {
      const rows = await pool.query(`SELECT farm_id FROM nutrient_states WHERE mode = 'auto'`);
      for (const r of rows.rows) await tickFarm(r.farm_id);
    } catch (e) {
      logger.warn(`nutrientAutoScheduler scan 실패: ${e.message}`);
    }
  }, TICK_INTERVAL_MS);
  logger.info(`🔄 nutrientAutoScheduler 시작 (tick=${TICK_INTERVAL_MS / 1000}s, cycle≈${ESTIMATED_CYCLE_SEC}s)`);
}

export function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}
