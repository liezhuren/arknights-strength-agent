// tools/scenario-eval.mjs —— 分场景评测：干员在标准场景下的 DPS 画像
// CLI：node tools/scenario-eval.mjs <干员名> [auto|physical|magical] [技能下标]
// 也支持自创干员 JSON：node tools/scenario-eval.mjs --custom <file.json>
import fs from 'node:fs'
import path from 'node:path'
import { avgDps, skillDps } from '../engine/dps-engine.mjs'
import { findOperator, toEngineInput, evaluateEngine, formatReport } from './evaluate.mjs'
import { evaluateCustom } from './evaluate-custom.mjs'

const SCENARIOS = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../data/scenarios.json'), 'utf8')).scenarios

/**
 * 对引擎输入计算分场景 DPS 画像。
 * @param {object} eng - makeOperator 产物
 * @param {Array} [scenarioList]
 */
export function scenarioProfile(eng, scenarioList = SCENARIOS) {
  return scenarioList.map((sc) => ({
    id: sc.id,
    name: sc.name,
    def: sc.def,
    res: sc.res,
    avgDps: Math.round(avgDps(eng, sc.def, sc.res) * 10) / 10,
    skillDps: Math.round(skillDps(eng, sc.def, sc.res) * 10) / 10,
  }))
}

/** 分场景报告文本。 */
export function formatScenarioReport(result, scenarios) {
  const lines = [
    `\n【分场景输出画像】${result.operator}「${result.skill}」(${result.damageType})`,
    `场景                        平均DPS    技能期DPS`,
    `------------------------------------------------------`,
  ]
  for (const sc of scenarios) {
    lines.push(
      `${sc.name.padEnd(14)}  DEF${String(sc.def).padStart(4)}/RES${String(sc.res).padStart(3)}  ${String(sc.avgDps).padStart(9)}  ${String(sc.skillDps).padStart(10)}`,
    )
  }
  lines.push('------------------------------------------------------')
  lines.push('说明：物理伤害看 DEF 列，法术伤害看 RES 列；"平均DPS"含技能覆盖率。')
  return lines.join('\n')
}

if (process.argv[1] && new URL(import.meta.url).pathname === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).pathname) {
  const argv = process.argv.slice(2)
  const isCustom = argv[0] === '--custom'
  try {
    let result
    let scenarios
    if (isCustom) {
      const data = JSON.parse(fs.readFileSync(path.resolve(argv[1]), 'utf8'))
      result = evaluateCustom(data)
      const eng = makeEngineFromCustom(data)
      scenarios = scenarioProfile(eng)
      result.scenarioProfile = scenarios
    } else {
      const [query, dmg = 'auto', idx = '2'] = argv
      const op = findOperator(query)
      if (!op) throw new Error(`未找到干员：${query}`)
      const eng = toEngineInput(op, { damageType: dmg === 'auto' ? undefined : dmg, skillIndex: Number(idx) })
      result = evaluateEngine(eng, {
        operator: op.name, rarity: op.rarity,
        profession: `${op.profession}/${op.subProfessionId}`,
        skill: op.skills[Number(idx)]?.levels?.[9]?.name ?? null,
      })
      scenarios = scenarioProfile(eng)
      result.scenarioProfile = scenarios
    }
    console.log(formatReport(result))
    console.log(formatScenarioReport(result, scenarios))
  } catch (e) {
    console.error(`评测失败：${e.message}`)
    process.exit(1)
  }
}

// 辅助：自创干员 JSON → 引擎输入（避免循环依赖，直接复用 evaluate-custom 的 makeOperator 语义）
import { makeOperator } from '../engine/dps-engine.mjs'
function makeEngineFromCustom(data) {
  return makeOperator({
    name: data.name, rarity: data.rarity, archetype: data.archetype,
    maxHp: data.maxHp, atk: data.atk, def: data.def, res: data.res,
    baseInterval: data.baseInterval, blockCount: data.blockCount, cost: data.cost,
    redeployTime: data.redeployTime, damageType: data.damageType,
    hitCount: data.hitCount, targetCount: data.targetCount, talents: data.talents,
    skill: data.skill,
  })
}
