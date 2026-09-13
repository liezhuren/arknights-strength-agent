// tools/compare.mjs —— 多干员分场景对比（"谁更强/该练谁"类问题）
// CLI：node tools/compare.mjs 银灰 史尔特尔 [技能下标默认2]
//       node tools/compare.mjs --all-skills 银灰   （单干员全技能对比）
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { avgDps } from '../engine/dps-engine.mjs'
import { findOperator, toEngineInput } from './evaluate.mjs'
import fs from 'node:fs'

const SCENARIOS = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, '../data/scenarios.json'), 'utf8'),
).scenarios

/** 评估单个干员指定技能在全部场景的平均 DPS。技能无专三数据时自动回退到最后一个可用技能。 */
export function evalOperatorScenarios(op, skillIndex = 2) {
  // 回退：指定技能缺失/无专三 → 取最后一个有专三数据的技能
  const hasMastery = (i) => op.skills?.[i]?.levels?.[9] !== undefined
  if (!hasMastery(skillIndex)) {
    for (let i = op.skills.length - 1; i >= 0; i--) {
      if (hasMastery(i)) {
        skillIndex = i
        break
      }
    }
  }
  const eng = toEngineInput(op, { skillIndex })
  const skillName = op.skills[skillIndex]?.levels?.[9]?.name ?? op.skills[skillIndex]?.id ?? '?'
  return {
    operator: op.name,
    rarity: op.rarity,
    damageType: eng.damageType,
    skillName,
    cost: eng.cost,
    rows: SCENARIOS.map((sc) => ({
      id: sc.id,
      name: sc.name,
      def: sc.def,
      res: sc.res,
      avgDps: Math.round(avgDps(eng, sc.def, sc.res) * 10) / 10,
    })),
  }
}

/** 渲染对比表：行 = 场景，列 = 干员，每行最佳加 ★。 */
export function formatComparison(results) {
  const header = ['场景'.padEnd(12), ...results.map((r) => `${r.operator}·${r.skillName}(${r.damageType})`.padEnd(22))]
  const lines = [header.join(' | '), header.map(() => '---').join('-+-')]
  for (let i = 0; i < SCENARIOS.length; i++) {
    const sc = SCENARIOS[i]
    const values = results.map((r) => r.rows[i].avgDps)
    const best = Math.max(...values)
    const cells = results.map((r, j) => {
      const v = r.rows[i].avgDps
      const mark = v === best ? ' ★' : ''
      return `${String(v).padStart(8)}${mark}`.padEnd(22)
    })
    lines.push(`${`${sc.name} ${sc.def}/${sc.res}`.padEnd(12)} | ${cells.join(' | ')}`)
  }
  return lines.join('\n')
}

if (process.argv[1] && new URL(import.meta.url).pathname === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).pathname) {
  const args = process.argv.slice(2)
  const allSkills = args[0] === '--all-skills'
  if (allSkills) args.shift()
  try {
    if (allSkills) {
      const op = findOperator(args[0])
      if (!op) throw new Error(`未找到干员：${args[0]}`)
      const results = [0, 1, 2]
        .filter((i) => op.skills?.[i]?.levels?.[9])
        .map((i) => evalOperatorScenarios(op, i))
      console.log(formatComparison(results))
    } else {
      let skillIndex = 2
      const names = args.filter((a) => !/^\d+$/.test(a))
      const numIdx = args.find((a) => /^\d+$/.test(a))
      if (numIdx !== undefined) skillIndex = Number(numIdx)
      const results = names.map((n) => {
        const op = findOperator(n)
        if (!op) throw new Error(`未找到干员：${n}`)
        return evalOperatorScenarios(op, skillIndex)
      })
      console.log(formatComparison(results))
    }
  } catch (e) {
    console.error(`对比失败：${e.message}`)
    process.exit(1)
  }
}
