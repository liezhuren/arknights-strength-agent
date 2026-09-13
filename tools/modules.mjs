// tools/modules.mjs —— 模组启用层：解析启用哪个模组、应用数值到干员对象
// 设计原则：**构造修改后的干员对象**再交给既有提取器，而不是让各提取器各自理解模组 ——
//   复用天赋/减益/穿透/特性的全部既有解析逻辑，避免语义分叉。
// 语义（来自游戏数据，见 build-modules.mjs 注释）：
//   属性加成 = attributeBlackboard 的 L3 值（累积总值，勿累加）
//   天赋更新 = 替换语义（index>=0 覆盖基础天赋；index=-1 追加隐藏天赋）
//   特性更新 = 覆盖分支特性（含穿透等可自动解析项，其余作为文本交给 agent 判断）
import fs from 'node:fs'
import path from 'node:path'
import { branchState } from './branch-traits.mjs'

const DATA = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, '../data/modules.json'), 'utf8'),
)
const MODULES = DATA.modules

/** 属性键 → 中文名（报告用）。 */
const ATTR_LABEL = {
  max_hp: '生命上限',
  atk: '攻击力',
  def: '防御力',
  magic_resistance: '法术抗性',
  attack_speed: '攻击速度',
  cost: '部署费用',
  block_cnt: '阻挡数',
  base_attack_time: '攻击间隔',
}

/** blackboard 键 → 中文标签 + 值格式（百分比 / 点数），让模组效果可读。 */
const BB_META = {
  attack_speed: ['攻速', '+'],
  move_speed: ['移动速度', 'pct'],
  atk: ['攻击力', 'pct+'],
  max_hp: ['生命上限', 'pct+'],
  def: ['防御力', 'pct+'],
  magic_resistance: ['法术抗性', 'pct'],
  hp_recovery_per_sec_by_max_hp_ratio: ['每秒回血', 'pct'],
  hp_ratio: ['触发血线', 'pct'],
  sp_recovery_per_sec: ['每秒技力', '+'],
  force_base: ['拖拽力度', ''],
  force_in_skill: ['技能期拖拽力度', ''],
  max_target_plus_in_skill: ['技能期额外目标', ''],
  element_atk_scale: ['元素伤害倍率', 'pct'],
  atk_scale: ['伤害倍率', 'pct'],
  atk_scale_m: ['附加法术伤害比例', 'pct'],
  ep_damage_ratio: ['元素损伤比例', 'pct'],
  def_penetrate_fixed: ['无视防御', '+'],
  magic_resist_penetrate_fixed: ['无视法抗', '+'],
  def_penetrate: ['无视防御比例', 'pct'],
  max_stack_cnt: ['最大叠加层数', ''],
  duration: ['持续', 'sec'],
  interval: ['间隔', 'sec'],
  prob: ['概率', 'pct'],
  cnt: ['数量', ''],
  ep_break_multi: ['爆发期伤害倍率', 'x'],
  'damage[normal]': ['每秒伤害', ''],
  'damage[ranged]': ['每秒伤害(远程目标)', ''],
}

/** 干员可用模组列表（合并数据集元数据与数值数据）。 */
export function modulesOf(op) {
  const numeric = MODULES[op.id] ?? []
  if (numeric.length) return numeric
  // 数值表缺该干员时退回数据集元数据（保持可用性与可解释性）
  return (op.modules ?? []).map((m) => ({
    id: m.id,
    name: m.name,
    type: m.type,
    isSpecial: !!m.isSpecial,
    kind: null,
    hasCombatData: false,
    levels: [],
  }))
}

/**
 * 解析模组启用规格。
 * @param {object} op - 数据集干员
 * @param {string|number} [spec] - none(默认) | default | isw/特限 | X/Y/D | 模组名 | 模组 id | 下标
 * @returns {object|null} 模组条目（含 _level 字段）或 null
 */
export function resolveModule(op, spec) {
  if (spec === undefined || spec === null) return null
  const s = String(spec).trim()
  if (!s || /^(none|off|no|无|不启用|0模组)$/i.test(s)) return null
  const list = modulesOf(op)
  if (!list.length) throw new Error(`${op.name} 没有模组数据`)

  let hit = null
  if (/^(default|默认)$/i.test(s)) {
    hit = list.find((m) => m.hasCombatData && !m.isSpecial)
  } else if (/^(isw|特限|special|肉鸽|集成战略)$/i.test(s)) {
    hit = list.find((m) => m.isSpecial && m.hasCombatData)
  } else if (/^\d+$/.test(s)) {
    hit = list[Number(s)]
  } else {
    const up = s.toUpperCase()
    hit = list.find((m) => m.id === s)
      ?? list.find((m) => m.name === s)
      ?? list.find((m) => m.type?.toUpperCase() === up)
      ?? list.find((m) => m.type?.toUpperCase().endsWith(`-${up}`))
  }
  if (!hit) {
    const avail = list.map((m) => `${m.name}(${m.type}${m.isSpecial ? '·特限' : ''}${m.hasCombatData ? '' : '·无数值'})`).join(' / ')
    throw new Error(`${op.name} 未找到模组「${spec}」；可选：${avail}`)
  }
  return hit
}

/** 取模组某等级数据（默认最高级 = 满配）。 */
export function levelOf(entry, level) {
  if (!entry?.levels?.length) return null
  const want = level === undefined ? Math.max(...entry.levels.map((l) => l.level)) : Number(level)
  return entry.levels.find((l) => l.level === want) ?? entry.levels[entry.levels.length - 1]
}

/** 属性加成 → 中文描述。 */
export function formatAttr(attr) {
  return Object.entries(attr ?? {})
    .filter(([, v]) => v)
    .map(([k, v]) => `${ATTR_LABEL[k] ?? k}${v > 0 ? '+' : ''}${v}`)
    .join('，')
}

/**
 * 应用模组到干员对象。
 * @returns {{ op: object, entry: object, level: object|null, attr: object,
 *             talentNotes: string[], traitNotes: string[], traitBlackboard: object,
 *             warnings: string[] }}
 */
export function applyModule(op, entry, level) {
  const out = {
    op,
    entry,
    level: null,
    attr: {},
    talentNotes: [],
    traitNotes: [],
    traitBlackboard: {},
    warnings: [],
  }
  // ---- 基础分支特性（数据集 trait：文本 + 数值黑匣子）----
  // 2026 修正：特性文本来自 character_table 的**干员级 description**（此前漏读，导致 454 人特性全空）
  const baseTrait = op.trait ?? null
  const baseDesc = stripTags(baseTrait?.description) || null
  const baseBb = Object.fromEntries((baseTrait?.blackboard ?? []).map((b) => [b.key, b.value]))
  let effDesc = baseDesc
  let effBb = { ...baseBb }
  let effMode = 'base'
  const panel = { ...(op.panel ?? {}) }
  const talents = [...(op.talents ?? [])]
  out.baseTrait = baseTrait

  /** 收尾：把**有效特性**写回 op.trait，作为下游（生存/控制/穿透/减益）的单一数据源。 */
  const finish = () => {
    const modAspd = (out.attr.attack_speed ?? 0) + (out.level?.talents ?? []).reduce(
      (s, t) => s + (typeof t.blackboard?.attack_speed === 'number' ? t.blackboard.attack_speed : 0), 0,
    )
    const hasTrait = effDesc || Object.keys(effBb).length
    out.traitBlackboard = effBb
    out.op = {
      ...op,
      panel,
      talents,
      trait: hasTrait
        ? {
            name: baseTrait?.name ?? null,
            description: effDesc,
            blackboard: Object.entries(effBb).map(([key, value]) => ({ key, value })),
            _mode: effMode,
          }
        : baseTrait,
    }
    out.op._moduleAspd = modAspd
    out.op._moduleTrait = hasTrait ? { desc: effDesc, blackboard: effBb, mode: effMode } : null
    out.op._moduleName = entry ? `${entry.name}(${entry.type})` : null
    return out
  }

  // 基础特性里的**条件型自身加成**（如解放者"技能未开启时攻击力逐渐提升至+200%"、
  // 阵法术师"通常时防御力与法抗大幅提升"）不能用单一面板表达 → 只标注，不硬套
  // 例外：**状态型分支**（阵法术师/解放者）已由 tools/branch-traits.mjs 按"常态/技能期"两态建模，
  //       不再重复告警（否则等于告诉用户"没算"，其实生存栏已经分两态算了）
  const baseSelf = selfBuffEntries(baseBb)
  const rule = branchState(op)
  if (baseSelf.length && !rule) {
    out.warnings.push(`基础特性含**条件型自身加成**（${baseSelf.join('、')}）—— 按"技能开/关"两种状态生效，未计入面板；评价常态/技能期差异时需手工考虑`)
  }
  // 基础特性里的**攻击力倍率变化**（如领主"可以进行远程攻击，但此时攻击力降低至80%" → atk_scale 0.8）
  // 依赖站位/距离，不进默认 DPS，但必须让用户知道
  if (typeof baseBb.atk_scale === 'number' && baseBb.atk_scale !== 1) {
    const pct = Math.round(baseBb.atk_scale * 100)
    out.warnings.push(`基础特性含**条件型攻击力倍率**（${pct}%）未计入 DPS —— ${baseDesc ?? ''}（按站位/距离生效，需按实战判断）`)
  }
  // 生存相关的基础特性（不能被治疗等）
  if (/无法被友方|不能被友方|无法被治疗/.test(baseDesc ?? '')) {
    out.warnings.push('基础特性：**无法被友方角色治疗** → 生存只能靠自身血量/自回/闪避，医疗支援对其无效')
  }

  if (!entry) return finish()
  if (!entry.hasCombatData) {
    out.warnings.push(`${entry.name}（${entry.type}）为干员证章，游戏数据中无战斗数值 → 启用后不影响计算`)
    return finish()
  }
  const lv = levelOf(entry, level)
  if (!lv) return finish()
  out.level = lv
  out.attr = lv.attr ?? {}
  if (entry.scopeTags?.includes('roguelike')) {
    out.warnings.push('特限模组增益**仅在集成战略生效**，常规关卡按 0 增益理解')
  }

  // ---- 属性加成（叠加到基础面板，百分比天赋在此之后相乘）----
  for (const [k, v] of Object.entries(out.attr)) {
    if (k === 'attack_speed') continue // 攻速走 talent.aspd 通道
    if (typeof panel[k] === 'number') panel[k] = panel[k] + v
    else panel[k] = v
  }

  // ---- 天赋更新（替换语义）----
  for (const t of lv.talents ?? []) {
    // 模组候选常只有数值而无 upgradeDescription → 合成可读描述，避免报告出现空行
    const text = t.desc || `模组效果：${formatBb(t.blackboard)}`
    const asTalent = {
      name: t.name ?? null,
      description: text,
      blackboard: Object.entries(t.blackboard ?? {}).map(([key, value]) => ({ key, value })),
      _fromModule: { index: t.index, tags: t.tags ?? [], hide: t.isHide },
    }
    // index 落在基础天赋范围内 = 替换该天赋；index<0 或超出基础天赋数 = 模组新增天赋。
    // 例外：isHideTalent 的隐藏天赋（prefabKey 10/11 等）是**追加的隐藏效果**，即便带 talentIndex
    // 也不可当作替换 —— 否则会误删该槽位的本体天赋（如深蓝之籽的 hp_ratio 会顶掉「创伤性癔症」）。
    const isReplace = typeof t.index === 'number' && t.index >= 0
      && t.index < talents.length && !t.isHide
    if (isReplace) {
      talents[t.index] = asTalent
      out.talentNotes.push(`天赋${t.index + 1} → ${text}`)
    } else {
      talents.push(asTalent)
      const scope = (t.tags ?? []).includes('roguelike') ? '（仅集成战略）' : ''
      const slot = t.isHide
        ? '新增隐藏效果'
        : typeof t.index === 'number' && t.index >= 0 ? `新增天赋槽${t.index + 1}` : '新增天赋效果'
      out.talentNotes.push(`${slot}${scope} → ${text}`)
    }
  }

  // ---- 特性更新：区分「覆盖」与「追加」----
  // overrideDescripton = 覆盖基础特性（如深蓝之籽把 50% 闪避改成 65%）
  // additionalDescription = 追加到基础特性之上（如水月 X 的减速光环、星熊 X 的阻挡时防御+20%）
  const trait = lv.trait
  if (trait) {
    const modBb = { ...(trait.blackboard ?? {}) }
    // 部分特性的黑匣子是空的，减速等效果只写在描述里（如"攻击范围内所有敌人移动速度-20%"）
    // → 通用描述解析：把可量化的表述补回黑匣子，供控制栏等下游使用
    if (typeof modBb.move_speed !== 'number' && trait.desc) {
      const m = trait.desc.match(/移动速度\s*-?\s*(\d+(?:\.\d+)?)\s*%/)
      if (m) modBb.move_speed = -Number(m[1]) / 100
    }
    const isOverride = trait.mode === 'override'
    if (isOverride) {
      effDesc = trait.desc ?? baseDesc
      effBb = { ...modBb }
      effMode = 'override'
    } else {
      effDesc = [baseDesc, trait.desc].filter(Boolean).join('；') || null
      effBb = { ...baseBb, ...modBb }
      effMode = 'add'
    }
    out.traitNotes.push(`${isOverride ? '覆盖' : '追加'}：${trait.desc ?? formatBb(modBb)}`)

    // 自身属性加成：**相对基础特性的净增量**（追加型叠加；覆盖型以模组值为准）
    const modSelf = selfBuffEntries(modBb)
    if (modSelf.length) {
      const cond = /阻挡/.test(trait.desc ?? '')
      // 阻挡类是站场常态（盾位就是用来挡的）→ 计入并标注假设；对空/距离/范围类依赖敌人与站位 → 只标注
      const blockingNormal = cond && !/对空|空中|距离|范围内存在/.test(trait.desc ?? '')
      if (blockingNormal || !isConditional(trait.desc ?? '')) {
        for (const [k, v] of Object.entries(modBb)) {
          if (!(k in SELF_KEY) || typeof v !== 'number' || v <= 0) continue
          applySelfToPanel(panel, k, v)
        }
        out.warnings.push(`特性加成的自身属性（${modSelf.join('、')}）已计入面板${blockingNormal ? '（**按持续阻挡假设**）' : ''}`)
      } else {
        out.warnings.push(`特性更新的自身属性加成（${modSelf.join('、')}）**未计入面板** —— 该加成依赖条件（${(trait.desc ?? '').slice(0, 24)}…），请按场景判断`)
      }
    }
    if (!Object.keys(modBb).some((k) => /penetrate/.test(k)) && isConditional(trait.desc ?? '')) {
      out.warnings.push('特性更新含条件/情景语义，未自动折算进 DPS（见特性栏，需按场景判断）')
    }
  }
  return finish()
}

/** 自身属性加成键 → 中文名。 */
const SELF_KEY = { atk: '攻击力', def: '防御力', max_hp: '生命上限', magic_resistance: '法术抗性', damage_resistance: '伤害减免' }
/** 这些键在特性里恒为**小数比例**（2 = +200%，如解放者/阵法术师）；其余按键值大小判断。 */
const FRACTION_KEYS = new Set(['atk', 'def', 'max_hp'])

/** 把特性加成值格式化为可读文本。 */
function fmtSelf(k, v) {
  if (FRACTION_KEYS.has(k)) return `+${Math.round(v * 100)}%`
  return Math.abs(v) <= 1 ? `+${Math.round(v * 100)}%` : `+${v}`
}

/** 把一条自身属性加成写进面板（比例键乘算，点数键加算）。 */
function applySelfToPanel(panel, k, v) {
  if (k === 'damage_resistance') return // 伤害减免走生存栏，不进面板
  if (FRACTION_KEYS.has(k)) {
    panel[k] = (panel[k] ?? 0) * (1 + v)
  } else if (k === 'magic_resistance') {
    panel.magicResistance = v <= 1 ? (panel.magicResistance ?? 0) * (1 + v) : (panel.magicResistance ?? 0) + v
  }
}

/** 从 blackboard 里挑出"自身属性加成"条目（正值）。 */
function selfBuffEntries(bb) {
  return Object.entries(bb ?? {})
    .filter(([k, v]) => SELF_KEY[k] && typeof v === 'number' && v > 0)
    .map(([k, v]) => `${SELF_KEY[k]}${fmtSelf(k, v)}`)
}

/** 特性描述是否含条件/情景语义。 */
function isConditional(desc) {
  return /对空|空中|距离|闪避|隐匿|阻挡|范围内|处于|每|若|当|速度|拖拽|未开启|开启时|通常/.test(desc)
}

const stripTags = (s) => (s ?? '').replace(/<[^>]+>/g, '')

/** blackboard → 可读中文（带单位与百分比换算），避免报告出现 move_speed=-0.2 这类裸键值。 */
export function formatBb(bb) {
  const parts = Object.entries(bb ?? {}).map(([k, v]) => {
    const [label, fmt] = BB_META[k] ?? [k, '']
    if (typeof v !== 'number') return `${label}=${v}`
    if (fmt === 'pct') return `${label}${v > 0 ? '+' : ''}${Math.round(v * 100)}%`
    if (fmt === 'pct+') return `${label}${v > 0 ? '+' : ''}${Math.round(v * 100)}%`
    if (fmt === 'x') return `${label}×${v}`
    if (fmt === 'sec') return `${label}${v}s`
    if (fmt === '+') return `${label}${v > 0 ? '+' : ''}${v}`
    return `${label}${v}`
  })
  return parts.join('，') || '（无数值）'
}

/**
 * 从天赋层提取破甲穿透（如能天使模组"逐渐无视防御"、史尔特尔"无视22法抗"）。
 * 通用能力：任何天赋出现 def_penetrate_fixed / magic_resist_penetrate_fixed / def_penetrate 都会被识别。
 *
 * 关键区分（否则会高估输出）：
 *   - 无条件型（"攻击无视目标175防御"）→ 计入 DPS
 *   - 叠层型（"连续攻击时逐渐无视…最高50%"）→ 按叠满值计入并标注
 *   - 条件型（"对沉睡敌人" / "击倒敌人后" / "攻击重量≥3" / "50%概率"）→ **不计入**，只在报告标注，
 *     由 agent 结合场景判断（例如配沉睡队时早露/埃拉托的穿透才生效）
 */
export function extractTalentPenetrate(op) {
  const CONDITIONAL = /概率|击倒|沉睡|重量|阻挡|战栗|同名|空中|若|当|被/
  const RAMP = /逐渐|连续|最多/
  const out = { defFixed: 0, defPct: 0, resFixed: 0, ramped: [], conditional: [] }
  const label = (k, v) => (k === 'defFixed' ? `无视防御${v}` : k === 'defPct' ? `无视${Math.round(v * 100)}%防御` : `无视法抗${v}`)
  for (const t of op.talents ?? []) {
    const bb = Object.fromEntries((t.blackboard ?? []).map((b) => [b.key, b.value]))
    const desc = stripTags(t.description)
    const stack = bb.max_stack_cnt ?? 1
    const items = []
    if (typeof bb.def_penetrate_fixed === 'number') items.push(['defFixed', bb.def_penetrate_fixed * stack])
    if (typeof bb.def_penetrate === 'number') items.push(['defPct', bb.def_penetrate * stack])
    if (typeof bb.magic_resist_penetrate_fixed === 'number') items.push(['resFixed', bb.magic_resist_penetrate_fixed * stack])
    if (!items.length) continue
    if (CONDITIONAL.test(desc)) {
      out.conditional.push({ desc, items: items.map(([k, v]) => label(k, v)).join('，') })
      continue
    }
    for (const [k, v] of items) out[k] += v
    if (RAMP.test(desc) || stack > 1) {
      out.ramped.push(`${items.map(([k, v]) => `${label(k, v)}（叠满值）`).join('，')} —— ${desc.slice(0, 40)}`)
    }
  }
  const total = out.defFixed + out.defPct + out.resFixed
  if (!total && !out.conditional.length && !out.ramped.length) return null
  return out
}

export const MODULE_DATA = { builtAt: DATA.builtAt, stats: DATA.stats, source: DATA.source }
