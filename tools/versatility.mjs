// tools/versatility.mjs —— ⑤ 泛用性（用户定位的四项关键点之一）
//
// 回答"换个场景还强不强"。三个可验证指标 + 一个分级（不合成假精确的单一分数）：
//   1. 场景覆盖：6 个标准场景中达到**全库可用线**的数量（p25 = 基本可用线 / p50 = 稳健线）
//   2. 波动比：最差场景 ÷ 中位场景（越低越偏科）
//   3. 属性衰减：物理看 DEF 0→800 的衰减、法术看 RES 0→90 的衰减（越平越泛用）
// 可用线来自 data/scenario-baseline.json（全库 433 名干员的分布）
import fs from 'node:fs'
import path from 'node:path'
import { avgDps, burstDps, trapDps, nextAttackDps } from '../engine/dps-engine.mjs'

const BASE = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../data/scenario-baseline.json'), 'utf8'))
const SCEN = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../data/scenarios.json'), 'utf8')).scenarios
export const SCENARIO_BASELINE = BASE

/** 与基准表同口径的场景输出值。 */
export function scenarioValue(eng, def, res) {
  if (eng.burst) return burstDps(eng, { scope: 'skill', mitigation: { def, res } })
  if (eng.trap) return trapDps(eng)
  if (eng.skill && (eng.skill.duration ?? 0) <= 0 && eng.skill.nextAttack) return nextAttackDps(eng, def, res)
  return avgDps(eng, def, res)
}

/**
 * 泛用性画像。
 * @returns {{rows:Array, coverageP25:number, coverageP50:number, worstOverMedian:number,
 *            decay:object, tier:string, reasons:string[]}}
 */
export function extractVersatility(eng) {
  const rows = SCENARIO_BASELINE.scenarios.map((b) => {
    const sc = SCEN.find((s) => s.id === b.id)
    const v = scenarioValue(eng, sc.def, sc.res)
    return { id: b.id, name: b.name, def: sc.def, res: sc.res, value: v, p25: b.p25, p50: b.p50, ok25: v >= b.p25, ok50: v >= b.p50 }
  })
  const vals = rows.map((r) => r.value).filter(Number.isFinite)
  const sorted = [...vals].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0
  const worst = sorted[0] ?? 0
  // 属性衰减：物理看 DEF，法术看 RES（另一项对己无效）
  const phys = eng.damageType === 'physical'
  const hi = phys ? scenarioValue(eng, 800, 0) : scenarioValue(eng, 0, 90)
  const lo = phys ? scenarioValue(eng, 0, 0) : scenarioValue(eng, 0, 0)
  const decayPct = lo > 0 ? (1 - hi / lo) * 100 : 0
  const coverageP25 = rows.filter((r) => r.ok25).length
  const coverageP50 = rows.filter((r) => r.ok50).length
  const worstOverMedian = median > 0 ? worst / median : 0

  const reasons = []
  let tier
  if (coverageP50 >= 5 && worstOverMedian >= 0.5) {
    tier = '全能型'
    reasons.push(`六场景中 ${coverageP50}/6 达稳健线，且波动小（最差/中位 ${worstOverMedian.toFixed(2)}）`)
  } else if (coverageP50 >= 5) {
    tier = '通用型'
    reasons.push(`${coverageP50}/6 场景达稳健线，但自身波动较大（最差/中位 ${worstOverMedian.toFixed(2)}）`)
  } else if (coverageP25 >= 5) {
    tier = '通用型'
    reasons.push(`全部场景达基本可用线，其中 ${coverageP50}/6 达稳健线`)
  } else if (coverageP25 >= 3) {
    tier = '偏科型'
    reasons.push(`仅 ${coverageP25}/6 场景达基本可用线（${coverageP50}/6 达稳健线）`)
  } else {
    tier = '特化型'
    reasons.push(`仅 ${coverageP25}/6 场景可用，高度依赖特定敌人画像`)
  }
  if (decayPct >= 70) reasons.push(`${phys ? '高防' : '高抗'}场景衰减 ${decayPct.toFixed(0)}%（对${phys ? '护甲' : '法抗'}极敏感）`)
  else if (decayPct <= 30) reasons.push(`${phys ? '护甲' : '法抗'}敏感度低（衰减仅 ${decayPct.toFixed(0)}%），属性适应性强`)
  if (worstOverMedian < 0.4 && median > 0) reasons.push(`最差/中位 = ${worstOverMedian.toFixed(2)}，短板场景需队友补足`)
  if (eng.element) reasons.push('元素伤害不吃 DEF/RES → 天然适应高防高抗')
  return { rows, coverageP25, coverageP50, worstOverMedian, decayPct, phys, tier, reasons, median, worst }
}

/** 渲染【泛用性】栏。 */
export function formatVersatilitySection(eng) {
  const v = extractVersatility(eng)
  if (!v.rows.length) return null
  const lines = ['【泛用性】（关键点之一：换场景还强不强；可用线 = 全库 433 名干员分布）']
  lines.push('  场景          敌方画像        输出      可用线(p25/p50)   判定')
  for (const r of v.rows) {
    const mark = r.ok50 ? '稳健' : r.ok25 ? '基本可用' : '**低于可用线**'
    lines.push(`    ${r.name.padEnd(12)}${String(`DEF${r.def}/RES${r.res}`).padEnd(15)}${String(Math.round(r.value)).padStart(7)}   ${String(Math.round(r.p25)).padStart(6)}/${String(Math.round(r.p50)).padStart(6)}      ${mark}`)
  }
  lines.push(`  覆盖：达基本可用线 ${v.coverageP25}/6 · 达稳健线 ${v.coverageP50}/6 · 波动比（最差/中位）${v.worstOverMedian.toFixed(2)}`)
  lines.push(`  属性衰减：${v.phys ? 'DEF 0→800' : 'RES 0→90'} 衰减 ${v.decayPct.toFixed(0)}%`)
  lines.push(`  分级：**${v.tier}** —— ${v.reasons.join('；')}`)
  lines.push('  说明：可用线来自全库干员主力技能输出分布（稳态取平均 DPS、爆发/陷阱取各自通道），用于量级判断；')
  lines.push('        高难场景的实际上场价值还需结合射程、费用、控制与团队配合判断')
  return lines.join('\n')
}
