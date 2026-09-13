// tools/smoke.mjs —— 全量冒烟：454 干员 × {无模组 / 默认模组 / 特限模组} 配置，统计异常分类
import { readFile } from 'node:fs/promises'
import { evaluate } from './evaluate.mjs'

const ops = JSON.parse(await readFile('E:/github/arknights-strength-agent/data/operators.json', 'utf8')).operators
const stats = { ok: 0, byReason: {}, unexpected: [] }
const note = (k) => { stats.byReason[k] = (stats.byReason[k] ?? 0) + 1 }

for (const op of ops) {
  for (const spec of [undefined, 'default', 'isw']) {
    try {
      evaluate(op, { damageType: 'auto', skillIndex: 2, moduleSpec: spec })
      stats.ok++
    } catch (e) {
      const m = e.message
      if (/缺少技能/.test(m)) note('缺少技能数据')
      else if (/没有可用技能/.test(m)) note('无技能干员（仅面板维度）')
      else if (/没有模组数据/.test(m)) note('该干员无模组')
      else if (/未找到模组/.test(m)) note('无对应类型模组')
      else stats.unexpected.push(`${op.name} [${spec ?? 'none'}] ${m}`)
    }
  }
}
console.log(`干员 ${ops.length} × 3 配置 = ${ops.length * 3} 次`)
console.log(`成功 ${stats.ok}`)
for (const [k, v] of Object.entries(stats.byReason)) console.log(`  ${k}: ${v}`)
console.log(`意外异常 ${stats.unexpected.length}`)
for (const u of stats.unexpected.slice(0, 20)) console.log('  ' + u)

// 有模组的干员里，三种配置都能跑的覆盖率
const withMod = ops.filter((o) => (o.modules ?? []).length)
console.log(`\n有模组的干员 ${withMod.length}`)
