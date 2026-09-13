// tools/evaluate-custom.mjs —— 自创干员评测（目标功能②）
// 流程：读 JSON → 按 custom-operator.schema.json 校验 → 转引擎输入 → 评测 → 报告
// CLI：node tools/evaluate-custom.mjs <custom-operator.json>
// 也可作为模块：evaluateCustom(data) / validateCustomOperator(data)
import fs from 'node:fs'
import path from 'node:path'
import { makeOperator } from '../engine/dps-engine.mjs'
import { evaluateEngine, formatReport } from './evaluate.mjs'

const SCHEMA_PATH = path.resolve(import.meta.dirname, '../engine/custom-operator.schema.json')
const SCHEMA = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'))

/**
 * 按 schema 校验自创干员输入（动态读 schema，避免校验逻辑与 schema 漂移）。
 * @returns {string[]} 错误列表（空 = 通过）
 */
export function validateCustomOperator(data) {
  const errors = []
  if (typeof data !== 'object' || data === null) return ['输入必须是 JSON 对象']

  const props = SCHEMA.properties
  for (const key of SCHEMA.required ?? []) {
    if (data[key] === undefined) errors.push(`缺少必填字段 ${key}`)
  }

  const checkEnum = (value, prop, label) => {
    if (value === undefined) return
    const enumValues = prop?.enum
    if (Array.isArray(enumValues) && !enumValues.includes(value)) {
      errors.push(`${label} 必须是 ${enumValues.join('/')}，得到 "${value}"`)
    }
  }
  checkEnum(data.damageType, props.damageType, 'damageType')
  checkEnum(data.skill?.spType, props.skill?.properties?.spType, 'skill.spType')

  const checkNumber = (value, prop, label) => {
    if (value === undefined) return
    if (typeof value !== 'number' || Number.isNaN(value)) {
      errors.push(`${label} 必须是数字`)
      return
    }
    if (prop?.minimum !== undefined && value < prop.minimum) errors.push(`${label} 不能小于 ${prop.minimum}`)
    if (prop?.maximum !== undefined && value > prop.maximum) errors.push(`${label} 不能大于 ${prop.maximum}`)
    if (prop?.exclusiveMinimum !== undefined && value <= prop.exclusiveMinimum) errors.push(`${label} 必须大于 ${prop.exclusiveMinimum}`)
    if (prop?.exclusiveMaximum !== undefined && value >= prop.exclusiveMaximum) errors.push(`${label} 必须小于 ${prop.exclusiveMaximum}`)
  }
  for (const [key, prop] of Object.entries(props)) {
    if (prop.type !== 'number' && prop.type !== 'integer') continue
    checkNumber(data[key], prop, key)
  }
  for (const [key, prop] of Object.entries(props.skill?.properties ?? {})) {
    if (prop.type !== 'number' && prop.type !== 'integer') continue
    checkNumber(data.skill?.[key], prop, `skill.${key}`)
  }
  return errors
}

/**
 * 自创干员 → 评测结果（与数据集干员同一套 evaluateEngine）。
 */
export function evaluateCustom(data) {
  const errors = validateCustomOperator(data)
  if (errors.length > 0) {
    throw new Error(`自创干员校验失败：${errors.join('；')}`)
  }
  const eng = makeOperator({
    name: data.name,
    rarity: data.rarity,
    archetype: data.archetype,
    maxHp: data.maxHp,
    atk: data.atk,
    def: data.def,
    res: data.res,
    baseInterval: data.baseInterval,
    blockCount: data.blockCount,
    cost: data.cost,
    redeployTime: data.redeployTime,
    damageType: data.damageType,
    hitCount: data.hitCount,
    targetCount: data.targetCount,
    spRecoveryPerSec: data.spRecoveryPerSec,
    hitAssumptionPerSec: data.hitAssumptionPerSec,
    talents: data.talents,
    skill: data.skill,
  })
  return evaluateEngine(eng, {
    operator: `[自创] ${data.name}`,
    rarity: data.rarity ?? 5,
    profession: data.archetype ?? '自定义',
    skill: data.skill?.name ?? null,
  })
}

if (process.argv[1] && new URL(import.meta.url).pathname === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).pathname) {
  const file = process.argv[2]
  if (!file) {
    console.error('用法：node tools/evaluate-custom.mjs <custom-operator.json>')
    process.exit(1)
  }
  try {
    const data = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))
    console.log(formatReport(evaluateCustom(data)))
  } catch (e) {
    console.error(`评测失败：${e.message}`)
    process.exit(1)
  }
}
