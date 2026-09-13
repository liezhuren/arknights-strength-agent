// tools/rotation.mjs —— ④' 回转时间（用户定位的四项关键点之一，单列）
//
// 与"覆盖率"同源但**口径不同**：覆盖率只回答"技能开着的时间占比"，
// 回转时间回答"多快能用上、节奏如何" —— 首轮可用时间是体感差异最大的指标。
// 全部由数据推导，无假设：
//   spData: { spType, spCost, initSp, increment, maxChargeTime }
//   duration / durationType(NONE|AMMO)
import { attackInterval } from '../engine/dps-engine.mjs'

const SP_LABEL = { auto: '自动回复', attack: '攻击回复', hit: '受击回复', deploy: '部署生效' }

/**
 * 计算回转指标。
 * @returns {object|null} 无技能（部署生效/永续且无消耗）时返回 null
 */
export function extractRotation(op, skillIndex = 2, eng = null, { hitAssumptionPerSec = 0.5 } = {}) {
  const lv = op.skills?.[skillIndex]?.levels?.[9]
  if (!lv) return null
  const sp = lv.spData ?? {}
  // 技能层数据取数据集（spData/duration），节奏参数取引擎（已含天赋/模组的攻速与 SP 速率）
  const spType = eng?.skill?.spType ?? 'auto'
  const cost = eng?.skill?.spCost ?? sp.spCost ?? 0
  const init = eng?.skill?.spStart ?? sp.initSp ?? 0
  const inc = eng?.skill?.increment ?? sp.increment ?? 1
  const dur = eng?.skill?.duration ?? lv.duration ?? 0
  const durType = lv.durationType ?? 'NONE'
  const interval = eng?.baseInterval ?? op.panel?.baseAttackTime ?? 1.5
  const rate0 = eng?.spRecoveryPerSec ?? op.panel?.spRecoveryPerSec ?? 1

  // 充能速率（SP/秒）
  const rate = spType === 'auto'
    ? rate0
    : spType === 'attack' ? inc / Math.max(interval, 0.05)
      : spType === 'hit' ? inc * hitAssumptionPerSec
        : null
  const need = Math.max(cost - init, 0)
  const firstUse = rate ? need / rate : (cost === 0 ? 0 : null)
  const permanent = dur <= 0 || durType === 'PERMANENT'
  const cycle = permanent ? null : (firstUse === null ? null : firstUse + dur)
  const coverage = permanent ? 1 : (cycle ? dur / cycle : 0)
  const downtime = cycle ? cycle - dur : null
  const castsIn = (window) => {
    if (permanent) return 1
    if (firstUse === null || !cycle) return 0
    if (firstUse > window) return 0
    return 1 + Math.floor((window - firstUse) / cycle)
  }
  return {
    spType, spLabel: SP_LABEL[spType] ?? spType, spCost: cost, initSp: init, increment: inc,
    rate, firstUse, duration: dur, durType, permanent, cycle, coverage, downtime,
    casts60: castsIn(60), casts90: castsIn(90),
    ammo: durType === 'AMMO',
    chargeable: (sp.maxChargeTime ?? 1) > 1 ? sp.maxChargeTime : null,
    notes: [],
  }
}

/** 操作难度相关的"回转侧"约束（供 tools/difficulty.mjs 复用）。 */
export function rotationBurden(r) {
  if (!r) return { level: 0, reasons: [] }
  const reasons = []
  let level = 0
  if (r.spType === 'hit') { level += 2; reasons.push('受击回复：充能依赖挨打，节奏不可控') }
  if (r.spType === 'attack') { level += 1; reasons.push('攻击回复：需持续接敌才能充能') }
  if (r.firstUse !== null && r.firstUse >= 25) { level += 1; reasons.push(`首轮 ${r.firstUse.toFixed(0)}s，开局空窗明显`) }
  if (r.downtime !== null && r.downtime >= r.duration && r.duration > 0) { level += 1; reasons.push('空窗期长于技能期，输出呈脉冲式') }
  if (r.permanent) { level -= 1; reasons.push('永续技能：开一次即长期生效，节奏压力最小') }
  return { level, reasons }
}

/** 渲染【回转】栏。 */
export function formatRotationSection(op, skillIndex = 2, eng = null) {
  const r = extractRotation(op, skillIndex, eng)
  if (!r) return null
  const lines = ['【回转】（关键点之一：多快能用上、节奏如何）']
  const rateTxt = r.rate === null ? '—' : `${r.rate.toFixed(2)} SP/s`
  lines.push(`  ${r.spLabel}${r.spType === 'deploy' ? '' : ` ${rateTxt}`} · 消耗 ${r.spCost} · 初始 ${r.initSp}`)
  if (r.permanent) {
    lines.push('  永续技能：开启后长期生效，无回转周期（覆盖率 100%）')
  } else if (r.firstUse === null) {
    lines.push('  无法推导回转（缺少速率参数）')
  } else {
    lines.push(`  首轮可用 ${r.firstUse.toFixed(1)}s · 完整周期 ${r.cycle.toFixed(1)}s（充能 ${r.firstUse.toFixed(1)}s + 持续 ${r.duration}s）`)
    lines.push(`  空窗 ${r.downtime.toFixed(1)}s · 覆盖率 ${(r.coverage * 100).toFixed(1)}% · 60s 内可开 ${r.casts60} 次 / 90s 内 ${r.casts90} 次`)
  }
  if (r.ammo) lines.push('  弹药型技能：以弹药耗尽为结束条件，实际持续随命中次数浮动')
  if (r.chargeable) lines.push(`  可充能 ${r.chargeable} 次：可连续释放，短窗口爆发节奏更灵活`)
  const burden = rotationBurden(r)
  if (burden.reasons.length) lines.push(`  回转侧操作负担（${burden.level > 0 ? '偏高' : '低'}）：${burden.reasons.join('；')}`)
  lines.push('  说明：受击回复按假设受击频率 0.5 次/秒折算；轴级最优节奏属玩法层，需用户给轴参数')
  return lines.join('\n')
}

export { attackInterval }
