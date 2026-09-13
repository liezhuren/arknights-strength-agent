// dps-engine.mjs
// 明日方舟数值引擎原型 —— 伤害公式 + 攻速 + 覆盖率 + 输出画像。
// 公式基于公开的明日方舟伤害机制；游戏数据拉取后用 gamedata 校准常量与面板字段。
// 本文件为纯函数模块，无外部依赖，Node >= 18 可直接运行。

// ---------- 伤害公式（含穿透：无视固定值 / 无视百分比）----------

/**
 * 物理伤害：max(⌊ATK×mult − DEF'⌋, ⌊ATK×mult×0.05⌋)。
 * DEF' = DEF×(1−无视%) − 无视固定值（下限 0）；穿透是打高甲场景的关键。
 */
export function physicalDamage(atk, mult, def, { defPenetrateFixed = 0, defPenetratePct = 0 } = {}) {
  const raw = atk * mult
  const effDef = Math.max(def * (1 - defPenetratePct) - defPenetrateFixed, 0)
  return Math.max(Math.floor(raw - effDef), Math.floor(raw * 0.05))
}

/**
 * 法术伤害：max(⌊ATK×mult×(1−RES'/100)⌋, ⌊ATK×mult×0.05⌋)。
 * RES' = RES − 无视固定法抗（下限 0）。
 */
export function magicalDamage(atk, mult, res, { resPenetrateFixed = 0 } = {}) {
  const raw = atk * mult
  const effRes = Math.max(res - resPenetrateFixed, 0)
  const resisted = raw * (1 - effRes / 100)
  return Math.max(Math.floor(resisted), Math.floor(raw * 0.05))
}

/**
 * 真实伤害：ATK×mult，无视防御与法抗。
 */
export function trueDamage(atk, mult) {
  return Math.floor(atk * mult)
}

/**
 * 攻击间隔（秒）= 基础间隔 / (1 + 攻速加成/100)。
 * 例：基础 1.5s，攻速 +50 → 1.0s。
 */
export function attackInterval(baseInterval, aspdBonus = 0) {
  return baseInterval / (1 + aspdBonus / 100)
}

// ---------- 干员模型 ----------

/**
 * 构造干员评测输入（MVP 子集）。
 * 满练面板指：E2 满级 + 潜能 + 信赖 + 模组合并后的最终值，由数据层负责填充。
 * @param {object} o
 */
export function makeOperator(o) {
  return {
    name: o.name ?? 'unnamed',
    rarity: o.rarity ?? 5,
    archetype: o.archetype ?? 'unknown',
    maxHp: o.maxHp ?? 0,
    atk: o.atk ?? 0,
    def: o.def ?? 0,
    res: o.res ?? 0,
    baseInterval: o.baseInterval ?? 1.5,
    blockCount: o.blockCount ?? 1,
    cost: o.cost ?? 0, // DP 费用
    redeployTime: o.redeployTime ?? 70, // 再部署秒
    rangeId: o.rangeId ?? null,
    damageType: o.damageType ?? 'physical', // physical | magical | true
    hitCount: o.hitCount ?? 1, // 单次攻击段数
    targetCount: o.targetCount ?? 1, // 同时攻击目标数
    spRecoveryPerSec: o.spRecoveryPerSec ?? 1, // 自然回 SP 速率（自动回复用）
    hitAssumptionPerSec: o.hitAssumptionPerSec ?? 0.5, // 受击频率假设（受击回复用，场景依赖）
    element: o.element ?? null, // 元素损伤：{ type, perHitRatio, isDot }（每击或每秒附带 ATK×ratio 的累积量）
    trap: o.trap ?? null, // 陷阱/棋子：{ mult, cdSec, cnt, targets }（触发伤害倍率/产陷阱CD秒/每轮产数/每次触发目标数假设）
    burst: o.burst ?? null, // 单次窗口爆发技能：{ totalHits, hitMult, windowSec, label }（总段数×每段倍率，窗口秒）
    summon: o.summon ?? null, // 召唤物：{ units:[{name,atk,interval,hits,mult,damageType?}], concurrency, coverage, note }
    penetrate: o.penetrate ?? null, // 破甲：{ defFixed, defPct, resFixed }（无视固定防御/无视防御百分比/无视固定法抗）
    enemyDebuff: o.enemyDebuff ?? null, // 对敌减益（自身受益）：{ defPct, defFlat, resFlat }（减防%/减防点数/减抗点数）
    talents: o.talents ?? [],
    idleNoAttack: o.idleNoAttack ?? false, // 常态不攻击（阵法术师/解放者特性）→ 平A 记 0
    skill: o.skill
      ? {
          name: o.skill.name ?? 'skill',
          spType: o.skill.spType ?? 'auto', // auto | attack | hit
          spCost: o.skill.spCost ?? 0,
          spStart: o.skill.spStart ?? 0,
          duration: o.skill.duration ?? 0, // 秒
          attackMult: o.skill.attackMult ?? 1,
          aspdBonus: o.skill.aspdBonus ?? 0, // 百分比（attack_speed 型）
          baseAttackTimeDelta: o.skill.baseAttackTimeDelta ?? 0, // 秒（base_attack_time 型，负值缩短）
          hits: o.skill.hits ?? 1,
          targetCount: o.skill.targetCount ?? 1,
          increment: o.skill.increment ?? 1, // 每次攻击回复 SP 量（攻击回复型）
          nextAttack: o.skill.nextAttack ?? false, // 下次攻击强化型
          noAttack: o.skill.noAttack ?? false, // 技能期间停止攻击（纯增益/陷阱/召唤型）
        }
      : null,
  }
}

/** 技能期攻击间隔：基础间隔 + 秒差，再按百分比攻速折算。 */
export function skillInterval(op) {
  const base = op.baseInterval + (op.skill?.baseAttackTimeDelta ?? 0)
  return attackInterval(base, op.skill?.aspdBonus ?? 0)
}

// ---------- 输出计算 ----------

/**
 * 单次攻击对单一目标的合计伤害（含段数与目标数）。
 * 技能期用技能自身的 hits/targetCount（覆盖基础值），非技能期用基础值。
 * 敌人状态修正（op.enemyDebuff：自身挂的减防/减抗）在此先于穿透生效。
 * 注：时序简化为"减益全程生效"（命中即挂、后续伤害受益），一次性爆发技能会略高估。
 */
export function hitDamage(op, mult, def, res, { inSkill = false } = {}) {
  const pen = op.penetrate ?? {}
  const deb = op.enemyDebuff ?? {}
  // 对敌减益支持两种单位：defPct（百分比小数）与 defFlat（绝对点数，如伊芙利特-300防）
  const effDef = Math.max(def * (1 - (deb.defPct ?? 0)) - (deb.defFlat ?? 0), 0)
  const effRes = Math.max(res - (deb.resFlat ?? 0), 0)
  const perHit =
    op.damageType === 'magical'
      ? magicalDamage(op.atk, mult, effRes, { resPenetrateFixed: pen.resFixed ?? 0 })
      : op.damageType === 'true'
        ? trueDamage(op.atk, mult)
        : physicalDamage(op.atk, mult, effDef, { defPenetrateFixed: pen.defFixed ?? 0, defPenetratePct: pen.defPct ?? 0 })
  const hits = inSkill && op.skill ? (op.skill.hits ?? 1) : (op.hitCount ?? 1)
  const targets = inSkill && op.skill ? (op.skill.targetCount ?? 1) : (op.targetCount ?? 1)
  return perHit * hits * targets
}

/** 技能期 DPS（对给定敌人 DEF/RES）。技能描述含"停止攻击"时技能期不进行普攻。 */
export function skillDps(op, def, res) {
  if (!op.skill) return 0
  if (op.skill.noAttack) return 0
  const interval = skillInterval(op)
  return hitDamage(op, op.skill.attackMult, def, res, { inSkill: true }) / interval
}

/** 技能外平 A DPS。
 *  `op.idleNoAttack`：常态不攻击的分支（阵法术师/解放者特性"通常时不攻击"）→ 平 A 为 0，
 *  这也意味着它们的平均 DPS 完全由技能期贡献（覆盖率即输出窗口占比）。 */
export function sustainDps(op, def, res) {
  if (op.idleNoAttack) return 0
  const interval = attackInterval(op.baseInterval)
  return hitDamage(op, 1, def, res, { inSkill: false }) / interval
}

/**
 * 技能覆盖率 = 持续时间 / 完整周期（充能时间 + 持续时间）。
 * 自动回复按 1 SP/s；攻击回复按 每次攻击回 1 SP。
 * spStart 为初始 SP，充能时间 = (spCost − spStart) / 回复速率。
 */
export function skillCoverage(op) {
  if (!op.skill || op.skill.duration <= 0) {
    // duration < 0 = 永续/被动型技能（开启后全程生效）
    if (op.skill && op.skill.duration < 0) return 1
    return 0
  }
  const sp = op.skill.spCost
  const spStart = op.skill.spStart ?? 0
  let chargeRate // SP / 秒
  if (op.skill.spType === 'attack') {
    // 攻击回复：每次攻击回 increment SP
    chargeRate = (op.skill.increment ?? 1) / skillInterval(op)
  } else if (op.skill.spType === 'hit') {
    // 受击回复：依赖被攻击频率（hitAssumptionPerSec 为场景假设值，非面板数据）
    chargeRate = (op.hitAssumptionPerSec ?? 0.5) * (op.skill.increment ?? 1)
  } else {
    // 自动回复：自然回 SP 速率取自面板 spRecoveryPerSec（方舟统一 1/s，个别技能/天赋可改）
    chargeRate = op.spRecoveryPerSec ?? 1
  }
  const chargeTime = Math.max(sp - spStart, 0) / chargeRate
  const cycle = chargeTime + op.skill.duration
  return op.skill.duration / cycle
}

/** 平均 DPS（按覆盖率加权技能期与平 A）。 */
export function avgDps(op, def, res) {
  if (isNextAttackSkill(op)) return nextAttackDps(op, def, res)
  const cov = skillCoverage(op)
  const during = op.skill ? skillDps(op, def, res) : sustainDps(op, def, res)
  const outside = sustainDps(op, def, res)
  return during * cov + outside * (1 - cov)
}

/**
 * 是否"下次攻击强化"型技能（充能型单次强化，如强力击、点燃）。
 * 特征：duration <= 0 且描述含"下次攻击"。
 */
export function isNextAttackSkill(op) {
  return !!op.skill && op.skill.duration <= 0 && (op.skill.nextAttack === true)
}

/**
 * 下次攻击强化型 DPS：每攒够一轮触发 1 次强化攻击，期间照常平 A。
 * 周期秒按回复类型：attack → n 次攻击 × 间隔；hit → n 次受击 / 受击频率假设；
 * auto → (spCost−spStart) / spRecoveryPerSec。周期内攻击次数 = 周期秒/间隔（含 1 次强化）。
 */
export function nextAttackDps(op, def, res) {
  if (!op.skill) return 0
  const interval = attackInterval(op.baseInterval, op.skill.aspdBonus)
  const n = Math.max(Math.ceil((op.skill.spCost ?? 1) / (op.skill.increment ?? 1)), 1)
  let cycleSec
  if (op.skill.spType === 'hit') {
    cycleSec = n / (op.hitAssumptionPerSec ?? 0.5)
  } else if (op.skill.spType === 'auto') {
    cycleSec = Math.max((op.skill.spCost ?? 0) - (op.skill.spStart ?? 0), 0) / (op.spRecoveryPerSec ?? 1)
  } else {
    cycleSec = n * interval // attack
  }
  cycleSec = Math.max(cycleSec, interval)
  const atkPerCycle = cycleSec / interval
  const normal = hitDamage(op, 1, def, res, { inSkill: false })
  const boosted = hitDamage(op, op.skill.attackMult, def, res, { inSkill: true })
  return (boosted + normal * (atkPerCycle - 1)) / cycleSec
}

/**
 * 输出画像：DEF/RES 网格上的平均 DPS 表。
 * 物理伤害只看 DEF 行（RES 不生效），法术伤害只看 RES 列。
 */
export function dpsProfile(
  op,
  { defs = [0, 200, 400, 600, 800, 1000, 1500, 2000], ress = [0, 30, 50, 70, 90] } = {},
) {
  const rows = []
  for (const def of defs) {
    const row = { def }
    for (const res of ress) {
      const key = `res${res}`
      row[key] = op.damageType === 'physical' ? avgDps(op, def, res) : avgDps(op, 0, res)
    }
    rows.push(row)
  }
  return rows
}

/** 费用效率：平均 DPS / DP 费用（"性价比"维度）。 */
export function costEfficiency(op, def, res) {
  if (op.cost <= 0) return 0
  return avgDps(op, def, res) / op.cost
}

// ---------- 元素损伤（累积速率 + 爆发收益模型）----------

/**
 * 元素损伤爆发收益表（我方干员施加给敌人时，敌人受到的爆发效果）。
 *
 * **数值来源修正（2026）**：此前标注为"PRTS「元素」页"，实际这些数值就在**游戏数据仓库**的
 * `gamedata_const.json` → `termDescriptionDict` 里（条目 `ba.dt.*2` 即"·我方"版本），
 * 例如 `ba.dt.neural2`：「累计满时爆发（普通、精英敌人1000点、领袖2000点累计值），
 * 敌人立即受到6000点元素伤害且获得3层麻痹。10秒冷却」。
 * 它们**以描述文本形式存放**（不是独立数值字段），所以当初是手抄进引擎的 —— 现已由
 * `tools/build-element.mjs` 解析落库到 `data/element-breaks.json`（引擎自测仍用本表做兜底）。
 *
 * 无来源元素伤害无视防御/法抗。
 * dotPerSec：爆发持续期间的持续元素伤害（凋亡的 800/s）；durationSec 同时作冷却假设。
 */
export const ELEMENT_BREAK_ON_ENEMY = {
  神经损伤: { burstDamage: 6000, dotPerSec: 0, durationSec: 10, note: '+3层麻痹（打断普攻，控制价值）' },
  侵蚀损伤: { burstDamage: 5000, dotPerSec: 0, durationSec: 8, note: '永久-120防（可叠加，物理增伤）' },
  灼燃损伤: { burstDamage: 7000, dotPerSec: 0, durationSec: 10, note: '法抗-20（法术增伤）' },
  凋亡损伤: { burstDamage: 0, dotPerSec: 800, durationSec: 15, note: '50%虚弱（衰减，降低敌方输出）' },
}

/**
 * 元素损伤累积速率（每秒向损伤条累积的元素量）。
 * - 每击型（perHitRatio）：攻击频率 × ATK × ratio × 目标数
 * - dot 型（isDot，如酒神 S3 每秒造成）：ATK × ratio × 目标数
 * 元素累积无视 DEF/RES。
 * @param {object} op - makeOperator 产物（需 element 字段 + skill/基础攻速）
 */
export function elementAccrualPerSec(op) {
  const el = op.element
  if (!el || !op.skill || el.perHitRatio === undefined) return 0
  const targets = el.targets ?? op.skill.targetCount ?? 1
  const base = op.atk * el.perHitRatio * targets
  if (el.isDot) return base // dot 型按秒计
  const interval = isNextAttackSkill(op)
    ? attackInterval(op.baseInterval, op.skill?.aspdBonus ?? 0)
    : skillInterval(op)
  return (base * (el.hits ?? 1)) / interval
}

/**
 * 元素损伤平均爆发收益 DPS（对普通敌人）。
 * 周期 = 损伤条充满时间（MAX_EP/累积速率）+ 爆发冷却（假设 ≈ 爆发持续秒数）。
 * 每次爆发的敌人收益：爆发直伤 + 持续伤害（凋亡 dotPerSec×duration）。
 * @param {object} op - makeOperator 产物
 * @param {number} [maxEp] - 损伤条上限（普通敌人 1000；领袖级 2000）
 */
export function elementBurstAvgDps(op, { maxEp = 1000 } = {}) {
  const el = op.element
  if (!el) return 0
  const accrual = elementAccrualPerSec(op)
  const entry = ELEMENT_BREAK_ON_ENEMY[el.type]
  if (!entry || accrual <= 0) return 0
  const burstTotal = entry.burstDamage + (entry.dotPerSec ?? 0) * entry.durationSec
  const cycle = maxEp / accrual + entry.durationSec
  return burstTotal / cycle
}

// ---------- 陷阱/棋子（触发模型 v1）----------

/**
 * 陷阱/棋子平均触发 DPS。
 * 每次技能周期产出 cnt 枚陷阱，假设高压场景下全部被敌人触发（理想上限，真实随走位波动）。
 * 每次触发伤害 = ATK × mult × (1 + 联动增伤) × 目标数假设。
 * @param {object} op - makeOperator 产物（需 trap 字段）
 * @param {number} [triggerIntervalSec] - 覆盖触发间隔假设（默认 = trap.cdSec）
 */
export function trapDps(op, { triggerIntervalSec } = {}) {
  const tr = op.trap
  if (!tr || tr.mult === undefined || tr.mult <= 0) return 0
  const interval = Math.max(triggerIntervalSec ?? tr.cdSec ?? 12, 0.1)
  const perTrigger = op.atk * tr.mult * (1 + (tr.multBonusPct ?? 0)) * (tr.targets ?? 1) * (tr.cnt ?? 1)
  return perTrigger / interval
}

// ---------- 单次窗口爆发技能（burst：按"部署次数 × 每次枚数"结算）----------

/**
 * 单次"部署/操作"的爆发伤害 = ATK × 每次引爆枚数 × 每枚倍率。
 * 如天下劫：手动部署 1 枚 → 天赋1（S3 强化）+ 周围四格空 → 十字阵 5 枚各引爆一次。
 * @param {object} op - makeOperator 产物（需 burst 字段）
 */
export function burstDeployDamage(op, mitigation = null) {
  const b = op.burst
  if (!b) return 0
  const raw = op.atk * (b.perDeployHits ?? 1) * (b.hitMult ?? 1)
  return mitigation ? mitigated(op, raw, mitigation.def ?? 0, mitigation.res ?? 0) : raw
}

/** 把"未减伤的原始伤害"按敌人 DEF/RES 折算（与 hitDamage 同一套公式）。
 *  默认不传 mitigation → 保持历史口径（锚点不变）；分场景/泛用性分析时传入 def/res。 */
function mitigated(op, raw, def, res) {
  if (op.damageType === 'true') return raw
  if (op.damageType === 'magical') {
    const effRes = Math.max(res - (op.penetrate?.resFixed ?? 0), 0)
    return Math.max(Math.floor(raw * (1 - effRes / 100)), Math.floor(raw * 0.05))
  }
  const effDef = Math.max(def * (1 - (op.penetrate?.defPct ?? 0)) - (op.penetrate?.defFixed ?? 0), 0)
  return Math.max(Math.floor(raw - effDef), Math.floor(raw * 0.05))
}

/**
 * 爆发技能总伤害。
 * 显式 totalHits 优先；否则 perDeployHits × 部署次数。
 * @param {object} op
 * @param {object} [opts]
 * @param {'skill'|'axis'} [opts.scope] - skill = 单次技能内（maxDeploysPerSkill）；axis = 完整轴（deploys）
 */
export function burstTotalDamage(op, { scope = 'axis', mitigation = null } = {}) {
  const b = op.burst
  if (!b) return 0
  if (b.totalHits !== undefined) {
    const raw = op.atk * b.totalHits * (b.hitMult ?? 1)
    return mitigation ? mitigated(op, raw, mitigation.def ?? 0, mitigation.res ?? 0) : raw
  }
  const deploys = scope === 'skill' ? (b.maxDeploysPerSkill ?? b.deploys ?? 1) : (b.deploys ?? 1)
  return burstDeployDamage(op, mitigation) * deploys
}

/**
 * 爆发技能平均 DPS = 总伤 / 窗口秒（axis 用轴长 windowSec；skill 用技能窗口 skillWindowSec）。
 * @param {object} op
 * @param {object} [opts]
 * @param {number} [opts.windowSec] - 覆盖窗口秒
 * @param {'skill'|'axis'} [opts.scope]
 */
export function burstDps(op, { windowSec, scope = 'axis', mitigation = null } = {}) {
  const b = op.burst
  if (!b) return 0
  const fallback = scope === 'skill' ? (b.skillWindowSec ?? b.windowSec) : b.windowSec
  const win = Math.max(windowSec ?? fallback ?? 10, 0.1)
  return burstTotalDamage(op, { scope, mitigation }) / win
}

// ---------- 召唤物（summon：独立输出线，不与本体 DPS 相加）----------

/**
 * 召唤物单体 DPS = ATK × 段数 × 倍率 ÷ 间隔（可含减伤）。
 * @param {object} unit - { atk, interval, hits?, mult?, damageType? }
 * @param {string} defaultType - 单位未声明 damageType 时用召唤师的伤害类型（召唤物与本体同源）
 * @param {object} op - 提供穿透（本体穿透对召唤物同样生效）
 * @param {object|null} mitigation - { def, res }
 */
function summonUnitDps(unit, defaultType, op, mitigation) {
  const interval = Math.max(unit.interval ?? 1.5, 0.01)
  const perHitRaw = (unit.atk ?? 0) * (unit.hits ?? 1) * (unit.mult ?? 1)
  if (perHitRaw <= 0) return 0
  if (!mitigation) return perHitRaw / interval
  // 减伤在"每击伤害"上做（与 hitDamage 同口径：含 5% 下限），再除以间隔 —— 不要在 DPS 上减防
  const type = unit.damageType ?? defaultType
  let perHit = perHitRaw
  if (type === 'magical') {
    const effRes = Math.max((mitigation.res ?? 0) - (op.penetrate?.resFixed ?? 0), 0)
    perHit = Math.max(Math.floor(perHitRaw * (1 - effRes / 100)), Math.floor(perHitRaw * 0.05))
  } else if (type !== 'true') {
    const effDef = Math.max((mitigation.def ?? 0) * (1 - (op.penetrate?.defPct ?? 0)) - (op.penetrate?.defFixed ?? 0), 0)
    perHit = Math.max(Math.floor(perHitRaw - effDef), Math.floor(perHitRaw * 0.05))
  }
  return perHit / interval
}

/**
 * 召唤物合计 DPS（一条独立输出线）。
 *
 * 口径要点（重要，防止误用）：
 * 1. **与本体分开报**，不并入 `skillDps`/`avgDps` —— 召唤物的攻击是另一条输出线。
 * 2. **与主力技能互斥/并列关系由调用方判断**：召唤师（令/麦哲伦）同一时刻只有一种召唤物在场，
 *    其本体技能期常为 `noAttack` → 合计 = Σ(召唤物 × 同时存在数)，而不是"本体 + 召唤物"。
 * 3. 同名单位只取 `concurrency` 个（按单位 DPS 降序取前 N），对应"最多同时部署 N 个"。
 * 4. 不套用本体技能倍率（`skill.attackMult`）—— 召唤物用自己的面板与自己的技能。
 * 5. `coverage` 处理限时召唤物（如夕"小自在"持续 25s）的在场占比；默认 1。
 * 6. 召唤物**自身的技能尚未建模**（如弦惊"宁作吾"攻速+25%、逍遥"笑鸣瑟"4.5 倍、
 *    打字机"锐笔速写"2.55 倍）→ 本函数给出的是**普攻下限**，报告须标注。
 *
 * @param {object} op - makeOperator 产物（需 summon 字段）
 * @param {object} [opts]
 * @param {object|null} [opts.mitigation] - { def, res } 敌人减伤（不传 = 不吃防御，与 burst 一致）
 * @returns {number}
 */
export function summonDps(op, { mitigation = null } = {}) {
  const s = op.summon
  if (!s || !Array.isArray(s.units) || s.units.length === 0) return 0
  const concurrency = Math.max(s.concurrency ?? 1, 1)
  const coverage = Math.min(Math.max(s.coverage ?? 1, 0), 1)
  const perUnit = s.units
    .map((u) => summonUnitDps(u, op.damageType, op, mitigation))
    .sort((a, b) => b - a)
  const total = perUnit.slice(0, concurrency).reduce((a, b) => a + b, 0)
  return total * coverage
}

/**
 * 召唤物在技能期的 DPS（限时/技能绑定召唤物用；口径同 summonDps，仅按 coverage 折算）。
 * 名字保持与 burst/skill 侧一致，便于报告统一呈现。
 */
export function summonSkillDps(op, { mitigation = null } = {}) {
  return summonDps(op, { mitigation })
}

