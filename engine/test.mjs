// test.mjs —— dps-engine 原型自测
// 运行：node test.mjs
import {
  physicalDamage,
  magicalDamage,
  trueDamage,
  attackInterval,
  makeOperator,
  skillDps,
  sustainDps,
  skillCoverage,
  avgDps,
  dpsProfile,
  costEfficiency,
  nextAttackDps,
  elementAccrualPerSec,
  elementBurstAvgDps,
  ELEMENT_BREAK_ON_ENEMY,
  trapDps,
  burstTotalDamage,
  burstDps,
  burstDeployDamage,
} from './dps-engine.mjs'
import { incomingHit, incomingDps, dodgeMultiplier, surviveSim, survival } from './survival.mjs'

let pass = 0
let fail = 0
function assert(name, cond) {
  if (cond) {
    pass++
    console.log(`PASS  ${name}`)
  } else {
    fail++
    console.log(`FAIL  ${name}`)
  }
}

// ---- 伤害公式 ----
assert('物理 800攻 vs 200防 = 600', physicalDamage(800, 1, 200) === 600)
assert('物理 800攻 vs 3000防 = 保底40', physicalDamage(800, 1, 3000) === 40)
assert('物理 800×3 vs 500防 = 1900', physicalDamage(800, 3, 500) === 1900)
assert('法术 800攻 vs 50抗 = 400', magicalDamage(800, 1, 50) === 400)
assert('法术 800攻 vs 95抗 = 保底40', magicalDamage(800, 1, 95) === 40)
assert('真实 800攻 = 800', trueDamage(800, 1) === 800)
assert('攻速 1.5s +50 = 1.0s', Math.abs(attackInterval(1.5, 50) - 1.0) < 1e-9)

// ---- 破甲穿透 ----
assert('无视800固定防御：700攻 vs 800防 = 700', physicalDamage(700, 1, 800, { defPenetrateFixed: 800 }) === 700)
assert('无视50%防御：700攻 vs 800防 = 300', physicalDamage(700, 1, 800, { defPenetratePct: 0.5 }) === 300)
assert('固定+百分比叠加：700 vs 800防(无视50%+100) = 400', physicalDamage(700, 1, 800, { defPenetrateFixed: 100, defPenetratePct: 0.5 }) === 400)
assert('无视30法抗：645攻 vs 50抗 = 516', magicalDamage(645, 1, 50, { resPenetrateFixed: 30 }) === 516)
assert('无视穿透不产生负防增伤', physicalDamage(700, 1, 100, { defPenetrateFixed: 800 }) === 700)

// ---- 法术歼灭型样例 ----
const caster = makeOperator({
  name: '测试·法术歼灭',
  damageType: 'magical',
  atk: 800,
  baseInterval: 1.6,
  cost: 19,
  skill: { spType: 'auto', spCost: 30, duration: 30, attackMult: 3, hits: 2 },
})
// 技能期：每击 800×3×0.5=1200 ×2段 = 2400，间隔 1.6s → 1500/s
assert('法术技能期 DPS vs 50抗 = 1500', skillDps(caster, 0, 50) === 1500)
// 覆盖率：30s 充能 + 30s 持续 → 0.5
assert('自动回复覆盖率 = 0.5', Math.abs(skillCoverage(caster) - 0.5) < 1e-9)
// 平A：800×0.5=400 / 1.6 = 250
assert('法术平A DPS vs 50抗 = 250', sustainDps(caster, 0, 50) === 250)
// 平均：1500×0.5 + 250×0.5 = 875
assert('平均 DPS = 875', Math.abs(avgDps(caster, 0, 50) - 875) < 1e-9)

// ---- 物理攻坚型样例 ----
const guard = makeOperator({
  name: '测试·物理攻坚',
  damageType: 'physical',
  atk: 700,
  baseInterval: 1.2,
  cost: 20,
  skill: { spType: 'attack', spCost: 8, duration: 20, attackMult: 1.8 },
})
// 平A vs 200防：max(700-200,35)=500 / 1.2 ≈ 416.67
assert(
  '物理平A DPS vs 200防 ≈ 416.67',
  Math.abs(sustainDps(guard, 200, 0) - 500 / 1.2) < 1e-9,
)
// 技能期：700×1.8-200=1060 / 1.2 = 883.33（攻速无加成）
assert(
  '物理技能期 DPS vs 200防 ≈ 883.33',
  Math.abs(skillDps(guard, 200, 0) - 1060 / 1.2) < 1e-9,
)
// 覆盖率：攻击回复 8SP×1.2s=9.6s 充能 + 20s = 29.6s → 20/29.6 ≈ 0.6757
const cov = 20 / (8 * 1.2 + 20)
assert('攻击回复覆盖率 ≈ 0.6757', Math.abs(skillCoverage(guard) - cov) < 1e-9)

// ---- 费用效率 ----
assert('费用效率 = 平均DPS/费用', Math.abs(costEfficiency(caster, 0, 50) - 875 / 19) < 1e-9)

// ---- SP 模型：spRecoveryPerSec / increment / 受击频率假设 ----
// 自动回复：spRecoveryPerSec=2 → 充能 30/2=15s → 覆盖率 30/(15+30)=2/3
const fastRegen = makeOperator({
  name: '测试·快速回费',
  damageType: 'magical',
  atk: 800,
  baseInterval: 1.6,
  cost: 19,
  spRecoveryPerSec: 2,
  skill: { spType: 'auto', spCost: 30, duration: 30, attackMult: 3 },
})
assert('spRecoveryPerSec=2 → 覆盖率 2/3', Math.abs(skillCoverage(fastRegen) - 2 / 3) < 1e-9)
// 自动回复默认 1/s 与原有 caster 断言一致（spRecoveryPerSec 未传 → 1）
assert('默认 spRecoveryPerSec=1 不破坏原覆盖率', Math.abs(skillCoverage(caster) - 0.5) < 1e-9)

// 攻击回复：increment=2 → 每击回2SP → 充能 8/2×1.2=4.8s → 覆盖率 20/24.8
const guardFast = makeOperator({
  name: '测试·物理攻坚·快速',
  damageType: 'physical',
  atk: 700,
  baseInterval: 1.2,
  cost: 20,
  skill: { spType: 'attack', spCost: 8, duration: 20, attackMult: 1.8, increment: 2 },
})
assert('攻击回复 increment=2 → 覆盖率 20/24.8', Math.abs(skillCoverage(guardFast) - 20 / 24.8) < 1e-9)

// 受击回复：hitAssumptionPerSec=0.5（默认）→ 充能 4/0.5=8s → 覆盖率 20/28
const hitOp = makeOperator({
  name: '测试·受击回复',
  damageType: 'physical',
  atk: 700,
  baseInterval: 1.2,
  cost: 20,
  skill: { spType: 'hit', spCost: 4, duration: 20, attackMult: 1.8 },
})
assert('受击回复 hit(默认0.5次/秒) → 覆盖率 20/28', Math.abs(skillCoverage(hitOp) - 20 / 28) < 1e-9)
// 受击频率假设提高 → 覆盖率上升
const hitOp2 = makeOperator({ ...hitOp, hitAssumptionPerSec: 1.5 })
assert('受击频率 1.5/s → 覆盖率 20/22.667', Math.abs(skillCoverage(hitOp2) - 20 / (4 / 1.5 + 20)) < 1e-9)

// ---- 强化攻击模型：三种回复方式的周期 ----
// attack 型（强力击式）：SP2 攻击回复、间隔 1.3s → 周期 2×1.3=2.6s，1 强化 + 1 平A
const strike = makeOperator({
  name: '测试·强力击',
  damageType: 'physical',
  atk: 713,
  baseInterval: 1.3,
  cost: 20,
  skill: { spType: 'attack', spCost: 2, duration: 0, attackMult: 2.9, nextAttack: true },
})
// (713×2.9−400 + 313) / 2.6 = (1667+313)/2.6 = 761.5
assert('强化攻击 attack 型 DPS ≈ 761.5', Math.abs(nextAttackDps(strike, 400, 0) - 1980 / 2.6) < 1e-9)
// auto 型（点燃式）：SP5 自动回复 → 周期 5s，期间普攻 5/1.6≈3.125 次
const ignite = makeOperator({
  name: '测试·点燃式',
  damageType: 'magical',
  atk: 645,
  baseInterval: 1.6,
  cost: 21,
  skill: { spType: 'auto', spCost: 5, duration: -1, attackMult: 1.85, nextAttack: true },
})
const igCycle = 5 / 1 // spCost / spRecoveryPerSec
const igExp = (Math.floor(645 * 1.85 * 0.5) + 322 * (igCycle / 1.6 - 1)) / igCycle
assert('强化攻击 auto 型周期 = spCost/回速', Math.abs(nextAttackDps(ignite, 0, 50) - igExp) < 1e-9)
// hit 型（岩崩锤式）：SP4 受击回复、假设 0.5 次/秒 → 周期 8s
const hammer = makeOperator({
  name: '测试·岩崩锤式',
  damageType: 'physical',
  atk: 700,
  baseInterval: 1.2,
  cost: 30,
  skill: { spType: 'hit', spCost: 4, duration: 0, attackMult: 2.7, nextAttack: true },
})
assert('强化攻击 hit 型周期 = n/受击频率', Math.abs(nextAttackDps(hammer, 0, 0)) > 0 && Math.abs(nextAttackDps(hammer, 0, 0)) < 3000)

// ---- 元素损伤累积（v1：每击型 + dot 型）----
// 每击型：ATK 800 × ratio 0.15 × 攻击频率 1/1.6 = 75/s
const elemOp = makeOperator({
  name: '测试·元素术士',
  damageType: 'magical',
  atk: 800,
  baseInterval: 1.6,
  cost: 19,
  element: { type: '凋亡损伤', perHitRatio: 0.15, isDot: false },
  skill: { spType: 'auto', spCost: 30, duration: 30, attackMult: 1, targetCount: 1 },
})
assert('每击型元素累积 = ATK×ratio/间隔', Math.abs(elementAccrualPerSec(elemOp) - (800 * 0.15) / 1.6) < 1e-9)
// dot 型：ATK 800 × ratio 0.1（每秒）= 80/s
const dotOp = makeOperator({
  name: '测试·dot型',
  damageType: 'magical',
  atk: 800,
  baseInterval: 1.6,
  cost: 19,
  element: { type: '神经损伤', perHitRatio: 0.1, isDot: true },
  skill: { spType: 'auto', spCost: 40, duration: 30, attackMult: 1, targetCount: 1 },
})
assert('dot 型元素累积 = ATK×ratio 每秒', Math.abs(elementAccrualPerSec(dotOp) - 80) < 1e-9)
// 无元素字段 → 0
assert('无元素字段 → 0', elementAccrualPerSec(makeOperator({ name: 'x', atk: 100, baseInterval: 1, skill: null })) === 0)

// 爆发收益模型：4 种元素对敌人的爆发数值表齐全（PRTS 2.7.61）
assert('爆发表含4元素', ['神经损伤', '侵蚀损伤', '灼燃损伤', '凋亡损伤'].every((t) => ELEMENT_BREAK_ON_ENEMY[t] !== undefined))
// 凋亡：累积 100/s → 周期 1000/100+15=25s，收益 800×15=12000 → 480/s
const aop = makeOperator({
  name: '测试·凋亡dot',
  damageType: 'magical',
  atk: 500,
  baseInterval: 1.6,
  cost: 19,
  element: { type: '凋亡损伤', perHitRatio: 0.2, isDot: true },
  skill: { spType: 'auto', spCost: 30, duration: 30, attackMult: 1, targetCount: 1 },
})
assert('凋亡 burst avg = 12000/25', Math.abs(elementBurstAvgDps(aop) - 12000 / 25) < 1e-6)
// 领袖 MAX_EP=2000 → 周期 2000/100+15=35 → 12000/35
assert('领袖条2000 → avg 降低', Math.abs(elementBurstAvgDps(aop, { maxEp: 2000 }) - 12000 / 35) < 1e-6)
// 灼燃 burst = 7000 直伤
const fop = makeOperator({
  name: '测试·灼燃',
  damageType: 'magical',
  atk: 500,
  baseInterval: 1.6,
  cost: 19,
  element: { type: '灼燃损伤', perHitRatio: 0.2, isDot: true },
  skill: { spType: 'auto', spCost: 30, duration: 30, attackMult: 1, targetCount: 1 },
})
assert('灼燃 burst avg = 7000/20', Math.abs(elementBurstAvgDps(fop) - 7000 / 20) < 1e-6)

// ---- 陷阱/棋子模型 ----
// 单枚：ATK 600 × 3.5 / cd 12s = 175/s
const t1 = makeOperator({
  name: '测试·夹子',
  damageType: 'physical',
  atk: 600,
  baseInterval: 0.85,
  cost: 13,
  trap: { mult: 3.5, cdSec: 12, cnt: 1, targets: 1 },
  skill: { spType: 'auto', spCost: 12, duration: -1, attackMult: 1 },
})
assert('单枚陷阱 DPS = 600×3.5/12', Math.abs(trapDps(t1) - (600 * 3.5) / 12) < 1e-9)
// 波次 8 枚：8×3.5×600/12
const t2 = makeOperator({ ...t1, trap: { mult: 3.8, cdSec: 12, cnt: 8, targets: 1 } })
assert('8枚波次 DPS = 8×3.8×600/12', Math.abs(trapDps(t2) - (8 * 3.8 * 600) / 12) < 1e-9)
// 覆盖触发间隔参数
assert('覆盖触发间隔生效', Math.abs(trapDps(t1, { triggerIntervalSec: 6 }) - (600 * 3.5) / 6) < 1e-9)

// ---- 单次窗口爆发技能（burst：部署次数 × 每次枚数）----
// 天下劫式：每次部署十字 5 枚 × 380% × ATK 589 = 11191/次
const bk = makeOperator({
  name: '测试·天下劫式',
  damageType: 'magical',
  atk: 589,
  baseInterval: 0.85,
  cost: 12,
  burst: { perDeployHits: 5, hitMult: 3.8, maxDeploysPerSkill: 8, skillWindowSec: 14, deploys: 16, windowSec: 78 },
  skill: { spType: 'auto', spCost: 50, duration: -1, attackMult: 1 },
})
assert('burst 单次部署 = 5×3.8×589 = 11191', Math.abs(burstDeployDamage(bk) - 5 * 3.8 * 589) < 1e-9)
assert('burst 单次技能(8部署=40枚)', Math.abs(burstTotalDamage(bk, { scope: 'skill' }) - 40 * 3.8 * 589) < 1e-9)
assert('burst 理想轴(16部署=80枚)≈179056', Math.abs(burstTotalDamage(bk, { scope: 'axis' }) - 179056) < 1)
assert('burst 轴 DPS ≈2296', Math.abs(burstDps(bk, { scope: 'axis' }) - 179056 / 78) < 1)
assert('burst 技能 DPS ≈6395', Math.abs(burstDps(bk, { scope: 'skill' }) - 89528 / 14) < 1)

// ---- 生存维度（survival.mjs）----
// 与输出侧对称：物理 max(ATK−DEF, 5%ATK)；法术 max(ATK×(1−RES/100), 5%ATK)
assert('受击·物理 550−356=194', incomingHit(550, { damageType: 'physical', def: 356 }) === 194)
assert('受击·物理 5%下限（高防）', incomingHit(550, { damageType: 'physical', def: 5000 }) === Math.floor(550 * 0.05))
assert('受击·法术 800×0.7=560', incomingHit(800, { damageType: 'magical', res: 30 }) === 560)
assert('受击·真伤无减免', incomingHit(1000, { damageType: 'true', def: 9999, res: 99 }) === 1000)
assert('受击·固定减伤先于百分比', incomingHit(1000, { damageType: 'physical', def: 0, drFlat: 100, drPct: 0.5 }) === Math.floor((1000 - 100) * 0.5))
assert('闪避倍率 65% → 1/0.35', Math.abs(dodgeMultiplier({ physical: 0.65 }, 'physical') - 1 / 0.35) < 1e-9)
assert('闪避类型分离（物理闪避不防法术）', dodgeMultiplier({ physical: 0.65, magical: 0 }, 'magical') === 1)
assert('闪避上限 95%', Math.abs(dodgeMultiplier({ physical: 1 }, 'physical') - 20) < 1e-9)

// 离散受击：1394/击、间隔 1.3s、1758 生命 → 第 2 击（t=2.6s）倒下（首击在 t=间隔）
const sim1 = surviveSim({ pool: 1758, perHit: 1394, interval: 1.3 })
assert('离散受击 2 击倒下', sim1.hits === 2)
assert('离散受击死亡时刻 t=2.6s', Math.abs(sim1.seconds - 2.6) < 1e-9)
// 单击超过总生命 → 1 击即倒（连续模型会误报 4.9s）
const sim2 = surviveSim({ pool: 1758, perHit: 2520, interval: 7 })
assert('单击致死 = 1 击', sim2.hits === 1)
assert('单击致死 t=7s', Math.abs(sim2.seconds - 7) < 1e-9)
// 自回抵扣：每击 194、间隔 3s（64.7 DPS），自回 100/s > 承伤 → 站得住
const sim3 = surviveSim({ pool: 1758, perHit: 194, interval: 3, healPerSec: 100 })
assert('自回高于承伤 → 站得住', sim3.sustained === true)
const sim4 = surviveSim({ pool: 1758, perHit: 194, interval: 3, healPerSec: 10 })
assert('自回低于承伤 → 仍会倒', sim4.sustained === false && sim4.hits !== null)

// 汇总口径：闪避摊薄承伤 → 有效生命放大
const sv = survival({ atk: 550, interval: 3, damageType: 'physical' }, { maxHp: 1758, def: 356, dodge: { physical: 0.65 } })
assert('汇总·每击 194', sv.perHit === 194)
assert('汇总·闪避使承伤摊薄', Math.abs(sv.dps - 194 / 3 / (1 / 0.35)) < 1e-9)
assert('汇总·等效生命 = 血池×防御折算×闪避倍率', Math.abs(sv.ehp - 1758 * (550 / 194) * (1 / 0.35)) < 1e-6)

// 泥岩式：3928 生命 / 602 防，对 550/3s 杂兵每击 27 → 站得住
const sv2 = survival({ atk: 550, interval: 3, damageType: 'physical' }, { maxHp: 3928, def: 602 })
assert('泥岩对杂兵每击 27', sv2.perHit === 27)
assert('泥岩对杂兵站得住', sv2.sustained === true)
// 泥岩技能期防御 1084 → 对 1000/2.6s 精英每击 50（原 398）
const sv3 = survival({ atk: 1000, interval: 2.6, damageType: 'physical' }, { maxHp: 3928, def: 1084 })
assert('泥岩技能期对精英每击 50', sv3.perHit === 50)

// ---- 输出画像 ----
console.log('\n===== 法术歼灭 输出画像（平均DPS，物理行看DEF / 法术列看RES） =====')
for (const row of dpsProfile(caster, { defs: [0, 400, 800], ress: [0, 50, 90] })) {
  console.log(`DEF=${row.def}  ${JSON.stringify(row)}`)
}

console.log(`\n===== 结果：PASS=${pass} FAIL=${fail} =====`)
process.exit(fail === 0 ? 0 : 1)
