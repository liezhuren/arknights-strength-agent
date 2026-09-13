// tools/branch-traits.mjs —— 分支特性的"状态"模型（技能开/关两态）
//
// 为什么需要它：多数分支特性的加成**无条件常驻**，但有两个分支的特性本身就是"状态开关"，
// 用单一面板表达会必然算错一边：
//   · 阵法术师 phalanx：**通常时**不攻击且防御力/法抗大幅提升；**技能开启时**加成消失、改为群体法术输出
//   · 解放者  librator：**通常时**不攻击且阻挡数为 0，技能未开启时攻击力逐渐蓄力至 +200%；
//                        **技能期**继承蓄力值，技能结束时重置
// 这两个分支恰好是"以生存换输出"的典型 —— 生存对它们不是附属维度，而是分支身份的一部分。
//
// 设计：**按分支（subProfessionId）** 配置规则，而不是按干员打补丁 —— 同分支所有干员自动适用。
// 新增状态型分支时只在这里加一条。
import { readFile } from 'node:fs/promises'

const ops = JSON.parse(await readFile('E:/github/arknights-strength-agent/data/operators.json', 'utf8')).operators

/**
 * 分支状态规则。
 * - idleTraitSelf：特性里的"自身属性加成"是否在**常态**生效（阵法术师 true：常态防御/法抗提升）
 * - noAttackIdle：常态是否不攻击（两个分支都 true）
 * - blockZeroIdle：常态阻挡数是否为 0（解放者 true）
 * - chargeAtk：特性是否是"常态蓄力、技能期继承"的攻击力加成（解放者 true）
 * - activeTraitSelf：技能期特性加成是否仍生效（阵法术师 false —— 这正是它的代价）
 */
export const BRANCH_STATES = {
  phalanx: {
    label: '阵法术师',
    idleTraitSelf: true,
    noAttackIdle: true,
    blockZeroIdle: false,
    chargeAtk: false,
    activeTraitSelf: false,
    note: '常态不攻击但防御力×3、法抗+20（生存强）；技能开启后加成消失（生存弱）换取群体法术输出 —— 典型"以生存换输出"',
  },
  librator: {
    label: '解放者',
    idleTraitSelf: false,      // 常态不攻击，攻击力加成只在技能期兑现
    noAttackIdle: true,
    blockZeroIdle: true,       // 常态阻挡 0 → 不能当墙用
    chargeAtk: true,
    activeTraitSelf: true,     // 技能期继承蓄力
    note: '常态不攻击且阻挡数为 0，技能未开启时攻击力蓄力至 +200%；技能期继承该加成，技能结束时重置 —— 常态不能承伤、也不能阻挡',
  },
}

/** 取干员的分支状态规则（无则返回 null）。 */
export function branchState(op) {
  const r = BRANCH_STATES[op?.subProfessionId]
  return r ? { id: op.subProfessionId, ...r } : null
}

/** 该分支是否有干员（用于文档与自检）。 */
export function branchMembers(subProfId) {
  return ops.filter((o) => o.subProfessionId === subProfId).map((o) => o.name)
}

/**
 * 计算解放者式"蓄力攻击力倍率"。
 * @param {object} rule - BRANCH_STATES 条目
 * @param {object} traitBb - 特性黑匣子（atk=2 → +200%；max_stack_cnt=40 → 蓄满需 40s）
 * @param {object} skillBb - 技能黑匣子（trait_up=2 → 特性倍率提升至 2 倍，如玛恩纳 S3）
 * @returns {{mult:number, detail:string}|null}
 */
export function chargeAtkMult(rule, traitBb, skillBb = {}) {
  if (!rule?.chargeAtk) return null
  const pct = typeof traitBb.atk === 'number' ? traitBb.atk : null
  if (pct === null) return null
  const up = typeof skillBb.trait_up === 'number' && skillBb.trait_up > 1 ? skillBb.trait_up : 1
  const secs = traitBb.max_stack_cnt ?? null
  return {
    mult: 1 + pct * up,
    detail: `按蓄满假设：特性攻击力 +${Math.round(pct * 100)}%${up > 1 ? ` × 技能"特性提升至${up}倍"` : ''}${secs ? `（需技能未开启约 ${secs}s 蓄满）` : ''}`,
  }
}
