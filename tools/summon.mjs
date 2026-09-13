// tools/summon.mjs —— 召唤物通道的接线层
//
// 职责：把 data/summons.json 里"属于某个干员"的伤害型召唤物，组装成引擎 `summon` 字段，
// 并把口径假设整理成可呈现的结构（报告行 + API charts）。
//
// 口径（重要，见 docs/dps-calculation.md §17）：
//   1. 召唤物是**独立输出线** —— 不与本体 skillDps/avgDps 相加；召唤师本体技能期常为 noAttack。
//   2. 只有 `dealsDamage: true` 的召唤物计入 DPS；治疗无人机/减益图腾/装置一律不计（会被标注）。
//   3. `concurrency` 来自「最多同时部署N个 / 最多存在N个 / 最多可部署N个」；缺失时取 1 并标注为假设。
//   4. **同一干员的多种召唤物默认视为"互斥形态"**（令/麦哲伦/电弧的召唤物随技能改变功能），
//      因此按**模式取最大**（只有一种在场），而不是把多种召唤物相加。
//      数据里 `mutuallyExclusive: false` 时才相加（用于未来确认可并存的场合）。
//   5. 召唤物**自身的技能未建模** → 本值是"仅普攻"的下限，报告必须标注。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA = join(HERE, '..', 'data', 'summons.json')

// ⚠ 通道互斥：`traper`（陷阱师）分支的技能 atk_scale 已归 **`trap` 通道**（罗宾「夹子」、霜华「迎宾踏垫」、
//   多萝西「共振装置」、钼铅、望）。这些召唤物若再进 summon 通道就是**双算** —— 与
//   "陷阱师 atk_scale 误当普攻倍率"是同一类错误。此处按 id 硬排除，并在评测里断言两者不同时命中。
const TRAP_CHANNEL_IDS = new Set([
  'token_10013_robin_mine', // 罗宾「夹子」
  'token_10016_rfrost_mine', // 霜华「迎宾踏垫」
  'token_10025_doroth_recttp', // 多萝西「共振装置」
  'token_10044_wulfen_mine', // 钼铅 矿石“杀手”
  'token_10064_wang_stone1', // 望「棋子」（burst 通道）
])
export const excludedByTrapChannel = () => [...TRAP_CHANNEL_IDS]

let _cache = null
export function loadSummons() {
  if (!_cache) {
    const raw = JSON.parse(readFileSync(DATA, 'utf8'))
    _cache = (Array.isArray(raw) ? raw : raw.summons).filter((s) => s && s.owner)
  }
  return _cache
}

/** 干员的伤害型召唤物（未关联 owner 的条目不属于任何干员；陷阱类归 trap 通道，不进这里） */
export function summonsOf(opName) {
  return loadSummons().filter((s) => s.owner === opName && s.dealsDamage && !TRAP_CHANNEL_IDS.has(s.id))
}

/** 干员的功能型/无伤害召唤物（不进 DPS，但要在报告里说明"有但没算"） */
export function supportSummonsOf(opName) {
  return loadSummons().filter((s) => s.owner === opName && s.combat && !s.dealsDamage)
}

/**
 * 构造引擎 `summon` 字段。
 * @param {string} opName - 干员名（与 summons.json 的 owner 对应）
 * @returns {object|null} null 表示该干员没有可计入的召唤物
 */
export function summonFor(opName) {
  const all = summonsOf(opName)
  if (all.length === 0) return null
  // 同一干员的召唤物默认互斥（技能改变功能）→ 取单体 DPS 最大的一个模式
  // ⚠ 比较必须用**自身技能改量后**的 DPS：鸿雪「打字机」带 S3 是 ×6.375，选模式时不能用裸面板
  const mode = all
    .map((s) => {
      const sm = s.ownSkill?.mods ?? null
      const atkMult = sm?.atkMult ?? 1
      const intervalMult = sm?.intervalMult ?? 1
      const unit = { name: s.name, atk: s.atk * atkMult, interval: (s.interval ?? 1.5) * intervalMult, hits: 1, mult: 1 }
      return { unit, src: s, sm, eff: unit.atk / unit.interval }
    })
    .sort((a, b) => b.eff - a.eff)[0]
  const concurrency = Math.max(mode.src.concurrency ?? 1, 1)
  return {
    units: [mode.unit],
    // ⚠ 保持 1：数据里的 `concurrency` 是**该召唤物在场上限N个**，而合成体只占 1 个实体，
    //   是否铺满取决于部署位与玩法（与"陷阱是否全被触发"同类）。基准取 1 保证可信，
    //   多副本潜力放进 meta.maxCopies 供报告给出上限区间。
    concurrency: 1,
    coverage: 1,
    // 报告用元数据（引擎忽略未知字段）
    meta: {
      owner: opName,
      modeCount: all.length,
      mode: mode.src.name,
      // 自身技能改量（§18）：已并入 units 的 atk/interval
      ownSkill: mode.sm
        ? {
            name: mode.sm.name,
            atkMult: mode.sm.atkMult ?? 1,
            intervalMult: mode.sm.intervalMult ?? 1,
            reason: mode.sm.reason,
            duration: mode.sm.duration,
            spCost: mode.sm.spCost,
          }
        : null,
      // 未能建模的技能条数（一次性入场伤害/周期伤害/概率型/无描述）→ 报告标注
      unmodeledSkills: (mode.src.ownSkill?.all ?? []).filter((x) => !x.modeled).length,
      baseAtk: mode.src.atk,
      baseInterval: mode.src.interval,
      maxCopies: concurrency,
      concurrencyConfidence: mode.src.concurrencyConfidence ?? 'default',
      concurrencyQuote: mode.src.concurrencyQuote ?? '',
      durationSec: mode.src.durationSec ?? null,
      skillIndex: mode.src.skillIndex ?? null,
      blockCnt: mode.src.blockCnt ?? 0,
      maxHp: mode.src.maxHp ?? 0,
      cost: mode.src.cost ?? null,
      allModes: all.map((s) => ({ name: s.name, atk: s.atk, interval: s.interval, perUnitDps: s.atk / (s.interval ?? 1.5) })),
      support: supportSummonsOf(opName).map((s) => ({ name: s.name, atk: s.atk })),
    },
  }
}

/**
 * 报告行：把召唤物通道变成人能读的几行 + 必须转述的假设。
 * @param {object} r - evaluateEngine 的返回值（需 r.summon / r.summonDps）
 */
export function formatSummonSection(r) {
  const s = r.summon
  if (!s?.meta) return []
  const m = s.meta
  const lines = []
  const per = s.units[0]
  const single = per.atk / Math.max(per.interval ?? 1.5, 0.01)
  const conf = m.concurrencyConfidence === 'phrase' ? '按召唤数量描述' : '无同时部署数表述，保守假设 1 个'
  lines.push(`召唤物：${m.mode} · atk${per.atk}/${per.interval}s → 单体 ${single.toFixed(1)} DPS${m.skillIndex !== null ? `（由 S${m.skillIndex + 1} 产出/强化）` : ''}`)
  if (m.ownSkill && (m.ownSkill.atkMult !== 1 || m.ownSkill.intervalMult !== 1)) {
    const parts = []
    if (m.ownSkill.atkMult !== 1) parts.push(`攻击力 ×${m.ownSkill.atkMult}`)
    if (m.ownSkill.intervalMult !== 1) parts.push(`间隔 ×${m.ownSkill.intervalMult}`)
    const before = (m.baseAtk / m.baseInterval).toFixed(1)
    lines.push(`        自身技能「${m.ownSkill.name}」已计入：${parts.join(' · ')}（${m.baseAtk}/${m.baseInterval}s 单体 ${before} → ${single.toFixed(1)}）；依据：${m.ownSkill.reason}`)
  }
  lines.push(`        ${m.modeCount > 1 ? `${m.modeCount} 种召唤物形态（同一时刻只存在 1 种，按最强形态计）· ` : ''}基准按 1 个在场 → 召唤物 ${r.summonDps.toFixed(1)} DPS`)
  lines.push(`        取数口径：${conf}`)
  if (m.unmodeledSkills > 0) {
    lines.push(`        ⚠ 另有 ${m.unmodeledSkills} 个自身技能**未折入**持续 DPS（一次性入场伤害/周期伤害/概率型/无描述可判定 → 不计比硬套更安全），故为持续输出的下限`)
  }
  if (m.maxCopies > 1) {
    lines.push(`        ⚠ 该召唤物表述为「最多存在 ${m.maxCopies} 个」→ 铺满时上限约 ${(r.summonDps * m.maxCopies).toFixed(0)} DPS（受部署位限制，默认口径不取）`)
  }
  if (m.durationSec) lines.push(`        ⚠ 限时召唤物：持续 ${m.durationSec}s，覆盖率未折算（按满覆盖计）`)
  if (m.support.length) {
    lines.push(`        另有不计入 DPS 的无伤害召唤物：${m.support.map((x) => x.name).join('、')}（治疗/减益/装置）`)
  }
  if (m.blockCnt || m.maxHp) lines.push(`        生存面：阻挡 ${m.blockCnt} · 生命 ${m.maxHp}（召唤物自身生存未参与本体 ④ 生存栏）`)
  return lines
}
