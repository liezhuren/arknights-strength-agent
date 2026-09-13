// tools/survival.mjs —— ④ 生存栏：承伤 / 自回 / 闪避 / 减伤 / 屏障 / 抵抗 / 免疫 / 团队生存
// 标准见 docs/eval-standards.md §4。设计原则：
//   1. 与 ①②③ 并列，**不与输出栏合并**（生存是独立维度）
//   2. 来袭画像来自真实敌人统计（data/threat-scenarios.json）
//   3. 常态与技能期分开报（防御型干员的生存大多来自技能）
//   4. 闪避按**期望值**折算并标注方差；多敌人集火按线性放大并标注假设
import fs from 'node:fs'
import path from 'node:path'
import { survival, incomingHit, fmt } from '../engine/survival.mjs'
import { branchState } from './branch-traits.mjs'

const THREAT = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, '../data/threat-scenarios.json'), 'utf8'),
)
export const THREAT_PROFILES = THREAT.profiles
export const THREAT_DIST = THREAT.distribution

const strip = (s) => (s ?? '').replace(/<[^>]+>/g, '')
const bbOf = (x) => Object.fromEntries((x?.blackboard ?? []).map((b) => [b.key, b.value]))

/** 抗性/免疫（面板字段 → 中文）。 */
const IMMUNE_LABEL = {
  stunImmune: '眩晕', silenceImmune: '沉默', sleepImmune: '睡眠', frozenImmune: '冻结',
  levitateImmune: '浮空', disarmedCombatImmune: '缴械', fearedImmune: '恐惧', palsyImmune: '麻痹',
  attractImmune: '吸引', teleportImmune: '传送', groundBoundImmune: '束缚',
}

/** 数值归一：|v| ≤ 1 视为小数百分比，> 1 视为绝对点数（与输出侧减益同一约定）。 */
const norm = (v) => (Math.abs(v) <= 1 ? { pct: v, flat: 0 } : { pct: 0, flat: v })

/**
 * 从一个 blackboard 集合提取"自身生存类"效果。
 * @param {object} bb
 * @param {string} desc
 */
function survivalFromBb(bb, desc) {
  const d = strip(desc)
  const out = { defPct: 0, defFlat: 0, resPct: 0, resFlat: 0, hpPct: 0, drPct: 0, drFlat: 0, healPctMax: 0, healFlat: 0, shieldPctMax: 0, dodgeP: 0, dodgeM: 0, blockCnt: null, taunt: null, resist: 0, undying: null, healAlly: null, notes: [] }
  const toEnemy = /敌人|敌军|目标|使其/.test(d) && !/自身|自己/.test(d)

  if (typeof bb.def === 'number') {
    // 正向 def 恒为**小数比例**（2 = +200%，如阵法术师"通常时防御力大幅提升"）—— 不能按键值大小判断
    if (bb.def > 0) { out.defPct += bb.def; out.notes.push(`防御+${Math.round(bb.def * 100)}%`) }
    else if (!toEnemy) { const n = norm(bb.def); out.defPct += n.pct; out.defFlat += n.flat; out.notes.push(`防御${Math.round(n.pct * 100)}%`) }
  }
  if (typeof bb.magic_resistance === 'number') {
    if (bb.magic_resistance > 0) {
      const n = norm(bb.magic_resistance)
      out.resPct += n.pct; out.resFlat += n.flat
      out.notes.push(`法抗+${n.pct ? Math.round(n.pct * 100) + '%' : n.flat}`)
    } else if (!toEnemy) {
      const n = norm(bb.magic_resistance); out.resPct += n.pct; out.resFlat += n.flat
    }
  }
  if (typeof bb.max_hp === 'number' && bb.max_hp > 0) {
    out.hpPct += bb.max_hp // 同样恒为小数比例
    out.notes.push(`生命+${Math.round(bb.max_hp * 100)}%`)
  }
  // 伤害减免：点数或百分比
  if (typeof bb.damage_resistance === 'number') {
    const v = Math.abs(bb.damage_resistance)
    if (v <= 1) { out.drPct += v; out.notes.push(`减伤${Math.round(v * 100)}%`) }
    else { out.drFlat += v; out.notes.push(`减伤${v}点/击`) }
  }
  // 自回
  if (typeof bb.hp_recovery_per_sec_by_max_hp_ratio === 'number') {
    out.healPctMax += Math.abs(bb.hp_recovery_per_sec_by_max_hp_ratio)
    out.notes.push(`每秒回复${(Math.abs(bb.hp_recovery_per_sec_by_max_hp_ratio) * 100).toFixed(1)}%最大生命`)
  }
  if (typeof bb.hp_recovery_per_sec === 'number') {
    out.healFlat += Math.abs(bb.hp_recovery_per_sec)
    out.notes.push(`每秒回复${Math.abs(bb.hp_recovery_per_sec)}点`)
  }
  // 屏障：超出生命上限的部分转化为屏障
  if (typeof bb.max_hp_ratio === 'number' && /屏障/.test(d)) {
    out.shieldPctMax += Math.max(bb.max_hp_ratio - 1, 0)
    out.notes.push(`屏障上限${Math.round(bb.max_hp_ratio * 100)}%最大生命`)
  }
  // 闪避（prob 是通用概率键，必须靠描述区分）
  if (typeof bb.prob === 'number' && /闪避|躲避/.test(d)) {
    const bothPhys = /物理和法术闪避|物法闪避/.test(d)
    const bothMag = bothPhys
    if (bothMag) { out.dodgeP += bb.prob; out.dodgeM += bb.prob }
    else if (/法术闪避/.test(d)) out.dodgeM += bb.prob
    else if (/物理闪避/.test(d)) out.dodgeP += bb.prob
    else { out.dodgeP += bb.prob / 2; out.dodgeM += bb.prob / 2 } // 未指明类型 → 双闪，各按一半保守折算
    const label = bothMag ? '物法' : /法术闪避/.test(d) ? '法术' : /物理闪避/.test(d) ? '物理' : '物法(未指明)'
    out.notes.push(`${label}闪避${Math.round(bb.prob * 100)}%`)
  }
  if (typeof bb.block_cnt === 'number') { out.blockCnt = bb.block_cnt; out.notes.push(`阻挡${bb.block_cnt >= 0 ? '+' : ''}${bb.block_cnt}`) }
  if (typeof bb.taunt_level === 'number') { out.taunt = bb.taunt_level; out.notes.push(`仇恨${bb.taunt_level > 0 ? '+' : ''}${bb.taunt_level}`) }
  // 抵抗 = 异常状态时间减半
  if (typeof bb.one_minus_status_resistance === 'number' && bb.one_minus_status_resistance !== 0) {
    const v = Math.abs(bb.one_minus_status_resistance)
    out.resist = Math.max(out.resist, v <= 1 ? v : v / 100)
    out.notes.push('抵抗（异常状态时长减半）')
  }
  // 保命：不死/坚忍/复活
  if (typeof bb.min_hp_ratio === 'number' && /坚忍|不低于|不会死亡|致命/.test(d)) {
    out.undying = bb.min_hp_ratio
    out.notes.push(`保命：${strip(d).slice(0, 40)}`)
  }
  if (/受到致命伤害时|不会死亡|生命值不低于/.test(d) && out.undying === null) {
    out.undying = 0
    out.notes.push(`保命：${strip(d).slice(0, 40)}`)
  }
  // 团队生存：给友方治疗/护盾
  if (/友方|我方|周围|队友/.test(d) && /治疗|恢复|护盾|屏障/.test(d)) {
    out.healAlly = strip(d).slice(0, 48)
  }
  return out
}

/** 合并多个效果的生存画像。 */
function mergeEffects(list) {
  const acc = { defPct: 0, defFlat: 0, resPct: 0, resFlat: 0, hpPct: 0, drPct: 0, drFlat: 0, healPctMax: 0, healFlat: 0, shieldPctMax: 0, dodgeP: 0, dodgeM: 0, blockCnt: null, taunt: null, resist: 0, undying: null, healAlly: null, notes: [] }
  for (const e of list) {
    if (!e) continue
    for (const k of ['defPct', 'defFlat', 'resPct', 'resFlat', 'hpPct', 'drPct', 'drFlat', 'healPctMax', 'healFlat', 'shieldPctMax', 'dodgeP', 'dodgeM']) acc[k] += e[k] ?? 0
    if (e.blockCnt !== null) acc.blockCnt = e.blockCnt
    if (e.taunt !== null) acc.taunt = e.taunt
    acc.resist = Math.max(acc.resist, e.resist ?? 0)
    if (e.undying !== null) acc.undying = e.undying
    if (e.healAlly) acc.healAlly = e.healAlly
    acc.notes.push(...(e.notes ?? []))
  }
  return acc
}

/**
 * 对队友的治疗/护盾输出（④ 的团队生存子项）。
 * 规则（读描述 + 职业，避免个例补丁）：
 *   - 医疗职业：常态治疗 = 有效攻击力 / 攻击间隔（医疗的攻击即治疗，基准量=攻击力）
 *   - `attack@heal_scale` / `heal_scale` 且描述含"每秒" → 持续型 HPS = 攻击力 × 系数（如塞雷娅钙质化 AoE）
 *   - 描述含"最大生命" → 按爆发治疗（%最大生命）标注，不折算 HPS
 * 估值口径：不含技能倍率叠加顺序的细节，标注为估算。
 */
export function extractAllyHeal(op, skillIndex = 2, talentAtkPct = 0, talentAspd = 0) {
  const panel = op.panel ?? {}
  const lv = op.skills?.[skillIndex]?.levels?.[9]
  const bb = bbOf(lv)
  const desc = strip(lv?.description)
  const isMedic = op.profession === 'MEDIC'
  const interval = (panel.baseAttackTime ?? 1.5) / (1 + (talentAspd + (op._moduleAspd ?? 0)) / 100)
  const baseAtk = (panel.atk ?? 0) * (1 + talentAtkPct)
  const skillAtk = baseAtk * (1 + (typeof bb.atk === 'number' && bb.atk > 0 ? bb.atk : 0))
  const out = { isMedic, normalHps: null, skillHps: null, notes: [], toAllies: false }
  if (isMedic) {
    out.normalHps = baseAtk / interval
    out.toAllies = true
    out.notes.push(`常态单体治疗 ${out.normalHps.toFixed(1)} HPS（=攻击力/间隔，未含技能）`)
  }
  const ratioKey = bb['attack@heal_scale'] ?? bb.heal_scale
  if (typeof ratioKey === 'number' && /回复|治疗|恢复/.test(desc) && /友方|友军|我方|周围|附近|队友/.test(desc)) {
    out.toAllies = true
    if (/最大生命/.test(desc)) {
      out.notes.push(`技能爆发治疗：恢复 ${Math.round(ratioKey * 100)}% 最大生命（单次，非持续）`)
    } else if (/每秒/.test(desc)) {
      out.skillHps = skillAtk * ratioKey
      out.notes.push(`技能持续治疗 ${out.skillHps.toFixed(1)} HPS（范围 AoE，=攻击力×${Math.round(ratioKey * 100)}%）`)
    } else {
      out.skillHps = skillAtk * ratioKey / interval
      out.notes.push(`技能期治疗 ${out.skillHps.toFixed(1)} HPS（攻击力×${Math.round(ratioKey * 100)}%/间隔）`)
    }
  } else if (isMedic && typeof bb.atk === 'number' && bb.atk > 0) {
    out.skillHps = skillAtk / interval
    out.notes.push(`技能期治疗 ${out.skillHps.toFixed(1)} HPS（攻击力+${Math.round(bb.atk * 100)}%）`)
  }
  return out
}

/**
 * 提取干员生存画像（常态 / 技能期）。
 * @param {object} op - 干员（可为模组修改后的对象）
 * @param {number} skillIndex
 * @param {{atkPct?:number, aspd?:number}} [talentBonus] - 由调用方传入的天赋面板加成（避免循环依赖）
 */
export function extractSurvival(op, skillIndex = 2, talentBonus = { atkPct: 0, aspd: 0 }) {
  const panel = op.panel ?? {}
  const lv = op.skills?.[skillIndex]?.levels?.[9]
  const talentEff = mergeEffects((op.talents ?? []).map((t) => survivalFromBb(bbOf(t), t.description)))
  const skillEff = lv ? survivalFromBb(bbOf(lv), lv.description) : null
  // 分支特性（**有效特性**：基础特性，或模组覆盖/追加后的结果）
  // 关键：基础特性里就有生存数据 —— 水月本体是 50% 物法闪避（此前漏读导致无模组配置被低估）
  const traitEff = op.trait?.description ? survivalFromBb(bbOf(op.trait), op.trait.description) : null
  // 状态型分支（阵法术师/解放者）：特性加成归属"常态"还是"技能期"由分支规则决定
  const rule = branchState(op)
  const traitBb = bbOf(op.trait)
  const base = mergeEffects([talentEff, rule?.idleTraitSelf ? traitEff : null])

  const panelOf = (e) => {
    const maxHp = (panel.maxHp ?? 0) * (1 + e.hpPct)
    const def = ((panel.def ?? 0) + e.defFlat) * (1 + e.defPct)
    const res = ((panel.magicResistance ?? 0) + e.resFlat) * (1 + e.resPct)
    return {
      maxHp,
      def,
      res,
      blockCnt: e.blockCnt ?? panel.blockCnt ?? 0,
      shield: maxHp * e.shieldPctMax,
      drFlat: e.drFlat,
      drPct: e.drPct,
      dodge: { physical: e.dodgeP, magical: e.dodgeM },
      healPerSec: maxHp * e.healPctMax + e.healFlat,
    }
  }
  // 状态型分支：技能期是否保留特性加成（阵法术师不保留 —— 这是它的代价）
  const activeBase = mergeEffects([talentEff, rule?.activeTraitSelf ? traitEff : null])
  const withSkill = mergeEffects([activeBase, skillEff])
  const normalPanel = panelOf(base)
  if (rule?.blockZeroIdle) normalPanel.blockCnt = 0 // 解放者常态阻挡 0

  return {
    name: op.name,
    rule,
    normal: { eff: base, panel: normalPanel },
    skill: {
      eff: withSkill,
      panel: panelOf(withSkill),
      // 状态型分支的"技能期"必然与常态不同（加成消失/生效） → 强制出双态
      active: (!!lv && hasSurvivalDelta(skillEff)) || !!rule,
    },
    stateNote: rule
      ? `${rule.label}分支特性状态：${rule.note}${rule.noAttackIdle ? '（常态不攻击）' : ''}`
      : null,
    immune: Object.entries(IMMUNE_LABEL).filter(([k]) => panel[k]).map(([, v]) => v),
    resist: withSkill.resist,
    taunt: withSkill.taunt ?? panel.tauntLevel ?? 0,
    undying: withSkill.undying,
    healAlly: withSkill.healAlly,
    allyHeal: extractAllyHeal(op, skillIndex, talentBonus.atkPct ?? 0, talentBonus.aspd ?? 0),
    notes: talentEff.notes,
    skillNotes: skillEff?.notes ?? [],
  }
}

function hasSurvivalDelta(e) {
  if (!e) return false
  return ['defPct', 'defFlat', 'resPct', 'resFlat', 'hpPct', 'drPct', 'drFlat', 'healPctMax', 'healFlat', 'shieldPctMax', 'dodgeP', 'dodgeM'].some((k) => (e[k] ?? 0) !== 0)
}

/** 对全部来袭画像做生存计算。 */
function runProfiles(p) {
  return THREAT_PROFILES.map((t) => ({
    threat: t,
    ...survival(t, {
      maxHp: p.maxHp, def: p.def, res: p.res,
      drFlat: p.drFlat, drPct: p.drPct, shield: p.shield,
      dodge: p.dodge, healPerSec: p.healPerSec,
    }),
  }))
}

/** 渲染 ④ 生存栏。 */
export function formatSurvivalSection(op, skillIndex = 2, talentBonus = { atkPct: 0, aspd: 0 }) {
  const s = extractSurvival(op, skillIndex, talentBonus)
  const n = s.normal.panel
  const lines = ['【④ 生存栏】（承伤/自回/闪避，独立于输出栏；来袭画像取自真实敌人统计）']
  if (s.stateNote) lines.push(`  ⚑ ${s.stateNote}`)
  const tauntText = s.taunt ? ` · 仇恨${s.taunt > 0 ? '+' : ''}${s.taunt}` : ''
  lines.push(`  ${s.rule ? '常态' : ''}面板：生命 ${Math.round(n.maxHp)} · 防御 ${Math.round(n.def)} · 法抗 ${Math.round(n.res)} · 阻挡 ${n.blockCnt}${tauntText}`)

  const killed = runProfiles(n)
  lines.push(`  硬扛（无治疗，单敌人${s.rule?.noAttackIdle ? '；常态不攻击' : ''}）：`)
  for (const k of killed) {
    const t = k.threat
    const sec = k.sustained ? '站得住' : `${fmt(k.seconds)}s`
    lines.push(`    ${t.id.padEnd(11)}${String(t.dps).padStart(6)}DPS → 每击 ${String(k.perHit).padStart(4)} · 可挨 ${k.hitsToDie ?? '∞'} 击 · ${sec}`)
  }
  if (s.skill.active) {
    const sk = runProfiles(s.skill.panel)
    const sp = s.skill.panel
    lines.push(`  ${s.rule ? '技能期' : '技能期'}（生命 ${Math.round(sp.maxHp)} · 防御 ${Math.round(sp.def)} · 法抗 ${Math.round(sp.res)}）：`)
    for (const k of sk) {
      const t = k.threat
      const sec = k.sustained ? '站得住' : `${fmt(k.seconds)}s`
      const base = killed.find((x) => x.threat.id === t.id)
      const delta = base && base.seconds && k.seconds ? `（×${(k.seconds / base.seconds).toFixed(2)}）` : ''
      lines.push(`    ${t.id.padEnd(11)}每击 ${String(k.perHit).padStart(4)} · 可挨 ${k.hitsToDie ?? '∞'} 击 · ${sec}${delta}`)
    }
    if (s.rule) {
      lines.push('      ↑ 常态与技能期的反差即该分支"以生存换输出"的代价 —— 技能期能否站住决定它能否打出输出')
    }
  }
  const selfEffects = []
  if (n.dodge.physical) selfEffects.push(`物理闪避 ${Math.round(n.dodge.physical * 100)}%（有效生命 ×${(1 / (1 - n.dodge.physical)).toFixed(2)}）`)
  if (n.dodge.magical) selfEffects.push(`法术闪避 ${Math.round(n.dodge.magical * 100)}%（×${(1 / (1 - n.dodge.magical)).toFixed(2)}）`)
  if (n.healPerSec) selfEffects.push(`自回 ${n.healPerSec.toFixed(1)} HP/s`)
  if (n.drPct) selfEffects.push(`减伤 ${Math.round(n.drPct * 100)}%`)
  if (n.drFlat) selfEffects.push(`减伤 ${n.drFlat} 点/击`)
  if (n.shield) selfEffects.push(`屏障 ${Math.round(n.shield)}`)
  if (s.resist) selfEffects.push('抵抗（异常状态时长减半）')
  if (s.undying !== null) selfEffects.push(`保命机制（生命不低于 ${s.undying ? Math.round(s.undying * 100) + '%' : '1'}）`)
  if (s.immune.length) selfEffects.push(`免疫：${s.immune.join('/')}`)
  if (selfEffects.length) lines.push(`  自身机制：${selfEffects.join(' · ')}`)

  // 自回对最高压画像的净效果（最能说明"站不站得住"）
  const worst = killed[killed.length - 1]
  if (n.healPerSec > 0) {
    lines.push(`  自回效果：对${worst.threat.id}（${worst.threat.dps}DPS）净承伤 ${Math.max(worst.netDps, 0).toFixed(1)}/s → ${worst.sustained ? '可稳定站住' : `撑 ${fmt(worst.seconds)}s`}`)
  }
  if (s.healAlly) lines.push(`  团队生存：${s.healAlly}`)
  const ah = s.allyHeal
  if (ah && (ah.normalHps || ah.skillHps || ah.notes.length)) {
    if (ah.toAllies) {
      const parts = []
      if (ah.normalHps) parts.push(`常态 ${ah.normalHps.toFixed(1)} HPS`)
      if (ah.skillHps) parts.push(`技能期 ${ah.skillHps.toFixed(1)} HPS`)
      if (parts.length) lines.push(`  治疗输出（估算）：${parts.join(' · ')}`)
      for (const n of ah.notes) lines.push(`      ${n}`)
    }
  }
  for (const note of s.skillNotes.slice(0, 4)) if (!/每秒|防御\+|法抗\+/.test(note)) lines.push(`  技能生存效果：${note}`)
  lines.push('  说明：单敌人压力假设（多敌人集火按线性放大）；闪避按期望值折算（实际存在方差）；')
  lines.push('        未计入治疗干员支援、地形与阻挡分流；治疗输出为估算（治疗量与技能叠序有简化）；')
  lines.push('        生存结论需结合阵型、关卡压力与队友支援判断，本栏只给量级与硬扛上限')
  return lines.join('\n')
}

export const THREAT_META = { builtAt: THREAT.builtAt, source: THREAT.source, totalEnemies: THREAT.totalEnemies }
export { incomingHit }
