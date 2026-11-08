// tools/model-coverage.mjs —— 建模覆盖度评估
//
// 回答一个问题：**这个 DPS 数字能不能当结论用？**
//
// 为什么需要它：引擎是"规则层"。天赋机制、元素通道、引导/召唤通道里有很多
// 规则层天生算不到的东西。以前这些缺口只体现在"数字偏小"，用户看不出来 ——
// 最坏的情况是 `noAttack` 技能直接把技能期 DPS 算成 0，而实际明明是几千。
//
// 设计约束（重要）：
//   本模块**只做判定与标注，绝不产生或修改任何数值**。
//   因此接入它不会让 anchors.mjs 的锚点漂移 —— 这一点每次改动都要守住。
//
// 严重度分级：
//   blocking —— 数字**可证明是错的**（例如技能期 DPS=0，但技能文本明确有伤害）
//   material —— 数字**系统性偏小**（例如天赋附带元素损伤，完全未计入）
//   note     —— 数字**可能偏小**（天赋里的机制键未被规则层消费；这是常态）

/** 天赋里"已由其数值折进面板"的键 —— 与 evaluate.mjs 的天赋合并口径保持一致。 */
const PANEL_FOLDED_TALENT_KEYS = new Set([
  'atk', 'attack_speed', 'def', 'max_hp', 'magic_resistance', 'block_cnt', 'cost',
  'sp_recovery_per_sec', 'attack@atk', 'attack@attack_speed', 'attack@def',
  // 面板字段，不是机制（否则会给几乎所有人加一条无意义的"未折算"噪声）
  'respawn_time', 'base_attack_time', 'position', 'mass',
  // 穿透类：由 extractTalentPenetrate 消费并合进 engine.penetrate（此前漏登记 →
  // 迷迭香「无视175防御」明明生效了却被报成"未折算"，是假阴性）
  'def_penetrate_fixed', 'def_penetrate', 'magic_resist_penetrate_fixed',
  // 元素累积：由 extractElement 消费
  'ep_damage_ratio', 'ep_damage_scale',
  // 概率倍率/追加段：由 extractTalentBonuses 的期望值折算消费
  'prob', 'prob_normal', 'prob_special', 'damage_scale',
])

/** 技能/天赋文本里表示"会造成伤害"的键。 */
const DAMAGE_SCALE_RE = /atk_scale|damage_scale|heatwave|proj_atk_scale|extra_atk_scale|magic_atk_scale/i

/** 元素类键（损伤系数 / 元素攻击倍率 / 元素抗性）。 */
const ELEMENT_RE = /^ep_|ep_damage|element_atk_scale|element_damage/i

export const SEVERITY_BLOCKING = 'blocking'
export const SEVERITY_MATERIAL = 'material'
export const SEVERITY_NOTE = 'note'

/**
 * 评估一名干员（一个技能）在当前规则层下的建模覆盖度。
 *
 * @param {object} args
 * @param {object} args.op     干员对象（已应用模组的那个，含 talents/skills）
 * @param {object} args.eng    引擎输入（含 skill.noAttack / trap / burst / summon / element）
 * @param {object} [args.lv]    该技能等级数据（含 blackboard）
 * @returns {{level:string, basis:string, gaps:Array, talentUnmodeled:string[], elementTalents:string[]}}
 */
export function assessModeling({ op, eng, lv }) {
  const gaps = []
  const skill = eng?.skill ?? {}
  const bb = lv?.blackboard ?? []

  // ── G1（blocking）技能期停止攻击，但伤害落在规则层没有的通道 ──────────────
  // 这是最坏的一类：引擎 return 0，用户看到"技能期 DPS 0.0"像是测量结果。
  const damageKeys = bb.filter((k) => DAMAGE_SCALE_RE.test(k.key)).map((k) => k.key)
  const hasChannel = !!(eng?.trap || eng?.burst || eng?.summon || eng?.element)
  if (skill.noAttack === true && damageKeys.length > 0 && !hasChannel) {
    gaps.push({
      code: 'skill-channel-unmodeled',
      severity: SEVERITY_BLOCKING,
      label: '技能期停止攻击，伤害在未建模通道',
      detail: `技能带伤害参数（${damageKeys.join(', ')}），但规则层没有对应通道 → 技能期 DPS 记为 0 不可用`,
    })
  }

  // ── G2（material）天赋附带元素损伤，完全没进 DPS ─────────────────────────
  const elementTalents = []
  for (const t of op?.talents ?? []) {
    const keys = (t.blackboard ?? []).map((k) => k.key).filter((k) => ELEMENT_RE.test(k))
    if (keys.length) elementTalents.push(`${t.name ?? '(无名天赋)'}: ${keys.join(',')}`)
  }
  if (elementTalents.length) {
    gaps.push({
      code: 'talent-element-unmodeled',
      severity: SEVERITY_MATERIAL,
      label: '天赋附带元素损伤，未计入 DPS',
      detail: elementTalents.join('；'),
    })
  }

  // ── G3（note）天赋含规则层不消费的机制键 —— 这是常态，不是异常 ────────────
  const unmodeledKeys = []
  for (const t of op?.talents ?? []) {
    for (const k of t.blackboard ?? []) {
      if (!PANEL_FOLDED_TALENT_KEYS.has(k.key) && !unmodeledKeys.includes(k.key)) unmodeledKeys.push(k.key)
    }
  }
  if (unmodeledKeys.length) {
    gaps.push({
      code: 'talent-mechanic-unmodeled',
      severity: SEVERITY_NOTE,
      label: '天赋含机制键，规则层未消费',
      detail: unmodeledKeys.slice(0, 8).join(', ') + (unmodeledKeys.length > 8 ? ` …（共 ${unmodeledKeys.length} 个）` : ''),
    })
  }

  const level = gaps.some((g) => g.severity === SEVERITY_BLOCKING)
    ? 'blocked'
    : gaps.some((g) => g.severity === SEVERITY_MATERIAL)
      ? 'partial'
      : 'full'

  return {
    level,                       // blocked | partial | full
    basis: 'rules-only',         // 一切数值都来自规则层
    skillDpsUsable: level !== 'blocked',
    gaps,
    talentUnmodeled: unmodeledKeys,
    elementTalents,
  }
}

/**
 * DPS 展示门禁。
 *
 * 判据（用户定调）：**DPS 只有在"从技能文本 + 天赋文本解析出参数 → 进入引擎计算"
 * 这条链路上才成立**。只吃面板与 blackboard 的规则层结果，天然把天赋机制和元素
 * 排除在外 —— 那不是"偏小的 DPS"，而是一个没有意义的数，不该出现在界面上。
 *
 * 因此 `verified` 只有在 LLM 解析产物已并入该干员的计算输入时才为 true。
 * 当前解析层尚未接通 → 恒为 false，全库不展示 DPS。
 */
export function dpsGate(m) {
  const verified = m?.verified === true
  return {
    verified,
    reason: verified
      ? null
      : '干员 DPS 需要天赋与元素一起参与计算；当前只有规则层（未接入文本解析），因此不给出 DPS 数值。',
  }
}

/**
 * 把判定渲染成报告行（紧跟 DPS 数字之前）。没有 modeling 时返回空数组。
 * @param {object} m
 * @param {{skipBlocking?:boolean, skipElement?:boolean}} [opts]
 *   skipBlocking  通道已建模（CHANNEL_OVERRIDES 命中）→ blocking 缺口已解决，不再报警
 *   skipElement   元素伤害已计入通道总伤 → 不再提示"元素未计入"
 */
export function describeModeling(m, opts = {}) {
  if (!m) return []
  const lines = []
  const blocking = opts.skipBlocking ? [] : m.gaps.filter((x) => x.severity === SEVERITY_BLOCKING)
  const material = m.gaps.filter((x) => x.severity === SEVERITY_MATERIAL && !(opts.skipElement && x.code === 'talent-element-unmodeled'))
  const notes = m.gaps.filter((x) => x.severity === SEVERITY_NOTE)

  // blocking 与 material 要**各自独立打印**：被 blocked 不代表"数值偏低"不存在，
  // 两个缺口是不同来源（通道缺失 vs 元素天赋），合并显示会让人以为只有一个问题。
  for (const g of blocking) {
    lines.push(`⛔ 技能期 DPS **不给出**：${g.label}`)
    if (g.detail) lines.push(`   ${g.detail}`)
    lines.push('   → 下方技能期数值显示为 —，平均值仅反映普攻部分；这不是"该技能没伤害"的意思')
  }
  for (const g of material) {
    lines.push(`⚠ 数值偏低：${g.label}`)
    if (g.detail) lines.push(`   ${g.detail}`)
  }
  if (notes.length) {
    lines.push(`ℹ 口径：规则层估算，天赋机制未折算（${notes[0].detail ?? '—'}）`)
  }
  return lines
}
