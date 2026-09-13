// tools/evaluate.mjs —— 评测管线：数据集 → 引擎输入 → 评测结果
// 这是未来 dsh agent 工具的核心模块。语义映射（damageType/倍率键）当前为
// 启发式 + 手工参数；数据集的 blackboard 原样保留，语义解释在此层完成。
import fs from 'node:fs'
import path from 'node:path'
import {
  makeOperator,
  avgDps,
  skillDps,
  sustainDps,
  skillCoverage,
  dpsProfile,
  costEfficiency,
  isNextAttackSkill,
  nextAttackDps,
  elementAccrualPerSec,
  elementBurstAvgDps,
  trapDps,
  burstDeployDamage,
  burstTotalDamage,
  burstDps,
  summonDps,
} from '../engine/dps-engine.mjs'
import { SKILL_OVERRIDES, MODULE_OVERRIDES } from './overrides.mjs'
import { formatTeamBuffSection, formatControlSection } from './extra-metrics.mjs'
import { analyzeDescription } from './patterns.mjs'
import { resolveModule, applyModule, extractTalentPenetrate, formatAttr, modulesOf } from './modules.mjs'
import { branchState, chargeAtkMult } from './branch-traits.mjs'
import { formatSurvivalSection } from './survival.mjs'
import { formatRotationSection } from './rotation.mjs'
import { formatVersatilitySection } from './versatility.mjs'
import { formatDifficultySection } from './difficulty.mjs'
import { summonFor, formatSummonSection } from './summon.mjs'
import { extractConditional, formatConditionalSection } from './conditional.mjs'

const DATA = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, '../data/operators.json'), 'utf8'),
)
const BY_ID = new Map(DATA.operators.map((o) => [o.id, o]))
const BY_NAME = new Map(DATA.operators.map((o) => [o.name, o]))

/** 干员查找：支持 id 或中文名。 */
export function findOperator(query) {
  return BY_ID.get(query) ?? BY_NAME.get(query) ?? null
}

export const SP_TYPE_MAP = {
  INCREASE_WITH_TIME: 'auto',
  INCREASE_WHEN_ATTACK: 'attack',
  INCREASE_WHEN_HIT: 'hit',
  INCREASE_WHEN_TAKEN_DAMAGE: 'hit', // 受击回复（泥岩岩崩锤等）
  '8': 'deploy', // 部署触发/被动型（spCost=0，部署即生效）
}

/** SP 类型 → 中文显示。 */
export const SP_TYPE_LABEL = { auto: '自动回复', attack: '攻击回复', hit: '受击回复', deploy: '部署生效' }

const RARITY_NUM = { TIER_1: 1, TIER_2: 2, TIER_3: 3, TIER_4: 4, TIER_5: 5, TIER_6: 6 }

/** 技能下标回退：低星干员常无 S3 → 取实际最高可用技能，避免默认评测直接报错。 */
export function resolveSkillIndex(op, skillIndex = 2) {
  const n = op.skills?.length ?? 0
  if (!n) return { index: skillIndex, adjusted: false }
  if (skillIndex < n) return { index: skillIndex, adjusted: false }
  return { index: n - 1, adjusted: true }
}

/** 技能等级下标回退：部分低星技能无专三数据 → 取最高可用等级（如技能等级7）。 */
export function resolveMastery(skillRef, masteryLevel = 9) {
  const arr = skillRef?.levels ?? []
  if (!arr.length) return { index: masteryLevel, adjusted: false }
  if (arr[masteryLevel]) return { index: masteryLevel, adjusted: false }
  return { index: arr.length - 1, adjusted: true }
}

function blackboardOf(lv) {
  return Object.fromEntries((lv?.blackboard ?? []).map((b) => [b.key, b.value]))
}

/**
 * 从技能描述推断伤害类型（关键词匹配，最具体者优先）。
 */
export function inferDamageType(desc) {
  const d = desc ?? ''
  if (d.includes('真实伤害')) return 'true'
  if (d.includes('法术伤害')) return 'magical'
  if (d.includes('物理伤害')) return 'physical'
  return null
}

/**
 * 从技能 blackboard + 描述提取元素损伤信息（累积模型 v1）。
 * 主流：攻击附带 ATK×ratio 的 X 损伤（attack@ep_damage_ratio / ep_damage_ratio）；
 * dot 型（"每秒...损伤"，如酒神 S3）按秒累积。
 * 爆发收益（损伤条阈值/爆发效果数值）待 PRTS 核实后叠加 —— 累积速率是"爆发触发频率"的代理指标。
 */
export function extractElement(bb, desc) {
  const d = desc ?? ''
  const type = ['神经', '侵蚀', '灼燃', '凋亡'].find((t) => d.includes(t + '损伤'))
  if (!type) return null
  const perHitRatio = bb['attack@ep_damage_ratio'] ?? bb.ep_damage_ratio
  if (perHitRatio === undefined) return null
  const isDot = /每秒[^，。]*损伤|损伤[^，。]*每秒/.test(d)
  return { type: `${type}损伤`, perHitRatio, isDot }
}

/**
 * 从干员天赋提取通用面板加成（天赋 blackboard 语义映射）。
 * 天赋的 atk 是**加法百分比**（0.05 = +5%），区别于技能 atk 的倍率语义（2 = ×2）。
 * 特殊机制类天赋（联动增伤/无视抗性/生成单位）走机制补丁（overrides.mjs / LLM 解析层）。
 * @param {object} op - 数据集干员
 * @returns {{ atkPct: number, aspd: number, defPct: number, hpPct: number, list: string[] }}
 */
export function extractTalentBonuses(op) {
  const out = { atkPct: 0, aspd: 0, defPct: 0, hpPct: 0, atkFlat: 0, defFlat: 0, hpFlat: 0, list: [] }
  /** 天赋数值单位判定：|v| ≤ 1 视为小数百分比；> 1 时看描述里是否出现对应百分数，否则视为**固定点数**。
   *  依据：乌尔比安"攻击力提高30"（点数）、嘉维尔"防御力+120（+20）"（点数）vs 特米米"攻击力+120%"（比例）。
   *  早期把任何 bb.atk 当百分比 → 乌尔比安被算成"攻击+3000%"（ATK ×31）。 */
  const isPct = (desc, v) => {
    if (Math.abs(v) <= 1) return true
    const n = Math.round(Math.abs(v) * 100)   // 1.1 → "110%"；30 → "3000%"
    return desc.includes(`${n}%`) || desc.includes(`${v}%`)
  }
  /** 天赋指向"友方/全体"时，收益对象不是自己 → 不并入自身面板（团队价值在 ② 栏体现）。 */
  const forAllies = (desc) => /友方|友军|我方|其他干员|全体/.test(desc) && !/自身/.test(desc)
  for (const t of op.talents ?? []) {
    const bb = Object.fromEntries((t.blackboard ?? []).map((b) => [b.key, b.value]))
    const desc = (t.description ?? '').replace(/<[^>]+>/g, '')
    const note = []
    if (typeof bb.atk === 'number') {
      // 负数 atk 需分流：描述指向敌人/目标 = 对敌减攻（不影响自身输出）；
      // 描述含"自身" = 真正的自身攻击力惩罚（如瑰盐"自身攻击力-5%"）。否则会把对敌减攻误算成自身减攻。
      const toEnemy = bb.atk < 0 && /敌人|敌军|目标/.test(desc) && !/自身/.test(desc)
      if (toEnemy) {
        note.push(`对敌减攻${Math.round(-bb.atk * 100)}%`)
      } else if (isPct(desc, bb.atk)) {
        out.atkPct += bb.atk
        note.push(`攻击${bb.atk >= 0 ? '+' : ''}${Math.round(bb.atk * 100)}%`)
      } else {
        out.atkFlat += bb.atk
        note.push(`攻击${bb.atk >= 0 ? '+' : ''}${bb.atk}点${/最多|叠加|叠/.test(desc) ? '（叠层上限，未含层数）' : ''}`)
      }
    }
    if (typeof bb.attack_speed === 'number') {
      const toEnemy = bb.attack_speed < 0 && /敌人|敌军|目标/.test(desc) && !/自身/.test(desc)
      if (toEnemy) note.push(`对敌减速攻${Math.round(-bb.attack_speed)}`)
      else {
        out.aspd += bb.attack_speed
        note.push(`攻速${bb.attack_speed >= 0 ? '+' : ''}${bb.attack_speed}`)
      }
    }
    if (typeof bb.def === 'number' && !/敌人|敌军|目标/.test(desc)) {
      if (forAllies(desc)) {
        note.push(`防御+${isPct(desc, bb.def) ? Math.round(bb.def * 100) + '%' : bb.def + '点'}（仅友方，计入②团队增益栏）`)
      } else if (isPct(desc, bb.def)) {
        out.defPct += bb.def
        note.push(`防御${bb.def >= 0 ? '+' : ''}${Math.round(bb.def * 100)}%`)
      } else {
        out.defFlat += bb.def
        note.push(`防御${bb.def >= 0 ? '+' : ''}${bb.def}点`)
      }
    }
    if (typeof bb.max_hp === 'number') {
      if (isPct(desc, bb.max_hp)) {
        out.hpPct += bb.max_hp
        note.push(`生命${bb.max_hp >= 0 ? '+' : ''}${Math.round(bb.max_hp * 100)}%`)
      } else {
        out.hpFlat += bb.max_hp
        note.push(`生命${bb.max_hp >= 0 ? '+' : ''}${bb.max_hp}点`)
      }
    }
    // 模组来源的天赋单独标注（替换基础天赋 / 新增效果），避免与干员本体天赋混淆
    const src = t._fromModule
      ? t._fromModule.index >= 0 ? `模组更新·天赋${t._fromModule.index + 1}` : '模组新增'
      : '天赋'
    out.list.push(`${src}${note.length ? `（${note.join('，')}）` : '（机制类，见补丁）'}：${desc.slice(0, 70)}`)
  }
  return out
}

/**
 * 从技能 blackboard 提取破甲（无视防御/法抗）。
 * key：def_penetrate_fixed（无视固定防御）、def_penetrate（无视防御%）、
 * magic_resist_penetrate_fixed（无视固定法抗）；兼容 attack@ 命名空间前缀。
 * 注：天赋层的 per_ 型（每层叠加，如望的棋子）走机制补丁，不在此处理。
 */
export function extractPenetrate(bb) {
  const defFixed = bb.def_penetrate_fixed ?? bb['attack@def_penetrate_fixed']
  const defPct = bb.def_penetrate ?? bb['attack@def_penetrate']
  const resFixed = bb.magic_resist_penetrate_fixed ?? bb['attack@magic_resist_penetrate_fixed']
  if (defFixed === undefined && defPct === undefined && resFixed === undefined) return null
  return {
    defFixed: defFixed ?? 0,
    defPct: defPct ?? 0,
    resFixed: resFixed ?? 0,
  }
}

/**
 * 减益数值单位归一：|v| ≤ 1 视为小数百分比（-0.44 → 44 点），> 1 视为绝对点数（-20 → 20 点）。
 * 依据：天赋层用小数（伊芙利特 -0.44），技能层用点数（S3 magic_resistance=-20、def=-300）。
 */
function normalizeDebuffValue(v) {
  return Math.abs(v) <= 1 ? Math.abs(v) * 100 : Math.abs(v)
}

/**
 * 从技能 blackboard + 描述提取"对敌减益"（自身输出受益的部分）。
 * 区分依据：描述含"使其…-/使目标…-"= 对敌减益；否则 bb 的 def 是自身加防（生存维度，不在此）。
 * 减防/减抗的单位自动归一并分流为百分比（defPct）或点数（defFlat/resFlat）。
 */
export function extractEnemyDebuff(bb, desc) {
  const d = desc ?? ''
  const toEnemy = /使其[^。]{0,12}(防御力|法术抗性)|使目标[^。]{0,12}(防御力|法术抗性)|对[^。]{0,10}(防御力|法术抗性)/.test(d)
  if (!toEnemy) return null
  const out = {}
  if (typeof bb.def === 'number' && bb.def < 0) {
    if (Math.abs(bb.def) <= 1) out.defPct = -bb.def
    else out.defFlat = -bb.def
  }
  if (typeof bb.magic_resistance === 'number' && bb.magic_resistance < 0) {
    out.resFlat = normalizeDebuffValue(bb.magic_resistance)
  }
  if (out.defPct === undefined && out.defFlat === undefined && out.resFlat === undefined) return null
  return out
}

/**
 * 天赋层的对敌减益（常驻减防/减抗，如伊芙利特"攻击范围内敌军法术抗性-44%"）。
 */
export function extractTalentEnemyDebuff(op) {
  const out = {}
  for (const t of op.talents ?? []) {
    const bb = Object.fromEntries((t.blackboard ?? []).map((b) => [b.key, b.value]))
    const desc = (t.description ?? '').replace(/<[^>]+>/g, '')
    const toEnemy = /敌军|敌人|目标/.test(desc)
    if (!toEnemy) continue
    if (typeof bb.magic_resistance === 'number' && bb.magic_resistance < 0) {
      out.resFlat = (out.resFlat ?? 0) + normalizeDebuffValue(bb.magic_resistance)
    }
    if (typeof bb.def === 'number' && bb.def < 0) {
      if (Math.abs(bb.def) <= 1) out.defPct = (out.defPct ?? 0) + -bb.def
      else out.defFlat = (out.defFlat ?? 0) + -bb.def
    }
  }
  return Object.keys(out).length ? out : null
}

/**
 * 数据集干员 → 引擎输入。
 * @param {object} op - 数据集干员对象
 * @param {object} opts
 * @param {'physical'|'magical'|'true'} [opts.damageType] - 伤害类型；缺省时由描述关键词推断
 * @param {number} [opts.skillIndex] - 技能下标（0/1/2）
 * @param {number} [opts.masteryLevel] - 技能等级下标（默认 9 = 专三）
 * @param {string} [opts.moduleSpec] - 模组启用规格（none/default/isw/X/模组名，默认 none 不启用）
 * @param {number} [opts.moduleLevel] - 模组等级（默认最高级 = 满配）
 * @param {{deploys?:number, windowSec?:number}} [opts.axis] - **轴参数**（玩法层）：爆发型技能的实际部署次数与轴长。
 *   不传则用补丁里的默认理想轴；轴长属玩法层参数，描述推导不出，需用户给定。
 */
export function toEngineInput(op, { damageType, skillIndex = 2, masteryLevel = 9, moduleSpec, moduleLevel, axis } = {}) {
  // 模组先行：产出"修改后的干员对象"，让既有天赋/减益/特性提取器全部复用，避免语义分叉
  const mod = applyModule(op, resolveModule(op, moduleSpec), moduleLevel)
  const eop = mod.op
  const panel = eop.panel ?? {}
  const si = resolveSkillIndex(eop, skillIndex)
  const skillRef = eop.skills?.[si.index]
  if (!skillRef) throw new Error(`${eop.name} 没有可用技能（无技能干员无法做输出评测，请从面板/机制维度评估）`)
  const mi = resolveMastery(skillRef, masteryLevel)
  const lv = skillRef.levels?.[mi.index]
  if (!lv) throw new Error(`${eop.name} 缺少技能[${si.index}]的技能数据`)
  const bb = blackboardOf(lv)
  const sp = lv.spData ?? {}
  // 特殊机制校准（overrides 优先于通用解析）
  const override = SKILL_OVERRIDES[eop.name]?.[si.index]
  const desc = lv.description ?? ''
  const nextAttack = (lv.duration ?? 0) <= 0 && desc.includes('下次攻击')
  // 第一层解析：通用描述模式库（表述 → 引擎参数；数据驱动覆盖高频机制）
  const { mods: descMods, discoveries: descDiscoveries } = analyzeDescription(lv, { knownKeys: new Set(Object.keys(bb)) })
  // 陷阱师特判：技能 atk_scale 是"陷阱/棋子伤害倍率"而非普攻倍率
  const isTraper = eop.subProfessionId === 'traper'
  const trapMultRaw = bb.atk_scale ?? bb['attack@atk_scale']
  const isTrapDamageSkill = isTraper && trapMultRaw !== undefined
    && (desc.includes('触发') || desc.includes('引爆') || desc.includes('被动效果'))
  // 普攻倍率语义：atk_scale/attack@atk_scale = 伤害倍率（陷阱师除外，归陷阱通道）；atk = 攻击力倍率（值 1+X%）
  // 优先级：attack@atk_scale 是"每次攻击的伤害倍率"，比裸 atk_scale 更具体。
  // 两者同时存在时（全库仅 4 个技能：玛恩纳S3/薄绿S2/机械师S3/断崖S2），描述里的主攻击一律用 attack@atk_scale，
  // 裸 atk_scale 是附带效果（如薄绿技能结束时的范围伤害）—— 早期取裸 atk_scale 会把玛恩纳 S3 算成 0.12 倍。
  const mainScale = bb['attack@atk_scale'] ?? bb.atk_scale
  const attackMult = isTrapDamageSkill
    ? (override?.attackMult ?? bb.atk ?? 1)
    : (override?.attackMult ?? mainScale ?? bb.atk ?? 1)
  const resolvedDmg = damageType === 'auto' ? null : damageType
  const finalDmg = (override?.damageType ?? resolvedDmg) ?? inferDamageType(lv.description) ?? (
    eop.profession === 'CASTER' || eop.subProfessionId === 'artsfghter' ? 'magical' : 'physical'
  )
  // 天赋通用加成（atk 加法%/攻速/防御/生命）—— 天赋必须进计算，而非只读技能 blackboard
  // 注意：此处读的是"模组修改后"的干员，模组的天赋更新（替换语义）自动生效
  const talent = extractTalentBonuses(eop)
  // 模组属性中的攻速是平A间隔的一部分
  const modAspd = mod.attr?.attack_speed ?? 0
  // 状态型分支：解放者的"常态蓄力攻击力"在技能期兑现（按蓄满假设，标注依据）
  const bs = branchState(eop)
  const charge = bs ? chargeAtkMult(bs, Object.fromEntries((eop.trait?.blackboard ?? []).map((b) => [b.key, b.value])), bb) : null
  if (charge) mod.warnings.push(`解放者蓄力：${charge.detail} → 技能期攻击力 ×${charge.mult}`)
  // 天赋层穿透（无条件型计入 DPS；条件型/叠层型在报告中标注）
  const talentPen = extractTalentPenetrate(eop)
  // 陷阱触发通道：cdSec = 技能再充能秒数（产 1 轮陷阱），cnt = 每轮产出数（望 S3 一次性 8 枚）
  // 机制补丁（override.trapPatch）来自 LLM 描述解析沉淀（overrides.mjs），透传给引擎
  // 若存在 burstPatch（单次窗口爆发形态），优先走 burst 通道，trap 持续口径作废
  const burst = override?.burstPatch
    ? {
        perDeployHits: override.burstPatch.perDeployHits,
        hitMult: override.burstPatch.hitMult ?? 1,
        maxDeploysPerSkill: override.burstPatch.maxDeploysPerSkill,
        skillWindowSec: override.burstPatch.skillWindowSec,
        deploys: override.burstPatch.deploys,
        totalHits: override.burstPatch.totalHits,
        windowSec: override.burstPatch.windowSec ?? 10,
        label: override.burstPatch.label,
        // 轴参数（玩法层，用户给定）优先于补丁里的默认理想轴
        ...(axis?.deploys ? { deploys: axis.deploys } : {}),
        ...(axis?.windowSec ? { windowSec: axis.windowSec } : {}),
        axisFromUser: !!(axis?.deploys || axis?.windowSec),
      }
    : null
  const trap = !burst && isTrapDamageSkill
    ? {
        mult: trapMultRaw,
        cdSec: Math.max(((sp.spCost ?? 12) - (sp.initSp ?? 0)) / (panel.spRecoveryPerSec ?? 1), 1),
        cnt: bb.cnt ?? 1,
        targets: 1,
        ...(override?.trapPatch ?? {}),
      }
    : null
  // 召唤物通道：独立输出线（不与本体 DPS 相加）。只有伤害型召唤物计入，其余在报告中标注。
  const summon = summonFor(eop.name)
  const eng = makeOperator({
    name: `${eop.name}·${lv.name ?? skillRef.id}`,
    rarity: RARITY_NUM[eop.rarity] ?? 5,
    archetype: eop.subProfessionId ?? eop.profession,
    atk: ((panel.atk ?? 0) + (talent.atkFlat ?? 0)) * (1 + talent.atkPct) * (charge?.mult ?? 1),
    maxHp: ((panel.maxHp ?? 0) + (talent.hpFlat ?? 0)) * (1 + talent.hpPct),
    def: ((panel.def ?? 0) + (talent.defFlat ?? 0)) * (1 + talent.defPct),
    res: panel.magicResistance ?? 0,
    baseInterval: (panel.baseAttackTime ?? 1.5) / (1 + (talent.aspd + modAspd) / 100),
    blockCount: panel.blockCnt ?? 1,
    cost: panel.cost ?? 0,
    redeployTime: panel.respawnTime ?? 70,
    spRecoveryPerSec: panel.spRecoveryPerSec ?? 1,
    damageType: finalDmg,
    idleNoAttack: !!bs?.noAttackIdle,
    targetCount: 1,
    burst,
    trap,
    summon,
    penetrate: (() => {
      // 三个来源相加：技能 blackboard、模组特性（如艾雅法拉 X 无视10法抗）、天赋（如史尔特尔 无视22法抗）
      const src = [extractPenetrate(bb), extractPenetrate(mod.traitBlackboard), talentPen]
      const sum = { defFixed: 0, defPct: 0, resFixed: 0 }
      for (const s of src) {
        if (!s) continue
        sum.defFixed += s.defFixed ?? 0
        sum.defPct += s.defPct ?? 0
        sum.resFixed += s.resFixed ?? 0
      }
      return (sum.defFixed || sum.defPct || sum.resFixed) ? sum : null
    })(),
    enemyDebuff: (() => {
      const skillDeb = extractEnemyDebuff(bb, desc)
      const talentDeb = extractTalentEnemyDebuff(eop)
      const traitDeb = extractEnemyDebuff(mod.traitBlackboard, eop.trait?.description ?? '')
      if (!skillDeb && !talentDeb && !traitDeb) return null
      return {
        defPct: (skillDeb?.defPct ?? 0) + (talentDeb?.defPct ?? 0) + (traitDeb?.defPct ?? 0),
        defFlat: (skillDeb?.defFlat ?? 0) + (talentDeb?.defFlat ?? 0) + (traitDeb?.defFlat ?? 0),
        resFlat: (skillDeb?.resFlat ?? 0) + (talentDeb?.resFlat ?? 0) + (traitDeb?.resFlat ?? 0),
      }
    })(),
    element: extractElement(bb, desc, panel.baseAttackTime ?? 1.5, SP_TYPE_MAP[sp.spType] ?? 'auto'),
    skill: {
      name: lv.name ?? skillRef.id,
      spType: SP_TYPE_MAP[sp.spType] ?? 'auto',
      spCost: sp.spCost ?? 0,
      spStart: sp.initSp ?? 0,
      duration: lv.duration ?? 0,
      attackMult,
      aspdBonus: bb.attack_speed ?? 0,
      baseAttackTimeDelta: bb.base_attack_time ?? 0,
      hits: bb['attack@times'] ?? descMods.hits ?? 1,
      // 目标数语义分流：描述含"额外攻击N个目标"时，bb 的 attack@max_target 是同一信息（额外数），
      // 避免重复计算 → 额外型按 1+N；否则 bb 的 attack@max_target 视为总目标数
      targetCount: descMods.extraTargets !== undefined
        ? 1 + descMods.extraTargets
        : (bb['attack@max_target'] ?? descMods.targetCount ?? 1),
      increment: sp.increment ?? 1,
      nextAttack,
      noAttack: descMods.skillNoAttack ?? false,
    },
  })
  // 挂载模组应用结果（引擎只读取已知字段，附加字段无副作用）
  eng._module = mod
  eng._talentPen = talentPen
  eng._skillIndex = si.index
  eng._skillAdjusted = si.adjusted
  eng._masteryAdjusted = mi.adjusted ? mi.index : null
  return eng
}

/**
 * 对引擎输入直接评测（自创干员与数据集干员共用）。
 * @param {object} eng - makeOperator 产物
 * @param {object} [meta] - 展示信息（operator/rarity/profession/skill/rawBlackboard）
 * @returns {object} 评测结果（含输出画像/覆盖率/费用效率）
 */
export function evaluateEngine(eng, meta = {}) {
  const profile = dpsProfile(eng)
  const physical = eng.damageType === 'physical'
  const nextAttack = isNextAttackSkill(eng)
  const benchmark = nextAttack
    ? physical
      ? {
          cycleAvgDpsVs400Def: nextAttackDps(eng, 400, 0),
          avgDpsVs400Def: avgDps(eng, 400, 0),
          costEffVs400Def: costEfficiency(eng, 400, 0),
        }
      : {
          cycleAvgDpsVs50Res: nextAttackDps(eng, 0, 50),
          avgDpsVs50Res: avgDps(eng, 0, 50),
          costEffVs50Res: costEfficiency(eng, 0, 50),
        }
    : physical
      ? {
          skillDpsVs400Def: skillDps(eng, 400, 0),
          sustainDpsVs400Def: sustainDps(eng, 400, 0),
          avgDpsVs400Def: avgDps(eng, 400, 0),
          costEffVs400Def: costEfficiency(eng, 400, 0),
        }
      : {
          skillDpsVs50Res: skillDps(eng, 0, 50),
          sustainDpsVs50Res: sustainDps(eng, 0, 50),
          avgDpsVs50Res: avgDps(eng, 0, 50),
          costEffVs50Res: costEfficiency(eng, 0, 50),
        }
  return {
    operator: meta.operator ?? eng.name,
    rarity: meta.rarity ?? eng.rarity,
    profession: meta.profession ?? eng.archetype,
    skill: meta.skill ?? eng.skill?.name ?? null,
    damageType: eng.damageType,
    nextAttack,
    element: eng.element,
    elementAccrualPerSec: eng.element ? elementAccrualPerSec(eng) : 0,
    elementBurstAvgDps: eng.element ? elementBurstAvgDps(eng) : 0,
    elementBurstAvgDpsLeader: eng.element ? elementBurstAvgDps(eng, { maxEp: 2000 }) : 0,
    trap: eng.trap,
    trapDps: eng.trap ? trapDps(eng) : 0,
    burst: eng.burst,
    burstDeployDamage: eng.burst ? burstDeployDamage(eng) : 0,
    burstTotalDamage: eng.burst ? burstTotalDamage(eng, { scope: 'axis' }) : 0,
    burstDps: eng.burst ? burstDps(eng, { scope: 'axis' }) : 0,
    burstSkillTotal: eng.burst ? burstTotalDamage(eng, { scope: 'skill' }) : 0,
    burstSkillDps: eng.burst ? burstDps(eng, { scope: 'skill' }) : 0,
    // 召唤物：独立输出线（不并入上面的 skillDps/avgDps，报告单列）
    // 基准与本体一致：物理 vs 400防 / 法术 vs 50抗（召唤物伤害类型默认跟随召唤师）
    summon: meta.summon ?? eng.summon ?? null,
    summonDps: (meta.summon ?? eng.summon) ? summonDps(eng) : 0,
    summonDpsBench: (meta.summon ?? eng.summon)
      ? summonDps(eng, { mitigation: physical ? { def: 400, res: 0 } : { def: 0, res: 50 } })
      : 0,
    talentBonuses: meta.talentBonuses ?? null,
    talentList: meta.talentList ?? [],
    trait: meta.trait ?? null,
    teamBuffSection: meta.teamBuffSection ?? null,
    controlSection: meta.controlSection ?? null,
    survivalSection: meta.survivalSection ?? null,
    rotationSection: meta.rotationSection ?? null,
    versatilitySection: meta.versatilitySection ?? null,
    difficultySection: meta.difficultySection ?? null,
    moduleList: meta.moduleList ?? [],
    moduleApplied: meta.moduleApplied ?? eng._module ?? null,
    skillIndexAdjusted: meta.skillIndexAdjusted ?? null,
    descDiscoveries: meta.descDiscoveries ?? [],
    conditional: meta.conditional ?? null,
    penetrate: eng.penetrate,
    talentPenetrate: eng._talentPen ?? null,
    enemyDebuff: eng.enemyDebuff,
    panel: { atk: eng.atk, baseInterval: eng.baseInterval, cost: eng.cost },
    skillData: {
      spType: eng.skill?.spType,
      spCost: eng.skill?.spCost,
      spStart: eng.skill?.spStart,
      duration: eng.skill?.duration,
      attackMult: eng.skill?.attackMult,
      targetCount: eng.skill?.targetCount,
      hits: eng.skill?.hits,
      baseAttackTimeDelta: eng.skill?.baseAttackTimeDelta,
      aspdBonus: eng.skill?.aspdBonus,
      increment: eng.skill?.increment,
      rawBlackboard: meta.rawBlackboard ?? null,
    },
    coverage: eng.skill ? skillCoverage(eng) : 0,
    benchmark,
    profile,
    // 引擎对象：供软件层（app/server 的图表）复用同一口径，避免重复计算或口径漂移
    engine: eng,
  }
}

/** 数据集干员 → 评测结果。 */
export function evaluate(op, opts = {}) {
  const eng = toEngineInput(op, opts)
  const skillIndex = eng._skillIndex ?? opts.skillIndex ?? 2
  // ②③ 两栏读"模组修改后"的干员，使模组的天赋/特性更新自动进入团队增益与控制栏
  const eop = eng._module?.op ?? op
  const lv = eop.skills?.[skillIndex]?.levels?.[eng._masteryAdjusted ?? opts.masteryLevel ?? 9]
  const { discoveries: descDiscoveries } = analyzeDescription(lv, { knownKeys: new Set(Object.keys(blackboardOf(lv ?? {}))) })
  const talent = extractTalentBonuses(eop)
  const adjustNotes = []
  if (eng._skillAdjusted) adjustNotes.push(`该干员无该技能，已回退至最高可用技能 S${skillIndex + 1}`)
  if (eng._masteryAdjusted !== null) adjustNotes.push(`该技能无专三数据，已按最高可用等级（下标 ${eng._masteryAdjusted}）计算`)
  return evaluateEngine(eng, {
    operator: op.name,
    rarity: op.rarity,
    profession: `${op.profession}/${op.subProfessionId}`,
    skill: lv?.name ?? null,
    skillIndexAdjusted: adjustNotes.length ? adjustNotes.join('；') : null,
    rawBlackboard: blackboardOf(lv),
    trait: eop.trait?.description ? `${(eop.trait.description ?? '').replace(/<[^>]+>/g, '').replace(/\\n/g, '；')}${eop.trait._mode && eop.trait._mode !== 'base' ? `（模组${eop.trait._mode === 'override' ? '覆盖' : '追加'}）` : ''}` : null,
    talentBonuses: talent,
    talentList: talent.list,
    teamBuffSection: formatTeamBuffSection(eop, skillIndex),
    controlSection: formatControlSection(eop, skillIndex),
    survivalSection: formatSurvivalSection(eop, skillIndex, talent),
    rotationSection: formatRotationSection(eop, skillIndex, eng),
    versatilitySection: formatVersatilitySection(eng),
    difficultySection: formatDifficultySection(eop, eng, skillIndex),
    moduleList: modulesOf(op).map((m) => `${m.name}(${m.type}${m.isSpecial ? '·特限' : ''}${m.hasCombatData ? '' : '·无数值'})`),
    moduleApplied: eng._module,
    descDiscoveries,
    // 条件型加成与索敌（对空加成/优先攻击/蓄力两态）：**只标注，不进 DPS**
    // 用 eng 解析后的技能下标（低星回退后可能不是请求值）与专精等级取值
    conditional: extractConditional(eop, eng._skillIndex ?? skillIndex, eng._masteryAdjusted ?? opts.masteryLevel ?? 9),
  })
}

/** SP 回复方式的中文技能描述片段。 */
function formatSpText(r) {
  const st = r.skillData
  const label = SP_TYPE_LABEL[st.spType] ?? st.spType
  const head = st.spType === 'deploy'
    ? label
    : `${label} SP${st.spCost}(初始${st.spStart})`
  return `${head} · 持续${st.duration}s · 倍率×${st.attackMult} · ${st.hits ?? 1}段/${st.targetCount}目标`
}

/** 简洁文本报告（后续 agent 输出格式的雏形）。 */
export function formatReport(r) {
  const lines = [
    `【${r.operator}】${r.rarity} · ${r.profession} · 技能「${r.skill}」(${r.damageType})`,
    `面板：ATK ${r.panel.atk.toFixed(1)} · 间隔 ${r.panel.baseInterval.toFixed(2)}s · 费用 ${r.panel.cost}${r.talentBonuses && (r.talentBonuses.atkPct || r.talentBonuses.aspd) ? `（含天赋：${[r.talentBonuses.atkPct ? `攻击${r.talentBonuses.atkPct >= 0 ? '+' : ''}${Math.round(r.talentBonuses.atkPct * 100)}%` : '', r.talentBonuses.aspd ? `攻速${r.talentBonuses.aspd >= 0 ? '+' : ''}${r.talentBonuses.aspd}` : ''].filter(Boolean).join('，')}）` : ''}`,
    `技能：${formatSpText(r)}${r.skillData.baseAttackTimeDelta ? ` · 间隔${r.skillData.baseAttackTimeDelta > 0 ? '+' : ''}${r.skillData.baseAttackTimeDelta}s` : ''}`,
  ]
  if (r.skillIndexAdjusted) lines.push(`⚠ ${r.skillIndexAdjusted}`)
  if (r.trait) lines.push(`分支特性：${r.trait}`)
  if (r.enemyDebuff && (r.enemyDebuff.defPct || r.enemyDebuff.resFlat)) {
    const parts = []
    if (r.enemyDebuff.defPct) parts.push(`减防${Math.round(r.enemyDebuff.defPct * 100)}%`)
    if (r.enemyDebuff.resFlat) parts.push(`减抗${r.enemyDebuff.resFlat}`)
    lines.push(`对敌减益（自身受益）：${parts.join(' · ')}（已计入上述 DPS；队友受益部分属团队增益栏）`)
  }
  for (const t of r.talentList ?? []) lines.push(`天赋：${t}`)
  if (r.descDiscoveries?.length) lines.push(`描述解析：${r.descDiscoveries.join('；')}`)
  if (r.penetrate && (r.penetrate.defFixed || r.penetrate.defPct || r.penetrate.resFixed)) {
    const parts = []
    if (r.penetrate.defFixed) parts.push(`无视${r.penetrate.defFixed}防御`)
    if (r.penetrate.defPct) parts.push(`无视${Math.round(r.penetrate.defPct * 100)}%防御`)
    if (r.penetrate.resFixed) parts.push(`无视${r.penetrate.resFixed}法抗`)
    lines.push(`破甲穿透：${parts.join(' · ')}（已计入上述 DPS）`)
  }
  // 天赋/模组层的条件型穿透不计入 DPS，但必须让用户看到（配特定队伍/敌人时才会生效）
  for (const rp of r.talentPenetrate?.ramped ?? []) lines.push(`穿透（叠层型，按叠满计）：${rp}`)
  for (const c of r.talentPenetrate?.conditional ?? []) {
    lines.push(`条件型穿透（⚠未计入 DPS）：${c.items} —— 条件：${c.desc.slice(0, 50)}`)
  }
  if (r.nextAttack) {
    const n = Math.max(Math.ceil((r.skillData.spCost ?? 1) / (r.skillData.increment ?? 1)), 1)
    const trigger = r.skillData.spType === 'hit'
      ? `每 ${n} 次受击`
      : r.skillData.spType === 'auto'
        ? `约每 ${n} 秒（自动回复）`
        : `每 ${n} 次攻击`
    lines.push(`强化攻击型：${trigger}触发 1 次×${r.skillData.attackMult} 强化`)
  } else {
    lines.push(`覆盖率：${(r.coverage * 100).toFixed(1)}%`)
  }
  if (r.element) {
    lines.push(`元素损伤：${r.element.type}累积 ${r.elementAccrualPerSec.toFixed(1)}/秒（技能期） · 爆发收益约 ${r.elementBurstAvgDps.toFixed(1)}/秒（普通敌人）/ ${r.elementBurstAvgDpsLeader.toFixed(1)}/秒（领袖，条2000）`)
    lines.push(`          损伤条1000，爆条后冷却≈爆发持续；数值源 PRTS(2.7.61)，假设标注见 docs/dps-calculation.md`)
  }
  if (r.burst) {
    lines.push(`单次窗口爆发：每次部署 ${r.burst.perDeployHits}枚 × ${r.burst.hitMult} = ${r.burstDeployDamage.toFixed(0)}`)
    lines.push(`          单次技能(${r.burst.maxDeploysPerSkill}部署/${r.burst.skillWindowSec}s)：总伤 ${r.burstSkillTotal.toFixed(0)} → ${r.burstSkillDps.toFixed(0)} DPS`)
    lines.push(`          理想轴(${r.burst.deploys}部署/${r.burst.windowSec}s)：总伤 ${r.burstTotalDamage.toFixed(0)} → ${r.burstDps.toFixed(0)} DPS`)
  }
  if (r.trap) {
    const bonus = r.trap.multBonusPct ? `，联动+${Math.round(r.trap.multBonusPct * 100)}%` : ''
    const pen = r.trap.resPenetrate ? `，无视${r.trap.resPenetrate}法抗` : ''
    lines.push(`陷阱/棋子：触发 DPS ${r.trapDps.toFixed(1)}（每次×${r.trap.mult}${bonus}${pen}，每 ${r.trap.cdSec}s 产 ${r.trap.cnt ?? 1} 个假设全触发；本体普攻另算，真实触发随敌人走位波动）`)
  }
  if (r.summon) {
    for (const l of formatSummonSection(r)) lines.push(l)
    if (r.summonDpsBench) {
      const bk = r.damageType === 'physical' ? 'vs400防' : 'vs50抗'
      lines.push(`        基准口径（${bk}）：召唤物 ${r.summonDpsBench.toFixed(1)} DPS —— **独立于上方本体数值，不相加**`)
    }
  }
  // 条件型加成与索敌（对空/优先攻击/蓄力两态）—— 只标注，不进 DPS
  if (r.conditional) for (const l of formatConditionalSection(r.conditional)) lines.push(l)
  const b = r.benchmark
  if (r.nextAttack) {
    const key = r.damageType === 'physical' ? 'Vs400Def' : 'Vs50Res'
    lines.push(`基准${key}：强化周期平均 DPS ${b[`cycleAvgDps${key}`].toFixed(1)} · 总平均 ${b[`avgDps${key}`].toFixed(1)} · 费效 ${b[`costEff${key}`].toFixed(1)}`)
  } else {
    const key = r.damageType === 'physical' ? 'Vs400Def' : 'Vs50Res'
    lines.push(
      `基准${key}：技能期 DPS ${b[`skillDps${key}`].toFixed(1)} · 平A ${b[`sustainDps${key}`].toFixed(1)} · 平均 ${b[`avgDps${key}`].toFixed(1)} · 费效 ${b[`costEff${key}`].toFixed(1)}`,
    )
  }
  // ② 团队增益栏 / ③ 控制栏（独立成栏，不并入 DPS 数字）
  if (r.moduleApplied?.entry) {
    const m = r.moduleApplied
    const tag = `${m.entry.name}(${m.entry.type}${m.entry.isSpecial ? '·特限' : ''}${m.level ? ` L${m.level.level}` : ''})`
    if (m.level) {
      lines.push('', `【模组】启用 ${tag}${m.entry.isSpecial ? ' ⚠仅集成战略生效' : ''}`)
      if (Object.keys(m.attr ?? {}).length) lines.push(`  属性加成：${formatAttr(m.attr)}`)
      for (const n of m.talentNotes) lines.push(`  天赋更新：${n}`)
      for (const n of m.traitNotes) lines.push(`  特性更新：${n}`)
    } else {
      lines.push('', `【模组】启用 ${tag} —— 无战斗数值，计算按未装备处理`)
    }
    for (const w of m.warnings) lines.push(`  ⚠ ${w}`)
  } else {
    if (r.moduleList?.length) {
      lines.push('', `【模组】未启用（可选项：${r.moduleList.join(' / ')}）`)
      lines.push(`  用法：--module default|isw|<X/Y/D>|<模组名>  ·  --mlvl 1|2|3（默认满级）`)
      const mod = MODULE_OVERRIDES[r.operator]
      if (mod) lines.push(`  机制补丁：${mod.moduleName}（${mod.type}·仅${mod.scope}）— ${mod.note}`)
    }
    // 无模组时也要给出"基础特性的假设与条件"——否则银灰远程 80%、泥岩不可被治疗等会被静默吞掉
    const ws = r.moduleApplied?.warnings ?? []
    if (ws.length) {
      lines.push('', '【假设与条件】（基础特性带来的口径说明）')
      for (const w of ws) lines.push(`  ⚠ ${w}`)
    }
  }
  if (r.versatilitySection) lines.push('', r.versatilitySection)
  if (r.difficultySection) lines.push('', r.difficultySection)
  if (r.rotationSection) lines.push('', r.rotationSection)
  if (r.teamBuffSection) lines.push('', r.teamBuffSection)
  if (r.controlSection) lines.push('', r.controlSection)
  if (r.survivalSection) lines.push('', r.survivalSection)
  return lines.join('\n')
}

/** 供命令行直接运行：
 *   node tools/evaluate.mjs <名字> [auto|physical|magical|true] [技能下标] [--module <规格>] [--mlvl 1|2|3]
 *   --module 取值：none(默认) | default(默认模组) | isw(特限) | X|Y|D | 模组名 | 模组 id | 下标
 */
if (process.argv[1] && new URL(import.meta.url).pathname === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).pathname) {
  const argv = process.argv.slice(2)
  const flag = (name) => {
    const i = argv.indexOf(name)
    if (i < 0) return undefined
    const v = argv[i + 1]
    argv.splice(i, v && !v.startsWith('--') ? 2 : 1)
    return v && !v.startsWith('--') ? v : true
  }
  const moduleSpec = flag('--module') ?? flag('-m')
  const moduleLevel = flag('--mlvl')
  const [query, dmg = 'auto', idx = '2'] = argv
  const op = findOperator(query)
  if (!op) {
    console.error(`未找到干员：${query}`)
    process.exit(1)
  }
  try {
    const result = evaluate(op, {
      damageType: dmg === 'auto' ? 'auto' : dmg,
      skillIndex: Number(idx),
      moduleSpec: moduleSpec === true ? 'default' : moduleSpec,
      moduleLevel: moduleLevel === undefined ? undefined : Number(moduleLevel),
    })
    console.log(formatReport(result))
  } catch (e) {
    console.error(`评测失败：${e.message}`)
    process.exit(1)
  }
}
