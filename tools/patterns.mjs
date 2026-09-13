// tools/patterns.mjs —— 通用描述模式库（第一层解析：表述 → 引擎参数）
// 设计目标：读懂技能描述中的通用机制表述，自动转成引擎参数，而不是为每个干员手工打补丁。
// 覆盖策略：数据驱动（按描述表述的真实出现频率建设），高频模式优先。
// 长尾复杂机制（联动/条件触发/操作循环）仍走第二层 LLM 解析（overrides.mjs 补丁）。
//
// 每项模式：{ id, test(desc), extract(match, ctx) → mods, note }
// mods 字段（供 evaluate.mjs 消费）：
//   extraTargets    额外攻击目标数（叠加到技能目标数）
//   targetCount     描述型同时攻击目标数（bb 无对应 key 时使用）
//   hits            描述型连击段数（bb 无对应 key 时使用）
//   charges         技能可充能次数（影响强化攻击频率）
//   skillNoAttack   技能期间停止攻击（技能期普攻不计）
//   charged         蓄力型（取强化数值）
//   antiAir         可对空

const strip = (s) => (s ?? '').replace(/<[^>]+>/g, '')

/** 模式表（按优先级顺序匹配，全部命中都会记录）。 */
export const DESC_PATTERNS = [
  {
    id: 'extra-targets',
    // "第一天赋额外攻击2个目标" / "额外攻击1个目标"
    re: /额外攻击(\d+)个?(?:目标|敌人)/,
    mods: (m) => ({ extraTargets: Number(m[1]) }),
    note: (m) => `额外攻击 ${m[1]} 个目标 → 技能期目标数 +${m[1]}`,
  },
  {
    id: 'multi-target-desc',
    // "同时攻击3个敌方单位"（仅在 bb 无 attack@max_target 时采用）
    re: /同时攻击(\d+)个?(?:敌方单位|目标|敌人)/,
    mods: (m, ctx) => ({ targetCount: Number(m[1]), _onlyIfNoKey: 'attack@max_target' }),
    note: (m) => `同时攻击 ${m[1]} 个目标 → 目标数 ${m[1]}`,
  },
  {
    id: 'combo-desc',
    // "5连射"（仅在 bb 无 attack@times 时采用）
    re: /(\d+)连(?:击|射)/,
    mods: (m, ctx) => ({ hits: Number(m[1]), _onlyIfNoKey: 'attack@times' }),
    note: (m) => `${m[1]} 连击 → 段数 ${m[1]}`,
  },
  {
    id: 'charges',
    // "可充能3次"（充能型技能可连续触发多次）
    re: /可充能(\d+)次/,
    mods: (m) => ({ charges: Number(m[1]) }),
    note: (m) => `可充能 ${m[1]} 次 → 强化攻击可连续触发（周期 ÷${m[1]}）`,
  },
  {
    id: 'stop-attack',
    // "停止攻击"（技能期不进行普攻：纯增益/陷阱/召唤型）
    re: /停止攻击/,
    mods: () => ({ skillNoAttack: true }),
    note: () => '技能期间停止攻击 → 技能期普攻不计入',
  },
  {
    id: 'charged',
    re: /蓄力/,
    mods: () => ({ charged: true }),
    note: () => '蓄力机制（长按取强化数值）→ 默认按普通形态，强化数值待解析',
  },
  {
    id: 'anti-air',
    re: /对空|空中单位/,
    mods: () => ({ antiAir: true }),
    note: () => '可对空',
  },
  {
    id: 'slow-desc',
    // "使其移动速度降低50%"（软控，进控制栏）
    re: /移动速度(?:降低|-)/,
    mods: () => ({ slow: true }),
    note: () => '移动速度降低（软控，计入控制栏）',
  },
]

/**
 * 分析一条技能描述，返回通用机制发现与引擎参数修改。
 * @param {object} lv - 技能专三 levelData
 * @param {object} [opts]
 * @param {Set<string>} [opts.knownKeys] - blackboard 已有的 key（用于 _onlyIfNoKey 判断）
 * @returns {{ mods: object, discoveries: string[] }}
 */
export function analyzeDescription(lv, { knownKeys = new Set() } = {}) {
  const desc = strip(lv?.description)
  const mods = {}
  const discoveries = []
  for (const p of DESC_PATTERNS) {
    const m = p.re.exec(desc)
    if (!m) continue
    if (p.mods) {
      const add = p.mods(m) ?? {}
      if (add._onlyIfNoKey && knownKeys.has(add._onlyIfNoKey)) continue // bb 已有更精确的值，跳过
      delete add._onlyIfNoKey
      Object.assign(mods, add)
    }
    discoveries.push(p.note ? p.note(m) : p.id)
  }
  return { mods, discoveries }
}
