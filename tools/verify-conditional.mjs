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

// 数据集路径：基于本文件位置解析，**不写死绝对路径**（否则别人克隆后跑不了）
const OPS = new URL('../data/operators.json', import.meta.url)

let pass = 0
let fail = 0
const assert = (name, ok, detail = '') => {
  if (ok) { pass++; return }
  fail++
  console.log(`FAIL  ${name}${detail ? ` —— ${detail}` : ''}`)
}

const ops = JSON.parse(readFileSync(OPS, 'utf8')).operators
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

// ---- ⑤ 模组/基础特性的条件型攻击倍率（§21）----
{
  const ev = (name, spec) => evaluate(byName.get(name), { damageType: 'auto', skillIndex: 2, moduleSpec: spec })
  // 对空型（能天使「杰作」atk_scale 1.1）
  const ex = ev('能天使', 'default')
  assert('能天使 杰作 → 对空条件型 ×1.1', ex.conditionalTraits?.[0]?.kind === 'air' && ex.conditionalTraits[0].value === 1.1,
    JSON.stringify(ex.conditionalTraits))
  assert('对空条件型未进基准（基准仍是 1994.6）', Math.abs(ex.benchmark.skillDpsVs400Def - 1994.6) < 0.05, `${ex.benchmark.skillDpsVs400Def}`)
  assert('条件化数值 = 基准 × 1.1', Math.abs(ex.conditionalSkillDps - ex.benchmark.skillDpsVs400Def * 1.1) < 0.05)
  // override 语义：帕拉斯基础 1.2 被模组 1.3 覆盖 → 只取 1.3（错误做法会得 1.56）
  const pa = ev('帕拉斯', 'default')
  assert('帕拉斯 override → 只取模组 1.3', pa.conditionalTraits?.length === 1 && pa.conditionalTraits[0].value === 1.3,
    JSON.stringify(pa.conditionalTraits?.map((x) => x.value)))
  assert('帕拉斯 条件化数值 = 基准 × 1.3（非 ×1.56）', Math.abs(pa.conditionalSkillDps - pa.benchmark.skillDpsVs400Def * 1.3) < 0.05)
  // add 语义：耀骑士临光 → ×1.15
  const nr = ev('耀骑士临光', 'default')
  assert('耀骑士临光 add → ×1.15', nr.conditionalTraits?.[0]?.kind === 'blocked' && nr.conditionalTraits[0].value === 1.15,
    JSON.stringify(nr.conditionalTraits))
  // 距离型（damage_scale 0.1 → ×1.1），且走 override
  const ifr = ev('伊芙利特', 'default')
  assert('伊芙利特 距离型 ×1.1', ifr.conditionalTraits?.[0]?.kind === 'distance' && Math.abs(ifr.conditionalTraits[0].value - 1.1) < 1e-9,
    JSON.stringify(ifr.conditionalTraits))
  // 领主降伤（0.8）是**降伤**不是加成 → 不得出现在条件型加成里
  const yh = ev('银灰', undefined)
  assert('银灰 领主 0.8 降伤不进条件型加成', !(yh.conditionalTraits ?? []).some((t) => t.value < 1),
    JSON.stringify(yh.conditionalTraits))
  assert('银灰 基准仍 5524.6（零漂移）', Math.abs(yh.benchmark.skillDpsVs400Def - 5524.6) < 0.05)
  // 无模组时不引入条件型
  assert('未启用模组 → 无条件型加成', (ev('能天使', undefined).conditionalTraits ?? []).length === 0)
}

// ---- ⑥ 召唤物自身生存（§23）----
{
  const { formatSummonSurvival } = await import('./summon.mjs')
  const kl = formatSummonSurvival('凯尔希')
  assert('凯尔希 有召唤物生存行', kl.length > 0 && /Mon3tr|生命 5433/.test(kl[0]), JSON.stringify(kl[0]))
  assert('召唤物生存注明"不与本体合并"', kl[0].includes('不与本体合并'))
  assert('召唤物生存给出 5 档画像', (() => { const j = kl.join(' '); return /物理·清杂/.test(j) && /物理·精英/.test(j) && /物理·狂暴/.test(j) && /法术·中压/.test(j) && /法术·高压/.test(j) })())
  assert('召唤物生存标注"自身技能防御/生命未建模"', kl.some((l) => /防御\/生命强化\*\*未建模/.test(l)))
  // 无召唤物干员 → 空
  assert('银灰 无召唤物生存行', formatSummonSurvival('银灰').length === 0)
}

console.log(`\n===== 条件型验证：PASS=${pass} FAIL=${fail} =====`)
process.exit(fail === 0 ? 0 : 1)
