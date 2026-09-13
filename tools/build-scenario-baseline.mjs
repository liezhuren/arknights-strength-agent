// tools/build-scenario-baseline.mjs —— 场景基准表：每个标准场景下全库干员的输出分布
// 用途：给"泛用性"提供**可用线**（某干员在该场景是否达到全库中位/下四分位水平）
// 口径：
//   · 每名干员取主力技能（S3，无则最高可用）+ 专三 + damageType 自动推断
//   · 稳态干员取 avgDps（含覆盖率加权）；爆发/陷阱干员取各自通道的技能期 DPS
//     （两者的绝对量级口径不同，故此表只用于"该场景的量级线"，不用于跨干员严格排序）
import { readFile, writeFile } from 'node:fs/promises'
import { toEngineInput, resolveSkillIndex, findOperator } from './evaluate.mjs'
import { avgDps, burstDps, trapDps, nextAttackDps } from '../engine/dps-engine.mjs'

const ops = JSON.parse(await readFile('E:/github/arknights-strength-agent/data/operators.json', 'utf8')).operators
const scenarios = JSON.parse(await readFile('E:/github/arknights-strength-agent/data/scenarios.json', 'utf8')).scenarios

/** 某干员在某场景的输出值（统一"技能期/稳态"量级口径）。 */
function valueFor(eng, def, res) {
  if (eng.burst) return burstDps(eng, { scope: 'skill', mitigation: { def, res } })
  if (eng.trap) return trapDps(eng)
  if (eng.skill && (eng.skill.duration ?? 0) <= 0 && eng.skill.nextAttack) return nextAttackDps(eng, def, res)
  if (eng.skill?.noAttack) return avgDps(eng, def, res) // 停止攻击型：只有增益，取平均
  return avgDps(eng, def, res)
}

const perScenario = {}
let evaluated = 0
const skipped = []

for (const op of ops) {
  const si = resolveSkillIndex(op, 2)
  let eng
  try {
    eng = toEngineInput(op, { damageType: 'auto', skillIndex: si.index })
  } catch (e) {
    skipped.push(op.name)
    continue
  }
  evaluated++
  for (const sc of scenarios) {
    const v = valueFor(eng, sc.def, sc.res)
    ;(perScenario[sc.id] ??= []).push({ name: op.name, value: v })
  }
}

const pct = (arr, p) => {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(Math.floor(s.length * p), s.length - 1)]
}

const out = {
  generatedAt: new Date().toISOString().slice(0, 10),
  note: '泛用性可用线来源：全库干员在各标准场景的输出分布（主力技能/专三）。稳态取 avgDps，爆发/陷阱取各自通道技能期 DPS，仅用于量级线判断。',
  evaluated,
  skipped: skipped.length,
  scenarios: scenarios.map((sc) => {
    const vals = perScenario[sc.id].map((x) => x.value).filter((v) => Number.isFinite(v))
    const sorted = [...perScenario[sc.id]].filter((x) => Number.isFinite(x.value)).sort((a, b) => b.value - a.value)
    return {
      id: sc.id,
      name: sc.name,
      def: sc.def,
      res: sc.res,
      count: vals.length,
      p10: +pct(vals, 0.10).toFixed(1),
      p25: +pct(vals, 0.25).toFixed(1),
      p50: +pct(vals, 0.50).toFixed(1),
      p75: +pct(vals, 0.75).toFixed(1),
      p90: +pct(vals, 0.90).toFixed(1),
      median: +pct(vals, 0.50).toFixed(1),
      top: sorted.slice(0, 3).map((x) => `${x.name} ${x.value.toFixed(0)}`),
    }
  }),
}

await writeFile('E:/github/arknights-strength-agent/data/scenario-baseline.json', JSON.stringify(out, null, 1), 'utf8')
console.log(`✅ 场景基准表已生成（评测 ${evaluated} 名干员，跳过无技能 ${skipped.length} 名）`)
for (const s of out.scenarios) {
  console.log(`  ${s.name.padEnd(16)} DEF${String(s.def).padStart(4)} RES${String(s.res).padStart(3)} | p25=${String(s.p25).padStart(7)} p50=${String(s.p50).padStart(7)} p75=${String(s.p75).padStart(7)} | 榜首 ${s.top[0]}`)
}
