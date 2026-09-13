// engine/survival.mjs —— 生存维度纯数学层（与输出侧共用同一套伤害公式，方向相反）
// 设计原则：与 dps-engine 同构 —— 承受伤害用同一公式，只是"我方 ATK"换成"敌方 ATK"、"敌方 DEF"换成"我方 DEF"。
// 公式（与引擎一致）：物理 max(⌊ATK−DEF⌋, ⌊ATK×0.05⌋)；法术 max(⌊ATK×(1−RES/100)⌋, ⌊ATK×0.05⌋)
// 减伤顺序：先减益/减免（固定点数、百分比），再套 5% 下限 —— 与输出侧的 enemyDebuff→penetrate 顺序对称。

/** 单次受击的实际伤害（来袭）。 */
export function incomingHit(atk, { damageType = 'physical', def = 0, res = 0, drFlat = 0, drPct = 0 } = {}) {
  let eff
  if (damageType === 'true') {
    eff = atk
  } else if (damageType === 'magical') {
    eff = atk * (1 - Math.max(res, 0) / 100)
  } else {
    eff = atk - Math.max(def, 0)
  }
  const floor = atk * 0.05
  const after = Math.max(eff - drFlat, 0) * (1 - Math.min(Math.max(drPct, 0), 1))
  return Math.max(Math.floor(after), Math.floor(floor))
}

/**
 * 面对某来袭画像的每秒承受伤害（未计闪避与自回）。
 * @param {{atk:number, interval:number, damageType:string}} profile
 */
export function incomingDps(profile, defense = {}) {
  const per = incomingHit(profile.atk, { damageType: profile.damageType, ...defense })
  return per / Math.max(profile.interval, 0.1)
}

/**
 * 闪避对有效生命的期望倍率：1/(1−闪避率)。
 * 区分物理/法术闪避；`prob` 语义由调用方按描述判定后传入。
 */
export function dodgeMultiplier(dodge, damageType = 'physical') {
  const p = damageType === 'magical' ? (dodge.magical ?? 0) : (dodge.physical ?? 0)
  const c = Math.min(Math.max(p, 0), 0.95)
  return 1 / (1 - c)
}

/**
 * 按"逐次受击 + 击间自回"模拟生存时长。
 * 为什么不直接用 pool / dps 的连续模型：连续模型会忽略伤害的**离散性** ——
 * 例：1758 生命面对 1394/击、间隔 1.3s，连续模型给 1.64s，实际是第 2 击（t=1.3s）倒下。
 * 离散模拟同时天然处理"单击超过总生命"（1 击即倒）与治疗回血。
 * @returns {{hits:number|null, seconds:number|null, sustained:boolean}}
 */
export function surviveSim({ pool, perHit, interval, healPerSec = 0, maxSec = 180 }) {
  if (!(pool > 0)) return { hits: 0, seconds: 0, sustained: false }
  if (!(perHit > 0)) return { hits: null, seconds: null, sustained: true }
  const dt = Math.max(interval, 0.05)
  const healPerTick = healPerSec * dt
  let hp = pool
  let t = 0
  let hits = 0
  while (t < maxSec) {
    t += dt
    hits++
    hp -= perHit
    if (hp <= 0) return { hits, seconds: t, sustained: false }
    if (healPerSec > 0) hp = Math.min(hp + healPerTick, pool)
    if (hits > 100000) break
  }
  return { hits: null, seconds: null, sustained: true }
}

/**
 * 生存能力汇总。
 * @returns {{perHit:number, dps:number, ehp:number, hitsToDie:number|null, seconds:number|null,
 *            healPerSec:number, netDps:number, sustained:boolean}}
 */
export function survival(profile, { maxHp, def = 0, res = 0, drFlat = 0, drPct = 0, shield = 0, dodge = {}, healPerSec = 0 } = {}) {
  const perHit = incomingHit(profile.atk, { damageType: profile.damageType, def, res, drFlat, drPct })
  const dodgeMul = dodgeMultiplier(dodge, profile.damageType)
  const rawDps = perHit / Math.max(profile.interval, 0.1)
  const dps = rawDps / dodgeMul // 闪避把承伤摊薄（期望值）
  const pool = maxHp + shield
  const sim = surviveSim({ pool, perHit, interval: profile.interval, healPerSec })
  // 等效生命 = 血池 × 防御/减伤带来的折算倍率 × 闪避倍率（三者都只放大一次）
  const mitigFactor = perHit > 0 ? profile.atk / perHit : Infinity
  return {
    perHit,
    dps,
    rawDps,
    dodgeMul,
    mitigFactor,
    ehp: Number.isFinite(mitigFactor) ? pool * mitigFactor * dodgeMul : Infinity,
    hitsToDie: sim.hits,
    seconds: sim.seconds,
    healPerSec,
    netDps: Math.max(dps - healPerSec, 0),
    sustained: sim.sustained,
  }
}

/** 固定值格式化（∞ 友好）。 */
export function fmt(v, digits = 1) {
  if (v === null || v === undefined) return '∞'
  if (!Number.isFinite(v)) return '∞'
  return v.toFixed(digits)
}

/**
 * 多敌人集火生存（§22）。
 *
 * **核心口径（重要，最容易算错的地方）**：N 个敌人各自按自己的间隔攻击，若**同时命中**
 * （同一个波次、同间隔），则应当 `perHit × N` **保持原间隔**，而**不是** `perHit` + `interval / N`。
 * 后者把伤害"平滑化"了 —— 而离散受击模型存在的全部意义就是"活下去看的是单次能不能扛住"：
 *
 *   例（1758 生命 / 356 防 vs 550 攻 / 每 3s 的杂兵）：
 *     1 个：每击 194 → 可挨 11 击 · 30s
 *     2 个**同时**：每击 388 → 可挨 5 击 · 12s      ← 正确
 *     2 个错算成"间隔减半"：每击 194、每 1.5s → 可挨 11 击 · 15s  ← 高估 25%，且漏掉"可能被秒"
 *
 * 同时命中也让**自回的窗口变差**（两次伤害之间没有恢复机会），这正是集火比"线性放大"更致命的原因。
 * 若敌人**错开**命中（不同波次/不同间隔），则应改用 `perHit` + `interval / N` 口径单独计算。
 *
 * **等效生命口径**：`pool × (N × atk / perHit_N) × 闪避倍率` —— 用**合并后的来袭强度**
 * `N × atk` 与**合并后的每击** `perHit_N` 计算，这样量纲与单敌人情形一致（不会出现负值）。
 *
 * @param {{atk:number, interval:number, damageType:string}} profile - **单个敌人**的来袭画像
 * @param {object} defense - 同 survival()
 * @param {number} [enemies] - 同时集火的敌人数（≥1）
 * @returns {{perHit:number, hitsToDie:number|null, seconds:number|null, sustained:boolean, ehp:number}}
 */
export function surviveGroup(profile, defense = {}, enemies = 1) {
  const N = Math.max(Math.floor(enemies) || 1, 1)
  const single = survival(profile, defense)
  if (N === 1) return { ...single, enemies: 1, perHitGroup: single.perHit }
  const { maxHp = 0, def = 0, res = 0, drFlat = 0, drPct = 0, shield = 0, dodge = {}, healPerSec = 0 } = defense
  const perHitGroup = incomingHit(profile.atk * N, { damageType: profile.damageType, def, res, drFlat, drPct })
  const pool = maxHp + shield
  const sim = surviveSim({ pool, perHit: perHitGroup, interval: profile.interval, healPerSec })
  // 合并来袭强度 N×atk 与合并每击 perHitGroup 的比值 = 减伤折算（量纲与单敌人一致，取正值）
  const mitigFactor = perHitGroup > 0 ? (profile.atk * N) / perHitGroup : Infinity
  const dodgeMul = single.dodgeMul
  return {
    ...single,
    enemies: N,
    perHitGroup,
    hitsToDie: sim.hits,
    seconds: sim.seconds,
    sustained: sim.sustained,
    ehp: Number.isFinite(mitigFactor) ? pool * mitigFactor * dodgeMul : Infinity,
  }
}

/**
 * 集火档位表：对同一画像给出 1/2/3/5 个敌人同时集火的结果（供报告与前端图表用）。
 * @param {object} profile - 单个敌人的来袭画像
 * @param {object} defense - 同 survival()
 * @param {number[]} [counts]
 */
export function surviveGroupTiers(profile, defense = {}, counts = [1, 2, 3, 5]) {
  return counts.map((n) => ({ enemies: n, ...surviveGroup(profile, defense, n) }))
}
