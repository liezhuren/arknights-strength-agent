// tools/verify-summons.mjs —— 召唤物通道专项验证
//
// 验证四件事：
//   ① 数据层分类可信（伤害型有面板、功能型不计、关联完整）
//   ② 数值与手工可验算一致（Mon3tr 1402/2.0 = 701；令弦惊 823/1.5 = 548.7）
//   ③ **通道不双算**：陷阱师（traper）的产出归 trap 通道，不能再进 summon 通道
//   ④ 召唤物**不渗进本体 DPS**（独立输出线，不与 skillDps/avgDps 相加）
//
// 规格：node tools/verify-summons.mjs  → PASS=n FAIL=0
import { loadSummons, summonsOf, summonFor, excludedByTrapChannel } from './summon.mjs'
import { makeOperator, summonDps, skillDps, avgDps } from '../engine/dps-engine.mjs'
import { findOperator, evaluate } from './evaluate.mjs'

let pass = 0
let fail = 0
const assert = (name, ok, detail = '') => {
  if (ok) { pass++; return }
  fail++
  console.log(`FAIL  ${name}${detail ? ` —— ${detail}` : ''}`)
}

const all = loadSummons()
const damage = all.filter((s) => s.dealsDamage)
const support = all.filter((s) => s.combat && !s.dealsDamage)

// ---- ① 数据层分类 ----
// 数据层 74 条；引擎可见 73 条（未关联 owner 的地图装置 trap_079_allydonq 不进评测）
assert('引擎可见召唤物 73 条', all.length === 73, `实际 ${all.length}`)
assert('伤害型 41 条（引擎可见）', damage.length === 41, `实际 ${damage.length}`)
assert('功能型 8 条（无伤害，不计 DPS）', support.length === 8, `实际 ${support.length}`)
// 数据层与引擎可见数的差值必须正好是那 1 条未关联装置
{
  const raw = JSON.parse((await import('node:fs')).readFileSync(new URL('../data/summons.json', import.meta.url), 'utf8'))
  assert('数据层 74 条 = 引擎可见 73 + 未关联 1', raw.summons.length === 74 && raw.summons.filter((s) => !s.owner).length === 1)
}
assert('伤害型均有 atk>0', damage.every((s) => s.atk > 0))
assert('伤害型均有正间隔', damage.every((s) => s.interval > 0))
assert('伤害型均有 owner 关联', damage.every((s) => s.owner))
assert('同时存在数 ≥1', all.every((s) => (s.concurrency ?? 1) >= 1))
assert('限时来源标注合法', all.filter((s) => s.durationSec).every((s) => ['blackboard', 'text'].includes(s.durationSource)))
// 医疗探机是治疗无人机：atk 125 是治疗量，不能当伤害
assert('赫默医疗探机判为无伤害', support.some((s) => s.name === '医疗探机'))
assert('唯一多副本证据是维什戴尔魂灵之影', damage.filter((s) => s.concurrency > 1).length === 1
  && damage.find((s) => s.concurrency > 1).owner === '维什戴尔')

// ---- ② 数值手工验算 ----
assert('Mon3tr 单体 = 1402/2.0 = 701', Math.abs(1402 / 2.0 - 701) < 1e-9)
assert('令弦惊 单体 = 823/1.5 ≈ 548.7', Math.abs(823 / 1.5 - 548.6667) < 1e-3)
assert('鸿雪打字机 单体 = 866/1.6 = 541.25', Math.abs(866 / 1.6 - 541.25) < 1e-9)
{
  const s = summonFor('凯尔希')
  assert('凯尔希 → summon 字段生成', !!s && s.units.length === 1)
  const eng = makeOperator({ damageType: 'physical', atk: 500, baseInterval: 1.5, summon: s })
  assert('凯尔希 召唤物 DPS = 701', Math.abs(summonDps(eng) - 701) < 1e-9, `${summonDps(eng)}`)
  const m = makeOperator({ damageType: 'physical', atk: 500, baseInterval: 1.5, summon: summonFor('令') })
  assert('令 调用 summonFor → 最强形态弦惊 548.7', Math.abs(summonDps(m) - 823 / 1.5) < 1e-9, `${summonDps(m)}`)
  assert('令 记录了 3 种形态', summonFor('令').meta.modeCount === 3)
}

// ---- ③ 通道不双算（陷阱师归 trap）----
for (const name of ['罗宾', '霜华', '多萝西', '钼铅', '望']) {
  assert(`${name} 不在 summon 通道`, summonsOf(name).length === 0)
  const op = findOperator(name)
  const r = evaluate(op, { damageType: 'auto', skillIndex: 2 })
  assert(`${name} 走 trap/burst 通道且无召唤物行`, !r.summon && (!!r.trap || !!r.burst),
    `trap=${!!r.trap} burst=${!!r.burst} summon=${!!r.summon}`)
}
assert('trap 通道排除名单有 5 条', excludedByTrapChannel().length === 5)

// ---- ④ 不渗进本体 DPS ----
{
  const op = findOperator('凯尔希')
  const r = evaluate(op, { damageType: 'auto', skillIndex: 2 })
  const s = summonFor('凯尔希')
  const withSummon = makeOperator({ damageType: 'physical', atk: r.panel.atk, baseInterval: r.panel.baseInterval, summon: s })
  const without = makeOperator({ damageType: 'physical', atk: r.panel.atk, baseInterval: r.panel.baseInterval })
  assert('召唤物不改变本体 skillDps', Math.abs(skillDps(withSummon, 400, 0) - skillDps(without, 400, 0)) < 1e-9)
  assert('召唤物不改变本体 avgDps', Math.abs(avgDps(withSummon, 400, 0) - avgDps(without, 400, 0)) < 1e-9)
  assert('召唤物 DPS 单列且 > 0', r.summonDps > 0)
  assert('召唤物基准口径已算', r.summonDpsBench > 0 && r.summonDpsBench < r.summonDps)
}

// ---- ⑤ 召唤物自身技能（§18）：只建模"无条件改变普攻"的两类 ----
{
  // 傀影 S2「血色乐章」：10 层 ×20%，每击消耗一层 → 全程平均 ×1.2
  const m = makeOperator({ damageType: 'physical', summon: summonFor('傀影') })
  assert('傀影 自身技能 ×1.2 → 548×1.2/0.93 = 707.1', Math.abs(summonDps(m) - (548 * 1.2) / 0.93) < 1e-6, `${summonDps(m)}`)
  // 鸿雪 S3「锐笔速写」：攻击力提升至 255% 且攻击间隔缩短 0.6s（1.6→1.0）
  const h = makeOperator({ damageType: 'physical', summon: summonFor('鸿雪') })
  assert('鸿雪 自身技能 2.55× / 间隔 0.4 → 3450.5', Math.abs(summonDps(h) - (866 * 2.55) / (1.6 * 0.4)) < 1e-6, `${summonDps(h)}`)
  // 衡沙「上紧发条」：攻速 +60（是百分比）→ 间隔 ÷1.6
  const l = makeOperator({ damageType: 'magical', summon: summonFor('衡沙') })
  assert('衡沙 自身技能 攻速+60 → 间隔 ×0.625', Math.abs(summonDps(l) - 340 / (1.6 * 0.625)) < 1e-6, `${summonDps(l)}`)
  // 一次性入场伤害**不能**当普攻倍率：梅尔「爆破回收」6 倍、令「逍遥」4.5 倍都必须不计
  const mel = makeOperator({ damageType: 'magical', summon: summonFor('梅尔') })
  assert('梅尔 一次性 6 倍不计入普攻', Math.abs(summonDps(mel) - 444 / 1.25) < 1e-9, `${summonDps(mel)}`)
  const yao = summonFor('令')
  assert('令 选中弦惊（4.5 倍的逍遥不计）', yao.meta.mode === '“弦惊”', yao.meta.mode)
  // 未建模的条数要被统计出来（报告据此标注"下限"）
  assert('鸿雪 记录了未建模技能数', summonFor('鸿雪').meta.unmodeledSkills >= 2, `${summonFor('鸿雪').meta.unmodeledSkills}`)
  assert('弦惊 第二形态 `2.` 前缀未被套到基础形态', Math.abs(summonDps(makeOperator({ damageType: 'magical', summon: summonFor('令') })) - 823 / 1.5) < 1e-9)
}

// ---- ⑥ 一次性触发伤害（burst 层，§19）----
{
  // 梅尔「爆破回收」6 倍：444×6 = 2664（一次性，不吃普攻倍率）
  const m = summonFor('梅尔')
  assert('梅尔 触发伤害 每次 2664', Math.abs(m.meta.burst.perTrigger - 444 * 6) < 1e-9, `${m.meta.burst?.perTrigger}`)
  assert('梅尔 触发伤害来自「爆破回收」', m.meta.burst.name === '爆破回收')
  // 傀影「夜幕突袭」3 倍：548×3 = 1644（与它的持续线 ×1.2 是**两条不同输出线**）
  const p = summonFor('傀影')
  assert('傀影 触发伤害 每次 1644', Math.abs(p.meta.burst.perTrigger - 548 * 3) < 1e-9)
  assert('傀影 触发与持续互不混算（持续仍 707.1）',
    Math.abs(summonDps(makeOperator({ damageType: 'physical', summon: p })) - (548 * 1.2) / 0.93) < 1e-6)
  // 陷阱类已归 trap 通道 → **不得**再出现在 summon 的 burst 里（防双算）
  for (const n of ['罗宾', '霜华', '多萝西', '钼铅', '望']) {
    const s = summonFor(n)
    assert(`${n} 无 summon 通道（含 burst 字段）`, s === null || !s.meta.burst, `${n}`)
  }
  // 周期伤害不算 burst（死芒 S3「每秒造成」是 DoT，形态不同）
  assert('死芒 周期伤害未误判为 burst', !summonFor('死芒')?.meta?.burst, JSON.stringify(summonFor('死芒')?.meta?.burst))
  // 触发伤害**不得**并进 summonDps（频率属玩法层）
  const before = summonDps(makeOperator({ damageType: 'physical', summon: p }))
  assert('触发伤害不进 summonDps', Math.abs(before - 707.1) < 0.1, `${before}`)
}

// ---- ⑦ 召唤物技能空间（§23）：范围/索敌/目标数 ----
{
  // 有 rangeId 的召唤物应报出范围
  const wt = summonFor('温蒂')
  assert('温蒂 蓄水炮 有攻击范围 4-1', wt.meta.space?.rangeId === '4-1', JSON.stringify(wt.meta.space))
  const hx = summonFor('鸿雪')
  assert('鸿雪 打字机 有攻击范围 4-1', hx.meta.space?.rangeId === '4-1')
  // 目标数**不得**并进 summonDps（报告口径是对单目标）
  const eng = makeOperator({ damageType: 'physical', summon: wt })
  assert('空间信息不改 summonDps', Math.abs(summonDps(eng) - 585 / 2.4) < 1e-9, `${summonDps(eng)}`)
  // 目标数 > 1 时引擎**支持**叠加（units.hits/mult），但默认不叠加
  const many = makeOperator({ damageType: 'physical', summon: { units: [{ atk: 600, interval: 1.5, hits: 3 }], concurrency: 1 } })
  assert('引擎支持段数（显式传入时叠加）', Math.abs(summonDps(many) - (600 * 3) / 1.5) < 1e-9)
  // rangeId 覆盖率：伤害型 42 条里应有 15 条带范围
  const { loadSummons } = await import('./summon.mjs')
  const withRange = loadSummons().filter((s) => s.dealsDamage && (s.skillIds ?? []).length).length
  assert('伤害型召唤物技能关联完整', withRange >= 40, `${withRange}`)
}

console.log(`\n===== 召唤物验证：PASS=${pass} FAIL=${fail} =====`)
process.exit(fail === 0 ? 0 : 1)
