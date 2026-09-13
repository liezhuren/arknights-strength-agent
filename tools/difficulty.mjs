// tools/difficulty.mjs —— ⑥ 操作难度（用户定位的四项关键点之一）
//
// 设计原则：**只给客观项 + 分级 + 理由**，不合成假精确的单一分数。
// 每一条都对应数据里可验证的事实，主观权重（"这算不算难"）留给 agent 结合玩家水平判断。
//
// 六类客观因素：
//   1. 触发方式    受击回复 = 节奏由敌人决定（最不可控）；攻击回复 = 需持续接敌；自动开启 = 无需操作
//   2. 时机窗口    技能期短 + 首轮晚 → 需要卡点；永续/长持续 → 容错高
//   3. 站位范围    攻击范围扩大/缩小、单方向射程、对空/重量等条件
//   4. 部署准备    常态不攻击（需准备时间）、费用高、阻挡 0（不能当墙）
//   5. 前置条件    蓄力等待、弹药打完、击杀叠层
//   6. 收益挂钩    手动开启才能择时收益；自动开启收益固定但失去控制
import { extractRotation, rotationBurden } from './rotation.mjs'
import { branchState } from './branch-traits.mjs'

const strip = (s) => (s ?? '').replace(/<[^>]+>/g, '').replace(/\\n/g, '；')

/**
 * 操作难度画像。
 * @returns {{factors:Array<{kind:string, level:number, text:string}>, score:number, tier:string, notes:string[]}}
 */
export function extractDifficulty(op, eng = null, skillIndex = 2) {
  const lv = op.skills?.[skillIndex]?.levels?.[9]
  const desc = strip(lv?.description)
  const panel = op.panel ?? {}
  const factors = []
  const notes = []
  const add = (kind, level, text) => factors.push({ kind, level, text })

  const rot = extractRotation(op, skillIndex, eng)
  const spType = eng?.skill?.spType ?? 'auto'

  // ---- 1. 触发方式 ----
  const autoOpen = /技能自动开启|自动触发/.test(desc)
  if (spType === 'hit') add('触发方式', 3, '受击回复：充能依赖挨打，开技能时机由敌人决定（最不可控）')
  else if (spType === 'attack') add('触发方式', 2, '攻击回复：必须持续接敌才能充能，空场时无法转好')
  else if (spType === 'deploy') add('触发方式', 1, '部署生效：无需操作，但也无法择时')
  else if (autoOpen) add('触发方式', 1, '技能自动开启：无需操作，但失去时机控制（收益固定）')
  else add('触发方式', 1, '自动回复 + 手动开启：充能稳定、时机完全可控（最省心）')

  // ---- 2. 时机窗口 ----
  if (rot && !rot.permanent) {
    if (rot.duration > 0 && rot.duration <= 10) add('时机窗口', 2, `技能期仅 ${rot.duration}s：需要卡在敌人集中时开，容错低`)
    else if (rot.duration > 0 && rot.duration <= 20) add('时机窗口', 1, `技能期 ${rot.duration}s：窗口较窄，需大致对轴`)
    else if (rot.duration >= 30) add('时机窗口', 0, `技能期 ${rot.duration}s：窗口宽，容错高`)
  } else if (rot?.permanent) add('时机窗口', 0, '永续技能：开一次长期生效，几乎无时机压力')

  // ---- 3. 站位/范围要求 ----
  if (/攻击范围扩大|攻击范围缩小/.test(desc)) add('站位范围', 1, `技能改变攻击范围（${/扩大/.test(desc) ? '扩大' : '缩小'}）：需重新规划站位`)
  if (/优先攻击空中|对空中单位|空中单位时/.test(desc)) add('站位范围', 1, '对空相关：收益依赖关卡空中单位占比')
  if (/重量|重量等级/.test(desc)) add('站位范围', 1, '按敌人重量生效：收益随敌人类型波动')
  if (/单方向|只攻击|仅攻击/.test(desc)) add('站位范围', 1, '射程方向受限：朝向与站位要求高')

  // ---- 4. 部署与准备 ----
  const rule = branchState(op)
  if (rule?.noAttackIdle) add('部署准备', 3, `${rule.label}常态不攻击：需预留准备时间，不能当常规输出来用`)
  if (rule?.blockZeroIdle) add('部署准备', 1, '常态阻挡 0：无法承担阻挡职责')
  if ((panel.cost ?? 0) >= 30) add('部署准备', 1, `费用 ${panel.cost}：高费，开局上手晚`)
  if ((panel.blockCnt ?? 0) === 0 && !rule?.blockZeroIdle) add('部署准备', 1, '阻挡 0：不能挡路，只能远程/辅助位')

  // ---- 5. 前置条件 ----
  if (/蓄力/.test(desc)) add('前置条件', 2, '蓄力型：需等待蓄力完成才吃满收益（如卡涅利安/司霆惊蛰）')
  if (rot?.ammo) add('前置条件', 1, '弹药型：以弹药耗尽结束，持续时长随命中浮动')
  if (/击杀|击倒|消灭/.test(desc) && /叠加|最多/.test(desc)) add('前置条件', 1, '需击杀叠层：收益随战场推进逐步到位')
  if (/技能未开启时|未开启技能/.test(desc)) add('前置条件', 2, '需在技能关闭期间积累（常态蓄力）')

  // ---- 6. 回转侧负担（复用回转栏口径）----
  const rb = rotationBurden(rot)
  if (rb.level >= 2) add('回转负担', 2, rb.reasons.filter((r) => /受击|首轮|空窗/.test(r)).join('；') || '回转节奏压力大')

  // ---- 汇总（分数仅用于排序参考，结论看理由）----
  const score = factors.reduce((s, f) => s + f.level, 0)
  const tier = score >= 8 ? '高' : score >= 4 ? '中' : '低'
  if (tier === '高') notes.push('上手门槛高：节奏/站位/前置条件中多项偏难，新手容易打不出上限')
  if (tier === '低') notes.push('上手门槛低：触发稳定、前置条件少，抽到即可上手')
  const worst = [...factors].sort((a, b) => b.level - a.level)[0]
  if (worst && worst.level >= 2) notes.push(`主要难点在「${worst.kind}」：${worst.text}`)
  return { factors: factors.sort((a, b) => b.level - a.level), score, tier, notes, rotation: rot }
}

/** 渲染【操作难度】栏。 */
export function formatDifficultySection(op, eng = null, skillIndex = 2) {
  const d = extractDifficulty(op, eng, skillIndex)
  if (!d.factors.length) return null
  const lines = ['【操作难度】（关键点之一：客观项 + 分级；"算不算难"的主观权重由 agent 给）']
  const lvLabel = { 3: '高', 2: '中', 1: '低', 0: '无' }
  for (const f of d.factors) lines.push(`  [${lvLabel[f.level] ?? f.level}] ${f.kind}：${f.text}`)
  lines.push(`  分级：**${d.tier}**（客观项加权 ${d.score} 分，仅供参考排序）`)
  for (const n of d.notes) lines.push(`    · ${n}`)
  lines.push('  说明：本栏只列数据可验证的客观约束；实际难度还取决于玩家熟练度与关卡节奏，需 agent 结合用户水平给结论')
  return lines.join('\n')
}
