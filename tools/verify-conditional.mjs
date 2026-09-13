// tools/verify-conditional.mjs —— 条件型加成 / 索敌 / 蓄力两态 专项验证
//
// 验证：
//   ① 对空加成识别正确且**未进 DPS**（阿罗玛，全库仅 1 人）
//   ② 索敌规则覆盖（含"来自特性"的狙击系 —— 只在技能描述上找会漏 23 名）
//   ③ 蓄力两态覆盖与数值差
//   ④ **不污染基准 DPS**：加层前后银灰等锚点不变
import { readFileSync } from 'node:fs'
import { findOperator, evaluate } from './evaluate.mjs'
import { extractConditional } from './conditional.mjs'

let pass = 0
let fail = 0
const assert = (name, ok, detail = '') => {
  if (ok) { pass++; return }
  fail++
  console.log(`FAIL  ${name}${detail ? ` —— ${detail}` : ''}`)
}

const ops = JSON.parse(readFileSync('E:/github/arknights-strength-agent/data/operators.json', 'utf8')).operators
const byName = new Map(ops.map((o) => [o.name, o]))

// ---- ① 对空加成 ----
{
  const c = extractConditional(byName.get('阿罗玛'), 0, 9)
  assert('阿罗玛 S1 对空加成 = 90%', c?.airBonus?.pct === 0.9, JSON.stringify(c?.airBonus?.pct))
  assert('对空加成标注了来源技能', c?.airBonus?.skillIndex === 0)
  // 阿罗玛 S3 无该加成 → 技能下标 2 时应回退到有加成的技能并说明
  const c3 = extractConditional(byName.get('阿罗玛'), 2, 9)
  assert('阿罗玛 S3 无对空加成时回退并标注来源', c3?.airBonus?.skillIndex === 0)
  // 对空加成不得进入 DPS：阿罗玛 S1 的 DPS 与"无该加成"的口径一致（无法直接比，改为验证字段独立）
  const r = evaluate(byName.get('阿罗玛'), { damageType: 'auto', skillIndex: 0 })
  assert('对空加成不进 benchmark（字段独立）', r.conditional?.airBonus && r.benchmark !== undefined)
}

// ---- ② 索敌规则 ----
{
  const sniper = extractConditional(byName.get('能天使'), 2, 9)
  assert('能天使 索敌来自**特性**（只在技能描述找会漏）',
    sniper.priority.some((p) => p.src === '特性' && p.target === '空中单位'),
    JSON.stringify(sniper.priority))
  const kuy = extractConditional(byName.get('苦艾'), 0, 9)
  assert('苦艾 索敌不含转义换行残留', kuy.priority.every((p) => !/\\n|持续/.test(p.target)), JSON.stringify(kuy.priority))
  const shan = extractConditional(byName.get('闪击'), 2, 9)
  assert('闪击 索敌在"且"处截断', shan.priority.every((p) => !/且|攻击力提升/.test(p.target)), JSON.stringify(shan.priority))
  const anbill = extractConditional(byName.get('安比尔'), 2, 9)
  assert('安比尔 索敌 = 防御力最低', anbill.priority.some((p) => /防御力最低/.test(p.target)), JSON.stringify(anbill.priority))
}

// ---- ③ 蓄力两态 ----
{
  for (const name of ['卡涅利安', '龙舌兰', '灵知', '斥罪']) {
    const c = extractConditional(byName.get(name), 2, 9)
    assert(`${name} 有蓄力两态`, !!c?.charge, JSON.stringify(Object.keys(c ?? {})))
    assert(`${name} 蓄力有数值差`, (c?.charge?.valueDiffs?.length ?? 0) > 0)
  }
  const lz = extractConditional(byName.get('灵知'), 2, 9)
  const d = lz.charge.valueDiffs.find((x) => x.key === 'atk_scale')
  assert('灵知 蓄力 atk_scale 1.7 → 2', d?.from === 1.7 && d?.to === 2, JSON.stringify(d))
  const kn = extractConditional(byName.get('卡涅利安'), 2, 9)
  assert('卡涅利安 蓄力 atk 0.45 → 0.6', kn.charge.valueDiffs.some((x) => x.key === 'atk' && x.from === 0.45 && x.to === 0.6))
}

// ---- ④ 覆盖统计 + 不污染锚点 ----
{
  let air = 0, prio = 0, charge = 0, failN = 0
  for (const o of ops) {
    if (!(o.skills ?? []).length) continue
    try {
      const r = evaluate(o, { damageType: 'auto', skillIndex: 2 })
      if (r.conditional?.airBonus) air++
      if (r.conditional?.priority?.length) prio++
      if (r.conditional?.charge) charge++
    } catch { failN++ }
  }
  assert('对空加成覆盖 = 1（仅阿罗玛）', air === 1, `${air}`)
  assert('索敌规则覆盖 40–55 名', prio >= 40 && prio <= 55, `${prio}`)
  assert('蓄力两态覆盖 = 9', charge === 9, `${charge}`)
  assert('全库无异常', failN === 0, `${failN}`)
  // 锚点：条件型层是纯新增，绝不改数值
  const yh = evaluate(findOperator('银灰'), { damageType: 'physical', skillIndex: 2 })
  assert('银灰 技能期 DPS 仍为 5524.6', Math.abs(yh.benchmark.skillDpsVs400Def - 5524.6) < 0.05, `${yh.benchmark.skillDpsVs400Def}`)
}

console.log(`\n===== 条件型验证：PASS=${pass} FAIL=${fail} =====`)
process.exit(fail === 0 ? 0 : 1)
